/** The Gauge request queue: a fixed number with the server, screens first, a waiter that gives up holds nothing. */
import { describe, expect, it } from 'vitest';
import { GAUGE_MAX_IN_FLIGHT, createGaugeQueue, type GaugeLane } from '../gaugeQueue';

const never = () => new AbortController().signal;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Enters the queue and records the order in which slots were given. */
function entering(queue: ReturnType<typeof createGaugeQueue>, order: string[]) {
  return (name: string, lane: GaugeLane, signal: AbortSignal = never()) => {
    let release: (() => void) | null | undefined;
    const done = queue.enter(lane, signal).then((r) => {
      release = r;
      if (r) order.push(name);
      return r;
    });
    return { done, release: () => release?.(), got: () => release };
  };
}

describe('Gauge request queue', () => {
  it('lets three through and holds the rest in the order they came', async () => {
    const queue = createGaugeQueue();
    const order: string[] = [];
    const enter = entering(queue, order);
    const all = ['a', 'b', 'c', 'd', 'e'].map((n) => enter(n, { priority: 'background' }));
    await tick();
    expect(GAUGE_MAX_IN_FLIGHT).toBe(3);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(queue.size()).toEqual({ running: 3, waiting: 2 });
    all[1]!.release();
    await tick();
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    // giving a slot back twice frees one slot, not two
    all[1]!.release();
    await tick();
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(queue.size()).toEqual({ running: 3, waiting: 1 });
  });

  it('serves a screen before the background reads that were already waiting, and a lane moved up while it waits', async () => {
    const queue = createGaugeQueue(1);
    const order: string[] = [];
    const enter = entering(queue, order);
    const first = enter('first', { priority: 'background' });
    const moved: GaugeLane = { priority: 'background' };
    enter('import-1', { priority: 'background' });
    enter('import-2', moved);
    const card = enter('card', { priority: 'screen' });
    await tick();
    first.release();
    await tick();
    expect(order).toEqual(['first', 'card']);
    moved.priority = 'screen';
    card.release();
    await tick();
    expect(order).toEqual(['first', 'card', 'import-2']);
  });

  it('a waiter that is cancelled leaves the queue without ever holding a slot', async () => {
    const queue = createGaugeQueue(1);
    const order: string[] = [];
    const enter = entering(queue, order);
    const first = enter('first', { priority: 'screen' });
    const gone = new AbortController();
    const cancelled = enter('cancelled', { priority: 'screen' }, gone.signal);
    enter('next', { priority: 'background' });
    await tick();
    gone.abort();
    expect(await cancelled.done).toBeNull();
    expect(queue.size()).toEqual({ running: 1, waiting: 1 });
    first.release();
    await tick();
    expect(order).toEqual(['first', 'next']);
    const late = new AbortController();
    late.abort();
    expect(await queue.enter({ priority: 'screen' }, late.signal)).toBeNull();
  });
});
