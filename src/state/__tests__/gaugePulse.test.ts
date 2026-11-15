/**
 * (r069 sync) The pulse loop: the first answer is the baseline; new data asks the screens again at once, a burst once at
 * its end; Gauge's own status reports never do; coming to the front flushes Gauge on this phone; an older server is
 * asked rarely; unpairing stops it. (r087) A 404 during a restart and a refresh owed from before the app went hidden
 * mend themselves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GaugePulse, GaugePulseAnswer } from '@/net/gaugePulse';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { notifyGaugeDataChanged, onGaugeDataChanged } from '@/net/gaugeIdentity';
import { PULSE_REFRESH_GAP_MS, PULSE_RETRY_MS, PULSE_UNSUPPORTED_AFTER, PULSE_UNSUPPORTED_MS, gaugeLive, resetGaugeLiveForTests, startGaugePulse, type GaugePulseDeps } from '../gaugePulse';

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

  it('a new server run asks again', async () => {
    vi.useFakeTimers();
    const h = harness([{ ok: true, pulse: pulse(5, 5) }, { ok: true, pulse: pulse(0, 0, 'b2') }]);
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('a "no such route" answer while the server restarts is asked again, and the loop carries on by itself', async () => {
    vi.useFakeTimers();
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: false, problem: 'not_supported' }, { ok: false, problem: 'not_supported' }, { ok: true, pulse: pulse(2, 2) }]);
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(h.asked).toEqual([null, 'b1.1.1']);
    await h.tick(PULSE_RETRY_MS);
    await h.tick(PULSE_RETRY_MS * 2);
    // no visibility change and no new pairing was needed; the cursor was kept, so the data that landed meanwhile counts
    expect(h.asked).toEqual([null, 'b1.1.1', 'b1.1.1', 'b1.1.1', 'b1.2.2']);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('an older server without the route is asked rarely, but still asked', async () => {
    vi.useFakeTimers();
    const answers: GaugePulseAnswer[] = Array.from({ length: PULSE_UNSUPPORTED_AFTER + 1 }, () => ({ ok: false, problem: 'not_supported' }));
    const h = harness([...answers, { ok: true, pulse: pulse(1, 1) }]);
    startGaugePulse(h.deps);
    await h.tick(10 * 60_000);
    expect(h.asked).toHaveLength(PULSE_UNSUPPORTED_AFTER);
    await h.tick(PULSE_UNSUPPORTED_MS);
    expect(h.asked).toHaveLength(PULSE_UNSUPPORTED_AFTER + 1);
    // the server was updated: the next ask finds the route
    await h.tick(PULSE_UNSUPPORTED_MS);
    expect(gaugeLive().pulse?.token).toBe('b1.1.1');
  });

  it('a refresh still waiting when the app goes hidden is done when it comes back, dated to when it went', async () => {
    vi.useFakeTimers();
    let visible = true;
    const heard: Array<number | undefined> = [];
    const off = onGaugeDataChanged((changedAt) => heard.push(changedAt));
    // the second change comes inside the 30-second gap, so its refresh waits on a timer
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }, { ok: true, pulse: pulse(3, 3) }], { visible: () => visible });
    startGaugePulse(h.deps);
    await h.tick(1000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    const hiddenAt = Date.parse('2026-10-29T12:00:01Z');
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await h.tick(PULSE_REFRESH_GAP_MS * 4);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    // the Android shell reports the same return a second time
    document.dispatchEvent(new Event('resume'));
    await h.tick(0);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    expect(heard).toEqual([undefined, hiddenAt]);
    await h.tick(PULSE_REFRESH_GAP_MS * 2);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    off();
  });

  it('an import held back by going hidden before it began is run on coming back', async () => {
    vi.useFakeTimers();
    let visible = true;
    let finish!: (began: boolean) => void;
    const stillCurrent: Array<() => boolean> = [];
    const refresh = vi.fn((current: () => boolean) => { stillCurrent.push(current); return new Promise<boolean>((resolve) => { finish = resolve; }); });
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }], { refresh, visible: () => visible });
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    // it was still waiting for another import to end: it is told not to begin, and says it did not
    expect(stillCurrent[0]!()).toBe(false);
    finish(false);
    await h.tick(PULSE_REFRESH_GAP_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await h.tick(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(stillCurrent[1]!()).toBe(true);
  });

  it('an import that had begun when the app went hidden runs to its end and is not run again on coming back', async () => {
    vi.useFakeTimers();
    let visible = true;
    let finish!: () => void;
    const heard: Array<number | undefined> = [];
    const off = onGaugeDataChanged((changedAt) => heard.push(changedAt));
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }], { refresh, visible: () => visible });
    startGaugePulse(h.deps);
    await h.tick(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    finish();
    await h.tick(1000);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await h.tick(PULSE_REFRESH_GAP_MS * 2);
    // the app's own import on coming back is the only one: the pulse neither imports nor tells the screens again
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([undefined]);
    off();
  });

  it('an import held back while hidden that answers only after the app is back is run then', async () => {
    vi.useFakeTimers();
    let visible = true;
    let finish!: (began: boolean) => void;
    const refresh = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }], { refresh, visible: () => visible });
    startGaugePulse(h.deps);
    await h.tick(0);
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await h.tick(1000);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await h.tick(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    // the import it waited behind ends now: it was told not to begin while the app was hidden
    finish(false);
    await h.tick(PULSE_REFRESH_GAP_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('nothing is owed to a new pairing', async () => {
    vi.useFakeTimers();
    let visible = true;
    let pairChanged!: () => void;
    const h = harness([{ ok: true, pulse: pulse(1, 1) }, { ok: true, pulse: pulse(2, 2) }, { ok: true, pulse: pulse(3, 3) }], {
      visible: () => visible, onPairing: (fn) => { pairChanged = fn; return () => undefined; },
    });
    startGaugePulse(h.deps);
    await h.tick(1000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    visible = false;
    document.dispatchEvent(new Event('visibilitychange'));
    // paired with another server while hidden: the old server's data is not the new one's
    pairChanged();
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await h.tick(PULSE_REFRESH_GAP_MS * 2);
    expect(h.refresh).toHaveBeenCalledTimes(1);
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

  it('(r087) the gap counts from anyone telling the screens, so they are not told twice inside it', async () => {
    vi.useFakeTimers();
    // a server whose held request answers when the test says
    const held: Array<(a: GaugePulseAnswer) => void> = [];
    const first: GaugePulseAnswer[] = [{ ok: true, pulse: pulse(1, 1) }];
    const h = harness([], {
      pulse: (_since, o) => {
        const next = first.shift();
        if (next) return Promise.resolve(next);
        return new Promise((resolve, reject) => {
          held.push(resolve);
          o.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    });
    startGaugePulse(h.deps);
    await h.tick(0);
    const told = vi.fn();
    const off = onGaugeDataChanged(told);
    // an import (or a finished measurement) tells the screens
    notifyGaugeDataChanged();
    expect(told).toHaveBeenCalledTimes(1);
    await h.tick(5_000);
    // new data a few seconds later waits for the end of that gap
    held.shift()!({ ok: true, pulse: pulse(2, 2) });
    await h.tick(0);
    expect(told).toHaveBeenCalledTimes(1);
    expect(h.refresh).not.toHaveBeenCalled();
    // a second word while that refresh waits moves its turn on again
    await h.tick(10_000);
    notifyGaugeDataChanged();
    expect(told).toHaveBeenCalledTimes(2);
    await h.tick(PULSE_REFRESH_GAP_MS - 1_000);
    expect(told).toHaveBeenCalledTimes(2);
    await h.tick(1_000);
    expect(told).toHaveBeenCalledTimes(3);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    off();
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
