/**
 * Copy for Body signals › Sleep (design/screens/ring-pages.md §4.3, §7.2, §7.3). Plain words, sentence case, lowercase
 * engraved labels, numbers then a thin space then the unit. Stage words come from `RING_COPY.stage`.
 */
import { THIN_SPACE as T, EN_DASH } from '@/components/lib/format';
import type { PeriodKind } from '../models';

/** "7 h 12 min" / "45 min" / "7 h" (strip readouts). */
export function durLong(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60), m = total % 60;
  if (h === 0) return `${m}${T}min`;
  return m === 0 ? `${h}${T}h` : `${h}${T}h ${m}${T}min`;
}

/** "7 h 05" / "45 min" / "7 h" (crosshair readouts, tables, header lines). */
export function durShort(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60), m = total % 60;
  if (h === 0) return `${m}${T}min`;
  return m === 0 ? `${h}${T}h` : `${h}${T}h ${String(m).padStart(2, '0')}`;
}

/** "23:40 – 07:05". */
export const clockRange = (a: string, b: string): string => `${a} ${EN_DASH} ${b}`;

export const SLEEP_COPY = {
  title: {
    stages: 'night stages and overnight readings',
    minutes: 'stage minutes',
    naps: 'naps and other sleep',
    bars: 'sleep per night',
    barsYear: 'sleep per month',
    window: 'when you slept',
    numbers: 'numbers',
  },
  strip: {
    label: 'The night in numbers',
    asleep: 'asleep',
    inBed: 'in bed',
    awake: 'awake',
    unknown: 'unknown',
    unknownCaption: 'the ring could not tell the stage',
    vendor: 'your ring says',
    vendorCaption: 'their estimate',
    noData: 'no data',
  },
  vendorLine: (n: number) => `Your ring says ${n} (their estimate)`,
  provisional: 'Stages may still change: the ring hadn’t finished this night.',
  stillChanging: 'still changing',
  stillChangingTable: '(still changing)',
  onlyUnknown: 'Your ring recorded when you slept but not the stages.',
  noTimes: 'This night has no bed and wake times.',
  empty: {
    day: 'No night recorded.',
    week: 'No sleep recorded this week.',
    month: 'No sleep recorded this month.',
    year: 'No sleep recorded this year.',
  } satisfies Record<PeriodKind, string>,
  noData: 'no data',
  bed: (c: string) => `bed ${c}`,
  up: (c: string) => `up ${c}`,
  inBed: (a: string, b: string) => `in bed ${clockRange(a, b)}`,
  nightTo: (day: string) => `Night to ${day}`,

  /* overnight lanes (§7.3.2) */
  lane: { hr: 'heart rate', spo2: 'blood oxygen', temp: 'skin temperature' },
  unit: { hr: 'bpm', spo2: '%', C: '°C', F: '°F' },
  laneEmpty: {
    hr: 'no heart-rate readings this night',
    spo2: 'no blood-oxygen readings this night',
    temp: 'no skin-temperature readings this night',
  },
  tempNoNormal: 'skin temperature: your normal is not known yet',
  laneReading: 'reading…',
  laneFailed: 'these readings couldn’t be loaded',
  retryLanes: 'Try again',
  lowest: (n: number) => `lowest ${n}`,
  yourNormal: 'your normal',
  noStage: 'no stage',
  bpm: (n: number) => `${n}${T}bpm`,
  pct: (n: number) => `${n}${T}%`,
  /** Blood oxygen as change from the person's normal (% points). */
  pctChange: (signed: string) => `${signed}${T}%`,
  temp: (signed: string, unit: 'C' | 'F') => `${signed}${T}°${unit}`,
  gapNote: 'Breaks in a line are times with no readings.',

  /* tables */
  col: {
    stage: 'stage',
    start: 'start',
    end: 'end',
    minutes: 'minutes',
    share: 'share of asleep',
    time: 'time',
    bpm: 'bpm',
    pctCol: '%',
    date: 'date',
    asleep: 'asleep',
    deep: 'deep',
    light: 'light',
    rem: 'REM',
    unknown: 'unknown',
    awake: 'awake',
    bed: 'bed',
    up: 'up',
    month: 'month',
    nights: 'nights recorded',
    avgAsleep: 'average asleep',
    other: 'naps and other sleep',
    measure: 'measure',
    value: 'value',
    basis: 'over',
  },
  tableStages: 'stages of the night',
  tableBuckets: 'every 5 minutes',
  tableBars: 'sleep per night',
  tableYear: 'sleep per month',
  tableWindow: 'bed and wake times',
  tableNumbers: 'numbers for the period',
  notAsleep: 'not asleep',
  uncovered: (m: number) => `${m}${T}min with no stage recorded.`,

  /* naps (§7.3.5) */
  nap: 'nap',
  another: 'another sleep',
  sessionRow: (kind: string, range: string | null, dur: string) => (range ? `${kind} · ${range} · ${dur}` : `${kind} · ${dur}`),

  /* week / month / year headers and readouts (§7.3.4, §7.3.6) */
  avgAsleep: (dur: string, n: number) => `average ${dur} asleep · average of ${n} recorded night${n === 1 ? '' : 's'}`,
  shares: (parts: string, n: number) => `${parts} (${n} night${n === 1 ? '' : 's'} with stages)`,
  noStagesYet: 'no nights with stages',
  share: (word: string, pct: number) => `${word} ${pct}${T}%`,
  stageDur: (word: string, dur: string) => `${word} ${dur}`,
  asleepDur: (dur: string) => `${dur} asleep`,
  avgAsleepDur: (dur: string) => `average ${dur} asleep`,
  nightsOf: (n: number, of: number) => `${n} of ${of} nights recorded`,
  goal: (h: number) => `goal ${h}${T}h`,
  hours: (h: number) => (h === 0 ? '0' : `${h}${T}h`),
  usually: (c: string) => `usually ${c}`,
  usualBedWake: (a: string, b: string) => `usually in bed ${clockRange(a, b)}`,

  /* numbers strip (week / month / year) */
  num: {
    label: 'Sleep numbers for the period',
    avgAsleep: 'average asleep',
    avgAsleepCaption: (n: number) => `average of ${n} recorded night${n === 1 ? '' : 's'}`,
    usual: 'usually in bed',
    usualCaption: 'middle bed and wake time',
    avgAwake: 'average awake',
    longest: 'longest night',
    shortest: 'shortest night',
    nights: 'nights recorded',
    naps: 'naps',
    napsCaption: 'not counted as asleep',
    recordedNights: 'recorded nights',
  },
} as const;
