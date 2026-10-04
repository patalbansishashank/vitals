/**
 * Reading the stored supplements section in either shape (SUITE_SPEC §13.2 migration v1 → v2). Never throws: a
 * malformed section reads as unanswered (null) and malformed rows are dropped.
 */
import { baseUnit, doseUnits } from './dose';
import { SUPPLEMENT_STANCES, SUPPLEMENT_STATES, TIMES_OF_DAY, type SupplementRow, type SupplementStance, type SupplementsSectionV2, type TimeOfDay } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A clock hour as a time of day: before 11 morning, before 16 midday, before 21 evening, else night. */
export function timeOfDayOfClock(clockH: number): TimeOfDay {
  const h = ((clockH % 24) + 24) % 24;
  if (h < 11) return 'morning';
  if (h < 16) return 'midday';
  if (h < 21) return 'evening';
  return 'night';
}

/** The usual clock hour of a time of day (what `log.supplement` and Today use when a row has times). */
export const CLOCK_OF_TIME: Readonly<Record<TimeOfDay, number>> = { morning: 8, midday: 13, evening: 19, night: 22 };

function rowOf(v: unknown): SupplementRow | null {
  if (!isObj(v)) return null;
  const id = typeof v.supplementId === 'string' && v.supplementId ? v.supplementId : null;
  const text = typeof v.text === 'string' && v.text.trim() ? v.text.trim() : undefined;
  if (!id && !text) return null;
  const state = SUPPLEMENT_STATES.includes(v.state as never) ? (v.state as SupplementRow['state']) : 'unknown';
  const times = Array.isArray(v.timesOfDay) ? TIMES_OF_DAY.filter((t) => (v.timesOfDay as unknown[]).includes(t)) : [];
  const dose = num(v.dose);
  return {
    supplementId: id,
    ...(text ? { text } : {}),
    state,
    ...(dose !== undefined ? { dose } : {}),
    ...(typeof v.unit === 'string' && v.unit ? { unit: v.unit } : {}),
    timesOfDay: times,
    ...(typeof v.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.since) ? { since: v.since } : {}),
  };
}

/** v1 stored the catalogue's unit text ("g protein"); v2 stores a unit you can type a number in ("g"). */
function v1Unit(id: string, unit: string): string {
  return doseUnits(id).includes(unit) ? unit : baseUnit(unit);
}

/** v1 `taking[]` entries as rows (state taking; the clock hour becomes a time of day). */
export function rowsFromV1Taking(taking: unknown): SupplementRow[] {
  if (!Array.isArray(taking)) return [];
  const out: SupplementRow[] = [];
  for (const t of taking) {
    if (!isObj(t) || typeof t.supplementId !== 'string' || !t.supplementId) continue;
    const dose = num(t.dose);
    const clockH = num(t.clockH);
    out.push({
      supplementId: t.supplementId,
      state: 'taking',
      ...(dose !== undefined ? { dose } : {}),
      ...(typeof t.unit === 'string' && t.unit ? { unit: v1Unit(t.supplementId, t.unit) } : {}),
      timesOfDay: clockH !== undefined ? [timeOfDayOfClock(clockH)] : [],
    });
  }
  return out;
}

/**
 * The stored section as v2. v1: `stance:'open'` with a non-empty `taking[]` (what "I already take some" wrote) →
 * `stance:'taking'`, each entry a `taking` row; `food_first` stays `food_first`. Null when nothing usable is stored.
 */
export function toSectionV2(raw: unknown): SupplementsSectionV2 | null {
  if (!isObj(raw)) return null;
  if (raw._v === 2) {
    const stance = SUPPLEMENT_STANCES.includes(raw.stance as never) ? (raw.stance as SupplementStance) : null;
    if (!stance) return null;
    const rows = Array.isArray(raw.rows) ? raw.rows.map(rowOf).filter((r): r is SupplementRow => r !== null) : [];
    return { _v: 2, stance, rows };
  }
  const rows = rowsFromV1Taking(raw.taking);
  if (raw.stance === 'open') return { _v: 2, stance: rows.length ? 'taking' : 'open', rows };
  if (raw.stance === 'food_first') return { _v: 2, stance: 'food_first', rows };
  return rows.length ? { _v: 2, stance: 'taking', rows } : null;
}

/** Same row identity: the catalogue id when both have one, else the typed text (case-insensitive). */
export function sameRow(a: Pick<SupplementRow, 'supplementId' | 'text'>, b: Pick<SupplementRow, 'supplementId' | 'text'>): boolean {
  if (a.supplementId && b.supplementId) return a.supplementId === b.supplementId;
  if (!a.supplementId && !b.supplementId) return !!a.text && a.text.toLowerCase() === b.text?.toLowerCase();
  return false;
}
