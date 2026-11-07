/**
 * The Gauge import schedule (S1): the 30-day backfill on the first run, a short re-read after it, nothing while offline or
 * unpaired or switched off, and `log.fromGauge` writing each reading once (re-runs and a second device add nothing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@/living/dates';
import type { LogEntry } from '@/living';
import type { GaugeApi, GaugeStatus } from '@/net/gauge';
import { currentDay, dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '../runtime';
import { GAUGE_IMPORT_KEY, GAUGE_RECONCILE_INTERVAL_MS, importWindow, readGaugeImportState, reconcileWindow, revisedWorkoutDates, runGaugeImport, type GaugeImportDeps } from '../gaugeImport';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

function fakeApi(o: { days?: Array<{ date: string; steps: number | null; bucketSteps?: number | null }>; down?: boolean; problem?: GaugeStatus['problem'] }) {
  const asked: Array<[string, string, string]> = [];
  const api = {
    activity: async (from: string, to: string) => {
      asked.push(['activity', from, to]);
      return o.down ? null : { from, to, units: {}, days: (o.days ?? []).map((d) => ({ activeMinutes: null, bucketSteps: null, distanceM: null, caloriesKcal: null, bucketDistanceM: null, lastUpdate: '', ...d })) };
    },
    sleep: async (from: string, to: string) => {
      asked.push(['sleep', from, to]);
      return o.down ? null : { from, to, units: {}, sessions: [] };
    },
    status: () => ({ lastOkAt: null, problem: o.problem ?? (o.down ? 'offline' : null) }),
  } as unknown as GaugeApi;
  return { api, asked };
}

const deps = (over: Partial<GaugeImportDeps>): Partial<GaugeImportDeps> => ({
  enabled: () => true,
  today: () => '2026-10-20',
  now: () => Date.parse('2026-10-20T06:34:00Z'),
  importer: async () => ({ created: [], skipped: [] }),
  storage: memoryStorage(),
  ...over,
});

describe('import window', () => {
  it('fills 30 days first, then re-reads two days before the last import', () => {
    expect(importWindow({ lastImportAt: null, lastDate: null, backfilled: false }, '2026-10-20')).toEqual({ from: '2026-09-21', to: '2026-10-20' });
    expect(importWindow({ lastImportAt: 'x', lastDate: '2026-10-20', backfilled: true }, '2026-10-20')).toEqual({ from: '2026-10-18', to: '2026-10-20' });
    // a device away for months reads at most the last 30 days
    expect(importWindow({ lastImportAt: 'x', lastDate: '2026-06-01', backfilled: true }, '2026-10-20')).toEqual({ from: '2026-09-21', to: '2026-10-20' });
  });
});

describe('runGaugeImport', () => {
  it('backfills on the first run, records the import, and re-reads a short window next time', async () => {
    const storage = memoryStorage();
    const { api, asked } = fakeApi({ days: [{ date: '2026-10-19', steps: 9000 }, { date: '2026-10-18', steps: null, bucketSteps: 4000 }, { date: '2026-10-17', steps: 0 }] });
    const seen: unknown[] = [];
    const importer = async (input: unknown) => {
      seen.push(input);
      return { created: [1, 2], skipped: [] };
    };
    expect(await runGaugeImport(deps({ api, storage, importer }))).toEqual({ ran: true, from: '2026-09-21', to: '2026-10-20', created: 2, skipped: 0 });
    // the day total, else the bucket sum; a zero count is unknown, never imported
    // (0.6.3 FX1) with what the server answered in full: the sleep read's wake dates (no fused steps route here)
    expect(seen[0]).toEqual({ steps: [{ date: '2026-10-19', steps: 9000 }, { date: '2026-10-18', steps: 4000 }], sleep: [], answered: { sleep: { from: '2026-09-21', to: '2026-10-20' } } });
    expect(readGaugeImportState(storage)).toEqual({ lastImportAt: '2026-10-20T06:34:00.000Z', lastDate: '2026-10-20', backfilled: true, feeds: { ring: '2026-10-20', sleep: '2026-10-20' } });
    await runGaugeImport(deps({ api, storage, importer }));
    // (0.6.3 FX1) the sleep read takes two days before and one after the window (a night of every wake date is in it)
    expect(asked).toContainEqual(['sleep', '2026-10-16', '2026-10-21']);
  });

  it.each([true, false])('a pulse during another import requests a fresh read only while current=%s', async (current) => {
    const storage = memoryStorage();
    const { api } = fakeApi({ days: [] });
    const original = api.activity;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const read = vi.fn(async (from: string, to: string) => {
      const answer = await original(from, to);
      if (read.mock.calls.length === 1) await held;
      return answer;
    });
    api.activity = read;
    const d = deps({ api, storage });
    const first = runGaugeImport(d);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const pulse = runGaugeImport(d, () => current);
    release();
    await Promise.all([first, pulse]);
    expect(read.mock.calls.length).toBe(current ? 3 : 1); // fresh recent read plus its due old correction
  });

  it('does nothing offline, unpaired or switched off (and keeps the backfill for later)', async () => {
    const storage = memoryStorage();
    expect(await runGaugeImport(deps({ api: fakeApi({ down: true }).api, storage }))).toEqual({ ran: false, reason: 'offline' });
    expect(await runGaugeImport(deps({ api: fakeApi({ down: true, problem: 'not_paired' }).api, storage }))).toEqual({ ran: false, reason: 'not_paired' });
    const off = fakeApi({});
    expect(await runGaugeImport(deps({ api: off.api, storage, enabled: () => false }))).toEqual({ ran: false, reason: 'off' });
    expect(off.asked).toEqual([]);
    expect(storage.map.has(GAUGE_IMPORT_KEY)).toBe(false);
  });

  it('starts a fresh backfill and change cursor for another paired person', async () => {
    const storage = memoryStorage();
    let paired = 'server-a|person-a';
    const asked: Array<{ who: string; from: string; cursor: string | null }> = [];
    const base = fakeApi({}).api;
    const api = {
      ...base,
      activity: async (from: string, to: string) => {
        asked.push({ who: paired, from, cursor: null });
        return base.activity(from, to);
      },
      changes: async (cursor: string | null) => {
        asked.push({ who: paired, from: 'changes', cursor });
        return { cursor: `cursor-${paired}`, resync: false, changes: [], truncated: false };
      },
    } as unknown as GaugeApi;
    await runGaugeImport(deps({ api, storage, identity: () => paired }));
    expect(readGaugeImportState(storage, paired)).toMatchObject({ identity: paired, backfilled: true, changesCursor: 'cursor-server-a|person-a' });
    paired = 'server-b|person-b';
    expect(readGaugeImportState(storage, paired).backfilled).toBe(false);
    await runGaugeImport(deps({ api, storage, identity: () => paired }));
    expect(asked.filter((x) => x.who === paired)).toEqual([
      { who: paired, from: 'changes', cursor: null },
      { who: paired, from: '2026-09-21', cursor: null },
    ]);
    expect(readGaugeImportState(storage, paired)).toMatchObject({ identity: paired, backfilled: true, changesCursor: 'cursor-server-b|person-b' });
  });

  it('drops an old unscoped cursor and never imports a stale in-flight answer after pairing changes', async () => {
    const storage = memoryStorage();
    storage.setItem(GAUGE_IMPORT_KEY, JSON.stringify({ lastImportAt: '2026-10-20T05:00:00Z', lastDate: '2026-10-20', backfilled: true, changesCursor: 'old-cursor' }));
    let paired = 'server-a|person-a';
    expect(readGaugeImportState(storage, paired)).toEqual({ lastImportAt: null, lastDate: null, backfilled: false });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    const writes: string[] = [];
    const a = fakeApi({}).api;
    const activity = a.activity;
    (a as unknown as { activity: GaugeApi['activity'] }).activity = async (from, to) => {
      entered();
      await held;
      return activity(from, to);
    };
    const first = runGaugeImport(deps({ api: a, storage, identity: () => paired, importer: async () => { writes.push('a'); return { created: [], skipped: [] }; } }));
    await reading;
    paired = 'server-b|person-b';
    const second = runGaugeImport(deps({ api: fakeApi({}).api, storage, identity: () => paired, importer: async () => { writes.push('b'); return { created: [], skipped: [] }; } }));
    release();
    expect(await first).toEqual({ ran: false, reason: 'identity_changed' });
    expect(await second).toMatchObject({ ran: true, from: '2026-09-21' });
    expect(writes).toEqual(['b']);
    expect(readGaugeImportState(storage, paired)).toMatchObject({ identity: paired, backfilled: true });
  });
});

describe('r063 S14/A21: the correction window is really revisited', () => {
  it('the probe: after the backfill only two days were ever read again; now a failed feed is re-read from where it stopped', () => {
    const st = { lastImportAt: 'x', lastDate: '2026-10-20', backfilled: true, feeds: { ring: '2026-10-20', sleep: '2026-10-15', steps: '2026-10-20' } };
    expect(importWindow(st, '2026-10-20', ['ring', 'sleep', 'steps'])).toEqual({ from: '2026-10-13', to: '2026-10-20' });
    // a feed that never succeeded on this device reads the whole window
    expect(importWindow({ ...st, feeds: { ring: '2026-10-20', sleep: '2026-10-20' } }, '2026-10-20', ['ring', 'sleep', 'steps'])).toEqual({ from: '2026-09-21', to: '2026-10-20' });
  });
  it('a rotating reconcile walks the 30 days a week at a time, at most once an hour', () => {
    const now = Date.parse('2026-10-20T06:34:00Z');
    const st = { lastImportAt: 'x', lastDate: '2026-10-20', backfilled: true };
    const chunks: string[] = [];
    let s1: Parameters<typeof reconcileWindow>[0] = st;
    for (let k = 0; k < 6; k++) {
      const c = reconcileWindow(s1, '2026-10-20', '2026-10-18', now + k * GAUGE_RECONCILE_INTERVAL_MS)!;
      chunks.push(`${c.from}..${c.to}`);
      s1 = { ...s1, reconcile: { next: c.next, at: new Date(now + k * GAUGE_RECONCILE_INTERVAL_MS).toISOString() } };
    }
    expect(chunks).toEqual(['2026-09-21..2026-09-27', '2026-09-28..2026-10-04', '2026-10-05..2026-10-11', '2026-10-12..2026-10-17', '2026-09-21..2026-09-27', '2026-09-28..2026-10-04']);
    // not again within the hour; never before the window is filled
    expect(reconcileWindow({ ...st, reconcile: { next: '2026-09-28', at: new Date(now).toISOString() } }, '2026-10-20', '2026-10-18', now + 60_000)).toBeNull();
    expect(reconcileWindow({ ...st, backfilled: false }, '2026-10-20', '2026-10-18', now)).toBeNull();
  });
  it('a run reads the due chunk, advances it only on success, and tracks each feed', async () => {
    const storage = memoryStorage();
    storage.setItem(GAUGE_IMPORT_KEY, JSON.stringify({ lastImportAt: '2026-10-20T04:00:00.000Z', lastDate: '2026-10-20', backfilled: true, feeds: { ring: '2026-10-20', sleep: '2026-10-20' } }));
    const { api, asked } = fakeApi({ days: [] });
    const r = await runGaugeImport(deps({ api, storage }));
    expect(r).toMatchObject({ ran: true, from: '2026-10-18', to: '2026-10-20', reconciled: { from: '2026-09-21', to: '2026-09-27', ok: true } });
    expect(asked.filter((a) => a[0] === 'activity').map((a) => a.slice(1))).toEqual([['2026-10-18', '2026-10-20'], ['2026-09-21', '2026-09-27']]);
    expect(readGaugeImportState(storage).reconcile).toEqual({ next: '2026-09-28', at: '2026-10-20T06:34:00.000Z' });
    // sleep fails now: its day stays, the ring's moves; the chunk stays to be read again (an hour later)
    const half = fakeApi({ days: [] });
    (half.api as unknown as { sleep: () => Promise<null> }).sleep = async () => null;
    await runGaugeImport(deps({ api: half.api, storage, now: () => Date.parse('2026-10-21T08:00:00Z'), today: () => '2026-10-21' }));
    const st = readGaugeImportState(storage);
    expect(st.feeds).toEqual({ ring: '2026-10-21', sleep: '2026-10-20' });
    expect(st.reconcile).toEqual({ next: '2026-09-28', at: '2026-10-21T08:00:00.000Z' });
    expect(importWindow(st, '2026-10-21', ['ring', 'sleep'])).toEqual({ from: '2026-10-18', to: '2026-10-21' });
  });
  it('imports recent detections before a delayed historical correction and still completes that correction', async () => {
    const storage = memoryStorage();
    storage.setItem(GAUGE_IMPORT_KEY, JSON.stringify({ lastImportAt: '2026-10-20T04:00:00.000Z', lastDate: '2026-10-20', backfilled: true, feeds: { ring: '2026-10-20', sleep: '2026-10-20', activities: '2026-10-20' } }));
    const { api } = fakeApi({ days: [] });
    const original = api.activity;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    api.activity = async (from, to) => {
      if (from === '2026-09-21') await held;
      return original(from, to);
    };
    (api as GaugeImportDeps['api']).detections = async ({ from }) => ({ detector: 'detect/2', withdrawn: [], episodes: from === '2026-10-18' ? [{ id: 'fixture-cycle', revision: '1', detector: 'detect/2', start: '2026-10-20T03:00:00Z', end: '2026-10-20T03:20:00Z', state: 'final', label: 'cycling', alternatives: [], reasons: [], existence: 0.9, typeScore: 0.9, level: 'strong' }] : [] }) as never;
    api.workouts = async () => ({ sessions: [] }) as never;
    const activityImporter = vi.fn(async () => ({ created: [], updated: [] }));
    const run = runGaugeImport(deps({ api, storage, activityImporter }));
    try {
      await vi.waitFor(() => expect(activityImporter).toHaveBeenCalledWith(expect.objectContaining({ detections: [expect.objectContaining({ id: 'fixture-cycle' })] })));
      // Completion watermarks cannot advance past a historical request still in flight.
      expect(readGaugeImportState(storage).lastImportAt).toBe('2026-10-20T04:00:00.000Z');
    } finally { release(); await run; }
    expect(readGaugeImportState(storage).reconcile).toEqual({ next: '2026-09-28', at: '2026-10-20T06:34:00.000Z' });
  });
  it('workouts new or revised since the last import get their days\' timelines, whatever their age', () => {
    const w = (start: string, updatedAt: string) => ({ id: start, start, end: start.replace('T07', 'T08'), type: 'run', updatedAt });
    const workouts = { sessions: [w('2026-10-02T07:00:00Z', '2026-10-20T05:00:00Z'), w('2026-10-05T07:00:00Z', '2026-10-05T09:00:00Z')] } as never;
    expect(revisedWorkoutDates(workouts, null, Date.parse('2026-10-20T04:00:00Z'), 'UTC', '2026-09-21', '2026-10-20')).toEqual(['2026-10-02']);
  });
});

describe('log.fromGauge', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
  const entries = () => getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => d as unknown as LogEntry & { _id: string });

  it('writes each reading once: a re-run (or a second device with the same reading) adds nothing', async () => {
    const d = addDays(currentDay(), -2);
    const input = { steps: [{ date: d, steps: 8214 }], sleep: [] };
    const first = await dispatch('log.fromGauge', input, SYS);
    expect(first.ok).toBe(true);
    await settleCommits();
    expect(entries()).toHaveLength(1);
    expect(entries()[0]!.source).toMatchObject({ by: 'device', app: 'gauge', deviceKey: `gauge:steps:${d}` });
    const again = await dispatch('log.fromGauge', input, SYS);
    await settleCommits();
    expect(again.ok && 'output' in again ? (again.output as { created: unknown[] }).created : null).toEqual([]);
    expect(entries()).toHaveLength(1);
  });

  it("never writes over the person's own steps", async () => {
    const d = addDays(currentDay(), -1);
    await dispatch('log.steps', { date: d, steps: 6000 });
    await settleCommits();
    const r = await dispatch('log.fromGauge', { steps: [{ date: d, steps: 9000 }], sleep: [] }, SYS);
    await settleCommits();
    expect(r.ok && 'output' in r ? (r.output as { skipped: Array<{ reason: string }> }).skipped.map((s) => s.reason) : null).toEqual(['userEntry']);
    expect(entries().filter((e) => e.kind === 'steps')).toHaveLength(1);
  });
});
