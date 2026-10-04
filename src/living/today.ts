/**
 * Today data contract (docs/SUITE_SPEC.md §3.9, `today.get`): one object feeds the Today screen and the Coach — what to eat
 * and when, sessions, what to log (one-tap checklist actions are commands), what was logged with its sources, what is
 * left, today's adherence "so far" with the 7/28-day trend, the trend weight against today's forecast band, drift and
 * goal-date shifts, check-in state, biometrics and notices. Pure: the caller (E4's `today.get` executor) gathers the
 * documents and derived results; this module only assembles and decides.
 */
import { coverageLabel, costliestItem } from './adherence';
import { hoursBetween, instantToLocal } from './dates';
import { mealTotals, summarise } from './logs';
import { assumptionDiffs, type DayObservations } from './observations';
import type { LoggedDayResult } from './loggedDay';
import type {
  AdherenceTrend,
  ClockH,
  DayStatusDoc,
  DriftReport,
  Instant,
  LocalDate,
  LogEntry,
  MeasurementEntry,
  Notice,
  PlanDoc,
  PlanVersionDoc,
  PrescribedDaySnapshot,
  TodayChecklistItem,
  TodayView,
} from './types';
import { planDay, planLength } from './calendar';

export interface TodayInput {
  date: LocalDate;
  tz: string;
  rolloverH: number;
  quietMode: boolean;
  minimalMode: boolean;
  /** Current instant (from the caller's clock port) for "fast running since" and the remaining hours. */
  now: Instant;
  plan: (PlanDoc & { id: string }) | null;
  version: PlanVersionDoc | null;
  prescription: PrescribedDaySnapshot | null;
  /** Today's effective entries and measurements. */
  entries: readonly LogEntry[];
  measurements: readonly MeasurementEntry[];
  status: DayStatusDoc | null;
  /** Today so far (`toLoggedDay` with final: false). */
  logged: LoggedDayResult | null;
  trend: AdherenceTrend;
  drift: DriftReport | null;
  /** Filtered trend (kg, SD) and today's forecast band of scale weight. */
  trendWeight: { kg: number; sd: number } | null;
  forecastToday: { p10: number; p50: number; p90: number } | null;
  checkIn: { due: boolean; lastAt: LocalDate | null };
  observations: DayObservations | null;
  lapse: { welcomeBack: boolean; gap: LocalDate[] };
  /** Notices from elsewhere (safety, proposals, sync, pending Coach changes). */
  notices?: readonly Notice[];
}

function fastState(rx: PrescribedDaySnapshot | null, entries: readonly LogEntry[], now: Instant): TodayView['logged']['fast'] {
  const log = entries.find((e): e is Extract<LogEntry, { kind: 'fast' }> => e.kind === 'fast');
  const target = rx?.fast?.hours;
  if (log) {
    if (log.firstIntakeAt) return { state: log.broken ? 'broken' : 'done', sinceH: hoursBetween(log.lastIntakeAt, log.firstIntakeAt) };
    const since = hoursBetween(log.lastIntakeAt, now);
    return { state: 'running', sinceH: since, ...(target !== undefined ? { remainingH: Math.max(0, target - since) } : {}) };
  }
  if (!rx?.fast) return undefined;
  const since = hoursBetween(rx.fast.lastIntakeAt, now);
  if (since < 0) return { state: 'notStarted' };
  const ateInside = entries.some((e) => e.kind === 'meal' && e.at !== undefined && Date.parse(e.at) > Date.parse(rx.fast!.lastIntakeAt) && Date.parse(e.at) < Date.parse(rx.fast!.firstIntakeAt));
  if (ateInside) return { state: 'broken' };
  if (since >= rx.fast.hours) return { state: 'done', sinceH: rx.fast.hours };
  return { state: 'running', sinceH: since, remainingH: rx.fast.hours - since };
}

function checklist(i: TodayInput, rx: PrescribedDaySnapshot): TodayChecklistItem[] {
  const out: TodayChecklistItem[] = [];
  const has = (k: LogEntry['kind']): boolean => i.entries.some((e) => e.kind === k);
  const weighed = i.measurements.some((m) => m.metric === 'weightKg') || (i.observations?.weights?.length ?? 0) > 0;
  out.push({ id: 'weigh', ...(i.plan?.intentions.weighInClockH !== undefined ? { at: i.plan.intentions.weighInClockH } : {}), kind: 'weigh', label: 'Weigh in', done: weighed, command: { id: 'log.measurement', input: { date: i.date, metric: 'weightKg' } } });
  const marks = i.status?.marks ?? {};
  out.push({ id: 'mark:all', kind: 'mark', label: 'Day as planned', done: marks.all !== undefined, command: { id: 'log.markDay', input: { date: i.date, marks: { all: 'asPlanned' } } } });
  if (i.minimalMode) return out;
  for (const m of rx.meals) {
    const done = i.entries.some((e) => e.kind === 'meal' && Math.abs(e.clockH - m.clockH) <= 2);
    out.push({ id: `meal:${m.slot}`, at: m.clockH, kind: 'meal', label: `Meal at ${fmtClock(m.clockH)}`, done: done || marks.food !== undefined || marks.all !== undefined, command: { id: 'log.meal', input: { date: i.date, slot: m.slot, clockH: m.clockH } } });
  }
  for (const s of rx.sessions) {
    const itemId = `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`;
    const done = i.entries.some((e) => e.kind === 'session' && (e.itemId === itemId || e.itemId === s.slotKey)) || marks.train !== undefined || marks.all !== undefined;
    out.push({ id: `session:${s.slotKey}`, at: s.startH, kind: 'session', label: s.kind === 'resistance' ? 'Strength session' : 'Cardio session', done, command: { id: 'log.session', input: { date: i.date, slotKey: s.slotKey, status: 'done' } } });
  }
  if (rx.fast) out.push({ id: 'fast', kind: 'fast', label: `Fast ${Math.round(rx.fast.hours)} h`, done: has('fast') || marks.fast !== undefined, command: { id: 'log.fast', input: { action: 'record' } } });
  for (const s of rx.supplements) {
    out.push({ id: `supplement:${s.supplementId}`, ...(s.clockH !== undefined ? { at: s.clockH } : {}), kind: 'supplement', label: s.supplementId, done: i.entries.some((e) => e.kind === 'supplement' && e.supplementId === s.supplementId), command: { id: 'log.supplement', input: { date: i.date, supplementId: s.supplementId, dose: s.dose, unit: s.unit } } });
  }
  // a device's reading keeps the row (done): Today shows it with its source and Correct (SUITE_SPEC §14.6)
  if (rx.steps !== undefined) out.push({ id: 'steps', kind: 'steps', label: 'Steps', done: has('steps') || !!i.observations?.steps, command: { id: 'log.steps', input: { date: i.date } } });
  out.push({ id: 'sleep', kind: 'sleep', label: 'Last night’s sleep', done: has('sleep') || !!i.observations?.sleep, command: { id: 'log.sleep', input: { date: i.date } } });
  // the weigh-in leads the morning when no time was chosen; untimed taps come last
  const key = (c: TodayChecklistItem): number => c.at ?? (c.kind === 'weigh' ? 0 : 23.5);
  return out.sort((a, b) => key(a) - key(b));
}

function fmtClock(h: ClockH): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function buildTodayView(i: TodayInput): TodayView {
  const rx = i.prescription;
  const totals = mealTotals(i.entries);
  const notices: Notice[] = [...(i.notices ?? [])];
  if (i.lapse.welcomeBack) {
    notices.push({ id: 'welcomeBack', kind: 'welcomeBack', level: 'info', text: 'Welcome back, nothing to catch up on.', command: { id: 'log.bulk', input: { days: i.lapse.gap.map((date) => ({ date, entries: [], marks: { all: 'asPlanned' }, assumed: true })) } } });
  }
  if (i.checkIn.due) notices.push({ id: 'checkIn', kind: 'checkIn', level: 'info', text: 'Your weekly check-in is ready.', command: { id: 'plan.checkIn', input: {} } });
  if (i.minimalMode) notices.push({ id: 'minimal', kind: 'burden', level: 'info', text: 'The plan still works with weigh-ins and one tap a day.' });
  if (i.plan && i.plan.status === 'paused') notices.push({ id: 'paused', kind: 'info', level: 'info', text: 'The plan is paused. Days are habitual until you resume.', command: { id: 'plan.resume', input: {} } });

  const score = i.logged?.score ?? null;
  const coachPrompts: string[] = [];
  if (score) {
    const label = coverageLabel(score);
    if (label) coachPrompts.push(`Today's score is ${label}.`);
    const worst = costliestItem(score);
    if (worst && worst.credit !== null && worst.credit < 1 && score.final) coachPrompts.push(`${worst.why}: it carried ${Math.round(100 * worst.weight)} % of the day.`);
  }
  for (const d of assumptionDiffs(rx, i.observations)) coachPrompts.push(`The plan assumed ${Math.round(d.assumed * 10) / 10} ${d.metric === 'steps' ? 'steps' : 'h of sleep'}; ${d.source} measured ${Math.round(d.measured * 10) / 10}.`);

  const weigh = i.measurements.filter((m) => m.metric === 'weightKg');
  const measured = weigh.length > 0 ? weigh.reduce((s, m) => s + m.value, 0) / weigh.length : i.observations?.weights?.[0]?.kg;
  const sleepHours = i.observations?.sleep?.hours ?? (() => {
    const s = i.entries.find((e): e is Extract<LogEntry, { kind: 'sleep' }> => e.kind === 'sleep');
    return s ? hoursBetween(s.bedAt, s.wakeAt) : undefined;
  })();
  const steps = i.observations?.steps?.value ?? i.entries.find((e): e is Extract<LogEntry, { kind: 'steps' }> => e.kind === 'steps')?.steps;
  const fast = fastState(rx, i.entries, i.now);
  const items = (i.logged?.loggedDay.items ?? []).map((o) => ({ itemId: o.itemId, status: o.status, ...(o.credit !== null ? { credit: o.credit } : {}) }));

  return {
    date: i.date,
    tz: i.tz,
    rolloverH: i.rolloverH,
    mode: i.plan && (i.plan.status === 'active' || i.plan.status === 'paused' || i.plan.status === 'scheduled') ? 'living' : 'planning',
    minimalMode: i.minimalMode,
    quietMode: i.quietMode,
    plan: i.plan && i.version
      ? { id: i.plan.id, name: i.plan.name, rung: i.plan.rung, day: planDay(i.plan, i.date) + 1, of: planLength(i.plan), status: i.plan.status, version: i.version.version }
      : null,
    prescription: rx,
    logged: {
      entries: i.entries.map(summarise),
      totals: { energyKcal: totals.energyKcal, proteinG: totals.proteinG, carbG: totals.carbG, fatG: totals.fatG, fibreG: totals.fibreG },
      items,
      ...(fast ? { fast } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(sleepHours !== undefined ? { sleepHours } : {}),
    },
    remaining: rx && !i.quietMode
      ? {
          energyKcal: rx.energyKcal - totals.energyKcal.value,
          proteinG: rx.macros.proteinG - totals.proteinG.value,
          carbG: rx.macros.carbG - totals.carbG.value,
          fatG: rx.macros.fatG - totals.fatG.value,
        }
      : null,
    checklist: rx ? checklist(i, rx) : [],
    adherence: { today: i.quietMode ? null : score, a7: i.quietMode ? null : i.trend.a7, a28: i.quietMode ? null : i.trend.a28, daysLogged7: i.trend.daysLogged7, spark: i.quietMode ? [] : i.trend.spark },
    drift: i.drift ? i.drift.goals.map((g) => ({ metric: g.metric, state: g.state, goalDate: g.goalDate, text: g.text })) : null,
    trendWeight: i.trendWeight && i.forecastToday
      ? { kg: i.trendWeight.kg, sd: i.trendWeight.sd, todayExpected: i.forecastToday, ...(measured !== undefined ? { measured } : {}) }
      : null,
    checkIn: i.checkIn,
    biometrics: i.observations
      ? {
          ...(i.observations.sleep ? { lastNight: { hours: i.observations.sleep.hours, ...(i.observations.sleep.efficiencyPct !== undefined ? { efficiency: i.observations.sleep.efficiencyPct } : {}), source: i.observations.sleep.source } } : {}),
          ...(i.observations.restingHr ? { restingHr: { value: i.observations.restingHr.bpm, vsBaseline: i.observations.restingHr.vsBaseline ?? 0 } } : {}),
          ...(i.observations.hrv ? { hrv: i.observations.hrv } : {}),
          flags: i.observations.flags ?? [],
        }
      : null,
    notices,
    coachPrompts,
  };
}

/** Local clock hour of an instant (fast timers on Today). */
export function clockOf(at: Instant, tz: string): ClockH {
  return instantToLocal(at, tz).clockH;
}
