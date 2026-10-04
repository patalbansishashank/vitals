/**
 * Catalogue contracts (PLAN items 11, 12, 14; docs/PLANNER_V2_SPEC.md §8.1/§8.6; research R3 §2, R4 §2.4/§5, R5 §2-3).
 *
 * Tier P (pure): types only, no runtime imports except engine types. Every exercise, piece of equipment, food and
 * supplement carries its sources and a two-axis evidence label (mechanism × certainty). Grades never gate inclusion
 * (R5 §2.5); only a nameable mechanism that reaches an engine state does.
 *
 * Vocabulary follows the R3 seed schema (R3-0.1) where it is richer than the PLANNER_V2 sketch (loadType, intensityScale,
 * priceTier, space); docs/CATALOGUES.md lists the differences.
 */
import type { CardioModality, ProteinSource, TrainingRegion } from '@/engine/types/schedule';
import type { EvidenceGrade } from '@/engine/types/params';

export type { CardioModality, ProteinSource, TrainingRegion, EvidenceGrade };

/** 0 = Sunday … 6 = Saturday (same convention as the planner's `Weekday`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ================================================================== evidence labels (R5 §2)

/**
 * R5 §2.1 axis M. `modelled`: the engine has an equation for the pathway; `mapped`: expressed as inputs of a modelled
 * pathway through a mapping (transfer factor τ); `infoOnly`: pathway named but it reaches no engine state yet;
 * `none` (M0): no nameable pathway to any engine state. PLANNER_V2's `MechanismStatus` is the first three.
 */
export type MechanismStatus = 'modelled' | 'mapped' | 'infoOnly';
export type MechanismRoute = MechanismStatus | 'none';

/** The two orthogonal labels of R5 §2: mechanism (known? which pathway?) × empirical certainty (A–D). */
export interface EvidenceLabel {
  mechanism: {
    /** True when every link from the item to an engine node can be named (R5 §1.3); false = M0. */
    known: boolean;
    /** Plain-language chain, e.g. "mechanical load on the shoulder muscles → effective sets → muscle protein synthesis". */
    pathway: string;
    /** How the pathway reaches the engine. */
    route: MechanismRoute;
  };
  /** Empirical certainty of the effect estimate; widens bands and sets wording, never gates (R5 §2.3-2.5). */
  certainty: EvidenceGrade;
}

/** Outcome families a label can be attached to (R5: labels are per (item, outcome) pair). */
export type OutcomeFamily =
  | 'hypertrophy'
  | 'strength'
  | 'cardio'
  | 'energy'
  | 'mobility'
  | 'protein'
  | 'fibre'
  | 'electrolytes'
  | 'lipids'
  | 'bloodPressure'
  | 'sleep'
  | 'micronutrient'
  | 'performance'
  | 'other';

/** GRADE indirectness downgrades (R5 §3.1): 0 none, 1 serious, 2 very serious. */
export interface Indirectness {
  population: 0 | 1 | 2;
  intervention: 0 | 1 | 2;
  outcome: 0 | 1 | 2;
}

/** R5 §3.2 robust transfer prior τ ~ (1 − w)·LogNormal(ln median, σ) + w·Uniform(0, τ_lo). */
export interface TauPrior {
  median: number;
  sigmaLog: number;
  wRobust: number;
  tauLo: number;
}

/** R5 §3.1 mapping record: one per item × outcome family set. */
export interface MappingDef {
  itemId: string;
  outcomes: readonly OutcomeFamily[];
  anchor: { kind: 'mechanism' | 'item'; id: string };
  pathway: string;
  /** The item expressed as anchor inputs, each a ParamDef-like {value, low, high}. */
  inputs: Readonly<Record<string, { value: number; low: number; high: number; unit?: string }>>;
  similarity: { dims: Readonly<Record<string, 0 | 0.5 | 1>>; S: number };
  tau: TauPrior;
  indirectness: Indirectness;
  directEvidence?: { refs: readonly string[]; grade: EvidenceGrade; sign: 1 | -1 | 0 };
  /** Computed from the anchor grade and indirectness (R5 §2.2); stored for display, recomputed in tests. */
  certainty: EvidenceGrade;
  /** The trial that would remove the mapping (target-trial sentence). */
  wouldSettle: string;
  author: 'dossier' | 'ai' | 'user';
}

// ================================================================== sources

export interface CatalogueSource {
  key: string;
  /** Author, year, venue and the claim used; plain text. */
  cite: string;
  url: string | null;
  /** ISO date the source was accessed. */
  accessed: string;
  /** True for maintainer-only pointers into the project's research notes; never rendered to users. */
  internal: boolean;
}

// ================================================================== exercises (R3 §2.1)

export type Tradition =
  | 'gym'
  | 'home'
  | 'bodyweight'
  | 'outdoor'
  | 'kettlebell'
  | 'bands'
  | 'indian'
  | 'yoga'
  | 'mobility'
  | 'odd-object'
  | 'cardio';

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'kneeExtension'
  | 'kneeFlexion'
  | 'calfRaise'
  | 'hipAbduction'
  | 'horizontalPush'
  | 'verticalPush'
  | 'horizontalPull'
  | 'verticalPull'
  | 'elbowFlexion'
  | 'elbowExtension'
  | 'shoulderIsolation'
  | 'coreFlexion'
  | 'coreAntiExtension'
  | 'coreAntiRotation'
  | 'carry'
  | 'ballisticHinge'
  | 'rotationalSwing'
  | 'plyometric'
  | 'complex'
  | 'locomotion'
  | 'cycle'
  | 'row'
  | 'swim'
  | 'sport'
  | 'mobility'
  | 'inversion'
  | 'armBalance'
  | 'balance'
  | 'neck';

/** R3 §2.1: how the load is applied; decides f_type of the effective-set count (R3 §3.1). */
export type LoadType = 'external' | 'bodyweight' | 'odd-object' | 'ballistic' | 'isometric' | 'cardio' | 'mobility';

/** R3 §2.1: which log fields the UI asks for. */
export type IntensityScale = 'pct1RM' | 'repsToFailure' | 'kgRpe' | 'holdSec' | 'rpe' | 'speed' | 'power' | 'met';

export type VolumeUnit = 'setsReps' | 'holds' | 'timeOrReps' | 'intervals' | 'minutes' | 'rounds' | 'distanceOrTime';

/** R3 §4 energy equations. `met` is the default; the others need speed / grade / step rate / watts / load inputs. */
export type EnergyEquation = 'met' | 'ludlowWalk' | 'acsmWalk' | 'acsmRun' | 'acsmStep' | 'cyclePower' | 'pandolf';

/** R3 §7 injury and condition answers (`contraTags`). */
export type ContraTag =
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'lumbar'
  | 'cervical'
  | 'knee'
  | 'ankle'
  | 'hip'
  | 'hypertension'
  | 'glaucoma'
  | 'osteoporosis'
  | 'pregnancy'
  | 'pelvic_floor'
  | 'cardiac_unscreened';

/**
 * Practical tags derived for intake filters (R3 §7 questions 8 and 10: "no jumping", "nothing overhead", "no floor work",
 * "no noise"); engineering classification, reviewable in the data module.
 */
export type ExerciseTag = 'jumping' | 'highImpact' | 'overhead' | 'floor' | 'noisy' | 'supervised';

/** One of the R3 default-dose shapes; absent fields do not apply. */
export interface DefaultDose {
  sets?: number;
  reps?: number;
  rir?: number;
  restSec?: number;
  holdSec?: number;
  durationSec?: number;
  durationMin?: number;
  rounds?: number;
  workSec?: number;
  secPerRound?: number;
}

export interface ExerciseEnergy {
  equation: EnergyEquation;
  /** Session-average gross MET including intra-exercise rest (Compendium convention). */
  metGross: number;
  /** Plausible range of the gross MET (analog rows bracket the value). */
  metRange: readonly [number, number];
  compendiumCode: string | null;
  /** Where the MET comes from ("compendium", "analog: …", "ESTIMATE: …"). */
  metSource: string;
}

export type ExerciseOrigin = 'seed' | 'ai-resolved' | 'user';

/** PLANNER_V2 §8.1 `ExerciseRecord`, with R3's richer field set. */
export interface ExerciseRecord {
  id: string;
  name: string;
  /** Hindi/Sanskrit/regional names, e.g. "bethak", "mugdar". */
  aliases: readonly string[];
  tradition: Tradition;
  /** OR of AND-sets of equipment ids; `[[]]` means no equipment. */
  equipmentAnyOf: readonly (readonly string[])[];
  pattern: MovementPattern;
  /** Region credit per hard set: 1 direct (prime mover), 0.5 indirect (synergist); omitted = 0. */
  regions: Readonly<Partial<Record<TrainingRegion, number>>>;
  loadType: LoadType;
  intensityScale: IntensityScale;
  volumeUnit: VolumeUnit;
  defaultDose: Readonly<DefaultDose>;
  /** Seconds per repetition (3 default; 2 baithak; 25 get-up; 30 per Surya Namaskar round). */
  secPerRep: number;
  energy: ExerciseEnergy;
  cardioModality: CardioModality | null;
  /** Fraction of the bout's minutes compiled as a cardio session (R3 §3.3). */
  hybridCardioShare: number;
  mobilityTargets: readonly string[];
  skill: 1 | 2 | 3 | 4 | 5;
  injuryRisk: 1 | 2 | 3 | 4 | 5;
  contraTags: readonly ContraTag[];
  tags: readonly ExerciseTag[];
  /** Mechanism text (plain language), the pathway of the evidence label. */
  mechanism: string;
  /** Route of the item's primary outcome (R5 §2.1). */
  status: MechanismStatus;
  /** Certainty of the stimulus mapping (R3 `grade`). */
  certainty: EvidenceGrade;
  /**
   * Prior of the per-set credit factor for items whose load cannot be expressed as %1RM (R3 ballistic set factor,
   * triangle {min, mode, max}); the nominal stimulus uses `mode`.
   */
  loadFactor?: { min: number; mode: number; max: number };
  /** Keys into the catalogue source table. */
  sources: readonly string[];
  origin: ExerciseOrigin;
}

// ================================================================== equipment (R3 §2.2)

export type EquipmentCategory =
  | 'free-weight'
  | 'band'
  | 'bar'
  | 'machine'
  | 'cardio-machine'
  | 'cardio-outdoor'
  | 'cardio-small'
  | 'outdoor'
  | 'odd-object'
  | 'indian'
  | 'improvised'
  | 'access'
  | 'accessory'
  | 'combat'
  | 'gym-structure';

export interface EquipmentItem {
  id: string;
  name: string;
  aliases: readonly string[];
  category: EquipmentCategory;
  /** Whether the item is normally owned or accessed somewhere (gym, park, pool). Not a claim that the user owns it. */
  ownershipKind: 'owned' | 'access';
  loadRangeKg: readonly [number, number] | null;
  adjustable: boolean;
  enablesPatterns: readonly MovementPattern[];
  /** 0 free/improvised, 1 < ₹1k, 2 ₹1–5k, 3 ₹5–25k, 4 > ₹25k or gym-only (engineering estimate, unverified). */
  priceTier: 0 | 1 | 2 | 3 | 4 | 5;
  space: 'none' | 'tiny' | 'small' | 'medium' | 'large';
  note: string;
  sources: readonly string[];
  origin: ExerciseOrigin;
}

// ================================================================== user training profile (PLANNER_V2 §8.1 + R3 §7)

export type RefusalToken = string; // exercise id | pattern | tradition | equipment id | ExerciseTag

export interface AccessPlace {
  place: 'home' | 'gym' | 'park' | 'other';
  equipment: readonly string[];
  weekdays: readonly Weekday[];
  /** Usable clock hours [start, end); outside them availability counts 0.5 instead of 0.8 (R3 §6). */
  hours?: readonly [number, number];
}

export interface TrainingProfile {
  owned: readonly string[];
  access: readonly AccessPlace[];
  /** Hard filter: exercise ids, patterns, traditions, equipment ids or tags ('jumping', 'overhead', 'floor', 'noisy'). */
  refused: readonly RefusalToken[];
  /** Soft preference (+1 enjoyment): exercise ids, patterns or traditions. */
  liked: readonly string[];
  /** Injury and condition answers (ContraTag values). */
  injuries: readonly string[];
  /** Injuries the user says a clinician cleared ("my physio cleared it", R3 §6). */
  cleared?: readonly string[];
  skill: 1 | 2 | 3 | 4 | 5;
  purchaseAllowance: { maxPriceTier: 0 | 1 | 2 | 3 | 4 | 5; maxItems: number };
  /** R3 §7 A2: weights owned per loadable equipment id. */
  loadsKg?: Readonly<Record<string, readonly number[]>>;
  /** Per exercise: reps to failure with the user's variant, or 1RM in kg. */
  capacities?: Readonly<Record<string, { repsMax?: number; oneRepMaxKg?: number }>>;
  /** R3 §7 enjoyment −2..+2 per exercise id, pattern or tradition; −2 means refuse. */
  enjoy?: Readonly<Record<string, number>>;
}

// ================================================================== logged / prescribed instances (R3 §2.3)

export interface PerformedSet {
  reps?: number;
  holdSec?: number;
  workSec?: number;
  loadKg?: number;
  /** %1RM when known directly. */
  pct1RM?: number;
  /** Reps in reserve (how many more were possible). */
  rir?: number;
  /** Borg CR-10 / RIR-based RPE; RIR = 10 − RPE when RIR is absent. */
  rpe?: number;
  /** Isometric hold ended within ~10 s of failure (R3 §3.1). */
  nearFailure?: boolean;
}

/** A logged or prescribed exercise instance. Either explicit `sets` or the compact fields. */
export interface PerformedExercise {
  exerciseId?: string;
  freeText?: string;
  sets?: readonly PerformedSet[];
  setCount?: number;
  reps?: number;
  holdSec?: number;
  workSec?: number;
  rounds?: number;
  loadKg?: number;
  pct1RM?: number;
  rir?: number;
  rpe?: number;
  restSec?: number;
  /** Total minutes of the bout (overrides the computed time). */
  minutes?: number;
  /** Gross MET the bout was done at (overrides the catalogue MET; e.g. a stated cardio pace). */
  met?: number;
  speedKmh?: number;
  powerW?: number;
  gradePct?: number;
  /** Step rate for bench stepping / stairs, steps/min. */
  stepRatePerMin?: number;
  /** Step height, m (stairs ≈ 0.17). */
  stepHeightM?: number;
  loadCarriedKg?: number;
  terrain?: 'road' | 'dirt' | 'lightBrush' | 'heavyBrush';
  oneRepMaxKg?: number;
  /** Equipment actually used (picks the implement class for strength specificity). */
  equipmentUsed?: readonly string[];
}

// ================================================================== stimulus currency (PLANNER_V2 §8.6, R3 §5.1)

export type LoadClass = 'heavy' | 'moderate' | 'light' | 'veryLight';

/** Implement geometry for strength specificity (R3 §5.2 c: barbell ↔ sumtola, DB ↔ KB count as the same). */
export type ImplementClass = 'bar' | 'handheld' | 'machine' | 'band' | 'bodyweight' | 'club' | 'odd' | 'none';

export interface StrengthWork {
  pattern: MovementPattern;
  implement: ImplementClass;
  /** Counted hard sets of this pattern/implement. */
  sets: number;
  /** Set-weighted mean %1RM (or %1RM-equivalent). */
  loadPct: number;
}

export interface StimulusVector {
  /** E_r: effective sets per region (e_set × region weight; direct 1, indirect 0.5). */
  effectiveSetsByRegion: Partial<Record<TrainingRegion, number>>;
  /** Dominant pattern (by sets, else by minutes). */
  pattern: MovementPattern;
  /** Set-weighted load class: ≥ 80 / 60–80 / 35–60 / < 35 %1RM. */
  loadClass: LoadClass;
  /** Net kcal above own resting rate, (MET − 1)·3.5·kg/200 per minute. */
  netKcal: number;
  /** Moderate-equivalent minutes (engine memWeight × cardio minutes). */
  mem: number;
  /** Cardio minutes at x ≥ hardX (0.85 VO2max). */
  hiMinutes: number;
  mobilityMinutes: Record<string, number>;
  /** R5 mapping uncertainty (σ of ln τ) for mapped items; 0 for modelled ones. */
  tauSd?: number;
  // ---- additive fields (E8): the equivalence formulas need them; absent = neutral defaults
  /** Plan priority π_r of each region; default 1 for every prescribed region. */
  regionPriority?: Partial<Record<TrainingRegion, number>>;
  /** Strength work by pattern and implement (S_str). */
  strength?: StrengthWork[];
  /** Effective sets one more set of the logged item adds, per region (shortfall "add N sets"). */
  perSetCredit?: Partial<Record<TrainingRegion, number>>;
  /** Net kcal per minute of the logged activity (shortfall "N more minutes"). */
  netKcalPerMin?: number;
  /** MEM per extra minute of the logged cardio (shortfall "N more minutes"). */
  memPerMin?: number;
  /** Set-weighted mean reps in reserve (shortfall "stop closer to failure"). */
  meanRir?: number;
  /** Total minutes of the bout(s). */
  minutes?: number;
  /** Exercise ids that contributed. */
  exerciseIds?: string[];
}

/** α: intent weights of a prescribed item over the five terms; sums to 1 (R3 §5.1). */
export interface StimulusIntent {
  hyp: number;
  str: number;
  card: number;
  kcal: number;
  mob: number;
}
export type StimulusTermId = keyof StimulusIntent;

export interface ShortfallNote {
  term: StimulusTermId;
  /** Missing amount in the term's unit (effective sets, kcal, MEM, minutes). */
  missing: number;
  /** Plain-language fix, e.g. "lighter load: add 1 set". */
  text: string;
}

export type CreditBand = 'full' | 'partial' | 'different';

export interface EquivalenceResult {
  /** Raw equivalence S ∈ [0, 1]. */
  score: number;
  /** Adherence credit: 1 at parity (S ≥ 0.90), else S (credited for what it trains). */
  credit: number;
  parity: boolean;
  band: CreditBand;
  perTerm: Array<{ term: StimulusTermId; ratio: number; weight: number }>;
  shortfall: ShortfallNote[];
  /** Regions trained beyond the prescription ("also trained: …"). */
  alsoTrained: TrainingRegion[];
}

// ================================================================== unknown-item resolution and user extensions

/** What a resolver (heuristic, AI, or user form) returns for an unknown exercise; becomes an `ExerciseRecord`. */
export interface ExerciseDraft {
  name: string;
  description?: string;
  aliases?: string[];
  pattern: MovementPattern;
  regions: Partial<Record<TrainingRegion, number>>;
  loadType: LoadType;
  intensityScale: IntensityScale;
  volumeUnit: VolumeUnit;
  defaultDose: DefaultDose;
  secPerRep?: number;
  metGross: number;
  metRange?: readonly [number, number];
  cardioModality: CardioModality | null;
  hybridCardioShare: number;
  mobilityTargets?: string[];
  equipmentAnyOf?: string[][];
  skill?: 1 | 2 | 3 | 4 | 5;
  injuryRisk?: 1 | 2 | 3 | 4 | 5;
  contraTags?: ContraTag[];
  mechanism: string;
  /** 0..1 confidence of the resolution. */
  confidence: number;
  resolvedBy: 'catalogue' | 'heuristic' | 'ai' | 'user';
  /** Closest catalogue item the draft was based on. */
  basedOn?: string;
}

/** Pluggable resolver (the AI fills it later through E9's tool). May be sync or async; null = could not resolve. */
export interface ExerciseResolver {
  readonly id: string;
  resolve(
    input: { name: string; description?: string },
    context: { candidates: readonly ExerciseRecord[] },
  ): ExerciseDraft | null | Promise<ExerciseDraft | null>;
}

/** The user's own catalogue extension (SUITE_SPEC §2.3 `catalogueCustom`), merged over the seed. */
export interface UserCatalogue {
  exercises: readonly ExerciseRecord[];
  equipment: readonly EquipmentItem[];
  foods: readonly FoodRecord[];
  mappings: readonly MappingDef[];
}

// ================================================================== foods (R4 §2.4)

export type FoodSourceKind = 'usda_sr' | 'usda_fnd' | 'ifct_permitted' | 'literature' | 'indb' | 'derived' | 'fixture' | 'user' | 'model';

/** Nutrients per 100 g edible portion (R4 §2.4 nutrient set). Macros are required; the rest are optional. */
export interface Nutrients {
  energyKcal: number;
  proteinG: number;
  fatG: number;
  /** Carbohydrate by difference (includes fibre, as in USDA tables). */
  carbG: number;
  fibreG?: number;
  sugarsG?: number;
  satFatG?: number;
  mufaG?: number;
  pufaG?: number;
  epaG?: number;
  dhaG?: number;
  alaG?: number;
  cholesterolMg?: number;
  waterG?: number;
  alcoholG?: number;
  caffeineMg?: number;
  sodiumMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  magnesiumMg?: number;
  zincMg?: number;
  b12Ug?: number;
  folateDfeUg?: number;
  vitDUg?: number;
  vitCMg?: number;
  vitARaeUg?: number;
  leucineG?: number;
  lysineG?: number;
}
export type NutrientKey = keyof Nutrients;

export interface FoodRecord {
  id: string;
  name: string;
  aliases: readonly string[];
  group: string;
  /** Diet / allergen / Jain-root / vrat-allowed / onion-garlic / animal-type tags; hand-curated hard filters. */
  tags: readonly string[];
  source: FoodSourceKind;
  verified: boolean;
  state: 'raw' | 'cooked' | 'as-eaten';
  yieldRawToCooked?: number;
  edibleFraction?: number;
  portions: ReadonlyArray<{ label: string; g: number }>;
  per100g: Readonly<Nutrients>;
  /** Engine protein-quality class (dossier protein table) when the food is a protein source. */
  proteinSource?: ProteinSource;
  sources: readonly string[];
}

/** The bundled food reference (R4 §2.4). The curated IFCT/USDA subset is a later data task; see docs/CATALOGUES.md. */
export interface FoodTable {
  readonly version: string;
  get(id: string): FoodRecord | undefined;
  /** Name/alias search, case-insensitive; best matches first. */
  search(query: string, limit?: number): FoodRecord[];
  all(): readonly FoodRecord[];
}

/** Nutrient targets of a meal slot or day (R4 §3.1). Absent = not targeted. */
export interface NutrientTargets {
  energyKcal?: number;
  proteinG?: number;
  /** Net (available) carbohydrate, g. */
  netCarbG?: number;
  fatG?: number;
  fibreG?: number;
  satFatMaxG?: number;
  /** Hard ceiling for low-carb/keto days: netCarb ≤ target + 5 g (R4 §3.5). */
  lowCarbDay?: boolean;
}

/** Totals of a meal as eaten (engine units: net carbohydrate excludes fibre). */
export interface MealTotals {
  energyKcal: number;
  proteinG: number;
  netCarbG: number;
  fatG: number;
  fibreG: number;
  satFatG: number;
}

export interface NutrientEquivalenceResult {
  score: number;
  credit: number;
  parity: boolean;
  band: CreditBand;
  perNutrient: Array<{ nutrient: keyof NutrientTargets; target: number; actual: number; ratio: number; score: number; weight: number }>;
  shortfall: Array<{ nutrient: keyof NutrientTargets; missing: number; text: string }>;
}

// ================================================================== supplements (R4 §5, supplements seed)

export type SupplementStatus = 'offer' | 'offer_if_risk' | 'situational' | 'only_if_diagnosed' | 'food_first_rule' | 'info';

export type DoseDetail = number | string | readonly number[] | { readonly [key: string]: DoseDetail };

export interface SupplementDose {
  /** Default amount; null when the dose is a rule (e.g. "replace 25–75 % of salt"). */
  amount: number | null;
  unit: string;
  /** "day", "serving", "night", "pre-exercise", … */
  per: string | null;
  /** Amount is per kg of current body weight. */
  perKg: boolean;
  range: readonly [number, number] | null;
  rule?: string;
  upperLimit?: { amount: number; unit: string; per: string };
  /** Remaining dose fields verbatim from the seed (loading phases, situational doses). */
  details: Readonly<Record<string, DoseDetail>>;
}

export interface DietCompat {
  ok: boolean | 'conditional';
  note?: string;
}

export interface SupplementOutcome {
  outcome: string;
  certainty: EvidenceGrade;
  /** effect = an effect was shown (its sign is in `effect`); null = shown not to help; harm = harm signal. */
  direction: 'effect' | 'null' | 'harm';
  effect?: string;
  /** Grade text as recorded (e.g. "A (null)", "C/D"). */
  gradeText: string;
}

export interface SupplementEngineMapping {
  route: MechanismStatus;
  /** Planner lever id when one exists (creatine L7, omega-3 L8, viscous fibre L9, caffeine L6). */
  leverId?: string;
  /** Schedule fields the item feeds when taken (e.g. 'substances.creatineG'). */
  inputs: readonly string[];
}

export interface SupplementRecord {
  id: string;
  name: string;
  aliases: readonly string[];
  category: string;
  status: SupplementStatus;
  /** Goal tags the item is relevant to. */
  goals: readonly string[];
  mechanism: string;
  dose: SupplementDose;
  timing: string;
  form: string;
  foodFirstAlternative: string | null;
  contraindications: ReadonlyArray<{ flag: string; note?: string }>;
  interactions: readonly string[];
  cautions: readonly string[];
  diet: { vegetarian: DietCompat; vegan: DietCompat; jain: DietCompat; halal?: DietCompat; allergens: readonly string[] };
  outcomes: readonly SupplementOutcome[];
  engine: SupplementEngineMapping;
  unverified: readonly string[];
  sources: readonly string[];
  /** Maintainer notes (engine hooks as written by the research); never rendered. */
  maintainerNotes: readonly string[];
}

/** "No expected benefit for these goals" entries: kept so the coach can answer questions, with the null evidence. */
export interface NoBenefitRecord {
  id: string;
  name: string;
  reason: string;
  gradeText: string;
  certainty: EvidenceGrade;
  sources: readonly string[];
}

export interface Advisory {
  id: string;
  text: string;
  sources: readonly string[];
}

// ================================================================== the assembled catalogue

export interface Catalogue {
  readonly version: string;
  readonly exercises: readonly ExerciseRecord[];
  readonly equipment: readonly EquipmentItem[];
  readonly supplements: readonly SupplementRecord[];
  readonly sources: Readonly<Record<string, CatalogueSource>>;
  readonly mappings: readonly MappingDef[];
  exercise(id: string): ExerciseRecord | undefined;
  equipmentItem(id: string): EquipmentItem | undefined;
  supplement(id: string): SupplementRecord | undefined;
  /** Name/alias search over exercises (case- and diacritic-insensitive), best first. */
  searchExercises(query: string, limit?: number): ExerciseRecord[];
}
