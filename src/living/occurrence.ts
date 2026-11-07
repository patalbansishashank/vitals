/**
 * Occurrence time, provenance and energy of logged records (C1, D5-01, D5-05). Pure.
 *
 * A record's audit instant (`at`, `recordedAt`) is never its physiological time. The occurrence comes from the record's own
 * `occurrence` when it carries one; legacy records derive it only from what they state with a known date meaning:
 *  - an instant the person gave (a fast's last intake, a night's bed and wake) is exact;
 *  - a legacy `date` + clock hour is the app day's wall clock in the record's zone. A clock hour before the rollover hour
 *    (default 04:00) is ambiguous between the stated date and the next calendar day (app-day vs calendar meaning), and a
 *    wall time inside a daylight-saving fold has two instants: both stay an interval, never a guessed point;
 *  - a record without a clock is date-only (no noon default, no command-entry time).
 * The engine replay keeps placing a meal at its clock hour on its plan day (the template convention); only the history's
 * time metadata changes.
 */
import {
  ETHANOL_G_PER_STANDARD_DRINK,
  GENERAL_ENERGY_FACTORS,
  activeExposureFromServing,
  dateOnlyOccurrence,
  exactOccurrence,
  intervalOccurrence,
  normalizeSubstanceDose,
  occurrenceBoundsMs,
  type OccurrenceTime,
  type QuantityProvenance,
} from '@/lib/bodyContracts';
import { DEFAULT_ROLLOVER_H } from './appDay';
import { addDays, instantToLocal, localToInstant } from './dates';
import type { ClockH, LocalDate, LogEntry, MeasurementEntry } from './types';

/** Version of the legacy date+clock → occurrence rule (C1 `rolloverVersion`). */
export const LEGACY_CLOCK_RULE_VERSION = 1;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function sameWall(ms: number, date: LocalDate, clockH: ClockH, tz: string): boolean {
  try {
    const w = instantToLocal(new Date(ms).toISOString(), tz);
    return w.date === date && Math.abs(w.clockH - clockH) * 60 < 1;
  } catch {
    return false;
  }
}

/**
 * Occurrence of a wall-clock hour on an app day (legacy rule, see the module comment). `clockH` may run to 24 (midnight
 * at the end of the date). Never returns a guessed instant for an ambiguous wall time.
 */
export function localClockOccurrence(date: LocalDate, clockH: ClockH, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H, source: OccurrenceTime['source'] = 'legacy'): OccurrenceTime {
  if (!Number.isFinite(clockH)) return dateOnlyOccurrence(date, 'appDay', source);
  const meta = { tz, source, date, dateMeaning: 'appDay' as const };
  const withRollover = (o: OccurrenceTime): OccurrenceTime => ({ ...o, rolloverH, rolloverVersion: LEGACY_CLOCK_RULE_VERSION });
  let d = date;
  let h = clockH;
  if (h >= 24) {
    d = addDays(date, Math.floor(h / 24));
    h -= 24 * Math.floor(h / 24);
  }
  const at = (dd: LocalDate, hh: number): number => Date.parse(localToInstant(dd, hh, tz));
  if (rolloverH > 0 && clockH < rolloverH) {
    // app day `date` holds the small hours of the next calendar day; a typed clock may mean either
    const a = at(d, h);
    const b = at(addDays(d, 1), h);
    if (Number.isFinite(a) && Number.isFinite(b)) return withRollover(intervalOccurrence(new Date(Math.min(a, b)).toISOString(), new Date(Math.max(a, b)).toISOString(), meta));
  }
  const t = at(d, h);
  if (!Number.isFinite(t)) return withRollover(dateOnlyOccurrence(date, 'appDay', source));
  // a daylight-saving fold: the same wall time one hour earlier or later is also this wall time
  const twins = [t - HOUR_MS, t + HOUR_MS].filter((x) => sameWall(x, d, h, tz));
  if (twins.length > 0) {
    const lo = Math.min(t, ...twins);
    const hi = Math.max(t, ...twins);
    return withRollover(intervalOccurrence(new Date(lo).toISOString(), new Date(hi).toISOString(), { ...meta, dstAmbiguous: true }));
  }
  return withRollover(exactOccurrence(new Date(t).toISOString(), meta));
}

/** Absolute window of an app day [rollover, next rollover) in a zone, epoch ms. */
export function appDayWindowMs(date: LocalDate, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H): { startMs: number; endMs: number } {
  return { startMs: Date.parse(localToInstant(date, rolloverH, tz)), endMs: Date.parse(localToInstant(addDays(date, 1), rolloverH, tz)) };
}

/**
 * Bounds of an occurrence in epoch ms: exact and interval occurrences as given, a date-only occurrence as its whole day
 * (app day, or the civil day for a calendar date), unknown as null.
 */
export function occurrenceWindowMs(o: OccurrenceTime | null | undefined, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H): { startMs: number; endMs: number } | null {
  const b = occurrenceBoundsMs(o);
  if (b) return b;
  if (o?.precision === 'dateOnly' && o.date) {
    if (o.dateMeaning === 'calendarLocal') return { startMs: Date.parse(localToInstant(o.date, 0, o.tz ?? tz)), endMs: Date.parse(localToInstant(addDays(o.date, 1), 0, o.tz ?? tz)) };
    return appDayWindowMs(o.date, o.tz ?? tz, o.rolloverH ?? rolloverH);
  }
  return null;
}

/** When a logged record happened (its own `occurrence`, else the legacy rule). */
export function entryOccurrence(e: LogEntry, ctx: { tz: string; rolloverH?: number }): OccurrenceTime {
  if (e.occurrence) return e.occurrence;
  const tz = e.tz || ctx.tz;
  const r = ctx.rolloverH ?? DEFAULT_ROLLOVER_H;
  switch (e.kind) {
    case 'fast':
      return exactOccurrence(e.lastIntakeAt, { tz, source: 'user', date: e.date, dateMeaning: 'appDay' });
    case 'sleep':
      return intervalOccurrence(e.bedAt, e.wakeAt, { tz, source: 'user', date: e.date, dateMeaning: 'wakeDate' });
    case 'meal':
    case 'substance':
      return localClockOccurrence(e.date, e.clockH, tz, r);
    case 'supplement':
      return e.clockH !== undefined ? localClockOccurrence(e.date, e.clockH, tz, r) : dateOnlyOccurrence(e.date, 'appDay');
    case 'session':
      return e.startH !== undefined ? localClockOccurrence(e.date, e.startH, tz, r) : dateOnlyOccurrence(e.date, 'appDay');
    default:
      return dateOnlyOccurrence(e.date, 'appDay');
  }
}

/** When a measurement happened (its own `occurrence`, else its date; the audit `at` is never used). */
export function measurementOccurrence(m: MeasurementEntry): OccurrenceTime {
  return m.occurrence ?? dateOnlyOccurrence(m.date, 'appDay');
}

/** Provenance of a record's quantities (C1/C3): its own field, else derived from how it was entered. */
export function entryProvenance(e: Pick<LogEntry, 'provenance' | 'assumed' | 'source'>): QuantityProvenance {
  if (e.provenance) return e.provenance;
  if (e.assumed) return 'asPlanned';
  switch (e.source?.method) {
    case 'asPlanned':
    case 'backfill':
      return 'asPlanned';
    case 'typed':
    case 'dbMatch':
    case 'import':
      return 'reported';
    case 'label':
      return 'label';
    case 'aiText':
    case 'aiPhoto':
    case 'aiPhotoUserGrams':
      return 'estimated';
    case 'biometrics':
      return 'measured';
    default:
      return 'legacyUnknown';
  }
}

/** True when the meal's total energy is a known number (an unknown energy is never a zero). */
export function mealEnergyKnown(m: Extract<LogEntry, { kind: 'meal' }>): boolean {
  if (m.energy && m.energy.reconciledMEKcal !== null && Number.isFinite(m.energy.reconciledMEKcal)) return true;
  if (m.totals.unknown?.includes('energyKcal')) return false;
  return Number.isFinite(m.totals.energyKcal.value);
}

/** Energy of a meal, kcal: the ledger's reconciled ME when present, else the totals; null when unknown. */
export function mealEnergyKcal(m: Extract<LogEntry, { kind: 'meal' }>): number | null {
  if (m.energy && m.energy.reconciledMEKcal !== null && Number.isFinite(m.energy.reconciledMEKcal)) return m.energy.reconciledMEKcal;
  if (m.totals.unknown?.includes('energyKcal')) return null;
  return Number.isFinite(m.totals.energyKcal.value) ? m.totals.energyKcal.value : null;
}

/** A substance record's validated canonical dose (its stored `normalized`, else validated now); null when invalid. */
export function substanceDose(e: Extract<LogEntry, { kind: 'substance' }>): { value: number; unit: 'mg' | 'g' } | null {
  if (e.normalized && Number.isFinite(e.normalized.value)) return { value: e.normalized.value, unit: e.normalized.unit };
  const r = normalizeSubstanceDose(e.substance, e.amount, e.unit);
  return r.ok ? { value: r.value, unit: r.unit } : null;
}

/**
 * Energy of an intake record for the zero-calorie fast clock (D5-05), kcal: meals by their energy, alcohol by its ethanol
 * at the general 7 kcal/g convention; null = an intake of unknown energy; undefined = not a caloric intake record.
 */
export function intakeEnergyKcal(e: LogEntry): number | null | undefined {
  if (e.kind === 'meal') return mealEnergyKcal(e);
  if (e.kind === 'substance' && e.substance === 'alcohol') {
    const d = substanceDose(e);
    return d ? d.value * GENERAL_ENERGY_FACTORS.ethanol : null;
  }
  return undefined;
}

/**
 * (D5-05) Caloric status of an intake record for the literal zero-calorie fast clock, kept apart from a numeric energy
 * estimate: `positive` = a known positive caloric ingestion (its exact kcal may be unknown: `energyKcal` null), `zero` = a
 * known zero, `unknown` = an intake whose energy or dose is not known; undefined = not an intake record.
 *  - meals by their energy, alcohol by its ethanol at the general 7 kcal/g convention (`intakeEnergyKcal`);
 *  - ingested exogenous BHB (a ketone substance log, mg normalised to g by `substanceDose`, or a supplement whose label
 *    exposure is `exogenousBhb`): a validated positive dose is a positive caloric ingestion WITHOUT a kcal number (no
 *    universal kcal/g is invented); a zero dose is not an intake; an invalid unit or an unknown label potency is unknown.
 * A modified fasting protocol is decided by the fast reducer, never here.
 */
export function intakeCaloricStatus(e: LogEntry): { status: 'positive' | 'zero' | 'unknown'; energyKcal: number | null } | undefined {
  const kcal = intakeEnergyKcal(e);
  if (kcal !== undefined) return kcal === null || !Number.isFinite(kcal) ? { status: 'unknown', energyKcal: null } : { status: kcal > 0 ? 'positive' : 'zero', energyKcal: kcal };
  if (e.kind === 'substance' && e.substance === 'exogenousKetones') {
    const d = substanceDose(e);
    if (!d) return { status: 'unknown', energyKcal: null };
    return { status: d.value > 0 ? 'positive' : 'zero', energyKcal: d.value > 0 ? null : 0 };
  }
  if (e.kind === 'supplement') {
    // the stored label exposure, else the label arithmetic of the product snapshot (as `supplementExposures` reads it)
    const p = e.product;
    const recorded = p && e.servings !== undefined && p.servingAmount !== null && Number.isFinite(e.servings) ? { amount: e.servings * p.servingAmount, unit: p.servingUnit } : { amount: e.dose, unit: e.unit };
    const exposures = e.exposures && e.exposures.length > 0 ? e.exposures : p ? activeExposureFromServing(recorded, p, { originEventId: e.id }) : [];
    const bhb = exposures.filter((x) => x.id === 'exogenousBhb');
    if (bhb.length === 0) return undefined;
    if (bhb.some((x) => x.value === null || !Number.isFinite(x.value))) return { status: 'unknown', energyKcal: null };
    return bhb.some((x) => (x.value as number) > 0) ? { status: 'positive', energyKcal: null } : { status: 'zero', energyKcal: 0 };
  }
  return undefined;
}

/** Engine drinks from an ethanol dose in g (declared 14 g/drink convention, D5-01). */
export const drinksOfEthanolG = (g: number): number => g / ETHANOL_G_PER_STANDARD_DRINK;

export { MINUTE_MS };
