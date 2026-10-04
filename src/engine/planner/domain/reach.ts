/**
 * Fastest-safe-rate search (ruling R-TTT, release check 2026-10-01; dossier 18 §4.14.3, dossier 17 §2): how far a goal
 * can move in a given time, and how long a target takes, at the fastest rate every safety limit allows. ONE function
 * serves both call sites — the pre-run "reachable in this horizon" hint on the Goals screen and the planner's
 * time-to-target (`GoalFeasibility.requiredWeeks` and its sentence) — so the two can never contradict each other.
 *
 * The route is a canonical plan simulated on the real engine (planner mode, the person's own profile and limits):
 *  - loss goals (fat mass, body fat %, waist, visceral / liver fat, trend weight going down): continuous deficit blocks
 *    of up to 12 weeks with a 1-week maintenance break (17 HC-E7), resistance training as the planner prescribes it,
 *    high protein, no cardio beyond the user's minimum and steps at the top of the user's range;
 *  - gain goals (skeletal muscle, lean tissue, resistance-training gain, weight gain): the productive resistance-training
 *    maximum with a surplus (or maintenance where 17 HC-E8 forbids a surplus) and high protein.
 * The energy of every 4-week check-in block is steered, over a few engine passes, to the edge of the planner's own
 * safety margins with the planner's nominal headroom (`CHANCE_CUSHION`): kcal floor (HC-E1), deficit cap (HC-E3 and the
 * user's cap), energy availability ≥ 30 kcal/kg FFM on training days in a deficit (R-EA-PLANNER), rate of loss (HC-E5,
 * 0.5-1 %BW/week by body fat) and the fat-store limit (W-13-ALPERT); for gains the lean-gain rate by training status, the
 * 0.5 %BW/week gain cap, 17 HC-E8 and W-S03. State floors (20 % total loss, BMI 19, the body-fat floor, the Simulator's
 * BMI/body-fat cautions) end the route: a target past them is not reachable by one plan. The route runs at most
 * `ROUTE_MAX_WEEKS` (104); beyond that the answer is "more than two years at the safe rate", never an extrapolation.
 *
 * Cost: 3-5 engine runs of ≤ 2 years (≈ 0.1-0.2 s in Node); routes are cached per (profile, limits, safety, goal kind),
 * so changing only the target amount is a lookup.
 */
import type { MetricId } from '../../types/metrics';
import type { Schedule, ScheduleDay } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import { compileRequest, withHorizon, type PlanningContext, type ResolvedGoal } from './context';
import { difficultyD } from './difficulty';
import { goalSeries, type GoalBinding } from './goalSpecs';
import { CHANCE_CUSHION, EA_FLOOR, GAIN_RATE_TARGET_PCT, EnginePlanModel } from './model';
import { HC } from './safety';
import { energyRange, makeStructure, phaseFeasible, toUnit, type SkeletonStructure, type PlanSkeleton, type SegmentSkeleton } from './skeleton';
import { mergeDay } from './dayMath';
import type { PlannerRequest, RouteKind, TargetReach } from './types';

export type { RouteKind, TargetReach } from './types';

/** Longest route, weeks (ruling R-TTT: never report absurd horizons; beyond this "more than two years"). */
export const ROUTE_MAX_WEEKS = 104;
const ROUTE_DAYS = ROUTE_MAX_WEEKS * 7;
/** Engine passes of the block-energy controller (the last one only raises energy where a margin is still short). */
const ROUTE_PASSES = 5;
/** Energy per kg of tissue lost or gained (mixed tissue, 7,700 kcal/kg) — only the controller's step size. */
const KCAL_PER_KG_TISSUE = 7700;

/** The fastest safe route for one goal kind: the goal metric day by day on the canonical plan. */
export interface SafeRoute {
  kind: RouteKind;
  metric: MetricId;
  /** Goal metric y(0..D) on the route (index 0 = start, after burn-in); D = last safe day (≤ 728). */
  y: Float64Array;
  /** Last day the route is within every state floor (the route ends there when a floor would be crossed). */
  safeDays: number;
  /** The route stopped at a state floor (20 % total loss, BMI 19, body-fat floor) before the two years ran out. */
  endedAtFloor: boolean;
  /** Planned energy per check-in block (% of maintenance at the block start), for diagnostics. */
  blockPct: number[];
}

const cache = new Map<string, SafeRoute | null>();
/** Internals of each cached route (same keys as `cache`): what `rungReach` needs to rebuild the route at a lower intensity. */
const rigs = new Map<string, RouteRig>();

/** The canonical route's plan, model and steered energies (kept so the intensity family reuses the same simulator path). */
interface RouteRig {
  ctx: PlanningContext;
  kind: RouteKind;
  model: EnginePlanModel;
  binding: GoalBinding;
  st: SkeletonStructure;
  /** Genome of the fastest-safe route (α = 1) and of the baseline habit (α = 0), unit space. */
  xFast: Float64Array;
  xHab: Float64Array;
  /** Steered energy per check-in block on the fastest-safe route, % of maintenance. */
  pctFast: number[];
  /** Fastest-safe route's schedule and nominal run (for its difficulty over the first 12 weeks). */
  schedule: Schedule;
  sim: SimulationResult;
  /** D of the fastest-safe route over its first 12 weeks (lazy). */
  d1?: number;
  /** The same context over 12 weeks (its own cached baseline for D). */
  ctx12?: PlanningContext;
}
const CACHE_MAX = 24;

/** Route kind of a goal: body-composition losses and gains; other metrics have no canonical route. */
export function routeKind(g: Pick<ResolvedGoal, 'metric' | 'classes'>): RouteKind | null {
  const loss = ['fatMass', 'bodyFatPct', 'waist', 'visceralFat', 'liverFat', 'scaleWeight'];
  const gain = ['skeletalMuscle', 'leanTissue', 'rtMuscleGain', 'scaleWeight', 'fatMass'];
  if (g.classes.includes('fatLoss') && loss.includes(g.metric)) return 'loss';
  if ((g.classes.includes('muscle') || g.classes.includes('weightGain')) && gain.includes(g.metric)) return 'gain';
  return null;
}

function routeKey(ctx: PlanningContext, g: ResolvedGoal, kind: RouteKind): string {
  const r = ctx.request;
  return JSON.stringify([r.profile, ctx.startDate, r.constraints ?? null, r.safety ?? null, g.metric, kind]);
}

const skeletonOf = (segments: SegmentSkeleton[], creatine = false): PlanSkeleton => ({
  baseline: false,
  segments,
  overlay: null,
  event: null,
  creatine,
  omega3: false,
  viscousFibre: false,
  sleepExtension: false,
});

/** Canonical structure and genome of a route (null when the person's limits allow no such plan). */
function canonicalPlan(ctx: PlanningContext, kind: RouteKind): { st: SkeletonStructure; x: Float64Array; lo: number; hi: number } | null {
  const candidates: SegmentSkeleton[][] =
    kind === 'loss'
      ? [[{ kind: 'cycle', on: 'B1', off: 'B8' }], [{ kind: 'phase', block: 'B1' }], [{ kind: 'phase', block: 'B24' }]]
      : [[{ kind: 'phase', block: 'B21' }], [{ kind: 'phase', block: 'B23' }], [{ kind: 'phase', block: 'B0' }]];
  for (const segs of candidates) {
    if (!segs.every((s) => phaseFeasible(ctx, s))) continue;
    const st = makeStructure(ctx, skeletonOf(segs));
    const x = Float64Array.from(st.x0);
    const set = (path: string, v: number) => {
      const k = st.geneIndex[path];
      if (k !== undefined) x[k] = v;
    };
    set('seg0.protein', 1);
    set('cardio.sessions', 0);
    if (kind === 'loss') {
      set('seg0.onWeeks', 1); // 12 weeks on (17 HC-E7 maximum), then the shortest break
      set('seg0.offWeeks', 0);
      set('steps', 1);
    } else {
      set('rt.sessions', 1);
      set('rt.sets', 1);
    }
    const s0 = segs[0]!;
    const block = s0.kind === 'phase' ? s0.block : s0.on;
    const r = energyRange(ctx, block);
    const caps = ctx.caps;
    const floorPct = (100 * caps.energyFloorKcal) / caps.tdee0Kcal;
    const lo = kind === 'loss' ? Math.max(100 - caps.deficitCapPct, floorPct) : 100;
    const hi = kind === 'loss' ? 100 : Math.max(100, block === 'B0' ? 100 : r.hi);
    return { st, x, lo, hi };
  }
  return null;
}

/** Steerable days per check-in block (days of the canonical plan whose energy is a % of maintenance off 100). */
function steerableBlocks(s: Schedule, kind: RouteKind): Array<{ start: number; end: number; days: number[] }> {
  const out: Array<{ start: number; end: number; days: number[] }> = [];
  for (const b of s.blocks ?? []) {
    const days: number[] = [];
    for (let d = b.startDay; d < Math.min(b.endDay, s.horizonDays); d++) {
      const t = mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
      if (t.energy.kind !== 'pctMaintenance') continue;
      if (kind === 'loss' ? t.energy.pct < 99.5 : true) days.push(d);
    }
    if (days.length) out.push({ start: b.startDay, end: b.endDay, days });
  }
  return out;
}

function withBlockEnergy(s: Schedule, blocks: ReadonlyArray<{ days: number[] }>, pct: readonly number[]): Schedule {
  const days: ScheduleDay[] = s.days.slice();
  blocks.forEach((b, k) => {
    for (const d of b.days) {
      const sd = days[d]!;
      const t = mergeDay(s.programs[sd.program]!, sd.override);
      if (t.energy.kind !== 'pctMaintenance') continue;
      days[d] = { ...sd, override: { ...(sd.override ?? {}), energy: { ...t.energy, pct: +pct[k]!.toFixed(3) } } };
    }
  });
  return { ...s, days };
}

/** Per-day margin series by id: the engine's hard-constraint and Simulator-warning margins of a run. */
function marginSeries(sim: SimulationResult): Map<string, Float32Array> {
  const m = new Map<string, Float32Array>();
  for (const c of sim.constraints ?? []) m.set(c.id, c.margin);
  for (const w of sim.warningMargins ?? []) m.set(w.id, w.margin);
  return m;
}

/**
 * Energy-sensitive margins of one run, per day, each with its sensitivity in %-points of maintenance per margin unit
 * (sign: + means more energy raises the margin). Mirrors the planner's `stateMargins` (engine margins, the user's
 * tighter caps, the R-EA-PLANNER floor on the days the Simulator's EA rules apply).
 */
function energyMargins(ctx: PlanningContext, sim: SimulationResult, kind: RouteKind): Array<{ m: Float64Array; sens: number; lag: number }> {
  const n = sim.safety.ei7.length;
  const ms = marginSeries(sim);
  const maint = ctx.rp.tdee0Kcal;
  const w = ctx.rp.weightKg;
  const s = sim.safety;
  const perKcal = 100 / maint; // %-points per kcal/d
  const rateSens = ((0.25 / 100) * w * KCAL_PER_KG_TISSUE * perKcal) / 7; // per 0.25 %BW/wk
  const out: Array<{ m: Float64Array; sens: number; lag: number }> = [];
  const series = (ids: string[], sens: number, lag = 0, extra?: (d: number) => number) => {
    const m = new Float64Array(n).fill(Infinity);
    for (const id of ids) {
      const a = ms.get(id);
      if (!a) continue;
      for (let d = 0; d < n; d++) if (Number.isFinite(a[d]!)) m[d] = Math.min(m[d]!, a[d]!);
    }
    if (extra) for (let d = 0; d < n; d++) m[d] = Math.min(m[d]!, extra(d));
    out.push({ m, sens, lag });
  };
  if (kind === 'loss') {
    const caps = ctx.caps;
    series(['HC-E1', 'W-E01'], 100 * perKcal);
    series(['HC-E3', 'W-E03'], 5, 0, (d) => (s.deficitPct7[d]! > 5 ? (caps.deficitCapPct - s.deficitPct7[d]!) / 5 : Infinity));
    series(['HC-E5', 'W-E05'], rateSens, 7, (d) => (d >= 13 && Number.isFinite(s.rate14PctPerWk[d]!) ? (caps.rateCapPct - s.rate14PctPerWk[d]!) / 0.25 : Infinity));
    series(['W-13-ALPERT'], 100 * perKcal);
    // R-EA-PLANNER: (EA7 − 30)/5 on the days the W-E07 series is defined (training in the trailing week and a deficit)
    const e07 = ms.get('W-E07');
    const shift = (EA_FLOOR.cautionUpper - EA_FLOOR.floor) / EA_FLOOR.scale;
    series([], (EA_FLOOR.scale * ctx.rp.ffm0Kg * perKcal), 0, (d) => (e07 && Number.isFinite(e07[d]!) ? e07[d]! + shift : Infinity));
  } else {
    const gt = GAIN_RATE_TARGET_PCT[ctx.rp.habits.trainingHistory] ?? 0.5;
    // gain rates fall as energy falls: sensitivity negative (less energy raises the margin)
    series(['W-S01'], -rateSens, 7, (d) => (d >= 13 && s.deficitPct7[d]! < -5 && Number.isFinite(s.rate14PctPerWk[d]!) ? (gt + s.rate14PctPerWk[d]!) / 0.25 : Infinity));
    series(['W-S03', 'HC-E8'], -5);
  }
  return out;
}

/** First day on which a state floor (20 % total loss, BMI, body fat, or their Simulator cautions) is crossed; n if none. */
function firstFloorDay(sim: SimulationResult): number {
  const ms = marginSeries(sim);
  const n = sim.safety.ei7.length;
  let first = n;
  for (const id of ['HC-E6', 'HC-P4', 'HC-P5', 'W-E11', 'W-E13', 'W-E15']) {
    const a = ms.get(id);
    if (!a) continue;
    for (let d = 0; d < Math.min(first, a.length); d++) {
      if (a[d]! < 0) {
        first = d;
        break;
      }
    }
  }
  return first;
}

/**
 * The fastest safe route for goal `i` of a compiled request (cached). Null when the goal has no canonical route or the
 * person's limits allow no plan of that kind (e.g. no deficit in the R1 safety mode).
 */
export function fastestSafeRoute(ctx: PlanningContext, i: number): SafeRoute | null {
  const g = ctx.goals[i];
  if (!g || ctx.caps.blocked) return null;
  const kind = routeKind(g);
  if (!kind) return null;
  const key = routeKey(ctx, g, kind);
  if (cache.has(key)) return cache.get(key)!;
  const out = computeRoute(withHorizon(ctx, ROUTE_DAYS), g, kind);
  if (cache.size >= CACHE_MAX) {
    const old = cache.keys().next().value!;
    cache.delete(old);
    rigs.delete(old);
  }
  cache.set(key, out?.route ?? null);
  if (out) rigs.set(key, out.rig);
  return out?.route ?? null;
}

function computeRoute(ctx: PlanningContext, g: ResolvedGoal, kind: RouteKind): { route: SafeRoute; rig: RouteRig } | null {
  const plan = canonicalPlan(ctx, kind);
  if (!plan) return null;
  const binding: GoalBinding = { metric: g.metric, functional: 'end', useTissueMass: g.useTissueMass };
  const model = new EnginePlanModel(ctx, { bindings: [binding], snapshots: true });
  const base = model.repair(plan.st, model.decode(plan.st, plan.x)).schedule;
  const blocks = steerableBlocks(base, kind);
  const pct = blocks.map(() => (kind === 'loss' ? plan.lo : plan.hi));
  const cushion = CHANCE_CUSHION;
  const run = () => model.simulate(withBlockEnergy(base, blocks, pct), -1);
  // one controller step over every block from a run's margins; returns the largest move (%-points)
  const adjust = (sim: SimulationResult, raiseOnly: boolean): number => {
    const floorDay = firstFloorDay(sim);
    const ms = energyMargins(ctx, sim, kind);
    let moved = 0;
    blocks.forEach((b, k) => {
      // required change in %-points: > 0 more energy for a loss route (less deficit), less energy for a gain route
      let need = -Infinity;
      for (const { m, sens, lag } of ms) {
        let lo = Infinity;
        for (let d = b.start + lag; d < Math.min(b.end + lag, floorDay, m.length); d++) if (m[d]! < lo) lo = m[d]!;
        if (!Number.isFinite(lo)) continue;
        need = Math.max(need, (cushion - lo) * Math.abs(sens));
      }
      if (!Number.isFinite(need)) need = kind === 'loss' ? -(pct[k]! - plan.lo) : -(plan.hi - pct[k]!);
      if (raiseOnly && need <= 1e-6) return;
      const step = need > 0 ? need : 0.85 * need;
      const next = kind === 'loss' ? Math.min(plan.hi, Math.max(plan.lo, pct[k]! + step)) : Math.min(plan.hi, Math.max(plan.lo, pct[k]! - step));
      moved = Math.max(moved, Math.abs(next - pct[k]!));
      pct[k] = next;
    });
    return moved;
  };
  let sim = run();
  for (let pass = 0; pass < ROUTE_PASSES; pass++) {
    const moved = adjust(sim, false);
    if (moved === 0) break;
    sim = run();
    if (moved < 0.25) break;
  }
  // the last steps only repair shortfalls (a block that ended a hair past a margin gets more energy, never less)
  for (let k = 0; k < 2; k++) {
    if (adjust(sim, true) === 0) break;
    sim = run();
  }
  const y = goalSeries(sim, binding, ctx);
  if (!y) return null;
  const floorDay = firstFloorDay(sim);
  const safeDays = Math.min(floorDay, y.length - 1);
  const route: SafeRoute = { kind, metric: g.metric, y: y.subarray(0, safeDays + 1), safeDays, endedAtFloor: floorDay < y.length - 1, blockPct: pct.map((p) => +p.toFixed(1)) };
  const rig: RouteRig = { ctx, kind, model, binding, st: plan.st, xFast: plan.x, xHab: habitGenome(ctx, plan.st, plan.x), pctFast: pct.slice(), schedule: withBlockEnergy(base, blocks, pct), sim };
  return { route, rig };
}

/**
 * Warm-start genomes for the main search (R-EA-PLANNER, R-TTT): for the highest-ranked loss goal and gain goal, the
 * canonical plan at the request horizon with its energy at the route's first-block level, so the search starts at the
 * edge of the safety limits and "reachable in this horizon" (the route) and "attainable" (the search) agree. Each is
 * mapped onto the main structure with the same skeleton (gene values copied by path).
 */
export function canonicalSeeds(ctx: PlanningContext, structures: readonly SkeletonStructure[]): Array<{ structure: number; x: Float64Array }> {
  const out: Array<{ structure: number; x: Float64Array }> = [];
  const kinds = new Set<RouteKind>();
  ctx.goals.forEach((g, i) => {
    const kind = routeKind(g);
    if (!kind || kinds.has(kind)) return;
    kinds.add(kind);
    const route = fastestSafeRoute(ctx, i);
    const plan = route ? canonicalPlan(ctx, kind) : null;
    if (!route || !plan) return;
    const j = structures.findIndex((st) => st.id === plan.st.id);
    if (j < 0) return;
    const st = structures[j]!;
    const x = Float64Array.from(st.x0);
    plan.st.genes.forEach((gene, k) => {
      const t = st.geneIndex[gene.path];
      if (t !== undefined) x[t] = plan.x[k]!;
    });
    const e = st.geneIndex['seg0.energy'];
    const s0 = st.skeleton.segments[0]!;
    if (e !== undefined && route.blockPct.length) {
      const r = energyRange(ctx, s0.kind === 'phase' ? s0.block : s0.on);
      x[e] = r.hi - r.lo > 1e-9 ? Math.min(1, Math.max(0, (route.blockPct[0]! - r.lo) / (r.hi - r.lo))) : 0;
    }
    out.push({ structure: j, x });
  });
  return out;
}

/**
 * Targets no plan of any length may reach, because they lie past a safety floor of one plan (17 HC-P5 body-fat floor with
 * lean tissue kept, HC-P4 projected BMI 19, HC-E6 20 % total weight-loss cap): the explanation, or null.
 */
export function beyondSafetyLimits(ctx: PlanningContext, i: number, theta: number): string | null {
  const g = ctx.goals[i]!;
  const caps = ctx.caps;
  const ffm = ctx.rp.ffm0Kg;
  const w0 = ctx.rp.weightKg;
  const h2 = ctx.rp.heightM * ctx.rp.heightM;
  const floorFm = (caps.bfFloorPct / (100 - caps.bfFloorPct)) * ffm;
  const minW = Math.max(HC.bmi.projectedMin * h2, (1 - HC.cumLossMaxPct / 100) * w0);
  switch (g.metric) {
    case 'fatMass':
      if (theta < floorFm) return `That is below the ${caps.bfFloorPct} % body-fat safety floor (about ${Math.round(floorFm * 10) / 10} kg of fat at your lean mass), so no plan reaches it.`;
      if (ctx.rp.fm0Kg - theta > w0 - minW) return `That needs more than the ${HC.cumLossMaxPct} % total weight loss one plan may contain (or a BMI below ${HC.bmi.projectedMin}); reach it in stages with maintenance in between.`;
      return null;
    case 'bodyFatPct':
      return theta < caps.bfFloorPct ? `That is below the ${caps.bfFloorPct} % body-fat safety floor, so no plan reaches it.` : null;
    case 'scaleWeight':
      return theta < minW ? `That is below the lowest weight one plan may reach (BMI ${HC.bmi.projectedMin} or ${HC.cumLossMaxPct} % total loss: about ${Math.round(minW)} kg).` : null;
    default:
      return null;
  }
}

/** Trailing 7-day means m(t) = mean(y[max(1, t − 6)..t]) for t ≥ 1 (m(0) = y(0)): the planner's end functional at every t. */
function endMeans(y: Float64Array): Float64Array {
  const m = new Float64Array(y.length);
  m[0] = y[0]!;
  let s = 0;
  for (let t = 1; t < y.length; t++) {
    s += y[t]!;
    if (t > 7) s -= y[t - 7]!;
    m[t] = s / Math.min(7, t);
  }
  return m;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const rate = (x: number) => (x >= 0.1 ? r1(x) : Math.round(x * 100) / 100);

/** Plain-language sentence of a reach answer (shared by the Goals-screen hint and the planner's feasibility text). */
export function reachText(r: Omit<TargetReach, 'text'>, unit: string, horizonWeeks: number): string {
  if (!r.supported || r.target === null) return '';
  if (r.beyondSafetyLimits) return '';
  const pace = r.ratePerWeek > 0 ? ` (about ${rate(r.ratePerWeek)} ${unit} a week at first)` : '';
  if (r.weeks !== null && r.weeks <= horizonWeeks) return `At the fastest safe rate it is reachable in about ${r.weeks} weeks${pace}.`;
  if (r.weeks !== null) return `At the fastest safe rate it takes about ${r.weeks} weeks${pace}.`;
  if (r.beyondTwoYears) return `At the fastest safe rate it takes more than two years${pace}.`;
  return 'No safe plan reaches it: the safety floors (body fat, BMI 19, 20 % total loss) stop the route first.';
}

/**
 * Reach answer for goal `i` of a request: the target's weeks at the fastest safe rate and what the request horizon
 * reaches (R-TTT: the Goals-screen hint and the planner's time-to-target both call this).
 */
export function targetReach(request: PlannerRequest | PlanningContext, i: number): TargetReach | null {
  const ctx = 'rp' in request ? request : compileRequest(request);
  const g = ctx.goals[i];
  if (!g) return null;
  const horizon = Math.max(1, Math.round(ctx.horizonDays));
  const hw = Math.round(horizon / 7);
  const kind = routeKind(g);
  const route = kind ? fastestSafeRoute(ctx, i) : null;
  const y0 = route && Number.isFinite(route.y[0]!) ? route.y[0]! : g.startEstimate;
  const raw = g.spec.target;
  const target = raw === undefined ? null : g.spec.targetKind === 'change' ? y0 + raw : raw;
  const beyond = target !== null && kind ? beyondSafetyLimits(ctx, i, target) : null;
  const base: Omit<TargetReach, 'text'> = {
    goal: i,
    metric: g.metric,
    supported: !!route,
    kind: route ? kind : null,
    start: y0,
    target,
    valueAtHorizon: y0,
    changeAtHorizon: 0,
    reachableInHorizon: null,
    weeks: null,
    beyondTwoYears: false,
    beyondSafetyLimits: !!beyond,
    ratePerWeek: 0,
  };
  if (!route) return { ...base, text: '' };
  // the planner judges end-value goals on the mean of the last 7 days (`endMean`): the route is read the same way, so
  // "reachable in the horizon" here and "attainable" in the planner mean the same thing
  const y = endMeans(route.y);
  const dir = kind === 'loss' ? -1 : 1;
  const tH = Math.min(horizon, y.length - 1);
  const vH = y[tH]!;
  const tR = Math.min(84, horizon, y.length - 1);
  const ratePerWeek = tR > 0 ? Math.max(0, (dir * (y[tR]! - y[0]!)) / (tR / 7)) : 0;
  const weeks = target !== null && !beyond ? crossingWeeks(y, target, dir) : null;
  const beyondTwoYears = target !== null && !beyond && weeks === null && !route.endedAtFloor;
  const out: Omit<TargetReach, 'text'> = {
    ...base,
    valueAtHorizon: vH,
    changeAtHorizon: vH - y0,
    reachableInHorizon: target === null ? null : weeks !== null && weeks <= hw,
    weeks,
    beyondTwoYears,
    ratePerWeek,
  };
  return { ...out, text: beyond ?? reachText(out, g.def.unit, hw) };
}

/** First week the end-functional series `y` (trailing 7-day means) reaches `target` in direction `dir`; null if never. */
function crossingWeeks(y: Float64Array, target: number, dir: 1 | -1): number | null {
  if (dir * (y[0]! - target) >= 0) return 0;
  for (let t = 1; t < y.length; t++) if (dir * (y[t]! - target) >= -1e-9) return Math.max(1, Math.ceil(t / 7));
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// time to target at a given effort (PLANNER_V2_SPEC §1.4): the canonical route family by intensity α
// ---------------------------------------------------------------------------------------------------------------

/** Bisection steps on α (each one engine run of the route length): the cost bound per rung and goal. */
export const RUNG_REACH_STEPS = 6;
/** Days over which a route's difficulty is measured (its first 12 weeks, the span a rung's own D describes). */
const RUNG_REACH_D_DAYS = 84;
/** A rung whose D is within this of the fastest-safe route's D sits at the safe rate (the D quantum q_D of §1.3). */
export const RUNG_REACH_D_TOL = 0.02;

/** Answer of `rungReach`: weeks at the route intensity a rung's effort allows, with its plain-language sentence. */
export interface RungReach {
  goal: number;
  /** Intensity of the route used: 1 = the fastest-safe route itself (then `text` is the pre-run hint verbatim). */
  alpha: number;
  /** D of that route over its first 12 weeks (NaN when no α > 0 fitted the rung's D). */
  routeD: number;
  weeks: number | null;
  beyondTwoYears: boolean;
  /** The route stopped at a state floor before reaching the target. */
  endedAtFloor: boolean;
  /** Mean rate toward the goal over the first 12 weeks of that route, metric units a week. */
  ratePerWeek: number;
  /** Engine runs this answer cost (≤ `RUNG_REACH_STEPS`; 0 when the fastest-safe route already fits). */
  simulations: number;
  text: string;
}

/**
 * Baseline-habit genome of a canonical route: the route's genome with its intensity levers at the person's habit —
 * protein at the low end of its range, steps and weekly sets at the habitual defaults, resistance and cardio sessions at
 * the habitual counts. Structure genes (cycle lengths, window, meals) stay as on the route, so every member of the
 * family has the same block layout and only intensity moves with α.
 */
function habitGenome(ctx: PlanningContext, st: SkeletonStructure, x: Float64Array): Float64Array {
  const h = Float64Array.from(x);
  const hab = ctx.rp.habits;
  const put = (path: string, f: (k: number) => number) => {
    const k = st.geneIndex[path];
    if (k !== undefined) h[k] = f(k);
  };
  const real = (path: string, v: number) => put(path, (k) => toUnit(st.genes[k]!, v));
  put('seg0.protein', () => 0);
  put('steps', (k) => st.x0[k]!);
  put('rt.sets', (k) => st.x0[k]!);
  real('rt.sessions', Math.round(hab.sessionsPerWeek * (1 - hab.lifingCardioMix)));
  real('cardio.sessions', Math.round(hab.sessionsPerWeek * hab.lifingCardioMix));
  return h;
}

/** First `n` days of a schedule (blocks clipped; the canonical routes carry no events). */
function headSchedule(s: Schedule, n: number): Schedule {
  if (s.horizonDays <= n) return s;
  const blocks = s.blocks?.map((b) => ({ ...b, endDay: Math.min(n, b.endDay) })).filter((b) => b.endDay > b.startDay);
  return { ...s, horizonDays: n, days: s.days.slice(0, n), events: (s.events ?? []).filter((e) => e.startDay < n), ...(blocks ? { blocks } : {}) };
}

/** D of a route over its first 12 weeks: the planned days and the run's hunger and intake series of those days. */
function routeD(rig: RouteRig, schedule: Schedule, sim: SimulationResult): number {
  const n = Math.min(RUNG_REACH_D_DAYS, schedule.horizonDays);
  rig.ctx12 ??= withHorizon(rig.ctx, n);
  const daily = { ...sim.daily };
  for (const id of ['hunger', 'inEnergyPctMaint'] as const) {
    const a = sim.daily[id];
    if (a) daily[id] = a.subarray(0, n);
  }
  return difficultyD(rig.ctx12, headSchedule(schedule, n), { ...sim, daily });
}

/** The route at intensity α: genome and block energies interpolated between the habit (0) and the fastest-safe route (1). */
function routeAt(rig: RouteRig, alpha: number): { schedule: Schedule; sim: SimulationResult } {
  const x = new Float64Array(rig.xFast.length);
  for (let k = 0; k < x.length; k++) x[k] = rig.xHab[k]! + alpha * (rig.xFast[k]! - rig.xHab[k]!);
  const base = rig.model.repair(rig.st, rig.model.decode(rig.st, x)).schedule;
  const blocks = steerableBlocks(base, rig.kind);
  const last = rig.pctFast.length - 1;
  // the habit eats at 100 % of maintenance; each block moves toward its fastest-safe energy by α, so every member of
  // the family stays inside the safety margins the fastest route was steered to
  const pct = blocks.map((_, k) => 100 + alpha * ((last >= 0 ? rig.pctFast[Math.min(k, last)]! : 100) - 100));
  const schedule = withBlockEnergy(base, blocks, pct);
  return { schedule, sim: rig.model.simulate(schedule, -1) };
}

/** Plain-language sentence of a route at a plan's effort (the R-TTT sentence, "at this plan's effort"). */
export function rungReachText(r: Pick<RungReach, 'weeks' | 'beyondTwoYears' | 'ratePerWeek'>, unit: string): string {
  const pace = r.ratePerWeek > 0 ? ` (about ${rate(r.ratePerWeek)} ${unit} a week at first)` : '';
  if (r.weeks !== null) return `At this plan's effort it takes about ${r.weeks} weeks${pace}.`;
  if (r.beyondTwoYears) return `At this plan's effort it takes more than two years${pace}.`;
  return 'No plan at this effort reaches it safely: the safety floors (body fat, BMI 19, 20 % total loss) stop the route first.';
}

/**
 * Time to target for goal `i` at the effort a rung allows (PLANNER_V2_SPEC §1.4): the R-TTT canonical route family
 * parameterised by intensity α ∈ [0, 1] — α = 0 the baseline habit, α = 1 the fastest-safe route — with α found by
 * bisection (≤ `RUNG_REACH_STEPS` engine runs on the same model and route as `targetReach`) so the route's D over its
 * first 12 weeks ≤ `dRung`. When the fastest-safe route already fits (within `RUNG_REACH_D_TOL`) the answer is
 * `targetReach` itself, so a rung at the safe rate gets the pre-run hint verbatim. Same 104-week cap as R-TTT. Null when
 * the goal has no target or no canonical route (callers then fall back to their own estimate).
 */
export function rungReach(ctx: PlanningContext, i: number, dRung: number): RungReach | null {
  const g = ctx.goals[i];
  if (!g || ctx.caps.blocked) return null;
  const fast = targetReach(ctx, i);
  if (!fast?.supported || fast.target === null || !fast.kind) return null;
  const route = fastestSafeRoute(ctx, i);
  const rig = route ? rigs.get(routeKey(ctx, g, fast.kind)) : undefined;
  if (!route || !rig) return null;
  rig.d1 ??= routeD(rig, rig.schedule, rig.sim);
  const d1 = rig.d1;
  if (fast.beyondSafetyLimits || !(dRung < d1 - RUNG_REACH_D_TOL))
    return { goal: i, alpha: 1, routeD: d1, weeks: fast.weeks, beyondTwoYears: fast.beyondTwoYears, endedAtFloor: route.endedAtFloor, ratePerWeek: fast.ratePerWeek, simulations: 0, text: fast.text };
  const target = fast.target;
  const dir: 1 | -1 = fast.kind === 'loss' ? -1 : 1;
  let lo = 0;
  let hi = 1;
  let best: { alpha: number; D: number; sim: SimulationResult } | null = null;
  let sims = 0;
  for (let step = 0; step < RUNG_REACH_STEPS; step++) {
    const a = (lo + hi) / 2;
    const { schedule, sim } = routeAt(rig, a);
    sims++;
    const D = routeD(rig, schedule, sim);
    if (D <= dRung) {
      lo = a;
      best = { alpha: a, D, sim };
    } else hi = a;
  }
  let weeks: number | null = null;
  let endedAtFloor = false;
  let ratePerWeek = 0;
  if (best) {
    const raw = goalSeries(best.sim, rig.binding, rig.ctx);
    if (raw) {
      const floorDay = firstFloorDay(best.sim);
      const safeDays = Math.min(floorDay, raw.length - 1);
      endedAtFloor = floorDay < raw.length - 1;
      const y = endMeans(raw.subarray(0, safeDays + 1));
      const tR = Math.min(RUNG_REACH_D_DAYS, y.length - 1);
      ratePerWeek = tR > 0 ? Math.max(0, (dir * (y[tR]! - y[0]!)) / (tR / 7)) : 0;
      weeks = crossingWeeks(y, target, dir);
    }
  }
  // never faster than the fastest safe rate (members with α < 1 are slower by construction; this guards engine noise)
  if (weeks !== null && fast.weeks !== null) weeks = Math.max(weeks, fast.weeks);
  const beyondTwoYears = weeks === null && !endedAtFloor;
  const out = { goal: i, alpha: best?.alpha ?? 0, routeD: best?.D ?? Number.NaN, weeks, beyondTwoYears, endedAtFloor, ratePerWeek, simulations: sims };
  return { ...out, text: rungReachText(out, g.def.unit) };
}

/** Reach answers for every goal of a request (index-aligned with `request.goals`; unsupported goals have `supported: false`). */
export function estimateTargets(request: PlannerRequest): TargetReach[] {
  const ctx = compileRequest(request);
  if (ctx.caps.blocked) return [];
  return ctx.goals.map((_, i) => targetReach(ctx, i)!).filter(Boolean);
}

/** Forget cached routes (tests; a profile edit makes a new key anyway). */
export function clearReachCache(): void {
  cache.clear();
  rigs.clear();
}
