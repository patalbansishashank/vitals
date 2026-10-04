import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncScheduler, onEngineBack, type SyncTrigger } from './scheduler';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(results: boolean[] = []) {
  const calls: SyncTrigger[] = [];
  const s = createSyncScheduler({
    round: async (reason) => {
      calls.push(reason);
      return results.length ? results.shift()! : true;
    },
  });
  return { s, calls };
}

describe('sync scheduler', () => {
  it('syncs on open and on a 5-minute heartbeat while visible', async () => {
    const { s, calls } = setup();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['open']);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls).toEqual(['open', 'heartbeat']);
    s.setVisible(false);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(calls).toEqual(['open', 'heartbeat']);
    s.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['open', 'heartbeat', 'visible']);
    s.stop();
  });

  it('debounces writes by 2 s', async () => {
    const { s, calls } = setup();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    s.noteWrite();
    await vi.advanceTimersByTimeAsync(1500);
    s.noteWrite();
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toEqual(['open']);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['open', 'write']);
    s.stop();
  });

  it('does not overlap rounds and runs one more after a trigger during a round', async () => {
    let release: () => void = () => {};
    const calls: SyncTrigger[] = [];
    const s = createSyncScheduler({
      round: (reason) => {
        calls.push(reason);
        return new Promise((r) => {
          release = () => r(true);
        });
      },
    });
    s.start();
    void s.trigger('online');
    void s.trigger('manual');
    expect(calls).toEqual(['open']);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['open', 'manual']);
    release();
    s.stop();
  });

  it('backs off 30 s → 5 min after 3 consecutive failures; manual still runs', async () => {
    const { s, calls } = setup([false, false, false, false, false, false, false, false, true]);
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    await s.trigger('online');
    await s.trigger('online');
    expect(s.failures).toBe(3);
    expect(s.backoffMs).toBe(30_000);
    await s.trigger('visible'); // ignored while backing off
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.at(-1)).toBe('retry');
    expect(s.backoffMs).toBe(60_000);
    await vi.advanceTimersByTimeAsync(60_000 + 120_000 + 240_000);
    expect(s.backoffMs).toBe(300_000);
    await s.trigger('manual');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.failures).toBe(0);
    expect(s.backoffMs).toBe(0);
    s.stop();
  });

  it('runs at once when the network comes back, even while backing off', async () => {
    const { s, calls } = setup([false, false, false]);
    s.start();
    await s.trigger('manual');
    await s.trigger('manual');
    expect(s.backoffMs).toBe(30_000);
    await s.trigger('online');
    expect(calls).toEqual(['open', 'manual', 'manual', 'online']);
    expect(s.backoffMs).toBe(0);
    s.stop();
  });

  it('starts fresh after a stop during a back-off (the open round runs)', async () => {
    const { s, calls } = setup([false, false, false]);
    s.start();
    await s.trigger('manual');
    await s.trigger('manual');
    expect(s.backoffMs).toBeGreaterThan(0);
    s.stop();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.at(-1)).toBe('open');
    expect(s.failures).toBe(0);
    s.stop();
  });
});


describe('engine back (offline or error to synced)', () => {
  const feed = (states: string[]) => {
    let back = 0;
    const on = onEngineBack(() => (back += 1));
    for (const s of states) on(s);
    return back;
  };

  it('fires once when the engine goes from offline, error or connecting to synced', () => {
    expect(feed(['synced', 'offline', 'synced'])).toBe(1);
    expect(feed(['synced', 'error', 'synced'])).toBe(1);
    expect(feed(['connecting', 'synced'])).toBe(1);
    expect(feed(['offline', 'offline', 'synced', 'synced'])).toBe(1);
  });

  it('stays quiet while synced, syncing, or when the first state is already synced', () => {
    expect(feed(['synced', 'syncing', 'synced', 'syncing', 'synced'])).toBe(0);
    expect(feed(['synced'])).toBe(0);
    expect(feed(['offline', 'syncing'])).toBe(0);
  });

  it('an online round resets the back-off, so queued uploads go out at once', async () => {
    const { s, calls } = setup([false, false, false, true]);
    s.start();
    await s.trigger('manual');
    await s.trigger('manual');
    expect(s.backoffMs).toBeGreaterThan(0);
    const on = onEngineBack(() => void s.trigger('online'));
    on('offline');
    on('synced');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.at(-1)).toBe('online');
    expect(s.backoffMs).toBe(0);
    s.stop();
  });
});
