import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setGaugeApi } from '@/features/ring/api';
import { makeGaugeFixture } from '@/features/ring/fixtures';
import { clearGaugeCache, useGauge } from '@/features/ring/useGauge';
import { resetGaugeLiveForTests, startGaugePulse } from '../gaugePulse';
import type { GaugePulseAnswer } from '@/net/gaugePulse';

type Run = (deps: object, afterCurrent?: () => boolean) => Promise<unknown>;
const never: Run = () => new Promise(() => undefined);
const imports = vi.hoisted(() => ({ run: vi.fn<Run>(() => new Promise(() => undefined)) }));
vi.mock('../gaugeImport', () => ({ runGaugeImport: imports.run }));
afterEach(() => { resetGaugeLiveForTests(); cleanup(); setGaugeApi(null); clearGaugeCache(); imports.run.mockReset(); imports.run.mockImplementation(never); });

it('updates all mounted card queries on a data pulse while import reconciliation is still pending', async () => {
  setGaugeApi(makeGaugeFixture());
  let value = 1;
  const steps = renderHook(() => useGauge('pulse-steps', async () => ({ steps: value })));
  const sleep = renderHook(() => useGauge('pulse-sleep', async () => ({ minutes: value })));
  const signals = renderHook(() => useGauge('pulse-signals', async () => ({ heartRate: value })));
  const energy = renderHook(() => useGauge('pulse-energy', async () => ({ score: value })));
  await waitFor(() => expect(steps.result.current.data).toEqual({ steps: 1 }));
  await waitFor(() => expect(sleep.result.current.data).toEqual({ minutes: 1 }));
  value = 2;
  // Reproduce the navigation symptom: the mounted summary stays old, but opening its
  // detail asks the shared question again and immediately updates both consumers.
  expect(steps.result.current.data).toEqual({ steps: 1 });
  const detail = renderHook(() => useGauge('pulse-steps', async () => ({ steps: value })));
  await waitFor(() => expect(steps.result.current.data).toEqual({ steps: 2 }));
  detail.unmount();
  value = 3;
  const answers: GaugePulseAnswer[] = [1, 2].map((data) => ({ ok: true, pulse: { token: `b.${data}`, boot: 'b', uploads: data, data, lastUploadAt: null, dataAt: null } }));
  act(() => { startGaugePulse({
    pulse: async (_, o) => answers.shift() ?? new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    visible: () => true, isPaired: () => true, onPairing: () => () => undefined,
    readLocal: async () => null, flushLocal: async () => null,
  }); });
  await waitFor(() => expect(imports.run).toHaveBeenCalled());
  await waitFor(() => expect(steps.result.current.data).toEqual({ steps: 3 }));
  expect(sleep.result.current.data).toEqual({ minutes: 3 });
  expect(signals.result.current.data).toEqual({ heartRate: 3 });
  expect(energy.result.current.data).toEqual({ score: 3 });
});

it('owes on coming back an import that going hidden held back behind another, and none that had begun', async () => {
  let visible = true;
  let clock = Date.parse('2026-11-15T12:00:00Z');
  // the importer: a run under way ends when the test says, and only then asks whether the pulse's own may begin
  const ends: Array<() => void> = [];
  let waitsBehindAnother = true;
  imports.run.mockImplementation((_deps, afterCurrent) => new Promise((resolve) => {
    const behind = waitsBehindAnother;
    ends.push(() => resolve(behind && !afterCurrent!() ? { ran: false, reason: 'busy' } : { ran: true }));
  }));
  const answers: GaugePulseAnswer[] = [1, 2].map((data) => ({ ok: true, pulse: { token: `b.${data}`, boot: 'b', uploads: data, data, lastUploadAt: null, dataAt: null } }));
  const turn = (to: boolean) => { visible = to; clock += 60_000; document.dispatchEvent(new Event('visibilitychange')); };
  startGaugePulse({
    pulse: async (_, o) => answers.shift() ?? new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    visible: () => visible, isPaired: () => true, onPairing: () => () => undefined, now: () => clock,
    readLocal: async () => null, flushLocal: async () => null,
  });
  await waitFor(() => expect(imports.run).toHaveBeenCalledTimes(1));
  turn(false);
  ends[0]!();
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(imports.run).toHaveBeenCalledTimes(1);
  // back in front: the import that never began is run now, and this one begins at once
  waitsBehindAnother = false;
  turn(true);
  await waitFor(() => expect(imports.run).toHaveBeenCalledTimes(2));
  turn(false);
  ends[1]!();
  await new Promise((resolve) => setTimeout(resolve, 15));
  turn(true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(imports.run).toHaveBeenCalledTimes(2);
});
