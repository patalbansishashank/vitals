/**
 * Copy for Body signals › Activity and the goal meter (design/screens/ring-pages.md §7.5, §6.3, §4.3). Plain, short
 * English; engraved labels lowercase; numbers then a thin space then the unit; a day with no record is "no data", never 0.
 */
import { formatNumber, THIN_SPACE } from '@/components/lib/format';
import type { WorkoutSource } from './activityModels';

const num = (v: number, d = 0): string => formatNumber(v, d);
/** "6 420 steps", "4.1 km". */
export const withUnit = (v: number, unit: string, d = 0): string => `${num(v, d)}${THIN_SPACE}${unit}`;
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "38 min", "1 h 05". */
export function fmtDuration(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  return m >= 60
    ? `${Math.floor(m / 60)}${THIN_SPACE}h ${String(m % 60).padStart(2, '0')}`
    : `${m}${THIN_SPACE}min`;
}

export type ActivityPeriod = 'week' | 'month' | 'year';
const PERIOD_WORD: Record<ActivityPeriod, string> = {
  week: 'this week',
  month: 'this month',
  year: 'this year',
};

export const ACTIVITY_COPY = {
  /* goal meters (§7.5.1) */
  goals: 'goals',
  meter: { steps: 'steps', activeMin: 'active minutes', activeKcal: 'active energy' },
  unit: { steps: 'steps', min: 'min', kcal: 'kcal', km: 'km', bpm: 'bpm' },
  goalTick: (goal: number): string => `goal ${num(goal, Number.isInteger(goal) ? 0 : 1)}`,
  noGoal: 'No goal set. Set one in Plan.',
  noDataToday: 'no data yet today',
  noDataDay: 'no data for this day',
  noData: 'no data',
  /** Accessible text of a meter: "steps: 6 420 steps, goal 8 000". */
  meterSummary(
    label: string,
    value: number | null,
    unit: string,
    goal: number | undefined,
    missing: string,
  ): string {
    const v = value === null ? missing : withUnit(value, unit);
    return `${label}: ${v}${goal ? `, goal ${num(goal)}` : ', no goal set'}`;
  },

  /* steps by hour (§7.5.2) */
  stepsByHour: 'steps by hour',
  asleep: 'asleep',
  /** "6 420 steps · 4.1 km · 280 kcal active" (parts with no record are left out). */
  dayLine(steps: number | null, distanceM: number | null, activeKcal: number | null): string {
    const parts = [
      steps !== null ? withUnit(steps, 'steps') : null,
      distanceM !== null ? withUnit(distanceM / 1000, 'km', 1) : null,
      activeKcal !== null ? `${withUnit(activeKcal, 'kcal')} active` : null,
    ].filter((p): p is string => p !== null);
    return parts.length ? parts.join(' · ') : 'no data';
  },
  hourLabel: (h: number): string =>
    `${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00`,
  hourReadout: (h: number, steps: number | null): string =>
    `${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00 · ${steps === null ? 'no data' : withUnit(steps, 'steps')}`,
  hourSummary(day: string, total: number, recorded: number, missing: number): string {
    if (!recorded) return `Steps by hour on ${day}: no hours recorded.`;
    return `Steps by hour on ${day}: ${withUnit(total, 'steps')} in ${recorded} recorded ${plural(recorded, 'hour', 'hours')}${missing ? `; ${missing} ${plural(missing, 'hour', 'hours')} with no data` : ''}.`;
  },
  noStepsToday: 'No steps recorded today yet.',
  noStepsDay: 'No steps recorded on this day.',
  noHourly: 'Steps by hour weren’t recorded for this day.',
  hourCols: { hour: 'hour', steps: 'steps' },

  /* steps per day, active minutes per day, per month (§7.5.3) */
  stepsPerDay: 'steps per day',
  activeMinPerDay: 'active minutes per day',
  stepsPerMonth: 'steps per month',
  /** "average 7 210 steps on 5 recorded days" */
  avgOnRecorded: (value: string, n: number): string =>
    `average ${value} on ${n} recorded ${plural(n, 'day', 'days')}`,
  /** A count, never a streak: "at goal on 4 of 7 days" (or "of 5 recorded days" when some are missing). */
  atGoal: (at: number, recorded: number, elapsed: number): string =>
    recorded === elapsed
      ? `at goal on ${at} of ${elapsed} ${plural(elapsed, 'day', 'days')}`
      : `at goal on ${at} of ${recorded} recorded ${plural(recorded, 'day', 'days')}`,
  emptySteps: (p: ActivityPeriod): string => `No steps recorded ${PERIOD_WORD[p]}.`,
  emptyActiveMin: (p: ActivityPeriod): string => `No active minutes recorded ${PERIOD_WORD[p]}.`,
  emptyWorkoutsYear: 'No workouts recorded this year.',
  columnsSummary(title: string, range: string, recorded: number, slots: number, avg: string | null): string {
    return `${title}, ${range}: ${recorded} of ${slots} recorded${avg ? `, ${avg}` : ''}.`;
  },
  dayCols: {
    date: 'date',
    steps: 'steps',
    activeMin: 'active min',
    activeKcal: 'active energy',
    distance: 'distance',
    workouts: 'workouts',
  },
  monthCols: {
    month: 'month',
    recorded: 'days recorded',
    avgSteps: 'average steps',
    avgActiveMin: 'average active min',
    workouts: 'workouts',
  },
  /** "October 2026 · average 7 210 steps on 21 of 31 days" */
  monthReadout: (month: string, avg: string | null, recorded: number, days: number): string =>
    avg === null
      ? `${month} · no data`
      : `${month} · average ${avg} on ${recorded} of ${days} ${plural(days, 'day', 'days')}`,
  /** "21/31" under a year column. */
  coverageNumerals: (recorded: number, days: number): string => `${recorded}/${days}`,

  /* workouts (§7.5.4) */
  workouts: 'workouts',
  workoutsPerMonth: 'workouts per month',
  workoutCount: (n: number): string => `${n} ${plural(n, 'workout', 'workouts')}`,
  noWorkouts: 'No workouts in this period.',
  logActivity: 'Log an activity',
  source: { ring: 'from your ring', hand: 'logged by hand', import: 'from an import' } satisfies Record<
    WorkoutSource,
    string
  >,
  /** Accessible name of a workout row. */
  workoutRowName: (type: string, at: string, duration: string, extra: string[]): string =>
    `${type} at ${at}, ${[duration, ...extra].join(', ')}. Show details`,
  avgBpm: (bpm: number): string => withUnit(bpm, 'bpm'),

  /* workout sheet */
  sheetTitle: (type: string, day: string, from: string, to: string): string =>
    `${type.charAt(0).toUpperCase()}${type.slice(1)} · ${day} · ${from} – ${to}`,
  sheetReadouts: {
    duration: 'duration',
    distance: 'distance',
    avgHr: 'average heart rate',
    maxHr: 'highest heart rate',
    activeKcal: 'active energy',
  },
  sheetStripLabel: 'This workout',
  notRecorded: 'not recorded',
  hrDuring: 'heart rate during the workout',
  hrDuringEmpty: 'No heart-rate readings during this workout.',
  sourceLine: (source: WorkoutSource): string =>
    source === 'ring' ? 'From your ring.' : source === 'hand' ? 'Logged by hand.' : 'From an import.',
  correct: 'Correct',
  correctWhere: 'The workout’s source is managed in Settings › Devices.',

  /* numbers (§6.2) */
  numbers: 'numbers',
  numbersLabel: 'Activity numbers',
  strip: {
    steps: 'steps',
    distance: 'distance',
    activeKcal: 'active energy',
    activeMin: 'active minutes',
    workouts: 'workouts',
  },
  stripAvg: {
    steps: 'average steps',
    distance: 'average distance',
    activeKcal: 'average active energy',
    activeMin: 'average active minutes',
    workouts: 'workouts',
  },
  onRecordedDays: (n: number): string => `on ${n} recorded ${plural(n, 'day', 'days')}`,
  table: 'table',
  hideTable: 'hide table',
} as const;
