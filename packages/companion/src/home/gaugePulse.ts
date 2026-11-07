/**
 * (r069 sync) The Gauge pulse: how the person's Vitals devices learn, within a second, that Gauge's data moved, instead
 * of waiting for their next 5-minute import or for the person to come back to the app.
 *
 *   GET /v1/gauge/pulse?since=<token>&wait=0..25   → { token, boot, uploads, data, lastUploadAt, dataAt, serverNow }
 *
 * The server holds the request up to `wait` seconds while `since` is still the person's current token (the commands
 * channel's long-poll, `./commands.ts`), then answers the state now. Without `since`, or with a token of an earlier
 * server run, it answers at once. Two counters, both only in memory (a restart starts a new `boot`, which a client
 * treats as "everything may have moved"):
 *
 * - `uploads`: every upload Gauge made that the store took (accepted or re-sent): "Gauge last sent" moves with it.
 * - `data`: uploads that brought new readings (anything but Gauge's own `state/*` reports, which change every minute
 *   while the ring reconnects), and detection runs that wrote episodes. Only this one asks a client to read again.
 *
 * Nothing about the data is in the answer: counts and times only.
 */
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

/** A hold is at most this long (the commands channel's). */
export const PULSE_MAX_WAIT_S = 25;

export interface PulseState {
  /** `<boot>.<uploads>.<data>`: what a client sends back as `since`. */
  token: string;
  boot: string;
  uploads: number;
  data: number;
  /** When Gauge's last upload reached this server run (ISO), null before the first one. */
  lastUploadAt: string | null;
  /** When the last new readings (or detections) did (ISO). */
  dataAt: string | null;
}

export interface GaugePulse {
  /** Gauge uploaded: `readings` events that are not its own status reports. */
  noteUpload(personId: string, readings: number): void;
  /** Detection wrote episodes for this person. */
  noteDerived(personId: string): void;
  state(personId: string): PulseState;
  /** Hold until the token differs from `since`, `waitMs` passes or the client goes away; resolves with the state then. */
  wait(personId: string, since: string | null, waitMs: number, res: ServerResponse): Promise<PulseState>;
  close(): void;
}

export function createGaugePulse(o: { now?: () => number } = {}): GaugePulse {
  const now = o.now ?? Date.now;
  const boot = randomBytes(6).toString('base64url');
  const people = new Map<string, { uploads: number; data: number; lastUploadMs: number | null; dataMs: number | null }>();
  const waiters = new Map<string, Set<() => void>>();
  const holders = new Set<() => void>();

  const entry = (personId: string) => {
    let e = people.get(personId);
    if (!e) people.set(personId, (e = { uploads: 0, data: 0, lastUploadMs: null, dataMs: null }));
    return e;
  };
  const wake = (personId: string) => waiters.get(personId)?.forEach((f) => f());
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const state = (personId: string): PulseState => {
    const e = people.get(personId);
    const uploads = e?.uploads ?? 0;
    const data = e?.data ?? 0;
    return { token: `${boot}.${uploads}.${data}`, boot, uploads, data, lastUploadAt: iso(e?.lastUploadMs ?? null), dataAt: iso(e?.dataMs ?? null) };
  };

  return {
    noteUpload(personId, readings) {
      const e = entry(personId);
      const at = now();
      e.uploads++;
      e.lastUploadMs = at;
      if (readings > 0) {
        e.data++;
        e.dataMs = at;
      }
      wake(personId);
    },
    noteDerived(personId) {
      const e = entry(personId);
      e.data++;
      e.dataMs = now();
      wake(personId);
    },
    state,
    wait(personId, since, waitMs, res) {
      return new Promise<PulseState>((resolve) => {
        const moved = () => state(personId).token !== since;
        if (waitMs <= 0 || since === null || moved()) return resolve(state(personId));
        const set = waiters.get(personId) ?? new Set<() => void>();
        waiters.set(personId, set);
        const done = () => {
          clearTimeout(timer);
          set.delete(check);
          if (set.size === 0) waiters.delete(personId);
          res.off('close', done);
          holders.delete(done);
          resolve(state(personId));
        };
        const check = () => {
          if (moved()) done();
        };
        set.add(check);
        holders.add(done);
        const timer = setTimeout(done, waitMs);
        res.once('close', done);
      });
    },
    close() {
      for (const done of [...holders]) done();
    },
  };
}

/** Gauge's own status reports (`state/connection`, `state/sync`, `state/battery`, …): they move "last sent" only. */
export function readingsOf(events: readonly unknown[]): number {
  let n = 0;
  for (const e of events) {
    const category = typeof e === 'object' && e !== null ? (e as { category?: unknown }).category : undefined;
    if (typeof category === 'string' && category.startsWith('state/')) continue;
    n++;
  }
  return n;
}
