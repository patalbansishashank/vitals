/**
 * `vitals.markers/1` helpers (SUITE_SPEC §13.5). Pure: add, confirm, remove, current readings, staleness, migration
 * from the Body page's `profile.labs`.
 */
import type { LabBaselines, MedicationChange } from '@/engine/types/profile';
import { instantToLocal } from '@/living/dates';
import type { Instant, LocalDate } from '@/store';
import { monthsBetween } from './because';
import type { MarkerId, MarkerProvenance, MarkerReading, MarkerReadingInput, MarkersDoc } from './types';
import { MARKER_IDS, emptyMarkersDoc, sampleFactsFrom } from './types';
import { canonicalUnitOf, toCanonical } from './units';

/**
 * Readings older than this are display-only for quantitative use (§13.5 staleness). A policy default for forecast
 * applicability (D7-05), not a biological expiry: an expired reading stays in the history, and an unresolved abnormal one
 * keeps its review status (`./review.ts`).
 */
export const STALE_MONTHS = 12;
/** HbA1c and lipids older than this after a recorded big diet change are display-only (policy default, D7-05). */
export const STALE_AFTER_DIET_CHANGE_MONTHS = 3;
const DIET_SENSITIVE: ReadonlySet<MarkerId> = new Set(['hba1c', 'ldl', 'hdl', 'tg', 'nonHdl', 'apoB']);

/**
 * Markers whose baseline a dated medication change of that class segments (D7-05/D7-09): readings drawn before the change
 * and older than `STALE_AFTER_DIET_CHANGE_MONTHS` stop being a current baseline. The class map names which markers the
 * treatment acts on; it is not a dose-response model. A change with no class (an explicit date only) segments all of them.
 */
export const MEDICATION_SENSITIVE: Readonly<Record<MedicationChange['medicationClass'], readonly MarkerId[]>> = {
  insulin: ['hba1c', 'fpg', 'insulin'],
  sulfonylurea: ['hba1c', 'fpg', 'insulin'],
  sglt2: ['hba1c', 'fpg', 'insulin'],
  glp1: ['hba1c', 'fpg', 'insulin'],
  metformin: ['hba1c', 'fpg', 'insulin'],
  statin: ['ldl', 'hdl', 'tg', 'nonHdl', 'apoB'],
  thyroid: ['tsh', 'ft3'],
  hormonal: ['testosterone'],
  antihypertensive: [],
  other: [],
};
const ANY_MEDICATION_SENSITIVE: ReadonlySet<MarkerId> = new Set(Object.values(MEDICATION_SENSITIVE).flat());

/** A dated medication change as the freshness rule reads it (class absent = unspecified). */
export type MedicationChangeLike = Pick<MedicationChange, 'date'> & Partial<Pick<MedicationChange, 'medicationClass'>>;

/**
 * The one freshness context (D7-05) the rules and the engine baseline builder share: the person's day, the latest big
 * diet change (by exposure, `./context.ts`) and the dated medication changes (the document's classed changes plus any
 * explicit unclassed dates). `freshnessOf(doc, ctx)` builds it; a `RuleContext` is one.
 */
export interface FreshnessContext {
  today: LocalDate;
  dietChangeDate?: LocalDate;
  medicationChangeDates?: readonly LocalDate[];
  medications?: readonly MedicationChangeLike[];
}

export function freshnessOf(doc: Pick<MarkersDoc, 'medications'> | null | undefined, ctx: LocalDate | FreshnessContext): FreshnessContext {
  const c: FreshnessContext = typeof ctx === 'string' ? { today: ctx } : ctx;
  const meds: MedicationChangeLike[] = [...(c.medications ?? []), ...(doc?.medications ?? []), ...(c.medicationChangeDates ?? []).map((date) => ({ date }))];
  return { today: c.today, ...(c.dietChangeDate ? { dietChangeDate: c.dietChangeDate } : {}), ...(meds.length ? { medications: meds } : {}) };
}

/** Staleness of a reading under a freshness context (see `isStale`). */
export function isStaleIn(r: Pick<MarkerReading, 'id' | 'date'>, f: FreshnessContext): boolean {
  return isStale(r, f.today, f.dietChangeDate, f.medications);
}

/** Top-level keys this version reads itself; any other non-meta key is a newer writer's field, kept as stored. */
const KNOWN_DOC_KEYS: ReadonlySet<string> = new Set(['readings', 'displayOnly', 'context', 'chapter', 'reviews', 'conditions', 'medications']);

/**
 * The stored document as the app reads it. Additive fields of newer writers (review states, clinician conditions,
 * medication changes; C7) and any other unknown top-level field are kept as stored so a read-modify-write never drops
 * them (store meta keys starting with `_` or `$` are not document content); readings are never rewritten (a legacy eGFR in
 * mL/min stays as entered and reads as indexing-unconfirmed, D7-02). Idempotent: normalising a normalised document
 * returns an equal document, so reload, sync and import converge.
 */
export function normaliseDoc(raw: unknown): MarkersDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<MarkersDoc> & Record<string, unknown>;
  const base = emptyMarkersDoc();
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!k.startsWith('_') && !k.startsWith('$') && !KNOWN_DOC_KEYS.has(k) && v !== undefined) extra[k] = v;
  const out: MarkersDoc = {
    ...(extra as object),
    _schema: 1,
    readings: Array.isArray(d.readings) ? d.readings.filter((r) => r && MARKER_IDS.includes(r.id)) : base.readings,
    displayOnly: Array.isArray(d.displayOnly) ? d.displayOnly : base.displayOnly,
    context: d.context && typeof d.context === 'object' ? d.context : base.context,
    chapter: d.chapter ?? null,
  };
  if (Array.isArray(d.reviews)) out.reviews = d.reviews;
  if (Array.isArray(d.conditions)) out.conditions = d.conditions;
  if (Array.isArray(d.medications)) out.medications = d.medications;
  return out;
}

/**
 * A confirmed reading from a producer's input (A1-009): value, unit and sample date exactly as given (the canonical value
 * beside them), and every supplied clinical fact copied through the one shared transport rule (`sampleFactsFrom`: draw
 * id/instant/local clock hour, fasting hours/status, confirmed pairing, GFR quantity kind and an explicit absolute→indexed
 * conversion, assay/lab, hormone therapy, sample context). Absent facts stay absent — nothing is inferred from the entry
 * time, the unit or binary sex; an invalid supplied fact is not stored (producers refuse it first). A GFR quantity kind or
 * conversion is kept only on an eGFR reading, and a quantity label never manufactures a BSA conversion.
 */
export function readingFromInput(input: MarkerReadingInput, provenance: MarkerProvenance, now: Instant, extra: Partial<MarkerReading> = {}): MarkerReading {
  const unitCanonical = canonicalUnitOf(input.id, input.unit);
  const r: MarkerReading = {
    id: input.id,
    value: input.value,
    unit: input.unit,
    valueCanonical: toCanonical(input.id, input.value, input.unit),
    unitCanonical,
    date: input.date,
    provenance,
    confirmed: true,
    enteredAt: now,
    ...extra,
  };
  if (input.labRange) r.labRange = input.labRange;
  if (input.method) r.method = input.method;
  if (input.fasting !== undefined) r.fasting = input.fasting;
  // sample facts (C1/D7-01/D7-02/D7-06, A1-009): stored only when actually given and valid, never inferred
  const { facts } = sampleFactsFrom(input);
  const { quantityKind, indexed, ...rest } = facts;
  Object.assign(r, rest);
  if (input.id === 'egfr') {
    if (quantityKind) r.quantityKind = quantityKind;
    if (indexed) r.indexed = indexed;
  }
  // explicit extras (confirmation, provenance) win, as before
  Object.assign(r, extra);
  return r;
}

/** Adds readings; a reading for the same marker and date replaces the earlier one (re-entry is a correction). */
export function upsertReadings(doc: MarkersDoc, readings: readonly MarkerReading[]): MarkersDoc {
  const keep = doc.readings.filter((r) => !readings.some((n) => n.id === r.id && n.date === r.date));
  return { ...doc, readings: sortReadings([...keep, ...readings]) };
}

export function removeReading(doc: MarkersDoc, markerId: MarkerId, date: LocalDate): MarkersDoc {
  return { ...doc, readings: doc.readings.filter((r) => !(r.id === markerId && r.date === date)) };
}

const sortReadings = (rs: MarkerReading[]): MarkerReading[] => [...rs].sort((a, b) => (a.id === b.id ? a.date.localeCompare(b.date) : a.id.localeCompare(b.id)));

/** All confirmed readings of a marker, oldest first. */
export const historyOf = (doc: MarkersDoc, id: MarkerId): MarkerReading[] => doc.readings.filter((r) => r.id === id && r.confirmed).sort((a, b) => a.date.localeCompare(b.date));

/** Newest confirmed reading per marker. */
export function currentReadings(doc: MarkersDoc): MarkerReading[] {
  const by = new Map<MarkerId, MarkerReading>();
  for (const r of doc.readings) {
    if (!r.confirmed) continue;
    const prev = by.get(r.id);
    if (!prev || r.date > prev.date || (r.date === prev.date && r.enteredAt > prev.enteredAt)) by.set(r.id, r);
  }
  return MARKER_IDS.flatMap((id) => (by.has(id) ? [by.get(id)!] : []));
}

/** The reading before the current one (for "fell from … to …" rules). */
export function previousReading(doc: MarkersDoc, id: MarkerId): MarkerReading | undefined {
  const h = historyOf(doc, id);
  return h.length >= 2 ? h[h.length - 2] : undefined;
}

/**
 * Display-only for quantitative use: older than 12 months; diet-sensitive and older than 3 months after a recorded diet
 * change; or drawn before a dated medication change that acts on the marker and older than 3 months (D7-05/D7-09).
 * Changes dated after `today` are not yet in force.
 */
export function isStale(r: Pick<MarkerReading, 'id' | 'date'>, today: LocalDate, dietChangeDate?: LocalDate, medications?: readonly MedicationChangeLike[]): boolean {
  if (monthsBetween(r.date, today) >= STALE_MONTHS) return true;
  const old = monthsBetween(r.date, today) >= STALE_AFTER_DIET_CHANGE_MONTHS;
  if (!old) return false;
  if (dietChangeDate && dietChangeDate <= today && DIET_SENSITIVE.has(r.id) && r.date < dietChangeDate) return true;
  for (const m of medications ?? []) {
    if (!m.date || m.date > today || r.date >= m.date) continue;
    if (m.medicationClass ? MEDICATION_SENSITIVE[m.medicationClass]?.includes(r.id) : ANY_MEDICATION_SENSITIVE.has(r.id)) return true;
  }
  return false;
}

/** Body page `profile.labs` fields that are markers, with their canonical unit. */
const PROFILE_LAB_FIELDS: ReadonlyArray<{ field: keyof LabBaselines; id: MarkerId; unit: string }> = [
  { field: 'ldlMmolL', id: 'ldl', unit: 'mmol/L' },
  { field: 'hdlMmolL', id: 'hdl', unit: 'mmol/L' },
  { field: 'tgMmolL', id: 'tg', unit: 'mmol/L' },
  { field: 'apoBgL', id: 'apoB', unit: 'g/L' },
  { field: 'fastingGlucoseMmolL', id: 'fpg', unit: 'mmol/L' },
  { field: 'fastingInsulinUuMl', id: 'insulin', unit: 'µU/mL' },
  { field: 'hba1cPct', id: 'hba1c', unit: '%' },
  { field: 'crpMgL', id: 'hsCrp', unit: 'mg/L' },
  { field: 'urateMgDl', id: 'urate', unit: 'mg/dL' },
  { field: 'testosteroneNmolL', id: 'testosterone', unit: 'nmol/L' },
];

/**
 * Migration (§13.5.4): existing `profile.labs` marker values become `manual`, confirmed readings dated at the
 * profile's last update. Markers already in the document are left alone.
 */
export function migrateProfileLabs(doc: MarkersDoc, labs: LabBaselines | undefined, updated: Instant, tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone): MarkersDoc {
  if (!labs) return doc;
  // The local day of the update (not the UTC day: near midnight they differ).
  const date = Number.isFinite(Date.parse(updated)) ? instantToLocal(updated, tz).date : updated.slice(0, 10);
  const add: MarkerReading[] = [];
  for (const f of PROFILE_LAB_FIELDS) {
    const v = labs[f.field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (doc.readings.some((r) => r.id === f.id)) continue;
    add.push(readingFromInput({ id: f.id, value: v, unit: f.unit, date }, 'manual', updated));
  }
  return add.length ? upsertReadings(doc, add) : doc;
}
