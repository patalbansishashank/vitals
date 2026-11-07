/**
 * Fasts resolved in absolute time before any day/hour split (C2, D5-05, D2-01). Pure.
 *
 * Rules:
 *  - a logged fast starts at its last intake; it ends at its logged first intake, or earlier at the first VERIFIED caloric
 *    intake after the start (positive energy, or a known positive caloric status such as an ingested BHB dose, at a known
 *    instant: `intakeCaloricStatus` + `zeroCalorieFastInterruption`). The adherence tolerance
 *    for a "zero-energy day" (≤ 50 kcal) is not a fast-break rule. An intake of unknown energy or time only bounds the end;
 *  - a running fast (no end) is right-censored at `asOf`: nothing after `asOf` is observed and the intended length is not
 *    history. Overlapping or duplicated fast records are merged into one interval (deterministic order, never counted twice);
 *  - a `modified` protocol keeps its permitted intake: it is never truncated by an intake and never treated as zero intake;
 *  - a prescribed fast without a fast log is replayed only as a named assumption: a verified intake inside it ends it there,
 *    a fast mark scales it, an unknown fast is kept only at expected credit ≥ 0.5 (decided by `fastEventsFor`);
 *  - a fast log on the prescribed fast's start day realises that prescribed fast (identity by plan day and `link`, never by
 *    a time window), so a later completion deduplicates the assumed interval.
 * The engine event never covers an observed intake as the replay places it (plan day × 24 + clock hour): the event is cut
 * at that intake, so a recorded meal is never suppressed to keep a fast.
 */
import type { FastEvent } from '@/engine';
import { exactOccurrence, occurrenceBoundsMs, zeroCalorieFastInterruption, type FastInterval, type HistoryAssumptionKind } from '@/lib/bodyContracts';
import { fastCredit, markCredit } from './adherence';
import { DEFAULT_ROLLOVER_H } from './appDay';
import { daysBetween, instantToLocal } from './dates';
import { entryOccurrence, intakeCaloricStatus, MINUTE_MS, occurrenceWindowMs } from './occurrence';
import type { DayStatusDoc, Instant, LocalDate, LogEntry, Mark, PrescribedDaySnapshot } from './types';

const HOUR_MS = 3_600_000;
/** Expected credit from which an unknown prescribed fast is kept in the replay (existing replay rule). */
export const UNKNOWN_FAST_KEEP_CREDIT = 0.5;

export interface PrescribedFastDay {
  date: LocalDate;
  planDay: number;
  prescription: PrescribedDaySnapshot;
  status: DayStatusDoc | null;
}

export interface FastResolutionInput {
  planStart: LocalDate;
  tz: string;
  rolloverH?: number;
  /** Observation horizon: later intakes and ends are not observed; running fasts are censored here. */
  asOf: Instant;
  /** Effective entries (edits and retractions resolved), any dates. */
  entries: readonly LogEntry[];
  /** Days whose prescriptions may hold a fast (any order). */
  days: readonly PrescribedFastDay[];
}

export type FastBasis = 'log' | 'terminatingEvent' | 'boundedEvent' | 'mark' | 'unknown';

export interface ResolvedFast {
  interval: FastInterval;
  /** The prescribed fast this interval realises (null = an unplanned fast). */
  prescribed: { startDay: number; startH: number; hours: number } | null;
  basis: FastBasis;
  /** Hours achieved when the end is observed (a logged end or a terminating intake); null otherwise. */
  achievedH: number | null;
  broken: boolean;
  markCredit?: number;
  /** Mark that decided it (basis 'mark'). */
  mark?: Mark;
  /** Engine event of the replay (null = not simulated). */
  event: FastEvent | null;
  /** Set when the event is kept only at expected credit ≥ 0.5 on `date` (an unknown prescribed fast). */
  expectedCreditDecision?: { date: LocalDate };
  /** The assumption the replay of this fast relies on, if any. */
  assumption?: HistoryAssumptionKind;
  /**
   * (D5-05) A running fast older than its intended length: the separately named continuation scenario "ended unlogged at
   * the intended length" (prospective/what-if input only). The observed `event` stays censored at `asOf`.
   */
  staleTimer?: { kind: 'endedAtIntendedLength'; durationH: number };
}

interface Intake {
  id: string;
  kind: 'terminates' | 'bounded';
  win: { startMs: number; endMs: number };
  /** Hour of the intake on the replay's time base (plan day × 24 + clock hour), when it has a clock. */
  engineH: number | null;
}

function intakesOf(i: FastResolutionInput): Intake[] {
  const r = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const out: Intake[] = [];
  for (const e of i.entries) {
    if (e.assumed) continue;
    // (D5-05) the shared classifier: a known positive caloric status (an ingested BHB dose with no kcal number) interrupts
    // like positive meal or alcohol energy; a known zero never does; unknown energy only bounds the end
    const cs = intakeCaloricStatus(e);
    if (cs === undefined || cs.status === 'zero') continue;
    const occ = entryOccurrence(e, { tz: i.tz, rolloverH: r });
    const kind = cs.energyKcal !== null ? zeroCalorieFastInterruption({ energyKcal: cs.energyKcal, occurrence: occ }) : cs.status === 'positive' && occ.precision === 'exact' && occurrenceBoundsMs(occ) !== null ? 'terminates' : 'bounded';
    if (kind === 'none') continue;
    const win = occurrenceWindowMs(occ, i.tz, r);
    if (!win) continue;
    const clock = e.kind === 'meal' || e.kind === 'substance' || e.kind === 'supplement' ? e.clockH : undefined;
    out.push({ id: e.id, kind, win, engineH: clock !== undefined && Number.isFinite(clock) ? daysBetween(i.planStart, e.date) * 24 + clock : null });
  }
  return out.sort((a, b) => a.win.startMs - b.win.startMs || (a.id < b.id ? -1 : 1));
}

/** Engine coordinates (plan day, clock hour) of an instant. */
function engineStart(planStart: LocalDate, at: Instant, tz: string): { startDay: number; startH: number } {
  const l = instantToLocal(at, tz);
  return { startDay: daysBetween(planStart, l.date), startH: l.clockH };
}

/** Cut an event at the first observed intake the replay places inside it (a recorded meal is never suppressed). */
function cutAtPlacedIntakes(ev: FastEvent, intakes: readonly Intake[]): FastEvent {
  const s = ev.startDay * 24 + ev.startH;
  let dur = ev.durationH;
  for (const x of intakes) if (x.engineH !== null && x.engineH > s + 1 / 60 && x.engineH - s < dur) dur = x.engineH - s;
  return dur < ev.durationH ? stripRefeed({ ...ev, durationH: Math.max(0, dur) }) : ev;
}

function stripRefeed(ev: FastEvent): FastEvent {
  const { refeed: _r, refeedFactors: _f, ...rest } = ev;
  void _r;
  void _f;
  return rest;
}

interface LoggedFast {
  ids: string[];
  startAt: Instant;
  startMs: number;
  loggedEndMs: number | null;
  protocol: 'zeroCalorie' | 'modified';
  broken: boolean;
  electrolytes: boolean;
  /** Plan days the records were written for (their `date`/`planDay`) and explicit links. */
  dates: LocalDate[];
  linkedFast: boolean;
}

function loggedFasts(i: FastResolutionInput): LoggedFast[] {
  const asOfMs = Date.parse(i.asOf);
  const raw = i.entries
    .filter((e): e is Extract<LogEntry, { kind: 'fast' }> => e.kind === 'fast' && !e.assumed && Number.isFinite(Date.parse(e.lastIntakeAt)))
    .map((e) => ({ e, s: Date.parse(e.lastIntakeAt), f: e.firstIntakeAt ? Date.parse(e.firstIntakeAt) : NaN }))
    .filter((x) => x.s < asOfMs)
    .sort((a, b) => a.s - b.s || (a.e.id < b.e.id ? -1 : 1));
  const out: LoggedFast[] = [];
  for (const { e, s, f } of raw) {
    const end = Number.isFinite(f) && f > s ? f : null;
    const prev = out[out.length - 1];
    const prevEnd = prev ? (prev.loggedEndMs ?? asOfMs) : -Infinity;
    if (prev && s < prevEnd) {
      // overlapping records of one fast (duplicates, devices): one interval, the union, never counted twice
      prev.ids.push(e.id);
      prev.loggedEndMs = prev.loggedEndMs === null || end === null ? null : Math.max(prev.loggedEndMs, end);
      if ((e.protocol ?? 'zeroCalorie') !== prev.protocol) prev.protocol = 'modified';
      prev.broken ||= e.broken === true;
      prev.electrolytes ||= e.electrolytes === true;
      prev.dates.push(e.date);
      prev.linkedFast ||= e.link?.itemId === 'fast' || e.itemId === 'fast';
      continue;
    }
    out.push({ ids: [e.id], startAt: e.lastIntakeAt, startMs: s, loggedEndMs: end, protocol: e.protocol ?? 'zeroCalorie', broken: e.broken === true, electrolytes: e.electrolytes === true, dates: [e.date], linkedFast: e.link?.itemId === 'fast' || e.itemId === 'fast' });
  }
  return out;
}

/** The first terminating and the first bounding intake strictly after `startMs` and before `limitMs`. */
function firstIntakes(intakes: readonly Intake[], startMs: number, limitMs: number): { term: Intake | null; bound: { x: Intake; a: number; b: number } | null } {
  let term: Intake | null = null;
  let bound: { x: Intake; a: number; b: number } | null = null;
  for (const x of intakes) {
    if (x.win.endMs <= startMs + MINUTE_MS || x.win.startMs >= limitMs) continue;
    if (x.kind === 'terminates') {
      if (x.win.startMs > startMs + MINUTE_MS && (!term || x.win.startMs < term.win.startMs)) term = x;
    } else {
      const a = Math.max(startMs, x.win.startMs);
      const b = Math.min(limitMs, x.win.endMs);
      if (!bound || a < bound.a) bound = { x, a, b };
    }
  }
  return { term, bound };
}

function markOf(day: PrescribedFastDay | undefined): Mark | undefined {
  const m = day?.status?.marks;
  return m?.fast ?? m?.all;
}

/**
 * Resolve every fast of the documents in absolute time (see the module comment). Deterministic: the same entries,
 * prescriptions and `asOf` give the same intervals and ids.
 */
export function resolveFasts(i: FastResolutionInput): ResolvedFast[] {
  const asOfMs = Date.parse(i.asOf);
  const intakes = intakesOf(i);
  const logs = loggedFasts(i);
  const days = [...i.days].sort((a, b) => a.planDay - b.planDay);
  const out: ResolvedFast[] = [];

  // prescribed fasts, one per start (a multi-day fast appears on every day it covers)
  const rxByKey = new Map<string, { ev: FastEvent; rx: PrescribedDaySnapshot; covered: PrescribedFastDay[] }>();
  for (const d of days) {
    const ev = d.prescription.fastEvent;
    if (!ev || !d.prescription.fast) continue;
    const key = `${ev.startDay}:${ev.startH}`;
    const g = rxByKey.get(key);
    if (g) g.covered.push(d);
    else rxByKey.set(key, { ev, rx: d.prescription, covered: [d] });
  }
  const startDayOfDate = (date: LocalDate): number => daysBetween(i.planStart, date);
  const realisedBy = new Map<string, LoggedFast>();
  for (const [key, g] of rxByKey) {
    const log = logs.find((l) => l.dates.some((dt) => startDayOfDate(dt) === g.ev.startDay));
    if (log) realisedBy.set(key, log);
  }
  const prescribedOfLog = (l: LoggedFast): { key: string; ev: FastEvent; rx: PrescribedDaySnapshot } | null => {
    for (const [key, log] of realisedBy) if (log === l) return { key, ev: rxByKey.get(key)!.ev, rx: rxByKey.get(key)!.rx };
    return null;
  };

  // ---- logged fasts (observations)
  for (const l of logs) {
    const p = prescribedOfLog(l);
    const intendedH = p?.rx.fast?.hours ?? p?.ev.durationH;
    const limit = Math.min(l.loggedEndMs ?? Infinity, asOfMs);
    const { term, bound } = l.protocol === 'zeroCalorie' ? firstIntakes(intakes, l.startMs, limit) : { term: null, bound: null };
    let endMs: number | null = null;
    let terminatingEventId: string | undefined;
    if (l.loggedEndMs !== null && l.loggedEndMs <= asOfMs) endMs = l.loggedEndMs;
    if (term && (endMs === null || term.win.startMs < endMs)) {
      endMs = term.win.startMs;
      terminatingEventId = term.id;
    }
    let end: FastInterval['end'];
    let observedHours: FastInterval['observedHours'];
    let achievedH: number | null = null;
    let staleTimer: ResolvedFast['staleTimer'];
    let engineEndMs: number;
    if (bound && bound.a < (endMs ?? limit)) {
      const b = Math.min(bound.b, endMs ?? limit);
      end = { kind: 'interval', interval: { start: new Date(bound.a).toISOString(), end: new Date(b).toISOString() }, terminatingEventId: bound.x.id };
      observedHours = { min: (bound.a - l.startMs) / HOUR_MS, max: (b - l.startMs) / HOUR_MS };
      engineEndMs = endMs ?? (l.loggedEndMs !== null ? Math.min(l.loggedEndMs, asOfMs) : asOfMs);
    } else if (endMs !== null) {
      end = { kind: 'observed', at: new Date(endMs).toISOString(), ...(terminatingEventId ? { terminatingEventId } : {}) };
      achievedH = (endMs - l.startMs) / HOUR_MS;
      observedHours = { min: achievedH, max: achievedH };
      engineEndMs = endMs;
    } else {
      // (C2/D5-05) running (or ended after asOf): the observed history runs to asOf, right-censored there, whatever length
      // was intended. The intended length is metadata; a stale timer (the fast may have ended unlogged at its intended
      // length) is only a separately named continuation scenario, never the observed event
      end = { kind: 'censored', at: new Date(asOfMs).toISOString() };
      const elapsed = (asOfMs - l.startMs) / HOUR_MS;
      observedHours = { min: elapsed, max: null };
      engineEndMs = asOfMs;
      if (l.loggedEndMs === null && intendedH !== undefined && elapsed > intendedH) staleTimer = { kind: 'endedAtIntendedLength', durationH: intendedH };
    }
    const id = `fast:${l.ids[0]}`;
    const interval: FastInterval = {
      id,
      protocol: l.protocol,
      start: exactOccurrence(l.startAt, { tz: i.tz, source: 'user' }),
      end,
      observedHours,
      ...(intendedH !== undefined ? { intendedHours: intendedH } : {}),
      sourceIds: [...l.ids],
    };
    const st = engineStart(i.planStart, l.startAt, i.tz);
    const base: FastEvent = {
      kind: 'fast',
      ...st,
      durationH: Math.max(0, (engineEndMs - l.startMs) / HOUR_MS),
      ...(l.electrolytes ? { electrolytes: true } : {}),
      source: end.kind === 'observed' ? 'observed' : 'censored',
      protocol: l.protocol,
      eventId: id,
    };
    const event = l.protocol === 'zeroCalorie' ? cutAtPlacedIntakes(base, intakes) : base;
    out.push({
      interval,
      prescribed: p ? { startDay: p.ev.startDay, startH: p.ev.startH, hours: p.rx.fast?.hours ?? p.ev.durationH } : null,
      basis: 'log',
      achievedH,
      broken: l.broken,
      event,
      ...(staleTimer ? { staleTimer } : {}),
    });
  }

  // ---- prescribed fasts without a fast log (assumptions, cut by observations)
  for (const [key, g] of rxByKey) {
    if (realisedBy.has(key)) continue;
    const fx = g.rx.fast!;
    const startMs = Date.parse(fx.lastIntakeAt);
    const rxEndMs = Date.parse(fx.firstIntakeAt);
    if (!Number.isFinite(startMs) || startMs >= asOfMs) continue; // prospective: not history
    const id = `rxfast:${g.rx.planId}:${g.ev.startDay}:${Math.round(g.ev.startH * 60)}`;
    const limit = Math.min(rxEndMs, asOfMs);
    const { term, bound } = (g.ev.protocol ?? 'zeroCalorie') === 'zeroCalorie' ? firstIntakes(intakes, startMs, limit) : { term: null, bound: null };
    const prescribed = { startDay: g.ev.startDay, startH: g.ev.startH, hours: fx.hours };
    const start = exactOccurrence(fx.lastIntakeAt, { tz: i.tz, source: 'derived' });
    const planned: FastEvent = { ...g.ev, source: 'planned', eventId: id };
    const common = { protocol: g.ev.protocol ?? ('zeroCalorie' as const), start, intendedHours: fx.hours, sourceIds: [] as string[] };
    if (term) {
      const achievedH = (term.win.startMs - startMs) / HOUR_MS;
      out.push({
        interval: { id, ...common, end: { kind: 'observed', at: new Date(term.win.startMs).toISOString(), terminatingEventId: term.id }, observedHours: { min: achievedH, max: achievedH }, sourceIds: [term.id] },
        prescribed,
        basis: 'terminatingEvent',
        achievedH,
        broken: true,
        event: cutAtPlacedIntakes(stripRefeed({ ...planned, durationH: Math.min(planned.durationH, achievedH) }), intakes),
        assumption: 'prescriptionReplay',
      });
      continue;
    }
    if (bound) {
      out.push({
        interval: { id, ...common, end: { kind: 'interval', interval: { start: new Date(bound.a).toISOString(), end: new Date(bound.b).toISOString() }, terminatingEventId: bound.x.id }, observedHours: { min: (bound.a - startMs) / HOUR_MS, max: (bound.b - startMs) / HOUR_MS }, sourceIds: [bound.x.id] },
        prescribed,
        basis: 'boundedEvent',
        achievedH: null,
        broken: false,
        event: cutAtPlacedIntakes(planned, intakes),
        assumption: 'prescriptionReplay',
      });
      continue;
    }
    const startDay = g.covered.find((d) => d.planDay === g.ev.startDay);
    const mark = markOf(startDay) ?? g.covered.map(markOf).find((m) => m !== undefined);
    if (mark) {
      const c = markCredit(mark);
      const event = c >= 0.999 ? planned : c > 0 ? { ...planned, durationH: Math.max(1, fx.hours * c) } : null;
      out.push({ interval: { id, ...common, end: { kind: 'unknown' } }, prescribed, basis: 'mark', achievedH: null, broken: false, markCredit: c, mark, event: event ? cutAtPlacedIntakes(event, intakes) : null, assumption: 'asPlannedTap' });
      continue;
    }
    const startDate = (startDay ?? g.covered[0]!).date;
    out.push({
      interval: { id, ...common, end: { kind: 'unknown' } },
      prescribed,
      basis: 'unknown',
      achievedH: null,
      broken: false,
      event: cutAtPlacedIntakes(planned, intakes),
      expectedCreditDecision: { date: startDate },
      assumption: 'prescriptionReplay',
    });
  }
  return out.sort((a, b) => Date.parse(a.interval.start.at ?? '') - Date.parse(b.interval.start.at ?? '') || (a.interval.id < b.interval.id ? -1 : 1));
}

/** The engine events of resolved fasts: unknown prescribed fasts only at expected credit ≥ 0.5 on their start date. */
export function fastEventsFor(resolved: readonly ResolvedFast[], expectedAt: (date: LocalDate) => number): FastEvent[] {
  const out: FastEvent[] = [];
  for (const rf of resolved) {
    if (!rf.event || !(rf.event.durationH > 0)) continue;
    if (rf.expectedCreditDecision && !(expectedAt(rf.expectedCreditDecision.date) >= UNKNOWN_FAST_KEEP_CREDIT)) continue;
    out.push(rf.event);
  }
  return out.sort((a, b) => a.startDay - b.startDay || a.startH - b.startH);
}

/** The resolved fast realising a day's prescribed fast (by its start), if any. */
export function resolvedForPrescription(resolved: readonly ResolvedFast[], rx: PrescribedDaySnapshot): ResolvedFast | undefined {
  const ev = rx.fastEvent;
  if (!ev) return undefined;
  return resolved.find((r) => r.prescribed !== null && r.prescribed.startDay === ev.startDay && Math.abs(r.prescribed.startH - ev.startH) < 1e-9);
}

const statusOf = (c: number): 'done' | 'partial' | 'skipped' => (c >= 0.999 ? 'done' : c <= 0.001 ? 'skipped' : 'partial');

/** Adherence outcome of a prescribed fast item from its resolution (unknown is never a failure). */
export function fastItemOutcome(rf: ResolvedFast | undefined, targetH: number): { status: 'done' | 'partial' | 'skipped' | 'unknown'; credit: number | null; why: string; assumed: boolean } {
  if (!rf) return { status: 'unknown', credit: null, why: 'not logged', assumed: true };
  switch (rf.basis) {
    case 'log': {
      if (rf.achievedH === null) return { status: 'unknown', credit: null, why: rf.interval.end.kind === 'interval' ? 'fast end unknown' : 'fast running', assumed: false };
      const c = fastCredit(targetH, rf.achievedH);
      return { status: rf.broken ? (c > 0 ? 'partial' : 'skipped') : statusOf(c), credit: c, why: `fasted ${Math.round(rf.achievedH)} of ${Math.round(targetH)} h`, assumed: false };
    }
    case 'terminatingEvent': {
      const c = fastCredit(targetH, rf.achievedH ?? 0);
      return { status: c > 0 ? 'partial' : 'skipped', credit: c, why: `fast ended after ${Math.round(rf.achievedH ?? 0)} h`, assumed: false };
    }
    case 'boundedEvent':
      return { status: 'unknown', credit: null, why: 'fast end unknown', assumed: true };
    case 'mark': {
      const c = rf.markCredit ?? 0;
      return { status: statusOf(c), credit: c, why: `fast marked ${rf.mark ?? ''}`.trim(), assumed: false };
    }
    default:
      return { status: 'unknown', credit: null, why: 'not logged', assumed: true };
  }
}
