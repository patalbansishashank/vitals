/**
 * Parameter registry contracts (docs/MODEL_SPEC.md §8 "Uncertainty" and §1 per-module parameter tables).
 *
 * Every numeric constant a module uses lives in exactly one `ParamDef`. The Evidence library UI, the
 * uncertainty bands and the planner's robust re-rank are all generated from these definitions, so a
 * value hard-coded inside a module (other than pure unit conversions listed in `core/defaults.ts`) is a
 * spec violation.
 */

export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';

/**
 * - `verified`: value located in the cited source by the dossier author.
 * - `proposed-fit`: fitted/engineered by the dossier author to cited data points (dossier label PROPOSED FIT / PROPOSED / DERIVED).
 * - `unverified`: dossier marks the number UNVERIFIED (could not be confirmed from the source).
 */
export type ParamStatus = 'verified' | 'proposed-fit' | 'unverified';

/**
 * How a parameter is sampled for uncertainty draws (MODEL_SPEC §8.1).
 * - `tri`: triangular(low, value, high) — default for every parameter with low < high.
 * - `logTri`: triangular in log space (for strictly positive rate constants / time constants spanning > 3x).
 * - `fixed`: never varied (unit conventions, structural constants, safety thresholds).
 * - `uniform`: uniform on [low, high]; used for latent quantiles that a module maps itself (e.g. the correlated
 *   biomarker z-scores of 06 §4.17, MODEL_SPEC §8.1).
 */
export type DrawKind = 'tri' | 'logTri' | 'uniform' | 'fixed';

export interface ParamDef {
  /** Globally unique, `<moduleId>.<name>`, e.g. `energy.atBeta`. Stable: used as a key in saved scenarios. */
  readonly id: string;
  /** Nominal value used for the point projection (P50 run). */
  readonly value: number;
  /** Unit in the engine's canonical units (see MODEL_SPEC §4.0), e.g. `kcal/kg/d`, `h`, `1`, `g/g`. */
  readonly unit: string;
  /**
   * Plausible lower bound (≈ P10 of the between-person / between-study distribution where the dossier gives one).
   * low/high hold only plausible values OF THE SAME QUANTITY; they are sampled in ensemble draws (MODEL_SPEC §0.4,
   * review M20). A rejected alternative from another convention or model form goes to `note`, never to low/high.
   */
  readonly low: number;
  /** Plausible upper bound (≈ P90). Same rule as `low`. */
  readonly high: number;
  readonly grade: EvidenceGrade;
  /** Author year + PMID/DOI as given by the dossier, e.g. `Hall 2011 PMID 21872751`. */
  readonly source: string;
  /** Dossier section the number was copied from, e.g. `04 §4.3`. */
  readonly dossier: string;
  readonly status?: ParamStatus;
  /** Short human label for the Evidence library (defaults to the id). */
  readonly label?: string;
  /** Defaults to `tri` when low < high, else `fixed`. */
  readonly draw?: DrawKind;
  /**
   * Free-text note. Required home for a rejected alternative that is a different convention, structure or model form
   * (e.g. `rhoL` note "03 hydrated-lean convention 1000 kcal/kg"; `t3CarbKnee` note "12 §4.3 130 g"); such values are
   * documentation, not ensemble draws (review M20). Suggested format: "alt <value> <unit> (<dossier §>): <why rejected>".
   */
  readonly note?: string;
  /**
   * Distribution semantics (D8-02, C6/C7; optional, absent = legacy semantics: a parameter-sensitivity prior with
   * unvalidated coverage). Simulation-affecting fields here belong in the registry hash.
   */
  readonly distribution?: ParamDistributionMeta;
}

/**
 * What a parameter's draw represents (D8-02). `low`/`high` are either the support of the draw or quantiles of it; the
 * nominal value may be a mode or a design point; correlated parameters share a group drawn together.
 */
export interface ParamDistributionMeta {
  /** Uncertainty kind of the draw ('parameterSensitivity' unless a calibrated predictive distribution exists). */
  readonly uncertaintyKind: 'parameterSensitivity' | 'scenario' | 'heuristic' | 'calibratedPrediction';
  /** `low`/`high` are the draw's support or its P10/P90 quantiles. */
  readonly bounds: 'support' | 'quantiles';
  /** The nominal value is the distribution's mode, its median or a design point (e.g. a latent quantile's 0.5). */
  readonly nominal: 'mode' | 'median' | 'designPoint';
  /** Evidence basis ('between-study range', 'design mixture fraction', 'engineering prior'). */
  readonly basis: string;
  /** Population/scope the range applies to. */
  readonly population?: string;
  /** Parameters in the same group are drawn jointly (correlation group id). */
  readonly correlationGroup?: string;
  /** Version of this distribution definition (hash it with the value/range). */
  readonly version: number;
  /** Engineering/policy defaults are labelled as such (never presented as measured physiology). */
  readonly label?: 'engineeringDefault' | 'policy' | 'designPrior' | 'empirical';
}

/**
 * Resolved parameter values for one run. `values[i]` corresponds to `defs[i]`; the order is the
 * registry order (module order, then declaration order) and is stable for a given engine version, so
 * a planner ensemble member can be passed as a bare `Float64Array` (`paramOverrides`).
 */
export interface ModelParams {
  readonly defs: readonly ParamDef[];
  readonly values: Float64Array;
  /** id → index into `values`. Only used at `prepare()` time, never inside the step loop. */
  readonly index: ReadonlyMap<string, number>;
  /** Engine version + registry hash; a draw is only valid for the registry it was sampled from. */
  readonly registryHash: string;
}

/** Latin-hypercube or independent draws of the whole registry (MODEL_SPEC §8). */
export interface ParamDrawSpec {
  /** Number of ensemble members (excluding the nominal run). */
  readonly count: number;
  /** 32-bit seed; identical seed + registry → identical draws (common random numbers across candidates). */
  readonly seed: number;
  /** `lhs` (default) stratifies each parameter into `count` bins. */
  readonly method?: 'lhs' | 'independent';
  /** Restrict variation to these parameter ids (default: every non-fixed parameter). */
  readonly only?: readonly string[];
}

export type SampleParams = (defs: readonly ParamDef[], spec: ParamDrawSpec) => Float64Array[];
