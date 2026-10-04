/**
 * Test helpers for the RWfit fixtures (`qa/fixtures/rings/rwfit`): fixture loading and a map from `RingEvent` to the
 * Kotlin event shape the fixtures assert (`RingDecodedEvent.*`, `timestampS` in epoch seconds).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toHex, type RingEvent } from '../../types';
import { frameRWfit, type RWfitState } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/rwfit');
export const fixture = <T,>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;

export const utc = { now: () => 1_723_000_000_000, tzOffsetS: () => 0 };

export async function collect(it: AsyncIterable<RingEvent>): Promise<RingEvent[]> {
  const out: RingEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** Hex of the frames a list of commands writes on `state`. */
export const framesOf = (cmds: Array<{ op: string; params?: Record<string, number | string | boolean> }>, state: RWfitState): string[] =>
  cmds.flatMap((c) => frameRWfit(c, state)).map((f) => toHex(f.bytes));

const KIND: Record<string, string> = { hr: 'HEART_RATE', spo2: 'SPO2', hrv: 'HRV', skin_temp: 'TEMPERATURE' };
const VENDOR_KIND: Record<string, string> = {
  blood_pressure_systolic_estimate: 'BLOOD_PRESSURE_SYSTOLIC',
  blood_pressure_diastolic_estimate: 'BLOOD_PRESSURE_DIASTOLIC',
  stress: 'STRESS',
  blood_glucose_estimate: 'BLOOD_SUGAR',
};

function runs(stages: string[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const s of stages) {
    const name = s.toUpperCase();
    const last = out[out.length - 1];
    if (last && last[0] === name) last[1]++;
    else out.push([name, 1]);
  }
  return out;
}

/** `RingEvent` → the Kotlin event the fixtures name; undefined for housekeeping (cursor, charging, errors). */
export function kotlinOf(e: RingEvent): Record<string, unknown> | undefined {
  const s = (t: number): number => t / 1000;
  switch (e.type) {
    case 'sample':
      return { kotlin: 'RingDecodedEvent.HistoryMeasurement', kind_field: KIND[e.stream], value: e.value, timestampS: s(e.t) };
    case 'vendor':
      return { kotlin: 'RingDecodedEvent.HistoryMeasurement', kind_field: VENDOR_KIND[e.key], value: e.value, timestampS: s(e.t) };
    case 'dailyTotal':
      return { kotlin: 'RingDecodedEvent.ActivityUpdate', timestampS: s(e.localDay), steps: e.steps, calories: e.kcal, distanceMeters: e.distanceM };
    case 'activityBucket':
      return { kotlin: 'RingDecodedEvent.ActivityBucket', timestampS: s(e.start), steps: e.steps, distanceMeters: e.distanceM };
    case 'sleepEpochs':
      return { kotlin: 'RingDecodedEvent.SleepTimeline', timestampS: s(e.start), stageRuns: runs(e.stages), stageCount: e.stages.length, completeSession: e.complete };
    case 'status':
      if (e.key === 'battery') return { kotlin: 'RingDecodedEvent.Battery', percent: e.value };
      return undefined;
    default:
      return undefined;
  }
}

/** Kotlin-shaped view of the events; legacy `status:charging` folds into the Battery event before it. */
export function kotlinEvents(evs: RingEvent[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const e of evs) {
    if (e.type === 'status' && e.key === 'charging' && out.length) out[out.length - 1]!.charging = e.value === 1;
    const k = kotlinOf(e);
    if (k) out.push(k);
  }
  return out;
}

/** Every asserted field of `expected` holds in `actual` (numbers within `valueTolerance` or 1e-9). */
export function sameAsKotlin(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): string | null {
  if (!actual) return `missing ${String(expected.kotlin)}`;
  const tol = typeof expected.valueTolerance === 'number' ? expected.valueTolerance : 1e-9;
  for (const [k, v] of Object.entries(expected)) {
    if (k === 'valueTolerance' || k === 'valueMmolL') continue;
    if (typeof v === 'number') {
      if (typeof actual[k] !== 'number' || Math.abs((actual[k] as number) - v) > tol) return `${String(expected.kotlin)}.${k} ${String(actual[k])} != ${v}`;
    } else if (JSON.stringify(actual[k]) !== JSON.stringify(v)) {
      return `${String(expected.kotlin)}.${k} ${JSON.stringify(actual[k])} != ${JSON.stringify(v)}`;
    }
  }
  return null;
}
