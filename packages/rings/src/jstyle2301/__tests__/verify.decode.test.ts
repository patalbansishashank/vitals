// @vitest-environment node
/**
 * Independent check of `decodePacket` against the Kotlin-derived decode vectors (`qa/fixtures/rings/jstyle2301/decode.json`).
 * Each Kotlin event is mapped onto the TS `RingDecodedEvent` the port documents (decoder.ts header, docs §12):
 *   HistoryMeasurement HR/SPO2/TEMPERATURE/HRV → `sample` (origin history, value, t); STRESS → `vendor stress`;
 *   VendorMetric → `vendor` (key, value, unit, t); Battery → `status battery`; FirmwareRevision → `status firmware`;
 *   AuthenticationResult → `status ack auth:accepted|rejected`; SleepTimeline → `sleepEpochs` (start, lower-case stages);
 *   ActivityUpdate → `vendor daily_steps|daily_distance|daily_kcal|active_minutes`; HeartRateSample → `sample hr`
 *   (spot for a 0x28 result, live otherwise; bpm 0 → `status ack 0x28`, since Kotlin's RingEventBridge drops it);
 *   SportTelemetry → nothing; Unknown → `status ack unknown:0xNN`.
 * `prelude` packets are decoded first and their firmware reply becomes the context firmware (Kotlin's decoder switches
 * its profile on 0x27). `counts` and `absent` are honoured.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RingDecodedEvent } from '../../../../../src/biometrics/core/ble/types';
import { fromHex } from '../../types';
import { HISTORY_STREAMS, isTerminal } from '../commands';
import { decodePacket, type DecodeContext } from '../decoder';

type KEvent = Record<string, unknown> & { kotlin: string };
interface Vector {
  name: string;
  firmware: string | null;
  tzOffsetS: number;
  nowMs: number | null;
  bytes: string;
  prelude?: string[];
  events: KEvent[];
  match: 'exact' | 'contains';
  counts?: Record<string, number>;
  absent?: KEvent[];
}
interface Fixture {
  vectors: Vector[];
  terminal: Array<{ name: string; streamOpcode: number; bytes: string; terminal: boolean }>;
}

const FIX = join(__dirname, '../../../../../qa/fixtures/rings/jstyle2301/decode.json');
const fixture = JSON.parse(readFileSync(FIX, 'utf8')) as Fixture;

/** Partial expectation: every listed key must equal (numbers within `tol`). */
type Expect = Record<string, unknown>;

const SAMPLE_STREAM: Record<string, 'hr' | 'spo2' | 'skin_temp' | 'hrv'> = { HEART_RATE: 'hr', SPO2: 'spo2', TEMPERATURE: 'skin_temp', HRV: 'hrv' };
const SAMPLE_UNIT: Record<string, string> = { hr: 'bpm', spo2: 'pct', skin_temp: 'degC', hrv: 'ms' };

/** Kotlin event → the TS event(s) it must appear as. Only fields the vector lists are carried over. */
function mapEvent(k: KEvent): Expect[] {
  const has = (f: string): boolean => k[f] !== undefined;
  switch (k.kotlin) {
    case 'HistoryMeasurement': {
      const kind = String(k.measurementKind);
      if (kind === 'STRESS') return [{ type: 'vendor', key: 'stress', unit: 'vendor_units', ...(has('value') ? { value: k.value } : {}), ...(has('timestampMs') ? { t: k.timestampMs } : {}) }];
      const stream = SAMPLE_STREAM[kind];
      if (!stream) throw new Error(`unmapped measurement ${kind}`);
      return [{ type: 'sample', stream, unit: SAMPLE_UNIT[stream], origin: 'history', ...(has('value') ? { value: k.value } : {}), ...(has('timestampMs') ? { t: k.timestampMs } : {}) }];
    }
    case 'VendorMetric':
      return [{ type: 'vendor', key: k.key, ...(has('value') ? { value: k.value } : {}), ...(has('unit') ? { unit: k.unit } : {}), ...(has('timestampMs') ? { t: k.timestampMs } : {}) }];
    case 'Battery':
      return [{ type: 'status', key: 'battery', value: k.percent }];
    case 'FirmwareRevision':
      return [{ type: 'status', key: 'firmware', value: k.version }];
    case 'AuthenticationResult':
      return [{ type: 'status', key: 'ack', value: k.accepted ? 'auth:accepted' : 'auth:rejected' }];
    case 'SleepTimeline': {
      const stages = (k.stages as string[]).map((s) => s.toLowerCase());
      return [{ type: 'sleepEpochs', start: k.timestampMs, epochS: 60, stages }];
    }
    case 'ActivityUpdate': {
      const out: Expect[] = [];
      if (has('steps')) out.push({ type: 'vendor', key: 'daily_steps', value: k.steps, unit: 'count' });
      if (has('distanceMeters')) out.push({ type: 'vendor', key: 'daily_distance', value: k.distanceMeters, unit: 'm' });
      if (has('calories')) out.push({ type: 'vendor', key: 'daily_kcal', value: k.calories, unit: 'kcal' });
      if (has('activeMinutes') && k.activeMinutes !== null) out.push({ type: 'vendor', key: 'active_minutes', value: k.activeMinutes, unit: 'min' });
      return out;
    }
    case 'HeartRateSample': {
      if (k.bpm === 0) return [{ type: 'status', key: 'ack', value: '0x28' }];
      const origin = k.measurementResult ? 'spot' : 'live';
      return [{ type: 'sample', stream: 'hr', unit: 'bpm', value: k.bpm, origin, ...(has('timestampMs') ? { t: k.timestampMs } : {}) }];
    }
    case 'SportTelemetry':
      return [];
    case 'Unknown':
      return [{ type: 'status', key: 'ack', value: `unknown:0x${Number(k.commandId).toString(16).padStart(2, '0')}` }];
  }
  throw new Error(`unmapped Kotlin event ${k.kotlin}`);
}

const TOL = 1e-4;
function fits(actual: RingDecodedEvent, exp: Expect): boolean {
  const a = actual as unknown as Record<string, unknown>;
  return Object.entries(exp).every(([key, v]) => {
    const got = a[key];
    if (typeof v === 'number' && typeof got === 'number') return Math.abs(got - v) <= TOL;
    if (Array.isArray(v)) return Array.isArray(got) && got.length === v.length && v.every((x, i) => got[i] === x);
    return got === v;
  });
}

/** TS events a Kotlin class is counted as (for `counts`). */
function countOf(events: RingDecodedEvent[], kotlinClass: string): number {
  switch (kotlinClass) {
    case 'ActivityUpdate':
      return events.filter((e) => e.type === 'vendor' && e.key === 'daily_steps').length;
    case 'ActivityBucket':
      return events.filter((e) => e.type === 'activityBucket').length;
    case 'SleepTimeline':
      return events.filter((e) => e.type === 'sleepEpochs').length;
  }
  throw new Error(`no count mapping for ${kotlinClass}`);
}

function decodeVector(v: Vector): RingDecodedEvent[] {
  const ctx: DecodeContext = { firmware: v.firmware, tzOffsetS: v.tzOffsetS, nowMs: v.nowMs ?? 0 };
  for (const p of v.prelude ?? []) {
    const r = decodePacket(fromHex(p), ctx);
    if (r.firmware !== undefined) ctx.firmware = r.firmware;
  }
  return decodePacket(fromHex(v.bytes), ctx).events;
}

describe('decode.json vectors through decodePacket', () => {
  it('covers every vector', () => {
    expect(fixture.vectors.length).toBe(29);
  });

  for (const v of fixture.vectors) {
    it(v.name, () => {
      const got = decodeVector(v);
      const want = v.events.flatMap(mapEvent);
      if (v.match === 'exact') {
        expect(got.length, `event count; got ${JSON.stringify(got)}`).toBe(want.length);
        want.forEach((w, i) => expect(fits(got[i]!, w), `event ${i}: got ${JSON.stringify(got[i])} want ${JSON.stringify(w)}`).toBe(true));
      } else {
        // contains: each expected event present; the matched TS events keep the Kotlin emission order.
        let from = 0;
        for (const w of want) {
          const at = got.findIndex((g, i) => i >= from && fits(g, w));
          expect(at, `missing ${JSON.stringify(w)} in ${JSON.stringify(got)}`).toBeGreaterThanOrEqual(0);
          from = at + 1;
        }
      }
      for (const [cls, n] of Object.entries(v.counts ?? {})) expect(countOf(got, cls), `count ${cls}`).toBe(n);
      for (const a of v.absent ?? []) for (const w of mapEvent(a)) expect(got.some((g) => fits(g, w)), `absent ${JSON.stringify(w)}`).toBe(false);
    });
  }
});

describe('decode.json terminal vectors through isTerminal', () => {
  for (const t of fixture.terminal) {
    it(t.name, () => {
      const s = Object.values(HISTORY_STREAMS).find((x) => x.opcode === t.streamOpcode)!;
      expect(isTerminal(fromHex(t.bytes), s)).toBe(t.terminal);
    });
  }
});

describe('decoder details the vectors do not assert', () => {
  const ctx: DecodeContext = { firmware: 'V0525', tzOffsetS: 0, nowMs: 1_789_552_800_000 };
  const ts = Date.UTC(2026, 8, 14, 12, 34, 56);

  it('activity detail: minute buckets carry the steps and split the distance like Kotlin (last bucket takes the rest)', () => {
    // 52 00 00 | 26 09 14 12 34 56 | steps 100 | kcal 4.35 | distance 7×10 m | minutes 60, 40, 0…
    const ev = decodePacket(fromHex('52 00 00 26 09 14 12 34 56 64 00 b3 01 07 00 3c 28 00 00 00 00 00 00 00 00'), ctx).events;
    const buckets = ev.filter((e) => e.type === 'activityBucket');
    expect(buckets).toEqual([
      { type: 'activityBucket', start: ts, durS: 60, steps: 60, distanceM: 42 },
      { type: 'activityBucket', start: ts + 60_000, durS: 60, steps: 40, distanceM: 28 },
    ]);
  });

  it('34-byte sleep records expand each 5-minute code to five minutes; count capped at 24', () => {
    const rec = fromHex('53 00 00 26 09 14 23 00 00 02 01 05 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00');
    const ev = decodePacket(rec, ctx).events;
    expect(ev).toHaveLength(1);
    const s = ev[0]!;
    expect(s.type).toBe('sleepEpochs');
    if (s.type !== 'sleepEpochs') return;
    expect(s.stages).toEqual(['deep', 'deep', 'deep', 'deep', 'deep', 'awake', 'awake', 'awake', 'awake', 'awake']);
    expect(s.epochS).toBe(60);
  });

  it('26-byte activity total reads the goal from one byte at 21', () => {
    const r = new Uint8Array(26);
    r.set([0x51, 0x00, 0x26, 0x09, 0x14]);
    r[5] = 10; // steps
    r[21] = 0x50; // goal 80 (one byte)
    r[22] = 0x01; // would make a u16 goal 336 if misread
    const ev = decodePacket(r, ctx).events;
    expect(ev.find((e) => e.type === 'vendor' && e.key === 'step_goal')).toMatchObject({ value: 0x50 });
    expect(ev.find((e) => e.type === 'vendor' && e.key === 'daily_steps')).toMatchObject({ value: 10, t: Date.UTC(2026, 8, 14) });
  });

  it('workout heart rate: 15 values at 10 s steps, zeros skipped', () => {
    const r = fromHex('54 00 00 26 09 14 12 34 56 50 00 52 00 00 00 00 00 00 00 00 00 00 00');
    const ev = decodePacket(new Uint8Array([...r, 0x00]), ctx).events;
    expect(ev).toEqual([
      { type: 'sample', stream: 'hr', t: ts, value: 0x50, unit: 'bpm', origin: 'history' },
      { type: 'sample', stream: 'hr', t: ts + 20_000, value: 0x52, unit: 'bpm', origin: 'history' },
    ]);
  });

  it('a 0x28 type-2 result is range-gated before becoming a public sample', () => {
    expect(decodePacket(fromHex('28 02 ff'), ctx).events).toEqual([]);
  });
});
