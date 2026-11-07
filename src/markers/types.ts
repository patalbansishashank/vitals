/**
 * Blood markers: document, interaction table and rule-engine types (docs/SUITE_SPEC.md §13.5).
 *
 * `vitals.markers/1` is the person's document (collection `markers`, key `me`). The interaction table is generated from
 * the four research JSON files by `scripts/markers/build-interactions.ts` into `./interactions.json`; its rows are
 * normalised here (the research files use several shapes; the generator maps them all onto these types and fails on
 * any row it cannot map). Everything in this folder except `extract/` is pure.
 */
import type { Id, Instant, LocalDate } from '@/store';
import type { MedicationChange } from '@/engine';
import type { Applicability, ConstraintComparator, ConstraintQuantity, ConstraintUnit, ConstraintWindow, WeightBasis } from '@/lib/bodyContracts';
import type { GfrQuantityKind, LabSampleContext } from '@/lib/measurementOperators';

/* ------------------------------------------------------------------------------------------- ids */

/** Tier A markers (typed by hand and planned on); ids are stable (§13.5). */
export type MarkerId =
  | 'ldl'
  | 'hdl'
  | 'tg'
  | 'nonHdl'
  | 'apoB'
  | 'lpa'
  | 'fpg'
  | 'hba1c'
  | 'insulin'
  | 'alt'
  | 'ast'
  | 'ggt'
  | 'creatinine'
  | 'egfr'
  | 'uacr'
  | 'urate'
  | 'tsh'
  | 'ft3'
  | 'hb'
  | 'ferritin'
  | 'b12'
  | 'vitD'
  | 'hsCrp'
  | 'sodium'
  | 'potassium'
  | 'testosterone'
  | 'cortisol';

export const MARKER_IDS: readonly MarkerId[] = [
  'ldl',
  'hdl',
  'tg',
  'nonHdl',
  'apoB',
  'lpa',
  'fpg',
  'hba1c',
  'insulin',
  'alt',
  'ast',
  'ggt',
  'creatinine',
  'egfr',
  'uacr',
  'urate',
  'tsh',
  'ft3',
  'hb',
  'ferritin',
  'b12',
  'vitD',
  'hsCrp',
  'sodium',
  'potassium',
  'testosterone',
  'cortisol',
];

/** Entry groups of the intake table (design intake-v3 §8.2), in display order. */
export type MarkerGroupId = 'lipids' | 'sugar' | 'liver' | 'kidney' | 'thyroid' | 'blood' | 'vitamins' | 'inflammation' | 'hormones';

export type LeverId =
  | 'vlc'
  | 'lowcarb'
  | 'highprotein'
  | 'fast16_8'
  | 'fast24'
  | 'fast36_48'
  | 'fast48plus'
  | 'satfat'
  | 'dietcholesterol'
  | 'fibre'
  | 'unsatfat'
  | 'alcohol'
  | 'caffeine'
  | 'creatine'
  | 'wheyprotein'
  | 'deficit_large'
  | 'deficit_moderate'
  | 'surplus'
  | 'resistance_load'
  | 'aerobic_load'
  | 'sleep_debt'
  | 'weight_loss'
  | `supp:${string}`;

export type Grade = 'A' | 'B' | 'C' | 'D';
export type Severity = 'info' | 'caution' | 'danger';
export type RuleKind = 'cap' | 'warn' | 'reask' | 'clinician' | 'retest' | 'prefer';

/**
 * Planner locks a lab rule may write. The first four exist in the screening (`PlannerLockId`); the rest are new
 * (numeric, may be 0). `added-sugar-cap`, `surplus-cap` and `caffeine-cap` extend §13.5.2's list because R13 has
 * caps on those levers (decision recorded in docs/wp/E20.md).
 */
export type LabLockId =
  | 'deficit-cap'
  | 'max-fast'
  | 'protein-cap'
  | 'carb-floor'
  | 'satfat-cap'
  | 'fat-cap'
  | 'creatine-cap'
  | 'potassium-supp-cap'
  | 'alcohol-cap'
  | 'added-sugar-cap'
  | 'surplus-cap'
  | 'caffeine-cap';

/** Unit of each lock value. */
export const LAB_LOCK_UNIT: Readonly<Record<LabLockId, string>> = {
  'deficit-cap': '%',
  'max-fast': 'h',
  'protein-cap': 'g/kg',
  'carb-floor': 'g/d',
  'satfat-cap': '%E',
  'fat-cap': '%E',
  'creatine-cap': 'g/d',
  'potassium-supp-cap': 'g/d',
  'alcohol-cap': 'g/d',
  'added-sugar-cap': '%E',
  'surplus-cap': '% of maintenance',
  'caffeine-cap': 'mg/d',
};

/**
 * Typed semantics of every lab lock (C5/D4-01, constraint policy v1): quantity, unit, comparator, weight basis, window and
 * exposure scope. `surplus-cap` is percent OF maintenance (110 = 110 %), never inferred from magnitude; per-kg protein uses
 * the reference-weight basis the safety rules use; windows are explicit (a daily limit is never silently a rolling mean).
 */
export const LAB_LOCK_DEFS: Readonly<
  Record<LabLockId, { quantity: ConstraintQuantity; unit: ConstraintUnit; comparator: ConstraintComparator; basis: WeightBasis; window: ConstraintWindow; scope: 'total' | 'supplementOnly' | 'plannedAddition' }>
> = {
  'deficit-cap': { quantity: 'deficitPct', unit: '%', comparator: 'cap', basis: 'notApplicable', window: { kind: 'rolling', days: 7 }, scope: 'total' },
  'max-fast': { quantity: 'fastHours', unit: 'h', comparator: 'cap', basis: 'notApplicable', window: { kind: 'event' }, scope: 'total' },
  'protein-cap': { quantity: 'proteinPerKg', unit: 'g/kg/d', comparator: 'cap', basis: 'reference', window: { kind: 'day' }, scope: 'total' },
  'carb-floor': { quantity: 'carbPerDay', unit: 'g/d', comparator: 'floor', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'satfat-cap': { quantity: 'satFatPctEnergy', unit: '%E', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'fat-cap': { quantity: 'fatPctEnergy', unit: '%E', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'creatine-cap': { quantity: 'creatinePerDay', unit: 'g/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'potassium-supp-cap': { quantity: 'potassiumSupplementPerDay', unit: 'g/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'supplementOnly' },
  'alcohol-cap': { quantity: 'alcoholPerDay', unit: 'g/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'added-sugar-cap': { quantity: 'addedSugarPctEnergy', unit: '%E', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'surplus-cap': { quantity: 'energyPctOfMaintenance', unit: '% of maintenance', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
  'caffeine-cap': { quantity: 'caffeinePerDay', unit: 'mg/d', comparator: 'cap', basis: 'notApplicable', window: { kind: 'day' }, scope: 'total' },
};

/* ------------------------------------------------------------------------------------------- document */

export type MarkerProvenance = 'manual' | 'pdf' | 'photo' | 'coach';

export interface LabRange {
  low?: number;
  high?: number;
  text?: string;
  unit: string;
}

export interface MarkerReading {
  id: MarkerId;
  /** As entered or printed. */
  value: number;
  unit: string;
  /** After the §13.5.1 table; Lp(a) keeps its entered unit (mg/dL or nmol/L). */
  valueCanonical: number;
  unitCanonical: string;
  /** Sample date, confirmed by the person. */
  date: LocalDate;
  /** As printed; never invented. */
  labRange?: LabRange;
  /** 'direct' | 'calculated' | lab text (LDL direct ≠ Friedewald). */
  method?: string;
  fasting?: boolean;
  provenance: MarkerProvenance;
  /** 0–1, extraction only. */
  confidence?: number;
  /** Only confirmed readings are used by any rule or the engine. */
  confirmed: boolean;
  attachmentId?: Id;
  enteredAt: Instant;
  // ---- contract additions 2026-10-18 (C1/C4, D7-01/02/05/06/09; optional: only claimed when actually provided)
  /** Draw identity (two analytes share it when drawn together) and the actual sampling instant / local clock hour. */
  sampleId?: string;
  sampledAt?: Instant;
  sampleLocalClockH?: number;
  /** Fasting before the draw: hours and/or status; legacy `fasting` reads as status only when explicitly true/false. */
  fastingHours?: number;
  fastingStatus?: 'fasting' | 'nonFasting' | 'unknown';
  /** The person confirmed this reading was drawn together with another reading's sample id (D7-06). */
  confirmedPairWith?: string;
  /** eGFR quantity kind (D7-02): indexed, absolute GFR, creatinine clearance or indexing unconfirmed (no staging). */
  quantityKind?: GfrQuantityKind;
  /** D7-02: an explicit absolute→indexed conversion kept beside the raw value (never replaces it). */
  indexed?: { valueMlMin173: number; bsaM2: number; bsaMethod: 'mosteller'; heightCm: number; weightKg: number; anthropometryDate: LocalDate };
  /** Assay/lab and hormonal-treatment context of the sample (D7-01/D7-09); never inferred from sex. */
  assay?: string;
  lab?: string;
  hormoneTherapy?: 'yes' | 'no' | 'unknown';
  /**
   * Sample-specific context (illness, hard training in the last 48 h, hours since the last fast ended, an explicit
   * prolonged-fast protocol, hours into a logged fast; D7-06/A1-047). Known illness or a prolonged fast is not a routine
   * basal HOMA sample; absent = unknown.
   */
  sampleContext?: LabSampleContext;
  /** Accepted value outside the model's calibration domain: kept exactly, projection unavailable (D7-02). */
  outOfDomain?: boolean;
}

export interface DisplayOnlyRow {
  name: string;
  value: string;
  unit?: string;
  range?: string;
  date: LocalDate;
}

export interface MarkerContext {
  creatineLast2w?: boolean;
  recentIllness?: boolean;
  hardTraining48h?: boolean;
  thyroidMeds?: boolean;
  metformin?: boolean;
  ppi?: boolean;
}

export type MarkersChapter = 'skipped' | 'manual' | 'report' | null;

export interface MarkersDoc {
  _schema: 1;
  /** Newest per id is "current"; older ones stay for trends. */
  readings: MarkerReading[];
  /** CBC indices and the rest: shown, never planned on. */
  displayOnly: DisplayOnlyRow[];
  context: MarkerContext;
  chapter: MarkersChapter;
  /** (D7-05, additive) persisted review states with their source reading ids (no diagnosis is assigned by migration). */
  reviews?: MarkerReviewRecord[];
  /** (D7-05, additive) clinician-confirmed conditions, separate from readings; a later normal value does not erase them. */
  conditions?: ClinicianCondition[];
  /** (D7-09, additive) dated medication class changes. */
  medications?: MedicationChange[];
}

/**
 * Review state of a marker (D7-05): baseline usability/freshness, a needed repeat, an unresolved prior abnormality and a
 * clinician-confirmed condition or resolution are distinct. Freshness expiry disables quantitative use only.
 */
export interface MarkerReviewRecord {
  id: string;
  markerId: MarkerId;
  readingIds: string[];
  state: 'baselineUsable' | 'needsRepeat' | 'unresolvedPriorAbnormality' | 'clinicianConfirmed' | 'resolved';
  since: LocalDate;
  authority: 'rule' | 'user' | 'clinician';
  resolvedOn?: LocalDate;
  ruleId?: string;
}

/** A clinician-confirmed condition (D7-05/D4-07). */
export interface ClinicianCondition {
  id: string;
  condition: 'ckd' | 'albuminuria' | 'diabetes' | 'dyslipidaemia' | 'liver' | 'other';
  confirmedOn: LocalDate;
  stage?: string;
  resolvedOn?: LocalDate;
  source: 'selfEnteredClinician' | 'document';
}

export const emptyMarkersDoc = (): MarkersDoc => ({ _schema: 1, readings: [], displayOnly: [], context: {}, chapter: null });

/* ------------------------------------------------------------------------------------------- interaction table */

export interface SourceRef {
  id: string;
  doi?: string;
  pmid?: string;
  url?: string;
  /** The citation text as the research file gives it. */
  note?: string;
  /** The project's own research notes: kept for traceability, never shown as a source on screen. */
  internal?: boolean;
}

/**
 * A threshold: a number in the condition's unit, or a value read from the person or the printed range:
 *   whoCutoff   Hb 13.0 g/dL men, 12.0 women (WHO)
 *   healthyULN  ALT 33 U/L men, 25 women (ACG)
 *   labLow / labHigh / labULN  the printed range's low / high end
 */
export type Threshold = number | 'whoCutoff' | 'healthyULN' | 'labLow' | 'labHigh' | 'labULN';

export type CompareOp = 'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'in';

/**
 * Normalised rule condition on the rule's own marker.
 *   cmp       value op threshold (in `unit`)
 *   between   low ≤ value ≤ high
 *   outside   value < low or > high; `range: 'lab'` = the printed range
 *   any       any confirmed current reading
 *   missing   no reading within `withinWeeks`
 *   xUln      value > factor × the printed upper limit
 *   fallPct   fall from the previous reading by more than `pct` %
 *   afterFast sample drawn within `days` after a fast longer than `fastHours` (needs context; never fires without it)
 */
export type Condition =
  | { op: 'cmp'; cmp: Exclude<CompareOp, 'eq' | 'in'>; value: Threshold; unit: string }
  | { op: 'between'; low: number; high: number; unit: string }
  | { op: 'outside'; range: 'lab' | [number, number]; unit: string }
  | { op: 'any' }
  | { op: 'missing'; withinWeeks: number }
  | { op: 'xUln'; factor: number }
  | { op: 'fallPct'; pct: number }
  | { op: 'afterFast'; days: number; fastHours: number };

/**
 * Extra condition that must also hold. `marker` compares another marker's current reading; `field` reads the rule
 * context (`RuleContext.fields`, dotted names as in the research file); `repeat` needs two confirmed readings meeting
 * the condition; `flag` reads `RuleContext.flags`. A field the context does not know is "unknown": the rule does not
 * fire (it is listed in `MarkerEvaluation.unresolved`).
 */
export type Also =
  | { kind: 'marker'; markerId: MarkerId; cmp: Exclude<CompareOp, 'in'>; value: number; unit: string }
  | { kind: 'field'; field: string; cmp: CompareOp; value: number | string | boolean | readonly string[] }
  | { kind: 'repeat' }
  | { kind: 'flag'; flag: string }
  | { kind: 'sex'; sex: 'male' | 'female' };

/** What a rule does to the plan (normalised from `kind`, `target` and `value`). */
export interface RuleEffect {
  /** Planner locks (cap rules, and clinician rules that hold the plan gentle). */
  locks?: ReadonlyArray<{ lock: LabLockId; value: number; unit: string; bySex?: { male: number; female: number }; relative?: 'deficitDefaultMinus' }>;
  /** Screening flags it sets (eGFR < 60 or ACR ≥ 30 → 'kidney-disease'). */
  flags?: readonly string[];
  /** Levers named (warn, prefer, cap targets): the rung, lever and dish rows the note touches. */
  levers: readonly LeverId[];
  /** Ranking bias for prefer rules (≤ 0.02, regulariser only). */
  preferWeight?: number;
  /** The supplement or lever the planner will not add (a person's own use is never refused, only warned). */
  noSuggest?: readonly LeverId[];
  /** What a re-ask asks about (the screening item or the sample context). */
  reask?: string;
  /** Retest interval for retest rules (and others that name one). */
  retestWeeks?: number;
  /** A value the rule names that has no planner home (eggYolksPerDay, fibre g, minutes): shown in the note only. */
  displayValue?: { name: string; value: number | string };
  /** Clinician rule that keeps the plan at maintenance ("stop and see"). */
  holdsDeficit?: boolean;
}

export interface InteractionRule {
  /** `W-L-<MARKER>-<n>` as in the research file; clinician-only thresholds of a marker get `W-L-<MARKER>-C<n>`. */
  id: `W-L${string}`;
  markerId: MarkerId;
  /** The research file this row came from (`R13-markers-lipids.md`). */
  dossier: string;
  kind: RuleKind;
  when: Condition;
  also: readonly Also[];
  severity: Severity;
  /** ≤ 200 chars; `{value}`, `{date}` (and the other placeholders of the research file) are filled by code. */
  message: string;
  effect: RuleEffect;
  grade: Grade;
  sources: SourceRef[];
  /** The index rule (W-L01…W-L12, W-M09) this row implements, when the research file names one. */
  mapsTo?: string;
  /** Raw target text from the research file (kept for the fixture test and the Evidence table). */
  target: string;
  /**
   * (D7-01, additive) population applicability: a rule with `referencePhysiology: 'adultMale'` applies only to confirmed
   * adult male reference physiology (unknown = unresolved, never a match); sample requirements are claimed only when the
   * readings carry those facts. Absent = the rule's existing sex/also semantics.
   */
  applicability?: { referencePhysiology?: 'adultMale' | 'adultFemale'; adultOnly?: boolean; sample?: { morning?: boolean; fasting?: boolean } };
}

export interface MarkerMeta {
  markerId: MarkerId;
  label: string;
  /** The research file's own id (`fasting_glucose`). */
  sourceId: string;
  dossier: string;
  /** Unit the research file's thresholds are written in (mg/dL for lipids). */
  conventionalUnit: string;
  siUnit: string;
  ranges: ReadonlyArray<{ region: string; low?: number; high?: number; target?: number; note: string; sources: string[] }>;
  retestWeeks: number | null;
}

export interface Interaction {
  markerId: MarkerId;
  lever: LeverId;
  direction: 'up' | 'down' | 'none' | 'mixed';
  /** Effect size as the research file states it (text with numbers, CI and population). */
  effectText: string;
  unit: string;
  population?: string;
  /** null when the research found no time course. */
  timeCourseWeeks: number | null;
  mechanism: string;
  grade: Grade;
  sources: SourceRef[];
  dossier: string;
}

export interface InteractionTable {
  schema: 'vitals.markerInteractions/1';
  generatedFrom: string[];
  markers: MarkerMeta[];
  interactions: Interaction[];
  rules: InteractionRule[];
}

/* ------------------------------------------------------------------------------------------- evaluation */

/**
 * Everything the rules may read besides the readings. Unknown fields stay undefined; a rule whose extra condition
 * reads an undefined field does not fire.
 */
export interface RuleContext {
  /**
   * 'unknown' when the person has not given it: each sex-specific threshold then takes its more cautious value (the
   * higher Hb cut-off, the lower healthy ALT limit, the lower sex-specific cap) and a rule limited to one sex applies.
   */
  sex: 'male' | 'female' | 'unknown';
  ageYears?: number;
  bmi?: number;
  /** HC-E3 default deficit cap for this person, % (for `deficitPct − 5`). */
  defaultDeficitCapPct?: number;
  /** Dotted fields the research file names: 'diet.pattern', 'plan.aerobic_load', 'supplements.calcium', 'deficitPct'… */
  fields?: Readonly<Record<string, number | string | boolean | undefined>>;
  /** Screening flags already known ('gout', 'diabetes', 'anaemia_or_haemoglobinopathy'). */
  flags?: readonly string[];
  /** The person's date for staleness and retest due dates. */
  today: LocalDate;
  /** Date of a big diet change (plan start with another pattern): HbA1c and lipids older than 3 months after it are stale. */
  dietChangeDate?: LocalDate;
  /**
   * (D7-01, additive) reference physiology for hormone rules: confirmed adult male/female reference, or unresolved (unknown,
   * hormone therapy without a lab reference). Never derived from binary sex alone.
   */
  referencePhysiology?: 'adultMale' | 'adultFemale' | 'unresolved';
  /** (D7-05/D7-09, additive) explicit medication change dates that segment freshness and calibration. */
  medicationChangeDates?: LocalDate[];
}

export interface Because {
  markerId: MarkerId;
  label: string;
  value: number;
  unit: string;
  date: LocalDate;
}

export interface MarkerNote {
  rule: `W-L${string}`;
  markerId: MarkerId;
  kind: RuleKind;
  severity: Severity;
  because: Because;
  levers: LeverId[];
  /** The rule's message with its placeholders filled. */
  text: string;
  grade: Grade;
  sources: SourceRef[];
  retestDue?: LocalDate;
}

export interface MarkerState {
  markerId: MarkerId;
  reading: MarkerReading;
  /** 'in range' | 'above range' | 'below range' against the printed range, else the research range. */
  status: 'in' | 'above' | 'below' | 'unknown';
  stale: boolean;
  /** Rule ids that fired on this reading. */
  rules: string[];
}

/** `PlannerSafetyInput` patch (structurally compatible with the planner's type; merged by `mergeSafety`). */
export interface MarkerSafetyPatch {
  plannerLocks: Array<{
    id: LabLockId;
    value: number;
    reasons: Array<{ rule: string }>;
    /** (D4-01, additive) explicit unit (`LAB_LOCK_UNIT[id]`), source and mandatory status of the lock. */
    unit?: string;
    source?: 'marker';
    mandatory?: boolean;
  }>;
  flags: string[];
}

/** (D7-03) A marker rule's decision not to suggest a product/lever, with provenance; a person's own use is never refused. */
export interface NoSuggestDecision {
  rule: `W-L${string}`;
  markerId: MarkerId;
  subject: LeverId;
  sampleDate: LocalDate;
  stale: boolean;
  applicability: Applicability;
}

export interface MarkerEvaluation {
  states: MarkerState[];
  notes: MarkerNote[];
  safety: MarkerSafetyPatch;
  preferLevers: Array<{ lever: LeverId; weight: number; rule: string }>;
  reasks: Array<{ rule: string; markerId: MarkerId; about: string }>;
  retests: Array<{ markerId: MarkerId; due: LocalDate; rule: string }>;
  /** Rules whose extra condition read a field the context does not have (not fired). */
  unresolved: Array<{ rule: string; field: string }>;
  /** (D7-03, additive) every fired noSuggest effect with rule/source/applicability, for the shared suggestion policy. */
  noSuggest?: NoSuggestDecision[];
  /** (D7-01, additive) rules whose population applicability is unresolved (shown as Needs context / Review). */
  applicability?: Array<{ rule: string; status: Applicability; reason: string }>;
}

/* ------------------------------------------------------------------------------------------- commands */

/**
 * Optional clinical metadata a producer may supply with a reading (D7-01/D7-02/D7-06/D7-09, A1-009): the SAME fields as
 * `MarkerReading`, so every producer (markers.set, report confirmation, the typed UI API) transports them unchanged and
 * absent facts stay absent (never inferred from the entry time, the unit or binary sex). Bounds a producer validates:
 * `sampleLocalClockH` finite in [0, 24); `fastingHours`, `sampleContext.afterFastHours` and
 * `sampleContext.loggedFastHoursAtSample` finite ≥ 0; `quantityKind` is a
 * label only (it never manufactures a BSA conversion: `indexed` is the separate explicit transformation and needs the
 * sample-date anthropometry and its declared method).
 */
export type MarkerSampleFacts = Pick<
  MarkerReading,
  | 'sampleId'
  | 'sampledAt'
  | 'sampleLocalClockH'
  | 'fastingHours'
  | 'fastingStatus'
  | 'confirmedPairWith'
  | 'quantityKind'
  | 'indexed'
  | 'assay'
  | 'lab'
  | 'hormoneTherapy'
  | 'sampleContext'
>;

/** Field names of `MarkerSampleFacts`, in a stable order (producers copy exactly these; A1-009). */
export const MARKER_SAMPLE_FACT_KEYS = [
  'sampleId',
  'sampledAt',
  'sampleLocalClockH',
  'fastingHours',
  'fastingStatus',
  'confirmedPairWith',
  'quantityKind',
  'indexed',
  'assay',
  'lab',
  'hormoneTherapy',
  'sampleContext',
] as const satisfies ReadonlyArray<keyof MarkerSampleFacts>;

export interface MarkerReadingInput extends MarkerSampleFacts {
  id: MarkerId;
  value: number;
  unit: string;
  date: LocalDate;
  labRange?: LabRange;
  method?: string;
  fasting?: boolean;
}

const GFR_KINDS: ReadonlySet<string> = new Set<GfrQuantityKind>(['egfrIndexed', 'gfrAbsolute', 'creatinineClearance', 'indexingUnconfirmed']);
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isText = (x: unknown, max = 60): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

/**
 * The supplied sample facts of a reading input, validated and copied exactly (A1-009): one shared transport rule for every
 * producer. Absent facts stay absent; an invalid supplied fact is reported in `rejected` (field path) and never coerced,
 * clamped or replaced by an inference. `indexed` is accepted only as the explicit absolute→indexed transformation it is:
 * a confirmed `gfrAbsolute` quantity, Mosteller BSA from sample-date height/weight (BSA and the indexed value must agree
 * with them), never manufactured from a bare quantity label.
 */
export function sampleFactsFrom(input: Partial<MarkerReadingInput> & { date?: LocalDate; value?: number }): { facts: MarkerSampleFacts; rejected: string[] } {
  const facts: { -readonly [K in keyof MarkerSampleFacts]?: MarkerSampleFacts[K] } = {};
  const rejected: string[] = [];
  const s = input as Record<string, unknown>;
  const text = (k: 'sampleId' | 'confirmedPairWith' | 'assay' | 'lab') => {
    if (s[k] === undefined) return;
    if (isText(s[k])) facts[k] = (s[k] as string).trim();
    else rejected.push(k);
  };
  text('sampleId');
  text('confirmedPairWith');
  text('assay');
  text('lab');
  if (s.sampledAt !== undefined) {
    if (typeof s.sampledAt === 'string' && /[T ]\d{2}:\d{2}/.test(s.sampledAt) && Number.isFinite(Date.parse(s.sampledAt))) facts.sampledAt = s.sampledAt;
    else rejected.push('sampledAt');
  }
  if (s.sampleLocalClockH !== undefined) {
    if (isFiniteNum(s.sampleLocalClockH) && s.sampleLocalClockH >= 0 && s.sampleLocalClockH < 24) facts.sampleLocalClockH = s.sampleLocalClockH;
    else rejected.push('sampleLocalClockH');
  }
  if (s.fastingHours !== undefined) {
    if (isFiniteNum(s.fastingHours) && s.fastingHours >= 0) facts.fastingHours = s.fastingHours;
    else rejected.push('fastingHours');
  }
  if (s.fastingStatus !== undefined) {
    if (s.fastingStatus === 'fasting' || s.fastingStatus === 'nonFasting' || s.fastingStatus === 'unknown') facts.fastingStatus = s.fastingStatus;
    else rejected.push('fastingStatus');
  }
  if (s.quantityKind !== undefined) {
    if (typeof s.quantityKind === 'string' && GFR_KINDS.has(s.quantityKind)) facts.quantityKind = s.quantityKind as GfrQuantityKind;
    else rejected.push('quantityKind');
  }
  if (s.hormoneTherapy !== undefined) {
    if (s.hormoneTherapy === 'yes' || s.hormoneTherapy === 'no' || s.hormoneTherapy === 'unknown') facts.hormoneTherapy = s.hormoneTherapy;
    else rejected.push('hormoneTherapy');
  }
  if (s.sampleContext !== undefined) {
    const c = s.sampleContext as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || Array.isArray(c)) rejected.push('sampleContext');
    else {
      const ctx: { -readonly [K in keyof LabSampleContext]?: LabSampleContext[K] } = {};
      const bad = (k: string) => rejected.push(`sampleContext.${k}`);
      if (c.illness !== undefined) {
        if (typeof c.illness === 'boolean') ctx.illness = c.illness;
        else bad('illness');
      }
      if (c.hardTraining48h !== undefined) {
        if (typeof c.hardTraining48h === 'boolean') ctx.hardTraining48h = c.hardTraining48h;
        else bad('hardTraining48h');
      }
      if (c.afterFastHours !== undefined) {
        if (isFiniteNum(c.afterFastHours) && c.afterFastHours >= 0) ctx.afterFastHours = c.afterFastHours;
        else bad('afterFastHours');
      }
      if (c.prolongedFastProtocol !== undefined) {
        if (typeof c.prolongedFastProtocol === 'boolean') ctx.prolongedFastProtocol = c.prolongedFastProtocol;
        else bad('prolongedFastProtocol');
      }
      if (c.loggedFastHoursAtSample !== undefined) {
        if (isFiniteNum(c.loggedFastHoursAtSample) && c.loggedFastHoursAtSample >= 0) ctx.loggedFastHoursAtSample = c.loggedFastHoursAtSample;
        else bad('loggedFastHoursAtSample');
      }
      if (Object.keys(ctx).length) facts.sampleContext = ctx;
    }
  }
  if (s.indexed !== undefined) {
    const x = s.indexed as Record<string, unknown> | null;
    const ok =
      !!x &&
      typeof x === 'object' &&
      facts.quantityKind === 'gfrAbsolute' &&
      x.bsaMethod === 'mosteller' &&
      isFiniteNum(x.heightCm) && x.heightCm > 0 &&
      isFiniteNum(x.weightKg) && x.weightKg > 0 &&
      isFiniteNum(x.bsaM2) && x.bsaM2 > 0 &&
      isFiniteNum(x.valueMlMin173) && x.valueMlMin173 >= 0 &&
      typeof x.anthropometryDate === 'string' &&
      (input.date === undefined || x.anthropometryDate === input.date) &&
      Math.abs(Math.sqrt((x.heightCm * x.weightKg) / 3600) - x.bsaM2) <= 1e-6 * Math.max(1, x.bsaM2) &&
      (!isFiniteNum(input.value) || Math.abs((input.value * 1.73) / x.bsaM2 - x.valueMlMin173) <= 1e-6 * Math.max(1, x.valueMlMin173));
    if (ok) facts.indexed = { valueMlMin173: x!.valueMlMin173 as number, bsaM2: x!.bsaM2 as number, bsaMethod: 'mosteller', heightCm: x!.heightCm as number, weightKg: x!.weightKg as number, anthropometryDate: x!.anthropometryDate as string };
    else rejected.push('indexed');
  }
  return { facts: facts as MarkerSampleFacts, rejected };
}

export interface MarkersView {
  doc: MarkersDoc;
  current: MarkerState[];
  notes: MarkerNote[];
}

export interface ExtractionRow {
  row: number;
  markerId: MarkerId | null;
  nameOnReport: string;
  value: number | null;
  unit: string | null;
  labRange?: string;
  method?: string;
  calculated: boolean;
  /** 0–1; the review table's chip reads it with `CONFIDENCE` (high ≥ 0.9, medium ≥ 0.7, else low). */
  confidence: number;
  issues: string[];
}

/**
 * Extraction confidence cut-offs, the one place both sides read: the extractor's scores (src/markers/extract/layout.ts)
 * and the review table's chip (`confidenceLevel` in src/features/intake/chapters/markers.ts).
 */
export const CONFIDENCE = { high: 0.9, medium: 0.7 } as const;

export interface MarkerExtraction {
  extractionId: Id;
  route: 'textLayer' | 'vision';
  sampleDate?: LocalDate;
  rows: ExtractionRow[];
  displayOnly: DisplayOnlyRow[];
  notInReport: MarkerId[];
  /** Pages that could not be read (no text layer and no provider). */
  unreadPages?: number[];
}
