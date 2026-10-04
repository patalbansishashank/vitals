/**
 * Row and section edits (pure). Every state can move to every other state; what changes on the way:
 * - into `taking`: the dose and unit are filled from the catalogue when the row has none; times stay as they were
 *   (the person chooses them; "taking" needs at least one before it is valid, see `validateDose`); `since` is set
 *   when a date is given and the row had none.
 * - into `onHand`, `notForMe`, `unknown`: dose and times are **kept** (hidden on screen) so going back to taking
 *   restores them; `since` is dropped (it means "taking since").
 */
import { defaultDose, doseUnits, supplementRecord } from './dose';
import { sameRow } from './migrate';
import { TIMES_OF_DAY, type SupplementRow, type SupplementStance, type SupplementState, type SupplementsSectionV2, type TimeOfDay } from './types';

/** A new row for a catalogue id or typed text, its state preset (from the stance: taking / have it, don't take). */
export function newRow(ref: { supplementId?: string | null; text?: string }, state: SupplementState): SupplementRow {
  const rec = supplementRecord(ref.supplementId);
  const text = ref.text?.trim();
  const d = defaultDose(rec?.id ?? null);
  return {
    supplementId: rec?.id ?? null,
    ...(text && !rec ? { text } : {}),
    state,
    ...(d.dose !== undefined ? { dose: d.dose } : {}),
    unit: d.unit,
    timesOfDay: [],
  };
}

export function setRowState(row: SupplementRow, state: SupplementState, today?: string): SupplementRow {
  if (row.state === state) return row;
  const next: SupplementRow = { ...row, state, timesOfDay: [...row.timesOfDay] };
  if (state === 'taking') {
    if (next.dose === undefined || !next.unit) {
      const d = defaultDose(row.supplementId);
      if (next.dose === undefined && d.dose !== undefined) next.dose = d.dose;
      if (!next.unit) next.unit = d.unit;
    }
    if (today && !next.since) next.since = today;
  } else delete next.since;
  return next;
}

/** Dose and unit; a unit the item is not sold in is replaced with the item's default unit. */
export function setRowDose(row: SupplementRow, dose: number | undefined, unit?: string): SupplementRow {
  const units = doseUnits(row.supplementId);
  const u = unit ?? row.unit;
  const next: SupplementRow = { ...row, unit: u && units.includes(u) ? u : units[0]! };
  if (dose === undefined) delete next.dose;
  else next.dose = dose;
  return next;
}

export function toggleTime(row: SupplementRow, t: TimeOfDay): SupplementRow {
  const has = row.timesOfDay.includes(t);
  const set = new Set(has ? row.timesOfDay.filter((x) => x !== t) : [...row.timesOfDay, t]);
  return { ...row, timesOfDay: TIMES_OF_DAY.filter((x) => set.has(x)) };
}

export function setTimes(row: SupplementRow, times: readonly TimeOfDay[]): SupplementRow {
  return { ...row, timesOfDay: TIMES_OF_DAY.filter((x) => times.includes(x)) };
}

/** Insert or replace a row (same catalogue id, or same typed text). */
export function upsertRow(section: SupplementsSectionV2, row: SupplementRow): SupplementsSectionV2 {
  const i = section.rows.findIndex((r) => sameRow(r, row));
  const rows = i < 0 ? [...section.rows, row] : section.rows.map((r, j) => (j === i ? row : r));
  return { ...section, rows };
}

export function removeRow(section: SupplementsSectionV2, ref: Pick<SupplementRow, 'supplementId' | 'text'>): SupplementsSectionV2 {
  return { ...section, rows: section.rows.filter((r) => !sameRow(r, ref)) };
}

/** An empty section for a stance. */
export function emptySection(stance: SupplementStance = 'food_first'): SupplementsSectionV2 {
  return { _v: 2, stance, rows: [] };
}

/** The state a new pick starts in for a stance (S2 presets from S1). */
export function presetState(stance: SupplementStance): SupplementState {
  return stance === 'onHand' ? 'onHand' : 'taking';
}

export const rowsIn = (section: SupplementsSectionV2 | null, state: SupplementState): SupplementRow[] => (section?.rows ?? []).filter((r) => r.state === state);
