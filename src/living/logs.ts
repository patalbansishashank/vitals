/**
 * Daily log reduction (docs/SUITE_SPEC.md §3.4; R11 §1.2, §6.2-6.3): edit/retract resolution (append-only store, latest
 * wins), logging tiers, provenance (user vs AI-estimated, confidence), totals with uncertainty, the burden monitor and the
 * lapse ("welcome back") rule. Pure.
 */
import { bandMetaFor, type BandMeta } from '@/lib/bodyContracts';
import { addDays, daysBetween } from './dates';
import { GAUGE_APP, type AmountMethod, type Est, type EntrySource, type LocalDate, type LogEntry, type LoggingTier, type LogEntrySummary, type MealComponent, type MeasurementEntry, type NutrientEstimate } from './types';

/**
 * One record per id (C2/C7: a document seen twice — a sync echo, a repeated import, a reload merged with a cache — is one
 * observation, never a conflict or a double count). Copies of one id are the same record; should two ever differ, the
 * choice depends only on their content, never on the order they arrive in.
 */
export function uniqueById<E extends { id: string }>(entries: readonly E[]): readonly E[] {
  const byId = new Map<string, E>();
  let duplicate = false;
  for (const e of entries) {
    const cur = byId.get(e.id);
    if (cur === undefined) {
      byId.set(e.id, e);
      continue;
    }
    duplicate = true;
    if (cur !== e && JSON.stringify(e) > JSON.stringify(cur)) byId.set(e.id, e);
  }
  if (!duplicate) return entries;
  const out: E[] = [];
  const emitted = new Set<string>();
  for (const e of entries) {
    if (emitted.has(e.id)) continue;
    emitted.add(e.id);
    out.push(byId.get(e.id)!);
  }
  return out;
}

/**
 * Entries still in force. An undo copy supersedes a retract marker, restoring its target's lineage. A conflict choice is a
 * retract that names the version kept (`keep`); two choices that cross (each removes what the other keeps, two devices at
 * once) cancel out, so the conflict shows again instead of the value before both edits (L-REV2 R3-02). A later choice
 * names the crossed choices it saw (`overrides`), which then count for nothing, so the person's next tap settles it.
 * (r069) A marker with `lineage` retracts its target and every earlier version of it (retracting only the newest version
 * of an edited entry brings the one before it back).
 */
export function effectiveEntries<E extends { id: string; supersedes?: string; kind?: string; target?: string; keep?: string; overrides?: readonly string[]; lineage?: boolean }>(input: readonly E[], includeRetracts = false): E[] {
  const entries = uniqueById(input);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const overridden = new Set(entries.flatMap((entry) => (entry.kind === 'retract' ? entry.overrides ?? [] : [])));
  const choices = new Set(entries.filter((entry) => entry.kind === 'retract' && entry.target && entry.keep && !overridden.has(entry.id)).map((entry) => `${entry.target} ${entry.keep}`));
  const crossed = (entry: E): boolean => !!entry.keep && choices.has(`${entry.keep} ${entry.target}`);
  const markers = entries.filter((entry) => entry.kind === 'retract' && !overridden.has(entry.id) && !crossed(entry));
  const retracted = new Set(markers.filter((entry) => entry.target).map((entry) => entry.target!));
  // (r069) the earlier versions of a lineage marker's target (through undone markers to the version they restored)
  for (const marker of markers) {
    if (!marker.lineage || !marker.target) continue;
    const seen = new Set<string>([marker.target]);
    let cur = byId.get(marker.target);
    while (cur?.supersedes && !seen.has(cur.supersedes)) {
      seen.add(cur.supersedes);
      let parent = byId.get(cur.supersedes);
      if (parent?.kind === 'retract') parent = parent.target ? byId.get(parent.target) : undefined;
      if (!parent || parent.kind === 'retract') break;
      retracted.add(parent.id);
      cur = parent;
    }
  }
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

type SourceLike = { by?: string; app?: string; deviceKey?: string };

/** (S1 import) An entry the Gauge import wrote from the person's ring (`source.app === 'gauge'`). */
export function isGaugeEntry(e: { source?: SourceLike }): boolean {
  return e.source?.app === GAUGE_APP;
}

/**
 * (S1 import) The person's own entry wins over the ring's: a steps entry not from Gauge hides the Gauge steps of the same
 * day, and a main-sleep entry not from Gauge (anything but a nap) hides the Gauge sleep of the same wake date. The Gauge
 * entry stays stored (the import never writes over the person's entry, nor the person's over the import); it only stops
 * counting. Other kinds and entries without a date pass unchanged.
 */
export function withManualPrecedence<E extends { kind?: string; date?: string; source?: SourceLike; episodeKind?: string }>(entries: readonly E[]): E[] {
  if (!entries.some((e) => isGaugeEntry(e) && (e.kind === 'steps' || e.kind === 'sleep'))) return [...entries];
  const manual = new Set<string>();
  for (const e of entries) {
    if (isGaugeEntry(e) || !e.date) continue;
    if (e.kind === 'steps') manual.add(`steps ${e.date}`);
    else if (e.kind === 'sleep' && e.episodeKind !== 'nap') manual.add(`sleep ${e.date}`);
  }
  return entries.filter((e) => !(isGaugeEntry(e) && (e.kind === 'steps' || e.kind === 'sleep') && manual.has(`${e.kind} ${e.date}`)));
}

/**
 * One visible entry per append-only lineage. Storage still retains every effective fork until a person retracts one. The
 * counted version is one not written by a device if there is one (a corrected value beats a device value), then the
 * latest `at`, then the id.
 */
export function projectEntries<E extends { id: string; at?: string; recordedAt?: string; supersedes?: string; kind?: string; target?: string; keep?: string; date?: string; source?: SourceLike }>(entries: readonly E[]): ProjectedEntry<E>[] {
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
    // (S1 import) two devices updating the same ring reading fork its lineage: the newest reading counts, with no
    // conflict to settle (both forks came from the same server, not from a person)
    const key = winner.source?.deviceKey;
    if (key && group.every((e) => isGaugeEntry(e) && e.source?.deviceKey === key)) {
      const newest = (e: E) => e.recordedAt ?? e.at ?? '';
      projected.push([...group].sort((a, b) => newest(b).localeCompare(newest(a)) || b.id.localeCompare(a.id))[0]!);
      continue;
    }
    const paths = group.map(ancestors);
    const parentId = paths[0]!.find((id) => paths.every((path) => path.includes(id))) ?? paths[0]![paths[0]!.length - 1]!;
    projected.push({ ...winner, conflict: { parentId, versions: group } });
  }
  return withManualPrecedence(projected).sort(compare);
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
    // a step correction says which source counts; it is no logged behaviour of its own
    case 'note':
    case 'retract':
    case 'stepsCorrection':
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

/**
 * Display spread shares by entry method when an estimate arrives without one (R11 §6.2): db/label/typed 8 %, AI text 25 %,
 * photo 35 %. (D6-06) These are uncalibrated display defaults (`LOG_BAND_META`), not validated SDs and not P10/P90
 * predictive coverage; typed numbers are not thereby weighed (the amount method is `amountMethodOf`).
 */
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

/**
 * (D6-06/C6) What the per-entry spreads are: fixed display fallbacks (heuristic, coverage unvalidated), never a calibrated
 * predictive interval. Versioned with the uncertainty contract so a later calibrated model is told apart.
 */
export const LOG_BAND_META: Readonly<BandMeta> = bandMetaFor('fallback', 0);

/**
 * (D6-06) How a component's amount was obtained, independent of its numeric grams: the stored method, else 'unknown'
 * (a legacy number is never assumed weighed).
 */
export function amountMethodOf(c: Pick<MealComponent, 'amountMethod'>): AmountMethod {
  return c.amountMethod ?? 'unknown';
}

const zero = (): Est => ({ value: 0, sd: 0 });

/** Sum of estimates (independent errors: SDs add in quadrature). */
export function addEst(a: Est, b: Est | undefined): Est {
  if (!b) return a;
  return { value: a.value + b.value, sd: Math.sqrt(a.sd * a.sd + b.sd * b.sd) };
}

/**
 * Shared-error key of a meal entry (C3/D6-06): the source-composition / recipe-yield groups of its components (a food or
 * recipe record version shared across entries), else the entry itself. Entries with the same key share one systematic
 * error, so their spreads add linearly instead of shrinking like independent noise.
 */
function sharedErrorKey(e: Extract<LogEntry, { kind: 'meal' }>): string {
  const shared = (e.components ?? [])
    .flatMap((c) => c.uncertaintyGroupIds ?? [])
    .filter((g) => g.startsWith('batchYield:') || (g.startsWith('sourceComposition:') && !g.includes(`:${e.id}:`)))
    .sort();
  return shared.length > 0 ? shared.join('|') : `entry:${e.id}`;
}

/**
 * Day totals of the logged meals (assumed entries included only when `includeAssumed`). Values add; spreads add linearly
 * inside a shared-error group (repeated logs of one recipe or food record keep their common systematic error) and in
 * quadrature across groups (D6-06). The spreads are the display fallbacks of `LOG_BAND_META`, not calibrated SDs.
 */
export function mealTotals(entries: readonly LogEntry[], includeAssumed = true): { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG: Est; alcoholG: Est } {
  type Key = 'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG' | 'alcoholG';
  const keys: readonly Key[] = ['energyKcal', 'proteinG', 'carbG', 'fatG', 'fibreG', 'alcoholG'];
  const groups = new Map<string, Record<Key, Est>>();
  for (const e of projectEntries(entries)) {
    if (e.kind !== 'meal' || (!includeAssumed && e.assumed)) continue;
    const n: NutrientEstimate = e.totals;
    const k = sharedErrorKey(e);
    const g = groups.get(k) ?? { energyKcal: zero(), proteinG: zero(), carbG: zero(), fatG: zero(), fibreG: zero(), alcoholG: zero() };
    for (const f of keys) {
      const v = n[f];
      if (v) g[f] = { value: g[f].value + v.value, sd: g[f].sd + Math.abs(v.sd) };
    }
    groups.set(k, g);
  }
  const t = { energyKcal: zero(), proteinG: zero(), carbG: zero(), fatG: zero(), fibreG: zero(), alcoholG: zero() };
  for (const k of [...groups.keys()].sort()) {
    const g = groups.get(k)!;
    for (const f of keys) t[f] = addEst(t[f], g[f]);
  }
  return t;
}

/**
 * Share of the logged meal energy that was AI-estimated (trust ledger, for display only). (D5-04) It no longer widens the
 * δ prior or changes any weight: a source label alone is not a quantitative error model.
 */
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

/** "7 h 15" (whole minutes; "45 min" under an hour). */
function hoursText(h: number): string {
  const min = Math.round(h * 60);
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return hh === 0 ? `${mm} min` : mm === 0 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')}`;
}

/** Plain summary of an entry for Today and the Coach (no numbers the model computed; the app's totals only). */
function summarisePlain(e: LogEntry): LogEntrySummary {
  const gauge = isGaugeEntry(e);
  const base = { id: e.id, kind: e.kind, ...(e.at ? { at: e.at } : {}), source: e.source.by, ...(gauge ? { app: GAUGE_APP } : {}), aiEstimated: isAiEstimated(e.source), ...(e.confidence !== undefined ? { confidence: e.confidence } : {}) };
  const ring = gauge ? ' · ring' : '';
  switch (e.kind) {
    case 'meal':
      return { ...base, clockH: e.clockH, ...(e.slot ? { slot: e.slot } : {}), label: e.components.map((c) => c.name).join(', ') || (e.slot ?? 'meal'), energyKcal: e.totals.energyKcal };
    case 'session':
      return { ...base, ...(e.startH !== undefined ? { clockH: e.startH } : {}), label: `session ${e.status}` };
    case 'fast':
      return { ...base, label: e.broken ? 'fast broken' : e.firstIntakeAt ? 'fast done' : 'fast running' };
    case 'steps':
      return { ...base, label: `${Math.round(e.steps)} steps${ring}` };
    case 'sleep': {
      // (D8-06) the logged duration as entered (never a modelled sleep score); quality only when the person rated it
      // (S1 import) a ring night shows the minutes the ring scored as asleep, not the time in bed
      const h = e.asleepMin !== undefined && Number.isFinite(e.asleepMin) && e.asleepMin > 0 ? e.asleepMin / 60 : (Date.parse(e.wakeAt) - Date.parse(e.bedAt)) / 3_600_000;
      const dur = Number.isFinite(h) && h > 0 ? ` ${hoursText(h)}` : '';
      return { ...base, label: `${e.episodeKind === 'nap' ? 'nap' : 'sleep'}${dur}${e.quality ? ` · ${e.quality}` : ''}${ring}` };
    }
    case 'substance':
      return { ...base, clockH: e.clockH, label: e.substance };
    case 'supplement': {
      // (D7-04) an unknown label potency is a valid log whose active dose is unknown (never zero, never "no issues")
      const unknownDose = (e.exposures ?? []).some((x) => x.value === null);
      return { ...base, ...(e.clockH !== undefined ? { clockH: e.clockH } : {}), label: `${e.supplementId}${unknownDose ? ' · dose unknown' : ''}` };
    }
    case 'subjective':
      return { ...base, label: 'how the day felt' };
    case 'event':
      return { ...base, label: e.event };
    case 'stepsCorrection':
      return { ...base, label: `steps from the ${e.use === 'ring' ? 'ring' : e.use === 'phone' ? 'phone' : 'other app'}` };
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
