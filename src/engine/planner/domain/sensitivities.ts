/**
 * Forward model of a living plan from its confirmed state (docs/PLANNER_V2_SPEC.md §7.6, §8.6, §9.3), shared by the
 * re-plan (`replan.ts`):
 *
 *  - `ForwardModel`: the plan's whole engine schedule (day 0 = plan start) run from the day-stamped snapshot the living
 *    plan confirmed at the last check-in, with the energy-balance bias δ as an intake offset (CR-L1, CR-L3). The run
 *    records the replay's series so the snapshot key matches; when a goal needs a series outside that set, or the snapshot
 *    does not restore, the run starts at day 0 with the confirmed tissue mass as a re-anchor at the anchor day instead.
 *  - `realisticSchedule` / `projectRealistic`: the plausible-execution scenario (D5-08, `BEHAVIOR_FORECAST`) next to the
 *    as-prescribed curve: full prescribed dose under an explicit execution assumption, independent of descriptive utility credit.
 *    The named missing-input alternative continues habitual intake/activity with no added sessions or fasts.
 *  - `computePlanSensitivities`: per item type, the share of the weighted goal score the type carries (finite
 *    differences over 28 days, floor 0.02) and the stimulus intent α of each session (∂G per stimulus component).
 *  - `benefitRetained`: c = clamp((J(actual) − J(omit)) / (J(plan) − J(omit)), 0, 1) on a 28-day forward run.
 *
 * Pure and deterministic (no clock, no randomness).
 */
import { INTENT_DEFAULTS, type StimulusIntent, type StimulusVector } from '@/catalogues';
import { REPLAY_SERIES, snapshotTissueKg } from '../../assimilation/replay';
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { MetricId, SeriesId } from '../../types/metrics';
import type { ResolvedProfile } from '../../types/profile';
import type { EngineSnapshot, RunOptions, SafetyTrace, SafetyTraceKey, SimulationResult } from '../../types/result';
import type { CardioSession, DayTemplate, ExerciseSession, MacroAmount, ResistanceSession, Schedule, ScheduleDay, TrainingRegion } from '../../types/schedule';
import { rocWeights } from '../optim/goals';
import { hashString } from '../optim/rng';
import { compileRequest, type PlanningContext } from './context';
import { mergeDay } from './dayMath';
import { goalRequiredSeries, goalValueStatus, goalTrajectory, type GoalBinding } from './goalSpecs';
import type {
  ActivePlanRecord,
  BlockAdherence,
  ConfirmedState,
  ExpectedCredits,
  ForecastGoalOutcome,
  LoggedDay,
  PlanItemType,
  PlanSensitivities,
} from './replanTypes';
import { PLAN_ITEM_TYPES } from './replanTypes';
import type { DailyBand, PlannerRequestV2, RankedGoal } from './types';
import { CONTRACT_VERSIONS, hasCurrentTissueFatEndpoint, type BandMeta, type OutputStatus, type EndpointAvailability } from '@/lib/bodyContracts';
import { ASSIMILATION_DEFAULTS } from '../../assimilation/params';
import { closedRunStatuses, goalDisplayStatus } from './capabilities';
import { objectiveGoalValues, plannerConditions } from './model';
import type { OffsetApplied } from '../../types/result';
import { physicalBehaviorSchedule, type BehaviorScenario } from '@/living/behaviorPaths';

// ------------------------------------------------------------------------------------------------------------ constants

/** z of the 10th / 90th percentile of a normal distribution. */
export const Z90 = 1.2815515655446004;
/** Prior of revealed adherence, Beta(6, 2) (R11 §4.3): the expected credit of an item type nobody observed yet. */
export const ADHERENCE_PRIOR = { a: 6, b: 2 } as const;
/** Forward window of `benefitRetained` and the sensitivities, days (R11 §4.1). */
export const SENSITIVITY_WINDOW_D = 28;
/** Floor of an item weight (§8.6). */
export const ITEM_WEIGHT_FLOOR = 0.02;
/**
 * Fallback item weights when the goals do not resolve any item (grade D; the same values the living plan uses before the
 * planner computes its own).
 */
export const FALLBACK_ITEM_WEIGHTS: Readonly<Record<PlanItemType, number>> = {
  energy: 0.34, protein: 0.16, rtSession: 0.2, cardioSession: 0.1, fast: 0.08, window: 0.03, steps: 0.05, sleep: 0.04, supplement: 0.02,
};
/** Relative step of the finite differences (sets, minutes, session energy). */
const FD_STEP = 0.2;
/** Smallest goal-metric difference a forward run resolves (relative to the value; the series are stored as float32). */
const RESOLUTION_REL = 2e-5;

// ------------------------------------------------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;
const utc = (d: string): number => Date.parse(`${d}T00:00:00Z`);
/** `to − from` in whole days (ISO dates). */
export function dayIndex(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}
/** ISO date `d` days after `start`. */
export function dateAt(start: string, d: number): string {
  return new Date(utc(start) + Math.round(d) * DAY_MS).toISOString().slice(0, 10);
}
/** 0 = Monday … 6 = Sunday. */
export function isoWeekday(date: string): number {
  return (new Date(utc(date)).getUTCDay() + 6) % 7;
}

// ------------------------------------------------------------------------------------------------------------ schedules

/** Template of day d (program merged with the day's override). */
export function dayTemplate(s: Schedule, d: number): DayTemplate {
  const sd = s.days[Math.max(0, Math.min(d, s.days.length - 1))]!;
  return mergeDay(s.programs[sd.program]!, sd.override);
}

/** The schedule cut or extended to `n` days (extra days repeat the last week; events and blocks clipped). */
export function withLength(s: Schedule, n: number): Schedule {
  const H = s.horizonDays;
  if (n === H) return s;
  const days: ScheduleDay[] = [];
  for (let d = 0; d < n; d++) {
    if (d < H) days.push(s.days[d]!);
    else {
      const src = s.days[Math.max(0, H - 7 + ((d - H) % 7))] ?? s.days[H - 1]!;
      days.push({ program: src.program, ...(src.override ? { override: src.override } : {}) });
    }
  }
  const blocks = s.blocks
    ?.map((b, i, all) => ({ ...b, endDay: i === all.length - 1 && b.endDay >= H ? n : Math.min(b.endDay, n) }))
    .filter((b) => b.startDay < n && b.endDay > b.startDay);
  return { ...s, horizonDays: n, days, events: (s.events ?? []).filter((e) => e.startDay < n), ...(blocks ? { blocks } : {}) };
}

/** Days [from, to) as a schedule of their own (start date moved; events and blocks re-indexed). */
export function sliceSchedule(s: Schedule, from: number, to: number): Schedule {
  const n = Math.max(1, to - from);
  const blocks = s.blocks
    ?.map((b) => ({ ...b, startDay: Math.max(0, b.startDay - from), endDay: Math.min(n, b.endDay - from) }))
    .filter((b) => b.endDay > b.startDay);
  return {
    ...s,
    startDate: dateAt(s.startDate, from),
    horizonDays: n,
    days: s.days.slice(from, from + n),
    events: (s.events ?? []).filter((e) => e.startDay >= from && e.startDay < from + n).map((e) => ({ ...e, startDay: e.startDay - from })),
    ...(blocks ? { blocks } : {}),
  };
}

/** Replace plan days by templates (each a program of its own, identical templates shared). */
export function withDayTemplates(s: Schedule, repl: ReadonlyMap<number, DayTemplate>): Schedule {
  if (repl.size === 0) return s;
  const programs = [...s.programs];
  const days = s.days.map((d) => ({ ...d }));
  const byKey = new Map<string, number>();
  for (const [d, t] of [...repl.entries()].sort((a, b) => a[0] - b[0])) {
    if (d < 0 || d >= days.length) continue;
    const key = JSON.stringify(t);
    let i = byKey.get(key);
    if (i === undefined) {
      i = programs.length;
      programs.push(t);
      byKey.set(key, i);
    }
    days[d] = { program: i };
  }
  return { ...s, programs, days };
}

// ------------------------------------------------------------------------------------------------------------ forward model

export type ForwardMode = 'snapshot' | 'replay' | 'fresh';

export interface ForwardRunOptions {
  /** Intake offset δ, kcal/d (default: the confirmed mean). */
  deltaKcal?: number;
  /** Collect the Simulator's warnings (final checks). */
  warnings?: boolean;
  /**
   * Parameter vector of one scenario member (C5/D4-03 safety audit), with a cache key. Only in 'replay' / 'fresh' mode:
   * a confirmed snapshot was captured under the nominal parameters and never restores under another vector.
   */
  params?: Float64Array;
  paramKey?: string;
}

/**
 * The energy-balance correction a forward run applies (D5-03/D5-04): the confirmed mean δ (kcal/day) applied from the
 * anchor day by the versioned legacy mechanism — absorbed intake scaled at the day's macro mix, zero-energy days left alone
 * (`RunOptions.intakeOffsetKcal`, booked per day in `meta.offsetsApplied`); logged foods are never rewritten. The
 * ±`clampKcal` bound is a provisional control default, not a biological limit: a mean at it is `saturated` (model mismatch,
 * shown as "Correction at limit"), and the scenario offsets δ ± z·sd stay inside the bound, so their range is a constrained
 * conditional scenario, never a posterior credible interval.
 */
export interface ForwardCorrection {
  meanKcal: number;
  sdKcal: number;
  clampKcal: number;
  saturated: boolean;
  mechanism: 'absorbedMacroImputation';
  /** Version of the forward application law (changes invalidate derived forecasts, C7). */
  version: number;
}

/** Version of the forward correction application (D5-03: unchanged legacy absorbed-macro law, now with a bounded scenario). */
export const FORWARD_CORRECTION_VERSION = 1;

/**
 * Engine runs of whole plan schedules (day 0 = plan start) from the confirmed state. Results are cached per schedule
 * object and options; `runs` counts the simulations (1 EU each).
 */
export class ForwardModel {
  readonly rp: ResolvedProfile;
  readonly startDate: string;
  readonly anchorIdx: number;
  readonly delta: { mean: number; sd: number };
  /** The correction's semantics and saturation (D5-03/D5-04). */
  readonly correction: ForwardCorrection;
  mode: ForwardMode;
  series: readonly SeriesId[];
  runs = 0;
  private probed = false;
  private readonly snap: EngineSnapshot | null;
  private readonly anchorTissue: number | null;
  private readonly needSeries: readonly SeriesId[];
  private readonly cache = new WeakMap<Schedule, Map<string, SimulationResult>>();

  constructor(plan: Pick<ActivePlanRecord, 'request' | 'startDate'>, state: ConfirmedState | null, needSeries: readonly SeriesId[] = [], forceMode?: ForwardMode) {
    this.startDate = plan.startDate;
    this.rp = resolveProfile({ ...plan.request.profile, startDate: plan.startDate });
    this.snap = state?.snapshot ?? null;
    const stamped = this.snap?.day;
    this.anchorIdx = state ? Math.max(0, stamped ?? dayIndex(plan.startDate, state.anchorDate)) : 0;
    this.delta = state ? { mean: state.energyBiasKcal.mean, sd: Math.max(0, state.energyBiasKcal.sd) } : { mean: 0, sd: 0 };
    const clamp = ASSIMILATION_DEFAULTS.biasClampKcal;
    this.correction = {
      meanKcal: this.delta.mean,
      sdKcal: this.delta.sd,
      clampKcal: clamp,
      saturated: Math.abs(this.delta.mean) >= clamp - 1e-9,
      mechanism: 'absorbedMacroImputation',
      version: FORWARD_CORRECTION_VERSION,
    };
    this.needSeries = needSeries;
    let tissue: number | null = null;
    if (this.snap) {
      try {
        tissue = snapshotTissueKg(this.snap);
      } catch {
        tissue = null;
      }
    }
    this.anchorTissue = tissue;
    const outside = needSeries.some((s) => !REPLAY_SERIES.includes(s));
    this.mode = forceMode ?? (!state ? 'fresh' : outside || stamped === undefined ? 'replay' : 'snapshot');
    this.series = this.seriesFor(this.mode);
    if (forceMode) this.probed = true;
  }

  private seriesFor(mode: ForwardMode): readonly SeriesId[] {
    return mode === 'snapshot' ? REPLAY_SERIES : [...new Set<SeriesId>([...REPLAY_SERIES, ...this.needSeries, 'hunger', 'bhb'])];
  }

  /** First run decides the mode for good: a snapshot that does not restore falls back to the day-0 replay. */
  private first(s: Schedule, o: ForwardRunOptions): SimulationResult {
    this.probed = true;
    if (this.mode !== 'snapshot') return this.raw(s, o);
    try {
      return this.raw(s, o);
    } catch {
      this.mode = 'replay';
      this.series = this.seriesFor('replay');
      return this.raw(s, o);
    }
  }

  private raw(s: Schedule, o: ForwardRunOptions): SimulationResult {
    const compiled = compileSchedule(s, this.rp);
    const delta = o.deltaKcal ?? this.delta.mean;
    if (o.params && this.mode === 'snapshot') throw new Error('ForwardModel: parameter scenarios need replay mode (the snapshot holds nominal parameters)');
    const opts: RunOptions = {
      record: 'daily',
      series: this.series,
      constraints: true,
      collectWarnings: !!o.warnings,
      collectEvents: false,
      ...(delta !== 0 && this.mode !== 'fresh' ? { intakeOffsetKcal: [{ fromDay: this.anchorIdx, kcal: delta }] } : {}),
      ...(o.params ? { paramOverrides: o.params } : {}),
    };
    if (this.mode === 'snapshot') opts.initialSnapshot = this.snap!;
    else if (this.mode === 'replay' && this.anchorTissue !== null && this.anchorIdx > 0 && this.anchorIdx < s.horizonDays)
      opts.anchors = [{ day: this.anchorIdx, tissueMassKg: this.anchorTissue }];
    const sim = runEngine(this.rp, compiled, opts);
    this.runs++;
    return sim;
  }

  /**
   * The δ ± z·sd scenario offsets of the correction, kept inside the control bound (D5-04: constrained scenario
   * semantics), or null without uncertainty or a confirmed state.
   */
  scenarioOffsets(): readonly [number, number] | null {
    if (!(this.delta.sd > 0) || this.mode === 'fresh') return null;
    const c = this.correction.clampKcal;
    const lim = (x: number) => Math.min(c, Math.max(-c, x));
    return [lim(this.delta.mean - Z90 * this.delta.sd), lim(this.delta.mean + Z90 * this.delta.sd)];
  }

  /** The correction each forecast day actually received (D5-03: zero-energy days skipped), from the run's ledger. */
  appliedOffsets(sim: SimulationResult): readonly OffsetApplied[] {
    return sim.meta.offsetsApplied ?? [];
  }

  run(s: Schedule, o: ForwardRunOptions = {}): SimulationResult {
    const key = `${o.deltaKcal ?? this.delta.mean}|${o.warnings ? 1 : 0}|${o.paramKey ?? ''}`;
    let m = this.cache.get(s);
    const hit = m?.get(key);
    if (hit) return hit;
    const sim = this.probed ? this.raw(s, o) : this.first(s, o);
    if (!m) this.cache.set(s, (m = new Map()));
    m.set(key, sim);
    return sim;
  }
}

const SAFETY_KEYS = (s: SafetyTrace): SafetyTraceKey[] => Object.keys(s) as SafetyTraceKey[];

/**
 * The run as seen from `fromDay` on: every per-day array (safety trace, daily series, engine margins) is NaN before it,
 * so margins and minima judge only the days a re-plan can still change (rolling windows keep the logged past). The
 * hunger index starts at `fromDay` (the planner's hunger penalty reads it from its first day).
 */
export function futureView(sim: SimulationResult, fromDay: number): SimulationResult {
  const cut = Math.max(0, fromDay);
  const mask = (a: Float32Array): Float32Array => {
    if (cut === 0) return a;
    const b = a.slice();
    b.fill(Number.NaN, 0, Math.min(cut, b.length));
    return b;
  };
  const safety = { ...sim.safety } as SafetyTrace;
  for (const k of SAFETY_KEYS(sim.safety)) {
    const a = sim.safety[k];
    if (a) (safety as unknown as Record<string, Float32Array>)[k] = mask(a);
  }
  const daily: SimulationResult['daily'] = {};
  for (const [k, a] of Object.entries(sim.daily) as Array<[SeriesId, Float32Array | undefined]>) if (a) daily[k] = mask(a);
  const hunger = sim.daily.hunger ?? sim.safety.hungerIdx;
  if (hunger) daily.hunger = hunger.subarray(Math.min(cut, hunger.length));
  return {
    ...sim,
    safety,
    daily,
    ...(sim.constraints ? { constraints: sim.constraints.map((c) => ({ ...c, margin: mask(c.margin) })) } : {}),
    ...(sim.warningMargins ? { warningMargins: sim.warningMargins.map((w) => ({ ...w, margin: mask(w.margin) })) } : {}),
  };
}

// ------------------------------------------------------------------------------------------------------------ goals

/** Goals with every 'change' target made absolute from `start(k)` (targets stay measured from where they were set). */
export function absoluteGoals(goals: readonly RankedGoal[], start: (k: number) => number): RankedGoal[] {
  return goals.map((g, k) => {
    // Freezing is not consent to reinterpret an old wake/unknown body-fat intent as tissue fat.
    if (g.metric === 'bodyFatPct' && !hasCurrentTissueFatEndpoint(g.endpointSemantics)) return { ...g };
    if (g.targetKind !== 'change' || g.target === undefined) return { ...g };
    const s = start(k);
    if (!Number.isFinite(s)) return { ...g };
    return { ...g, target: s + g.target, targetKind: 'absolute', targetOrigin: g.targetOrigin ?? { kind: 'change', delta: g.target, baseline: s } };
  });
}

/** Context of a plan's request at the plan start (labels, bindings, start estimates). */
export function planContext(plan: Pick<ActivePlanRecord, 'request' | 'startDate'>, request: PlannerRequestV2 = plan.request): PlanningContext {
  return compileRequest({ ...request, startDate: plan.startDate, profile: { ...request.profile, startDate: plan.startDate } });
}

export function bindingsOf(ctx: PlanningContext): GoalBinding[] {
  return ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
}

/** Series a forward run must record for these goals (their required outputs, D4-05: body fat reads fat mass and lean tissue). */
export function goalSeriesIds(ctx: PlanningContext): SeriesId[] {
  return [...new Set<SeriesId>([
    ...ctx.goals.flatMap((g) => [g.metric as SeriesId, ...goalRequiredSeries(g.metric)]),
    'tdee', 'inEnergy',
    ...(ctx.request.constraints?.muscleRetention ? ['skeletalMuscle' as const] : []),
  ])];
}

/** Absolute target of goal k (frozen, or the change applied to the plan-start estimate), or null. */
export function absoluteTarget(ctx: PlanningContext, k: number): number | null {
  const g = ctx.goals[k];
  if (!g || g.spec.target === undefined) return null;
  const target = g.spec.targetKind === 'change' ? g.startEstimate + g.spec.target : g.spec.target;
  return Number.isFinite(target) ? target : null;
}

/** +1 when larger values are better for goal k (target above the current value, or maximise), else −1. */
export function goalSign(ctx: PlanningContext, k: number, current: number): 1 | -1 {
  const g = ctx.goals[k]!;
  if (g.direction === 'maximise') return 1;
  if (g.direction === 'minimise') return -1;
  const t = absoluteTarget(ctx, k);
  if (t === null || !Number.isFinite(current)) return g.def.direction === 'down' ? -1 : 1;
  if (Math.abs(t - current) < 1e-9) return g.def.direction === 'down' ? -1 : 1;
  return t < current ? -1 : 1;
}

// ------------------------------------------------------------------------------------------------------------ adherence

// ------------------------------------------------------------------------------------------------------------ behaviour scenarios (D5-08)

/**
 * Versioned physical scenario semantics, separate from descriptive Beta utility summaries and parameter uncertainty.
 * Plausible execution assumes the full prescription; missingData is a named habitual continuation sensitivity.
 */
export const BEHAVIOR_FORECAST = { version: 3, algorithm: 'plausibleExecution', paths: 1, calibration: 'heuristic' } as const;
/** Days with a resolved fast outcome needed before the observed completion share replaces the scenario assumption. */
export const FAST_OUTCOME_MIN_DAYS = 3;
/**
 * Explicit scenario assumption without enough observed fast outcomes: the planned fasting routine happens as chosen
 * (unknown is not skipped; low logging coverage never implies non-adherence).
 */
export const ASSUMED_FAST_COMPLETION = 1;

/** Observed fast outcomes, one per day (same-day opportunities clustered: a day is one observation, not several). */
export interface FastOutcomeCounts {
  done: number;
  partial: number;
  skipped: number;
}

/**
 * Fast outcomes from logged days (D5-08): per day, every fast item done → done; any done with others not → partial; none
 * done but some skipped/partial → skipped/partial. Unknown items are not observations (no outcome is invented).
 */
export function fastOutcomeCounts(logs: readonly Pick<LoggedDay, 'items'>[]): FastOutcomeCounts {
  const out: FastOutcomeCounts = { done: 0, partial: 0, skipped: 0 };
  for (const l of logs) {
    const f = l.items.filter((it) => it.type === 'fast' && it.status !== 'unknown');
    if (!f.length) continue;
    if (f.every((it) => it.status === 'done')) out.done++;
    else if (f.some((it) => it.status === 'done' || it.status === 'partial')) out.partial++;
    else out.skipped++;
  }
  return out;
}

/** The fast-completion probability of the plausible-execution scenario and where it comes from. */
export interface FastCompletionScenario {
  p: number;
  source: 'observed' | 'assumed';
  /** Observed days behind `p` (0 when assumed). */
  days: number;
}

/**
 * Completion probability of a planned fast in the plausible-execution scenario (D5-08): the observed share of fully
 * completed fast days, (done + 1)/(n + 2), once `FAST_OUTCOME_MIN_DAYS` days have a resolved outcome; otherwise the
 * explicit scenario assumption. Never the mean utility credit (a partial tap is not a fractional fast).
 */
export function fastCompletionScenario(counts?: FastOutcomeCounts | null): FastCompletionScenario {
  const n = counts ? counts.done + counts.partial + counts.skipped : 0;
  if (!counts || n < FAST_OUTCOME_MIN_DAYS) return { p: ASSUMED_FAST_COMPLETION, source: 'assumed', days: 0 };
  return { p: (counts.done + 1) / (n + 2), source: 'observed', days: n };
}

/** Deterministic behaviour-path draw u ∈ [0, 1) for one opportunity (seeded once per path; stable across runs). */
export function behaviorPathU(seed: string, path: number, opportunity: number): number {
  return hashString(`${seed}|p${path}|o${opportunity}`) / 4294967296;
}

/** Seed of a plan's behaviour paths: keyed to the plan (start date, schedule length), its version and the scenario version. */
export function behaviorSeed(s: Pick<Schedule, 'startDate' | 'horizonDays'>, planVersion = 0): string {
  return `beh${BEHAVIOR_FORECAST.version}|${s.startDate}|${s.horizonDays}|v${planVersion}`;
}

/** Which planned fasts a path keeps: each kept whole when u < p (a skipped fast is fully skipped, never scaled). */
export function fastPathKeeper(seed: string, p: number, path = 0): (opportunity: number) => boolean {
  if (p >= 1) return () => true;
  if (p <= 0) return () => false;
  return (i) => behaviorPathU(seed, path, i) < p;
}

/** E[c] = a/(a + b) of a type (weekday entry first, then the type entry, then the Beta(6, 2) prior). */
export function expectedCredit(adherence: readonly BlockAdherence[], type: PlanItemType, weekday?: number): number {
  const wd = weekday !== undefined ? adherence.find((b) => b.type === type && b.weekday === weekday) : undefined;
  const t = wd ?? adherence.find((b) => b.type === type && b.weekday === undefined);
  const a = t ? t.a : ADHERENCE_PRIOR.a;
  const b = t ? t.b : ADHERENCE_PRIOR.b;
  return a + b > 0 ? Math.min(1, Math.max(0, a / (a + b))) : 1;
}

const scaleToward = (v: number, habit: number, c: number): number => habit + c * (v - habit);

function scaleProtein(m: MacroAmount, c: number, rp: ResolvedProfile): MacroAmount {
  const habG = rp.habitualProteinG;
  if (m.unit === 'g') return { unit: 'g', value: scaleToward(m.value, habG, c) };
  if (m.unit === 'gPerKgBw') return { unit: 'gPerKgBw', value: scaleToward(m.value, habG / rp.weightKg, c) };
  if (m.unit === 'gPerKgFfm') return { unit: 'gPerKgFfm', value: scaleToward(m.value, habG / rp.ffm0Kg, c) };
  return m;
}

/**
 * A day's template with every dose item at credit `c[type]` (1 = as prescribed, 0 = omitted). A zero day (a planned fast)
 * is kept or skipped WHOLE: `fastKept` decides (default: kept unless the fast credit is 0, the omission scenario) — never
 * a threshold on the mean credit, never a partially scaled fast (D5-08). Returns `t` when nothing moves.
 */
export function scaleDay(t: DayTemplate, c: (type: PlanItemType) => number, rp: ResolvedProfile, fastKept?: boolean): DayTemplate {
  const cE = c('energy');
  const cP = c('protein');
  const cR = c('rtSession');
  const cC = c('cardioSession');
  const cS = c('steps');
  let out: DayTemplate = t;
  const set = (patch: Partial<DayTemplate>) => (out = { ...out, ...patch });
  const e = t.energy;
  if (e.kind === 'zero') {
    if (!(fastKept ?? c('fast') > 0)) set({ energy: { kind: 'pctMaintenance', pct: 100 } });
  } else if (cE < 1) {
    if (e.kind === 'pctMaintenance') set({ energy: { ...e, pct: scaleToward(e.pct, 100, cE) } });
    else set({ energy: { kind: 'kcal', kcal: scaleToward(e.kcal, rp.tdee0Kcal, cE) } });
  }
  if (cP < 1 && t.energy.kind !== 'zero') {
    const p = scaleProtein(t.macros.protein, cP, rp);
    if (p !== t.macros.protein) set({ macros: { ...out.macros, protein: p } });
  }
  if ((cR < 1 || cC < 1) && t.exercise?.length) {
    const ex: ExerciseSession[] = [];
    for (const s of t.exercise) {
      if (s.kind === 'resistance') {
        if (cR <= 0) continue;
        const r: ResistanceSession = { ...s };
        if (s.setsByRegion) r.setsByRegion = Object.fromEntries(Object.entries(s.setsByRegion).map(([k, v]) => [k, (v ?? 0) * cR])) as Partial<Record<TrainingRegion, number>>;
        if (s.durationMin !== undefined) r.durationMin = Math.max(5, s.durationMin * cR);
        ex.push(r);
      } else {
        const m = s.durationMin * cC;
        if (m >= 1) ex.push({ ...s, durationMin: m });
      }
    }
    set({ exercise: ex });
  }
  if (cS < 1 && t.steps !== undefined) set({ steps: Math.round(scaleToward(t.steps, rp.habits.typicalSteps, cS)) });
  return out;
}

/** Options of the plausible-execution scenario (D5-08). */
export interface BehaviorScenarioOptions {
  /** Explicit physical assumption, independent of descriptive utility credit. */
  scenario?: BehaviorScenario;
  /** Observed fast outcomes (from logged days, `fastOutcomeCounts`); absent = the explicit scenario assumption. */
  fastOutcomes?: FastOutcomeCounts | null;
  /** Plan version (part of the path seed). */
  planVersion?: number;
  /** Stable path index (0 for the single realistic curve). */
  path?: number;
}

/**
 * Explicit future physical scenario. Plausible execution and as prescribed retain complete prescribed doses;
 * missingData uses the shared habitual continuation. The realised past remains immutable.
 */
export function realisticSchedule(s: Schedule, fromDay: number, adherence: readonly BlockAdherence[], rp: ResolvedProfile, opts: BehaviorScenarioOptions = {}): Schedule {
  // Utility posteriors describe past usefulness, not performed physical dose.
  void adherence;
  return physicalBehaviorSchedule(s, rp, fromDay, s.horizonDays, opts.scenario ?? 'plausibleExecution');
}

/**
 * Days [from, to) with dose credits from `credit(type, weekday)`. Planned fasts (zero days and fast events, numbered in
 * schedule order as opportunities) are kept or skipped whole by `fastKept(opportunity)` (default: kept unless the fast
 * credit is 0 — the omission scenario); no fast is ever scaled partially and no mean credit switches all of them (D5-08).
 */
export function creditSchedule(
  s: Schedule,
  from: number,
  to: number,
  credit: (type: PlanItemType, weekday: number) => number,
  rp: ResolvedProfile,
  fastKept?: (opportunity: number) => boolean,
): Schedule {
  const w0 = isoWeekday(s.startDate);
  const keepOf = (opp: number, weekday: number): boolean => (fastKept ? fastKept(opp) : credit('fast', weekday) > 0);
  const repl = new Map<number, DayTemplate>();
  const lo = Math.max(0, from);
  const hi = Math.min(to, s.horizonDays);
  for (let d = lo; d < hi; d++) {
    const w = (w0 + d) % 7;
    const t = dayTemplate(s, d);
    // zero-day opportunities are numbered by plan day (stable when the window moves); events after them
    const u = scaleDay(t, (type) => credit(type, w), rp, t.energy.kind === 'zero' ? keepOf(d, w) : undefined);
    if (u !== t) repl.set(d, { ...u, id: `${t.id}~r${d}`, label: t.label });
  }
  let out = withDayTemplates(s, repl);
  const evs = s.events ?? [];
  if (evs.length) {
    const events = evs.filter((e, i) => e.startDay < from || e.startDay >= to || keepOf(s.horizonDays + i, (w0 + e.startDay) % 7));
    if (events.length !== evs.length) out = { ...out, events };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ forecasts

const BAND_SERIES_LIVING: readonly SeriesId[] = ['scaleWeight', 'fatMass', 'leanTissue', 'bodyFatPct', 'waist', 'skeletalMuscle', 'tdee', 'inEnergy'];
/**
 * Engineering split of the trend-weight SD across the mass series (scale weight all of it; 0.75 / 0.25 fat / lean). A
 * display heuristic of the conditional scenario range, not a physiological partition and not an ensemble quantile (D5-02).
 */
const MASS_SHARE: Partial<Record<SeriesId, number>> = { scaleWeight: 1, fatMass: 0.75, leanTissue: 0.25 };

/**
 * What a living forecast band is (C6/D5-02): the nominal path widened by the energy-bias scenarios δ ± z·sd and the
 * trend-weight SD share — a conditional scenario range with unvalidated coverage, not empirical ensemble percentiles of
 * jointly drawn paths and not a calibrated 80 % prediction interval.
 */
export const LIVING_SCENARIO_BAND_META: Readonly<BandMeta> = {
  method: 'fallback',
  uncertaintyKind: 'scenario',
  coverage: 'unvalidated',
  draws: 0,
  nominalInQuantiles: false,
  endpoint: 'raw',
  version: CONTRACT_VERSIONS.uncertainty,
};

export interface ForecastRuns {
  nominal: SimulationResult;
  low: SimulationResult | null;
  high: SimulationResult | null;
  /** The correction behind the runs (D5-03/D5-04): its mean, SD, bound, saturation and application mechanism. */
  correction?: ForwardCorrection;
  /** The schedule the runs simulate (planner conditions of the goal statuses, D1-05/D7-07). */
  schedule?: Schedule;
}

/**
 * Nominal and δ ± z·sd runs of a schedule (the confirmed state's energy-bias uncertainty spans the band). The scenario
 * offsets stay inside the correction's control bound (`ForwardModel.scenarioOffsets`, D5-04).
 */
export function forecastRuns(fwd: ForwardModel, s: Schedule): ForecastRuns {
  const nominal = fwd.run(s);
  const off = fwd.scenarioOffsets();
  if (!off) return { nominal, low: null, high: null, correction: fwd.correction, schedule: s };
  return { nominal, low: fwd.run(s, { deltaKcal: off[0] }), high: fwd.run(s, { deltaKcal: off[1] }), correction: fwd.correction, schedule: s };
}

/** Daily bands of days [from, to) (index 0 = day `from`). */
export function bandsOf(runs: ForecastRuns, from: number, to: number, extra: readonly SeriesId[], weightSd: number): Partial<Record<SeriesId, DailyBand>> {
  const out: Partial<Record<SeriesId, DailyBand>> = {};
  const n = Math.max(0, to - from);
  for (const id of new Set<SeriesId>([...BAND_SERIES_LIVING, ...extra])) {
    const y = runs.nominal.daily[id];
    if (!y) continue;
    const p10 = new Float32Array(n);
    const p50 = new Float32Array(n);
    const p90 = new Float32Array(n);
    const lo = runs.low?.daily[id];
    const hi = runs.high?.daily[id];
    const ws = Z90 * weightSd * (MASS_SHARE[id] ?? 0);
    for (let i = 0; i < n; i++) {
      const d = from + i;
      const v = y[d]!;
      const a = lo ? lo[d]! : v;
      const b = hi ? hi[d]! : v;
      const dn = Math.hypot(Math.max(0, v - Math.min(a, b)), ws);
      const up = Math.hypot(Math.max(0, Math.max(a, b) - v), ws);
      p50[i] = v;
      p10[i] = v - dn;
      p90[i] = v + up;
    }
    out[id] = { p10, p50, p90, meta: LIVING_SCENARIO_BAND_META };
  }
  return out;
}


/** Goal-specific bands: transform each coherent path before reduction, retaining the operator identity. */
export function goalBandsOf(ctx: PlanningContext, runs: ForecastRuns, from: number, to: number): Record<string, DailyBand> {
  const members = [runs.nominal, ...(runs.low ? [runs.low] : []), ...(runs.high ? [runs.high] : [])];
  const out: Record<string, DailyBand> = {};
  bindingsOf(ctx).forEach((binding) => {
    const paths = members.map((run) => goalTrajectory(run, binding, ctx));
    if (members.some((run) => !goalValueStatus(run, binding, ctx).available)) return;
    const samples = paths.map((path) => Array.from({ length: Math.max(0, to - from) }, (_, k) => path.sample(from + k + 1)));
    if (samples.some((path) => path.some((v) => v === null))) return;
    const p50 = Float32Array.from(samples[0] as number[]);
    const p10 = Float32Array.from(p50, (_, k) => Math.min(...samples.map((path) => path[k]!)));
    const p90 = Float32Array.from(p50, (_, k) => Math.max(...samples.map((path) => path[k]!)));
    out[paths[0]!.bandKey] = { p10, p50, p90, meta: LIVING_SCENARIO_BAND_META };
  });
  return out;
}

/** First day in [from, to) whose value reaches `target` coming from the `sign` side, or null. */
export function crossingDay(y: ArrayLike<number> | undefined, from: number, to: number, target: number, sign: 1 | -1): number | null {
  if (!y) return null;
  for (let d = Math.max(0, from); d < Math.min(to, y.length); d++) {
    const v = y[d]!;
    if (Number.isFinite(v) && (sign > 0 ? v >= target : v <= target)) return d;
  }
  return null;
}

/** C6: a forecast goal row's status (numbers and statuses travel separately; a withheld status shows no range). */
export interface ForecastGoalStatus {
  availability: EndpointAvailability;
  operator: string;
  bandKey: string;
  dateRange: [string, string] | null;
  status: OutputStatus;
  reasonCode: string;
}

/**
 * Goal rows of a forecast: end value, its conditional scenario range (`p10`/`p90` are the scenario bounds of
 * `LIVING_SCENARIO_BAND_META`, not percentiles), goal date of the nominal path. `pTargetMet` is null (D5-02): a normal
 * fitted to scenario extrema is not a probability, so no target-met likelihood is claimed until coherent joint paths exist.
 * Each row carries its status (C6): an unsupported lean partition (D1-05), an uncertain ketogenic lipid response (D7-07)
 * or a model-limit / out-of-domain run (D1-08) withholds the range and the goal date.
 */
export function goalOutcomes(ctx: PlanningContext, runs: ForecastRuns, from: number, startDate: string, weightSd: number): Array<ForecastGoalOutcome & ForecastGoalStatus> {
  const b = bindingsOf(ctx);
  const nominal = runs.nominal;
  const closed = closedRunStatuses(nominal, runs.schedule ? plannerConditions(ctx, runs.schedule, nominal) : []);
  return ctx.goals.map((g, k) => {
    const members = [nominal, ...(runs.low ? [runs.low] : []), ...(runs.high ? [runs.high] : [])];
    const values = members.map((run) => goalValueStatus(run, b[k]!, ctx));
    const trajectory = goalTrajectory(nominal, b[k]!, ctx);
    const gv = values[0]!;
    const end = gv.value;
    const complete = values.every((v) => v.available);
    const availability = {
      version: 1 as const, status: complete ? 'complete' as const : values.some((v) => v.available) ? 'partial' as const : 'unavailable' as const,
      attempted: values.length, available: values.filter((v) => v.available).length,
      excluded: values.filter((v) => !v.available).length,
      reasons: [...new Set(values.filter((v) => !v.available).map((v) => v.reasonCode))],
      memberAvailable: values.map((v) => v.available), policy: 'allRequiredMembers' as const,
    };
    const lo = Math.min(...values.map((v) => v.value));
    const hi = Math.max(...values.map((v) => v.value));
    const ws = Z90 * weightSd * (MASS_SHARE[g.metric as SeriesId] ?? 0);
    const p10 = end - Math.hypot(Math.max(0, end - lo), ws);
    const p90 = end + Math.hypot(Math.max(0, hi - end), ws);
    const current = trajectory.sample(from) ?? Number.NaN;
    const target = absoluteTarget(ctx, k);
    const unresolved = g.spec.target !== undefined && (target === null || (g.spec.targetKind === 'change' && ['sbp', 'glucose', 'fastingGlucose'].includes(g.metric)));
    const sign = goalSign(ctx, k, Number.isFinite(current) ? current : end);
    const st = complete && !unresolved ? goalDisplayStatus(closed, g.metric, sign, nominal.meta.validity) : { status: 'unavailable' as const, reasonCode: unresolved ? 'targetNeedsReview' : gv.available ? 'partialEndpointCoverage' : gv.reasonCode, withheld: true };
    const withheld = st.withheld;
    const crossing = target === null || withheld ? null : trajectory.crossing(target, sign, from);
    const date = crossing === null ? null : dateAt(startDate, crossing);
    const dates = target === null || withheld ? [] : members.map((run) => goalTrajectory(run, b[k]!, ctx).crossing(target, sign, from));
    const coveredDates = dates.filter((d): d is number => d !== null);
    const dateRange: [string, string] | null = dates.length > 0 && coveredDates.length === dates.length ? [dateAt(startDate, Math.min(...coveredDates)), dateAt(startDate, Math.max(...coveredDates))] : null;
    return {
      goal: g.index,
      availability,
      operator: trajectory.operator,
      bandKey: trajectory.bandKey,
      dateRange,
      metric: g.metric as MetricId,
      label: g.def.label,
      unit: g.def.unit,
      endP50: end,
      ...(withheld ? {} : { p10, p90 }),
      target: unresolved ? null : target,
      pTargetMet: null,
      date: withheld ? null : date,
      ...(Number.isFinite(current) ? { current } : {}),
      status: st.status,
      reasonCode: st.reasonCode,
    };
  });
}

// ------------------------------------------------------------------------------------------------------------ realistic projection

export interface RealisticProjection {
  /** Plan day of index 0 of the bands (the anchor, or `today` when given). */
  fromDay: number;
  asPrescribed: Array<ForecastGoalOutcome & ForecastGoalStatus>;
  realistic: Array<ForecastGoalOutcome & ForecastGoalStatus>;
  /** The energy-balance correction behind both curves (D5-03/D5-04): saturation shows as "Correction at limit". */
  correction: ForwardCorrection;
  bands: { asPrescribed: Partial<Record<SeriesId, DailyBand>>; realistic: Partial<Record<SeriesId, DailyBand>> };
  goalBands: { asPrescribed: Record<string, DailyBand>; realistic: Record<string, DailyBand> };
  /** Descriptive utility credit per item type; never a physical dose multiplier. */
  credits: ExpectedCredits;
  /**
   * D5-08: semantics of the realistic curve — the plausible-execution scenario, its version, path seed and count, and
   * where the fast-completion probability came from. Heuristic: never a calibrated probability.
   */
  behavior: { algorithm: 'plausibleExecution'; scenario: BehaviorScenario; assumption: 'prescribedDose' | 'habitualContinuation'; assumptions: readonly string[]; version: number; seed: string; paths: number; calibration: 'heuristic'; fastCompletion: FastCompletionScenario };
  /** The realistic schedule (whole plan, days from `fromDay` scaled). */
  schedule: Schedule;
  euUsed: number;
  ms: number;
}

/**
 * Both curves of §7.6 from the confirmed state: as prescribed and an explicit physical execution scenario, with
 * bands from the energy-bias uncertainty (and the trend weight's for mass series).
 */
export function projectRealistic(
  plan: ActivePlanRecord,
  state: ConfirmedState | null,
  adherence: readonly BlockAdherence[],
  opts: { today?: string; now?: () => number; fastOutcomes?: FastOutcomeCounts | null; planVersion?: number; scenario?: BehaviorScenario } = {},
): RealisticProjection {
  const t0 = opts.now?.() ?? 0;
  const ctx = planContext(plan);
  const fwd = new ForwardModel(plan, state, goalSeriesIds(ctx));
  const N = plan.schedule.horizonDays;
  const from = opts.today ? Math.max(fwd.anchorIdx, Math.min(N - 1, dayIndex(plan.startDate, opts.today))) : fwd.anchorIdx;
  const planVersion = opts.planVersion ?? plan.version;
  const scen: BehaviorScenarioOptions = { ...(opts.scenario ? { scenario: opts.scenario } : {}), ...(opts.fastOutcomes ? { fastOutcomes: opts.fastOutcomes } : {}), planVersion };
  const real = realisticSchedule(plan.schedule, from, adherence, fwd.rp, scen);
  const wsd = state?.trendWeight.sd ?? 0;
  const runsA = forecastRuns(fwd, plan.schedule);
  const runsR = forecastRuns(fwd, real);
  const extra = goalSeriesIds(ctx);
  const credits: ExpectedCredits = {};
  for (const t of PLAN_ITEM_TYPES) credits[t] = expectedCredit(adherence, t);
  return {
    fromDay: from,
    asPrescribed: goalOutcomes(ctx, runsA, from, plan.startDate, wsd),
    realistic: goalOutcomes(ctx, runsR, from, plan.startDate, wsd),
    bands: { asPrescribed: bandsOf(runsA, from, N, extra, wsd), realistic: bandsOf(runsR, from, N, extra, wsd) },
    goalBands: { asPrescribed: goalBandsOf(ctx, runsA, from, N), realistic: goalBandsOf(ctx, runsR, from, N) },
    correction: fwd.correction,
    credits,
    behavior: {
      algorithm: BEHAVIOR_FORECAST.algorithm,
      scenario: opts.scenario ?? 'plausibleExecution',
      assumption: opts.scenario === 'missingData' ? 'habitualContinuation' : 'prescribedDose',
      assumptions: opts.scenario === 'missingData' ? ['habitualIntakeNoAddedSessionContinuation', 'noCompletionEstimate'] : ['fullDoseAsPrescribed', 'noCompletionEstimate'],
      version: BEHAVIOR_FORECAST.version,
      seed: behaviorSeed(plan.schedule, planVersion),
      paths: BEHAVIOR_FORECAST.paths,
      calibration: BEHAVIOR_FORECAST.calibration,
      fastCompletion: { p: opts.scenario === 'missingData' ? 0 : 1, source: 'assumed', days: 0 },
    },
    schedule: real,
    euUsed: fwd.runs,
    ms: (opts.now?.() ?? 0) - t0,
  };
}

// ------------------------------------------------------------------------------------------------------------ items

/** Parsed plan item id (`energy`, `protein`, `window`, `fast`, `steps`, `sleep`, `supplement:<id>`, `rtSession:<d>:<k>`). */
export interface ItemRef {
  type: PlanItemType;
  day?: number;
  index?: number;
  supplementId?: string;
}

export function parseItemId(itemId: string): ItemRef {
  const [head, a, b] = itemId.split(':');
  if (head === 'rtSession' || head === 'cardioSession') return { type: head, ...(a !== undefined ? { day: Number(a) } : {}), ...(b !== undefined ? { index: Number(b) } : {}) };
  if (head === 'supplement') return { type: 'supplement', ...(a ? { supplementId: a } : {}) };
  if ((PLAN_ITEM_TYPES as readonly string[]).includes(head ?? '')) return { type: head as PlanItemType };
  throw new RangeError(`unknown plan item "${itemId}"`);
}

/** Sessions of a template that belong to a session item type. */
const sessionsOfType = (t: DayTemplate, type: PlanItemType): ExerciseSession[] => (t.exercise ?? []).filter((s) => (type === 'rtSession' ? s.kind === 'resistance' : s.kind === 'cardio'));

/** Day template with one item removed (habitual value / not done). */
export function omitItem(t: DayTemplate, ref: ItemRef, rp: ResolvedProfile): DayTemplate {
  switch (ref.type) {
    case 'energy':
      return t.energy.kind === 'zero' ? t : { ...t, energy: { kind: 'pctMaintenance', pct: 100 } };
    case 'protein':
      return { ...t, macros: { ...t.macros, protein: { unit: 'g', value: rp.habitualProteinG } } };
    case 'window':
      return t.meals ? { ...t, meals: { ...t.meals, window: { startH: rp.habits.habitualWindowStartH, lengthH: rp.habits.habitualWindowLengthH } } } : t;
    case 'fast':
      return t.energy.kind === 'zero' ? { ...t, energy: { kind: 'pctMaintenance', pct: 100 } } : t;
    case 'steps':
      return t.steps === undefined ? t : { ...t, steps: rp.habits.typicalSteps };
    case 'sleep':
      return t.sleep ? { ...t, sleep: { ...t.sleep, bedH: rp.habits.bedTimeH, wakeH: rp.habits.wakeTimeH, hours: undefined } } : t;
    case 'supplement':
      return t.substances?.creatineG ? { ...t, substances: { ...t.substances, creatineG: 0 } } : t;
    case 'rtSession':
    case 'cardioSession': {
      const all = t.exercise ?? [];
      if (ref.index !== undefined) return { ...t, exercise: all.filter((_, k) => k !== ref.index) };
      return { ...t, exercise: all.filter((s) => !sessionsOfType(t, ref.type).includes(s)) };
    }
  }
}

const LOAD_PCT: Record<StimulusVector['loadClass'], number> = { heavy: 85, moderate: 70, light: 50, veryLight: 30 };

/** Engine sessions delivering a performed stimulus vector, in place of the prescribed session `prescribed`. */
export function sessionsFromStimulus(v: StimulusVector, prescribed: ExerciseSession | undefined): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  const startH = prescribed?.startH ?? 18;
  const sets = Object.values(v.effectiveSetsByRegion).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (sets > 0) {
    out.push({
      kind: 'resistance',
      startH,
      setsByRegion: { ...v.effectiveSetsByRegion },
      loadPct1RM: LOAD_PCT[v.loadClass],
      durationMin: Math.max(10, Math.round(2.5 * Math.max(...Object.values(v.effectiveSetsByRegion).map((x) => x ?? 0)) * 3)),
    });
  }
  if (v.mem > 0) {
    const c: CardioSession = prescribed?.kind === 'cardio' ? { ...prescribed, durationMin: v.mem } : { kind: 'cardio', modality: 'other', startH: startH + (sets > 0 ? 1 : 0), durationMin: v.mem };
    out.push(c);
  }
  return out;
}

/** Day template with the item as performed (a stimulus vector for sessions, or the logged day's own values). */
export function performItem(t: DayTemplate, ref: ItemRef, performed: StimulusVector | DayTemplate, rp: ResolvedProfile): DayTemplate {
  const isTemplate = (p: StimulusVector | DayTemplate): p is DayTemplate => (p as DayTemplate).energy !== undefined && (p as DayTemplate).macros !== undefined;
  if (!isTemplate(performed)) {
    if (ref.type !== 'rtSession' && ref.type !== 'cardioSession') throw new RangeError('benefitRetained: a stimulus vector describes a session item');
    const all = t.exercise ?? [];
    const own = ref.index !== undefined ? all[ref.index] : sessionsOfType(t, ref.type)[0];
    const rest = all.filter((s) => s !== own);
    return { ...t, exercise: [...rest, ...sessionsFromStimulus(performed, own)] };
  }
  const p = performed;
  switch (ref.type) {
    case 'energy':
    case 'fast':
      return { ...t, energy: p.energy, macros: p.macros };
    case 'protein':
      return { ...t, macros: { ...t.macros, protein: p.macros.protein } };
    case 'window':
      return { ...t, ...(p.meals ? { meals: p.meals } : {}) };
    case 'steps':
      return p.steps === undefined ? omitItem(t, ref, rp) : { ...t, steps: p.steps };
    case 'sleep':
      return p.sleep ? { ...t, sleep: p.sleep } : omitItem(t, ref, rp);
    case 'supplement':
      return { ...t, substances: { ...t.substances, creatineG: p.substances?.creatineG ?? 0 } };
    case 'rtSession':
    case 'cardioSession': {
      const all = t.exercise ?? [];
      const own = ref.index !== undefined ? all[ref.index] : sessionsOfType(t, ref.type)[0];
      const done = sessionsOfType(p, ref.type);
      return { ...t, exercise: [...all.filter((s) => s !== own), ...done] };
    }
  }
}

/** Dose ratio fallback when the forward run cannot resolve the item's effect: performed / prescribed amount. */
function doseRatio(plan: DayTemplate, actual: DayTemplate, omit: DayTemplate, ref: ItemRef, rp: ResolvedProfile): number {
  const dose = (t: DayTemplate): number => {
    switch (ref.type) {
      case 'rtSession':
        return sessionsOfType(t, 'rtSession').reduce((a, s) => a + Object.values((s as ResistanceSession).setsByRegion ?? {}).reduce<number>((x, y) => x + (y ?? 0), 0) + ((s as ResistanceSession).setsByRegion ? 0 : 12), 0);
      case 'cardioSession':
        return sessionsOfType(t, 'cardioSession').reduce((a, s) => a + (s as CardioSession).durationMin, 0);
      case 'energy':
      case 'fast': {
        const e = t.energy;
        return -(e.kind === 'zero' ? 100 : e.kind === 'kcal' ? (100 * e.kcal) / rp.tdee0Kcal : e.pct);
      }
      case 'steps':
        return t.steps ?? rp.habits.typicalSteps;
      default:
        return JSON.stringify(t) === JSON.stringify(plan) ? 1 : 0;
    }
  };
  const p = dose(plan) - dose(omit);
  if (Math.abs(p) < 1e-9) return JSON.stringify(actual) === JSON.stringify(plan) ? 1 : 0;
  return Math.min(1, Math.max(0, (dose(actual) - dose(omit)) / p));
}

/**
 * Engine-level credit of one item (§8.6, R11 §4.1): c = clamp((J(actual) − J(omit)) / (J(plan) − J(omit)), 0, 1) with J
 * the ROC-weighted goal functionals on a 28-day forward run (from the confirmed state when given, else from the plan
 * start), each goal normalised by what the prescribed item does for it; goals the item does not move measurably drop
 * out. When no goal resolves the item, the performed/prescribed dose ratio is returned.
 */
export function benefitRetained(plan: ActivePlanRecord, date: string, itemId: string, performed: StimulusVector | DayTemplate, state: ConfirmedState | null = null): number {
  const ref = parseItemId(itemId);
  const d = dayIndex(plan.startDate, date);
  const ctx = planContext(plan);
  const fwd = new ForwardModel(plan, state, goalSeriesIds(ctx));
  const start = Math.max(d, fwd.anchorIdx);
  const H = Math.max(start + 7, Math.min(Math.max(plan.schedule.horizonDays, d + 8), start + SENSITIVITY_WINDOW_D));
  const base = withLength(plan.schedule, H);
  const t = dayTemplate(base, d);
  const tOmit = omitItem(t, ref, fwd.rp);
  const tAct = performItem(t, ref, performed, fwd.rp);
  if (d < 0 || d >= H || d < fwd.anchorIdx) return doseRatio(t, tAct, tOmit, ref, fwd.rp);
  const sched = (x: DayTemplate) => (x === t ? base : withDayTemplates(base, new Map([[d, { ...x, id: `${t.id}~${itemId}`, label: t.label }]])));
  const b = bindingsOf(ctx);
  // C6 (D1-05, D7-07, D1-08): the same objective guard as plan ranking — no credited benefit without a warrant
  const phi = (s: Schedule) => Array.from(objectiveGoalValues(ctx, b, fwd.run(s), s));
  const fP = phi(sched(t));
  const fO = phi(sched(tOmit));
  const fA = JSON.stringify(tAct) === JSON.stringify(t) ? fP : JSON.stringify(tAct) === JSON.stringify(tOmit) ? fO : phi(sched(tAct));
  const w = rocWeights(ctx.goals.length);
  let num = 0;
  let den = 0;
  for (let k = 0; k < fP.length; k++) {
    const u = fP[k]! - fO[k]!;
    if (!(Math.abs(u) > RESOLUTION_REL * Math.max(1, Math.abs(fP[k]!)))) continue;
    num += w[k]! * Math.min(1, Math.max(0, (fA[k]! - fO[k]!) / u));
    den += w[k]!;
  }
  return den > 0 ? num / den : doseRatio(t, tAct, tOmit, ref, fwd.rp);
}

// ------------------------------------------------------------------------------------------------------------ sensitivities

/** Item types prescribed on day d of a schedule. */
function itemTypesOn(s: Schedule, d: number): Set<PlanItemType> {
  const t = dayTemplate(s, d);
  const out = new Set<PlanItemType>();
  if (t.energy.kind === 'zero' || (s.events ?? []).some((e) => d >= e.startDay && d * 24 < e.startDay * 24 + e.startH + e.durationH)) out.add('fast');
  if (t.energy.kind !== 'zero') {
    out.add('energy');
    out.add('protein');
  }
  if (t.meals?.window) out.add('window');
  if ((t.exercise ?? []).some((x) => x.kind === 'resistance')) out.add('rtSession');
  if ((t.exercise ?? []).some((x) => x.kind === 'cardio')) out.add('cardioSession');
  if (t.steps !== undefined) out.add('steps');
  if (t.sleep) out.add('sleep');
  if ((t.substances?.creatineG ?? 0) > 0) out.add('supplement');
  return out;
}

/** Days [from, to) with every item of one type omitted (fasts: events starting there removed, zero days eaten). */
export function omitType(s: Schedule, from: number, to: number, type: PlanItemType, rp: ResolvedProfile): Schedule {
  const repl = new Map<number, DayTemplate>();
  for (let d = Math.max(0, from); d < Math.min(to, s.horizonDays); d++) {
    const t = dayTemplate(s, d);
    const u = omitItem(t, { type }, rp);
    if (JSON.stringify(u) !== JSON.stringify(t)) repl.set(d, { ...u, id: `${t.id}~o${d}`, label: t.label });
  }
  let out = withDayTemplates(s, repl);
  if (type === 'fast') {
    const events = (s.events ?? []).filter((e) => e.startDay < from || e.startDay >= to);
    if (events.length !== (s.events ?? []).length) out = { ...out, events };
  }
  return out;
}

/** Floor and renormalise: every weight ≥ floor, sum 1 (water-filling over the types above the floor). */
export function floorWeights(raw: Readonly<Record<PlanItemType, number>>, floor = ITEM_WEIGHT_FLOOR): Record<PlanItemType, number> {
  const types = [...PLAN_ITEM_TYPES];
  const out = Object.fromEntries(types.map((t) => [t, Math.max(0, raw[t] ?? 0)])) as Record<PlanItemType, number>;
  const fixed = new Set<PlanItemType>();
  for (let it = 0; it < types.length; it++) {
    const free = types.filter((t) => !fixed.has(t));
    const mass = 1 - floor * fixed.size;
    const sum = free.reduce((a, t) => a + out[t], 0);
    for (const t of free) out[t] = sum > 0 ? (out[t] * mass) / sum : mass / free.length;
    const low = free.filter((t) => out[t] < floor);
    if (low.length === 0) break;
    for (const t of low) {
      out[t] = floor;
      fixed.add(t);
    }
  }
  return out;
}

/**
 * Goal metric → R3 goal class of the session intent. D8-09: the generic endurance index is no goal and maps to no class
 * (task-specific performance is not represented by one index); VO2max keeps its broad estimate.
 */
const R3_CLASS_OF_METRIC: Partial<Record<string, keyof typeof INTENT_DEFAULTS>> = {
  leanTissue: 'muscle', leanMass: 'muscle', skeletalMuscle: 'muscle', rtMuscleGain: 'muscle', strength: 'strength',
  fatMass: 'fatLoss', bodyFatPct: 'fatLoss', scaleWeight: 'fatLoss', waist: 'fatLoss', visceralFat: 'fatLoss', liverFat: 'fatLoss',
  vo2max: 'vo2max',
};

/** R3 goal-class default α for a session type: the ROC-weighted mix over the ranked goals, else by what the session trains. */
export function defaultIntentFor(ctx: PlanningContext, type: 'rtSession' | 'cardioSession'): StimulusIntent {
  const w = rocWeights(ctx.goals.length);
  const acc: StimulusIntent = { hyp: 0, str: 0, card: 0, kcal: 0, mob: 0 };
  let tot = 0;
  ctx.goals.forEach((g, k) => {
    const cls = R3_CLASS_OF_METRIC[g.metric];
    if (!cls) return;
    const a = INTENT_DEFAULTS[cls];
    for (const key of Object.keys(acc) as (keyof StimulusIntent)[]) acc[key] += w[k]! * a[key];
    tot += w[k]!;
  });
  if (tot <= 0) return { ...(type === 'rtSession' ? INTENT_DEFAULTS.muscle : INTENT_DEFAULTS.vo2max) };
  // a session type cannot deliver what it does not train: resistance carries no cardio term, cardio no hypertrophy/strength
  if (type === 'rtSession') acc.card = 0;
  else {
    acc.hyp = 0;
    acc.str = 0;
  }
  const s = acc.hyp + acc.str + acc.card + acc.kcal + acc.mob;
  if (s <= 0) return { ...(type === 'rtSession' ? INTENT_DEFAULTS.muscle : INTENT_DEFAULTS.vo2max) };
  return { hyp: acc.hyp / s, str: acc.str / s, card: acc.card / s, kcal: acc.kcal / s, mob: acc.mob / s };
}

/** Net session energy, kcal (resistance ≈ 4 kcal/min, cardio ≈ 7 kcal/min at moderate intensity). */
const sessionKcal = (s: ExerciseSession): number => (s.kind === 'resistance' ? 4 * (s.durationMin ?? 60) : 7 * s.durationMin);

export interface SensitivityOptions {
  /** Plan version id written into the result (default `<planId>@<version>`). */
  planVersion?: string;
  now?: () => number;
  /** Receives the number of simulations and the elapsed ms (when `now` is given). */
  onCost?: (c: { runs: number; ms: number }) => void;
}

/**
 * `PlanSensitivities` (§8.6, R11 §4.1): over the 28 days from the confirmed state (or the plan start),
 *  - itemWeights: J(plan) − J(plan without that item type), J the ROC-weighted goal functionals each normalised by what the
 *    whole plan does for the goal against the habitual week; shares with a 0.02 floor (all nine types, sum 1);
 *  - intentByItem: per session type, ∂J of its stimulus components (hypertrophy: sets +20 %; strength: load to 85 %
 *    1RM; cardio: minutes +20 % net of their energy; energy: the same energy taken off intake), normalised; the R3
 *    goal-class defaults when the run does not resolve them. The same α applies to every session item of that type.
 */
export function computePlanSensitivities(plan: ActivePlanRecord, state: ConfirmedState | null, opts: SensitivityOptions = {}): PlanSensitivities {
  const t0 = opts.now?.() ?? 0;
  const ctx = planContext(plan);
  const fwd = new ForwardModel(plan, state, goalSeriesIds(ctx));
  const N = plan.schedule.horizonDays;
  const from = Math.min(fwd.anchorIdx, Math.max(0, N - 1));
  const H = Math.min(Math.max(N, from + 7), from + SENSITIVITY_WINDOW_D);
  const base = withLength(plan.schedule, H);
  const b = bindingsOf(ctx);
  // C6 (D1-05, D7-07, D1-08): the same objective guard as plan ranking — no credited benefit without a warrant
  const phi = (s: Schedule) => Array.from(objectiveGoalValues(ctx, b, fwd.run(s), s));
  const allOff = (types: ReadonlySet<PlanItemType>) => creditSchedule(base, from, H, (t) => (types.has(t) ? 0 : 1), fwd.rp);
  const present = new Set<PlanItemType>();
  for (let d = from; d < H; d++) for (const t of itemTypesOn(base, d)) present.add(t);
  const fPlan = phi(base);
  const fHab = phi(allOff(new Set(PLAN_ITEM_TYPES)));
  const w = rocWeights(ctx.goals.length);
  const scale = fPlan.map((v, k) => Math.max(Math.abs(v - fHab[k]!), RESOLUTION_REL * Math.max(1, Math.abs(v))));
  const sign = fPlan.map((_, k) => goalSign(ctx, k, fHab[k]!));
  const J = (f: readonly number[]) => f.reduce((a, v, k) => a + (w[k]! * sign[k]! * (v - fHab[k]!)) / scale[k]!, 0);
  const jPlan = J(fPlan);

  // item weights (types not prescribed in the window keep the floor)
  const raw = Object.fromEntries(PLAN_ITEM_TYPES.map((t) => [t, 0])) as Record<PlanItemType, number>;
  let any = false;
  for (const t of PLAN_ITEM_TYPES) {
    if (!present.has(t)) continue;
    const s = omitType(base, from, H, t, fwd.rp);
    if (s === base) continue;
    const dj = jPlan - J(phi(s));
    raw[t] = Math.max(0, dj);
    if (raw[t] > 1e-9) any = true;
  }
  const itemWeights = floorWeights(any ? raw : FALLBACK_ITEM_WEIGHTS);

  // stimulus intent per session type
  const intentOf = new Map<'rtSession' | 'cardioSession', StimulusIntent>();
  for (const type of ['rtSession', 'cardioSession'] as const) {
    if (!present.has(type)) continue;
    const mod = (f: (s: ExerciseSession) => ExerciseSession, energy?: (t: DayTemplate, s: ExerciseSession[]) => DayTemplate): Schedule => {
      const repl = new Map<number, DayTemplate>();
      for (let d = from; d < H; d++) {
        const t = dayTemplate(base, d);
        const own = sessionsOfType(t, type);
        if (own.length === 0) continue;
        let u: DayTemplate = { ...t, exercise: (t.exercise ?? []).map((s) => (own.includes(s) ? f(s) : s)) };
        if (energy) u = energy(u, own);
        repl.set(d, { ...u, id: `${t.id}~fd${d}`, label: t.label });
      }
      return withDayTemplates(base, repl);
    };
    const less = (t: DayTemplate, own: ExerciseSession[]): DayTemplate => {
      const k = FD_STEP * own.reduce((a, s) => a + sessionKcal(s), 0);
      const e = t.energy;
      if (e.kind === 'zero') return t;
      return { ...t, energy: e.kind === 'kcal' ? { kind: 'kcal', kcal: e.kcal - k } : { ...e, pct: e.pct - (100 * k) / fwd.rp.tdee0Kcal } };
    };
    const dKcal = J(phi(mod((s) => s, less))) - jPlan;
    let a: StimulusIntent;
    if (type === 'rtSession') {
      const more = (s: ExerciseSession): ExerciseSession => {
        const r = s as ResistanceSession;
        return r.setsByRegion ? { ...r, setsByRegion: Object.fromEntries(Object.entries(r.setsByRegion).map(([k, v]) => [k, (v ?? 0) * (1 + FD_STEP)])) } : r;
      };
      const heavy = (s: ExerciseSession): ExerciseSession => ({ ...(s as ResistanceSession), loadPct1RM: 85 });
      a = { hyp: J(phi(mod(more))) - jPlan, str: J(phi(mod(heavy))) - jPlan, card: 0, kcal: dKcal, mob: 0 };
    } else {
      const longer = (s: ExerciseSession): ExerciseSession => ({ ...(s as CardioSession), durationMin: (s as CardioSession).durationMin * (1 + FD_STEP) });
      a = { hyp: 0, str: 0, card: J(phi(mod(longer))) - jPlan - dKcal, kcal: dKcal, mob: 0 };
    }
    const keys = Object.keys(a) as (keyof StimulusIntent)[];
    for (const k of keys) a[k] = Math.max(0, a[k]);
    const s = keys.reduce((x, k) => x + a[k], 0);
    intentOf.set(type, s > 1e-6 ? (Object.fromEntries(keys.map((k) => [k, a[k] / s])) as unknown as StimulusIntent) : defaultIntentFor(ctx, type));
  }
  const intentByItem: Record<string, StimulusIntent> = {};
  for (let d = 0; d < N; d++) {
    const t = dayTemplate(plan.schedule, d);
    (t.exercise ?? []).forEach((s, k) => {
      const type = s.kind === 'resistance' ? 'rtSession' : 'cardioSession';
      intentByItem[`${type}:${d}:${k}`] = { ...(intentOf.get(type) ?? defaultIntentFor(ctx, type)) };
    });
  }
  opts.onCost?.({ runs: fwd.runs, ms: (opts.now?.() ?? 0) - t0 });
  return { planVersion: opts.planVersion ?? `${plan.planId}@${plan.version}`, itemWeights, intentByItem };
}
