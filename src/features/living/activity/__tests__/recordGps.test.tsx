/**
 * r063 FX3: Gauge's deliberate no-GPS fallback reaches the person (sR12/aR12) through both transports — "Recording
 * without GPS", why, and the action that opens Gauge's location prompt (Gauge 2.8.1 `GRANT_LOCATION`) or the phone's
 * location switch — and the shell banner's elapsed time is words in quiet mode (sR10/aR10).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticesRegion } from '@/app/shell/notices';
import { Toaster } from '@/components';
import { makeCommandsFixture } from '@/features/ring/commands';
import { createGaugeCommandsController, type LocalTransport } from '@/state/gaugeCommands';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { expectWordsOnly } from '../../__tests__/wordsOnly';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { dayFixture, fixtureActivityData } from '../../today/__screens__/fixtures';
import { ActivityDataProvider } from '../data';
import { RecordBanner, gpsOutcome, recordingToShow, resetLocalRecording } from '../RecordBanner';
import { RecordSheet } from '../RecordSheet';
import { resetRecordTypes } from '../recordType';
import type * as GaugeLocal from '@/platform/gaugeLocal';

const platform = vi.hoisted(() => ({ here: true, opened: true, calls: [] as Array<string | undefined> }));
vi.mock('@/platform/gaugeLocal', async (orig) => ({
  ...(await orig<typeof GaugeLocal>()),
  canOpenGaugeGpsFix: () => platform.here,
  openGaugeGpsFix: async (warning?: string) => {
    platform.calls.push(warning);
    return platform.opened;
  },
}));

window.scrollTo = (() => undefined) as typeof window.scrollTo;
const NOW = Date.parse(`${FIXTURE_TODAY}T13:00:00`);
const STARTED = new Date(NOW - 31 * 60_000).toISOString();

beforeEach(() => {
  platform.here = true;
  platform.opened = true;
  platform.calls = [];
});
afterEach(() => {
  resetLocalRecording();
  resetRecordTypes();
  withSystemWrite(() => useSettingsStore.setState({ quietMode: false }));
});

const offAck = (warning: string) => ({ state: 'recording', sessionId: 'w-9', type: 'run', startedAt: STARTED, gps: 'off', warning });
const noLocal: LocalTransport = { probe: async () => false, run: async () => ({ kind: 'fallback' }) };

function renderSheet(local: LocalTransport, startResult: Record<string, unknown> | null) {
  const api = makeCommandsFixture({ delayMs: 5, ...(startResult ? { answer: { 'workout.start': { state: 'done', code: null, result: startResult } } } : {}) });
  const ctl = createGaugeCommandsController({ api, local });
  const f = dayFixture(FIXTURE_TODAY, NOW, 'pending');
  const onClose = vi.fn();
  render(
    <ActivityDataProvider value={fixtureActivityData(f, { quiet: false, commands: ctl })}>
      <NoticesRegion />
      <Toaster />
      <RecordBanner />
      <RecordSheet open onClose={onClose} />
    </ActivityDataProvider>,
  );
  return { onClose };
}

async function startWithGps(onClose: () => void) {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('switch', { name: 'Use GPS' }));
  await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Start' })));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  return screen.findByRole('region', { name: 'Notices' });
}

describe('the GPS outcome of a start', () => {
  it('reads Gauge’s gps and warning off an ack; a start without GPS carries neither', () => {
    expect(gpsOutcome({ gps: 'off', warning: 'gps_permission_missing' })).toEqual({ gps: 'off', gpsWarning: 'gps_permission_missing' });
    expect(gpsOutcome({ gps: 'on' })).toEqual({ gps: 'on' });
    expect(gpsOutcome({ state: 'recording' })).toEqual({});
    expect(gpsOutcome(undefined)).toEqual({});
    // Gauge's own state report has no GPS outcome: this device's ack keeps it for the same recording
    const mine = { sessionId: 'w-9', status: 'recording' as const, type: 'run', startedAt: STARTED, gps: 'off' as const, gpsWarning: 'gps_location_off' };
    expect(recordingToShow({ sessionId: 'w-9', status: 'recording', type: 'run', startedAt: STARTED }, null, mine).rec).toMatchObject({ gps: 'off', gpsWarning: 'gps_location_off' });
    expect(recordingToShow({ sessionId: 'w-10', status: 'recording', type: 'run', startedAt: STARTED }, null, mine).rec?.gps).toBeUndefined();
  });
});

describe('Recording without GPS (sR12/aR12)', () => {
  it('server path: the banner says so and why, with the action that opens Gauge’s location prompt', async () => {
    const { onClose } = renderSheet(noLocal, offAck('gps_permission_missing'));
    const banner = await startWithGps(onClose);
    await waitFor(() => expect(banner).toHaveTextContent('Recording without GPS'));
    expect(banner).toHaveTextContent('The phone app isn’t allowed to use location');
    // the toast says it too (never the ordinary "Recording run")
    expect(await screen.findByText(/^Recording without GPS\. /)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', { name: 'Allow location in the ring app' }));
    await waitFor(() => expect(platform.calls).toEqual(['gps_permission_missing']));
  });

  it('local path: Gauge’s result extras reach the banner; location off offers the phone’s switch', async () => {
    const local: LocalTransport = {
      probe: vi.fn(async () => true),
      run: vi.fn(async () => ({ kind: 'ack' as const, status: 'done' as const, result: offAck('gps_location_off') })),
    };
    const { onClose } = renderSheet(local, null);
    const banner = await startWithGps(onClose);
    await waitFor(() => expect(banner).toHaveTextContent('Recording without GPS'));
    expect(local.run).toHaveBeenCalledWith('workout.start', expect.objectContaining({ useGps: true }));
    expect(banner).toHaveTextContent('Location is off on the phone');
    fireEvent.click(within(banner).getByRole('button', { name: 'Turn on location' }));
    await waitFor(() => expect(platform.calls).toEqual(['gps_location_off']));
  });

  it('away from the phone (no Android app): what to do on the phone, no key', async () => {
    platform.here = false;
    const { onClose } = renderSheet(noLocal, offAck('gps_precise_permission_missing'));
    const banner = await startWithGps(onClose);
    await waitFor(() => expect(banner).toHaveTextContent('The phone app has only approximate location'));
    expect(banner).toHaveTextContent('open the ring app and allow precise location');
    expect(within(banner).queryByRole('button', { name: /location/ })).toBeNull();
  });

  it('a route recording says nothing more', async () => {
    const { onClose } = renderSheet(noLocal, { state: 'recording', sessionId: 'w-9', type: 'run', startedAt: STARTED, gps: 'on' });
    const banner = await startWithGps(onClose);
    await waitFor(() => expect(banner).toHaveTextContent(/Recording /));
    expect(banner).not.toHaveTextContent('without GPS');
  });
});

describe('quiet mode: the banner’s elapsed time (sR10/aR10)', () => {
  it('says the time so far in words, no running clock (aria too)', async () => {
    withSystemWrite(() => useSettingsStore.setState({ quietMode: true }));
    const { onClose } = renderSheet(noLocal, { state: 'recording', sessionId: 'w-9', type: 'run', startedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
    const dialog = await screen.findByRole('dialog');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Start' })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const banner = await screen.findByRole('region', { name: 'Notices' });
    await waitFor(() => expect(banner).toHaveTextContent(/Recording \S+ · about half an hour/));
    expectWordsOnly(banner, 'recording banner');
  });
});
