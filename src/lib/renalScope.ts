/**
 * Renal nutrition scope (D4-07; contracts C5/C6). Pure: no clock, no store, no copy.
 *
 * Kidney context decides one thing here: whether the planner may set renal-targeted numbers (protein, sodium, potassium,
 * fluid) on its own. It may only inside an applicable clinician-directed nutrition envelope:
 *   - a kidney-disease answer (or a legacy `kidneyDisease = true` profile) is `incomplete` (contract `contextIncomplete`):
 *     no automatic renal protein bound, no 0.8 g/kg default, no 1.3 g/kg reference-weight ceiling;
 *   - an entered envelope applies while it is dated on or before today, not revoked, its own review date has not passed,
 *     nothing material changed since its assessment (a dated medication change, a recent acute illness, a new
 *     clinician-level kidney or electrolyte result), its context is stable, its dialysis status is known and every per-kg
 *     bound names the kg it refers to (`entered`). Vitals invents no expiry of its own;
 *   - an envelope that no longer applies needs review (`review`); it is kept, never deleted;
 *   - a kidney lab result without a confirmed condition is a neutral review (`priorAbnormalityReview`), never a stage.
 * Entered bounds keep the clinician's own basis and value: g/day = g/kg/day × the specified basis kg, with its date; an
 * actual- or dry-weight order is never replaced by the reference weight min(BW, 27.5·H²). A conflict with a general floor
 * (age, sarcopenia), the carbohydrate floor or an energy lock is reported with both values in one unit; neither side is
 * clipped. Activity, logging, weight management and independent goals are untouched: renal context adds no exercise lock.
 *
 * Inline words (C6): `Entered`, `Review`, `Incomplete` beside the entered g/day, mg/day or mL/day values. KDIGO's 0.8 g/kg
 * (adult G3–G5, grade 2C, basis not mandated) and the > 1.3 g/kg avoidance ceiling are reference detail for the info
 * sheet (`RENAL_REFERENCE_DETAIL`), never a default.
 */
import { intersectConstraints, validateConstraintDef, type ClinicalNutritionEnvelope, type ConstraintDef, type ConstraintQuantity, type IsoDate, type RenalContextStatus, type WeightBasis } from '@/lib/bodyContracts';
import type { MedicationChange, SafetyFlags } from '@/engine/types/profile';

/** Bump when the scope's meaning changes (part of request/certificate hashes through the profile fields it writes). */
export const RENAL_SCOPE_VERSION = 2;

/**
 * KDIGO 2024 reference detail (SB-02, summary pp. S156–S157) for the info sheet. Reference only: no rule here reads these
 * numbers, and they are never a default for dialysis, frailty, instability or unknown context.
 */
export const RENAL_REFERENCE_DETAIL = {
  source: 'KDIGO 2024 CKD guideline',
  proteinReference: { gPerKgPerDay: 0.8, population: 'adults, CKD G3–G5, not on dialysis', grade: '2C', basis: 'body weight (basis not mandated)' },
  proteinAvoidAbove: { gPerKgPerDay: 1.3, population: 'adults with CKD at risk of progression', role: 'avoidance ceiling, not a target' },
  notFor: ['dialysis', 'metabolic instability', 'frailty'],
} as const;

/**
 * A clinician-directed nutrition envelope as the person records it (D4-07): the contract fields plus the kg its per-kg
 * bounds refer to. `weightBasis` names the kind (actual, reference, FFM, clinician-entered such as a dry weight); for any
 * basis other than `actual`, `basisWeightKg` is the clinician's own kg — never the app's reference weight.
 */
export interface RenalNutritionEnvelope extends ClinicalNutritionEnvelope {
  /** kg the per-kg bounds refer to (required unless `weightBasis` is 'actual'). */
  basisWeightKg?: number;
  /** When that kg was set or measured (retained beside the g/day it yields). */
  basisWeightOn?: IsoDate;
  /** What a clinician-entered kg is (shown in the info sheet). */
  basisWeightKind?: 'dry' | 'adjusted' | 'ideal' | 'usual' | 'other';
  /** Frailty as the clinician recorded it (context only: no frailty default exists). */
  frailty?: 'yes' | 'no' | 'unknown';
  /** A recorded withdrawal of the envelope (kept with its date). */
  revokedAt?: IsoDate;
  version?: number;
  supersedesId?: string;
  recordedAt?: string;
  sourceDocument?: string;
  provenance?: string;
}

/**
 * A kidney-relevant finding from the blood markers (src/markers/renal.ts). Kept apart: a current abnormal reading, an
 * expired one under review, a clinician-confirmed condition, and a clinician-level result (the table's own clinician
 * rules, kidney and electrolytes). `stage` is only ever a clinician's entry.
 */
export interface RenalFinding {
  kind: 'currentAbnormal' | 'priorAbnormality' | 'clinicianConfirmed' | 'clinicianLevel';
  /** Marker id ('egfr') or condition ('ckd'). */
  source: string;
  /** Reading identity (`<marker>:<date>`) or condition id. */
  ref: string;
  /** Sample date, or the condition's confirmation date; absent when unknown. */
  date?: IsoDate;
  /** Table rule that raised it, when one did. */
  rule?: string;
  /** Clinician-entered stage (confirmed condition only). */
  stage?: string;
}

/** Renal-targeted numeric domains withheld without an applicable envelope (energy and activity stay independent). */
export const RENAL_DOMAINS = ['protein', 'sodium', 'potassium', 'fluid'] as const;
export type RenalDomain = (typeof RENAL_DOMAINS)[number];

const DOMAIN_OF: Readonly<Partial<Record<ConstraintQuantity, RenalDomain>>> = {
  proteinPerKg: 'protein',
  proteinPerDay: 'protein',
  sodiumPerDay: 'sodium',
  potassiumPerDay: 'potassium',
  fluidPerDay: 'fluid',
};

export type RenalScopeStatus = 'none' | 'incomplete' | 'review' | 'entered' | 'conflict';
export type RenalLabel = 'Entered' | 'Review' | 'Incomplete';

export type RenalReviewReason =
  | 'noDate'
  | 'notYetAssessed'
  | 'revoked'
  | 'reviewDatePassed'
  | 'medicationChanged'
  | 'acuteIllness'
  | 'newClinicalFinding'
  | 'unstable'
  | 'basisWeightMissing'
  | 'basisMismatch'
  | 'invalidBound'
  | 'invalidDate';

export type RenalMissing = 'envelope' | 'dialysisStatus' | 'stability' | 'bounds' | 'bodyMeasures';

export interface RenalBound {
  envelopeId: string;
  /** The bound exactly as entered (unit, basis and value preserved). */
  def: ConstraintDef;
  /** A per-kg bound in g/day: value × the specified basis kg, with that kg and its date. */
  perDay?: { value: number; unit: 'g/d'; basis: WeightBasis; basisKg: number; basisOn?: IsoDate };
  status: 'enforceable' | 'needsBasisWeight' | 'invalid' | 'review' | 'notApplicable';
  normalized?: ConstraintDef;
  domain?: RenalDomain;
  reason?: string;
}

/** One side of a conflict, in its own declared unit. */
export interface RenalConflictSide {
  id: string;
  value: number;
  unit: string;
  source: 'envelope' | 'screening';
  ref: string;
}

/**
 * An empty intersection (C5): a floor above a cap. `proven` when both sides were compared in one unit (`compared`);
 * `unresolved` when they could not be (a body measure or basis kg is missing) — review, not a pass.
 */
export interface RenalConflict {
  kind: 'proven' | 'unresolved';
  domain: 'protein' | 'energy' | 'carbohydrate' | 'other';
  cap: RenalConflictSide;
  floor: RenalConflictSide;
  compared?: { cap: number; floor: number; unit: string };
}

export interface RenalScope {
  version: number;
  envelopes: RenalNutritionEnvelope[];
  evaluations: Array<EnvelopeState & { envelope: RenalNutritionEnvelope }>;
  sourceContext?: Omit<RenalScopeInput, 'envelopes'>;
  status: RenalScopeStatus;
  /** For `profile.safety.flags.renalContext` (`renalSafetyFlags`). */
  context: RenalContextStatus;
  label: RenalLabel | null;
  /** Renal domains with no applicable entered bound: the planner sets no numbers for them on its own. */
  withheld: RenalDomain[];
  /** Domains an applicable envelope bounds (numbers only within the entered bounds). */
  entered: RenalDomain[];
  /** The newest applicable kidney envelope. */
  envelope: RenalNutritionEnvelope | null;
  /** Every applicable envelope (kidney and other), newest first. */
  applicable: RenalNutritionEnvelope[];
  /** Envelopes that no longer apply, with why (kept as recorded). */
  needsReview: Array<{ envelope: RenalNutritionEnvelope; reasons: RenalReviewReason[] }>;
  /** Envelopes missing context they need. */
  incomplete: Array<{ envelope: RenalNutritionEnvelope; missing: RenalMissing[] }>;
  /** Every original bound, including explicit invalid/review/not-applicable states. */
  bounds: RenalBound[];
  conflicts: RenalConflict[];
  /** Context the scope still lacks (no envelope, unknown dialysis status, …). */
  missing: RenalMissing[];
  findings: RenalFinding[];
  /** A stage only as a clinician entered it (envelope or confirmed condition); never inferred from a reading. */
  stage: string | null;
}

export interface RenalScopeInput {
  /** Explicit current source, including an empty list, replaces legacy stored-plan fallback. */
  sourceKnown?: boolean;
  /** Screening flags: 'kidney-disease' is the questionnaire's (or a legacy profile's) kidney answer. */
  flags: readonly string[];
  envelopes?: readonly RenalNutritionEnvelope[];
  findings?: readonly RenalFinding[];
  medicationChanges?: readonly (Pick<MedicationChange, 'id' | 'date'> & Partial<Pick<MedicationChange, 'medicationClass'>>)[];
  /** An acute illness within the screening's recent-illness window. */
  recentIllness?: boolean;
  recentIllnessAt?: IsoDate;
  /** Local date the envelopes are judged on; without it no envelope applies. */
  today?: IsoDate;
  /** Actual weight (with its date) and height: actual-basis g/day and the reference-weight floors' g/day. */
  body?: { weightKg?: number; weightOn?: IsoDate; heightCm?: number };
  /** Screening locks an entered bound can conflict with (protein-floor g/kg reference weight, carb-floor g/day, no-deficit, deficit-cap %). */
  locks?: ReadonlyArray<{ id: string; value?: number }>;
}

const dateOf = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : '');
const positive = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const newestFirst = (a: RenalNutritionEnvelope, b: RenalNutritionEnvelope): number => (a.assessedAt < b.assessedAt ? 1 : a.assessedAt > b.assessedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface EnvelopeState {
  state: 'applicable' | 'review' | 'incomplete';
  reasons: RenalReviewReason[];
  missing: RenalMissing[];
  bounds: RenalBound[];
}

/** One bound with its g/day where the basis kg is known (the basis kind is the bound's own; never substituted). */
function boundOf(env: RenalNutritionEnvelope, def: ConstraintDef, body: RenalScopeInput['body']): RenalBound {
  const domain = DOMAIN_OF[def.quantity];
  const base = { envelopeId: env.id, def, ...(domain ? { domain } : {}) };
  // Check the entered definition before any arithmetic; malformed imported requirements remain visible.
  let bad: string | null;
  try { bad = validateConstraintDef(def); } catch { bad = 'malformedDefinition'; }
  if (!bad && !['actual', 'reference', 'ffm', 'clinicianEntered', 'notApplicable'].includes(def.basis)) bad = 'unknownBasis';
  if (!bad && !['day', 'rolling', 'event', 'horizon'].includes(def.window?.kind)) bad = 'unknownWindow';
  if (!bad && !['applicable', 'notApplicable', 'unresolved'].includes(def.applicability)) bad = 'unknownApplicability';
  if (!bad && !['total', 'supplementOnly', 'plannedAddition'].includes(def.scope)) bad = 'unknownScope';
  if (bad) return { ...base, status: 'invalid', reason: bad };
  if (def.applicability === 'notApplicable') return { ...base, status: 'notApplicable', reason: 'notApplicable' };
  if (def.applicability !== 'applicable') return { ...base, status: 'review', reason: 'unresolvedApplicability' };
  if (def.unit !== 'g/kg/d') return { ...base, status: 'enforceable', normalized: def };
  if (def.basis !== env.weightBasis) return { ...base, status: 'invalid', reason: 'basisMismatch' };
  const kg = positive(env.basisWeightKg) ? env.basisWeightKg : def.basis === 'actual' && positive(body?.weightKg) ? body.weightKg : undefined;
  const on = env.basisWeightOn ?? (def.basis === 'actual' ? body?.weightOn : undefined);
  if (!positive(kg)) return { ...base, status: 'needsBasisWeight', reason: 'basisWeightMissing' };
  return { ...base, status: 'enforceable', normalized: { ...def, quantity: 'proteinPerDay', unit: 'g/d', value: def.value * kg, basis: 'notApplicable' }, perDay: { value: def.value * kg, unit: 'g/d', basis: def.basis, basisKg: kg, ...(on ? { basisOn: on } : {}) } };
}

/**
 * Whether one envelope applies on `i.today` (D4-07). Any material change since its assessment, a passed review date, a
 * withdrawal, an unstable context or an unusable bound is review; an unknown stability or dialysis status (kidney
 * envelopes) or an envelope without bounds is incomplete; otherwise it applies.
 */
export function renalEnvelopeState(env: RenalNutritionEnvelope, i: Pick<RenalScopeInput, 'today' | 'medicationChanges' | 'recentIllness' | 'recentIllnessAt' | 'findings' | 'body'>): EnvelopeState {
  const reasons = new Set<RenalReviewReason>();
  const missing = new Set<RenalMissing>();
  const today = dateOf(i.today);
  const assessed = dateOf(env.assessedAt);
  if (!today || !assessed || !/^\d{4}-\d{2}-\d{2}$/.test(assessed) || !Number.isFinite(Date.parse(assessed))) reasons.add('noDate');
  else {
    if (assessed > today) reasons.add('notYetAssessed');
    for (const date of [env.reviewBy, env.revokedAt, env.basisWeightOn]) if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(dateOf(date)) || !Number.isFinite(Date.parse(date)))) reasons.add('invalidDate');
    if (env.revokedAt && dateOf(env.revokedAt) <= today) reasons.add('revoked');
    if (env.reviewBy && dateOf(env.reviewBy) < today) reasons.add('reviewDatePassed');
    if ((i.medicationChanges ?? []).some((m) => (!m.medicationClass || ['antihypertensive', 'sglt2', 'insulin', 'sulfonylurea'].includes(m.medicationClass)) && dateOf(m.date) > assessed && dateOf(m.date) <= today)) reasons.add('medicationChanged');
    if ((i.findings ?? []).some((f) => f.kind === 'clinicianLevel' && f.date !== undefined && dateOf(f.date) > assessed && dateOf(f.date) <= today)) reasons.add('newClinicalFinding');
  }
  if (i.recentIllnessAt ? dateOf(i.recentIllnessAt) > assessed && dateOf(i.recentIllnessAt) <= today : i.recentIllness) reasons.add('acuteIllness');
  if (env.stability === 'unstable') reasons.add('unstable');
  else if (env.condition === 'ckd' && env.stability !== 'stable') missing.add('stability');
  if (env.condition === 'ckd' && (env.dialysis === undefined || env.dialysis === 'unknown')) missing.add('dialysisStatus');
  if (!env.bounds.length) missing.add('bounds');
  const bounds = env.bounds.map((d) => boundOf(env, d, i.body));
  for (const b of bounds) {
    if (b.status === 'invalid') reasons.add(b.reason === 'basisMismatch' ? 'basisMismatch' : 'invalidBound');
    else if (b.status === 'needsBasisWeight') reasons.add('basisWeightMissing');
  }
  const state = reasons.size ? 'review' : missing.size ? 'incomplete' : 'applicable';
  return { state, reasons: [...reasons].sort(), missing: [...missing].sort(), bounds };
}

/** Reference weight of the screening's own floors (`LOCK_UNIT`: g/kg reference weight), RW = min(BW, 27.5·H²). */
function referenceWeightKg(body: RenalScopeInput['body']): number | null {
  if (!positive(body?.weightKg) || !positive(body?.heightCm)) return null;
  const h = body.heightCm / 100;
  return Math.min(body.weightKg, 27.5 * h * h);
}

interface Side extends RenalConflictSide {
  comparator: 'cap' | 'floor';
  /** The side in the comparison unit, null when it cannot be expressed in it. */
  common: number | null;
}

/** Cross-basis comparison of one domain's sides in one unit (C5: floor above cap is a conflict; unknown is unresolved). */
function compareSides(domain: RenalConflict['domain'], sides: readonly Side[], unit: string, out: RenalConflict[]): void {
  const caps = sides.filter((s) => s.comparator === 'cap');
  const floors = sides.filter((s) => s.comparator === 'floor');
  const strip = ({ comparator: _c, common: _x, ...side }: Side): RenalConflictSide => side;
  for (const c of caps)
    for (const f of floors) {
      if (c.source === 'screening' && f.source === 'screening') continue; // the screening's own locks are not this scope's
      if (c.common === null || f.common === null) out.push({ kind: 'unresolved', domain, cap: strip(c), floor: strip(f) });
      else if (f.common > c.common + 1e-9) out.push({ kind: 'proven', domain, cap: strip(c), floor: strip(f), compared: { cap: c.common, floor: f.common, unit } });
    }
}

/**
 * Conflicts of the applicable envelopes' bounds with each other and with the screening locks (C5): same-key duplicates
 * through `intersectConstraints`; protein across bases in g/day (each side with its own declared basis kg); energy in %
 * of maintenance against `no-deficit` / `deficit-cap`; carbohydrate against `carb-floor`. Nothing is clipped.
 */
function renalConflicts(bounds: readonly RenalBound[], i: RenalScopeInput): RenalConflict[] {
  const out: RenalConflict[] = [];
  const seen = new Set<string>();
  const add = (c: RenalConflict): void => {
    const key = `${c.cap.ref}|${c.cap.id}|${c.floor.ref}|${c.floor.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  const usable = bounds.filter((b) => b.status === 'enforceable' || b.status === 'needsBasisWeight' || (b.status === 'review' && b.reason === 'basisWeightMissing'));
  const side = (b: RenalBound, common: number | null): Side => ({ id: b.def.id, value: b.def.value, unit: b.def.unit, source: 'envelope', ref: b.envelopeId, comparator: b.def.comparator, common });
  const strip = ({ comparator: _c, common: _x, ...s }: Side): RenalConflictSide => s;
  // same quantity, unit, basis, scope and window: the contract's own intersection (ids tagged by position to map back)
  for (const c of intersectConstraints(usable.map((b, k) => ({ ...b.def, id: String(k) }))).conflicts) {
    const cap = usable[Number(c.cap.id)]!;
    const floor = usable[Number(c.floor.id)]!;
    const domain = DOMAIN_OF[cap.def.quantity] === 'protein' ? 'protein' : cap.def.quantity === 'carbPerDay' ? 'carbohydrate' : cap.def.quantity === 'energyPctOfMaintenance' || cap.def.quantity === 'deficitPct' ? 'energy' : 'other';
    add({ kind: 'proven', domain, cap: strip(side(cap, null)), floor: strip(side(floor, null)), compared: { cap: cap.def.value, floor: floor.def.value, unit: cap.def.unit } });
  }
  const cross = (domain: RenalConflict['domain'], sides: readonly Side[], unit: string): void => {
    const found: RenalConflict[] = [];
    compareSides(domain, sides, unit, found);
    for (const c of found) add(c);
  };
  const locks = i.locks ?? [];
  const lockValue = (id: string): number | undefined => locks.find((l) => l.id === id && typeof l.value === 'number' && Number.isFinite(l.value))?.value;

  // protein: every side in g/day (per-kg bounds × their own basis kg; the screening floor × its reference weight)
  const protein: Side[] = [];
  for (const b of usable) {
    if (b.def.quantity === 'proteinPerDay') protein.push(side(b, b.def.value));
    else if (b.def.quantity === 'proteinPerKg') protein.push(side(b, b.perDay?.value ?? null));
  }
  const floorPerKg = lockValue('protein-floor');
  if (floorPerKg !== undefined && protein.some((s) => s.comparator === 'cap')) {
    const rw = referenceWeightKg(i.body);
    protein.push({ id: 'protein-floor', value: floorPerKg, unit: 'g/kg reference weight', source: 'screening', ref: 'protein-floor', comparator: 'floor', common: rw === null ? null : floorPerKg * rw });
  }
  cross('protein', protein, 'g/d');

  // energy: intake in % of maintenance (a deficit cap D means intake ≥ 100 − D; no-deficit means ≥ 100)
  const energy: Side[] = [];
  for (const b of usable) {
    if (b.def.quantity === 'energyPctOfMaintenance') energy.push(side(b, b.def.value));
    else if (b.def.quantity === 'deficitPct') energy.push({ ...side(b, 100 - b.def.value), comparator: b.def.comparator === 'cap' ? 'floor' : 'cap' });
  }
  if (energy.length) {
    if (locks.some((l) => l.id === 'no-deficit')) energy.push({ id: 'no-deficit', value: 0, unit: '%', source: 'screening', ref: 'no-deficit', comparator: 'floor', common: 100 });
    const deficitCap = lockValue('deficit-cap');
    if (deficitCap !== undefined) energy.push({ id: 'deficit-cap', value: deficitCap, unit: '%', source: 'screening', ref: 'deficit-cap', comparator: 'floor', common: 100 - deficitCap });
    cross('energy', energy, '% of maintenance');
  }

  // carbohydrate: g/day both sides
  const carbs: Side[] = usable.filter((b) => b.def.quantity === 'carbPerDay').map((b) => side(b, b.def.value));
  const carbFloor = lockValue('carb-floor');
  if (carbFloor !== undefined && carbs.some((s) => s.comparator === 'cap')) carbs.push({ id: 'carb-floor', value: carbFloor, unit: 'g/d', source: 'screening', ref: 'carb-floor', comparator: 'floor', common: carbFloor });
  cross('carbohydrate', carbs, 'g/d');
  return out;
}

const NONE: RenalScope = Object.freeze({
  version: RENAL_SCOPE_VERSION,
  envelopes: [],
  evaluations: [],
  status: 'none',
  context: 'none',
  label: null,
  withheld: [],
  entered: [],
  envelope: null,
  applicable: [],
  needsReview: [],
  incomplete: [],
  bounds: [],
  conflicts: [],
  missing: [],
  findings: [],
  stage: null,
}) as RenalScope;

/** The empty scope (no kidney context, no envelope). */
export const NO_RENAL_SCOPE: RenalScope = NONE;

/**
 * The renal nutrition scope of a profile (D4-07). Status, most specific first: an applicable kidney envelope is `entered`
 * (`conflict` when its bounds meet an empty intersection); a kidney envelope that no longer applies is `review`; a
 * kidney answer, a clinician-confirmed condition or an incomplete kidney envelope is `incomplete`; a kidney lab result
 * alone is `review` (contract `priorAbnormalityReview`); otherwise `none`.
 */
export function resolveRenalScope(i: RenalScopeInput): RenalScope {
  const envelopes = [...(i.envelopes ?? [])].sort(newestFirst);
  const findings = [...(i.findings ?? [])];
  const kidneyAnswer = i.flags.includes('kidney-disease');
  if (!envelopes.length && !findings.length && !kidneyAnswer) return i.sourceKnown ? { ...NONE, sourceContext: { ...i, envelopes: undefined } as Omit<RenalScopeInput, 'envelopes'> } : NONE;

  const states = envelopes.map((e) => ({ envelope: e, ...renalEnvelopeState(e, i) }));
  const applicable = states.filter((s) => s.state === 'applicable');
  const kidneyApplicable = applicable.filter((s) => s.envelope.condition === 'ckd');
  const needsReview = states.filter((s) => s.state === 'review').map((s) => ({ envelope: s.envelope, reasons: s.reasons }));
  const incomplete = states.filter((s) => s.state === 'incomplete').map((s) => ({ envelope: s.envelope, missing: s.missing }));
  const bounds = states.flatMap((s) => s.bounds.map((b): RenalBound => (s.missing.length === 0 && s.reasons.every((r) => ['invalidBound', 'basisMismatch', 'basisWeightMissing'].includes(r))) || b.status === 'invalid' || b.status === 'notApplicable' ? b : { ...b, status: 'review', normalized: undefined, reason: s.reasons.join(',') || s.missing.join(',') }));
  const conflicts = renalConflicts(bounds, i);

  const confirmed = findings.some((f) => f.kind === 'clinicianConfirmed');
  const labOnly = findings.some((f) => f.kind !== 'clinicianConfirmed');
  const kidneyReview = needsReview.some((s) => s.envelope.condition === 'ckd');
  const kidneyIncomplete = incomplete.some((s) => s.envelope.condition === 'ckd');
  const renalRelevant = kidneyAnswer || confirmed || labOnly || envelopes.some((e) => e.condition === 'ckd');

  let status: RenalScopeStatus;
  let context: RenalContextStatus;
  if (kidneyApplicable.length) {
    status = conflicts.length ? 'conflict' : 'entered';
    context = 'envelopeEntered';
  } else if (kidneyReview) {
    status = 'review';
    context = 'contextIncomplete';
  } else if (kidneyAnswer || confirmed || kidneyIncomplete) {
    status = 'incomplete';
    context = 'contextIncomplete';
  } else if (labOnly) {
    status = 'review';
    context = 'priorAbnormalityReview';
  } else {
    status = conflicts.length ? 'conflict' : needsReview.length ? 'review' : incomplete.length ? 'incomplete' : applicable.length ? 'entered' : 'none';
    context = 'none';
  }

  const conflictDomains = new Set<string>(conflicts.map((c) => c.domain));
  const entered = RENAL_DOMAINS.filter((d) => bounds.some((b) => b.status === 'enforceable' && b.def.scope === 'total' && (b.def.window.kind === 'day' || b.def.window.kind === 'rolling') && DOMAIN_OF[b.def.quantity] === d && (!renalRelevant || envelopes.some((e) => e.condition === 'ckd' && e.id === b.envelopeId))) && !conflictDomains.has(d));
  const withheld = renalRelevant ? RENAL_DOMAINS.filter((d) => !entered.includes(d)) : [];

  const missing = new Set<RenalMissing>();
  if (renalRelevant && !kidneyApplicable.length && !kidneyReview && !kidneyIncomplete) missing.add('envelope');
  for (const s of incomplete) if (s.envelope.condition === 'ckd' || !renalRelevant) for (const m of s.missing) missing.add(m);
  if (conflicts.some((c) => c.kind === 'unresolved')) missing.add('bodyMeasures');

  const stage = envelopes.find((e) => e.condition === 'ckd' && e.stage)?.stage ?? findings.find((f) => f.kind === 'clinicianConfirmed' && f.stage)?.stage ?? null;
  const label: RenalLabel | null = status === 'entered' ? 'Entered' : status === 'incomplete' ? 'Incomplete' : status === 'none' ? null : 'Review';

  return {
    version: RENAL_SCOPE_VERSION,
    envelopes,
    evaluations: states,
    sourceContext: { ...i, envelopes: undefined } as Omit<RenalScopeInput, 'envelopes'>,
    status,
    context,
    label,
    withheld,
    entered,
    envelope: kidneyApplicable[0]?.envelope ?? null,
    applicable: applicable.map((s) => s.envelope),
    needsReview,
    incomplete,
    bounds,
    conflicts,
    missing: [...missing].sort(),
    findings,
    stage,
  };
}

/**
 * The profile fields the planner reads (`profile.safety.flags.renalContext` / `nutritionEnvelopes`; contract C5): the
 * context, all original envelopes and their evaluated states. Review/revocation never deletes source evidence and never
 * grants authority. A healthy profile with no recorded source keeps its existing request fields unchanged.
 */
export function renalSafetyFlags(scope: RenalScope): Pick<SafetyFlags, 'renalContext' | 'nutritionEnvelopes' | 'renalScope'> {
  if (scope.context === 'none' && !scope.envelopes.length && !scope.sourceContext?.sourceKnown) return {};
  return { renalContext: scope.context, nutritionEnvelopes: [...scope.envelopes], renalScope: scope };
}

/** Re-evaluate current dated facts at every planner/lifecycle boundary. */
export function resolveClinicalNutritionScope(flags: SafetyFlags, today: string, actualWeightKg?: number): RenalScope {
  const source = flags.renalScope?.sourceContext;
  return resolveRenalScope({ ...source, flags: flags.kidneyDisease || flags.renalContext === 'contextIncomplete' || flags.renalContext === 'envelopeEntered' ? ['kidney-disease'] : source?.flags ?? [], envelopes: flags.nutritionEnvelopes ?? [], ...(flags.acuteIllnessLast4Weeks && !source?.recentIllnessAt ? { recentIllness: true } : {}), today, body: { ...source?.body, ...(actualWeightKg !== undefined ? { weightKg: actualWeightKg } : {}) } });
}

/** Legacy profile reading (migration): `kidneyDisease = true` without a recorded context is `contextIncomplete`, never a stage. */
export function legacyRenalContext(pf: Pick<SafetyFlags, 'kidneyDisease' | 'renalContext'> | undefined): RenalContextStatus {
  if (pf?.renalContext) return pf.renalContext;
  return pf?.kidneyDisease ? 'contextIncomplete' : 'none';
}

/**
 * Fold marker findings into a profile's renal fields (D4-07): a confirmed kidney condition makes the context at least
 * `contextIncomplete`, a kidney lab result at least `priorAbnormalityReview`; an entered envelope stays in force unless a
 * clinician-level result is dated after its assessment (then review: the context is `contextIncomplete` and the
 * envelope no longer authorizes). Never relaxes a context. Returns the input unchanged when nothing changes.
 */
export function withRenalFindings(pf: Pick<SafetyFlags, 'kidneyDisease' | 'renalContext' | 'nutritionEnvelopes' | 'renalScope'>, findings: readonly RenalFinding[], today?: string, body?: RenalScopeInput['body']): Pick<SafetyFlags, 'renalContext' | 'nutritionEnvelopes' | 'renalScope'> {
  const current = legacyRenalContext(pf);
  const source = pf.renalScope?.sourceContext;
  const day = today ?? source?.today;
  const scope = resolveRenalScope({ ...source, flags: current === 'contextIncomplete' || current === 'envelopeEntered' || pf.kidneyDisease ? ['kidney-disease'] : source?.flags ?? [], envelopes: pf.nutritionEnvelopes ?? [], findings: [...(source?.findings ?? []).filter((f) => !findings.some((n) => n.ref === f.ref)), ...findings], today: day, body: { ...source?.body, ...body } });
  return renalSafetyFlags(scope);
}
