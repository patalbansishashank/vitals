/**
 * Measured observations entering the living plan (docs/SUITE_SPEC.md §4.5): sleep, steps, workouts, weight and body fat,
 * VO2max, resting HR/HRV flags, from E10's biometrics adapter. The adapter applies the person's stream policy (only streams
 * with `engine: true` arrive here) and the one-source-per-metric-per-day choice; this module defines the interface the
 * living plan consumes, a fake for tests and for use until wp/E10 merges, the mapping from canonical `vitals.biometrics/1`
 * records (§4.1, structural subset), workout matching, and the "plan assumed X, you measured Y" diffs. Pure.
 *
 * Precedence inside a replayed day (§3.4): steps device > manual > prescribed-if-as-planned > habitual; sleep device >
 * manual > prescribed (the night ending on D is D's sleep); device workouts mark prescribed sessions done/partial.
 */
import { instantToLocal } from './dates';
import type { ClockH, LocalDate, PrescribedDaySnapshot, PrescribedSession, SleepQuality } from './types';

export interface ObservedWorkout {
  recordId: string;
  startH: ClockH;
  durationMin: number;
  exerciseType: string;
  kind: 'resistance' | 'cardio' | 'other';
  activeKcal?: number;
  avgHrBpm?: number;
  load?: { value: number; method: 'trimp' | 'srpe' | 'vendor' };
  rpe010?: number;
  source: string;
}

export interface DayObservations {
  date: LocalDate;
  steps?: { value: number; source: string; recordId?: string };
  sleep?: { bedH: ClockH; wakeH: ClockH; hours: number; efficiencyPct?: number; quality?: SleepQuality; source: string; recordId?: string };
  workouts?: ObservedWorkout[];
  weights?: Array<{ kg: number; clockH?: ClockH; context?: 'fasting' | 'morning' | 'post_workout'; source: string; recordId?: string }>;
  bodyFat?: Array<{ pct: number; method: 'bia' | 'dxa' | 'other'; source: string }>;
  /** Lab/field tests or Vitals' own `fitness.vo2max` posterior (vendor estimates never arrive here). */
  vo2max?: { mlKgMin: number; sd: number; method: 'lab' | 'field_test' | 'derived'; source: string };
  restingHr?: { bpm: number; vsBaseline?: number; source: string };
  hrv?: { state: 'below' | 'normal' | 'above'; metric: 'rmssd' | 'sdnn' };
  flags?: Array<{ id: string; level: 'yellow' | 'amber' | 'red'; text: string }>;
}

/** What E10's engine observation adapter implements (wired by E4; a fake until then). */
export interface ObservationAdapter {
  /** Observations of local dates in [from, to], one entry per date that has any. */
  observations(from: LocalDate, to: LocalDate): DayObservations[];
}

/** In-memory adapter (tests, and the default until wp/E10 merges). */
export function createFakeObservationAdapter(days: readonly DayObservations[] = []): ObservationAdapter & { add(d: DayObservations): void } {
  const store = new Map<LocalDate, DayObservations>();
  for (const d of days) store.set(d.date, d);
  return {
    observations(from, to) {
      return [...store.values()].filter((d) => d.date >= from && d.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    add(d) {
      store.set(d.date, { ...store.get(d.date), ...d });
    },
  };
}

// ------------------------------------------------------------------------------------------- canonical record mapping
/** Structural subset of `vitals.biometrics/1` records (§4.1) the living plan reads. */
export interface BioRecordLike {
  kind: 'daily' | 'sleep' | 'workout' | 'series' | 'spot' | 'device_profile';
  record_id: string;
  time: { start?: string; end?: string; at?: string; tz_offset_s: number; local_date: string };
  provenance: { channel: string; source_app?: string; device?: { type: string; tier: 'A' | 'B' | 'C' } };
  quality?: { validation: string; flags?: string[] };
  steps?: number;
  vo2max?: { ml_kg_min: number; method: 'lab' | 'field_test' | 'vendor_estimate' | 'derived' };
  resting_hr_bpm?: number;
  is_main?: boolean;
  asleep_s?: number;
  in_bed_s?: number;
  efficiency_pct?: number;
  exercise_type?: string;
  active_duration_s?: number;
  active_kcal?: number;
  hr_avg_bpm?: number;
  rpe_0_10?: number;
  load?: { value: number; method: 'trimp' | 'srpe' | 'vendor' };
  metric?: string;
  value?: number;
  context?: 'fasting' | 'morning' | 'post_workout';
}

const RESISTANCE_TYPES = /strength|weight|resistance|functional|core|crossfit|calisthenics|kettlebell|pilates/i;
const CARDIO_TYPES = /run|walk|cycl|bik|swim|row|elliptical|hiit|stair|hike|cardio|dance|ski|jog|spin/i;

/** Resistance, cardio or other, from a device workout's exercise type. */
export function workoutKindOf(exerciseType: string): ObservedWorkout['kind'] {
  return RESISTANCE_TYPES.test(exerciseType) ? 'resistance' : CARDIO_TYPES.test(exerciseType) ? 'cardio' : 'other';
}

function sourceOf(r: BioRecordLike): string {
  return r.provenance.source_app ?? r.provenance.channel;
}

/** VO2max SD by method (lab ≈ 3 %, field test ≈ 7 %, Vitals' posterior: its own band — 5 % here when absent). */
const VO2_SD_FRAC: Record<'lab' | 'field_test' | 'derived', number> = { lab: 0.03, field_test: 0.07, derived: 0.05 };

/** Group canonical records into per-day observations (records already filtered by the person's engine policy). */
export function observationsFromBioRecords(records: readonly BioRecordLike[], tz: string): DayObservations[] {
  const by = new Map<LocalDate, DayObservations>();
  const day = (d: LocalDate): DayObservations => {
    let o = by.get(d);
    if (!o) {
      o = { date: d };
      by.set(d, o);
    }
    return o;
  };
  for (const r of records) {
    const d = r.time.local_date;
    if (r.kind === 'daily') {
      if (r.steps !== undefined) day(d).steps = { value: r.steps, source: sourceOf(r), recordId: r.record_id };
      if (r.vo2max && r.vo2max.method !== 'vendor_estimate') {
        const m = r.vo2max.method;
        day(d).vo2max = { mlKgMin: r.vo2max.ml_kg_min, sd: r.vo2max.ml_kg_min * VO2_SD_FRAC[m], method: m, source: sourceOf(r) };
      }
      if (r.resting_hr_bpm !== undefined) day(d).restingHr = { bpm: r.resting_hr_bpm, source: sourceOf(r) };
    } else if (r.kind === 'sleep' && r.is_main !== false && r.time.start && r.time.end && r.asleep_s !== undefined) {
      const bed = instantToLocal(r.time.start, tz);
      const wake = instantToLocal(r.time.end, tz);
      day(d).sleep = {
        bedH: bed.clockH,
        wakeH: wake.clockH,
        hours: r.asleep_s / 3600,
        ...(r.efficiency_pct !== undefined ? { efficiencyPct: r.efficiency_pct } : {}),
        source: sourceOf(r),
        recordId: r.record_id,
      };
    } else if (r.kind === 'workout' && r.time.start && r.active_duration_s !== undefined) {
      const t = r.exercise_type ?? 'other';
      const w: ObservedWorkout = {
        recordId: r.record_id,
        startH: instantToLocal(r.time.start, tz).clockH,
        durationMin: r.active_duration_s / 60,
        exerciseType: t,
        kind: workoutKindOf(t),
        ...(r.active_kcal !== undefined ? { activeKcal: r.active_kcal } : {}),
        ...(r.hr_avg_bpm !== undefined ? { avgHrBpm: r.hr_avg_bpm } : {}),
        ...(r.load ? { load: r.load } : {}),
        ...(r.rpe_0_10 !== undefined ? { rpe010: r.rpe_0_10 } : {}),
        source: sourceOf(r),
      };
      (day(d).workouts ??= []).push(w);
    } else if (r.kind === 'spot' && r.value !== undefined) {
      const at = r.time.at ? instantToLocal(r.time.at, tz).clockH : undefined;
      if (r.metric === 'weight_kg') (day(d).weights ??= []).push({ kg: r.value, ...(at !== undefined ? { clockH: at } : {}), ...(r.context ? { context: r.context } : {}), source: sourceOf(r), recordId: r.record_id });
      else if (r.metric === 'body_fat_pct') (day(d).bodyFat ??= []).push({ pct: r.value, method: r.provenance.device?.type === 'scale' ? 'bia' : 'other', source: sourceOf(r) });
    }
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ------------------------------------------------------------------------------------------- workout matching
export interface WorkoutMatch {
  slotKey: string;
  recordId: string;
  status: 'done' | 'partial';
  /** Observed / prescribed duration, capped at 1 (the credit's fast form for an unresolved device workout). */
  ratio: number;
}

/**
 * Match device workouts to prescribed sessions of the same day by type and duration (§4.5): kind must agree (resistance
 * vs cardio; 'other' matches either at a lower score), duration ratio ≥ 0.8 → done, ≥ 0.3 → partial, below → no match;
 * start-time proximity breaks ties. Greedy on the best score, each workout used once.
 */
export function matchWorkouts(prescribed: readonly PrescribedSession[], workouts: readonly ObservedWorkout[]): WorkoutMatch[] {
  const cands: Array<{ s: number; slot: string; rec: string; ratio: number }> = [];
  for (const p of prescribed) {
    for (const w of workouts) {
      const kindOk = w.kind === p.kind || w.kind === 'other';
      if (!kindOk) continue;
      const ratio = p.durationMin > 0 ? w.durationMin / p.durationMin : 1;
      if (ratio < 0.3) continue;
      const s = (w.kind === p.kind ? 2 : 1) + Math.min(1, ratio) - Math.min(1, Math.abs(w.startH - p.startH) / 12);
      cands.push({ s, slot: p.slotKey, rec: w.recordId, ratio });
    }
  }
  cands.sort((a, b) => b.s - a.s || (a.slot < b.slot ? -1 : 1));
  const usedS = new Set<string>();
  const usedW = new Set<string>();
  const out: WorkoutMatch[] = [];
  for (const c of cands) {
    if (usedS.has(c.slot) || usedW.has(c.rec)) continue;
    usedS.add(c.slot);
    usedW.add(c.rec);
    out.push({ slotKey: c.slot, recordId: c.rec, status: c.ratio >= 0.8 ? 'done' : 'partial', ratio: Math.min(1, c.ratio) });
  }
  return out;
}

/** "Plan assumed X, you measured Y" (§4.5) for the metrics that replace an assumption on this day. */
export function assumptionDiffs(rx: PrescribedDaySnapshot | null, obs: DayObservations | null): Array<{ metric: 'steps' | 'sleepHours'; assumed: number; measured: number; source: string }> {
  if (!rx || !obs) return [];
  const out: Array<{ metric: 'steps' | 'sleepHours'; assumed: number; measured: number; source: string }> = [];
  if (obs.steps && rx.steps !== undefined) out.push({ metric: 'steps', assumed: rx.steps, measured: obs.steps.value, source: obs.steps.source });
  if (obs.sleep && rx.sleep) out.push({ metric: 'sleepHours', assumed: (rx.sleep.wakeH - rx.sleep.bedH + 24) % 24, measured: obs.sleep.hours, source: obs.sleep.source });
  return out;
}
