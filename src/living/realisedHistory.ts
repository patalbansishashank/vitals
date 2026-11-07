/**
 * The one realised history (C2; D5-05, D5-01, D2-01): a pure reducer from the plan's immutable documents to every elapsed
 * plan day — canonical events with identities, per-channel coverage, observed and separately imputed inputs, explicit
 * assumptions, fasts resolved in absolute time, uncertainty groups — and a stable content hash. Assimilation, the weekly
 * check-in, re-planning and the current-day views read the same object from the same anchor (the plan start), so they
 * replay the same past.
 *
 * Elapsed history is [plan start, today): its observation horizon `asOf` is the start of today's app day, so the hash only
 * changes when a past record changes. Today ("so far") is projected with the same day function, the current instant and the
 * same fast resolution, but is not part of the elapsed history. Historical inputs of unknown days come from the prescription
 * frozen for that day (the version in force then), never the current head; calibration filters evidence, it never removes a
 * day's exposure from physiology.
 */
import type { CompiledSchedule, FastEvent } from '@/engine';
import { ENGINE_VERSION } from '@/engine/core/defaults';
import {
  CONTRACT_FINGERPRINT,
  CONTRACT_VERSIONS,
  contentHash,
  realisedHistoryHash,
  type CanonicalEvent,
  type CanonicalEventKind,
  type HistoryAnchor,
  type HistoryAssumption,
  type RealisedDay,
  type RealisedHistory,
  type ReduceRealisedHistory,
  type UncertaintyGroup,
} from '@/lib/bodyContracts';
import { expectedCreditFor, revealedAdherence, type CreditObservation } from './adherence';
import { appDay, DEFAULT_ROLLOVER_H } from './appDay';
import { headAdopted, pausedDaySet, planDay, versionInForce } from './calendar';
import { addDays, compareDates, localToInstant, minDate, weekdayOf } from './dates';
import { catalogueEquivalence, type EquivalenceFn } from './equivalence';
import { fastEventsFor, resolveFasts, type PrescribedFastDay, type ResolvedFast } from './fastIntervals';
import { toLoggedDay, type LoggedDayResult, type SessionCompiler } from './loggedDay';
import { projectEntries } from './logs';
import { entryOccurrence, entryProvenance, intakeEnergyKcal, measurementOccurrence } from './occurrence';
import { compileVersion, freezePrescription, withUsualSessions } from './prescription';
import type { DayStatusDoc, Instant, LocalDate, LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from './types';

/** Version of this reducer's semantics (C7: part of every derived hash; a change invalidates derived caches). */
export const REALISED_HISTORY_REDUCER_VERSION = 2;

export interface ProjectedDay {
  date: LocalDate;
  planDay: number;
  prescription: PrescribedDaySnapshot;
  /** True when the prescription came from `dayStatus.prescribed` (frozen at rollover). */
  frozen: boolean;
  result: LoggedDayResult;
}

export interface LivingHistoryInput {
  plan: PlanDoc & { id: string };
  /** The plan's versions (any order). */
  versions: readonly PlanVersionDoc[];
  dayStatus: readonly DayStatusDoc[];
  /** Effective (projected) entries, any dates. */
  entries: readonly LogEntry[];
  /** The raw append-only entries behind `entries` (lineage of canonical events); default `entries`. */
  rawEntries?: readonly LogEntry[];
  /** Effective measurements (events of the history; assimilation reads them separately). */
  measurements?: readonly MeasurementEntry[];
  today: LocalDate;
  tz: string;
  /** Current instant (today's running fasts are censored here). */
  now: Instant;
  rolloverH?: number;
  equivalence?: EquivalenceFn;
  sessionCompiler?: SessionCompiler;
  /** Memoised compiled schedule of a version (the caller's cache). */
  compiledOf?: (v: PlanVersionDoc) => CompiledSchedule;
}

export interface LivingHistory {
  /** Every plan day up to today (today "so far" last when inside the plan). */
  days: ProjectedDay[];
  /** Credit observations of final, non-backfilled days (revealed adherence). */
  credits: CreditObservation[];
  /** Fasts of the elapsed history (asOf = start of today's app day). */
  fasts: ResolvedFast[];
  /** Engine fast events of the elapsed history (start day before today). */
  fastEvents: FastEvent[];
  /** The C2 object: elapsed days, events, fasts, assumptions, uncertainty groups and the content hash. */
  history: RealisedHistory;
}

const KIND_OF: Partial<Record<LogEntry['kind'], CanonicalEventKind>> = {
  meal: 'meal',
  session: 'session',
  fast: 'fast',
  steps: 'steps',
  sleep: 'sleep',
  substance: 'substance',
  supplement: 'supplement',
  subjective: 'subjective',
  event: 'event',
};

/** The start of an app day as an instant (the elapsed history's observation horizon). */
export function appDayStartInstant(date: LocalDate, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H): Instant {
  return localToInstant(date, rolloverH, tz);
}

/**
 * The shared anchor of a plan's history: the plan start and its baseline profile (every replay starts there). The state
 * hash also binds the engine version and the contract fingerprint (C7): a semantics change gives a new history hash.
 */
export function historyAnchorOf(plan: PlanDoc & { id: string }, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H): HistoryAnchor {
  const profileHash = contentHash(plan.baselineProfile);
  const stateHash = contentHash({ profile: profileHash, engine: ENGINE_VERSION, contracts: CONTRACT_FINGERPRINT });
  return { planId: plan.id, anchorDate: plan.startDate, anchorDay: 0, stateHash, profileHash, rolloverH, rolloverVersion: 1, tz };
}

/** Lineage ids of an effective entry (itself and every record it supersedes), oldest last. */
function lineage(e: LogEntry, byId: ReadonlyMap<string, LogEntry>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: LogEntry | undefined = e;
  while (cur && !seen.has(cur.id)) {
    out.push(cur.id);
    seen.add(cur.id);
    const parent: string | undefined = cur.kind === 'retract' ? cur.target : cur.supersedes;
    cur = parent ? byId.get(parent) : undefined;
  }
  return out;
}

/** Canonical events (C2) of effective entries and measurements before `before` (an app date; exclusive). */
function canonicalEvents(i: { all: readonly LogEntry[]; measurements: readonly MeasurementEntry[]; tz: string; rolloverH: number; before: LocalDate }): { events: CanonicalEvent[]; groups: UncertaintyGroup[] } {
  const byId = new Map(i.all.map((e) => [e.id, e] as const));
  const events: CanonicalEvent[] = [];
  const groups: UncertaintyGroup[] = [];
  for (const e of projectEntries(i.all)) {
    const kind = KIND_OF[e.kind];
    if (!kind || compareDates(e.date, i.before) >= 0) continue;
    const energy = intakeEnergyKcal(e);
    const link = e.link ?? (e.itemId && e.planId ? { planId: e.planId, version: 0, itemId: e.itemId } : undefined);
    events.push({
      id: e.id,
      kind,
      sourceIds: lineage(e, byId),
      occurrence: entryOccurrence(e, { tz: i.tz, rolloverH: i.rolloverH }),
      ...(e.recordedAt || e.at ? { recordedAt: e.recordedAt ?? e.at! } : {}),
      provenance: entryProvenance(e),
      ...(link && e.extra !== true ? { replaces: link } : {}),
      ...(e.extra ? { extra: true } : {}),
      ...(e.conflict ? { alternativeGroup: `alt:${e.conflict.parentId}` } : {}),
      ...(energy !== undefined ? { energyKcal: energy } : {}),
    });
    if (e.conflict) groups.push({ id: `alt:${e.conflict.parentId}`, kind: 'identityAmbiguity', memberIds: e.conflict.versions.map((v) => v.id), candidates: e.conflict.versions.map((v) => v.id) });
  }
  for (const m of projectEntries(i.measurements)) {
    if (m.assumed || compareDates(m.date, i.before) >= 0) continue;
    events.push({ id: m.id, kind: 'measurement', sourceIds: [m.id], occurrence: measurementOccurrence(m), ...(m.recordedAt || m.at ? { recordedAt: m.recordedAt ?? m.at! } : {}), provenance: m.source.by === 'device' ? 'measured' : 'reported' });
  }
  events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  groups.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { events, groups };
}

/**
 * Project every plan day up to today and reduce the elapsed days to the realised history. Pure and deterministic for the
 * same documents, `today`, `now` and zone.
 */
export function realiseLivingHistory(i: LivingHistoryInput): LivingHistory {
  const { plan, today, tz } = i;
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const eq = i.equivalence ?? catalogueEquivalence;
  const versions = i.versions.filter((v) => v.planId === plan.id);
  const head = headAdopted(versions);
  const statusByDate = new Map(i.dayStatus.map((s) => [s.date, s] as const));
  const entries = i.entries;
  const entriesOn = new Map<LocalDate, LogEntry[]>();
  for (const e of entries) entriesOn.set(e.date, [...(entriesOn.get(e.date) ?? []), e]);
  const memo = new Map<number, CompiledSchedule>();
  const compiledOf = i.compiledOf ?? ((v: PlanVersionDoc): CompiledSchedule => {
    let c = memo.get(v.version);
    if (!c) {
      c = compileVersion(plan.baselineProfile, v.schedule);
      memo.set(v.version, c);
    }
    return c;
  });

  // ---- prescriptions of every plan day up to today (frozen ones from dayStatus, else frozen now with the version in force)
  const lastDay = minDate(today, addDays(plan.plannedEndDate, -1));
  const paused = pausedDaySet(plan, addDays(today, 1));
  const dayRows: PrescribedFastDay[] = [];
  const frozenFlags = new Map<LocalDate, boolean>();
  const inForce = new Map<LocalDate, PlanVersionDoc>();
  if (head) {
    for (let date = plan.startDate; compareDates(date, lastDay) <= 0; date = addDays(date, 1)) {
      const d = planDay(plan, date);
      const status = statusByDate.get(date) ?? null;
      const v = versionInForce(versions, d) ?? head;
      inForce.set(date, v);
      const frozen = status?.prescribed !== undefined && status.prescribed.planId === plan.id;
      const freezeWith = (fv: PlanVersionDoc) => () => freezePrescription({ plan, version: fv, date, tz, compiled: compiledOf(fv), ...(paused.has(d) ? { paused: true } : {}) });
      // a day frozen before usual sessions were prescribed gets them re-derived from its own version (never written back)
      const prescription = frozen
        ? withUsualSessions(status!.prescribed!, plan.baselineProfile, date, freezeWith(versions.find((x) => x.version === status!.prescribed!.version) ?? v))
        : freezeWith(v)();
      dayRows.push({ date, planDay: d, prescription, status });
      frozenFlags.set(date, frozen);
    }
  }

  // ---- fasts in absolute time: current (asOf = now, today's credits) and elapsed (asOf = start of today)
  const fastsNow = resolveFasts({ planStart: plan.startDate, tz, rolloverH, asOf: i.now, entries, days: dayRows });
  const elapsedAsOf = appDayStartInstant(today, tz, rolloverH);
  const elapsedEntries = entries.filter((e) => compareDates(e.date, today) < 0);
  const elapsedRows = dayRows.filter((r) => compareDates(r.date, today) < 0);
  const fastsElapsed = resolveFasts({ planStart: plan.startDate, tz, rolloverH, asOf: elapsedAsOf, entries: elapsedEntries, days: elapsedRows });

  // ---- the day function over every day (revealed adherence from the days before each)
  const days: ProjectedDay[] = [];
  const credits: CreditObservation[] = [];
  const expectedFastOn = new Map<LocalDate, number>();
  for (const row of dayRows) {
    const { date, planDay: d, prescription, status } = row;
    const v = inForce.get(date)!;
    const blocks = revealedAdherence(credits, addDays(date, -1));
    expectedFastOn.set(date, expectedCreditFor(blocks, 'fast', weekdayOf(date)));
    const isPast = compareDates(date, today) < 0;
    const result = toLoggedDay({
      date,
      planStart: plan.startDate,
      tz,
      prescription,
      entries: entriesOn.get(date) ?? [],
      status,
      expected: (t, wd) => expectedCreditFor(blocks, t, wd),
      equivalence: eq,
      intentByItem: v.sensitivities.intentByItem,
      ...(i.sessionCompiler ? { sessionCompiler: i.sessionCompiler } : {}),
      final: isPast || status?.confirmedAt !== undefined,
      fasts: isPast ? fastsElapsed : fastsNow,
      rolloverH,
    });
    days.push({ date, planDay: d, prescription, frozen: frozenFlags.get(date) ?? false, result });
    if (result.score.final && !result.assumedDay) for (const o of result.loggedDay.items) if (o.credit !== null) credits.push({ date, type: o.type, credit: o.credit });
  }
  const todayIdx = planDay(plan, today);
  const fastEvents = fastEventsFor(fastsElapsed, (date) => expectedFastOn.get(date) ?? 0).filter((e) => e.startDay < todayIdx);

  // ---- the C2 object over the elapsed days
  const anchor = historyAnchorOf(plan, tz, rolloverH);
  const { events, groups } = canonicalEvents({ all: i.rawEntries ?? i.entries, measurements: i.measurements ?? [], tz, rolloverH, before: today });
  const assumptions: HistoryAssumption[] = [];
  const realisedDays: RealisedDay[] = [];
  for (const day of days) {
    if (compareDates(day.date, today) >= 0) continue;
    const r = day.result;
    const ids: string[] = [];
    for (const a of r.assumptions) {
      const id = `${day.date}:${a.kind}:${a.reasonCode}`;
      ids.push(id);
      assumptions.push({ id, kind: a.kind, dates: [day.date], prescription: { planId: day.prescription.planId, version: day.prescription.version }, reasonCode: a.reasonCode });
    }
    for (const alt of r.alternatives) groups.push({ id: alt.id, kind: 'identityAmbiguity', memberIds: alt.memberIds, candidates: alt.candidates });
    // D6-06: the day's shared-error groups, merged by id (members unioned) across days
    for (const g of r.uncertaintyGroups) mergeGroup(groups, g);
    realisedDays.push({
      date: day.date,
      planDay: day.planDay,
      coverage: r.coverage,
      ...(statusByDate.get(day.date)?.intake ? { attestation: statusByDate.get(day.date)!.intake! } : {}),
      observedEventIds: (entriesOn.get(day.date) ?? []).filter((e) => !e.assumed && KIND_OF[e.kind]).map((e) => e.id).sort(),
      remainders: r.remainders,
      assumptionIds: ids,
      resolution: r.resolution,
      prescription: { planId: day.prescription.planId, version: day.prescription.version },
    });
  }
  for (const rf of fastsElapsed) {
    if (rf.assumption) assumptions.push({ id: `${rf.interval.id}:${rf.assumption}`, kind: rf.assumption, dates: [], reasonCode: `fast:${rf.basis}` });
  }
  const sensors = sensorLineageOf(entries, today);
  const body: Omit<RealisedHistory, 'contentHash'> & { sensors?: SensorLineage } = {
    kind: 'vitals.realisedHistory',
    contractVersion: CONTRACT_VERSIONS.realisedHistory,
    reducerVersion: REALISED_HISTORY_REDUCER_VERSION,
    anchor,
    asOf: elapsedAsOf,
    days: realisedDays,
    events,
    fasts: fastsElapsed.map((rf) => rf.interval),
    assumptions,
    uncertaintyGroups: groups,
    ...(sensors ? { sensors } : {}),
  };
  const history: RealisedHistory = { ...body, contentHash: realisedHistoryHash(body) };
  return { days, credits, fasts: fastsElapsed, fastEvents, history };
}

/**
 * (energy SPEC §V3.8) What the sensor-derived inputs of the elapsed history were made with: the step fusion version, the
 * estimator versions of approved bouts and each approved entry's candidate `decidedRevision`. Part of the content hash, so
 * a re-fused day, a new estimator or a late edit, rejection or deletion of an approved activity changes the hash from the
 * earliest changed day (the event ids already move with the entries; these pin the derivations behind them). Absent when
 * no elapsed entry came from a sensor derivation, so older histories keep their hash.
 */
export interface SensorLineage {
  fusionVersions: string[];
  estimatorVersions: string[];
  decisions: Array<{ date: LocalDate; entryId: string; candidateKey: string; decidedRevision: string }>;
}

export function sensorLineageOf(entries: readonly LogEntry[], before: LocalDate): SensorLineage | null {
  const fusion = new Set<string>();
  const estimators = new Set<string>();
  const decisions: SensorLineage['decisions'] = [];
  for (const e of entries) {
    if (compareDates(e.date, before) >= 0) continue;
    if (e.kind === 'steps' && e.fusion) fusion.add(e.fusion.version);
    if (e.kind === 'session' && e.candidate) {
      estimators.add(e.candidate.estimatorVersion);
      decisions.push({ date: e.date, entryId: e.id, candidateKey: e.candidate.key, decidedRevision: e.candidate.decidedRevision });
    }
  }
  if (fusion.size === 0 && estimators.size === 0 && decisions.length === 0) return null;
  decisions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
  return { fusionVersions: [...fusion].sort(), estimatorVersions: [...estimators].sort(), decisions };
}

/** Adds a shared-error group, or unions its members into the group with the same id. */
function mergeGroup(groups: UncertaintyGroup[], g: UncertaintyGroup): void {
  const i = groups.findIndex((x) => x.id === g.id);
  if (i < 0) {
    groups.push({ ...g, memberIds: [...g.memberIds] });
    return;
  }
  const prev = groups[i]!;
  groups[i] = { ...prev, memberIds: [...new Set([...prev.memberIds, ...g.memberIds])].sort() };
}

/** Documents the reducer reads (C2 `ReduceRealisedHistory`). */
export type HistoryDocument =
  | { kind: 'plan'; plan: PlanDoc & { id: string } }
  | { kind: 'version'; version: PlanVersionDoc }
  | { kind: 'dayStatus'; status: DayStatusDoc }
  | { kind: 'entry'; entry: LogEntry }
  | { kind: 'measurement'; measurement: MeasurementEntry };

/**
 * The one reducer (C2): `reduceRealisedHistory(anchor, documents, asOf, contractVersion)`. `asOf` is the current instant
 * (today's app day comes from it with the anchor's zone and rollover); the result's own `asOf` is the start of that day.
 * Raw entries are projected here (edits, retractions, conflicts); an unknown contract version is recorded as given.
 */
export const reduceRealisedHistory: ReduceRealisedHistory<HistoryDocument> = (anchor, documents, asOf, contractVersion) => {
  const plan = documents.find((d): d is Extract<HistoryDocument, { kind: 'plan' }> => d.kind === 'plan' && (anchor.planId === undefined || d.plan.id === anchor.planId))?.plan;
  const tz = anchor.tz ?? 'UTC';
  const rolloverH = anchor.rolloverH ?? DEFAULT_ROLLOVER_H;
  const today = appDay(Date.parse(asOf), { tz, rolloverH });
  if (!plan) {
    const body: Omit<RealisedHistory, 'contentHash'> = { kind: 'vitals.realisedHistory', contractVersion, reducerVersion: REALISED_HISTORY_REDUCER_VERSION, anchor, asOf: appDayStartInstant(today, tz, rolloverH), days: [], events: [], fasts: [], assumptions: [], uncertaintyGroups: [] };
    return { ...body, contentHash: realisedHistoryHash(body) };
  }
  const pick = <K extends HistoryDocument['kind']>(k: K) => documents.filter((d): d is Extract<HistoryDocument, { kind: K }> => d.kind === k);
  const out = realiseLivingHistory({
    plan,
    versions: pick('version').map((d) => d.version),
    dayStatus: pick('dayStatus').map((d) => d.status),
    entries: projectEntries(pick('entry').map((d) => d.entry)),
    rawEntries: pick('entry').map((d) => d.entry),
    measurements: projectEntries(pick('measurement').map((d) => d.measurement)),
    today,
    tz,
    now: asOf,
    rolloverH,
  }).history;
  const body = { ...out, contractVersion, anchor: { ...out.anchor, ...anchor } };
  const { contentHash: _old, ...rest } = body;
  void _old;
  return { ...rest, contentHash: realisedHistoryHash(rest) };
};
