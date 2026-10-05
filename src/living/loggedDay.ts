/**
 * `toLoggedDay` (docs/SUITE_SPEC.md §3.4): one calendar day of a living plan as PLANNER_V2's `LoggedDay` — the engine inputs
 * of what was done (`inputs: DayTemplate`), the outcome and credit of every prescribed item, coverage — plus the realised fast
 * event and the day's adherence score. Pure.
 *
 * Rules:
 *  - meals → absolute energy and macro grams with explicit meals; a T0 food mark → the prescription ("as planned" or
 *    "partly") or habitual maintenance ("not"); no food information → unknown;
 *  - sessions → the logged stimulus (engine sessions resolved by E8 at logging time, else compiled through the injected
 *    `sessionCompiler`, else derived from the stimulus vector); device workouts matched by type and duration; marks;
 *  - fasts → instants; a logged meal inside a prescribed fast ends it there;
 *  - steps device > manual > prescribed-if-as-planned > habitual; sleep device > manual > prescribed (night ending on D);
 *  - substances, supplements and events (illness, stress) become engine inputs;
 *  - UNKNOWN items (no log, no mark, no device) are never failures: they drop out of the score and, for the replay only, are
 *    simulated at their expected credit E[c] from revealed adherence (energy interpolated toward maintenance, session volume
 *    scaled, a fast kept when E[c] ≥ 0.5), flagged `assumedItems`; such days are excluded from the δ estimate's intake gate.
 */
import type { DayTemplate, ExerciseSession, FastEvent, MealSpec } from '@/engine';
import { energyCredit, fastCredit, markCredit, proteinCredit, ratioCredit, scoreDay, windowCredit, type ItemCredit } from './adherence';
import { daysBetween, hoursBetween, instantToLocal, weekdayOf } from './dates';
import type { EquivalenceFn } from './equivalence';
import { mealTotals } from './logs';
import { matchWorkouts, type DayObservations, type ObservedWorkout } from './observations';
import type { ItemOutcome, LoggedDay, PerformedExercise, PlanItemType, StimulusIntent, StimulusVector } from './plannerContract';
import type { AdherenceScore, DayStatusDoc, LocalDate, LogEntry, Mark, MarkBlock, PrescribedDaySnapshot, PrescribedSession } from './types';

export type SessionCompiler = (performed: readonly PerformedExercise[], startH: number) => ExerciseSession[] | null;

export interface LoggedDayInput {
  date: LocalDate;
  /** Plan start (plan-day index of fast events). */
  planStart: LocalDate;
  tz: string;
  prescription: PrescribedDaySnapshot;
  /** Effective entries of this date (edits and retracts resolved). */
  entries: readonly LogEntry[];
  status?: DayStatusDoc | null;
  observations?: DayObservations | null;
  /** E[c] of an item type (revealed adherence; prior mean 0.75 when nothing is known). */
  expected: (type: PlanItemType, weekday: number) => number;
  equivalence?: EquivalenceFn;
  intentByItem?: Record<string, StimulusIntent>;
  sessionCompiler?: SessionCompiler;
  /** `benefitRetained` values (E6) by item id; replace the fast credit forms when present. */
  creditOverrides?: Record<string, number>;
  /** The day is over (rolled over or confirmed); otherwise the score is "so far". */
  final: boolean;
}

export interface LoggedDayResult {
  loggedDay: LoggedDay;
  score: AdherenceScore;
  /** Realised fast starting on this day (plan-day indices), if any. */
  fast: FastEvent | null;
  /** Items simulated at expected credit (unknown). */
  assumedItems: string[];
  /** A non-assumed intake record exists (meals or a food mark): counts for the δ gate. */
  intakeLogged: boolean;
  /** Backfilled day (never scored, never estimated from). */
  assumedDay: boolean;
}

const LOAD_PCT: Record<StimulusVector['loadClass'], number> = { heavy: 85, moderate: 70, light: 50, veryLight: 30 };

/** Engine sessions from a stimulus vector (fallback when no catalogue compiler is wired). */
export function stimulusToEngineSessions(stim: StimulusVector, startH: number, durationMin?: number): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  const sets = Object.values(stim.effectiveSetsByRegion).reduce<number>((a, b) => a + (b ?? 0), 0);
  let t = startH;
  if (sets > 0) {
    const minutes = Math.max(10, Math.round(sets * 2.5));
    out.push({ kind: 'resistance', startH: t, durationMin: minutes, setsByRegion: { ...stim.effectiveSetsByRegion }, loadPct1RM: LOAD_PCT[stim.loadClass] ?? 70 });
    t += minutes / 60;
  }
  const cardioMin = stim.mem > 0 ? stim.mem : 0;
  if (cardioMin > 0) out.push({ kind: 'cardio', modality: 'other', startH: t, durationMin: cardioMin, pctVo2max: stim.hiMinutes > cardioMin / 2 ? 0.85 : 0.6 });
  if (out.length === 0 && durationMin && durationMin > 0) out.push({ kind: 'cardio', modality: 'other', startH, durationMin, pctVo2max: 0.5 });
  return out;
}

const VOLUME_LADDER = ['minimal', 'light', 'moderate', 'high', 'veryHigh'] as const;

/**
 * Scale an engine session's dose by a credit (expected or partial): cardio minutes, resistance sets (or, for a volume
 * preset, the preset one step lower per 25 % missing) and duration. Null when nothing is left.
 */
export function scaleSession(s: ExerciseSession, f: number): ExerciseSession | null {
  if (!(f > 0.01)) return null;
  if (f >= 0.999) return s;
  if (s.kind === 'cardio') return { ...s, durationMin: s.durationMin * f };
  const out: ExerciseSession = { ...s, ...(s.durationMin !== undefined ? { durationMin: s.durationMin * f } : {}) };
  if (s.setsByRegion) {
    const sets: Partial<Record<keyof NonNullable<typeof s.setsByRegion>, number>> = {};
    for (const [r, v] of Object.entries(s.setsByRegion) as Array<[keyof NonNullable<typeof s.setsByRegion>, number | undefined]>) sets[r] = (v ?? 0) * f;
    return { ...out, setsByRegion: sets };
  }
  const idx = VOLUME_LADDER.indexOf(s.volume ?? 'moderate');
  const down = Math.min(idx, Math.round((1 - f) / 0.25));
  return { ...out, volume: VOLUME_LADDER[Math.max(0, idx - down)]! };
}

function itemTypeOfSession(s: PrescribedSession): PlanItemType {
  return s.kind === 'resistance' ? 'rtSession' : 'cardioSession';
}

export function toLoggedDay(i: LoggedDayInput): LoggedDayResult {
  const rx = i.prescription;
  const wd = weekdayOf(i.date);
  const status = i.status ?? null;
  const assumedDay = status?.assumed === true || (i.entries.length > 0 && i.entries.every((e) => e.assumed));
  const marks = status?.marks ?? {};
  const markFor = (b: Exclude<MarkBlock, 'all'>): Mark | undefined => marks[b] ?? marks.all;
  const credits: ItemCredit[] = [];
  const outcomes = new Map<string, ItemOutcome>();
  const assumedItems: string[] = [];
  const itemOf = (id: string) => rx.items.find((x) => x.itemId === id);
  const setItem = (itemId: string, type: PlanItemType, status: ItemOutcome['status'], credit: number | null, why: string, performed?: StimulusVector): void => {
    if (!itemOf(itemId)) return;
    credits.push({ itemId, credit, why });
    outcomes.set(itemId, { itemId, type, status, credit, ...(performed ? { performed } : {}) });
  };
  const statusOf = (c: number): ItemOutcome['status'] => (c >= 0.999 ? 'done' : c <= 0.001 ? 'skipped' : 'partial');
  const t: DayTemplate = { ...rx.template, label: 'as logged' };

  // ------------------------------------------------------------------ intake
  const meals = i.entries.filter((e): e is Extract<LogEntry, { kind: 'meal' }> => e.kind === 'meal');
  const foodMark = markFor('food');
  const totals = mealTotals(meals);
  const mealsComplete = meals.length > 0 && (meals.some((m) => m.complete === true) || foodMark !== undefined || (i.final && meals.length >= Math.max(1, rx.meals.length)));
  const maint = Number.isFinite(rx.maintenanceKcal) ? rx.maintenanceKcal : rx.energyKcal;
  const eTarget = itemOf('energy')?.target.energyKcal ?? rx.energyKcal;
  const pTarget = itemOf('protein')?.target.proteinG ?? rx.macros.proteinG;
  let intakeLogged = false;
  if (meals.length > 0) {
    intakeLogged = !meals.every((m) => m.assumed);
    const expectedKcal = maint + i.expected('energy', wd) * (rx.energyKcal - maint);
    const kcal = mealsComplete ? totals.energyKcal.value : Math.max(totals.energyKcal.value, expectedKcal);
    const f = totals.energyKcal.value > 0 ? kcal / totals.energyKcal.value : 1;
    const mealSpecs: MealSpec[] = meals
      .slice()
      .sort((a, b) => a.clockH - b.clockH)
      .map((m) => ({ clockH: m.clockH, share: Math.max(1e-6, m.totals.energyKcal.value), macros: { proteinG: m.totals.proteinG.value * f, carbG: m.totals.carbG.value * f, fatG: m.totals.fatG.value * f, fibreG: (m.totals.fibreG?.value ?? 0) * f, ...(m.totals.alcoholG ? { alcoholG: m.totals.alcoholG.value * f } : {}) } }));
    t.energy = { kind: 'kcal', kcal };
    t.macros = { ...rx.template.macros, protein: { unit: 'g', value: totals.proteinG.value * f }, carbs: { unit: 'g', value: totals.carbG.value * f }, fat: { unit: 'g', value: totals.fatG.value * f }, fibre: { unit: 'g', value: totals.fibreG.value * f } };
    t.meals = { meals: mealSpecs };
    const gi = meals.find((m) => m.glycaemicIndex !== undefined)?.glycaemicIndex;
    const upf = meals.find((m) => m.upfShare !== undefined)?.upfShare;
    if (gi !== undefined || upf !== undefined) t.food = { ...rx.template.food, ...(gi !== undefined ? { glycaemicIndex: gi } : {}), ...(upf !== undefined ? { upfShare: upf } : {}) };
    if (mealsComplete) {
      setItem('energy', 'energy', statusOf(energyCredit(eTarget, totals.energyKcal.value, maint)), energyCredit(eTarget, totals.energyKcal.value, maint), `ate ${Math.round(totals.energyKcal.value)} of ${Math.round(eTarget)} kcal`);
      setItem('protein', 'protein', statusOf(proteinCredit(pTarget, totals.proteinG.value)), proteinCredit(pTarget, totals.proteinG.value), `${Math.round(totals.proteinG.value)} of ${Math.round(pTarget)} g protein`);
    } else {
      setItem('energy', 'energy', 'unknown', null, 'meals logged so far');
      setItem('protein', 'protein', 'unknown', null, 'meals logged so far');
      assumedItems.push('energy');
    }
    if (rx.window) {
      const c = windowCredit(rx.window.startH, rx.window.endH, meals.map((m) => ({ clockH: m.clockH, kcal: m.totals.energyKcal.value })));
      setItem('window', 'window', statusOf(c), c, 'meals inside the eating window');
    }
  } else if (foodMark) {
    intakeLogged = !assumedDay;
    const c = markCredit(foodMark);
    if (foodMark === 'not') {
      t.energy = { kind: 'pctMaintenance', pct: 100, reference: 'current' };
      t.meals = rx.template.meals;
    }
    setItem('energy', 'energy', statusOf(c), c, `food marked ${foodMark}`);
    setItem('protein', 'protein', statusOf(c), c, `food marked ${foodMark}`);
    if (rx.window) setItem('window', 'window', statusOf(c), c, `food marked ${foodMark}`);
  } else {
    // unknown intake: simulate at expected credit between maintenance and the prescription
    const c = i.expected('energy', wd);
    const e = rx.template.energy;
    if (e.kind === 'pctMaintenance') t.energy = { ...e, pct: 100 + c * (e.pct - 100) };
    else if (e.kind === 'kcal') t.energy = { kind: 'kcal', kcal: maint + c * (e.kcal - maint) };
    else if (c < 0.5) t.energy = { kind: 'pctMaintenance', pct: 100, reference: 'current' };
    setItem('energy', 'energy', 'unknown', null, 'not logged');
    setItem('protein', 'protein', 'unknown', null, 'not logged');
    if (rx.window) setItem('window', 'window', 'unknown', null, 'not logged');
    assumedItems.push('energy', 'protein');
  }

  // ------------------------------------------------------------------ sessions
  // a device workout logged by `log.fromBiometrics` is a device workout, not a session the person logged: it is matched
  // like one, and dropped when the observations already carry the same record
  const allSessions = i.entries.filter((e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session');
  const observed = i.observations?.workouts ?? [];
  const deviceLogged = allSessions.filter((e) => e.source.by === 'device' && e.bioWorkoutId && e.workout && e.startH !== undefined && e.durationMin !== undefined);
  const sessionLogs = allSessions.filter((e) => !deviceLogged.includes(e));
  const seen = new Set(observed.flatMap((w) => [w.recordId, ...(w.aliases ?? [])]));
  const workouts: ObservedWorkout[] = [
    ...observed,
    ...deviceLogged
      .filter((e) => !seen.has(e.bioWorkoutId!))
      .map((e): ObservedWorkout => ({
        recordId: e.bioWorkoutId!,
        startH: e.startH!,
        durationMin: e.durationMin!,
        exerciseType: e.workout!.exerciseType,
        kind: e.workout!.kind,
        ...(e.workout!.activeKcal !== undefined ? { activeKcal: e.workout!.activeKcal } : {}),
        ...(e.hr?.avgBpm !== undefined ? { avgHrBpm: e.hr.avgBpm } : {}),
        source: 'a device',
      })),
  ];
  const usedLogs = new Set<string>();
  const matches = matchWorkouts(rx.sessions, workouts);
  const usedWorkouts = new Set(matches.map((m) => m.recordId));
  const exercise: ExerciseSession[] = [];
  const trainMark = markFor('train');
  for (const s of rx.sessions) {
    const type = itemTypeOfSession(s);
    const itemId = `${type}:${s.slotKey}`;
    const log = sessionLogs.find((e) => e.itemId === itemId || e.itemId === s.slotKey);
    if (log) {
      usedLogs.add(log.id);
      if (log.status === 'skipped') {
        setItem(itemId, type, 'skipped', 0, 'session skipped');
        continue;
      }
      let credit: number;
      let why: string;
      if (s.stimulus && i.equivalence) {
        const r = i.equivalence(s.stimulus, log.stimulus, i.intentByItem?.[itemId]);
        credit = r.credit;
        why = r.parity ? 'counts as the planned session' : (r.shortfall[0]?.text ?? 'partly matched the planned session');
      } else if (log.status === 'done') {
        credit = 1;
        why = 'session done';
      } else {
        credit = log.durationMin && s.durationMin > 0 ? Math.min(1, log.durationMin / s.durationMin) : 0.5;
        why = 'session partly done';
      }
      setItem(itemId, type, log.status === 'done' && credit >= 0.999 ? 'done' : statusOf(credit), credit, why, log.stimulus);
      const eng = log.engine ?? i.sessionCompiler?.(log.performed, log.startH ?? s.startH) ?? null;
      if (eng && eng.length > 0) exercise.push(...eng);
      else if (log.status === 'done' && (!s.stimulus || credit >= 0.999)) exercise.push(...s.engine);
      else exercise.push(...stimulusToEngineSessions(log.stimulus, log.startH ?? s.startH, log.durationMin));
      continue;
    }
    const m = matches.find((x) => x.slotKey === s.slotKey);
    if (m) {
      setItem(itemId, type, m.status, m.ratio, `recorded by ${workouts.find((w) => w.recordId === m.recordId)?.source ?? 'a device'}`);
      for (const e of s.engine) {
        const sc = scaleSession(e, m.ratio);
        if (sc) exercise.push(sc);
      }
      continue;
    }
    if (trainMark) {
      const c = markCredit(trainMark);
      setItem(itemId, type, statusOf(c), c, `training marked ${trainMark}`);
      for (const e of s.engine) {
        const sc = scaleSession(e, c);
        if (sc) exercise.push(sc);
      }
      continue;
    }
    const c = i.expected(type, wd);
    setItem(itemId, type, 'unknown', null, 'not logged');
    assumedItems.push(itemId);
    for (const e of s.engine) {
      const sc = scaleSession(e, c);
      if (sc) exercise.push(sc);
    }
  }
  for (const log of sessionLogs) {
    if (usedLogs.has(log.id) || log.status === 'skipped') continue;
    const eng = log.engine ?? i.sessionCompiler?.(log.performed, log.startH ?? 18) ?? stimulusToEngineSessions(log.stimulus, log.startH ?? 18, log.durationMin);
    exercise.push(...eng);
  }
  for (const w of workouts) {
    if (usedWorkouts.has(w.recordId)) continue;
    exercise.push(w.kind === 'resistance' ? { kind: 'resistance', startH: w.startH, durationMin: w.durationMin, volume: 'light' } : { kind: 'cardio', modality: 'other', startH: w.startH, durationMin: w.durationMin });
  }
  t.exercise = exercise.sort((a, b) => a.startH - b.startH);
  if (rx.template.habitualTraining && rx.sessions.length === 0 && sessionLogs.length === 0 && workouts.length === 0) t.habitualTraining = true;
  else t.habitualTraining = false;

  // ------------------------------------------------------------------ fast
  let fast: FastEvent | null = null;
  const fastLog = i.entries.find((e): e is Extract<LogEntry, { kind: 'fast' }> => e.kind === 'fast');
  const fastMark = markFor('fast');
  const rxFast = rx.fastEvent ?? null;
  const startsToday = (ev: FastEvent): boolean => ev.startDay === rx.planDay;
  if (fastLog) {
    const start = instantToLocal(fastLog.lastIntakeAt, i.tz);
    const startDay = daysBetween(i.planStart, start.date);
    const achieved = fastLog.firstIntakeAt ? hoursBetween(fastLog.lastIntakeAt, fastLog.firstIntakeAt) : null;
    if (achieved !== null) fast = { kind: 'fast', startDay, startH: start.clockH, durationH: achieved, ...(fastLog.electrolytes ? { electrolytes: true } : {}) };
    else if (rxFast) fast = { ...rxFast, startDay, startH: start.clockH };
    if (rx.fast) {
      if (achieved !== null) {
        const c = fastCredit(rx.fast.hours, achieved);
        setItem('fast', 'fast', fastLog.broken ? (c > 0 ? 'partial' : 'skipped') : statusOf(c), c, `fasted ${Math.round(achieved)} of ${Math.round(rx.fast.hours)} h`);
      } else setItem('fast', 'fast', 'unknown', null, 'fast running');
    }
  } else if (rx.fast && rxFast) {
    // a logged meal inside the prescribed fast ends it there
    const rxStart = Date.parse(rx.fast.lastIntakeAt);
    const rxEnd = Date.parse(rx.fast.firstIntakeAt);
    const firstMealInside = meals
      .filter((m) => !m.assumed)
      .map((m) => (m.at ? Date.parse(m.at) : NaN))
      .filter((ms) => Number.isFinite(ms) && ms > rxStart && ms < rxEnd)
      .sort((a, b) => a - b)[0];
    if (firstMealInside !== undefined) {
      const achieved = (firstMealInside - rxStart) / 3_600_000;
      const c = fastCredit(rx.fast.hours, achieved);
      setItem('fast', 'fast', c > 0 ? 'partial' : 'skipped', c, `fast ended after ${Math.round(achieved)} h`);
      if (startsToday(rxFast)) fast = { ...rxFast, durationH: achieved };
    } else if (fastMark) {
      const c = markCredit(fastMark);
      setItem('fast', 'fast', statusOf(c), c, `fast marked ${fastMark}`);
      if (startsToday(rxFast) && c > 0) fast = c >= 0.999 ? rxFast : { ...rxFast, durationH: Math.max(1, rx.fast.hours * c) };
    } else {
      const c = i.expected('fast', wd);
      setItem('fast', 'fast', 'unknown', null, 'not logged');
      assumedItems.push('fast');
      if (startsToday(rxFast) && c >= 0.5) fast = rxFast;
    }
  } else if (itemOf('fast')) {
    // a zero-energy day without an event: the food information decides
    const c = meals.length > 0 ? (totals.energyKcal.value <= 50 ? 1 : 0) : foodMark ? markCredit(foodMark) : null;
    setItem('fast', 'fast', c === null ? 'unknown' : statusOf(c), c, c === null ? 'not logged' : 'water-only day');
  }

  // ------------------------------------------------------------------ steps, sleep
  const stepsLog = i.entries.find((e): e is Extract<LogEntry, { kind: 'steps' }> => e.kind === 'steps');
  const devSteps = i.observations?.steps?.value;
  const steps = devSteps ?? stepsLog?.steps;
  if (steps !== undefined) {
    t.steps = steps;
    if (rx.steps !== undefined) setItem('steps', 'steps', statusOf(ratioCredit(rx.steps, steps)), ratioCredit(rx.steps, steps), devSteps !== undefined ? `${Math.round(steps)} steps (device)` : `${Math.round(steps)} steps`);
  } else if (rx.steps !== undefined) {
    if (marks.all === 'asPlanned' || markFor('train') === 'asPlanned') {
      t.steps = rx.steps;
      setItem('steps', 'steps', 'done', 1, 'marked as planned');
    } else {
      // replay: habitual steps (engine default) unless revealed adherence says otherwise
      const c = i.expected('steps', wd);
      if (c < 0.5) delete t.steps;
      setItem('steps', 'steps', 'unknown', null, 'not logged');
      assumedItems.push('steps');
    }
  }
  const sleepLog = i.entries.find((e): e is Extract<LogEntry, { kind: 'sleep' }> => e.kind === 'sleep');
  const dev = i.observations?.sleep;
  let sleepH: number | undefined;
  if (dev) {
    t.sleep = { ...t.sleep, bedH: dev.bedH, wakeH: dev.wakeH, hours: dev.hours, ...(dev.quality ? { quality: dev.quality } : {}) };
    sleepH = dev.hours;
  } else if (sleepLog) {
    const bed = instantToLocal(sleepLog.bedAt, i.tz);
    const wake = instantToLocal(sleepLog.wakeAt, i.tz);
    sleepH = hoursBetween(sleepLog.bedAt, sleepLog.wakeAt);
    t.sleep = { ...t.sleep, bedH: bed.clockH, wakeH: wake.clockH, hours: sleepH, ...(sleepLog.quality ? { quality: sleepLog.quality } : {}) };
  }
  const sleepTarget = itemOf('sleep')?.target.hours;
  if (sleepTarget !== undefined) {
    if (sleepH !== undefined) setItem('sleep', 'sleep', statusOf(ratioCredit(sleepTarget, sleepH)), ratioCredit(sleepTarget, sleepH), `${sleepH.toFixed(1)} h asleep`);
    else setItem('sleep', 'sleep', 'unknown', null, 'not logged');
  }

  // ------------------------------------------------------------------ substances, supplements, events
  const subs = { ...(t.substances ?? {}) };
  for (const e of i.entries) {
    if (e.kind === 'substance') {
      if (e.substance === 'caffeine') subs.caffeine = [...(subs.caffeine ?? []), { clockH: e.clockH, mg: e.unit === 'mg' ? e.amount : e.amount * 1000 }];
      else if (e.substance === 'alcohol') subs.alcohol = [...(subs.alcohol ?? []), { clockH: e.clockH, drinks: e.unit === 'drinks' ? e.amount : e.amount / 14 }];
      else if (e.substance === 'creatine') subs.creatineG = (subs.creatineG ?? 0) + e.amount;
      else subs.exogenousKetones = [...(subs.exogenousKetones ?? []), { clockH: e.clockH, gBhb: e.amount, form: 'salt' }];
    } else if (e.kind === 'supplement' && e.supplementId === 'creatine' && e.unit === 'g') subs.creatineG = (subs.creatineG ?? 0) + e.dose;
  }
  if (Object.keys(subs).length > 0) t.substances = subs;
  for (const s of rx.supplements) {
    const id = `supplement:${s.supplementId}`;
    const logged = i.entries.some((e) => e.kind === 'supplement' && e.supplementId === s.supplementId);
    if (logged) setItem(id, 'supplement', 'done', 1, 'taken');
    else if (marks.all) setItem(id, 'supplement', statusOf(markCredit(marks.all)), markCredit(marks.all), `day marked ${marks.all}`);
    else setItem(id, 'supplement', 'unknown', null, 'not logged');
  }
  const ill = i.entries.some((e) => (e.kind === 'event' && e.event === 'illness') || (e.kind === 'subjective' && e.illness === true));
  const stress = i.entries.find((e): e is Extract<LogEntry, { kind: 'subjective' }> => e.kind === 'subjective' && e.stress !== undefined)?.stress;
  if (ill || stress) t.modifiers = { ...t.modifiers, ...(ill ? { illness: true } : {}), ...(stress ? { stress } : {}) };

  // ------------------------------------------------------------------ remaining items, overrides, score
  for (const it of rx.items) if (!outcomes.has(it.itemId)) setItem(it.itemId, it.type, 'unknown', null, 'not logged');
  if (i.creditOverrides) {
    for (const c of credits) {
      const v = i.creditOverrides[c.itemId];
      if (v !== undefined && c.credit !== null) {
        c.credit = v;
        c.why = `${c.why} (benefit kept: ${Math.round(100 * v)} %)`;
        const o = outcomes.get(c.itemId)!;
        outcomes.set(c.itemId, { ...o, credit: v, status: statusOf(v) });
      }
    }
  }
  if (assumedDay) {
    // backfilled day: "as planned" for the replay, never scored
    for (const c of credits) c.credit = null;
  }
  const score = scoreDay(rx.items, credits, { final: i.final, assumed: assumedDay, ...(rx.paused ? { paused: true } : {}) });
  const loggedDay: LoggedDay = {
    date: i.date,
    inputs: t,
    items: rx.items.map((it) => outcomes.get(it.itemId)!).map((o) => (assumedDay ? { ...o, status: 'unknown' as const, credit: null } : o)),
    coverage: score.coverage,
  };
  return { loggedDay, score, fast, assumedItems: [...new Set(assumedItems)], intakeLogged: intakeLogged && !assumedDay, assumedDay };
}
