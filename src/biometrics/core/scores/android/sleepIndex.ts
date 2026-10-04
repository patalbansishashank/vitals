/**
 * `sleep.index` = exact port of the Android daily sleep index `lumen-sleep-v4` (R10 §3.3; R9 §2.3 "Sleep index";
 * SUITE_SPEC §4.4). Owner's code: `service/SleepScoreRepository.kt` (`DailySleepScoreAlgorithm`, `forWakingDay`) and the
 * stage-coverage gates of `SleepScore` (`service/SleepInsights.kt`, owner's formulas per R10 §1). Tier P.
 * Parity target: integer-exact (R10 §6).
 */
import type { ScoreContributor, ScoreDef, ScoreInput, ScoreResult } from '../../types';
import { makeResult, withheld } from '../util';
import { androidInputsFromScoreInput, type AndroidSleepSession, type AndroidStageBlock, type AndroidWorld } from './adapter';
import { coerceIn, groupValues, indexP10, localParts, maxByOrNull, plusDays, roundToInt, sortedNums, sumOf } from './kotlin';

export const SLEEP_INDEX_ID = 'sleep.index';
/** Mirrors the Android `lumen-sleep-v4`. */
export const SLEEP_INDEX_VERSION = '4.0.0';
export const ANDROID_SLEEP_VERSION = 'lumen-sleep-v4';

/** Engineering weights and maps of `DailySleepScoreAlgorithm` (self-declared product heuristics, R10 §3.3). */
export const DURATION_WEIGHT = 0.5;
export const CONTINUITY_WEIGHT = 0.25;
export const TIMING_WEIGHT = 0.25;
export const MIN_PRIOR_NIGHTS = 7;
export const BASELINE_DAYS = 28;
export const DEFAULT_TARGET_MIN = 480;

const SLEEP_STAGES = new Set(['DEEP', 'LIGHT', 'REM']);
const NAMED_STAGES = new Set(['DEEP', 'LIGHT', 'REM', 'AWAKE']);

/** `SleepScoreContext`. */
export interface SleepScoreContext {
  priorPrimarySessions: AndroidSleepSession[];
  priorBlocksBySession: Record<string, AndroidStageBlock[]>;
  targetMinutes: number;
  nightlyHrvMs: number | null;
  sleepingHeartRateDropBpm: number | null;
  tz: string;
}

export type ContributorRole = 'SCORED' | 'CONTEXT' | 'UNAVAILABLE';

/** `ScoreContributor` (service/ScoreContributor.kt). `weight` is the applied (renormalised) weight. */
export interface AndroidContributor {
  id: string;
  label: string;
  value: number | null;
  unit: string | null;
  score: number | null;
  weight: number;
  configuredWeight: number;
  role: ContributorRole;
}

export type SleepQualityLabel = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'NEEDS_WORK';

/** `DailySleepScore`. */
export interface DailySleepScore {
  score: number;
  label: SleepQualityLabel;
  contributors: AndroidContributor[];
  confidence: 'medium' | 'low';
  algorithmVersion: string;
  primarySessionId: string;
  totalSleepMinutes: number;
  awakeAfterOnsetMinutes: number | null;
  sleepEfficiencyPercent: number | null;
  timingDeviationMinutes: number | null;
}

/** `SleepScore.qualityLabel`. */
export function qualityLabel(score: number): SleepQualityLabel {
  return score >= 85 ? 'EXCELLENT' : score >= 70 ? 'GOOD' : score >= 55 ? 'FAIR' : 'NEEDS_WORK';
}

/** `SleepScore.hasUsableStageData`: ≥ 95 % of positive block minutes carry a named stage (incl. AWAKE). */
export function hasUsableStageData(blocks: readonly AndroidStageBlock[]): boolean {
  const positive = blocks.filter((b) => b.durationMinutes > 0);
  if (!positive.length) return false;
  const total = sumOf(positive, (b) => b.durationMinutes);
  const named = sumOf(positive.filter((b) => NAMED_STAGES.has(b.stageRaw)), (b) => b.durationMinutes);
  return named * 100 >= total * 95;
}

function hasAnyNamedStageData(blocks: readonly AndroidStageBlock[]): boolean {
  return blocks.some((b) => b.durationMinutes > 0 && NAMED_STAGES.has(b.stageRaw));
}

interface Continuity { awakeMinutes: number; efficiency: number; score: number }

function continuity(blocks: readonly AndroidStageBlock[]): Continuity | null {
  if (!hasUsableStageData(blocks)) return null;
  const positive = blocks.filter((b) => b.durationMinutes > 0).sort((a, b) => a.startAt - b.startAt);
  const firstBlock = positive.find((b) => SLEEP_STAGES.has(b.stageRaw));
  if (!firstBlock) return null;
  const firstSleep = firstBlock.startAt;
  let lastBlock: AndroidStageBlock | undefined;
  for (const b of positive) if (SLEEP_STAGES.has(b.stageRaw)) lastBlock = b;
  if (!lastBlock) return null;
  const lastSleepEnd = lastBlock.startAt + lastBlock.durationMinutes * 60_000;
  if (lastSleepEnd <= firstSleep) return null;
  const spanMinutes = Math.trunc((lastSleepEnd - firstSleep) / 60_000);
  if (spanMinutes <= 0) return null;
  const states: Array<string | null> = new Array<string | null>(spanMinutes).fill(null);
  for (const block of positive) {
    for (let minute = 0; minute < block.durationMinutes; minute++) {
      const at = block.startAt + minute * 60_000;
      if (at < firstSleep || at >= lastSleepEnd) continue;
      const index = Math.trunc((at - firstSleep) / 60_000);
      if (index < 0 || index >= spanMinutes) continue;
      const existing = states[index];
      if (existing !== null && existing !== undefined && existing !== block.stageRaw) return null;
      states[index] = block.stageRaw;
    }
  }
  let namedCoverage = 0;
  let awake = 0;
  let asleep = 0;
  for (const s of states) {
    if (s === 'AWAKE') {
      awake++;
      namedCoverage++;
    } else if (s !== null && SLEEP_STAGES.has(s)) {
      asleep++;
      namedCoverage++;
    }
  }
  if (namedCoverage * 100 < spanMinutes * 95) return null;
  const denominator = asleep + awake;
  if (denominator <= 0) return null;
  const efficiency = (100 * asleep) / denominator;
  // Kotlin: (100.0 * (efficiency - 70.0) / 15.0).coerceIn(0.0, 100.0); the 70–85 % map is a product heuristic.
  const component = coerceIn((100 * (efficiency - 70)) / 15, 0, 100);
  return { awakeMinutes: awake, efficiency, score: component };
}

function namedSleepBounds(blocks: readonly AndroidStageBlock[]): [number, number] | null {
  const named = blocks.filter((b) => b.durationMinutes > 0 && SLEEP_STAGES.has(b.stageRaw));
  if (!named.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of named) {
    if (b.startAt < lo) lo = b.startAt;
    const end = b.startAt + b.durationMinutes * 60_000;
    if (end > hi) hi = end;
  }
  return [lo, hi];
}

/** Local minute-of-day of the bounds' midpoint (Long halving; seconds as whole seconds / 60). */
export function midpointMinute(bounds: [number, number], tz: string): number {
  const midpoint = bounds[0] + Math.trunc((bounds[1] - bounds[0]) / 2);
  const l = localParts(midpoint, tz);
  return l.hour * 60 + l.minute + l.second / 60;
}

interface Timing { deviationMinutes: number; score: number; priorNights: number }

function timingConsistency(
  current: AndroidSleepSession,
  currentBlocks: readonly AndroidStageBlock[],
  prior: readonly AndroidSleepSession[],
  priorBlocks: Record<string, AndroidStageBlock[]>,
  tz: string,
): Timing | null {
  const currentBounds = namedSleepBounds(currentBlocks);
  if (!currentBounds) return null;
  const currentDate = current.date;
  const earliestDate = plusDays(currentDate, -BASELINE_DAYS);
  const filtered = prior
    .filter((p) => p.date < current.date && p.totalMinutes > 0 && p.endAt <= currentBounds[0])
    .filter((p) => !(p.date < earliestDate) && p.date < currentDate);
  const eligible = groupValues(filtered, (p) => p.date)
    .map((rows) => maxByOrNull(rows, (r) => r.totalMinutes))
    .filter((p): p is AndroidSleepSession => p !== null && namedSleepBounds(priorBlocks[p.id] ?? []) !== null);
  if (eligible.length < MIN_PRIOR_NIGHTS) return null;
  const minutes = eligible.map((p) => midpointMinute(namedSleepBounds(priorBlocks[p.id] ?? [])!, tz));
  // Kotlin: cos(it / 1440.0 * 2.0 * PI), evaluated left to right.
  const x = sumOf(minutes, (m) => Math.cos((m / 1440) * 2 * Math.PI));
  const y = sumOf(minutes, (m) => Math.sin((m / 1440) * 2 * Math.PI));
  if (Math.abs(x) + Math.abs(y) < 1e-9) return null;
  let center = (Math.atan2(y, x) / (2 * Math.PI)) * 1440;
  if (center < 0) center += 1440;
  const currentMinute = midpointMinute(currentBounds, tz);
  const direct = Math.abs(currentMinute - center);
  const deviation = Math.min(direct, 1440 - direct);
  // A two-hour displacement exhausts the contributor (Lumen heuristic, not the published SRI).
  const score = coerceIn(100 * (1 - deviation / 120), 0, 100);
  return { deviationMinutes: deviation, score, priorNights: eligible.length };
}

/** `DailySleepScoreAlgorithm.calculate`. Null when no session has minutes or the day's total is outside 1–1440. */
export function computeSleepIndexV4(
  sessions: readonly AndroidSleepSession[],
  blocksBySession: Record<string, AndroidStageBlock[]>,
  context: SleepScoreContext,
): DailySleepScore | null {
  const valid = sessions.filter((s) => s.totalMinutes > 0);
  const primary = maxByOrNull(valid, (s) => s.totalMinutes);
  if (!primary) return null;
  const totalMinutes = sumOf(valid, (s) => s.totalMinutes);
  if (totalMinutes < 1 || totalMinutes > 1440) return null;
  const target = coerceIn(context.targetMinutes, 420, 720);
  const durationScore = coerceIn((100 * totalMinutes) / target, 0, 100);
  const primaryBlocks = blocksBySession[primary.id] ?? [];
  const cont = continuity(primaryBlocks);
  const timing = timingConsistency(primary, primaryBlocks, context.priorPrimarySessions, context.priorBlocksBySession, context.tz);

  const available: Array<{ id: string; configured: number; score: number }> = [{ id: 'duration', configured: DURATION_WEIGHT, score: durationScore }];
  if (cont) available.push({ id: 'continuity', configured: CONTINUITY_WEIGHT, score: cont.score });
  if (timing) available.push({ id: 'timing_consistency', configured: TIMING_WEIGHT, score: timing.score });
  const availableWeight = sumOf(available, (a) => a.configured);
  const applied = (id: string): number => {
    const a = available.find((x) => x.id === id);
    return a ? a.configured / availableWeight : 0;
  };
  const score = coerceIn(roundToInt(sumOf(available, (a) => (a.score * a.configured) / availableWeight)), 0, 100);

  const hasStageContext = hasAnyNamedStageData(primaryBlocks);
  const stageMinutes = (stage: string): number | null =>
    hasStageContext ? sumOf(primaryBlocks.filter((b) => b.stageRaw === stage), (b) => Math.max(b.durationMinutes, 0)) : null;
  const deep = stageMinutes('DEEP');
  const rem = stageMinutes('REM');
  const ctx = (id: string, label: string, value: number | null, unit: string): AndroidContributor =>
    ({ id, label, value, unit, score: null, weight: 0, configuredWeight: 0, role: value === null ? 'UNAVAILABLE' : 'CONTEXT' });
  const contributors: AndroidContributor[] = [
    { id: 'duration', label: 'Duration', value: totalMinutes, unit: 'min', score: durationScore, weight: applied('duration'), configuredWeight: DURATION_WEIGHT, role: 'SCORED' },
    cont
      ? { id: 'continuity', label: 'Continuity', value: cont.efficiency, unit: '%', score: cont.score, weight: applied('continuity'), configuredWeight: CONTINUITY_WEIGHT, role: 'SCORED' }
      : { id: 'continuity', label: 'Continuity', value: null, unit: null, score: null, weight: 0, configuredWeight: CONTINUITY_WEIGHT, role: 'UNAVAILABLE' },
    timing
      ? { id: 'timing_consistency', label: 'Timing consistency', value: timing.deviationMinutes, unit: 'min deviation', score: timing.score, weight: applied('timing_consistency'), configuredWeight: TIMING_WEIGHT, role: 'SCORED' }
      : { id: 'timing_consistency', label: 'Timing consistency', value: null, unit: null, score: null, weight: 0, configuredWeight: TIMING_WEIGHT, role: 'UNAVAILABLE' },
    ctx('deep_sleep', 'Deep sleep', deep, 'min'),
    ctx('rem_sleep', 'REM sleep', rem, 'min'),
    ctx('nightly_hrv', 'Nightly HRV', context.nightlyHrvMs, 'ms'),
    ctx('sleeping_hr_drop', 'Sleeping HR drop', context.sleepingHeartRateDropBpm, 'bpm'),
  ];
  return {
    score,
    label: qualityLabel(score),
    contributors,
    confidence: available.length === 3 ? 'medium' : 'low',
    algorithmVersion: ANDROID_SLEEP_VERSION,
    primarySessionId: primary.id,
    totalSleepMinutes: totalMinutes,
    awakeAfterOnsetMinutes: cont ? cont.awakeMinutes : null,
    sleepEfficiencyPercent: cont ? cont.efficiency : null,
    timingDeviationMinutes: timing ? timing.deviationMinutes : null,
  };
}

/** Sessions of one waking day, primary, and the context `forWakingDay` assembles. */
export interface SleepDayInputs {
  sessions: AndroidSleepSession[];
  blocksBySession: Record<string, AndroidStageBlock[]>;
  context: SleepScoreContext;
}

/** `SleepScoreRepository.forWakingDay(db, day, DERIVED)` minus the DB: builds the calculate() arguments. */
export function sleepInputsForWakingDay(w: AndroidWorld, day: string): SleepDayInputs | null {
  const sessions = w.sessions.filter((s) => s.date === day && s.totalMinutes > 0);
  if (!sessions.length) return null;
  const primary = maxByOrNull(sessions, (s) => s.totalMinutes)!;
  const baselineStartDate = plusDays(day, -BASELINE_DAYS);
  // inRangeReal(baselineStart, day − 1): `date BETWEEN`, ORDER BY date; then date < day and totalMinutes > 0.
  const priorRows = w.sessions
    .filter((s) => s.date >= baselineStartDate && s.date < day && s.totalMinutes > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const prior = groupValues(priorRows, (s) => s.date).map((rows) => maxByOrNull(rows, (r) => r.totalMinutes)!);
  const priorBlocks: Record<string, AndroidStageBlock[]> = {};
  for (const p of prior) priorBlocks[p.id] = w.blocksBySession[p.id] ?? [];
  const blocks: Record<string, AndroidStageBlock[]> = {};
  for (const s of sessions) blocks[s.id] = w.blocksBySession[s.id] ?? [];
  const target = coerceIn(w.sleepGoalMinutes ?? DEFAULT_TARGET_MIN, 420, 720);
  const inWindow = (t: number): boolean => t >= primary.startAt && t <= primary.endAt;
  const hrvVals = sortedNums(w.measurements.HRV.filter((m) => inWindow(m.t)).map((m) => m.value).filter((v) => Number.isFinite(v) && v >= 1 && v <= 300));
  const hrv = hrvVals.length ? hrvVals[Math.trunc(hrvVals.length / 2)]! : null;
  const hrVals = sortedNums(w.measurements.HEART_RATE.filter((m) => inWindow(m.t)).map((m) => m.value).filter((v) => Number.isFinite(v) && v >= 30 && v <= 220));
  const sleepingHr = indexP10(hrVals);
  const base = w.hrRestingBaseline;
  let hrDrop: number | null = null;
  if (base !== null && Number.isFinite(base) && base >= 30 && base <= 150 && sleepingHr !== null) {
    const d = base - sleepingHr;
    if (Number.isFinite(d) && d >= -100 && d <= 100) hrDrop = d;
  }
  return {
    sessions,
    blocksBySession: blocks,
    context: { priorPrimarySessions: prior, priorBlocksBySession: priorBlocks, targetMinutes: target, nightlyHrvMs: hrv, sleepingHeartRateDropBpm: hrDrop, tz: w.tz },
  };
}

export function sleepIndexForWakingDay(w: AndroidWorld, day: string): DailySleepScore | null {
  const i = sleepInputsForWakingDay(w, day);
  return i ? computeSleepIndexV4(i.sessions, i.blocksBySession, i.context) : null;
}

/** Android contributor → Vitals contributor (CONTEXT rows carry weight 0 and `available: true`). */
export function toVitalsContributors(cs: readonly AndroidContributor[]): ScoreContributor[] {
  return cs.map((c) => {
    const out: ScoreContributor = { id: c.id, weightConfigured: c.configuredWeight, weightApplied: c.weight, available: c.role !== 'UNAVAILABLE' };
    if (c.value !== null) out.raw = c.value;
    if (c.unit !== null) out.unit = c.unit;
    if (c.score !== null) out.component = c.score;
    return out;
  });
}

export function sleepResultFrom(input: ScoreInput, r: DailySleepScore | null, w: AndroidWorld, day: string): ScoreResult {
  const scope = { kind: 'night' as const, localDate: day };
  if (!r) return withheld(SLEEP_INDEX_ID, SLEEP_INDEX_VERSION, input, 'no sleep session with 1–1440 recorded minutes for the waking day', scope);
  const used = [r.primarySessionId, ...w.sessions.filter((s) => s.date === day && s.id !== r.primarySessionId).map((s) => s.id)];
  return makeResult(SLEEP_INDEX_ID, SLEEP_INDEX_VERSION, input, {
    scope,
    status: 'ok',
    value: r.score,
    state: r.label,
    confidence: r.confidence,
    contributors: toVitalsContributors(r.contributors),
    sourceIds: used,
    hashOf: { c: r.contributors.map((c) => [c.id, c.value, c.score, c.weight]), s: used },
    detail: {
      algorithm: ANDROID_SLEEP_VERSION,
      primarySessionId: r.primarySessionId,
      totalSleepMinutes: r.totalSleepMinutes,
      awakeAfterOnsetMinutes: r.awakeAfterOnsetMinutes,
      sleepEfficiencyPercent: r.sleepEfficiencyPercent,
      timingDeviationMinutes: r.timingDeviationMinutes,
    },
  });
}

const SRC = 'R10 §3.3 / SleepScoreRepository.kt';

export const sleepIndexDef: ScoreDef = {
  scoreId: SLEEP_INDEX_ID,
  title: 'Sleep index',
  version: SLEEP_INDEX_VERSION,
  released: '2026-10-01',
  kind: 'index',
  label: 'convenience_index',
  inputs: [
    { stream: 'sleep_sessions', window: 'main_sleep', minCount: 1, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    { stream: 'sleep_sessions', window: '28d', minCount: MIN_PRIOR_NIGHTS, tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    { stream: 'hrv', window: 'main_sleep', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
    { stream: 'hr', window: 'main_sleep', tiersAllowed: ['A', 'B', 'C'], sameSourceRequired: false },
  ],
  profileInputs: ['sleepNeedH'],
  gates: [
    'sleep.sessions(waking_day) >= 1 with total_min > 0',
    'sleep.total_min(waking_day) in [1, 1440]',
    'continuity: named stage minutes >= 95% of positive minutes and of the first-to-last-sleep span; no conflicting overlap',
    'timing: >= 7 prior primary nights in 28 calendar days ending before current named-sleep start',
  ],
  formula: {
    fn: `${SLEEP_INDEX_ID}@${SLEEP_INDEX_VERSION}`,
    text:
      'round( Σ_k w_k·c_k / Σ_k w_k ) over available k (Kotlin roundToInt, ties up), clamped 0–100. ' +
      'Duration c = clamp(100·TST/target, 0, 100), TST = Σ non-awake minutes of all sessions of the waking day, target = goal clamped 420–720 (default 480), w 0.50. ' +
      'Continuity (primary session) c = clamp(100·(eff − 70)/15, 0, 100), eff = 100·asleep/(asleep+awake) from first to last named sleep minute, w 0.25. ' +
      'Timing c = clamp(100·(1 − dev/120), 0, 100), dev = circular distance (min) of the named-sleep midpoint from the circular mean of ≥ 7 prior primary-night midpoints in 28 d, w 0.25. ' +
      'Deep/REM minutes, nightly HRV median and HR drop (profile resting HR − night p10) are context only.',
  },
  params: [
    { name: 'w_duration', value: DURATION_WEIGHT, unit: '1', sourceRef: SRC, kind: 'engineering' },
    { name: 'w_continuity', value: CONTINUITY_WEIGHT, unit: '1', sourceRef: SRC, kind: 'engineering' },
    { name: 'w_timing', value: TIMING_WEIGHT, unit: '1', sourceRef: SRC, kind: 'engineering' },
    { name: 'target_default', value: DEFAULT_TARGET_MIN, range: [420, 720], unit: 'min', sourceRef: SRC, kind: 'engineering' },
    { name: 'efficiency_floor', value: 70, unit: '%', sourceRef: SRC, kind: 'engineering' },
    { name: 'efficiency_span', value: 15, unit: '%', sourceRef: SRC, kind: 'engineering' },
    { name: 'timing_exhaust', value: 120, unit: 'min', sourceRef: SRC, kind: 'engineering' },
    { name: 'timing_min_prior_nights', value: MIN_PRIOR_NIGHTS, unit: 'nights', sourceRef: SRC, kind: 'engineering' },
    { name: 'timing_baseline_days', value: BASELINE_DAYS, unit: 'd', sourceRef: SRC, kind: 'engineering' },
    { name: 'named_coverage_min', value: 0.95, unit: '1', sourceRef: 'R10 §3.2–3.3 / SleepInsights.kt hasUsableStageData', kind: 'engineering' },
  ],
  output: { unit: 'index', range: [0, 100], goodDirection: 'up', display: 'number' },
  uncertainty: { method: 'none', notes: 'Unvalidated composite of vendor primitives (R10 §3.3); confidence medium with all three contributors, else low. No band.' },
  evidence: {
    mechanism: { status: 'infoOnly', pathway: 'convenience composite of sleep duration, continuity and timing regularity', engineNodes: [] },
    certainty: 'D',
    refs: [],
  },
  tierHandling: 'Vendor sleep sessions and stages from any tier are accepted as in Android (the ring is tier C); stages give no points, only coverage-gated continuity. Sessions are taken as resolved per day (one source).',
  planEffects: [{ target: 'display_only', rule: 'display; input to readiness.index', priority: 0 }],
  optInStreams: ['sleep_sessions', 'hr', 'hrv'],
  compute(input: ScoreInput): ScoreResult {
    const w = androidInputsFromScoreInput(input);
    return sleepResultFrom(input, sleepIndexForWakingDay(w, input.localDate), w, input.localDate);
  },
};

export const sleepIndexDefs: ScoreDef[] = [sleepIndexDef];
