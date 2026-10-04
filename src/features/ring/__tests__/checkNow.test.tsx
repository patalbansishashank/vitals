import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedDay, SpotRecord } from '@/biometrics/core/types';
import { fixedClock, LivingClockContext } from '@/features/living/clock';
import { SignalsSourceProvider, type SignalBaseline, type SignalsSource } from '@/features/signals/data';
import { RingServiceProvider, type RingStatus } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, type FakeRingService } from '../fixtures';
import { CheckNow } from '../CheckNow';

const TODAY = '2026-10-04';
const NOW = new Date(`${TODAY}T13:41:00`).getTime();
const clock = fixedClock(`${TODAY}T13:41`);
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\u2009\u00a0]/g, ' ');
const STEP = 20_000; // the fake ring answers a check after 20 s

const spot: SpotRecord = {
  kind: 'spot', record_id: 'sp1', version: 1, metric: 'hr_bpm', value: 72,
  time: { at: '2026-10-04T09:14:00.000Z', tz_offset_s: 0, local_date: TODAY },
  provenance: { channel: 'ble:jstyle2301', recording_method: 'manual', modality: 'sensed', ingested_at: '2026-10-04T09:14:00Z' },
  quality: { validation: 'vendor_proprietary', confidence: null, flags: [] },
};
const DAY: ResolvedDay = { localDate: TODAY, sleeps: [], workouts: [], spots: [spot], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [] };
const BASELINES: SignalBaseline[] = [{ metric: 'hrv_rmssd_ms', unit: 'ms', mean: 43, lo: 40, hi: 46, nights: 30, forming: false }];

function source(): SignalsSource {
  return {
    subscribe: () => () => {},
    revision: () => 0,
    days: (from, to) => (TODAY >= from && TODAY <= to ? [DAY] : []),
    series: async () => [],
    baselines: async () => BASELINES,
    firstDate: () => null,
    datesWithData: () => [],
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C' }),
    sourceInfo: () => ({ labels: [], lastReadAt: null }),
  };
}

let fake: FakeRingService;
function setup(patch: Partial<RingStatus> = {}, withoutStop = false) {
  fake = createFakeRingService('connected', { now: NOW, stepMs: STEP });
  // the real service has no stopCheck: a check cannot be aborted there
  if (withoutStop) delete (fake as Partial<FakeRingService>).stopCheck;
  const ring = { ...fake.rings()[0]!, ...patch };
  return render(
    <MemoryRouter>
      <LivingClockContext.Provider value={clock}>
        <RingServiceProvider service={fake} platform={scenarioPlatform('connected')} sharing={createFakeSharing()}>
          <SignalsSourceProvider source={source()}>
            <CheckNow ring={ring} />
          </SignalsSourceProvider>
        </RingServiceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>,
  );
}

const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});
const status = () => norm(document.querySelector('.rs-check__status')?.textContent);
const live = () => norm(document.querySelector('.rs-check__status [aria-live="polite"]')?.textContent);
const readout = () => norm(document.querySelector('.rs-readout')?.textContent);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Check now', () => {
  it('ready: one key per supported measurement, Start, and the last check of the chosen one today', async () => {
    setup();
    await flush();
    expect(screen.getByRole('heading', { name: 'Check now' })).toBeTruthy();
    expect(screen.getByText('Hold still. Your ring measures for about 30 seconds.')).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['heart rate', 'blood oxygen', 'heart-rate variability', 'skin temperature']);
    expect(screen.getByRole('radio', { name: 'heart rate' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(status()).toBe('last check 72 bpm · 09:14');
    // another measurement with no check today: no line
    fireEvent.click(screen.getByRole('radio', { name: 'blood oxygen' }));
    expect(status()).toBe('');
  });

  it('shows only the keys the driver supports (default heart rate only)', async () => {
    setup({ caps: undefined });
    await flush();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['heart rate']);
  });

  it('measuring → result: Stop, the countdown over the driver’s ceiling, the live readout, then the saved value', async () => {
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(fake.calls).toContain(`checkNow:${fake.rings()[0]!.ringKey}:hr`);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(status()).toContain('measuring · 32 s left');
    expect(readout()).toBe('— bpm');
    expect(live()).toBe('Measuring heart rate.');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    // one check at a time: the measurement cannot change while it runs
    for (const r of screen.getAllByRole('radio')) expect(r.getAttribute('aria-disabled')).toBe('true');
    await advance(14_000);
    expect(status()).toContain('measuring · 18 s left');
    await advance(STEP - 14_000);
    expect(readout()).toBe('71 bpm');
    expect(status()).toMatch(/saved · \d\d:\d\d/);
    expect(status()).not.toContain('change from your normal');
    expect(live()).toBe('Heart rate 71 bpm. Saved.');
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('a tier C result adds the change from the person’s normal', async () => {
    setup();
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: 'heart-rate variability' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await advance(STEP);
    expect(readout()).toBe('46 ms');
    expect(status()).toContain('change from your normal: +3 ms');
  });

  it('no steady reading: the warning and Try again, which starts the same check again', async () => {
    setup();
    await flush();
    fake.failNextCheck('no_reading');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await advance(STEP);
    expect(status()).toContain('No steady reading. Keep the ring snug and your hand still, then try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(status()).toContain('measuring');
    expect(fake.calls.filter((c) => c.startsWith('checkNow:'))).toHaveLength(2);
  });

  it('ring not on a finger: its own line', async () => {
    setup();
    await flush();
    fake.failNextCheck('off_finger');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await advance(STEP);
    expect(status()).toContain('Your ring isn’t touching your skin. Put it on snugly, then try again.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('any other failure reads as no steady reading', async () => {
    setup();
    await flush();
    const err = Object.assign(new Error('gone'), { code: 'disconnected' });
    fake.checkNow = () => Promise.reject(err);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await flush();
    expect(status()).toContain('No steady reading.');
  });

  it('stop: nothing saved, the late result is ignored, back to ready after 4 s', async () => {
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await advance(5_000);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(fake.calls).toContain(`stopCheck:${fake.rings()[0]!.ringKey}`);
    expect(status()).toContain('Stopped. Nothing was saved.');
    expect(live()).toBe('Stopped. Nothing was saved.');
    await advance(3_900);
    expect(status()).toContain('Stopped. Nothing was saved.');
    await advance(200);
    expect(status()).toBe('last check 72 bpm · 09:14');
    // the fake answers at 20 s: the page ignores it
    await advance(STEP);
    expect(document.querySelector('.rs-readout')).toBeNull();
    expect(status()).toBe('last check 72 bpm · 09:14');
  });

  it('never shows a forbidden word', async () => {
    setup();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await advance(STEP);
    expect(document.body.textContent ?? '').not.toMatch(/password|passcode|credential|\bPIN\b|MQTT|\blease\b|GATT|handshake|\bbond\b/i);
  });
});

describe('Check now on the real service (no stopCheck, no checkProgress)', () => {
  it('has no Stop key: a check that cannot be aborted is never reported as "nothing saved"', async () => {
    setup({}, true);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(status()).toContain('measuring · 32 s left');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    await advance(STEP);
    expect(readout()).toBe('71 bpm');
    expect(live()).toBe('Heart rate 71 bpm. Saved.');
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('heart rate fills in from the ring’s live reading once one newer than the start arrives', async () => {
    const view = setup({ liveHr: { bpm: 64, at: new Date(NOW - 20_000).toISOString() } }, true);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    // the reading from before the start is not this check's
    expect(readout()).toBe('— bpm');
    const ring = fake.rings()[0]!;
    view.rerender(
      <MemoryRouter>
        <LivingClockContext.Provider value={clock}>
          <RingServiceProvider service={fake} platform={scenarioPlatform('connected')} sharing={createFakeSharing()}>
            <SignalsSourceProvider source={source()}>
              <CheckNow ring={{ ...ring, liveHr: { bpm: 77, at: new Date(NOW + 2_000).toISOString() } }} />
            </SignalsSourceProvider>
          </RingServiceProvider>
        </LivingClockContext.Provider>
      </MemoryRouter>,
    );
    expect(readout()).toBe('77 bpm');
  });
});
