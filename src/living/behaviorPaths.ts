/**
 * Behaviour scenarios and seeded completion paths (D5-08; C2, C6, C7). Utility credit is not a completion probability and
 * never becomes a physiological dose here. Production uses `physicalBehaviorSchedule`: plausible execution is an explicit
 * full-prescribed-dose assumption, alongside the prescribed and habitual-continuation sensitivity. The optional sampled
 * helpers below support a separately selected, named path analysis:
 *
 *  - 'asPrescribed': every future opportunity done as prescribed (one path).
 *  - 'missingData': a sensitivity alternative for opportunities the person may not report — each replays at the habitual baseline
 *    (sessions and fasts left out), never a fraction of a prescribed dose.
 *  - 'plausibleExecution': seeded paths sample done / partial / skipped per opportunity from OBSERVED completion outcomes
 *    (`completionProbabilities`), or the explicit as-prescribed assumption when there is no evidence. Same-day opportunities
 *    of one type share one draw (no within-day pseudo-replication). Each path's doses go through the full nonlinear
 *    simulation BEFORE outcomes are averaged (E[f(D)], generally ≠ f(E[D])); a fast is kept, shortened or left out per
 *    path — never scaled by a mean credit, and no 0.5 switch turns every fast on.
 *
 * A partial outcome needs a dose: a session replays at an explicit 50 % scenario dose and a fast ends at the person's
 * median observed partial fast, else at the overnight gap (12 h) — named assumptions, not measurements. Seeds derive from
 * the plan, version and stable path index (reproducible); the path count is budgeted. Intervals from these paths are
 * scenario ranges of heuristic coverage until a prospective calibration exists.
 */
import type { DayTemplate, ResolvedProfile, Schedule } from '@/engine';
export type { BehaviorScenario } from './adherence';
import { fnv1a } from '@/engine/core/math';
import { mulberry32 } from '@/lib/rng';
import { BEHAVIOR_FORECAST_VERSION, behaviorForecastMeta, completionEvidence, completionProbabilities, FAST_BASE_H, type BehaviorScenario, type CompletionProbabilities, type OutcomeObservation } from './adherence';
import { scaleSession } from './loggedDay';
import type { PlanItemType } from './plannerContract';
import { templateOfDay } from './prescription';
import type { BehaviorForecastMeta, LocalDate } from './types';

/** Most paths a forecast may sample (compute budget). */
export const MAX_BEHAVIOR_PATHS = 64;
/** Scenario dose of a partially done session (an explicit assumption, not a measured fraction). */
export const PARTIAL_SESSION_DOSE_ASSUMPTION = 0.5;

/** A future prescribed opportunity (plan day and item type). */
export interface BehaviorOpportunity {
  day: number;
  type: Extract<PlanItemType, 'rtSession' | 'cardioSession' | 'fast'>;
}

export type OpportunityOutcome = 'done' | 'partial' | 'skipped';

export interface BehaviorPath {
  index: number;
  seed: number;
  /** Outcome per cluster key `${day}:${type}` (same-day opportunities of a type share it). */
  outcomes: Readonly<Record<string, OpportunityOutcome>>;
  /** Named assumptions the path relies on. */
  assumptions: readonly string[];
}

/** The deterministic seed of path `index` for a plan version (stable across reloads and devices). */
export function behaviorPathSeed(planId: string, version: number, index: number): number {
  return parseInt(fnv1a(`behaviorPath|semantics${BEHAVIOR_FORECAST_VERSION}|${planId}|v${version}|${index}`).slice(0, 8), 16) >>> 0;
}

/** Future opportunities of a schedule from `fromDay`: sessions by kind and fasts starting that day. */
export function opportunitiesOf(schedule: Schedule, fromDay: number, toDay: number = schedule.horizonDays): BehaviorOpportunity[] {
  const out: BehaviorOpportunity[] = [];
  for (let d = Math.max(0, fromDay); d < Math.min(toDay, schedule.horizonDays); d++) {
    const ex = templateOfDay(schedule, d).exercise ?? [];
    if (ex.some((s) => s.kind !== 'cardio')) out.push({ day: d, type: 'rtSession' });
    if (ex.some((s) => s.kind === 'cardio')) out.push({ day: d, type: 'cardioSession' });
    if (templateOfDay(schedule, d).energy.kind === 'zero' || (schedule.events ?? []).some((e) => e.kind === 'fast' && e.startDay === d && e.durationH > 0)) out.push({ day: d, type: 'fast' });
  }
  return out;
}

const clusterKey = (o: BehaviorOpportunity): string => `${o.day}:${o.type}`;

/**
 * Sample behaviour paths for a scenario. 'asPrescribed' and 'missingData' are single deterministic paths; 'plausibleExecution'
 * draws `paths` seeded paths (at most `MAX_BEHAVIOR_PATHS`) from the observed completion probabilities of each type, the
 * as-prescribed outcome where a type has no evidence (named).
 */
export function sampleBehaviorPaths(i: {
  opportunities: readonly BehaviorOpportunity[];
  scenario: BehaviorScenario;
  probabilities: (type: BehaviorOpportunity['type']) => CompletionProbabilities | null;
  planId: string;
  version: number;
  paths?: number;
}): BehaviorPath[] {
  const keys = [...new Set(i.opportunities.map(clusterKey))].sort((a, b) => {
    const [da, ta] = a.split(':');
    const [db, tb] = b.split(':');
    return Number(da) - Number(db) || (ta! < tb! ? -1 : ta! > tb! ? 1 : 0);
  });
  if (i.scenario === 'asPrescribed') return [{ index: 0, seed: behaviorPathSeed(i.planId, i.version, 0), outcomes: Object.fromEntries(keys.map((k) => [k, 'done'])), assumptions: ['asPrescribed'] }];
  if (i.scenario === 'missingData') return [{ index: 0, seed: behaviorPathSeed(i.planId, i.version, 0), outcomes: Object.fromEntries(keys.map((k) => [k, 'skipped'])), assumptions: ['missingDataHabitualBaseline'] }];
  const n = Math.max(1, Math.min(MAX_BEHAVIOR_PATHS, Math.floor(i.paths ?? 16)));
  const out: BehaviorPath[] = [];
  for (let index = 0; index < n; index++) {
    const seed = behaviorPathSeed(i.planId, i.version, index);
    const outcomes: Record<string, OpportunityOutcome> = {};
    const assumptions = new Set<string>();
    for (const k of keys) {
      const type = k.split(':')[1] as BehaviorOpportunity['type'];
      const p = i.probabilities(type);
      const u = mulberry32(parseInt(fnv1a(`${seed}|${k}`), 16) >>> 0)(); // common cluster draw across schedules
      if (!p) {
        outcomes[k] = 'done';
        assumptions.add(`noEvidence:${type}:asPrescribed`);
        continue;
      }
      outcomes[k] = u < p.done ? 'done' : u < p.done + p.partial ? 'partial' : 'skipped';
      if (outcomes[k] === 'partial') assumptions.add(type === 'fast' ? 'partialFast:observedMedianOr12hAssumption' : 'partialSession:fixedHalfDoseAssumption');
      if (outcomes[k] === 'skipped') assumptions.add('omittedFast:explicitIntakeContinuation');
    }
    out.push({ index, seed, outcomes, assumptions: [...assumptions].sort() });
  }
  return out;
}

/** The person's median achieved hours of fasts that ended early (observed), or null. */
export function medianPartialFastH(achieved: readonly number[]): number | null {
  const xs = achieved.filter((h) => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/**
 * The schedule of one path from `fromDay`: a skipped session leaves that day's sessions of its kind out, a partial one
 * replays at the scenario dose; a skipped fast is removed, a partial one ends at `partialFastH` (default the overnight
 * gap), a done one stays as prescribed. Days before `fromDay` are never touched.
 */
export function applyBehaviorPath(schedule: Schedule, path: BehaviorPath, fromDay: number, opts: { partialFastH?: number | null; intakeContinuation?: DayTemplate; partialSessionDose?: number } = {}): Schedule {
  const days = schedule.days.map((d) => ({ ...d }));
  let events = [...(schedule.events ?? [])];
  for (const [k, outcome] of Object.entries(path.outcomes)) {
    if (outcome === 'done') continue;
    const [ds, type] = k.split(':') as [string, BehaviorOpportunity['type']];
    const d = Number(ds);
    if (!(d >= fromDay) || d >= days.length) continue;
    if (type === 'fast') {
      const t = templateOfDay({ ...schedule, days }, d);
      if (t.energy.kind === 'zero') {
        if (!opts.intakeContinuation) throw new Error('A zero-intake fast path requires an explicit intake continuation');
        days[d] = { ...days[d]!, override: { ...days[d]!.override, energy: opts.intakeContinuation.energy, macros: opts.intakeContinuation.macros, meals: opts.intakeContinuation.meals } };
        if (outcome === 'partial') {
          const h = Math.min(24, Math.max(0, opts.partialFastH ?? FAST_BASE_H));
          // The continuation supplies the eating period; the remaining fast remains a physical event.
          if (h > 0 && !(events.some((e) => e.kind === 'fast' && e.startDay === d))) events.push({ kind: 'fast', startDay: d, startH: 0, durationH: h });
        }
      }
      events = events.flatMap((e) => {
        if (e.kind !== 'fast' || e.startDay !== d) return [e];
        if (outcome === 'skipped') return [];
        const h = Math.min(e.durationH, opts.partialFastH ?? FAST_BASE_H);
        return h > 0 ? [{ ...e, durationH: h }] : [];
      });
      continue;
    }
    const cardio = type === 'cardioSession';
    const ex = templateOfDay({ ...schedule, days }, d).exercise ?? [];
    const kept = ex.flatMap((s) => {
      if ((s.kind === 'cardio') !== cardio) return [s];
      if (outcome === 'skipped') return [];
      const fraction = opts.partialSessionDose ?? PARTIAL_SESSION_DOSE_ASSUMPTION;
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Partial session dose must be a finite fraction from 0 to 1');
      if (fraction === 0) return [];
      // Use exact physical fractions for represented doses; the descriptive-credit helper's near-zero/near-one
      // rounding is not a physical completion rule.
      const sc = s.kind === 'cardio'
        ? { ...s, durationMin: s.durationMin * fraction, ...(s.phases ? { phases: s.phases.map((phase) => ({ ...phase, durationMin: phase.durationMin * fraction })) } : {}) }
        : s.groups
          ? { ...s, ...(s.durationMin !== undefined ? { durationMin: s.durationMin * fraction } : {}), groups: s.groups.map((g) => ({ ...g, sets: g.sets * fraction, ...(g.startOffsetMin !== undefined ? { startOffsetMin: g.startOffsetMin * fraction } : {}), ...(g.durationMin !== undefined ? { durationMin: g.durationMin * fraction } : {}) })) }
          : s.setsByRegion
            ? { ...s, ...(s.durationMin !== undefined ? { durationMin: s.durationMin * fraction } : {}), setsByRegion: Object.fromEntries(Object.entries(s.setsByRegion).map(([region, sets]) => [region, (sets ?? 0) * fraction])) }
            : scaleSession(s, fraction);
      return sc ? [sc] : [];
    });
    days[d] = { ...days[d]!, override: { ...days[d]!.override, exercise: kept } };
  }
  return { ...schedule, days, events };
}

export interface EnsembleSummary {
  /** Per output index: mean, P10, P50 and P90 over the simulated paths (scenario range; heuristic coverage). */
  mean: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  paths: number;
  /** Finite storage uses zero only with an unavailable/count sidecar. */
  available: boolean[];
  contributors: number[];
  meta: BehaviorForecastMeta;
}

const quantile = (sorted: readonly number[], q: number): number => {
  if (sorted.length === 1) return sorted[0]!;
  const x = q * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  const fraction = x - lo;
  return sorted[lo]! * (1 - fraction) + sorted[hi]! * fraction;
};

/**
 * Simulate every path, then summarise (E[f(D)]): `simulate` runs the full model on one path's schedule and returns its
 * outcome series. Non-finite values are skipped per index (never averaged as zero).
 */
export function ensembleOutcome(paths: readonly BehaviorPath[], simulate: (p: BehaviorPath) => ArrayLike<number>, scenario: BehaviorScenario): EnsembleSummary {
  const runs = paths.map((p) => Array.from(simulate(p), (x) => x));
  const n = Math.max(0, ...runs.map((r) => r.length));
  const mean: number[] = [];
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  const available: boolean[] = [];
  const contributors: number[] = [];
  for (let k = 0; k < n; k++) {
    const xs = runs.map((r) => r[k]).filter((x): x is number => x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
    contributors.push(xs.length);
    available.push(xs.length > 0);
    if (xs.length === 0) {
      mean.push(0);
      p10.push(0);
      p50.push(0);
      p90.push(0);
      continue;
    }
    mean.push(xs.reduce((a, b) => a + b / xs.length, 0));
    p10.push(quantile(xs, 0.1));
    p50.push(quantile(xs, 0.5));
    p90.push(quantile(xs, 0.9));
  }
  const algorithm: BehaviorForecastMeta['algorithm'] = scenario === 'plausibleExecution' ? (paths.length > 1 ? 'pathEnsemble' : 'plausibleExecution') : scenario;
  return { mean, p10, p50, p90, available, contributors, paths: paths.length, meta: behaviorForecastMeta(algorithm, { ...(paths[0] ? { seed: paths[0].seed } : {}), paths: paths.length }) };
}

/** Observed outcomes of elapsed days (final, not backfilled) for `completionEvidence`; unknown items drop out. */
export function outcomesOfDays(days: ReadonlyArray<{ date: LocalDate; result: { score: { final: boolean }; assumedDay: boolean; loggedDay: { items: ReadonlyArray<{ type: PlanItemType; status: OutcomeObservation['status'] }> } } }>): OutcomeObservation[] {
  const out: OutcomeObservation[] = [];
  for (const d of days) {
    if (!d.result.score.final || d.result.assumedDay) continue;
    for (const it of d.result.loggedDay.items) if (it.status !== 'unknown') out.push({ date: d.date, type: it.type, status: it.status });
  }
  return out;
}

/** Held-out score of completion predictions (predictive only: no causal attribution). */
export interface ProspectiveCompletionScore {
  trainDays: number;
  heldOutDays: number;
  /** Mean multiclass Brier score (done/partial/skipped) of the fitted probabilities on held-out day clusters. */
  brier: number | null;
  /** The same score for the simple as-prescribed baseline (every opportunity done). */
  baselineBrier: number | null;
  /** Mean predicted minus observed share of done clusters (calibration bias). */
  bias: number | null;
  causal: false;
  meta: BehaviorForecastMeta;
}

/**
 * (D5-08) Prospective calibration check: fit completion probabilities on the outcomes before `splitDate` (training block),
 * freeze them, and score the untouched later outcomes (day clusters) with a proper score and bias against the simple
 * as-prescribed baseline. A type without training evidence is predicted as prescribed. Predictive only.
 */
export function prospectiveCompletionScore(outcomes: readonly OutcomeObservation[], splitDate: LocalDate): ProspectiveCompletionScore {
  const known = outcomes.filter((o) => o.status !== 'unknown');
  const train = known.filter((o) => o.date < splitDate);
  const test = known.filter((o) => o.date >= splitDate);
  const lastTrain = train.reduce<LocalDate | null>((m, o) => (m === null || o.date > m ? o.date : m), null);
  const evidence = lastTrain ? completionEvidence(train, lastTrain) : [];
  const clusters = new Map<string, { type: OutcomeObservation['type']; statuses: string[] }>();
  for (const o of test) {
    const k = `${o.date}|${o.type}`;
    const c = clusters.get(k) ?? { type: o.type, statuses: [] };
    c.statuses.push(o.status);
    clusters.set(k, c);
  }
  const trainDays = new Set(train.map((o) => `${o.date}|${o.type}`)).size;
  const meta = behaviorForecastMeta('plausibleExecution');
  if (clusters.size === 0) return { trainDays, heldOutDays: 0, brier: null, baselineBrier: null, bias: null, causal: false, meta };
  let brier = 0;
  let base = 0;
  let predDone = 0;
  let obsDone = 0;
  for (const c of clusters.values()) {
    const y = c.statuses.every((x) => x === 'done') ? 'done' : c.statuses.every((x) => x === 'skipped') ? 'skipped' : 'partial';
    const p = completionProbabilities(evidence, c.type) ?? { done: 1, partial: 0, skipped: 0 };
    for (const k of ['done', 'partial', 'skipped'] as const) {
      const yk = y === k ? 1 : 0;
      brier += (p[k] - yk) ** 2;
      base += ((k === 'done' ? 1 : 0) - yk) ** 2;
    }
    predDone += p.done;
    obsDone += y === 'done' ? 1 : 0;
  }
  const n = clusters.size;
  return { trainDays, heldOutDays: n, brier: brier / n, baselineBrier: base / n, bias: (predDone - obsDone) / n, causal: false, meta };
}

/**
 * Shared fixed physical scenarios for all production forecast/re-plan consumers. Plausible execution explicitly assumes
 * the full prescription. No utility posterior or inferred completion probability determines the physical dose.
 * The missing-input sensitivity is a named habitual-intake/no-added-session continuation, not observed compliance.
 */
export function physicalBehaviorSchedule(schedule: Schedule, rp: ResolvedProfile, fromDay: number, toDay = schedule.horizonDays, scenario: BehaviorScenario = 'plausibleExecution'): Schedule {
  if (scenario !== 'missingData') return schedule;
  const lo = Math.max(0, Math.floor(fromDay));
  const hi = Math.max(lo, Math.min(schedule.horizonDays, Math.floor(toDay)));
  if (!(hi > lo)) return schedule;
  const days = schedule.days.map((d) => ({ ...d }));
  for (let day = lo; day < hi; day++) {
    days[day] = { ...days[day]!, override: { ...days[day]!.override,
      energy: { kind: 'kcal', kcal: rp.tdee0Kcal },
      macros: { protein: { unit: 'g', value: rp.habitualProteinG }, carbs: { unit: 'g', value: rp.habitualCarbG }, fat: { unit: 'g', value: rp.habitualFatG } },
      meals: { count: rp.habits.habitualMealsPerDay, window: { startH: rp.habits.habitualWindowStartH, lengthH: rp.habits.habitualWindowLengthH } },
      exercise: [], steps: rp.habits.typicalSteps,
    } };
  }
  const omitFromH = lo * 24;
  const omitToH = hi * 24;
  const events = (schedule.events ?? []).flatMap((e) => {
    const startH = e.startDay * 24 + e.startH;
    const endH = startH + e.durationH;
    if (endH <= omitFromH || startH >= omitToH) return [e];
    const kept: typeof e[] = [];
    if (startH < omitFromH) {
      // Preserve realised past hours. This artificial endpoint must not impose a new refeed ramp on the
      // explicitly selected habitual-intake continuation.
      kept.push({ ...e, durationH: omitFromH - startH, refeed: 'none', refeedFactors: undefined });
    }
    if (endH > omitToH) kept.push({ ...e, startDay: hi, startH: 0, durationH: endH - omitToH });
    return kept;
  });
  return { ...schedule, days, events };
}
