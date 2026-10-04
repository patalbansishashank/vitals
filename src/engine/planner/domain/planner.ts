/**
 * Coordinator side of the Vitals planner (dossier 18 §4.11, §4.14, §4.17, §4.19; MODEL_SPEC §10): compiles the request,
 * runs the baseline, builds goals from the ranked list, runs the optimisation pipeline (`../optim` `runPlanner`)
 * against an evaluator (worker pool or local), runs time-to-target searches for unattainable targets, and assembles
 * the `PlannerResult` (options with schedules, simulations, scorecards, explanations, feasibility report).
 */
import { SERIES, SERIES_INDEX, type SeriesId } from '../../types/metrics';
import type { Schedule } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import type { Evaluator } from '../optim/types';
import { complexityPenalty, rocWeights, timeToTarget } from '../optim/goals';
import { runPlanner, type PlannerConfig, type PlannerProblem, type PlannerResult as OptimResult, type Tier } from '../optim/pipeline';
import { hashString } from '../optim/rng';
import { BLOCKS } from './registry/blocks';
import type { PlanningContext } from './context';
import { decodePlan, gridStep as gridStepOf, roundGenome as roundGenomeOf } from './decode';
import { buildVariant, type EvalVariant, type HostInit, type VariantProblem } from './evaluatorHost';
import { goalNotes, hungerAssessment, phaseExplanations, safetyNotes, bindingNotes, ruleText, hedge } from './explain';
import { FEATURE_SCHEMA, complexityCounts } from './features';
import { goalSeries, goalValue, type BuiltGoals } from './goalSpecs';
import { BAND_SERIES, EA_FLOOR, MARGIN_IDS, type EnginePlanModel } from './model';
import { FAST_COMPARE, describeFasts, fastingVerdict, rivalVerdict, type OptionSide, type RivalPlan } from './fastingExplain';
import { fastingKind, longestFastH, usesFast } from './fastMath';
import { stubModules } from './physiology';
import { OVERLAY_HOSTS, toUnit, transferGenome as transfer, type SkeletonStructure, type PlanSkeleton } from './skeleton';
import { validatePlan } from './validate';
import { runLadderPlanner } from './ladderPlanner';
import { toV1Progress, toV1Result } from './compat';
import { equipmentFor, type EquipmentForResult } from './equipment';
import type { EvidenceGrade, GoalFeasibility, GoalScore, PlanOption, PlannerProgressInfo, PlannerProgressV2, PlannerRequest, PlannerResult, SafetyNote } from './types';
import { quantileSorted } from '../optim/stats';
import { ROUTE_MAX_WEEKS, beyondSafetyLimits } from './reach';
import type { TargetReach } from './types';

export { beyondSafetyLimits } from './reach';

export interface PlannerOptions {
  onProgress?: (p: PlannerProgressInfo) => void;
  /** Cooperative cancellation (an AbortSignal works): the best result so far is returned with complete = false. */
  signal?: { readonly aborted: boolean };
  /** Evaluator for a problem variant (worker pool). Default: an in-thread `EvaluatorHost`. */
  evaluatorFor?: (variant: EvalVariant, init: HostInit) => Evaluator;
  tier?: Tier;
  /** Main search algorithm (default: the shipped hybrid; 'v2' = the v2 search alone). */
  algorithm?: 'hybrid' | 'v2';
  totalEU?: number;
  /** Wall clock for progress throttling (the worker binding passes performance.now; the engine has no clock). */
  now?: () => number;
  /** Minimum ms between progress callbacks when `now` is given (18 §4.19: ≤ 4 Hz). */
  progressIntervalMs?: number;
  /** Run time-to-target searches for unattainable targets (default true). */
  timeToTarget?: boolean;
  /** EU budget of the first time-to-target search (default by tier: S 600, M 900, L 1500). */
  tttBudgetEU?: number;
  /** Advanced: overrides of the optimiser configuration (diagnostics and tuning; seed/tier/signal are set here). */
  pipeline?: Partial<Omit<PlannerConfig, 'seed' | 'tier' | 'signal' | 'onProgress'>>;
  /** Calibrate the prior chance cushion from the ensemble spread of probe plans (default true when the ensemble runs). */
  calibrateCushion?: boolean;
  /** Advanced: receives the optimiser's raw result (diagnostics). */
  onOptimResult?: (res: OptimResult<SkeletonStructure>) => void;
  /**
   * Daily band series of one plan for ensemble draws 0..draws−1 (worker pool). Default: the in-thread host. Returns one
   * Float32Array per draw, series-major, each series of length horizon + 1.
   */
  bandsFor?: (variant: EvalVariant, structure: number, x: Float64Array, draws: number, series: readonly string[], option: number, drawBase?: number) => Promise<Float32Array[]>;
}

const GRADE_ORDER: EvidenceGrade[] = ['A', 'B', 'C', 'D'];
/** Rung title of a v1 option id (fixed mapping hard 'A', medium 'B', easy 'C'; compat.ts). */
const RUNG_TITLE_OF_ID: Readonly<Record<PlanOption['id'], string>> = { A: 'Hard', B: 'Medium', C: 'Easy' };
const worse = (a: EvidenceGrade, b: EvidenceGrade): EvidenceGrade => (GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b);

export function seedOf(req: PlannerRequest): string {
  if (req.seed !== undefined) return String(req.seed);
  const key = JSON.stringify([req.profile, req.goals, req.horizonDays, req.startDate ?? null, req.constraints ?? null, req.safety ?? null, req.strictness ?? null]);
  return `req-${hashString(key).toString(16)}`;
}

/** Skeleton equality ignoring the listed fields. */
function sameExcept(a: PlanSkeleton, b: PlanSkeleton, except: (keyof PlanSkeleton)[]): boolean {
  const strip = (s: PlanSkeleton) => JSON.stringify(Object.entries(s).filter(([k]) => !except.includes(k as keyof PlanSkeleton)));
  return strip(a) === strip(b);
}

/** Label of the 24-h fast overlay and of a multi-day fast event (ablation labels and the fasting explanations). */
const FAST_LABEL_24 = '24-hour fasts';
const eventFastLabel = (h: number) => `${Math.round(h)}-hour fasts`;

/** True when a skeleton uses a fasting lever (multi-day fast, 24-h fast overlay or zero-energy days). */
export function skeletonFasts(sk: PlanSkeleton): boolean {
  return sk.event !== null || sk.overlay?.lever === 'fastDay24' || sk.segments.some((g) => g.kind === 'phase' && g.block === 'B12');
}

/** What a fasting skeleton's fasts are, in plain words ("72-hour fasts", "a weekly 24-hour fast", "zero-energy days"). */
export function fastPhrase(sk: PlanSkeleton): string | null {
  const parts: string[] = [];
  if (sk.event) parts.push(eventFastLabel(sk.event.durationH));
  if (sk.overlay?.lever === 'fastDay24') parts.push(sk.overlay.perWeek === 2 ? 'two 24-hour fasts a week' : 'a weekly 24-hour fast');
  if (sk.segments.some((g) => g.kind === 'phase' && g.block === 'B12')) parts.push('zero-energy days');
  return parts.length ? parts.join(' and ') : null;
}

/**
 * Fasting structures closest to structure `i` for the rival search when the run evaluated none (PLANNER_V2_SPEC §3.6):
 * the same skeleton with a fast added (overlay or event) first, then the fasting structures in prior order; ≤ `max`.
 */
export function nearestFastingStructures(structures: readonly SkeletonStructure[], i: number, max: number): number[] {
  const sk = structures[i]?.skeleton;
  if (!sk) return [];
  const fasting = structures.flatMap((s, j) => (j !== i && !s.skeleton.baseline && skeletonFasts(s.skeleton) ? [j] : []));
  const twins = fasting.filter((j) => sameExcept(structures[j]!.skeleton, sk, ['overlay', 'event']));
  return [...new Set([...twins, ...fasting])].slice(0, max);
}

/** Neutralised variants for ablation explanations (18 §4.17 item 4). */
export function ablationsFor(structures: readonly SkeletonStructure[], i: number, x: Float64Array): Array<{ label: string; structure: number; x: Float64Array }> {
  const st = structures[i]!;
  const sk = st.skeleton;
  if (sk.baseline) return [];
  const out: Array<{ label: string; structure: number; x: Float64Array }> = [];
  const find = (pred: (s: PlanSkeleton) => boolean) => structures.findIndex((s, j) => j !== i && !s.skeleton.baseline && pred(s.skeleton));
  const add = (label: string, j: number) => {
    if (j >= 0) out.push({ label, structure: j, x: transfer(st, structures[j]!, x) });
  };
  if (sk.overlay) add(sk.overlay.lever === 'refeedDay' ? 'without the refeed days' : `without the ${FAST_LABEL_24}`, find((s) => s.overlay === null && sameExcept(s, sk, ['overlay'])));
  if (sk.event) add(`without the ${eventFastLabel(sk.event.durationH)}`, find((s) => s.event === null && sameExcept(s, sk, ['event'])));
  if (sk.creatine) add('without creatine', find((s) => !s.creatine && sameExcept(s, sk, ['creatine'])));
  const cyc = sk.segments.findIndex((g) => g.kind === 'cycle');
  if (cyc >= 0) {
    const seg = sk.segments[cyc]!;
    if (seg.kind === 'cycle') {
      const segs = sk.segments.map((g, k) => (k === cyc ? { kind: 'phase' as const, block: seg.on } : g));
      add('without the diet breaks', find((s) => JSON.stringify(s.segments) === JSON.stringify(segs) && sameExcept(s, sk, ['segments'])));
    }
  }
  const gene = (path: string, label: string) => {
    const k = st.geneIndex[path];
    if (k === undefined || x[k]! <= 1e-9) return;
    const y = Float64Array.from(x);
    y[k] = 0;
    out.push({ label, structure: i, x: y });
  };
  gene('cardio.sessions', 'with the fewest cardio sessions');
  gene('rt.sessions', 'with the fewest resistance-training sessions');
  gene('steps', 'without the extra steps');
  return out;
}

export interface Assembly {
  ctx: PlanningContext;
  goals: BuiltGoals;
  full: EnginePlanModel;
  main: VariantProblem;
}

export function scheduleFor(a: Assembly, structure: number, x: Float64Array): { schedule: Schedule; log: ReturnType<EnginePlanModel['repair']>['log']; plan: ReturnType<typeof decodePlan> } {
  const st = a.main.structures[structure]!;
  const decoded = a.full.decode(st, x);
  const plan = a.full.planOf(decoded) ?? decodePlan(a.ctx, st, x);
  const r = a.full.repair(st, decoded);
  return { schedule: r.schedule, log: r.log, plan };
}

function confidenceOf(a: Assembly, plan: ReturnType<typeof decodePlan>): EvidenceGrade {
  let g: EvidenceGrade = 'A';
  for (const goal of a.ctx.goals) g = worse(g, goal.def.grade as EvidenceGrade);
  for (const ph of plan.phases) g = worse(g, BLOCKS[ph.blockId].grade);
  return g;
}

/** Daily P10/P50/P90 per series from per-draw buffers (series-major, length T + 1 each). */
function dailyBands(ctx: PlanningContext, sim: SimulationResult, series: readonly SeriesId[], buffers: readonly Float32Array[]): NonNullable<PlanOption['bands']> {
  const T1 = ctx.horizonDays + 1;
  const out: NonNullable<PlanOption['bands']>['series'] = {};
  series.forEach((id, k) => {
    const def = SERIES[SERIES_INDEX[id]]!;
    const delta = def.presentation === 'deltaFromBaseline';
    const nominal0 = sim.initial[id] ?? Number.NaN;
    const p10 = new Float32Array(T1);
    const p50 = new Float32Array(T1);
    const p90 = new Float32Array(T1);
    const vals: number[] = [];
    for (let t = 0; t < T1; t++) {
      vals.length = 0;
      for (const b of buffers) {
        let v = b[k * T1 + t]!;
        if (delta) v = v - b[k * T1]! + nominal0;
        if (Number.isFinite(v)) vals.push(v);
      }
      vals.sort((x, y) => x - y);
      p10[t] = vals.length ? quantileSorted(vals, 0.1) : Number.NaN;
      p50[t] = vals.length ? quantileSorted(vals, 0.5) : Number.NaN;
      p90[t] = vals.length ? quantileSorted(vals, 0.9) : Number.NaN;
    }
    if (vals.length) out[id] = { p10, p50, p90 };
  });
  return { draws: buffers.length, series: out };
}

/** Severity of the plan-level safety notes (17 §3 severities: fasting tiers W-F02/F03 caution, W-F04 danger). */
export function safetyItemsFor(ctx: PlanningContext, schedule: Schedule, plan: ReturnType<typeof decodePlan>, sim: SimulationResult): SafetyNote[] {
  const texts = safetyNotes(ctx, schedule, plan);
  const longest = Math.max(0, ...(schedule.events ?? []).map((e) => e.durationH));
  const items: SafetyNote[] = texts.map((text) => {
    if (/^Stop the fast/.test(text)) return { text, severity: longest > 72 ? 'danger' : 'caution', rule: longest > 72 ? 'W-F04' : longest > 48 ? 'W-F03' : 'W-F02' };
    if (/LDL/.test(text)) return { text, severity: 'caution', rule: 'W-M09' };
    if (/lean tissue|fat-loss advantage/.test(text)) return { text, severity: 'caution' };
    return { text, severity: 'info' };
  });
  for (const w of sim.warnings) {
    if (w.severity === 'info') continue;
    if (items.some((it) => it.rule === w.id)) continue;
    items.push({ text: `${w.message} (days ${w.startDay + 1}-${w.endDay + 1})`, severity: w.severity === 'danger' ? 'danger' : 'caution', rule: w.id });
  }
  const rank = { danger: 0, caution: 1, info: 2 } as const;
  return items.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/**
 * Simulator cautions a plan may carry when they are listed with it (R-PLAN-SAFETY): they come with a regime the user
 * opted into or chose (fasting tiers, very-low-carbohydrate eating, a fat-loss deficit while training: W-E07, energy
 * availability 30-35 kcal/kg FFM for more than two weeks, whose floor of 30 the planner keeps with headroom, ruling
 * R-EA-PLANNER), with the person (women's energy-availability flag in any deficit with training, screening context),
 * not with a margin the planner could keep. Every other caution or danger warning is avoided by the planner's margins;
 * a finalist that still raises one is rejected.
 */
export function listableWarning(ctx: PlanningContext, schedule: Schedule, id: string): boolean {
  const fasts = (schedule.events ?? []).length > 0 || schedule.programs.some((p) => p.energy.kind === 'zero');
  const vlc = (schedule.blocks ?? []).some((b) => b.buildingBlockId === 'B2');
  if (fasts && ['W-F02', 'W-F03', 'W-F10', 'W-F13', 'W-20-FAST-LEAN'].includes(id)) return true;
  if (vlc && ['W-M09', 'W-M24'].includes(id)) return true;
  if (id === 'W-F04' && ctx.caps.fastTierAllowed.T4) return true;
  if (id === 'W-E07') return true;
  if (id === 'W-E18' && ctx.caps.sex === 'female') return true;
  return ['W-P03', 'W-P05', 'W-P06', 'W-P07', 'W-U02'].includes(id);
}

/** Caution/danger warnings of a Simulator-mode run that the plan may not carry (see `listableWarning`). */
export function unlistableWarnings(ctx: PlanningContext, schedule: Schedule, sim: SimulationResult): SimulationResult['warnings'] {
  return sim.warnings.filter((w) => w.severity !== 'info' && !listableWarning(ctx, schedule, w.id));
}

/** End-of-plan change of a daily series: mean of the last 7 days − the start value (NaN when absent). */
export function seriesChange(sim: SimulationResult, id: SeriesId): number {
  const d = sim.daily[id];
  const y0 = sim.initial[id];
  if (!d || !d.length || y0 === undefined || !Number.isFinite(y0)) return NaN;
  const n = Math.min(7, d.length);
  let s = 0;
  for (let i = d.length - n; i < d.length; i++) s += d[i]!;
  return s / n - y0;
}

/** Lowest EA_7 where the Simulator's EA rules apply, from the engine's W-E07 margin series (m = (EA − 35)/5). */
export function eaLowOf(sim: SimulationResult): { value: number; day: number } | null {
  const wm = sim.warningMargins?.find((w) => w.id === 'W-E07');
  if (!wm) return null;
  let best: { value: number; day: number } | null = null;
  for (let d = 0; d < wm.margin.length; d++) {
    const m = wm.margin[d]!;
    if (!Number.isFinite(m)) continue;
    const v = EA_FLOOR.cautionUpper + EA_FLOOR.scale * m;
    if (!best || v < best.value) best = { value: v, day: d };
  }
  return best;
}

/** Search record of a rival: from the run's best plan with a fast, or one evaluation of a transferred genome. */
export interface RivalRecord {
  structure: number;
  x: Float64Array;
  desirability: ArrayLike<number>;
  goalScore: number;
  vS: number;
  violated: number[];
  /** Regulariser (complexity, hunger, time) of the planner-mode run. */
  reg: number;
}

/**
 * Option `i`'s plan with fasts added (ruling R-FAST-GATE rival search): each fasting twin of its skeleton (the same phases
 * plus the 24-h fast overlay or a multi-day fast), its genome transferred, and — for the 24-h overlay — the eating days
 * of the host phases raised by the energy the fasts remove (energy × 7 / (7 − fasts/week × (meals − 1)/meals), within
 * the gene's range), so the twin delivers the same weekly energy as the plan without fasts.
 */
export function equalEnergyFastTwins(ctx: PlanningContext, structures: readonly SkeletonStructure[], i: number, x: Float64Array): Array<{ structure: number; x: Float64Array }> {
  const src = structures[i];
  if (!src) return [];
  const sk = src.skeleton;
  const out: Array<{ structure: number; x: Float64Array }> = [];
  structures.forEach((st, j) => {
    const t = st.skeleton;
    if (j === i || t.baseline || !skeletonFasts(t) || t.overlay?.lever === 'refeedDay' || !sameExcept(t, sk, ['overlay', 'event'])) return;
    const y = transfer(src, st, x);
    if (t.overlay?.lever === 'fastDay24') {
      const mi = st.geneIndex['meals'];
      const mg = mi !== undefined ? st.genes[mi]! : undefined;
      const meals = mg ? Math.round(mg.min + y[mi!]! * (mg.max - mg.min)) : ctx.practical.meals.min;
      const factor = 7 / (7 - t.overlay.perWeek * ((Math.max(1, meals) - 1) / Math.max(1, meals)));
      t.segments.forEach((seg, k) => {
        const block = seg.kind === 'phase' ? seg.block : seg.on;
        const gi = st.geneIndex[`seg${k}.energy`];
        if (gi === undefined || !OVERLAY_HOSTS.fastDay24.includes(block)) return;
        const g = st.genes[gi]!;
        y[gi] = toUnit(g, Math.min(g.max, (g.min + y[gi]! * (g.max - g.min)) * factor));
      });
    }
    out.push({ structure: j, x: y });
  });
  // the 24-h overlay variants first (closest to "the same plan with a weekly fast"), then multi-day events
  return out.sort((p, q) => Number(structures[q.structure]!.skeleton.overlay !== null) - Number(structures[p.structure]!.skeleton.overlay !== null));
}

/**
 * Assess the rival (ruling R-FAST-GATE): one Simulator-mode run (goal values, fat / lean change, hunger peak, warnings,
 * EA), the independent validator, and the P90 chance constraint over the ensemble when the plan is otherwise safe.
 */
export async function assessRival(a: Assembly, rec: RivalRecord, chanceOf: ((structure: number, x: Float64Array) => Promise<{ ok: boolean; worst: string | null } | null>) | null): Promise<RivalPlan | null> {
  const st = a.main.structures[rec.structure];
  const phrase = st ? fastPhrase(st.skeleton) : null;
  if (!st || !phrase) return null;
  const { schedule } = scheduleFor(a, rec.structure, rec.x);
  if (!usesFast(fastingKind(schedule))) return null;
  const sim = a.full.simulate(schedule, -1);
  const valid = validatePlan(a.ctx, schedule).ok;
  const unlistable = unlistableWarnings(a.ctx, schedule, sim).map((w) => ({ id: w.id as string, message: w.message }));
  const safe = valid && !unlistable.length && rec.vS === 0;
  return {
    structureId: st.id,
    phrase,
    kind: fastingKind(schedule),
    longestFastH: longestFastH(schedule),
    desirability: rec.desirability,
    goalScore: rec.goalScore,
    vS: rec.vS,
    violated: [...new Set(rec.violated.map((j) => MARGIN_IDS[j] ?? String(j)))],
    valid,
    unlistable,
    chance: safe && chanceOf ? await chanceOf(rec.structure, rec.x) : null,
    values: a.goals.bindings.map((b) => goalValue(sim, b, a.ctx)),
    fatChange: seriesChange(sim, 'fatMass'),
    leanChange: seriesChange(sim, 'leanTissue'),
    hungerPeak: hungerAssessment(a.ctx, sim).peak7Idx,
    eaLow: eaLowOf(sim),
  };
}

/** Weighted goal score G = Σ w_k·min(1, d̃_k) over the active goals (ROC weights, as `GoalSystem.goalScore`). */
export function goalScoreOf(res: OptimResult<SkeletonStructure>, d: ArrayLike<number>): number {
  const w = rocWeights(d.length);
  let g = 0;
  for (let k = 0; k < d.length; k++) if (res.goals.status[k] === 'active') g += w[k]! * Math.min(1, d[k]!);
  return g;
}

/** Search desirability d̃ of raw goal functionals against the run's final scales (as `GoalSystem.dRaw`). */
export function desirabilityFrom(res: OptimResult<SkeletonStructure>, specs: BuiltGoals['specs'], raw: ArrayLike<number>): Float64Array {
  return Float64Array.from(specs, (sp, k) => {
    const st = res.goals.status[k];
    if (st === 'metAtBaseline') return 1;
    if (st === 'notImprovable') return 0;
    const sc = res.goals.scales[k]!;
    const f = (sp.sense === 'min' ? -1 : 1) * raw[k]!;
    return sc.u - sc.b > 1e-12 ? Math.min(1, (f - sc.b) / (sc.u - sc.b)) : 0;
  });
}

/**
 * "Keep" goals (a target of zero change): how far the value may drift the wrong way and still count as kept — a tenth of
 * the keep scale (5 % of the start value, ≥ 0.5 kg: `keepScale`), at least half a display step (0.05) — so two options
 * that both show "±0.0 kg" get the same verdict (release check 2026-10-01).
 */
export function keepTolerance(keepScale: number): number {
  return Math.max(0.1 * keepScale, 0.05);
}

/** Verdict of one goal of one option (the same word everywhere it is shown). */
export function goalVerdict(value: number, target: number | null, sense: 'min' | 'max' | 'band', keepScale: number | undefined): { met: boolean | null; verdict: GoalScore['verdict']; tolerance: number | undefined } {
  if (target === null) return { met: null, verdict: null, tolerance: undefined };
  const tol = keepScale !== undefined ? keepTolerance(keepScale) : 0;
  const met = sense === 'min' ? value <= target + tol + 1e-9 : value >= target - tol - 1e-9;
  return { met, verdict: met ? (keepScale !== undefined ? 'kept' : 'reached') : 'notReached', tolerance: keepScale !== undefined ? tol : undefined };
}

/**
 * "% of what is achievable" as shown: for a keep goal, how fully it is kept (its keep desirability, 100 when held; the
 * optimiser's P measures the distance to the best loss instead, which read as "19 %" for a goal that was kept).
 */
export function displayPercent(isKeep: boolean, p: number, desirability: number): number {
  const v = isKeep ? Math.min(1, desirability) : p;
  return Number.isFinite(v) ? Math.round(1000 * v) / 10 : 0;
}

export async function buildOption(
  a: Assembly,
  res: OptimResult<SkeletonStructure>,
  k: number,
  relations: string[],
  bandsFor: NonNullable<PlannerOptions['bandsFor']>,
  M: number,
  fastCmp: { rival: RivalPlan | null; steps: Float64Array } | null = null,
  variant: EvalVariant = { kind: 'main' },
  drawBase = 0,
  equipment: { ideal: boolean } | null = null,
): Promise<{ option: PlanOption; plan: ReturnType<typeof decodePlan>; side: OptionSide; equipment: EquipmentForResult | null } | null> {
  const o = res.options[k]!;
  const sf = scheduleFor(a, o.structureIndex, o.x);
  const { log, plan } = sf;
  let schedule = sf.schedule;
  // equipment-aware prescription (PLANNER_V2_SPEC §8.3): the composed sessions' delivered dose is written into the schedule
  // before the Simulator-mode run, so the numbers match what the person is told to do (no-op without a training profile)
  let eq: EquipmentForResult | null = null;
  if (equipment) {
    eq = await equipmentFor(a.ctx, schedule, {
      ideal: equipment.ideal,
      goalDelta: async (s) => {
        const g = a.main.model.goals(a.main.model.simulate(s, -1));
        return Array.from(g, (v, i) => ({ goal: i, delta: v, unit: a.ctx.goals[i]?.def.unit ?? '' }));
      },
    });
    if (eq.infeasible === null) schedule = eq.schedule;
  }
  if (!validatePlan(a.ctx, schedule).ok) return null; // never return an invalid plan (18 §9 item 3)
  const sim: SimulationResult = a.full.simulate(schedule, -1);
  const T = a.ctx.horizonDays;
  const scorecard: GoalScore[] = a.ctx.goals.map((g, i) => {
    const b = a.goals.bindings[i]!;
    const y = goalSeries(sim, b, a.ctx);
    const start = y && Number.isFinite(y[0]!) ? y[0]! : a.goals.start[i]!;
    const value = goalValue(sim, b, a.ctx);
    const target = a.goals.targets[i] ?? null;
    const sense = a.goals.specs[i]!.sense;
    const rob = o.robust?.goals[i];
    const P = o.percentOfPossible[i]!;
    const Q = o.percentOfTarget[i]!;
    const keepS = a.goals.specs[i]!.keep;
    const v = goalVerdict(value, target, sense, keepS);
    return {
      goal: i,
      metric: g.metric,
      label: g.def.label,
      unit: g.def.unit,
      direction: g.direction,
      start,
      value,
      change: value - start,
      target,
      percentOfAchievable: displayPercent(keepS !== undefined, P, Q),
      percentOfTarget: target === null || !Number.isFinite(Q) ? null : Math.round(1000 * Q) / 10,
      met: v.met,
      verdict: v.verdict,
      ...(v.tolerance !== undefined ? { keepTolerance: +v.tolerance.toFixed(3) } : {}),
      costVsA: Math.round(1000 * (o.costVsA[i] ?? 0)) / 10,
      band: rob ? { p10: rob.metric.p10, p50: rob.metric.p50, p90: rob.metric.p90, pTargetMet: Number.isFinite(rob.pTargetMet) ? rob.pTargetMet : null } : null,
      grade: g.def.grade as EvidenceGrade,
    };
  });
  const hunger = hungerAssessment(a.ctx, sim);
  const counts = complexityCounts(a.ctx, schedule, log);
  const C = complexityPenalty(counts);
  const phases = phaseExplanations(a.ctx, plan, schedule, sim);
  const conf = confidenceOf(a, plan);
  const g1 = scorecard[0];
  const weeks = Math.round(T / 7);
  const explanation: string[] = [];
  if (g1) {
    const unit = g1.unit;
    const v = `${Math.round(g1.value * 10) / 10} ${unit}`;
    if (g1.keepTolerance !== undefined)
      explanation.push(hedge(g1.grade, g1.met ? `This plan keeps ${g1.label.toLowerCase()} at ${v} (${signed(g1.change, unit)}; kept).` : `This plan does not keep ${g1.label.toLowerCase()}: ${v} (${signed(g1.change, unit)}).`));
    else explanation.push(hedge(g1.grade, `This plan reaches ${g1.label.toLowerCase()} of ${v} (${Math.round(g1.percentOfAchievable)} % of what is achievable in ${weeks} weeks${g1.target !== null ? `; ${g1.met ? 'target met' : `target ${Math.round(g1.target * 10) / 10} ${unit} not met`}` : ''}).`));
  }
  const binding = bindingNotes(log, T, o.output.margins, MARGIN_IDS);
  if (binding.length) explanation.push(`It is limited by ${ruleText(binding[0]!.rule)}.`);
  // deltaGoal1 = d(plan) − d(plan with the lever neutralised), × 100: positive = the lever helps goal 1; the metric-unit
  // change is plan − variant in goal 1's units (QA item 9: the sentence's sign)
  const sc0 = res.goals.scales[0];
  const perD = sc0 && Number.isFinite(sc0.u - sc0.b) ? (a.goals.specs[0]!.sense === 'min' ? -1 : 1) * (sc0.u - sc0.b) : NaN;
  const contributions = o.ablations.map((ab) => {
    const dd = ab.deltaD[0] ?? 0;
    return { label: ab.label, deltaGoal1: Math.round(1000 * dd) / 10, ...(Number.isFinite(perD) ? { deltaGoal1Metric: +(dd * perD).toFixed(3) } : {}), safe: ab.safe !== false };
  });
  // only a variant that is itself safe says what a lever is worth (a refeed that keeps energy availability up is not
  // "costing" the fat the plan could lose without it, because that plan would break a safety margin)
  const top = contributions.reduce<(typeof contributions)[number] | null>((m, c) => (c.safe && Math.abs(c.deltaGoal1) >= 1 && (!m || Math.abs(c.deltaGoal1) > Math.abs(m.deltaGoal1)) ? c : m), null);
  if (top && g1 && top.deltaGoal1Metric !== undefined) explanation.push(whatMovesGoal1(g1.label, g1.unit, top.label, top.deltaGoal1Metric));
  for (let i = 1; i < scorecard.length; i++) {
    const s = scorecard[i]!;
    const wrongWay = s.percentOfAchievable < 0;
    // masses and lengths to one decimal, as the cards show them (one rounding rule for the same value)
    const chDp = s.unit === 'kg' || s.unit === 'cm' ? 10 : 100;
    const ch = `${s.change >= 0 ? '+' : '−'}${Math.abs(Math.round(s.change * chDp) / chDp)} ${s.unit}`;
    const flat = Math.abs(s.change) < 0.05 * Math.max(1, Math.abs(s.start) / 20);
    if (s.keepTolerance !== undefined) {
      explanation.push(s.met ? `Goal ${i + 1} (${s.label}): kept (${signed(s.change, s.unit)}).` : `Goal ${i + 1} (${s.label}): not kept (${signed(s.change, s.unit)}), because your higher-ranked goals need it (see the conflict notes).`);
      continue;
    }
    explanation.push(
      flat && wrongWay
        ? `Goal ${i + 1} (${s.label}): about unchanged (${ch}); your higher-ranked goals leave no room to raise it.`
        : wrongWay
        ? `Goal ${i + 1} (${s.label}): ${ch} — it moves the other way, because your higher-ranked goals need it (see the conflict notes).`
        : `Goal ${i + 1} (${s.label}): ${ch}, ${Math.round(s.percentOfAchievable)} % of what is achievable alongside your higher priorities.`,
    );
  }
  explanation.push(...goalNotes(a.ctx, plan, schedule));
  // fasting (ruling R-FAST-GATE): a plan with a fast says what it buys (its "without the N-hour fasts" ablation, in the
  // units of the goal it moves most); a plan without one, when fasting was offered, is compared with the best plan with
  // a fast the search evaluated
  const fastAbl = o.ablations.find((ab) => ab.safe !== false && /^without the .*fasts?$/.test(ab.label));
  let without: { label: string; goal: number; delta: number } | null = null;
  if (fastAbl) {
    // the goal fasting serves when the fast moves it noticeably, else the goal it moves most
    const served = a.ctx.fastingServedGoal;
    let gi = served !== null && Math.abs(fastAbl.deltaD[served] ?? 0) >= FAST_COMPARE.ablationD ? served : -1;
    if (gi < 0) for (let i = 0; i < fastAbl.deltaD.length; i++) if (gi < 0 || Math.abs(fastAbl.deltaD[i]!) > Math.abs(fastAbl.deltaD[gi]!)) gi = i;
    const sc = gi >= 0 ? res.goals.scales[gi] : undefined;
    const dd = gi >= 0 ? fastAbl.deltaD[gi]! : 0;
    if (sc && Number.isFinite(sc.u - sc.b) && Math.abs(dd) >= FAST_COMPARE.ablationD)
      without = { label: fastAbl.label, goal: gi, delta: dd * (a.goals.specs[gi]!.sense === 'min' ? -1 : 1) * (sc.u - sc.b) };
  }
  const kind = fastingKind(schedule);
  const evs = schedule.events ?? [];
  const zeroDays = schedule.days.filter((d) => schedule.programs[d.program]?.energy.kind === 'zero').length;
  const what = describeFasts(evs, zeroDays, a.ctx.horizonDays);
  let rivalCmp: Parameters<typeof fastingVerdict>[4] = null;
  const side: OptionSide = { scorecard, desirability: o.desirability, goalScore: goalScoreOf(res, o.desirability), fatChange: seriesChange(sim, 'fatMass'), leanChange: seriesChange(sim, 'leanTissue'), hungerPeak: hunger.peak7Idx, usesFast: usesFast(kind) };
  if (!usesFast(kind) && a.ctx.fastingRelevant) {
    rivalCmp = fastCmp?.rival
      ? rivalVerdict(a.ctx, fastCmp.rival, side, fastCmp.steps)
      : { kind: 'none', longestFastH: 0, structureId: '', reason: 'notEvaluated', goalDeltas: [], hungerPeakDelta: null, leanTissueDeltaKg: null, deltaD: 0, detail: 'no plan with a fast was evaluated', text: '' };
  }
  const fasting = rivalCmp && rivalCmp.reason === 'notEvaluated'
    ? (() => {
        const v = fastingVerdict(a.ctx, kind, longestFastH(schedule), what, null, without);
        const { text: _t, ...r } = rivalCmp;
        return { ...v, rival: r };
      })()
    : fastingVerdict(a.ctx, kind, longestFastH(schedule), what, rivalCmp, without);
  explanation.push(fasting.text);
  explanation.push('Timing and order of the phases carry no fat-loss bonus in the model; only energy, protein and training change body composition.');
  const bandSeries = [...new Set<SeriesId>([...a.goals.bindings.map((b) => b.metric as SeriesId), ...BAND_SERIES])].filter((id) => sim.daily[id]);
  const bands = M > 0 ? dailyBands(a.ctx, sim, bandSeries, await bandsFor(variant, o.structureIndex, o.x, M, bandSeries, k, drawBase)) : null;
  const safetyItems = safetyItemsFor(a.ctx, schedule, plan, sim);
  const unmet = new Set(scorecard.filter((s) => s.percentOfAchievable < 95).map((s) => s.label));
  const notes = relations.filter((m) => [...unmet].some((l) => m.includes(l)));
  const option: PlanOption = {
    id: (['A', 'B', 'C'] as const)[k]!,
    name: '',
    schedule,
    simulation: sim,
    scorecard,
    utility: o.utility,
    hunger,
    complexity: { score: Math.round(Math.min(100, (100 * C) / 0.5)), dayTypes: schedule.programs.length, phases: phases.length, events: (schedule.events ?? []).length },
    phases,
    explanation,
    notes,
    safetyNotes: safetyItems.map((x) => x.text),
    safetyItems,
    fasting,
    bands,
    bindingConstraints: binding,
    confidence: conf,
    aBeatsThisShare: o.aBeatsThisShare,
    contributions,
  };
  return { option, plan, side, equipment: eq };
}

/** Signed change as the scorecard prints it (one decimal; "±0.0" when it rounds to zero). */
export function signed(x: number, unit: string): string {
  const r = Math.round(x * 10) / 10;
  return `${r === 0 ? '±' : r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} ${unit}`;
}

/** Share of the ensemble half-width (P90 − P10)/2 of a goal used as its minimum floor tolerance. */
export const MIN_TOLERANCE_SHARE = 0.5;

/**
 * Per goal: lower median over probe plans of the ensemble half-width (P90 − P10)/2 of the raw goal functional (metric
 * units) — how finely the model can tell plans apart on that goal. `draws[p][m][k]`.
 */
export function goalSpreads(draws: ReadonlyArray<ReadonlyArray<ArrayLike<number>>>, K: number): number[] {
  return Array.from({ length: K }, (_, k) => {
    const w: number[] = [];
    for (const probe of draws) {
      const v = probe.map((g) => g[k]!).filter(Number.isFinite).sort((a, b) => a - b);
      if (v.length < 5) continue;
      const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]!;
      w.push((q(0.9) - q(0.1)) / 2);
    }
    if (!w.length) return NaN;
    w.sort((a, b) => a - b);
    return w[Math.floor((w.length - 1) / 2)]!;
  });
}

/** Result of the time-to-target search for one goal (18 §4.14.3). */
export interface TttResult {
  /** Weeks / days to reach the target at the fastest safe plan found (null when not reached within `searchedDays`). */
  weeks: number | null;
  days: number | null;
  /** Longest horizon searched, days (the extended horizon, then 365 d when the target was not reached earlier). */
  searchedDays: number;
  /** Not reached within `searchedDays`: extrapolation at the rate the best plan sustains over its last 8 weeks. */
  estimatedWeeks: number | null;
  /** That rate, metric units per week toward the target (null when the plan is not moving toward it). */
  ratePerWeek: number | null;
  /** Value of the goal metric at the end of the best plan (metric units). */
  bestValue: number | null;
}

/**
 * Warm-start genomes at the energy bound in the goal's direction (time-to-target): deficit corners (energy genes at their
 * lower bound, protein high) for goals that fall with a deficit, surplus corners (energy at the upper bound, the most
 * resistance-training sessions and sets, no cardio) for muscle and gain goals; other genes keep the block defaults.
 */
export function directionCorners(structures: readonly SkeletonStructure[], classes: readonly string[], direction: 1 | -1, count: number): Array<{ structure: number; x: Float64Array }> {
  const gain = classes.includes('muscle') || classes.includes('weightGain') || (classes.includes('other') && direction > 0);
  const loss = !gain && (classes.includes('fatLoss') || direction < 0);
  if (!gain && !loss) return [];
  const out: Array<{ structure: number; x: Float64Array }> = [];
  for (let j = 1; j < structures.length && out.length < count; j++) {
    const st = structures[j]!;
    if (!st.genes.some((g) => /\.energy$/.test(g.path))) continue;
    const x = Float64Array.from(st.x0);
    st.genes.forEach((g, k) => {
      if (/\.energy$/.test(g.path)) x[k] = gain ? 1 : 0;
      else if (/\.protein$/.test(g.path)) x[k] = gain ? 0.5 : 1;
      else if (gain && (g.path === 'rt.sessions' || g.path === 'rt.sets')) x[k] = 1;
      else if (gain && g.path === 'cardio.sessions') x[k] = 0;
    });
    out.push({ structure: j, x });
  }
  return out;
}

/** EU of the first time-to-target run per tier (the 12-month confirmation gets 60 % of it). */
export const TTT_BUDGET_EU: Readonly<Record<Tier, number>> = { S: 600, M: 900, L: 1500, X: 1500 };

/** Longest time-to-target horizon (18 §4.14.3: T_ext ≤ 365 d). */
export const TTT_MAX_DAYS = 365;

/**
 * Time-to-target on an extended horizon for one unattainable target goal (18 §4.14.3). The single-goal search runs at
 * T_ext = min(max(2T, T + 56), 365) days; when the target is not crossed there it is repeated at 365 days, so "not
 * reached within 12 months" is only ever said after a 12-month search. Each run is warm-started from the best plans the
 * previous run found (the main run's anchor for this goal and option A, transferred by gene path): feasible sets are
 * nested in T (18 §4.14.3), so the longer search starts from a plan that is already good.
 */
export async function timeToTargetRun(
  init: HostInit,
  base: PlanningContext,
  goals: BuiltGoals,
  i: number,
  opts: PlannerOptions,
  evaluatorFor: (v: EvalVariant, init: HostInit) => Evaluator,
  seedsFrom: { structures: readonly SkeletonStructure[]; plans: ReadonlyArray<{ structure: number; x: Float64Array }> },
): Promise<TttResult> {
  const T = base.horizonDays;
  const T1 = Math.min(Math.max(2 * T, T + 56), TTT_MAX_DAYS);
  const horizons = T1 < TTT_MAX_DAYS ? [T1, TTT_MAX_DAYS] : [T1];
  const theta = goals.targets[i]!;
  const direction: 1 | -1 = goals.specs[i]!.sense === 'min' ? -1 : 1;
  const budget = opts.tttBudgetEU ?? TTT_BUDGET_EU[opts.tier ?? init.request.budget?.tier ?? 'S'];
  let prev = seedsFrom;
  let out: TttResult = { weeks: null, days: null, searchedDays: 0, estimatedWeeks: null, ratePerWeek: null, bestValue: null };
  for (let h = 0; h < horizons.length; h++) {
    if (opts.signal?.aborted) break;
    const H = horizons[h]!;
    const v: EvalVariant = { kind: 'ttt', goal: i, horizonDays: H, theta, direction };
    const vp = buildVariant(init, v, base);
    const seeds: Array<{ structure: number; x: Float64Array }> = [];
    for (const p of prev.plans) {
      const src = prev.structures[p.structure];
      const j = src ? vp.structures.findIndex((st) => st.id === src.id) : -1;
      if (src && j > 0) seeds.push({ structure: j, x: transfer(src, vp.structures[j]!, p.x) });
    }
    // direction corners of the most relevant structures: the fastest safe route usually sits at the energy bound
    if (h === 0) for (const sd of directionCorners(vp.structures, base.goals[i]!.classes, direction, 4)) seeds.push(sd);
    const problem: PlannerProblem<SkeletonStructure> = {
      structures: vp.structures,
      goals: [{ id: `ttt:${base.goals[i]!.metric}`, sense: 'max' }],
      baseline: { structure: 0, x: [] },
      seeds,
      roundGenome: (s, x) => roundGenomeOf(vp.ctx, vp.structures[s]!, x),
      gridStep: (s) => gridStepOf(vp.structures[s]!),
      validate: (s, x) => {
        const st = vp.structures[s]!;
        const r = vp.model.repair(st, vp.model.decode(st, x));
        return validatePlan(vp.ctx, r.schedule);
      },
      featureSchema: FEATURE_SCHEMA,
    };
    // the 12-month confirmation starts from a good plan and needs less search
    const cfg: PlannerConfig = { seed: `${init.ensemble.seed}/ttt/${i}/${H}`, tier: 'S', totalEU: h === 0 ? budget : Math.ceil(0.6 * budget), ensembleSize: 0, optionCount: 1 };
    if (opts.signal) cfg.signal = opts.signal;
    const res = await runPlanner(problem, evaluatorFor(v, init), cfg);
    out.searchedDays = H;
    // the fastest safe plan seen: the anchor (best objective of any safe nominal record) when it passes the independent
    // validator, else option A (whose selection also weighs the regulariser, so it can be slower than the anchor)
    const anchor = res.anchors?.[0] ?? null;
    const optA = res.options[0] ? { structure: res.options[0].structureIndex, x: res.options[0].x, f: res.options[0].objectives[0]! } : null;
    const anchorOk = anchor && (!optA || anchor.f > optA.f) && validatePlan(vp.ctx, vp.model.repair(vp.structures[anchor.structure]!, vp.model.decode(vp.structures[anchor.structure]!, anchor.x)).schedule).ok;
    const best = anchorOk ? anchor : optA;
    if (!best) continue;
    const st = vp.structures[best.structure]!;
    const sched = vp.model.repair(st, vp.model.decode(st, best.x)).schedule;
    const sim = vp.model.simulate(sched, -1);
    const y = goalSeries(sim, vp.bindings[0]!, vp.ctx);
    if (!y) continue;
    const Tn = y.length - 1;
    out.bestValue = y[Tn]!;
    const hit = timeToTarget(y, theta, direction).tHit;
    if (hit !== null) return { ...out, weeks: Math.ceil(hit / 7), days: Math.ceil(hit), estimatedWeeks: null, ratePerWeek: null };
    // not reached: rate over the last 8 weeks toward the target, and an extrapolated duration (reported as an estimate)
    const w = Math.min(56, Tn);
    const rate = w > 0 ? (direction * (y[Tn]! - y[Tn - w]!)) / (w / 7) : 0;
    const gap = direction * (theta - y[Tn]!);
    out = { ...out, ratePerWeek: rate > 1e-6 ? rate : null, estimatedWeeks: rate > 1e-6 ? Math.ceil(Tn / 7 + gap / rate) : null };
    prev = { structures: vp.structures, plans: [{ structure: best.structure, x: best.x }, ...seeds.slice(0, 2)] };
  }
  return out;
}

export function feasibilityReport(
  a: Assembly,
  res: OptimResult<SkeletonStructure>,
  ttt: Map<number, TttResult>,
  reach: ReadonlyArray<TargetReach | null>,
  options: readonly PlanOption[],
): GoalFeasibility[] {
  const hw = Math.round(a.ctx.horizonDays / 7);
  return a.ctx.goals.map((g, i) => {
    const f = res.feasibility[i];
    let status = (f?.status ?? 'directional') as GoalFeasibility['status'];
    const target = a.goals.targets[i] ?? null;
    const t = ttt.get(i);
    const r = reach[i] ?? null;
    const unit = g.def.unit;
    const beyond = target !== null && status === 'unattainable' ? beyondSafetyLimits(a.ctx, i, target) : null;
    const fmt = (x: number) => `${Math.round(x * 10) / 10} ${unit}`;
    const keepS = a.goals.specs[i]!.keep;
    const scA = options[0]?.scorecard[i];
    let text: string;
    // a "keep" goal is judged by the options' own verdict (release check 2026-10-01: never "not reachable" for a kept goal)
    if (keepS !== undefined && scA && status !== 'metAtBaseline') {
      const tol = Math.round(keepTolerance(keepS) * 100) / 100;
      if (scA.verdict === 'kept') {
        status = 'attainable';
        text = `${g.def.label}: kept (the Hard plan ${signed(scA.change, unit)}; kept means within ${tol} ${unit} of the start).`;
      } else {
        const other = options.find((o) => o.scorecard[i]?.verdict === 'kept');
        text = `${g.def.label}: not kept by the Hard plan (${signed(scA.change, unit)}) alongside your higher-priority goals${other ? `; the ${RUNG_TITLE_OF_ID[other.id]} plan keeps it` : ''}.`;
      }
      return { goal: i, metric: g.metric, label: g.def.label, status, baseline: f?.baseline ?? a.goals.start[i]!, bestAchievable: f?.best ?? NaN, target, nearestAttainableTarget: f?.nearestAttainableTarget ?? null, requiredWeeks: null, requiredHorizonDays: null, text };
    }
    switch (status) {
      case 'unattainable':
        text = `${g.def.label}: the target ${target !== null ? fmt(target) : ''} is not reachable in ${hw} weeks within the safety limits; the best found is ${f ? fmt(f.best) : '—'}.`;
        if (beyond) text += ` ${beyond}`;
        else if (r?.supported && r.weeks !== null && r.weeks <= hw)
          text += ` The fastest safe route reaches it in about ${r.weeks} weeks on its own, but not together with your other goals and limits.`;
        else if (r?.supported) text += ` ${r.text}`;
        else if (t) text += ` ${tttText(t, unit)}`;
        break;
      case 'attainableAloneNotJointly':
        // goal 1 has no higher-priority goal: its options stop within the model's precision of the target (floors never
        // ask for more precision than the ensemble resolves) while serving the lower-ranked goals
        text =
          i === 0
            ? `${g.def.label}: reachable (the best plan found reaches ${f ? fmt(f.best) : '—'}); the plans stop within the model's precision of the target ${target !== null ? fmt(target) : ''} while serving your other goals.`
            : `${g.def.label}: reachable on its own, but not together with your higher-priority goals.`;
        break;
      case 'metAtBaseline':
        text = `${g.def.label}: already met without changing anything.`;
        break;
      case 'notImprovable':
        text = `${g.def.label}: the model finds no plan that improves it within the limits${stubModules().length ? ' (some physiology is still a placeholder)' : ''}.`;
        break;
      case 'attainable':
        text = `${g.def.label}: the target is reachable.`;
        break;
      default:
        text = `${g.def.label}: improved as far as your priorities allow.`;
    }
    const unatt = status === 'unattainable' && target !== null && !beyond;
    const fromReach = unatt && !!r?.supported;
    const tLong = !!t && t.weeks === null && t.estimatedWeeks !== null && t.estimatedWeeks > ROUTE_MAX_WEEKS;
    return {
      goal: i,
      metric: g.metric,
      label: g.def.label,
      status,
      baseline: f?.baseline ?? a.goals.start[i]!,
      bestAchievable: f?.best ?? NaN,
      target,
      nearestAttainableTarget: f?.nearestAttainableTarget ?? null,
      requiredWeeks: fromReach ? r!.weeks : t?.weeks ?? null,
      requiredHorizonDays: fromReach ? (r!.weeks === null ? null : 7 * r!.weeks) : t?.days ?? null,
      ...(beyond || (fromReach && r!.beyondSafetyLimits) ? { beyondSafetyLimits: true } : {}),
      ...((fromReach && r!.beyondTwoYears) || (!fromReach && tLong) ? { beyondTwoYears: true } : {}),
      ...(fromReach ? { searchedWeeks: ROUTE_MAX_WEEKS, estimatedWeeks: null, fastestRatePerWeek: +r!.ratePerWeek.toFixed(3) } : {}),
      ...(!fromReach && t ? { searchedWeeks: Math.round(t.searchedDays / 7), estimatedWeeks: tLong ? null : t.estimatedWeeks, fastestRatePerWeek: t.ratePerWeek === null ? null : +t.ratePerWeek.toFixed(3) } : {}),
      ...(r?.supported ? { reach: r } : {}),
      text,
    };
  });
}

/**
 * "What moves goal 1 most" (18 §4.17 item 4) from an ablation: `label` names the neutralised variant ("without the
 * extra steps"), `delta` = d(plan) − d(variant) in points of the achievable range.
 */
export function whatMovesGoal1(goalLabel: string, unit: string, label: string, deltaMetric: number): string {
  const v = Math.abs(deltaMetric);
  const r = v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  // deltaMetric = plan − variant: the variant ends lower when the lever raises the goal metric
  return `What moves goal 1 (${goalLabel.toLowerCase()}) most: ${label}, it would end about ${r} ${unit} ${deltaMetric > 0 ? 'lower' : 'higher'}.`;
}

/**
 * Plain-language time-to-target sentence of the extended-horizon search (18 §4.14.3), used for goals without a
 * fastest-safe-rate route (`reach.ts`): measured weeks, an honest extrapolation up to two years, or "more than two years
 * at the safe rate" beyond that (ruling R-TTT: never an absurd horizon).
 */
export function tttText(t: TttResult, unit: string): string {
  if (t.weeks !== null) return `At the fastest safe rate the model finds it takes about ${t.weeks} weeks.`;
  const searched = Math.round(t.searchedDays / 7);
  if (t.estimatedWeeks !== null && t.ratePerWeek !== null) {
    if (t.estimatedWeeks > ROUTE_MAX_WEEKS) return `It is not reached within ${searched} weeks at the safe limits; at the safe rate it would take more than two years.`;
    const r = t.ratePerWeek >= 0.1 ? Math.round(t.ratePerWeek * 10) / 10 : Math.round(t.ratePerWeek * 100) / 100;
    return `It is not reached within ${searched} weeks at the safe limits; at the pace the model sustains by then (about ${r} ${unit} a week) it would take roughly ${t.estimatedWeeks} weeks (an extrapolation, less certain).`;
  }
  return `It was not reached within ${searched} weeks at the safe limits, and no safe plan keeps moving toward it.`;
}

/**
 * @deprecated (PLANNER_V2_SPEC §9.6; removed in 0.3.0) The v1 result shape over the planner v2 (`runLadderPlanner`)
 * without the Ideal: options are the rungs Hard, Medium, Easy in that order with the fixed ids 'A', 'B', 'C' (a collapsed
 * rung is absent, so options may read [A, C]); the v2 result rides along as `v2`. Deterministic in (request, seed,
 * tier) for any worker count.
 */
export async function runDomainPlanner(request: PlannerRequest, opts: PlannerOptions = {}): Promise<PlannerResult> {
  const { onProgress, tier, ...rest } = opts;
  const v2 = await runLadderPlanner(request, {
    ...rest,
    ...(tier ? { tier } : {}),
    ideal: false,
    limitCosts: false,
    ...(onProgress ? { onProgress: (p: PlannerProgressV2) => onProgress(toV1Progress(p)) } : {}),
  });
  return toV1Result(v2);
}

/** Metric-series sanity used by the UI: which goal metric ids exist. */
export function isGoalMetric(id: string): boolean {
  const i = (SERIES_INDEX as Record<string, number>)[id];
  return i !== undefined && SERIES[i]!.kind === 'metric' && SERIES[i]!.goal !== 'none';
}
