/**
 * (r069 D4) The day Energy page's model. Pure: the page draws it, the tests read it.
 *
 * The engine's day (`energy-day/1`, `EnergyDay`) splits every 15 minutes into its ledger components; the page groups them
 * by kind, the way a person asks "what did I burn it on":
 *  - resting: the resting metabolic rate and the model's remaining terms (`rmr` + `other`: adaptation and the rest of the
 *    day's expenditure model);
 *  - everyday movement: the movement outside an activity (`neatBase` + `stepsEnergy`, the steps' energy);
 *  - exercise: what the day's activities added above the usual day (`exercise` + the `recovery` tail after a bout);
 *  - food digestion: the thermic effect of the food logged (`tef`, modelled).
 * The kinds add up to the bin's total (one ledger, never a second calorie model). A bin whose movement is negative (an hour
 * of fewer steps than the usual day the engine was given) draws no movement and takes the difference off its resting part,
 * so the column still totals the engine's figure. Today's quarters after now are the likely rest of the day, one bar.
 */
import { clockText, durationText } from '@/components';
import type { EnergyComponent, EnergyDay } from '@/living/sensors/energyDay';
import type { RingActivity } from '@/features/ring/activities';
import { energyText } from '../activity/model';
import { shortActivityName } from '../activity/ActivityLane';
import type { EnergyUnitChoice } from '@/components';

export type EnergyKind = 'resting' | 'movement' | 'digestion' | 'exercise';

/** Bottom to top in the columns (dark and light steps alternate) and in the legend. */
export const KIND_ORDER: readonly EnergyKind[] = ['resting', 'movement', 'digestion', 'exercise'];

export const KIND_LABEL: Record<EnergyKind, string> = {
  resting: 'Resting',
  movement: 'Everyday movement',
  digestion: 'Food digestion',
  exercise: 'Exercise',
};

/**
 * (r069 U1) The intensity roles (`tokens.css`): resting the ramp's first step, everyday movement its active step,
 * exercise its top (gold); food digestion keeps the bronze of Today's chart. Stacked resting · movement · digestion ·
 * exercise, dark and light steps alternate, so neighbours separate by lightness as well as name.
 */
export const KIND_HUE: Record<EnergyKind, string> = {
  resting: 'var(--lm-intensity-resting)',
  movement: 'var(--lm-intensity-active)',
  digestion: 'var(--lm-intensity-light)',
  exercise: 'var(--lm-intensity-exercise)',
};

/** The kinds of one set of ledger components (kcal); they add up to the components' sum. */
export function kindsOf(c: Record<EnergyComponent, number>): Record<EnergyKind, number> {
  const movement = c.neatBase + c.stepsEnergy;
  const exercise = c.exercise + c.recovery;
  const resting = c.rmr + c.other;
  // a negative part is drawn as none, its difference taken off the resting part (the column keeps its total)
  const m = Math.max(0, movement);
  const x = Math.max(0, exercise);
  return { resting: resting + (movement - m) + (exercise - x), movement: m, digestion: c.tef, exercise: x };
}

export interface KindColumn {
  start: number;
  kinds: Record<EnergyKind, number>;
  total: number;
  /** After now (today): the likely rest of the day, drawn as one lighter bar. */
  future: boolean;
  /** The share of the quarter before now: 1 before, 0 after, a fraction for the quarter now is in. */
  pastFrac: number;
}

/** The day's 15-min columns by kind (`nowMs` = Infinity for a past day: nothing is ahead). */
export function kindColumns(day: Pick<EnergyDay, 'bins15'>, nowMs: number): KindColumn[] {
  const Q = 15 * 60_000;
  return day.bins15.map((b) => {
    const pastFrac = Math.max(0, Math.min(1, (nowMs - b.start) / Q));
    return { start: b.start, kinds: kindsOf(b.components), total: b.kcal, future: pastFrac === 0, pastFrac };
  });
}

export interface KindSplit {
  /** kcal by kind before now (the whole day on a past day). */
  byKind: Record<EnergyKind, number>;
  /** Σ before now. */
  soFar: number;
  /** The likely rest of the day (today), kcal; 0 on a past day. */
  ahead: number;
  /** The day: so far + ahead. */
  total: number;
}

export function kindSplit(cols: readonly KindColumn[]): KindSplit {
  const byKind: Record<EnergyKind, number> = { resting: 0, movement: 0, digestion: 0, exercise: 0 };
  let soFar = 0;
  let ahead = 0;
  for (const c of cols) {
    // the quarter now is in counts pro rata (as Today's "so far" counts the hour it is in)
    const f = c.pastFrac;
    ahead += c.total * (1 - f);
    soFar += c.total * f;
    for (const k of KIND_ORDER) byKind[k] += c.kinds[k] * f;
  }
  return { byKind, soFar, ahead, total: soFar + ahead };
}

/** The busiest quarter hour before now (null when nothing is known). */
export function peakColumn(cols: readonly KindColumn[]): KindColumn | null {
  let peak: KindColumn | null = null;
  for (const c of cols) if (!c.future && (!peak || c.total > peak.total)) peak = c;
  return peak;
}

/** "Energy through the day, estimated: 1 640 kcal so far; resting 1 120, everyday movement 210, …; most at 14:15 (52 kcal in 15 min)." */
export function spokenKinds(
  split: KindSplit,
  peak: KindColumn | null,
  unit: EnergyUnitChoice = 'kcal',
): string {
  const t = (v: number) => energyText(v, unit);
  const parts = KIND_ORDER.filter((k) => split.byKind[k] > 0.5).map(
    (k) => `${KIND_LABEL[k].toLowerCase()} ${t(split.byKind[k])}`,
  );
  const at =
    peak && peak.total > 0.5 ? `; most at ${clockText(peak.start)} (${t(peak.total)} in 15 min)` : '';
  const rest = split.ahead > 0.5 ? `; likely ${t(split.ahead)} more by bedtime` : '';
  return `Energy through the day, estimated: ${t(split.soFar)} ${unit}${split.ahead > 0.5 ? ' so far' : ''}; ${parts.join(', ')}${at}${rest}.`;
}

// ------------------------------------------------------------------------------------------- the day's activities
/** How an activity's energy was estimated, in words (the booked method). */
export const METHOD_WORDS: Record<string, string> = {
  compendiumMet: 'from the activity type and minutes',
  acsm: 'from your speed',
  hr: 'from your heart rate',
  power: 'from power',
  reported: 'the number the machine showed',
  device: 'the device’s own figure',
  modelled: 'modelled',
};

export const ENERGY_PAGE_WORDS = {
  title: 'Energy',
  burned: 'Burned',
  soFar: 'Burned so far',
  byBedtime: 'Likely by bedtime',
  likely: (lo: string, hi: string) => `likely ${lo}–${hi}`,
  throughTheDay: 'Through the day',
  byKind: 'By kind',
  ofTheDay: 'of the day',
  perQuarter: (unit: string) => `${unit} per 15 min`,
  ahead: 'Rest of the day (likely)',
  activities: 'Activities',
  noActivities: 'No activities recorded or logged that day',
  activitiesNote:
    'Each activity’s figure is its whole burn, the resting part included. The Exercise band counts only what it added above your usual day.',
  toReview: 'Detected, not counted yet',
  byRing: 'Recorded by the ring',
  byPhone: 'Recorded by the phone',
  byHc: 'Recorded by Health Connect',
  byHand: 'Logged by hand',
  howKnown: 'Measured and estimated',
  measured: 'Measured',
  estimated: 'Estimated',
  modelled: 'Modelled',
  comparison: 'Not counted',
  measuredSteps: (covered: string) => `Steps from the ring and phone, ${covered} of the day covered`,
  measuredNone: 'No step or heart-rate reading this day',
  measuredHr: 'Heart rate during activities',
  estimatedRestBody: 'Resting burn from your height, weight, age and sex',
  estimatedRestPlan: 'Resting burn from your plan’s body model',
  estimatedActs: 'Each activity from its type, minutes, speed or heart rate (named on its row)',
  estimatedMovement: 'Everyday movement from the steps counted',
  modelledTef: 'Food digestion from what you logged; timing within each hour is approximate',
  ringComparison: (v: string, unit: string) =>
    `The ring’s own estimate, ${v} ${unit}, is shown for comparison only`,
  quiet: 'Energy figures stay hidden in quiet mode.',
  noProfile: 'The energy of a day needs your height, weight, age and sex.',
  yourBody: 'Your body',
  noRun: 'The energy of this day is not available here.',
  loading: 'Working out the day…',
  table: 'Energy through the day table',
  // (r069 U2) a week, month, year or range
  periodTitle: 'Total burned',
  total: 'Total',
  dailyAverage: 'Daily average',
  daysWith: 'Days with a figure',
  ofDays: (n: number, of: number) => `${n} of ${of}`,
  noDays: 'No day of this period has an energy figure.',
  todaySoFar: 'Today counts what is burned so far; the daily average is of whole days.',
  periodByKind: 'By kind',
} as const;

export interface DayActivityRow {
  id: string;
  name: string;
  /** "14:08–14:53 · 45 min", quiet: part of day only (built by the page). */
  start: number | null;
  end: number | null;
  minutes: number | null;
  kcal: number | null;
  range: { lo: number; hi: number } | null;
  /** "Recorded by the ring · from your speed" */
  basis: string;
  pending: boolean;
  candidateKey: string | null;
}

/** Where an activity came from, in words. */
export function sourceWords(a: Pick<RingActivity, 'sources' | 'status'>): string {
  if (a.status === 'pending') return ENERGY_PAGE_WORDS.toReview;
  if (a.sources.includes('ring')) return ENERGY_PAGE_WORDS.byRing;
  if (a.sources.includes('healthConnect')) return ENERGY_PAGE_WORDS.byHc;
  return ENERGY_PAGE_WORDS.byHand;
}

/** "Recorded by the ring · from your speed"; a method the page does not know keeps the source alone. */
export function basisText(a: Pick<RingActivity, 'sources' | 'status' | 'kcalMethod'>): string {
  const how = a.kcalMethod ? METHOD_WORDS[a.kcalMethod] : undefined;
  return how ? `${sourceWords(a)} · ${how}` : sourceWords(a);
}

/** The day's activities, oldest first: counted ones, then those still to review. */
export function activityRows(
  acts: { approved: readonly RingActivity[]; pending: readonly RingActivity[] },
  date: string,
): DayActivityRow[] {
  const row = (a: RingActivity): DayActivityRow => ({
    id: a.id,
    name: shortActivityName(a.exerciseId),
    start: a.window?.start ?? null,
    end: a.window?.end ?? null,
    minutes: a.durationMin,
    kcal: a.grossKcal,
    range: a.kcalRange ?? null,
    basis: basisText(a),
    pending: a.status === 'pending',
    candidateKey: a.candidateKey,
  });
  const byStart = (x: DayActivityRow, y: DayActivityRow) =>
    (x.start ?? Number.MAX_SAFE_INTEGER) - (y.start ?? Number.MAX_SAFE_INTEGER);
  return [
    ...acts.approved
      .filter((a) => a.date === date)
      .map(row)
      .sort(byStart),
    ...acts.pending
      .filter((a) => a.date === date)
      .map(row)
      .sort(byStart),
  ];
}

/** "14:08–14:53 · 45 min" (minutes only when the time is unknown). */
export function rowWhen(r: Pick<DayActivityRow, 'start' | 'end' | 'minutes'>): string {
  const min = r.minutes !== null ? durationText(r.minutes) : null;
  if (r.start === null || r.end === null) return min ?? '';
  return [`${clockText(r.start)}–${clockText(r.end)}`, min].filter(Boolean).join(' · ');
}

// r071: the ledger's actual components, kept separate all the way to the legend.
export const COMPONENT_ORDER: readonly EnergyComponent[] = [
  'rmr',
  'neatBase',
  'stepsEnergy',
  'exercise',
  'recovery',
  'tef',
  'other',
];
export const COMPONENT_LABEL: Record<EnergyComponent, string> = {
  rmr: 'Resting metabolism',
  neatBase: 'Everyday movement (NEAT)',
  stepsEnergy: 'Walking outside activities',
  exercise: 'Exercise',
  recovery: 'After exercise',
  tef: 'Food digestion (TEF)',
  other: 'Model adjustments',
};
export const COMPONENT_HUE: Record<EnergyComponent, string> = {
  rmr: 'var(--lm-energy-part-rmr)',
  neatBase: 'var(--lm-energy-part-neat)',
  stepsEnergy: 'var(--lm-energy-part-walking)',
  exercise: 'var(--lm-energy-part-exercise)',
  recovery: 'var(--lm-energy-part-recovery)',
  tef: 'var(--lm-energy-part-tef)',
  other: 'var(--lm-energy-part-other)',
};
export const COMPONENT_INFO: Record<EnergyComponent, string> = {
  rmr: 'Your resting metabolic rate (RMR) is the energy your body uses at rest. The engine starts from the profile and formula below, then adjusts for the body composition and adaptation in the model. This is estimated unless a measured RMR was supplied.',
  neatBase:
    'Non-exercise activity thermogenesis (NEAT) covers everyday movement other than the walking shown separately. It comes from your usual activity and the model’s adaptations. A negative contribution means less movement than the model’s usual day; it is retained in the total.',
  stepsEnergy:
    'Walking from steps outside counted activities is separate from other everyday movement. Steps may be measured by the ring or phone; their energy is estimated by the engine. Steps inside an activity are not added again. A negative value represents a deficit against usual steps.',
  exercise:
    'The energy your counted activities add above your usual day, allocated to their moving minutes. Activity estimates use the method shown on each activity. Detected activities waiting for your decision are not counted. An activity’s gross figure includes resting energy, so it is not this contribution.',
  recovery:
    'The engine’s exercise energy remaining after the moving part of an activity is allocated to recovery after the activity. This is an estimated timing allocation of the same exercise ledger, not an additional activity or a second calorie estimate.',
  tef: 'The thermic effect of food (TEF) is the energy used in digestion and processing what you eat. The engine uses the food and nutrient mix logged, with its usual-diet assumptions where needed. Placement within the hour is modelled.',
  other:
    'The signed remainder of the engine’s expenditure ledger includes adaptation and its other energy terms. It is shown explicitly so resting metabolism, everyday movement, walking, exercise, recovery and digestion add to the total. A negative adjustment reduces the total.',
};
export const emptyComponents = (): Record<EnergyComponent, number> => ({
  rmr: 0,
  neatBase: 0,
  stepsEnergy: 0,
  exercise: 0,
  recovery: 0,
  tef: 0,
  other: 0,
});

/** Components through the same hourly cut-off that Today's canonical total uses. */
export function componentsThrough(
  day: Pick<EnergyDay, 'bins15'>,
  nowMs = Infinity,
): Record<EnergyComponent, number> {
  const out = emptyComponents();
  // The engine's headline interpolates the current hour uniformly. Keep that policy here too: within-hour
  // placement is a display model, so a minute's shape must not silently change the headline or its breakdown.
  const hours = new Map<number, Record<EnergyComponent, number>>();
  const first = day.bins15[0]?.start ?? 0;
  for (const b of day.bins15) {
    const start = first + Math.floor((b.start - first) / 3_600_000) * 3_600_000;
    const c = hours.get(start) ?? emptyComponents();
    for (const k of COMPONENT_ORDER) c[k] += b.components[k];
    hours.set(start, c);
  }
  for (const [start, c] of hours) {
    const fraction = Math.max(0, Math.min(1, (nowMs - start) / 3_600_000));
    for (const k of COMPONENT_ORDER) out[k] += c[k] * fraction;
  }
  return out;
}

/** The estimate's supplied scenario envelope, scaled to a contribution (never a measured confidence interval). */
export function componentRange(
  value: number,
  total: number,
  envelope: { lo: number; hi: number } | null | undefined,
): { lo: number; hi: number } | null {
  if (!envelope || !(total > 0)) return null;
  const a = (value * envelope.lo) / total;
  const b = (value * envelope.hi) / total;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/** Cumulative total from the ledger; the final actual point follows the headline's hourly interpolation. */
export function cumulativeSeries(
  day: Pick<EnergyDay, 'bins15'>,
  nowMs = Infinity,
): { series: Array<{ t: number; v: number }>; future: Array<{ t: number; v: number }> } {
  const first = day.bins15[0]?.start;
  if (first === undefined) return { series: [], future: [] };
  const series = [{ t: first, v: 0 }];
  const future: Array<{ t: number; v: number }> = [];
  const currentHour = first + Math.floor((nowMs - first) / 3_600_000) * 3_600_000;
  const beforeHour = day.bins15.filter((b) => b.start < currentHour).reduce((s, b) => s + b.kcal, 0);
  const hourTotal = day.bins15
    .filter((b) => b.start >= currentHour && b.start < currentHour + 3_600_000)
    .reduce((s, b) => s + b.kcal, 0);
  const interpolated = (t: number, raw: number) =>
    Number.isFinite(nowMs) && t >= currentHour && t <= currentHour + 3_600_000
      ? beforeHour + (hourTotal * (t - currentHour)) / 3_600_000
      : raw;
  let total = 0;
  for (const b of day.bins15) {
    const end = b.start + 900_000;
    if (nowMs > b.start && nowMs < end)
      series.push({ t: nowMs, v: interpolated(nowMs, total + (b.kcal * (nowMs - b.start)) / 900_000) });
    total += b.kcal;
    (end <= nowMs ? series : future).push({ t: end, v: interpolated(end, total) });
  }
  return { series, future };
}
