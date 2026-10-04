/**
 * `vitals.markers/1` helpers (SUITE_SPEC §13.5). Pure: add, confirm, remove, current readings, staleness, migration
 * from the Body page's `profile.labs`.
 */
import type { LabBaselines } from '@/engine/types/profile';
import { instantToLocal } from '@/living/dates';
import type { Instant, LocalDate } from '@/store';
import { monthsBetween } from './because';
import type { MarkerId, MarkerProvenance, MarkerReading, MarkerReadingInput, MarkersDoc } from './types';
import { MARKER_IDS, emptyMarkersDoc } from './types';
import { canonicalUnitOf, toCanonical } from './units';

/** Readings older than this are display-only (§13.5 staleness). */
export const STALE_MONTHS = 12;
/** HbA1c and lipids older than this after a recorded big diet change are display-only. */
export const STALE_AFTER_DIET_CHANGE_MONTHS = 3;
const DIET_SENSITIVE: ReadonlySet<MarkerId> = new Set(['hba1c', 'ldl', 'hdl', 'tg', 'nonHdl', 'apoB']);

export function normaliseDoc(raw: unknown): MarkersDoc {
  const d = (raw ?? {}) as Partial<MarkersDoc>;
  const base = emptyMarkersDoc();
  return {
    _schema: 1,
    readings: Array.isArray(d.readings) ? d.readings.filter((r) => r && MARKER_IDS.includes(r.id)) : base.readings,
    displayOnly: Array.isArray(d.displayOnly) ? d.displayOnly : base.displayOnly,
    context: d.context && typeof d.context === 'object' ? d.context : base.context,
    chapter: d.chapter ?? null,
  };
}

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

/** Display-only: older than 12 months, or diet-sensitive and older than 3 months after a recorded diet change. */
export function isStale(r: Pick<MarkerReading, 'id' | 'date'>, today: LocalDate, dietChangeDate?: LocalDate): boolean {
  if (monthsBetween(r.date, today) >= STALE_MONTHS) return true;
  if (dietChangeDate && DIET_SENSITIVE.has(r.id) && r.date < dietChangeDate && monthsBetween(r.date, today) >= STALE_AFTER_DIET_CHANGE_MONTHS) return true;
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
