/** Synthetic builders for score tests (no real data). */
import type { ScoreDef, ScoreResult, BioProvenance, DailyRecord, LocalDate, ResolvedDay, ScoreInput, ScoreProfile, SleepRecord, WorkoutRecord } from '../../types';
import { addDays, makeResult } from '../util';

export const prov: BioProvenance = { channel: 'manual', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-01-01T00:00:00.000Z', device: { type: 'watch', tier: 'A' } };
const quality = { validation: 'measured', confidence: 'high', flags: [] } as const;

export function daily(date: LocalDate, p: Partial<DailyRecord> = {}): DailyRecord {
  return { kind: 'daily', record_id: `d-${date}`, version: 1, time: { local_date: date, tz_offset_s: 0 }, provenance: prov, quality: { ...quality, flags: [] }, ...p };
}

export function workout(date: LocalDate, p: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const start = p.time?.start ?? `${date}T07:00:00.000Z`;
  return {
    kind: 'workout', record_id: `w-${date}-${p.exercise_type ?? 'run'}`, version: 1, exercise_type: 'run', active_duration_s: 1800,
    time: { start, end: new Date(Date.parse(start) + (p.active_duration_s ?? 1800) * 1000).toISOString(), local_date: date, tz_offset_s: 0 },
    provenance: prov, quality: { ...quality, flags: [] }, ...p,
  };
}

export function sleep(date: LocalDate, p: Partial<SleepRecord> = {}): SleepRecord {
  return {
    kind: 'sleep', record_id: `s-${date}`, version: 1, is_main: true, asleep_s: 7 * 3600,
    time: { start: `${addDays(date, -1)}T23:00:00.000Z`, end: `${date}T07:00:00.000Z`, local_date: date, tz_offset_s: 0 }, provenance: prov, quality: { ...quality, flags: [] }, ...p,
  };
}

export function resolved(date: LocalDate, p: Partial<ResolvedDay> = {}): ResolvedDay {
  return { localDate: date, sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [], ...p };
}

export function makeInput(date: LocalDate, p: Partial<ScoreInput> = {}, profile: ScoreProfile = {}): ScoreInput {
  return { localDate: date, tz: 'UTC', profile, days: [], series: {}, workouts: [], prior: {}, computedAt: '2026-10-01T00:00:00.000Z', build: 'test', ...p };
}

export const MALE_30: ScoreProfile = { ageY: 30, sex: 'male', massKg: 75, heightCm: 175, paRating: 3, restingHrBpm: 60 };

/** n consecutive days ending at `end`. */
export function dateRange(end: LocalDate, n: number): LocalDate[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
}

export function fakeDef(id: string, version: string, deps: string[] = [], compute?: (i: ScoreInput) => ScoreResult): ScoreDef {
  return {
    scoreId: id, title: id, version, released: '2026-10-01', kind: 'derived_measurement', label: 'measurement', inputs: [], profileInputs: [], gates: [],
    formula: { fn: `${id}@${version}`, text: '' }, params: [], output: { unit: '1', display: 'number' }, uncertainty: { method: 'none', notes: '' },
    evidence: { mechanism: { status: 'mapped', pathway: 'x', engineNodes: [] }, certainty: 'B', refs: [] }, tierHandling: '', planEffects: [], optInStreams: [],
    ...(deps.length ? { dependsOn: deps } : {}),
    compute: compute ?? ((i) => makeResult(id, version, i, { status: 'ok', value: 1, hashOf: i.localDate })),
  };
}
