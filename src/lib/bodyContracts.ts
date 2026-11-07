/**
 * Binding body-model contracts C1–C7 (review 2026-10-18, `_CONTRACTS.md`): the shared, typed vocabulary every package
 * builds on. Pure data types and small pure helpers only: no physiology, no IO, no clock reads, no randomness. Measurement
 * operators (C4) live next door in `./measurementOperators.ts`.
 *
 * Interface inventory (who provides / who consumes):
 *   C1  observations & occurrence    ChannelCoverage, ExposureChannel, ChannelCoverageMap, coverageOf,
 *                                    DayIntakeAttestation/DAY_INTAKE_ATTESTATIONS, OccurrenceTime, intervalOccurrence,
 *                                    ObservationMeta, QuantityProvenance, exactOccurrence/dateOnlyOccurrence/
 *                                    unknownOccurrence, occurrenceBoundsMs, dayIntakeCoverage, exposureCalibrationEligible,
 *                                    normalizeSubstanceDose, SUBSTANCE_UNITS, ETHANOL_G_PER_STANDARD_DRINK
 *                                                                      → living (W0-history), food commands (W0-food)
 *   C2  one realised history         RealisedHistory, RealisedDay, CanonicalEvent, FastInterval, LatentRemainder,
 *                                    HistoryAssumption, UncertaintyGroup, ReduceRealisedHistory, CausalResolution,
 *                                    weakestResolution, realisedHistoryHash, zeroCalorieFastInterruption, PlanItemLink,
 *                                    HistoryAnchor, ADHERENCE_ZERO_DAY_TOLERANCE_KCAL
 *                                                                      → reducer (W0-history), assimilation, replan, engine
 *   C3  exposure ledger              ExposureQuantity, EXPOSURE_UNITS, EXPOSURE_IDS, CarbohydrateBasis/Record,
 *                                    availableCarbohydrate, EnergyLedger, buildEnergyLedger, conventionEnergyKcal,
 *                                    GENERAL_ENERGY_FACTORS, residualEnergyEnvelope, ingredientEdibleMassG,
 *                                    recipeBatchNutrient, per100FromBatch, SupplementProduct/ProductActive/ACTIVE_BASES,
 *                                    SupplementSchedule/SUPPLEMENT_SCHEDULE_KINDS, SafetyCheckStatus,
 *                                    activeExposureFromServing, convertMass, GLUCOSE_G_PER_MMOL, GLYCOSYL_G_PER_MMOL,
 *                                    convertActiveAmount, VITAMIN_D_IU_PER_UG, NITRATE_ION_MG_PER_MMOL (A1-026),
 *                                    MacroMask, SubstrateRoute, substrateRouteOf (A1-014, A1-031)
 *                                                                      → nutrient provider (W0-food), engine intake, D7-04
 *   C5  safety & certificates        ConstraintDef, CONSTRAINT_UNITS, CONSTRAINT_CHANNELS, constraintKey,
 *                                    validateConstraintDef, intersectConstraints, evaluateBound, combineConstraintStatuses,
 *                                    nutrientTotalCoverage, exposureInterval (A1-014),
 *                                    interpretSurplusCap, jointSafetyScreen, requiredJointPasses, SAFETY_AUDIT_ENSEMBLE,
 *                                    iidZeroFailureLowerBound, normalizedMarginScore, SafetyCertificate,
 *                                    certificateFingerprint, certificateAuthorizes, LifecycleBoundary, SymptomReport,
 *                                    isConcerningUnresolved, ClinicianExerciseEnvelope, ClinicalNutritionEnvelope,
 *                                    RenalContextStatus, ScreeningAnswer, SuggestionPolicyState/SuggestionDecision
 *                                                                      → planner safety (W0-planner), clinical (W0-clinical)
 *   C6  capability, status, UI       OutputStatus, StatusValue, statusValue, STATUS_LABEL, INTERPRETABLE_STATUSES,
 *                                    OBJECTIVE_STATUSES, inlineStatusText, formatRange, worstStatus, dependentStatusOf,
 *                                    closeStatuses, closeStatusMeta, OUTPUT_DEPENDENCIES, UncertaintyKind, CoverageStatus,
 *                                    GoalCapability, Warrant, BandAvailability, BAND_DAY_METHOD, bandDayMethodOf,
 *                                    bandDayUsable (A1-013, A1-049),
 *                                    CapabilityAvailability, capabilityAllowsOptimization, SearchOutcome,
 *                                    searchOutcomeFromLegacy, SEARCH_OUTCOME_LABEL, BandMeta, bandMetaFor, LEGACY_BAND_META
 *                                    (the per-metric registry GOAL_CAPABILITY / isProductionGoalEligible lives in
 *                                    `@/engine/types/metrics`)
 *                                                                      → planner, recorder adapters, workers, UI (W3-ui)
 *   C7  versions, hashing, ledgers   CONTRACT_VERSIONS, CONTRACT_FINGERPRINT, stableStringify, contentHash,
 *                                    DerivedVersionStamp, stampDerived, isDerivedCurrent, DerivationLineage,
 *                                    derivationLineage, lineageInvalidation (A1-017), ExerciseCostBreakdown,
 *                                    exerciseNetAboveRestKcal, exerciseIncrementalKcal, EnergyBoundary
 *
 * Rules that apply to every helper here: unknown is never zero, a status travels beside (never inside) a number, nothing
 * returns NaN/Infinity, and no new physiological coefficient is introduced. Numbers that do appear are declared accounting
 * conventions (energy factors, molar masses) or the review's explicitly named policy/engineering defaults.
 */

/** ISO-8601 instant with offset or Z (`2026-10-18T07:30:00+05:30`). */
export type IsoInstant = string;
/** ISO local date `YYYY-MM-DD`. */
export type IsoDate = string;

// =====================================================================================================================
// C7 — versions and stable hashing
// =====================================================================================================================

/**
 * Semantic versions of every contract whose meaning a derived artifact depends on (C7). A change of any value invalidates
 * derived caches, snapshots, worker results and certificates that recorded the old value; it never rewrites observations.
 * Version 1 of each is the first under the 2026-10-18 contracts; legacy (pre-contract) artifacts read as version 0.
 */
export const CONTRACT_VERSIONS = {
  /** C1: record/occurrence/coverage semantics of logs and measurements. */
  observation: 1,
  /** C2: the realised-history reducer (event identity, fast intervals, censoring, causal resolution). */
  realisedHistory: 1,
  /**
   * C3: exposure ledger interpretation (units, bases, energy ledger, product actives). 3 (re-audit 2026-10-19): per-nutrient
   * knowledge masks and interval bounds (A1-014), ingredient-aware active conversions — vitamin D IU → µg, nitrate-ion
   * mass → mmol (A1-026) — and polyol identity with an unmodelled substrate route (A1-031).
   */
  exposure: 3,
  /**
   * C4: measurement operators and observable tags. 2: `nitrogenBalance` no longer maps to urinary nitrogen (A1-059), the
   * hour-end `bhbEndpoint` series is the blood-reading observable (A1-058), lab-sample occurrence/context transport (A1-034,
   * A1-047).
   */
  measurementOperator: 2,
  /**
   * C4: trend/balance estimator strategy (fixed-prior refit, consumed observation identities). 2: derived anchors carry a
   * full derivation lineage and are refit after a retraction/revision/estimator change (A1-017); composition evidence uses a
   * joint own-time state + shared device-bias likelihood instead of lifetime precision subtraction (A1-038).
   */
  estimator: 2,
  /** C5: constraint definitions, intersection and evaluation. */
  constraintPolicy: 2,
  /** C5: safety certificate fingerprint and joint-audit protocol. */
  safetyCertificate: 1,
  /** C6: goal capability registry. */
  goalCapability: 2,
  /** A2-024: explicit goal operator/sample identity; absent legacy stamps never imply tissue confirmation. */
  goalEndpoint: 1,
  /** A2-001: all-required-member endpoint coverage, independent from finite compatibility storage. */
  goalAggregation: 1,
  /** A2-010: additive clinician guidance history, revocation and current-source scope. */
  clinicalGuidance: 1,
  /** A2-019: physical execution scenarios independent from descriptive utility credit. */
  behaviorExecution: 1,
  /** A2-031: occurrence-based, operator-compatible repeated-measurement monitoring evidence. */
  monitoringEvidence: 1,
  /** A2-022: independent intake/exercise coverage in daily and calendar exposure. */
  energyAvailability: 2,
  /**
   * C6: status propagation between outputs (`OUTPUT_DEPENDENCIES`, `dependentStatusOf`). 1 (re-audit 2026-10-19): energy
   * balance / substrate / partition / regional / nitrogen / muscle-dose edges (A1-013, A1-022). Legacy = 0.
   */
  statusPropagation: 1,
  /**
   * C6: band/uncertainty metadata (sensitivity ranges vs predictive intervals). 2: per-day band availability with
   * attempted/valid/excluded counts and member status (A1-049); structural modes carried by every member (A1-065).
   */
  uncertainty: 2,
  /** C6: finite-search outcome vocabulary. */
  searchOutcome: 1,
  /**
   * D8-06: observed sleep episodes map to the wake date; planned nights keep the starting date. 2: the known total asleep
   * hours of a waking day is kept separate from the main-episode timing, and observed quality (or unrated) reaches day zero
   * and every later day (A1-053).
   */
  sleepDate: 2,
  /**
   * D3-01/D3-03/D3-09 exercise-dose interpretation. 1 (re-audit 2026-10-19): physical-bout identity for per-bout
   * nonlinearities (A1-020), ordered phase/class/scale transport (A1-021), unknown hard-set dose as a named scenario
   * (A1-022), distinct effort-scale identities (A1-062). Legacy = 0.
   */
  exerciseDose: 1,
  /** D8-03: external validation record roles. */
  validation: 1,
} as const;
export type ContractName = keyof typeof CONTRACT_VERSIONS;

/**
 * Canonical JSON: object keys sorted, `undefined` and functions dropped, typed arrays as arrays, Maps as sorted entry
 * lists, Dates as ISO strings. Non-finite numbers are encoded as `{"$num":"NaN"}` (never as `null`), so a hash still
 * distinguishes them while no NaN/Infinity ever reaches JSON (C6).
 */
export function stableStringify(value: unknown): string {
  return encode(value, new Set());
}

function encode(v: unknown, seen: Set<object>): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      return Number.isFinite(v) ? (Object.is(v, -0) ? '0' : JSON.stringify(v)) : `{"$num":"${String(v)}"}`;
    case 'bigint':
      return `{"$big":"${v.toString()}"}`;
    case 'string':
      return JSON.stringify(v);
    case 'undefined':
    case 'function':
    case 'symbol':
      return 'null';
  }
  const o = v as object;
  if (seen.has(o)) throw new Error('stableStringify: cyclic value');
  if (o instanceof Date) return JSON.stringify(Number.isNaN(o.getTime()) ? 'Invalid Date' : o.toISOString());
  seen.add(o);
  try {
    if (ArrayBuffer.isView(o) && !(o instanceof DataView)) return encode(Array.from(o as unknown as ArrayLike<number>), seen);
    if (Array.isArray(o)) return `[${o.map((x) => encode(x === undefined ? null : x, seen)).join(',')}]`;
    if (o instanceof Map) {
      const entries = Array.from(o.entries()).map(([k, x]) => [encode(k, seen), encode(x, seen)] as const);
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return `{"$map":[${entries.map(([k, x]) => `[${k},${x}]`).join(',')}]}`;
    }
    if (o instanceof Set) {
      const items = Array.from(o.values()).map((x) => encode(x, seen));
      items.sort();
      return `{"$set":[${items.join(',')}]}`;
    }
    const keys = Object.keys(o)
      .filter((k) => {
        const x = (o as Record<string, unknown>)[k];
        return x !== undefined && typeof x !== 'function' && typeof x !== 'symbol';
      })
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${encode((o as Record<string, unknown>)[k], seen)}`).join(',')}}`;
  } finally {
    seen.delete(o);
  }
}

/**
 * Deterministic 64-bit content hash (two independent 32-bit lanes, hex). For cache keys, fingerprints and replay identity;
 * not a cryptographic digest. Same canonical JSON ⇒ same hash on every platform.
 */
export function contentHash(value: unknown): string {
  const s = typeof value === 'string' ? value : stableStringify(value);
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Hash of `CONTRACT_VERSIONS`: include it in every request/cache/snapshot/worker key whose result depends on them (C7). */
export const CONTRACT_FINGERPRINT: string = contentHash(CONTRACT_VERSIONS);

/** What a derived artifact (forecast, cache, filter state, certificate) was computed under (C7). */
export interface DerivedVersionStamp {
  /** `CONTRACT_FINGERPRINT` at computation time. */
  contracts: string;
  /** The individual contract versions it depended on (subset of `CONTRACT_VERSIONS`). */
  versions?: Partial<Record<ContractName, number>>;
  engineVersion?: string;
  registryHash?: string;
  /** Hash of the immutable inputs (history hash, profile, request). */
  inputsHash?: string;
  /** Instant the artifact was computed (audit only). */
  computedAt?: IsoInstant;
  /** 'original' = adopted/frozen when made; 'recomputed' = rebuilt after an upgrade (drift never changes silently). */
  origin?: 'original' | 'recomputed';
}

export function stampDerived(extra: Omit<DerivedVersionStamp, 'contracts'> = {}): DerivedVersionStamp {
  return { contracts: CONTRACT_FINGERPRINT, ...extra };
}

/**
 * True when a stamped artifact is still valid for the current contracts (and, when given, the same engine/registry/inputs).
 * A missing stamp (legacy artifact) is never current: invalidating derived data is safe (C7).
 */
export function isDerivedCurrent(stamp: DerivedVersionStamp | null | undefined, current: Omit<DerivedVersionStamp, 'contracts' | 'computedAt' | 'origin'> = {}): boolean {
  if (!stamp || stamp.contracts !== CONTRACT_FINGERPRINT) return false;
  if (current.engineVersion !== undefined && stamp.engineVersion !== current.engineVersion) return false;
  if (current.registryHash !== undefined && stamp.registryHash !== current.registryHash) return false;
  if (current.inputsHash !== undefined && stamp.inputsHash !== current.inputsHash) return false;
  if (current.versions) for (const [k, v] of Object.entries(current.versions)) if (stamp.versions?.[k as ContractName] !== v) return false;
  return true;
}

/* ---------------------------------------------------------------- derivation lineage (C4/C7, D5-07, A1-017/A1-038) */

/** Version of the derivation-lineage semantics (`DerivationLineage`). */
export const DERIVATION_LINEAGE_VERSION = 1;

/**
 * One observation revision a derived artifact consumed (C4/C7): `id` = the observation's stable identity (the root of its
 * edit chain), `revision` = the effective revision used, `valueHash` = hash of the values used (value, scan masses, date,
 * operator), so a corrected value with the same revision number is still detected.
 */
export interface ConsumedObservationRef {
  id: string;
  revision: number;
  valueHash: string;
  /** Occurrence date/instant the observation was assimilated at (its own time, never the decision date). */
  at?: string;
}

/**
 * Complete derivation fingerprint of a derived current-state artifact (anchor, refit composition, filter state; A1-017):
 * the observation revisions and values it consumed, the realised history it replayed, the estimator/operator identity and
 * the previous derived anchor it propagated from (null = the fixed prior). An artifact whose lineage no longer matches the
 * current effective graph is invalid as CURRENT state (it stays as history); a refit is never a new confirmation.
 */
export interface DerivationLineage {
  version: number;
  /** Sorted by `id`. */
  observations: readonly ConsumedObservationRef[];
  historyHash?: string;
  estimator?: { strategy: string; version: number; paramsHash: string };
  operatorVersion?: number;
  /** `fingerprint` of the previous derived anchor (null = fixed prior). */
  previous?: string | null;
  fingerprint: string;
}

/** Build a lineage with its fingerprint (observations sorted by id; order of input never matters). */
export function derivationLineage(input: Omit<DerivationLineage, 'version' | 'fingerprint'>): DerivationLineage {
  const observations = [...input.observations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision));
  const body = { version: DERIVATION_LINEAGE_VERSION, ...input, observations };
  return { ...body, fingerprint: contentHash(body) };
}

export type LineageInvalidation = 'legacyUnreconstructable' | 'observationRetracted' | 'observationRevised' | 'estimatorChanged' | 'operatorChanged' | 'historyChanged' | 'upstreamChanged';

/**
 * Why a stored lineage is no longer valid against the current effective observation graph and estimator (A1-017), or null
 * when it still is. `current.observations` = the current effective revision of every observation (by stable id); a new
 * observation the artifact never consumed does not invalidate it (it is new evidence for a later decision). A missing or
 * older-version lineage cannot be checked: `legacyUnreconstructable` (keep it historical/conditional, never certify it).
 */
export function lineageInvalidation(
  stored: DerivationLineage | null | undefined,
  current: { observations: readonly ConsumedObservationRef[]; estimator?: DerivationLineage['estimator']; operatorVersion?: number; historyHash?: string; previous?: string | null },
): { reason: LineageInvalidation; ids: string[] } | null {
  if (!stored || stored.version !== DERIVATION_LINEAGE_VERSION) return { reason: 'legacyUnreconstructable', ids: [] };
  const now = new Map(current.observations.map((o) => [o.id, o] as const));
  const retracted: string[] = [];
  const revised: string[] = [];
  for (const o of stored.observations) {
    const c = now.get(o.id);
    if (!c) retracted.push(o.id);
    else if (c.revision !== o.revision || c.valueHash !== o.valueHash) revised.push(o.id);
  }
  if (retracted.length) return { reason: 'observationRetracted', ids: retracted.sort() };
  if (revised.length) return { reason: 'observationRevised', ids: revised.sort() };
  const e = stored.estimator;
  const ce = current.estimator;
  if (ce !== undefined && (!e || e.strategy !== ce.strategy || e.version !== ce.version || e.paramsHash !== ce.paramsHash)) return { reason: 'estimatorChanged', ids: [] };
  if (current.operatorVersion !== undefined && stored.operatorVersion !== current.operatorVersion) return { reason: 'operatorChanged', ids: [] };
  if (current.historyHash !== undefined && stored.historyHash !== undefined && stored.historyHash !== current.historyHash) return { reason: 'historyChanged', ids: [] };
  if (current.previous !== undefined && (stored.previous ?? null) !== current.previous) return { reason: 'upstreamChanged', ids: [] };
  return null;
}

// =====================================================================================================================
// C1 — immutable observations, occurrence time and per-channel coverage
// =====================================================================================================================

/**
 * Coverage of one exposure channel for one day or interval (C1). `unknown` is the default for every channel and every
 * legacy record; `confirmedZero` is a positive statement ("nothing eaten"), never inferred from an absence; `asPlannedEstimate`
 * is a behavioural tap replayed through a frozen prescription snapshot (an estimate, not a measurement).
 */
export type ChannelCoverage = 'unknown' | 'partial' | 'complete' | 'confirmedZero' | 'asPlannedEstimate';
export const CHANNEL_COVERAGES: readonly ChannelCoverage[] = ['unknown', 'partial', 'complete', 'confirmedZero', 'asPlannedEstimate'];

/** Independent exercise knowledge: covered prescribed sessions are not an exhaustive actual-day observation. */
export interface ExerciseExposureCoverage {
  version: 1;
  coverage: ChannelCoverage;
  scope: 'actualDay' | 'coveredSessions' | 'prescribedScenario' | 'unknown';
  source?: string;
  reasonCode?: string;
  /** Optional finite upper bound on all actual-day net-above-rest exercise cost, kcal. */
  upperBoundKcal?: number;
}

/** Independent exposure/outcome channels (meal completeness is not day completeness; no blood test ≠ zero intake). */
export type ExposureChannel =
  | 'energy'
  | 'protein'
  | 'carbohydrate'
  | 'fat'
  | 'fibre'
  | 'alcohol'
  | 'caffeine'
  | 'sodium'
  | 'potassium'
  | 'micronutrients'
  | 'supplements'
  | 'fluids'
  | 'exercise'
  | 'steps'
  | 'sleep'
  | 'fasting'
  | 'bodyMass'
  | 'labs';
export const EXPOSURE_CHANNELS: readonly ExposureChannel[] = [
  'energy',
  'protein',
  'carbohydrate',
  'fat',
  'fibre',
  'alcohol',
  'caffeine',
  'sodium',
  'potassium',
  'micronutrients',
  'supplements',
  'fluids',
  'exercise',
  'steps',
  'sleep',
  'fasting',
  'bodyMass',
  'labs',
];

/** Per-channel coverage; an absent channel is `unknown` (never false, zero or complete). */
export type ChannelCoverageMap = Partial<Record<ExposureChannel, ChannelCoverage>>;

export function coverageOf(map: ChannelCoverageMap | null | undefined, channel: ExposureChannel): ChannelCoverage {
  return map?.[channel] ?? 'unknown';
}

/**
 * The person's optional day-level report about food (D5-01): `complete` = everything eaten is logged with amounts,
 * `partial` = some of it, `none` = nothing was eaten (confirmed zero intake, never "skipped"). Absent = no statement.
 */
export type DayIntakeAttestation = 'complete' | 'partial' | 'none';
export const DAY_INTAKE_ATTESTATIONS: readonly DayIntakeAttestation[] = ['complete', 'partial', 'none'];

/**
 * Day-level energy coverage under C1/D5-01. Only an explicit attestation can make a day `complete` or `confirmedZero`;
 * meal count, a per-meal `complete` flag or a final adherence score never do. Some actual quantified intake without an
 * attestation is `partial`; behavioural taps alone are `asPlannedEstimate`; nothing is `unknown`.
 */
export function dayIntakeCoverage(input: { attestation?: DayIntakeAttestation | null; quantifiedIntakeEvents: number; asPlannedTaps?: number }): ChannelCoverage {
  if (input.attestation === 'none') return input.quantifiedIntakeEvents > 0 ? 'partial' : 'confirmedZero';
  if (input.attestation === 'complete') return input.quantifiedIntakeEvents > 0 ? 'complete' : 'unknown';
  if (input.quantifiedIntakeEvents > 0) return 'partial';
  if ((input.asPlannedTaps ?? 0) > 0) return 'asPlannedEstimate';
  return 'unknown';
}

/**
 * How a quantity came to be known (C1/C3). `measured` (instrument), `reported` (typed by the person), `label` (transcribed
 * package label), `estimated` (model or AI estimate of an actual event), `imputed` (filled for a missing event in a named
 * scenario), `asPlanned` (frozen prescription replay), `default` (population/engine default), `derived` (computed from
 * other observations, e.g. Navy from girths), `legacyUnknown` (written before provenance existed).
 */
export type QuantityProvenance = 'measured' | 'reported' | 'label' | 'estimated' | 'imputed' | 'asPlanned' | 'default' | 'derived' | 'legacyUnknown';

/** Provenance values that are evidence about an actual event (not a scenario assumption). */
export const OBSERVED_PROVENANCE: ReadonlySet<QuantityProvenance> = new Set<QuantityProvenance>(['measured', 'reported', 'label', 'estimated', 'derived']);

/** C1/D5-01: an energy interval may enter an exposure-conditional balance calibration only when quantitatively covered. */
export function exposureCalibrationEligible(coverage: ChannelCoverage, provenance: readonly QuantityProvenance[] = []): boolean {
  if (coverage === 'confirmedZero') return true;
  if (coverage !== 'complete') return false;
  return provenance.every((p) => p !== 'asPlanned' && p !== 'imputed' && p !== 'default' && p !== 'legacyUnknown');
}

export type TimePrecision = 'exact' | 'interval' | 'dateOnly' | 'unknown';
/**
 * What a stored local date means: `calendarLocal` (civil date in `tz`), `appDay` (app day with rollover at `rolloverH`,
 * versioned by `rolloverVersion`), `wakeDate` (sleep: the date of waking), `unknown` (legacy without a known meaning).
 */
export type DateMeaning = 'calendarLocal' | 'appDay' | 'wakeDate' | 'unknown';

/**
 * When something happened (C1), stored separately from when it was recorded. Exactly one of `at` (precision 'exact') or
 * `interval` (precision 'interval', half-open [start, end)) is set when the time is known; a date-only or unknown time
 * never gets a guessed clock (no noon default, no command-entry time).
 */
export interface OccurrenceTime {
  precision: TimePrecision;
  at?: IsoInstant;
  interval?: { start: IsoInstant; end: IsoInstant };
  date?: IsoDate;
  dateMeaning: DateMeaning;
  /** IANA zone and/or the UTC offset in minutes at the occurrence. */
  tz?: string;
  offsetMin?: number;
  /** App-day rollover clock hour and the version of the rollover rule the date was written under. */
  rolloverH?: number;
  rolloverVersion?: number;
  /** The wall-clock time was ambiguous (DST fold) and was kept as an interval rather than resolved by guess. */
  dstAmbiguous?: boolean;
  source: 'user' | 'device' | 'import' | 'derived' | 'legacy';
}

export function exactOccurrence(at: IsoInstant, opts: { tz?: string; source?: OccurrenceTime['source']; date?: IsoDate; dateMeaning?: DateMeaning } = {}): OccurrenceTime {
  return { precision: 'exact', at, dateMeaning: opts.dateMeaning ?? (opts.date ? 'calendarLocal' : 'unknown'), source: opts.source ?? 'user', ...(opts.tz ? { tz: opts.tz } : {}), ...(opts.date ? { date: opts.date } : {}) };
}

export function intervalOccurrence(start: IsoInstant, end: IsoInstant, opts: { tz?: string; source?: OccurrenceTime['source']; date?: IsoDate; dateMeaning?: DateMeaning; dstAmbiguous?: boolean } = {}): OccurrenceTime {
  return {
    precision: 'interval',
    interval: { start, end },
    dateMeaning: opts.dateMeaning ?? (opts.date ? 'calendarLocal' : 'unknown'),
    source: opts.source ?? 'user',
    ...(opts.tz ? { tz: opts.tz } : {}),
    ...(opts.date ? { date: opts.date } : {}),
    ...(opts.dstAmbiguous ? { dstAmbiguous: true } : {}),
  };
}

export function dateOnlyOccurrence(date: IsoDate, dateMeaning: DateMeaning, source: OccurrenceTime['source'] = 'legacy'): OccurrenceTime {
  return { precision: 'dateOnly', date, dateMeaning, source };
}

export function unknownOccurrence(source: OccurrenceTime['source'] = 'legacy'): OccurrenceTime {
  return { precision: 'unknown', dateMeaning: 'unknown', source };
}

/** Absolute bounds (epoch ms) of an occurrence, or null when no instant is known (date-only/unknown). */
export function occurrenceBoundsMs(o: OccurrenceTime | null | undefined): { startMs: number; endMs: number } | null {
  if (!o) return null;
  if (o.precision === 'exact' && o.at) {
    const t = Date.parse(o.at);
    return Number.isFinite(t) ? { startMs: t, endMs: t } : null;
  }
  if (o.precision === 'interval' && o.interval) {
    const a = Date.parse(o.interval.start);
    const b = Date.parse(o.interval.end);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? { startMs: a, endMs: b } : null;
  }
  return null;
}

/**
 * Audit and occurrence metadata any observation may carry (C1). Additive on every stored record: absent fields mean
 * "not known", and `recordedAt` is never used as a physiological timestamp.
 */
export interface ObservationMeta {
  /** When the record was written (audit). */
  recordedAt?: IsoInstant;
  /** When it happened. */
  occurrence?: OccurrenceTime;
  provenance?: QuantityProvenance;
  /** Free method/device/protocol tag ('scale', 'labelScan', 'dxa:hologic'…). */
  method?: string;
  /** Catalogue/recipe/label version the values were resolved with (frozen at entry). */
  sourceVersion?: string;
  /** `CONTRACT_VERSIONS.observation` the record was written under (absent = legacy, version 0). */
  contract?: number;
}

/* ------------------------------------------------------------------------------- substances (D5-01 boundary rules) */

export type SubstanceId = 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones';
export type SubstanceUnit = 'mg' | 'drinks' | 'g';
/** Declared current accounting convention for one standard drink (D5-01); stored beside every converted value. */
export const ETHANOL_G_PER_STANDARD_DRINK = 14;
/** Canonical unit per substance: caffeine mg, ethanol g, creatine g, exogenous D-BHB g. */
export const SUBSTANCE_CANONICAL_UNIT: Readonly<Record<SubstanceId, 'mg' | 'g'>> = { caffeine: 'mg', alcohol: 'g', creatine: 'g', exogenousKetones: 'g' };
/** Legal input units per substance; any other pairing is rejected, never coerced (alcohol in mg, caffeine in drinks…). */
export const SUBSTANCE_UNITS: Readonly<Record<SubstanceId, readonly SubstanceUnit[]>> = {
  caffeine: ['mg', 'g'],
  alcohol: ['drinks', 'g'],
  creatine: ['g', 'mg'],
  exogenousKetones: ['g', 'mg'],
};

export type SubstanceDoseResult =
  | { ok: true; value: number; unit: 'mg' | 'g'; original: { amount: number; unit: SubstanceUnit }; convention?: 'ethanol14gPerDrink' }
  | { ok: false; reason: 'unitNotAllowed' | 'notFiniteNonNegative'; original: { amount: number; unit: string } };

/** Validate a substance/unit pair and normalise to the canonical unit, keeping the raw value (D5-01). */
export function normalizeSubstanceDose(substance: SubstanceId, amount: number, unit: string): SubstanceDoseResult {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: 'notFiniteNonNegative', original: { amount, unit } };
  const allowed = SUBSTANCE_UNITS[substance] as readonly string[];
  if (!allowed.includes(unit)) return { ok: false, reason: 'unitNotAllowed', original: { amount, unit } };
  const u = unit as SubstanceUnit;
  const target = SUBSTANCE_CANONICAL_UNIT[substance];
  if (substance === 'alcohol' && u === 'drinks') return { ok: true, value: amount * ETHANOL_G_PER_STANDARD_DRINK, unit: 'g', original: { amount, unit: u }, convention: 'ethanol14gPerDrink' };
  const value = u === target ? amount : u === 'g' && target === 'mg' ? amount * 1000 : u === 'mg' && target === 'g' ? amount / 1000 : amount;
  return { ok: true, value, unit: target, original: { amount, unit: u } };
}

// =====================================================================================================================
// C2 — one realised history and causal replay
// =====================================================================================================================

/**
 * Causal resolution of a quantity (C2/D2-01): `eventPrefix` = depends only on exposure up to the evaluated instant;
 * `daily` = a daily-native empirical model that reads whole-day inputs (no within-day causal claim); `scenario` = depends
 * on an assumed continuation or imputed input. Propagates through every dependent output and snapshot (weakest wins).
 */
export type CausalResolution = 'eventPrefix' | 'daily' | 'scenario';
const RESOLUTION_RANK: Readonly<Record<CausalResolution, number>> = { eventPrefix: 0, daily: 1, scenario: 2 };

export function weakestResolution(...rs: ReadonlyArray<CausalResolution | null | undefined>): CausalResolution {
  let out: CausalResolution = 'eventPrefix';
  for (const r of rs) if (r && RESOLUTION_RANK[r] > RESOLUTION_RANK[out]) out = r;
  return out;
}

/** The shared anchor assimilation, replanning, current-day views and projection all start from (C2). */
export interface HistoryAnchor {
  planId?: string;
  anchorDate: IsoDate;
  /** Plan-day index of the anchor. */
  anchorDay: number;
  /** Hash of the confirmed engine state at the anchor (snapshot key or state digest). */
  stateHash: string;
  /** Hash of the baseline profile the replay uses. */
  profileHash: string;
  /** App-day rollover rule in force for the history's dates. */
  rolloverH?: number;
  rolloverVersion?: number;
  tz?: string;
}

export type CanonicalEventKind = 'meal' | 'session' | 'fast' | 'steps' | 'sleep' | 'substance' | 'supplement' | 'measurement' | 'subjective' | 'event';

/** Identity of a planned item an actual event explicitly replaces (no nearest-time matching, C2). */
export interface PlanItemLink {
  planId: string;
  version: number;
  /** Prescription item id or session slot key. */
  itemId: string;
}

/**
 * One canonical event after edits/retractions are resolved (C2). Corrections append superseding records; unresolved
 * conflicts stay as `alternatives` (never both counted).
 */
export interface CanonicalEvent {
  /** Stable id: the effective source record's id (or a deterministic group id). */
  id: string;
  kind: CanonicalEventKind;
  /** Every immutable source document id that contributed (original, superseding edits). */
  sourceIds: readonly string[];
  occurrence: OccurrenceTime;
  recordedAt?: IsoInstant;
  provenance: QuantityProvenance;
  /** Replaces exactly this planned item; absent with `extra` true = an explicit extra occurrence. */
  replaces?: PlanItemLink;
  extra?: boolean;
  /** Group id of unresolved alternatives this event belongs to (only one member counts per scenario). */
  alternativeGroup?: string;
  /** Energy of the event, kcal, when known (null = unknown, not zero). */
  energyKcal?: number | null;
}

export type FastEndKind = 'observed' | 'censored' | 'interval' | 'unknown';

/**
 * A zero-calorie or modified fast resolved in absolute time before any day/hour split (C2). The earliest verified caloric
 * event terminates a zero-calorie clock; a running fast is right-censored at `asOf`; intended duration is prospective only.
 */
export interface FastInterval {
  id: string;
  /** `zeroCalorie` = water-only clock; `modified` = a protocol with permitted intake (its identity is not zero intake). */
  protocol: 'zeroCalorie' | 'modified';
  permittedIntake?: { maxKcalPerDay?: number; note?: string };
  start: OccurrenceTime;
  end: { kind: FastEndKind; at?: IsoInstant; interval?: { start: IsoInstant; end: IsoInstant }; terminatingEventId?: string };
  /** Observed duration bounds, h (actual elapsed hours, not date differences). */
  observedHours?: { min: number; max: number | null };
  /** Prescribed/intended duration, h: forecast metadata only, never read by history-driven physiology. */
  intendedHours?: number;
  sourceIds: readonly string[];
}

/**
 * Literal zero-calorie fast interruption (D5-05): the first verified positive metabolizable energy with a known occurrence
 * terminates the clock; unknown energy or time only bounds the end; a known zero does not interrupt. Distinct from the
 * adherence tolerance for a "zero-energy day" (`ADHERENCE_ZERO_DAY_TOLERANCE_KCAL`).
 */
export function zeroCalorieFastInterruption(event: { energyKcal: number | null | undefined; occurrence: OccurrenceTime | null | undefined }): 'terminates' | 'bounded' | 'none' {
  const e = event.energyKcal;
  if (e !== null && e !== undefined && Number.isFinite(e) && e <= 0) return 'none';
  const exact = event.occurrence?.precision === 'exact' && occurrenceBoundsMs(event.occurrence) !== null;
  if (e !== null && e !== undefined && Number.isFinite(e) && e > 0 && exact) return 'terminates';
  return 'bounded';
}
/** Existing adherence/safety tolerance (≤ 50 kcal counts as a zero-intake hour/day for tiers): not a fast-break rule. */
export const ADHERENCE_ZERO_DAY_TOLERANCE_KCAL = 50;

/** A separately named, possibly unknown, imputed remainder for a partially observed day (never a multiplier on observed food). */
export interface LatentRemainder {
  date: IsoDate;
  channel: ExposureChannel;
  /** Named scenario the remainder belongs to ('asPrescribed', 'habitualMix', 'outcomeOnly'…). */
  scenario: string;
  /** Central value in the channel's canonical unit, or null when only bounds/unknown. */
  value: number | null;
  bounds?: { low: number; high: number };
  /** Assumed timing of the remainder; an imputed meal may end a fast only inside this scenario. */
  timing: 'unknown' | 'prescribedSlots' | 'interval';
  interval?: { start: IsoInstant; end: IsoInstant };
  provenance: 'imputed';
}

export type HistoryAssumptionKind =
  | 'prescriptionReplay'
  | 'unknownDayFrozenPrescription'
  | 'habitualBaseline'
  | 'remainderImputation'
  | 'legacyTimeConversion'
  | 'censoredFast'
  | 'asPlannedTap'
  | 'dailyNativeModel';

/** An explicit assumption the history relies on (shown in details, never presented as observation). */
export interface HistoryAssumption {
  id: string;
  kind: HistoryAssumptionKind;
  dates: readonly IsoDate[];
  /** Prescription version used for replay of unknown days (the version in force, not the current head). */
  prescription?: { planId: string; version: number };
  reasonCode: string;
}

export type UncertaintyGroupKind = 'portionMass' | 'sourceComposition' | 'batchYield' | 'retainedOil' | 'reportingBias' | 'occurrenceTime' | 'deviceBias' | 'identityAmbiguity';

/** Shared-error group (C3/C4): sampled once per path for every member, never as independent errors. */
export interface UncertaintyGroup {
  id: string;
  kind: UncertaintyGroupKind;
  memberIds: readonly string[];
  /** Candidate identities for an identity-ambiguity mixture. */
  candidates?: readonly string[];
}

export interface RealisedDay {
  date: IsoDate;
  planDay: number;
  coverage: ChannelCoverageMap;
  attestation?: DayIntakeAttestation;
  /** Canonical events that occurred on this day (by occurrence, half-open day bounds). */
  observedEventIds: readonly string[];
  remainders: readonly LatentRemainder[];
  assumptionIds: readonly string[];
  /** Causal resolution of the day's realised inputs (daily-native dependencies mark the day 'daily'). */
  resolution: CausalResolution;
  /** Prescription in force on the day (frozen version). */
  prescription?: { planId: string; version: number };
}

/** Output of the one pure reducer (C2). Assimilation, replanning, current-day views and projection read the same object. */
export interface RealisedHistory {
  kind: 'vitals.realisedHistory';
  contractVersion: number;
  reducerVersion: number;
  anchor: HistoryAnchor;
  asOf: IsoInstant;
  /** Every elapsed day since the anchor, in order (unknown days included). */
  days: readonly RealisedDay[];
  events: readonly CanonicalEvent[];
  fasts: readonly FastInterval[];
  assumptions: readonly HistoryAssumption[];
  uncertaintyGroups: readonly UncertaintyGroup[];
  /** `realisedHistoryHash` of everything above. */
  contentHash: string;
}

/** Signature of the one reducer (implemented by the living package). Pure: same inputs ⇒ same output and hash. */
export type ReduceRealisedHistory<Doc = unknown> = (anchor: HistoryAnchor, documents: readonly Doc[], asOf: IsoInstant, contractVersion: number) => RealisedHistory;

/** Stable content hash of a realised history (excluding its own `contentHash`). */
export function realisedHistoryHash(h: Omit<RealisedHistory, 'contentHash'> & { contentHash?: string }): string {
  const { contentHash: _ignored, ...rest } = h;
  void _ignored;
  return contentHash(rest);
}

// =====================================================================================================================
// C3 — nutrient, energy and active-ingredient exposure
// =====================================================================================================================

export type CanonicalUnit = 'kcal' | 'g' | 'mg' | 'ug' | 'mmol' | 'mL' | 'count';

/** Canonical unit of each exposure identity (C3). Product mass, active mass, elemental mass and salt mass are never mixed. */
export const EXPOSURE_UNITS = {
  energy: 'kcal',
  protein: 'g',
  carbAvailable: 'g',
  carbReported: 'g',
  sugars: 'g',
  fructose: 'g',
  polyols: 'g',
  fibre: 'g',
  fat: 'g',
  satFat: 'g',
  mufa: 'g',
  pufa: 'g',
  mct: 'g',
  epaDha: 'g',
  ala: 'g',
  linoleic: 'g',
  ethanol: 'g',
  cholesterol: 'mg',
  sodium: 'mg',
  potassium: 'mg',
  calcium: 'mg',
  magnesium: 'mg',
  iron: 'mg',
  zinc: 'mg',
  iodine: 'ug',
  vitD: 'ug',
  b12: 'ug',
  folateDfe: 'ug',
  vitARae: 'ug',
  vitC: 'mg',
  caffeine: 'mg',
  creatine: 'g',
  exogenousBhb: 'g',
  nitrate: 'mmol',
  leucine: 'g',
  water: 'g',
  fluid: 'mL',
} as const satisfies Record<string, CanonicalUnit>;
export type ExposureId = keyof typeof EXPOSURE_UNITS;
export const EXPOSURE_IDS: readonly ExposureId[] = Object.keys(EXPOSURE_UNITS) as ExposureId[];

/**
 * One exposure quantity (C3). `value: null` = unknown (absent analysis); `0` = known zero. Bounds carry a known partial
 * sum (e.g. a lower bound from the known components of an incompletely analysed meal).
 */
export interface ExposureQuantity {
  id: ExposureId;
  value: number | null;
  lowerBound?: number;
  upperBound?: number;
  unit: CanonicalUnit;
  /** Chemical form/basis ('elemental', 'RAE', 'DFE', 'monohydrate', 'availableCarbohydrate'…). */
  form?: string;
  provenance: QuantityProvenance;
  coverage: ChannelCoverage;
  originEventId?: string;
  occurrence?: OccurrenceTime;
  /** Catalogue/label/recipe version the value came from. */
  sourceVersion?: string;
  /** The value exactly as entered or printed (and the printed basis of a label active). */
  original?: { value: number | null; unit: string; text?: string; basis?: string };
  /** (A1-026) Named conversion convention that produced `value` from `original` (e.g. 40 IU/µg vitamin D). */
  convention?: ActiveConversion;
  uncertaintyGroupIds?: readonly string[];
}

/** Decimal exponent of each mass unit relative to grams (integer powers keep g↔mg↔µg conversions exact). */
const MASS_EXP: Readonly<Record<'g' | 'mg' | 'ug', number>> = { g: 0, mg: -3, ug: -6 };
const MASS_ALIASES: Readonly<Record<string, 'g' | 'mg' | 'ug'>> = { g: 'g', gram: 'g', grams: 'g', mg: 'mg', milligram: 'mg', milligrams: 'mg', ug: 'ug', µg: 'ug', mcg: 'ug', microgram: 'ug', micrograms: 'ug' };

/** Mass unit conversion g/mg/µg; null for anything else (mmol, IU, capsules need an explicit identity/basis). */
export function convertMass(value: number, from: string, to: string): number | null {
  const a = MASS_ALIASES[from.trim().toLowerCase()];
  const b = MASS_ALIASES[to.trim().toLowerCase()];
  if (!a || !b || !Number.isFinite(value)) return null;
  const e = MASS_EXP[a] - MASS_EXP[b];
  return e >= 0 ? value * 10 ** e : value / 10 ** -e;
}

/** Free glucose, g per mmol (C3: the energy conversion is not a carbon conversion). */
export const GLUCOSE_G_PER_MMOL = 0.180;
/** Anhydroglucosyl unit of glycogen, g per mmol (C3). */
export const GLYCOSYL_G_PER_MMOL = 0.162;

/**
 * Carbohydrate basis of a source value (D6-01). `totalByDifference` includes fibre (subtract it once), `available` already
 * excludes it, `monosaccharideEquivalent` reports hydrolysed glucose-equivalent mass (not polymer mass), `labelConvention`
 * a declared jurisdiction convention, `legacyTotalByDifference` the pre-contract app schema (labelled legacy-assumed),
 * `unknown` an undeclared imported label.
 */
export type CarbohydrateBasis = 'available' | 'totalByDifference' | 'monosaccharideEquivalent' | 'labelConvention' | 'legacyTotalByDifference' | 'unknown';

export interface CarbohydrateRecord {
  reportedG: number | null;
  basis: CarbohydrateBasis;
  fibreG: number | null;
  /** Polyols by identity, g (never subtracted by one universal factor). */
  polyolsG?: Readonly<Record<string, number>>;
}

/**
 * Available carbohydrate from a reported value (C3/D6-01): subtract fibre exactly once and only when the basis includes it.
 * Unknown basis, or a needed fibre value that is missing, stays unresolved (the reported value is kept, not zeroed).
 */
export function availableCarbohydrate(r: CarbohydrateRecord): { availableG: number | null; status: 'resolved' | 'unresolved'; reason?: string } {
  if (r.reportedG === null || !Number.isFinite(r.reportedG)) return { availableG: null, status: 'unresolved', reason: 'carbUnknown' };
  switch (r.basis) {
    case 'available':
      return { availableG: r.reportedG, status: 'resolved' };
    case 'totalByDifference':
    case 'legacyTotalByDifference':
      if (r.fibreG === null || !Number.isFinite(r.fibreG)) return { availableG: null, status: 'unresolved', reason: 'fibreNeeded' };
      if (r.fibreG > r.reportedG) return { availableG: null, status: 'unresolved', reason: 'fibreExceedsTotal' };
      return { availableG: r.reportedG - r.fibreG, status: 'resolved' };
    case 'monosaccharideEquivalent':
      return { availableG: null, status: 'unresolved', reason: 'monosaccharideEquivalentNotPolymerMass' };
    default:
      return { availableG: null, status: 'unresolved', reason: 'basisUnknown' };
  }
}

/** General Atwater-type accounting factors, kcal/g (declared conventions; a valid source-specific factor replaces one). */
export const GENERAL_ENERGY_FACTORS = { protein: 4, carbAvailable: 4, fat: 9, mct: 8.3, fibre: 2, ethanol: 7 } as const;
export type EnergyFactorKey = keyof typeof GENERAL_ENERGY_FACTORS;

/** Macronutrient grams of one event; `null` = unknown (never zero). MCT is a subset of total fat. */
export interface MacroGrams {
  proteinG: number | null;
  carbAvailableG: number | null;
  fatG: number | null;
  /** Declared MCT inside `fatG`; undefined = not declared separately (all fat at the fat factor). */
  mctG?: number | null;
  fibreG: number | null;
  ethanolG: number | null;
}

const isKnown = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);

/**
 * Convention ME (C3/D6-02): 4P + 4C_available + 9(F − MCT) + 8.3·MCT + 2·fibre + 7·ethanol, kcal, with `factors` replacing
 * the general ones (never stacked). Null when any term is unknown: unknown macros never become zero energy.
 */
export function conventionEnergyKcal(m: MacroGrams, factors: Partial<Record<EnergyFactorKey, number>> = {}): number | null {
  if (!isKnown(m.proteinG) || !isKnown(m.carbAvailableG) || !isKnown(m.fatG) || !isKnown(m.fibreG) || !isKnown(m.ethanolG)) return null;
  if (m.mctG === null) return null;
  const f = { ...GENERAL_ENERGY_FACTORS, ...factors };
  const mct = m.mctG ?? 0;
  if (mct < 0 || mct > m.fatG) return null;
  return f.protein * m.proteinG + f.carbAvailable * m.carbAvailableG + f.fat * (m.fatG - mct) + f.mct * mct + f.fibre * m.fibreG + f.ethanol * m.ethanolG;
}

export type MacroKnowledge = 'known' | 'imputed' | 'unknown';
export type EnergyLedgerStatus = 'consistent' | 'energyOnly' | 'conflict' | 'energyUnknown';
/** Per-nutrient knowledge of one intake event (D6-02/A1-014): an explicit 0 is 'known'; absent analysis is 'unknown'. */
export type MacroMask = Readonly<Record<'protein' | 'carbohydrate' | 'fat' | 'fibre' | 'ethanol', MacroKnowledge>>;

/**
 * Substrate-route availability of an intake event, separate from its energy reconciliation (D6-01/D6-03, A1-031): a
 * consistent energy ledger does not certify the glucose-forming route of grams the engine does not model (identified or
 * identity-unknown polyols). `unmodelled` seeds a named conditional status on the affected glucose/insulin/fuel/ketone
 * outputs; a zero-route computation is that named scenario, never a resolved fact.
 */
export interface SubstrateRoute {
  status: 'modelled' | 'unmodelled';
  /** Unmodelled polyol grams by identity (`'unidentified'` = identity-unknown total). */
  unmodelledPolyolsG?: Readonly<Record<string, number>>;
}

/** Substrate route from an event's polyols (A1-031): any positive polyol mass is an unmodelled route. */
export function substrateRouteOf(polyolsG: Readonly<Record<string, number>> | null | undefined): SubstrateRoute {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(polyolsG ?? {})) if (isKnown(v) && v > 0) out[k] = v;
  return Object.keys(out).length ? { status: 'unmodelled', unmodelledPolyolsG: out } : { status: 'modelled' };
}

/**
 * Per immutable meal snapshot energy ledger (C3/D6-02). Reported ME is preserved and reconciled once; a convention value
 * and the residual are recorded beside it; the macro mask says which grams are known. The intake boundary is reported ME:
 * urinary/fecal deductions already inside ME are never charged again (C7).
 */
export interface EnergyLedger {
  reportedMEKcal: number | null;
  conventionMEKcal: number | null;
  /** The energy the engine uses: reported when present, else convention, else null. */
  reconciledMEKcal: number | null;
  /** reported − convention when both are known (rounding/factor/residual; never deposited in a named substrate pool). */
  residualKcal: number | null;
  method: 'reported' | 'convention' | 'sourceSpecificFactors' | 'none';
  macroMask: MacroMask;
  factors?: Partial<Record<EnergyFactorKey, number>>;
  status: EnergyLedgerStatus;
  boundary: 'reportedME';
  version: number;
  /** (A1-031) Substrate-route availability, independent of `status` (absent = legacy: route not assessed). */
  substrateRoute?: SubstrateRoute;
}

/**
 * Build an energy ledger (D6-02). Partial macros with a reported total: R = E − Σ known terms; R < 0 is a source conflict.
 * Complete macros: the residual is recorded; `conflictToleranceKcal` (no default: the provider declares its tolerance)
 * turns a larger |residual| into a conflict.
 */
export function buildEnergyLedger(input: {
  reportedMEKcal?: number | null;
  macros: MacroGrams;
  factors?: Partial<Record<EnergyFactorKey, number>>;
  imputed?: ReadonlyArray<'protein' | 'carbohydrate' | 'fat' | 'fibre' | 'ethanol'>;
  conflictToleranceKcal?: number;
  /** (A1-031) Polyols by identity, g: their energy is inside the reported total; their substrate route is unmodelled. */
  polyolsG?: Readonly<Record<string, number>> | null;
}): EnergyLedger {
  const m = input.macros;
  const imputed = new Set(input.imputed ?? []);
  const k = (key: 'protein' | 'carbohydrate' | 'fat' | 'fibre' | 'ethanol', v: number | null | undefined): MacroKnowledge => (imputed.has(key) ? 'imputed' : isKnown(v) ? 'known' : 'unknown');
  const macroMask = { protein: k('protein', m.proteinG), carbohydrate: k('carbohydrate', m.carbAvailableG), fat: k('fat', m.fatG), fibre: k('fibre', m.fibreG), ethanol: k('ethanol', m.ethanolG) } as const;
  const reported = isKnown(input.reportedMEKcal) && input.reportedMEKcal >= 0 ? input.reportedMEKcal : null;
  const convention = conventionEnergyKcal(m, input.factors);
  const hasSourceFactors = input.factors !== undefined && Object.keys(input.factors).length > 0;
  const base = {
    conventionMEKcal: convention,
    macroMask,
    boundary: 'reportedME' as const,
    version: CONTRACT_VERSIONS.exposure,
    ...(hasSourceFactors ? { factors: { ...input.factors } } : {}),
    ...(input.polyolsG !== undefined ? { substrateRoute: substrateRouteOf(input.polyolsG) } : {}),
  };
  if (reported === null) {
    return { ...base, reportedMEKcal: null, reconciledMEKcal: convention, residualKcal: null, method: convention === null ? 'none' : hasSourceFactors ? 'sourceSpecificFactors' : 'convention', status: convention === null ? 'energyUnknown' : 'consistent' };
  }
  if (convention === null) {
    const env = residualEnergyEnvelope(reported, m, input.factors);
    return { ...base, reportedMEKcal: reported, reconciledMEKcal: reported, residualKcal: null, method: 'reported', status: env.status === 'conflict' ? 'conflict' : 'energyOnly' };
  }
  const residual = reported - convention;
  const conflict = input.conflictToleranceKcal !== undefined && Math.abs(residual) > input.conflictToleranceKcal;
  return { ...base, reportedMEKcal: reported, reconciledMEKcal: reported, residualKcal: residual, method: 'reported', status: conflict ? 'conflict' : 'consistent' };
}

/**
 * The restricted carbohydrate/fat family for a reported total with unknown C and/or F (D6-02): R = E − Σ known a_i·g_i.
 * Unique when exactly one of C/F is unknown; otherwise the two algebraic endpoints (all-C, all-F) with ΔC = qR/4,
 * ΔF = (1 − q)R/9 for an explicitly chosen q — conditional scenario endpoints, not probability bounds, and q has no default.
 * Unknown protein/fibre/ethanol/MCT make the closure non-unique.
 */
export function residualEnergyEnvelope(
  reportedKcal: number,
  m: MacroGrams,
  factors: Partial<Record<EnergyFactorKey, number>> = {},
):
  | { status: 'conflict'; residualKcal: number }
  | { status: 'notUnique'; residualKcal: null; unknown: readonly string[] }
  | { status: 'complete'; residualKcal: number }
  | { status: 'unique'; residualKcal: number; carbAvailableG: number; fatG: number }
  | { status: 'family'; residualKcal: number; carbOnlyG: number; fatOnlyG: number; split: (q: number) => { carbAvailableG: number; fatG: number } } {
  const f = { ...GENERAL_ENERGY_FACTORS, ...factors };
  const others: string[] = [];
  if (!isKnown(m.proteinG)) others.push('protein');
  if (!isKnown(m.fibreG)) others.push('fibre');
  if (!isKnown(m.ethanolG)) others.push('ethanol');
  if (m.mctG === null) others.push('mct');
  if (others.length) return { status: 'notUnique', residualKcal: null, unknown: others };
  const mct = m.mctG ?? 0;
  let known = f.protein * (m.proteinG as number) + f.fibre * (m.fibreG as number) + f.ethanol * (m.ethanolG as number);
  const cKnown = isKnown(m.carbAvailableG);
  const fKnown = isKnown(m.fatG);
  if (cKnown) known += f.carbAvailable * (m.carbAvailableG as number);
  if (fKnown) known += f.fat * ((m.fatG as number) - mct) + f.mct * mct;
  const R = reportedKcal - known;
  if (R < 0) return { status: 'conflict', residualKcal: R };
  if (cKnown && fKnown) return { status: 'complete', residualKcal: R };
  if (cKnown) return { status: 'unique', residualKcal: R, carbAvailableG: m.carbAvailableG as number, fatG: R / f.fat };
  if (fKnown) return { status: 'unique', residualKcal: R, carbAvailableG: R / f.carbAvailable, fatG: m.fatG as number };
  return {
    status: 'family',
    residualKcal: R,
    carbOnlyG: R / f.carbAvailable,
    fatOnlyG: R / f.fat,
    split: (q: number) => {
      const qq = Math.min(1, Math.max(0, Number.isFinite(q) ? q : 0));
      return { carbAvailableG: (qq * R) / f.carbAvailable, fatG: ((1 - qq) * R) / f.fat };
    },
  };
}

/* ----------------------------------------------------------------------- recipes (C3/D6-04) */

/**
 * Edible mass of a recipe ingredient (D6-04): refuse converts exactly once (as purchased × edible fraction); an
 * as-purchased mass without a known edible fraction has no edible mass (null, not the purchased mass). A legacy
 * unknown basis keeps its original gram arithmetic, flagged.
 */
export function ingredientEdibleMassG(massG: number, basis: 'asPurchased' | 'edible' | 'legacyUnknown', edibleFraction?: number): { edibleG: number | null; legacy: boolean } {
  if (!Number.isFinite(massG) || massG < 0) return { edibleG: null, legacy: false };
  if (basis === 'edible') return { edibleG: massG, legacy: false };
  if (basis === 'legacyUnknown') return { edibleG: massG, legacy: true };
  return isKnown(edibleFraction) && edibleFraction > 0 && edibleFraction <= 1 ? { edibleG: massG * edibleFraction, legacy: false } : { edibleG: null, legacy: false };
}

/**
 * One nutrient of a recipe batch (C3): Σ(edible_i/100 × source_i × retention_i) + added − discarded. An ingredient with
 * unknown composition (or unknown edible mass) makes the batch value unknown; `knownSum` keeps the known part. Retention
 * applies only where a supported factor is given (never twice to an already-cooked source; the caller passes none then).
 */
export function recipeBatchNutrient(
  ingredients: ReadonlyArray<{ edibleG: number | null; per100: number | null; retention?: number }>,
  addedAmount = 0,
  discardedAmount = 0,
): { value: number | null; knownSum: number; unknownIngredients: number } {
  let known = 0;
  let unknown = 0;
  for (const i of ingredients) {
    if (!isKnown(i.edibleG) || !isKnown(i.per100)) {
      unknown++;
      continue;
    }
    const r = isKnown(i.retention) ? i.retention : 1;
    known += (i.edibleG / 100) * i.per100 * r;
  }
  const add = isKnown(addedAmount) ? addedAmount : 0;
  const dis = isKnown(discardedAmount) ? discardedAmount : 0;
  const total = known + add - dis;
  return { value: unknown ? null : total, knownSum: total, unknownIngredients: unknown };
}

/** Concentration per 100 g of the final edible batch (C3): only with a positive measured or sourced final mass; else null. */
export function per100FromBatch(batchAmount: number | null, finalEdibleMassG: number | null | undefined): number | null {
  if (!isKnown(batchAmount) || !isKnown(finalEdibleMassG) || finalEdibleMassG <= 0) return null;
  return (100 * batchAmount) / finalEdibleMassG;
}

/* ----------------------------------------------------------------------- supplement products and actives (D7-04) */

/** Basis of a label's active amount: elemental mineral, a named salt/compound mass, EPA+DHA vs whole oil, protein vs powder… */
export const ACTIVE_BASES = ['elemental', 'sodiumChloride', 'potassiumChloride', 'compound', 'epaDha', 'oilMass', 'protein', 'powderMass', 'nitrate', 'asLabelled'] as const;
export type ActiveBasis = (typeof ACTIVE_BASES)[number];

export interface ProductActive {
  ingredient: ExposureId;
  /** Amount per label serving; null = potency unknown (valid record, safety unchecked). */
  amount: number | null;
  unit: string;
  basis: ActiveBasis;
}

/** A product's label serving (D7-04): what one serving contains, preserved as printed. */
export interface SupplementProduct {
  servingAmount: number | null;
  servingUnit: string;
  actives: readonly ProductActive[];
  labelText?: string;
  /** Catalogue product id or 'label' when transcribed. */
  source?: string;
}

/** Recurrence of taking (D7-04): weekly or alternate-day use keeps its bolus, never a divided daily average only. */
export const SUPPLEMENT_SCHEDULE_KINDS = ['daily', 'weekly', 'alternateDay', 'dates', 'asNeeded', 'unknown'] as const;
export interface SupplementSchedule {
  kind: (typeof SUPPLEMENT_SCHEDULE_KINDS)[number];
  daysOfWeek?: readonly number[];
  dates?: readonly IsoDate[];
  from?: IsoDate;
  to?: IsoDate;
  timesOfDay?: readonly string[];
  servingsPerOccasion?: number;
}

/** Dose input validity and safety assessment are separate statuses (D7-04). */
export type SafetyCheckStatus = 'passed' | 'violation' | 'unchecked' | 'notApplicable';

/** Stoichiometric mass fractions (first principles) for the only salt bases converted automatically. */
export const SODIUM_FRACTION_OF_NACL = 22.98977 / 58.44277;
export const POTASSIUM_FRACTION_OF_KCL = 39.0983 / 74.5513;

/** Dietary vitamin D (D2/D3) label convention: 40 IU = 1 µg (NIH ODS). Applies to vitamin D only, never to other IU actives. */
export const VITAMIN_D_IU_PER_UG = 40;
/**
 * Nitrate ion (NO3⁻) molar-mass convention, mg per mmol (A1-026): the declared rounded value 62.0 (PubChem 62.005 g/mol;
 * the 0.008 % difference is far below label precision). Versioned with `CONTRACT_VERSIONS.exposure`; applies only to the ion
 * itself (basis 'nitrate'), never to a nitrate salt or product mass.
 */
export const NITRATE_ION_MG_PER_MMOL = 62.0;

/** Named conversion conventions applied by `convertActiveAmount` (kept beside the converted value). */
export type ActiveConversion = 'vitaminD40IuPerUg' | 'nitrateIon62mgPerMmol';

/** Unit text normalised for comparison: case, spaces and dots removed ('I.U.' → 'iu'). */
const normUnit = (u: string): string => u.trim().toLowerCase().replace(/[.\s]/g, '');

/**
 * Ingredient-aware amount → the identity's canonical unit (C3/D7-04, A1-026): the ONE converter for catalogue rows, product
 * labels and logged products, so a known label never loses exposure the catalogue path knows.
 *  - mass g/mg/µg (and aliases) convert exactly; mmol stays mmol for an mmol identity;
 *  - vitamin D: IU → µg at `VITAMIN_D_IU_PER_UG` (dietary D2/D3); IU of any other active is refused;
 *  - nitrate: with basis 'nitrate' (the NO3⁻ ion) a g/mg/µg mass → mmol at `NITRATE_ION_MG_PER_MMOL`; a salt/compound or
 *    unspecified-basis mass is refused (no stoichiometry is guessed);
 *  - compound/oil/powder masses never stand in for the active; chloride salts convert only to their own cation.
 * The raw amount/unit/basis stay with the caller's record; `null` carries the reason (unchecked, never zero or safe).
 */
export function convertActiveAmount(
  ingredient: ExposureId,
  amount: number,
  unit: string,
  basis: ActiveBasis = 'asLabelled',
): { value: number; unit: CanonicalUnit; conversion?: ActiveConversion } | { value: null; reason: 'notFiniteNonNegative' | 'basisNotConvertible' | 'unitIncompatible' } {
  if (!Number.isFinite(amount) || amount < 0) return { value: null, reason: 'notFiniteNonNegative' };
  const basisOk =
    basis === 'sodiumChloride' ? ingredient === 'sodium' : basis === 'potassiumChloride' ? ingredient === 'potassium' : basis === 'nitrate' ? ingredient === 'nitrate' : basis !== 'compound' && basis !== 'oilMass' && basis !== 'powderMass';
  if (!basisOk) return { value: null, reason: 'basisNotConvertible' };
  const canon = EXPOSURE_UNITS[ingredient];
  const u = normUnit(unit);
  if (ingredient === 'vitD' && u === 'iu') {
    const ug = amount / VITAMIN_D_IU_PER_UG;
    const v = convertMass(ug, 'ug', canon);
    return v === null ? { value: null, reason: 'unitIncompatible' } : { value: v, unit: canon, conversion: 'vitaminD40IuPerUg' };
  }
  if (canon === 'mmol') {
    if (u === 'mmol') return { value: amount, unit: canon };
    if (ingredient === 'nitrate' && basis === 'nitrate') {
      const mg = convertMass(amount, unit, 'mg');
      if (mg !== null) return { value: mg / NITRATE_ION_MG_PER_MMOL, unit: canon, conversion: 'nitrateIon62mgPerMmol' };
    }
    return { value: null, reason: 'unitIncompatible' };
  }
  let v = convertMass(amount, unit, canon);
  if (v === null) return { value: null, reason: 'unitIncompatible' };
  if (basis === 'sodiumChloride') v *= SODIUM_FRACTION_OF_NACL;
  if (basis === 'potassiumChloride') v *= POTASSIUM_FRACTION_OF_KCL;
  return { value: v, unit: canon };
}

/**
 * Active exposure from a recorded amount of a product (D7-04): dose_i = recorded/servingAmount × active_i, after compatible
 * unit conversion, normalised to the identity's canonical unit. Unknown potency, incompatible units or an unconverted
 * compound basis give `value: null` with the reason (unchecked, never a passed safety inference).
 */
export function activeExposureFromServing(recorded: { amount: number; unit: string }, product: SupplementProduct, meta: { originEventId?: string; occurrence?: OccurrenceTime } = {}): Array<ExposureQuantity & { reason?: string }> {
  const out: Array<ExposureQuantity & { reason?: string }> = [];
  let servings: number | null = null;
  if (isKnown(product.servingAmount) && product.servingAmount > 0 && Number.isFinite(recorded.amount) && recorded.amount >= 0) {
    if (recorded.unit.trim().toLowerCase() === product.servingUnit.trim().toLowerCase()) servings = recorded.amount / product.servingAmount;
    else {
      const conv = convertMass(recorded.amount, recorded.unit, product.servingUnit);
      if (conv !== null) servings = conv / product.servingAmount;
    }
  }
  for (const a of product.actives) {
    const unit = EXPOSURE_UNITS[a.ingredient];
    const base = { id: a.ingredient, unit, provenance: 'label' as const, original: { value: a.amount, unit: a.unit, basis: a.basis }, ...(meta.originEventId ? { originEventId: meta.originEventId } : {}), ...(meta.occurrence ? { occurrence: meta.occurrence } : {}) };
    if (servings === null) {
      out.push({ ...base, value: null, coverage: 'unknown', reason: 'servingIncompatible' });
      continue;
    }
    if (!isKnown(a.amount)) {
      out.push({ ...base, value: null, coverage: 'unknown', reason: 'potencyUnknown' });
      continue;
    }
    // one ingredient-aware converter (A1-026): compound/oil/powder masses refused, chloride salts to their own cation only,
    // vitamin D IU → µg, nitrate-ion mass → mmol
    const conv = convertActiveAmount(a.ingredient, a.amount, a.unit, a.basis);
    if (conv.value === null) {
      out.push({ ...base, value: null, coverage: 'unknown', reason: conv.reason === 'notFiniteNonNegative' ? 'potencyUnknown' : conv.reason });
      continue;
    }
    const form = a.basis === 'elemental' ? 'elemental' : a.basis === 'nitrate' ? 'nitrateIon' : undefined;
    out.push({ ...base, value: servings * conv.value, coverage: 'complete', ...(form ? { form } : {}), ...(conv.conversion ? { convention: conv.conversion } : {}) });
  }
  return out;
}

// =====================================================================================================================
// C5 — enforceable constraints, joint scenario screen and lifecycle certificates
// =====================================================================================================================

export type ConstraintComparator = 'cap' | 'floor';
export type ConstraintCapability = 'enforced' | 'satisfiedByConstruction' | 'unsupported';
export type Applicability = 'applicable' | 'notApplicable' | 'unresolved';

/** What a constraint bounds. Units are fixed per quantity (`CONSTRAINT_UNITS`); magnitude never decides the dimension. */
export type ConstraintQuantity =
  | 'energyPctOfMaintenance'
  | 'deficitPct'
  | 'fatPctEnergy'
  | 'satFatPctEnergy'
  | 'addedSugarPctEnergy'
  | 'proteinPerKg'
  | 'proteinPerDay'
  | 'carbPerDay'
  | 'caffeinePerDay'
  | 'creatinePerDay'
  | 'alcoholPerDay'
  | 'potassiumSupplementPerDay'
  | 'sodiumPerDay'
  | 'potassiumPerDay'
  | 'fluidPerDay'
  | 'fastHours'
  | 'stepsPerDay';

export type ConstraintUnit = '% of maintenance' | '%' | '%E' | 'g/kg/d' | 'g/d' | 'mg/d' | 'mL/d' | 'h' | 'steps/d';

export const CONSTRAINT_UNITS: Readonly<Record<ConstraintQuantity, ConstraintUnit>> = {
  energyPctOfMaintenance: '% of maintenance',
  deficitPct: '%',
  fatPctEnergy: '%E',
  satFatPctEnergy: '%E',
  addedSugarPctEnergy: '%E',
  proteinPerKg: 'g/kg/d',
  proteinPerDay: 'g/d',
  carbPerDay: 'g/d',
  caffeinePerDay: 'mg/d',
  creatinePerDay: 'g/d',
  alcoholPerDay: 'g/d',
  potassiumSupplementPerDay: 'g/d',
  sodiumPerDay: 'mg/d',
  potassiumPerDay: 'mg/d',
  fluidPerDay: 'mL/d',
  fastHours: 'h',
  stepsPerDay: 'steps/d',
};

/** Exposure channels each quantity needs for a final resolved-intake check (missing channel ⇒ unsupported, not pass). */
export const CONSTRAINT_CHANNELS: Readonly<Record<ConstraintQuantity, readonly ExposureChannel[]>> = {
  energyPctOfMaintenance: ['energy'],
  deficitPct: ['energy'],
  fatPctEnergy: ['fat', 'energy'],
  satFatPctEnergy: ['fat', 'energy'],
  addedSugarPctEnergy: ['carbohydrate', 'energy'],
  proteinPerKg: ['protein', 'bodyMass'],
  proteinPerDay: ['protein'],
  carbPerDay: ['carbohydrate'],
  caffeinePerDay: ['caffeine'],
  creatinePerDay: ['supplements'],
  alcoholPerDay: ['alcohol'],
  potassiumSupplementPerDay: ['supplements'],
  sodiumPerDay: ['sodium'],
  potassiumPerDay: ['potassium'],
  fluidPerDay: ['fluids'],
  fastHours: ['fasting'],
  stepsPerDay: ['steps'],
};

/** Weight basis of a per-kg bound (KDIGO-style references need an explicit basis; never silently actual weight). */
export type WeightBasis = 'actual' | 'reference' | 'ffm' | 'clinicianEntered' | 'notApplicable';

export type ConstraintWindow = { kind: 'day' } | { kind: 'rolling'; days: number } | { kind: 'event' } | { kind: 'horizon' };

export interface ConstraintSource {
  kind: 'clinician' | 'marker' | 'screening' | 'user' | 'policy' | 'import';
  /** Rule/marker/lock id or document id the bound came from. */
  ref?: string;
  enteredAt?: IsoInstant;
  /** Origin of a legacy value whose unit was implied (decides whether a deterministic mapping is allowed). */
  legacyOrigin?: 'generatedMarker' | 'importedAmbiguous';
}

/** A typed constraint (C5). One definition per bound; duplicates are intersected, never "first one wins". */
export interface ConstraintDef {
  /** Lock id ('fat-cap', 'caffeine-cap', …) or a clinician envelope bound id. */
  id: string;
  quantity: ConstraintQuantity;
  unit: ConstraintUnit;
  comparator: ConstraintComparator;
  value: number;
  basis: WeightBasis;
  /** Total exposure (food + supplements), supplement-only, or the planner-added scope only. */
  scope: 'total' | 'supplementOnly' | 'plannedAddition';
  window: ConstraintWindow;
  applicability: Applicability;
  /** Mandatory (clinician/marker) bounds block prescription when unsupported; optional ones never block all use. */
  mandatory: boolean;
  source: ConstraintSource;
  policyVersion: number;
  /** %E bounds on a zero-energy day: not applicable (gram bounds still apply) unless the semantics say violation. */
  zeroDenominator?: 'notApplicable' | 'violation';
}

export interface ConstraintConflict {
  key: string;
  cap: ConstraintDef;
  floor: ConstraintDef;
}

export interface ConstraintIntersection {
  /** Strictest bound per key and comparator (caps by min, floors by max), order-independent. */
  merged: ConstraintDef[];
  /** Empty intersections (floor above cap): policy conflicts with their actual units and values. */
  conflicts: ConstraintConflict[];
  /** Definitions that failed validation (unknown unit, non-finite value, rolling window without days…). */
  rejected: Array<{ def: ConstraintDef; reason: string }>;
}

const windowKey = (w: ConstraintWindow): string => (w.kind === 'rolling' ? `rolling:${w.days}` : w.kind);

/** Key under which duplicates are intersected: same quantity, unit, basis, scope and window. */
export function constraintKey(d: Pick<ConstraintDef, 'quantity' | 'unit' | 'basis' | 'scope' | 'window'>): string {
  return `${d.quantity}|${d.unit}|${d.basis}|${d.scope}|${windowKey(d.window)}`;
}

export function validateConstraintDef(d: ConstraintDef): string | null {
  // Persisted/imported clinician facts may be malformed despite their static type. Reject them without throwing or
  // repairing the original into authority; callers retain the original alongside this review reason.
  if (!d || typeof d !== 'object') return 'invalidDefinition';
  if (typeof d.id !== 'string' || !d.id.trim()) return 'missingId';
  if (!Object.prototype.hasOwnProperty.call(CONSTRAINT_UNITS, d.quantity)) return 'unknownQuantity';
  if (CONSTRAINT_UNITS[d.quantity] !== d.unit) return 'unitMismatch';
  if (!Number.isFinite(d.value)) return 'nonFiniteValue';
  if (d.value < 0) return 'negativeValue';
  if (!['actual', 'reference', 'ffm', 'clinicianEntered', 'notApplicable'].includes(d.basis)) return 'unknownBasis';
  if (!['total', 'supplementOnly', 'plannedAddition'].includes(d.scope)) return 'unknownScope';
  if (!['applicable', 'notApplicable', 'unresolved'].includes(d.applicability)) return 'unknownApplicability';
  if (!d.window || typeof d.window !== 'object' || !['day', 'rolling', 'event', 'horizon'].includes(d.window.kind)) return 'unknownWindow';
  if (typeof d.mandatory !== 'boolean') return 'missingMandatory';
  if (!d.source || typeof d.source !== 'object' || !['clinician', 'marker', 'screening', 'user', 'policy', 'import'].includes(d.source.kind)) return 'unknownSource';
  if (!Number.isInteger(d.policyVersion) || d.policyVersion < 1) return 'invalidPolicyVersion';
  if (d.zeroDenominator !== undefined && d.zeroDenominator !== 'notApplicable' && d.zeroDenominator !== 'violation') return 'unknownZeroDenominator';
  if (d.window.kind === 'rolling' && !(Number.isInteger(d.window.days) && d.window.days > 0)) return 'rollingWindowDays';
  if (d.comparator !== 'cap' && d.comparator !== 'floor') return 'unknownComparator';
  if (d.unit === 'g/kg/d' && d.basis === 'notApplicable') return 'perKgNeedsBasis';
  return null;
}

/** Deterministic tie-break between equal bounds so the merged set does not depend on input order. */
const tieKey = (d: ConstraintDef): string => `${d.mandatory ? 0 : 1}|${d.source.kind}|${d.source.ref ?? ''}|${d.id}`;

/**
 * Intersect duplicate constraints (C5): caps by minimum, floors by maximum, independently of order; an empty intersection
 * is a conflict. Unknown mandatory definitions are rejected (the caller treats a rejected mandatory bound as unsupported).
 */
export function intersectConstraints(defs: readonly ConstraintDef[]): ConstraintIntersection {
  const rejected: ConstraintIntersection['rejected'] = [];
  const caps = new Map<string, ConstraintDef>();
  const floors = new Map<string, ConstraintDef>();
  for (const d of defs) {
    const bad = validateConstraintDef(d);
    if (bad) {
      rejected.push({ def: d, reason: bad });
      continue;
    }
    const key = constraintKey(d);
    const pool = d.comparator === 'cap' ? caps : floors;
    const cur = pool.get(key);
    if (!cur) {
      pool.set(key, d);
      continue;
    }
    const strictlyStricter = d.comparator === 'cap' ? d.value < cur.value : d.value > cur.value;
    const tieWins = d.value === cur.value && tieKey(d) < tieKey(cur);
    // the strictest bound implies every looser duplicate, so it inherits their mandatory status
    const mandatory = d.mandatory || cur.mandatory;
    if (strictlyStricter || tieWins) pool.set(key, mandatory === d.mandatory ? d : { ...d, mandatory });
    else if (mandatory !== cur.mandatory) pool.set(key, { ...cur, mandatory });
  }
  const conflicts: ConstraintConflict[] = [];
  for (const [key, cap] of caps) {
    const floor = floors.get(key);
    if (floor && floor.value > cap.value) conflicts.push({ key, cap, floor });
  }
  const merged = [...caps.values(), ...floors.values()].sort((a, b) => (constraintKey(a) + a.comparator < constraintKey(b) + b.comparator ? -1 : 1));
  rejected.sort((a, b) => (tieKey(a.def) < tieKey(b.def) ? -1 : 1));
  conflicts.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { merged, conflicts, rejected };
}

export type BoundStatus = 'pass' | 'violation' | 'unchecked' | 'notApplicable';

/**
 * Evaluate one bound against a resolved exposure interval (C5). With non-negative unknown additions a known lower bound
 * above a cap proves a violation and a known lower bound meeting a floor proves the floor; a cap passes only with a valid
 * upper bound at or below it. Unresolved applicability or missing bounds are `unchecked`.
 */
export function evaluateBound(def: Pick<ConstraintDef, 'comparator' | 'value'>, exposure: { lower: number | null; upper: number | null }, applicability: Applicability = 'applicable'): { status: BoundStatus; margin: number | null } {
  if (applicability === 'notApplicable') return { status: 'notApplicable', margin: null };
  if (applicability === 'unresolved') return { status: 'unchecked', margin: null };
  const lo = isKnown(exposure.lower) ? exposure.lower : null;
  const hi = isKnown(exposure.upper) ? exposure.upper : null;
  if (def.comparator === 'cap') {
    if (lo !== null && lo > def.value) return { status: 'violation', margin: def.value - lo };
    if (hi !== null && (lo === null || hi >= lo) && hi <= def.value) return { status: 'pass', margin: def.value - hi };
    return { status: 'unchecked', margin: null };
  }
  if (lo !== null && lo >= def.value) return { status: 'pass', margin: lo - def.value };
  if (hi !== null && hi < def.value) return { status: 'violation', margin: hi - def.value };
  return { status: 'unchecked', margin: null };
}

/**
 * Coverage of one nutrient total from its included contributions (C1/C3, A1-014): complete only when every included
 * contribution's analysis is known; some known + some unknown = partial (the known sum is a lower bound); none known =
 * unknown. No included contribution gives `unknown` — a confirmed zero comes only from an explicit attestation (C1) or a
 * construction proof, never from an absence.
 */
export function nutrientTotalCoverage(knownContributions: number, unknownContributions: number): ChannelCoverage {
  if (unknownContributions > 0) return knownContributions > 0 ? 'partial' : 'unknown';
  return knownContributions > 0 ? 'complete' : 'unknown';
}

/**
 * The interval a cap/floor is evaluated on (C5, A1-014), from a known sum and its coverage: complete (and an as-planned
 * prescription estimate, which is its own construction) ⇒ [sum, sum]; confirmed zero ⇒ [0, 0]; partial ⇒ [knownSum, ∞);
 * unknown ⇒ [0, ∞) — unless a supported tighter bound is carried. Unknown is never 0 and a lower bound never proves a cap
 * or a deficiency (`evaluateBound` applies the cap/floor duality). `null` = unbounded.
 */
export function exposureInterval(s: { knownSum: number; coverage: ChannelCoverage; lowerBound?: number; upperBound?: number | null }): { lower: number | null; upper: number | null } {
  const known = isKnown(s.knownSum) && s.knownSum >= 0 ? s.knownSum : null;
  const lb = isKnown(s.lowerBound) ? s.lowerBound : null;
  const ub = isKnown(s.upperBound) ? s.upperBound : null;
  switch (s.coverage) {
    case 'confirmedZero':
      return { lower: 0, upper: 0 };
    case 'complete':
    case 'asPlannedEstimate':
      return known === null ? { lower: lb, upper: ub } : { lower: known, upper: known };
    case 'partial': {
      const lower = known === null ? lb : lb === null ? known : Math.max(known, lb);
      return { lower, upper: ub !== null && lower !== null && ub < lower ? null : ub };
    }
    default:
      return { lower: lb ?? 0, upper: ub };
  }
}

export interface ConstraintEvaluation {
  constraintId: string;
  key: string;
  status: BoundStatus;
  capability: ConstraintCapability;
  mandatory: boolean;
  margin: number | null;
  unit: ConstraintUnit;
  reasonCode?: string;
}

/** Safety status shown inline: Verified / Unchecked / Limit conflict / Review / a known violation. */
export type SafetyStatus = 'verified' | 'unchecked' | 'violation' | 'conflict' | 'review';

/**
 * Combine evaluations (C5): a known violation is preserved even when others are unchecked; conflicts next; any mandatory
 * unchecked/unsupported bound makes the whole `unchecked`; `verified` only when every mandatory bound passed by an enforced
 * check or a construction proof. An empty list is `unchecked` (no warnings is not a completed check).
 */
export function combineConstraintStatuses(evals: readonly ConstraintEvaluation[], conflicts: readonly ConstraintConflict[] = []): SafetyStatus {
  if (evals.some((e) => e.status === 'violation')) return 'violation';
  if (conflicts.length) return 'conflict';
  if (evals.length === 0) return 'unchecked';
  for (const e of evals) {
    if (!e.mandatory) continue;
    if (e.capability === 'unsupported') return 'unchecked';
    if (e.status === 'unchecked') return 'unchecked';
  }
  return 'verified';
}

/**
 * Surplus-cap semantics (D4-01): the unit is percent OF maintenance (110 = 110 % of maintenance, 90 = 90 %); a value is
 * never re-read as percent above maintenance by its magnitude. A legacy generated marker value maps deterministically;
 * an imported value without an explicit unit needs review.
 */
export function interpretSurplusCap(input: {
  value: number;
  unit?: string | null;
  origin: 'generatedMarker' | 'imported' | 'user';
}):
  | { status: 'ok'; pctOfMaintenance: number }
  | { status: 'conflict'; pctOfMaintenance: number; reason: 'belowMaintenanceConflictsNoDeficitPolicy' }
  | { status: 'review'; reason: 'ambiguousUnit' | 'nonFinite' } {
  if (!Number.isFinite(input.value) || input.value <= 0) return { status: 'review', reason: 'nonFinite' };
  const explicit = input.unit === '% of maintenance' || input.unit === 'pctOfMaintenance';
  const implicitOk = (input.unit === undefined || input.unit === null || input.unit === '') && input.origin === 'generatedMarker';
  if (!explicit && !implicitOk) return { status: 'review', reason: 'ambiguousUnit' };
  // 90 means 90 % of maintenance (never 190 %): below maintenance it contradicts a surplus/no-deficit cap
  if (input.value < 100) return { status: 'conflict', pctOfMaintenance: input.value, reason: 'belowMaintenanceConflictsNoDeficitPolicy' };
  return { status: 'ok', pctOfMaintenance: input.value };
}

/* ---------------------------------------------------------------- joint scenario screen (D4-03) */

/** Existing declared design screen: alpha = 0.10 of model scenarios may fail (policy, not a human-safety probability). */
export const SAFETY_ALPHA = 0.1;
/** Reserved safety-audit stream size per budget tier = the configured selection-ensemble size (C5). */
export const SAFETY_AUDIT_ENSEMBLE: Readonly<Record<'S' | 'M' | 'L' | 'X', number>> = { S: 16, M: 32, L: 64, X: 128 };

/** Exact passes needed: ceil((1 − alpha)·M) (15 of 16 at alpha 0.1). M ≤ 0 ⇒ Infinity (cannot pass). */
export function requiredJointPasses(M: number, alpha: number = SAFETY_ALPHA): number {
  if (!(M > 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil((1 - alpha) * M - 1e-9);
}

export interface JointScreenResult {
  status: 'pass' | 'fail' | 'unchecked';
  /** Scenario members evaluated. */
  M: number;
  passes: number;
  required: number | null;
  /** Indices of members whose joint pass failed. */
  failedMembers: number[];
  /** Required margin ids missing (or non-finite) in at least one member. */
  missing: string[];
  alpha: number;
  reasonCode: 'ok' | 'noMembers' | 'missingMargin' | 'unresolvedApplicability' | 'belowRequired' | 'knownViolation';
}

/**
 * Joint model-scenario screen (C5/D4-03): jointPass_m = all(margin_jm ≥ 0) over every required margin; accept when
 * passes ≥ ceil(0.9·M). M = 0, a missing/non-finite required margin or unresolved applicability is `unchecked`. A
 * deterministic known violation (`knownViolation`) fails regardless of the scenario share. Not an IID confidence bound.
 */
export function jointSafetyScreen(
  members: ReadonlyArray<Readonly<Record<string, number | null | undefined>>>,
  required: readonly string[],
  opts: { alpha?: number; applicabilityUnresolved?: boolean; knownViolation?: boolean } = {},
): JointScreenResult {
  const alpha = opts.alpha ?? SAFETY_ALPHA;
  const M = members.length;
  const base = { M, alpha, failedMembers: [] as number[], missing: [] as string[] };
  if (opts.knownViolation) return { ...base, status: 'fail', passes: 0, required: M > 0 ? requiredJointPasses(M, alpha) : null, reasonCode: 'knownViolation' };
  if (opts.applicabilityUnresolved) return { ...base, status: 'unchecked', passes: 0, required: null, reasonCode: 'unresolvedApplicability' };
  if (M === 0) return { ...base, status: 'unchecked', passes: 0, required: null, reasonCode: 'noMembers' };
  const missing = new Set<string>();
  const failed: number[] = [];
  let passes = 0;
  members.forEach((m, i) => {
    let ok = true;
    for (const id of required) {
      const v = m[id];
      if (!isKnown(v)) {
        missing.add(id);
        ok = false;
      } else if (v < 0) ok = false;
    }
    if (ok) passes++;
    else failed.push(i);
  });
  const req = requiredJointPasses(M, alpha);
  if (missing.size) return { ...base, status: 'unchecked', passes, required: req, failedMembers: failed, missing: [...missing].sort(), reasonCode: 'missingMargin' };
  return { ...base, status: passes >= req ? 'pass' : 'fail', passes, required: req, failedMembers: failed, reasonCode: passes >= req ? 'ok' : 'belowRequired' };
}

/**
 * One-sided lower confidence bound on the pass rate after N IID scenario draws with zero failures: (1 − c)^(1/N)
 * (0.829 for 16, 0.902 for 29 at c = 0.95). Valid only for a declared IID final audit of the declared model distribution;
 * never for LHS selection draws and never a human-safety rate.
 */
export function iidZeroFailureLowerBound(N: number, confidence = 0.95): number | null {
  if (!(N > 0) || !(confidence > 0 && confidence < 1)) return null;
  return Math.pow(1 - confidence, 1 / N);
}

/**
 * Optional scalar ranking of margins (D4-03): each margin is divided by a declared positive same-unit scale before any
 * aggregation; an undeclared or non-positive scale returns null (never sum raw g, kcal and mmol shortfalls).
 */
export function normalizedMarginScore(margins: Readonly<Record<string, number>>, scales: Readonly<Record<string, number>>): number | null {
  let worst = Number.POSITIVE_INFINITY;
  for (const [id, v] of Object.entries(margins)) {
    const s = scales[id];
    if (!isKnown(s) || s <= 0 || !isKnown(v)) return null;
    worst = Math.min(worst, v / s);
  }
  return worst === Number.POSITIVE_INFINITY ? null : worst;
}

/* ---------------------------------------------------------------- certificates (C5) */

/** Lifecycle points where current safety is validated afresh (C5); a stored proposal or worker output never authorizes. */
export type LifecycleBoundary = 'run' | 'start' | 'adopt' | 'resume' | 'replan' | 'scenarioStart' | 'safetyChange' | 'medicationChange' | 'symptomChange';

/** Everything a certificate binds (C5). Any mismatch invalidates it. */
export interface CertificateInputs {
  /** The final repaired, resolved schedule. */
  schedule: unknown;
  initialStateHash: string;
  historyHash?: string;
  profile: unknown;
  screening: unknown;
  symptoms?: unknown;
  /** Locks/constraints with units, active products, etc. */
  constraints: readonly ConstraintDef[];
  actives?: unknown;
  versions: { engine: string; registry: string; parameters?: string; policy: number; contracts: string };
  requiredMargins: readonly string[];
  population?: string;
  drawProtocol: { stream: 'safetyAudit'; M: number; seed: number | string; method: 'lhs' | 'independent' };
}

export function certificateFingerprint(inputs: CertificateInputs): string {
  return contentHash({ v: CONTRACT_VERSIONS.safetyCertificate, ...inputs, requiredMargins: [...inputs.requiredMargins].sort() });
}

/**
 * A safety certificate for one frozen candidate (C5/D4-03). One automatic final audit per decision episode; failed audits
 * are kept in `history`; a deterministic recheck of the same fingerprint is not a new sampling opportunity.
 */
export interface SafetyCertificate {
  kind: 'vitals.safetyCertificate';
  version: number;
  fingerprint: string;
  episodeId: string;
  /** 1 = the automatic audit; later explicitly changed episodes get a new episode id, not attempt 2 of the same one. */
  attempt: number;
  status: 'verified' | 'failed' | 'unchecked';
  audit: JointScreenResult;
  constraintStatus: SafetyStatus;
  createdAt: IsoInstant;
  /**
   * The required hard margins and the declared audit draw protocol the fingerprint was computed with (optional for
   * certificates stored before 2026-10-18). A lifecycle revalidation recomputes the fingerprint with these; a certificate
   * without them can never be reported valid (status at most Unchecked).
   */
  requiredMargins?: readonly string[];
  drawProtocol?: CertificateInputs['drawProtocol'];
  /** Earlier audits of the same episode or of superseded episodes (never discarded). */
  history?: ReadonlyArray<{ fingerprint: string; episodeId: string; status: SafetyCertificate['status']; at: IsoInstant }>;
}

/** True only for a verified certificate whose fingerprint equals the current one. A boolean `chanceChecked` never authorizes. */
export function certificateAuthorizes(cert: SafetyCertificate | null | undefined, currentFingerprint: string): boolean {
  return !!cert && cert.kind === 'vitals.safetyCertificate' && cert.version === CONTRACT_VERSIONS.safetyCertificate && cert.status === 'verified' && cert.fingerprint === currentFingerprint;
}

/* ---------------------------------------------------------------- symptoms, envelopes, suggestion policy (D4-02, D4-07, D7-03) */

export type SymptomCategory = 'exertionalChestDiscomfort' | 'syncopeOrPresyncope' | 'disproportionateBreathlessness' | 'palpitations' | 'dizziness' | 'musculoskeletal' | 'other';
export type SymptomStatus = 'new' | 'unexplained' | 'reviewNeeded' | 'resolved' | 'unknown';

/** A reported symptom (D4-02). Legacy yes/prefer-not screening answers migrate to `reviewNeeded`, not a diagnosis. */
export interface SymptomReport {
  id: string;
  category: SymptomCategory;
  status: SymptomStatus;
  occurredOn?: IsoDate;
  reportedAt: IsoInstant;
  context?: 'exertional' | 'rest' | 'unknown';
  source: 'user' | 'clinician' | 'legacyScreening';
}

/** Concerning cardiorespiratory categories that suspend autonomous exercise progression while unresolved (C5/D4-02). */
export const CONCERNING_EXERTIONAL_SYMPTOMS: ReadonlySet<SymptomCategory> = new Set<SymptomCategory>(['exertionalChestDiscomfort', 'syncopeOrPresyncope', 'disproportionateBreathlessness']);

export function isConcerningUnresolved(s: SymptomReport): boolean {
  return CONCERNING_EXERTIONAL_SYMPTOMS.has(s.category) && s.status !== 'resolved' && s.status !== 'unknown';
}

/**
 * A reviewed exercise envelope (D4-02): permitted domains, intensity convention and unit, step ceiling, progression and
 * dates. No universal clearance expiry; a missing permitted domain does not authorize that domain; a new materially
 * different symptom invalidates it regardless of date.
 */
export interface ClinicianExerciseEnvelope {
  id: string;
  assessedAt: IsoDate;
  reviewBy?: IsoDate;
  revokedAt?: IsoDate;
  permitted: ReadonlyArray<'resistance' | 'cardio' | 'walking' | 'steps' | 'other'>;
  intensity?: { convention: 'MET' | 'RPE' | 'pctHRmax' | 'pctVo2max' | 'talkTest'; max: number; unit: string };
  stepsCeiling?: number;
  progressionAllowed: boolean;
  /** Symptom ids the assessment covered. */
  coversSymptomIds?: readonly string[];
  source: 'selfEnteredClinician' | 'document';
}

/** Clinician-directed nutrition envelope (D4-07): explicit stage/dialysis/stability, weight basis, bounds and dates. */
export interface ClinicalNutritionEnvelope {
  id: string;
  condition: 'ckd' | 'other';
  stage?: string;
  dialysis?: 'none' | 'hemodialysis' | 'peritoneal' | 'unknown';
  stability: 'stable' | 'unstable' | 'unknown';
  weightBasis: WeightBasis;
  bounds: readonly ConstraintDef[];
  assessedAt: IsoDate;
  reviewBy?: IsoDate;
  source: 'selfEnteredClinician' | 'document';
  /** The clinician's own kg for per-kg bounds (required unless `weightBasis` is 'actual'); never the app's reference weight. */
  basisWeightKg?: number;
  /** When that kg was set or measured. */
  basisWeightOn?: IsoDate;
  /** What a clinician-entered kg is. */
  basisWeightKind?: 'dry' | 'adjusted' | 'ideal' | 'usual' | 'other';
  /** Frailty as the clinician recorded it (context only). */
  frailty?: 'yes' | 'no' | 'unknown';
  /** A recorded withdrawal (kept with its date); the envelope no longer applies from then. */
  revokedAt?: IsoDate;
}

/** Renal context (D4-07/D7-05): legacy kidneyDisease=true migrates to `contextIncomplete`, never to a stage. */
export type RenalContextStatus = 'none' | 'contextIncomplete' | 'envelopeEntered' | 'priorAbnormalityReview';

/** Tri-state screening answer: unknown/prefer-not stay distinct from a negative screen. */
export type ScreeningAnswer = 'yes' | 'no' | 'unknown' | 'preferNot';

/** Shared suggestion policy states (D7-03). Logging an already-taken product is always allowed; its status shows separately. */
export type SuggestionPolicyState = 'allow' | 'caution' | 'clinicianReview' | 'noSuggest' | 'unchecked';

export interface SuggestionDecision {
  /** Product, ingredient or lever id. */
  subject: string;
  state: SuggestionPolicyState;
  reasons: ReadonlyArray<{ rule: string; source: 'screening' | 'marker' | 'clinician' | 'user' | 'policy'; applicability: Applicability; sampleDate?: IsoDate; stale?: boolean }>;
}

// =====================================================================================================================
// C6 — goal capability, status propagation, uncertainty metadata and inline expression
// =====================================================================================================================

/**
 * Status of an output, travelling beside its number (C6). Statuses that forbid interpreting the number make every internal
 * finite compatibility value invisible to objectives and UI.
 */
export type OutputStatus =
  | 'observed'
  | 'verified'
  | 'estimated'
  | 'partial'
  | 'scenario'
  | 'limited'
  | 'exploratory'
  | 'review'
  | 'unchecked'
  | 'unknown'
  | 'notFound'
  | 'outOfDomain'
  | 'modelLimit'
  | 'unavailable'
  | 'conflict';

/** Inline status words (C6). Short, no explainer; details belong in the info sheet. */
export const STATUS_LABEL: Readonly<Record<OutputStatus, string>> = {
  observed: 'Observed',
  verified: 'Verified',
  estimated: 'Estimated',
  partial: 'Partial',
  scenario: 'Scenario',
  limited: 'Limited',
  exploratory: 'Exploratory',
  review: 'Review',
  unchecked: 'Unchecked',
  unknown: 'Unknown',
  notFound: 'Not found',
  outOfDomain: 'Unsupported',
  modelLimit: 'Model limit',
  unavailable: 'Unsupported',
  conflict: 'Limit conflict',
};

/** Statuses whose value/range may be shown and used (objectives, charts). */
export const INTERPRETABLE_STATUSES: ReadonlySet<OutputStatus> = new Set<OutputStatus>(['observed', 'verified', 'estimated', 'partial', 'scenario', 'limited', 'exploratory']);

/** Statuses whose number an optimizer may use as a supported objective (scenario/exploratory values never count as benefit). */
export const OBJECTIVE_STATUSES: ReadonlySet<OutputStatus> = new Set<OutputStatus>(['observed', 'verified', 'estimated']);

/**
 * Kind of uncertainty a range expresses (C6/D8-02): `parameterSensitivity` ranges have unvalidated predictive coverage;
 * `calibratedPrediction` only after held-out evaluation; `conditionalResidual` is not a full predictive interval.
 */
export type UncertaintyKind = 'none' | 'measurementRepeatability' | 'parameterSensitivity' | 'scenario' | 'conditionalResidual' | 'heuristic' | 'calibratedPrediction';
export type CoverageStatus = 'notApplicable' | 'unvalidated' | 'heldOutValidated';

/** The practical boundary type for any number that crosses a recorder, optimizer, JSON, worker or chart boundary (C6). */
export interface StatusValue {
  status: OutputStatus;
  value?: number;
  range?: readonly [number, number];
  unit: string;
  uncertaintyKind: UncertaintyKind;
  coverageStatus: CoverageStatus;
  reasonCode: string;
  /** Pointer to the info-sheet content (warrant, source, population, assumptions). */
  detailsRef?: string;
}

/**
 * Build a StatusValue, refusing to carry non-finite numbers (C6): a NaN/Infinity value or range bound is dropped and an
 * interpretable status degrades to `unknown`. A range is ordered low→high; a calibrated-coverage claim requires
 * `calibratedPrediction` with `heldOutValidated` (anything else is forced to `unvalidated`).
 */
export function statusValue(input: Omit<StatusValue, 'uncertaintyKind' | 'coverageStatus' | 'reasonCode'> & Partial<Pick<StatusValue, 'uncertaintyKind' | 'coverageStatus' | 'reasonCode'>>): StatusValue {
  const value = isKnown(input.value) ? input.value : undefined;
  const range = input.range && isKnown(input.range[0]) && isKnown(input.range[1]) ? ([Math.min(input.range[0], input.range[1]), Math.max(input.range[0], input.range[1])] as const) : undefined;
  let status = input.status;
  const hadNumber = input.value !== undefined || input.range !== undefined;
  if (hadNumber && value === undefined && range === undefined && INTERPRETABLE_STATUSES.has(status)) status = 'unknown';
  const kind: UncertaintyKind = range ? (input.uncertaintyKind ?? 'parameterSensitivity') : (input.uncertaintyKind ?? 'none');
  const coverage: CoverageStatus = kind === 'none' ? 'notApplicable' : kind === 'calibratedPrediction' && input.coverageStatus === 'heldOutValidated' ? 'heldOutValidated' : 'unvalidated';
  return {
    status,
    ...(value !== undefined ? { value } : {}),
    ...(range ? { range } : {}),
    unit: input.unit,
    uncertaintyKind: kind,
    coverageStatus: coverage,
    reasonCode: input.reasonCode ?? (status === input.status ? 'ok' : 'nonFiniteDropped'),
    ...(input.detailsRef ? { detailsRef: input.detailsRef } : {}),
  };
}

const NBSP = ' ';
const MINUS = '−';
const EN_DASH = '–';

function fmtNumber(x: number, decimals: number): string {
  const fixed = Math.abs(x).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = x < 0 && Number(fixed) !== 0 ? MINUS : '';
  return `${sign}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

/** "71–74 kg": en dash, true minus, grouped thousands, unit inline (DESIGN.md number grammar). */
export function formatRange(range: readonly [number, number], unit: string, decimals = 0): string {
  return `${fmtNumber(range[0], decimals)}${EN_DASH}${fmtNumber(range[1], decimals)}${unit ? `${NBSP}${unit}` : ''}`;
}

/** Inline readout (C6): a range with unit when the status allows and a range exists, the value for observations, else the status word. */
export function inlineStatusText(sv: StatusValue, decimals = 0): string {
  if (INTERPRETABLE_STATUSES.has(sv.status)) {
    if (sv.range) return formatRange(sv.range, sv.unit, decimals);
    if (sv.value !== undefined && (sv.status === 'observed' || sv.status === 'verified' || sv.status === 'partial')) return `${fmtNumber(sv.value, decimals)}${sv.unit ? `${NBSP}${sv.unit}` : ''}`;
  }
  return STATUS_LABEL[sv.status];
}

/** Severity order for propagation: later = worse. */
const STATUS_RANK: Readonly<Record<OutputStatus, number>> = {
  observed: 0,
  verified: 0,
  estimated: 1,
  partial: 2,
  scenario: 3,
  limited: 3,
  exploratory: 4,
  review: 5,
  unchecked: 5,
  unknown: 6,
  notFound: 6,
  outOfDomain: 7,
  modelLimit: 7,
  unavailable: 8,
  conflict: 8,
};

export function worstStatus(...ss: ReadonlyArray<OutputStatus | null | undefined>): OutputStatus {
  let out: OutputStatus = 'observed';
  for (const s of ss) if (s && STATUS_RANK[s] > STATUS_RANK[out]) out = s;
  return out;
}

/**
 * What an upstream status does to a mathematically dependent output (C6): a scenario/unsupported upstream makes the
 * dependent a conditional scenario (joint conditional scenarios stay usable; no newly certified downstream forecast);
 * a model-limit termination propagates as is; safety-review statuses do not travel through physiology.
 */
export function dependentStatusOf(upstream: OutputStatus): OutputStatus | null {
  switch (upstream) {
    case 'partial':
    case 'scenario':
    case 'limited':
    case 'exploratory':
    case 'unknown':
    case 'unavailable':
    case 'outOfDomain':
      return 'scenario';
    case 'modelLimit':
      return 'modelLimit';
    default:
      return null;
  }
}

/**
 * Mathematical dependencies between engine outputs used for status closure (C6; `CONTRACT_VERSIONS.statusPropagation`).
 * Keys/values are series ids; an entry lists the outputs the key is computed from. A scenario/unsupported upstream makes
 * the dependant a conditional scenario (`dependentStatusOf`); cycles are closed to a fixpoint. Edges (A1-013, A1-022):
 *  - tissue: the energy balance and its partition → lean and fat; glycogen-energy change → fat. Training accretion is NOT
 *    an edge into lean/skeletal muscle: `rtMuscleGain` always carries the uncalibrated growth-state scenario
 *    (`growthBurnInAnchor`), which must not demote every tissue forecast. A run-specific muscle-dose condition (an unknown
 *    hard-set count, A1-022) is seeded by its provider on `leanTissue`/`skeletalMuscle` from the affected day, and the
 *    edges below carry it to fat, scale, regional and nitrogen outputs;
 *  - scale: fat + lean + labile water (glycogen-bound water, ECF shift, gut contents) → scale weight, body fat %, inferred
 *    non-fat scale mass;
 *  - regional/derived tissue: fat → regional fat; lean/skeletal muscle → regional muscle; lean change → nitrogen balance;
 *  - later mass-dependent expenditure: lean/fat → RMR; scale weight → movement and exercise energy; components → TDEE,
 *    maintenance, energy balance, adaptive thermogenesis;
 *  - fuel: liver/muscle glycogen → total glycogen and its water; liver glycogen → ketones → ketosis state/hours;
 *  - markers: fat/liver fat → the cardiometabolic markers (as before).
 * Independent observations and outputs with no such path (e.g. hunger, sleep quality) are never touched.
 */
export const OUTPUT_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  // tissue and partition
  leanTissue: ['energyBalance'],
  fatMass: ['leanTissue', 'energyBalance', 'glycogenTotal'],
  skeletalMuscle: ['leanTissue'],
  rtMuscleGain: ['leanTissue'],
  strength: ['rtMuscleGain', 'skeletalMuscle'],
  nitrogenBalance: ['leanTissue'],
  // scale and fractions
  glycogenWater: ['glycogenTotal'],
  waterWeight: ['glycogenWater', 'ecfShift', 'gutContent'],
  scaleWeight: ['fatMass', 'leanTissue', 'waterWeight'],
  leanMass: ['leanTissue', 'fatMass', 'scaleWeight'],
  bodyFatPct: ['fatMass', 'leanTissue', 'scaleWeight'],
  // regional and derived tissue
  waist: ['fatMass'],
  visceralFat: ['fatMass'],
  fatTrunk: ['fatMass'],
  fatArms: ['fatMass'],
  fatLegs: ['fatMass'],
  muscleArms: ['skeletalMuscle', 'leanTissue'],
  muscleLegs: ['skeletalMuscle', 'leanTissue'],
  muscleTrunk: ['skeletalMuscle', 'leanTissue'],
  // later mass-dependent expenditure
  rmr: ['leanTissue', 'fatMass'],
  neat: ['scaleWeight'],
  exerciseEE: ['scaleWeight'],
  exerciseEnergy: ['scaleWeight'],
  stepsEnergy: ['scaleWeight'],
  tdee: ['rmr', 'tef', 'neat', 'exerciseEE'],
  maintenance: ['tdee'],
  energyBalance: ['tdee', 'tef'],
  metabolicAdaptation: ['energyBalance'],
  atResting: ['energyBalance'],
  atNonResting: ['energyBalance'],
  energyAvailability: ['leanTissue', 'exerciseEE'],
  // fuel
  glycogenTotal: ['liverGlycogen', 'muscleGlycogen'],
  bhb: ['liverGlycogen'],
  bhbEndpoint: ['liverGlycogen'],
  totalKetones: ['liverGlycogen'],
  ketosisState: ['bhb'],
  hoursInKetosis: ['bhb'],
  // markers
  liverFat: ['fatMass'],
  ldl: ['fatMass'],
  apoB: ['ldl'],
  triglycerides: ['fatMass'],
  insulinSensitivity: ['fatMass', 'liverFat'],
  fastingGlucose: ['insulinSensitivity'],
  sbp: ['fatMass'],
  crp: ['fatMass'],
  leptin: ['fatMass'],
};

/** Close statuses over `deps` to a fixpoint: each output takes the worse of its own and its dependencies' induced status. */
export function closeStatuses(statuses: Readonly<Record<string, OutputStatus>>, deps: Readonly<Record<string, readonly string[]>> = OUTPUT_DEPENDENCIES): Record<string, OutputStatus> {
  const out: Record<string, OutputStatus> = { ...statuses };
  for (let iter = 0, changed = true; changed && iter < 64; iter++) {
    changed = false;
    for (const [node, ups] of Object.entries(deps)) {
      const cur: OutputStatus | undefined = out[node];
      let next = cur;
      for (const u of ups) {
        const us = out[u];
        const induced = us ? dependentStatusOf(us) : null;
        if (induced && (next === undefined || STATUS_RANK[induced] > STATUS_RANK[next])) next = induced;
      }
      if (next !== undefined && next !== cur) {
        out[node] = next;
        changed = true;
      }
    }
  }
  return out;
}

/** A status with its provenance, as `SeriesStatusMeta` carries it (C6). */
export interface StatusMetaLike {
  status: OutputStatus;
  reasonCode: string;
  /** First plan day the status applies from (absent = the whole run, i.e. day 0). */
  fromDay?: number;
  uncertaintyKind?: UncertaintyKind;
  resolution?: CausalResolution;
}

/** A closed status: an induced one names its root output (`inducedBy`) and keeps the root's reason (`rootReason`). */
export type ClosedStatusMeta = StatusMetaLike & { inducedBy?: string; rootReason?: string };

/**
 * `closeStatuses` with provenance (C6, A1-013): an induced status keeps the source's first affected day (the earliest day
 * among the upstreams inducing it), its uncertainty kind and its root reason, so a minimal series mask and a resumed run see
 * the same status, onset and reason as the full run. An output's own status is kept when it is at least as strong; an equal
 * induced status can only move its onset EARLIER. Reason of an induced status: `dependsOn:<root output>`.
 */
export function closeStatusMeta(statuses: Readonly<Record<string, StatusMetaLike>>, deps: Readonly<Record<string, readonly string[]>> = OUTPUT_DEPENDENCIES): Record<string, ClosedStatusMeta> {
  const out: Record<string, ClosedStatusMeta> = {};
  for (const [id, m] of Object.entries(statuses)) out[id] = { ...m };
  const day = (m: StatusMetaLike): number => (isKnown(m.fromDay) && m.fromDay > 0 ? m.fromDay : 0);
  for (let iter = 0, changed = true; changed && iter < 256; iter++) {
    changed = false;
    for (const [node, ups] of Object.entries(deps)) {
      for (const u of ups) {
        const up = out[u];
        const induced = up ? dependentStatusOf(up.status) : null;
        if (!up || !induced) continue;
        const cur = out[node];
        const root = up.inducedBy ?? u;
        const rootReason = up.inducedBy ? (up.rootReason ?? up.reasonCode) : up.reasonCode;
        const kind: UncertaintyKind = up.uncertaintyKind ?? (induced === 'scenario' ? 'scenario' : 'none');
        if (!cur || STATUS_RANK[induced] > STATUS_RANK[cur.status]) {
          out[node] = {
            status: induced,
            reasonCode: `dependsOn:${root}`,
            inducedBy: root,
            rootReason,
            uncertaintyKind: kind,
            ...(up.fromDay !== undefined ? { fromDay: up.fromDay } : {}),
            ...(up.resolution ? { resolution: up.resolution } : {}),
          };
          changed = true;
        } else if (STATUS_RANK[induced] === STATUS_RANK[cur.status] && day(up) < day(cur)) {
          const next: ClosedStatusMeta = { ...cur };
          if (up.fromDay !== undefined) next.fromDay = up.fromDay;
          else delete next.fromDay;
          out[node] = next;
          changed = true;
        }
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- warrants and goal capability */

export type WarrantType =
  | 'analyticallyTrue'
  | 'firstPrinciples'
  | 'empiricalFormal'
  | 'causallyCoherent'
  | 'physiologicallyIntuitive'
  | 'ecologicallyValid'
  | 'functionallyTrue'
  | 'tacitKnowledge'
  | 'eminenceBased'
  | 'commonSense'
  | 'timeTested'
  | 'livedExperience';

export interface Warrant {
  type: WarrantType;
  confidence: 'high' | 'moderate' | 'low' | 'provisional';
  /** What the warrant covers ("direction only", "population mean, not personal response"). */
  scope?: string;
}

/**
 * Availability of an outcome as a goal (C6): `supported` = actionable planning objective; `scenario` = usable as a labelled,
 * bounded planning objective (functional/tacit/mechanistic warrant, personal calibration pending); `observedOnly` = monitor
 * observations, no forecast objective; `unavailable` = no objective, no benefit credit.
 */
export type CapabilityAvailability = 'supported' | 'scenario' | 'observedOnly' | 'unavailable';
export type ObjectiveShape = 'target' | 'maximise' | 'minimise' | 'band';

/** Identity of a saved objective, distinct from raw body-fat observations and frozen historical forecasts. */
export interface GoalEndpointSemantics {
  version: 1;
  operator: 'tissueFatFraction' | 'scaleBodyFatWake' | 'legacyUnknown';
  timeBasis: 'endOfDay' | 'wake' | 'unknown';
  /** Trustworthy original operator provenance only; never inferred from a legacy number. */
  provenance?: string;
}

export const CURRENT_TISSUE_FAT_ENDPOINT: Readonly<GoalEndpointSemantics> = {
  version: 1, operator: 'tissueFatFraction', timeBasis: 'endOfDay',
};

/** Only an explicit current operator/sample pair confirms tissue intent. Capability versions are not confirmation. */
export function hasCurrentTissueFatEndpoint(endpoint: GoalEndpointSemantics | null | undefined): boolean {
  return endpoint?.version === 1 && endpoint.operator === 'tissueFatFraction' && endpoint.timeBasis === 'endOfDay';
}

/** Read adapter only: preserve explicit provenance; an unstamped saved BF value has unknown legacy basis. */
export function goalEndpointSemanticsOf(metric: string, endpoint?: GoalEndpointSemantics): GoalEndpointSemantics | undefined {
  if (endpoint) return endpoint;
  return metric === 'bodyFatPct' ? { version: 1, operator: 'legacyUnknown', timeBasis: 'unknown' } : undefined;
}

/** Coverage of an aggregate endpoint. Incomplete aggregates withhold bands and target shares instead of renormalizing. */
export interface EndpointAvailability {
  version: 1;
  policy: 'allRequiredMembers';
  status: 'complete' | 'partial' | 'unavailable';
  attempted: number;
  available: number;
  excluded: number;
  reasons: readonly string[];
  memberAvailable?: readonly boolean[];
}

/** Build coverage from every attempted member; finite compatibility values never participate in this decision. */
export function endpointAvailability(memberAvailable: readonly boolean[], reasons: readonly string[] = []): EndpointAvailability {
  const attempted = memberAvailable.length;
  const available = memberAvailable.filter(Boolean).length;
  return {
    version: 1, policy: 'allRequiredMembers', status: attempted > 0 && available === attempted ? 'complete' : available > 0 ? 'partial' : 'unavailable',
    attempted, available, excluded: attempted - available, reasons: [...new Set(reasons)], memberAvailable: [...memberAvailable],
  };
}

/** Outcome-specific goal capability (C6/D4-05). Formal trial grade alone never decides `availability`. */
export interface GoalCapability {
  availability: CapabilityAvailability;
  /** What is estimated, in words ("tissue fat mass at end of horizon, kg"). */
  estimand: string;
  /** Measurement operator id (`./measurementOperators` OPERATOR_TAGS key) the goal is judged on, when observable. */
  operator?: string;
  timeBasis: 'end' | 'mean' | 'episode' | 'none';
  /** Manual inputs (with provenance) required for the objective to be actionable. */
  requiredInputs: readonly string[];
  /** Engine outputs that must be available; a missing one makes the goal unavailable (never zero benefit). */
  requiredOutputs: readonly string[];
  population: string;
  objectives: readonly ObjectiveShape[];
  /** Non-monotone quantities need a target/band/satiation point instead of open-ended min/max. */
  satiation: 'required' | 'optional' | 'none';
  warrants: readonly Warrant[];
  reasonCode: string;
}

/** One capability-driven normalization for direct, saved and UI requests; a finite aspiration is bounded satiation. */
export function resolveCapabilityObjective(
  capability: Pick<GoalCapability, 'objectives' | 'satiation'> | null | undefined,
  requested: { direction: 'minimise' | 'maximise' | 'target'; target?: number },
): { supported: boolean; direction: 'minimise' | 'maximise' | 'target'; objective: 'minimise' | 'maximise' | 'target' | null; reasonCode: 'ok' | 'needsTargetBand' | 'unsupportedObjective' } {
  if (!capability) return { supported: false, direction: requested.direction, objective: null, reasonCode: 'unsupportedObjective' };
  const finiteTarget = requested.target !== undefined && Number.isFinite(requested.target);
  if ((requested.direction === 'target' || capability.satiation === 'required') && !finiteTarget) {
    return { supported: false, direction: requested.direction, objective: null, reasonCode: 'needsTargetBand' };
  }
  const direction = finiteTarget && capability.objectives.includes('target') ? 'target' : requested.direction;
  if (!capability.objectives.includes(direction)) {
    return { supported: false, direction, objective: null, reasonCode: 'unsupportedObjective' };
  }
  return { supported: true, direction, objective: direction, reasonCode: 'ok' };
}

/** Whether a capability may be used as a planning objective at all (scenario objectives are labelled, never benefit-certified). */
export function capabilityAllowsOptimization(c: Pick<GoalCapability, 'availability'> | null | undefined): boolean {
  return !!c && (c.availability === 'supported' || c.availability === 'scenario');
}

/* ---------------------------------------------------------------- finite search outcomes (D4-08) */

/** Finite-search result vocabulary (C6): not found is not proof of impossibility. */
export type SearchOutcome = 'foundUnderModel' | 'notFoundWithinBudget' | 'provenPolicyConflict' | 'outsideSupportedDomain' | 'uncertainResponse' | 'stopped';

export interface SearchOutcomeInfo {
  outcome: SearchOutcome;
  budget?: { tier: string; euBudget?: number; euUsed?: number };
  seed?: string;
  /** The optimizer's actual stop reason (no invented convergence criterion). */
  termination?: string;
  /** Witness/proof ids for `provenPolicyConflict` (direct contradiction or analytic policy proof only). */
  proofIds?: readonly string[];
  /** Read from a legacy artifact: its reason is unknown unless a stored proof exists. */
  legacy?: boolean;
}

/** Adapter for legacy `GoalFeasibilityStatus` (C6/D4-08): legacy unattainable without a stored proof is not "impossible". */
export function searchOutcomeFromLegacy(status: string, proofIds?: readonly string[]): SearchOutcomeInfo {
  switch (status) {
    case 'attainable':
    case 'metAtBaseline':
    case 'attainableAloneNotJointly':
    case 'notImprovable':
    case 'directional':
      return { outcome: 'foundUnderModel', legacy: true };
    case 'unattainable':
      return proofIds && proofIds.length ? { outcome: 'provenPolicyConflict', proofIds: [...proofIds], legacy: true } : { outcome: 'notFoundWithinBudget', legacy: true };
    case 'stopped':
      return { outcome: 'stopped', legacy: true };
    default:
      return { outcome: 'notFoundWithinBudget', legacy: true };
  }
}

/** Inline word for a search outcome. */
export const SEARCH_OUTCOME_LABEL: Readonly<Record<SearchOutcome, string>> = {
  foundUnderModel: 'Estimated',
  notFoundWithinBudget: 'Not found',
  provenPolicyConflict: 'Limit conflict',
  outsideSupportedDomain: 'Limited',
  uncertainResponse: 'Limited',
  stopped: 'Not found',
};

/* ---------------------------------------------------------------- band metadata (D8-02) */

/**
 * What a P10–P90 band is (C6/D8-02). Quantiles come from stochastic members only (the nominal run is separate); zero
 * draws export no band (`method: 'none'`). Current ensemble bands are parameter-sensitivity ranges with unvalidated
 * predictive coverage; fixed fallback bands are display ranges, not predictive intervals.
 */
export interface BandMeta {
  method: 'draws' | 'fallback' | 'none';
  uncertaintyKind: UncertaintyKind;
  coverage: CoverageStatus;
  /** Stochastic members behind the quantiles (0 for fallback/none). */
  draws: number;
  /** Always false: the nominal trajectory is never mixed into quantiles. */
  nominalInQuantiles: false;
  /** Change-from-baseline series: member deltas re-based on the nominal t = 0 value, or raw member values. */
  endpoint: 'deltaRebasedOnNominal' | 'raw';
  /** `CONTRACT_VERSIONS.uncertainty` the band was made under (absent = legacy). */
  version: number;
}

/** Semantics of a legacy stored band: a parameter-sensitivity range, coverage unvalidated (never relabelled 80 % prediction). */
export const LEGACY_BAND_META: Readonly<BandMeta> = { method: 'draws', uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', draws: 0, nominalInQuantiles: false, endpoint: 'raw', version: 0 };

export function bandMetaFor(method: BandMeta['method'], draws: number, endpoint: BandMeta['endpoint'] = 'raw'): BandMeta {
  return {
    method: method === 'draws' && draws <= 0 ? 'none' : method,
    uncertaintyKind: method === 'none' || (method === 'draws' && draws <= 0) ? 'none' : method === 'fallback' ? 'heuristic' : 'parameterSensitivity',
    coverage: method === 'none' || (method === 'draws' && draws <= 0) ? 'notApplicable' : 'unvalidated',
    draws: method === 'draws' ? Math.max(0, draws) : 0,
    nominalInQuantiles: false,
    endpoint,
    version: CONTRACT_VERSIONS.uncertainty,
  };
}

/* ---------------------------------------------------------------- per-day band availability (D8-02, A1-049) */

/**
 * Per-day band method code (A1-049): `none` = no usable range that day (zero valid members, or a model-limit/domain
 * exclusion with no named conditional range); `full` = every attempted member contributed a valid value; `conditionalValid`
 * = a range over the valid members only, explicitly conditional on their validity (never presented as the full ensemble).
 */
export const BAND_DAY_METHOD = { none: 0, full: 1, conditionalValid: 2 } as const;
export type BandDayMethodCode = (typeof BAND_DAY_METHOD)[keyof typeof BAND_DAY_METHOD];

/**
 * Why a member value was excluded from a day's band (A1-049): non-finite value, the member's own forbidding output status
 * (a finite compatibility number never makes it usable), a model-limit termination or out-of-domain validity, or an early
 * abort before that day.
 */
export const BAND_EXCLUSION_REASONS = ['nonFinite', 'forbiddingStatus', 'modelLimit', 'outOfDomain', 'aborted'] as const;
export type BandExclusionReason = (typeof BAND_EXCLUSION_REASONS)[number];

/**
 * Per-series, per-day band availability sidecar (D8-02/A1-049). Quantile arrays stay finite compatibility storage; THIS mask
 * says whether a day's range may be used. Counts are per day: `valid[d] + excluded[d] = attempted`. Scenario/limited members
 * remain valid contributions (the band then inherits their conditional `status`, `fromDay` and `uncertaintyKind`).
 */
export interface BandAvailability {
  /** `CONTRACT_VERSIONS.uncertainty` the sidecar was made under. */
  version: number;
  /** Stochastic members attempted (scalar, for serialization compatibility with `draws`). */
  attempted: number;
  valid: Uint16Array;
  excluded: Uint16Array;
  /** `BandDayMethodCode` per day. */
  method: Uint8Array;
  /** Excluded members per day by reason (absent reason = none excluded for it). */
  excludedBy: Partial<Record<BandExclusionReason, Uint16Array>>;
  /** Worst interpretable status among contributing members (`estimated` when none was conditional) and its first day. */
  status: OutputStatus;
  fromDay?: number;
  uncertaintyKind: UncertaintyKind;
  reasonCode: string;
}

/** Whether day `d` of a band has a usable range (A1-049). A missing sidecar (legacy result) reads as usable. */
export function bandDayUsable(av: Pick<BandAvailability, 'method'> | null | undefined, d: number): boolean {
  if (!av) return true;
  if (!(d >= 0 && d < av.method.length)) return false;
  return av.method[d] !== BAND_DAY_METHOD.none;
}

/**
 * The per-day method from counts (A1-049): no valid member ⇒ `none`; any model-limit/domain exclusion ⇒ `none` unless the
 * caller explicitly asks for a named valid-domain conditional range; other exclusions (non-finite, forbidding status,
 * abort) ⇒ `conditionalValid`; nothing excluded ⇒ `full`.
 */
export function bandDayMethodOf(counts: { valid: number; excluded: number; domainExcluded: number }, opts: { conditionalValidDomain?: boolean } = {}): BandDayMethodCode {
  if (!(counts.valid > 0)) return BAND_DAY_METHOD.none;
  if (counts.domainExcluded > 0) return opts.conditionalValidDomain ? BAND_DAY_METHOD.conditionalValid : BAND_DAY_METHOD.none;
  return counts.excluded > 0 ? BAND_DAY_METHOD.conditionalValid : BAND_DAY_METHOD.full;
}

// =====================================================================================================================
// C7 — exercise energy ledger terms (D3-07) and energy boundaries
// =====================================================================================================================

/** System boundary of an intake number (C3/C7): ME, gross ingested and absorbed energy are different quantities. */
export type EnergyBoundary = 'reportedME' | 'grossIngested' | 'absorbed';

/**
 * One bout's energy, with every quantity labelled (C7/D3-07): gross, own resting share, net above rest, displaced
 * lifestyle activity and the incremental cost the energy ledger books (recovery is added once, separately).
 */
export interface ExerciseCostBreakdown {
  grossKcal: number;
  ownRestKcal: number;
  netAboveRestKcal: number;
  displacedLifestyleKcal: number | null;
  /** net − displaced (may be negative when the bout replaces costlier activity; never clamped silently). */
  incrementalKcal: number | null;
  recoveryKcal?: number;
  /**
   * Gross route. (SPEC V1.3, 2026-10-27, additive) `hr` = a heart-rate regression (Keytel, only in its eligible domain, D2);
   * `reported` = a user override (e.g. "the machine showed N kcal"), booked with its provenance.
   */
  method: 'compendiumMet' | 'acsm' | 'power' | 'modelled' | 'device' | 'hr' | 'reported' | 'unknown';
  /** Validation domain of the gross equation (published standard-MET vs individually modelled). */
  domain?: string;
  source: QuantityProvenance;
  // ---- SPEC V1.3 additions 2026-10-27 (optional; absent on every earlier record)
  /** What `envelope` is: a product scenario (launch default), a prediction interval, measurement uncertainty, or unknown. */
  uncertaintyKind?: EnergyUncertaintyKind;
  /** Gross-energy range, kcal (a scenario envelope unless `uncertaintyKind` says otherwise; never a 95 % interval by default). */
  envelope?: { lo: number; hi: number };
  /** Estimator id and version that produced `grossKcal` (e.g. 'acsm-walk/1', 'compendium-met/1', 'keytel/1'). */
  estimatorVersion?: string;
  /** Opaque reference to the inputs (source ids and revisions) the estimate was computed from. */
  inputsRef?: string;
}

/**
 * Kind of an energy estimate's range (SPEC §1.5). Launch envelopes are product SCENARIOS (RMR ±15 %, in-domain speed/grade
 * ±25 %, matched MET ±30 %, analog/unspecified MET ±50 %, Keytel ±40 % / ±50 % out of 18-45 y or 47-120 kg, verified power
 * ±25 %), never confidence intervals. Bout envelopes add linearly within a day (shared person bias). DECISION D5 default
 * (recommended, pending the owner): numeric ranges are shown, labelled "scenario range".
 */
export type EnergyUncertaintyKind = 'scenario' | 'predictionInterval' | 'measurementUncertainty' | 'unknown';

/** net = max(0, gross − RMR_day·duration/1440), kcal (D3-07). */
export function exerciseNetAboveRestKcal(grossKcal: number, rmrKcalPerDay: number, durationMin: number): number | null {
  if (![grossKcal, rmrKcalPerDay, durationMin].every(Number.isFinite) || durationMin < 0 || rmrKcalPerDay < 0) return null;
  return Math.max(0, grossKcal - (rmrKcalPerDay * durationMin) / 1440);
}

/** incremental = net − displaced lifestyle energy (unknown displacement ⇒ null: an explicit scenario, not a guess). */
export function exerciseIncrementalKcal(netAboveRestKcal: number, displacedLifestyleKcal: number | null | undefined): number | null {
  if (!Number.isFinite(netAboveRestKcal) || !isKnown(displacedLifestyleKcal)) return null;
  return netAboveRestKcal - displacedLifestyleKcal;
}

/** Whether a daily step count includes the steps of planned sessions (D3-07); legacy counts are `unknown`. */
export type StepsScopeContract = 'totalDay' | 'excludesTraining' | 'unknown';
