/** The Gauge command hooks' controller: transport per command, local fallback with the same id, retries, no offline queue. */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Answer, GaugeCommand, GaugeCommandsApi, GaugeLinkState } from '@/net/gaugeCommands';
import type { LocalRun } from '@/platform/gaugeLocal';
import { createGaugeCommandsController, useGaugeCommand, useGaugeLink, type LocalTransport } from '../gaugeCommands';

const cmd = (patch: Partial<GaugeCommand>): GaugeCommand => ({
  id: 'x', type: 'hr.measure', payload: {}, state: 'queued', code: null, detail: null, result: null, issuedAt: '2026-10-27T04:00:00.000Z',
  expiresAt: '2026-10-27T04:01:00.000Z', occurredAt: null, deliveredAt: null, attempt: 0, installationId: 'i', updatedAt: '2026-10-27T04:00:00.000Z', ...patch,
});
const LINK: GaugeLinkState = {
  paired: true, installationId: 'i', online: true, lastPollAt: '2026-10-27T04:00:00.000Z', appVersion: '2.8.0', capabilities: ['hr.measure', 'workout.start'],
  reels: { enabled: true, dailyLimit: 30, countdownSeconds: 5, apps: ['instagram', 'youtube'] }, recording: null, serverNow: '2026-10-27T04:00:00.000Z',
};

/** A server that runs every command to `done` (or answers `send` with a problem). */
function fakeApi(o: { sendProblem?: 'server_unreachable' } = {}) {
  const sends: Array<{ id: string; type: string; payload: unknown }> = [];
  const api: GaugeCommandsApi = {
    send: vi.fn(async (c) => {
      sends.push({ id: c.id, type: c.type, payload: c.payload });
      if (o.sendProblem) return { ok: false as const, problem: o.sendProblem };
      return { ok: true as const, command: cmd({ id: c.id, type: c.type, payload: c.payload as Record<string, unknown> }), online: true };
    }),
    get: vi.fn(),
    watch: vi.fn(async (id, w) => {
      const done = cmd({ id, state: 'done', result: { ok: 1 } });
      w?.onUpdate?.(cmd({ id, state: 'running' }), true);
      w?.onUpdate?.(done, true);
      return { ok: true as const, command: done, online: true };
    }),
    list: vi.fn(async () => ({ ok: true as const, commands: [cmd({ id: 'old-1', type: 'update.check', state: 'done', result: { outcome: 'UP_TO_DATE' } })] })),
    cancel: vi.fn(),
    state: vi.fn(async (): Promise<Answer<{ state: GaugeLinkState }>> => ({ ok: true, state: LINK })),
  };
  return { api, sends };
}

function fakeLocal(available: boolean, run: (type: string) => LocalRun = () => ({ kind: 'ack', status: 'done', result: { state: 'recording', sessionId: 'w-1' } })) {
  const runs: string[] = [];
  const local: LocalTransport = {
    probe: vi.fn(async () => available),
    run: vi.fn(async (type) => {
      runs.push(type);
      return run(type);
    }),
  };
  return { local, runs };
}

describe('gauge command controller', () => {
  it('picks the transport per command: workouts local when the probe passes, everything else the server', async () => {
    const { api, sends } = fakeApi();
    const { local, runs } = fakeLocal(true);
    const ctl = createGaugeCommandsController({ api, local });
    expect(ctl.transportFor('workout.start')).toBe('server');
    await ctl.probeLocal();
    expect(ctl.transportFor('workout.start')).toBe('local');
    expect(ctl.transportFor('workout.stop')).toBe('local');
    expect(ctl.transportFor('hr.measure')).toBe('server');
    expect(ctl.transportFor('reels.set')).toBe('server');

    const start = await ctl.send('workout.start', { type: 'walk' });
    expect(start).toMatchObject({ state: 'done', via: 'local', result: { sessionId: 'w-1' } });
    const hr = await ctl.send('hr.measure', {});
    expect(hr).toMatchObject({ state: 'done', via: 'server', result: { ok: 1 } });
    expect(runs).toEqual(['workout.start']);
    expect(sends.map((s) => s.type)).toEqual(['hr.measure']);
  });

  it('probes before the first workout command, and without the plugin sends workouts to the server', async () => {
    const { api, sends } = fakeApi();
    const { local, runs } = fakeLocal(false);
    const ctl = createGaugeCommandsController({ api, local });
    const r = await ctl.send('workout.stop', {});
    expect(local.probe).toHaveBeenCalledTimes(1);
    expect(r.via).toBe('server');
    expect(runs).toEqual([]);
    expect(sends).toHaveLength(1);
  });

  it('falls back to the server with the same id after a local timeout', async () => {
    const { api, sends } = fakeApi();
    const { local, runs } = fakeLocal(true, () => ({ kind: 'fallback' }));
    const ctl = createGaugeCommandsController({ api, local });
    await ctl.probeLocal();
    const r = await ctl.send('workout.pause', { sessionId: 'w-1' }, { id: 'pause-aaaaaaaaaaaaaaaa' });
    expect(runs).toEqual(['workout.pause']);
    expect(sends).toEqual([{ id: 'pause-aaaaaaaaaaaaaaaa', type: 'workout.pause', payload: { sessionId: 'w-1' } }]);
    expect(r).toMatchObject({ id: 'pause-aaaaaaaaaaaaaaaa', via: 'server', state: 'done' });
  });

  it('fails at once with server_unreachable, and a retry reuses the id', async () => {
    const { api, sends } = fakeApi({ sendProblem: 'server_unreachable' });
    const ctl = createGaugeCommandsController({ api, local: fakeLocal(false).local });
    const r = await ctl.send('reels.set', { dailyLimit: 20 });
    expect(r).toMatchObject({ state: 'failed', code: 'server_unreachable', via: 'server' });
    expect(ctl.slot('reels.set')).toEqual({ pending: false, last: r });
    await ctl.retry('reels.set');
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual({ ...sends[0] });
    expect(api.watch).not.toHaveBeenCalled();
  });

  it('a watch that breaks mid-run ends the running state with the failure shown, and a retry reuses the id (Codex UI #17)', async () => {
    const { api, sends } = fakeApi();
    api.watch = vi.fn(async (id, w) => {
      w?.onUpdate?.(cmd({ id, state: 'running' }), true);
      return { ok: false as const, problem: 'server_unreachable' as const };
    });
    const ctl = createGaugeCommandsController({ api, local: fakeLocal(false).local });
    const r = await ctl.send('hr.measure', {});
    expect(r).toMatchObject({ state: 'running', code: 'server_unreachable', lost: true });
    expect(ctl.slot('hr.measure').pending).toBe(false);
    expect(ctl.slot('hr.measure').last?.lost).toBe(true);
    await ctl.retry('hr.measure');
    expect(sends).toHaveLength(2);
    expect(sends[1]!.id).toBe(sends[0]!.id);
  });

  it('refresh reads the link and seeds each type’s last command from the recent list', async () => {
    const { api } = fakeApi();
    const ctl = createGaugeCommandsController({ api, local: fakeLocal(false).local });
    await ctl.refresh();
    expect(ctl.link()).toMatchObject({ online: true, appVersion: '2.8.0', reels: LINK.reels, paired: true });
    expect(ctl.slot('update.check').last).toMatchObject({ id: 'old-1', state: 'done', via: 'server' });
    await ctl.refresh();
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});

describe('hooks', () => {
  it('useGaugeLink and useGaugeCommand follow the controller', async () => {
    const { api } = fakeApi();
    const ctl = createGaugeCommandsController({ api, local: fakeLocal(false).local });
    const link = renderHook(() => useGaugeLink(ctl));
    await act(async () => undefined);
    expect(link.result.current).toMatchObject({ online: true, appVersion: '2.8.0', local: false });
    expect(link.result.current.transportFor('workout.start')).toBe('server');

    const hr = renderHook(() => useGaugeCommand('hr.measure', ctl));
    expect(hr.result.current.pending).toBe(false);
    await act(async () => {
      await hr.result.current.send({});
    });
    expect(hr.result.current).toMatchObject({ pending: false, last: { state: 'done', via: 'server' } });
    link.unmount();
    hr.unmount();
  });
});

/** (0.6.3 S4/A23) Gauge on this phone without the control grant: the permission is asked on the person's action. */
function fakeGrant(o: { grantOnAsk: boolean; package?: string | null }) {
  let granted = false;
  const info = () => ({ package: o.package === undefined ? 'com.pulseloop' : o.package, installed: o.package === null ? [] : ['com.pulseloop'], granted });
  const run = vi.fn(async (): Promise<LocalRun> => ({ kind: 'ack', status: 'done', result: { state: 'recording', sessionId: 'w-2' } }));
  const local: LocalTransport = {
    probe: vi.fn(async () => granted),
    run,
    info: vi.fn(async () => info()),
    requestControl: vi.fn(async () => {
      if (o.grantOnAsk && info().package) granted = true;
      return info();
    }),
  };
  return { local, run, grant: () => void (granted = true) };
}

describe('local control permission (0.6.3 S4/A23)', () => {
  it('offers the grant when Gauge is installed without it; a grant re-probes and workouts go local', async () => {
    const { api, sends } = fakeApi();
    const g = fakeGrant({ grantOnAsk: true });
    const ctl = createGaugeCommandsController({ api, local: g.local });
    await ctl.probeLocal();
    expect(ctl.link()).toMatchObject({ local: false, localControl: 'askable' });
    expect(ctl.transportFor('workout.start')).toBe('server');
    expect(g.local.requestControl).not.toHaveBeenCalled();

    await expect(ctl.requestLocalControl()).resolves.toBe(true);
    expect(g.local.requestControl).toHaveBeenCalledTimes(1);
    expect(ctl.link()).toMatchObject({ local: true, localControl: 'granted' });
    expect(ctl.transportFor('workout.start')).toBe('local');
    const v = await ctl.send('workout.start', { type: 'cycle', activityTypeId: 'air_bike' });
    expect(v).toMatchObject({ via: 'local', state: 'done' });
    expect(g.run).toHaveBeenCalledWith('workout.start', { type: 'cycle', activityTypeId: 'air_bike' });
    expect(sends).toEqual([]);
  });

  it('declined: stays on the server and stops offering; no plugin or no Gauge: unavailable', async () => {
    const { api, sends } = fakeApi();
    const g = fakeGrant({ grantOnAsk: false });
    const ctl = createGaugeCommandsController({ api, local: g.local });
    await ctl.probeLocal();
    await expect(ctl.requestLocalControl()).resolves.toBe(false);
    expect(ctl.link()).toMatchObject({ local: false, localControl: 'declined' });
    expect(ctl.transportFor('workout.start')).toBe('server');
    await ctl.send('workout.stop', {});
    expect(sends.map((s) => s.type)).toEqual(['workout.stop']);

    const none = createGaugeCommandsController({ api, local: fakeGrant({ grantOnAsk: true, package: null }).local });
    await none.probeLocal();
    expect(none.link().localControl).toBe('unavailable');
    await expect(none.requestLocalControl()).resolves.toBe(false);
    expect(none.transportFor('workout.start')).toBe('server');
  });

  it('re-probes when the app comes back to the foreground while the link is shown (a grant made in settings)', async () => {
    const { api } = fakeApi();
    const g = fakeGrant({ grantOnAsk: false });
    const ctl = createGaugeCommandsController({ api, local: g.local });
    const release = ctl.retain();
    await vi.waitFor(() => expect(ctl.link().localControl).toBe('askable'));
    g.grant();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(ctl.link()).toMatchObject({ local: true, localControl: 'granted' }));
    expect(ctl.transportFor('workout.start')).toBe('local');
    // released: a later resume checks nothing
    release();
    const probes = (g.local.probe as ReturnType<typeof vi.fn>).mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => undefined);
    expect((g.local.probe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(probes);
    visibility.mockRestore();
  });
});

describe('the recording activity on workout.start (0.6.3 S26)', () => {
  it('sends activityTypeId through the server only when Gauge reports the feature token', async () => {
    const { api, sends } = fakeApi();
    const ctl = createGaugeCommandsController({ api, local: fakeLocal(false).local });
    await ctl.refresh();
    await ctl.send('workout.start', { type: 'cycle', activityTypeId: 'air_bike' });
    expect(sends.at(-1)!.payload).toEqual({ type: 'cycle' });

    api.state = vi.fn(async (): Promise<Answer<{ state: GaugeLinkState }>> => ({ ok: true, state: { ...LINK, appVersion: '2.8.1', capabilities: ['workout.start', 'workout.start.activity_type_id'] } }));
    await ctl.refresh();
    await ctl.send('workout.start', { type: 'cycle', activityTypeId: 'air_bike' });
    expect(sends.at(-1)!.payload).toEqual({ type: 'cycle', activityTypeId: 'air_bike' });
  });
});

describe('Refresh and Measure from another device (r068 B2)', () => {
  it('a finished ring sync or measurement asks every screen again; a failed one does not', async () => {
    const { onGaugeDataChanged } = await import('@/net/gaugeIdentity');
    let changed = 0;
    const off = onGaugeDataChanged(() => void changed++);
    const { api, sends } = fakeApi();
    const ctl = createGaugeCommandsController({ api, local: fakeLocal(false).local });
    const views: string[] = [];
    const unsub = ctl.subscribe(() => {
      const last = ctl.slot('ring.sync').last;
      if (last && views.at(-1) !== last.state) views.push(last.state);
    });
    const v = await ctl.send('ring.sync', {});
    expect(sends.at(-1)).toMatchObject({ type: 'ring.sync', payload: {} });
    expect(v).toMatchObject({ state: 'done', via: 'server' });
    // the person sees each step: sent, running on the phone, done
    expect(views).toEqual(['queued', 'running', 'done']);
    expect(changed).toBe(1);
    await ctl.send('hr.measure', {});
    expect(changed).toBe(2);
    api.watch = vi.fn(async (id: string) => ({ ok: true as const, command: cmd({ id, type: 'ring.sync', state: 'expired' }), online: false }));
    expect(await ctl.send('ring.sync', {})).toMatchObject({ state: 'expired', online: false });
    expect(changed).toBe(2);
    unsub();
    off();
  });
});
