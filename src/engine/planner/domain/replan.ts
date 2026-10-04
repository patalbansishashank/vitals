/**
 * Receding-horizon re-plan of a living plan (docs/PLANNER_V2_SPEC.md §7; R6 §5, R11 §4) and the start bridge
 * `toActivePlan` (§9.3).
 *
 *  - Past immutable: days before `today` keep the active plan's prescription in the returned schedule; for the forward runs
 *    they are the logged days, replayed from the confirmed day-stamped snapshot with δ as an intake offset.
 *  - Lock window: today and tomorrow keep their prescription unless the plan from here would break a safety margin or the
 *    user asked ('user'); a `light` re-plan may move tomorrow's energy by at most ±10 %.
 *  - Horizon: shrinks to the plan end (at least 7 days left); goals keep their ABSOLUTE targets.
 *  - `light`: next 7 days only, structure and rung fixed, CMA-ES σ₀ 0.05, ≈ 1k EU; `weekly`: the remaining horizon,
 *    the structure or a grammar neighbour (all structures only when none is safe), σ₀ 0.10; `event` / `user`: the full
 *    search on the remaining horizon. Warm start from the active genome (same frame) or the genome shifted by the elapsed
 *    days (elapsed segments dropped, the current one shortened) and transferred by gene path.
 *  - Stability: the key (v_S, v_L, −⌊(G − G_keep)/q_G⌋, λ_S·C + R, −G) — churn C (Gower over the next 14 days) only
 *    breaks practical ties with the current plan; light/weekly hard limits (next-7-day energy ±10 %, sessions ±1, no new
 *    fast ≥ 24 h, no new day type) count as practical-limit violations v_L.
 *  - Safety: decoder repair, state-space margins of the run from today on, the independent validator, fasting spacing
 *    across the logged past, the P10/P90 energy-bias check and the Simulator-mode re-run (R-PLAN-SAFETY) of the result.
 *  - Load: automatic changes may only lower load; a result that raises load (deeper deficit or surplus, more training,
 *    a new or longer fast, more steps) comes back as status 'proposal'.
 *  - weekly/event/user objectives read the realistic projection (each item at its revealed expected credit).
 */
import { snapshotFatKg } from '../../assimilation/replay';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { ENGINE_VERSION } from '../../core/defaults';
import type { SeriesId } from '../../types/metrics';
import type { SimulationResult } from '../../types/result';
import type { DayTemplate, FastEvent, Schedule, ScheduleBlock, ScheduleDay } from '../../types/schedule';
import { GOAL_SCORE_STEP, rocWeights, type GoalSpec } from '../optim/goals';
import { TIER_BUDGET_EU, evaluatePlan, runPlanner, type PlannerConfig, type PlannerProblem, type Tier } from '../optim/pipeline';
import type { Rng } from '../optim/rng';
import type { EvalOutput, EvalRequest, Evaluator, PlanModel, RepairEntry, Repaired } from '../optim/types';
import { violation } from '../optim/types';
import { HORIZON_MAX_DAYS, HORIZON_MIN_DAYS, compileRequest, withHorizon, type PlanningContext } from './context';
import { estimateDay } from './dayMath';
import { decodePlan, gridStep as gridStepOf, roundGenome as roundGenomeOf } from './decode';
import { ruleText } from './explain';
import { FEATURE_SCHEMA, descriptors, features, planFacts, type PlanFacts } from './features';
import { buildGoals, goalSeries, goalValue, type BuiltGoals } from './goalSpecs';
import { DEFAULT_CUSHION, EnginePlanModel, MARGIN_IDS, MARGIN_NA, NOMINAL_ONLY_MARGINS, regulariserOf, stateMargins } from './model';
import { unlistableWarnings } from './planner';
import { firstSpacingViolation, zeroSpans, type ZeroSpan } from './repair';
import type {
  ActivePlanProvenance,
  ActivePlanRecord,
  ForecastGoalOutcome,
  ReplanDiffRow,
  ReplanFrame,
  ReplanGoalDate,
  ReplanKind,
  ReplanProposal,
  ReplanRequest,
  ReplanResult,
  ReplanTrigger,
} from './replanTypes';
import {
  ForwardModel,
  Z90,
  absoluteGoals,
  bandsOf,
  bindingsOf,
  crossingDay,
  dateAt,
  dayIndex,
  dayTemplate,
  creditSchedule,
  forecastRuns,
  futureView,
  goalOutcomes,
  goalSeriesIds,
  isoWeekday,
  realisticSchedule,
  sliceSchedule,
  withLength,
  SENSITIVITY_WINDOW_D,
  type ForwardMode,
  type ForecastRuns,
} from './sensitivities';
import { enumerateStructures, makeStructure, mutateStructure as mutate, neighbours, toUnit, transferGenome as transfer, type SkeletonStructure } from './skeleton';
import type { PlannerProgressV2, PlannerRequestV2, PlannerTier, RungPlan } from './types';
import { validatePlan } from './validate';

// ------------------------------------------------------------------------------------------------------------ constants

/** Re-plan constants (§7.2-§7.4; PROPOSED values marked in the spec). */
export const REPLAN = {
  /** Minimum days left in re-plan mode (§7.2). */
  minHorizonDays: 7,
  /** Today and tomorrow (§7.2). */
  lockDays: 2,
  /** `light` touches the next 7 days only. */
  lightDays: 7,
  /** `light` may move tomorrow's energy by at most this share (R11 §4.4). */
  lightTomorrowRel: 0.1,
  /** Churn distance window, days (§7.4). */
  churnDays: 14,
  /** λ_S [PROPOSED]. */
  lambdaS: 1,
  /** CMA-ES σ₀ per kind (§7.3); event/user use the pipeline defaults. */
  sigma0: { light: 0.05, weekly: 0.1 } as const,
  /** Budgets, EU: light ≈ 1k (§7.2); weekly half the tier-S budget; event/user the tier budget. */
  budgetEU: { light: 1000, weekly: 1500 } as const,
  /** Hard limits for light and weekly [PROPOSED] (§7.4). */
  hard: { energyMeanRel: 0.1, sessionsPerWeek: 1, newFastMinH: 24, windowDays: 7 } as const,
  /** Finalists verified in key order (Simulator-mode re-run, energy-bias band). */
  finalists: 6,
  /** Points of maintenance the fallback eases the current plan's deficit by, in turn, when nothing else verifies. */
  easeSteps: [2, 4, 6, 8, 10] as readonly number[],
  /** Diff rows cover the next 28 days. */
  diffDays: 28,
  /** A day's planned energy counts as more load when it moves away from maintenance by more than this share of it. */
  loadEnergyTol: 0.01,
  /** Hysteresis in favour of the current plan on the churn/regulariser tie-break (no change for noise). */
  tieEps: 0.01,
} as const;

/** Margin slots after the state-space margins (`MARGIN_IDS`): fasting spacing and validator are safety, the rest churn. */
const SAFETY_EXTRA = ['spacing', 'validator'] as const;
const CHURN_IDS = ['churn.energy', 'churn.sessions', 'churn.newFast', 'churn.dayType'] as const;
const N_SAFETY = MARGIN_IDS.length + SAFETY_EXTRA.length;
const N_MARGINS = N_SAFETY + CHURN_IDS.length;

// ------------------------------------------------------------------------------------------------------------ problem spec

/**
 * Everything an evaluator needs to rebuild the re-plan problem (posted to evaluator workers with the request): the
 * coordinator decides these once; `ReplanEvaluatorHost` rebuilds the identical model from them.
 */
export interface ReplanProblemSpec {
  lockEnd: number;
  touchEnd: number;
  /** First plan day the margins judge (violations carried over from the logged days that even eating at maintenance cannot avoid end before it). */
  judgeFrom: number;
  frame: ReplanFrame;
  /** Structure ids searched, index 0 = baseline. */
  structureIds: string[];
  realistic: boolean;
  churnLimits: boolean;
  mode: ForwardMode;
}

export interface ReplanEvalInit {
  request: ReplanRequest;
  spec: ReplanProblemSpec;
}

export interface ReplanOptions {
  signal?: { readonly aborted: boolean };
  onProgress?: (p: PlannerProgressV2) => void;
  /** Evaluator of the re-plan problem (worker pool: each worker holds a `ReplanEvaluatorHost(init)`). Default in-thread. */
  evaluatorFor?: (init: ReplanEvalInit) => Evaluator;
  /** Tier of event/user re-plans (default: the plan's). */
  tier?: PlannerTier;
  /** Override of the search budget, EU (tests, diagnostics). */
  totalEU?: number;
  /** Diagnostics: the decisions and the key of the current plan and the chosen candidate. */
  onDiagnostics?: (d: ReplanDiagnostics) => void;
}

export interface ReplanDiagnostics {
  todayIdx: number;
  lockEnd: number;
  touchEnd: number;
  judgeFrom: number;
  safetyFirst: boolean;
  candidates: number;
  keep: { vS: number; vL: number; G: number; reg: number; violated: string[] };
  chosen: { structureId: string; vS: number; vL: number; G: number; C: number | null; reg: number; violated: string[] } | null;
  rejected: string[];
}

// ------------------------------------------------------------------------------------------------------------ setup

interface Setup {
  req: ReplanRequest;
  kind: ReplanKind;
  plan: ActivePlanRecord;
  /** Effective request: changes applied, every target absolute. */
  request: PlannerRequestV2;
  todayIdx: number;
  /** Plan length after the re-plan (days, = end index). */
  N: number;
  /** Active schedule at length N (prescribed past). */
  active: Schedule;
  /** Active schedule with the logged days replaced (forward runs). */
  realised: Schedule;
  /** Effective request compiled at today (caps, margins, labels; horizon = days left). */
  todayCtx: PlanningContext;
  /** Effective request compiled at the plan start over the whole plan (validator). */
  startCtx: PlanningContext;
  fwd: ForwardModel;
  bindings: ReturnType<typeof bindingsOf>;
  /** Plan days the person fixed (`req.pinnedDays`): every candidate keeps `active`'s prescription there. */
  pinned: ReadonlySet<number>;
  /** The schedule before the person's edit (`req.baseline`) at length N, and its realised form; else `active`/`realised`. */
  base: Schedule;
  baseRealised: Schedule;
}

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

function compileAt(request: PlannerRequestV2, startDate: string, horizon: number, weightKg: number): PlanningContext {
  const profile = { ...request.profile, startDate, body: { ...request.profile.body, weightKg } };
  const ctx = compileRequest({ ...request, profile, startDate, horizonDays: clampInt(horizon, HORIZON_MIN_DAYS, HORIZON_MAX_DAYS) });
  return ctx.horizonDays === horizon ? ctx : withHorizon(ctx, horizon);
}

/**
 * Realised schedule: logged days replace the prescription (own programs). A prescribed fast starting on a logged day stays
 * unless that day's fast item was skipped (or credited below one half), as the living plan's replay does.
 */
function realise(active: Schedule, logs: ReplanRequest['logs'], startDate: string, todayIdx: number): Schedule {
  const byDay = new Map<number, DayTemplate>();
  const fastOff = new Set<number>();
  for (const l of logs) {
    const d = dayIndex(startDate, l.date);
    if (!(d >= 0 && d < todayIdx && d < active.horizonDays)) continue;
    byDay.set(d, l.inputs);
    const f = l.items.find((x) => x.type === 'fast');
    if (f && (f.status === 'skipped' || (f.credit !== null && f.credit < 0.5))) fastOff.add(d);
  }
  if (byDay.size === 0) return active;
  const programs = [...active.programs];
  const key = new Map<string, number>();
  const days = active.days.map((x, d) => {
    const t = byDay.get(d);
    if (!t) return x;
    const k = JSON.stringify(t);
    let i = key.get(k);
    if (i === undefined) {
      i = programs.length;
      programs.push({ ...t, id: `logged-${i}`, label: t.label || 'as logged' });
      key.set(k, i);
    }
    return { program: i };
  });
  const events = (active.events ?? []).filter((e) => !fastOff.has(e.startDay));
  return { ...active, programs, days, events };
}

function prepare(req: ReplanRequest, forceMode?: ForwardMode): Setup {
  const plan = req.plan;
  const todayIdx = Math.max(0, dayIndex(plan.startDate, req.today));
  const N0 = plan.schedule.horizonDays;
  const wanted = req.changes?.horizonDays !== undefined ? Math.round(req.changes.horizonDays) : Math.max(N0, dayIndex(plan.startDate, plan.endDate));
  const N = Math.max(todayIdx + REPLAN.minHorizonDays, wanted);
  const active = withLength(plan.schedule, N);
  const planStartCtx = compileAt(plan.request, plan.startDate, N, plan.request.profile.body.weightKg);
  const trendKg = Number.isFinite(req.state.trendWeight.kg) && req.state.trendWeight.kg > 0 ? req.state.trendWeight.kg : plan.request.profile.body.weightKg;
  // targets set at the plan start stay measured from the plan start; targets the user changes now are measured from today
  const estimate = (ctx: PlanningContext, k: number) => ctx.goals.find((g) => g.index === k)?.startEstimate ?? Number.NaN;
  const kept = absoluteGoals(plan.request.goals, (k) => estimate(planStartCtx, k));
  const changed = req.changes?.goals;
  let goals = kept;
  if (changed) {
    const nowCtx = compileAt({ ...plan.request, goals: changed }, req.today, Math.max(1, N - todayIdx), trendKg);
    let fatNow = Number.NaN;
    try {
      fatNow = snapshotFatKg(req.state.snapshot);
    } catch {
      fatNow = Number.NaN;
    }
    goals = absoluteGoals(changed, (k) => {
      const m = changed[k]!.metric;
      if (m === 'scaleWeight') return trendKg;
      if (m === 'fatMass' && Number.isFinite(fatNow)) return fatNow;
      return estimate(nowCtx, k);
    });
  }
  const request: PlannerRequestV2 = {
    ...plan.request,
    goals,
    ...(req.changes?.constraints ? { constraints: req.changes.constraints } : {}),
    ...(req.changes?.safety ? { safety: req.changes.safety } : {}),
    horizonDays: N,
  };
  const todayCtx = compileAt(request, req.today, N - todayIdx, trendKg);
  const startCtx = compileAt(request, plan.startDate, N, plan.request.profile.body.weightKg);
  const fwd = new ForwardModel(plan, req.state, goalSeriesIds(todayCtx), forceMode);
  const realised = realise(active, req.logs, plan.startDate, todayIdx);
  const base = req.baseline ? withLength(req.baseline, N) : active;
  return {
    req,
    kind: req.kind,
    plan,
    request,
    todayIdx,
    N,
    active,
    realised,
    todayCtx,
    startCtx,
    fwd,
    bindings: bindingsOf(todayCtx),
    pinned: new Set((req.pinnedDays ?? []).filter((d) => Number.isInteger(d) && d >= todayIdx && d < N)),
    base,
    baseRealised: req.baseline ? realise(base, req.logs, plan.startDate, todayIdx) : realised,
  };
}

// ------------------------------------------------------------------------------------------------------------ frames

interface Frame {
  def: ReplanFrame;
  ctx: PlanningContext;
  structures: SkeletonStructure[];
  decoder: EnginePlanModel;
}

function buildFrame(s: Setup, def: ReplanFrame): Frame {
  const ctx = compileAt(s.request, dateAt(s.plan.startDate, def.offset), def.horizonDays, def.weightKg);
  return { def, ctx, structures: enumerateStructures(ctx), decoder: new EnginePlanModel(ctx, { bindings: [] }) };
}

/** The active genome's frame (as written by `toActivePlan` / a previous re-plan), or null when there is no genome. */
function activeFrameDef(plan: ActivePlanRecord): ReplanFrame | null {
  if (plan.kind === 'custom' || !plan.structureId || plan.genome.length === 0) return null;
  return plan.provenance.replanFrame ?? { offset: 0, horizonDays: plan.request.horizonDays, weightKg: plan.request.profile.body.weightKg };
}

/** A frame decoding from today over the days left (at least 28 days are decoded; the first ones are used). */
function todayFrameDef(s: Setup): ReplanFrame {
  return { offset: s.todayIdx, horizonDays: clampInt(s.N - s.todayIdx, HORIZON_MIN_DAYS, HORIZON_MAX_DAYS), weightKg: s.todayCtx.rp.weightKg };
}

/**
 * Warm start in a new frame (§7.3): the active genome with the elapsed segments dropped, the current segment's weeks
 * shortened to what is left, transferred by gene path (`transferGenome`) into the remaining skeleton (and into the same
 * skeleton, when both exist).
 */
function shiftedSeeds(s: Setup, from: Frame | null, to: Frame): Array<{ structure: number; x: Float64Array }> {
  if (!from) return [];
  const st = from.structures.find((x) => x.id === s.plan.structureId);
  if (!st || st.dim !== s.plan.genome.length) return [];
  const x = Float64Array.from(s.plan.genome);
  const dec = decodePlan(from.ctx, st, x);
  const e = s.todayIdx - from.def.offset;
  const segEnd = new Map<number, number>();
  for (const ph of dec.phases) segEnd.set(ph.segment, Math.max(segEnd.get(ph.segment) ?? 0, ph.endDay));
  let k0 = 0;
  while (k0 < st.skeleton.segments.length - 1 && (segEnd.get(k0) ?? 0) <= e) k0++;
  const remainingId = makeStructure(to.ctx, { ...st.skeleton, segments: st.skeleton.segments.slice(k0) }).id;
  const out: Array<{ structure: number; x: Float64Array }> = [];
  for (const id of [remainingId, st.id]) {
    const j = to.structures.findIndex((t) => t.id === id);
    if (j <= 0 || out.some((o) => o.structure === j)) continue;
    const tgt = to.structures[j]!;
    const y = transfer(st, tgt, x);
    const wi = tgt.geneIndex['seg0.weeks'];
    if (wi !== undefined) {
      const g = tgt.genes[wi]!;
      y[wi] = toUnit(g, Math.max(1, Math.round(((segEnd.get(k0) ?? e) - e) / 7)));
    }
    out.push({ structure: j, x: y });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ splicing

/** Drop programs no day uses (indices remapped in order of first use of the original order). */
function compact(s: Schedule): Schedule {
  const used = new Set(s.days.map((d) => d.program));
  if (used.size === s.programs.length) return s;
  const map = new Map<number, number>();
  const programs: Schedule['programs'] = [];
  s.programs.forEach((p, i) => {
    if (!used.has(i)) return;
    map.set(i, programs.length);
    programs.push(p);
  });
  return { ...s, programs, days: s.days.map((d) => ({ ...d, program: map.get(d.program)! })) };
}

/**
 * Plan-day schedule: days [lockEnd, touchEnd) from the frame schedule (frame day = plan day − offset; days past the frame
 * repeat its last week), every other day from `prefix`; events and blocks by the same split.
 */
function splice(prefix: Schedule, frameSched: Schedule, offset: number, lockEnd: number, touchEnd: number, pinned: ReadonlySet<number> = NO_PINS): Schedule {
  const P = prefix.programs.length;
  const H = frameSched.horizonDays;
  const frameDay = (j: number): ScheduleDay => frameSched.days[j < H ? Math.max(0, j) : Math.max(0, H - 7 + ((j - H) % 7))] ?? frameSched.days[H - 1]!;
  const days = prefix.days.map((d, i) => {
    if (i < lockEnd || i >= touchEnd || pinned.has(i)) return d;
    const sd = frameDay(i - offset);
    return { program: sd.program + P, ...(sd.override ? { override: sd.override } : {}) };
  });
  const events: FastEvent[] = [
    ...(prefix.events ?? []).filter((e) => e.startDay < lockEnd || e.startDay >= touchEnd || pinned.has(e.startDay)),
    ...(frameSched.events ?? []).map((e) => ({ ...e, startDay: e.startDay + offset })).filter((e) => e.startDay >= lockEnd && e.startDay < touchEnd && !pinned.has(e.startDay) && !pinned.has(Math.floor(e.startDay + (e.startH + e.durationH) / 24 - 1e-9))),
  ].sort((a, b) => a.startDay - b.startDay || a.startH - b.startH);
  const clip = (b: ScheduleBlock, lo: number, hi: number): ScheduleBlock | null => {
    const a = Math.max(lo, b.startDay);
    const z = Math.min(hi, b.endDay);
    return z > a ? { ...b, startDay: a, endDay: z } : null;
  };
  const N = prefix.horizonDays;
  const blocks: ScheduleBlock[] = [];
  for (const b of prefix.blocks ?? []) {
    const x = clip(b, 0, lockEnd);
    if (x) blocks.push(x);
  }
  for (const b of frameSched.blocks ?? []) {
    const x = clip({ ...b, startDay: b.startDay + offset, endDay: (b.endDay >= H ? Math.max(b.endDay, N) : b.endDay) + offset }, lockEnd, touchEnd);
    if (x) blocks.push(x);
  }
  for (const b of prefix.blocks ?? []) {
    const x = clip(b, touchEnd, N);
    if (x) blocks.push(x);
  }
  blocks.sort((a, b) => a.startDay - b.startDay);
  return compact({ ...prefix, programs: [...prefix.programs, ...frameSched.programs], days, events, blocks });
}

const NO_PINS: ReadonlySet<number> = new Set();

const refsOf = (ctx: PlanningContext) => ({ maintenanceKcal: ctx.rp.tdee0Kcal, bwKg: ctx.rp.weightKg, ffmKg: ctx.rp.ffm0Kg });

/** `light`: tomorrow keeps its prescription except its energy, moved toward the candidate's by at most ±10 %. */
function lightTomorrow(s: Setup, out: Schedule, frameSched: Schedule, offset: number): Schedule {
  const d = s.todayIdx + 1;
  if (d >= s.N) return out;
  const a = dayTemplate(out, d);
  if (a.energy.kind === 'zero' || (out.events ?? []).some((e) => e.startDay <= d && e.startDay * 24 + e.startH + e.durationH > d * 24)) return out;
  const j = d - offset;
  if (j < 0 || j >= frameSched.horizonDays) return out;
  const b = dayTemplate(frameSched, j);
  if (b.energy.kind === 'zero') return out;
  const refs = refsOf(s.todayCtx);
  const ka = estimateDay(a, refs).kcal;
  const kb = estimateDay(b, refs).kcal;
  if (!(ka > 0 && kb > 0)) return out;
  const r = Math.min(1 + REPLAN.lightTomorrowRel, Math.max(1 - REPLAN.lightTomorrowRel, kb / ka));
  if (Math.abs(r - 1) < 1e-3) return out;
  const e = a.energy;
  const energy = e.kind === 'kcal' ? { kind: 'kcal' as const, kcal: Math.round(e.kcal * r) } : { ...e, pct: Math.round(e.pct * r * 10) / 10 };
  const days = out.days.map((x, i) => (i === d ? { ...x, override: { ...x.override, energy } } : x));
  return { ...out, days };
}

// ------------------------------------------------------------------------------------------------------------ evaluation

interface Built {
  /** Forward-run schedule (realised past). */
  run: Schedule;
  /** Output schedule (prescribed past). */
  out: Schedule;
  log: readonly RepairEntry[];
  frameSched: Schedule | null;
}

interface Scored {
  goals: Float64Array;
  margins: Float64Array;
  vS: number;
  vL: number;
  reg: number;
  /** Violated margin ids (safety first). */
  violated: string[];
}

interface Evaluated extends Scored {
  id: number;
  structure: number;
  structureId: string;
  x: Float64Array | null;
  frame: Frame | null;
  G: number;
  C: number | null;
  built: Built | null;
}

/** Future spacing check (HC-F2 and the multi-day spacing) with the logged past as context: a violation by a span ending today or later. */
export function futureSpacingViolation(spans: readonly ZeroSpan[], fromH: number): { rule: string; span: ZeroSpan } | null {
  const prior: ZeroSpan[] = [];
  for (const z of spans) {
    if (z.end > fromH + 1e-6) {
      // pairwise against every earlier fast (a conflict inside the logged past must not hide this one), then the counts
      for (const y of prior) {
        const v = firstSpacingViolation([y, z]);
        if (v && v.span === z) return v;
      }
      const v = firstSpacingViolation([...prior, z]);
      if (v && v.span === z) return v;
    }
    prior.push(z);
  }
  return null;
}

/** Day-level load of [from, to): planned kcal, training, fasting, steps (baseline references). */
interface Load {
  f: PlanFacts;
  fastStart: Map<number, number>;
}

function loadOf(ctx: PlanningContext, s: Schedule): Load {
  const f = planFacts(ctx, s);
  const fastStart = new Map<number, number>();
  for (const e of s.events ?? []) fastStart.set(e.startDay, Math.max(fastStart.get(e.startDay) ?? 0, e.durationH));
  for (let d = 0; d < s.horizonDays; d++) if (f.zero[d] && !fastStart.has(d) && dayTemplate(s, d).energy.kind === 'zero') fastStart.set(d, 24);
  return { f, fastStart };
}

/** Load comparison of a candidate against the active plan over [from, to) (§7.4: automatic changes only lower load). */
export function loadChange(ctx: PlanningContext, active: Schedule, next: Schedule, from: number, to: number): { raises: string[]; lowers: boolean; changed: number } {
  const A = loadOf(ctx, active);
  const B = loadOf(ctx, next);
  const M = ctx.rp.tdee0Kcal;
  const tol = REPLAN.loadEnergyTol * M;
  const raises = new Set<string>();
  let lowers = false;
  let changed = 0;
  for (let d = from; d < Math.min(to, active.horizonDays, next.horizonDays); d++) {
    const a = A.f;
    const b = B.f;
    const da = Math.abs(a.kcal[d]! - M);
    const db = Math.abs(b.kcal[d]! - M);
    const ea = (A.fastStart.get(d) ?? 0);
    const eb = (B.fastStart.get(d) ?? 0);
    const diff = Math.abs(a.kcal[d]! - b.kcal[d]!) > 1 || Math.abs(a.rtSets[d]! - b.rtSets[d]!) > 1e-6 || Math.abs(a.cardioMin[d]! - b.cardioMin[d]!) > 1e-6 || ea !== eb || Math.abs(a.steps[d]! - b.steps[d]!) > 1;
    if (!diff) continue;
    changed++;
    if (eb > ea + 1e-6) raises.add(ea > 0 ? 'a longer fast' : 'a new fast');
    else if (!b.zero[d] && !a.zero[d] && db > da + tol) raises.add(b.kcal[d]! < M ? 'a deeper energy deficit' : 'a larger energy surplus');
    if (b.rtSets[d]! > a.rtSets[d]! + 0.5 || b.rtMin[d]! > a.rtMin[d]! + 1) raises.add('more resistance training');
    if (b.cardioMin[d]! > a.cardioMin[d]! + 1) raises.add('more cardio');
    if (b.steps[d]! > a.steps[d]! + 250) raises.add('more daily steps');
    if (db < da - tol || b.rtSets[d]! < a.rtSets[d]! - 0.5 || b.cardioMin[d]! < a.cardioMin[d]! - 1 || eb < ea - 1e-6 || b.steps[d]! < a.steps[d]! - 250) lowers = true;
  }
  return { raises: [...raises], lowers, changed };
}

/** Churn hard limits of light/weekly (§7.4) as margins (≥ 0 satisfied): energy, sessions, new fast, new day type. */
function churnMargins(s: Setup, out: Schedule): number[] {
  const from = s.todayIdx;
  const to = Math.min(s.N, from + REPLAN.hard.windowDays);
  const A = loadOf(s.todayCtx, s.active);
  const B = loadOf(s.todayCtx, out);
  let eA = 0;
  let eB = 0;
  let sA = 0;
  let sB = 0;
  let newFast = false;
  const labels = new Set<string>();
  for (let d = 0; d < to; d++) labels.add(dayTemplate(s.active, d).label);
  let newType = false;
  for (let d = from; d < to; d++) {
    eA += A.f.kcal[d]!;
    eB += B.f.kcal[d]!;
    sA += (A.f.rtSessions[d]! > 0 ? 1 : 0) + (A.f.cardioMin[d]! > 0 ? 1 : 0);
    sB += (B.f.rtSessions[d]! > 0 ? 1 : 0) + (B.f.cardioMin[d]! > 0 ? 1 : 0);
    const fb = B.fastStart.get(d) ?? 0;
    if (fb >= REPLAN.hard.newFastMinH && fb > (A.fastStart.get(d) ?? 0) + 1e-6) newFast = true;
    if (!labels.has(dayTemplate(out, d).label)) newType = true;
  }
  const rel = eA > 0 ? Math.abs(eB - eA) / eA : 0;
  return [
    (REPLAN.hard.energyMeanRel - rel) / 0.05,
    REPLAN.hard.sessionsPerWeek - Math.abs(sB - sA),
    newFast && s.kind !== 'user' ? -1 : MARGIN_NA,
    newType ? -1 : MARGIN_NA,
  ];
}

/** Gower churn distance C ∈ [0, 1] over the next 14 days (energy, training, fasting, window, steps; §7.4). */
export function churnDistance(ctx: PlanningContext, active: Schedule, next: Schedule, from: number, days: number = REPLAN.churnDays): number {
  const to = Math.min(from + days, active.horizonDays, next.horizonDays);
  if (to <= from) return 0;
  const a = planFacts(ctx, active);
  const b = planFacts(ctx, next);
  const M = ctx.rp.tdee0Kcal;
  const F: Array<[Float64Array | Uint8Array, number, boolean?]> = [
    [a.kcal, 0.5 * M], [a.rtSets, 60], [a.rtMin, 90], [a.cardioMin, 90], [a.fastedH, 24], [a.windowStart, 12, true], [a.windowLen, 12], [a.steps, 10000],
  ];
  const G: Array<Float64Array | Uint8Array> = [b.kcal, b.rtSets, b.rtMin, b.cardioMin, b.fastedH, b.windowStart, b.windowLen, b.steps];
  let sum = 0;
  let n = 0;
  for (let d = from; d < to; d++) {
    F.forEach(([x, range, circ], i) => {
      let dv = Math.abs(x[d]! - G[i]![d]!);
      if (circ) dv = Math.min(dv % 24, 24 - (dv % 24));
      sum += Math.min(1, dv / range);
      n++;
    });
  }
  return n ? sum / n : 0;
}

/** The validator's reasons for the whole output schedule (plan start context). */
function validatorReasons(s: Setup, out: Schedule): string[] {
  return validatePlan(s.startCtx, out).reasons;
}

class ReplanEvaluator {
  readonly realisticCache = new WeakMap<Schedule, Schedule>();
  readonly scored = new WeakMap<Schedule, Scored>();
  readonly built = new WeakMap<Schedule, Built>();
  private keepReasons: Set<string> | null = null;
  constructor(
    readonly s: Setup,
    readonly spec: Pick<ReplanProblemSpec, 'lockEnd' | 'touchEnd' | 'judgeFrom' | 'realistic' | 'churnLimits'>,
  ) {}

  realisticOf(run: Schedule): Schedule {
    if (!this.spec.realistic) return run;
    let r = this.realisticCache.get(run);
    if (!r) this.realisticCache.set(run, (r = realisticSchedule(run, this.s.todayIdx, this.s.req.adherence, this.s.fwd.rp)));
    return r;
  }

  sim(run: Schedule): SimulationResult {
    return this.s.fwd.run(this.realisticOf(run));
  }

  /** Build the run/output pair of a frame candidate. */
  build(frame: Frame, frameSched: Schedule, log: readonly RepairEntry[]): Built {
    const { lockEnd, touchEnd } = this.spec;
    let out = splice(this.s.active, frameSched, frame.def.offset, lockEnd, touchEnd, this.s.pinned);
    if (this.s.kind === 'light' && lockEnd > this.s.todayIdx + 1 && !this.s.pinned.has(this.s.todayIdx + 1)) out = lightTomorrow(this.s, out, frameSched, frame.def.offset);
    // the run takes the logged past and the output's future (same programs appended after the realised ones)
    const run = this.s.realised === this.s.active ? out : withPast(this.s.realised, out, this.s.todayIdx);
    const b: Built = { run, out, log, frameSched };
    this.built.set(run, b);
    return b;
  }

  keepBuilt(): Built {
    const b: Built = { run: this.s.realised, out: this.s.active, log: [], frameSched: null };
    this.built.set(b.run, b);
    return b;
  }

  score(b: Built, sim: SimulationResult): Scored {
    const hit = this.scored.get(b.run);
    if (hit) return hit;
    const s = this.s;
    const fsim = futureView(sim, this.spec.judgeFrom);
    const margins = new Float64Array(N_MARGINS).fill(MARGIN_NA);
    margins.set(relativeMargins(s, sim, b.out, this.spec.judgeFrom, undefined, true), 0);
    const sp = futureSpacingViolation(zeroSpans(s.todayCtx, b.run), s.todayIdx * 24);
    margins[MARGIN_IDS.length] = sp ? -1 : MARGIN_NA;
    // validator reasons new against the plan before the person's edit (the edit itself is judged too)
    if (!this.keepReasons) this.keepReasons = new Set(validatorReasons(s, s.base));
    const fresh = b.out === s.base ? [] : validatorReasons(s, b.out).filter((r) => !this.keepReasons!.has(r));
    margins[MARGIN_IDS.length + 1] = fresh.length ? -1 : MARGIN_NA;
    if (this.spec.churnLimits && b.out !== s.active) margins.set(churnMargins(s, b.out), N_SAFETY);
    const future = sliceSchedule(b.out, s.todayIdx, s.N);
    const reg = regulariserOf(s.todayCtx, future, fsim, b.log);
    const goals = Float64Array.from(s.bindings, (x) => goalValue(sim, x, s.todayCtx));
    const ids = [...MARGIN_IDS, ...SAFETY_EXTRA, ...CHURN_IDS];
    const violated: string[] = [];
    margins.forEach((m, i) => {
      if (m < 0 || Number.isNaN(m)) violated.push(ids[i]!);
    });
    const out: Scored = { goals, margins, vS: violation(margins.subarray(0, N_SAFETY)), vL: violation(margins.subarray(N_SAFETY)), reg, violated };
    this.scored.set(b.run, out);
    return out;
  }
}

/** The output schedule with days before `todayIdx` taken from the realised schedule (forward runs). */
function withPast(realised: Schedule, out: Schedule, todayIdx: number): Schedule {
  const P = realised.programs.length;
  const days = out.days.map((d, i) => (i < todayIdx ? realised.days[i]! : { ...d, program: d.program + P }));
  const events = [...(realised.events ?? []).filter((e) => e.startDay < todayIdx), ...(out.events ?? []).filter((e) => e.startDay >= todayIdx)];
  return compact({ ...out, programs: [...realised.programs, ...out.programs], days, events });
}

/** `PlanModel` of the re-plan problem for the optimiser (frame decode → splice → run from the confirmed state). */
class ReplanModel implements PlanModel<SkeletonStructure, Schedule, SimulationResult> {
  constructor(
    readonly ev: ReplanEvaluator,
    readonly frame: Frame,
    readonly structures: readonly SkeletonStructure[],
  ) {}

  decode(st: SkeletonStructure, x: Float64Array): Schedule {
    return this.frame.decoder.decode(st, x);
  }

  repair(st: SkeletonStructure, sched: Schedule): Repaired<Schedule> {
    const r = this.frame.decoder.repair(st, sched);
    const b = this.ev.build(this.frame, r.schedule, r.log);
    return { schedule: b.run, log: r.log };
  }

  simulate(run: Schedule): SimulationResult {
    return this.ev.sim(run);
  }

  private scoredOf(run: Schedule, sim: SimulationResult): Scored {
    const b = this.ev.built.get(run) ?? { run, out: run, log: [], frameSched: null };
    return this.ev.score(b, sim);
  }

  goals(sim: SimulationResult, run: Schedule): Float64Array {
    return this.scoredOf(run, sim).goals;
  }

  constraints(sim: SimulationResult, run: Schedule): Float64Array {
    return this.scoredOf(run, sim).margins;
  }

  regulariser(run: Schedule, sim: SimulationResult): number {
    return this.scoredOf(run, sim).reg;
  }

  descriptors(run: Schedule): Float64Array {
    const f = this.ev.built.get(run)?.frameSched ?? run;
    return descriptors(this.frame.ctx, f);
  }

  features(run: Schedule): Float64Array {
    const f = this.ev.built.get(run)?.frameSched ?? run;
    return features(this.frame.ctx, f);
  }

  cost(): number {
    return 1;
  }
}

// ------------------------------------------------------------------------------------------------------------ evaluator host (workers)

function problemOf(s: Setup, spec: ReplanProblemSpec): { ev: ReplanEvaluator; frame: Frame; structures: SkeletonStructure[]; model: ReplanModel } {
  const ev = new ReplanEvaluator(s, spec);
  const frame = buildFrame(s, spec.frame);
  const byId = new Map(frame.structures.map((x) => [x.id, x] as const));
  const structures = spec.structureIds.map((id) => byId.get(id)).filter((x): x is SkeletonStructure => !!x);
  return { ev, frame, structures, model: new ReplanModel(ev, frame, structures) };
}

/**
 * Evaluator worker side of a re-plan: rebuilds the coordinator's problem from the request and the spec and answers
 * batches (outputs in request order; identical to the in-thread evaluation).
 */
export class ReplanEvaluatorHost {
  private readonly model: ReplanModel;
  private readonly structures: readonly SkeletonStructure[];
  constructor(init: ReplanEvalInit) {
    const p = problemOf(prepare(init.request, init.spec.mode), init.spec);
    this.model = p.model;
    this.structures = p.structures;
  }
  evaluate(batch: readonly EvalRequest[]): EvalOutput[] {
    return batch.map((r) => evaluatePlan(this.model, this.structures, r));
  }
}

// ------------------------------------------------------------------------------------------------------------ selection

interface Scales {
  b: number[];
  u: number[];
}

/** Desirability scales per goal: 0 = the habitual future (or the current plan), 1 = the target or the best safe value seen. */
function scalesOf(specs: readonly GoalSpec[], base: Float64Array, cands: readonly Evaluated[]): Scales {
  const sgn = specs.map((sp) => (sp.sense === 'min' ? -1 : 1));
  const b = specs.map((_, k) => sgn[k]! * base[k]!);
  const u = specs.map((sp, k) => {
    let best = b[k]!;
    for (const c of cands) if (c.vS === 0 && c.vL === 0) best = Math.max(best, sgn[k]! * c.goals[k]!);
    return sp.target !== undefined ? sgn[k]! * sp.target : best;
  });
  return { b, u };
}

function goalScore(specs: readonly GoalSpec[], sc: Scales, goals: ArrayLike<number>): number {
  const w = rocWeights(specs.length);
  let g = 0;
  specs.forEach((sp, k) => {
    const f = (sp.sense === 'min' ? -1 : 1) * goals[k]!;
    const den = sc.u[k]! - sc.b[k]!;
    const d = Math.abs(den) > 1e-12 ? (f - sc.b[k]!) / den : f >= sc.u[k]! - 1e-12 ? 1 : 0;
    g += w[k]! * Math.min(1, d);
  });
  return g;
}

// ------------------------------------------------------------------------------------------------------------ texts

const WHY: Readonly<Record<ReplanTrigger, string>> = {
  nudge: 'A small adjustment after yesterday went differently from the plan.',
  checkin: 'Updated at your weekly check-in from your measured trend.',
  absence: 'Fits the plan around the days you said you cannot follow it.',
  missedBlocks: 'Plans around what you have actually been able to do lately.',
  lowAdherence: 'Plans around what you have actually been able to do lately.',
  outOfBand: 'Your measured trend has moved away from the forecast, so the plan follows it.',
  requestChange: 'Follows the change you made to your goals, limits or safety answers.',
  safetyAhead: 'Keeps the coming days inside your safety limits.',
  user: 'You asked for a new plan from here.',
};

const r1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
const kcalText = (k: number): string => `${Math.round(k / 10) * 10} kcal`;

function clock(h: number): string {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function trainingText(t: DayTemplate): string {
  const parts = (t.exercise ?? []).map((x) => (x.kind === 'resistance' ? `resistance training ${Math.round(x.durationMin ?? 60)} min` : `${x.modality === 'other' ? 'cardio' : x.modality} ${Math.round(x.durationMin)} min`));
  return parts.length ? parts.join(' and ') : 'no training';
}

function fastText(s: Schedule, d: number): string {
  const e = (s.events ?? []).find((x) => x.startDay === d);
  if (e) return `${Math.round(e.durationH)}-hour fast from ${clock(e.startH)}`;
  return dayTemplate(s, d).energy.kind === 'zero' ? 'zero-energy day' : 'no fast';
}

/** Day rows of what changed over [from, to), with plain reasons. */
function diffRows(ctx: PlanningContext, a: Schedule, b: Schedule, startDate: string, from: number, to: number, why: string): ReplanDiffRow[] {
  const rows: ReplanDiffRow[] = [];
  const refs = refsOf(ctx);
  for (let d = from; d < Math.min(to, a.horizonDays, b.horizonDays); d++) {
    const x = dayTemplate(a, d);
    const y = dayTemplate(b, d);
    const date = dateAt(startDate, d);
    const ex = estimateDay(x, refs);
    const ey = estimateDay(y, refs);
    if (Math.abs(ex.kcal - ey.kcal) > 5 || JSON.stringify(x.energy) !== JSON.stringify(y.energy)) {
      const more = ey.kcal > ex.kcal;
      rows.push({ date, field: 'energy', before: x.energy.kind === 'zero' ? 'no food' : kcalText(ex.kcal), after: y.energy.kind === 'zero' ? 'no food' : kcalText(ey.kcal), why: `${why} ${more ? 'More food on this day.' : 'Less food on this day.'}` });
    }
    if (Math.abs(ex.proteinG - ey.proteinG) > 2) rows.push({ date, field: 'protein', before: `${Math.round(ex.proteinG)} g protein`, after: `${Math.round(ey.proteinG)} g protein`, why });
    const tx = trainingText(x);
    const ty = trainingText(y);
    if (tx !== ty) rows.push({ date, field: 'training', before: tx, after: ty, why });
    const fx = fastText(a, d);
    const fy = fastText(b, d);
    if (fx !== fy) rows.push({ date, field: 'fast', before: fx, after: fy, why });
    if ((x.steps ?? 0) !== (y.steps ?? 0)) rows.push({ date, field: 'steps', before: x.steps !== undefined ? `${Math.round(x.steps)} steps` : 'usual steps', after: y.steps !== undefined ? `${Math.round(y.steps)} steps` : 'usual steps', why });
    const wx = x.meals?.window ? `eating window ${clock(x.meals.window.startH)} to ${clock(x.meals.window.startH + x.meals.window.lengthH)}` : '';
    const wy = y.meals?.window ? `eating window ${clock(y.meals.window.startH)} to ${clock(y.meals.window.startH + y.meals.window.lengthH)}` : '';
    if (wx !== wy) rows.push({ date, field: 'meals', before: wx || 'usual meal times', after: wy || 'usual meal times', why });
  }
  return rows;
}

function goalLines(asP: readonly ForecastGoalOutcome[], real: readonly ForecastGoalOutcome[]): string[] {
  return asP.map((g, k) => {
    const r = real[k];
    const u = g.unit ?? '';
    const label = g.label ?? g.metric;
    const t = g.target !== null && g.target !== undefined ? ` (target ${r1(g.target)} ${u})` : '';
    const at = r && Math.abs(r.endP50 - g.endP50) >= 0.05 ? `, about ${r1(r.endP50)} ${u} at the adherence of your recent weeks` : '';
    return `Goal ${k + 1} (${label}): about ${r1(g.endP50)} ${u} at the end of the plan as prescribed${at}${t}.`;
  });
}

// ------------------------------------------------------------------------------------------------------------ re-plan

function tierOf(t: PlannerTier | undefined): Tier {
  return t === 'X' ? 'L' : (t ?? 'S');
}

/** Map the optimiser's progress to the v2 progress shape. */
function progressOf(p: { stage: string; euUsed: number; euBudget: number }): PlannerProgressV2 {
  return { stage: `replan.${p.stage}`, fraction: Math.min(1, p.euUsed / Math.max(1, p.euBudget)), euUsed: p.euUsed, euBudget: p.euBudget, score: null, provisional: {}, changed: false };
}

interface SearchResult {
  cands: Evaluated[];
  euExternal: number;
  /** Goals of the habitual future (the optimiser's baseline), desirability 0. */
  baseGoals: Float64Array | null;
}

/** One optimiser run over a frame and a structure subset; returns every nominal candidate it evaluated. */
async function search(
  s: Setup,
  ev: ReplanEvaluator,
  frame: Frame,
  subsetIds: readonly string[],
  seeds: ReadonlyArray<{ id: string; x: Float64Array }>,
  specs: GoalSpec[],
  cfgExtra: Partial<PlannerConfig>,
  budget: number,
  opts: ReplanOptions,
  spec: ReplanProblemSpec,
  nextId: () => number,
): Promise<SearchResult> {
  const byId = new Map(frame.structures.map((x) => [x.id, x] as const));
  const structures = subsetIds.map((id) => byId.get(id)).filter((x): x is SkeletonStructure => !!x);
  if (structures.length < 2 || budget <= 0 || opts.signal?.aborted) return { cands: [], euExternal: 0, baseGoals: null };
  const model = new ReplanModel(ev, frame, structures);
  const local: Evaluator = { evaluate: (batch) => batch.map((r) => evaluatePlan(model, structures, r)) };
  const inner = opts.evaluatorFor ? opts.evaluatorFor({ request: s.req, spec: { ...spec, frame: frame.def, structureIds: structures.map((x) => x.id) } }) : local;
  const recorded: Array<{ structure: number; x: Float64Array; out: EvalOutput }> = [];
  const evaluator: Evaluator = {
    async evaluate(batch) {
      const outs = await inner.evaluate(batch);
      batch.forEach((r, i) => {
        if (r.draw < 0) recorded.push({ structure: r.structure, x: Float64Array.from(r.x), out: outs[i]! });
      });
      return outs;
    },
  };
  const cache = new Map<number, number[]>();
  const problem: PlannerProblem<SkeletonStructure> = {
    structures,
    goals: specs,
    baseline: { structure: 0, x: [] },
    seeds: seeds.flatMap((sd) => {
      const j = structures.findIndex((x) => x.id === sd.id);
      return j > 0 && structures[j]!.dim === sd.x.length ? [{ structure: j, x: sd.x }] : [];
    }),
    ...(structures.length > 2 ? { mutateStructure: (i: number, rng: Rng) => mutate(structures, i, rng, cache) } : {}),
    transferGenome: (f, t, x) => transfer(structures[f]!, structures[t]!, x),
    roundGenome: (i, x) => roundGenomeOf(frame.ctx, structures[i]!, x),
    gridStep: (i) => gridStepOf(structures[i]!),
    validate: (i, x) => {
      const st = structures[i]!;
      const run = model.repair(st, model.decode(st, x)).schedule;
      const sc = ev.score(ev.built.get(run)!, model.simulate(run));
      return sc.vS === 0 ? { ok: true, reasons: [] } : { ok: false, reasons: sc.violated };
    },
    featureSchema: FEATURE_SCHEMA,
  };
  const cfg: PlannerConfig = {
    seed: `${s.plan.provenance.seed || s.plan.planId}/replan/${s.req.today}/${s.kind}/${frame.def.offset}`,
    tier: s.kind === 'light' || s.kind === 'weekly' ? 'S' : tierOf(opts.tier ?? s.plan.provenance.tier),
    totalEU: budget,
    ensembleSize: 0,
    strictness: s.request.strictness ?? 'balanced',
    ...cfgExtra,
  };
  if (opts.signal) cfg.signal = opts.signal;
  if (opts.onProgress) cfg.onProgress = (p) => opts.onProgress!(progressOf(p));
  const res = await runPlanner(problem, evaluator, cfg);
  const seen = new Set<string>();
  const cands: Evaluated[] = [];
  for (const r of recorded) {
    const st = structures[r.structure]!;
    if (st.skeleton.baseline) continue;
    const key = `${st.id}|${Array.from(r.x, (v) => Math.round(v * 1e6)).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = Float64Array.from(r.out.margins);
    const ids = [...MARGIN_IDS, ...SAFETY_EXTRA, ...CHURN_IDS];
    const violated: string[] = [];
    m.forEach((v, i) => {
      if (v < 0 || Number.isNaN(v)) violated.push(ids[i]!);
    });
    cands.push({
      id: nextId(),
      structure: r.structure,
      structureId: st.id,
      x: r.x,
      frame,
      goals: Float64Array.from(r.out.goals),
      margins: m,
      vS: violation(m.subarray(0, N_SAFETY)),
      vL: violation(m.subarray(N_SAFETY)),
      reg: r.out.regulariser,
      violated,
      G: 0,
      C: null,
      built: null,
    });
  }
  const base = recorded.find((r) => structures[r.structure]!.skeleton.baseline);
  return { cands, euExternal: opts.evaluatorFor ? res.provenance.euUsed : 0, baseGoals: base ? Float64Array.from(base.out.goals) : null };
}

/** Rebuild a candidate's schedules (deterministic decode → repair → splice). */
/** Days [from, to) other than `pinned` with their energy eased by `k` points of maintenance (kcal days by k %); fasts and other fields kept. */
function easedSchedule(src: Schedule, from: number, to: number, pinned: ReadonlySet<number>, k: number): Schedule {
  const programs = [...src.programs];
  const map = new Map<number, number>();
  let changed = false;
  const days = src.days.map((d, i) => {
    if (i < from || i >= to || pinned.has(i)) return d;
    let j = map.get(d.program);
    if (j === undefined) {
      const t = src.programs[d.program]!;
      const e = t.energy;
      const next = e.kind === 'pctMaintenance' && e.pct < 100 ? { ...e, pct: Math.min(100, e.pct + k) } : e.kind === 'kcal' ? { ...e, kcal: Math.round(e.kcal * (1 + k / 100)) } : null;
      j = next ? programs.push({ ...t, energy: next }) - 1 : d.program;
      map.set(d.program, j);
    }
    if (j !== d.program) changed = true;
    return { ...d, program: j };
  });
  return changed ? { ...src, programs, days } : src;
}

function rebuild(ev: ReplanEvaluator, c: Evaluated): Built {
  if (c.built) return c.built;
  const f = c.frame!;
  const st = f.structures.find((x) => x.id === c.structureId)!;
  const r = f.decoder.repair(st, f.decoder.decode(st, c.x!));
  c.built = ev.build(f, r.schedule, r.log);
  return c.built;
}

/**
 * First day ≥ today from which the habitual future (eating at maintenance, usual activity, no fasts) breaks no margin:
 * violations before it are carried over from the logged days (rolling windows) and no plan can avoid them, so the
 * margins judge from there (today when the habitual future is safe at once or never becomes safe within 28 days).
 */
function harbourDay(s: Setup): number {
  const h = harbourOf(s);
  const sim = s.fwd.run(h.schedule);
  if (violation(stateMargins(s.todayCtx, futureView(sim, s.todayIdx), h.schedule, null)) === 0) return s.todayIdx;
  const last = Math.min(s.N - 1, s.todayIdx + SENSITIVITY_WINDOW_D);
  for (let d = s.todayIdx + 1; d <= last; d++) if (violation(stateMargins(s.todayCtx, futureView(sim, d), h.schedule, null)) === 0) return d;
  return s.todayIdx;
}

/**
 * The habitual future (eating at maintenance, usual activity, no fasts) after the logged past: what no plan can do
 * better than on margins the logged days already broke (e.g. the 28-day deficit after a long logged fast). Such a margin
 * is judged relative to it: a plan may not be worse there than eating at maintenance (`floors`, per margin, ≤ 0).
 */
interface Harbour {
  schedule: Schedule;
  floors: Map<string, Float64Array>;
  warnings: Map<number, Set<string>>;
}
const harbours = new WeakMap<Setup, Harbour>();
function harbourOf(s: Setup): Harbour {
  let h = harbours.get(s);
  if (!h) harbours.set(s, (h = { schedule: creditSchedule(s.realised, s.todayIdx, s.N, () => 0, s.fwd.rp), floors: new Map(), warnings: new Map() }));
  return h;
}

/** Per-margin floor min(0, harbour margin) from `from`, at intake offset `deltaKcal` (default the mean), with or without the cushion. */
function harbourFloors(s: Setup, from: number, deltaKcal: number | undefined, cushion: boolean): Float64Array {
  const h = harbourOf(s);
  const key = `${from}|${deltaKcal ?? 'm'}|${cushion ? 1 : 0}`;
  let f = h.floors.get(key);
  if (!f) {
    const sim = s.fwd.run(h.schedule, deltaKcal !== undefined ? { deltaKcal } : {});
    f = stateMargins(s.todayCtx, futureView(sim, from), h.schedule, cushion ? DEFAULT_CUSHION : null).map((v) => (Number.isFinite(v) ? Math.min(0, v) : 0));
    h.floors.set(key, f);
  }
  return f;
}

/** Unlistable warnings the habitual future itself raises from `from` on (carried over from the logged days). */
function harbourWarnings(s: Setup, from: number): Set<string> {
  const h = harbourOf(s);
  let w = h.warnings.get(from);
  if (!w) {
    const sim = s.fwd.run(h.schedule, { warnings: true });
    w = new Set(unlistableWarnings(s.todayCtx, h.schedule, sim).filter((x) => x.endDay >= from).map((x) => x.id as string));
    h.warnings.set(from, w);
  }
  return w;
}

/** State margins of a run from `from`, relative to the harbour on the margins it breaks itself (and to `extraFloor`, when given: the lower of the two). */
function relativeMargins(s: Setup, sim: SimulationResult, out: Schedule, from: number, deltaKcal: number | undefined, cushion: boolean, extraFloor?: Float64Array): Float64Array {
  const m = stateMargins(s.todayCtx, futureView(sim, from), out, cushion ? DEFAULT_CUSHION : null);
  const f = harbourFloors(s, from, deltaKcal, cushion);
  for (let i = 0; i < m.length; i++) {
    const floor = Math.min(f[i]!, extraFloor?.[i] ?? 0);
    if (floor < 0 && Number.isFinite(m[i]!)) m[i] = m[i]! - floor;
  }
  return m;
}

/**
 * Per-margin floor min(0, margin) of the current plan (the plan in force with the person's edit, if any) at intake
 * offset `deltaKcal`, from `from`. The energy-bias band (δ ± Z90·sd; before the first check-in the R11 prior,
 * 0 ± 150 kcal) is judged relative to it: the ladder search that made the plan judges at δ alone, so a plan near the
 * deficit or rate cap breaks the band from day 1 and no re-plan, meal out or push-back could pass (Q3-J5-01). A re-plan
 * may not be worse inside the band than the current plan; the nominal margins (at δ) stay absolute, so an edit that
 * breaks a safety limit is still refused.
 */
const planFloorCache = new WeakMap<Setup, Map<string, Float64Array>>();
function planBandFloors(s: Setup, from: number, deltaKcal: number): Float64Array {
  let c = planFloorCache.get(s);
  if (!c) planFloorCache.set(s, (c = new Map()));
  const key = `${from}|${deltaKcal}`;
  let f = c.get(key);
  if (!f) {
    const sim = s.fwd.run(s.realised, { deltaKcal });
    f = stateMargins(s.todayCtx, futureView(sim, from), s.active, null).map((v) => (Number.isFinite(v) ? Math.min(0, v) : 0));
    c.set(key, f);
  }
  return f;
}

const material = (t: DayTemplate): string => JSON.stringify({ ...t, id: undefined, label: undefined });

/** Days [from, end) carry the same templates (ids and labels aside) and the same fasts. */
function sameFuture(a: Schedule, b: Schedule, from: number): boolean {
  const n = Math.min(a.horizonDays, b.horizonDays);
  if (a.horizonDays !== b.horizonDays) return false;
  for (let d = from; d < n; d++) if (material(dayTemplate(a, d)) !== material(dayTemplate(b, d))) return false;
  const ev = (s: Schedule) => JSON.stringify((s.events ?? []).filter((e) => e.startDay >= from).map((e) => [e.startDay, e.startH, e.durationH, e.refeed ?? null, e.refeedFactors ?? null]));
  return ev(a) === ev(b);
}

/** Final checks of a finalist: Simulator-mode warnings (from today on), as-prescribed safety, energy-bias band. */
function verify(s: Setup, ev: ReplanEvaluator, b: Built): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const fin = s.fwd.run(b.run, { warnings: true });
  const from = ev.spec.judgeFrom;
  const carried = harbourWarnings(s, from);
  const bad = unlistableWarnings(s.todayCtx, b.out, fin).filter((w) => w.endDay >= from && !carried.has(w.id));
  for (const w of bad) reasons.push(w.id);
  if (ev.spec.realistic) {
    const sc = relativeMargins(s, fin, b.out, from, undefined, true);
    if (violation(sc) > 0) reasons.push('asPrescribed');
  }
  if (s.fwd.delta.sd > 0 && s.fwd.mode !== 'fresh') {
    for (const dk of [s.fwd.delta.mean - Z90 * s.fwd.delta.sd, s.fwd.delta.mean + Z90 * s.fwd.delta.sd]) {
      const m = relativeMargins(s, s.fwd.run(b.run, { deltaKcal: dk }), b.out, from, dk, false, planBandFloors(s, from, dk));
      for (const i of NOMINAL_ONLY_MARGINS) m[i] = MARGIN_NA;
      m.forEach((v, i) => {
        if (v < 0 || Number.isNaN(v)) reasons.push(`band:${MARGIN_IDS[i]}`);
      });
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function plainReason(id: string): string {
  // validator lines read "<rule id>: <detail>"; only the rule's wording is shown
  const raw = (id.startsWith('band:') ? id.slice(5) : id).split(':')[0]!.trim();
  if (raw === 'spacing') return ruleText('HC-F2');
  if (raw === 'validator') return 'the planning rules for your profile';
  if (raw === 'asPrescribed') return 'your safety limits when the plan is followed in full';
  if (raw.startsWith('churn.')) return 'the limits on how much a routine update may change';
  const text = ruleText(raw);
  // never show a bare rule id (e.g. a simulator warning line) to the user
  return text === raw && !/\s/.test(raw) || /^simulator /.test(raw) ? 'a safety limit' : text;
}

/**
 * Re-plan a living plan from today (§7). Deterministic in the request (seeded from the plan's provenance, the date and the
 * kind) for any evaluator.
 */
export async function replan(req: ReplanRequest, opts: ReplanOptions = {}): Promise<ReplanResult> {
  const s = prepare(req);
  const plan = s.plan;
  let idSeq = 0;
  const nextId = () => idSeq++;

  // ---- the current plan from here ("keep"): decides the lock window, start values and the desirability baseline
  const realistic = s.kind !== 'light';
  const judgeFrom = harbourDay(s);
  const probe = new ReplanEvaluator(s, { lockEnd: s.todayIdx + REPLAN.lockDays, touchEnd: s.N, judgeFrom, realistic, churnLimits: false });
  const keepB = probe.keepBuilt();
  const keepSim = probe.sim(keepB.run);
  const keepScored = probe.score(keepB, keepSim);
  // safety first: when the current plan breaks a safety margin from here, the lock window opens, a light re-plan looks at
  // the whole remaining horizon and the routine churn limits do not hold the fix back
  const keepCheck = keepScored.vS === 0 ? verify(s, probe, keepB) : { ok: false, reasons: [] as string[] };
  const safetyFirst = keepScored.vS > 0 || !keepCheck.ok;
  const bypass = s.kind === 'user' || safetyFirst;
  const lockEnd = Math.min(s.N - 1, bypass ? s.todayIdx : s.todayIdx + REPLAN.lockDays);
  const touchEnd = s.kind === 'light' && !safetyFirst ? Math.min(s.N, s.todayIdx + REPLAN.lightDays) : s.N;
  const churnLimits = (s.kind === 'light' || s.kind === 'weekly') && !safetyFirst;
  const ev = new ReplanEvaluator(s, { lockEnd, touchEnd, judgeFrom, realistic, churnLimits });
  const keep: Evaluated = { ...ev.score(ev.keepBuilt(), keepSim), id: nextId(), structure: -1, structureId: plan.structureId, x: null, frame: null, G: 0, C: 0, built: { run: s.realised, out: s.active, log: [], frameSched: null } };

  // start values y(today) of each goal (direction of absolute targets, keep scales)
  const start = s.bindings.map((b) => {
    const y = goalSeries(keepSim, b, s.todayCtx);
    if (!y) return Number.NaN;
    for (let t = Math.min(s.todayIdx, y.length - 1); t < y.length; t++) if (Number.isFinite(y[t]!)) return y[t]!;
    return Number.NaN;
  });
  const built: BuiltGoals = buildGoals(s.todayCtx, start);
  const specs = built.specs;

  // ---- search
  const activeDef = activeFrameDef(plan);
  const activeFrame = activeDef ? buildFrame(s, activeDef) : null;
  const ai = activeFrame ? activeFrame.structures.findIndex((x) => x.id === plan.structureId) : -1;
  const genomeOk = activeFrame !== null && ai > 0 && activeFrame.structures[ai]!.dim === plan.genome.length;
  const baseSpec: ReplanProblemSpec = { lockEnd, touchEnd, judgeFrom, frame: activeDef ?? todayFrameDef(s), structureIds: [], realistic, churnLimits, mode: s.fwd.mode };
  const budget = (k: ReplanKind): number => opts.totalEU ?? (k === 'light' ? REPLAN.budgetEU.light : k === 'weekly' ? REPLAN.budgetEU.weekly : TIER_BUDGET_EU[tierOf(opts.tier ?? plan.provenance.tier)]);
  const cands: Evaluated[] = [];
  let euExternal = 0;
  let base: Float64Array | null = null;
  const run = async (frame: Frame, ids: string[], seeds: Array<{ id: string; x: Float64Array }>, extra: Partial<PlannerConfig>, eu: number) => {
    const r = await search(s, ev, frame, ids, seeds, specs, extra, eu, opts, baseSpec, nextId);
    cands.push(...r.cands);
    euExternal += r.euExternal;
    base = base ?? r.baseGoals;
  };
  const safeFound = () => cands.some((c) => c.vS === 0 && c.vL === 0);
  let free = 0;
  for (let d = lockEnd; d < touchEnd; d++) if (!s.pinned.has(d)) free++;
  if (free === 0) {
    // every day that could change is fixed by the person: nothing to search, the result is their edit with its forecast
  } else if ((s.kind === 'light' || s.kind === 'weekly') && genomeOk && !safetyFirst) {
    const st = activeFrame!.structures[ai]!;
    const x = Float64Array.from(plan.genome);
    const ids = ['baseline', st.id];
    const seeds: Array<{ id: string; x: Float64Array }> = [{ id: st.id, x }];
    if (s.kind === 'weekly')
      for (const j of neighbours(activeFrame!.structures, ai)) {
        const nb = activeFrame!.structures[j]!;
        ids.push(nb.id);
        seeds.push({ id: nb.id, x: transfer(st, nb, x) });
      }
    const sigma = REPLAN.sigma0[s.kind];
    await run(activeFrame!, ids, seeds, { sigmaExplore: sigma, sigmaWarm: sigma }, budget(s.kind));
    // weekly: the whole structure set only when neither the structure nor a neighbour is safe
    if (s.kind === 'weekly' && !safeFound() && keep.vS + keep.vL > 0) await run(activeFrame!, activeFrame!.structures.map((x) => x.id), seeds, { sigmaWarm: sigma }, budget(s.kind));
  } else if (s.kind === 'light' && !safetyFirst) {
    // no genome to perturb (a scenario-started plan): the plan stays unless it became unsafe
  } else {
    const frame = s.N - s.todayIdx >= HORIZON_MIN_DAYS || !activeFrame ? buildFrame(s, todayFrameDef(s)) : activeFrame;
    const seeds = frame === activeFrame && genomeOk ? [{ id: plan.structureId, x: Float64Array.from(plan.genome) }] : shiftedSeeds(s, activeFrame, frame).map((x) => ({ id: frame.structures[x.structure]!.id, x: x.x }));
    const extra: Partial<PlannerConfig> = s.kind === 'weekly' ? { sigmaWarm: REPLAN.sigma0.weekly } : {};
    await run(frame, frame.structures.map((x) => x.id), seeds, extra, budget(s.kind));
  }

  // ---- selection: (v_S, v_L, −⌊(G − G_keep)/q_G⌋, λ_S·C + R, −G)
  const all = [keep, ...cands];
  const sc = scalesOf(specs, base ?? keep.goals, all);
  for (const c of all) c.G = goalScore(specs, sc, c.goals);
  const level = (c: Evaluated) => Math.floor((c.G - keep.G) / GOAL_SCORE_STEP + 1e-9);
  const minV = Math.min(...all.map((c) => c.vS + c.vL));
  const top = all.filter((c) => c.vS + c.vL <= minV + 1e-12);
  const topLevel = Math.max(...top.map(level));
  for (const c of top) if (c.C === null && level(c) === topLevel) c.C = churnDistance(s.todayCtx, s.active, rebuild(ev, c).out, s.todayIdx);
  const keyOf = (c: Evaluated): number[] => [c.vS, c.vL, -level(c), REPLAN.lambdaS * (c.C ?? 1) + c.reg - (c === keep ? REPLAN.tieEps : 0), -c.G, c.id];
  const order = [...all].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  });
  let chosen: Evaluated | null = null;
  const rejected: string[] = [];
  let checked = 0;
  for (const c of order) {
    if (c.vS > 0 || (c !== keep && c.vL > 0)) break;
    if (checked >= REPLAN.finalists) break;
    checked++;
    const v = c === keep ? keepCheck : verify(s, ev, rebuild(ev, c));
    if (v.ok) {
      chosen = c;
      break;
    }
    rejected.push(...v.reasons);
  }
  // no finalist verified but the current plan still does: keep it (a re-plan never leaves a safe plan for no plan)
  if (!chosen && keep.vS === 0 && keepCheck.ok && order.indexOf(keep) >= checked) chosen = keep;
  // nothing verified and the current plan does not either (e.g. a person's edit leaves the plan just past the cushioned
  // rate or deficit margin, while the search's finalists push the goals harder): the current plan with the deficit eased
  // on the days that may change, step by step; a plan that asks less of the person is better than no plan (Q3-J5-01)
  if (!chosen && free > 0) {
    for (const k of REPLAN.easeSteps) {
      const out = easedSchedule(s.active, lockEnd, touchEnd, s.pinned, k);
      if (out === s.active) break;
      const eb: Built = { run: s.realised === s.active ? out : easedSchedule(s.realised, lockEnd, touchEnd, s.pinned, k), out, log: [], frameSched: null };
      ev.built.set(eb.run, eb);
      const e = ev.score(eb, ev.sim(eb.run));
      if (e.vS > 0 || e.vL > 0 || !verify(s, ev, eb).ok) continue;
      chosen = { ...e, id: nextId(), structure: -1, structureId: plan.structureId, x: null, frame: null, G: goalScore(specs, sc, e.goals), C: null, built: eb };
      break;
    }
  }
  // a candidate whose days from today are materially the current plan's (templates and fasts) is no change
  if (chosen && chosen !== keep && !safetyFirst && sameFuture(s.active, rebuild(ev, chosen).out, s.todayIdx)) chosen = keep;
  const euUsed = () => s.fwd.runs + euExternal;
  opts.onDiagnostics?.({
    todayIdx: s.todayIdx,
    lockEnd,
    touchEnd,
    judgeFrom,
    safetyFirst,
    candidates: cands.length,
    keep: { vS: keep.vS, vL: keep.vL, G: keep.G, reg: keep.reg, violated: keep.violated },
    chosen: chosen ? { structureId: chosen.structureId, vS: chosen.vS, vL: chosen.vL, G: chosen.G, C: chosen.C, reg: chosen.reg, violated: chosen.violated } : null,
    rejected: [...keepCheck.reasons.map((r) => `current:${r}`), ...rejected],
  });

  // ---- result
  const fromDay = s.todayIdx;
  const wsd = req.state.trendWeight.sd;
  const extraSeries = goalSeriesIds(s.todayCtx);
  const keepRuns = forecastRuns(s.fwd, s.realised);
  const why = WHY[req.trigger];
  if (!chosen) {
    const reasons = [...new Set([...keep.violated.filter((v) => !v.startsWith('churn.')), ...keepCheck.reasons, ...rejected].map(plainReason))];
    const asP = goalOutcomes(s.todayCtx, keepRuns, fromDay, plan.startDate, wsd);
    return {
      status: 'noSafePlan',
      plan,
      diff: [],
      forecast: { asPrescribed: asP, realistic: goalOutcomes(s.todayCtx, forecastRuns(s.fwd, realisticSchedule(s.realised, fromDay, req.adherence, s.fwd.rp)), fromDay, plan.startDate, wsd), bands: bandsOf(keepRuns, fromDay, s.N, extraSeries, wsd), fromDay },
      goalDates: [],
      proposals: [],
      explanation: [
        'No safe plan was found from here, so the current plan was not changed.',
        ...(reasons.length ? [`It would break ${reasons.slice(0, 3).join('; ')}.`] : []),
        'Please check the plan with your clinician or adjust your goals or limits.',
      ],
      euUsed: euUsed(),
    };
  }
  const b = chosen === keep ? keep.built! : rebuild(ev, chosen);
  const out = b.out;
  const unchanged = chosen === keep;
  // an edit by the person (`baseline` given) is a change even when the search keeps the edited plan
  const edited = s.base !== s.active && !sameFuture(s.base, s.active, s.todayIdx);
  const load = loadChange(s.todayCtx, s.base, out, s.todayIdx, s.N);
  const changesGiven = !!req.changes && Object.keys(req.changes).length > 0;
  // in the last 7 days the horizon grows to today + 7 (§7.2); a kept schedule then still returns the grown record (`ok`,
  // a new version) so the end date never depends on whether the search changed anything (review V1b-04)
  const grows = s.N !== plan.schedule.horizonDays || dateAt(plan.startDate, s.N) !== plan.endDate;
  const status: ReplanResult['status'] = unchanged && !edited ? (changesGiven || grows ? 'ok' : 'unchanged') : load.raises.length ? 'proposal' : 'ok';
  const frameDef = chosen.frame?.def ?? plan.provenance.replanFrame;
  const provenance: ActivePlanProvenance = { ...plan.provenance, ...(frameDef ? { replanFrame: frameDef } : {}) };
  const nextPlan: ActivePlanRecord =
    status === 'unchanged'
      ? plan
      : {
          ...plan,
          version: plan.version + 1,
          request: s.request,
          endDate: dateAt(plan.startDate, s.N),
          structureId: unchanged ? plan.structureId : chosen.structureId,
          genome: unchanged || !chosen.x ? [...plan.genome] : Array.from(chosen.x),
          schedule: out,
          provenance,
        };

  // forecasts: as prescribed and at revealed adherence, bands from today
  const runsA: ForecastRuns = unchanged ? keepRuns : forecastRuns(s.fwd, b.run);
  const runsR = forecastRuns(s.fwd, realisticSchedule(b.run, fromDay, req.adherence, s.fwd.rp));
  const asP = goalOutcomes(s.todayCtx, runsA, fromDay, plan.startDate, wsd);
  const real = goalOutcomes(s.todayCtx, runsR, fromDay, plan.startDate, wsd);
  const keepAsP = s.base !== s.active ? goalOutcomes(s.todayCtx, forecastRuns(s.fwd, s.baseRealised), fromDay, plan.startDate, wsd) : unchanged ? asP : goalOutcomes(s.todayCtx, keepRuns, fromDay, plan.startDate, wsd);
  const bandsA = bandsOf(runsA, fromDay, s.N, extraSeries, wsd);
  const goalDates: ReplanGoalDate[] = asP.map((g, k) => {
    const t = g.target ?? null;
    let range: [string, string] | null = null;
    const band = bandsA[g.metric as SeriesId];
    if (t !== null && band) {
      const sign = (keepAsP[k]?.current ?? g.endP50) > t ? -1 : 1;
      const early = crossingDay(sign < 0 ? band.p10 : band.p90, 0, band.p50.length, t, sign);
      const late = crossingDay(sign < 0 ? band.p90 : band.p10, 0, band.p50.length, t, sign);
      if (early !== null && late !== null) range = [dateAt(plan.startDate, fromDay + early), dateAt(plan.startDate, fromDay + late)];
    }
    return { goal: k, before: keepAsP[k]?.date ?? null, after: g.date ?? null, range };
  });

  const diff = unchanged && !edited ? [] : diffRows(s.todayCtx, s.base, out, plan.startDate, s.todayIdx, Math.min(s.N, s.todayIdx + REPLAN.diffDays), why);
  const proposals: ReplanProposal[] = [];
  if (status === 'proposal')
    proposals.push({ id: `raise-load@${req.today}`, text: `This update asks more of you (${load.raises.join(', ')}). It applies only when you agree.`, raisesLoad: true, apply: undefined });

  const explanation: string[] = [];
  if (status === 'unchanged') explanation.push('No change: the current plan is still the best fit from here within what the model can tell apart.');
  else if (unchanged && edited) explanation.push(`${why} The days you changed are in the plan; the other days stay as they were, because they are still the best fit.`);
  else if (unchanged && !changesGiven) explanation.push(`The plan now runs to ${dateAt(plan.startDate, s.N)}, at least 7 days from today; the schedule from here stays the same, because it is still the best fit.`);
  else if (unchanged) explanation.push('Your goals or limits changed; the schedule from here stays the same, because it is still the best fit.');
  else explanation.push(`${why} The plan from today to the end (${s.N - s.todayIdx} days) was updated${s.pinned.size ? ' around the days you changed' : ''}; days already lived stay as they were.`);
  if (status === 'proposal') explanation.push(proposals[0]!.text);
  if (bypass && s.kind !== 'user' && !unchanged) explanation.push(`Today and tomorrow could change too: the plan from here would otherwise break ${[...new Set([...keep.violated.filter((v) => !v.startsWith('churn.')), ...keepCheck.reasons].map(plainReason))].slice(0, 2).join('; ') || 'a safety limit'}.`);
  else if (!bypass && !unchanged) explanation.push(s.kind === 'light' ? 'Only the next 7 days were looked at; today and tomorrow keep their prescription (tomorrow\'s food may move by up to a tenth).' : 'Today and tomorrow keep their prescription.');
  if (judgeFrom > s.todayIdx) explanation.push(`Because of the last few days some safety limits stay outside their range until ${dateAt(plan.startDate, judgeFrom)} whatever the plan does; the plan is judged on them from then on.`);
  if (req.logs.length > 0) explanation.push(`The forecast starts from your confirmed state on ${req.state.anchorDate} and the ${req.logs.length} day${req.logs.length === 1 ? '' : 's'} you logged since.`);
  else explanation.push(`The forecast starts from your confirmed state on ${req.state.anchorDate}.`);
  explanation.push(...goalLines(asP, real));
  if (realistic) explanation.push('The plan was chosen on what you have actually been doing lately, not only on the prescription.');

  return {
    status,
    plan: nextPlan,
    diff,
    forecast: { asPrescribed: asP, realistic: real, bands: bandsA, realisticBands: bandsOf(runsR, fromDay, s.N, extraSeries, wsd), fromDay, before: keepAsP },
    goalDates,
    proposals,
    explanation,
    euUsed: euUsed(),
  };
}

// ------------------------------------------------------------------------------------------------------------ start bridge

/** Freeze 'change' targets as absolute values from the start values (§9.3: "lose 8 kg" stays measured from the start). */
export function freezeTargets(goals: PlannerRequestV2['goals'], startValues: ReadonlyMap<number, number>): PlannerRequestV2['goals'] {
  return absoluteGoals(goals, (k) => startValues.get(k) ?? Number.NaN);
}

/**
 * The schedule moved to another start weekday (the living plan's start rule): with j = weekday(start) − weekday(schedule
 * start) mod 7 the days become old[j..H−1] then the old last week's first j days; blocks and fasts shift by −j (fasts in
 * the skipped days are dropped). Same weekday: only the date changes.
 */
export function anchorToStart(schedule: Schedule, startDate: string): { schedule: Schedule; skipped: number } {
  const H = schedule.horizonDays;
  const j = (((isoWeekday(startDate) - isoWeekday(schedule.startDate)) % 7) + 7) % 7;
  if (j === 0) return { schedule: { ...schedule, startDate }, skipped: 0 };
  const tail = Math.max(0, H - 7);
  const days = [...schedule.days.slice(j, H), ...schedule.days.slice(tail, tail + j)].map((d) => ({ ...d }));
  while (days.length < H) days.push({ ...schedule.days[schedule.days.length - 1]! });
  const blocks = schedule.blocks
    ?.map((b) => ({ ...b, startDay: Math.max(0, b.startDay - j), endDay: b.endDay >= H ? H : Math.max(0, b.endDay - j) }))
    .filter((b) => b.endDay > b.startDay);
  const events = (schedule.events ?? []).filter((e) => e.startDay >= j).map((e) => ({ ...e, startDay: e.startDay - j }));
  return { schedule: { ...schedule, startDate, days, events, ...(blocks ? { blocks } : {}) }, skipped: j };
}

function defaultProvenance(): ActivePlanProvenance {
  return { seed: '', tier: 'S', budgetEU: 0, euUsed: 0, registryHash: buildModelParams(MODULES).registryHash, engineVersion: ENGINE_VERSION, libraryVersion: 0, structures: 0 };
}

/**
 * `ActivePlanRecord` from a started rung (§9.3): change targets frozen as ABSOLUTE values (from the rung's scorecard start
 * values), kind = the rung, the genome and its frame (an anchored start weekday shifts the frame by the skipped days).
 * `opts.schedule` is the anchored schedule when the caller anchored it; otherwise the rung's schedule is anchored here.
 */
export function toActivePlan(
  rung: RungPlan,
  request: PlannerRequestV2,
  opts: { planId: string; startDate?: string; version?: number; schedule?: Schedule; provenance?: Partial<ActivePlanProvenance> },
): ActivePlanRecord {
  const decodedStart = rung.schedule.startDate;
  const startDate = opts.startDate ?? request.startDate ?? request.profile.startDate ?? decodedStart;
  const anchored = opts.schedule ? { schedule: opts.schedule, skipped: (((isoWeekday(startDate) - isoWeekday(decodedStart)) % 7) + 7) % 7 } : anchorToStart(rung.schedule, startDate);
  const startValues = new Map(rung.scorecard.map((g) => [g.goal, g.start] as const));
  const goals = freezeTargets(request.goals, startValues);
  const H = anchored.schedule.horizonDays;
  const frame: ReplanFrame = { offset: -anchored.skipped, horizonDays: request.horizonDays, weightKg: request.profile.body.weightKg };
  return {
    planId: opts.planId,
    version: opts.version ?? 1,
    kind: rung.kind,
    request: { ...request, goals, startDate, profile: { ...request.profile, startDate } },
    startDate,
    endDate: dateAt(startDate, H),
    structureId: rung.genome.structureId,
    genome: [...rung.genome.x],
    schedule: { ...anchored.schedule, startDate },
    provenance: { ...defaultProvenance(), plannerVersion: 2, ...opts.provenance, replanFrame: frame },
  };
}

/**
 * `ActivePlanRecord` for a plan started from a Simulator scenario: kind 'custom', no genome (every re-plan searches the
 * full structure set on the days left; a light re-plan keeps the plan unless it became unsafe).
 */
export function toActivePlanFromScenario(schedule: Schedule, request: PlannerRequestV2, opts: { planId: string; startDate?: string; version?: number; startValues?: ReadonlyMap<number, number> }): ActivePlanRecord {
  const startDate = opts.startDate ?? schedule.startDate;
  return {
    planId: opts.planId,
    version: opts.version ?? 1,
    kind: 'custom',
    request: { ...request, goals: freezeTargets(request.goals, opts.startValues ?? new Map()), startDate, profile: { ...request.profile, startDate } },
    startDate,
    endDate: dateAt(startDate, schedule.horizonDays),
    structureId: '',
    genome: [],
    schedule: { ...schedule, startDate },
    provenance: defaultProvenance(),
  };
}

