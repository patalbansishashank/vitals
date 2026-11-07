/**
 * Shared safety policy for suggestions and exercise progression (D7-03, D4-02; contracts C5/C6). Pure: callers pass the
 * current safety state in; nothing here reads a store, a clock or the catalogue module.
 *
 * Suggestion policy (D7-03). One tri-state evaluator for every suggestion surface (Food cards, the Coach and the
 * `supplements.*` / MCP commands, catalogue listings and the planner's supplement opt-ins):
 *   - typed contraindication predicates (`ContraindicationPredicateId`) with a reviewed alias map from the catalogue's
 *     historical spellings (`ckd`/`kidney_disease` → `kidney-disease`, `liver_disease` → `liver-disease`, …); an id that
 *     is neither canonical nor a reviewed alias is `unchecked`, never silently ignored (and CI rejects it);
 *   - each predicate resolves from the current screening (tri-state: yes / no / unknown / prefer not), positive marker
 *     flags (eGFR < 60 → kidney disease) and the food allergies; a predicate the app never asks about is `notAsked`;
 *   - each product's policy when the predicate holds is `caution`, `clinicianReview` or `noSuggest` (reviewed per
 *     product; "whey is a protein exposure issue, not toxic because it is whey");
 *   - marker noSuggest decisions keep their rule, marker, sample date and applicability; unresolved ones are `unchecked`;
 *   - unknown or unanswered screening is `unchecked`, never an empty negative screen and never a known disease.
 * A decision only gates the suggestion. Logging a product the person already takes is always allowed and keeps its
 * exposure; its row shows the status (`takenProductStatus`), never a stop or start instruction.
 *
 * Exercise symptom gate (D4-02). Unresolved concerning exertional symptoms suspend autonomous exercise prescription and
 * progression (including compensating step increases) until a reviewed envelope covers them; a legacy yes / prefer-not
 * screening answer is context-incomplete (review, no new progression), not a diagnosis; asymptomatic risk factors and
 * musculoskeletal limitations keep their own envelopes and do not invoke this gate. No universal clearance lifetime.
 */
import {
  CONCERNING_EXERTIONAL_SYMPTOMS,
  isConcerningUnresolved,
  type Applicability,
  type ClinicianExerciseEnvelope,
  type IsoDate,
  type ScreeningAnswer,
  type SuggestionDecision,
  type SuggestionPolicyState,
  type SymptomReport,
} from './bodyContracts';

/**
 * Version of the suggestion policy and predicate registry (part of any cached card/suggestion key; C7). 2: a confirmed soy
 * allergy is not suggested the generic soy-or-pea plant protein (A1-033); a heart-rhythm medicine is its own predicate,
 * never atrial-fibrillation or arrhythmia history (A1-046).
 */
export const SAFETY_POLICY_VERSION = 2;

/* ===================================================================================================================
   Contraindication predicates
   =================================================================================================================== */

export const CONTRAINDICATION_PREDICATES = [
  'kidney-disease',
  'liver-disease',
  'milk-allergy',
  'soy-allergy',
  'pregnancy',
  'high-blood-pressure',
  'uncontrolled-hypertension',
  'heart-failure',
  'arrhythmia',
  'af-history',
  'rhythm-medication',
  'raas-or-k-sparing',
  'hyperkalaemia-history',
  'anticoagulant',
  'kidney-stones',
  'hypercalcaemia',
  'granulomatous-disease',
  'bowel-obstruction',
  'dysphagia',
  'haemochromatosis',
  'iron-status-untested',
  'hyperthyroidism',
  'thyroid-disease',
  'autoimmune',
  'anxiety-disorder',
] as const;
export type ContraindicationPredicateId = (typeof CONTRAINDICATION_PREDICATES)[number];

/** Policy when a predicate holds (the suggestion is never a deletion: logs and factual information stay). */
export type ContraindicationPolicy = Extract<SuggestionPolicyState, 'caution' | 'clinicianReview' | 'noSuggest'>;

export interface PredicateDef {
  id: ContraindicationPredicateId;
  /** Short reason words for the status/details list ("kidney disease"). */
  label: string;
  /** Positive screening flags (or marker flags) that establish it. */
  yesFlags: readonly string[];
  /**
   * Tri-state screening keys whose answers settle it negatively: 'no' on every key → no. A broader 'yes' that does not
   * name the condition (a heart condition, for heart failure) leaves it unknown. Empty with no allergen = never asked.
   */
  noKeys: readonly string[];
  /** Food-allergy predicates read the food rules' allergies instead of the screening. */
  allergen?: 'milk' | 'soy';
  /** Default policy when it holds; a product may override it (`PRODUCT_POLICY`). */
  whenYes: ContraindicationPolicy;
}

const P = (id: ContraindicationPredicateId, label: string, whenYes: ContraindicationPolicy, yesFlags: readonly string[] = [], noKeys: readonly string[] = [], allergen?: 'milk' | 'soy'): PredicateDef => ({
  id,
  label,
  yesFlags,
  noKeys,
  whenYes,
  ...(allergen ? { allergen } : {}),
});

/**
 * The supported predicate registry. Screening keys are the onboarding flag vocabulary (`screeningAnswerMap` in
 * src/features/onboarding/safetyRules.ts); marker flags use the same names ('kidney-disease').
 */
export const PREDICATES: Readonly<Record<ContraindicationPredicateId, PredicateDef>> = {
  'kidney-disease': P('kidney-disease', 'kidney disease', 'clinicianReview', ['kidney-disease'], ['kidney-disease']),
  'liver-disease': P('liver-disease', 'liver disease', 'noSuggest', ['liver-disease'], ['liver-disease']),
  'milk-allergy': P('milk-allergy', 'milk allergy', 'noSuggest', [], [], 'milk'),
  // A1-033: the catalogue's plant protein is soy isolate OR a pea:rice blend with no formulation selected — a confirmed soy
  // allergy is never suggested it (a separately identified soy-free formulation is its own product, Food › Supplements)
  'soy-allergy': P('soy-allergy', 'soy allergy', 'noSuggest', [], [], 'soy'),
  pregnancy: P('pregnancy', 'pregnancy', 'noSuggest', ['pregnant', 'planning-pregnancy'], ['pregnant', 'planning-pregnancy']),
  'high-blood-pressure': P('high-blood-pressure', 'high blood pressure', 'clinicianReview', ['high-blood-pressure'], ['high-blood-pressure']),
  'uncontrolled-hypertension': P('uncontrolled-hypertension', 'uncontrolled blood pressure', 'clinicianReview', [], ['high-blood-pressure']),
  'heart-failure': P('heart-failure', 'heart failure', 'clinicianReview', [], ['heart-condition']),
  // A1-046: a condition holds only from its own reported/clinician fact ('af-history', 'arrhythmia'); a medicine that
  // affects heart rhythm is a separate predicate. "No heart condition" settles both negatively; a broad "heart condition: yes"
  // leaves the subtype unresolved (never inferred as AF).
  arrhythmia: P('arrhythmia', 'heart rhythm problem', 'clinicianReview', ['arrhythmia', 'af-history'], ['heart-condition']),
  'af-history': P('af-history', 'atrial fibrillation', 'clinicianReview', ['af-history'], ['heart-condition']),
  'rhythm-medication': P('rhythm-medication', 'heart-rhythm medicine', 'clinicianReview', ['qt-prolonging'], ['qt-prolonging']),
  'raas-or-k-sparing': P('raas-or-k-sparing', 'ACE inhibitor, ARB or potassium-sparing medicine', 'noSuggest', ['raas-blocker'], ['raas-blocker', 'diuretic']),
  'hyperkalaemia-history': P('hyperkalaemia-history', 'high potassium before', 'noSuggest'),
  anticoagulant: P('anticoagulant', 'blood thinner', 'clinicianReview', ['anticoagulant'], ['anticoagulant']),
  'kidney-stones': P('kidney-stones', 'kidney stones', 'caution', ['kidney-stones'], ['kidney-stones']),
  hypercalcaemia: P('hypercalcaemia', 'high calcium', 'noSuggest'),
  'granulomatous-disease': P('granulomatous-disease', 'sarcoidosis or granulomatous disease', 'clinicianReview'),
  'bowel-obstruction': P('bowel-obstruction', 'bowel obstruction', 'noSuggest'),
  dysphagia: P('dysphagia', 'swallowing problem', 'caution'),
  haemochromatosis: P('haemochromatosis', 'haemochromatosis', 'noSuggest'),
  'iron-status-untested': P('iron-status-untested', 'iron status not tested', 'clinicianReview'),
  hyperthyroidism: P('hyperthyroidism', 'overactive thyroid', 'clinicianReview'),
  'thyroid-disease': P('thyroid-disease', 'thyroid disease', 'caution', ['thyroid-hormone']),
  autoimmune: P('autoimmune', 'autoimmune disease', 'caution'),
  'anxiety-disorder': P('anxiety-disorder', 'anxiety disorder', 'caution'),
};

/**
 * Reviewed alias migration of the catalogue's historical contraindication spellings (D7-03). Only these explicit,
 * semantically reviewed aliases migrate; anything else is unsupported (unchecked) and fails the catalogue test.
 */
export const PREDICATE_ALIASES: Readonly<Record<string, ContraindicationPredicateId>> = {
  ckd: 'kidney-disease',
  kidney_disease: 'kidney-disease',
  liver_disease: 'liver-disease',
  milk_allergy: 'milk-allergy',
  soy_allergy: 'soy-allergy',
  hypertension: 'high-blood-pressure',
  uncontrolled_hypertension: 'uncontrolled-hypertension',
  heart_failure: 'heart-failure',
  af_history: 'af-history',
  ace_arb_ksparing: 'raas-or-k-sparing',
  hyperkalaemia_history: 'hyperkalaemia-history',
  kidney_stones: 'kidney-stones',
  'sarcoidosis/granulomatous': 'granulomatous-disease',
  bowel_obstruction: 'bowel-obstruction',
  'dysphagia/oesophageal': 'dysphagia',
  untested: 'iron-status-untested',
  thyroid_disease: 'thyroid-disease',
  anxiety_disorder: 'anxiety-disorder',
};

/** Canonical predicate of a catalogue flag (canonical id or reviewed alias), or null when unsupported. */
export function canonicalPredicate(flag: string): ContraindicationPredicateId | null {
  if ((CONTRAINDICATION_PREDICATES as readonly string[]).includes(flag)) return flag as ContraindicationPredicateId;
  return PREDICATE_ALIASES[flag] ?? null;
}

/**
 * Reviewed per-product policies where they differ from the predicate default (D7-03): creatine and potassium products are
 * not suggested with kidney disease; whey/casein, magnesium and sodium products need clinician review (a protein or
 * mineral exposure question, not proof of harm); caffeine in pregnancy is a dose caution (> 200 mg/d).
 */
export const PRODUCT_POLICY: Readonly<Record<string, ContraindicationPolicy>> = {
  'creatine_monohydrate|kidney-disease': 'noSuggest',
  'potassium_salt_substitute|kidney-disease': 'noSuggest',
  'electrolytes_fasting|kidney-disease': 'noSuggest',
  'caffeine|pregnancy': 'caution',
  'vitamin_d3|kidney-stones': 'caution',
  'dietary_nitrate|kidney-stones': 'caution',
  'calcium|kidney-stones': 'clinicianReview',
};

/**
 * Reviewed medication precautions linked to a product's own condition predicates (A1-046): a product reviewed for a heart
 * rhythm condition (atrial-fibrillation history, arrhythmia — omega-3, caffeine) is also reviewed when the person takes a
 * medicine that affects heart rhythm (the medicine may be for such a condition), named for the medicine and never as the
 * condition. Applied with the catalogue's own predicates; a product without such a condition gains nothing.
 */
export const MEDICATION_PRECAUTIONS_OF: Readonly<Partial<Record<ContraindicationPredicateId, readonly ContraindicationPredicateId[]>>> = {
  'af-history': ['rhythm-medication'],
  arrhythmia: ['rhythm-medication'],
};

/* ===================================================================================================================
   Suggestion safety context
   =================================================================================================================== */

/** A product's policy-relevant facts (structurally the catalogue's `SupplementRecord`). */
export interface PolicyProduct {
  id: string;
  contraindications: ReadonlyArray<{ flag: string; note?: string }>;
}

/** A marker rule's noSuggest decision (structurally `NoSuggestDecision` of src/markers/types.ts). */
export interface MarkerNoSuggestInput {
  rule: string;
  markerId: string;
  subject: string;
  sampleDate: IsoDate;
  stale: boolean;
  applicability: Applicability;
}

/** The current safety state every suggestion surface passes in (built once from the same sources). */
export interface SuggestionSafetyInput {
  /** Tri-state screening answers keyed by flag (`screeningAnswerMap`); absent key = not answered (unknown). */
  screening?: Readonly<Partial<Record<string, ScreeningAnswer>>> | null;
  /** Positive flags from the screening outcome (used when no tri-state map is available; never read as negatives). */
  flags?: readonly string[];
  /** Positive flags from the marker patch (eGFR < 60 or ACR ≥ 30 → 'kidney-disease'). */
  markerFlags?: readonly string[];
  /** Marker noSuggest decisions with provenance (`MarkerEvaluation.noSuggest`). */
  markerNoSuggest?: readonly MarkerNoSuggestInput[];
  /** Food allergies from the food rules; absent = not answered. */
  allergies?: Readonly<Partial<Record<'milk' | 'soy', ScreeningAnswer>>> | null;
  /** Products a clinician told the person to stop or not to start (no new suggestion; logs stay). */
  clinicianStops?: readonly string[];
  /** Products the person refused ("not for me"). */
  refused?: readonly string[];
}

export type PredicateResolution = ScreeningAnswer | 'notAsked';

/** How one predicate stands for this person (yes / no / unknown / prefer not, or never asked by the app). */
export function resolvePredicate(def: PredicateDef, input: SuggestionSafetyInput): { answer: PredicateResolution; source: 'screening' | 'marker' } {
  const scr = input.screening ?? {};
  if (def.yesFlags.some((f) => input.markerFlags?.includes(f))) return { answer: 'yes', source: 'marker' };
  if (def.yesFlags.some((f) => scr[f] === 'yes' || input.flags?.includes(f))) return { answer: 'yes', source: 'screening' };
  if (def.allergen) return { answer: input.allergies?.[def.allergen] ?? 'unknown', source: 'screening' };
  if (!def.noKeys.length) return { answer: 'notAsked', source: 'screening' };
  const answers = def.noKeys.map((k) => scr[k]);
  if (answers.every((a) => a === 'no')) return { answer: 'no', source: 'screening' };
  if (answers.some((a) => a === 'preferNot')) return { answer: 'preferNot', source: 'screening' };
  return { answer: 'unknown', source: 'screening' };
}

/* ===================================================================================================================
   Evaluator
   =================================================================================================================== */

const SEVERITY: Readonly<Record<SuggestionPolicyState, number>> = { allow: 0, caution: 1, unchecked: 2, clinicianReview: 3, noSuggest: 4 };

/** The worse of two policy states (noSuggest > clinicianReview > unchecked > caution > allow). */
export function worsePolicy(a: SuggestionPolicyState, b: SuggestionPolicyState): SuggestionPolicyState {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/** Catalogue product ids a marker noSuggest subject names ('supp:creatine_monohydrate', 'creatine', 'wheyprotein'). */
export function productsOfSubject(subject: string): string[] {
  if (subject.startsWith('supp:')) return [subject.slice(5)];
  const lever: Readonly<Record<string, readonly string[]>> = { creatine: ['creatine_monohydrate'], wheyprotein: ['whey_protein'], caffeine: ['caffeine'] };
  return [...(lever[subject] ?? [])];
}

type Reason = SuggestionDecision['reasons'][number];

/**
 * The suggestion decision for one product (D7-03): the worst of its contraindication predicates, the marker noSuggest
 * decisions naming it, clinician stops and refusals. `allow` and `caution` may be suggested; the other states withhold
 * the suggestion with their reasons (never a deletion of a log or of factual information).
 */
export function suggestionDecision(product: PolicyProduct, input: SuggestionSafetyInput): SuggestionDecision {
  let state: SuggestionPolicyState = 'allow';
  const reasons: Reason[] = [];
  const add = (s: SuggestionPolicyState, reason: Reason): void => {
    state = worsePolicy(state, s);
    reasons.push(reason);
  };
  const own = new Set(product.contraindications.map((c) => canonicalPredicate(c.flag)));
  const precautions = [...new Set([...own].flatMap((id) => (id ? (MEDICATION_PRECAUTIONS_OF[id] ?? []) : [])))].filter((id) => !own.has(id)).map((flag) => ({ flag }));
  for (const c of [...product.contraindications, ...precautions] as ReadonlyArray<{ flag: string; note?: string }>) {
    const id = canonicalPredicate(c.flag);
    if (!id) {
      // never silently omitted: an unsupported predicate cannot be checked
      add('unchecked', { rule: `predicate:unsupported:${c.flag}`, source: 'policy', applicability: 'unresolved' });
      continue;
    }
    const def = PREDICATES[id];
    const r = resolvePredicate(def, input);
    if (r.answer === 'no') continue;
    if (r.answer === 'yes') {
      const policy = PRODUCT_POLICY[`${product.id}|${id}`] ?? (/clinician/i.test(c.note ?? '') ? 'clinicianReview' : def.whenYes);
      add(policy, { rule: `predicate:${id}`, source: r.source, applicability: 'applicable' });
    } else if (r.answer === 'notAsked') add('caution', { rule: `predicate:${id}:notScreened`, source: 'policy', applicability: 'unresolved' });
    else add('unchecked', { rule: `predicate:${id}:${r.answer}`, source: 'screening', applicability: 'unresolved' });
  }
  for (const d of input.markerNoSuggest ?? []) {
    if (!productsOfSubject(d.subject).includes(product.id)) continue;
    const s: SuggestionPolicyState = d.applicability === 'applicable' && !d.stale ? 'noSuggest' : d.applicability === 'notApplicable' ? 'allow' : 'unchecked';
    if (s === 'allow') continue;
    add(s, { rule: d.rule, source: 'marker', applicability: d.applicability, sampleDate: d.sampleDate, stale: d.stale });
  }
  if (input.clinicianStops?.includes(product.id)) add('noSuggest', { rule: 'clinicianStop', source: 'clinician', applicability: 'applicable' });
  if (input.refused?.includes(product.id)) add('noSuggest', { rule: 'refused', source: 'user', applicability: 'applicable' });
  return { subject: product.id, state, reasons };
}

/** Decisions for a list of products, in their order. */
export function suggestionDecisions(products: readonly PolicyProduct[], input: SuggestionSafetyInput): SuggestionDecision[] {
  return products.map((p) => suggestionDecision(p, input));
}

/** Whether a decision allows a new suggestion card (allow, or caution shown with the card). */
export const isSuggestible = (d: Pick<SuggestionDecision, 'state'>): boolean => d.state === 'allow' || d.state === 'caution';

/** Inline status words (C6): short, details in the info sheet. */
export const POLICY_LABEL: Readonly<Record<SuggestionPolicyState, string>> = {
  allow: '',
  caution: 'Caution',
  clinicianReview: 'Review',
  noSuggest: 'Not suggested',
  unchecked: 'Unchecked',
};

/**
 * Status of a product the person already takes (D7-03): logging stays allowed and its exposure is kept; the row shows a
 * caution, review or unchecked status, never a stop/start instruction from the app.
 */
export function takenProductStatus(d: Pick<SuggestionDecision, 'state'>): 'none' | 'caution' | 'review' | 'unchecked' {
  switch (d.state) {
    case 'allow':
      return 'none';
    case 'caution':
      return 'caution';
    case 'unchecked':
      return 'unchecked';
    case 'clinicianReview':
    case 'noSuggest':
      return 'review';
  }
}

/** Short reason words of a decision for the tap-accessible details list ("kidney disease", "blood result", …). */
export function reasonWords(d: Pick<SuggestionDecision, 'reasons'>): string[] {
  const out: string[] = [];
  for (const r of d.reasons) {
    const m = /^predicate:([a-z-]+)(?::(.+))?$/.exec(r.rule);
    let w: string;
    if (m && m[1] && (CONTRAINDICATION_PREDICATES as readonly string[]).includes(m[1])) {
      const label = PREDICATES[m[1] as ContraindicationPredicateId].label;
      w = m[2] === 'notScreened' ? `${label} (not asked)` : m[2] ? `${label} (not answered)` : label;
    } else if (r.source === 'marker') w = r.applicability === 'applicable' ? 'blood result' : 'blood result (needs context)';
    else if (r.rule === 'clinicianStop') w = 'clinician advice';
    else if (r.rule === 'refused') w = 'not for you';
    else w = 'not checked';
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/* ===================================================================================================================
   Exercise symptom gate (D4-02)
   =================================================================================================================== */

export type ExerciseGateStatus = 'clear' | 'review' | 'suspended' | 'envelope';

export interface ExerciseSymptomGate {
  status: ExerciseGateStatus;
  reasonCode: 'noConcern' | 'legacyAnswerNeedsContext' | 'concerningUnresolved' | 'envelopeCovers' | 'envelopeNeedsReview';
  /** Autonomous new exercise prescription allowed (RT/cardio) — false while suspended or under review. */
  allowsNewExercise: boolean;
  /** Progression (dose increases, exercise-driven step increases) allowed. */
  allowsProgression: boolean;
  /**
   * Step targets: `free` (normal planning) or `documentedOnly` (never above the documented baseline or the envelope's
   * ceiling; no default minimum or Ideal relaxation; without a documented baseline there is no new numeric step target).
   */
  steps: 'free' | 'documentedOnly';
  /** The envelope in force (status `envelope`). */
  envelope?: ClinicianExerciseEnvelope;
  /** Concerning unresolved symptoms not covered by a valid envelope. */
  uncovered: string[];
}

/** ISO date of a date or an instant ('' when absent): dates and instants are compared by calendar day. */
const dateOf = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : '');

/**
 * An envelope that can authorize on `today`: not revoked, its own review date not passed, and not assessed after today
 * (no invented expiry otherwise). Without a known day nothing is authorized (`screeningExerciseGate` passes no envelopes).
 */
export function envelopeValid(e: ClinicianExerciseEnvelope, today: IsoDate): boolean {
  if (dateOf(e.assessedAt) > today) return false;
  if (e.revokedAt !== undefined && dateOf(e.revokedAt) <= today) return false;
  if (e.reviewBy !== undefined && dateOf(e.reviewBy) < today) return false;
  return true;
}

/**
 * Whether one envelope governs all the given unresolved symptoms on `today` (the planner's `envelopeCovers` semantics):
 * valid, listing every symptom id, and assessed on or after each symptom's date — a later, materially new symptom
 * invalidates it regardless of the envelope's own dates.
 */
export function envelopeCoversAll(e: ClinicianExerciseEnvelope, symptoms: readonly SymptomReport[], today: IsoDate): boolean {
  if (!envelopeValid(e, today)) return false;
  for (const s of symptoms) {
    if (!e.coversSymptomIds?.includes(s.id)) return false;
    const at = dateOf(s.occurredOn) || dateOf(s.reportedAt);
    if (at && dateOf(e.assessedAt) < at) return false;
  }
  return true;
}

/**
 * The exercise gate from current symptom state (D4-02), with the same semantics as the planner's `exerciseGateOf`
 * (src/engine/planner/domain/safety.ts) so the screening, the planner and the lifecycle checks agree:
 *  - a concerning unresolved exertional symptom suspends autonomous exercise prescription and progression unless ONE valid
 *    envelope assessed on or after every such symptom names them all (the newest such envelope applies);
 *  - a legacy screening yes / prefer-not / unknown without a clarifying structured report on a concerning category (any
 *    known status) is review: context incomplete, not a diagnosis; a valid envelope may cover it;
 *  - unknown-status reports and non-cardiorespiratory categories are neither a diagnosis nor a clarification.
 * Under an envelope, new RT/cardio needs progression permission and the named domain; steps follow the envelope's ceiling,
 * or the documented baseline unless walking/steps progression is permitted.
 */
export function exerciseSymptomGate(input: {
  /** The legacy screening answer to "fainting, chest pain or dizziness" (Q13). */
  screening?: ScreeningAnswer | 'prefer-not' | null;
  symptoms?: readonly SymptomReport[] | null;
  envelopes?: readonly ClinicianExerciseEnvelope[] | null;
  today: IsoDate;
}): ExerciseSymptomGate {
  const symptoms = input.symptoms ?? [];
  const concerning = symptoms.filter(isConcerningUnresolved);
  const ids = concerning.map((s) => s.id).sort();
  const clarified = symptoms.some((s) => CONCERNING_EXERTIONAL_SYMPTOMS.has(s.category) && s.status !== 'unknown');
  const a = input.screening;
  const legacyOpen = !clarified && (a === 'yes' || a === 'preferNot' || a === 'prefer-not' || a === 'unknown');
  if (!concerning.length && !legacyOpen) return { status: 'clear', reasonCode: 'noConcern', allowsNewExercise: true, allowsProgression: true, steps: 'free', uncovered: [] };
  const all = input.envelopes ?? [];
  const envs = [...all].sort((x, y) => (x.assessedAt < y.assessedAt ? 1 : x.assessedAt > y.assessedAt ? -1 : x.id < y.id ? -1 : 1));
  const env = envs.find((e) => (concerning.length ? envelopeCoversAll(e, concerning, input.today) : envelopeValid(e, input.today)));
  if (env) {
    const progress = env.progressionAllowed;
    const ownCeiling = typeof env.stepsCeiling === 'number' && Number.isFinite(env.stepsCeiling);
    const walkProgress = progress && (env.permitted.includes('steps') || env.permitted.includes('walking'));
    return {
      status: 'envelope',
      reasonCode: 'envelopeCovers',
      allowsNewExercise: progress && (env.permitted.includes('resistance') || env.permitted.includes('cardio')),
      allowsProgression: progress,
      steps: !ownCeiling && walkProgress ? 'free' : 'documentedOnly',
      envelope: env,
      uncovered: [],
    };
  }
  // an envelope that no longer authorizes (revoked, review date passed) is never carried forward silently
  const lapsed = all.some((e) => !envelopeValid(e, input.today) && (concerning.length ? concerning.some((s) => e.coversSymptomIds?.includes(s.id)) : true));
  const reasonCode: ExerciseSymptomGate['reasonCode'] = lapsed ? 'envelopeNeedsReview' : concerning.length ? 'concerningUnresolved' : 'legacyAnswerNeedsContext';
  return { status: concerning.length ? 'suspended' : 'review', reasonCode, allowsNewExercise: false, allowsProgression: false, steps: 'documentedOnly', uncovered: ids };
}

/** The planner's gate name for a status (`SafetyCaps['exercise'].gate`): clear → none, review → reviewNeeded. */
export const PLANNER_GATE_OF: Readonly<Record<ExerciseGateStatus, 'none' | 'reviewNeeded' | 'suspended' | 'envelope'>> = { clear: 'none', review: 'reviewNeeded', suspended: 'suspended', envelope: 'envelope' };
