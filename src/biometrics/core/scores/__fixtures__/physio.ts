/** Synthetic fixtures for the physiology score tests (no personal data). */
import type { BioStream, DeviceTier, ResolvedDay, ScoreInput, ScoreResult, SleepRecord, SleepStageInterval } from '../../types';
import { addDays } from '../util';

export const T0 = '2026-09-01';

const prov = (tier: DeviceTier) => ({
  channel: 'manual' as const,
  device: { type: 'ring' as const, tier },
  recording_method: 'automatic' as const,
  modality: 'sensed' as const,
  ingested_at: '2026-10-01T00:00:00.000Z',
});

/** ISO instant for local `date` at `hh:mm` with offset (s). */
export function at(date: string, hhmm: string, offsetS = 0): string {
  return new Date(Date.parse(`${date}T${hhmm}:00Z`) - offsetS * 1000).toISOString();
}

export function ms(date: string, hhmm: string, offsetS = 0): number {
  return Date.parse(at(date, hhmm, offsetS));
}

export interface SleepOpts {
  /** Bedtime on the previous evening (local), default 23:00. */
  start?: string;
  /** Wake time on the wake date (local), default 07:00. */
  end?: string;
  /** Start on the wake date instead of the evening before. */
  startSameDay?: boolean;
  asleepMin?: number;
  awakeMin?: number;
  stages?: SleepStageInterval[];
  offsetS?: number;
  tier?: DeviceTier;
}

export function mkSleep(wakeDate: string, o: SleepOpts = {}): SleepRecord {
  const off = o.offsetS ?? 0;
  const start = at(o.startSameDay ? wakeDate : addDays(wakeDate, -1), o.start ?? '23:00', off);
  const end = at(wakeDate, o.end ?? '07:00', off);
  const spt = (Date.parse(end) - Date.parse(start)) / 60_000;
  const rec: SleepRecord = {
    kind: 'sleep',
    record_id: `sleep-${wakeDate}`,
    version: 1,
    time: { start, end, tz_offset_s: off, local_date: wakeDate },
    provenance: prov(o.tier ?? 'A'),
    quality: { validation: 'measured', confidence: null, flags: [] },
    is_main: true,
    asleep_s: (o.asleepMin ?? spt) * 60,
  };
  if (o.awakeMin !== undefined) rec.awake_s = o.awakeMin * 60;
  if (o.stages) rec.stages = o.stages;
  return rec;
}

export function mkDay(date: string, main?: SleepRecord, extra: Partial<ResolvedDay> = {}): ResolvedDay {
  return { localDate: date, sleeps: main ? [main] : [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [], ...(main ? { mainSleep: main } : {}), ...extra };
}

export function mkInput(localDate: string, p: Partial<ScoreInput> = {}): ScoreInput {
  return {
    localDate,
    tz: 'UTC',
    profile: {},
    days: [],
    series: {},
    workouts: [],
    prior: {},
    computedAt: `${addDays(localDate, 1)}T23:59:00.000Z`,
    build: 'test',
    ...p,
  };
}

export function series(stream: BioStream, pts: Array<[number, number]>, sourceKey = 'ring', tier: DeviceTier = 'A'): Partial<ScoreInput['series']> {
  return { [stream]: pts.map(([t, value]) => ({ t, value, tier, sourceKey })) };
}

export function mkPrior(scoreId: string, date: string, value: number | null, detail: ScoreResult['detail'] = {}, extra: Partial<ScoreResult> = {}): ScoreResult {
  return {
    scoreId,
    version: '1.0.0',
    scope: { kind: 'night', localDate: date },
    status: 'ok',
    value,
    confidence: 'medium',
    contributors: [],
    inputsHash: 'x',
    sourceIds: [`src-${date}`],
    computedAt: '2026-10-01T00:00:00.000Z',
    build: 'test',
    detail,
    ...extra,
  };
}

/** Deterministic PRNG (mulberry32) for synthetic noise. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dates = (from: string, n: number) => Array.from({ length: n }, (_, k) => addDays(from, k));
