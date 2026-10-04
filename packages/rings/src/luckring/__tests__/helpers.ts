/**
 * Test helpers for the LuckRing fixtures (`qa/fixtures/rings/luckring`): fixture loading, a reverse map from `RingEvent`
 * to the Kotlin event shape the fixtures assert, a fake ring that accepts every write, and a small replay helper for the
 * fixture steps `fakeFromSession` cannot run (`do`, `advanceMs`, `expectEvents`, `expectProgress`, `expectRunning`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { FakePeripheral } from '../../testing';
import { toHex, type RingEvent, type SessionRuntime, type Uuid } from '../../types';
import { HISTORY_CATALOG } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/luckring');
export const fixture = <T,>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

export type Kotlin = Record<string, unknown>;

export interface LuckStep {
  do?: Record<string, unknown>;
  advanceMs?: number;
  expectWrite?: string;
  notify?: string[];
  expectEvents?: Kotlin[];
  expectProgress?: string[];
  expectNoWrite?: boolean;
  expectRunning?: boolean;
}
export interface LuckSession {
  name: string;
  setup: { clock?: { nowMs: number; tzOffsetS: number } } & Record<string, unknown>;
  steps: LuckStep[];
}

const sessions = fixture<{ sessions: LuckSession[] }>('sessions.json').sessions;
export function session(name: string): LuckSession {
  const s = sessions.find((x) => x.name.startsWith(name));
  if (!s) throw new Error(`no fixture session ${name}`);
  return s;
}

export const fixedClock = (c: { nowMs: number; tzOffsetS: number } = { nowMs: 1_700_000_000_000, tzOffsetS: 0 }) => ({ now: () => c.nowMs, tzOffsetS: () => c.tzOffsetS });
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Polls until `cond` holds (real timers; the session runs on the scaled test timers). */
export async function waitUntil(cond: () => boolean, ms = 2_000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

/** A fake ring that takes every write (the replay helper checks the order itself). */
export class RecordingFake extends FakePeripheral {
  override async write(_s: Uuid, _c: Uuid, bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new Error('not connected');
    this.writes.push(bytes.slice());
  }
}

const STAGE: Record<string, string> = { light: 'LIGHT', deep: 'DEEP', awake: 'AWAKE', rem: 'REM', unknown: 'UNKNOWN' };
const S = (t: number): number => t / 1000;

/** `RingEvent` → the Kotlin `RingDecodedEvent` the fixtures name (undefined for housekeeping with no Kotlin event). */
export function kotlinOf(e: RingEvent): Kotlin | undefined {
  switch (e.type) {
    case 'sample': {
      const hist = e.origin === 'history';
      const kind = { hr: 'HEART_RATE', spo2: 'SPO2', hrv: 'HRV', skin_temp: 'TEMPERATURE' }[e.stream as string];
      if (hist) return { kotlin: 'HistoryMeasurement', kind, value: e.value, timestampS: S(e.t) };
      if (e.stream === 'hr') return { kotlin: 'HeartRateSample', bpm: e.value, timestampS: S(e.t) };
      if (e.stream === 'spo2') return { kotlin: 'Spo2Result', value: e.value, timestampS: S(e.t) };
      if (e.stream === 'hrv') return { kotlin: 'HrvSample', value: e.value, timestampS: S(e.t) };
      if (e.stream === 'skin_temp') return { kotlin: 'TemperatureSample', celsius: e.value, timestampS: S(e.t) };
      return undefined;
    }
    case 'vendor': {
      const kind = { bp_sys: 'BLOOD_PRESSURE_SYSTOLIC', bp_dia: 'BLOOD_PRESSURE_DIASTOLIC', stress: 'STRESS' }[e.key];
      if (e.origin === 'history' || e.key !== 'stress') return { kotlin: 'HistoryMeasurement', kind, value: e.value, timestampS: S(e.t) };
      return { kotlin: 'StressSample', value: e.value, timestampS: S(e.t) };
    }
    case 'activityBucket':
      return { kotlin: 'ActivityBucket', timestampS: S(e.start), steps: e.steps, distanceMeters: e.distanceM };
    case 'sleepEpochs':
      return { kotlin: 'SleepTimeline', timestampS: S(e.start), stages: e.stages.map((s) => STAGE[s]) };
    case 'status':
      if (e.key === 'battery') return { kotlin: 'Battery', percent: e.value };
      if (e.key === 'firmware') return { kotlin: 'Status', firmware: e.value };
      if (e.key === 'ack' && e.value === 'hr_complete') return { kotlin: 'HeartRateComplete' };
      if (e.key === 'ack' && e.value === 'spo2_complete') return { kotlin: 'Spo2Complete' };
      if (e.key === 'ack') return { kotlin: 'CommandAck', commandId: e.value };
      if (e.key === 'error' && String(e.value).startsWith('unknown_data_type:')) return { kotlin: 'Unknown', commandId: Number(String(e.value).split(':')[1]) };
      return undefined;
    default:
      return undefined;
  }
}

export const kotlinEvents = (evs: RingEvent[]): Kotlin[] => evs.map(kotlinOf).filter((x): x is Kotlin => x !== undefined);

/** Fields the port cannot or need not reproduce: Kotlin-only fields and the decoder clock on the "complete" markers. */
const SKIP = new Set(['kotlin', 'charging', 'address', 'rawHex', 'count']);

/** Every asserted field of `want` holds in `got` (numbers to 1e-3, `allStages` = every stage equals it). */
export function sameAsKotlin(got: Kotlin | undefined, want: Kotlin): string | null {
  if (!got) return `missing ${String(want.kotlin)}`;
  if (got.kotlin !== want.kotlin) return `${String(got.kotlin)} != ${String(want.kotlin)}`;
  for (const [k, v] of Object.entries(want)) {
    if (SKIP.has(k)) continue;
    if (k === 'timestampS' && (want.kotlin === 'HeartRateComplete' || want.kotlin === 'Spo2Complete')) continue;
    if (k === 'allStages') {
      if (!(got.stages as string[]).every((s) => s === v)) return `${String(want.kotlin)} stages not all ${String(v)}`;
    } else if (typeof v === 'number') {
      if (typeof got[k] !== 'number' || Math.abs((got[k] as number) - v) > 1e-3) return `${String(want.kotlin)}.${k} ${String(got[k])} != ${v}`;
    } else if (JSON.stringify(got[k]) !== JSON.stringify(v)) {
      return `${String(want.kotlin)}.${k} ${JSON.stringify(got[k])} != ${JSON.stringify(v)}`;
    }
  }
  return null;
}

/** The events (housekeeping dropped) equal the expected list, each as a subset match. */
export function expectKotlin(evs: RingEvent[], want: Kotlin[]): void {
  const got = kotlinEvents(evs);
  expect(got.length, JSON.stringify(got)).toBe(want.length);
  want.forEach((w, i) => expect(sameAsKotlin(got[i], w)).toBeNull());
}

// ---------------------------------------------------------------- replay of the pager sessions

/** `LuckRingHistorySync.label`. */
const LABEL: Record<number, string> = { 5: 'activity', 6: 'sleep', 8: 'heart rate', 40: 'blood oxygen', 41: 'blood pressure', 42: 'HRV', 47: 'temperature', 53: 'stress' };

/**
 * The Kotlin pager over the library: one `history` exchange per type, in order, with the Kotlin progress strings
 * ("Syncing <label>..." before each request, "done" after the last; nothing on cancel).
 */
export function pager(rt: SessionRuntime, types: number[], signal: AbortSignal, out: { events: RingEvent[]; progress: string[] }): Promise<void> {
  return (async () => {
    for (const dataType of types) {
      const c = HISTORY_CATALOG.find((x) => x.dataType === dataType)!;
      out.progress.push(`Syncing ${LABEL[dataType]}...`);
      try {
        for await (const e of rt.exchange({ op: 'history', params: { dataType, stream: c.stream, stage: c.stage } }, signal)) out.events.push(e);
      } catch (e) {
        if (signal.aborted) return;
        throw e;
      }
    }
    out.progress.push('done');
  })();
}

/**
 * Replays the steps of a pager session against an open session whose handshake wrote `base` packets. Virtual-clock
 * steps (`advanceMs`) are no-ops: the scaled session timers move the pager on, and the next `expectWrite` waits for it.
 */
export async function replayPager(steps: LuckStep[], ctx: { rt: SessionRuntime; fake: FakePeripheral; base: number }): Promise<{ events: RingEvent[]; progress: string[] }> {
  const out = { events: [] as RingEvent[], progress: [] as string[] };
  let w = ctx.base;
  let p = 0;
  let running: Promise<void> | null = null;
  let finished = false;
  let ac = new AbortController();
  let evMark = 0;
  for (const s of steps) {
    if (s.do?.start) {
      const types = s.do.start as number[];
      if (running && !finished) {
        // A pass already in flight wins: a second exchange is refused and writes nothing.
        await expect(ctx.rt.exchange({ op: 'history', params: { dataType: types[0]! } }).next()).rejects.toMatchObject({ code: 'busy' });
      } else {
        ac = new AbortController();
        finished = false;
        running = pager(ctx.rt, types, ac.signal, out).finally(() => {
          finished = true;
        });
      }
    }
    if (s.do?.cancel) {
      ac.abort();
      await running;
    }
    if (s.notify) {
      evMark = out.events.length;
      for (const n of s.notify) ctx.fake.notify(n);
    }
    if (s.expectWrite) {
      await waitUntil(() => ctx.fake.writes.length > w, 2_000, `write ${s.expectWrite}`);
      expect(toHex(ctx.fake.writes[w]!)).toBe(s.expectWrite);
      w++;
    }
    if (s.expectProgress) {
      await waitUntil(() => out.progress.length >= p + s.expectProgress!.length, 2_000, `progress ${s.expectProgress.join()}`);
      expect(out.progress.slice(p, p + s.expectProgress.length)).toEqual(s.expectProgress);
      p += s.expectProgress.length;
    }
    if (s.expectEvents) {
      const want = s.expectEvents;
      await waitUntil(() => kotlinEvents(out.events.slice(evMark)).length >= want.length, 2_000, 'events');
      expectKotlin(out.events.slice(evMark), want);
    }
    if (s.expectRunning === false) {
      await running;
      expect(finished || running === null).toBe(true);
    }
    if (s.expectRunning === true) expect(finished).toBe(false);
    if (s.expectNoWrite) {
      await sleep(40);
      expect(ctx.fake.writes.length, 'no write expected').toBe(w);
    }
  }
  return out;
}
