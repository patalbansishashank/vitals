/**
 * Vitals safety gate — pure rules.
 *
 * Source: research/17-safety-guardrails.md (§2.2 HC-*, §3 W-*, §4.1 onboarding gate, §4.2 population
 * rules, §4.3 fasting tiers + exclusion codes EX-*, §4.4 medication gate, §4.5 DS-10 privacy) and
 * design/screens/onboarding-safety.md. Screening answers (+ optional body context and opt-ins) go in;
 * access levels, planner locks, required acknowledgements and message ids come out.
 *
 * Pure: no DOM, no clock, no copy. Timestamps are ISO strings supplied by the caller; message and
 * lock ids map to text in ./copy.ts. The Planner consumes `plannerLocks` + `fasting`; the Simulator
 * consumes `flags` + `simulatorRules` to arm its population warnings (W-P*, W-M05, W-M10, W-X05).
 *
 * Where the dossier is internally inconsistent the STRICTER reading is implemented and marked
 * `REVIEW:` (clinician review), e.g. the T1 policy row excludes EX-H/EX-J/EX-K while the exclusion-
 * code table applies them from T2.
 */

/* ============================================================================
   Versions
   ============================================================================ */

/** Bump when a rule changes meaning; stored outcomes are recomputed from answers anyway. */
export const RULES_VERSION = 1;
/** Bump when questions are added/changed: stored answers then need a review before the gate clears. */
export const QUESTION_SET_VERSION = 1;
/** PAR-Q+-style clearance lapses after 12 months (dossier §4.1). */
export const CLEARANCE_VALID_DAYS = 365;
/** Q19: recent illness blocks fasts over T1 for 4 weeks (dossier §4.1). */
export const RECENT_ILLNESS_BLOCK_DAYS = 28;

/* ============================================================================
   Answers
   ============================================================================ */

export type YesNo = 'yes' | 'no';
export type YesNoPrefer = 'yes' | 'no' | 'prefer-not';
export type AgeBand = 'under-18' | '18-64' | '65-74' | '75-plus';
export type PregnancyAnswer = 'pregnant-or-breastfeeding' | 'planning' | 'no' | 'prefer-not';

export const DIABETES_ITEMS = ['type-1', 'insulin', 'sulfonylurea-meglitinide', 'sglt2', 'metformin', 'glp1-injection', 'other-glucose-lowering', 'diet-only'] as const;
export type DiabetesItem = (typeof DIABETES_ITEMS)[number];

export const CONDITION_ITEMS = ['heart', 'high-blood-pressure', 'kidney', 'liver', 'stroke'] as const;
export type ConditionItem = (typeof CONDITION_ITEMS)[number];

export const METABOLIC_ITEMS = ['gout', 'kidney-stones', 'gallstones', 'pancreatitis', 'rare-metabolic'] as const;
export type MetabolicItem = (typeof METABOLIC_ITEMS)[number];

export const MEDICATION_ITEMS = [
  'diuretic',
  'acei-arb-mra',
  'other-blood-pressure',
  'lithium',
  'topiramate-zonisamide',
  'corticosteroid',
  'heart-rhythm',
  'chemotherapy',
  'antacid',
  'anticoagulant',
  'thyroid',
  'other',
] as const;
export type MedicationItem = (typeof MEDICATION_ITEMS)[number];

/** SCOFF-adapted items (dossier §4.1 Q4–Q8). Never persisted (DS-10): only `scoffRisk` is. */
export const SCOFF_ITEMS = ['sick', 'control', 'weightLoss', 'believeFat', 'foodDominates'] as const;
export type ScoffItem = (typeof SCOFF_ITEMS)[number];

/** SARC-F (dossier §4.1 Q18), asked for age 65–74. 0 none · 1 some · 2 a lot / unable (falls: 0 · 1–3 · ≥ 4). */
export const SARCF_ITEMS = ['lift', 'walk', 'chair', 'stairs', 'falls'] as const;
export type SarcfItem = (typeof SARCF_ITEMS)[number];
export type SarcfScore = 0 | 1 | 2;

export interface ScreeningAnswers {
  /** Q1 (dossier asks the age; we ask the band — the exact age comes from Your body as context). */
  ageBand?: AgeBand;
  /** Q2 */
  pregnancy?: PregnancyAnswer;
  /** Q3 */
  eatingDisorder?: YesNoPrefer;
  /** Q4–Q8, shown when Q3 = no. Transient: stripped before storage. */
  scoff?: Partial<Record<ScoffItem, YesNo>>;
  /** Stored instead of the SCOFF items: score ≥ 2. */
  scoffRisk?: boolean;
  /** Q9 + follow-up */
  diabetes?: YesNoPrefer;
  diabetesItems?: DiabetesItem[];
  /** Q10 + follow-up */
  conditions?: YesNoPrefer;
  conditionItems?: ConditionItem[];
  /** Q12 + follow-up */
  metabolic?: YesNoPrefer;
  metabolicItems?: MetabolicItem[];
  /** Q11 + class picker (§4.4) */
  medications?: YesNoPrefer;
  medicationItems?: MedicationItem[];
  /** Q13 fainting / chest pain / dizziness */
  symptoms?: YesNoPrefer;
  /** Q15 exercise only under medical supervision */
  supervisedExercise?: YesNoPrefer;
  /** Q14 bone, joint or muscle problem */
  musculoskeletal?: YesNoPrefer;
  /** Q16 heavy alcohol use */
  alcohol?: YesNoPrefer;
  /** Q18 SARC-F, age 65–74 */
  sarcf?: Partial<Record<SarcfItem, SarcfScore>>;
}

/** Top-level questions (follow-ups belong to their parent). Order = display order. */
export type QuestionId =
  | 'ageBand'
  | 'sarcf'
  | 'pregnancy'
  | 'eatingDisorder'
  | 'scoff'
  | 'diabetes'
  | 'conditions'
  | 'metabolic'
  | 'medications'
  | 'symptoms'
  | 'supervisedExercise'
  | 'musculoskeletal'
  | 'alcohol';

/** Body facts from Your body. Without them the BMI / body-fat / exact-age rules are skipped. */
export interface SafetyContext {
  ageYears?: number;
  bmi?: number;
  bodyFatPct?: number;
  /** The physiological model's sex parameter (dossier §1.1), not an identity statement. */
  sex?: 'male' | 'female';
  /** High training load / EA < 45 (EX-L), from Habits. */
  highTrainingLoad?: boolean;
  optIns?: SafetyOptIns;
}

/** Opt-ins that are valid now (see `resolveOptIns`). */
export interface SafetyOptIns {
  /** Highest fasting tier the user opted into with current acknowledgements. */
  fastingTier?: OptInTier | null;
  /** HC-F5: daily eating windows of 4 to < 6 h. */
  shortEatingWindow?: boolean;
  /** Q19 answered yes within the last 4 weeks. */
  recentIllness?: boolean;
}

/* ============================================================================
   Outcome types (exported for the Planner and the Simulator)
   ============================================================================ */

/** Dossier user modes: M0 standard · R1 ED-risk restricted · R2 clinician-first · H hard stop. */
export type SafetyModeCode = 'M0' | 'R1' | 'R2' | 'H';
export type RestrictionMode = 'R1' | 'R2';
export type HardStop = 'BLOCK_APP' | 'BLOCK_PLANNER';
/** User-facing mode names (design: "Standard mode", "Gentle mode", …). */
export type ModeName = 'standard' | 'gentle' | 'clinician-first' | 'simulator-only' | 'adults-only';

export type SimulatorAccess = 'full' | 'with-warnings' | 'blocked';
export type PlannerAccess = 'full' | 'restricted' | 'blocked';

/** Water-only fasting tiers by consecutive hours with ≤ 50 kcal (dossier §4.3.2). */
export type FastingTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
export type OptInTier = 'T2' | 'T3' | 'T4';
/** Tier acknowledgements (dossier §4.3.3): A honest + not advice · B stop rules · C supervision/someone knows · D clinician supervising. */
export type FastingAckId = 'A' | 'B' | 'C' | 'D';

export const TIER_ORDER: readonly FastingTier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
/** Upper bound (hours) of each tier. T5 (> 7 d) is never planned. */
export const TIER_MAX_HOURS: Readonly<Record<Exclude<FastingTier, 'T5'>, number>> = { T0: 20, T1: 24, T2: 48, T3: 72, T4: 168 };
export const TIER_ACKNOWLEDGEMENTS: Readonly<Record<OptInTier, readonly FastingAckId[]>> = { T2: ['A', 'B'], T3: ['A', 'B', 'C'], T4: ['A', 'B', 'C', 'D'] };
/** T4 (3–7 d) and VLED blocks need expert mode; the dossier recommends a feature flag until clinician review. */
export const EXPERT_TIER: OptInTier = 'T4';
/**
 * Expert mode (T4, tier V) is built but OFF until a clinician reviews its copy (dossier §1.2 item 1, §4.3.2).
 * REVIEW: flip only after clinician + counsel sign-off, and update LIMITS_PAGE.limits "fasting" in copy.ts.
 */
export const EXPERT_MODE_AVAILABLE = false;

/** Body-fat floors (HC-P5, PROPOSED) by the model's sex parameter. */
export const BF_FLOOR_PCT = { male: 10, female: 18 } as const;

export type PlannerLockId =
  | 'no-deficit'
  | 'deficit-cap'
  | 'rate-cap'
  | 'max-fast'
  | 'min-eating-window'
  | 'no-ketogenic'
  | 'carb-floor'
  | 'no-vled'
  | 'no-weight-loss-goal'
  | 'protein-cap'
  | 'protein-floor'
  | 'no-potassium-supplement'
  | 'no-creatine'
  | 'fat-floor'
  | 'exercise-light-moderate'
  | 'exercise-low-impact'
  | 'no-exercise-prescription';

/**
 * Units: deficit-cap % of maintenance · rate-cap % body weight per week · max-fast h ·
 * min-eating-window h · carb-floor g/day · protein-cap / protein-floor g per kg reference weight ·
 * fat-floor g/day.
 */
export const LOCK_UNIT: Readonly<Partial<Record<PlannerLockId, string>>> = {
  'deficit-cap': '% of maintenance',
  'rate-cap': '% body weight per week',
  'max-fast': 'h',
  'min-eating-window': 'h',
  'carb-floor': 'g/day',
  'protein-cap': 'g/kg reference weight',
  'protein-floor': 'g/kg reference weight',
  'fat-floor': 'g/day',
};

export type LockSource = QuestionId | 'body' | 'default' | 'opt-in';

export interface LockReason {
  /** Rule id ('HC-P3', 'EX-C', 'HC-M4') or a plain name ('population rules', 'medication check'). Never shown to users. */
  rule: string;
  source: LockSource;
}

export interface PlannerLock {
  id: PlannerLockId;
  /** For caps and floors (see LOCK_UNIT). */
  value?: number;
  /** The binding reasons (all reasons at the strictest value). */
  reasons: LockReason[];
}

export type AcknowledgementId = 'disclaimer' | 'clinician-first';

export interface RequiredAcknowledgement {
  id: AcknowledgementId;
  /** `app`: before anything (first-run consent) · `planner`: the "talk to your clinician" interstitial (§4.2 Warn). */
  scope: 'app' | 'planner';
}

export type MessageId =
  | 'adults-only'
  | 'older-adult'
  | 'older-adult-75'
  | 'sarcopenia-risk'
  | 'pregnancy-planner-off'
  | 'pregnancy-planning'
  | 'pregnancy-undisclosed'
  | 'gentle-mode'
  | 'gentle-mode-undisclosed'
  | 'gentle-mode-scoff'
  | 'diabetes-planner-off'
  | 'diabetes-clinician-first'
  | 'diabetes-undisclosed'
  | 'conditions-clinician-first'
  | 'metabolic-clinician-first'
  | 'medications-clinician-first'
  | 'symptoms-exercise'
  | 'supervised-exercise'
  | 'musculoskeletal-exercise'
  | 'alcohol-fasting'
  | 'body-underweight'
  | 'body-bmi-below-20'
  | 'body-bf-below-floor'
  | 'refeeding-risk';

export type MessageSeverity = 'info' | 'caution' | 'danger';

export interface SafetyMessage {
  id: MessageId;
  severity: MessageSeverity;
  source: QuestionId | 'body';
  rules: string[];
}

/** Profile flags for the Simulator's population rules (dossier `{mode, flags[]}`). */
export type SafetyFlag =
  | 'under-18'
  | 'age-65-74'
  | 'age-75-plus'
  | 'sarcopenia-risk'
  | 'pregnant'
  | 'planning-pregnancy'
  | 'pregnancy-undisclosed'
  | 'ed-history'
  | 'ed-undisclosed'
  | 'scoff-risk'
  | 'type-1-diabetes'
  | 'insulin'
  | 'sulfonylurea'
  | 'sglt2-inhibitor'
  | 'metformin'
  | 'glp1'
  | 'other-glucose-lowering'
  | 'diabetes-diet-only'
  | 'diabetes-undisclosed'
  | 'heart-condition'
  | 'high-blood-pressure'
  | 'kidney-disease'
  | 'liver-disease'
  | 'stroke'
  | 'conditions-undisclosed'
  | 'gout'
  | 'kidney-stones'
  | 'gallstones'
  | 'pancreatitis'
  | 'rare-metabolic'
  | 'metabolic-undisclosed'
  | 'diuretic'
  | 'raas-blocker'
  | 'other-antihypertensive'
  | 'lithium'
  | 'topiramate-zonisamide'
  | 'corticosteroid'
  | 'qt-prolonging'
  | 'chemotherapy'
  | 'antacid'
  | 'anticoagulant'
  | 'thyroid-hormone'
  | 'other-medication'
  | 'medications-undisclosed'
  | 'exercise-symptoms'
  | 'supervised-exercise-only'
  | 'musculoskeletal'
  | 'heavy-alcohol'
  | 'underweight'
  | 'bmi-below-20'
  | 'bmi-below-16'
  | 'bf-below-floor'
  | 'bf-near-floor'
  | 'high-training-load'
  | 'recent-illness'
  | 'refeeding-risk';

/** Simulator population / profile rules armed by this profile (dossier §3). */
export type SimulatorRuleId = 'W-P01' | 'W-P02' | 'W-P03' | 'W-P04' | 'W-P05' | 'W-P06' | 'W-P07' | 'W-M05' | 'W-M10' | 'W-M24' | 'W-X05';

export interface FastingEligibility {
  /** Highest tier this profile may reach with opt-ins (null when the app is blocked). */
  maxEligibleTier: FastingTier | null;
  /** Profile cap in hours before opt-ins (12 = "no fasting over 12 h"). */
  eligibleMaxHours: number;
  /** Effective cap for plans after opt-ins (the `max-fast` lock value). */
  maxFastHours: number;
  /** Tier that `maxFastHours` falls in. */
  effectiveTier: FastingTier | null;
  /** Tiers the user may opt into now (above the T1 default, within eligibility). */
  optInTiers: OptInTier[];
  /** Why the profile cap sits where it does. */
  bindingReasons: LockReason[];
  /** The 4–6 h eating-window opt-in (HC-F5) is available. */
  shortWindowAvailable: boolean;
}

export interface ScreeningOutcome {
  rulesVersion: number;
  /** Every visible question has an answer. */
  complete: boolean;
  missing: QuestionId[];
  mode: SafetyModeCode;
  modeName: ModeName;
  /** R1 and R2 can co-occur (intersection of restrictions). */
  restrictions: RestrictionMode[];
  hardStop: HardStop | null;
  simulatorAccess: SimulatorAccess;
  plannerAccess: PlannerAccess;
  /** Empty when the Planner is blocked. */
  plannerLocks: PlannerLock[];
  requiredAcknowledgements: RequiredAcknowledgement[];
  messages: SafetyMessage[];
  flags: SafetyFlag[];
  simulatorRules: SimulatorRuleId[];
  fasting: FastingEligibility;
  /** Body context (BMI, body fat, age in years) was available and applied. */
  bodyRulesApplied: boolean;
}

/* ============================================================================
   Questions: visibility, completeness, scores
   ============================================================================ */

const ALWAYS_AFTER_ED: QuestionId[] = ['diabetes', 'conditions', 'metabolic', 'medications', 'symptoms', 'supervisedExercise', 'musculoskeletal', 'alcohol'];

/** Questions currently shown, in display order. Under 18 ends the questionnaire. */
export function visibleQuestions(a: ScreeningAnswers): QuestionId[] {
  if (a.ageBand === 'under-18') return ['ageBand'];
  const q: QuestionId[] = ['ageBand'];
  if (a.ageBand === '65-74') q.push('sarcf');
  q.push('pregnancy', 'eatingDisorder');
  if (a.eatingDisorder === 'no') q.push('scoff');
  q.push(...ALWAYS_AFTER_ED);
  return q;
}

export function scoffScore(items: ScreeningAnswers['scoff']): number | null {
  if (!items) return null;
  let n = 0;
  for (const k of SCOFF_ITEMS) {
    const v = items[k];
    if (v === undefined) return null;
    if (v === 'yes') n += 1;
  }
  return n;
}

export function sarcfScore(items: ScreeningAnswers['sarcf']): number | null {
  if (!items) return null;
  let n = 0;
  for (const k of SARCF_ITEMS) {
    const v = items[k];
    if (v === undefined) return null;
    n += v;
  }
  return n;
}

/** SCOFF-adapted risk flag: ≥ 2 "yes" (dossier Q8), or the stored flag when items were not kept. */
export function scoffPositive(a: ScreeningAnswers): boolean {
  const s = scoffScore(a.scoff);
  if (s !== null) return s >= 2;
  return a.scoffRisk === true;
}

function withItems<T>(answer: YesNoPrefer | undefined, items: readonly T[] | undefined): boolean {
  return answer !== undefined && (answer !== 'yes' || (items?.length ?? 0) > 0);
}

export interface CompletenessOptions {
  /**
   * Require the five SCOFF answers themselves (the form). Stored answers only keep `scoffRisk`,
   * which counts as answered when false (default).
   */
  requireScoffItems?: boolean;
}

export function isAnswered(q: QuestionId, a: ScreeningAnswers, opts: CompletenessOptions = {}): boolean {
  switch (q) {
    case 'ageBand':
      return a.ageBand !== undefined;
    case 'sarcf':
      return sarcfScore(a.sarcf) !== null;
    case 'pregnancy':
      return a.pregnancy !== undefined;
    case 'eatingDisorder':
      return a.eatingDisorder !== undefined;
    case 'scoff':
      return scoffScore(a.scoff) !== null || (!opts.requireScoffItems && typeof a.scoffRisk === 'boolean');
    case 'diabetes':
      return withItems(a.diabetes, a.diabetesItems);
    case 'conditions':
      return withItems(a.conditions, a.conditionItems);
    case 'metabolic':
      return withItems(a.metabolic, a.metabolicItems);
    case 'medications':
      return withItems(a.medications, a.medicationItems);
    case 'symptoms':
      return a.symptoms !== undefined;
    case 'supervisedExercise':
      return a.supervisedExercise !== undefined;
    case 'musculoskeletal':
      return a.musculoskeletal !== undefined;
    case 'alcohol':
      return a.alcohol !== undefined;
  }
}

/** Visible questions without an answer ("prefer not to say" counts as an answer). */
export function missingQuestions(a: ScreeningAnswers, opts: CompletenessOptions = {}): QuestionId[] {
  return visibleQuestions(a).filter((q) => !isAnswered(q, a, opts));
}

/**
 * Data minimisation before anything is stored (DS-10, §4.7): drop SCOFF item answers (keep only
 * the risk flag), follow-up items whose parent is not "yes", and answers to hidden questions.
 */
export function sanitizeAnswers(a: ScreeningAnswers): ScreeningAnswers {
  if (a.ageBand === 'under-18') return { ageBand: 'under-18' };
  const out: ScreeningAnswers = {};
  const visible = new Set(visibleQuestions(a));
  if (a.ageBand) out.ageBand = a.ageBand;
  if (visible.has('sarcf') && a.sarcf) out.sarcf = { ...a.sarcf };
  if (a.pregnancy) out.pregnancy = a.pregnancy;
  if (a.eatingDisorder) out.eatingDisorder = a.eatingDisorder;
  if (visible.has('scoff')) {
    const s = scoffScore(a.scoff);
    if (s !== null) out.scoffRisk = s >= 2;
    else if (typeof a.scoffRisk === 'boolean') out.scoffRisk = a.scoffRisk;
  }
  const pair = <T>(ans: YesNoPrefer | undefined, items: readonly T[] | undefined): [YesNoPrefer | undefined, T[] | undefined] =>
    ans === 'yes' ? [ans, items && items.length ? [...new Set(items)] : undefined] : [ans, undefined];
  [out.diabetes, out.diabetesItems] = pair(a.diabetes, a.diabetesItems);
  [out.conditions, out.conditionItems] = pair(a.conditions, a.conditionItems);
  [out.metabolic, out.metabolicItems] = pair(a.metabolic, a.metabolicItems);
  [out.medications, out.medicationItems] = pair(a.medications, a.medicationItems);
  if (a.symptoms) out.symptoms = a.symptoms;
  if (a.supervisedExercise) out.supervisedExercise = a.supervisedExercise;
  if (a.musculoskeletal) out.musculoskeletal = a.musculoskeletal;
  if (a.alcohol) out.alcohol = a.alcohol;
  for (const k of Object.keys(out) as Array<keyof ScreeningAnswers>) if (out[k] === undefined) delete out[k];
  return out;
}

/* ============================================================================
   Flags
   ============================================================================ */

const positive = (x: YesNoPrefer | undefined) => x === 'yes' || x === 'prefer-not';

const DIABETES_FLAG: Record<DiabetesItem, SafetyFlag> = {
  'type-1': 'type-1-diabetes',
  insulin: 'insulin',
  'sulfonylurea-meglitinide': 'sulfonylurea',
  sglt2: 'sglt2-inhibitor',
  metformin: 'metformin',
  'glp1-injection': 'glp1',
  'other-glucose-lowering': 'other-glucose-lowering',
  'diet-only': 'diabetes-diet-only',
};
const CONDITION_FLAG: Record<ConditionItem, SafetyFlag> = {
  heart: 'heart-condition',
  'high-blood-pressure': 'high-blood-pressure',
  kidney: 'kidney-disease',
  liver: 'liver-disease',
  stroke: 'stroke',
};
const METABOLIC_FLAG: Record<MetabolicItem, SafetyFlag> = {
  gout: 'gout',
  'kidney-stones': 'kidney-stones',
  gallstones: 'gallstones',
  pancreatitis: 'pancreatitis',
  'rare-metabolic': 'rare-metabolic',
};
const MEDICATION_FLAG: Record<MedicationItem, SafetyFlag> = {
  diuretic: 'diuretic',
  'acei-arb-mra': 'raas-blocker',
  'other-blood-pressure': 'other-antihypertensive',
  lithium: 'lithium',
  'topiramate-zonisamide': 'topiramate-zonisamide',
  corticosteroid: 'corticosteroid',
  'heart-rhythm': 'qt-prolonging',
  chemotherapy: 'chemotherapy',
  antacid: 'antacid',
  anticoagulant: 'anticoagulant',
  thyroid: 'thyroid-hormone',
  other: 'other-medication',
};

/** HC-P6: these block the Planner. */
const PLANNER_BLOCKING_DIABETES: readonly SafetyFlag[] = ['type-1-diabetes', 'insulin', 'sulfonylurea', 'sglt2-inhibitor'];
/** EX-E: any glucose-lowering drug or type 1 → no fasting over 12 h. */
const GLUCOSE_LOWERING: readonly SafetyFlag[] = ['type-1-diabetes', 'insulin', 'sulfonylurea', 'sglt2-inhibitor', 'metformin', 'glp1', 'other-glucose-lowering'];
const CONDITION_FLAGS: readonly SafetyFlag[] = ['heart-condition', 'high-blood-pressure', 'kidney-disease', 'liver-disease', 'stroke'];
const METABOLIC_FLAGS: readonly SafetyFlag[] = ['gout', 'kidney-stones', 'gallstones', 'pancreatitis', 'rare-metabolic'];
const MEDICATION_FLAGS: readonly SafetyFlag[] = Object.values(MEDICATION_FLAG);
/** NICE refeeding risk factors among medicines (§4.3.3): insulin, chemotherapy, antacids, diuretics. */
const REFEEDING_MEDICINES: readonly SafetyFlag[] = ['insulin', 'chemotherapy', 'antacid', 'diuretic'];

function bfFloor(sex: 'male' | 'female' | undefined): number | null {
  return sex ? BF_FLOOR_PCT[sex] : null;
}

/** Profile flags from answers and body context. Sorted, unique. */
export function deriveFlags(a: ScreeningAnswers, ctx: SafetyContext = {}): SafetyFlag[] {
  const f = new Set<SafetyFlag>();
  const age = ctx.ageYears;
  if (a.ageBand === 'under-18' || (age !== undefined && age < 18)) {
    f.add('under-18');
    return [...f];
  }
  if (a.ageBand === '75-plus' || (age !== undefined && age >= 75)) f.add('age-75-plus');
  else if (a.ageBand === '65-74' || (age !== undefined && age >= 65)) f.add('age-65-74');
  const sarcf = sarcfScore(a.sarcf);
  if (a.ageBand === '65-74' && sarcf !== null && sarcf >= 4) f.add('sarcopenia-risk');

  if (a.pregnancy === 'pregnant-or-breastfeeding') f.add('pregnant');
  else if (a.pregnancy === 'planning') f.add('planning-pregnancy');
  else if (a.pregnancy === 'prefer-not') f.add('pregnancy-undisclosed');

  if (a.eatingDisorder === 'yes') f.add('ed-history');
  else if (a.eatingDisorder === 'prefer-not') f.add('ed-undisclosed');
  else if (a.eatingDisorder === 'no' && scoffPositive(a)) f.add('scoff-risk');

  if (a.diabetes === 'yes') for (const i of a.diabetesItems ?? []) f.add(DIABETES_FLAG[i]);
  else if (a.diabetes === 'prefer-not') f.add('diabetes-undisclosed');

  if (a.conditions === 'yes') for (const i of a.conditionItems ?? []) f.add(CONDITION_FLAG[i]);
  else if (a.conditions === 'prefer-not') f.add('conditions-undisclosed');

  if (a.metabolic === 'yes') for (const i of a.metabolicItems ?? []) f.add(METABOLIC_FLAG[i]);
  else if (a.metabolic === 'prefer-not') f.add('metabolic-undisclosed');

  if (a.medications === 'yes') for (const i of a.medicationItems ?? []) f.add(MEDICATION_FLAG[i]);
  else if (a.medications === 'prefer-not') f.add('medications-undisclosed');

  // "Prefer not to say" routes to the safer reading (design §10; REVIEW: mapping not specified by the dossier for Q13–Q16).
  if (positive(a.symptoms)) f.add('exercise-symptoms');
  if (positive(a.supervisedExercise)) f.add('supervised-exercise-only');
  if (positive(a.musculoskeletal)) f.add('musculoskeletal');
  if (positive(a.alcohol)) f.add('heavy-alcohol');

  const { bmi, bodyFatPct } = ctx;
  if (bmi !== undefined) {
    if (bmi < 16) f.add('bmi-below-16');
    if (bmi < 18.5) f.add('underweight');
    if (bmi < 20) f.add('bmi-below-20');
  }
  const floor = bfFloor(ctx.sex);
  if (floor !== null && bodyFatPct !== undefined) {
    if (bodyFatPct < floor) f.add('bf-below-floor');
    if (bodyFatPct < floor + 2) f.add('bf-near-floor');
  }
  if (ctx.highTrainingLoad) f.add('high-training-load');
  if (ctx.optIns?.recentIllness) f.add('recent-illness');

  // NICE refeeding risk (§4.3.3): one of BMI < 16 …, or two of BMI < 18.5, alcohol misuse, insulin/chemo/antacids/diuretics.
  // Unintentional-loss and intake-days criteria are not asked (DS-10 keeps the SCOFF weight item unstored).
  const twoOf = [f.has('underweight'), f.has('heavy-alcohol'), REFEEDING_MEDICINES.some((m) => f.has(m))].filter(Boolean).length;
  if (f.has('bmi-below-16') || twoOf >= 2) f.add('refeeding-risk');

  return [...f].sort();
}

/* ============================================================================
   Locks
   ============================================================================ */

/** Caps: lower value is stricter. Floors: higher value is stricter. */
const FLOOR_LOCKS: ReadonlySet<PlannerLockId> = new Set(['min-eating-window', 'carb-floor', 'protein-floor', 'fat-floor']);

class LockSet {
  private map = new Map<PlannerLockId, PlannerLock>();

  add(id: PlannerLockId, reason: LockReason, value?: number): void {
    const cur = this.map.get(id);
    if (!cur) {
      this.map.set(id, { id, value, reasons: [reason] });
      return;
    }
    if (value === undefined || cur.value === undefined) {
      if (!cur.reasons.some((r) => r.rule === reason.rule && r.source === reason.source)) cur.reasons.push(reason);
      return;
    }
    const stricter = FLOOR_LOCKS.has(id) ? value > cur.value : value < cur.value;
    if (stricter) this.map.set(id, { id, value, reasons: [reason] });
    else if (value === cur.value && !cur.reasons.some((r) => r.rule === reason.rule && r.source === reason.source)) cur.reasons.push(reason);
  }

  get(id: PlannerLockId): PlannerLock | undefined {
    return this.map.get(id);
  }

  list(): PlannerLock[] {
    const order: PlannerLockId[] = [
      'no-deficit',
      'deficit-cap',
      'rate-cap',
      'no-weight-loss-goal',
      'max-fast',
      'min-eating-window',
      'no-ketogenic',
      'carb-floor',
      'no-vled',
      'protein-floor',
      'protein-cap',
      'fat-floor',
      'no-potassium-supplement',
      'no-creatine',
      'exercise-light-moderate',
      'exercise-low-impact',
      'no-exercise-prescription',
    ];
    return order.map((id) => this.map.get(id)).filter((l): l is PlannerLock => l !== undefined);
  }
}

/** HC-E3 base deficit cap from BMI (PROPOSED shape, §2.3); age and body-fat adjustments are added as caps. */
function baseDeficitCap(bmi: number | undefined): { value: number; rule: string } {
  if (bmi === undefined) return { value: 25, rule: 'HC-E3' };
  if (bmi >= 30) return { value: 30, rule: 'HC-E3' };
  if (bmi < 25) return { value: 20, rule: 'HC-E3' };
  return { value: 25, rule: 'HC-E3' };
}

/** HC-E5 base rate cap (% BW / week, §2.3). */
function baseRateCap(ctx: SafetyContext): number {
  const floor = bfFloor(ctx.sex);
  const bf = ctx.bodyFatPct;
  let cap = 0.75;
  if (floor !== null && bf !== undefined && bf <= floor + 6) cap = 0.5;
  const highAdiposity = (ctx.bmi !== undefined && ctx.bmi >= 30) || (bf !== undefined && ctx.sex !== undefined && bf >= (ctx.sex === 'male' ? 30 : 40));
  if (highAdiposity) cap = 1.0;
  return cap;
}

export function tierForHours(hours: number): FastingTier {
  if (hours <= TIER_MAX_HOURS.T0) return 'T0';
  if (hours <= TIER_MAX_HOURS.T1) return 'T1';
  if (hours <= TIER_MAX_HOURS.T2) return 'T2';
  if (hours <= TIER_MAX_HOURS.T3) return 'T3';
  if (hours <= TIER_MAX_HOURS.T4) return 'T4';
  return 'T5';
}

export function tierRank(t: FastingTier): number {
  return TIER_ORDER.indexOf(t);
}

/* ============================================================================
   Evaluate
   ============================================================================ */

const R2_FLAGS: readonly SafetyFlag[] = [
  'planning-pregnancy',
  'metformin',
  'glp1',
  'other-glucose-lowering',
  'diabetes-diet-only',
  'diabetes-undisclosed',
  ...CONDITION_FLAGS,
  'conditions-undisclosed',
  ...METABOLIC_FLAGS,
  'metabolic-undisclosed',
  ...MEDICATION_FLAGS,
  'medications-undisclosed',
  'exercise-symptoms',
  'supervised-exercise-only',
];

/** Flags that narrow the Planner beyond the standard limits even outside R1/R2. */
const RESTRICTING_FLAGS: readonly SafetyFlag[] = [
  'age-65-74',
  'age-75-plus',
  'sarcopenia-risk',
  'musculoskeletal',
  'heavy-alcohol',
  'underweight',
  'bmi-below-20',
  'bf-below-floor',
  'refeeding-risk',
  'recent-illness',
];

/**
 * The onboarding gate (dossier §4.1–§4.4). Highest-priority outcome wins:
 * BLOCK_APP > BLOCK_PLANNER > R1 > R2 > M0; R1 and R2 co-occur as an intersection of restrictions.
 */
export function evaluateScreening(answers: ScreeningAnswers, context: SafetyContext = {}): ScreeningOutcome {
  const missing = missingQuestions(answers);
  const flags = deriveFlags(answers, context);
  const fl = new Set(flags);
  const has = (f: SafetyFlag) => fl.has(f);
  const bodyRulesApplied = context.bmi !== undefined || context.bodyFatPct !== undefined || context.ageYears !== undefined;

  const blockApp = has('under-18');
  const blockPlanner = !blockApp && (has('pregnant') || PLANNER_BLOCKING_DIABETES.some(has));
  const r1 = !blockApp && (has('ed-history') || has('ed-undisclosed') || has('scoff-risk'));
  const r2 = !blockApp && R2_FLAGS.some(has);
  const hardStop: HardStop | null = blockApp ? 'BLOCK_APP' : blockPlanner ? 'BLOCK_PLANNER' : null;
  const restrictions: RestrictionMode[] = [];
  if (r1) restrictions.push('R1');
  if (r2) restrictions.push('R2');
  const mode: SafetyModeCode = hardStop ? 'H' : r1 ? 'R1' : r2 ? 'R2' : 'M0';
  const modeName: ModeName = blockApp ? 'adults-only' : blockPlanner ? 'simulator-only' : r1 ? 'gentle' : r2 ? 'clinician-first' : 'standard';

  const messages = buildMessages(answers, fl);

  if (blockApp) {
    return {
      rulesVersion: RULES_VERSION,
      complete: missing.length === 0,
      missing,
      mode,
      modeName,
      restrictions,
      hardStop,
      simulatorAccess: 'blocked',
      plannerAccess: 'blocked',
      plannerLocks: [],
      requiredAcknowledgements: [],
      messages,
      flags,
      simulatorRules: [],
      fasting: {
        maxEligibleTier: null,
        eligibleMaxHours: 0,
        maxFastHours: 0,
        effectiveTier: null,
        optInTiers: [],
        bindingReasons: [{ rule: 'HC-P1', source: 'ageBand' }],
        shortWindowAvailable: false,
      },
      bodyRulesApplied,
    };
  }

  const locks = new LockSet();
  const L = (id: PlannerLockId, rule: string, source: LockSource, value?: number) => locks.add(id, { rule, source }, value);

  /* ---- defaults (every adult) ------------------------------------------ */
  const def = baseDeficitCap(context.bmi);
  L('deficit-cap', def.rule, context.bmi !== undefined ? 'body' : 'default', def.value);
  L('rate-cap', 'HC-E5', bodyRulesApplied ? 'body' : 'default', baseRateCap(context));
  L('no-vled', 'HC-E1', 'default'); // tier V is expert mode only (and BMI ≥ 30); see fasting below

  /* ---- fasting caps (hours) -------------------------------------------- */
  const caps: Array<{ hours: number; reason: LockReason }> = [];
  const capFast = (hours: number, rule: string, source: LockSource) => caps.push({ hours, reason: { rule, source } });

  /* ---- R1: gentle mode (HC-P3, EX-C, HC-F5, HC-M4) --------------------- */
  if (r1) {
    const src: QuestionId = has('scoff-risk') ? 'scoff' : 'eatingDisorder';
    L('no-deficit', 'HC-P3', src);
    L('no-weight-loss-goal', 'HC-P3', src);
    L('carb-floor', 'HC-P3', src, 100);
    L('no-ketogenic', 'HC-M4', src);
    L('min-eating-window', 'HC-F5', src, 12);
    capFast(12, 'EX-C', src);
  }

  /* ---- R2: clinician-first (HC-P7, §4.2, HC-M4) ------------------------ */
  if (r2) {
    const src = firstR2Source(fl);
    L('deficit-cap', 'HC-P7', src, 15);
    L('no-ketogenic', 'HC-M4', src);
    capFast(TIER_MAX_HOURS.T1, 'HC-P7', src); // T2+ require mode M0
  }

  /* ---- pregnancy (EX-B, §4.2) ------------------------------------------ */
  if (has('planning-pregnancy')) {
    L('no-deficit', 'population rules', 'pregnancy');
    L('min-eating-window', 'EX-B', 'pregnancy', 12);
    capFast(12, 'EX-B', 'pregnancy');
  }

  /* ---- diabetes (HC-P6, EX-E) ------------------------------------------ */
  if (GLUCOSE_LOWERING.some(has)) {
    L('min-eating-window', 'EX-E', 'diabetes', 12);
    capFast(12, 'EX-E', 'diabetes');
  }
  if (has('diabetes-undisclosed')) {
    // REVIEW: dossier gives no mapping for "prefer not to say" on Q9; treated as a possible glucose-lowering drug.
    L('min-eating-window', 'EX-E', 'diabetes', 12);
    capFast(12, 'EX-E', 'diabetes');
  }

  /* ---- conditions (§4.2, EX-F) ----------------------------------------- */
  if (has('kidney-disease')) {
    L('protein-cap', 'HC-M2', 'conditions', 1.3);
    L('no-potassium-supplement', 'HC-M7', 'conditions');
    L('no-creatine', 'HC-M12', 'conditions');
    L('no-ketogenic', 'population rules', 'conditions');
  }
  if (has('liver-disease')) L('no-ketogenic', 'population rules', 'conditions');
  if (has('heart-condition') || has('high-blood-pressure') || has('stroke')) L('exercise-light-moderate', 'HC-X4', 'conditions');
  if (CONDITION_FLAGS.some(has) || has('conditions-undisclosed')) capFast(TIER_MAX_HOURS.T1, 'EX-F', 'conditions');

  /* ---- metabolic (§4.2, EX-G, EX-H) ------------------------------------ */
  if (has('gout')) {
    L('rate-cap', 'population rules', 'metabolic', 0.5);
    L('no-ketogenic', 'population rules', 'metabolic');
    capFast(TIER_MAX_HOURS.T1, 'EX-G', 'metabolic');
  }
  if (has('kidney-stones')) capFast(TIER_MAX_HOURS.T2, 'EX-G', 'metabolic');
  if (has('gallstones')) {
    L('rate-cap', 'population rules', 'metabolic', 0.5);
    L('fat-floor', 'HC-M3', 'metabolic', 30);
    L('no-vled', 'population rules', 'metabolic');
  }
  if (has('pancreatitis')) L('no-ketogenic', 'W-M10', 'metabolic');
  if (has('rare-metabolic')) {
    L('no-ketogenic', 'W-M10', 'metabolic');
    // REVIEW: EX-H applies from T2 in the exclusion table but the T1 row excludes it too; stricter = T0.
    capFast(TIER_MAX_HOURS.T0, 'EX-H', 'metabolic');
  }
  if (has('metabolic-undisclosed')) L('no-ketogenic', 'population rules', 'metabolic');

  /* ---- medications (§4.4, EX-I) ---------------------------------------- */
  if (['diuretic', 'raas-blocker', 'other-antihypertensive'].some((m) => has(m as SafetyFlag))) {
    L('no-potassium-supplement', 'HC-M7', 'medications');
    capFast(TIER_MAX_HOURS.T1, 'medication check', 'medications');
  }
  if (has('lithium')) {
    L('no-ketogenic', 'medication check', 'medications');
    capFast(TIER_MAX_HOURS.T1, 'medication check', 'medications');
  }
  if (has('topiramate-zonisamide')) L('no-ketogenic', 'medication check', 'medications');
  if (has('qt-prolonging')) {
    L('no-vled', 'medication check', 'medications');
    capFast(TIER_MAX_HOURS.T1, 'medication check', 'medications');
  }
  if (has('chemotherapy') || has('antacid')) capFast(TIER_MAX_HOURS.T1, 'EX-I', 'medications');
  if (has('medications-undisclosed')) {
    // REVIEW: conservative reading of "prefer not to say" on Q11 (union of the common §4.4 restrictions).
    L('no-potassium-supplement', 'HC-M7', 'medications');
    capFast(TIER_MAX_HOURS.T1, 'medication check', 'medications');
  }

  /* ---- exercise (HC-X4, Q13–Q15) --------------------------------------- */
  if (has('exercise-symptoms')) {
    L('exercise-light-moderate', 'HC-X4', 'symptoms');
    capFast(TIER_MAX_HOURS.T1, 'Q13', 'symptoms');
  }
  if (has('supervised-exercise-only')) L('no-exercise-prescription', 'Q15', 'supervisedExercise');
  if (has('musculoskeletal')) L('exercise-low-impact', 'Q14', 'musculoskeletal');

  /* ---- alcohol (Q16, EX-J) --------------------------------------------- */
  if (has('heavy-alcohol')) {
    L('no-vled', 'Q16', 'alcohol');
    // REVIEW: Q16 says "no fasting > T1", the T1 policy row excludes EX-J from T1; stricter = T0.
    capFast(TIER_MAX_HOURS.T0, 'EX-J', 'alcohol');
  }

  /* ---- age (HC-P8, HC-P9, EX-A) ---------------------------------------- */
  if (has('age-65-74')) {
    L('deficit-cap', 'HC-P8', 'ageBand', 15);
    L('rate-cap', 'HC-P8', 'ageBand', 0.5);
    L('protein-floor', 'HC-P8', 'ageBand', 1.2);
    capFast(TIER_MAX_HOURS.T1, 'EX-A', 'ageBand');
  }
  if (has('age-75-plus')) {
    L('no-deficit', 'HC-P9', 'ageBand');
    L('protein-floor', 'HC-M1', 'ageBand', 1.0);
    capFast(TIER_MAX_HOURS.T0, 'EX-A', 'ageBand'); // T1 is for ages 18–74
  }
  if (has('sarcopenia-risk')) {
    L('no-deficit', 'HC-P9', 'sarcf');
    L('protein-floor', 'HC-M1', 'sarcf', 1.0);
  }

  /* ---- body context (HC-P4, HC-P5, HC-E3, EX-D, EX-L) ------------------ */
  if (has('underweight')) {
    L('no-deficit', 'population rules', 'body');
    L('no-ketogenic', 'population rules', 'body');
    capFast(12, 'population rules', 'body');
  } else if (has('bmi-below-20')) {
    L('no-deficit', 'HC-P4', 'body');
    capFast(TIER_MAX_HOURS.T0, 'EX-D', 'body');
  }
  if (context.bmi !== undefined) {
    if (context.bmi < 22) capFast(TIER_MAX_HOURS.T2, 'EX-D', 'body');
    else if (context.bmi < 25) capFast(TIER_MAX_HOURS.T3, 'EX-D', 'body');
  }
  const floor = bfFloor(context.sex);
  if (floor !== null && context.bodyFatPct !== undefined) {
    const bf = context.bodyFatPct;
    if (bf < floor) L('no-deficit', 'HC-P5', 'body');
    if (bf <= floor + 4) L('deficit-cap', 'HC-E3', 'body', 10);
    if (bf < floor + 2) capFast(TIER_MAX_HOURS.T1, 'HC-P5', 'body');
    const t3Min = context.sex === 'male' ? 15 : 25;
    if (bf < t3Min) capFast(TIER_MAX_HOURS.T2, 'EX-D', 'body');
  }
  if (has('high-training-load')) capFast(TIER_MAX_HOURS.T2, 'EX-L', 'body');
  if (has('refeeding-risk')) capFast(TIER_MAX_HOURS.T2, 'NICE-refeeding', has('underweight') ? 'body' : has('heavy-alcohol') ? 'alcohol' : 'medications');
  if (has('recent-illness')) {
    // REVIEW: Q19 blocks > T1; the T1 policy row excludes EX-K from T1 too; stricter = T0.
    capFast(TIER_MAX_HOURS.T0, 'EX-K', 'opt-in');
  }

  /* ---- resolve fasting ------------------------------------------------- */
  const eligibleMaxHours = caps.length ? Math.min(TIER_MAX_HOURS.T4, ...caps.map((c) => c.hours)) : TIER_MAX_HOURS.T4;
  const bindingReasons = caps.filter((c) => c.hours === eligibleMaxHours).map((c) => c.reason);
  const maxEligibleTier = tierForHours(eligibleMaxHours);
  // Opt-in consent can be given from the screening alone; T3/T4 then also need the body thresholds
  // (BMI ≥ 22 / ≥ 25, body fat, EX-D) — without body context plans stay at T2 or below.
  const bodyKnown = context.bmi !== undefined;
  const planHours = bodyKnown ? eligibleMaxHours : Math.min(eligibleMaxHours, TIER_MAX_HOURS.T2);
  const optInTier = context.optIns?.fastingTier ?? null;
  const permitted = optInTier ? TIER_MAX_HOURS[optInTier] : TIER_MAX_HOURS.T1;
  const maxFastHours = Math.min(planHours, permitted);
  const optInTiers = (['T2', 'T3', 'T4'] as const).filter((t) => TIER_MAX_HOURS[t] <= eligibleMaxHours);

  const fastReasons: LockReason[] =
    maxFastHours < permitted
      ? planHours < eligibleMaxHours
        ? [{ rule: 'EX-D', source: 'body' }]
        : bindingReasons
      : optInTier && maxFastHours > TIER_MAX_HOURS.T1
        ? [{ rule: 'HC-F1', source: 'opt-in' }]
        : [{ rule: 'HC-F1', source: 'default' }];
  for (const r of fastReasons) locks.add('max-fast', r, maxFastHours);

  // HC-F5: eating window ≥ 6 h by default, 4 h with opt-in (M0/R2 only; never with the 12 h rules).
  const windowFloorFromProfile = locks.get('min-eating-window')?.value;
  const shortWindowAvailable = windowFloorFromProfile === undefined;
  if (shortWindowAvailable) {
    if (context.optIns?.shortEatingWindow) L('min-eating-window', 'HC-F5', 'opt-in', 4);
    else L('min-eating-window', 'HC-F5', 'default', 6);
  }

  // Tier V (VLED / PSMF blocks) — expert mode, BMI ≥ 30, T4-level eligibility (§4.3.2).
  const vledEligible = optInTier === 'T4' && planHours >= TIER_MAX_HOURS.T4 && context.bmi !== undefined && context.bmi >= 30;
  const vledLock = locks.get('no-vled');
  const vledOnlyDefault = vledLock !== undefined && vledLock.reasons.every((r) => r.source === 'default');
  const lockList = locks.list().filter((l) => !(l.id === 'no-vled' && vledEligible && vledOnlyDefault));

  /* ---- access ---------------------------------------------------------- */
  const plannerAccess: PlannerAccess = blockPlanner ? 'blocked' : restrictions.length > 0 || RESTRICTING_FLAGS.some(has) ? 'restricted' : 'full';

  const simulatorRules = buildSimulatorRules(fl);
  const simulatorAccess: SimulatorAccess = blockPlanner || restrictions.length > 0 || simulatorRules.length > 0 ? 'with-warnings' : 'full';

  const requiredAcknowledgements: RequiredAcknowledgement[] = [{ id: 'disclaimer', scope: 'app' }];
  if (r2 && !blockPlanner) requiredAcknowledgements.push({ id: 'clinician-first', scope: 'planner' });

  return {
    rulesVersion: RULES_VERSION,
    complete: missing.length === 0,
    missing,
    mode,
    modeName,
    restrictions,
    hardStop,
    simulatorAccess,
    plannerAccess,
    plannerLocks: blockPlanner ? [] : lockList,
    requiredAcknowledgements,
    messages,
    flags,
    simulatorRules,
    fasting: {
      maxEligibleTier,
      eligibleMaxHours,
      maxFastHours,
      effectiveTier: tierForHours(maxFastHours),
      optInTiers: blockPlanner ? [] : optInTiers,
      bindingReasons,
      shortWindowAvailable: !blockPlanner && shortWindowAvailable,
    },
    bodyRulesApplied,
  };
}

function firstR2Source(fl: Set<SafetyFlag>): QuestionId {
  if (fl.has('planning-pregnancy')) return 'pregnancy';
  if (['metformin', 'glp1', 'other-glucose-lowering', 'diabetes-diet-only', 'diabetes-undisclosed'].some((f) => fl.has(f as SafetyFlag))) return 'diabetes';
  if (CONDITION_FLAGS.some((f) => fl.has(f)) || fl.has('conditions-undisclosed')) return 'conditions';
  if (METABOLIC_FLAGS.some((f) => fl.has(f)) || fl.has('metabolic-undisclosed')) return 'metabolic';
  if (MEDICATION_FLAGS.some((f) => fl.has(f)) || fl.has('medications-undisclosed')) return 'medications';
  if (fl.has('exercise-symptoms')) return 'symptoms';
  return 'supervisedExercise';
}

function buildSimulatorRules(fl: Set<SafetyFlag>): SimulatorRuleId[] {
  const r: SimulatorRuleId[] = [];
  const has = (f: SafetyFlag) => fl.has(f);
  if (has('pregnant')) r.push('W-P01');
  if (has('ed-history') || has('ed-undisclosed') || has('scoff-risk')) r.push('W-P02');
  if (has('age-65-74') || has('age-75-plus')) r.push('W-P03');
  if (GLUCOSE_LOWERING.some(has) || has('diabetes-undisclosed')) r.push('W-P04');
  if (CONDITION_FLAGS.some(has) || has('conditions-undisclosed')) r.push('W-P05');
  if (has('gout') || has('kidney-stones') || has('gallstones')) r.push('W-P06');
  if (['diuretic', 'raas-blocker', 'lithium', 'qt-prolonging', 'chemotherapy'].some((f) => has(f as SafetyFlag))) r.push('W-P07');
  if (has('kidney-disease')) r.push('W-M05');
  if (
    has('pregnant') ||
    has('sglt2-inhibitor') ||
    has('insulin') ||
    has('type-1-diabetes') ||
    has('pancreatitis') ||
    has('rare-metabolic') ||
    has('underweight') ||
    has('ed-history') ||
    has('ed-undisclosed') ||
    has('scoff-risk')
  )
    r.push('W-M10');
  if (has('kidney-stones')) r.push('W-M24');
  if (has('exercise-symptoms') || has('supervised-exercise-only')) r.push('W-X05');
  return r;
}

function buildMessages(a: ScreeningAnswers, fl: Set<SafetyFlag>): SafetyMessage[] {
  const m: SafetyMessage[] = [];
  const push = (id: MessageId, severity: MessageSeverity, source: QuestionId | 'body', rules: string[]) => m.push({ id, severity, source, rules });
  const has = (f: SafetyFlag) => fl.has(f);
  if (has('under-18')) {
    push('adults-only', 'danger', 'ageBand', ['HC-P1']);
    return m;
  }
  if (has('age-75-plus')) push('older-adult-75', 'info', 'ageBand', ['HC-P9', 'EX-A']);
  else if (has('age-65-74')) push('older-adult', 'info', 'ageBand', ['HC-P8', 'EX-A']);
  if (has('sarcopenia-risk')) push('sarcopenia-risk', 'info', 'sarcf', ['HC-P9']);

  if (has('pregnant')) push('pregnancy-planner-off', 'caution', 'pregnancy', ['HC-P2', 'W-P01']);
  else if (has('planning-pregnancy')) push('pregnancy-planning', 'info', 'pregnancy', ['population rules', 'EX-B']);
  else if (has('pregnancy-undisclosed')) push('pregnancy-undisclosed', 'info', 'pregnancy', ['pregnancy question']);

  if (has('ed-history')) push('gentle-mode', 'info', 'eatingDisorder', ['HC-P3']);
  else if (has('ed-undisclosed')) push('gentle-mode-undisclosed', 'info', 'eatingDisorder', ['HC-P3']);
  else if (has('scoff-risk')) push('gentle-mode-scoff', 'info', 'scoff', ['HC-P3']);

  if (PLANNER_BLOCKING_DIABETES.some(has)) push('diabetes-planner-off', 'caution', 'diabetes', ['HC-P6', 'W-P04']);
  else if (has('diabetes-undisclosed')) push('diabetes-undisclosed', 'info', 'diabetes', ['HC-P7', 'EX-E']);
  else if (a.diabetes === 'yes' && (a.diabetesItems?.length ?? 0) > 0) push('diabetes-clinician-first', 'info', 'diabetes', ['HC-P7']);

  if (CONDITION_FLAGS.some(has) || has('conditions-undisclosed')) push('conditions-clinician-first', 'info', 'conditions', ['HC-P7', 'EX-F']);
  if (METABOLIC_FLAGS.some(has) || has('metabolic-undisclosed')) push('metabolic-clinician-first', 'info', 'metabolic', ['HC-P7', 'EX-G']);
  if (MEDICATION_FLAGS.some(has) || has('medications-undisclosed')) push('medications-clinician-first', 'info', 'medications', ['HC-P7', 'medication check']);
  if (has('exercise-symptoms')) push('symptoms-exercise', 'info', 'symptoms', ['HC-X4', 'W-X05']);
  if (has('supervised-exercise-only')) push('supervised-exercise', 'info', 'supervisedExercise', ['Q15', 'W-X05']);
  if (has('musculoskeletal')) push('musculoskeletal-exercise', 'info', 'musculoskeletal', ['Q14']);
  if (has('heavy-alcohol')) push('alcohol-fasting', 'info', 'alcohol', ['Q16', 'EX-J']);

  if (has('underweight')) push('body-underweight', 'caution', 'body', ['population rules', 'W-E14']);
  else if (has('bmi-below-20')) push('body-bmi-below-20', 'info', 'body', ['HC-P4']);
  if (has('bf-below-floor')) push('body-bf-below-floor', 'info', 'body', ['HC-P5']);
  if (has('refeeding-risk')) push('refeeding-risk', 'info', 'body', ['NICE-refeeding']);
  return m;
}

/* ============================================================================
   Acknowledgements, opt-ins, time
   ============================================================================ */

export interface StoredAcknowledgement {
  version: number;
  /** ISO time of acknowledgement. */
  at: string;
}

export type AcknowledgementRecord = Partial<Record<AcknowledgementId, StoredAcknowledgement>>;

export function isAcknowledged(acks: AcknowledgementRecord, id: AcknowledgementId, currentVersion: number): boolean {
  return acks[id]?.version === currentVersion;
}

/** Required acknowledgements that are missing or were given for an older copy version. */
export function pendingAcknowledgements(
  outcome: Pick<ScreeningOutcome, 'requiredAcknowledgements'>,
  acks: AcknowledgementRecord,
  versions: Readonly<Record<AcknowledgementId, number>>,
  scope?: RequiredAcknowledgement['scope'],
): AcknowledgementId[] {
  return outcome.requiredAcknowledgements.filter((r) => (scope ? r.scope === scope : true) && !isAcknowledged(acks, r.id, versions[r.id])).map((r) => r.id);
}

const DAY_MS = 86_400_000;

/** Whole days from `fromIso` to `toIso` (negative if `toIso` is earlier; NaN for unreadable input). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

export function isClearanceExpired(answeredAt: string | null, nowIso: string): boolean {
  if (!answeredAt) return true;
  const d = daysBetween(answeredAt, nowIso);
  return !Number.isFinite(d) || d >= CLEARANCE_VALID_DAYS;
}

export interface FastingOptIn {
  tier: OptInTier;
  acknowledged: FastingAckId[];
  /** Copy version of the tier acknowledgements when given. */
  ackVersion: number;
  /** T2 eligibility: a prior 24 h fast was tolerated (self-declared). */
  priorFastTolerated: boolean;
  /** T4: refeeding plan accepted (§4.3.2). */
  refeedingPlanAccepted?: boolean;
  at: string;
}

export interface OptInState {
  fastingOptIn: FastingOptIn | null;
  shortWindow: { version: number; at: string } | null;
  recentIllnessAt: string | null;
}

/** An opt-in is valid only with every acknowledgement for its tier, at the current copy version. */
export function validFastingTier(optIn: FastingOptIn | null, ackVersion: number, expertModeAvailable: boolean): OptInTier | null {
  if (!optIn || optIn.ackVersion !== ackVersion || !optIn.priorFastTolerated) return null;
  const tiers: OptInTier[] = optIn.tier === 'T4' ? ['T4', 'T3', 'T2'] : optIn.tier === 'T3' ? ['T3', 'T2'] : ['T2'];
  for (const t of tiers) {
    if (t === 'T4' && (!expertModeAvailable || !optIn.refeedingPlanAccepted)) continue;
    if (TIER_ACKNOWLEDGEMENTS[t].every((a) => optIn.acknowledged.includes(a))) return t;
  }
  return null;
}

/**
 * Expert mode for the planner (T4, 3-7-day fasts; dossier 17 §4.3.2): on when the feature is available and the user's
 * valid opt-in is T4 (`validFastingTier` returns T4 only then, with the refeeding plan accepted). The planner request
 * carries it as `safety.expertMode`, which the engine's tier compiler requires for T4 (PLAN item 8 decision 6).
 */
export function expertModeOn(optedTier: OptInTier | null, available: boolean = EXPERT_MODE_AVAILABLE): boolean {
  return available && optedTier === 'T4';
}

/** Opt-ins that hold right now (versions current, illness window open). */
export function resolveOptIns(
  s: OptInState,
  nowIso: string,
  versions: { fasting: number; shortWindow: number },
  expertModeAvailable: boolean,
): SafetyOptIns {
  const ill = s.recentIllnessAt !== null && daysBetween(s.recentIllnessAt, nowIso) < RECENT_ILLNESS_BLOCK_DAYS;
  return {
    fastingTier: ill ? null : validFastingTier(s.fastingOptIn, versions.fasting, expertModeAvailable),
    shortEatingWindow: s.shortWindow?.version === versions.shortWindow,
    recentIllness: ill,
  };
}

/** Restrictions present before and absent after (e.g. ['R1'] → "Turn off gentle mode?"). */
export function liftedRestrictions(prev: Pick<ScreeningOutcome, 'hardStop' | 'restrictions'>, next: Pick<ScreeningOutcome, 'hardStop' | 'restrictions'>): Array<HardStop | RestrictionMode> {
  const set = (o: Pick<ScreeningOutcome, 'hardStop' | 'restrictions'>) => new Set<HardStop | RestrictionMode>([...(o.hardStop ? [o.hardStop] : []), ...o.restrictions]);
  const a = set(prev);
  const b = set(next);
  return [...a].filter((x) => !b.has(x));
}

/** Danger acknowledgement for one scenario (per rule, until the schedule changes; onboarding-safety.md §6.6). */
export interface DangerAcknowledgement {
  scheduleHash: string;
  rules: string[];
  version: number;
  at: string;
}

export function isDangerAcknowledged(ack: DangerAcknowledgement | undefined, scheduleHash: string, ruleIds: readonly string[], version: number): boolean {
  if (!ack || ack.scheduleHash !== scheduleHash || ack.version !== version) return false;
  return ruleIds.every((r) => ack.rules.includes(r));
}
