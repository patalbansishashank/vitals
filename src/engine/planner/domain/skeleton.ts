/**
 * Plan skeletons (dossier 18 §4.4.3) enumerated from the block grammar (18 §4.11 "Skeleton grammar"), their genome
 * layouts, prior scores and the structural moves used by the S4 structural emitter.
 *
 *   Plan := Segment{1..3};  Segment := Phase(block) | Cycle(on-block, diet break) ;  + ≤ 1 overlay, ≤ 1 event kind
 *
 * Pruning (18 §4.11): block tiers and consent (17 via `SafetyCaps`), feasibility of the block's energy envelope under
 * the deficit cap and energy floor, block duration ranges vs the horizon, user exclusions, goal relevance (20 §4C
 * fasting rule), and the 13 §4C sequencing rules. Structures are ordered by a prior score (goal match, evidence grade,
 * simplicity) so tier S screens the most relevant first.
 */
import type { DiscreteGene } from '../optim/cmaes';
import type { PlanStructure } from '../optim/types';
import type { Rng } from '../optim/rng';
import { BLOCKS, type BlockId, type SafetyTier } from './registry/blocks';
import { LEVER_INDEX } from './registry/levers';
import type { GoalClass, PlanningContext } from './context';
import { HC } from './safety';
import { gateOn } from './gates';
import { WATER_FAST_VARIANTS, eventPeriodDays, recoveryDayCount, type WaterFastH } from './fastMath';
import { refeedRamp } from '../../core/compileSchedule';
import { equipmentHeavyOk, equipmentSetsCap } from './equipment';
import { IDEAL_SLEEP, sleepMidpointRange } from './ideal';

export type PhaseBlockId = 'B0' | 'B1' | 'B2' | 'B3' | 'B6' | 'B11' | 'B12' | 'B21' | 'B22' | 'B23' | 'B24';
export type CycleOnBlockId = 'B1' | 'B2' | 'B6';

export type SegmentSkeleton =
  | { readonly kind: 'phase'; readonly block: PhaseBlockId; readonly perWeek?: number }
  | { readonly kind: 'cycle'; readonly on: CycleOnBlockId; readonly off: 'B8' };

export type OverlaySkeleton = { readonly lever: 'refeedDay'; readonly days: 1 | 2 } | { readonly lever: 'fastDay24'; readonly perWeek: 1 | 2 };

/**
 * Phase blocks that host each overlay (13 §4C B9 allowedInBlocks; B13 delivers part of a deficit). Ruling R-FAST-GATE
 * (2026-10-01; PLANNER_V2_SPEC §3.1): the 24-h fast also sits in very-low-carbohydrate (B2), mild-deficit (B24) and
 * maintenance phases (B0, B22) — a zero-intake day keeps a ketogenic phase ketogenic, and a transient-marker goal
 * (autophagy signal, ketones, IGF-1) is served by fasts at maintenance too. The 7-day deficit cap and kcal floor are
 * evaluated on non-fast days (ruling 18:10); the decoder raises a host phase's eating days so the 28-day mean keeps the
 * intake floor, and the 28-day tissue-mass rate cap and the fasting-tier rules govern the fast days, exactly as for
 * B1/B3/B6. Surplus phases (B21, B23) never carry fasts (20 §4C). Refeed days stay deficit-only and out of B2 (a refeed
 * breaks ketosis for 2-5 d, 13 §4C B9).
 */
export const OVERLAY_HOSTS: Readonly<Record<OverlaySkeleton['lever'], readonly BlockId[]>> = {
  refeedDay: ['B1', 'B3', 'B6'],
  fastDay24: ['B0', 'B1', 'B2', 'B3', 'B6', 'B22', 'B24'],
};
export interface EventSkeleton {
  readonly lever: 'waterFast';
  readonly durationH: WaterFastH;
}

export interface PlanSkeleton {
  /** The status-quo plan (desirability 0, 18 §4.6): habitual intake at maintenance, habitual activity. */
  readonly baseline: boolean;
  readonly segments: readonly SegmentSkeleton[];
  readonly overlay: OverlaySkeleton | null;
  readonly event: EventSkeleton | null;
  readonly creatine: boolean;
  readonly omega3: boolean;
  readonly viscousFibre: boolean;
  readonly sleepExtension: boolean;
}

export interface GeneSpec {
  readonly path: string;
  readonly kind: 'real' | 'int';
  /** Nominal range (the decoder may narrow it at run time, e.g. energy under the deficit cap). */
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  /** Friendly rounding grid in value units (18 §4.2). */
  readonly grid?: number;
  /** Block default (value units). */
  readonly def: number;
}

/** A skeleton with its genome layout: the `PlanStructure` the optimiser sees (MODEL_SPEC §10.1). */
export interface SkeletonStructure extends PlanStructure {
  readonly id: string;
  readonly dim: number;
  readonly x0: Float64Array;
  readonly discrete: readonly DiscreteGene[];
  readonly skeleton: PlanSkeleton;
  readonly genes: readonly GeneSpec[];
  readonly geneIndex: Readonly<Record<string, number>>;
  readonly prior: number;
}

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function segmentBlocks(s: SegmentSkeleton): BlockId[] {
  return s.kind === 'phase' ? [s.block] : [s.on, s.off];
}

export function skeletonBlocks(sk: PlanSkeleton): BlockId[] {
  const out: BlockId[] = [];
  for (const s of sk.segments) for (const b of segmentBlocks(s)) if (!out.includes(b)) out.push(b);
  return out;
}

/** Minimum weeks of a segment (block minimum or 2 weeks, 18 §4.9 "usually ≥ 2"). */
export function segmentMinWeeks(s: SegmentSkeleton): number {
  if (s.kind === 'cycle') return (BLOCKS[s.on].durationWeeks?.min ?? 2) + (s.on === 'B2' ? 2 : 1);
  return Math.max(BLOCKS[s.block].durationWeeks?.min ?? 2, 2);
}

export function segmentMaxWeeks(s: SegmentSkeleton): number {
  if (s.kind === 'cycle') return Infinity;
  return BLOCKS[s.block].durationWeeks?.max ?? Infinity;
}

/** Energy role of a phase block for gating. */
function isDeficit(b: BlockId): boolean {
  return BLOCKS[b].energyRole === 'deficit' || b === 'B2' || b === 'B6';
}

/** 11 §9: largest planned surplus, kcal/d. */
export const SURPLUS_MAX_KCAL = 500;

/** Allowed energy range (% of maintenance) of a block's normal days after 17 caps (decoder clamp layer 2). */
export function energyRange(ctx: PlanningContext, b: BlockId): { lo: number; hi: number } {
  const blk = BLOCKS[b];
  const e = blk.energyPct ?? { min: 100, max: 100 };
  const caps = ctx.caps;
  const floorPct = (100 * caps.energyFloorKcal) / caps.tdee0Kcal;
  let lo = e.min;
  let hi = Math.min(e.max, caps.maxPctTdee);
  // 11 §9: the planner never prescribes more than ≈ +500 kcal/d (larger surpluses add mostly fat)
  if (blk.energyRole === 'surplus') hi = Math.min(hi, 100 + (100 * SURPLUS_MAX_KCAL) / caps.tdee0Kcal, caps.surplusPhaseMaxPct);
  if (e.min < 100) lo = Math.max(lo, 100 - caps.deficitCapPct, floorPct);
  if (caps.deficitCapPct <= 0) lo = Math.max(lo, 100);
  return { lo, hi };
}

/**
 * Protein range g/kg for a block (B1: untrained range when no resistance training can be planned). With resistance
 * training and a muscle goal or a deficit block, at least 1.6 g/kg (09 §4.8/§9: f_P plateaus at 1.6; plan 1.6-2.2 with
 * RT, more in a deficit; 08 §4.15 muscle-first rule).
 */
export function proteinRange(ctx: PlanningContext, b: BlockId): { lo: number; hi: number } {
  const blk = BLOCKS[b];
  const r = (b === 'B1' || b === 'B24') && ctx.practical.rtDays.max === 0 ? blk.proteinGPerKgBwUntrained ?? blk.proteinGPerKgBw : blk.proteinGPerKgBw;
  let lo = Math.max(r?.min ?? 1.2, 0);
  const hi = Math.min(r?.max ?? 2.2, ctx.caps.proteinCapRw, Math.max((HC.proteinPlanCapGPerKgFfm * ctx.caps.ffmKg) / ctx.caps.rwKg, ctx.caps.proteinFloorDeficitRw));
  const rtFloor = ctx.practical.rtDays.max > 0 && (ctx.classRank.muscle !== undefined || blk.energyRole === 'deficit' || blk.energyRole === 'surplus' || ctx.classRank.fatLoss !== undefined);
  if (rtFloor) lo = Math.max(lo, 1.6);
  return { lo: Math.min(lo, hi), hi };
}

/** Planner tier of a block with consent: usable when default, or optIn with consent (fasting tiers carry consent). */
function blockUsable(ctx: PlanningContext, b: BlockId): boolean {
  if (ctx.practical.excluded.has(b) && gateOn(ctx, 'user.excluded')) return false;
  const t: SafetyTier = BLOCKS[b].tier(ctx.caps);
  return t === 'default' || t === 'optIn' || !gateOn(ctx, 'block.tier');
}

function leverUsable(ctx: PlanningContext, id: string, p: Record<string, number | string> = {}): boolean {
  if (ctx.practical.excluded.has(id) && gateOn(ctx, 'user.excluded')) return false;
  const l = LEVER_INDEX.get(id);
  if (!l || (!l.plannerUsable && gateOn(ctx, 'lever.noEngineChannel'))) return false;
  const t = l.tier(ctx.caps, p);
  if (t === 'never' && gateOn(ctx, 'lever.tier')) return false;
  // expert-tier fasts: the tier function already requires expert mode + attestation (fastAllowed); nothing else is expert
  if (t === 'expert' && l.family !== 'zeroIntake' && gateOn(ctx, 'lever.expertOnlyFasts')) return false;
  if (t === 'optIn' && l.family !== 'zeroIntake' && !(ctx.caps.optInLevers.has(id) || ctx.caps.optInLevers.has(l.family)) && gateOn(ctx, 'lever.optInConsent')) return false;
  return true;
}

/**
 * Supplement consent (QA LIV-13; SUITE_SPEC §8.5 "opt-in only, after the food first or supplements? question"): a
 * supplement lever is prescribed only when the person opted in to it (`safety.optIns.levers` holds its id or family).
 * Creatine's registry tier is 'default' (safe for most people), but a safe supplement is still a product the person did
 * not ask for. Consent, so the Ideal keeps it too (PLANNER_V2_SPEC §2.1).
 */
export const CONSENT_SUPPLEMENTS: Readonly<Record<string, string>> = { L7: 'creatine' };

export function supplementConsent(ctx: Pick<PlanningContext, 'caps'> & { readonly disabledGates?: ReadonlySet<string> }, id: keyof typeof CONSENT_SUPPLEMENTS): boolean {
  const fam = CONSENT_SUPPLEMENTS[id]!;
  return ctx.caps.optInLevers.has(id) || ctx.caps.optInLevers.has(fam) || !gateOn(ctx, 'lever.optInConsent');
}

/** Feasibility of a phase block for the person (energy envelope after caps; B11/B12 weekly-mean checks). */
export function phaseFeasible(ctx: PlanningContext, s: SegmentSkeleton): boolean {
  for (const b of segmentBlocks(s)) {
    if (!blockUsable(ctx, b)) return false;
    const r = energyRange(ctx, b);
    if (r.hi < r.lo - 1e-9 && gateOn(ctx, 'block.energyEnvelope')) return false;
  }
  if (s.kind === 'phase' && s.block === 'B11' && gateOn(ctx, 'B11.weeklyFloor')) {
    // weekly mean (5·p + 2·k)/7 ≥ max(100 − cap, floor) with p ≤ 100 and k ≤ 700 kcal (and k within the HC-E2 band)
    const caps = ctx.caps;
    const need = Math.max(100 - caps.deficitCapPct, (100 * caps.energyFloorKcal) / caps.tdee0Kcal);
    const kMax = Math.min(700, caps.restrictedDayUpperKcal);
    const kMin = Math.max(500, caps.restrictedDayMinKcal);
    if (kMin > kMax) return false;
    const best = (5 * 100 + (2 * 100 * kMax) / caps.tdee0Kcal) / 7;
    if (best < need) return false;
  }
  if (s.kind === 'phase' && s.block === 'B12' && gateOn(ctx, 'B12.intakeFloor28')) {
    // zero days are opted-in fasts (ruling 18:10): the weekly mean only has to meet the 28-day intake floor
    const z = s.perWeek ?? 2;
    const caps = ctx.caps;
    const best = ((7 - z) * Math.min(120, caps.maxPctTdee)) / 7;
    if (best < (100 * caps.energyFloorKcal) / caps.tdee0Kcal) return false;
  }
  if (s.kind === 'phase' && (s.block === 'B3' || s.block === 'B23') && ctx.practical.rtDays.max < (BLOCKS[s.block].minRtSessions ?? 3) && gateOn(ctx, 'block.minRtSessions')) return false;
  return true;
}

/**
 * Best-case 28-day planned mean (% of maintenance) around one fast (ruling 18:10: an opted-in fast is governed by the
 * tier rules and a 28-day mean-intake floor, not by the 7-day floor or deficit cap): zero days, the refeed ramp at
 * ≤ 100 %, all other days at the surplus cap.
 */
function event28BestPct(ctx: PlanningContext, durationH: number): number {
  const zeroDays = durationH / 24;
  const ramp = refeedRamp(durationH);
  const rec = Math.max(recoveryDayCount(durationH), ramp.length);
  let rampSum = 0;
  for (let i = 0; i < rec; i++) rampSum += 100 * (ramp[i] ?? 1);
  const others = Math.max(0, 28 - zeroDays - rec);
  return (rampSum + others * Math.min(120, ctx.caps.maxPctTdee)) / 28;
}

export const BLOCK_OF_FAST: Readonly<Record<WaterFastH, BlockId>> = { 48: 'B14', 72: 'B15', 120: 'B16', 168: 'B16' };

function eventFeasible(ctx: PlanningContext, durationH: WaterFastH): boolean {
  if (!ctx.fastingRelevant) return false;
  if (!leverUsable(ctx, 'waterFast', { durationH })) return false;
  if (ctx.practical.excluded.has(BLOCK_OF_FAST[durationH]) && gateOn(ctx, 'user.excluded')) return false;
  if (event28BestPct(ctx, durationH) < (100 * ctx.caps.energyFloorKcal) / ctx.caps.tdee0Kcal && gateOn(ctx, 'fast.intakeFloor28')) return false;
  return !gateOn(ctx, 'fast.horizonFits') || ctx.horizonDays >= Math.ceil(durationH / 24) + recoveryDayCount(durationH) + 7;
}

// ---------------------------------------------------------------------------------------------------------------
// gene layout
// ---------------------------------------------------------------------------------------------------------------

/** 09 §4.1 presets (core/defaults RT_PRESETS): light 5 … high 18 effective sets per region per week; 09 §9 planner cap 20. */
export const RT_SETS_RANGE = { min: 5, max: 20 } as const;

/** Resistance-training prescription range for the ranked goals (dossier 09 §4.2, §4.3, §4.8, §4.14; §9 planner defaults). */
export interface RtPrescription {
  sessionsMin: number;
  setsMin: number;
  setsMax: number;
  /** Load, % 1RM, and the session style (energy-cost category). */
  loadPct: number;
  style: 'general' | 'heavyCompound';
}

/**
 * Productive training ranges by goal (QA item 9: never 1 × 5 sets for a muscle goal):
 *  - muscle gain / keep in the top two goals: ≥ 2 sessions (09 §4.3 frequency f_F 0.9 at 1×), 10-20 hard sets per muscle
 *    group a week (09 §4.2: "hypertrophy enhanced by ≥ 10 sets/wk"; "12-20 sets is a reasonable default"; §9 cap 20-25);
 *  - a lower-ranked muscle goal: ≥ 8 sets; strength: ≥ 3 sessions where allowed (strength rises with frequency, 09 §4.3),
 *    6-16 sets at ≈ 82 % 1RM (09 §4.14 load factor 1.0 at ≥ 80 %), heavy compound style;
 *  - fat loss: resistance training retained, ≥ 2 sessions and ≥ 6 sets (09 §4.8/§4.10 lean retention in a deficit).
 * The user's training-day range and session length always win (the set ceiling is also capped by session time).
 */
export function rtPrescription(ctx: PlanningContext): RtPrescription {
  const p = ctx.practical;
  const cr = ctx.classRank;
  const muscle = cr.muscle;
  const strength = ctx.goals.some((g) => g.metric === 'strength' && g.direction !== 'minimise');
  let sessionsMin = 0;
  let setsMin: number = RT_SETS_RANGE.min;
  if (cr.fatLoss !== undefined) {
    sessionsMin = 2;
    setsMin = 6;
  }
  if (muscle !== undefined) {
    sessionsMin = 2;
    setsMin = Math.max(setsMin, muscle <= 1 ? 10 : 8);
  }
  if (strength) {
    sessionsMin = Math.max(sessionsMin, 3);
    setsMin = Math.max(setsMin, 6);
  }
  return {
    sessionsMin: Math.min(Math.max(sessionsMin, p.rtDays.min), p.rtDays.max),
    setsMin,
    setsMax: strength && muscle === undefined ? 16 : RT_SETS_RANGE.max,
    // §8.2: 82 % 1RM only when the person's equipment reaches ≥ 80 % in some region (always without a training profile)
    loadPct: strength && equipmentHeavyOk(ctx) ? 82 : 70,
    style: strength && equipmentHeavyOk(ctx) ? 'heavyCompound' : 'general',
  };
}
/** 10 §4.8 moderate-equivalent %VO2max bands by modality (core/defaults comment; DERIVED). */
export const CARDIO_BANDS: Record<string, { min: number; max: number }> = {
  walk: { min: 0.4, max: 0.55 },
  run: { min: 0.7, max: 0.85 },
  cycle: { min: 0.55, max: 0.7 },
  swim: { min: 0.55, max: 0.7 },
  row: { min: 0.55, max: 0.7 },
  other: { min: 0.55, max: 0.7 },
  hiit: { min: 0.55, max: 0.7 },
};
/** 18 §4.2 fibre search range, g/d. */
export const FIBRE_RANGE = { min: 15, max: 45 } as const;

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

function phaseGenes(ctx: PlanningContext, prefix: string, b: BlockId, out: GeneSpec[]): void {
  const blk = BLOCKS[b];
  if (b === 'B8') return; // protein unchanged, energy 100 %
  if (blk.energyPct && blk.energyPct.min < blk.energyPct.max) {
    const r = energyRange(ctx, b);
    out.push({ path: `${prefix}.energy`, kind: 'real', min: blk.energyPct.min, max: blk.energyPct.max, unit: '%', grid: 1, def: mid(r.lo, r.hi) });
  }
  const pr = proteinRange(ctx, b);
  out.push({ path: `${prefix}.protein`, kind: 'real', min: pr.lo, max: pr.hi, unit: 'g/kg', grid: 0.05, def: mid(pr.lo, pr.hi) });
  if (blk.carbG && blk.remainder === 'fat') {
    const lo = Math.max(blk.carbG.min, ctx.caps.carbFloorG);
    out.push({ path: `${prefix}.carbG`, kind: 'real', min: lo, max: Math.max(lo, blk.carbG.max), unit: 'g/d', grid: 5, def: mid(lo, Math.max(lo, blk.carbG.max)) });
  } else if (blk.fatGPerKgBw) {
    const f = blk.fatGPerKgBw;
    out.push({ path: `${prefix}.fat`, kind: 'real', min: f.min, max: f.max, unit: 'g/kg', grid: 0.05, def: mid(f.min, f.max) });
  }
  if (b === 'B11' && blk.energyKcal) {
    const lo = Math.max(blk.energyKcal.min, ctx.caps.restrictedDayMinKcal);
    const hi = Math.min(blk.energyKcal.max, ctx.caps.restrictedDayUpperKcal);
    out.push({ path: `${prefix}.lowKcal`, kind: 'real', min: lo, max: Math.max(lo, hi), unit: 'kcal', grid: 10, def: mid(lo, Math.max(lo, hi)) });
  }
}

function buildLayout(ctx: PlanningContext, sk: PlanSkeleton): GeneSpec[] {
  const g: GeneSpec[] = [];
  const p = ctx.practical;
  const rp = ctx.rp;
  if (sk.baseline) return g;
  // eating window: start within [earliest, latest − minWindow], length within [minWindow, min(14, latest − start)]
  const minW = ctx.caps.minWindowH;
  const habStart = clamp(rp.habits.habitualWindowStartH, p.earliestH, Math.max(p.earliestH, p.latestH - minW));
  g.push({ path: 'window.startH', kind: 'real', min: p.earliestH, max: Math.max(p.earliestH, p.latestH - minW), unit: 'clock h', grid: 0.5, def: habStart });
  const habLen = clamp(rp.habits.habitualWindowLengthH, minW, Math.min(14, p.latestH - habStart));
  g.push({ path: 'window.lengthH', kind: 'real', min: minW, max: Math.max(minW, Math.min(14, p.latestH - p.earliestH)), unit: 'h', grid: 0.5, def: habLen });
  if (p.meals.max > p.meals.min)
    g.push({ path: 'meals', kind: 'int', min: p.meals.min, max: p.meals.max, unit: 'meals', def: clamp(Math.round(rp.habits.habitualMealsPerDay), p.meals.min, p.meals.max) });
  if (p.rtDays.max > 0) {
    if (p.rtDays.max > p.rtDays.min) {
      const habRt = Math.round(rp.habits.sessionsPerWeek * (1 - rp.habits.lifingCardioMix));
      g.push({ path: 'rt.sessions', kind: 'int', min: p.rtDays.min, max: p.rtDays.max, unit: '/wk', def: clamp(Math.max(habRt, 2), p.rtDays.min, p.rtDays.max) });
    }
    // §8.2: the equipment envelope bounds the weekly dose (Infinity without a training profile → unchanged)
    const setsMax = Math.max(RT_SETS_RANGE.min, Math.min(RT_SETS_RANGE.max, equipmentSetsCap(ctx, p.rtDays.max)));
    g.push({ path: 'rt.sets', kind: 'real', min: RT_SETS_RANGE.min, max: setsMax, unit: 'sets/region/wk', grid: 1, def: Math.min(11, setsMax) });
  }
  if (p.cardioDays.max > 0) {
    if (p.cardioDays.max > p.cardioDays.min)
      g.push({ path: 'cardio.sessions', kind: 'int', min: p.cardioDays.min, max: p.cardioDays.max, unit: '/wk', def: clamp(1, p.cardioDays.min, p.cardioDays.max) });
    const maxMin = Math.min(90, p.maxSessionMin);
    g.push({ path: 'cardio.minutes', kind: 'real', min: 20, max: Math.max(20, maxMin), unit: 'min', grid: 5, def: clamp(40, 20, Math.max(20, maxMin)) });
    const band = CARDIO_BANDS[p.cardioModality] ?? CARDIO_BANDS.other!;
    // Ideal (§2.2): the modality is a gene over the modalities the caps allow; intensity spans their bands (the decoder
    // narrows it to the chosen modality's band)
    const modGene = !!p.idealGenes?.modality && p.idealModalities.length > 1;
    const iLo = modGene ? Math.min(...p.idealModalities.map((m) => (CARDIO_BANDS[m] ?? CARDIO_BANDS.other!).min)) : band.min;
    const iHi = modGene ? Math.max(...p.idealModalities.map((m) => (CARDIO_BANDS[m] ?? CARDIO_BANDS.other!).max)) : band.max;
    g.push({ path: 'cardio.intensity', kind: 'real', min: iLo, max: iHi, unit: 'fraction of VO2max', grid: 0.05, def: mid(band.min, band.max) });
    if (modGene) g.push({ path: 'cardio.modality', kind: 'int', min: 0, max: p.idealModalities.length - 1, unit: 'modality', def: Math.max(0, p.idealModalities.indexOf(p.cardioModality)) });
  }
  // Ideal (§2.2): the training clock is a gene on the 15-minute grid (the decoder keeps it inside the waking day)
  if (p.idealGenes?.clock && (p.rtDays.max > 0 || p.cardioDays.max > 0))
    g.push({ path: 'train.clockH', kind: 'real', min: 5, max: 22, unit: 'clock h', grid: 0.25, def: clamp(p.trainingTimeH, 5, 22) });
  if (p.steps.max > p.steps.min)
    g.push({ path: 'steps', kind: 'real', min: p.steps.min, max: p.steps.max, unit: 'steps/d', grid: 500, def: clamp(rp.habits.typicalSteps, p.steps.min, p.steps.max) });
  const habFibre = (rp.habits.habitualFibreGPer1000Kcal * rp.tdee0Kcal) / 1000;
  g.push({ path: 'fibre', kind: 'real', min: FIBRE_RANGE.min, max: FIBRE_RANGE.max, unit: 'g/d', grid: 1, def: clamp(habFibre, FIBRE_RANGE.min, FIBRE_RANGE.max) });
  if (sk.sleepExtension) g.push({ path: 'sleep.extraH', kind: 'real', min: 0.5, max: 1.5, unit: 'h', grid: 0.25, def: 1 });
  // Ideal (§2.2): sleep duration 7-8.5 h and midpoint ±1 h of the habit (moved toward 02:30-04:30), 15-minute grid
  if (p.idealGenes?.sleep) {
    const mr = sleepMidpointRange(p.bedH, p.wakeH);
    g.push({ path: 'sleep.durationH', kind: 'real', min: IDEAL_SLEEP.minH, max: IDEAL_SLEEP.maxH, unit: 'h', grid: IDEAL_SLEEP.grid, def: IDEAL_SLEEP.defH });
    g.push({ path: 'sleep.midpointH', kind: 'real', min: mr.lo, max: mr.hi, unit: 'clock h', grid: IDEAL_SLEEP.grid, def: mr.centre });
  }
  if (sk.creatine) g.push({ path: 'creatine.g', kind: 'real', min: 3, max: HC.creatineMaxG, unit: 'g/d', grid: 1, def: 4 });
  if (sk.omega3) g.push({ path: 'omega3.g', kind: 'real', min: 2, max: 3, unit: 'g/d', grid: 0.5, def: 2.5 });
  if (sk.viscousFibre) g.push({ path: 'viscous.g', kind: 'real', min: 5, max: 15, unit: 'g/d', grid: 1, def: 10 });

  // segments
  const n = sk.segments.length;
  sk.segments.forEach((s, i) => {
    const prefix = `seg${i}`;
    if (i < n - 1) {
      const lo = segmentMinWeeks(s);
      const hi = Math.max(lo, Math.min(segmentMaxWeeks(s), Math.floor(ctx.horizonDays / 7)));
      if (hi > lo) g.push({ path: `${prefix}.weeks`, kind: 'int', min: lo, max: hi, unit: 'wk', def: Math.round(mid(lo, hi)) });
    }
    if (s.kind === 'cycle') {
      const onLo = s.on === 'B2' ? 3 : 2;
      g.push({ path: `${prefix}.onWeeks`, kind: 'int', min: onLo, max: 12, unit: 'wk', def: Math.max(onLo, 4) });
      if (s.on !== 'B2') g.push({ path: `${prefix}.offWeeks`, kind: 'int', min: 1, max: 2, unit: 'wk', def: 2 });
      phaseGenes(ctx, prefix, s.on, g);
    } else {
      phaseGenes(ctx, prefix, s.block, g);
    }
  });
  if (sk.overlay?.lever === 'refeedDay') {
    g.push({ path: 'ov.pct', kind: 'real', min: 100, max: Math.min(120, ctx.caps.maxPctTdee), unit: '%', grid: 1, def: 110 });
    g.push({ path: 'ov.carb', kind: 'real', min: 6, max: 10, unit: 'g/kg', grid: 0.5, def: 8 });
  }
  if (sk.event) {
    const period = eventPeriodDays(sk.event.durationH);
    const maxCount = Math.max(1, Math.floor((ctx.horizonDays - 7) / period));
    g.push({ path: 'ev.pos', kind: 'real', min: 0, max: 1, unit: '', def: 0.25 });
    if (maxCount > 1) g.push({ path: 'ev.count', kind: 'int', min: 1, max: maxCount, unit: 'fasts', def: 1 });
  }
  return g;
}

function skeletonId(sk: PlanSkeleton): string {
  if (sk.baseline) return 'baseline';
  const seg = sk.segments.map((s) => (s.kind === 'phase' ? `${s.block}${s.perWeek ? `x${s.perWeek}` : ''}` : `cyc(${s.on}/${s.off})`)).join('>');
  const ov = sk.overlay ? (sk.overlay.lever === 'refeedDay' ? `+refeed${sk.overlay.days}` : `+fast24x${sk.overlay.perWeek}`) : '';
  const ev = sk.event ? `+fast${sk.event.durationH}h` : '';
  const flags = [sk.creatine ? 'cr' : '', sk.omega3 ? 'n3' : '', sk.viscousFibre ? 'vf' : '', sk.sleepExtension ? 'sl' : ''].filter(Boolean).join(',');
  return `${seg}${ov}${ev}${flags ? `[${flags}]` : ''}`;
}

/** Encode a value into [0,1] against a gene's nominal range. */
export function toUnit(g: GeneSpec, v: number): number {
  return g.max > g.min ? clamp((v - g.min) / (g.max - g.min), 0, 1) : 0.5;
}

export function makeStructure(ctx: PlanningContext, sk: PlanSkeleton, prior = 0): SkeletonStructure {
  const genes = buildLayout(ctx, sk);
  const geneIndex: Record<string, number> = {};
  genes.forEach((g, i) => (geneIndex[g.path] = i));
  const x0 = Float64Array.from(genes, (g) => toUnit(g, g.def));
  const discrete: DiscreteGene[] = [];
  genes.forEach((g, i) => {
    if (g.kind === 'int' && g.max > g.min) discrete.push({ index: i, levels: Math.round(g.max - g.min) + 1 });
  });
  return { id: skeletonId(sk), dim: genes.length, x0, discrete, skeleton: sk, genes, geneIndex, prior };
}

// ---------------------------------------------------------------------------------------------------------------
// enumeration
// ---------------------------------------------------------------------------------------------------------------

const GRADE_SCORE: Record<string, number> = { A: 1, B: 0.8, C: 0.55, D: 0.3 };

/** Goal-match weights of an energy role / feature per goal class (prior ordering only; PROPOSED). */
function classAffinity(c: GoalClass, sk: PlanSkeleton): number {
  const blocks = skeletonBlocks(sk);
  const hasDef = blocks.some(isDeficit);
  const hasSur = blocks.includes('B21') || blocks.includes('B23');
  const hasMaint = blocks.includes('B0') || blocks.includes('B22') || blocks.includes('B8');
  switch (c) {
    case 'fatLoss':
    case 'glycaemia':
    case 'tgBp':
      return (hasDef ? 1 : 0) - (hasSur ? 0.5 : 0);
    case 'muscle':
      return (hasSur ? 1 : 0) + (sk.creatine ? 0.3 : 0) + (hasMaint ? 0.3 : 0) - (sk.event || sk.overlay?.lever === 'fastDay24' ? 0.5 : 0);
    case 'weightGain':
      return hasSur ? 1 : 0;
    case 'transient':
      return (blocks.includes('B2') ? 0.8 : 0) + (sk.event ? 1 : 0) + (sk.overlay?.lever === 'fastDay24' ? 0.6 : 0) + (blocks.includes('B12') ? 0.6 : 0);
    case 'lipids':
      return (blocks.includes('B6') ? 1 : 0) + (sk.viscousFibre ? 0.5 : 0) + (hasDef ? 0.5 : 0);
    case 'comfort':
      return (hasMaint ? 0.6 : 0) + (sk.overlay?.lever === 'refeedDay' ? 0.4 : 0) + (sk.segments.some((s) => s.kind === 'cycle') ? 0.4 : 0);
    case 'expenditure':
      return hasMaint ? 0.8 : 0;
    case 'endurance':
      return hasMaint || hasSur ? 0.6 : 0.3;
    default:
      return 0;
  }
}

function priorScore(ctx: PlanningContext, sk: PlanSkeleton): number {
  if (sk.baseline) return Infinity;
  let s = 0;
  const K = ctx.goals.length;
  for (const g of ctx.goals) {
    const w = (K - g.index) / K;
    let a = 0;
    for (const c of g.classes) a = Math.max(a, classAffinity(c, sk));
    s += w * a;
  }
  let grade = 1;
  for (const b of skeletonBlocks(sk)) grade = Math.min(grade, GRADE_SCORE[BLOCKS[b].grade] ?? 0.5);
  s += 0.3 * grade;
  s -= 0.08 * (sk.segments.length - 1) + (sk.overlay ? 0.05 : 0) + (sk.event ? 0.1 : 0);
  s -= 0.02 * [sk.creatine, sk.omega3, sk.viscousFibre, sk.sleepExtension].filter(Boolean).length;
  return s;
}

function segmentSequenceOk(ctx: PlanningContext, segs: readonly SegmentSkeleton[]): boolean {
  const W = ctx.horizonDays / 7;
  let minSum = 0;
  let maxSum = 0;
  for (const s of segs) {
    if (!phaseFeasible(ctx, s)) return false;
    minSum += segmentMinWeeks(s);
    maxSum += segmentMaxWeeks(s);
  }
  if (minSum > Math.floor(W) && gateOn(ctx, 'segments.durationFit')) return false;
  if (maxSum < W - 1e-9 && gateOn(ctx, 'segments.durationFit')) return false;
  // 13 §4C rule 2: B2 ⇄ carbohydrate blocks not more often than every 14 d (adjacent B2 phases are merged anyway)
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]!;
    const b = segs[i]!;
    if (a.kind === 'phase' && b.kind === 'phase' && a.block === b.block && gateOn(ctx, 'sequence.noRepeat')) return false;
  }
  return true;
}

/** Enumerate, prune and order skeletons (index 0 is always the baseline). */
export function enumerateStructures(ctx: PlanningContext, maxStructures = 400): SkeletonStructure[] {
  const caps = ctx.caps;
  const p = ctx.practical;
  const baseline: PlanSkeleton = { baseline: true, segments: [{ kind: 'phase', block: 'B0' }], overlay: null, event: null, creatine: false, omega3: false, viscousFibre: false, sleepExtension: false };
  const out: SkeletonStructure[] = [makeStructure(ctx, baseline, Infinity)];
  if (caps.blocked || ctx.problems.length) return out;

  const deficit: PhaseBlockId[] = ['B1', 'B24', 'B2', 'B3', 'B6', 'B11'];
  const maint: PhaseBlockId[] = ['B0'];
  const patterns: SegmentSkeleton[][] = [];
  const ph = (block: PhaseBlockId, perWeek?: number): SegmentSkeleton => (perWeek ? { kind: 'phase', block, perWeek } : { kind: 'phase', block });
  for (const b of [...deficit, ...maint, 'B21' as const, 'B23' as const]) if (b !== 'B3' || !gateOn(ctx, 'B3.notAlone')) patterns.push([ph(b)]);
  // alternate zero-energy days when fasting is offered for a fat-loss or transient-marker goal (R-FAST-GATE)
  const served = ctx.fastingServedGoal === null ? undefined : ctx.goals.find((g) => g.index === ctx.fastingServedGoal);
  if (ctx.fastingRelevant && (!gateOn(ctx, 'zeroDays.servedClass') || (served && (served.classes.includes('fatLoss') || served.classes.includes('transient'))))) {
    patterns.push([ph('B12', 2)], [ph('B12', 2), ph('B22')]);
  }
  for (const b of deficit) patterns.push([ph(b), ph('B22')]);
  for (const on of ['B1', 'B2', 'B6'] as const) patterns.push([{ kind: 'cycle', on, off: 'B8' }]);
  patterns.push([ph('B21'), ph('B1')], [ph('B1'), ph('B21')], [ph('B2'), ph('B1')], [ph('B6'), ph('B1')]);
  // lean gain (09 §4.8, 11 §4.8): a small surplus alone, after a cut, or followed by a short cut back toward the start fat
  patterns.push([ph('B23'), ph('B1')], [ph('B1'), ph('B23')]);
  patterns.push([{ kind: 'cycle', on: 'B1', off: 'B8' }, ph('B22')]);

  const hasClass = (c: GoalClass) => ctx.classRank[c] !== undefined;
  const creatineOpts =
    (hasClass('muscle') || !gateOn(ctx, 'creatine.muscleGoal')) && (p.rtDays.max > 0 || !gateOn(ctx, 'creatine.withTraining')) && leverUsable(ctx, 'L7') && supplementConsent(ctx, 'L7') ? [false, true] : [false];
  const omega3 = (hasClass('tgBp') || !gateOn(ctx, 'omega3.tgBpGoal')) && leverUsable(ctx, 'L8');
  const viscous = (hasClass('lipids') || !gateOn(ctx, 'viscousFibre.lipidGoal')) && leverUsable(ctx, 'L9');
  // the Ideal's sleep genes replace the sleep-extension lever (§2.2)
  const sleepExt =
    (!p.sleepFixed || !gateOn(ctx, 'sleep.fixed')) && !p.idealGenes?.sleep && (p.habitualSleepH < 7 || !gateOn(ctx, 'sleepExtension.shortSleep')) && leverUsable(ctx, 'L5');

  const overlays: (OverlaySkeleton | null)[] = [null];
  const notExcluded = (b: string) => !p.excluded.has(b) || !gateOn(ctx, 'user.excluded');
  if (leverUsable(ctx, 'refeedDay') && notExcluded('B9')) overlays.push({ lever: 'refeedDay', days: 1 }, { lever: 'refeedDay', days: 2 });
  if (ctx.fastingRelevant && leverUsable(ctx, 'fastDay24') && notExcluded('B13')) overlays.push({ lever: 'fastDay24', perWeek: 1 }, { lever: 'fastDay24', perWeek: 2 });
  const events: (EventSkeleton | null)[] = [null];
  for (const d of WATER_FAST_VARIANTS) if (eventFeasible(ctx, d)) events.push({ lever: 'waterFast', durationH: d });

  const seen = new Set<string>();
  const cands: { sk: PlanSkeleton; prior: number; id: string }[] = [];
  for (const segs of patterns) {
    if (!segmentSequenceOk(ctx, segs)) continue;
    const blocks = segs.flatMap(segmentBlocks);
    for (const ov of overlays) {
      // overlays live inside their host phases
      if (ov && gateOn(ctx, ov.lever === 'refeedDay' ? 'refeed.deficitOnly' : 'fast24.hosts') && !blocks.some((b) => OVERLAY_HOSTS[ov.lever].includes(b))) continue;
      if (ov?.lever === 'refeedDay' && blocks.includes('B2') && gateOn(ctx, 'refeed.notInVeryLowCarb')) continue; // a refeed breaks ketosis for 2-5 d (13 §4C B9)
      for (const ev of events) {
        if (ev && (blocks.includes('B21') || blocks.includes('B23')) && gateOn(ctx, 'surplus.noFasts')) continue; // never for muscle-gain phases (20 §4C)
        if (ev && blocks.includes('B12') && gateOn(ctx, 'zeroDays.noMultiDayFast')) continue; // zero days twice a week leave no room for a multi-day fast's eating gap (HC-F2)
        // two low-energy days every week leave at most 3 plain days in a row, never the span plus locked recovery a
        // multi-day fast needs: a plan made only of B11 phases could not place its fast (it decoded to no fast at all)
        if (ev && blocks.every((b) => b === 'B11') && gateOn(ctx, 'lowDays.noMultiDayFast')) continue;
        for (const cr of creatineOpts) {
          const sk: PlanSkeleton = { baseline: false, segments: segs, overlay: ov, event: ev, creatine: cr, omega3, viscousFibre: viscous, sleepExtension: sleepExt };
          const st = makeStructure(ctx, sk);
          if (seen.has(st.id)) continue;
          seen.add(st.id);
          cands.push({ sk, prior: priorScore(ctx, sk), id: st.id });
        }
      }
    }
  }
  cands.sort((a, b) => b.prior - a.prior || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of cands.slice(0, maxStructures - 1)) out.push(makeStructure(ctx, c.sk, c.prior));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// structural moves (S4 structural emitter) and genome transfer by path name
// ---------------------------------------------------------------------------------------------------------------

/** Structures reachable by one grammar move: block swap, overlay/event add/remove, phase split/merge, flag toggle. */
/**
 * Structures reachable by one grammar move (S4 structural emitter, 18 §4.12): swap a block / cycle ↔ phase / split or
 * merge a phase, add or remove the overlay, add, remove or change the event. Supplement flags (creatine, omega-3, viscous
 * fibre, sleep) ride along with any move, and an overlay the new block does not allow is dropped with the swap, so
 * e.g. "moderate deficit + refeeds + creatine" reaches "very-low-carbohydrate" in one move.
 */
export function neighbours(structures: readonly SkeletonStructure[], from: number): number[] {
  const a = structures[from]!.skeleton;
  const out: number[] = [];
  const segsA = JSON.stringify(a.segments);
  structures.forEach((s, i) => {
    if (i === from || s.skeleton.baseline) return;
    const b = s.skeleton;
    const segChanged = JSON.stringify(b.segments) !== segsA;
    if (segChanged && Math.abs(a.segments.length - b.segments.length) > 1) return;
    const ovChanged = JSON.stringify(a.overlay) !== JSON.stringify(b.overlay);
    const evChanged = JSON.stringify(a.event) !== JSON.stringify(b.event);
    // a segment swap may drop an overlay (never add one) in the same move
    const major = (segChanged ? 1 : 0) + (ovChanged && !(segChanged && b.overlay === null) ? 1 : 0) + (evChanged ? 1 : 0);
    if (major === 1) out.push(i);
  });
  return out;
}

export function mutateStructure(structures: readonly SkeletonStructure[], from: number, rng: Rng, cache?: Map<number, number[]>): number | null {
  let nb = cache?.get(from);
  if (!nb) {
    nb = neighbours(structures, from);
    cache?.set(from, nb);
  }
  if (nb.length === 0) return null;
  return nb[rng.int(nb.length)]!;
}

/** Continuous parameters inherited by path name (18 §4.12); segment genes map by block id where possible. */
export function transferGenome(fromS: SkeletonStructure, toS: SkeletonStructure, x: Float64Array): Float64Array {
  const out = Float64Array.from(toS.x0);
  // map segment prefixes by block of the segment
  const segKey = (sk: PlanSkeleton, i: number) => {
    const s = sk.segments[i]!;
    return s.kind === 'phase' ? s.block : `cyc:${s.on}`;
  };
  const fromSeg = new Map<string, number>();
  fromS.skeleton.segments.forEach((_, i) => fromSeg.set(segKey(fromS.skeleton, i), i));
  toS.genes.forEach((g, j) => {
    let path = g.path;
    const m = /^seg(\d+)\.(.*)$/.exec(path);
    if (m) {
      // same block → its segment; otherwise the segment at the same position (energy, protein … carry over by name)
      const pos = Number(m[1]);
      const key = segKey(toS.skeleton, pos);
      const src = fromSeg.get(key) ?? (pos < fromS.skeleton.segments.length ? pos : undefined);
      if (src === undefined) return;
      path = `seg${src}.${m[2]}`;
    }
    const i = fromS.geneIndex[path];
    if (i === undefined) return;
    const gi = fromS.genes[i]!;
    const v = gi.min + x[i]! * (gi.max - gi.min);
    out[j] = toUnit(g, v);
  });
  return out;
}

/** Goal classes present in the request that a structure serves (prior affinity > 0): the race's diversity guard (PLANNER_V2_SPEC §4.5). */
export function structureGoalClasses(ctx: PlanningContext, sk: PlanSkeleton): GoalClass[] {
  if (sk.baseline) return [];
  const present = [...new Set(ctx.goals.flatMap((g) => g.classes))];
  return present.filter((c) => classAffinity(c, sk) > 0);
}
