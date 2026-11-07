/**
 * When a logged meal happened (C1/D5-01), kept apart from when it was recorded. Only an explicit instant, an explicit clock
 * hour or a device capture time is an occurrence; a slot's planned clock, the command's entry time or a noon default are
 * never one. Those still fill the entry's legacy `clockH` (old readers need a number), while `occurrence` says the time is
 * date-only, so the shared history keeps it time-uncertain.
 */
import { dateOnlyOccurrence, exactOccurrence, intervalOccurrence, type OccurrenceTime } from '@/lib/bodyContracts';

/** UTC offset of `tz` at epoch `ms`, minutes (null when the zone is unknown to the runtime). */
export function zoneOffsetMin(ms: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
    return Number.isFinite(asUtc) ? Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000) : null;
  } catch {
    return null;
  }
}

/**
 * Epoch instants whose wall time in `tz` is `date` + `clockH` hours: one normally, two in a daylight-saving fold, none in a
 * spring-forward gap. `clockH` may exceed 24 (an item after midnight of the app day).
 */
export function wallInstants(date: string, clockH: number, tz: string): number[] {
  const [y, m, d] = date.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(clockH)) return [];
  const wall = Date.UTC(y!, m! - 1, d!) + Math.round(clockH * 3_600_000);
  const offsets = new Set<number>();
  for (const probe of [wall - 12 * 3_600_000, wall, wall + 12 * 3_600_000]) {
    const o = zoneOffsetMin(probe, tz);
    if (o !== null) offsets.add(o);
  }
  const out: number[] = [];
  for (const o of offsets) {
    const t = wall - o * 60_000;
    if (zoneOffsetMin(t, tz) === o) out.push(t);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export interface MealOccurrence {
  occurrence: OccurrenceTime;
  /** Clock hour of the occurrence on the entry's date, when it is known (exact instant). */
  clockH?: number;
}

/**
 * The occurrence of a meal on app date `date`: `occurredAt` (an instant) wins, then an explicit clock hour on that date in
 * `tz` (a DST fold becomes an interval, a gap stays date-only), else date-only. Never the command's entry time.
 */
export function mealOccurrence(o: { date: string; tz: string; occurredAt?: string; clockH?: number; source: OccurrenceTime['source'] }): MealOccurrence {
  if (o.occurredAt !== undefined) {
    const t = Date.parse(o.occurredAt);
    if (Number.isFinite(t)) {
      const midnight = wallInstants(o.date, 0, o.tz)[0];
      const h = midnight !== undefined ? (t - midnight) / 3_600_000 : NaN;
      const occurrence = exactOccurrence(new Date(t).toISOString(), { tz: o.tz, source: o.source, date: o.date, dateMeaning: 'appDay' });
      return Number.isFinite(h) && h >= 0 && h < 48 ? { occurrence, clockH: Math.round(h * 100) / 100 } : { occurrence };
    }
  }
  if (o.clockH !== undefined && Number.isFinite(o.clockH)) {
    const ts = wallInstants(o.date, o.clockH, o.tz);
    if (ts.length === 1) return { occurrence: exactOccurrence(new Date(ts[0]!).toISOString(), { tz: o.tz, source: o.source, date: o.date, dateMeaning: 'appDay' }), clockH: o.clockH };
    if (ts.length === 2) return { occurrence: intervalOccurrence(new Date(ts[0]!).toISOString(), new Date(ts[1]!).toISOString(), { tz: o.tz, source: o.source, date: o.date, dateMeaning: 'appDay', dstAmbiguous: true }), clockH: o.clockH };
  }
  return { occurrence: { ...dateOnlyOccurrence(o.date, 'appDay', o.source), tz: o.tz } };
}
