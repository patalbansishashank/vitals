/**
 * (r087) The ring engine's own readings on this phone reach the Ring day with its `state` event: today's ring steps and
 * the newest heart rate show at once, marked provisional, and give way as soon as the server answers with them. A phone
 * still on the older native app sends neither and the server's answers stand.
 */
import './clock';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import type { EngineState } from '@/platform/gaugeEngine';
import { resetGaugeEngineStoreForTests, startGaugeEngine, type EngineReadings } from '@/state/gaugeEngine';
import { setGaugeApi } from '../api';
import { useRingDay } from '../day';
import { baseState, fakeEngine } from '../engine/__tests__/fakeEngine';
import { makeGaugeFixture } from '../fixtures';
import { useLocalHeartRate, withLocalHeartPoint } from '../localFill';
import { calendarDate } from '../model';
import { useStepsDay } from '../stepsDay';
import type { RingApi } from '../types';
import { clearGaugeCache } from '../useGauge';

const today = calendarDate(Date.now());

/** The demo server, with what the phone's upload adds once it lands (`landed`). */
function server() {
  const base = makeGaugeFixture({ uploadedMinutesAgo: 4 });
  let landed: { ringSteps: number; hr: { at: string; value: number } } | null = null;
  const api: RingApi = {
    ...base,
    // the fused day as a scenario of at least the ring's own total (D3 `atLeast`): the rule the phone's count fills in
    steps: async (from, to) => {
      const s = await base.steps!(from, to);
      if (!s) return s;
      return {
        ...s,
        days: s.days.map((d) => {
          const ring = d.date === today && landed ? landed.ringSteps : (d.ringDailyTotal ?? 0);
          return { ...d, ringDailyTotal: ring, headline: Math.max(d.located, ring), headlinePolicy: 'atLeast' as const };
        }),
      };
    },
    activity: async (from, to) => {
      const a = await base.activity(from, to);
      if (!a || !landed) return a;
      const ring = landed.ringSteps;
      return { ...a, days: a.days.map((d) => (d.date === today ? { ...d, fusedHeadline: Math.max(d.fusedHeadline ?? 0, ring) } : d)) };
    },
    daily: async (date) => {
      const d = await base.daily(date);
      const hr = d?.metrics?.hr;
      if (!d || !landed || date !== today || !hr || !('mean' in hr)) return d;
      return { ...d, metrics: { ...d.metrics, hr: { ...hr, latest: landed.hr } } };
    },
  };
  return { api, land: (v: NonNullable<typeof landed>) => void (landed = v) };
}

function phone() {
  const f = fakeEngine();
  startGaugeEngine({ plugin: () => f.plugin, credentials: () => null, onPairing: () => () => undefined, visible: () => true });
  return f;
}

const hrOf = (day: ReturnType<typeof useRingDay>) => {
  const m = day.daily?.metrics?.hr;
  return m && 'mean' in m ? m.latest : null;
};

beforeEach(() => {
  freshState({ cleared: true });
});

afterEach(() => {
  cleanup();
  resetGaugeEngineStoreForTests();
  setGaugeApi(null);
  clearGaugeCache();
});

it('shows the phone\'s newer ring steps and heart rate at once, and the server\'s answer as soon as it has them', async () => {
  const s = server();
  setGaugeApi(s.api);
  const f = phone();
  const { result } = renderHook(() => ({ day: useRingDay(today), stepsDay: useStepsDay(today), hr: useLocalHeartRate(today) }));
  await waitFor(() => expect(result.current.day.steps).not.toBeNull());
  await waitFor(() => expect(result.current.stepsDay.ready).toBe(true));
  await waitFor(() => expect(hrOf(result.current.day)).not.toBeNull());

  // the older native app: the engine's state has no readings, so everything is the server's
  const serverSteps = result.current.day.steps!;
  const serverHr = hrOf(result.current.day)!;
  const serverUpdated = result.current.stepsDay.updatedAt;
  expect(serverSteps.provisional).toBeUndefined();
  expect(serverHr).not.toHaveProperty('provisional');
  expect(result.current.hr).toBeNull();

  // the ring reports more steps and a new reading: one `state` event, no server round trip. The phone stamps a live
  // reading with its own clock, to the millisecond
  const at = new Date(Math.floor(Date.now() / 1000) * 1000 + 412).toISOString();
  const bpm = (serverHr.value ?? 60) + 9;
  const ringSteps = serverSteps.value + 250;
  const readings: EngineReadings = { today: { date: today, ringSteps, ringStepsAt: at }, latestHr: { bpm, at } };
  act(() => f.set({ ...baseState(), ...readings }));
  expect(result.current.day.steps).toEqual({ value: ringSteps, lineage: serverSteps.lineage, provisional: true });
  expect(hrOf(result.current.day)).toEqual({ at, value: bpm, provisional: true });
  // the one reading the other Heart rate surfaces fill in from, the same object while it is the same reading
  const shared = result.current.hr;
  expect(shared).toEqual({ bpm, at });
  act(() => f.set({ ...baseState(), ...readings, upload: { ...baseState().upload, pending: 9 } }));
  expect(result.current.hr).toBe(shared);
  expect(result.current.stepsDay.updatedAt).toBe(Date.parse(at));
  // the chart and the day's other figures are still the server's
  expect(result.current.day.daily?.activity).toBe(result.current.day.q.data?.activity);
  expect(result.current.stepsDay.bins.length).toBeGreaterThan(0);

  // a count and a reading of another date (the phone has just passed midnight) are not today's
  const other: EngineReadings = { today: { date: '2020-01-01', ringSteps: ringSteps + 5000 }, latestHr: { bpm: bpm + 40, at: '2020-01-01T10:00:00.000Z' } };
  act(() => f.set({ ...baseState(), ...other } as EngineState));
  expect(result.current.day.steps).toEqual(serverSteps);
  expect(hrOf(result.current.day)).toEqual(serverHr);
  expect(result.current.hr).toBeNull();
  expect(result.current.stepsDay.updatedAt).toBe(serverUpdated);

  // the upload lands and the screens read the server again: its answer is shown as it is, nothing added to it
  // (the server gives the reading's time in whole seconds: it is still that reading)
  act(() => f.set({ ...baseState(), ...readings }));
  const serverAt = at.replace(/\.\d{3}Z$/, '+00:00');
  s.land({ ringSteps, hr: { at: serverAt, value: bpm } });
  await act(async () => document.dispatchEvent(new Event('resume')));
  await waitFor(() => expect(result.current.day.steps).toEqual({ value: Math.max(serverSteps.value, ringSteps), lineage: 'fused' }));
  expect(hrOf(result.current.day)).toEqual({ at: serverAt, value: bpm });
  // the phone still holds the reading; a series that ends with it takes nothing more from the phone
  expect(result.current.hr).toEqual({ bpm, at });
  const landedSeries = [{ at: serverAt, value: bpm, provenance: null }];
  expect(withLocalHeartPoint(landedSeries, result.current.hr)).toBe(landedSeries);
  expect(result.current.stepsDay.updatedAt).toBe(serverUpdated);
});
