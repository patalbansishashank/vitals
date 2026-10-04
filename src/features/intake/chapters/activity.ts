/**
 * Chapter 1 · A normal day (`activity`): the questions of a normal week (+ children), then the maintenance result and the two measured-energy
 * questions → `ActivityIntake` (engine `habits.activity`) and
 * the v0.1 habit fields the same answers already had a home for (current training, sleep, a rough step number).
 * Answer → stored value follows the design's mapping table (ride = passive commute, watch or ring = wrist, hard =
 * vigorous). Skipped answers are left out so the engine applies its own defaults (an all-skipped day is the population
 * mixture, with the widest band).
 */
import { formatNumber } from '@/components/lib/format';
import type { ActivityDriverId, ActivityIntake, CommuteMode, HabitProfile, OffDayPattern, OnFeetAtHome, RecreationEntry, RecreationIntensity, WorkClass } from '@/engine/types/profile';
import { A } from '../copy';
import { usedValues, type FlowContext, type Question } from '../flow';
import type { ChapterAnswers, MeasuredEnergy, MeasuredMethod } from '../types';

export type WorkAnswer = 'yes' | 'no' | 'varies';
export type JobClass = Exclude<WorkClass, 'notWorking' | 'unknown'>;
export type CommuteAnswer = 'ride' | 'walk' | 'cycle' | 'home';
export type StepsKnown = 'wrist' | 'phone' | 'roughly' | 'no';
export type TrainNow = 'none' | '1-2' | '3-4' | '5+';
export type TrainMix = 'lifting' | 'mixed' | 'cardio';
export type SleepPreset = '22-06' | '23-07' | '00-08' | '01-09' | 'other';
export type SleepQuality = 'poor' | 'fair' | 'good';

export interface WorkTimeValue {
  days: number;
  hours: number;
}
export interface StepsValue {
  mean?: number;
  workday?: number;
  offDay?: number;
  /** "I'll import it": the devices chapter revises it. */
  importLater?: boolean;
}
export type MeasuredEver = 'no' | 'rmr' | 'tdee';
/** `activity.measured` as answered (the kind comes from `measuredEver`). */
export interface MeasuredValue {
  value: number;
  unit: 'kcal' | 'kJ';
  method: MeasuredMethod;
  /** `YYYY-MM`. */
  date?: string;
}
export const MEASURED_METHODS: readonly MeasuredMethod[] = ['metabolic_cart', 'dxa_based', 'smart_scale', 'calculator', 'tracking'];
/** Accepted range for a day's figure (design §4.3): 800–6 000 kcal. */
export const MEASURED_KCAL_RANGE = [800, 6000] as const;
export const KJ_PER_KCAL = 4.184;
export const toKcal = (m: Pick<MeasuredValue, 'value' | 'unit'>): number => (m.unit === 'kJ' ? Math.round(m.value / KJ_PER_KCAL) : Math.round(m.value));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthText = (ym: string | undefined): string | null => {
  const m = ym ? /^(\d{4})-(\d{2})$/.exec(ym) : null;
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : null;
};
export function measuredText(m: MeasuredValue | undefined): string {
  if (!m || !Number.isFinite(m.value)) return A.measured.skip;
  return [`${formatNumber(m.value, 0)} ${m.unit}`, A.measured.methodsShort[m.method] ?? m.method, monthText(m.date)].filter(Boolean).join(' · ');
}

export interface SleepRange {
  bed: number;
  wake: number;
}

const JOBS: readonly JobClass[] = ['desk', 'mixed', 'onFeet', 'manualModerate', 'manualHeavy'];
const steps = (n: number) => formatNumber(n, 0);
const working = (v: Readonly<Record<string, unknown>>) => v.work === 'yes' || v.work === 'varies';

/** Words that mean planned training, not sport (listing them offers "Move to training"). */
export const TRAINING_WORDS = /\b(gym|weights?|lifting|running|jogging|run|yoga|dand|baithak|dand-baithak|crossfit|hiit|workout|cardio|pilates|calisthenics|strength)\b/i;
export const looksLikeTraining = (label: string): boolean => TRAINING_WORDS.test(label);

export const SLEEP_PRESETS: Readonly<Record<Exclude<SleepPreset, 'other'>, SleepRange>> = {
  '22-06': { bed: 22, wake: 6 },
  '23-07': { bed: 23, wake: 7 },
  '00-08': { bed: 0, wake: 8 },
  '01-09': { bed: 1, wake: 9 },
};
const hh = (h: number) => `${String(Math.floor(((h % 24) + 24) % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
export const sleepText = (r: SleepRange) => `${hh(r.bed)}–${hh(r.wake)}`;

export const ACTIVITY_QUESTIONS: readonly Question[] = [
  {
    id: 'work',
    chapter: 'activity',
    section: 'activity',
    anchor: 'work',
    kind: 'single',
    prompt: A.work.prompt,
    short: A.work.short,
    skipText: A.work.skip,
    options: [
      { value: 'yes', label: A.work.options.yes },
      { value: 'no', label: A.work.options.no },
      { value: 'varies', label: A.work.options.varies },
    ],
    receipt: (v) => A.work.options[v as WorkAnswer] ?? String(v),
  },
  {
    id: 'job',
    parent: 'work',
    chapter: 'activity',
    section: 'activity',
    anchor: 'job',
    kind: 'single',
    cards: true,
    prompt: A.job.prompt,
    why: A.job.why,
    short: A.job.short,
    skipText: A.job.skip,
    defaultValue: 'mixed',
    applies: working,
    options: JOBS.map((j) => ({ value: j, label: A.job.options[j].label, examples: A.job.options[j].examples })),
    receipt: (v) => A.job.options[v as JobClass]?.short ?? String(v),
  },
  {
    id: 'workTime',
    parent: 'work',
    chapter: 'activity',
    section: 'activity',
    kind: 'custom',
    widget: 'workTime',
    prompt: A.workTime.prompt,
    short: A.workTime.short,
    skipText: A.workTime.skip,
    applies: working,
    receipt: (v) => {
      const t = v as WorkTimeValue;
      return A.workTime.receipt(t.days, t.hours);
    },
  },
  {
    id: 'commute',
    parent: 'work',
    chapter: 'activity',
    section: 'activity',
    anchor: 'commute',
    kind: 'single',
    prompt: A.commute.prompt,
    short: A.commute.short,
    skipText: A.commute.skip,
    defaultValue: 'ride',
    applies: working,
    options: (['ride', 'walk', 'cycle', 'home'] as const).map((c) => ({ value: c, label: A.commute.options[c] })),
    receipt: (v) => A.commute.receipt[v as CommuteAnswer] ?? String(v),
  },
  {
    id: 'commuteMin',
    parent: 'commute',
    chapter: 'activity',
    section: 'activity',
    kind: 'number',
    prompt: A.commuteMin.prompt,
    short: A.commuteMin.short,
    skipText: A.commuteMin.skip,
    name: A.commuteMin.name,
    unit: A.commuteMin.unit,
    min: 0,
    max: 240,
    step: 5,
    presets: [10, 20, 30, 45, 60],
    defaultValue: 20,
    applies: (v) => v.commute === 'walk' || v.commute === 'cycle',
    receipt: (v) => A.commuteMin.receipt(Number(v)),
  },
  {
    id: 'stepsKnown',
    chapter: 'activity',
    section: 'activity',
    anchor: 'steps',
    kind: 'single',
    prompt: A.stepsKnown.prompt,
    why: A.stepsKnown.why,
    short: A.stepsKnown.short,
    skipText: A.stepsKnown.skip,
    defaultValue: 'no',
    options: (['wrist', 'phone', 'roughly', 'no'] as const).map((s) => ({ value: s, label: A.stepsKnown.options[s] })),
    receipt: (v) => A.stepsKnown.receipt[v as StepsKnown] ?? String(v),
  },
  {
    id: 'stepsNumber',
    parent: 'stepsKnown',
    chapter: 'activity',
    section: 'activity',
    kind: 'custom',
    widget: 'steps',
    prompt: A.stepsNumber.prompt,
    short: A.stepsNumber.short,
    skipText: A.stepsNumber.skip,
    applies: (v) => v.stepsKnown === 'wrist' || v.stepsKnown === 'phone',
    receipt: (v) => {
      const s = v as StepsValue;
      if (s.importLater) return A.stepsNumber.receiptImport;
      if (s.mean !== undefined) return A.stepsNumber.receiptMean(steps(s.mean));
      return A.stepsNumber.receiptSplit(steps(s.workday ?? 0), steps(s.offDay ?? 0));
    },
  },
  {
    id: 'phoneCarried',
    parent: 'stepsKnown',
    chapter: 'activity',
    section: 'activity',
    kind: 'single',
    prompt: A.phoneCarried.prompt,
    short: A.phoneCarried.short,
    skipText: A.phoneCarried.skip,
    defaultValue: 'mostly',
    applies: (v) => v.stepsKnown === 'phone',
    options: [
      { value: 'mostly', label: A.phoneCarried.options.mostly },
      { value: 'notReally', label: A.phoneCarried.options.notReally },
    ],
    receipt: (v) => A.phoneCarried.options[v as 'mostly' | 'notReally'] ?? String(v),
  },
  {
    id: 'stepsRough',
    parent: 'stepsKnown',
    chapter: 'activity',
    section: 'activity',
    kind: 'number',
    prompt: A.stepsRough.prompt,
    short: A.stepsRough.short,
    skipText: A.stepsRough.skip,
    name: A.stepsRough.name,
    min: 0,
    max: 40000,
    step: 500,
    presets: [3000, 5000, 7000, 9000, 12000, 15000],
    presetLabel: steps,
    defaultValue: 7000,
    applies: (v) => v.stepsKnown === 'roughly',
    receipt: (v) => A.stepsRough.receipt(steps(Number(v))),
  },
  {
    id: 'offDay',
    chapter: 'activity',
    section: 'activity',
    kind: 'single',
    prompt: A.offDay.prompt,
    short: A.offDay.short,
    skipText: A.offDay.skip,
    defaultValue: 'mixed',
    options: (['mostlyHome', 'mixed', 'outAndAbout'] as const).map((o) => ({ value: o, label: A.offDay.options[o] })),
    receipt: (v) => A.offDay.options[v as OffDayPattern] ?? String(v),
  },
  {
    id: 'home',
    chapter: 'activity',
    section: 'activity',
    anchor: 'home',
    kind: 'single',
    prompt: A.home.prompt,
    short: A.home.short,
    skipText: A.home.skip,
    defaultValue: 'some',
    options: (['little', 'some', 'aLot'] as const).map((o) => ({ value: o, label: A.home.options[o] })),
    receipt: (v) => A.home.options[v as OnFeetAtHome] ?? String(v),
  },
  {
    id: 'sport',
    chapter: 'activity',
    section: 'activity',
    anchor: 'sport',
    kind: 'custom',
    widget: 'sportRows',
    prompt: A.sport.prompt,
    why: A.sport.why,
    short: A.sport.short,
    skipText: A.sport.skip,
    receipt: (v) => {
      const rows = (v as RecreationEntry[]) ?? [];
      if (!rows.length) return A.sport.receiptNone;
      return rows.map((r) => A.sport.receiptRow(r.label, r.minPerWeek, A.sport.intensity[r.intensity])).join(' · ');
    },
  },
  {
    id: 'trainNow',
    chapter: 'activity',
    section: 'activity',
    anchor: 'training',
    kind: 'single',
    prompt: A.trainNow.prompt,
    short: A.trainNow.short,
    skipText: A.trainNow.skip,
    defaultValue: 'none',
    options: (['none', '1-2', '3-4', '5+'] as const).map((o) => ({ value: o, label: A.trainNow.options[o] })),
    receipt: (v) => A.trainNow.receipt[v as TrainNow] ?? String(v),
  },
  {
    id: 'trainMix',
    parent: 'trainNow',
    chapter: 'activity',
    section: 'activity',
    kind: 'single',
    prompt: A.trainMix.prompt,
    short: A.trainMix.short,
    skipText: A.trainMix.skip,
    defaultValue: 'mixed',
    applies: (v) => v.trainNow !== undefined && v.trainNow !== 'none',
    options: (['lifting', 'mixed', 'cardio'] as const).map((o) => ({ value: o, label: A.trainMix.options[o] })),
    receipt: (v) => A.trainMix.options[v as TrainMix] ?? String(v),
  },
  {
    id: 'sleep',
    chapter: 'activity',
    section: 'activity',
    anchor: 'sleep',
    kind: 'custom',
    widget: 'sleep',
    prompt: A.sleep.prompt,
    why: A.sleep.why,
    short: A.sleep.short,
    skipText: A.sleep.skip,
    receipt: (v) => sleepText(v as SleepRange),
  },
  {
    id: 'sleepQuality',
    chapter: 'activity',
    section: 'activity',
    kind: 'single',
    prompt: A.sleepQuality.prompt,
    short: A.sleepQuality.short,
    skipText: A.sleepQuality.skip,
    defaultValue: 'fair',
    options: (['poor', 'fair', 'good'] as const).map((o) => ({ value: o, label: A.sleepQuality.options[o] })),
    receipt: (v) => A.sleepQuality.options[v as SleepQuality] ?? String(v),
  },
  // measured maintenance (§13.1, item 1): ordinary questions after the maintenance result card
  {
    id: 'measuredEver',
    chapter: 'activity',
    section: 'activity',
    anchor: 'measured',
    kind: 'single',
    prompt: A.measuredEver.prompt,
    why: A.measuredEver.why,
    short: A.measuredEver.short,
    skipText: A.measuredEver.skip,
    defaultValue: 'no',
    options: (['no', 'rmr', 'tdee'] as const).map((o) => ({ value: o, label: A.measuredEver.options[o] })),
    receipt: (v) => A.measuredEver.receipt[v as MeasuredEver] ?? String(v),
  },
  {
    id: 'measured',
    parent: 'measuredEver',
    chapter: 'activity',
    section: 'activity',
    kind: 'custom',
    widget: 'measured',
    prompt: A.measured.prompt,
    short: A.measured.short,
    skipText: A.measured.skip,
    applies: (v) => v.measuredEver === 'rmr' || v.measuredEver === 'tdee',
    receipt: (v) => measuredText(v as MeasuredValue),
  },
];

/** The question after which the chapter's maintenance result card is shown. */
export const MAINTENANCE_RESULT_BEFORE = 'measuredEver';

/* ------------------------------------------------------------------------------------------- reducer */

/** Habit fields the activity answers write on the profile (only answered ones; undefined = leave as is). */
export type ActivityHabitsPatch = Pick<HabitProfile, 'typicalSteps' | 'sessionsPerWeek' | 'lifingCardioMix' | 'bedTimeH' | 'wakeTimeH' | 'sleepQuality'>;

export interface ActivityResult {
  /** undefined = nothing answered or skipped yet (the engine keeps its pre-intake behaviour). */
  activity: ActivityIntake | undefined;
  habits: ActivityHabitsPatch;
  /** "roughly" → write `typicalSteps`; "no" → clear it so a stale tick is not read as a step answer. */
  clearTypicalSteps: boolean;
  /** Drivers whose answer was skipped (drawn dashed: "assumed"). */
  defaulted: ActivityDriverId[];
  /** Measured maintenance or resting energy, as answered (not part of the engine's `ActivityIntake`). */
  measured?: MeasuredEnergy;
}

/**
 * The binding of a measured figure (§13.1): only a resting value from a metabolic cart (indirect calorimetry) is used
 * as the resting metabolism (`profile.labs.measuredRmrKcal`, exactly as the v2 "measured" path wrote it); everything
 * else is stored and shown, never used as RMR.
 */
export function measuredRmrKcal(m: MeasuredEnergy | undefined): number | null {
  if (!m || m.kind !== 'rmr' || m.method !== 'metabolic_cart' || !Number.isFinite(m.value)) return null;
  const kcal = toKcal(m);
  return kcal >= MEASURED_KCAL_RANGE[0] && kcal <= MEASURED_KCAL_RANGE[1] ? kcal : null;
}

export const SESSIONS: Readonly<Record<Exclude<TrainNow, 'none'>, number>> = { '1-2': 2, '3-4': 4, '5+': 5 };
export const CARDIO_SHARE: Readonly<Record<TrainMix, number>> = { lifting: 0.2, mixed: 0.5, cardio: 0.8 };
const COMMUTE_MODE: Readonly<Record<CommuteAnswer, CommuteMode>> = { ride: 'passive', walk: 'walk', cycle: 'cycle', home: 'none' };

const roundHalf = (x: number) => Math.round(x * 2) / 2;

/** Answers → `ActivityIntake` + habit fields (pure; skipped and not-applicable answers are left out). */
export function reduceActivity(a: ChapterAnswers, ctx: FlowContext): ActivityResult {
  const v = usedValues(ACTIVITY_QUESTIONS, a, ctx);
  const s = a.status;
  const touched = Object.keys(s).length > 0;
  const intake: ActivityIntake = {};

  if (v.work === 'no') intake.work = 'notWorking';
  else if (working(v)) {
    if (typeof v.job === 'string' && (JOBS as readonly string[]).includes(v.job)) intake.work = v.job as JobClass;
    const t = v.workTime as WorkTimeValue | undefined;
    if (t) {
      intake.workDaysPerWeek = v.work === 'varies' ? roundHalf(t.days) : Math.round(t.days);
      intake.workHoursPerDay = t.hours;
    }
    const c = v.commute as CommuteAnswer | undefined;
    if (c) {
      const mode = COMMUTE_MODE[c];
      const active = mode === 'walk' || mode === 'cycle';
      intake.commute = active ? { mode, activeMinPerWorkday: typeof v.commuteMin === 'number' ? v.commuteMin : 20 } : { mode };
    }
  }

  let typicalSteps: number | undefined;
  const known = v.stepsKnown as StepsKnown | undefined;
  if (known === 'wrist' || known === 'phone') {
    const n = v.stepsNumber as StepsValue | undefined;
    const ans: NonNullable<ActivityIntake['steps']> = { source: known };
    if (n && !n.importLater) {
      if (n.mean !== undefined) ans.weeklyMean = n.mean;
      else {
        if (n.workday !== undefined) ans.workday = n.workday;
        if (n.offDay !== undefined) ans.offDay = n.offDay;
      }
    }
    if (known === 'phone') ans.phoneCarried = v.phoneCarried !== 'notReally';
    intake.steps = ans;
  } else if (known === 'roughly') {
    const n = typeof v.stepsRough === 'number' ? v.stepsRough : 7000;
    intake.steps = { source: 'estimate', weeklyMean: n };
    typicalSteps = n;
  } else if (known === 'no') intake.steps = { source: 'unknown' };

  if (typeof v.offDay === 'string') intake.offDay = v.offDay as OffDayPattern;
  if (typeof v.home === 'string') intake.onFeetAtHome = v.home as OnFeetAtHome;
  if (Array.isArray(v.sport)) {
    intake.recreation = (v.sport as RecreationEntry[])
      .filter((r) => r && r.label.trim() && Number.isFinite(r.minPerWeek) && r.minPerWeek > 0)
      .map((r) => ({ label: r.label.trim(), intensity: r.intensity as RecreationIntensity, minPerWeek: r.minPerWeek }));
  }

  const habits: ActivityHabitsPatch = {};
  if (typicalSteps !== undefined) habits.typicalSteps = typicalSteps;
  if (v.trainNow === 'none') habits.sessionsPerWeek = 0;
  else if (typeof v.trainNow === 'string' && v.trainNow in SESSIONS) {
    habits.sessionsPerWeek = SESSIONS[v.trainNow as Exclude<TrainNow, 'none'>];
    if (typeof v.trainMix === 'string') habits.lifingCardioMix = CARDIO_SHARE[v.trainMix as TrainMix];
  }
  const sl = v.sleep as SleepRange | undefined;
  if (sl) {
    habits.bedTimeH = ((sl.bed % 24) + 24) % 24;
    habits.wakeTimeH = ((sl.wake % 24) + 24) % 24;
  }
  if (typeof v.sleepQuality === 'string') habits.sleepQuality = v.sleepQuality as SleepQuality;

  const skipped = (id: string) => s[id] === 'skipped';
  const defaulted: ActivityDriverId[] = [];
  if (skipped('stepsKnown') || skipped('stepsNumber') || skipped('stepsRough')) defaulted.push('steps');
  if (skipped('work') || skipped('job') || skipped('workTime')) defaulted.push('work');
  if (skipped('home')) defaulted.push('home');
  if (skipped('commute') || skipped('commuteMin')) defaulted.push('commute');
  if (skipped('sport')) defaulted.push('recreation');
  if (skipped('trainNow')) defaulted.push('training');

  let measured: MeasuredEnergy | undefined;
  const mv = v.measured as MeasuredValue | undefined;
  if ((v.measuredEver === 'rmr' || v.measuredEver === 'tdee') && mv && Number.isFinite(mv.value) && (MEASURED_METHODS as readonly string[]).includes(mv.method)) {
    measured = { kind: v.measuredEver, value: mv.value, unit: mv.unit === 'kJ' ? 'kJ' : 'kcal', method: mv.method, ...(mv.date ? { date: mv.date } : {}) };
  }

  return { activity: touched ? intake : undefined, habits, clearTypicalSteps: known === 'no', defaulted, ...(measured ? { measured } : {}) };
}

/** Top-level questions of the chapter (children excluded). */
export const ACTIVITY_MAIN_COUNT = ACTIVITY_QUESTIONS.filter((q) => !q.parent).length;
