/**
 * Everything the schedule screen derives from the scenario, computed once per schedule change in the UI thread:
 * resolved profile, compiled schedule (the real compiler — cheap), fast spans, safety flags, phases, per-cell models.
 */
import { useMemo } from 'react';
import { compileSchedule, resolveProfile } from '@/engine';
import type { CompiledSchedule, PersonProfile, ResolvedProfile, Schedule } from '@/engine';
import { calendarGrid, formatDayLong, formatClock, type CalendarGrid } from './lib/calendar';
import { checkSchedule, type ScheduleCheck } from './lib/dayFlags';
import { dayMaintenance, energyStep } from './lib/energy';
import { dayFasts, fastSpans, formatFastHours, type DayFast, type FastSpan } from './lib/fasts';
import { programUsage } from './lib/ops';
import { derivePhases, type Phase } from './lib/phases';
import {
  habitualTraining,
  scheduleTraining,
  type HabitualTraining,
  type ScheduleTraining,
  type TrainingMode,
} from './lib/training';

export interface CellModel {
  day: number;
  iso: string;
  program: number;
  letter: string;
  label: string;
  /**
   * Energy as % of the day's maintenance reference (0 on water-only days). Since ruling R-MAINT the reference is
   * maintenance at the activity this schedule plans (habitual maintenance − habitual exercise + planned exercise),
   * so 100 % is weight-stable for this plan, not for the user's usual week.
   */
  pct: number;
  /** The day's maintenance reference, kcal/d. */
  maintKcal: number;
  /** True planned balance, kcal/d (< 0 deficit). */
  balanceKcal: number;
  step: number;
  zero: boolean;
  fast: DayFast | null;
  /** Energy shares P/C/F of the day (null when nothing is eaten). */
  shares: [number, number, number] | null;
  lift: boolean;
  cardio: boolean;
  /** Where the day's training comes from: as usual (habitual sessions), custom sessions, or none (R-DETRAIN). */
  training: TrainingMode;
  highSteps: boolean;
  /** Daily fast ≥ 16 h from a short eating window. */
  shortWindow: boolean;
  override: boolean;
  flag: ScheduleCheck['flag'][number];
  ariaLabel: string;
}

export interface ScheduleModel {
  schedule: Schedule;
  resolved: ResolvedProfile;
  compiled: CompiledSchedule;
  grid: CalendarGrid;
  spans: FastSpan[];
  fasts: Array<DayFast | null>;
  check: ScheduleCheck;
  phases: Phase[];
  usage: number[];
  cells: CellModel[];
  /** Habitual maintenance at the start (the body's usual week), kcal/d. */
  maintenanceKcal: number;
  /** Mean maintenance reference over the horizon at this plan's activity (R-MAINT), kcal/d. */
  referenceKcal: number;
  /**
   * How the plan's activity differs from the usual week, averaged over the horizon: `deltaKcal` = extra activity energy
   * as booked, `adjKcal` = the resulting change in maintenance (after compensation, digestion and adaptation).
   */
  activity: { deltaKcal: number; adjKcal: number };
  /** Mean maintenance reference of each program's (unedited) days, kcal/d; habitual maintenance for unused programs. */
  programMaintKcal: number[];
  /** Training source by day and overall (as usual / custom / none). */
  training: ScheduleTraining;
  /** The user's habitual training (Your body → habits), what "as usual" trains. */
  habitual: HabitualTraining;
}

const SEVERITY_WORD = { error: 'needs a fix', danger: 'danger', caution: 'caution' } as const;

export function buildScheduleModel(schedule: Schedule, resolved: ResolvedProfile): ScheduleModel {
  const compiled = compileSchedule(schedule, resolved);
  const grid = calendarGrid(schedule.startDate, schedule.horizonDays);
  const spans = fastSpans(compiled, schedule.events ?? []);
  const fasts = dayFasts(spans, compiled.nDays);
  const check = checkSchedule(compiled, resolved, spans, schedule.events ?? []);
  const maintenanceKcal = resolved.tdee0Kcal;
  const phases = derivePhases(schedule, compiled, grid, maintenanceKcal);
  let refSum = 0;
  let deltaSum = 0;
  let adjSum = 0;
  for (const d of compiled.days) {
    refSum += dayMaintenance(d, maintenanceKcal);
    deltaSum += Number.isFinite(d.activityDeltaKcal) ? d.activityDeltaKcal! : 0;
    adjSum += Number.isFinite(d.activityAdjKcal) ? d.activityAdjKcal! : 0;
  }
  const nDays = Math.max(1, compiled.days.length);
  const progSum = schedule.programs.map(() => 0);
  const progN = schedule.programs.map(() => 0);
  for (const d of compiled.days) {
    if (schedule.days[d.day]?.override || progSum[d.program] === undefined) continue;
    progSum[d.program]! += dayMaintenance(d, maintenanceKcal);
    progN[d.program]!++;
  }
  const programMaintKcal = progSum.map((v, i) => (progN[i]! > 0 ? v / progN[i]! : maintenanceKcal));
  const usage = programUsage(schedule);
  const training = scheduleTraining(schedule);
  const habitual = habitualTraining(resolved);
  const cells: CellModel[] = compiled.days.map((d) => {
    const program = d.program;
    const tmpl = schedule.programs[program] ?? schedule.programs[0]!;
    const maintKcal = dayMaintenance(d, maintenanceKcal);
    const pct = maintKcal > 0 ? (100 * d.energyKcal) / maintKcal : 0;
    const balanceKcal = Number.isFinite(d.plannedBalanceKcal) ? d.plannedBalanceKcal! : d.energyKcal - maintKcal;
    const eaten = 4 * d.proteinG + 4 * d.carbG + 9 * d.fatG;
    const shares: CellModel['shares'] =
      eaten > 0 ? [(4 * d.proteinG) / eaten, (4 * d.carbG) / eaten, (9 * d.fatG) / eaten] : null;
    let lift = false;
    let cardio = false;
    for (let i = 0; i < d.nSessions; i++) {
      if (d.sessions[i]!.kind === 'resistance') lift = true;
      else cardio = true;
    }
    const zero = d.zeroIntake || d.energyKcal === 0;
    const fast = fasts[d.day] ?? null;
    const shortWindow = !zero && d.nMeals > 0 && 24 - d.windowLengthH >= 16;
    const flag = check.flag[d.day] ?? null;
    const parts = [
      formatDayLong(d.dateISO),
      `program ${tmpl.id} ${tmpl.label}`,
      zero ? 'water-only fast' : `${Math.round(pct)} percent energy`,
    ];
    if (fast) parts.push(`fast ${formatFastHours(fast.span.hours)}`);
    if (!zero && d.nMeals > 0)
      parts.push(`window ${formatClock(d.windowStartH)} to ${formatClock(d.windowStartH + d.windowLengthH)}`);
    const tr = training.byDay[d.day] ?? 'none';
    const src = tr === 'habitual' ? ' (as usual)' : '';
    if (lift) parts.push(`lifting${src}`);
    if (cardio) parts.push(`cardio${src}`);
    if (tr === 'habitual' && !lift && !cardio) parts.push('rest day of your usual week');
    if (schedule.days[d.day]?.override) parts.push('edited for this day');
    if (flag)
      parts.push(
        `${SEVERITY_WORD[flag]}: ${check.byDay[d.day]!.find((x) => x.severity === flag)?.message ?? ''}`,
      );
    return {
      day: d.day,
      iso: d.dateISO,
      program,
      letter: tmpl.id,
      label: tmpl.label,
      pct,
      maintKcal,
      balanceKcal,
      step: zero ? 0 : energyStep(pct),
      zero,
      fast,
      shares,
      lift,
      cardio,
      training: tr,
      highSteps: d.steps >= 12000,
      shortWindow,
      override: Boolean(schedule.days[d.day]?.override),
      flag,
      ariaLabel: parts.join(', '),
    };
  });
  return {
    schedule,
    resolved,
    compiled,
    grid,
    spans,
    fasts,
    check,
    phases,
    usage,
    cells,
    maintenanceKcal,
    referenceKcal: refSum / nDays,
    activity: { deltaKcal: deltaSum / nDays, adjKcal: adjSum / nDays },
    programMaintKcal,
    training,
    habitual,
  };
}

export function useResolvedProfile(profile: PersonProfile): ResolvedProfile {
  return useMemo(() => resolveProfile(profile), [profile]);
}

export function useScheduleModel(
  schedule: Schedule | undefined,
  resolved: ResolvedProfile,
): ScheduleModel | null {
  return useMemo(() => (schedule ? buildScheduleModel(schedule, resolved) : null), [schedule, resolved]);
}
