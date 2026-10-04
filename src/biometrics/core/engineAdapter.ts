/**
 * Engine observation adapter (SUITE_SPEC §4.5). Tier P, pure. E5 maps these outputs into `LoggedDay`.
 * Everything is gated by the opt-in matrix: policy off (or stream not engine-eligible) → null / empty.
 * Vendor opinions never appear here. Score ids and states are those of R9 §4.3 (illness red|yellow|green,
 * hrv.status below|within|above, sleep.debt value or detail.dF in hours).
 */
import { engineOn, type PolicyMatrix } from './policy';
import { FIELD_TEST_SD, LAB_REL_SD, LAB_SD_FLOOR } from './scores/vo2max';
import type { LocalDate, ResolvedDay, ScoreResult, SleepRecord, WorkoutRecord } from './types';

export type Provenance = 'measured' | 'estimated' | 'assumed';

// ---------------------------------------------------------------- sleep

export interface SleepEngineInput {
  localDate: LocalDate;
  /** Hours of the local day 0..24 (the engine's convention: DayInput.sleepBedH). */
  sleepBedH: number;
  sleepWakeH: number;
  sleepHours: number;
  /** 0..1 convenience mapping (PROPOSED). */
  sleepQuality: number;
  /** The engine's own 0 poor / 1 fair / 2 good class (DayInput.sleepQuality). PROPOSED thresholds. */
  sleepQualityClass: 0 | 1 | 2;
  source: { recordId: string; version: number; sourceKey: string | null };
  assumedVsMeasured: { sleepBedH: Provenance; sleepWakeH: Provenance; sleepHours: Provenance; sleepQuality: Provenance };
}

/** Quality mapping (PROPOSED): sleep.index (0..100) / 100; else efficiency ramp 70 % → 0, 95 % → 1; else null (no quality claim). */
export const QUALITY_CLASS_THRESHOLDS = { fair: 0.6, good: 0.75 } as const;
export const EFFICIENCY_RAMP = { lo: 70, hi: 95 } as const;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function sleepQualityOf(sleep: SleepRecord, results: readonly ScoreResult[]): { q: number; provenance: Provenance } | null {
  const idx = results.find((r) => r.scoreId === 'sleep.index' && r.status === 'ok' && r.value !== null && r.scope.localDate === sleep.time.local_date)
    ?? results.find((r) => r.scoreId === 'sleep.index' && r.status === 'ok' && r.value !== null);
  if (idx) return { q: clamp01(idx.value! / 100), provenance: 'estimated' };
  if (sleep.efficiency_pct !== undefined) return { q: clamp01((sleep.efficiency_pct - EFFICIENCY_RAMP.lo) / (EFFICIENCY_RAMP.hi - EFFICIENCY_RAMP.lo)), provenance: 'estimated' };
  return null;
}

/** Local hour of day 0..24 for an instant given the record's UTC offset. */
export function localHour(iso: string, tzOffsetS: number): number {
  const ms = Date.parse(iso) + tzOffsetS * 1000;
  return (((ms % 86_400_000) + 86_400_000) % 86_400_000) / 3_600_000;
}

export function toSleepInputs(day: ResolvedDay, results: readonly ScoreResult[], policy: PolicyMatrix, assumedQuality = 0.5): SleepEngineInput | null {
  if (!engineOn(policy, 'sleep_sessions')) return null;
  const s = day.mainSleep;
  if (!s || !s.time.start || !s.time.end || !(s.asleep_s > 0)) return null;
  const tz = s.time.tz_offset_s;
  const q = sleepQualityOf(s, results);
  const quality = q?.q ?? assumedQuality;
  return {
    localDate: day.localDate,
    sleepBedH: localHour(s.time.start, tz),
    sleepWakeH: localHour(s.time.end, tz),
    sleepHours: s.asleep_s / 3600,
    sleepQuality: quality,
    sleepQualityClass: quality >= QUALITY_CLASS_THRESHOLDS.good ? 2 : quality >= QUALITY_CLASS_THRESHOLDS.fair ? 1 : 0,
    source: { recordId: s.record_id, version: s.version, sourceKey: day.sourceByMetric['sleep'] ?? day.sourceByMetric['sleep_sessions'] ?? null },
    assumedVsMeasured: { sleepBedH: 'measured', sleepWakeH: 'measured', sleepHours: 'measured', sleepQuality: q?.provenance ?? 'assumed' },
  };
}

// ---------------------------------------------------------------- activity

export interface WorkoutEngineInput {
  recordId: string;
  version: number;
  /** ISO instant, null when the source has no start. */
  start: string | null;
  startH: number | null;
  durationMin: number;
  exerciseType: string;
  load: { value: number; method: 'trimp' | 'srpe' | 'vendor' } | null;
}

export interface ActivityEngineInput {
  localDate: LocalDate;
  /** Present only when the steps stream has engine on. */
  steps: number | null;
  /** Empty unless the workouts stream has engine on. */
  workouts: WorkoutEngineInput[];
  assumedVsMeasured: { steps: Provenance; workouts: Provenance };
}

function loadOf(w: WorkoutRecord, results: readonly ScoreResult[]): WorkoutEngineInput['load'] {
  const fromScore = (id: string, method: 'trimp' | 'srpe') => {
    const r = results.find((x) => x.scoreId === id && x.status === 'ok');
    const c = r?.contributors.find((k) => k.id === w.record_id && k.available && k.raw !== undefined);
    return c ? { value: c.raw!, method } : null;
  };
  // Own scores first (TRIMP, then sRPE); a stored vendor-method load is only used when it is not 'vendor'.
  const own = fromScore('load.trimp', 'trimp') ?? fromScore('load.srpe', 'srpe');
  if (own) return own;
  if (w.load && w.load.method !== 'vendor') return { value: w.load.value, method: w.load.method };
  return null;
}

export function toActivityInputs(day: ResolvedDay, policy: PolicyMatrix, results: readonly ScoreResult[] = []): ActivityEngineInput | null {
  const stepsOn = engineOn(policy, 'steps');
  const workoutsOn = engineOn(policy, 'workouts');
  if (!stepsOn && !workoutsOn) return null;
  const steps = stepsOn && day.daily?.steps !== undefined ? day.daily.steps : null;
  const workouts: WorkoutEngineInput[] = workoutsOn
    ? day.workouts.map((w) => ({
        recordId: w.record_id,
        version: w.version,
        start: w.time.start ?? null,
        startH: w.time.start ? localHour(w.time.start, w.time.tz_offset_s) : null,
        durationMin: w.active_duration_s / 60,
        exerciseType: w.exercise_type,
        load: loadOf(w, results),
      }))
    : [];
  return { localDate: day.localDate, steps, workouts, assumedVsMeasured: { steps: steps === null ? 'assumed' : 'measured', workouts: workoutsOn ? 'measured' : 'assumed' } };
}

// ---------------------------------------------------------------- VO2max

export interface Vo2Observation {
  kind: 'vo2max';
  valueMlKgMin: number;
  sdMlKgMin: number;
  method: 'posterior' | 'lab' | 'field_test';
  localDate: LocalDate;
}

/** Observation of the dossier-10 VO2max state from the fitness.vo2max posterior. Vendor estimates never reach here. */
export function toVo2Observation(result: ScoreResult, policy: PolicyMatrix): Vo2Observation | null {
  if (!engineOn(policy, 'daily_summary')) return null;
  if (result.scoreId !== 'fitness.vo2max' || result.status !== 'ok' || result.value === null) return null;
  const sd = result.detail?.['posteriorSd'];
  if (typeof sd !== 'number' || !(sd > 0)) return null;
  return { kind: 'vo2max', valueMlKgMin: result.value, sdMlKgMin: sd, method: 'posterior', localDate: result.scope.localDate };
}

/** Entered lab / field tests on the daily record (vendor_estimate and derived are ignored). */
export function toVo2TestObservation(day: ResolvedDay, policy: PolicyMatrix): Vo2Observation | null {
  if (!engineOn(policy, 'daily_summary')) return null;
  const v = day.daily?.vo2max;
  if (!v || (v.method !== 'lab' && v.method !== 'field_test')) return null;
  const sd = v.method === 'lab' ? Math.max(LAB_SD_FLOOR, LAB_REL_SD * v.ml_kg_min) : FIELD_TEST_SD;
  return { kind: 'vo2max', valueMlKgMin: v.ml_kg_min, sdMlKgMin: sd, method: v.method, localDate: day.localDate };
}

// ---------------------------------------------------------------- display and briefing

export type FlagLevel = 'none' | 'info' | 'watch' | 'alert';

export interface DisplayItem {
  scoreId: string;
  version: string;
  localDate: LocalDate;
  status: ScoreResult['status'];
  value: number | null;
  state: string | null;
  flag: FlagLevel;
  /** 'trainer_briefing' items are offered to the Coach when its policy allows; everything else is display only. */
  target: 'display_only' | 'trainer_briefing';
}

const BRIEFING_PREFIXES = ['illness.', 'hrv.status', 'hrv.strain', 'sleep.debt', 'load.ewma', 'overreaching.'];

function flagLevel(r: ScoreResult): FlagLevel {
  const s = r.state;
  if (r.scoreId.startsWith('illness.')) return s === 'red' ? 'alert' : s === 'yellow' || s === 'amber' ? 'watch' : 'none';
  if (r.scoreId === 'hrv.status') return s === 'below' ? 'watch' : 'none';
  if (r.scoreId.startsWith('overreaching.')) return s === 'red' || s === 'flagged' ? 'watch' : 'none';
  if (r.scoreId === 'spo2.night') return s === 'low' || s === 'flag' ? 'watch' : 'none';
  return 'none';
}

/** Everything that is not an engine input: shown, trended, or briefed, with its flag state. */
export function toDisplayOnly(results: readonly ScoreResult[]): DisplayItem[] {
  return results.map((r) => ({
    scoreId: r.scoreId,
    version: r.version,
    localDate: r.scope.localDate,
    status: r.status,
    value: r.value,
    state: r.state ?? null,
    flag: flagLevel(r),
    target: BRIEFING_PREFIXES.some((p) => r.scoreId.startsWith(p)) ? 'trainer_briefing' : 'display_only',
  }));
}

// ---------------------------------------------------------------- plan effect proposals

export type ProposalTarget = 'training_intensity' | 'training_volume' | 'fast_permission' | 'replan_trigger';

export interface PlanEffectProposal {
  scoreId: string;
  version: string;
  target: ProposalTarget;
  action: string;
  /** Conflict rank: illness red 4 > HRV below 3 > sleep debt 2 > load 1. */
  rank: 1 | 2 | 3 | 4;
  /** False when a more protective effect on the same target wins (still reported to the trainer). */
  active: boolean;
  suppressedBy?: string;
  /** Proposals only ever lower load; auto-apply additionally needs the user's autoApplyLoadLowering setting. */
  lowersLoad: boolean;
}

export interface ActiveFlag { scoreId: string; state: string; text: string }

const SLEEP_DEBT_FAST_H = 1.5;

/** Applies R9 §4.3 plan behaviour and the conflict rule: illness red > HRV below > sleep debt > load, per target. */
export function planEffectProposals(results: readonly ScoreResult[]): { proposals: PlanEffectProposal[]; activeFlags: ActiveFlag[] } {
  const raw: Array<Omit<PlanEffectProposal, 'active'>> = [];
  const flags: ActiveFlag[] = [];
  const latest = (id: string) => [...results].filter((r) => r.scoreId === id && r.status !== 'withheld' && r.status !== 'insufficient_baseline').sort((a, b) => (a.scope.localDate < b.scope.localDate ? -1 : 1)).at(-1);
  const add = (r: ScoreResult, target: ProposalTarget, action: string, rank: 1 | 2 | 3 | 4, lowersLoad = true) => raw.push({ scoreId: r.scoreId, version: r.version, target, action, rank, lowersLoad });

  const ill = latest('illness.nightsignal') ?? latest('illness.composite');
  if (ill?.state === 'red') {
    flags.push({ scoreId: ill.scoreId, state: 'red', text: 'Illness signal red' });
    add(ill, 'training_intensity', 'all training easy or rest', 4);
    add(ill, 'fast_permission', 'pause or abort planned fasts', 4);
    add(ill, 'replan_trigger', 'replan; ask about confounders', 4);
  } else if (ill?.state === 'yellow' || ill?.state === 'amber') {
    flags.push({ scoreId: ill.scoreId, state: ill.state, text: 'Illness signal yellow' });
  }
  const hrv = latest('hrv.status');
  if (hrv?.state === 'below') {
    flags.push({ scoreId: hrv.scoreId, state: 'below', text: 'HRV below normal range' });
    add(hrv, 'training_intensity', 'next session low or rest', 3);
    add(hrv, 'fast_permission', 'no fast longer than 24 h', 3);
  }
  const debt = latest('sleep.debt');
  const dF = debt ? (typeof debt.detail?.['dF'] === 'number' ? (debt.detail['dF'] as number) : debt.value) : null;
  if (debt && dF !== null && dF > SLEEP_DEBT_FAST_H) {
    flags.push({ scoreId: debt.scoreId, state: 'debt', text: `Fast sleep debt ${dF.toFixed(1)} h` });
    add(debt, 'fast_permission', 'no fast starts longer than 24 h', 2);
    add(debt, 'training_intensity', 'intensity down one level', 2);
  }
  const ewma = latest('load.ewma');
  if (ewma?.status === 'ok') add(ewma, 'training_volume', 'PROPOSED: volume progression at most chronic load + 10 %/wk (ACWR is context only)', 1);

  const best = new Map<ProposalTarget, number>();
  for (const p of raw) best.set(p.target, Math.max(best.get(p.target) ?? 0, p.rank));
  const winner = new Map<ProposalTarget, string>();
  for (const p of raw) if (p.rank === best.get(p.target)) winner.set(p.target, p.scoreId);
  const proposals = raw
    .map((p): PlanEffectProposal => (p.rank === best.get(p.target) ? { ...p, active: true } : { ...p, active: false, suppressedBy: winner.get(p.target)! }))
    .sort((a, b) => b.rank - a.rank);
  return { proposals, activeFlags: flags };
}
