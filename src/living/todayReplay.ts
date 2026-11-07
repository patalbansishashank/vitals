/**
 * Today's replay (energy SPEC §V3.4): the realised template of the current app day — actual so far plus the plan's
 * remainder — that `realisedSchedule(…, { current })` puts on today's index. Pure.
 *
 *  (a) a prescribed slot whose approved actual is linked (`itemId` / `link`) → that actual (a skipped log drops it);
 *  (b) approved unplanned actuals (and manual logs) are added;
 *  (c) steps today = `fusedSoFar + rxSteps · remainingAwakeFrac(now)`, from the template's sleep window. The remainder is a
 *      NAMED PRIOR (`assumption: 'stepsRemainderPlanShare'`), disclosed in the run's assumptions; it is not an observation.
 *      Elapsed awake minutes with no step coverage get the same plan-share prior, so a morning gap is never read as zero.
 *      The day's coverage minutes (`fusion.coverage.eitherMin`) count from the steps day's start (the rollover for a fused
 *      app day, audit F12; local midnight for a calendar day): the part of them inside the night's recorded sleep before
 *      the awake window opens is the night's, not the morning's (audit F7). (r063 A12) When the steps day carries its
 *      coverage spans, the covered awake time is those spans intersected with the elapsed awake window instead;
 *  (d) unlinked, unperformed slots stay prescribed (at full dose: today is not over, so no expected-credit imputation).
 *
 * The day's TEE of a run over this template is then actual-through-now plus the plan remainder. Pending candidates never
 * enter (D8): only session entries — what the person approved or logged — are read.
 */
import type { DayTemplate, ExerciseSession } from '@/engine';
import { appDay, DEFAULT_ROLLOVER_H } from './appDay';
import { instantToLocal, localToInstant } from './dates';
import { stimulusToEngineSessions } from './loggedDay';
import type { LocalDate, LogEntry, PrescribedDaySnapshot } from './types';
import type { EnergyBout } from './sensors/energyDay';
import { mergeSpans } from './stepsAppDay';

/** The named prior of today's step remainder (and of uncovered elapsed awake time). */
export const STEPS_REMAINDER_ASSUMPTION = 'stepsRemainderPlanShare' as const;

type Session = Extract<LogEntry, { kind: 'session' }>;
type Steps = Extract<LogEntry, { kind: 'steps' }>;

export interface TodayStepsModel {
  /** The fused (or typed) count so far; null when nothing is known yet today. */
  fusedSoFar: number | null;
  /** The plan's steps for today (null = none prescribed: the engine's habitual default stays). */
  rxSteps: number | null;
  /** Share of today's awake window still ahead (template sleep window). */
  remainingAwakeFrac: number;
  /** Share of the awake window already elapsed with no step coverage (it gets the same prior). */
  uncoveredAwakeFrac: number;
  /** The prior part: rxSteps · (remaining + uncovered). */
  prior: number;
  /** What the replay uses for today (fused so far + prior); null = the engine's habitual default. */
  total: number | null;
  /** The located steps inside today's approved gait bouts (known overlap). */
  sessionIncludedSteps: number;
  assumption: typeof STEPS_REMAINDER_ASSUMPTION | null;
  status: 'observed' | 'inferred' | 'asPlanned';
  lineages: readonly string[];
  headlinePolicy: 'located' | 'atLeast' | null;
}

/**
 * (r063 A16) One bout the realised today run books: an effective session entry (approved activity or the person's log) or
 * a plan session still ahead, with its engine parts on the app day's clock (a paused bout has several) and its booked
 * incremental kcal when known. The energy display allocates the run's exercise energy to these windows.
 */
export interface TodayBout {
  id: string;
  source: 'actual' | 'planned';
  parts: Array<{ startH: number; durationMin: number }>;
  incrementalKcal: number | null;
}

export interface TodayActual {
  date: LocalDate;
  template: DayTemplate;
  /** (r063 A16) The run's bouts (every session it books), for the energy allocation. */
  bouts: TodayBout[];
  steps: TodayStepsModel;
  sessions: { linked: Array<{ itemId: string; entryId: string }>; unplanned: string[]; prescribed: string[]; skipped: string[] };
  assumptions: string[];
}

export interface TodayActualInput {
  date: LocalDate;
  prescription: PrescribedDaySnapshot;
  /** The head schedule's template of today (the future the plan holds). */
  headTemplate: DayTemplate;
  /** Effective entries of today. */
  entries: readonly LogEntry[];
  nowMs: number;
  tz: string;
  rolloverH?: number;
}

/** The local clock hour of an instant on its app date (after midnight before the rollover reads 24 h and more). */
export function appClockH(ms: number, tz: string, rolloverH: number = DEFAULT_ROLLOVER_H): { date: LocalDate; clockH: number } {
  const date = appDay(ms, { tz, rolloverH });
  const local = instantToLocal(new Date(ms).toISOString(), tz);
  return { date, clockH: local.date === date ? local.clockH : local.clockH + 24 };
}

const withId = (sessions: readonly ExerciseSession[], id: string): ExerciseSession[] => sessions.map((s, k) => (s.sessionId ? s : { ...s, sessionId: sessions.length > 1 ? `${id}#${k}` : id }));

/**
 * The awake window [wake, bed) on the app day's clock (bed after midnight reads 24 h and more) and where now is in it.
 * Default window 07:00-23:00 when the template has none (P).
 */
export function awakeFractions(sleep: { bedH?: number; wakeH?: number } | undefined, nowH: number): { remaining: number; elapsed: number; totalMin: number } {
  const wake = sleep?.wakeH ?? 7;
  let bed = sleep?.bedH ?? 23;
  if (bed <= wake) bed += 24;
  const total = bed - wake;
  if (!(total > 0)) return { remaining: 0, elapsed: 1, totalMin: 0 };
  const remaining = Math.min(total, Math.max(0, bed - Math.max(nowH, wake))) / total;
  const elapsed = Math.min(total, Math.max(0, Math.min(nowH, bed) - wake)) / total;
  return { remaining, elapsed, totalMin: total * 60 };
}

/**
 * Minutes of the steps day's coverage that belong to the night (audit F7): the recorded sleep of today (in-force sleep
 * entries) inside [the steps day's start, the awake window's start), clipped to now. The ring that recorded the night
 * observed those minutes; they never cover the morning. Without a sleep entry nothing is attributed to the night. The
 * steps day starts at the rollover for a fused app day (audit F12: its small hours went to the day before), else at local
 * midnight (a calendar day).
 */
function nightCoveredMin(i: TodayActualInput, date: LocalDate, wakeH: number, dayStartH: number): number {
  let midnight: number;
  let from: number;
  try {
    midnight = Date.parse(localToInstant(date, 0, i.tz));
    from = dayStartH > 0 ? Date.parse(localToInstant(date, dayStartH, i.tz)) : midnight;
  } catch {
    return 0;
  }
  const until = Math.min(i.nowMs, midnight + Math.max(0, Math.min(24, wakeH)) * 3_600_000);
  if (!(until > from)) return 0;
  const spans = i.entries
    .filter((e): e is Extract<LogEntry, { kind: 'sleep' }> => e.kind === 'sleep' && !e.assumed)
    .map((e) => ({ start: Math.max(from, Date.parse(e.bedAt)), end: Math.min(until, Date.parse(e.wakeAt)) }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let end = -Infinity;
  for (const x of spans) {
    const a = Math.max(x.start, end);
    if (x.end > a) total += x.end - a;
    end = Math.max(end, x.end);
  }
  return total / 60_000;
}

/**
 * (r063 A12) Minutes of the elapsed awake window [wake, min(now, bed)) of `date` that the steps day's coverage spans cover
 * (the union of its located intervals). Null when the window cannot be placed (then the minute counts are used).
 */
export function coveredAwakeMin(spans: ReadonlyArray<{ start: string; end: string }>, date: LocalDate, sleep: { bedH?: number; wakeH?: number } | undefined, nowMs: number, tz: string): number | null {
  const wakeH = sleep?.wakeH ?? 7;
  let bedH = sleep?.bedH ?? 23;
  if (bedH <= wakeH) bedH += 24;
  let a: number;
  let b: number;
  try {
    a = Date.parse(localToInstant(date, wakeH, tz));
    b = Math.min(nowMs, Date.parse(localToInstant(date, bedH, tz)));
  } catch {
    return null;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (!(b > a)) return 0;
  const xs = spans.map((x) => [Math.max(a, Date.parse(x.start)), Math.min(b, Date.parse(x.end))] as const).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [s, e] of xs) {
    const from = Math.max(s, end);
    if (e > from) total += e - from;
    end = Math.max(end, e);
  }
  return total / 60_000;
}

/** Today's realised template: approved and logged actuals, the fused steps so far and the plan's remainder (§V3.4). */
export function todayActual(i: TodayActualInput): TodayActual {
  const rolloverH = i.rolloverH ?? DEFAULT_ROLLOVER_H;
  const rx = i.prescription;
  const head = i.headTemplate;
  const assumptions: string[] = [];
  const { clockH: nowH } = appClockH(i.nowMs, i.tz, rolloverH);

  // ---- sessions: linked actuals replace their slot, unlinked unperformed slots stay prescribed, unplanned actuals add
  const logs = i.entries.filter((e): e is Session => e.kind === 'session' && !e.assumed);
  const used = new Set<string>();
  const exercise: ExerciseSession[] = [];
  const linked: TodayActual['sessions']['linked'] = [];
  const prescribed: string[] = [];
  const skipped: string[] = [];
  const engineOf = (log: Session): ExerciseSession[] => (log.engine && log.engine.length > 0 ? log.engine : stimulusToEngineSessions(log.stimulus, log.startH ?? 18, log.durationMin));
  const bouts: TodayBout[] = [];
  const addBout = (id: string, source: TodayBout['source'], sessions: readonly ExerciseSession[], inc: number | null | undefined) => {
    const parts = sessions.filter((x) => Number.isFinite(x.startH) && (x.durationMin ?? 0) > 0).map((x) => ({ startH: x.startH, durationMin: x.durationMin! }));
    if (parts.length > 0) bouts.push({ id, source, parts, incrementalKcal: typeof inc === 'number' && Number.isFinite(inc) ? inc : null });
  };
  const logInc = (log: Session) => (log.cost ?? log.stimulus?.cost)?.incrementalKcal;
  for (const s of rx.sessions) {
    const type = s.kind === 'resistance' ? 'rtSession' : 'cardioSession';
    const itemId = `${type}:${s.slotKey}`;
    const log = logs.find((e) => !used.has(e.id) && (e.itemId === itemId || e.itemId === s.slotKey || e.link?.itemId === itemId || e.link?.itemId === s.slotKey));
    if (log) {
      used.add(log.id);
      if (log.status === 'skipped') {
        skipped.push(itemId);
        continue;
      }
      linked.push({ itemId, entryId: log.id });
      const sx = withId(engineOf(log), log.id);
      exercise.push(...sx);
      addBout(log.physicalBoutId ?? log.id, 'actual', sx, logInc(log));
      continue;
    }
    if (s.usual) continue; // the engine trains a usual session itself (habitualTraining below)
    prescribed.push(itemId);
    exercise.push(...withId(s.engine, s.slotKey));
    addBout(s.slotKey, 'planned', s.engine, s.stimulus?.cost?.incrementalKcal);
  }
  const unplanned: string[] = [];
  for (const log of logs) {
    if (used.has(log.id) || log.status === 'skipped') continue;
    unplanned.push(log.id);
    if (log.startH === undefined) assumptions.push('prescriptionReplay:sessionClockDefault');
    const sx = withId(engineOf(log), log.id);
    exercise.push(...sx);
    addBout(log.physicalBoutId ?? log.id, 'actual', sx, logInc(log));
  }
  const ownSessions = rx.sessions.filter((s) => !s.usual).length;
  const habitualTraining = head.habitualTraining === true && ownSessions === 0 && logs.length === 0;

  // ---- steps: fused so far + the plan share of the awake time still ahead (and of uncovered elapsed awake time)
  const stepsLog = i.entries.find((e): e is Steps => e.kind === 'steps' && !e.assumed);
  const fusedSoFar = stepsLog ? stepsLog.steps : null;
  const rxSteps = rx.steps ?? head.steps ?? null;
  const sleep = rx.sleep ?? (head.sleep?.bedH !== undefined || head.sleep?.wakeH !== undefined ? { ...(head.sleep.bedH !== undefined ? { bedH: head.sleep.bedH } : {}), ...(head.sleep.wakeH !== undefined ? { wakeH: head.sleep.wakeH } : {}) } : undefined);
  const aw = awakeFractions(sleep, nowH);
  let uncovered = 0;
  const awakeSpanCovered = stepsLog?.fusion?.spans && aw.totalMin > 0 ? coveredAwakeMin(stepsLog.fusion.spans, i.date, sleep, i.nowMs, i.tz) : null;
  if (fusedSoFar === null) uncovered = aw.elapsed;
  else if (awakeSpanCovered !== null) {
    // (r063 A12) the real coverage spans intersected with the elapsed awake time: a sleep entry never stands in for them
    const elapsedMin = aw.elapsed * aw.totalMin;
    uncovered = Math.max(0, elapsedMin - Math.min(elapsedMin, awakeSpanCovered)) / aw.totalMin;
  } else if (stepsLog?.fusion?.coverage && aw.totalMin > 0) {
    const elapsedMin = aw.elapsed * aw.totalMin;
    const night = nightCoveredMin(i, stepsLog.date, sleep?.wakeH ?? 7, stepsLog.occurrence?.dateMeaning === 'appDay' ? (stepsLog.occurrence.rolloverH ?? rolloverH) : 0);
    const awakeCovered = Math.min(elapsedMin, Math.max(0, stepsLog.fusion.coverage.eitherMin - night));
    uncovered = Math.max(0, elapsedMin - awakeCovered) / aw.totalMin;
  }
  const share = rxSteps !== null ? aw.remaining + uncovered : 0;
  const prior = rxSteps !== null ? rxSteps * share : 0;
  const total = rxSteps === null ? fusedSoFar : (fusedSoFar ?? 0) + prior;
  const included = logs.filter((l) => l.status !== 'skipped' && l.stepsIncluded !== undefined && l.stepsIncluded > 0).reduce((a, l) => a + l.stepsIncluded!, 0);
  const assumption = rxSteps !== null && share > 0 ? STEPS_REMAINDER_ASSUMPTION : null;
  if (assumption) assumptions.push(`habitualBaseline:${STEPS_REMAINDER_ASSUMPTION}`);

  const template: DayTemplate = { ...head, label: 'today so far' };
  template.exercise = exercise.sort((a, b) => a.startH - b.startH);
  template.habitualTraining = habitualTraining;
  if (total !== null) {
    template.steps = Math.round(total);
    template.stepsScope = 'totalDay';
    if (included > 0) template.sessionIncludedSteps = Math.min(Math.round(total), included);
    else delete template.sessionIncludedSteps;
  }
  template.observed = {
    coverage: { exercise: logs.length > 0 ? 'partial' : 'unknown', steps: fusedSoFar !== null ? 'partial' : 'unknown' },
    resolution: 'scenario',
    eventIds: i.entries.filter((e) => !e.assumed && (e.kind === 'session' || e.kind === 'steps')).map((e) => e.id).sort(),
    assumptionIds: assumptions.map((a) => `${i.date}:${a}`),
  };
  return {
    date: i.date,
    template,
    bouts,
    steps: {
      fusedSoFar,
      rxSteps,
      remainingAwakeFrac: aw.remaining,
      uncoveredAwakeFrac: uncovered,
      prior,
      total: total === null ? null : Math.round(total),
      sessionIncludedSteps: included,
      assumption,
      status: fusedSoFar === null ? 'asPlanned' : share > 0 ? 'inferred' : 'observed',
      lineages: stepsLog?.source.sources ?? (stepsLog ? [stepsLog.source.app === 'gauge' ? 'ring' : stepsLog.source.by] : []),
      headlinePolicy: stepsLog?.fusion?.headlinePolicy ?? null,
    },
    sessions: { linked, unplanned, prescribed, skipped },
    assumptions,
  };
}

/** (r063 A16/S23) The plan's own bouts of a prescribed day (the head run's sessions; usual sessions have no clock). */
export function prescribedBouts(rx: Pick<PrescribedDaySnapshot, 'sessions'>): TodayBout[] {
  return rx.sessions
    .filter((s) => !s.usual)
    .flatMap((s) => {
      const parts = s.engine.filter((x) => Number.isFinite(x.startH) && (x.durationMin ?? 0) > 0).map((x) => ({ startH: x.startH, durationMin: x.durationMin! }));
      const inc = s.stimulus?.cost?.incrementalKcal;
      return parts.length > 0 ? [{ id: s.slotKey, source: 'planned' as const, parts, incrementalKcal: typeof inc === 'number' && Number.isFinite(inc) ? inc : null }] : [];
    });
}

/**
 * (r063 A16) The run's bouts as energy-allocation windows on `date` (engine hours are clock hours from local midnight, so
 * part k starts at `date startH:00` in the zone). Overlapping parts are merged (a second is one bout second); the booked
 * incremental kcal over the moving minutes caps the bout's direct share, the rest of a bout hour's exercise energy is
 * recovery.
 */
export function energyBoutsOf(bouts: readonly TodayBout[], date: LocalDate, tz: string): EnergyBout[] {
  const out: EnergyBout[] = [];
  for (const b of bouts) {
    const raw: Array<[number, number]> = [];
    for (const p of b.parts) {
      let a: number;
      try {
        a = Date.parse(localToInstant(date, p.startH, tz));
      } catch {
        continue;
      }
      if (Number.isFinite(a)) raw.push([a, a + p.durationMin * 60_000]);
    }
    const spans = mergeSpans(raw);
    if (spans.length === 0) continue;
    const min = spans.reduce((x, [a, e]) => x + (e - a), 0) / 60_000;
    const parts = spans.map(([start, end]) => ({ start, end }));
    out.push({
      id: b.id,
      window: { start: parts[0]!.start, end: parts[parts.length - 1]!.end },
      ...(parts.length > 1 ? { parts } : {}),
      source: b.source,
      incrementalKcalPerMin: b.incrementalKcal !== null && min > 0 ? b.incrementalKcal / min : null,
    });
  }
  return out;
}
