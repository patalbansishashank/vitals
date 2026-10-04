/**
 * Behaviour descriptors b₁…b₄ (dossier 18 §4.12), the Gower plan-distance features φ and the complexity counts of
 * §4.9, all computed from the Schedule alone (no engine state).
 */
import type { FeatureSpec } from '../optim/archive';
import type { ComplexityCounts } from '../optim/goals';
import type { RepairEntry } from '../optim/types';
import type { Schedule } from '../../types/schedule';
import { BLOCKS, type BlockFamily, type BlockId } from './registry/blocks';
import { LEVER_INDEX } from './registry/levers';
import type { PlanningContext } from './context';
import { estimateDay, mealClocks, mergeDay } from './dayMath';
import { refeedDayFactors } from './fastMath';

const FAMILIES: readonly BlockFamily[] = [
  'maintenance', 'deficit', 'veryLowCarb', 'aggressiveDeficit', 'veryLowEnergy', 'veryLowFat', 'dietBreak', 'refeed', 'carbLoad',
  'intermittentRestriction', 'alternateDay', 'zeroIntake', 'trainLow', 'reintroduction', 'fibreRamp', 'surplus', 'recovery',
];

export interface PlanFacts {
  kcal: Float64Array;
  carbKcal: Float64Array;
  proteinG: Float64Array;
  fastedH: Float64Array;
  zero: Uint8Array;
  windowStart: Float64Array;
  windowLen: Float64Array;
  steps: Float64Array;
  rtSets: Float64Array;
  rtSessions: Float64Array;
  /** Resistance-training minutes of the day. */
  rtMin: Float64Array;
  cardioMin: Float64Array;
  fastedCardioMin: Float64Array;
  trainingClock: Set<number>;
  dayKey: string[];
  blockRuns: BlockId[];
  eventHours: number[];
  // ---- planner v2 (difficulty axis, PLANNER_V2_SPEC §1.1; A8)
  /** Planned meals of the day (0 on fully fasted days). */
  mealsN: Float64Array;
  /** Supplement doses of the day (creatine, omega-3, viscous fibre). */
  supps: Float64Array;
  /** 1 on fast days: touched by a fast event, zero-energy, or a locked refeed day after a long fast (ruling 18:10). */
  fastDay: Uint8Array;
  /** Start of the day's first session, clock h (NaN without one). */
  sessionStart: Float64Array;
  /** The night's bed and wake clock (template sleep, else the habit). */
  bedH: Float64Array;
  wakeH: Float64Array;
}

/** Per-day planned facts at baseline references (cached per schedule object). */
const factsCache = new WeakMap<Schedule, PlanFacts>();

export function planFacts(ctx: PlanningContext, s: Schedule): PlanFacts {
  const hit = factsCache.get(s);
  if (hit) return hit;
  const T = s.horizonDays;
  const refs = { maintenanceKcal: ctx.rp.tdee0Kcal, bwKg: ctx.rp.weightKg, ffmKg: ctx.rp.ffm0Kg };
  const f: PlanFacts = {
    kcal: new Float64Array(T), carbKcal: new Float64Array(T), proteinG: new Float64Array(T), fastedH: new Float64Array(T), zero: new Uint8Array(T),
    windowStart: new Float64Array(T), windowLen: new Float64Array(T), steps: new Float64Array(T), rtSets: new Float64Array(T), rtSessions: new Float64Array(T), rtMin: new Float64Array(T),
    cardioMin: new Float64Array(T), fastedCardioMin: new Float64Array(T), trainingClock: new Set(), dayKey: [], blockRuns: [], eventHours: [],
    mealsN: new Float64Array(T), supps: new Float64Array(T), fastDay: new Uint8Array(T), sessionStart: new Float64Array(T), bedH: new Float64Array(T), wakeH: new Float64Array(T),
  };
  const cov = new Float64Array(T);
  for (const e of s.events ?? []) {
    const a = e.startDay * 24 + e.startH;
    const b = a + e.durationH;
    f.eventHours.push(e.durationH);
    for (let d = Math.max(0, Math.floor(a / 24)); d <= Math.min(T - 1, Math.floor((b - 1e-9) / 24)); d++) cov[d] = cov[d]! + Math.min(b, d * 24 + 24) - Math.max(a, d * 24);
  }
  const rf = s.events?.length ? refeedDayFactors(s) : null;
  const hab = ctx.rp.habits;
  for (let d = 0; d < T; d++) {
    const sd = s.days[d]!;
    const t = mergeDay(s.programs[sd.program]!, sd.override);
    const e = estimateDay(t, refs);
    const full = cov[d]! >= 24 - 1e-9 || e.zero || e.kcal <= 50;
    f.fastDay[d] = full || cov[d]! > 0 || (rf !== null && rf[d]! < 1) ? 1 : 0;
    f.bedH[d] = t.sleep?.bedH ?? hab.bedTimeH;
    f.wakeH[d] = t.sleep?.wakeH ?? hab.wakeTimeH;
    f.supps[d] = (t.substances?.creatineG ? 1 : 0) + (t.macros.fatTypes?.omega3G ? 1 : 0) + (t.macros.viscousFibreShare && !full ? 1 : 0);
    f.sessionStart[d] = Number.NaN;
    f.zero[d] = full ? 1 : 0;
    f.kcal[d] = full ? 0 : e.kcal;
    f.carbKcal[d] = full ? 0 : 4 * e.carbG;
    f.proteinG[d] = full ? 0 : e.proteinG;
    const mc = full ? [] : mealClocks(t);
    const first = mc.length ? Math.min(...mc) : 0;
    const last = mc.length ? Math.max(...mc) : 0;
    f.windowStart[d] = first;
    f.windowLen[d] = last - first;
    f.mealsN[d] = mc.length;
    f.fastedH[d] = full ? 24 : Math.min(24, Math.max(24 - (last - first), cov[d]!));
    f.steps[d] = t.steps ?? ctx.rp.habits.typicalSteps;
    for (const x of t.exercise ?? []) {
      f.trainingClock.add(Math.round(x.startH * 2) / 2);
      if (!(x.startH >= f.sessionStart[d]!)) f.sessionStart[d] = x.startH;
      if (x.kind === 'resistance') {
        f.rtSessions[d] = f.rtSessions[d]! + 1;
        f.rtMin[d] = f.rtMin[d]! + (x.durationMin ?? 60);
        for (const v of Object.values(x.setsByRegion ?? {})) f.rtSets[d] = f.rtSets[d]! + (v ?? 0);
      } else {
        f.cardioMin[d] = f.cardioMin[d]! + x.durationMin;
        if (mc.length === 0 || x.startH < first) f.fastedCardioMin[d] = f.fastedCardioMin[d]! + x.durationMin;
      }
    }
    f.dayKey.push(JSON.stringify([sd.program, sd.override ?? null]));
  }
  let prev: string | undefined;
  for (const b of s.blocks ?? []) {
    const id = (b.buildingBlockId ?? 'B0') as BlockId;
    if (id !== prev) f.blockRuns.push(id);
    prev = id;
  }
  factsCache.set(s, f);
  return f;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return a.length ? s / a.length : 0;
}

/** 18 §4.12 descriptors, each in [0,1]. */
export function descriptors(ctx: PlanningContext, s: Schedule): Float64Array {
  const f = planFacts(ctx, s);
  const m = mean(f.kcal);
  let v = 0;
  for (let i = 0; i < f.kcal.length; i++) v += (f.kcal[i]! - m) ** 2;
  const cv = m > 0 ? Math.sqrt(v / f.kcal.length) / m : 0;
  let kc = 0;
  let cc = 0;
  for (let i = 0; i < f.kcal.length; i++) {
    kc += f.kcal[i]!;
    cc += f.carbKcal[i]!;
  }
  let fl = 0;
  for (let i = 0; i < f.fastedH.length; i++) fl += f.zero[i] ? 1 : Math.max(0, f.fastedH[i]! - 10) / 14;
  const cardio = mean(f.cardioMin) * 7;
  const sets = mean(f.rtSets) * 7;
  return Float64Array.of(
    clamp01(cv / 0.6),
    clamp01(kc > 0 ? cc / kc / 0.6 : 0),
    clamp01(fl / Math.max(1, f.fastedH.length)),
    cardio + sets > 0 ? clamp01(cardio / (cardio + 3 * sets)) : 0.5,
  );
}

/** Index of the block-family bit set in `features()` and the bit of the zero-intake family (fast events, zero days). */
const FAMILY_FEATURE = 15;
const ZERO_INTAKE_BIT = 1 << FAMILIES.indexOf('zeroIntake');

/** True when an evaluated plan's features show a planned fast (an event or a zero-energy day), not just a short window. */
export function featuresHaveFast(features: ArrayLike<number> | undefined): boolean {
  const f = features?.[FAMILY_FEATURE];
  return f !== undefined && ((f >>> 0) & ZERO_INTAKE_BIT) !== 0;
}

/** Gower schema matching `features()` (18 §4.12 weights: 2 for b₁-b₃, multi-day fast, breaks, families). */
export const FEATURE_SCHEMA: readonly FeatureSpec[] = [
  { kind: 'numeric', weight: 2 },
  { kind: 'numeric', weight: 2 },
  { kind: 'numeric', weight: 2 },
  { kind: 'numeric', weight: 1 },
  { kind: 'numeric' }, // mean energy %
  { kind: 'numeric' }, // mean protein g/kg
  { kind: 'numeric' }, // RT sessions / week
  { kind: 'numeric' }, // cardio min / week
  { kind: 'numeric' }, // mean steps
  { kind: 'numeric' }, // mean window length
  { kind: 'circular', period: 24 }, // mean window start
  { kind: 'numeric' }, // number of phases
  { kind: 'categorical', weight: 2 }, // has multi-day fast
  { kind: 'categorical', weight: 2 }, // has maintenance breaks
  { kind: 'categorical' }, // fasted-cardio share ≥ 0.5
  { kind: 'set', weight: 2 }, // block families
];

export function features(ctx: PlanningContext, s: Schedule): Float64Array {
  const f = planFacts(ctx, s);
  const b = descriptors(ctx, s);
  const T = f.kcal.length;
  let fam = 0;
  const addFam = (x: BlockFamily) => {
    const k = FAMILIES.indexOf(x);
    if (k >= 0) fam |= 1 << k;
  };
  for (const id of f.blockRuns) addFam(BLOCKS[id]?.family ?? 'maintenance');
  // overlays and events are lever families of their own (18 §4.12 "set of block families used")
  if ((s.events ?? []).length || f.zero.some((z, d) => z === 1 && s.programs[s.days[d]!.program]?.energy.kind === 'zero')) addFam('zeroIntake');
  if (s.programs.some((p) => p.label.includes('refeed day'))) addFam('refeed');
  const cardio = mean(f.cardioMin) * 7;
  const fasted = mean(f.fastedCardioMin) * 7;
  return Float64Array.of(
    b[0]!,
    b[1]!,
    b[2]!,
    b[3]!,
    (100 * mean(f.kcal)) / ctx.rp.tdee0Kcal,
    mean(f.proteinG) / ctx.caps.rwKg,
    (mean(f.rtSessions) * 7),
    cardio,
    mean(f.steps),
    mean(f.windowLen),
    mean(f.windowStart),
    f.blockRuns.length,
    f.eventHours.some((h) => h > 24) ? 1 : 0,
    f.blockRuns.includes('B8') ? 1 : 0,
    cardio > 0 && fasted / cardio >= 0.5 ? 1 : 0,
    fam >>> 0,
  ).map((x) => (T ? x : 0));
}

/** 18 §4.9 complexity counts from the schedule and repair log. */
/** Complexity counts per schedule object (the regulariser and the difficulty axis both read them; the log is unused). */
const countsCache = new WeakMap<Schedule, ComplexityCounts>();

export function complexityCounts(ctx: PlanningContext, s: Schedule, log: readonly RepairEntry[]): ComplexityCounts {
  const hit = countsCache.get(s);
  if (hit) return hit;
  const f = planFacts(ctx, s);
  const T = s.horizonDays;
  const perPhase = new Map<string, Set<number>>();
  for (const b of s.blocks ?? []) {
    const key = `${b.buildingBlockId ?? 'B0'}`;
    let set = perPhase.get(key);
    if (!set) perPhase.set(key, (set = new Set()));
    for (let d = b.startDay; d < Math.min(T, b.endDay); d++) set.add(s.days[d]!.program);
  }
  let shift = 0;
  for (let d = 1; d < T; d++) {
    if (f.zero[d] || f.zero[d - 1]) continue;
    const a = Math.abs(f.windowStart[d]! - f.windowStart[d - 1]!) % 24;
    shift += Math.min(a, 24 - a);
  }
  let same = 0;
  for (let d = 7; d < T; d++) if (f.dayKey[d] === f.dayKey[d - 7]) same++;
  const eventCosts: number[] = [];
  for (const e of s.events ?? []) eventCosts.push((e.durationH > 24 ? LEVER_INDEX.get('waterFast') : LEVER_INDEX.get('fastDay24'))!.complexityCost({ durationH: e.durationH + 1 }));
  void log;
  const out: ComplexityCounts = {
    dayTypesPerPhase: [...perPhase.values()].map((x) => x.size),
    distinctPhases: new Set(f.blockRuns).size,
    phaseTransitions: Math.max(0, f.blockRuns.length - 1),
    horizonDays: T,
    eventComplexityCosts: eventCosts,
    meanWindowStartShiftH: T > 1 ? shift / T : 0,
    distinctTrainingClockTimes: Math.max(1, f.trainingClock.size),
    weekRepeatShare: T > 7 ? same / (T - 7) : 1,
  };
  countsCache.set(s, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// lifestyle features φ_life (planner v2 difficulty axis, PLANNER_V2_SPEC §1.1 component 7)
// ---------------------------------------------------------------------------------------------------------------

/** The lifestyle subset of the plan features, in vector order (habit distance of the difficulty axis). */
export const LIFE_FEATURES = [
  'windowStart', 'windowLength', 'meals', 'steps', 'rtSessions', 'cardioMin', 'trainingClock', 'bedTime', 'wakeTime', 'energyPct', 'proteinGPerKg', 'carbShare',
] as const;
export type LifeFeatureId = (typeof LIFE_FEATURES)[number];
/** Clock features (circular, period 24 h). */
export const LIFE_CIRCULAR: readonly boolean[] = [true, false, false, false, false, false, true, true, true, false, false, false];

const lifeCache = new WeakMap<Schedule, Float64Array>();

/** Signed shortest clock difference to − from, h. */
function clockDelta(from: number, to: number): number {
  const d = (((to - from) % 24) + 24) % 24;
  return d > 12 ? d - 24 : d;
}

/**
 * φ_life of a schedule (cached per schedule object): eating-window start (circular mean over non-fast eating days),
 * window length and meals per day over the same days, mean steps, resistance sessions and cardio minutes a week, the
 * first session's clock (circular mean over training days; NaN without training), bed and wake time (circular), mean
 * energy as % of the habitual intake, protein g/kg reference weight and the carbohydrate share of energy.
 */
export function lifeFeatures(ctx: PlanningContext, s: Schedule): Float64Array {
  const hit = lifeCache.get(s);
  if (hit) return hit;
  const f = planFacts(ctx, s);
  const T = f.kcal.length;
  let nE = 0;
  let wsRef = Number.NaN;
  let ws = 0;
  let wl = 0;
  let ml = 0;
  let nS = 0;
  let ssRef = Number.NaN;
  let ss = 0;
  const bedRef = T ? f.bedH[0]! : 0;
  const wakeRef = T ? f.wakeH[0]! : 0;
  let bd = 0;
  let wk = 0;
  let steps = 0;
  let rt = 0;
  let cm = 0;
  let kc = 0;
  let pr = 0;
  let cc = 0;
  for (let d = 0; d < T; d++) {
    if (!f.fastDay[d] && f.mealsN[d]! > 0) {
      if (nE === 0) wsRef = f.windowStart[d]!;
      ws += clockDelta(wsRef, f.windowStart[d]!);
      wl += f.windowLen[d]!;
      ml += f.mealsN[d]!;
      nE++;
    }
    const s0 = f.sessionStart[d]!;
    if (s0 === s0) {
      if (nS === 0) ssRef = s0;
      ss += clockDelta(ssRef, s0);
      nS++;
    }
    bd += clockDelta(bedRef, f.bedH[d]!);
    wk += clockDelta(wakeRef, f.wakeH[d]!);
    steps += f.steps[d]!;
    rt += f.rtSessions[d]!;
    cm += f.cardioMin[d]!;
    kc += f.kcal[d]!;
    pr += f.proteinG[d]!;
    cc += f.carbKcal[d]!;
  }
  const n = Math.max(1, T);
  const clock = (ref: number, sum: number, k: number) => (k ? (((ref + sum / k) % 24) + 24) % 24 : Number.NaN);
  const out = Float64Array.of(
    clock(wsRef, ws, nE),
    nE ? wl / nE : Number.NaN,
    nE ? ml / nE : Number.NaN,
    steps / n,
    (7 * rt) / n,
    (7 * cm) / n,
    clock(ssRef, ss, nS),
    clock(bedRef, bd, T),
    clock(wakeRef, wk, T),
    (100 * kc) / n / ctx.rp.tdee0Kcal,
    pr / n / ctx.caps.rwKg,
    kc > 0 ? cc / kc : 0,
  );
  lifeCache.set(s, out);
  return out;
}
