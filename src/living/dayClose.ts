/**
 * The day close (r063 A34; energy SPEC §V3.7, PLANNER_V2 §7.5 row 1, D10): when an app day closes, the re-plan triggers
 * read it — `pickReplan` over the closed day's item outcomes, its observed energy against the target and its approved
 * exercise against the plan's exercise energy (EAT). Pure; `projectLiving` runs it on every read for yesterday.
 *
 *  - `forecastOnly` (only the training went beyond the plan, by more than 15 % of the planned EAT): the forecast updates —
 *    the realised history already replays the approved actuals, so every forecast read from the projection's schedule
 *    carries them — and food stays exactly as planned. No command, no plan version: an info notice says so.
 *  - any other departure: a re-plan is OFFERED (a notice whose command the person taps; `plan.replan` then makes a version
 *    that stays a proposal unless the person's own change only lowers load). Nothing is ever applied from here.
 *
 * Planned EAT = Σ the incremental kcal of the day's own prescribed sessions (the stimulus cost the plan was built with; a
 * session without one is costed from its engine dose on the shared ledger at the plan's body mass). Actual = Σ the
 * incremental kcal of the day's done session entries (approved activities and logs); unknown when any lacks a cost.
 */
import type { ExerciseSession } from '@/engine';
import { boutCost, standardMetGrossKcal } from '@/engine/core/exerciseCost';
import { DISPLACED_BASELINE } from './sensors/activityEnergy';
import { pickReplan, type TriggerDecision, type TriggerInputs } from './replan';
import type { LocalDate, LogEntry, Notice, PrescribedDaySnapshot } from './types';
import type { LoggedDayResult } from './loggedDay';

type Session = Extract<LogEntry, { kind: 'session' }>;

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Incremental kcal of one engine session on the shared ledger (standard rest at `massKg`): its realised gross, else its
 * MET, else (cardio) its stated %VO2max at a known VO2max. Null when it states no dose (unknown, never guessed).
 */
function engineIncremental(s: ExerciseSession, massKg: number, vo2max: number | null): number | null {
  const min = s.durationMin ?? 0;
  if (!(min > 0)) return null;
  const pct = s.kind === 'cardio' ? s.pctVo2max : undefined;
  const met = fin(s.met) && s.met > 0 ? s.met : fin(pct) && pct > 0 && vo2max !== null && vo2max > 0 ? (pct * vo2max) / 3.5 : null;
  const gross = fin(s.realisedGrossKcal) && s.realisedGrossKcal > 0 ? s.realisedGrossKcal : met !== null && massKg > 0 ? standardMetGrossKcal(met, massKg, min) : null;
  if (gross === null) return null;
  return boutCost({ grossKcal: gross, durationMin: min, rmrKcalPerDay: null, bodyMassKg: massKg, displacedFracOfRmr: DISPLACED_BASELINE, method: 'modelled', source: 'derived' }).incrementalKcal;
}

/** The plan's exercise energy of a prescribed day (Σ its sessions' incremental kcal); null when one cannot be costed. */
export function plannedEatKcal(rx: Pick<PrescribedDaySnapshot, 'sessions'>, massKg: number, vo2max: number | null = null): number | null {
  let sum = 0;
  for (const s of rx.sessions) {
    // a usual ("training as usual") session is the habitual energy the engine adds itself, not plan EAT
    if (s.usual) continue;
    const c = s.stimulus?.cost?.incrementalKcal;
    if (fin(c)) {
      sum += c;
      continue;
    }
    let part = 0;
    for (const e of s.engine) {
      const x = engineIncremental(e, massKg, vo2max);
      if (x === null) return null;
      part += x;
    }
    sum += part;
  }
  return sum;
}

/** Incremental kcal of the day's done sessions (approved actuals and logs); null when one has no cost. */
export function actualExerciseKcal(entries: readonly LogEntry[]): number | null {
  let sum = 0;
  for (const e of entries) {
    if (e.kind !== 'session' || e.assumed || (e as Session).status === 'skipped') continue;
    const c = ((e as Session).cost ?? (e as Session).stimulus?.cost)?.incrementalKcal;
    if (!fin(c)) return null;
    sum += c;
  }
  return sum;
}

/** The closed day as the triggers read it. */
export function closedDayOf(i: { date: LocalDate; prescription: PrescribedDaySnapshot; result: LoggedDayResult; entries: readonly LogEntry[]; massKg: number; vo2max?: number | null }): NonNullable<TriggerInputs['closedDay']> {
  const planned = plannedEatKcal(i.prescription, i.massKg, i.vo2max ?? null);
  const actual = actualExerciseKcal(i.entries.filter((e) => e.date === i.date));
  const intake = i.result.observed.energyKcal;
  return {
    date: i.date,
    items: i.result.loggedDay.items,
    ...(i.result.calibrationEligible && fin(intake) && i.prescription.energyKcal > 0 ? { energy: { target: i.prescription.energyKcal, actual: intake } } : {}),
    ...(planned !== null && actual !== null ? { exercise: { incrementalKcal: actual, plannedEatKcal: planned } } : {}),
  };
}

export interface DayClose {
  date: LocalDate;
  closedDay: NonNullable<TriggerInputs['closedDay']>;
  /** The highest-priority trigger the closed day fires (`pickReplan`), or null. */
  decision: TriggerDecision | null;
}

/** Run the triggers on the day that closed (only its own rows: the weekly and event triggers run on their own paths). */
export function dayClose(i: Parameters<typeof closedDayOf>[0] & { today: LocalDate }): DayClose {
  const closedDay = closedDayOf(i);
  const decision = pickReplan({ today: i.today, closedDay, checkInConfirmed: false, declared: [], recent: [], a7: null, scored7: 0, outOfBandDays: 0, requestChanged: false, safetyBindsInDays: null });
  return { date: i.date, closedDay, decision };
}

/**
 * The notice of a day close: `forecastOnly` → information only (the forecast carries the training, food unchanged); any
 * other departure → a re-plan offer the person opens. Null when the day kept to the plan.
 */
export function dayCloseNotice(c: DayClose): Notice | null {
  const d = c.decision;
  if (!d) return null;
  if (d.forecastOnly) return { id: `dayClose:${c.date}`, kind: 'info', level: 'info', text: d.reason };
  return { id: `dayClose:${c.date}`, kind: 'info', level: 'info', text: `${d.reason} You can review a re-plan; nothing changes unless you approve it.`, command: { id: 'plan.replan', input: { reason: 'dayDeparted' } } };
}
