/**
 * MODULE composition — fat mass and lean tissue (energy partition), protein-deposition plan, regional fat/muscle,
 * VAT and waist (via src/engine/body), post-diet overshoot memory, nitrogen balance.
 * Spec: docs/MODEL_SPEC.md §1.8 (+ docs/MODEL_SPEC_REVIEW.md B2, B3c, M1, M2, M7, M9, M10, M20, m6 and the orchestrator
 * rulings in docs/MODEL_SPEC_DECISIONS.md) · Dossiers: 01 §4.2-4.7 (accounting, Hall convention); 03 §4.4, §4.13, §4.14,
 * §4.19 (non-RT partition in deficit, very-low-intake branch, age drift, SM split); 11 §4.7, §4.12, §4.15 (surplus
 * partition, overshoot); 20 §4.4/§4B.1 (fasting protein loss, via the fasting module); 09 §4.8-4.10 (RT accretion/retention,
 * via the muscle module — R-RT: no RT term lives here); 14 M6-M8 (regional allocation, VAT, circumferences — body
 * library); 16 §4.0.1 (sleep partition shift, via moderators).
 * Owned files: src/engine/model/composition/** only.
 *
 * Energy bookkeeping (§0.2, review B2): stored energy S_h = E_abs − TEE_pre − DNL heat − ketone loss − ρG·ΔG; every
 * change of fat / lean tissue is booked at the effective densities ρ + η for either sign, so each hour
 * `S_h = (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT` exactly and `depositionCostKcalH = ηF·ΔFM + ηL·ΔLT` is signed.
 *
 * Branch per hour (review M7 ruling): an hour with `fastActive = 1` uses the fasting branch (the fasting module's protein
 * flux is the lean change, fat takes the residual); every other hour uses the day's plan — the fraction branch with the
 * day's p_E (deficit 03 / surplus 11) or the explicit 03 §4.13 very-low-intake lean rate.
 *
 * Decisions on points the spec leaves open (documented in the WP report):
 *  - Deficit size d for 03's pCat is today's planned deficit clamp(−u, 0, 1); the deficit/surplus switch uses EB7 (spec).
 *  - Slow states (FM, LT, SM, regional depots, overshoot memory, counters) are re-anchored to the body estimate at the
 *    end of burn-in (review B3c ruling; 01 §4.11 "slow states F, P fixed from user inputs").
 *  - `leanRateKgD` (written at endOfDay for tomorrow, spec step 7) = today's realised non-fasting lean change.
 *  - VAT (D1-02): one transition for every output mask, VAT·(FM_end/FM_start)^k bounded to [0, FM] (`vatTransition`; loss
 *    k = 1.3 empirical population prior, gain k a labelled symmetric hypothesis). When a regional series is recorded,
 *    `allocateRegional` receives that VAT explicitly and spreads the rest of the fat over the other depots; geometry
 *    (depots, waist) is rendering only and never changes the modelled VAT that cardiometabolic reads.
 *  - Unsupported partition domains (D1-05, D1-08, C6), status only: a day whose non-fasting partition books a positive
 *    lean response through the surplus share (any nonzero blend weight 1 − w, inside the ±W maintenance blend and while
 *    the trailing boxcar is still filling — A1-039) with known protein below the m_P knee or with protein only a lower
 *    bound, and the very-low-intake branch, are recorded as first days; `compositionOutputStatuses` turns them into series
 *    statuses (the lean partition and the module's own outputs computed from it — skeletal muscle, nitrogen, regional
 *    muscle, residual fat with its regional/visceral/waist geometry; scale/marker outputs through the output
 *    dependencies). Exact maintenance with no positive lean claim records nothing. No new lean rate or coefficient.
 *  - Tissue floors (D1-08): reaching the numerical lean floor is a model limit, solved as a conservative boundary event
 *    (lean stops at the floor, the unmet lean energy moves to fat, so every accepted hour still closes the ledger) and
 *    recorded with its hour (`compositionModelLimit`); post-boundary values are not forecasts. A fat mass that would go
 *    negative as well cannot be conserved: that hour is the termination point (valid through the hour before).
 *  - Nitrogen (D2-05): `nitrogenBalance` is the body-N change implied by the modelled lean-tissue change
 *    (ΔLT·f_prot/6.25, approximate conversion), not urinary nitrogen and not skeletal-muscle protein; `fastProteinCost` is
 *    model lean tissue (protein plus its bound water) lost inside fasts net of repletion (`COMPOSITION_NITROGEN_LEDGER`).
 *
 * Causal resolution (C2/D2-01, HA-01): the per-hour branch follows only the fasting module's history-driven `fastActive`
 * flag and its fluxes; no planned fast length, label or span is read (`planMetadataReads` is empty). The day plan
 * (regime, p_E, explicit lean terms, EB7) reads whole-day intake totals before the day's hours run, an empirical daily
 * model kept as it was fitted (no elapsed-total substitution without refitting), so every output is daily-native on an
 * observed day (`COMPOSITION_CAUSAL_RESOLUTION`).
 *
 * Tissue-mass binding (D4-05, C4/C6): tissue mass = FM + FFM_act with FFM_act = FFM0 + (LT − LT0) = LT + referenceFfm,
 * referenceFfm = FFM0 − LT0 (baseline glycogen and its water, constant within a run); the tissue fat fraction is
 * 100·FM/(FM + FFM_act), never FM/(FM + leanTissue). FM and LT are read at one instant (end of a committed day, or the run's
 * first frame), the same way in a fresh run, a replay and a day-stamped continuation (`COMPOSITION_TISSUE_BINDING`,
 * `compositionTissueTrace`). Read-only helpers: nothing here changes physiology.
 */
import { defineModule } from '../../core/moduleKit';
import { clamp, wakeRecordHour } from '../../core/math';
import { allocateRegional, circumferencesFor } from '../../body';
import { VAT_ALLOMETRY, vatTransition } from '../../body/regional';
import type { BodyEstimate, BodyState, RegionalComposition } from '../../body/types';
import { dependentStatusOf, worstStatus, type CausalResolution, type HistoryAssumptionKind, type OutputStatus, type UncertaintyKind } from '@/lib/bodyContracts';
import type { OperatorId } from '@/lib/measurementOperators';
import { G_PROTEIN_PER_G_N } from '../../core/defaults';
import { proteinIsLowerBound } from '../energy';
import { MI, type SeriesId } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import type { ModuleId, SignalBus, SignalName } from '../../types/signals';
import type { DayInput } from '../../types/inputs';
import type { ResolvedProfile } from '../../types/profile';
import type { EngineSnapshot, SafetyTraceKey, SeriesStatusMeta } from '../../types/result';
import { COMPOSITION_PARAMS } from './params';
import {
  type CompositionConstants,
  ageLeanDriftGD,
  deficitEnergyShare,
  fatFloorWeight,
  jacquetPmSS,
  leannessIndex,
  mFatType,
  overshootLeanRatio,
  pCatDeficit,
  poxDecayFactor,
  poxLeanRateKgD,
  poxRate,
  readConstants,
  SURPLUS_PROTEIN_LOW,
  SURPLUS_PROTEIN_UNKNOWN,
  surplusEnergyShare,
  surplusLeanRatio,
  SURPLUS_PROTEIN_SUPPORTED,
  surplusProteinDomain,
} from './partition';

/** Day plan regime (MODEL_SPEC §1.8 step 2 b-d); the fasting branch (2a) is chosen per hour. */
export const REGIME_SURPLUS = 0;
export const REGIME_DEFICIT = 1;
export const REGIME_VLI = 2;

/**
 * Causal-resolution declaration (C2/D2-01): whole-day DayInput fields `planDay` reads at startDay, bus values latched there,
 * and the outputs inheriting that daily-native resolution. Consumers combine it with `DayInput.resolution`
 * (`weakestResolution`) for status sidecars, replay and snapshots. Declarative only; nothing here changes physiology.
 */
export const COMPOSITION_CAUSAL_RESOLUTION = {
  module: 'composition',
  nativeResolution: 'daily',
  dailyInputs: ['energyKcal', 'proteinG', 'proteinQDaily', 'carbG', 'fatG', 'pufaG', 'satFatG'],
  dayStartSignals: ['tdeeEstKcalD', 'maintenanceKcalD', 'fastRepletionGH', 'rtAccretionKgD', 'rtDoseFrac', 'rtRetentionFrac', 'rtVolumeWb', 'partitionSleepShift', 'aerobicIdx', 'ageYears'],
  planMetadataReads: [],
  series: [
    'fatMass', 'leanTissue', 'skeletalMuscle', 'waist', 'visceralFat', 'nitrogenBalance', 'fastProteinCost',
    'fatTrunk', 'fatArms', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk',
  ],
  signals: [
    'fatMassKg', 'leanTissueKg', 'ffmActKg', 'tissueMassKg', 'skeletalMuscleKg', 'tissueEnergyKcalH', 'depositionCostKcalH',
    'leanRateKgD', 'energyBalanceFrac', 'energyBalance7KcalD', 'vatKg', 'fatFloorActive',
  ],
  assumption: 'dailyNativeModel',
  reasonCode: 'dailyNativePartitionPlan',
} as const satisfies {
  module: ModuleId;
  nativeResolution: CausalResolution;
  dailyInputs: readonly (keyof DayInput)[];
  dayStartSignals: readonly SignalName[];
  planMetadataReads: readonly (keyof DayInput)[];
  series: readonly SeriesId[];
  signals: readonly SignalName[];
  assumption: HistoryAssumptionKind;
  reasonCode: string;
};

/**
 * D2-05: what this module's nitrogen/protein outputs are (declarative, no new coefficient). Boundary: body excluding the
 * GI lumen; the intake boundary is reported ME, so no second fecal/urinary energy charge; fasting protein flux is booked
 * once as lean tissue at the run's ρL + ηL. The 6.25 g protein/g N conversion and h_P 1.6 g water/g protein are declared
 * approximations (Hall convention), not measurements.
 */
export const COMPOSITION_NITROGEN_LEDGER = {
  version: 1,
  boundary: 'bodyExcludingGutLumen',
  intakeBoundary: 'reportedME',
  nitrogenBalance: {
    estimand: 'modelBodyNitrogenChange',
    unit: 'g N/d',
    equation: 'ΔLT·1000·f_prot/6.25, f_prot = 1/(1 + h_P)',
    notUrinaryNitrogen: true,
    notSkeletalMuscleProtein: true,
  },
  fastProteinCost: {
    estimand: 'modelLeanTissueLostInFasts',
    unit: 'kg',
    includesBoundWater: true,
    netOfLabileRepletion: true,
    notSkeletalMuscle: true,
  },
} as const;

/**
 * D1-08 (C6/C7): versioned validity of this module's tissue forecast, with protocol fidelity, parameter-fit checks and
 * external prediction kept apart. Conservation is necessary, not external validation. The Minnesota comparison is a
 * failed challenge with a mismatched protocol (intake as a percentage of a different baseline; the observed fall in
 * voluntary activity not imposed); it does not classify all severe restriction as disproven and adds no cutoff. Runtime
 * statuses use only existing model rules (`compositionOutputStatuses`).
 */
export const COMPOSITION_VALIDITY = {
  /** 2 = surplus-protein domains flag every positive lean claim of the surplus share (any blend weight, A1-039). */
  version: 2,
  domains: {
    ordinaryEnergyBalance: { protocolFidelity: 'matched', parameterFit: 'checked', externalPrediction: 'notIndependentlyValidated', status: 'estimated' },
    severeRestrictionMinnesota: {
      protocolFidelity: 'mismatched',
      parameterFit: 'notRefitted',
      externalPrediction: 'failedChallenge',
      challenge: '01-7.1-minnesota',
      imputations: ['intake as 43.7 % of engine maintenance (archival absolute 1 585 kcal/d vs baseline 3 630)', 'scheduled steps instead of the observed activity decline'],
      status: 'limited',
    },
    veryLowIntakeBranch: { protocolFidelity: 'notAssessed', parameterFit: 'dossierFit', externalPrediction: 'notEstablished', status: 'limited', reasonCode: 'veryLowIntakeOutsideSupport' },
    lowProteinSurplus: { status: 'scenario', reasonCode: 'lowProteinSurplusPartition' },
    unknownProteinSurplus: { status: 'scenario', reasonCode: 'unknownProteinSurplusPartition' },
    tissueFloor: { status: 'modelLimit', reasonCode: 'tissueFloorModelLimit' },
  },
} as const;

/**
 * Floating-point guard for a "positive" day sum of hourly energy residuals, kcal: the module's hourly conservation
 * tolerance (exact maintenance sums to ± round-off). Numerical only, not a physiological or diagnostic threshold.
 */
const ROUNDOFF_KCAL = 1e-6;

/**
 * Lean-partition outputs and the module's own outputs computed directly from the partitioned masses: lean tissue and its
 * skeletal-muscle/nitrogen/regional-muscle details, the residual fat with its regional, visceral and waist geometry
 * (A1-013/A1-039). Scale, body-fat and marker outputs follow through `OUTPUT_DEPENDENCIES`.
 */
export const COMPOSITION_PARTITION_SERIES: readonly SeriesId[] = [
  'leanTissue', 'skeletalMuscle', 'nitrogenBalance', 'muscleArms', 'muscleLegs', 'muscleTrunk',
  'fatMass', 'fatTrunk', 'fatArms', 'fatLegs', 'visceralFat', 'waist',
];
/** Every tissue output of the module (a model limit applies to all of them). */
export const COMPOSITION_TISSUE_SERIES: readonly SeriesId[] = [
  'fatMass', 'leanTissue', 'skeletalMuscle', 'waist', 'visceralFat', 'nitrogenBalance', 'fastProteinCost',
  'fatTrunk', 'fatArms', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk',
];

/** One series-status record for the recorder (`Recorder.setStatus` per series id). */
export interface CompositionStatusRecord extends SeriesStatusMeta {
  series: readonly SeriesId[];
}

/**
 * D1-08: the run's first model-limit hour, if any. `kind` is the worst limit reached since (a later non-conservable hour
 * upgrades it); `validThroughHour` = the last fully conserved hour at the first limit (forecast values after the boundary
 * are not forecasts either way, so a consumer stops there).
 */
export interface CompositionModelLimit {
  hourIndex: number;
  day: number;
  kind: 'conservedBoundary' | 'nonConservable';
  validThroughHour: number;
}

export function compositionModelLimit(s: Pick<CompositionState, 'modelLimitHour' | 'modelLimitKind' | 'modelLimitValidThrough'>): CompositionModelLimit | null {
  if (!(s.modelLimitHour >= 0)) return null;
  return {
    hourIndex: s.modelLimitHour,
    day: Math.floor(s.modelLimitHour / 24),
    kind: s.modelLimitKind >= 2 ? 'nonConservable' : 'conservedBoundary',
    validThroughHour: s.modelLimitValidThrough >= -1 ? s.modelLimitValidThrough : s.modelLimitHour - 1,
  };
}

/**
 * C6 statuses implied by the composition state after a run (D1-05, D1-08): low-protein or unknown-protein surplus partition
 * → lean partition 'scenario'; very-low-intake branch → 'limited'; tissue floor → 'modelLimit' on every tissue output.
 * Each record applies from its first plan day; the caller closes them over the output dependencies. Allocation allowed.
 */
export function compositionOutputStatuses(
  s: Pick<CompositionState, 'lowProteinSurplusFromDay' | 'unknownProteinSurplusFromDay' | 'vliFromDay' | 'modelLimitHour' | 'modelLimitKind' | 'modelLimitValidThrough'>,
): CompositionStatusRecord[] {
  const out: CompositionStatusRecord[] = [];
  const d = COMPOSITION_VALIDITY.domains;
  const scenario: UncertaintyKind = 'scenario';
  if (s.lowProteinSurplusFromDay >= 0) out.push({ series: COMPOSITION_PARTITION_SERIES, status: d.lowProteinSurplus.status, reasonCode: d.lowProteinSurplus.reasonCode, uncertaintyKind: scenario, fromDay: s.lowProteinSurplusFromDay });
  if (s.unknownProteinSurplusFromDay >= 0) out.push({ series: COMPOSITION_PARTITION_SERIES, status: d.unknownProteinSurplus.status, reasonCode: d.unknownProteinSurplus.reasonCode, uncertaintyKind: scenario, fromDay: s.unknownProteinSurplusFromDay });
  if (s.vliFromDay >= 0) {
    const limited: OutputStatus = d.veryLowIntakeBranch.status;
    out.push({ series: COMPOSITION_PARTITION_SERIES, status: limited, reasonCode: d.veryLowIntakeBranch.reasonCode, uncertaintyKind: scenario, fromDay: s.vliFromDay });
  }
  const lim = compositionModelLimit(s);
  if (lim) out.push({ series: COMPOSITION_TISSUE_SERIES, status: d.tissueFloor.status, reasonCode: d.tissueFloor.reasonCode, fromDay: lim.day });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// D4-05 (C4/C6): tissue-mass binding — FM + FFM_act at one sampled time, in fresh, replay and continuation runs
// ---------------------------------------------------------------------------------------------------------------------

/**
 * D4-05 provider contract (declarative): how the engine's tissue mass and tissue fat fraction are read. FFM_act carries the
 * baseline glycogen and its water (referenceFfm = FFM0 − LT0, fixed when the run anchors its slow states; tissue anchors
 * move FM and LT only), so `FM + leanTissue` is not the denominator. Labile water and glycogen departures from the
 * reference never enter. Both masses are sampled at the same instant: the end of each committed day (daily `fatMass` /
 * `leanTissue`, `SafetyTrace.tissueMassKg` / `.bodyFatPct`) and the run's first frame (post-burn-in midnight, or the start
 * of a day-stamped snapshot's day). The wake-hour `bodyFatPct` series (FM / wake scale) is a different operator.
 */
export const COMPOSITION_TISSUE_BINDING = {
  version: 1,
  convention: 'hallTissueMass',
  sampleTime: 'endOfDay',
  firstSample: 'runStartState',
  requiredSeries: ['fatMass', 'leanTissue'],
  tissueMass: { operator: 'modelTissueMass', unit: 'kg', equation: 'FM + FFM_act', busSignal: 'tissueMassKg', traceKey: 'tissueMassKg' },
  ffmAct: { unit: 'kg', equation: 'FFM0 + (LT − LT0) = LT + referenceFfm', busSignal: 'ffmActKg' },
  referenceFfm: {
    unit: 'kg',
    estimand: 'baseline glycogen and its bound water inside FFM0',
    equation: 'FFM0 − LT0, LT0 = max(FFM0/2, FFM0 − (1 + h)·G0/1000)',
    constantWithinRun: true,
  },
  tissueFatFraction: { operator: 'tissueFatFraction', unit: '%', equation: '100·FM/(FM + FFM_act)', traceKey: 'bodyFatPct' },
  excludes: ['labileWater', 'glycogenDepartureFromReference'],
  notDenominator: 'FM + leanTissue',
  distinctOperators: ['scaleBodyFatWake', 'inferredNonFatScaleMass'],
} as const satisfies {
  version: number;
  convention: string;
  sampleTime: 'endOfDay';
  firstSample: 'runStartState';
  requiredSeries: readonly SeriesId[];
  tissueMass: { operator: OperatorId; unit: 'kg'; equation: string; busSignal: SignalName; traceKey: SafetyTraceKey };
  ffmAct: { unit: 'kg'; equation: string; busSignal: SignalName };
  referenceFfm: { unit: 'kg'; estimand: string; equation: string; constantWithinRun: true };
  tissueFatFraction: { operator: OperatorId; unit: '%'; equation: string; traceKey: SafetyTraceKey };
  excludes: readonly string[];
  notDenominator: string;
  distinctOperators: readonly OperatorId[];
};

/** Tissue of one composition state (D4-05): masses in kg, tissue fat fraction in %. */
export interface CompositionTissue {
  fatMassKg: number;
  leanTissueKg: number;
  /** FFM0 + (LT − LT0), kg (bus `ffmActKg`). */
  ffmActKg: number;
  /** FM + FFM_act, kg (bus `tissueMassKg`). */
  tissueMassKg: number;
  /** FFM0 − LT0: baseline glycogen and its water, kg (constant within a run). */
  referenceFfmKg: number;
  /** 100·FM/(FM + FFM_act), %; null when the tissue mass is not positive. */
  tissueFatPct: number | null;
}

/** The state fields the binding reads (present in every stored composition state, legacy snapshots included). */
export type CompositionTissueStateView = Pick<CompositionState, 'fmKg' | 'ltKg' | 'lt0Kg' | 'ffm0Kg'>;

/** FFM_act = FFM0 + (LT − LT0), kg. */
export function ffmActOf(s: CompositionTissueStateView): number {
  return s.ffm0Kg + (s.ltKg - s.lt0Kg);
}

/** Tissue fat fraction 100·FM/(FM + FFM_act), %; null for a non-finite or non-positive tissue mass or a negative FM. */
export function tissueFatFractionPct(fatMassKg: number, ffmActKg: number): number | null {
  const tm = fatMassKg + ffmActKg;
  return Number.isFinite(tm) && tm > 0 && fatMassKg >= 0 ? (100 * fatMassKg) / tm : null;
}

/** Tissue of a composition state; null when a mass is not finite. */
export function compositionTissue(s: CompositionTissueStateView): CompositionTissue | null {
  const ffm = ffmActOf(s);
  const tm = s.fmKg + ffm;
  if (!Number.isFinite(s.fmKg) || !Number.isFinite(s.ltKg) || !Number.isFinite(s.lt0Kg) || !Number.isFinite(s.ffm0Kg) || !Number.isFinite(tm)) return null;
  return { fatMassKg: s.fmKg, leanTissueKg: s.ltKg, ffmActKg: ffm, tissueMassKg: tm, referenceFfmKg: s.ffm0Kg - s.lt0Kg, tissueFatPct: tissueFatFractionPct(s.fmKg, ffm) };
}

/** C7 read adapter: tissue of a stored composition state of unknown shape (e.g. from a snapshot); null when fields are missing. */
export function readCompositionTissue(state: unknown): CompositionTissue | null {
  if (state === null || typeof state !== 'object') return null;
  const o = state as Partial<Record<keyof CompositionTissueStateView, unknown>>;
  if (typeof o.fmKg !== 'number' || typeof o.ltKg !== 'number' || typeof o.lt0Kg !== 'number' || typeof o.ffm0Kg !== 'number') return null;
  return compositionTissue({ fmKg: o.fmKg, ltKg: o.ltKg, lt0Kg: o.lt0Kg, ffm0Kg: o.ffm0Kg });
}

/** Tissue held by an engine snapshot (the state at its day's start for a day-stamped one); null without a composition state. */
export function snapshotCompositionTissue(snap: Pick<EngineSnapshot, 'moduleIds' | 'states'>): CompositionTissue | null {
  const i = snap.moduleIds.indexOf('composition');
  return i >= 0 ? readCompositionTissue(snap.states[i]) : null;
}

/** LT0 = FFM0 − (1 + h)·G0/1000 (G0 = baseline total glycogen, g; h = composition.lt0GlycogenWater), floored at FFM0/2. */
export function initialLeanTissueKg(ffm0Kg: number, glycogenTotalG: number, lt0GlycogenWater: number): number {
  const glyKg = Number.isFinite(glycogenTotalG) && glycogenTotalG > 0 ? (glycogenTotalG * (1 + lt0GlycogenWater)) / 1000 : 0;
  return Math.max(0.5 * ffm0Kg, ffm0Kg - glyKg);
}

/** Registry value of composition.lt0GlycogenWater (fixed, never drawn). */
const LT0_GLYCOGEN_WATER = COMPOSITION_PARAMS.find((p) => p.id === 'composition.lt0GlycogenWater')?.value ?? 3;

/**
 * Tissue of the entered body (FM0, LT0, FFM0 of the profile) under the run's convention. A run's first frame differs from
 * it by the habitual overnight change (morning anchor), so a trajectory takes its first sample from the run
 * (`compositionTissueTrace`); this supplies the run's `referenceFfmKg` for a fresh run or a replay.
 */
export function profileCompositionTissue(rp: Pick<ResolvedProfile, 'fm0Kg' | 'ffm0Kg' | 'body'>, lt0GlycogenWater: number = LT0_GLYCOGEN_WATER): CompositionTissue | null {
  const lt0 = initialLeanTissueKg(rp.ffm0Kg, rp.body.glycogen.totalG, lt0GlycogenWater);
  return compositionTissue({ fmKg: rp.fm0Kg, ltKg: lt0, lt0Kg: lt0, ffm0Kg: rp.ffm0Kg });
}

/**
 * The run's reference FFM (kg): from the restored snapshot when a run continues one (its stored FFM0 and LT0), else from
 * the profile. Null when neither gives a finite value.
 */
export function tissueReferenceFfmKg(
  rp: Pick<ResolvedProfile, 'fm0Kg' | 'ffm0Kg' | 'body'>,
  snapshot?: Pick<EngineSnapshot, 'moduleIds' | 'states'> | null,
  lt0GlycogenWater: number = LT0_GLYCOGEN_WATER,
): number | null {
  const t = (snapshot ? snapshotCompositionTissue(snapshot) : null) ?? profileCompositionTissue(rp, lt0GlycogenWater);
  return t && Number.isFinite(t.referenceFfmKg) && t.referenceFfmKg >= 0 ? t.referenceFfmKg : null;
}

/** Why a tissue trajectory is unavailable (C6: the objective abstains; never 0, never the start value). */
export type CompositionTissueTraceReason = 'missingFatMass' | 'missingLeanTissue' | 'invalidReference' | 'lengthMismatch' | 'nonFiniteTissue' | 'modelLimit';

/** The run fields the trace reads (a `SimulationResult` satisfies it). */
export interface CompositionTissueTraceSource {
  initial: Partial<Record<SeriesId, number>>;
  daily: Partial<Record<SeriesId, ArrayLike<number>>>;
  meta?: { startDay?: number; outputStatus?: Partial<Record<SeriesId, SeriesStatusMeta>> };
}

/**
 * Tissue trajectory of a run (D4-05). Index 0 = the run's first frame (state at the start of `startDay`: post-burn-in
 * midnight for a fresh run or replay, the snapshot's day for a continuation); index j ≥ 1 = end of plan day startDay + j − 1.
 * For startDay = 0 this is the planner's goal-series indexing. Numbers and status travel separately (C6): an unavailable
 * trace carries no arrays, so no NaN or sentinel reaches an objective.
 */
export type CompositionTissueTrace =
  | {
      available: true;
      version: number;
      operator: 'tissueFatFraction';
      startDay: number;
      tissueMassKg: Float64Array;
      tissueFatPct: Float64Array;
      referenceFfmKg: number;
      status: OutputStatus;
      reasonCode: string;
      uncertaintyKind: UncertaintyKind;
      /** First plan day the status applies from (absent = whole run). */
      fromDay?: number;
    }
  | {
      available: false;
      version: number;
      operator: 'tissueFatFraction';
      startDay: number;
      status: 'unavailable' | 'modelLimit';
      reasonCode: CompositionTissueTraceReason;
      /** First trajectory index without a finite tissue value. */
      firstMissingIndex?: number;
    };

/**
 * Tissue mass and tissue fat fraction from the run's daily `fatMass`/`leanTissue` (both recorded at the end of the day)
 * and its first frame, with the run's reference FFM (`tissueReferenceFfmKg`). Status: the lean-partition and fat statuses
 * propagate as for any dependent output (`dependentStatusOf`, C6); a non-finite value anywhere makes the trace unavailable.
 */
export function compositionTissueTrace(sim: CompositionTissueTraceSource, referenceFfmKg: number | null): CompositionTissueTrace {
  const version = COMPOSITION_TISSUE_BINDING.version;
  const operator = 'tissueFatFraction' as const;
  const sd = sim.meta?.startDay;
  const startDay = sd !== undefined && Number.isInteger(sd) && sd > 0 ? sd : 0;
  const metas = [sim.meta?.outputStatus?.fatMass, sim.meta?.outputStatus?.leanTissue].filter((m): m is SeriesStatusMeta => m !== undefined);
  const limited = metas.some((m) => m.status === 'modelLimit');
  const fail = (reasonCode: CompositionTissueTraceReason, firstMissingIndex?: number): CompositionTissueTrace => ({
    available: false,
    version,
    operator,
    startDay,
    status: limited ? 'modelLimit' : 'unavailable',
    reasonCode: limited && reasonCode === 'nonFiniteTissue' ? 'modelLimit' : reasonCode,
    ...(firstMissingIndex !== undefined ? { firstMissingIndex } : {}),
  });
  const fm = sim.daily.fatMass;
  const lt = sim.daily.leanTissue;
  if (!fm) return fail('missingFatMass');
  if (!lt) return fail('missingLeanTissue');
  if (referenceFfmKg === null || !Number.isFinite(referenceFfmKg) || referenceFfmKg < 0) return fail('invalidReference');
  if (fm.length !== lt.length || startDay > fm.length) return fail('lengthMismatch');
  const n = fm.length - startDay + 1;
  const tissueMassKg = new Float64Array(n);
  const tissueFatPct = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const f = j === 0 ? sim.initial.fatMass : fm[startDay + j - 1];
    const l = j === 0 ? sim.initial.leanTissue : lt[startDay + j - 1];
    if (f === undefined || l === undefined) return fail('nonFiniteTissue', j);
    const ffm = l + referenceFfmKg;
    const pct = tissueFatFractionPct(f, ffm);
    if (pct === null || !Number.isFinite(l)) return fail('nonFiniteTissue', j);
    tissueMassKg[j] = f + ffm;
    tissueFatPct[j] = pct;
  }
  // C6 dependency closure: tissue fat fraction depends on fatMass and leanTissue
  let status: OutputStatus = 'estimated';
  let worst: SeriesStatusMeta | null = null;
  let fromDay: number | undefined;
  let wholeRun = false;
  for (const m of metas) {
    const induced = dependentStatusOf(m.status);
    if (induced === null) continue;
    if (m.fromDay === undefined) wholeRun = true;
    else fromDay = fromDay === undefined ? m.fromDay : Math.min(fromDay, m.fromDay);
    const next = worstStatus(status, induced);
    if (next !== status) {
      status = next;
      worst = m;
    }
  }
  const uncertaintyKind: UncertaintyKind = status === 'estimated' ? 'none' : (worst?.uncertaintyKind ?? 'scenario');
  return {
    available: true,
    version,
    operator,
    startDay,
    tissueMassKg,
    tissueFatPct,
    referenceFfmKg,
    status,
    reasonCode: status === 'estimated' || worst === null ? 'ok' : worst.reasonCode,
    uncertaintyKind,
    ...(status !== 'estimated' && !wholeRun && fromDay !== undefined ? { fromDay } : {}),
  };
}

/** Numerical guard (not physiology): lean tissue never falls below this fraction of LT0 (only reachable in absurd runs). */
const LT_FLOOR_FRAC = 0.3;
/** Smallest accumulated weight loss (kg) from which Pm_SS is taken from the simulated loss instead of Jacquet's formula. */
const PMSS_MIN_LOSS_KG = 0.25;

export interface CompositionState {
  /** Fat mass FM, kg. */
  fmKg: number;
  /** Lean tissue LT, kg (Hall convention, ρL 1816 kcal/kg incl. h_P = 1.6 g water/g protein). */
  ltKg: number;
  /** LT at t = 0, kg (= FFM0 − (1 + h)·G0/1000, review m6 ruling). */
  lt0Kg: number;
  /** FM at t = 0, kg. */
  fm0Kg: number;
  /** FFM at t = 0, kg (tissue FFM; FFM_act = FFM0 + ΔLT). */
  ffm0Kg: number;
  /** Non-lean, non-labile part of FFM0 (reference glycogen + its water), FFM0 − LT0, kg. */
  otherFfmKg: number;
  /** Fat floor FM_min = 0.02·BW0, kg (review M9). */
  fmMinKg: number;
  /** Skeletal muscle, kg, and its t = 0 value. */
  smKg: number;
  sm0Kg: number;
  /**
   * EB7 = trailing 7-day mean (boxcar, today's plan included) of the planned balance EI − TEE_est, kcal/d (11 §4.15 EB7).
   * A boxcar over exactly one week is constant for any weekly-periodic schedule, so the partition of a weight-stable
   * habitual week (training and rest days) does not oscillate between the deficit and surplus rules (review m20).
   */
  eb7: number;
  /** Ring of the last `eb7WindowD` daily balances, kcal/d, and the next write index. */
  eb7Ring: Float64Array;
  eb7Idx: number;
  /** Today's energy balance fraction u = (EI − TEE_est)/TEE_est, clamped to [−1, 1]. */
  u: number;
  /** Today's plan regime (REGIME_*), used in every non-fasting hour. */
  regime: number;
  /**
   * Today's energy share of S′ going to lean tissue (fraction regimes), 0..0.9: the deficit (03) and surplus (11) shares
   * blended linearly over |EB7| < partBlendKcalD (review m20).
   */
  pE: number;
  /** Deficit (03) and surplus (11) energy shares of today, before the blend (diagnostics). */
  pDef: number;
  pSur: number;
  /** Today's catabolic lean mass fraction (deficit regime, diagnostics) and surplus lean ratio r_L, kg/kg. */
  pCat: number;
  rL: number;
  /** Explicit lean terms for today: RT accretion (09) + age drift (03 §4.14), kg LT/d; the RT part alone, kg LT/d. */
  leanExtraKgD: number;
  rtAccKgD: number;
  /** Very-low-intake branch lean rate (03 §4.13), kg LT/d (≤ 0 usually; 0 outside the branch), non-fasting hours only. */
  vliLeanKgD: number;
  /** Explicit hourly lean change in non-fasting hours ((leanExtra + VLI)/24) and in fasting hours (leanExtra/24), kg/h. */
  explicitKgH: number;
  explicitFastKgH: number;
  /** Days spent in the very-low-intake branch (t_f) and the Pox transient factor exp(−t_f/τ_N,eff). */
  vliDays: number;
  poxDecay: number;
  /** Regional fat depots and skeletal muscle (body library), kg. */
  regional: RegionalComposition;
  /** Visceral adipose tissue, kg; waist, cm. */
  vatKg: number;
  waistCm: number;
  /** Simulated body state handed to `circumferencesFor` (fields refreshed daily; plain data). */
  body: BodyState;
  /** Overshoot memory (11 §4.12): 1 while a deficit phase is running / while the memory is valid. */
  osInDeficit: number;
  osValid: number;
  /** FM, FFM_act, weight and %fat at the start of the last deficit phase. */
  fmPreKg: number;
  ffmPreKg: number;
  wPreKg: number;
  pctFatPre: number;
  /** Mass fraction of the deficit-phase loss that was FFM (accumulated Pm_SS). */
  pmSS: number;
  /** Day index at which the last deficit phase ended (−1 while none has ended). */
  deficitEndDay: number;
  /** Fractional fat depletion D_F = (FM_pre − FM)/FM_pre now (diagnostics) and its maximum reached in the deficit phase. */
  depletionFrac: number;
  depletionMax: number;
  /** Net protein tissue lost inside fasts (hydrated, kg; minus labile repletion), 20 §6. */
  fastProteinLostKg: number;
  /** Nitrogen balance of the last completed day, g N/d. */
  nBalanceG: number;
  /** Hours today in which the smooth fat floor diverted energy to lean tissue (review M9; 0 normally). */
  fatFloorHours: number;
  /** 1 while the fat floor is engaged (cleared after a day without it; diagnostics). */
  fatFloorOn: number;
  /** 1 when the floor engaged in the last stepped hour. */
  fatFloorThisHour: number;
  /** Last value written to `fatFloorActive` (1 − g of review M9; the bus write is skipped while unchanged, usually 0). */
  fatFloorOut: number;
  /** Day accumulators: FM/LT at day start (kg), LT changes inside fasting hours and from repletion (kg). */
  fmDayStart: number;
  ltDayStart: number;
  dayFastLtKg: number;
  dayRepLtKg: number;
  /**
   * Morning anchor (orchestrator ruling 2026-09-30, MODEL_SPEC §3.4): FM and LT change from midnight to the wake hour on the
   * most recent burn-in day of day 0's weekday (else the latest burn-in day), kg (≤ 0: overnight oxidation), 1 once a day of
   * that weekday was latched, and the current day's morning weigh-in hour (`core/math.wakeRecordHour`).
   */
  nightFmKg: number;
  nightLtKg: number;
  nightMatched: number;
  wakeHour: number;

  // ---- D1-05 / D1-08 partition-domain and model-limit records (main-loop days only; −1 = never)
  /**
   * Today's surplus-protein domain (`SURPLUS_PROTEIN_*`) whenever the surplus share has nonzero blend weight (EB7 > −W),
   * else −1 (A1-039: a partial blend weight is still a dependency).
   */
  surplusDomain: number;
  /** Today's blend weight of the surplus share, 1 − w ∈ [0, 1] (0 outside the fraction regimes). */
  surplusWeight: number;
  /** Today's net energy residual S′ over non-fasting hours, kcal (sign of the partition's lean claim; reset each day). */
  daySPrimeKcal: number;
  /** First plan day whose surplus lean share was used with known protein below the m_P knee (D1-05). */
  lowProteinSurplusFromDay: number;
  /** First plan day whose surplus lean share was used with protein only a known lower bound (D1-05). */
  unknownProteinSurplusFromDay: number;
  /** First plan day in the very-low-intake branch (D1-08: outside demonstrated support). */
  vliFromDay: number;
  /** D1-08: model-limit kind of the last stepped hour (0 none, 1 lean floor conservative boundary, 2 non-conservable). */
  limitThisHour: number;
  /** D1-08: absolute hour index of the first model-limit hour (−1 = none) and the worst kind reached since. */
  modelLimitHour: number;
  modelLimitKind: number;
  /** D1-08: last fully conserved hour at the first limit (the boundary hour itself when it was conserved), −1 = none. */
  modelLimitValidThrough: number;
}

/** Prepared constants plus per-run context (never mutated during the run). */
export interface CompositionK extends CompositionConstants {
  female: boolean;
  /** true when `allocateRegional`/`circumferencesFor` run daily (waist or visceralFat recorded). */
  regionalEnabled: boolean;
  /** t = 0 body estimate (baseline for circumferences, M8). */
  baseline: BodyEstimate;
  /** VAT allometry exponents (D1-02, body module `VAT_ALLOMETRY`): loss prior, gain hypothesis. */
  vatKLoss: number;
  vatKGain: number;
  /** kg lean tissue per g protein, (1 + h_P)/1000. */
  ltPerGProtein: number;
  /** Weekday of day 0 (0 = Monday): the burn-in night whose overnight change anchors the t = 0 masses. */
  startWeekday: number;
}

function prepare(ctx: ModuleContext): CompositionK {
  const c = readConstants(ctx.params);
  const se = ctx.seriesEnabled;
  return {
    ...c,
    female: ctx.profile.sex === 'female',
    regionalEnabled:
      se[MI.waist] === 1 || se[MI.visceralFat] === 1 || se[MI.fatTrunk] === 1 || se[MI.fatArms] === 1 || se[MI.fatLegs] === 1 ||
      se[MI.muscleArms] === 1 || se[MI.muscleLegs] === 1 || se[MI.muscleTrunk] === 1,
    baseline: ctx.profile.body,
    vatKLoss: VAT_ALLOMETRY.kLoss,
    vatKGain: VAT_ALLOMETRY.kGain,
    ltPerGProtein: (1 + c.hP) / 1000,
    startWeekday: ctx.profile.startWeekday,
  };
}

/** LT0 = FFM0 − (1 + h)·G0/1000 (review m6 ruling; G0 = the body estimate's total glycogen, g), floored at ½ FFM0. */
export function initialLeanTissue(k: CompositionK, ffm0: number): number {
  return initialLeanTissueKg(ffm0, k.baseline.glycogen.totalG, k.lt0GlycogenWater);
}

function writeMassSignals(s: CompositionState, bus: SignalBus): void {
  const ffmAct = ffmActOf(s);
  bus.fatMassKg = s.fmKg;
  bus.leanTissueKg = s.ltKg;
  bus.ffmActKg = ffmAct;
  bus.tissueMassKg = s.fmKg + ffmAct;
}

/** Reset every slow state to the t = 0 body (init and end of burn-in; allocation allowed there). */
function anchorSlowStates(s: CompositionState, k: CompositionK, fm0: number, ffm0: number): void {
  const b = k.baseline;
  s.fmKg = fm0;
  s.fm0Kg = fm0;
  s.ffm0Kg = ffm0;
  s.lt0Kg = initialLeanTissue(k, ffm0);
  s.ltKg = s.lt0Kg;
  s.otherFfmKg = ffm0 - s.lt0Kg;
  s.fmMinKg = k.fmFloorFracBw0 * (fm0 + ffm0);
  s.smKg = b.skeletalMuscleKg;
  s.sm0Kg = b.skeletalMuscleKg;
  s.regional = { fat: { ...b.fat }, muscle: { ...b.muscle } };
  s.vatKg = b.fat.vatKg;
  s.waistCm = b.circumferences.waistCm;
  s.osInDeficit = 0;
  s.osValid = 0;
  s.fmPreKg = fm0;
  s.ffmPreKg = ffm0;
  s.wPreKg = fm0 + ffm0;
  s.pctFatPre = (100 * fm0) / (fm0 + ffm0);
  s.pmSS = 0;
  s.deficitEndDay = -1;
  s.depletionFrac = 0;
  s.depletionMax = 0;
  s.fastProteinLostKg = 0;
  s.nBalanceG = 0;
  s.fatFloorHours = 0;
  s.fatFloorOn = 0;
  s.fatFloorThisHour = 0;
  s.fatFloorOut = 0;
  s.fmDayStart = s.fmKg;
  s.ltDayStart = s.ltKg;
  s.dayFastLtKg = 0;
  s.dayRepLtKg = 0;
  s.body.fatMassKg = fm0;
  s.body.fatFreeMassKg = ffm0;
  s.body.weightKg = fm0 + ffm0;
  s.body.skeletalMuscleKg = s.smKg;
  s.body.fat = s.regional.fat;
  s.body.muscle = s.regional.muscle;
}

function init(k: CompositionK, ctx: ModuleContext, bus: SignalBus): CompositionState {
  const p = ctx.profile;
  const b = p.body;
  const body: BodyState = {
    sex: b.sex,
    ageYears: b.ageYears,
    heightCm: b.heightCm,
    weightKg: b.weightKg,
    fatMassKg: b.fatMassKg,
    fatFreeMassKg: b.fatFreeMassKg,
    skeletalMuscleKg: b.skeletalMuscleKg,
    fat: { ...b.fat },
    muscle: { ...b.muscle },
    satShares: { ...b.satShares },
    frameZ: b.frameZ,
  };
  const s: CompositionState = {
    fmKg: 0,
    ltKg: 0,
    lt0Kg: 0,
    fm0Kg: 0,
    ffm0Kg: 0,
    otherFfmKg: 0,
    fmMinKg: 0,
    smKg: 0,
    sm0Kg: 0,
    eb7: 0,
    eb7Ring: new Float64Array(k.eb7WindowD),
    eb7Idx: 0,
    u: 0,
    regime: REGIME_SURPLUS,
    pE: 0,
    pDef: 0,
    pSur: 0,
    pCat: 0,
    rL: 0,
    leanExtraKgD: 0,
    rtAccKgD: 0,
    vliLeanKgD: 0,
    explicitKgH: 0,
    explicitFastKgH: 0,
    vliDays: 0,
    poxDecay: 1,
    regional: { fat: { ...b.fat }, muscle: { ...b.muscle } },
    vatKg: 0,
    waistCm: 0,
    body,
    osInDeficit: 0,
    osValid: 0,
    fmPreKg: 0,
    ffmPreKg: 0,
    wPreKg: 0,
    pctFatPre: 0,
    pmSS: 0,
    deficitEndDay: -1,
    depletionFrac: 0,
    depletionMax: 0,
    fastProteinLostKg: 0,
    nBalanceG: 0,
    fatFloorHours: 0,
    fatFloorOn: 0,
    fatFloorThisHour: 0,
    fatFloorOut: 0,
    fmDayStart: 0,
    ltDayStart: 0,
    dayFastLtKg: 0,
    dayRepLtKg: 0,
    nightFmKg: 0,
    nightLtKg: 0,
    nightMatched: 0,
    wakeHour: wakeRecordHour(p.habits.wakeTimeH),
    surplusDomain: -1,
    surplusWeight: 0,
    daySPrimeKcal: 0,
    lowProteinSurplusFromDay: -1,
    unknownProteinSurplusFromDay: -1,
    vliFromDay: -1,
    limitThisHour: 0,
    modelLimitHour: -1,
    modelLimitKind: 0,
    modelLimitValidThrough: -1,
  };
  anchorSlowStates(s, k, p.fm0Kg, p.ffm0Kg);
  writeMassSignals(s, bus);
  bus.skeletalMuscleKg = s.smKg;
  bus.vatKg = s.vatKg;
  bus.tissueEnergyKcalH = 0;
  bus.depositionCostKcalH = 0;
  bus.leanRateKgD = 0;
  bus.energyBalanceFrac = 0;
  bus.energyBalance7KcalD = 0;
  return s;
}

/**
 * Plan the day (MODEL_SPEC §1.8 steps 1-2): energy-balance signals, regime, energy share p_E and explicit lean terms.
 * `dayIndex` = the plan day (negative in burn-in; only plan days record partition-domain statuses, D1-05/D1-08).
 * Exported for unit tests (drives the module with hand-built bus/day values). Allocation-free.
 */
export function planDay(s: CompositionState, k: CompositionK, bus: SignalBus, day: DayInput, dayIndex = 0): void {
  // 1. energy balance of today's plan
  let tee = bus.tdeeEstKcalD;
  if (!(tee > 1)) tee = bus.maintenanceKcalD > 1 ? bus.maintenanceKcalD : 1;
  const ei = day.energyKcal > 0 ? day.energyKcal : 0;
  const u = clamp((ei - tee) / tee, -1, 1);
  s.u = u;
  bus.energyBalanceFrac = u;
  const ring = s.eb7Ring;
  ring[s.eb7Idx] = ei - tee;
  s.eb7Idx = s.eb7Idx + 1 >= ring.length ? 0 : s.eb7Idx + 1;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) sum += ring[i]!;
  s.eb7 = sum / ring.length;
  bus.energyBalance7KcalD = s.eb7;

  // body descriptors (tissue basis)
  const ffm = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  const bw = s.fmKg + ffm;
  const bf = bw > 0 ? s.fmKg / bw : 0;
  const age = bus.ageYears;
  const repletionG = 24 * (bus.fastRepletionGH > 0 ? bus.fastRepletionGH : 0);
  const protG = day.proteinG > 0 ? day.proteinG : 0;
  const qDaily = day.proteinQDaily > 0 ? day.proteinQDaily : 1;
  const pEff = Math.max(0, protG * qDaily - repletionG);
  const q = ffm > 0 ? pEff / ffm : 0;

  // explicit lean terms (all regimes, all hours): 09 RT accretion + 03 §4.14 age drift, RT = muscle's rtDoseFrac
  // (min(1, V_wb/V_R(age)), 09 §4.8 — one V_R owner, so ensemble draws of V_R reach both uses)
  const rtDose = bus.rtDoseFrac;
  const rt = rtDose > 1 ? 1 : rtDose > 0 ? rtDose : 0;
  s.rtAccKgD = bus.rtAccretionKgD;
  s.leanExtraKgD = s.rtAccKgD + ageLeanDriftGD(k, age, rt) / 1000;
  s.vliLeanKgD = 0;
  s.pCat = 0;
  s.rL = 0;
  s.surplusDomain = -1;
  s.surplusWeight = 0;
  s.daySPrimeKcal = 0;

  // 2. plan regime for non-fasting hours
  if (ei < k.vliEnergyFrac * tee && q < k.vliProteinQ && protG >= k.vliProteinMinG) {
    // 2b. very-low-intake, non-fasting: 03 §4.13 Pox branch (explicit lean rate; fat takes the residual)
    s.regime = REGIME_VLI;
    s.pE = 0;
    // D1-08: the very-low-intake branch is outside demonstrated support (status only; existing entry rule, no new cutoff)
    if (dayIndex >= 0 && s.vliFromDay < 0) s.vliFromDay = dayIndex;
    if (s.vliDays === 0) s.poxDecay = 1;
    const L = leannessIndex(k, bf, k.female);
    const pox = poxRate(k, s.poxDecay, L, day.carbG > 0 ? day.carbG : 0, s.vliDays);
    s.vliLeanKgD = poxLeanRateKgD(k, pox, ffm, pEff);
  } else {
    // 2c. deficit share: 03 leanFractionOfLoss, RT-stripped; × (1 − R_RT); energy share + 16 sleep shift (review M1).
    //     The deficit size d is the sustained one, −EB7/TEE_est (03's d is the diet's deficit, not one day's plan).
    const d = clamp(-s.eb7 / tee, 0, 1);
    s.pCat = pCatDeficit(k, q, d, bf, s.fmKg, k.female, age, bus.aerobicIdx);
    const pDef = deficitEnergyShare(k, s.pCat, bus.rtRetentionFrac, bus.partitionSleepShift);
    // 2d. surplus share: 11 §4.7 r_L with (1 − s_RT); overshoot blend (11 §4.12)
    const pRaw = Math.max(0, protG - repletionG);
    const pBw = bw > 0 ? pRaw / bw : 0;
    const fatG = day.fatG;
    const pufa = fatG > 0 ? day.pufaG / fatG : Number.NaN;
    const sfa = fatG > 0 ? day.satFatG / fatG : Number.NaN;
    // 11 §4.8 switch from the sedentary surplus lean accretion to RT mode (R-RTSWITCH, final round 2026-09-30): RT takes
    // over the sedentary share only as far as 09's accretion supplies it, s_RT = min(1, L_RT/L_sed), L_sed = the sedentary
    // surplus lean rate at the current surplus (at least the blend half-width W, so the share is continuous through
    // EB7 = 0). Total surplus lean = max(L_sed, L_RT) is then non-decreasing in training volume; 11's literal
    // s_RT = min(1, V_wb/12) removed the sedentary share faster than 09's accretion replaced it in trained lifters
    // (lean gain at +10 % fell from 4 to 12 sets/wk). Without RT (V_wb = 0) s_RT = 0 as before.
    const mFa = mFatType(k, pufa, sfa);
    let sRt = 0;
    if (bus.rtVolumeWb > 0) {
      const pSed = surplusEnergyShare(k, surplusLeanRatio(k, pBw, s.fmKg, 0, mFa));
      const lSed = (pSed * (s.eb7 > k.partBlendKcalD ? s.eb7 : k.partBlendKcalD)) / k.effL;
      const lRt = s.rtAccKgD > 0 ? s.rtAccKgD : 0;
      sRt = lSed > 0 ? (lRt < lSed ? lRt / lSed : 1) : 1;
    }
    let rL = surplusLeanRatio(k, pBw, s.fmKg, sRt, mFa);
    if (s.osValid === 1 && s.ffmPreKg - ffm > k.osFfmDefMin && s.fmPreKg > 0) {
      // D_F latched at the depletion reached in the deficit phase (interpretation: keeps P_RF constant through the regain,
      // as in Jacquet 2020; with the current FM the ramp would hand the regain back to the generic rule as fat returns)
      rL = overshootLeanRatio(k, rL, s.pmSS, s.pctFatPre, s.depletionMax, age);
    }
    s.rL = rL;
    const pSur = surplusEnergyShare(k, rL);
    // 2e. review m20: p_E is continuous in EB7 — linear blend of the two shares over |EB7| < W (fully 03 at EB7 ≤ −W,
    //     fully 11 at EB7 ≥ +W). Together with the weekly boxcar EB7 (step 1) and the EB7-based deficit size d, a weight-
    //     stable habitual week gets the same p_E every day, so hourly/daily storage and mobilisation use the same share and
    //     no lean↔fat ratchet builds up at maintenance (O-12).
    const w = clamp(0.5 - s.eb7 / (2 * k.partBlendKcalD), 0, 1);
    s.pDef = pDef;
    s.pSur = pSur;
    s.pE = w * pDef + (1 - w) * pSur;
    s.regime = s.eb7 < 0 ? REGIME_DEFICIT : REGIME_SURPLUS;
    // D1-05/A1-039: whenever the surplus share enters p_E with nonzero weight 1 − w (inside the ±W maintenance blend and
    // during the boxcar warm-up as well as at full saturation), today's protein domain is evaluated; `closeDay` records the
    // first day whose non-fasting partition actually booked a positive lean response through it. Status only: the
    // existing partition stays as the broad scenario, no new lean rate.
    s.surplusWeight = 1 - w;
    if (1 - w > 0) s.surplusDomain = surplusProteinDomain(k, pBw, proteinIsLowerBound(day));
  }
  s.explicitFastKgH = s.leanExtraKgD / 24;
  s.explicitKgH = (s.leanExtraKgD + s.vliLeanKgD) / 24;
}

/**
 * One hour of tissue bookkeeping (MODEL_SPEC §1.8 steps 3-6, per-hour branch of review M7, smooth fat floor of review
 * M9). Allocation-free. Exported for unit tests.
 */
export function stepTissue(s: CompositionState, k: CompositionK, bus: SignalBus): void {
  // each bus field is read once (bus reads are the dominant hot-path cost)
  const sh = bus.eAbsKcalH - bus.teePreKcalH - bus.dnlHeatKcalH - bus.ketoneLossKcalH - bus.glycogenChangeKcalH;
  const repG = bus.fastRepletionGH;
  const rep = repG > 0 ? repG * k.ltPerGProtein : 0;
  const fasting = bus.fastActive === 1;
  const effL = k.effL;
  // 4. lean first: explicit terms at ρL + ηL (signed)
  const dLtX = (fasting ? s.explicitFastKgH : s.explicitKgH) + rep;
  const sPrime = sh - effL * dLtX;
  let dLt = dLtX;
  let dLtFast = 0;
  let eFat: number; // energy (kcal) that fat tissue takes this hour
  if (fasting) {
    // 5. fasting branch: the fasting module's protein flux is the lean change; fat takes the residual
    const pox = bus.fastProtOxGH;
    dLtFast = pox > 0 ? -pox * k.ltPerGProtein : 0;
    dLt += dLtFast;
    eFat = sPrime - effL * dLtFast;
  } else {
    const pE = s.pE;
    dLt += (pE * sPrime) / effL;
    eFat = (1 - pE) * sPrime;
    s.daySPrimeKcal += sPrime;
  }
  // review M9: smooth fat floor — below FM_min + ramp, a growing part of a fat *deficit* is met from lean tissue
  let fm = s.fmKg;
  let lt = s.ltKg;
  let floorOut = 0;
  s.fatFloorThisHour = 0;
  if (eFat < 0 && fm < s.fmMinKg + k.fmFloorRampKg) {
    const w = fatFloorWeight(k, fm, s.fmMinKg);
    dLt += ((1 - w) * eFat) / effL;
    eFat *= w;
    floorOut = 1 - w;
    s.fatFloorHours += 1;
    s.fatFloorThisHour = 1;
  }
  if (floorOut !== s.fatFloorOut) {
    s.fatFloorOut = floorOut;
    bus.fatFloorActive = floorOut;
  }
  // D1-08 numerical tissue floors (physically unreachable in supported runs) are a MODEL LIMIT, detected before the hour is
  // committed. Lean floor: conservative boundary event — lean stops at the floor and the lean energy it can no longer
  // supply is taken from fat, so (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT still equals S_h. A fat mass that would then go negative
  // cannot be conserved: clamp for finite numbers, flag a non-conservable hour (the run is valid through the hour before).
  let limit = 0;
  const ltFloor = LT_FLOOR_FRAC * s.lt0Kg;
  if (lt + dLt < ltFloor) {
    const dLtB = ltFloor - lt;
    eFat += effL * (dLt - dLtB);
    dLt = dLtB;
    limit = 1;
  }
  let dFm = eFat / k.effF;
  if (fm + dFm < 0) {
    dFm = -fm;
    limit = 2;
  }
  s.limitThisHour = limit;
  fm += dFm;
  lt += dLt;
  s.fmKg = fm;
  s.ltKg = lt;
  // 6. signals
  bus.tissueEnergyKcalH = k.effF * dFm + effL * dLt;
  bus.depositionCostKcalH = k.etaF * dFm + k.etaL * dLt;
  const ffmAct = s.ffm0Kg + (lt - s.lt0Kg); // D4-05 binding (`ffmActOf`), inline on the hot path
  bus.fatMassKg = fm;
  bus.leanTissueKg = lt;
  bus.ffmActKg = ffmAct;
  bus.tissueMassKg = fm + ffmAct;
  if (fasting) s.dayFastLtKg += dLtFast;
  if (rep > 0) s.dayRepLtKg += rep;
}

/** Daily closing (MODEL_SPEC §1.8 step 7): SM, N balance, lean rate, regional/VAT/waist, overshoot memory. */
export function closeDay(s: CompositionState, k: CompositionK, bus: SignalBus, dayIndex: number): void {
  // D1-05/A1-039: the surplus share's own lean claim today, (1 − w)·p_Sur·ΣS′/(ρL + ηL) over non-fasting hours — positive
  // with protein outside the supported domain → first affected plan day (low known protein vs unknown kept apart)
  if (dayIndex >= 0 && s.surplusDomain > SURPLUS_PROTEIN_SUPPORTED && s.surplusWeight > 0 && s.pSur > 0 && s.daySPrimeKcal > ROUNDOFF_KCAL) {
    if (s.surplusDomain === SURPLUS_PROTEIN_LOW && s.lowProteinSurplusFromDay < 0) s.lowProteinSurplusFromDay = dayIndex;
    else if (s.surplusDomain === SURPLUS_PROTEIN_UNKNOWN && s.unknownProteinSurplusFromDay < 0) s.unknownProteinSurplusFromDay = dayIndex;
  }
  const dLtDay = s.ltKg - s.ltDayStart;
  const ffm = s.ffm0Kg + (s.ltKg - s.lt0Kg);
  const bw = s.fmKg + ffm;
  // SM: 0.5 of non-RT lean change + 0.7 of RT accretion (03 §4.19 step 7; 09 §4.9, review M10)
  const rtPart = s.rtAccKgD; // booked as rtAccKgD/24 in each of the day's 24 hours
  s.smKg = Math.max(0, s.smKg + k.smLossShare * (dLtDay - rtPart) + k.smRtShare * rtPart);
  // D2-05: body-N change implied by the modelled lean-tissue change (approximate 6.25 g protein/g N conversion); not
  // urinary nitrogen, not skeletal-muscle protein
  s.nBalanceG = (dLtDay * 1000 * k.fProt) / G_PROTEIN_PER_G_N;
  s.fastProteinLostKg += -s.dayFastLtKg - s.dayRepLtKg;
  bus.leanRateKgD = dLtDay - s.dayFastLtKg;

  // VAT (D1-02): one transition for every output mask, computed before any optional geometry
  s.vatKg = vatTransition(s.vatKg, s.fmDayStart, s.fmKg, k.vatKLoss, k.vatKGain);
  // regional depots and waist (14 M7-M8): rendering geometry; the other depots take FM − VAT
  if (k.regionalEnabled) {
    s.regional = allocateRegional(s.regional, { fatMassKg: s.fmKg, skeletalMuscleKg: s.smKg, vatKg: s.vatKg });
    const b = s.body;
    b.ageYears = bus.ageYears;
    b.fatMassKg = s.fmKg;
    b.fatFreeMassKg = ffm;
    b.weightKg = bw;
    b.skeletalMuscleKg = s.smKg;
    b.fat = s.regional.fat;
    b.muscle = s.regional.muscle;
    s.waistCm = circumferencesFor(b, k.baseline).waistCm;
  }
  bus.skeletalMuscleKg = s.smKg;
  bus.vatKg = s.vatKg;

  // very-low-intake branch clock (03 §4.13: t_f resets after ≥ 24 h of normal feeding)
  if (s.regime === REGIME_VLI) {
    s.poxDecay *= poxDecayFactor(k, bus.bhbEndoMmolL);
    s.vliDays += 1;
  } else {
    s.vliDays = 0;
  }

  // overshoot memory (11 §4.12)
  if (s.eb7 < 0) {
    if (s.osInDeficit === 0) {
      s.osInDeficit = 1;
      if (s.osValid === 0) {
        // entering a new deficit phase: remember the pre-diet body (day-start values)
        const ffmStart = s.ffm0Kg + (s.ltDayStart - s.lt0Kg);
        s.fmPreKg = s.fmDayStart;
        s.ffmPreKg = ffmStart;
        s.wPreKg = s.fmDayStart + ffmStart;
        s.pctFatPre = s.wPreKg > 0 ? (100 * s.fmDayStart) / s.wPreKg : 0;
        s.depletionMax = 0;
      }
      s.osValid = 1;
    }
    const df = s.fmPreKg > 0 ? (s.fmPreKg - s.fmKg) / s.fmPreKg : 0;
    if (df > s.depletionMax) s.depletionMax = df;
    const dW = s.wPreKg - bw;
    s.pmSS = dW >= PMSS_MIN_LOSS_KG ? clamp((s.ffmPreKg - ffm) / dW, 0, 0.95) : jacquetPmSS(k, s.pctFatPre);
  } else {
    if (s.osInDeficit === 1) {
      s.osInDeficit = 0;
      s.deficitEndDay = dayIndex;
    }
    if (s.osValid === 1 && (s.ffmPreKg - ffm <= 0 || (s.deficitEndDay >= 0 && dayIndex - s.deficitEndDay > k.osExpiryD))) {
      s.osValid = 0;
    }
  }
  s.depletionFrac = s.fmPreKg > 0 ? (s.fmPreKg - s.fmKg) / s.fmPreKg : 0;

  // next day's accumulators
  s.fmDayStart = s.fmKg;
  s.ltDayStart = s.ltKg;
  s.dayFastLtKg = 0;
  s.dayRepLtKg = 0;
  if (s.fatFloorHours === 0) s.fatFloorOn = 0;
  s.fatFloorHours = 0;
}

export const compositionModule = defineModule<CompositionState, CompositionK>({
  id: 'composition',
  specSection: '§1.8',
  dossiers: '01 §4.2-4.7; 03 §4.4/4.13/4.14/4.19; 11 §4.7/4.12/4.15; 20 §4.4; 09 §4.8-4.10; 14 M6-M8; 16 §4.0.1',
  params: COMPOSITION_PARAMS,
  reads: [
    'partitionSleepShift', 'ageYears', 'aerobicIdx', 'raProtGH', 'eAbsKcalH', 'fastActive', 'fastProtOxGH', 'fastRepletionGH',
    'teePreKcalH', 'maintenanceKcalD', 'tdeeEstKcalD', 'dnlHeatKcalH', 'glycogenChangeKcalH', 'bhbEndoMmolL',
    'ketoneLossKcalH', 'rtAccretionKgD', 'rtRetentionFrac', 'rtDoseFrac', 'rtVolumeWb',
  ],
  writes: [
    'fatMassKg', 'leanTissueKg', 'ffmActKg', 'tissueMassKg', 'skeletalMuscleKg', 'tissueEnergyKcalH', 'depositionCostKcalH',
    'leanRateKgD', 'energyBalanceFrac', 'energyBalance7KcalD', 'vatKg', 'fatFloorActive',
  ],
  records: [
    'fatMass', 'leanTissue', 'skeletalMuscle', 'waist', 'visceralFat', 'nitrogenBalance', 'fastProteinCost',
    'fatTrunk', 'fatArms', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk',
  ],
  prepare,
  init,
  startDay: (s, k, bus, day, clock) => {
    s.wakeHour = wakeRecordHour(day.sleepWakeH);
    planDay(s, k, bus, day, clock.day);
  },
  stepHour: (s, k, bus, _hour, _day, clock) => {
    stepTissue(s, k, bus);
    // D1-08: first model-limit hour of the plan (burn-in is re-anchored at its end); the worst kind reached is kept
    if (s.limitThisHour !== 0 && clock.day >= 0) {
      if (s.modelLimitHour < 0) {
        s.modelLimitHour = clock.hourIndex;
        s.modelLimitValidThrough = s.limitThisHour >= 2 ? clock.hourIndex - 1 : clock.hourIndex;
      }
      if (s.limitThisHour > s.modelLimitKind) s.modelLimitKind = s.limitThisHour;
    }
    // review M9 / MODEL_SPEC §7.1: the fat floor is reported through `fatFloorActive` (safety owns W-01-FATFLOOR and every
    // `safetyFlag` event); composition emits no events.
    if (s.fatFloorThisHour === 1) s.fatFloorOn = 1;
    // morning anchor: latch the burn-in night's midnight → wake-hour tissue change (fmDayStart/ltDayStart = midnight)
    if (clock.day < 0 && clock.hourOfDay === s.wakeHour) {
      const same = clock.weekday === k.startWeekday;
      if (same || s.nightMatched === 0) {
        s.nightFmKg = s.fmKg - s.fmDayStart;
        s.nightLtKg = s.ltKg - s.ltDayStart;
        if (same) s.nightMatched = 1;
      }
    }
  },
  endOfDay: (s, k, bus, _day, clock) => {
    closeDay(s, k, bus, clock.day);
  },
  endBurnIn: (s, k, bus, ctx) => {
    // end of burn-in (review B3c, MODEL_SPEC §3.4): slow states back to the entered body; fast states (EB7, VLI clock) keep
    // their settled values. Morning anchor (orchestrator ruling 2026-09-30): the entered body is the wake-hour body, so the
    // t = 0 (midnight) masses are FM0/LT0 minus the habitual overnight change — FM = FM0 and LT = LT0 again at day 0's wake
    // hour (burn-in night of day 0's weekday). References (fm0Kg, lt0Kg, ffm0Kg) stay the entered values. Water adds no
    // tissue offset.
    anchorSlowStates(s, k, s.fm0Kg, s.ffm0Kg);
    if ((ctx.burnInDays ?? 0) > 0) {
      s.fmKg = s.fm0Kg - s.nightFmKg;
      s.ltKg = s.lt0Kg - s.nightLtKg;
      s.fmDayStart = s.fmKg;
      s.ltDayStart = s.ltKg;
    }
    writeMassSignals(s, bus);
    bus.skeletalMuscleKg = s.smKg;
    bus.vatKg = s.vatKg;
    bus.leanRateKgD = 0;
    bus.fatFloorActive = 0;
    bus.tissueEnergyKcalH = 0;
    bus.depositionCostKcalH = 0;
  },
  recordDay: (s, _k, _bus, out) => {
    out[MI.fatMass] = s.fmKg;
    out[MI.leanTissue] = s.ltKg;
    out[MI.skeletalMuscle] = s.smKg;
    out[MI.visceralFat] = s.vatKg;
    out[MI.waist] = s.waistCm;
    out[MI.nitrogenBalance] = s.nBalanceG;
    out[MI.fastProteinCost] = s.fastProteinLostKg;
    const f = s.regional.fat;
    const m = s.regional.muscle;
    out[MI.fatTrunk] = f.trunkSatKg;
    out[MI.fatArms] = f.armsKg;
    out[MI.fatLegs] = f.legsKg;
    out[MI.muscleArms] = m.armsKg;
    out[MI.muscleLegs] = m.legsKg;
    out[MI.muscleTrunk] = m.trunkKg;
  },
});
