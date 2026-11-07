/**
 * 0.6.3 recording: the banner in the app shell (A31), the Record sheet's full activity picker with the catalogue id kept
 * apart from the ring sport mode (S26/A24), and the local control permission asked from the sheet (S4/A23).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/shell/AppShell';
import { NoticesRegion } from '@/app/shell/notices';
import type { GaugeCommandsApi } from '@/net/gaugeCommands';
import { makeCommandsFixture } from '@/features/ring/commands';
import { createGaugeCommandsController, type GaugeCommandsController, type LocalTransport } from '@/state/gaugeCommands';
import { detectActivities } from '@/living/sensors/activityDetect';
import { knownActivityTypeId } from '@/living/activityCandidates';
import type { GaugeApi } from '@/net/gauge';
import { activityInput } from '@/state/gaugeImport';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { commandsFixture, dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';
import { ActivityDataProvider } from '../data';
import { RecordBanner, resetLocalRecording } from '../RecordBanner';
import { RecordSheet } from '../RecordSheet';
import { coarseRecordType, isRecordableActivity, recentTypesOfRows, recordingWord, recordTypeChoices, resetRecordTypes } from '../recordType';

vi.mock('@/app/shell/HeaderSync', () => ({ HeaderSync: () => null }));
vi.mock('@/agents/AgentSurfaces', () => ({ AgentSurfaces: () => null }));

window.scrollTo = (() => undefined) as typeof window.scrollTo;
const NOW = Date.parse(`${FIXTURE_TODAY}T13:00:00`);
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  resetLocalRecording();
  resetRecordTypes();
});

describe('what a recording is started as (S26)', () => {
  it('maps a catalogue activity to the ring sport mode and names it', () => {
    expect(coarseRecordType('walk_brisk')).toBe('walk');
    expect(coarseRecordType('treadmill_run')).toBe('run');
    expect(coarseRecordType('air_bike')).toBe('cycle');
    expect(coarseRecordType('stationary_bike')).toBe('cycle');
    expect(coarseRecordType('hatha_yoga')).toBe('other');
    expect(coarseRecordType('not_a_thing')).toBe('other');
    expect(recordingWord('cycle', 'air_bike')).toBe('air bike');
    expect(recordingWord('walk')).toBe('walk');
    expect(recordingWord('run', 'Bad Id')).toBe('run');
    expect(isRecordableActivity('treadmill_run')).toBe(true);
    expect(isRecordableActivity('treadmill run')).toBe(false);
    expect(recordTypeChoices('air bike').map((t) => t.id)).toContain('air_bike');
    expect(recordTypeChoices('', ['treadmill_run'])[0]!.id).toBe('treadmill_run');
  });

  // (0.6.3 INT) Today's and Train's Record sheets offer the person's own recent activity types first
  it('the recent types of decided activities: newest first, each once, only recordable ones', () => {
    const rows = [
      { exerciseId: 'walk_brisk', startAt: '2026-10-26T07:00:00Z' },
      { exerciseId: 'air_bike', startAt: '2026-10-27T18:00:00Z' },
      { exerciseId: 'walk_brisk', startAt: '2026-10-25T07:00:00Z' },
      { exerciseId: 'not a type', startAt: '2026-10-28T07:00:00Z' },
    ];
    expect(recentTypesOfRows(rows)).toEqual(['air_bike', 'walk_brisk']);
    expect(recentTypesOfRows(rows, 1)).toEqual(['air_bike']);
  });

  it('a Gauge session started as a known catalogue activity suggests it; an unknown id keeps the coarse guess', () => {
    expect(knownActivityTypeId('air_bike')).toBe('air_bike');
    expect(knownActivityTypeId('made_up_thing')).toBeNull();
    expect(knownActivityTypeId(7)).toBeNull();
    const at = Date.parse(`${FIXTURE_TODAY}T07:00:00Z`);
    const r = detectActivities({
      gaugeSessions: [
        { id: 'a', revision: '1', start: at, end: at + 30 * 60_000, type: 'cycle', activityTypeId: 'air_bike' },
        { id: 'b', revision: '1', start: at + 3 * 3600_000, end: at + 4 * 3600_000, type: 'walk' },
      ],
      mintKey: (() => {
        let n = 0;
        return () => `k${n++}`;
      })(),
    });
    const byRef = new Map(r.drafts.map((d) => [d.refs[0], d.suggested.exerciseId]));
    expect(byRef.get('gauge:a')).toBe('air_bike');
    expect(byRef.get('gauge:b')).not.toBe('air_bike');
  });
});

describe('the import keeps the recording activity (S26)', () => {
  it('reads activity_type_id (or activityTypeId) off a Gauge session when it names a known activity', async () => {
    const s = (id: string, extra: Record<string, unknown>) => ({ id, date: FIXTURE_TODAY, start: `${FIXTURE_TODAY}T07:00:00Z`, end: `${FIXTURE_TODAY}T07:30:00Z`, type: 'cycle', updatedAt: 'u', ...extra });
    const api = {
      workouts: async () => ({ sessions: [s('a', { activity_type_id: 'air_bike' }), s('b', { activityTypeId: 'treadmill_run' }), s('c', { activity_type_id: 'warp_drive' }), s('d', {})] }),
    } as unknown as GaugeApi;
    const input = (await activityInput(api, FIXTURE_TODAY, FIXTURE_TODAY, FIXTURE_TODAY))!;
    expect(input.gaugeSessions.map((g) => g.activityTypeId ?? null)).toEqual(['air_bike', 'treadmill_run', null, null]);
  });
});

/** A paired Gauge that runs every command, with an optional local transport. */
function controller(local?: LocalTransport): { ctl: GaugeCommandsController; api: GaugeCommandsApi } {
  const api = makeCommandsFixture({ delayMs: 5 });
  const ctl = createGaugeCommandsController({ api, local: local ?? { probe: async () => false, run: async () => ({ kind: 'fallback' }) } });
  return { ctl, api };
}

function renderSheet(ctl: GaugeCommandsController, recent?: string[]) {
  const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
  const data = fixtureActivityData(f, { quiet: false, commands: ctl });
  const onClose = vi.fn();
  render(
    <ActivityDataProvider value={data}>
      <NoticesRegion />
      <RecordBanner />
      <RecordSheet open onClose={onClose} {...(recent ? { recent } : {})} />
    </ActivityDataProvider>,
  );
  return { onClose };
}

describe('the Record sheet', () => {
  it('pins the recent types it is given first and starts with the newest picked (ActivityFace / the hub pass them)', async () => {
    const { ctl } = controller();
    renderSheet(ctl, ['treadmill_run', 'hatha_yoga']);
    const dialog = await screen.findByRole('dialog');
    const chips = within(within(dialog).getByRole('group', { name: 'Activity' })).getAllByRole('button');
    expect(chips[0]).toHaveTextContent(/^Treadmill/);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    expect(chips[1]).toHaveTextContent(/yoga/i);
  });

  it('searches the whole catalogue, starts as the coarse ring mode with the catalogue id, and names it in the banner', async () => {
    const { ctl } = controller();
    const send = vi.spyOn(ctl, 'send');
    const { onClose } = renderSheet(ctl);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'air bike' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Air bike/ }));
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Start' })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith('workout.start', { type: 'cycle', useGps: false, activityTypeId: 'air_bike' }, undefined);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Notices' })).toHaveTextContent(/Recording air bike · /));
  });

  it('offers to allow local control when Gauge is on this phone without the grant, and goes local once allowed (S4)', async () => {
    let granted = false;
    const local: LocalTransport = {
      probe: vi.fn(async () => granted),
      run: vi.fn(async () => ({ kind: 'ack' as const, status: 'done' as const, result: { state: 'recording', sessionId: 'w-1' } })),
      info: vi.fn(async () => ({ package: 'com.pulseloop', installed: ['com.pulseloop'], granted })),
      requestControl: vi.fn(async () => {
        granted = true;
        return { package: 'com.pulseloop', installed: ['com.pulseloop'], granted };
      }),
    };
    const { ctl } = controller(local);
    renderSheet(ctl);
    const dialog = await screen.findByRole('dialog');
    const allow = await within(dialog).findByRole('button', { name: 'Allow Vitals to control the ring app on this phone' });
    expect(local.requestControl).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('Starts on your phone, through your server.');
    await act(async () => fireEvent.click(allow));
    await waitFor(() => expect(dialog).toHaveTextContent('Starts on this phone.'));
    expect(local.requestControl).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByRole('button', { name: 'Allow Vitals to control the ring app on this phone' })).toBeNull();
  });
});

describe('the recording banner in the app shell (A31)', () => {
  it('keeps Pause and Stop on a screen other than Today', async () => {
    const f = dayFixture(FIXTURE_TODAY, NOW, 'recording');
    const data = fixtureActivityData(f, { quiet: false, commands: commandsFixture(f) });
    const router = createMemoryRouter([{ path: '/', element: <AppShell />, children: [{ path: 'ring', element: <h1>Ring</h1> }] }], { initialEntries: ['/ring'] });
    render(
      <ActivityDataProvider value={data}>
        <RouterProvider router={router} />
      </ActivityDataProvider>,
    );
    const banner = await screen.findByRole('region', { name: 'Notices' }, { timeout: 4000 });
    await waitFor(() => expect(banner).toHaveTextContent(/Recording walk · /));
    expect(within(banner).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Notices' })).toHaveLength(1);
  });
});
