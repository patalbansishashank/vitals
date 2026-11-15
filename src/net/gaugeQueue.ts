/**
 * The Gauge client's request queue. The home server answers one heavy read at a time, so a screen that asks thirty
 * questions at once only makes each of them wait behind the others until they time out. At most
 * `GAUGE_MAX_IN_FLIGHT` requests are with the server; the rest wait here, the questions of mounted screens first.
 *
 * The pulse long-poll (`./gaugePulse`) is held open on purpose and never passes through this queue.
 */
export type GaugePriority = 'screen' | 'background';

/** Where a request stands in the queue. Shared and mutable: a screen joining a waiting background read moves it up. */
export interface GaugeLane {
  priority: GaugePriority;
}

export const GAUGE_MAX_IN_FLIGHT = 3;

export interface GaugeQueue {
  /**
   * Waits for a free slot. Answers the function that gives the slot back (call it once the server has answered), or
   * null when `signal` aborted first: then no slot is held.
   */
  enter(lane: GaugeLane, signal: AbortSignal): Promise<(() => void) | null>;
  /** Requests with the server now, and requests still waiting. */
  size(): { running: number; waiting: number };
}

export function createGaugeQueue(limit: number = GAUGE_MAX_IN_FLIGHT): GaugeQueue {
  type Waiter = { lane: GaugeLane; start: () => void };
  let running = 0;
  const waiting: Waiter[] = [];

  const drain = () => {
    while (running < limit && waiting.length > 0) {
      // read at the moment of choosing: a lane may have been moved up while it waited
      const screen = waiting.findIndex((w) => w.lane.priority === 'screen');
      const [next] = waiting.splice(screen < 0 ? 0 : screen, 1);
      next!.start();
    }
  };
  const slot = (): (() => void) => {
    running++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      running--;
      drain();
    };
  };

  return {
    enter(lane, signal) {
      if (signal.aborted) return Promise.resolve(null);
      if (running < limit && waiting.length === 0) return Promise.resolve(slot());
      return new Promise((resolve) => {
        const waiter: Waiter = {
          lane,
          start: () => {
            signal.removeEventListener('abort', onAbort);
            resolve(slot());
          },
        };
        const onAbort = () => {
          const i = waiting.indexOf(waiter);
          if (i >= 0) waiting.splice(i, 1);
          resolve(null);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiting.push(waiter);
      });
    },
    size: () => ({ running, waiting: waiting.length }),
  };
}
