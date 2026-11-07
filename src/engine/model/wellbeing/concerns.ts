/**
 * Wellbeing concern flags (D8-04, D8-09; C6). The model contributes transparent, named flags from its own inputs (low EA
 * exposure against the policy references, rapid loss, keto-adaptation symptoms, sleep debt, very low body fat, an impaired
 * habitual baseline); the person contributes observed fatigue, restfulness, mood, function and named concerns. Observed
 * concerns are never erased by a reassuring model tier, unlogged ratings are never treated as measured, and nothing here
 * is a diagnosis, a probability or a safety clearance.
 *
 * The 45 / 30 / 15 kcal/kg FFM/d EA values are historical context / operational policy references (Loucks; IOC REDs
 * statements), not universal physiological breakpoints and not diagnostic of REDs.
 */

/** Model concern flag bits (state `concernFlags`). */
export const CONCERN_FLAG = {
  /** 14-d internal EA drive below the T1 policy reference (30). */
  eaBelowT1: 1,
  /** 14-d internal EA drive below the T2 policy reference (15). */
  eaBelowT2: 2,
  /** 14-d loss rate at or above the amber rubric rate. */
  rapidLoss: 4,
  /** 14-d loss rate above the red rubric rate. */
  veryRapidLoss: 8,
  /** Keto-induction symptom load at or above the rubric threshold. */
  ketoSymptoms: 16,
  /** Slow sleep debt above the rubric hours. */
  sleepDebt: 32,
  /** Body fat below the very-lean rubric value. */
  veryLean: 64,
  /** The habitual (burn-in) EA is below the T1 policy reference: "baseline" does not mean adequate. */
  impairedBaseline: 128,
  /** Today's EA exposure is not fully covered by logs (partial or unknown intake/exercise). */
  exposureIncomplete: 256,
} as const;
export type ConcernFlagName = keyof typeof CONCERN_FLAG;

/** Names of the set flags (allocation: one array; for adapters and info sheets, not the hot path). */
export function concernFlagNames(bits: number): ConcernFlagName[] {
  const out: ConcernFlagName[] = [];
  for (const [name, bit] of Object.entries(CONCERN_FLAG) as Array<[ConcernFlagName, number]>) if ((bits & bit) !== 0) out.push(name);
  return out;
}

/** EA policy references (kcal/kg FFM/d): operational policy and historical context only (D8-04). */
export const EA_POLICY_REFERENCES = {
  unit: 'kcal/kg FFM/d',
  values: { t0: 45, t1: 30, t2: 15 },
  kind: 'policyReference',
  diagnostic: false,
  basis: 'Loucks 2003 and later short controlled studies in mostly young women; IOC REDs 2023 notes individual variability',
} as const;

/** Observed concern categories (mirrors the living log's `WellbeingConcern`; engine-local to keep layers apart). */
export type ObservedConcernKind = 'persistentFatigue' | 'performanceDecline' | 'injury' | 'menstrualChange' | 'poorRecovery' | 'dizziness' | 'other';

/** One day's observed wellbeing record as entered (fields absent = not logged, never zero). */
export interface ObservedWellbeingDay {
  /** Local date `YYYY-MM-DD` of the observation. */
  date: string;
  /** Named concerns the person flagged that day. */
  concerns?: readonly ObservedConcernKind[];
  /**
   * Ratings on the person's own saved scale with direction, so no fixed cut-off is imposed: `adverse` is the person's own
   * anchor ("Poor", "Very tired") as stored with the scale, not a threshold applied here.
   */
  ratings?: ReadonlyArray<{ scale: 'fatigue' | 'restfulness' | 'mood' | 'energy' | 'function'; value: number; adverse?: boolean }>;
}

export interface WellbeingConcernInput {
  /** Model tier 0 / 1 / 2 and flag bits from the run (absent = no model output for the period). */
  modelTier?: number;
  modelFlags?: number;
  /** Observed days of the period (absent/empty = nothing logged). */
  observed?: readonly ObservedWellbeingDay[];
}

export interface WellbeingConcernResult {
  /** Inline status: `review` (any concern) or `noFlaggedConcern` (never "healthy" or "safe"). */
  status: 'review' | 'noFlaggedConcern';
  /** Whether observations exist for the period: unlogged wellbeing is not measured. */
  observed: 'logged' | 'notLogged';
  /** Observed concern kinds seen, and those repeated on ≥ 2 distinct days (persistent). */
  observedConcerns: ObservedConcernKind[];
  persistentConcerns: ObservedConcernKind[];
  /** Rating scales with an adverse anchor on ≥ 2 distinct days. */
  repeatedAdverseRatings: Array<'fatigue' | 'restfulness' | 'mood' | 'energy' | 'function'>;
  /** Model flags behind a model concern. */
  modelFlags: ConcernFlagName[];
  /** Short machine reasons for the info sheet. */
  reasons: string[];
}

/**
 * Combine model flags with observed wellbeing (D8-04/D8-09). Any observed named concern or a repeated adverse rating gives
 * `review` whatever the model tier; a model tier ≥ 1 or any model concern flag gives `review` (so "No flagged concern"
 * never sits beside a set flag; `exposureIncomplete` is a data-coverage note, not a concern); otherwise
 * `noFlaggedConcern`. A single observed concern is shown (and reviewed) too; "persistent" marks repetition on two or more
 * distinct days. Pure.
 */
export function combineWellbeingConcern(input: WellbeingConcernInput): WellbeingConcernResult {
  const days = input.observed ?? [];
  const concernDays = new Map<ObservedConcernKind, Set<string>>();
  const adverseDays = new Map<'fatigue' | 'restfulness' | 'mood' | 'energy' | 'function', Set<string>>();
  let logged = false;
  for (const d of days) {
    if ((d.concerns?.length ?? 0) > 0 || (d.ratings?.length ?? 0) > 0) logged = true;
    for (const c of d.concerns ?? []) {
      const set = concernDays.get(c) ?? new Set<string>();
      set.add(d.date);
      concernDays.set(c, set);
    }
    for (const r of d.ratings ?? []) {
      if (r.adverse !== true) continue;
      const set = adverseDays.get(r.scale) ?? new Set<string>();
      set.add(d.date);
      adverseDays.set(r.scale, set);
    }
  }
  const observedConcerns = [...concernDays.keys()].sort();
  const persistentConcerns = observedConcerns.filter((c) => concernDays.get(c)!.size >= 2);
  const repeatedAdverseRatings = [...adverseDays.entries()].filter(([, s]) => s.size >= 2).map(([k]) => k).sort();
  const modelFlags = concernFlagNames(input.modelFlags ?? 0);
  const reasons: string[] = [];
  if (observedConcerns.length > 0) reasons.push(persistentConcerns.length > 0 ? 'persistentObservedConcern' : 'observedConcern');
  if (repeatedAdverseRatings.length > 0) reasons.push('repeatedAdverseRating');
  if ((input.modelTier ?? 0) >= 1) reasons.push('modelConcernTier');
  else if (((input.modelFlags ?? 0) & ~CONCERN_FLAG.exposureIncomplete) !== 0) reasons.push('modelConcernFlag');
  return {
    status: reasons.length > 0 ? 'review' : 'noFlaggedConcern',
    observed: logged ? 'logged' : 'notLogged',
    observedConcerns,
    persistentConcerns,
    repeatedAdverseRatings,
    modelFlags,
    reasons,
  };
}
