/**
 * Maps a Vitals `ScoreInput` onto the Android app's data shapes (Room entities and DAO reads, R10 §2.1), so the
 * ported functions run on exactly what the Kotlin code would have read. Tier P.
 */
import type { LocalDate, ScoreInput, SleepRecord, SleepStageName } from '../../types';
import { localParts, roundToInt, startOfDayMs, plusDays, type MeasurementKind, type VitalSample } from './kotlin';

/** `SleepStage` enum names as persisted in `sleep_stage_blocks.stageRaw`. */
export type AndroidStage = 'DEEP' | 'LIGHT' | 'REM' | 'AWAKE' | 'UNKNOWN';

/** `SleepSessionEntity` (fields the scores read). `date` is the waking day (the 19:00 rule, R10 §3.1). */
export interface AndroidSleepSession {
  id: string;
  date: LocalDate;
  /** epoch ms */
  startAt: number;
  /** epoch ms */
  endAt: number;
  /** Σ non-AWAKE block minutes (UNKNOWN counts as asleep, R10 §3.1). */
  totalMinutes: number;
}

/** `SleepStageBlockEntity`. */
export interface AndroidStageBlock {
  /** epoch ms */
  startAt: number;
  durationMinutes: number;
  stageRaw: AndroidStage | string;
}

/** `ActivityDailyEntity` (real rows only). */
export interface AndroidActivityDay {
  date: LocalDate;
  /** local midnight, epoch ms */
  dateMs: number;
  /** min; vendor exercise minutes on the 2301 */
  activeMinutes: number;
}

/** Everything `SleepScoreRepository.forWakingDay` and `LocalInsightEngine.compute` (recovery part) read. */
export interface AndroidWorld {
  /** IANA zone (`ZoneId.systemDefault()`). */
  tz: string;
  /** The engine's `nowMs` (epoch ms). */
  nowMs: number;
  /** Real sessions, any waking day, ascending by `startAt`. */
  sessions: AndroidSleepSession[];
  blocksBySession: Record<string, AndroidStageBlock[]>;
  /** `measurements` rows by kind, ascending by timestamp (unfiltered; policy bounds are applied by the readers). */
  measurements: Record<MeasurementKind, VitalSample[]>;
  activity: AndroidActivityDay[];
  /** `user_goals.sleepMinutes` (null → 480). */
  sleepGoalMinutes: number | null;
  /** `user_profile.hrRestingBaseline`, bpm. */
  hrRestingBaseline: number | null;
  /** Prior-day `lumen-nutrition-v1` score (Int 0–100), from the planner. */
  priorDayNutritionScore: number | null;
}

/** Vitals has no nutrition score in E10; the planner (E5) supplies one as a ScoreResult under this id, scoped to the
 * day the food was eaten. Absent → the nutrition contributor is unavailable (as Android with no logged meals). */
export const NUTRITION_PRIOR_SCORE_ID = 'nutrition.day';

const STAGE_MAP: Record<SleepStageName, AndroidStage> = {
  deep: 'DEEP',
  light: 'LIGHT',
  rem: 'REM',
  awake: 'AWAKE',
  awake_in_bed: 'AWAKE',
  out_of_bed: 'AWAKE',
  asleep_unspecified: 'UNKNOWN',
  unknown: 'UNKNOWN',
};

/** Stage intervals → minute blocks (the 2301 stores 1-min epochs, so durations are whole minutes). */
export function blocksOf(s: SleepRecord): AndroidStageBlock[] {
  return (s.stages ?? [])
    .map((iv) => {
      const startAt = Date.parse(iv.start);
      return { startAt, durationMinutes: roundToInt((Date.parse(iv.end) - startAt) / 60_000), stageRaw: STAGE_MAP[iv.stage] };
    })
    .sort((a, b) => a.startAt - b.startAt);
}

/** Android `totalMinutes` = Σ non-AWAKE minutes; without stages, the record's asleep seconds. */
export function totalMinutesOf(s: SleepRecord, blocks: readonly AndroidStageBlock[]): number {
  const positive = blocks.filter((b) => b.durationMinutes > 0);
  if (positive.length) return positive.filter((b) => b.stageRaw !== 'AWAKE').reduce((a, b) => a + b.durationMinutes, 0);
  return roundToInt(s.asleep_s / 60);
}

/** Active minutes of a Vitals daily summary (light + moderate + vigorous, rounded). The Android value is the ring's
 * own exercise-seconds ÷ 60; importers of the 2301 should put that into `active_min.moderate`. */
export function activeMinutesOf(a: { light: number; moderate: number; vigorous: number }): number {
  return roundToInt(a.light + a.moderate + a.vigorous);
}

export interface AdapterOptions {
  /** Engine clock; default min(computedAt, end of the scored local day), so history rescoring is stable. */
  nowMs?: number;
}

/** Builds the Kotlin-shaped world from a ScoreInput. Sleeps belong to the waking day of the ResolvedDay holding them. */
export function androidInputsFromScoreInput(input: ScoreInput, opts: AdapterOptions = {}): AndroidWorld {
  const tz = input.tz;
  const endOfDay = startOfDayMs(plusDays(input.localDate, 1), tz) - 1;
  const computed = Date.parse(input.computedAt);
  const nowMs = opts.nowMs ?? (Number.isFinite(computed) && computed < endOfDay ? computed : endOfDay);

  const sessions: AndroidSleepSession[] = [];
  const blocksBySession: Record<string, AndroidStageBlock[]> = {};
  const seen = new Set<string>();
  for (const d of input.days) {
    const recs = d.mainSleep ? [d.mainSleep, ...d.sleeps] : d.sleeps;
    for (const s of recs) {
      if (seen.has(s.record_id) || !s.time.start || !s.time.end) continue;
      seen.add(s.record_id);
      const blocks = blocksOf(s);
      blocksBySession[s.record_id] = blocks;
      sessions.push({ id: s.record_id, date: d.localDate, startAt: Date.parse(s.time.start), endAt: Date.parse(s.time.end), totalMinutes: totalMinutesOf(s, blocks) });
    }
  }
  sessions.sort((a, b) => a.startAt - b.startAt);

  const series = (k: 'hr' | 'hrv' | 'skin_temp'): VitalSample[] =>
    (input.series[k] ?? []).map((s) => ({ t: s.t, value: s.value })).sort((a, b) => a.t - b.t);

  const activity: AndroidActivityDay[] = [];
  for (const d of input.days) {
    const am = d.daily?.active_min;
    if (am) activity.push({ date: d.localDate, dateMs: startOfDayMs(d.localDate, tz), activeMinutes: activeMinutesOf(am) });
  }

  const priorDay = plusDays(localParts(nowMs, tz).date, -1);
  const nut = (input.prior[NUTRITION_PRIOR_SCORE_ID] ?? []).find((r) => r.scope.localDate === priorDay && r.status === 'ok' && r.value !== null);

  const need = input.profile.sleepNeedH;
  return {
    tz,
    nowMs,
    sessions,
    blocksBySession,
    measurements: { HEART_RATE: series('hr'), HRV: series('hrv'), TEMPERATURE: series('skin_temp'), SPO2: [] },
    activity,
    sleepGoalMinutes: need !== undefined && Number.isFinite(need) ? roundToInt(need * 60) : null,
    hrRestingBaseline: input.profile.restingHrBpm ?? null,
    priorDayNutritionScore: nut?.value ?? null,
  };
}
