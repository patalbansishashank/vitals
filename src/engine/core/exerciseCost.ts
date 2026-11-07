/**
 * One exercise energy ledger (C7, D3-07): the pure bout-cost resolver shared by the catalogue (stimulus), the activity
 * intake, the activity module and the R-MAINT reference. Every surface names the same five quantities and never equates
 * them:
 *
 *   gross               published standard-MET gross (MET·3.5 mL/kg/min·BW·5 kcal/L) or an individually modelled gross
 *   ownRest             RMR_day·duration/1440 (the person's own resting share of the bout)
 *   netAboveRest        max(0, gross − ownRest)                     — the EEE of energy availability / safety
 *   displacedLifestyle  the lifestyle activity the bout replaces (activity 10 §4.1.3 design prior 0.2 × RMR/min)
 *   incremental         netAboveRest − displacedLifestyle (signed)  — what the energy ledger books
 *
 * Recovery energy (EPOC / a research recovery budget) is added once, separately, by the activity module; the resolver
 * never folds it into gross or net. A standard-MET gross with a personal resting intercept is a modelled quantity: the
 * published equation's validation is not inherited (`domain` says which one was used).
 *
 * Steps (D3-07): what a daily step number counts (`StepsScope`) decides the step-energy ledger only. A total-day count
 * includes the locomotor steps of sessions whose energy is booked as sessions, so those steps leave the step ledger (never
 * the reported total); an excludes-training count is used as it is. The habitual reference is reconciled with the same
 * rule, so the overlap correction is symmetric. Unknown overlap is a declared scenario (no subtraction) with one named
 * assumption, never a guessed fraction.
 *
 * Pure, allocation only for returned objects.
 */
import type { ExerciseCostBreakdown, QuantityProvenance } from '@/lib/bodyContracts';
import type { StepsScope } from '../types/schedule';

/** Semantics version of the shared ledger (C7: changed semantics enter request/cache hashes through the registry). */
export const EXERCISE_COST_VERSION = 'exerciseCost/2026-10-18';

/** 1 MET = 3.5 mL O2/kg/min (Compendium convention, activity.metVo2) and 5 kcal per litre of O2 (activity.kcalPerLO2). */
export const STANDARD_MET_VO2 = 3.5;
export const STANDARD_KCAL_PER_L_O2 = 5;
/**
 * kcal per kg per hour per MET under the standard conversion: 3.5·5·60/1000 = 1.05. The "MET·kg·h" shortcut (1.0) is a
 * different approximation; every surface uses this one so a bout costs the same wherever it is computed.
 */
export const KCAL_PER_KG_H_PER_MET = (STANDARD_MET_VO2 * STANDARD_KCAL_PER_L_O2 * 60) / 1000;

/** Gross kcal of `minutes` at a gross MET for a body mass (standard conversion), kcal. */
export function standardMetGrossKcal(metGross: number, bodyMassKg: number, minutes: number): number {
  return (metGross * KCAL_PER_KG_H_PER_MET * bodyMassKg * minutes) / 60;
}

/** Net kcal above a standard 1-MET rest (MET − 1), the published-equation convention when no RMR is known, kcal. */
export function standardMetNetKcal(metGross: number, bodyMassKg: number, minutes: number): number {
  return standardMetGrossKcal(Math.max(0, metGross - 1), bodyMassKg, minutes);
}

/** Inputs of one bout's cost. */
export interface BoutCostInput {
  /** Gross kcal of the bout (published standard MET, an equation, a device, …). */
  grossKcal: number;
  durationMin: number;
  /**
   * The person's RMR, kcal/d. Null = unknown: own rest falls back to the standard 1 MET (3.5 mL/kg/min) with `bodyMassKg`,
   * labelled through `restBasis`.
   */
  rmrKcalPerDay: number | null;
  /** Needed for the standard-rest fallback. */
  bodyMassKg?: number;
  /**
   * Displaced lifestyle activity as a multiple of RMR per minute of the bout (activity.displacedBaseline, a design prior);
   * null = unknown (incremental then stays null: an explicit scenario, not a guess).
   */
  displacedFracOfRmr: number | null;
  method: ExerciseCostBreakdown['method'];
  domain?: string;
  source: QuantityProvenance;
  /** Recovery kcal booked separately for this bout (EPOC / research budget); carried, never added into net. */
  recoveryKcal?: number;
}

/** Where `ownRestKcal` came from. */
export type RestBasis = 'personalRmr' | 'standardMet';

/** One bout's labelled energy terms (ExerciseCostBreakdown) plus the resting basis used. */
export interface BoutCost extends ExerciseCostBreakdown {
  restBasis: RestBasis;
  version: typeof EXERCISE_COST_VERSION;
}

const fin = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * The shared resolver: ownRest = RMR·duration/1440 (standard 1 MET when RMR is unknown), net = max(0, gross − ownRest),
 * displaced = frac·RMR·duration/1440, incremental = net − displaced (signed; may be negative when the bout replaces costlier
 * activity — never clamped). Non-finite or negative inputs give zero-duration/zero-cost terms, never NaN.
 */
export function boutCost(i: BoutCostInput): BoutCost {
  const dur = fin(i.durationMin) && i.durationMin > 0 ? i.durationMin : 0;
  const gross = fin(i.grossKcal) && i.grossKcal > 0 ? i.grossKcal : 0;
  const rmrKnown = fin(i.rmrKcalPerDay) && i.rmrKcalPerDay > 0;
  const restBasis: RestBasis = rmrKnown ? 'personalRmr' : 'standardMet';
  const restPerMin = rmrKnown ? i.rmrKcalPerDay! / 1440 : standardMetGrossKcal(1, fin(i.bodyMassKg) && i.bodyMassKg > 0 ? i.bodyMassKg : 0, 1);
  const ownRest = restPerMin * dur;
  const net = gross > ownRest ? gross - ownRest : 0;
  const displaced = fin(i.displacedFracOfRmr) && i.displacedFracOfRmr >= 0 ? i.displacedFracOfRmr * restPerMin * dur : null;
  const incremental = displaced === null ? null : net - displaced;
  return {
    grossKcal: gross,
    ownRestKcal: ownRest,
    netAboveRestKcal: net,
    displacedLifestyleKcal: displaced,
    incrementalKcal: incremental,
    ...(fin(i.recoveryKcal) ? { recoveryKcal: i.recoveryKcal } : {}),
    method: i.method,
    ...(i.domain !== undefined ? { domain: i.domain } : {}),
    source: i.source,
    restBasis,
    version: EXERCISE_COST_VERSION,
  };
}

/** Sum of several bouts' labelled terms (null stays null when any part is unknown). */
export function sumBoutCosts(parts: readonly ExerciseCostBreakdown[], method: ExerciseCostBreakdown['method'] = 'modelled', source: QuantityProvenance = 'derived'): ExerciseCostBreakdown {
  let gross = 0;
  let rest = 0;
  let net = 0;
  let disp: number | null = 0;
  let inc: number | null = 0;
  let rec: number | undefined;
  for (const p of parts) {
    gross += p.grossKcal;
    rest += p.ownRestKcal;
    net += p.netAboveRestKcal;
    disp = disp === null || p.displacedLifestyleKcal === null ? null : disp + p.displacedLifestyleKcal;
    inc = inc === null || p.incrementalKcal === null ? null : inc + p.incrementalKcal;
    if (p.recoveryKcal !== undefined) rec = (rec ?? 0) + p.recoveryKcal;
  }
  const one = parts.length === 1 ? parts[0]! : null;
  return {
    grossKcal: gross,
    ownRestKcal: rest,
    netAboveRestKcal: net,
    displacedLifestyleKcal: disp,
    incrementalKcal: inc,
    ...(rec !== undefined ? { recoveryKcal: rec } : {}),
    method: one ? one.method : method,
    ...(one?.domain !== undefined ? { domain: one.domain } : {}),
    source: one ? one.source : source,
  };
}

// ================================================================== steps (D3-07)

/** Named assumption when a step count's overlap with sessions is unknown (a scenario: nothing is subtracted). */
export const STEPS_OVERLAP_UNKNOWN = 'stepsOverlapUnknown' as const;

/**
 * Steps that belong to the step-energy ledger for a day: a total-day count minus the locomotor steps of sessions whose
 * energy is booked as sessions; an excludes-training count as it is; unknown scope (legacy) as it is, flagged by
 * `stepsOverlapStatus`. The reported total is never changed — this is only the ledger's share. Never negative.
 */
export function stepLedgerSteps(steps: number, scope: StepsScope | undefined, includedSteps: number | undefined): number {
  const s = fin(steps) && steps > 0 ? steps : 0;
  if (scope !== 'totalDay') return s;
  const inc = fin(includedSteps) && includedSteps > 0 ? includedSteps : 0;
  return s > inc ? s - inc : 0;
}

/** Whether a day's step/session overlap is resolved: 'none' (no sessions with steps / excludes-training), 'known', 'unknown'. */
export function stepsOverlapStatus(scope: StepsScope | undefined, includedSteps: number | undefined, hasLocomotorSessions: boolean): 'none' | 'known' | 'unknown' {
  if (scope === 'excludesTraining') return 'none';
  if (scope === 'totalDay') return fin(includedSteps) || !hasLocomotorSessions ? (fin(includedSteps) && includedSteps > 0 ? 'known' : 'none') : 'unknown';
  return hasLocomotorSessions ? 'unknown' : 'none';
}

/**
 * Steps above the habitual reference for the step-energy ledger, reconciled on both sides with the same rule:
 * ledger(current) − ledger(habitual). Already-habitual walking that is now logged as a session inside the same total-day
 * count therefore cancels instead of being counted twice.
 */
export function stepsAboveHabitual(
  current: { steps: number; scope?: StepsScope; includedSteps?: number },
  habitual: { steps: number; scope?: StepsScope; includedSteps?: number },
): number {
  return stepLedgerSteps(current.steps, current.scope, current.includedSteps) - stepLedgerSteps(habitual.steps, habitual.scope, habitual.includedSteps);
}

// ================================================================== physical identity of bouts (D3-07)

/** A bout described by several surfaces (a planned session, a commute, a recreation entry, a log). */
export interface BoutIdentity {
  /** Stable identity of the physical bout (session id, log entry id, recreation label key), when known. */
  id?: string;
  /** Start and end, minutes from the day's start (or any common clock), when known. */
  startMin?: number;
  endMin?: number;
  durationMin: number;
  source: 'session' | 'commute' | 'recreation' | 'log';
}

/**
 * Physical minutes of a set of bout descriptions, counting the same physical bout once: entries sharing an `id` are one
 * bout (the longest description wins), and timed entries are merged by interval overlap. Untimed entries without an id
 * cannot be matched and are summed (their possible overlap is an explicit scenario the caller labels).
 */
export function reconcileBoutMinutes(bouts: readonly BoutIdentity[]): { physicalMin: number; duplicateMin: number; unmatchedMin: number } {
  const byId = new Map<string, BoutIdentity>();
  const rest: BoutIdentity[] = [];
  let total = 0;
  for (const b of bouts) {
    const d = fin(b.durationMin) && b.durationMin > 0 ? b.durationMin : 0;
    total += d;
    if (b.id !== undefined) {
      const prev = byId.get(b.id);
      if (!prev || d > prev.durationMin) byId.set(b.id, { ...b, durationMin: d });
    } else rest.push({ ...b, durationMin: d });
  }
  const timed: Array<[number, number]> = [];
  let untimed = 0;
  for (const b of [...byId.values(), ...rest]) {
    if (fin(b.startMin) && fin(b.endMin) && b.endMin > b.startMin) timed.push([b.startMin, b.endMin]);
    else if (fin(b.startMin)) timed.push([b.startMin, b.startMin + b.durationMin]);
    else untimed += b.durationMin;
  }
  timed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let merged = 0;
  let cs = Number.NaN;
  let ce = Number.NaN;
  for (const [s, e] of timed) {
    if (!(e > s)) continue;
    if (Number.isNaN(cs) || s > ce) {
      if (!Number.isNaN(cs)) merged += ce - cs;
      cs = s;
      ce = e;
    } else if (e > ce) ce = e;
  }
  if (!Number.isNaN(cs)) merged += ce - cs;
  const physical = merged + untimed;
  return { physicalMin: physical, duplicateMin: Math.max(0, total - physical), unmatchedMin: untimed };
}
