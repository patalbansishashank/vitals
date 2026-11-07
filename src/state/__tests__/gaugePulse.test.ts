/**
 * (r069 sync) The pulse loop: the first answer is the baseline; new data asks the screens again at once, a burst once at
 * its end; Gauge's own status reports never do; coming to the front flushes Gauge on this phone; an older server is
 * left alone; unpairing stops it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GaugePulse, GaugePulseAnswer } from '@/net/gaugePulse';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { PULSE_REFRESH_GAP_MS, gaugeLive, resetGaugeLiveForTests, startGaugePulse, type GaugePulseDeps } from '../gaugePulse';

const pulse = (uploads: number, data: number, boot = 'b1'): GaugePulse => ({ token: `${boot}.${uploads}.${data}`, boot, uploads, data, lastUploadAt: `2026-10-29T11:${String(10 + uploads).padStart(2, '0')}:00.000Z`, dataAt: null });
const SNAP: GaugeLocalSnapshot = {
  schema: 1, at: '2026-10-29T11:50:00.000Z', app: '2.8.7',
  upload: { paired: true, pending: 4, lastSentAt: '2026-10-29T11:40:00.000Z', lastError: null, lastErrorAt: null, retryAt: null, needsRepair: false },
  today: null,
};

/** A server that answers the queued pulses one per request, then holds until aborted. */
function harness(answers: GaugePulseAnswer[], over: Partial<GaugePulseDeps> = {}) {
  let clock = Date.parse('2026-10-29T12:00:00Z');
  const asked: Array<string | null> = [];
  const refresh = vi.fn(async () => undefined);
  const flushLocal = vi.fn(async () => SNAP);
  const readLocal = vi.fn(async () => SNAP);
  const deps: GaugePulseDeps = {
    pulse: (since, o) => {
      asked.push(since);
      const next = answers.shift();
      if (next) return Promise.resolve(next);
      return new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    },
    refresh, readLocal, flushLocal,
    visible: () => true,
    onPairing: () => () => undefined,
    isPaired: () => true,
    now: () => clock,
    ...over,
  };
  return { deps, asked, refresh, flushLocal, readLocal, tick: (ms: number) => ((clock += ms), vi.advanceTimersByTimeAsync(ms)) };
}

afterEach(() => {
  resetGaugeLiveForTests();
  vi.useRealTimers();
});

describe('Gauge pulse loop', () => {
  it('takes the first answer as the baseline, then refreshes when data moves, holding on the last token', async () => {
    vi.useFakeTimers();
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 1) }, { ok: true, pulse: pulse(3, 2) }]);
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.asked).toEqual([null, 'b1.1.1', 'b1.2.1', 'b1.3.2']);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(gaugeLive().pulse?.token).toBe('b1.3.2');
    // coming to the front asked Gauge on the phone to send, and a pulse with a new upload read its queue again
    expect(h.flushLocal).toHaveBeenCalledTimes(1);
    expect(h.readLocal).toHaveBeenCalled();
    expect(gaugeLive().local).toEqual(SNAP);
  });

  it('a burst of new data is one refresh now and one at the end of the gap', async () => {
    vi.useFakeTimers();
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }, { ok: true, pulse: pulse(3, 3) }, { ok: true, pulse: pulse(4, 4) }]);
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.tick(PULSE_REFRESH_GAP_MS);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it('replays one coalesced data change after an in-flight import completes', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }, { ok: true, pulse: pulse(3, 3) }], { refresh });
    startGaugePulse(h.deps);
    await h.tick(0);
    await h.tick(PULSE_REFRESH_GAP_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await h.tick(PULSE_REFRESH_GAP_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    await h.tick(PULSE_REFRESH_GAP_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each(['hidden', 'stopped', 'repaired'] as const)('drops a trailing import when %s', async (reason) => {
    vi.useFakeTimers();
    let visible = true;
    let pairChanged!: () => void;
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }, { ok: true, pulse: pulse(3, 3) }], {
      refresh, visible: () => visible,
      onPairing: (fn) => { pairChanged = fn; return () => undefined; },
    });
    const stop = startGaugePulse(h.deps);
    await h.tick(PULSE_REFRESH_GAP_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    if (reason === 'hidden') { visible = false; document.dispatchEvent(new Event('visibilitychange')); }
    else if (reason === 'repaired') pairChanged();
    else stop();
    finish();
    await h.tick(PULSE_REFRESH_GAP_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a new server run asks again; an older server without the route is left alone', async () => {
    vi.useFakeTimers();
    const h = harness([{ ok: true, pulse: pulse(5, 5) }, { ok: true, pulse: pulse(0, 0, 'b2') }]);
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    resetGaugeLiveForTests();
    const old = harness([{ ok: false, problem: 'not_supported' }]);
    startGaugePulse(old.deps);
    await old.tick(60_000);
    expect(old.asked).toEqual([null]);
  });

  it('an offline answer is asked again after a pause; an unpaired one stops and forgets the pulse', async () => {
    vi.useFakeTimers();
    const h = harness([{ ok: false, problem: 'offline' }, { ok: true, pulse: pulse(1, 1) }]);
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.asked).toEqual([null]);
    await h.tick(5_000);
    expect(h.asked).toEqual([null, null, 'b1.1.1']);
    resetGaugeLiveForTests();
    const u = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: false, problem: 'not_paired' }]);
    startGaugePulse(u.deps);
    await u.tick(0);
    expect(gaugeLive().pulse).toBeNull();
    expect(u.asked).toHaveLength(2);
  });

  it('a direct re-pair retires the old cursor, queued refresh and late local snapshot', async () => {
    vi.useFakeTimers();
    let changed!: () => void;
    const late: Array<(s: GaugeLocalSnapshot | null) => void> = [];
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }, { ok: true, pulse: pulse(3, 3) }], {
      onPairing: (fn) => { changed = fn; return () => undefined; },
      flushLocal: () => new Promise((resolve) => late.push(resolve)),
      readLocal: async () => null,
    });
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    changed();
    late[0]!(SNAP);
    await h.tick(0);
    expect(h.asked.at(-1)).toBeNull();
    expect(gaugeLive()).toEqual({ pulse: null, local: null, localAt: null });
    await h.tick(PULSE_REFRESH_GAP_MS);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('asks nothing while hidden or unpaired', async () => {
    vi.useFakeTimers();
    const h = harness([], { visible: () => false });
    startGaugePulse(h.deps);
    await h.tick(1000);
    expect(h.asked).toEqual([]);
    expect(h.flushLocal).not.toHaveBeenCalled();
    resetGaugeLiveForTests();
    const u = harness([], { isPaired: () => false });
    startGaugePulse(u.deps);
    await u.tick(1000);
    expect(u.asked).toEqual([]);
  });
});
