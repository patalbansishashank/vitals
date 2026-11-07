/**
 * Today data contract (docs/SUITE_SPEC.md §3.9, `today.get`): one object feeds the Today screen and the Coach — what to eat
 * and when, sessions, what to log (one-tap checklist actions are commands), what was logged with its sources, what is
 * left, today's adherence "so far" with the 7/28-day trend, the trend weight against today's forecast band, drift and
 * goal-date shifts, check-in state and notices. Pure: the caller (E4's `today.get` executor) gathers the
 * documents and derived results; this module only assembles and decides.
 */
import { coverageLabel, costliestItem } from './adherence';
import { hoursBetween, instantToLocal } from './dates';
import { mealTotals, summarise } from './logs';
import { entryOccurrence, intakeCaloricStatus, occurrenceWindowMs } from './occurrence';
import { observedSleep, type LoggedDayResult } from './loggedDay';
import type { PersonProfile } from '@/engine';
import { contentHash } from '@/lib/bodyContracts';
import { exerciseSymptomGate } from '@/lib/safetyPolicy';
import { currentSymptoms, documentedBaselineSteps } from './lifecycleSafety';
import { CURRENT_EXERCISE_ELIGIBILITY_VERSION } from './types';
import type {
  AdherenceTrend,
  ClockH,
  CurrentExerciseEligibility,
  ExerciseScope,
  PrescribedSession,
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
  lapse: { welcomeBack: boolean; gap: LocalDate[] };
  /** Notices from elsewhere (safety, proposals, sync, pending Coach changes). */
  notices?: readonly Notice[];
  /** (D4-02/A1-005) The current exercise eligibility of today's unperformed recommendations (`currentExerciseEligibility`). */
  exerciseEligibility?: CurrentExerciseEligibility | null;
}

function fastState(rx: PrescribedDaySnapshot | null, entries: readonly LogEntry[], now: Instant, tz: string, rolloverH: number): TodayView['logged']['fast'] {
  const log = entries.find((e): e is Extract<LogEntry, { kind: 'fast' }> => e.kind === 'fast');
  const target = rx?.fast?.hours;
  if (log) {
    if (log.firstIntakeAt) return { state: log.broken ? 'broken' : 'done', sinceH: hoursBetween(log.lastIntakeAt, log.firstIntakeAt), endedClockH: clockOf(log.firstIntakeAt, tz) };
    const since = hoursBetween(log.lastIntakeAt, now);
    return { state: 'running', sinceH: since, ...(target !== undefined ? { remainingH: Math.max(0, target - since) } : {}) };
  }
  if (!rx?.fast) return undefined;
  const since = hoursBetween(rx.fast.lastIntakeAt, now);
  if (since < 0) return { state: 'notStarted' };
  // a verified intake inside the prescribed fast, by when it happened (C1: never the entry's audit time)
  const lo = Date.parse(rx.fast.lastIntakeAt);
  const hi = Date.parse(rx.fast.firstIntakeAt);
  // the earliest such intake ends the fast at its observed instant (D5-05: the counted length and the end clock)
  let endMs = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    if (e.assumed) continue;
    // the shared caloric classifier (meals, alcohol, an ingested BHB dose): a known zero never ends the fast
    const cs = intakeCaloricStatus(e);
    if (!cs || cs.status === 'zero') continue;
    const o = entryOccurrence(e, { tz, rolloverH });
    const w = o.precision === 'exact' ? occurrenceWindowMs(o, tz, rolloverH) : null;
    if (w !== null && w.startMs > lo && w.startMs < hi && w.startMs < endMs) endMs = w.startMs;
  }
  if (Number.isFinite(endMs)) {
    const end = new Date(endMs).toISOString();
    return { state: 'broken', sinceH: hoursBetween(rx.fast.lastIntakeAt, end), endedClockH: clockOf(end, tz) };
  }
  if (since >= rx.fast.hours) return { state: 'done', sinceH: rx.fast.hours };
  return { state: 'running', sinceH: since, remainingH: rx.fast.hours - since };
}

function checklist(i: TodayInput, rx: PrescribedDaySnapshot): TodayChecklistItem[] {
  const out: TodayChecklistItem[] = [];
  const has = (k: LogEntry['kind']): boolean => i.entries.some((e) => e.kind === k);
  const weighed = i.measurements.some((m) => m.metric === 'weightKg');
  out.push({ id: 'weigh', ...(i.plan?.intentions.weighInClockH !== undefined ? { at: i.plan.intentions.weighInClockH } : {}), kind: 'weigh', label: 'Weigh in', done: weighed, command: { id: 'log.measurement', input: { date: i.date, metric: 'weightKg' } } });
  const marks = i.status?.marks ?? {};
  out.push({ id: 'mark:all', kind: 'mark', label: 'Day as planned', done: marks.all !== undefined, command: { id: 'log.markDay', input: { date: i.date, marks: { all: 'asPlanned' } } } });
  if (i.minimalMode) return out;
  const planned = new Set(rx.meals.map((m) => m.slot));
  for (const m of rx.meals) {
    // a meal logged against a planned slot counts for that slot only; other meals count for the slot at about their time
    const ate = i.entries.some((e) => e.kind === 'meal' && (e.slot && planned.has(e.slot) ? e.slot === m.slot : Math.abs(e.clockH - m.clockH) <= 2));
    // the meal's own answer (partly, not) is that meal's alone; the day-wide marks answer every meal
    const answered = marks.meals?.[m.slot] !== undefined || marks.food !== undefined || marks.all !== undefined;
    out.push({ id: `meal:${m.slot}`, at: m.clockH, kind: 'meal', label: `Meal at ${fmtClock(m.clockH)}`, done: ate || answered, command: { id: 'log.meal', input: { date: i.date, slot: m.slot, clockH: m.clockH } } });
  }
  for (const s of rx.sessions) {
    // a session the current eligibility holds is not recommended now (its hold reads as Review; logging stays open)
    if (sessionHeld(s, i.exerciseEligibility)) continue;
    const itemId = `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`;
    const done = i.entries.some((e) => e.kind === 'session' && (e.itemId === itemId || e.itemId === s.slotKey)) || marks.train !== undefined || marks.all !== undefined;
    out.push({ id: `session:${s.slotKey}`, at: s.startH, kind: 'session', label: s.kind === 'resistance' ? 'Strength session' : 'Cardio session', done, command: { id: 'log.session', input: { date: i.date, slotKey: s.slotKey, status: 'done' } } });
  }
  if (rx.fast) out.push({ id: 'fast', kind: 'fast', label: `Fast ${Math.round(rx.fast.hours)} h`, done: has('fast') || marks.fast !== undefined, command: { id: 'log.fast', input: { action: 'record' } } });
  for (const s of rx.supplements) {
    out.push({ id: `supplement:${s.supplementId}`, ...(s.clockH !== undefined ? { at: s.clockH } : {}), kind: 'supplement', label: s.supplementId, done: i.entries.some((e) => e.kind === 'supplement' && e.supplementId === s.supplementId), command: { id: 'log.supplement', input: { date: i.date, supplementId: s.supplementId, dose: s.dose, unit: s.unit } } });
  }
  // logging steps stays a prompt even when the step target is held (monitoring never depends on eligibility)
  if (rx.steps !== undefined || i.prescription?.steps !== undefined) out.push({ id: 'steps', kind: 'steps', label: 'Steps', done: has('steps'), command: { id: 'log.steps', input: { date: i.date } } });
  out.push({ id: 'sleep', kind: 'sleep', label: 'Last night’s sleep', done: has('sleep'), command: { id: 'log.sleep', input: { date: i.date } } });
  // the weigh-in leads the morning when no time was chosen; untimed taps come last
  const key = (c: TodayChecklistItem): number => c.at ?? (c.kind === 'weigh' ? 0 : 23.5);
  return out.sort((a, b) => key(a) - key(b));
}

/** (D8-06) Last night's asleep hours as logged: the union of the day's episodes (an overlap counts once), never modelled. */
const sleepOf = (entries: readonly LogEntry[]) => observedSleep(entries.filter((e): e is Extract<LogEntry, { kind: 'sleep' }> => e.kind === 'sleep' && !e.assumed));
const stepsOf = (entries: readonly LogEntry[]): number | undefined => entries.find((e): e is Extract<LogEntry, { kind: 'steps' }> => e.kind === 'steps')?.steps;

function fmtClock(h: ClockH): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------- current exercise eligibility (D4-02)
/**
 * (D4-02/A1-005) The CURRENT exercise eligibility of unperformed current/future recommendations: one pure evaluation of the
 * current screening answer, the symptom reports and resolutions (profile + logged, latest per category), the clinician
 * envelopes with their current dates and the documented baseline, with the shared gate's semantics
 * (`exerciseSymptomGate`, as screening, planner and lifecycle checks read it). It is an overlay: the adopted schedule and
 * the frozen prescription snapshots stay as historical provenance, logged exercise and steps are never rewritten.
 *  - clear: everything as prescribed;
 *  - an unresolved concerning symptom without a covering envelope (or an open legacy screening answer): autonomous new
 *    sessions are held (the person's own "training as usual" routine is not autonomous progression) and steps never exceed
 *    the documented baseline; with no documented baseline there is no numeric step target (never a 3000/12000 default);
 *  - a covering, current envelope restores exactly what it permits (progression and named domains; its own step ceiling,
 *    else the baseline unless walking/steps progression is permitted). A revoked or overdue envelope restores nothing.
 * No clinical cutoff or clearance duration is introduced here.
 */
export function currentExerciseEligibility(i: { profile: PersonProfile; entries: readonly LogEntry[]; asOf: LocalDate; prescribedSteps?: number | null }): CurrentExerciseEligibility {
  const flags = i.profile.safety?.flags;
  const symptoms = currentSymptoms(i.profile, i.entries);
  const screening = flags?.faintingOrChestPain ? 'yes' : (flags?.answers?.faintingOrChestPain ?? null);
  const g = exerciseSymptomGate({ screening, symptoms, envelopes: flags?.exerciseEnvelopes ?? [], today: i.asOf });
  const baseline = documentedBaselineSteps(i.profile);
  const env = g.envelope;
  const permittedNew = (scope: ExerciseScope): boolean => g.status === 'clear' || (g.allowsNewExercise && !!env && env.permitted.includes(scope));
  const scopes: ExerciseScope[] = ['resistance', 'cardio', 'walking', 'steps', 'other'];
  const stepsFree = g.steps === 'free';
  const permitted = scopes.filter((s) => (s === 'steps' || s === 'walking' ? stepsFree || (env?.permitted.includes(s) ?? false) : permittedNew(s)));
  const held = scopes.filter((s) => !permitted.includes(s));
  const envCeiling = env && typeof env.stepsCeiling === 'number' && Number.isFinite(env.stepsCeiling) ? env.stepsCeiling : null;
  const ceiling = stepsFree ? null : (envCeiling ?? baseline);
  const ceilingSource: CurrentExerciseEligibility['steps']['ceilingSource'] = stepsFree ? 'none' : envCeiling !== null ? 'clinicianCeiling' : baseline !== null ? 'documentedBaseline' : 'none';
  const rxSteps = i.prescribedSteps !== undefined && i.prescribedSteps !== null && Number.isFinite(i.prescribedSteps) ? i.prescribedSteps : null;
  let steps: CurrentExerciseEligibility['steps'];
  if (stepsFree || rxSteps === null) steps = { status: 'unchanged', target: rxSteps, prescribed: rxSteps, ceiling, ceilingSource };
  else if (ceiling === null) steps = { status: 'noNumericTarget', target: null, prescribed: rxSteps, ceiling: null, ceilingSource };
  else steps = rxSteps > ceiling ? { status: 'capped', target: ceiling, prescribed: rxSteps, ceiling, ceilingSource } : { status: 'unchanged', target: rxSteps, prescribed: rxSteps, ceiling, ceilingSource };
  const fingerprint = contentHash({
    v: CURRENT_EXERCISE_ELIGIBILITY_VERSION,
    asOf: i.asOf,
    screening,
    symptoms: symptoms.map((s) => [s.id, s.category, s.status, s.context ?? null, s.occurredOn ?? null]),
    envelopes: (flags?.exerciseEnvelopes ?? []).map((e) => [e.id, e.assessedAt, e.reviewBy ?? null, e.revokedAt ?? null, e.progressionAllowed, [...e.permitted], e.stepsCeiling ?? null, [...(e.coversSymptomIds ?? [])]]),
    baseline,
  });
  return {
    version: CURRENT_EXERCISE_ELIGIBILITY_VERSION,
    asOf: i.asOf,
    status: g.status,
    reasonCode: g.reasonCode,
    allowsNewExercise: g.allowsNewExercise,
    allowsProgression: g.allowsProgression,
    permitted,
    held,
    steps,
    symptomIds: [...g.uncovered],
    ...(env ? { envelopeId: env.id } : {}),
    fingerprint,
  };
}

/** Whether a prescribed session is held by the current eligibility (usual "training as usual" sessions never are). */
export function sessionHeld(s: PrescribedSession, e: CurrentExerciseEligibility | null | undefined): boolean {
  if (!e || s.usual) return false;
  return e.held.includes(s.kind === 'resistance' ? 'resistance' : 'cardio');
}

/**
 * The current/future prescription with the eligibility overlay applied to its unperformed step instruction: capped at the
 * ceiling, or no numeric target. Sessions stay listed (the eligibility names the held ones); nothing else changes and the
 * original snapshot object is not modified.
 */
export function overlayPrescription(rx: PrescribedDaySnapshot, e: CurrentExerciseEligibility | null | undefined): PrescribedDaySnapshot {
  if (!e || rx.steps === undefined || e.steps.status === 'unchanged') return rx;
  if (e.steps.status === 'noNumericTarget') {
    const { steps: _held, ...rest } = rx;
    void _held;
    return rest;
  }
  return { ...rx, steps: e.steps.target ?? rx.steps };
}

/**
 * One short inline status per held scope of an adopted prescription (details in the safety sheet): 'symptomHold' when a
 * held session is prescribed, 'stepsHold' when the step target is capped or has no number. Ids already in `existing` are
 * not repeated.
 */
export function eligibilityNotices(rx: PrescribedDaySnapshot | null, e: CurrentExerciseEligibility | null | undefined, existing: readonly Notice[] = []): Notice[] {
  if (!rx || !e || e.status === 'clear') return [];
  const out: Notice[] = [];
  const has = (id: string) => existing.some((n) => n.id === id);
  const replan = { id: 'plan.replan', input: { reason: 'symptom' } };
  if (rx.sessions.some((s) => sessionHeld(s, e)) && !has('symptomHold')) out.push({ id: 'symptomHold', kind: 'safety', level: 'caution', text: e.status === 'review' ? 'Review: exercise on hold.' : 'Exercise on hold: a symptom is unresolved.', command: replan });
  if (!has('stepsHold')) {
    if (e.steps.status === 'capped') out.push({ id: 'stepsHold', kind: 'safety', level: 'caution', text: `Review: steps up to ${Math.round(e.steps.target ?? 0)}/day.`, command: replan });
    else if (e.steps.status === 'noNumericTarget') out.push({ id: 'stepsHold', kind: 'safety', level: 'caution', text: 'Review: no step target.', command: replan });
  }
  return out;
}

export function buildTodayView(i: TodayInput): TodayView {
  const adopted = i.prescription;
  // (D4-02/A1-005) the unperformed step instruction follows the current eligibility; the adopted snapshot is provenance
  const rx = adopted ? overlayPrescription(adopted, i.exerciseEligibility) : null;
  const totals = mealTotals(i.entries);
  const notices: Notice[] = [...(i.notices ?? [])];
  notices.push(...eligibilityNotices(adopted, i.exerciseEligibility, notices));
  if (i.lapse.welcomeBack) {
    notices.push({ id: 'welcomeBack', kind: 'welcomeBack', level: 'info', text: 'Welcome back, nothing to catch up on.', command: { id: 'log.bulk', input: { days: i.lapse.gap.map((date) => ({ date, entries: [], marks: { all: 'asPlanned' }, assumed: true })) } } });
  }
  // (D5-06) a short status word; the sheet confirms it (closing never does)
  if (i.checkIn.due) notices.push({ id: 'checkIn', kind: 'checkIn', level: 'info', text: 'Check-in ready', command: { id: 'plan.checkIn', input: {} } });
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

  const weigh = i.measurements.filter((m) => m.metric === 'weightKg');
  const measured = weigh.length > 0 ? weigh.reduce((s, m) => s + m.value, 0) / weigh.length : undefined;
  const sleep = sleepOf(i.entries);
  const sleepHours = sleep?.hours;
  const sleepQuality = sleep?.main?.quality;
  const steps = stepsOf(i.entries);
  const fast = fastState(rx, i.entries, i.now, i.tz, i.rolloverH);
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
    ...(i.exerciseEligibility ? { exerciseEligibility: i.exerciseEligibility } : {}),
    logged: {
      entries: i.entries.map(summarise),
      measurements: [...i.measurements],
      totals: { energyKcal: totals.energyKcal, proteinG: totals.proteinG, carbG: totals.carbG, fatG: totals.fatG, fibreG: totals.fibreG },
      items,
      ...(fast ? { fast } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(sleepHours !== undefined ? { sleepHours } : {}),
      ...(sleepQuality ? { sleepQuality } : {}),
    },
    remaining: rx && !i.quietMode
      ? {
          energyKcal: rx.energyKcal - totals.energyKcal.value,
          proteinG: rx.macros.proteinG - totals.proteinG.value,
          carbG: rx.macros.carbG - totals.carbG.value,
          fatG: rx.macros.fatG - totals.fatG.value,
        }
      : null,
    ...(i.status?.marks ? { marks: i.status.marks } : {}),
    ...(i.status?.intake ? { intake: i.status.intake } : {}),
    ...(i.logged?.coverage ? { coverage: i.logged.coverage } : {}),
    checklist: rx ? checklist(i, rx) : [],
    adherence: { today: i.quietMode ? null : score, a7: i.quietMode ? null : i.trend.a7, a28: i.quietMode ? null : i.trend.a28, daysLogged7: i.trend.daysLogged7, spark: i.quietMode ? [] : i.trend.spark },
    drift: i.drift ? i.drift.goals.map((g) => ({ metric: g.metric, state: g.state, goalDate: g.goalDate, text: g.text })) : null,
    trendWeight: i.trendWeight && i.forecastToday
      ? { kg: i.trendWeight.kg, sd: i.trendWeight.sd, todayExpected: i.forecastToday, ...(measured !== undefined ? { measured } : {}) }
      : null,
    checkIn: i.checkIn,
    notices,
    coachPrompts,
  };
}

/** Local clock hour of an instant (fast timers on Today). */
export function clockOf(at: Instant, tz: string): ClockH {
  return instantToLocal(at, tz).clockH;
}
