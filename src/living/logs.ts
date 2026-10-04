/**
 * Daily log reduction (docs/SUITE_SPEC.md §3.4; R11 §1.2, §6.2-6.3): edit/retract resolution (append-only store, latest
 * wins), logging tiers, provenance (user vs AI-estimated, confidence), totals with uncertainty, the burden monitor and the
 * lapse ("welcome back") rule. Pure.
 */
import { addDays, daysBetween } from './dates';
import type { Est, EntrySource, LocalDate, LogEntry, LoggingTier, LogEntrySummary, MeasurementEntry, NutrientEstimate } from './types';

/**
 * Entries still in force. An undo copy supersedes a retract marker, restoring its target's lineage. A conflict choice is a
 * retract that names the version kept (`keep`); two choices that cross (each removes what the other keeps, two devices at
 * once) cancel out, so the conflict shows again instead of the value before both edits (L-REV2 R3-02). A later choice
 * names the crossed choices it saw (`overrides`), which then count for nothing, so the person's next tap settles it.
 */
export function effectiveEntries<E extends { id: string; supersedes?: string; kind?: string; target?: string; keep?: string; overrides?: readonly string[] }>(entries: readonly E[], includeRetracts = false): E[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const overridden = new Set(entries.flatMap((entry) => (entry.kind === 'retract' ? entry.overrides ?? [] : [])));
  const choices = new Set(entries.filter((entry) => entry.kind === 'retract' && entry.target && entry.keep && !overridden.has(entry.id)).map((entry) => `${entry.target} ${entry.keep}`));
  const crossed = (entry: E): boolean => !!entry.keep && choices.has(`${entry.keep} ${entry.target}`);
  const markers = entries.filter((entry) => entry.kind === 'retract' && !overridden.has(entry.id) && !crossed(entry));
  const retracted = new Set(markers.filter((entry) => entry.target).map((entry) => entry.target!));
  const successors = new Map<string, E[]>();
  const markerSuccessors = new Map<string, E[]>();
  const parentOf = (entry: E, seen = new Set<string>()): string | undefined => {
    const parentId = entry.supersedes;
    if (!parentId || seen.has(parentId)) return undefined;
    const parent = byId.get(parentId);
    if (parent?.kind !== 'retract') return parentId;
    seen.add(parentId);
    const restored = parent.target ? byId.get(parent.target) : undefined;
    return restored ? parentOf(restored, seen) : undefined;
  };
  for (const entry of entries) {
    if (entry.kind === 'retract') continue;
    if (entry.supersedes && byId.get(entry.supersedes)?.kind === 'retract')
      markerSuccessors.set(entry.supersedes, [...(markerSuccessors.get(entry.supersedes) ?? []), entry]);
    const parentId = parentOf(entry);
    if (parentId) successors.set(parentId, [...(successors.get(parentId) ?? []), entry]);
  }
  const branchMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const branchSurvives = (entry: E): boolean => {
    const known = branchMemo.get(entry.id);
    if (known !== undefined) return known;
    if (visiting.has(entry.id)) return false;
    visiting.add(entry.id);
    const survives = !retracted.has(entry.id) || (successors.get(entry.id) ?? []).some(branchSurvives);
    visiting.delete(entry.id);
    branchMemo.set(entry.id, survives);
    return survives;
  };
  const live = entries.filter((entry) => entry.kind !== 'retract' && !retracted.has(entry.id) && !(successors.get(entry.id) ?? []).some(branchSurvives));
  return includeRetracts ? [...live, ...markers.filter((entry) => !retracted.has(entry.id) && !markerSuccessors.has(entry.id))] : live;
}

export type ProjectedEntry<E> = E & { conflict?: { parentId: string; versions: E[] } };

/**
 * One visible entry per append-only lineage. Storage still retains every effective fork until a person retracts one. The
 * counted version is one not written by a device if there is one (a corrected value beats a device value), then the
 * latest `at`, then the id.
 */
export function projectEntries<E extends { id: string; at?: string; supersedes?: string; kind?: string; target?: string; keep?: string; source?: { by?: string } }>(entries: readonly E[]): ProjectedEntry<E>[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ancestors = (entry: E): string[] => {
    const path: string[] = [];
    const seen = new Set<string>();
    let next: E | undefined = entry;
    while (next && !seen.has(next.id)) {
      path.push(next.id);
      seen.add(next.id);
      const parentId: string | undefined = next.kind === 'retract' ? next.target : next.supersedes;
      if (parentId && !byId.has(parentId)) path.push(parentId);
      next = parentId ? byId.get(parentId) : undefined;
    }
    return path;
  };
  const groups = new Map<string, E[]>();
  for (const entry of effectiveEntries(entries)) {
    const path = ancestors(entry);
    const root = path[path.length - 1] ?? entry.id;
    const group = groups.get(root) ?? [];
    group.push(entry);
    groups.set(root, group);
  }
  const compare = (a: E, b: E): number => (b.at ?? '').localeCompare(a.at ?? '') || b.id.localeCompare(a.id);
  const byDevice = (e: E): number => (e.source?.by === 'device' ? 1 : 0);
  const projected: ProjectedEntry<E>[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => byDevice(a) - byDevice(b) || compare(a, b));
    const winner = group[0]!;
    if (group.length === 1) {
      projected.push(winner);
      continue;
    }
    const paths = group.map(ancestors);
    const parentId = paths[0]!.find((id) => paths.every((path) => path.includes(id))) ?? paths[0]![paths[0]!.length - 1]!;
    projected.push({ ...winner, conflict: { parentId, versions: group } });
  }
  return projected.sort(compare);
}

export function entriesOn(entries: readonly LogEntry[], date: LocalDate): LogEntry[] {
  return projectEntries(entries).filter((e) => e.date === date);
}

export function measurementsInForce(ms: readonly MeasurementEntry[]): MeasurementEntry[] {
  return projectEntries(ms);
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
  for (const e of projectEntries(entries)) {
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
  for (const e of projectEntries(entries)) {
    if (e.kind !== 'meal' || e.assumed) continue;
    const v = Math.max(0, e.totals.energyKcal.value);
    all += v;
    if (isAiEstimated(e.source)) ai += v;
  }
  return all > 0 ? ai / all : 0;
}

/** Plain summary of an entry for Today and the Coach (no numbers the model computed; the app's totals only). */
function summarisePlain(e: LogEntry): LogEntrySummary {
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

export function summarise(e: ProjectedEntry<LogEntry>): LogEntrySummary {
  const summary = summarisePlain(e);
  return e.conflict
    ? { ...summary, conflict: { parentId: e.conflict.parentId, versions: e.conflict.versions.map(summarisePlain) } }
    : summary;
}

/** Dates (within [from, to]) with at least one T1+ entry that is not assumed. */
export function t1PlusDays(entries: readonly LogEntry[], measurements: readonly MeasurementEntry[], from: LocalDate, to: LocalDate): Set<LocalDate> {
  const out = new Set<LocalDate>();
  for (const e of projectEntries(entries)) {
    if (e.assumed || e.date < from || e.date > to) continue;
    if (tierOfEntry(e) !== 'T0') out.add(e.date);
  }
  for (const m of projectEntries(measurements)) {
    if (m.assumed || m.date < from || m.date > to) continue;
    if (tierOfMeasurement(m) !== 'T0') out.add(m.date);
  }
  return out;
}

/** Dates with any non-assumed log, mark or weigh-in ("days logged"). */
export function loggedDays(entries: readonly LogEntry[], measurements: readonly MeasurementEntry[], markedDates: readonly LocalDate[]): Set<LocalDate> {
  const out = new Set<LocalDate>(markedDates);
  for (const e of projectEntries(entries)) if (!e.assumed) out.add(e.date);
  for (const m of projectEntries(measurements)) if (!m.assumed) out.add(m.date);
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
