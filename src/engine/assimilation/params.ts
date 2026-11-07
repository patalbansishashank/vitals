/**
 * Assimilation constants (docs/SUITE_SPEC.md §3.5, plan/01-after-launch/research/R11-living-plan.md §3), declared as
 * `ParamDef`s with grades like every engine constant (MODEL_SPEC §0.4). They are NOT part of the physiology registry
 * (`buildModelParams(MODULES)` never sees them, so they are never drawn in ensembles and do not move the registry hash);
 * the living plan reads them through `assimilationParams()` and may override them per person.
 *
 * Status (C4, D5-03, D5-04, D5-07; review 2026-10-18): every value here is a provisional engineering default (filter noise,
 * gates, the fixed prior, composition reading SDs) or a controller policy bound (correction limits), never validated
 * physiology. Held-out coverage has not been measured, so nothing derived from them is presented as an 80/95 % interval.
 * The trend-filter defaults and correction bounds are the C4 contract values (`TREND_FILTER_DEFAULTS`,
 * `BALANCE_CORRECTION_BOUNDS`), read from there so there is one source. Because the engine registry hash cannot see these
 * values, `estimatorIdentity` hashes them with the estimator contract version (C7): a parameter change invalidates the
 * filter, the evidence a decision consumed and snapshot reuse.
 */
import { contentHash, CONTRACT_VERSIONS } from '@/lib/bodyContracts';
import { BALANCE_CORRECTION_BOUNDS, TREND_FILTER_DEFAULTS } from '@/lib/measurementOperators';
import type { ParamDef, ParamDistributionMeta } from '../types/params';
import { CORRECTION_LAW_VERSION, CORRECTION_MECHANISM } from './runHooks';

const R11 = 'R11 living plan';
const PROPOSED = 'R11 [PROPOSED] engineering choice, grade D, to be tuned on logged data';

/** Fixed (never drawn) engineering default: a design point, not a measured distribution. */
const ENGINEERING: ParamDistributionMeta = { uncertaintyKind: 'heuristic', bounds: 'support', nominal: 'designPoint', basis: 'engineering prior (provisional, held-out coverage not validated)', version: 1, label: 'engineeringDefault' };
/** Controller bound (D5-03): a policy choice, not a biological limit. */
const POLICY: ParamDistributionMeta = { uncertaintyKind: 'heuristic', bounds: 'support', nominal: 'designPoint', basis: 'controller policy bound (provisional until evaluated)', version: 1, label: 'policy' };

function p(name: string, value: number, low: number, high: number, unit: string, grade: ParamDef['grade'], source: string, dossier: string, status: ParamDef['status'], label: string, note?: string, distribution: ParamDistributionMeta = ENGINEERING): ParamDef {
  return { id: `assimilation.${name}`, value, low, high, unit, grade, source, dossier, status, label, draw: 'fixed', distribution, ...(note ? { note } : {}) };
}

const T = TREND_FILTER_DEFAULTS;
const B = BALANCE_CORRECTION_BOUNDS;

export const ASSIMILATION_PARAMS: readonly ParamDef[] = [
  // ---- trend filter (local-linear-trend Kalman, R11 §3.2; SUITE_SPEC §3.5 step 2; C4 provisional defaults)
  p('sigmaRel', T.relObsSdStandardized, 0.004, 0.008, '1 (fraction of body mass)', 'D', 'Within-person 1-day SD 0.53 % of body mass, standardised morning weighing (PMC10653631; one man, 9,521 days)', `${R11} §3.1-3.2`, 'proposed-fit',
    'Weigh-in noise, standardised protocol (provisional default, SD as a share of body mass)',
    'n = 1 day-to-day difference variability, not a validated observation SD after model-water removal; used only when the protocol is known to be standardised (C4/D5-04)'),
  p('sigmaRelUnstd', T.relObsSdUnstandardized, 0.006, 0.007, '1 (fraction of body mass)', 'D', PROPOSED, `${R11} §3.1`, 'proposed-fit', 'Weigh-in noise, unstandardised or unknown protocol (provisional default)',
    'an unknown weighing context uses this value, never the standardised one (C4)'),
  p('qW', T.qWKgPerDay, 0.02, 0.05, 'kg (SD of the daily weight-state increment) at 75 kg', 'D', PROPOSED, `${R11} §3.2 table`, 'proposed-fit', 'Trend process noise: SD of the daily weight-state increment',
    'discrete daily-noise SD (not a variance, not a tissue flux); scaled linearly with body mass'),
  p('qR', T.qRKgPerDayPerDay, 0.003, 0.01, 'kg/d (SD of the daily rate-state increment) at 75 kg', 'D', PROPOSED, `${R11} §3.2 table`, 'proposed-fit', 'Trend process noise: SD of the daily rate-state increment',
    'discrete daily-noise SD (not a variance, not a physiological rate); scaled linearly with body mass'),
  p('refMassKg', T.referenceMassKg, 75, 75, 'kg', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Body mass the q_w and q_r defaults refer to'),
  p('rateInitSdKgD', 0.05, 0.02, 0.1, 'kg/d', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Prior SD of the trend rate when the filter starts (0.35 kg/week)'),
  p('outlierSigma', 3.5, 3, 4, 'SD of the innovation', 'D', PROPOSED, `${R11} §3.2 robustness`, 'proposed-fit', 'Innovation size that marks a weigh-in as unusual'),
  p('outlierRMult', 10, 10, 10, '1', 'D', PROPOSED, `${R11} §3.2 robustness`, 'proposed-fit', 'Noise multiplier for an unusual weigh-in (flagged, never deleted)'),
  p('eventRMult', 4, 4, 4, '1', 'D', PROPOSED, `${R11} §3.1 events`, 'proposed-fit', 'Noise multiplier after a declared event (illness, travel, creatine start, diet break, new block)'),
  p('eventDays', 4, 3, 5, 'd', 'D', PROPOSED, `${R11} §3.1 events`, 'proposed-fit', 'Days the event multiplier lasts'),
  p('gapResetDays', 14, 14, 14, 'd', 'D', PROPOSED, `${R11} §3.3 item 3`, 'proposed-fit', 'Days without a weigh-in that reset the trend uncertainty'),
  p('gapResetSdKg', 1, 1, 1, 'kg', 'D', PROPOSED, `${R11} §3.3 item 3`, 'proposed-fit', 'Trend SD after a long gap'),
  p('dowMinDays', 42, 42, 42, 'd', 'D', PROPOSED, `${R11} §3.1 weekly cycle`, 'proposed-fit', 'Days of data before a day-of-week offset is estimated'),
  p('dowShrink', 7, 3, 14, 'weigh-ins', 'D', PROPOSED, `${R11} §3.1 weekly cycle`, 'proposed-fit', 'Shrinkage pseudo-count of each day-of-week offset toward 0'),
  p('ewmaAlpha', 0.1, 0.1, 0.2, '1', 'D', "Hacker's Diet 10 % rule (Walker); MacroFactor documents a recency-weighted average", `${R11} §3.2 display`, 'verified', 'Display trend smoothing (EWMA α)', 'lag (1 − α)/α = 9 d; display only, never used for estimation'),
  // ---- check-in gates (R11 §3.3; SUITE_SPEC §3.5)
  p('checkInMin7', 4, 4, 4, 'weigh-ins', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Weigh-ins in 7 days needed for a check-in (alternative: 10 in 14)'),
  p('checkInMin14', 10, 10, 10, 'weigh-ins', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Weigh-ins in 14 days that also allow a check-in'),
  // ---- balance correction δ (R11 §3.3; SUITE_SPEC §3.5 step 4; D5-03/D5-04)
  p('biasPriorSdKcal', 150, 100, 200, 'kcal/d', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Fixed prior SD of the balance correction (each decision refits its window from this prior)',
    'the prior is N(0, SD²) at every decision; an earlier posterior is never fed back as an independent prior (D5-04)'),
  p('biasClampKcal', B.maxAbsKcalPerDay, 300, 300, 'kcal/d', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Largest balance correction (controller bound, not a biological limit)', 'saturation is reported as "Correction at limit"', POLICY),
  p('biasMaxStepKcal', B.maxStepKcalPerDecision, 100, 100, 'kcal/d per weekly decision', 'D', PROPOSED, `${R11} §3.3 item 2`, 'proposed-fit', 'Largest change of the correction per weekly decision (controller bound)', 'a retry or a second decision within the period never earns another step', POLICY),
  p('biasAiSdBumpKcal', 0, 0, 0, 'kcal/d', 'D', 'Retired by the 2026-10-18 review (D5-04)', `${R11} §6.3 item 8`, 'proposed-fit', 'Retired: AI-estimated energy never widens the prior',
    'was +50 kcal/d above 70 % AI share; a wider prior raises the weight of the same residual (K = P/(P + R)), so the rule is removed; kept at 0 for old links'),
  p('biasAiShare', 0.7, 0.7, 0.7, '1', 'D', 'Retired by the 2026-10-18 review (D5-04)', `${R11} §6.3 item 8`, 'proposed-fit', 'Retired: unused AI-share threshold', 'no estimator reads it'),
  p('biasWindowDays', 20, 14, 28, 'd', 'D', 'MacroFactor expenditure v3 (≈ 20-day window; pauses with > 3 of 7 days unlogged)', `${R11} §3.2 rate detectability`, 'proposed-fit', 'Window of the balance-correction refit'),
  p('biasMinWeighIns', 10, 10, 10, 'weigh-ins', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Weigh-ins in the window needed to update the correction'),
  p('biasMinIntakeDays', 4, 4, 4, 'logged days per week', 'D', PROPOSED, `${R11} §3.2`, 'proposed-fit', 'Calibration-eligible intake days in each of the last two weeks needed to update the correction'),
  // ---- composition observations at their own time (R11 §3.3 items 4-5; D5-07)
  p('girthSdCm', 0.8, 0.7, 1.0, 'cm', 'C', 'Self-measured circumferences: ICC ≥ 0.87, TEM ≈ 0.2-1.9 cm (Springer 2016, BMC Med Res Methodol)', `${R11} §3.3 item 4`, 'verified', 'Noise of a weekly mean waist measurement',
    'waist updates tissue only through an explicitly supplied personal operator; otherwise it is corroborative (D5-07)'),
  p('girthMinWeeks', 3, 3, 4, 'weeks', 'D', PROPOSED, `${R11} §3.3 item 4`, 'proposed-fit', 'Weekly waist means needed before a personal waist operator is used'),
  p('biaSdPct', 2.5, 2, 4, 'percentage points', 'D', 'Consumer bioimpedance vs DXA; hydration moves it more than the weekly change', `${R11} §3.3 item 5`, 'unverified', 'Consumer body-fat reading SD (provisional design input)',
    'without device-specific values it is applied to both the repeatability (per reading) and the stable device-bias component (shared by a device group, prior variance never collapsing; A1-038); no bias drift is modelled (D5-07)'),
  p('biaMaxGain', 0.3, 0.2, 0.5, '1', 'D', PROPOSED, `${R11} §3.3 item 5`, 'proposed-fit', 'Largest share of the gap a consumer body-fat reading may move the split ("never overrides")'),
  p('dxaSdPct', 1.25, 1, 1.5, 'percentage points', 'C', 'DXA body-fat precision (dossier 14)', `${R11} §3.3 item 5`, 'proposed-fit', 'DXA body-fat reading SD (provisional design input)',
    'not a universal validated precision; without scan-specific values it is applied to both repeatability and device bias (D5-07)'),
  p('modelBfSdPct', 2, 1.5, 3, 'percentage points', 'D', PROPOSED, `${R11} §3.3`, 'proposed-fit', "SD of the engine's own body-fat estimate at a check-in (provisional design input)",
    'fixed prior of the path fat error at every decision (restored before each decision, covariance with device biases kept; A1-038)'),
];

export interface AssimilationParams {
  sigmaRel: number;
  sigmaRelUnstd: number;
  qW: number;
  qR: number;
  refMassKg: number;
  rateInitSdKgD: number;
  outlierSigma: number;
  outlierRMult: number;
  eventRMult: number;
  eventDays: number;
  gapResetDays: number;
  gapResetSdKg: number;
  dowMinDays: number;
  dowShrink: number;
  ewmaAlpha: number;
  checkInMin7: number;
  checkInMin14: number;
  biasPriorSdKcal: number;
  biasClampKcal: number;
  biasMaxStepKcal: number;
  /** Retired (D5-04): always 0, never read by an estimator. */
  biasAiSdBumpKcal: number;
  /** Retired (D5-04): never read by an estimator. */
  biasAiShare: number;
  biasWindowDays: number;
  biasMinWeighIns: number;
  biasMinIntakeDays: number;
  girthSdCm: number;
  girthMinWeeks: number;
  biaSdPct: number;
  biaMaxGain: number;
  dxaSdPct: number;
  modelBfSdPct: number;
}

/** Nominal values keyed by short name, with optional per-person overrides (validated to stay inside [low, high]). */
export function assimilationParams(overrides: Partial<AssimilationParams> = {}): AssimilationParams {
  const out: Record<string, number> = {};
  for (const d of ASSIMILATION_PARAMS) {
    const name = d.id.slice('assimilation.'.length);
    const o = (overrides as Record<string, number | undefined>)[name];
    out[name] = o !== undefined && Number.isFinite(o) ? Math.min(d.high, Math.max(d.low, o)) : d.value;
  }
  return out as unknown as AssimilationParams;
}

export const ASSIMILATION_DEFAULTS: AssimilationParams = assimilationParams();

/**
 * Period of the weekly step bound (D5-03), days: the step of a decision is measured from the correction in force this
 * many days before it, so a retry or a second decision inside the week never earns another step. A restatement of
 * "per weekly decision", not a separate constant to tune.
 */
export const CORRECTION_STEP_PERIOD_DAYS = 7;

// ------------------------------------------------------------------------------------------- estimator identity (C7)

/** Estimator strategy of the weekly decision (D5-04): each eligible decision refits its window from a fixed prior. */
export const ESTIMATOR_STRATEGY = 'fixedPriorRefit' as const;
/** Estimator semantics version = the C4 estimator contract version (legacy, pre-contract records read as 0). */
export const ESTIMATOR_VERSION: number = CONTRACT_VERSIONS.estimator;

/**
 * Composition evidence semantics (D5-07; re-audit 2026-10-19): readings compared at their own time (A1-018), one effective
 * observation per raw-scan lineage (A1-019) and one joint own-time state + shared device-bias likelihood whose
 * innovations are consumed once (A1-038), replacing the lifetime precision subtraction of version 1. Part of every
 * decision's parameter hash, so an anchor derived under version 1 is never reused as current inference.
 */
export const COMPOSITION_ESTIMATOR = { strategy: 'jointStateDeviceBias', version: 2 } as const;

/** What a decision was computed under; matches `ConfirmedStateRecord.estimator`. */
export interface EstimatorIdentity {
  strategy: typeof ESTIMATOR_STRATEGY;
  version: number;
  /** Hash of the resolved assimilation parameters, the estimator/operator versions and the correction law. */
  paramsHash: string;
  windowDays: number;
}

const hashCache = new WeakMap<AssimilationParams, string>();

/** Content hash of the resolved parameter values plus every version their meaning depends on (C7). */
export function assimilationParamsHash(prm: AssimilationParams = ASSIMILATION_DEFAULTS): string {
  const hit = hashCache.get(prm);
  if (hit) return hit;
  const h = contentHash({
    params: prm,
    estimator: ESTIMATOR_VERSION,
    measurementOperator: CONTRACT_VERSIONS.measurementOperator,
    composition: COMPOSITION_ESTIMATOR,
    correction: { mechanism: CORRECTION_MECHANISM, law: CORRECTION_LAW_VERSION },
  });
  hashCache.set(prm, h);
  return h;
}

export function estimatorIdentity(prm: AssimilationParams = ASSIMILATION_DEFAULTS): EstimatorIdentity {
  return { strategy: ESTIMATOR_STRATEGY, version: ESTIMATOR_VERSION, paramsHash: assimilationParamsHash(prm), windowDays: prm.biasWindowDays };
}
