/**
 * Difficulty axis D (PLANNER_V2_SPEC §1.1): seven explainable burdens, each scaled from today's habit (0) to the user's
 * own limit or the safety cap (1),
 *
 *   c_i = clamp((v_i − h_i) / (ℓ_i − h_i), 0, 1);   c_i = 0 when ℓ_i − h_i < ε_i (the limits leave no room on it)
 *   D = (1/7) Σ c_i,   D_max = max c_i
 *
 * h_i is v_i of the status-quo plan (`baselineSchedule`) on its own nominal run, so D(baseline) = 0 exactly. D depends
 * only on (context, schedule, nominal run): deterministic and cacheable with the evaluation. `difficultyD` is the fast
 * path the optimiser calls on every evaluation (O(T), no strings); `difficulty` adds the plain-language rows.
 *
 * Components 1 (deficit depth, the run's R-MAINT `inEnergyPctMaint` on non-fast eating days) and 2 (hunger, the run's
 * normalised hunger index) read the simulation; the other five read the schedule. Component 7 is the Gower distance
 * between the plan's lifestyle features and the habit's, over ranges fixed per request from the gene bounds the limits
 * allow (`lifeRanges`), plus 0.05 per required purchase (§8.4).
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import type { SimulationResult } from '../../types/result';
import type { Schedule } from '../../types/schedule';
import { complexityPenalty, type ComplexityCounts } from '../optim/goals';
import { MIN_MEAL_SPACING_H, type PlanningContext } from './context';
import { baselineSchedule } from './decode';
import { PLANNER_MODULES } from './engineModules';
import { LIFE_CIRCULAR, LIFE_FEATURES, complexityCounts, lifeFeatures, planFacts, type LifeFeatureId } from './features';
import { WATER_FAST_VARIANTS, eventPeriodDays } from './fastMath';
import { IDEAL_SLEEP, bedClockOf, clockDiff, idealSleepEnvelope, sleepMidpointRange } from './ideal';
import { LEVER_INDEX } from './registry/levers';
import { fastAllowed } from './safety';
import { DIFFICULTY_COMPONENTS, type DifficultyBreakdown, type DifficultyComponent, type DifficultyComponentId } from './types';

/** ε_i: a component is active only when its limit leaves at least this much room above the habit (own units, PROPOSED). */
export const DIFFICULTY_EPS: Readonly<Record<DifficultyComponentId, number>> = {
  deficit: 0.01, // 1 %-point of maintenance
  hunger: 0.02,
  trainingTime: 10, // min a week
  fastingLoad: 0.01,
  windowTightness: 0.25, // h
  decisions: 0.005,
  habitDistance: 0.02,
};
/** Hunger limit above the tolerance: the hunger cap's 0.15 plus 0.25 (§1.1 row 2, PROPOSED). */
export const HUNGER_LIMIT_EXCESS = 0.15 + 0.25;
/** Weight of the daily choices term of component 6 (meals off the habit + supplement doses), per item a day. */
export const DECISION_ITEM_WEIGHT = 0.02;
/** Habit distance added per required purchase (§8.4, PROPOSED). */
export const PURCHASE_DISTANCE = 0.05;

const N = DIFFICULTY_COMPONENTS.length;
const I_DEF = 0;
const I_HUN = 1;
const I_TRN = 2;
const I_FST = 3;
const I_WIN = 4;
const I_DEC = 5;
const I_HAB = 6;

// ---------------------------------------------------------------------------------------------------------------
// limits that are pure functions of the context
// ---------------------------------------------------------------------------------------------------------------

export interface FastingPattern {
  kind: 'window' | 'fast24' | 'zeroDays' | 'event';
  /** b₃ of the pattern (mean of max(0, fasted h − 10)/14 per day; a zero-intake day = 1). */
  b3: number;
  /** Fast lengths of the pattern's events over the horizon (for the decision ceiling). */
  events: number[];
}

/** Shortest eating window the planner can build: the safety minimum, or the meal spacing of the fewest meals. */
function minWindowH(ctx: PlanningContext): number {
  return Math.max(ctx.caps.minWindowH, MIN_MEAL_SPACING_H * (Math.max(2, ctx.practical.meals.min) - 1));
}

/**
 * The most fasting-heavy pattern the caps and consent allow (§1.1, closed form, no engine runs): without fasting levers
 * the shortest window every day; otherwise the heaviest of two 24-h fasts a week, three zero-intake days a week and the
 * longest allowed fast once per its spacing period, with the shortest window on every other day. A 24-h fast counts as
 * one fully fasted day (an upper bound, so no plan the planner builds exceeds it).
 */
export function maxFastingPattern(ctx: PlanningContext): FastingPattern {
  const T = ctx.horizonDays;
  const W = minWindowH(ctx);
  const bMin = Math.max(0, 24 - W - 10) / 14;
  let best: FastingPattern = { kind: 'window', b3: bMin, events: [] };
  if (!ctx.fastingRelevant) return best;
  const caps = ctx.caps;
  const ex = ctx.practical.excluded;
  const weeks = Math.floor(T / 7);
  if (fastAllowed(caps, 24) && !ex.has('fastDay24') && !ex.has('B13')) {
    const b3 = (5 * bMin + 2) / 7;
    if (b3 > best.b3) best = { kind: 'fast24', b3, events: Array.from({ length: 2 * weeks }, () => 24) };
  }
  // zero days: each one is a ≤ 36-h fast between ≥ 12-h windows (the decoder's B12 rule)
  if (fastAllowed(caps, 36) && !ex.has('B12') && !ex.has('zeroDay')) {
    const b3 = (3 + 4 * (Math.max(0, 14 - Math.max(W, 12)) / 14)) / 7;
    if (b3 > best.b3) best = { kind: 'zeroDays', b3, events: [] };
  }
  if (!ex.has('waterFast')) {
    let H = 0;
    for (const h of WATER_FAST_VARIANTS) if (fastAllowed(caps, h)) H = Math.max(H, h);
    if (H > 0) {
      const P = eventPeriodDays(H);
      const z = H / 24;
      const b3 = (z + Math.max(0, P - z) * bMin) / P;
      if (b3 > best.b3) best = { kind: 'event', b3, events: Array.from({ length: Math.max(1, Math.floor((T - 7) / P)) }, () => H) };
    }
  }
  return best;
}

function eventCost(h: number): number {
  return (h > 24 ? LEVER_INDEX.get('waterFast') : LEVER_INDEX.get('fastDay24'))!.complexityCost({ durationH: h + 1 });
}

/**
 * Ceiling of the daily-decisions component (§1.1 row 6, PROPOSED): the complexity penalty at 4 day-types in each of 3
 * phases, the events of the heaviest fasting pattern, 2 training clock times and a week-repeat share of 0.5, plus the
 * largest daily choices (meals off the habit at the limit of the meal range, every supplement the person may take).
 */
export function complexityCeiling(ctx: PlanningContext): number {
  const counts: ComplexityCounts = {
    dayTypesPerPhase: [4, 4, 4],
    distinctPhases: 3,
    phaseTransitions: 2,
    horizonDays: ctx.horizonDays,
    eventComplexityCosts: maxFastingPattern(ctx).events.map(eventCost),
    meanWindowStartShiftH: 0,
    distinctTrainingClockTimes: 2,
    weekRepeatShare: 0.5,
  };
  const hab = ctx.rp.habits.habitualMealsPerDay;
  const m = ctx.practical.meals;
  const mealsOff = Math.max(Math.abs(m.max - hab), Math.abs(m.min - hab));
  const caps = ctx.caps;
  const supps = (caps.creatineAllowed ? 1 : 0) + (caps.optInLevers.has('L8') || caps.optInLevers.has('omega3') ? 1 : 0) + 1;
  return complexityPenalty(counts) + DECISION_ITEM_WEIGHT * (mealsOff + supps);
}

/** Weekly training minutes the limits allow (§1.1 row 3): sessions × length, cardio × min(90, length), extra steps / 100. */
function trainingLimit(ctx: PlanningContext): number {
  const p = ctx.practical;
  return p.rtDays.max * p.maxSessionMin + p.cardioDays.max * Math.min(90, p.maxSessionMin) + Math.max(0, p.steps.max - ctx.rp.habits.typicalSteps) / 100;
}

// ---------------------------------------------------------------------------------------------------------------
// baseline (per context, cached): h_i, ℓ_i, φ_life of the habit and its ranges
// ---------------------------------------------------------------------------------------------------------------

interface Base {
  h: Float64Array;
  l: Float64Array;
  active: Uint8Array;
  life: Float64Array;
  ranges: Float64Array;
  /** Number of φ_life features with a non-zero range (the Gower denominator, fixed per request). */
  nLive: number;
  hungerMean: number;
  hungerShare: number;
  windowH: number;
  fastedGapH: number;
  sim: SimulationResult;
  schedule: Schedule;
}

const baseCache = new WeakMap<PlanningContext, Base>();

/** Nominal planner-mode run of the status-quo plan (same options as the optimiser's nominal evaluation). */
function baselineRun(ctx: PlanningContext, schedule: Schedule): SimulationResult {
  return runEngine(ctx.rp, compileSchedule(schedule, ctx.rp), { mode: 'planner', record: 'daily', series: ['hunger', 'inEnergyPctMaint'], burnInDays: 14 }, PLANNER_MODULES);
}

function union(lo: number, hi: number, v: number): [number, number] {
  return Number.isFinite(v) ? [Math.min(lo, v), Math.max(hi, v)] : [lo, hi];
}

/** Circular union of a clock range [lo, hi] (unwrapped) with a clock value. */
function unionClock(lo: number, hi: number, v: number): [number, number] {
  if (!Number.isFinite(v)) return [lo, hi];
  const c = (lo + hi) / 2;
  const u = c + clockDiff(c, v);
  return [Math.min(lo, u), Math.max(hi, u)];
}

/**
 * Ranges R_k of the φ_life features (`LIFE_FEATURES` order), fixed per request from the gene bounds the limits allow and
 * the habit itself — never from what else was evaluated, so D of a plan is the same in every run of the request.
 */
export function lifeRanges(ctx: PlanningContext): Float64Array {
  return base(ctx).ranges;
}

function computeRanges(ctx: PlanningContext, hab: Float64Array): Float64Array {
  const p = ctx.practical;
  const caps = ctx.caps;
  const R = new Float64Array(LIFE_FEATURES.length);
  const set = (k: LifeFeatureId, [lo, hi]: [number, number]) => (R[LIFE_FEATURES.indexOf(k)] = Math.max(0, hi - lo));
  const at = (k: LifeFeatureId) => hab[LIFE_FEATURES.indexOf(k)]!;
  const W = minWindowH(ctx);
  set('windowStart', unionClock(p.earliestH, Math.max(p.earliestH, p.latestH - W), at('windowStart')));
  set('windowLength', union(Math.min(W, caps.minWindowH), Math.max(W, Math.min(14, p.latestH - p.earliestH)), at('windowLength')));
  set('meals', union(p.meals.min, p.meals.max, at('meals')));
  set('steps', union(p.steps.min, p.steps.max, at('steps')));
  set('rtSessions', union(p.rtDays.min, p.rtDays.max, at('rtSessions')));
  set('cardioMin', union(0, p.cardioDays.max * Math.min(90, p.maxSessionMin), at('cardioMin')));
  // training clock: the waking day with the clock gene, else the placement window around the preferred time
  const ig = p.idealGenes;
  const env = ig?.sleep ? idealSleepEnvelope(p.bedH, p.wakeH) : { earliestWakeH: p.wakeH, latestBedClock: bedClockOf(p.bedH) };
  const shift = ctx.request.constraints?.trainingTimeH !== undefined ? 1.5 : 3;
  const clk: [number, number] = ig?.clock
    ? [env.earliestWakeH + 1, Math.max(env.earliestWakeH + 1, env.latestBedClock - 1.5)]
    : [Math.max(p.wakeH + 1, p.trainingTimeH - shift), Math.max(p.wakeH + 1, Math.min(bedClockOf(p.bedH) - 1.5, p.trainingTimeH + shift))];
  set('trainingClock', p.rtDays.max > 0 || p.cardioDays.max > 0 ? unionClock(clk[0], clk[1], at('trainingClock')) : [0, 0]);
  // bed and wake: the Ideal's sleep genes; else the sleep-extension lever moves bed up to 1.5 h earlier
  if (ig?.sleep) {
    const mr = sleepMidpointRange(p.bedH, p.wakeH);
    set('bedTime', unionClock(mr.lo - IDEAL_SLEEP.maxH / 2, mr.hi - IDEAL_SLEEP.minH / 2, at('bedTime')));
    set('wakeTime', unionClock(mr.lo + IDEAL_SLEEP.minH / 2, mr.hi + IDEAL_SLEEP.maxH / 2, at('wakeTime')));
  } else {
    set('bedTime', !p.sleepFixed && p.habitualSleepH < 7 ? [0, 1.5] : [0, 0]);
    set('wakeTime', [0, 0]);
  }
  const floorPct = (100 * caps.energyFloorKcal) / caps.tdee0Kcal;
  const ePctLo = Math.max(caps.deficitCapPct > 0 ? 100 - caps.deficitCapPct : 100, Math.min(100, floorPct));
  const ePctHi = caps.surplusAllowed ? Math.min(caps.surplusPhaseMaxPct, 100 + (100 * 500) / caps.tdee0Kcal) : 100;
  set('energyPct', union(ePctLo, ePctHi, at('energyPct')));
  set('proteinGPerKg', union(caps.proteinFloorRw, Math.max(caps.proteinFloorRw, Math.min(caps.proteinCapRw, (2.9 * caps.ffmKg) / caps.rwKg)), at('proteinGPerKg')));
  set('carbShare', union(caps.ketogenicAllowed ? 0.05 : 0.2, 0.65, at('carbShare')));
  return R;
}

function base(ctx: PlanningContext): Base {
  const hit = baseCache.get(ctx);
  if (hit) return hit;
  const schedule = baselineSchedule(ctx);
  const sim = baselineRun(ctx, schedule);
  const life = lifeFeatures(ctx, schedule);
  const ranges = computeRanges(ctx, life);
  let nLive = 0;
  for (let k = 0; k < ranges.length; k++) if (ranges[k]! > 1e-9) nLive++;
  const b: Base = {
    h: new Float64Array(N),
    l: new Float64Array(N),
    active: new Uint8Array(N),
    life,
    ranges,
    nLive,
    hungerMean: 0,
    hungerShare: 0,
    windowH: ctx.rp.habits.habitualWindowLengthH,
    fastedGapH: 0,
    sim,
    schedule,
  };
  const hs = hungerStats(ctx, sim);
  b.hungerMean = hs.mean;
  b.hungerShare = hs.share;
  // the habit's own values (exact zeros on the baseline itself), with the baseline's window as W_hab
  b.windowH = meanWindow(ctx, schedule);
  b.fastedGapH = 24 - b.windowH;
  rawInto(ctx, schedule, sim, b, 0, b.h, true);
  const caps = ctx.caps;
  b.l[I_DEF] = caps.deficitCapPct / 100;
  b.l[I_HUN] = ctx.practical.hTol + HUNGER_LIMIT_EXCESS;
  b.l[I_TRN] = trainingLimit(ctx);
  b.l[I_FST] = maxFastingPattern(ctx).b3;
  b.l[I_WIN] = b.windowH - caps.minWindowH;
  b.l[I_DEC] = complexityCeiling(ctx);
  b.l[I_HAB] = 1;
  DIFFICULTY_COMPONENTS.forEach((id, i) => (b.active[i] = b.l[i]! - b.h[i]! >= DIFFICULTY_EPS[id] ? 1 : 0));
  baseCache.set(ctx, b);
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// raw component values v_i
// ---------------------------------------------------------------------------------------------------------------

function hungerStats(ctx: PlanningContext, sim: SimulationResult | undefined): { mean: number; share: number; ok: boolean } {
  const h = sim?.daily.hunger;
  if (!h || !h.length || !Number.isFinite(h[0]!)) return { mean: 0, share: 0, ok: false };
  const tol = ctx.practical.hTol;
  let s = 0;
  let above = 0;
  let n = 0;
  for (let d = 0; d < h.length; d++) {
    const v = h[d]!;
    if (!Number.isFinite(v)) continue;
    const x = v / 100;
    s += x;
    if (x > tol) above++;
    n++;
  }
  return n ? { mean: s / n, share: above / n, ok: true } : { mean: 0, share: 0, ok: false };
}

function meanWindow(ctx: PlanningContext, s: Schedule): number {
  const f = planFacts(ctx, s);
  let w = 0;
  let n = 0;
  for (let d = 0; d < f.kcal.length; d++) {
    if (f.fastDay[d] || !(f.mealsN[d]! > 0)) continue;
    w += f.windowLen[d]!;
    n++;
  }
  return n ? w / n : ctx.rp.habits.habitualWindowLengthH;
}

/** Mean intake on non-fast eating days, % of the run's maintenance (R-MAINT; planned energy without a run). */
function meanIntakePct(ctx: PlanningContext, s: Schedule, sim: SimulationResult | undefined): number {
  const f = planFacts(ctx, s);
  const pm = sim?.daily.inEnergyPctMaint;
  let sum = 0;
  let n = 0;
  for (let d = 0; d < f.kcal.length; d++) {
    if (f.fastDay[d] || !(f.mealsN[d]! > 0)) continue;
    let pct = pm && pm.length > d ? pm[d]! : Number.NaN;
    if (!Number.isFinite(pct)) pct = (100 * f.kcal[d]!) / ctx.rp.tdee0Kcal;
    sum += pct;
    n++;
  }
  return n ? sum / n : 100;
}

/** Gower distance of the plan's φ_life from the habit's over the fixed ranges (circular for clock features). */
function habitDistance(life: ArrayLike<number>, b: Base, contrib?: Float64Array): number {
  if (!b.nLive) return 0;
  let s = 0;
  for (let k = 0; k < life.length; k++) {
    const R = b.ranges[k]!;
    if (!(R > 1e-9)) {
      if (contrib) contrib[k] = 0;
      continue;
    }
    const a = life[k]!;
    const h = b.life[k]!;
    let d = 0;
    if (a === a && h === h) d = Math.min(1, Math.abs(LIFE_CIRCULAR[k] ? clockDiff(h, a) : a - h) / R);
    if (contrib) contrib[k] = d;
    s += d;
  }
  return s / b.nLive;
}

/**
 * v_i of a plan into `out` (fractions for deficit, hunger index units, min/week, b₃, h, penalty, distance). `isBase`:
 * the habit values themselves (hunger from the baseline run).
 */
function rawInto(ctx: PlanningContext, s: Schedule, sim: SimulationResult | undefined, b: Base, extraHabit: number, out: Float64Array, isBase = false): void {
  const f = planFacts(ctx, s);
  const T = f.kcal.length;
  const n = Math.max(1, T);
  const tdee = ctx.rp.tdee0Kcal;
  const habSteps = ctx.rp.habits.typicalSteps;
  const habMeals = ctx.rp.habits.habitualMealsPerDay;
  const pm = sim?.daily.inEnergyPctMaint;
  const usePm = !!pm && pm.length >= T;
  let def = 0;
  let nDef = 0;
  let train = 0;
  let steps = 0;
  let fl = 0;
  let win = 0;
  let nWin = 0;
  let choices = 0;
  for (let d = 0; d < T; d++) {
    const fast = f.fastDay[d] === 1;
    if (!fast && f.mealsN[d]! > 0) {
      let pct = usePm ? pm[d]! : Number.NaN;
      if (!Number.isFinite(pct)) pct = (100 * f.kcal[d]!) / tdee;
      def += pct < 100 ? 1 - pct / 100 : 0;
      nDef++;
      const gap = b.windowH - f.windowLen[d]!;
      win += gap > 0 ? gap : 0;
      nWin++;
      choices += Math.abs(f.mealsN[d]! - habMeals);
    }
    train += f.rtMin[d]! + f.cardioMin[d]!;
    steps += f.steps[d]!;
    fl += f.zero[d] ? 1 : Math.max(0, f.fastedH[d]! - 10) / 14;
    choices += f.supps[d]!;
  }
  out[I_DEF] = nDef ? def / nDef : 0;
  if (isBase) out[I_HUN] = b.hungerMean + 0.5 * b.hungerShare;
  else {
    const hs = hungerStats(ctx, sim);
    out[I_HUN] = hs.ok ? hs.mean + 0.5 * hs.share : b.h[I_HUN]!;
  }
  out[I_TRN] = (7 * train) / n + Math.max(0, steps / n - habSteps) / 100;
  out[I_FST] = fl / n;
  out[I_WIN] = nWin ? win / nWin : 0;
  out[I_DEC] = complexityPenalty(complexityCounts(ctx, s, [])) + (DECISION_ITEM_WEIGHT * choices) / n;
  out[I_HAB] = isBase ? 0 : habitDistance(lifeFeatures(ctx, s), b) + Math.max(0, extraHabit);
}

const scratch = new Float64Array(N);

function component(b: Base, i: number, v: number): number {
  if (!b.active[i]) return 0;
  const x = (v - b.h[i]!) / (b.l[i]! - b.h[i]!);
  // a 1e-9 dead zone keeps D(baseline) = 0 when the plan's run restores a post-burn-in snapshot (floating-point noise)
  return x > 1e-9 ? (x < 1 ? x : 1) : 0;
}

/**
 * D ∈ [0, 1] of a plan (fast path: no strings, one O(T) pass over cached schedule facts and the run's two series).
 * `sim` should be the plan's nominal run; `purchases` = number of required equipment purchases (§8.4: 0.05 each),
 * `purchaseBurden` = the same already in distance units (`equipment.ts` `purchaseBurden`); pass one of them.
 */
export function difficultyD(ctx: PlanningContext, schedule: Schedule, sim: SimulationResult | undefined, purchases = 0, purchaseBurden = 0): number {
  const b = base(ctx);
  rawInto(ctx, schedule, sim, b, PURCHASE_DISTANCE * Math.max(0, purchases) + Math.max(0, purchaseBurden), scratch);
  let s = 0;
  for (let i = 0; i < N; i++) s += component(b, i, scratch[i]!);
  return s / N;
}

// ---------------------------------------------------------------------------------------------------------------
// breakdown with plain-language rows
// ---------------------------------------------------------------------------------------------------------------

export const DIFFICULTY_LABELS: Readonly<Record<DifficultyComponentId, string>> = {
  deficit: 'Eating less',
  hunger: 'Hunger',
  trainingTime: 'Training time',
  fastingLoad: 'Fasting',
  windowTightness: 'Eating window',
  decisions: 'Daily decisions',
  habitDistance: 'Change from your routine',
};
const UNITS: Readonly<Record<DifficultyComponentId, string>> = {
  deficit: '% below maintenance',
  hunger: 'hunger score',
  trainingTime: 'min a week',
  fastingLoad: 'fasting load',
  windowTightness: 'h shorter window',
  decisions: 'decision score',
  habitDistance: 'routine change',
};
/** Text of a component whose limit leaves no room (ℓ − h < ε). */
export const INACTIVE_TEXT = 'no room to change here — your limit is where you are now';

const LIFE_WORDS: Readonly<Record<LifeFeatureId, string>> = {
  windowStart: 'meal times',
  windowLength: 'eating window',
  meals: 'meals a day',
  steps: 'daily steps',
  rtSessions: 'strength sessions',
  cardioMin: 'cardio',
  trainingClock: 'training time of day',
  bedTime: 'bedtime',
  wakeTime: 'wake time',
  energyPct: 'how much you eat',
  proteinGPerKg: 'protein',
  carbShare: 'carbohydrate share',
};
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

function words(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function round1(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "45 min", "4 h", "4.5 h" (weekly amounts). */
export function fmtWeekly(min: number): string {
  if (min < 55) return `${Math.max(0, 5 * Math.round(min / 5))} min`;
  const h = Math.round((min / 60) * 2) / 2;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

function listWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function fastingText(ctx: PlanningContext, s: Schedule, gapNow: number, meanGap: number): string {
  const T = s.horizonDays;
  const weeks = Math.max(1, T / 7);
  const evs = s.events ?? [];
  const multi = evs.filter((e) => e.durationH > 24 + 1e-6);
  if (multi.length) {
    const h = Math.round(Math.max(...multi.map((e) => e.durationH)));
    const n = multi.length;
    return `${n === 1 ? 'one' : words(n)} ${h}-h fast${n > 1 ? 's' : ''} in ${Math.round(weeks)} weeks`;
  }
  const f = planFacts(ctx, s);
  let zeroDays = 0;
  for (let d = 0; d < T; d++) if (s.programs[s.days[d]!.program]!.energy.kind === 'zero' && f.zero[d]) zeroDays++;
  if (zeroDays) {
    const k = Math.max(1, Math.round(zeroDays / weeks));
    return `${words(k)} day${k > 1 ? 's' : ''} without food a week`;
  }
  const n24 = evs.filter((e) => e.durationH > 20 - 1e-6).length;
  if (n24) {
    const k = n24 / weeks;
    if (k >= 0.75) {
      const kk = Math.round(k);
      return `${words(kk)} 24-h fast${kk > 1 ? 's' : ''} a week`;
    }
    return `a 24-h fast about every ${Math.max(2, Math.round(1 / k))} weeks`;
  }
  const g = Math.round(meanGap * 2) / 2;
  const now = Math.round(gapNow * 2) / 2;
  return `a ${round1(g)}-h overnight gap without food${Math.abs(g - now) >= 0.5 ? ` (now ${round1(now)} h)` : ', as now'}`;
}

/** Full breakdown with labels and plain sentences in the user's terms (for rung cards and the comparison table). */
export function difficulty(
  ctx: PlanningContext,
  schedule: Schedule,
  sim: SimulationResult | undefined,
  opts: { purchases?: number; purchaseBurden?: number } = {},
): DifficultyBreakdown {
  const b = base(ctx);
  const burden = Math.max(0, opts.purchaseBurden ?? 0);
  const purchases = Math.max(0, opts.purchases ?? 0) + Math.round(burden / PURCHASE_DISTANCE);
  const v = new Float64Array(N);
  rawInto(ctx, schedule, sim, b, PURCHASE_DISTANCE * Math.max(0, opts.purchases ?? 0) + burden, v);
  const f = planFacts(ctx, schedule);
  const contrib = new Float64Array(LIFE_FEATURES.length);
  habitDistance(lifeFeatures(ctx, schedule), b, contrib);
  const hs = hungerStats(ctx, sim);
  const counts = complexityCounts(ctx, schedule, []);
  const T = f.kcal.length;
  let suppSum = 0;
  for (let d = 0; d < T; d++) suppSum += f.supps[d]!;
  const scale: Record<DifficultyComponentId, number> = { deficit: 100, hunger: 1, trainingTime: 1, fastingLoad: 1, windowTightness: 1, decisions: 1, habitDistance: 1 };
  const components: DifficultyComponent[] = DIFFICULTY_COMPONENTS.map((id, i) => {
    const value = component(b, i, v[i]!);
    const active = b.active[i] === 1;
    let text = INACTIVE_TEXT;
    if (active) {
      switch (id) {
        case 'deficit': {
          const pct = Math.round(100 * v[i]!);
          const now = Math.round(100 * b.h[i]!);
          const above = Math.round(meanIntakePct(ctx, schedule, sim) - 100);
          text =
            pct >= 1
              ? `${pct} % below the intake that keeps your weight steady, averaged over the whole plan with maintenance weeks and breaks included (each phase shows its own deficit)${now >= 1 ? ` (now ${now} %)` : ''}`
              : above >= 1
                ? `no deficit: about ${above} % above the intake that keeps your weight steady`
                : 'eating about what keeps your weight steady, as now';
          break;
        }
        case 'hunger': {
          const mean = Math.round(100 * (hs.ok ? hs.mean : b.hungerMean));
          const now = Math.round(100 * b.hungerMean);
          const share = Math.round(100 * (hs.ok ? hs.share : b.hungerShare));
          text = `hunger about ${mean} of 100 (now ${now})${share >= 1 ? `, above your comfort level on ${share} % of days` : ''}`;
          break;
        }
        case 'trainingTime': {
          const diff = v[i]! - b.h[i]!;
          text = `${fmtWeekly(v[i]!)} a week of training and extra walking, ${Math.abs(diff) < 15 ? 'about the same as now' : `${fmtWeekly(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than now`}`;
          break;
        }
        case 'fastingLoad': {
          let gap = 0;
          let n = 0;
          for (let d = 0; d < T; d++) if (!f.fastDay[d] && f.mealsN[d]! > 0) {
            gap += 24 - f.windowLen[d]!;
            n++;
          }
          text = fastingText(ctx, schedule, b.fastedGapH, n ? gap / n : b.fastedGapH);
          break;
        }
        case 'windowTightness': {
          const w = meanWindow(ctx, schedule);
          const diff = b.windowH - w;
          text = Math.abs(diff) < 0.25 ? `${round1(w)} h, as now` : `${round1(w)} h, ${round1(Math.abs(diff))} h ${diff > 0 ? 'shorter' : 'longer'} than now`;
          break;
        }
        case 'decisions': {
          const kinds = Math.max(1, ...counts.dayTypesPerPhase);
          const phases = counts.distinctPhases;
          const supps = Math.round(suppSum / Math.max(1, T));
          text = `${kinds} kind${kinds > 1 ? 's' : ''} of day across ${words(phases)} phase${phases > 1 ? 's' : ''}${supps > 0 ? `, ${words(supps)} supplement${supps > 1 ? 's' : ''} a day` : ''}`;
          break;
        }
        case 'habitDistance': {
          const changed = LIFE_FEATURES.map((k, j) => ({ k, d: contrib[j]! })).filter((x) => x.d >= 0.15).sort((a, c) => c.d - a.d || (a.k < c.k ? -1 : 1));
          const level = v[i]! < 0.1 ? 'close to your routine' : v[i]! < 0.3 ? 'some changes' : 'big changes';
          const what = changed.slice(0, 3).map((x) => LIFE_WORDS[x.k]);
          text = `${level}${what.length ? `: ${listWords(what)}` : ''}${purchases > 0 ? `; ${words(purchases)} item${purchases > 1 ? 's' : ''} to buy` : ''}`;
          break;
        }
      }
    }
    return {
      id,
      value,
      raw: v[i]! * scale[id],
      habit: b.h[i]! * scale[id],
      limit: b.l[i]! * scale[id],
      unit: UNITS[id],
      active,
      label: DIFFICULTY_LABELS[id],
      text,
    };
  });
  let D = 0;
  let Dmax = 0;
  let hardest: DifficultyComponentId | null = null;
  for (const c of components) {
    D += c.value;
    if (c.value > Dmax + 1e-12) {
      Dmax = c.value;
      hardest = c.id;
    }
  }
  D /= N;
  return { D, Dmax, components, hardest: D > 0 ? hardest : null };
}

/** Habit values h_i, limits ℓ_i and activity of the seven components for a context (tests, explanations). */
export function difficultyFrame(ctx: PlanningContext): { habit: Float64Array; limit: Float64Array; active: boolean[]; baseline: Schedule; baselineSim: SimulationResult } {
  const b = base(ctx);
  return { habit: Float64Array.from(b.h), limit: Float64Array.from(b.l), active: Array.from(b.active, (x) => x === 1), baseline: b.schedule, baselineSim: b.sim };
}
