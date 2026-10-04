/**
 * Evidence policy helpers (PLAN item 14; R5). Two orthogonal labels on every item: mechanism (known? which pathway?
 * how does it reach the engine?) × empirical certainty (A–D). Inclusion requires a mechanism that reaches an engine
 * state; certainty only widens bands and shapes wording; grades never gate (R5 §2.5).
 *
 * Unstudied items are mapped onto a studied anchor by shared mechanism with a robust transfer factor τ (R5 §3.2):
 *   τ ~ (1 − w)·LogNormal(ln median, σ_τ) + w·Uniform(0, τ_lo),  σ_τ = 0.10 + 0.50·(1 − S).
 */
import { cp } from './params';
import type {
  Catalogue,
  EvidenceGrade,
  EvidenceLabel,
  ExerciseRecord,
  Indirectness,
  MappingDef,
  MechanismRoute,
  OutcomeFamily,
  SupplementRecord,
  TauPrior,
} from './types';

const GRADES: readonly EvidenceGrade[] = ['A', 'B', 'C', 'D'];

// ================================================================== inclusion (R5 §2.1, §2.5)

/**
 * R5 inclusion rule: an item enters the simulator and planner iff at least one of its labels names a pathway that
 * reaches an engine state (`modelled` or `mapped`), unless there is direct evidence of no effect or of harm for the
 * outcome the plan uses it for. The certainty grade is never consulted.
 */
export function isIncludable(labels: EvidenceLabel | readonly EvidenceLabel[], opts: { directNullOrHarm?: boolean } = {}): boolean {
  if (opts.directNullOrHarm) return false;
  const list = Array.isArray(labels) ? (labels as readonly EvidenceLabel[]) : [labels as EvidenceLabel];
  return list.some((l) => l.mechanism.known && l.mechanism.pathway.trim().length > 0 && (l.mechanism.route === 'modelled' || l.mechanism.route === 'mapped'));
}

/** Why an item is in or out, in plain words (for the Evidence drawer). */
export function inclusionReason(labels: readonly EvidenceLabel[], opts: { directNullOrHarm?: boolean } = {}): string {
  if (opts.directNullOrHarm) return 'Left out: trials of this item found no effect, or harm, for this goal.';
  if (isIncludable(labels)) {
    const mapped = labels.some((l) => l.mechanism.route === 'mapped');
    return mapped ? 'Included: it works through a mechanism the model already simulates, so it is counted by how it works.' : 'Included: the model simulates how it works.';
  }
  if (labels.some((l) => l.mechanism.known && l.mechanism.route === 'infoOnly')) return 'Not simulated yet: the way it works is known but does not reach anything the model tracks.';
  return 'Not simulated: no known way for it to change anything the model tracks.';
}

// ================================================================== certainty → band (R5 §2.3)

export function bandFloor(grade: EvidenceGrade): number {
  return cp(`bandFloor${grade}`);
}

/**
 * Effective band of a parameter (R5 §2.3): certainty sets a floor on the band width and never narrows it; the centre
 * never moves. σ_band = (high − low)/2.563; σ_floor = f[grade]·scale; k = max(1, σ_floor/σ_band);
 * low' = value − k·(value − low), high' = value + k·(high − value), clipped to `bounds`. With `log`, applied in log space.
 */
export function inflateBand(
  value: number,
  low: number,
  high: number,
  grade: EvidenceGrade,
  opts: { bounds?: readonly [number, number]; scaleRef?: number; log?: boolean } = {},
): { low: number; high: number; k: number } {
  if (opts.log && value > 0 && low > 0 && high > 0) {
    const r = inflateBand(Math.log(value), Math.log(low), Math.log(high), grade, { scaleRef: opts.scaleRef ?? 1 });
    let lo = Math.exp(r.low);
    let hi = Math.exp(r.high);
    if (opts.bounds) {
      lo = Math.max(opts.bounds[0], lo);
      hi = Math.min(opts.bounds[1], hi);
    }
    return { low: lo, high: hi, k: r.k };
  }
  const scale = Math.abs(value) > 1e-12 ? Math.abs(value) : (opts.scaleRef ?? 1);
  const sigmaBand = (high - low) / 2.563;
  const sigmaFloor = bandFloor(grade) * scale;
  // a fixed parameter (low = high = value) gets a symmetric band at the floor: k·0 would leave it at zero width
  let lo: number;
  let hi: number;
  let k: number;
  if (sigmaBand <= 1e-12) {
    k = Number.POSITIVE_INFINITY;
    lo = value - 1.2816 * sigmaFloor;
    hi = value + 1.2816 * sigmaFloor;
  } else {
    k = Math.max(1, sigmaFloor / sigmaBand);
    lo = value - k * (value - low);
    hi = value + k * (high - value);
  }
  if (opts.bounds) {
    lo = Math.max(opts.bounds[0], lo);
    hi = Math.min(opts.bounds[1], hi);
  }
  return { low: lo, high: hi, k };
}

/** Relative inflation factor of a band of relative half-width `relHalfWidth` (P10–P90 around 1). */
export function inflationFactor(grade: EvidenceGrade, relHalfWidth: number): number {
  const sigmaBand = (2 * relHalfWidth) / 2.563;
  return sigmaBand <= 0 ? Number.POSITIVE_INFINITY : Math.max(1, bandFloor(grade) / sigmaBand);
}

// ================================================================== certainty of a mapped item (R5 §2.2)

/** C(item) = max(D, C(anchor) − Σ downgrades); +1 if a direct human trial agrees in sign (capped at the anchor). */
export function certaintyFromAnchor(
  anchor: EvidenceGrade,
  indirectness: Indirectness,
  directEvidence?: { grade: EvidenceGrade; sign: 1 | -1 | 0 } | null,
): EvidenceGrade {
  const down = indirectness.population + indirectness.intervention + indirectness.outcome;
  let idx = Math.min(3, GRADES.indexOf(anchor) + down);
  if (directEvidence && directEvidence.sign > 0) idx = Math.max(GRADES.indexOf(anchor), idx - 1);
  return GRADES[idx]!;
}

// ================================================================== transfer factor τ (R5 §3.2)

export function similarityS(dims: Readonly<Record<string, number>>): number {
  const v = Object.values(dims);
  return v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length;
}

/** R5 §3.2 τ prior from similarity S; `extraSigma` is a documented allowance (e.g. unknown mass distribution). */
export function tauPrior(opts: { S: number; median?: number; wRobust?: number; author?: 'dossier' | 'ai' | 'user'; linkAssumed?: boolean; extraSigma?: number }): TauPrior {
  const S = Math.min(1, Math.max(0, opts.S));
  const w = opts.wRobust ?? (opts.author === 'ai' || opts.linkAssumed ? cp('tauWAssumed') : cp('tauWShown'));
  return {
    median: opts.median ?? 1,
    sigmaLog: cp('tauSigmaBase') + cp('tauSigmaSlope') * (1 - S) + (opts.extraSigma ?? 0),
    wRobust: opts.author === 'ai' ? Math.max(w, cp('tauWAssumed')) : w,
    tauLo: cp('tauLo'),
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** CDF of the robust τ mixture. */
export function tauCdf(tau: TauPrior, x: number): number {
  if (x <= 0) return 0;
  const ln = phi((Math.log(x) - Math.log(tau.median)) / tau.sigmaLog);
  const un = Math.min(1, x / tau.tauLo);
  return (1 - tau.wRobust) * ln + tau.wRobust * un;
}

/** Quantile of the robust τ mixture (bisection; monotone CDF). */
export function tauQuantile(tau: TauPrior, p: number): number {
  let lo = 1e-6;
  let hi = tau.median * Math.exp(8 * tau.sigmaLog) + tau.tauLo;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (tauCdf(tau, mid) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Quantile of a triangular distribution (min, mode, max). */
export function triQuantile(min: number, mode: number, max: number, p: number): number {
  if (max <= min) return min;
  const fc = (mode - min) / (max - min);
  return p < fc ? min + Math.sqrt(p * (max - min) * (mode - min)) : max - Math.sqrt((1 - p) * (max - min) * (max - mode));
}

/** Specification of an unstudied item mapped onto a studied anchor (R5 §3.1). */
export interface MappingSpec {
  itemId: string;
  outcomes: readonly OutcomeFamily[];
  anchor: { kind: 'mechanism' | 'item'; id: string; grade: EvidenceGrade };
  pathway: string;
  inputs: Readonly<Record<string, { value: number; low: number; high: number; unit?: string }>>;
  dims: Readonly<Record<string, 0 | 0.5 | 1>>;
  indirectness: Indirectness;
  directEvidence?: { refs: readonly string[]; grade: EvidenceGrade; sign: 1 | -1 | 0 };
  wouldSettle: string;
  author: 'dossier' | 'ai' | 'user';
  /** Known direction of a mismatch (e.g. ballistic → less time under tension → 0.8). */
  median?: number;
  wRobust?: number;
  linkAssumed?: boolean;
  extraSigma?: number;
}

export interface MappedIntervention extends MappingDef {
  /** Each input × τ at P10 / P50 / P90 (τ applied at the stimulus level, R5 §3.2). */
  mapped: Readonly<Record<string, { p10: number; p50: number; p90: number }>>;
}

/**
 * Map an unstudied intervention onto a studied one by shared mechanism (R5 §3): similarity S → τ prior (wider when
 * less similar or AI-authored), certainty = anchor − indirectness (+1 for an agreeing direct trial), and the item's
 * anchor inputs scaled by τ quantiles. Never excludes; low similarity only widens the band.
 */
export function mapIntervention(spec: MappingSpec): MappedIntervention {
  const S = similarityS(spec.dims);
  const tau = tauPrior({
    S,
    ...(spec.median !== undefined ? { median: spec.median } : {}),
    ...(spec.wRobust !== undefined ? { wRobust: spec.wRobust } : {}),
    author: spec.author,
    ...(spec.linkAssumed !== undefined ? { linkAssumed: spec.linkAssumed } : {}),
    ...(spec.extraSigma !== undefined ? { extraSigma: spec.extraSigma } : {}),
  });
  const q10 = tauQuantile(tau, 0.1);
  const q50 = tauQuantile(tau, 0.5);
  const q90 = tauQuantile(tau, 0.9);
  const mapped: Record<string, { p10: number; p50: number; p90: number }> = {};
  for (const [k, v] of Object.entries(spec.inputs)) mapped[k] = { p10: v.low * q10, p50: v.value * q50, p90: v.high * q90 };
  return {
    itemId: spec.itemId,
    outcomes: spec.outcomes,
    anchor: { kind: spec.anchor.kind, id: spec.anchor.id },
    pathway: spec.pathway,
    inputs: spec.inputs,
    similarity: { dims: spec.dims, S },
    tau,
    indirectness: spec.indirectness,
    ...(spec.directEvidence ? { directEvidence: spec.directEvidence } : {}),
    certainty: certaintyFromAnchor(spec.anchor.grade, spec.indirectness, spec.directEvidence ?? null),
    wouldSettle: spec.wouldSettle,
    author: spec.author,
    mapped,
  };
}

// ================================================================== labels of catalogue items

const ANALOG = /analog|estimate/i;

/** Per-outcome labels of an exercise (R5: M is per (item, outcome) pair). */
export function exerciseLabels(ex: ExerciseRecord): Partial<Record<OutcomeFamily, EvidenceLabel>> {
  const out: Partial<Record<OutcomeFamily, EvidenceLabel>> = {};
  const trainsRegions = Object.values(ex.regions).some((v) => (v ?? 0) > 0) && ex.loadType !== 'cardio' && ex.loadType !== 'mobility';
  const rtRoute: MechanismRoute = ex.status === 'infoOnly' ? 'mapped' : ex.status;
  if (trainsRegions) {
    out.hypertrophy = { mechanism: { known: true, pathway: ex.mechanism, route: rtRoute }, certainty: ex.certainty };
    out.strength = { mechanism: { known: true, pathway: ex.mechanism, route: rtRoute }, certainty: ex.certainty };
  }
  const analogMet = ANALOG.test(ex.energy.metSource);
  if (ex.hybridCardioShare > 0) {
    out.cardio = { mechanism: { known: true, pathway: `${ex.mechanism} Aerobic training by intensity and minutes.`, route: analogMet ? 'mapped' : 'modelled' }, certainty: ex.certainty };
  }
  out.energy = {
    mechanism: { known: true, pathway: 'Energy cost of the work, from its metabolic equivalent and minutes.', route: analogMet ? 'mapped' : 'modelled' },
    certainty: analogMet ? 'C' : 'A',
  };
  if (ex.mobilityTargets.length > 0) {
    out.mobility = { mechanism: { known: true, pathway: `Range of motion: ${ex.mobilityTargets.map((t) => t.replace(/_/g, ' ')).join(', ')}.`, route: 'infoOnly' }, certainty: ex.certainty };
  }
  return out;
}

/** The headline label of an exercise (its primary outcome's route, its R3 certainty). */
export function exerciseLabel(ex: ExerciseRecord): EvidenceLabel {
  return { mechanism: { known: ex.mechanism.trim().length > 0, pathway: ex.mechanism, route: ex.status }, certainty: ex.certainty };
}

/** Per-outcome labels of a supplement: route from its engine mapping, certainty per recorded outcome. */
export function supplementLabels(s: SupplementRecord): Array<{ outcome: string; label: EvidenceLabel; direction: 'effect' | 'null' | 'harm' }> {
  return s.outcomes.map((o) => ({
    outcome: o.outcome,
    label: { mechanism: { known: s.mechanism.trim().length > 0, pathway: s.mechanism, route: s.engine.route }, certainty: o.certainty },
    direction: o.direction,
  }));
}

/** Headline label of a supplement: the best-supported outcome with an effect (or the best grade overall). */
export function supplementLabel(s: SupplementRecord): EvidenceLabel {
  const effect = s.outcomes.filter((o) => o.direction === 'effect');
  const pool = effect.length > 0 ? effect : s.outcomes;
  const best = pool.reduce<EvidenceGrade>((g, o) => (GRADES.indexOf(o.certainty) < GRADES.indexOf(g) ? o.certainty : g), 'D');
  return { mechanism: { known: s.mechanism.trim().length > 0, pathway: s.mechanism, route: s.engine.route }, certainty: best };
}

// ================================================================== default mapping of mapped exercises

type Dims = Record<'pattern' | 'regions' | 'loadType' | 'intensity' | 'velocity' | 'rom' | 'volume' | 'duration' | 'cardio', 0 | 0.5 | 1>;

/**
 * Similarity of a mapped exercise to the anchor class of its pathway, over R5's nine stimulus dimensions. Engineering
 * classification by load type (grade D): ballistic swings follow R5's gada example; odd objects differ in load type
 * and load estimate; bodyweight/isometric C–D items differ in load type and ROM; analog-MET sport/dance in pattern,
 * intensity and cardio profile; AI-resolved items are half-similar on every dimension.
 */
export function exerciseSimilarity(ex: ExerciseRecord): Dims {
  if (ex.origin === 'ai-resolved') return { pattern: 0.5, regions: 0.5, loadType: 0.5, intensity: 0.5, velocity: 0.5, rom: 0.5, volume: 0.5, duration: 0.5, cardio: 0.5 };
  switch (ex.loadType) {
    case 'ballistic':
      return { pattern: 0.5, regions: 1, loadType: 0.5, intensity: 0.5, velocity: 0, rom: 1, volume: 1, duration: 1, cardio: 0.5 };
    case 'odd-object':
      return { pattern: 1, regions: 1, loadType: 0.5, intensity: 0.5, velocity: 1, rom: 1, volume: 1, duration: 1, cardio: 1 };
    case 'cardio':
      return { pattern: 0.5, regions: 1, loadType: 1, intensity: 0.5, velocity: 1, rom: 1, volume: 1, duration: 1, cardio: 0.5 };
    default:
      return { pattern: 1, regions: 1, loadType: 0.5, intensity: 1, velocity: 1, rom: 0.5, volume: 1, duration: 1, cardio: 1 };
  }
}

/** τ prior of an exercise (median 1: the nominal stimulus already carries the set-type factor). */
export function exerciseTau(ex: ExerciseRecord): TauPrior {
  return tauPrior({ S: similarityS(exerciseSimilarity(ex)), author: ex.origin === 'ai-resolved' ? 'ai' : ex.origin === 'user' ? 'user' : 'dossier', linkAssumed: ex.certainty === 'D' });
}

/** The mapping record of a mapped exercise (null for modelled or info-only items). */
export function exerciseMapping(ex: ExerciseRecord): MappingDef | null {
  if (ex.status !== 'mapped') return null;
  const trains = Object.values(ex.regions).some((v) => (v ?? 0) > 0) && ex.loadType !== 'cardio';
  const dims = exerciseSimilarity(ex);
  const indirectness: Indirectness = { population: 0, intervention: 1, outcome: ex.certainty === 'D' ? 1 : 0 };
  const inputs: Record<string, { value: number; low: number; high: number; unit?: string }> = {
    metGross: { value: ex.energy.metGross, low: ex.energy.metRange[0], high: ex.energy.metRange[1], unit: 'MET' },
  };
  if (ex.loadFactor) inputs.setFactor = { value: ex.loadFactor.mode, low: ex.loadFactor.min, high: ex.loadFactor.max, unit: '1' };
  return {
    itemId: ex.id,
    outcomes: trains ? ['hypertrophy', 'strength', 'energy'] : ['cardio', 'energy'],
    anchor: { kind: 'mechanism', id: trains ? 'resistance-effective-sets' : 'cardio-met' },
    pathway: ex.mechanism,
    inputs,
    similarity: { dims, S: similarityS(dims) },
    tau: exerciseTau(ex),
    indirectness,
    certainty: ex.certainty,
    wouldSettle: trains
      ? `A 10-week trial in untrained adults: ${ex.name} against volume-matched dumbbell or bodyweight work, with muscle thickness and strength measured.`
      : `A laboratory measurement of oxygen uptake during ${ex.name} at typical pace.`,
    author: ex.origin === 'ai-resolved' ? 'ai' : ex.origin === 'user' ? 'user' : 'dossier',
  };
}

// ================================================================== evidence-graph edges (PLANNER_V2 §6.1, §9.4)

/** Catalogue side of an evidence-graph edge; E6 converts these to its `EvidenceEdge` (metrics, series, probes). */
export interface CatalogueEdge {
  id: string;
  from: { kind: 'catalogue'; id: string };
  outcome: OutcomeFamily | string;
  /** Engine schedule fields the item reaches. */
  engineInputs: readonly string[];
  module: 'muscle' | 'activity' | 'other';
  status: 'modelled' | 'mapped' | 'infoOnly';
  certainty: EvidenceGrade;
  /** R5 τ spread for mapped items. */
  tauSd: number;
  sign: 1 | -1 | 0;
}

const RT_INPUTS = ['ResistanceSession.setsByRegion', 'ResistanceSession.rir', 'ResistanceSession.loadPct1RM'] as const;

/** Evidence-graph edges for every catalogue item with a known pathway (grades recorded, never used to drop an edge). */
export function catalogueEdges(catalogue: Catalogue): CatalogueEdge[] {
  const edges: CatalogueEdge[] = [];
  for (const ex of catalogue.exercises) {
    const labels = exerciseLabels(ex);
    const tauSd = ex.status === 'mapped' ? exerciseTau(ex).sigmaLog : 0;
    for (const [outcome, l] of Object.entries(labels) as Array<[OutcomeFamily, EvidenceLabel]>) {
      if (l.mechanism.route === 'none') continue;
      const rt = outcome === 'hypertrophy' || outcome === 'strength';
      edges.push({
        id: `${ex.id}>${outcome}`,
        from: { kind: 'catalogue', id: ex.id },
        outcome,
        engineInputs: rt ? RT_INPUTS : outcome === 'mobility' ? [] : ['CardioSession.met', 'CardioSession.durationMin'],
        module: rt ? 'muscle' : outcome === 'mobility' ? 'other' : 'activity',
        status: l.mechanism.route,
        certainty: l.certainty,
        tauSd: l.mechanism.route === 'mapped' ? tauSd : 0,
        sign: 1,
      });
    }
  }
  for (const s of catalogue.supplements) {
    for (const o of supplementLabels(s)) {
      edges.push({
        id: `${s.id}>${o.outcome}`,
        from: { kind: 'catalogue', id: s.id },
        outcome: o.outcome,
        engineInputs: s.engine.inputs,
        module: 'other',
        status: o.label.mechanism.route === 'none' ? 'infoOnly' : o.label.mechanism.route,
        certainty: o.label.certainty,
        tauSd: 0,
        sign: o.direction === 'effect' ? 1 : o.direction === 'harm' ? -1 : 0,
      });
    }
  }
  return edges;
}

// ================================================================== wording (R5 §2.4)

/** Verb hedge by certainty (GRADE 26): "lowers", "probably lowers", "may lower", "might lower". */
export function hedge(certainty: EvidenceGrade): '' | 'probably' | 'may' | 'might' {
  return certainty === 'A' ? '' : certainty === 'B' ? 'probably' : certainty === 'C' ? 'may' : 'might';
}

/**
 * The clause that explains why an item is in the plan (R5 §2.4): always names the pathway for mapped items and for
 * certainty D; never uses "speculative"; bands do the rest of the hedging.
 */
export function evidenceClause(label: EvidenceLabel, anchorName?: string): string {
  const { route, pathway } = label.mechanism;
  const p = pathway.replace(/\.\s*$/, '');
  if (route === 'none') return 'Not simulated: there is no known way for it to change what the model tracks.';
  if (route === 'infoOnly') return `Not simulated yet. ${p}.`;
  if (route === 'mapped') {
    const as = anchorName ? `Counted as ${anchorName}` : 'Counted by how it works';
    return label.certainty === 'A' || label.certainty === 'B' ? `${as}.` : `${as} (${p}); the range is wide because few trials exist.`;
  }
  return label.certainty === 'D' ? `In the model because of how it works (${p}); human data are scarce, so the range is wide.` : '';
}
