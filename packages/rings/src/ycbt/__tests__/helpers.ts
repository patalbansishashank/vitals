/**
 * Test helpers for the YCBT fixtures (`qa/fixtures/rings/ycbt`): fixture loading, the Kotlin-event matcher (fixtures name
 * Lumen's `RingDecodedEvent` classes and fields) and the reverse mapping from `RingEvent`s, so session events compare
 * against the same expectations.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { RingEvent } from '../../types';
import { HISTORY_CATALOG, ringTimeToMs, type ZoneContext } from '../commands';

export const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/ycbt');
export const fixture = <T,>(file: string): T => JSON.parse(readFileSync(join(FIX, file), 'utf8')) as T;
export const UTC: ZoneContext = { tz: 'UTC', tzOffsetS: 0 };

export type Expected = Record<string, unknown> & { kotlin: string };
type Shaped = Record<string, unknown> & { kotlin: string };

const META = new Set(['kotlin', 'tolerance', 'absent', 'index', 'count', 'capabilitiesInclude', 'capabilitiesExclude', 'stagesSize', 'stageCounts', 'stagesExclude', 'firstStages']);

/** True when `a` (a decoded event or a reverse-mapped RingEvent) satisfies the fixture's expectation `e`. */
export function matchesKotlin(a: Shaped, e: Expected, zone: ZoneContext = UTC): boolean {
  if (a.kotlin !== e.kotlin) return false;
  const tol = typeof e.tolerance === 'number' ? e.tolerance : 0;
  for (const [k, v] of Object.entries(e)) {
    if (META.has(k)) continue;
    if (k === '_timestamp') {
      if (a._timestamp !== ringTimeToMs((v as { ringSeconds: number }).ringSeconds, zone)) return false;
    } else if (k === 'capabilities') {
      if ([...(a.capabilities as string[])].sort().join() !== [...(v as string[])].sort().join()) return false;
    } else if (typeof v === 'number' && typeof a[k] === 'number') {
      if (Math.abs((a[k] as number) - v) > tol) return false;
    } else if (a[k] !== v) return false;
  }
  const caps = a.capabilities as string[] | undefined;
  if (e.capabilitiesInclude && !(e.capabilitiesInclude as string[]).every((c) => caps?.includes(c))) return false;
  if (e.capabilitiesExclude && (e.capabilitiesExclude as string[]).some((c) => caps?.includes(c))) return false;
  const stages = a.stages as string[] | undefined;
  if (typeof e.stagesSize === 'number' && stages?.length !== e.stagesSize) return false;
  if (e.stageCounts) for (const [s, n] of Object.entries(e.stageCounts as Record<string, number>)) if (stages?.filter((x) => x === s).length !== n) return false;
  if (e.stagesExclude && (e.stagesExclude as string[]).some((s) => stages?.includes(s))) return false;
  if (e.firstStages) {
    const f = e.firstStages as { count: number; stage: string };
    if (!stages || stages.slice(0, f.count).some((s) => s !== f.stage)) return false;
  }
  return true;
}

/** Asserts a list of shaped events against a fixture expectation list and its `match` rule. */
export function checkEvents(actual: Shaped[], expected: Expected[], match: string, label: string, count?: number): void {
  const present = expected.filter((e) => !e.absent);
  for (const e of expected.filter((x) => x.absent)) expect(actual.some((a) => a.kotlin === e.kotlin), `${label}: no ${e.kotlin}`).toBe(false);
  if (match === 'ignore') return;
  if (match === 'count') return void expect(actual.length, label).toBe(count);
  if (match === 'exact' || match === 'prefix') {
    if (match === 'exact') expect(actual.length, `${label}: ${JSON.stringify(actual)}`).toBe(present.length);
    present.forEach((e, i) => expect(actual[i] && matchesKotlin(actual[i]!, e), `${label}: #${i} ${JSON.stringify(e)} vs ${JSON.stringify(actual[i])}`).toBe(true));
    return;
  }
  for (const e of present) {
    const same = actual.filter((a) => a.kotlin === e.kotlin);
    if (typeof e.count === 'number' && Object.keys(e).length === 2) {
      expect(same.length, `${label}: ${e.kotlin} count`).toBe(e.count);
      continue;
    }
    const pool = typeof e.index === 'number' ? same.slice(e.index, e.index + 1) : same;
    expect(pool.some((a) => matchesKotlin(a, e)), `${label}: ${JSON.stringify(e)} in ${JSON.stringify(same).slice(0, 400)}`).toBe(true);
  }
}

const LABEL = Object.fromEntries(HISTORY_CATALOG.map((t) => [t.name, t.label]));
const KIND: Record<string, string> = { hr: 'HEART_RATE', spo2: 'SPO2', hrv: 'HRV', skin_temp: 'TEMPERATURE', resp_rate: 'RESPIRATORY_RATE' };

/** A `RingEvent` back in Lumen's terms (only the shapes the session fixtures check). */
export function kotlinOf(e: RingEvent): Shaped | null {
  switch (e.type) {
    case 'sample':
      if (e.origin === 'history') return { kotlin: 'HistoryMeasurement', kind_field: KIND[e.stream], value: e.value, _timestamp: e.t };
      if (e.stream === 'hr') return { kotlin: 'HeartRateSample', bpm: e.value };
      if (e.stream === 'spo2') return { kotlin: 'Spo2Result', value: e.value };
      return null;
    case 'status': {
      const v = String(e.value);
      if (e.key === 'firmware') return { kotlin: 'Status', firmware: v };
      if (e.key === 'battery') return { kotlin: 'Battery', percent: e.value };
      if (e.key === 'capabilities') return { kotlin: 'SupportFunctions', capabilities: v ? v.split(',') : [] };
      if (e.key === 'ack' && typeof e.value === 'number') return { kotlin: 'CommandAck', commandId: e.value };
      if (v.startsWith('measurement_complete:')) return { kotlin: 'MeasurementComplete', mode: Number(v.split(':')[1]), success: true };
      if (v.startsWith('measurement_failed:')) return { kotlin: 'MeasurementComplete', mode: Number(v.split(':')[1]), success: false };
      if (v.startsWith('measurement_rejected:')) return { kotlin: 'MeasurementRejected', mode: Number(v.split(':')[1]) };
      return null;
    }
    case 'progress':
      return e.stage === 'history' && e.done ? { kotlin: 'HistorySyncFinished' } : LABEL[e.stage] ? { kotlin: 'HistorySyncProgress', stage: `Syncing ${LABEL[e.stage]}…` } : null;
  }
  return null;
}
