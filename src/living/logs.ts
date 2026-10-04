/**
 * Daily log reduction (docs/SUITE_SPEC.md §3.4; R11 §1.2, §6.2-6.3): edit/retract resolution (append-only store, latest
 * wins), logging tiers, provenance (user vs AI-estimated, confidence), totals with uncertainty, the burden monitor and the
 * lapse ("welcome back") rule. Pure.
 */
import { addDays, daysBetween } from './dates';
import type { Est, EntrySource, LocalDate, LogEntry, LoggingTier, LogEntrySummary, MeasurementEntry, NutrientEstimate } from './types';

/** Entries that are still in force: superseded entries and retract targets are hidden; retract markers themselves too.
 * A retracted entry no longer supersedes anything, so retracting an edit (its undo) brings back the entry it replaced. */
export function effectiveEntries<E extends { id: string; supersedes?: string; kind?: string; target?: string }>(entries: readonly E[]): E[] {
  const retracted = new Set<string>();
  for (const e of entries) if (e.kind === 'retract' && e.target) retracted.add(e.target);
  const hidden = new Set<string>(retracted);
  for (const e of entries) if (e.supersedes && !retracted.has(e.id)) hidden.add(e.supersedes);
  return entries.filter((e) => !hidden.has(e.id) && e.kind !== 'retract');
}

export function entriesOn(entries: readonly LogEntry[], date: LocalDate): LogEntry[] {
  return effectiveEntries(entries).filter((e) => e.date === date);
}

export function measurementsInForce(ms: readonly MeasurementEntry[]): MeasurementEntry[] {
  return effectiveEntries(ms);
}

/**
 * Logging tier (R11 §1.2): T0 = marks and weigh-ins (≤ 10 s), T1 = what differed (sessions, fasts, steps, sleep,
 * substances, supplements, events), T2 = meals, T3 = girths, body-fat readings, labs and subjective ratings.
 */
export function tierOfEntry(e: LogEntry): LoggingTier {
  switch (e.kind) {
    case 'meal':
      return 'T2';
    case 'subjective':
      return 'T3';
    case 'note':
    case 'retract':
      return 'T0';
    default:
      return 'T1';
  }
}

export function tierOfMeasurement(m: MeasurementEntry): LoggingTier {
  return m.metric === 'weightKg' ? 'T0' : 'T3';
}

/** Model-estimated entries (text or photo through the AI), as opposed to typed, label, table or device values. */
export function isAiEstimated(s: EntrySource): boolean {
  return s.by === 'ai' || s.method === 'aiText' || s.method === 'aiPhoto' || s.method === 'aiPhotoUserGrams';
}

/** Default SD shares by method when an estimate arrives without one (R11 §6.2): db/label 8 %, AI text 25 %, photo 35 %. */
export function defaultRelSd(s: EntrySource): number {
  switch (s.method) {
    case 'label':
    case 'dbMatch':
    case 'typed':
      return 0.08;
    case 'asPlanned':
      return 0.1;
    case 'aiPhotoUserGrams':
      return 0.2;
    case 'aiText':
      return 0.25;
    case 'aiPhoto':
      return 0.35;
    default:
      return 0.15;
  }
}

const zero = (): Est => ({ value: 0, sd: 0 });

/** Sum of estimates (independent errors: SDs add in quadrature). */
export function addEst(a: Est, b: Est | undefined): Est {
  if (!b) return a;
  return { value: a.value + b.value, sd: Math.sqrt(a.sd * a.sd + b.sd * b.sd) };
}

/** Day totals of the logged meals (assumed entries included only when `includeAssumed`). */
export function mealTotals(entries: readonly LogEntry[], includeAssumed = true): { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG: Est; alcoholG: Est } {
  const t = { energyKcal: zero(), proteinG: zero(), carbG: zero(), fatG: zero(), fibreG: zero(), alcoholG: zero() };
  for (const e of entries) {
    if (e.kind !== 'meal' || (!includeAssumed && e.assumed)) continue;
    const n: NutrientEstimate = e.totals;
    t.energyKcal = addEst(t.energyKcal, n.energyKcal);
    t.proteinG = addEst(t.proteinG, n.proteinG);
    t.carbG = addEst(t.carbG, n.carbG);
    t.fatG = addEst(t.fatG, n.fatG);
    t.fibreG = addEst(t.fibreG, n.fibreG);
    t.alcoholG = addEst(t.alcoholG, n.alcoholG);
  }
  return t;
}

/** Share of the logged meal energy that was AI-estimated (trust ledger; widens the δ prior above 70 %). */
export function aiEnergyShare(entries: readonly LogEntry[]): number {
  let ai = 0;
  let all = 0;
  for (const e of entries) {
    if (e.kind !== 'meal' || e.assumed) continue;
    const v = Math.max(0, e.totals.energyKcal.value);
    all += v;
    if (isAiEstimated(e.source)) ai += v;
  }
  return all > 0 ? ai / all : 0;
}

/** Plain summary of an entry for Today and the Coach (no numbers the model computed; the app's totals only). */
export function summarise(e: LogEntry): LogEntrySummary {
  const base = { id: e.id, kind: e.kind, ...(e.at ? { at: e.at } : {}), source: e.source.by, aiEstimated: isAiEstimated(e.source), ...(e.confidence !== undefined ? { confidence: e.confidence } : {}) };
  switch (e.kind) {
    case 'meal':
      return { ...base, clockH: e.clockH, label: e.components.map((c) => c.name).join(', ') || (e.slot ?? 'meal'), energyKcal: e.totals.energyKcal };
    case 'session':
      return { ...base, ...(e.startH !== undefined ? { clockH: e.startH } : {}), label: `session ${e.status}` };
    case 'fast':
      return { ...base, label: e.broken ? 'fast broken' : e.firstIntakeAt ? 'fast done' : 'fast running' };
    case 'steps':
      return { ...base, label: `${Math.round(e.steps)} steps` };
    case 'sleep':
      return { ...base, label: 'sleep' };
    case 'substance':
      return { ...base, clockH: e.clockH, label: e.substance };
    case 'supplement':
      return { ...base, ...(e.clockH !== undefined ? { clockH: e.clockH } : {}), label: e.supplementId };
    case 'subjective':
      return { ...base, label: 'how the day felt' };
    case 'event':
      return { ...base, label: e.event };
    default:
      return { ...base, label: e.kind };
  }
}

/** Dates (within [from, to]) with at least one T1+ entry that is not assumed. */
export function t1PlusDays(entries: readonly LogEntry[], measurements: readonly MeasurementEntry[], from: LocalDate, to: LocalDate): Set<LocalDate> {
  const out = new Set<LocalDate>();
  for (const e of effectiveEntries(entries)) {
    if (e.assumed || e.date < from || e.date > to) continue;
    if (tierOfEntry(e) !== 'T0') out.add(e.date);
  }
  for (const m of effectiveEntries(measurements)) {
    if (m.assumed || m.date < from || m.date > to) continue;
    if (tierOfMeasurement(m) !== 'T0') out.add(m.date);
  }
  return out;
}

/** Dates with any non-assumed log, mark or weigh-in ("days logged"). */
export function loggedDays(entries: readonly LogEntry[], measurements: readonly MeasurementEntry[], markedDates: readonly LocalDate[]): Set<LocalDate> {
  const out = new Set<LocalDate>(markedDates);
  for (const e of effectiveEntries(entries)) if (!e.assumed) out.add(e.date);
  for (const m of effectiveEntries(measurements)) if (!m.assumed) out.add(m.date);
  return out;
}

/**
 * Burden monitor (§3.4): T1+ logging on fewer than 3 days in 7 for two consecutive weeks → minimal mode (T0 only); the
 * Coach says the plan still works with weigh-ins and taps, at most one prompt a week.
 */
export function burdenMonitor(entries: readonly LogEntry[], measurements: readonly MeasurementEntry[], today: LocalDate, planStart: LocalDate): { minimalMode: boolean; week1: number; week2: number } {
  const w1 = t1PlusDays(entries, measurements, addDays(today, -7), addDays(today, -1)).size;
  const w2 = t1PlusDays(entries, measurements, addDays(today, -14), addDays(today, -8)).size;
  const enoughHistory = daysBetween(planStart, today) >= 14;
  return { minimalMode: enoughHistory && w1 < 3 && w2 < 3, week1: w1, week2: w2 };
}

/**
 * Lapse rule (§3.4): the first open after ≥ 2 missed days says "Welcome back, nothing to catch up on" and offers a one-tap
 * "as planned" backfill of the gap (`assumed: true`, excluded from scoring and estimation).
 */
export function lapseState(lastLogged: LocalDate | null, today: LocalDate, planStart: LocalDate): { welcomeBack: boolean; gap: LocalDate[] } {
  const from = lastLogged ?? addDays(planStart, -1);
  const missed = daysBetween(from, today) - 1;
  if (missed < 2) return { welcomeBack: false, gap: [] };
  const gap: LocalDate[] = [];
  for (let k = 1; k <= missed; k++) {
    const d = addDays(from, k);
    if (d >= planStart) gap.push(d);
  }
  return { welcomeBack: gap.length >= 2, gap };
}
