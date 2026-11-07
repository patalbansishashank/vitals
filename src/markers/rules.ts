/**
 * The W-L* rule engine (SUITE_SPEC §13.5.3). Pure and deterministic.
 *
 * Reads the person's confirmed, non-stale readings, evaluates every row of the interaction table and returns what the
 * plan does with them: planner locks and flags (`cap`, and the clinician rules that hold the plan gentle), notes for the
 * ladder, Food tab and Coach (`warn`, `clinician`, and every other fired rule, each with its "because" reading),
 * ranking preferences (`prefer`), re-asks and retest dates. No rule removes anything: a cap limits what the planner
 * proposes, a person's own logged choices are never refused.
 *
 * A rule whose condition needs something the app does not know (a printed range that was not entered, a context
 * answer not given) does not fire; it is listed in `unresolved`.
 *
 * Population applicability (D7-01): a rule whose threshold is defined for one reference population (`applicability`)
 * fires only for that confirmed population. Unknown physiology, unknown adulthood or a sample drawn on hormone therapy is
 * unresolved (listed in `applicability` and `unresolved`, never a match); another population is not applicable (silent).
 * A message claims sample facts ("two morning fasting tests") only when every counted draw records them.
 *
 * eGFR (D7-02): rules written in mL/min/1.73 m² read the indexed value only (printed indexed, confirmed indexed, or an
 * explicit BSA conversion of a confirmed absolute GFR); an ambiguous mL/min value leaves them unresolved (no staging).
 *
 * Suggestion policy (D7-03): every noSuggest effect of a fired (or applicability-unresolved) rule is emitted as a typed
 * decision in `noSuggest`, with its rule, marker, sample date and applicability, for the shared suggestion policy.
 *
 * Freshness and history (D7-05): one freshness context (`freshnessOf`: the day, the diet change, dated medication
 * changes) decides which readings are current here and in the engine baseline builder. A reading that met a clinical
 * finding rule (renal, glycaemic, lipid; never an electrolyte) keeps a neutral review (`W-L-REVIEW-*`: one note and one
 * re-ask, no lock or flag) once it is expired or superseded, until a newer usable comparable measurement for that rule
 * resolves it under the rule's own threshold or a recorded resolution covers it (A1-010: the full confirmed history is read,
 * not only the newest reading; an unknown-index, absolute or clearance GFR never resolves an indexed eGFR finding, a
 * non-fasting or unknown-fasting glucose never resolves a fasting finding). A clinician-confirmed kidney condition keeps its
 * flag after expiry or a normal value.
 *
 * Samples (D7-06/D7-09): fasting is judged per draw (≥ 8 h without calories; unknown is never fasting), so a nonfasting or
 * unknown glucose never gets a prediabetes (impaired fasting glucose) label, and the prediabetes bands stop below the
 * diabetes range (100 ≤ FPG < 126 mg/dL, 5.7 ≤ HbA1c < 6.5 %). HOMA-IR is computed only from the same draw's glucose and
 * insulin (A1-034: a shared id or confirmed pairing whose recorded dates/instants do not conflict), both eligible fasting,
 * off insulin at the draw (A1-063: as-of medication chronology) and in a routine basal context (A1-047: a known illness or
 * prolonged fast keeps only a separately labelled contextual ratio) (`homaFor`); otherwise its rules stay unresolved.
 *
 * Renal numeric scope (D4-07): a kidney reading never sets a protein bound. The kidney-flag rules (eGFR < 60, ACR ≥ 30)
 * keep their precaution flag, supplement caps, retest and notes, but their protein cap is withheld here
 * (`RENAL_WITHHELD_LOCKS`) and their note says renal targets wait: KDIGO's 0.8 g/kg and the > 1.3 g/kg avoidance ceiling
 * are reference detail for a clinician's own envelope, never an automatic bound on the app's reference weight. No stage,
 * persistence or clearance is inferred from any reading (src/markers/renal.ts).
 */
import type { PersonProfile } from '@/engine/types/profile';
import { PLANNER_LOCK_DEFS } from '@/engine/planner/domain/safety';
import type { PlannerSafetyInput } from '@/engine/planner/domain/types';
import type { Applicability } from '@/lib/bodyContracts';
import { drawIdentityLinked, fastingSampleEligibility, homaDescriptiveRatio, homaEligibility, homaIr, selectDrawPartner, type HomaContextReason, type LabSample, type MedicationScreen } from '@/lib/measurementOperators';
import { homaSampleContext, insulinExposureAt } from '@/engine/model/cardiometabolic/constants';
import type { LocalDate } from '@/store';
import { fillMessage, formatMarkerDate, readingText, type DateStyle } from './because';
import { currentReadings, freshnessOf, historyOf, isStaleIn, previousReading, type FreshnessContext } from './doc';
import { TABLE } from './table';
import { LAB_LOCK_UNIT, MARKER_IDS } from './types';
import type {
  Also,
  ClinicianCondition,
  Condition,
  InteractionRule,
  LabLockId,
  LeverId,
  MarkerEvaluation,
  MarkerId,
  MarkerNote,
  MarkerReading,
  MarkersDoc,
  MarkerState,
  MarkerSafetyPatch,
  NoSuggestDecision,
  RuleContext,
  Threshold,
} from './types';
import { EGFR_INDEXED_UNIT, MARKER_UNITS, convert, displayValue, gfrQuantityOf, indexedEgfrOf } from './units';

/** Re-asks that pause the planner search until answered (§13.5.3); the rest are questions shown with the note. */
export const BLOCKING_REASKS: ReadonlySet<string> = new Set(['diabetes', 'kidney', 'gout', 'foodAllergy']);

/** Renal numeric locks a kidney-flag rule does not apply (D4-07: no automatic renal protein bound). */
export const RENAL_WITHHELD_LOCKS: ReadonlySet<LabLockId> = new Set<LabLockId>(['protein-cap']);

/** A rule that marks kidney context (its effect sets the kidney flag): its renal numeric locks are withheld (D4-07). */
export const isRenalScopeRule = (rule: Pick<InteractionRule, 'effect'>): boolean => (rule.effect.flags ?? []).includes('kidney-disease');

/** Locks where the larger value is the stricter one. */
const FLOOR_LOCKS: ReadonlySet<string> = new Set(['carb-floor', 'protein-floor', 'fat-floor', 'min-eating-window']);

/** WHO haemoglobin cut-off, g/dL; ACG healthy ALT limit, U/L (the research tables' symbolic thresholds). */
const WHO_HB_GDL = { male: 13, female: 12 } as const;
const HEALTHY_ALT_UL = { male: 33, female: 25 } as const;

/*
 * Sex not given: each sex-specific threshold takes its more cautious value. Hb low → the higher cut-off (anaemia is
 * flagged sooner); ALT → the lower healthy limit; a sex-specific cap → the lower cap; a rule limited to one sex applies.
 */
const whoHbCutoff = (sex: RuleContext['sex']): number => (sex === 'unknown' ? Math.max(WHO_HB_GDL.male, WHO_HB_GDL.female) : WHO_HB_GDL[sex]);
const healthyAltUln = (sex: RuleContext['sex']): number => (sex === 'unknown' ? Math.min(HEALTHY_ALT_UL.male, HEALTHY_ALT_UL.female) : HEALTHY_ALT_UL[sex]);

const EPS = 1e-9;

/**
 * "Morning" for a sample claim: drawn before 10:00 local clock time, the bound the testosterone rules already state
 * ("repeat a fasting test before 10 am"; AUA: early morning). A reading without a recorded local clock hour is unknown.
 */
export const MORNING_SAMPLE_BEFORE_H = 10;

type Unknown = { unknown: string };
const isUnknown = (x: unknown): x is Unknown => typeof x === 'object' && x !== null && 'unknown' in x;

/* ------------------------------------------------------------------------------------------- values */

/* ------------------------------------------------------------------------------------------- HOMA pairing (D7-06) */

/** One draw's facts as the shared pair-eligibility contract reads them (absent = unknown, never assumed). */
function labSampleOf(r: MarkerReading, exogenousInsulin: boolean): LabSample {
  const status = r.fastingStatus ?? (r.fasting === true ? 'fasting' : r.fasting === false ? 'nonFasting' : undefined);
  const context = homaSampleContext(r.sampleContext);
  return {
    date: r.date,
    ...(r.sampleId ? { sampleId: r.sampleId } : {}),
    ...(r.sampledAt ? { sampledAt: r.sampledAt } : {}),
    ...(r.fastingHours !== undefined ? { fastingHours: r.fastingHours } : {}),
    ...(status ? { fastingStatus: status } : {}),
    ...(r.confirmedPairWith ? { confirmedPairWith: r.confirmedPairWith } : {}),
    ...(context ? { sampleContext: context } : {}),
    ...(exogenousInsulin ? { exogenousInsulin: true } : {}),
  };
}

const GLUCOSE_LOWERING_INSULIN_FLAGS = ['insulin', 'type-1-diabetes'] as const;
const UNDISCLOSED_MEDICATION_FLAGS = ['diabetes-undisclosed', 'medications-undisclosed'] as const;

/**
 * Exogenous-insulin context of a draw (D7-06, A1-063): the as-of chronology of the document's dated insulin changes at the
 * sample date with the current screen (`insulinExposureAt`, the same resolver the opt-in engine calibration uses). A start
 * or dose change on or before the draw with no later stop is yes; a start after the draw (a future event) never applies to
 * it; a stop before the draw ends that course; an ambiguous same-class history is unknown. The current screening (insulin
 * or type 1 diabetes) is an independent fact: with no recorded insulin history it is yes; a withheld medicines answer is
 * unknown. Never inferred from a diagnosis or a marker value; no washout duration.
 */
export function insulinTherapyAt(doc: Pick<MarkersDoc, 'medications'>, ctx: Pick<RuleContext, 'flags'> & Partial<Pick<RuleContext, 'today'>>, date: LocalDate): 'yes' | 'no' | 'unknown' {
  const flags = ctx.flags ?? [];
  const asOf = ctx.today ?? date;
  const screen: MedicationScreen | undefined = GLUCOSE_LOWERING_INSULIN_FLAGS.some((f) => flags.includes(f))
    ? { status: 'active', asOf }
    : UNDISCLOSED_MEDICATION_FLAGS.some((f) => flags.includes(f))
      ? { status: 'undisclosed', asOf }
      : undefined;
  return insulinExposureAt(doc.medications ?? [], date, screen);
}

/**
 * Why a HOMA-IR is not shown (inline: "Pairing unknown" / "Fasting unknown" / "Not fasting" / "Insulin treatment"; A1-034
 * `samplingConflict`: the shared id or pairing contradicts the recorded dates/instants; A1-047 `illnessUnresolved` /
 * `prolongedFast`: a known non-routine context — only a separately labelled contextual ratio).
 */
export type HomaUnavailableReason = 'noGlucose' | 'pairingUnknown' | 'samplingConflict' | 'fastingUnknown' | 'notFasting' | 'exogenousInsulin' | 'insulinTherapyUnknown' | HomaContextReason | 'unit';

export type HomaResult =
  | { status: 'eligible'; value: number; glucose: MarkerReading; insulin: MarkerReading }
  | {
      status: 'unavailable';
      reasons: HomaUnavailableReason[];
      glucose?: MarkerReading;
      insulin: MarkerReading;
      /**
       * (A1-047) The arithmetic glucose × insulin / 22.5 of an otherwise eligible same-draw fasting pair whose context is
       * not routine (known illness, prolonged fast): descriptive and contextual only — never a rule, preference, objective
       * or calibration input.
       */
      contextual?: { value: number; label: 'contextual'; contextReasons: readonly HomaContextReason[] };
    };

/**
 * HOMA-IR of one insulin draw (D7-06): glucose (mmol/L) × insulin (µU/mL) / 22.5, only with the glucose of the SAME draw
 * and both samples eligible fasting (≥ 8 h without calories), no exogenous insulin at the draw and a routine basal context.
 * The partner is the linked glucose (shared sample id or a pairing the person confirmed) whose recorded date/instant agrees
 * (`selectDrawPartner`, A1-034): a reused id on another date or a contradictory instant is `samplingConflict`, never the
 * last-entered match. A glucose from the same date without a draw identity is not a pairing; a historical insulin is paired
 * with its own draw's glucose. A known illness or prolonged fast (A1-047) leaves only a contextual descriptive ratio. A
 * descriptive surrogate within its assay/population scope, never a diagnostic threshold or a measured hepatic sensitivity.
 */
export function homaFor(insulin: MarkerReading, doc: Pick<MarkersDoc, 'readings' | 'medications'>, ctx: Pick<RuleContext, 'flags'> & Partial<Pick<RuleContext, 'today'>>): HomaResult {
  const glucoses = doc.readings.filter((g) => g.id === 'fpg' && g.confirmed).sort((a, b) => b.date.localeCompare(a.date) || b.enteredAt.localeCompare(a.enteredAt));
  if (!glucoses.length) return { status: 'unavailable', reasons: ['noGlucose'], insulin };
  const target = labSampleOf(insulin, false);
  const candidates = glucoses.map((g) => ({ ...labSampleOf(g, false), reading: g }));
  const partner = selectDrawPartner(target, candidates);
  if (!partner) return { status: 'unavailable', reasons: [candidates.some((c) => drawIdentityLinked(c, target)) ? 'samplingConflict' : 'pairingUnknown'], insulin };
  const glucose = partner.reading;
  const therapy = insulinTherapyAt(doc, ctx, insulin.date);
  const h = homaEligibility(labSampleOf(glucose, therapy === 'yes'), labSampleOf(insulin, therapy === 'yes'));
  const reasons: HomaUnavailableReason[] = [...h.reasons];
  if (therapy === 'unknown') reasons.push('insulinTherapyUnknown');
  const gl = convert('fpg', glucose.value, glucose.unit, 'mmol/L');
  const ins = convert('insulin', insulin.value, insulin.unit, 'µU/mL');
  if (gl === null || ins === null) reasons.push('unit');
  if (reasons.length || gl === null || ins === null) {
    // a known illness / prolonged fast alone: the arithmetic stays visible as a contextual ratio, outside every rule
    const ratio = gl !== null && ins !== null && h.pair.eligible && therapy === 'no' ? homaDescriptiveRatio(gl, ins, h) : null;
    return { status: 'unavailable', reasons, glucose, insulin, ...(ratio && ratio.label === 'contextual' ? { contextual: { value: ratio.value, label: 'contextual' as const, contextReasons: ratio.contextReasons } } : {}) };
  }
  const v = homaIr(gl, ins, h);
  return v === null ? { status: 'unavailable', reasons: ['unit'], glucose, insulin } : { status: 'eligible', value: v, glucose, insulin };
}

/** A reading's value in the unit a rule is written in (HOMA-IR is computed from the same draw's glucose and insulin). */
function valueIn(r: MarkerReading, unit: string, env: Pick<Env, 'doc' | 'ctx'>): number | Unknown {
  if (r.id === 'egfr' && unit === EGFR_INDEXED_UNIT) {
    // D7-02: indexed eGFR only; ambiguous mL/min, creatinine clearance or unconverted absolute GFR never stage CKD
    const g = indexedEgfrOf(r);
    return g.status === 'resolved' ? g.value : { unknown: `egfr:${g.reason}` };
  }
  if (unit === 'HOMA-IR') {
    // D7-06: no preference or fasting lever is ever emitted from an invalid pair (the rule stays unresolved)
    const h = homaFor(r, env.doc, env.ctx);
    return h.status === 'eligible' ? h.value : { unknown: `HOMA-IR:${h.reasons[0] ?? 'unavailable'}` };
  }
  const v = convert(r.id, r.value, r.unit, unit);
  // Lp(a) mg/dL and nmol/L never convert: a rule in the other unit simply does not apply
  return v === null ? { unknown: `unit:${unit}` } : v;
}

/** The printed range's ends in a rule's unit. */
function labEnds(r: MarkerReading, unit: string): { low?: number; high?: number } {
  const lr = r.labRange;
  if (!lr) return {};
  const conv = (x: number | undefined): number | undefined => (x === undefined ? undefined : (convert(r.id, x, lr.unit || r.unit, unit) ?? undefined));
  return { low: conv(lr.low), high: conv(lr.high) };
}

function threshold(t: Threshold, r: MarkerReading, unit: string, ctx: RuleContext): number | Unknown {
  if (typeof t === 'number') return t;
  switch (t) {
    case 'whoCutoff':
      return convert('hb', whoHbCutoff(ctx.sex), 'g/dL', unit) ?? { unknown: t };
    case 'healthyULN':
      return healthyAltUln(ctx.sex);
    case 'labLow':
      return labEnds(r, unit).low ?? { unknown: 'labRange' };
    case 'labHigh':
    case 'labULN':
      return labEnds(r, unit).high ?? { unknown: 'labRange' };
  }
}

function cmp(op: string, v: number, t: number): boolean {
  switch (op) {
    case 'gte':
      return v >= t - EPS;
    case 'gt':
      return v > t + EPS;
    case 'lte':
      return v <= t + EPS;
    case 'lt':
      return v < t - EPS;
    case 'eq':
      return Math.abs(v - t) <= EPS;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------- conditions */

interface Env {
  ctx: RuleContext;
  doc: MarkersDoc;
  cur: ReadonlyMap<MarkerId, MarkerReading>;
  /** The one freshness context (D7-05) the baseline builder also uses. */
  fresh: FreshnessContext;
}

/** Does `when` hold for reading `r`? */
function holds(when: Condition, r: MarkerReading, env: Env): boolean | Unknown {
  switch (when.op) {
    case 'any':
      return true;
    case 'missing':
      return false; // evaluated separately (no reading)
    case 'cmp': {
      const v = valueIn(r, when.unit, env);
      if (isUnknown(v)) return v;
      const t = threshold(when.value, r, when.unit, env.ctx);
      if (isUnknown(t)) return t;
      return cmp(when.cmp, v, t);
    }
    case 'between': {
      const v = valueIn(r, when.unit, env);
      if (isUnknown(v)) return v;
      return v >= when.low - EPS && v <= when.high + EPS;
    }
    case 'outside': {
      const v = valueIn(r, when.unit, env);
      if (isUnknown(v)) return v;
      const { low, high } = when.range === 'lab' ? labEnds(r, when.unit) : { low: when.range[0], high: when.range[1] };
      if (low === undefined && high === undefined) return { unknown: 'labRange' };
      return (low !== undefined && v < low - EPS) || (high !== undefined && v > high + EPS);
    }
    case 'xUln': {
      const high = r.labRange?.high;
      if (high === undefined) return { unknown: 'labRange' };
      const h = convert(r.id, high, r.labRange!.unit || r.unit, r.unit);
      if (h === null) return { unknown: 'labRange' };
      return r.value > when.factor * h + EPS;
    }
    case 'fallPct': {
      // the reading before this one (for the newest reading, the previous reading; for a historical one, its own predecessor)
      const prev = previousOf(env.doc, r);
      if (!prev) return false;
      const p = convert(r.id, prev.value, prev.unit, r.unit);
      if (p === null || p <= 0) return false;
      return ((p - r.value) / p) * 100 > when.pct + EPS;
    }
    case 'afterFast': {
      const h = env.ctx.fields?.['sample.fastHoursBefore'];
      const d = env.ctx.fields?.['sample.daysAfterFast'];
      if (typeof h !== 'number' || typeof d !== 'number') return { unknown: 'sample.fastHoursBefore' };
      return h > when.fastHours && d <= when.days;
    }
  }
}

const ORDINAL: Readonly<Record<string, number>> = { none: 0, low: 1, light: 1, moderate: 2, high: 3, 'very high': 4 };

/** Fasting status of one draw from its own metadata (hours, status, or the legacy flag when explicitly set). */
export const sampleFastingOf = (r: MarkerReading): 'eligible' | 'notFasting' | 'unknown' => sampleFasting(r);

function sampleFasting(r: MarkerReading): 'eligible' | 'notFasting' | 'unknown' {
  const status = r.fastingStatus ?? (r.fasting === true ? 'fasting' : r.fasting === false ? 'nonFasting' : undefined);
  return fastingSampleEligibility({ date: r.date, ...(r.fastingHours !== undefined ? { fastingHours: r.fastingHours } : {}), ...(status ? { fastingStatus: status } : {}) });
}

/** Morning draw from its own recorded local clock hour (never from the entry time or the date). */
function sampleMorning(r: MarkerReading): 'yes' | 'no' | 'unknown' {
  const h = r.sampleLocalClockH;
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0 || h >= 24) return 'unknown';
  return h < MORNING_SAMPLE_BEFORE_H ? 'yes' : 'no';
}

function fieldValue(field: string, r: MarkerReading, env: Env): number | string | boolean | undefined {
  // D7-09: fasting is judged per draw from its own metadata (hours ≥ 8 without calories, else the status or the legacy
  // flag); unknown stays undefined (the rule is unresolved), never assumed fasting
  if (field === 'reading.fasting') {
    const f = sampleFasting(r);
    return f === 'eligible' ? true : f === 'notFasting' ? false : undefined;
  }
  if (field === 'reading.fastingEligibility') return sampleFasting(r);
  if (field === 'bmi') return env.ctx.bmi;
  if (field.startsWith('context.')) return env.doc.context[field.slice(8) as keyof MarkersDoc['context']];
  return env.ctx.fields?.[field];
}

/**
 * Confirmed, non-stale readings of the rule's marker that meet its condition, each judged with its own metadata (a draw
 * on hormone therapy never counts toward a reference-population rule).
 */
function repeatHits(rule: InteractionRule, r: MarkerReading, env: Env): MarkerReading[] {
  const population = !!rule.applicability?.referencePhysiology;
  return historyOf(env.doc, r.id).filter((h) => !isStaleIn(h, env.fresh) && !(population && h.hormoneTherapy === 'yes') && holds(rule.when, h, env) === true);
}

function alsoHolds(a: Also, r: MarkerReading, rule: InteractionRule, env: Env): boolean | Unknown {
  switch (a.kind) {
    case 'sex':
      return env.ctx.sex === 'unknown' || env.ctx.sex === a.sex;
    case 'flag':
      return env.ctx.flags?.includes(a.flag) ?? false;
    case 'repeat':
      return repeatHits(rule, r, env).length >= 2;
    case 'marker': {
      // a bound on the rule's own marker (the half-open bands of D7-09) reads the reading being judged, never another draw
      const o = a.markerId === r.id ? r : env.cur.get(a.markerId);
      if (!o) return { unknown: `marker:${a.markerId}` };
      const v = convert(a.markerId, o.value, o.unit, a.unit);
      if (v === null) return { unknown: `marker:${a.markerId}` };
      return a.cmp === 'eq' ? Math.abs(v - a.value) <= EPS : cmp(a.cmp, v, a.value);
    }
    case 'field': {
      const v = fieldValue(a.field, r, env);
      if (v === undefined) return { unknown: a.field };
      if (a.cmp === 'in') return Array.isArray(a.value) && (a.value as readonly string[]).includes(String(v));
      if (a.cmp === 'eq') return v === a.value;
      const num = (x: unknown): number | undefined => (typeof x === 'number' ? x : typeof x === 'string' && x in ORDINAL ? ORDINAL[x] : undefined);
      const nv = num(v);
      const nt = num(a.value);
      if (nv === undefined || nt === undefined) return { unknown: a.field };
      return cmp(a.cmp, nv, nt);
    }
  }
}

/* ------------------------------------------------------------------------------------------- applicability (D7-01) */

interface ApplicabilityResult {
  status: Applicability;
  reason?: string;
}

/**
 * Whether a rule's reference population applies (D7-01). Rules without `applicability` keep their existing sex/also
 * semantics (the conservative unknown-sex handling of the Hb/ALT rules is unchanged). Unknown physiology or adulthood is
 * unresolved, never a positive match; a draw on hormone therapy uses the lab's own reference, not the population cut-off.
 */
function applicabilityOf(rule: InteractionRule, readings: readonly (MarkerReading | undefined)[], ctx: RuleContext): ApplicabilityResult {
  const a = rule.applicability;
  if (!a || (!a.referencePhysiology && !a.adultOnly)) return { status: 'applicable' };
  if (a.adultOnly && ctx.ageYears !== undefined && ctx.ageYears < 18) return { status: 'notApplicable' };
  if (a.referencePhysiology) {
    const rp = ctx.referencePhysiology ?? 'unresolved';
    if (rp === 'unresolved') return { status: 'unresolved', reason: 'referencePhysiology' };
    if (rp !== a.referencePhysiology) return { status: 'notApplicable' };
    if (readings.some((x) => x?.hormoneTherapy === 'yes')) return { status: 'unresolved', reason: 'hormoneTherapy' };
    return { status: 'applicable' };
  }
  // adult-only without a population: adulthood must be known
  return ctx.ageYears === undefined ? { status: 'unresolved', reason: 'age' } : { status: 'applicable' };
}

/** Readings a rule reads: its own and every other marker its extra conditions name. */
function readingsOf(rule: InteractionRule, r: MarkerReading | undefined, env: Env): Array<MarkerReading | undefined> {
  const out: Array<MarkerReading | undefined> = [r];
  for (const a of rule.also) if (a.kind === 'marker') out.push(env.cur.get(a.markerId));
  return out;
}

/**
 * The sample claim of a rule that declares sample facts (`{sampleClaim}`): "morning fasting " when every counted draw
 * records those facts, else "" with the reason (unknown timing vs a draw known not to be a morning fasting one).
 */
function sampleClaimOf(rule: InteractionRule, draws: readonly MarkerReading[]): { claim: string; reason?: 'sampleTimingUnknown' | 'sampleNotMorningFasting' } {
  const need = rule.applicability?.sample;
  if (!need || (!need.morning && !need.fasting)) return { claim: '' };
  let unknown = false;
  let no = false;
  for (const d of draws) {
    if (need.morning) {
      const m = sampleMorning(d);
      if (m === 'unknown') unknown = true;
      else if (m === 'no') no = true;
    }
    if (need.fasting) {
      const f = sampleFasting(d);
      if (f === 'unknown') unknown = true;
      else if (f === 'notFasting') no = true;
    }
  }
  if (draws.length === 0 || unknown || no) return { claim: '', reason: no ? 'sampleNotMorningFasting' : 'sampleTimingUnknown' };
  return { claim: `${[need.morning && 'morning', need.fasting && 'fasting'].filter(Boolean).join(' ')} ` };
}

/** noSuggest decisions of one rule (D7-03): subject, rule, marker, sample date, freshness and applicability. */
function noSuggestOf(rule: InteractionRule, r: MarkerReading, applicability: Applicability, fresh: FreshnessContext): NoSuggestDecision[] {
  return (rule.effect.noSuggest ?? []).map((subject) => ({ rule: rule.id, markerId: rule.markerId, subject, sampleDate: r.date, stale: isStaleIn(r, fresh), applicability }));
}

/* ------------------------------------------------------------------------------------------- evaluation */

const addWeeks = (iso: LocalDate, weeks: number): LocalDate => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return d.toISOString().slice(0, 10);
};

const addMonths = (iso: LocalDate, months: number): LocalDate => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

function lockValue(l: NonNullable<InteractionRule['effect']['locks']>[number], ctx: RuleContext): number {
  if (l.bySex) {
    if (ctx.sex !== 'unknown') return l.bySex[ctx.sex];
    // sex not given: the stricter value (the larger for a floor, the smaller for a cap)
    return FLOOR_LOCKS.has(l.lock) ? Math.max(l.bySex.male, l.bySex.female) : Math.min(l.bySex.male, l.bySex.female);
  }
  if (l.relative === 'deficitDefaultMinus') return Math.max(0, (ctx.defaultDeficitCapPct ?? 25) - l.value);
  return l.value;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The message with its placeholders filled. The reading itself ("{v} mmol/L") is shown in the unit the person entered,
 * like the "because" chip (§13.5.3); when that differs in number from the unit the message is written in, the
 * message's unit follows in brackets so its other numbers ("At 190 or more") still read right. Other numbers stay in
 * the message's unit.
 */
function noteText(rule: InteractionRule, r: MarkerReading, env: Env, style: DateStyle, sampleClaim = ''): string {
  const unit = 'unit' in rule.when ? rule.when.unit : r.unit;
  const homa = unit === 'HOMA-IR' ? valueIn(r, unit, env) : undefined;
  const v = typeof homa === 'number' ? homa : (convert(r.id, r.value, r.unit, unit) ?? r.value);
  const prev = previousReading(env.doc, r.id);
  const capLock = rule.effect.locks?.find((l) => l.bySex);
  const asRuleUnit = `${displayValue(r.id, v, unit)}${unit === '%' ? ' %' : ` ${unit}`}`;
  const entered = readingText(r.id, r.value, r.unit) + (Math.abs(v - r.value) > EPS ? ` (${asRuleUnit})` : '');
  const message = rule.message.replace(new RegExp(`\\{(?:v|value)\\} ?${escapeRe(unit)}(?![\\w/])`, 'g'), () => entered)
    // retest dates: "{date+12w}", "{date+3m}" count from the reading date
    .replace(/\{date\+(\d+)([wm])\}/g, (_all, n: string, u: string) => formatMarkerDate(u === 'w' ? addWeeks(r.date, Number(n)) : addMonths(r.date, Number(n)), style));
  return fillMessage(message, {
    value: displayValue(r.id, v, unit),
    date: formatMarkerDate(r.date, style),
    cap: capLock ? lockValue(capLock, env.ctx) : undefined,
    uln: rule.markerId === 'alt' ? `${healthyAltUln(env.ctx.sex)} U/L` : undefined,
    old: prev ? displayValue(r.id, convert(r.id, prev.value, prev.unit, r.unit) ?? prev.value, r.unit) : undefined,
    d1: prev ? formatMarkerDate(prev.date, style) : undefined,
    d2: formatMarkerDate(r.date, style),
    sampleClaim,
  });
}

/**
 * The note of a kidney-flag rule whose protein cap is withheld (D4-07): what the plan does now — renal targets wait for a
 * repeat test or the clinician's own numbers. The reading is shown as entered, like every "because" clause.
 */
function renalScopeText(r: MarkerReading, style: DateStyle): string {
  const label = MARKER_UNITS[r.id].label;
  return `Because your ${label} was ${readingText(r.id, r.value, r.unit)} on ${formatMarkerDate(r.date, style)}, kidney targets for protein, potassium and fluid wait for a repeat test or your clinician's numbers.`;
}

function statusOf(r: MarkerReading): MarkerState['status'] {
  const lr = r.labRange;
  if (!lr || (lr.low === undefined && lr.high === undefined)) return 'unknown';
  const lo = lr.low === undefined ? undefined : (convert(r.id, lr.low, lr.unit || r.unit, r.unit) ?? undefined);
  const hi = lr.high === undefined ? undefined : (convert(r.id, lr.high, lr.unit || r.unit, r.unit) ?? undefined);
  if (hi !== undefined && r.value > hi + EPS) return 'above';
  if (lo !== undefined && r.value < lo - EPS) return 'below';
  return 'in';
}

/* ------------------------------------------------------------------------------------------- history review (D7-05) */

/**
 * Markers whose clinically important history outlives a reading's freshness (D7-05), and the screening topic its neutral
 * review asks about. Severe renal, glycaemic and lipid findings keep a review until reassessed; electrolytes (sodium,
 * potassium) are acute and simply expire, so an old potassium never raises a perpetual emergency.
 */
export const HISTORY_REVIEW_TOPIC: Readonly<Partial<Record<MarkerId, 'kidney' | 'diabetes' | 'lipids'>>> = {
  egfr: 'kidney',
  uacr: 'kidney',
  creatinine: 'kidney',
  fpg: 'diabetes',
  hba1c: 'diabetes',
  ldl: 'lipids',
  nonHdl: 'lipids',
  apoB: 'lipids',
  tg: 'lipids',
  lpa: 'lipids',
};

/** The history-review markers in the document's marker order (one review per marker). */
const MARKER_IDS_WITH_HISTORY: readonly MarkerId[] = MARKER_IDS.filter((m) => HISTORY_REVIEW_TOPIC[m] !== undefined);

/** Rule id of a marker's history review note / re-ask. */
export const historyReviewRuleId = (m: MarkerId): `W-L${string}` => `W-L-REVIEW-${m.toUpperCase()}`;

/**
 * A rule whose firing is a clinically important finding (D7-05): a clinician rule, a blocking screening re-ask or a rule
 * that sets a screening flag. The thresholds are the table's own (no new cutoff).
 */
export function isClinicalFindingRule(rule: InteractionRule): boolean {
  return rule.kind === 'clinician' || (rule.kind === 'reask' && BLOCKING_REASKS.has(rule.effect.reask ?? '')) || (rule.effect.flags?.length ?? 0) > 0;
}

/** Clinician-confirmed conditions in force on `today` (a recorded resolution on or before it ends one). */
export function activeConditions(doc: Pick<MarkersDoc, 'conditions'>, today: LocalDate): ClinicianCondition[] {
  return (doc.conditions ?? []).filter((c) => c.confirmedOn <= today && !(c.resolvedOn && c.resolvedOn <= today));
}

/** A recorded resolution of a marker's review covering a reading of `date` (user, clinician or a documented rule). */
function reviewResolved(doc: Pick<MarkersDoc, 'reviews'>, markerId: MarkerId, date: LocalDate): boolean {
  return (doc.reviews ?? []).some((v) => v.markerId === markerId && v.state === 'resolved' && (v.resolvedOn ?? v.since) >= date);
}

/** The confirmed reading of the same marker before `r` (a relative rule compares a reading with its own predecessor). */
function previousOf(doc: MarkersDoc, r: Pick<MarkerReading, 'id' | 'date'>): MarkerReading | undefined {
  const h = historyOf(doc, r.id).filter((x) => x.date < r.date);
  return h[h.length - 1];
}

/** A rule fires on reading `r` itself: its population applies and its condition and every extra condition hold. */
function firesOn(rule: InteractionRule, r: MarkerReading, env: Env): boolean {
  if (applicabilityOf(rule, readingsOf(rule, r, env), env.ctx).status !== 'applicable') return false;
  if (holds(rule.when, r, env) !== true) return false;
  return rule.also.every((a) => alsoHolds(a, r, rule, env) === true);
}

/** Extra conditions that name the draw's fasting state: only a known fasting draw is the same observable. */
const FASTING_SAMPLE_FIELDS: ReadonlySet<string> = new Set(['reading.fasting', 'reading.fastingEligibility']);

/**
 * Whether reading `n` is a usable comparable measurement for `rule`'s operator and quantity, against the episode reading
 * `episode` (A1-010): the rule's population applies to it; a fasting-sample rule reads only a known fasting draw (a
 * non-fasting or unknown-fasting glucose is another observable); any other condition on the draw itself holds; and the
 * rule's condition is decidable on it — an unknown-index, absolute (unconverted) or clearance GFR never stands in for
 * indexed eGFR, and a unit that does not convert is not comparable. A relative rule compares the same quantity kind.
 */
function comparableFor(rule: InteractionRule, episode: MarkerReading, n: MarkerReading, env: Env): boolean {
  if (applicabilityOf(rule, [n], env.ctx).status !== 'applicable') return false;
  for (const a of rule.also) {
    if (a.kind !== 'field' || !a.field.startsWith('reading.')) continue;
    if (FASTING_SAMPLE_FIELDS.has(a.field) ? sampleFasting(n) !== 'eligible' : alsoHolds(a, n, rule, env) !== true) return false;
  }
  if (rule.when.op === 'fallPct') {
    if (n.id === 'egfr' && gfrQuantityOf(n) !== gfrQuantityOf(episode)) return false;
    return convert(n.id, n.value, n.unit, episode.unit) !== null;
  }
  return !isUnknown(holds(rule.when, n, env));
}

/**
 * Whether a comparable reading `n` documents the resolution of `rule`'s episode at `episode`, under the rule's own
 * threshold (no new cutoff): the condition no longer holds on it; for a relative fall, the decline from the reading before
 * the episode no longer exceeds the rule's percentage.
 */
function resolvesEpisode(rule: InteractionRule, episode: MarkerReading, n: MarkerReading, env: Env): boolean {
  if (rule.when.op === 'fallPct') {
    const ref = previousOf(env.doc, episode);
    const p = ref ? convert(episode.id, ref.value, ref.unit, episode.unit) : null;
    const v = convert(n.id, n.value, n.unit, episode.unit);
    if (p === null || v === null || p <= 0) return false;
    return ((p - v) / p) * 100 <= rule.when.pct + EPS;
  }
  return holds(rule.when, n, env) === false;
}

/**
 * The newest unresolved clinical-finding episode of a marker over its full confirmed history (D7-05, A1-010), or null.
 * For each clinical finding rule, the newest reading it fires on is an episode unless it is the current (fresh, newest)
 * reading — whose own rules apply — or it is resolved: a recorded resolution covers its date, or the latest later reading
 * that is a usable comparable measurement for that rule no longer meets the threshold. A later comparable reading that
 * is current and still fires carries the finding itself. A newer reading that cannot reassess it (an ambiguous GFR
 * quantity, a non-fasting glucose) leaves the episode open.
 */
function unresolvedEpisode(markerId: MarkerId, rules: readonly InteractionRule[], env: Env): { rule: InteractionRule; reading: MarkerReading } | null {
  const history = historyOf(env.doc, markerId);
  if (!history.length) return null;
  const current = env.cur.get(markerId);
  let best: { rule: InteractionRule; reading: MarkerReading } | null = null;
  for (const rule of rules) {
    if (rule.markerId !== markerId || rule.when.op === 'missing' || !isClinicalFindingRule(rule)) continue;
    for (let i = history.length - 1; i >= 0; i--) {
      const x = history[i]!;
      if (x === current || !firesOn(rule, x, env)) continue;
      if (reviewResolved(env.doc, markerId, x.date)) break;
      const later = history.slice(i + 1).filter((n) => comparableFor(rule, x, n, env));
      const latest = later[later.length - 1];
      if (latest && resolvesEpisode(rule, x, latest, env)) break;
      if (latest && latest === current && firesOn(rule, latest, env)) break;
      if (!best || x.date > best.reading.date) best = { rule, reading: x };
      break;
    }
  }
  return best;
}

/**
 * Unresolved prior abnormality (D7-05, A1-010): a reading that met a clinical finding rule keeps a neutral review — one
 * re-ask on its screening topic and one note naming that reading (its source identity, separate from the newest reading the
 * marker shows exactly as entered) — instead of the rule's locks, flags or prescriptions (an old low eGFR is not a new
 * chronic-kidney-disease diagnosis or a permanent protein cap). Only a newer usable comparable measurement that no longer
 * meets the rule, or a recorded resolution, ends the review; a clinician-confirmed condition is separate and is not ended
 * by a later normal value.
 */
function priorAbnormalityReviews(rules: readonly InteractionRule[], env: Env, ev: MarkerEvaluation, style: DateStyle): void {
  for (const m of MARKER_IDS_WITH_HISTORY) {
    const topic = HISTORY_REVIEW_TOPIC[m]!;
    const ep = unresolvedEpisode(m, rules, env);
    if (!ep) continue;
    const r = ep.reading;
    const id = historyReviewRuleId(m);
    const label = MARKER_UNITS[m].label;
    ev.notes.push({
      rule: id,
      markerId: m,
      kind: 'reask',
      severity: 'info',
      because: { markerId: m, label, value: r.value, unit: r.unit, date: r.date },
      levers: [],
      text: `Because your ${label} ${/s$/.test(label) ? 'were' : 'was'} ${readingText(m, r.value, r.unit)} on ${formatMarkerDate(r.date, style)}: repeat the test or confirm it with your doctor before the plan uses it.`,
      grade: ep.rule.grade,
      sources: ep.rule.sources,
    });
    ev.reasks.push({ rule: id, markerId: m, about: topic });
    ev.states.find((st) => st.markerId === m)?.rules.push(id);
  }
}

export interface EvaluateOptions {
  dateStyle?: DateStyle;
  /** Evaluate only these rules (tests). */
  rules?: readonly InteractionRule[];
}

export function evaluateMarkers(doc: MarkersDoc, ctx: RuleContext, opts: EvaluateOptions = {}): MarkerEvaluation {
  const style = opts.dateStyle ?? 'day-month';
  const all = currentReadings(doc);
  const fresh = freshnessOf(doc, ctx);
  const cur = new Map<MarkerId, MarkerReading>();
  for (const r of all) if (!isStaleIn(r, fresh)) cur.set(r.id, r);
  const env: Env = { ctx, doc, cur, fresh };

  const states: MarkerState[] = all.map((r) => ({ markerId: r.id, reading: r, status: statusOf(r), stale: !cur.has(r.id), rules: [] }));
  const ev: MarkerEvaluation = { states, notes: [], safety: { plannerLocks: [], flags: [] }, preferLevers: [], reasks: [], retests: [], unresolved: [], noSuggest: [], applicability: [] };
  const noSuggest = ev.noSuggest!;
  const applicability = ev.applicability!;
  const locks = new Map<LabLockId, MarkerSafetyPatch['plannerLocks'][number]>();
  const prefer = new Map<LeverId, { lever: LeverId; weight: number; rule: string }>();

  const rules = opts.rules ?? TABLE.rules;
  for (const rule of rules) {
    const r = cur.get(rule.markerId);
    const app = applicabilityOf(rule, readingsOf(rule, r, env), ctx);
    if (app.status === 'notApplicable') continue;
    if (rule.when.op === 'missing') {
      // fires when there is no usable reading within the window (and its extra conditions hold)
      const recent = r && addWeeks(r.date, rule.when.withinWeeks) >= ctx.today;
      if (recent) continue;
      if (app.status === 'unresolved') {
        applicability.push({ rule: rule.id, status: 'unresolved', reason: app.reason ?? 'unresolved' });
        ev.unresolved.push({ rule: rule.id, field: app.reason ?? 'applicability' });
        continue;
      }
      const pseudo = r ?? all.find((x) => x.id === rule.markerId);
      let ok = true;
      for (const a of rule.also) {
        const h = pseudo ? alsoHolds(a, pseudo, rule, env) : a.kind === 'field' ? (ctx.fields?.[a.field] === undefined ? { unknown: a.field } : ctx.fields[a.field] === a.value) : false;
        if (isUnknown(h)) {
          ev.unresolved.push({ rule: rule.id, field: h.unknown });
          ok = false;
          break;
        }
        if (!h) {
          ok = false;
          break;
        }
      }
      if (ok && rule.effect.retestWeeks !== undefined) ev.retests.push({ markerId: rule.markerId, due: ctx.today, rule: rule.id });
      continue;
    }
    if (!r) continue;
    let fired = holds(rule.when, r, env);
    if (fired === true) {
      for (const a of rule.also) {
        const h = alsoHolds(a, r, rule, env);
        if (h !== true) {
          fired = h;
          break;
        }
      }
    }
    if (isUnknown(fired)) {
      ev.unresolved.push({ rule: rule.id, field: fired.unknown });
      // a declared noSuggest whose context is unknown stays visible as unresolved (never silently dropped)
      noSuggest.push(...noSuggestOf(rule, r, 'unresolved', fresh));
      continue;
    }
    if (!fired) continue;
    if (app.status === 'unresolved') {
      // the condition holds but the rule's population is not established: neutral review, nothing applied
      applicability.push({ rule: rule.id, status: 'unresolved', reason: app.reason ?? 'unresolved' });
      ev.unresolved.push({ rule: rule.id, field: app.reason ?? 'applicability' });
      noSuggest.push(...noSuggestOf(rule, r, 'unresolved', fresh));
      continue;
    }
    const claim = sampleClaimOf(rule, rule.also.some((a) => a.kind === 'repeat') ? repeatHits(rule, r, env).slice(-2) : [r]);
    if (claim.reason) applicability.push({ rule: rule.id, status: 'unresolved', reason: claim.reason });

    states.find((s) => s.markerId === rule.markerId)?.rules.push(rule.id);
    const e = rule.effect;
    const retestDue = e.retestWeeks !== undefined ? addWeeks(r.date, e.retestWeeks) : undefined;
    const renalScope = isRenalScopeRule(rule);
    const note: MarkerNote = {
      rule: rule.id,
      markerId: rule.markerId,
      kind: rule.kind,
      severity: rule.severity,
      because: { markerId: r.id, label: MARKER_UNITS[r.id].label, value: r.value, unit: r.unit, date: r.date },
      levers: [...e.levers],
      text: renalScope && (e.locks ?? []).some((l) => RENAL_WITHHELD_LOCKS.has(l.lock)) ? renalScopeText(r, style) : noteText(rule, r, env, style, claim.claim),
      grade: rule.grade,
      sources: rule.sources,
    };
    if (retestDue) note.retestDue = retestDue;
    ev.notes.push(note);

    for (const l of e.locks ?? []) {
      // D4-07: a kidney reading marks renal context; it never sets an automatic renal protein bound
      if (renalScope && RENAL_WITHHELD_LOCKS.has(l.lock)) continue;
      const value = lockValue(l, ctx);
      const prev = locks.get(l.lock);
      const stricter = !prev || (FLOOR_LOCKS.has(l.lock) ? value > prev.value : value < prev.value);
      // D4-01: explicit unit (never inferred from the magnitude), marker source, mandatory (a clinical lab bound)
      if (!prev) locks.set(l.lock, { id: l.lock, value, reasons: [{ rule: rule.id }], unit: LAB_LOCK_UNIT[l.lock], source: 'marker', mandatory: true });
      else {
        if (stricter) prev.value = value;
        prev.reasons.push({ rule: rule.id });
      }
    }
    for (const f of e.flags ?? []) if (!ev.safety.flags.includes(f)) ev.safety.flags.push(f);
    noSuggest.push(...noSuggestOf(rule, r, 'applicable', fresh));
    if (rule.kind === 'prefer' && e.preferWeight !== undefined)
      for (const lever of e.levers) {
        const p = prefer.get(lever);
        if (!p || e.preferWeight > p.weight) prefer.set(lever, { lever, weight: Math.min(0.02, e.preferWeight), rule: rule.id });
      }
    if (e.reask) ev.reasks.push({ rule: rule.id, markerId: rule.markerId, about: e.reask });
    if (rule.kind === 'retest' && retestDue) ev.retests.push({ markerId: rule.markerId, due: retestDue, rule: rule.id });
  }

  priorAbnormalityReviews(rules, env, ev, style);
  // D7-05: a clinician-confirmed kidney condition keeps its screening flag after a reading expires or a later normal value
  for (const c of activeConditions(doc, ctx.today)) if ((c.condition === 'ckd' || c.condition === 'albuminuria') && !ev.safety.flags.includes('kidney-disease')) ev.safety.flags.push('kidney-disease');

  ev.safety.plannerLocks = [...locks.values()];
  ev.preferLevers = [...prefer.values()];
  // one retest per marker: the earliest
  const byMarker = new Map<MarkerId, MarkerEvaluation['retests'][number]>();
  for (const t of ev.retests) {
    const p = byMarker.get(t.markerId);
    if (!p || t.due < p.due) byMarker.set(t.markerId, t);
  }
  ev.retests = [...byMarker.values()];
  return ev;
}

/** `markerConstraints(doc, ctx) → PlannerSafetyInput` patch (§13.5.3). */
export function markerConstraints(doc: MarkersDoc, ctx: RuleContext): MarkerSafetyPatch {
  return evaluateMarkers(doc, ctx).safety;
}

type MergedLock = NonNullable<PlannerSafetyInput['plannerLocks']>[number];

/** Whether the larger value of a lock id is the stricter one (the planner's typed comparator, else the screening floors). */
const isFloorLock = (id: string): boolean => PLANNER_LOCK_DEFS[id]?.comparator === 'floor' || FLOOR_LOCKS.has(id);

/**
 * The unit key two entries of a lock id must share to be merged here (D4-01), read with the planner's typed lock
 * semantics (`PLANNER_LOCK_DEFS`, the one definition the request compiler uses): an accepted spelling of the id's unit
 * ('g/kg', 'g/kg reference weight', 'g/kg/d') and an absent unit (the id's fixed unit) are the typed unit. Any other
 * unit is kept verbatim, and so is the absent unit of a surplus cap (ambiguous for an import: the planner asks for
 * review). A unit is never inferred from a value's magnitude.
 */
function unitKey(id: string, unit: string | undefined): string {
  const sem = PLANNER_LOCK_DEFS[id];
  const u = unit === '' ? undefined : unit;
  if (!sem) return u ?? '';
  if (u === undefined) return id === 'surplus-cap' ? '' : sem.unit;
  return u === sem.unit || sem.units.includes(u) ? sem.unit : u;
}

/**
 * Merge the lab patch (or any independently applicable typed bounds, e.g. clinician bounds carried by the current-safety
 * composer) into a screening outcome (D4-01). Entries of one lock id in the same unit merge into one with the
 * strictest value — caps by minimum, floors by maximum, independent of order; reasons of both are kept; a bound is
 * mandatory when any contributor is; flags are united. An entry whose unit is not an accepted spelling of its id (or a
 * surplus cap without a unit) stays a separate entry with exactly the unit it was supplied with, so the planner's typed
 * resolver (`resolveLockConstraints`) still reviews it instead of this merge relabelling it.
 */
export function mergeSafety(input: PlannerSafetyInput | undefined, patch: MarkerSafetyPatch | { plannerLocks: NonNullable<PlannerSafetyInput['plannerLocks']>; flags: readonly string[] }): PlannerSafetyInput {
  const base = input ?? {};
  if (!patch.plannerLocks.length && !patch.flags.length) return base;
  const out = new Map<string, { -readonly [K in keyof MergedLock]: MergedLock[K] }>();
  for (const l of [...(base.plannerLocks ?? []), ...patch.plannerLocks]) {
    const k = unitKey(l.id, l.unit);
    const key = `${l.id}\u0000${k}`;
    // an accepted spelling reads as the typed unit; an unaccepted one stays exactly as supplied; none stays none
    const unit = l.unit === undefined || l.unit === '' ? undefined : PLANNER_LOCK_DEFS[l.id]?.unit === k ? k : l.unit;
    const prev = out.get(key);
    if (!prev) {
      out.set(key, {
        id: l.id,
        ...(l.value !== undefined ? { value: l.value } : {}),
        reasons: [...(l.reasons ?? [])],
        ...(unit !== undefined ? { unit } : {}),
        ...(l.source !== undefined ? { source: l.source } : {}),
        ...(l.mandatory !== undefined ? { mandatory: l.mandatory } : {}),
      });
      continue;
    }
    if (l.value !== undefined) {
      if (prev.value === undefined) prev.value = l.value;
      else prev.value = isFloorLock(l.id) ? Math.max(prev.value, l.value) : Math.min(prev.value, l.value);
    }
    prev.reasons = [...(prev.reasons ?? []), ...(l.reasons ?? [])];
    if (prev.unit === undefined && unit !== undefined) prev.unit = unit;
    if (l.mandatory === true || prev.mandatory === true) prev.mandatory = true;
    else if (prev.mandatory === undefined && l.mandatory !== undefined) prev.mandatory = l.mandatory;
    // one source only when every contributor names the same one
    if (prev.source !== l.source) delete prev.source;
  }
  return { ...base, plannerLocks: [...out.values()], flags: [...new Set([...(base.flags ?? []), ...patch.flags])] };
}

/**
 * Re-asks that pause the planner (`planner.find` → precondition `markerReask`): blocking re-asks whose raising reading is
 * newer than the date the screening question was last answered (an old abnormality the person already answered about
 * does not block again; D7-05).
 */
export function blockingReasks(ev: MarkerEvaluation, answeredOn: Readonly<Partial<Record<string, LocalDate>>> = {}): MarkerEvaluation['reasks'] {
  return ev.reasks.filter((q) => {
    if (!BLOCKING_REASKS.has(q.about)) return false;
    // history-aware (D7-05): the reading that raised this re-ask (its note's "because"), not merely the newest reading
    const raisedBy = ev.notes.find((n) => n.rule === q.rule && n.markerId === q.markerId)?.because.date ?? ev.states.find((s) => s.markerId === q.markerId)?.reading.date;
    const answered = answeredOn[q.about];
    return !answered || (raisedBy !== undefined && raisedBy > answered);
  });
}

/** HC-E3 default deficit cap for a person (17 §2.3; mirrors the planner's compile without the screening locks). */
export function defaultDeficitCapPct(bmi: number, ageYears: number): number {
  let cap = 25;
  if (bmi >= 30) cap = 30;
  if (bmi < 25) cap = 20;
  if (ageYears >= 65) cap = Math.min(cap, 15);
  return cap;
}

/**
 * Reference physiology for population rules (D7-01): the confirmed physiological sex parameter of Your body (the
 * equations' reference, not an identity statement; "prefer not to say" is unresolved) and a known adult age. Unknown sex
 * or age is unresolved, never male. Hormone therapy is per sample (`MarkerReading.hormoneTherapy`), never inferred.
 */
export function referencePhysiologyOf(sex: RuleContext['sex'], ageYears: number | undefined): NonNullable<RuleContext['referencePhysiology']> {
  if (sex === 'unknown' || ageYears === undefined || !Number.isFinite(ageYears) || ageYears < 18) return 'unresolved';
  return sex === 'male' ? 'adultMale' : 'adultFemale';
}

/**
 * Rule context from the person's profile (sex, age, BMI, screening flags) and today's date. Sex is 'unknown' when the
 * person chose "prefer not to say" (`sexUnspecified`; `body.sex` then holds only the equation set) or gave none.
 * Callers use `markerRuleContext` (./context.ts), which adds the fields the app holds.
 */
export function ruleContextFrom(profile: Pick<PersonProfile, 'body' | 'safety' | 'sexUnspecified'> | undefined, today: LocalDate, extra: Partial<RuleContext> = {}): RuleContext {
  const b = profile?.body;
  const sex: RuleContext['sex'] = !profile?.sexUnspecified && (b?.sex === 'female' || b?.sex === 'male') ? b.sex : 'unknown';
  const bmi = b && b.heightCm > 0 ? b.weightKg / (b.heightCm / 100) ** 2 : undefined;
  const pf = profile?.safety?.flags;
  const flags: string[] = [];
  if (pf?.gout) flags.push('gout');
  if (pf?.kidneyDisease) flags.push('kidney-disease');
  if (pf?.diabetesMedication && pf.diabetesMedication !== 'none') flags.push('diabetes');
  // D7-06: exogenous insulin (HOMA-IR and the hepatic calibration are not interpreted on insulin treatment)
  if (pf?.diabetesMedication === 'insulin' || pf?.type1Diabetes) flags.push('insulin');
  const ctx: RuleContext = { sex, today, flags, ...extra };
  if (b?.ageYears !== undefined) ctx.ageYears = b.ageYears;
  if (bmi !== undefined && Number.isFinite(bmi)) {
    ctx.bmi = Math.round(bmi * 10) / 10;
    ctx.defaultDeficitCapPct = defaultDeficitCapPct(bmi, b?.ageYears ?? 40);
  }
  if (extra.flags) ctx.flags = [...new Set([...flags, ...extra.flags])];
  if (extra.referencePhysiology === undefined) ctx.referencePhysiology = referencePhysiologyOf(sex, ctx.ageYears);
  return ctx;
}
