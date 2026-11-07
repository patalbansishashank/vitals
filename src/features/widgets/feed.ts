/**
 * What Today and the ring give the home-screen widgets (0.6.6; transport: src/platform/widgets.ts). Pure builders: the
 * figures as the app writes them (the same formatters as Today's Activity card and the Ring cards) and the app's quiet
 * words for each (DotFill's, Heart Points', the sleep goal's, the battery's), so the widget reads like the app in both
 * modes. The publisher strips every figure in quiet mode; these builders still give the words.
 *
 * (r071) The builders also give what the new widgets draw: ratios for the rings, the course of the day in a word, and,
 * when `pictures` is on (the shell reads the new snapshot revision and a widget that draws them is placed), the series:
 * the day's running burn with its forecast, steps by hour, the night's stages, today's heart rate, the weight trend.
 * Nothing here reads a store: `useWidgetFeed.ts` reads the models the cards read and calls these.
 */
import { dotQuietWord, formatNumber, type EnergyUnitChoice } from '@/components';
import { energyText, HEART_POINTS_GOAL, heartPointsQuietText } from '@/features/living/activity/model';
import { minutesText } from '@/features/ring/model';
import { sleepGoalWord } from '@/features/ring/quiet';
import type { WidgetBody, WidgetHr, WidgetRing, WidgetRingState, WidgetSeries, WidgetSleep, WidgetToday } from '@/platform/widgets';
import { cumulativeBurn, hourlyBars, lineOf, stageSpans, type StageBlock } from './series';

/** The words the widgets add to the app's own: no figure in any of them, so they read the same in quiet mode. */
export const WIDGET_WORDS = {
  onCourse: 'On course',
  likelyUnder: 'Likely under',
  onPlan: 'On plan',
  overPlan: 'Over plan',
  underPlan: 'Under plan',
} as const;

/** The day display's bins are quarter hours. */
const BIN_MS = 15 * 60_000;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export interface ActivityFigures {
  date: string;
  unit: EnergyUnitChoice;
  /**
   * Energy so far (kcal) and the day's scenario band it is scaled from (`rangeChip`'s inputs); null when unknown.
   * (r071) `byBedtime` is the likely day and `plan` the planned burn (the ring and the course word); `bins` are the day
   * display's quarter hours (kcal each) for the line.
   */
  energy: {
    soFar: number;
    envelope?: { lo: number; hi: number } | null;
    total?: number | null;
    byBedtime?: number | null;
    plan?: number | null;
    bins?: ReadonlyArray<{ start: number; kcal: number }> | null;
  } | null;
  /**
   * Counted steps so far (null = unknown, never zero) against the goal. (r071) `likely` is the likely total by bedtime
   * (only once something is counted); `hours` are the counted steps per hour of the day (null = no reading).
   */
  steps: { soFar: number | null; goal: number | null; likely?: number | null; hours?: ReadonlyArray<number | null> | null; nowHour?: number | null } | null;
  /** The week's Heart Points (null = no readings) and the days of the week so far; undefined while they load. */
  heartPoints?: { week: number | null; daysIn: number };
  /** The instant "now" is (the line's live end); default the clock. */
  nowMs?: number;
  /** When the app's day ends (epoch ms): the widget keeps today's figures until then. */
  until?: number;
  /** Build the pictures: the energy line and the steps bars. */
  pictures?: boolean;
}

/** "1 120–1 360": the scenario range of a figure, as Today's `rangeChip`. */
function rangeOf(value: number, env: { lo: number; hi: number } | null | undefined, total: number | null | undefined, unit: EnergyUnitChoice): string | null {
  if (!env || !total || !(total > 0) || !Number.isFinite(env.lo) || !Number.isFinite(env.hi)) return null;
  return `${energyText((value * env.lo) / total, unit)}–${energyText((value * env.hi) / total, unit)}`;
}

/** The course against the plan in a word; the margin is the app's (`overPlanText`): 5 % of the plan, at least 50 kcal. */
export function planState(byBedtime: number | null | undefined, plan: number | null | undefined): string | null {
  if (!finite(byBedtime) || !finite(plan) || !(plan > 0)) return null;
  const over = byBedtime - plan;
  if (Math.abs(over) < Math.max(50, 0.05 * plan)) return WIDGET_WORDS.onPlan;
  return over > 0 ? WIDGET_WORDS.overPlan : WIDGET_WORDS.underPlan;
}

/** Today's Activity card as a widget part: energy so far with its range, steps against the goal, the week's points. */
export function activityWidgetPart(f: ActivityFigures): WidgetToday {
  const part: WidgetToday = { date: f.date, ...(f.until !== undefined ? { until: f.until } : {}) };
  if (f.energy && Number.isFinite(f.energy.soFar)) {
    const e = f.energy;
    const energy: NonNullable<WidgetToday['energy']> = { value: energyText(e.soFar, f.unit), unit: f.unit, range: rangeOf(e.soFar, e.envelope, e.total, f.unit) };
    if (finite(e.byBedtime) && e.byBedtime > 0) {
      energy.ratio = e.soFar / e.byBedtime;
      energy.likely = energyText(e.byBedtime, f.unit);
    }
    const state = planState(e.byBedtime, e.plan);
    if (state) energy.state = state;
    const series = f.pictures && e.bins ? cumulativeBurn(e.bins, BIN_MS, f.nowMs ?? Date.now()) : null;
    if (series) energy.series = series;
    part.energy = energy;
  } else {
    part.energy = null;
  }
  if (f.steps) {
    const { soFar, goal } = f.steps;
    const ratio = soFar !== null && goal !== null && goal > 0 ? Math.max(0, soFar) / goal : null;
    const steps: NonNullable<WidgetToday['steps']> = {
      value: soFar !== null ? formatNumber(soFar, 0) : null,
      goal: goal !== null && goal > 0 ? formatNumber(goal, 0) : null,
      ratio,
      word: soFar === null ? dotQuietWord(0, false) : ratio !== null ? dotQuietWord(ratio) : null,
    };
    const likely = f.steps.likely;
    if (soFar !== null && goal !== null && goal > 0 && finite(likely)) {
      steps.state = likely >= goal ? WIDGET_WORDS.onCourse : WIDGET_WORDS.likelyUnder;
      steps.likely = formatNumber(likely, 0);
    }
    const series = f.pictures && f.steps.hours ? hourlyBars(f.steps.hours, f.steps.nowHour ?? null) : null;
    if (series) steps.series = series;
    part.steps = steps;
  }
  if (f.heartPoints) {
    const w = f.heartPoints.week !== null ? Math.round(f.heartPoints.week) : null;
    part.heartPoints = {
      value: w !== null ? formatNumber(w, 0) : null,
      goal: formatNumber(HEART_POINTS_GOAL, 0),
      ratio: w !== null ? Math.max(0, w) / HEART_POINTS_GOAL : null,
      word: heartPointsQuietText(w, f.heartPoints.daysIn),
    };
  }
  return part;
}

/** What a night gives the sleep widget: the figure, and (r071) the instants, the goal and the stage blocks. */
export interface SleepNightFigures {
  tstText: string;
  tstLower: number;
  onset?: number | null;
  wake?: number | null;
  windowStart?: number;
  windowEnd?: number;
  session?: { blocks: ReadonlyArray<StageBlock> };
}

/** Last night as a widget part: "7 h 12", its goal and ratio, when it began and ended, and, quiet, the goal's word ("Goal met"). */
export function sleepWidgetPart(date: string, night: SleepNightFigures, goalMin: number | null | undefined, o: { pictures?: boolean; until?: number } = {}): WidgetToday {
  const goal = goalMin && goalMin > 0 ? goalMin : null;
  const sleep: WidgetSleep = { value: night.tstText, word: goal ? sleepGoalWord(night.tstLower, goal) : null };
  if (goal && finite(night.tstLower)) {
    sleep.goal = minutesText(goal);
    sleep.ratio = Math.max(0, night.tstLower) / goal;
  }
  if (finite(night.onset)) sleep.onset = night.onset;
  if (finite(night.wake)) sleep.wake = night.wake;
  if (o.pictures && night.session && finite(night.windowStart) && finite(night.windowEnd)) {
    const stages = stageSpans(night.session.blocks, night.windowStart, night.windowEnd);
    if (stages.length) sleep.stages = stages;
  }
  return { date, ...(o.until !== undefined ? { until: o.until } : {}), sleep };
}

/** The ring as a widget part: the latest heart rate, the battery (and the app's quiet word for it) and the last sync. */
export function ringWidgetPart(i: {
  state: WidgetRingState;
  /** (r071) `state` is the reading in words, `range` the day's low and high, `series` the day's line. */
  hr: { text: string; at: string; state?: string | null; range?: string | null; series?: WidgetSeries | null } | null;
  battery: { percent: number; at: string | null } | null;
  lastUploadAt: string | null | undefined;
}): WidgetRing {
  const ms = (s: string | null | undefined) => {
    const t = s ? Date.parse(s) : Number.NaN;
    return Number.isFinite(t) ? t : null;
  };
  const hrAt = ms(i.hr?.at);
  let hr: WidgetHr | null = null;
  if (i.hr && hrAt !== null) {
    hr = { value: i.hr.text, unit: 'bpm', at: hrAt };
    if (i.hr.state) hr.state = i.hr.state;
    if (i.hr.range) hr.range = i.hr.range;
    if (i.hr.series) hr.series = i.hr.series;
  }
  return {
    state: i.state,
    hr,
    battery: i.battery ? { value: formatNumber(i.battery.percent, 0), word: i.battery.percent <= 20 ? 'Low' : 'Fine', at: ms(i.battery.at) } : null,
    lastSyncAt: ms(i.lastUploadAt),
  };
}

/**
 * Today's heart rate as a line from the day's minute readings (`bpm` per minute from midnight, null = no reading), up to
 * `nowMinute`; its range as "50–90" and the state word of the latest reading come from the same minutes. null without a reading.
 */
export function heartRateDay(bpm: ReadonlyArray<number | null>, nowMinute: number, pictures: boolean): { series: WidgetSeries | null; range: string | null } {
  const upto = bpm.slice(0, Math.max(0, nowMinute + 1));
  const known = upto.filter((v): v is number => finite(v) && v > 0);
  if (known.length === 0) return { series: null, range: null };
  const range = `${Math.round(Math.min(...known))}–${Math.round(Math.max(...known))}`;
  return { series: pictures ? lineOf(upto.map((v) => (finite(v) && v > 0 ? v : null))) : null, range };
}

/** The trend weight as a widget part (opt-in only; the publisher drops it otherwise): "85.2 kg", where it stands against the plan, the last weeks as a line. */
export function weightWidgetPart(i: { kg: number | null; state: 'ahead' | 'onTrack' | 'behind' | null; trend?: ReadonlyArray<number | null> | null; pictures?: boolean }): WidgetBody | null {
  if (i.kg === null || !Number.isFinite(i.kg)) return null;
  const series = i.pictures && i.trend ? lineOf(i.trend) : null;
  return { weight: { value: formatNumber(i.kg, 1), unit: 'kg', state: i.state, ...(series ? { series } : {}) } };
}
