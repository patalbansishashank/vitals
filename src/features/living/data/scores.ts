/**
 * Body-signal scores as the Living screens read them (design/screens/scores.md; docs/SUITE_SPEC.md §4.4): one tile per
 * score (`ScoreTileModel`) and a detail model per score (`ScoreDetailModel`). Values, bands, states, flags and plan
 * effects come from the source — the UI renders them and never computes them.
 *
 * TODO(E10): the real `ScoresSource` over `bioScores` (`ScoreResult`), `ScoreDef` (formula text, evidence, plan
 * effects, versions), `bio.baselines` (normal ranges), `bio.sources` (device tiers) and the decision log. Install it with
 * `<ScoresSourceContext.Provider value={…}>`; until then `stubScoresSource` (synthetic numbers, not real data) answers.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ScoreHistoryData } from '@/features/charts/living/types';
import { currentDay, systemClock } from '../clock';
import { fmtDayMonth } from '../format';

export type ScoreScope = 'today' | 'lastNight' | '7d' | '28d';
export type ScoreGrade = 'A' | 'B' | 'C' | 'D';

/** One score as a tile (COMPONENTS §13.14). Titles are plain-first and lowercase ("hrv status"). */
export interface ScoreTileModel {
  scoreId: string;
  title: string;
  /** "v1.2". */
  version: string;
  /** Evidence certainty of what the score claims. */
  grade: ScoreGrade;
  kind: 'measurement' | 'estimate' | 'index' | 'flag';
  display: 'number' | 'state' | 'band';
  status: 'ok' | 'withheld' | 'insufficient_baseline' | 'borderline';
  /** Null when withheld (never a guessed value) or for state/band displays. */
  value: number | null;
  unit: string;
  decimals: number;
  /** Likely range (80 %) of `value`. */
  band?: { lo: number; hi: number };
  /** State or band word ("within your normal", "midpoint 03:10"). */
  state?: string;
  /** Personal normal range. */
  normal?: { lo: number; hi: number };
  /** 7-day mean and its likely range (borderline draws the range as a bracket). */
  mean7?: number;
  mean7Range?: { lo: number; hi: number };
  lastNight?: number;
  /** BaselineGauge domain. */
  gauge?: { min: number; max: number };
  /** Withheld: the unmet requirement ("needs 14 nights · 9 so far"). */
  withheld?: { needed: number; have: number; unit: string };
  /** Insufficient baseline: "normal range forming · 9 of 14 nights". */
  baselineForming?: { needed: number; have: number };
  device?: { kind: 'ring' | 'watch' | 'scale' | 'phone'; name: string; tier: 'A' | 'B' | 'C' };
  /** Tier C on HRV, autonomic load, SpO2 and temperature: change from your normal only, never an absolute number. */
  trendOnly?: boolean;
  /** "2 below your normal", "+3 % vs your normal". */
  vsNormalText?: string;
  /** Flags: the word is shown, the level code never is. */
  flag?: { level: 'yellow' | 'amber' | 'red'; word: string; nights?: number };
  /** The score changed something today: "this week's fasts are paused" (+ Undo). */
  planLink?: { text: string; changeId: string };
  /** Vendor opinion (only when the vendor-scores stream is on). */
  vendor?: { name: string; says: string };
  /** A short qualifier after the value ("asleep"). */
  valueSuffix?: string;
  /** Secondary text on the value line ("from 4 of 6 parts", "7-night average"). */
  line?: string;
  /** Quiet mode word for convenience indices ("about usual", "lower than usual", "higher than usual"). */
  quietWord?: string;
}

export interface ScoreDecision {
  date: LocalDate;
  /** "below → eased Tuesday's lift". */
  text: string;
  version: string;
  changeId: string | null;
}

export interface ScoreDetailModel {
  tile: ScoreTileModel;
  /** Sentence-case name for the screen title ("HRV status"). */
  heading: string;
  /** Lines under the gauge: "7-day mean 42 ms (likely 39–45) · your normal 38–47". */
  readings: string[];
  /** "medium — 6 of 7 nights". */
  confidence: string | null;
  /** Flags: risk first, then what the plan did. */
  flagText?: string;
  history: ScoreHistoryData;
  /** The score definition's formula text. */
  formula: string;
  inputs: string[];
  evidence: { grade: ScoreGrade; text: string };
  /** What it changes in the plan (or "Shown and trended only — no established link to your plan."). */
  planEffects: string;
  /** False for display-only scores (no established mechanism). */
  changesPlan: boolean;
  decisions: ScoreDecision[];
  deviceText: string;
  versions: Array<{ version: string; date: LocalDate; current: boolean; text: string }>;
  /** Convenience indices: the parts and their weights. */
  contributors?: Array<{ part: string; today: string; score: number | null; weightSet: number; weightUsed: number; available: boolean }>;
}

/** A score in the quiet "more:" list under the tiles. */
export interface ScoreMoreItem {
  scoreId: string;
  title: string;
  /** False when the stream is not brought in ("not brought in · change"). */
  broughtIn: boolean;
}

export interface ScoresSource {
  tiles(scope: ScoreScope): ScoreTileModel[];
  detail(scoreId: string): ScoreDetailModel | null;
  /** The person's other scores, for the quiet link list. */
  more(): ScoreMoreItem[];
  subscribe(listener: () => void): () => void;
  revision(): number;
}

/* ------------------------------------------------------------------ synthetic stand-in */

/** Deterministic [0, 1) from a string (FNV-1a). */
function noise(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const RING = { kind: 'ring', name: 'Colmi R10', tier: 'C' } as const;
const H = (h: number, m: number) => h + m / 60;

function baseTiles(scope: ScoreScope): Record<string, ScoreTileModel> {
  const week = scope === '7d' || scope === '28d';
  const span = scope === '28d' ? '28-night average' : '7-night average';
  return {
    'sleep.tst': {
      scoreId: 'sleep.tst',
      title: 'sleep',
      version: 'v1.0',
      grade: 'B',
      kind: 'measurement',
      display: 'number',
      status: 'ok',
      value: week ? (scope === '28d' ? H(7, 0) : H(6, 55)) : H(7, 10),
      unit: 'h',
      decimals: 0,
      band: week ? (scope === '28d' ? { lo: H(6, 45), hi: H(7, 15) } : { lo: H(6, 30), hi: H(7, 20) }) : { lo: H(6, 10), hi: H(8, 10) },
      valueSuffix: 'asleep',
      ...(week ? { line: span } : {}),
      device: RING,
    },
    'hrv.status': {
      scoreId: 'hrv.status',
      title: 'hrv status',
      version: 'v1.2',
      grade: 'B',
      kind: 'measurement',
      display: 'state',
      status: 'ok',
      value: null,
      unit: '%',
      decimals: 0,
      state: 'within your normal',
      normal: { lo: -8, hi: 8 },
      mean7: 3,
      mean7Range: { lo: -1, hi: 7 },
      lastNight: 5,
      gauge: { min: -20, max: 20 },
      device: RING,
      trendOnly: true,
      vsNormalText: '7-day +3 % vs your normal',
      vendor: { name: 'Oura', says: 'balanced' },
    },
    'hr.rhr_night': {
      scoreId: 'hr.rhr_night',
      title: 'resting heart rate',
      version: 'v1.0',
      grade: 'B',
      kind: 'measurement',
      display: 'number',
      status: 'ok',
      value: week ? 55 : 54,
      unit: 'bpm',
      decimals: 0,
      normal: { lo: 53, hi: 59 },
      vsNormalText: week ? '1 below your normal' : '2 below your normal',
      ...(week ? { line: span } : {}),
      device: RING,
    },
    'illness.nightsignal': {
      scoreId: 'illness.nightsignal',
      title: 'illness watch',
      version: 'v1.0',
      grade: 'C',
      kind: 'flag',
      display: 'band',
      status: 'ok',
      value: null,
      unit: '',
      decimals: 0,
      state: 'signs of strain',
      flag: { level: 'amber', word: 'signs of strain', nights: 2 },
      planLink: { text: 'this week’s fasts are paused', changeId: 'chg-fasts-paused' },
      device: RING,
    },
    'fitness.vo2max': {
      scoreId: 'fitness.vo2max',
      title: 'cardio fitness',
      version: 'v1.0',
      grade: 'B',
      kind: 'estimate',
      display: 'number',
      status: 'withheld',
      value: null,
      unit: 'ml/kg/min',
      decimals: 0,
      withheld: { needed: 14, have: 9, unit: 'nights' },
      device: RING,
    },
    'readiness.index': {
      scoreId: 'readiness.index',
      title: 'readiness',
      version: 'v4.0',
      grade: 'D',
      kind: 'index',
      display: 'number',
      status: 'ok',
      value: 64,
      unit: '/ 100',
      decimals: 0,
      line: 'from 4 of 6 parts',
      quietWord: 'about usual',
      device: RING,
    },
    'load.trimp': {
      scoreId: 'load.trimp',
      title: 'training load',
      version: 'v1.0',
      grade: 'C',
      kind: 'estimate',
      display: 'number',
      status: 'ok',
      value: 420,
      unit: '',
      decimals: 0,
      band: { lo: 360, hi: 480 },
      line: 'this week, heart-rate based · 4-week average 380',
      device: RING,
    },
    'sleep.midpoint': {
      scoreId: 'sleep.midpoint',
      title: 'sleep timing',
      version: 'v1.0',
      grade: 'B',
      kind: 'measurement',
      display: 'band',
      status: 'ok',
      value: null,
      unit: '',
      decimals: 0,
      state: 'midpoint 03:10 · weekend shift 1 h 20',
      device: RING,
    },
    'sleep.sri': {
      scoreId: 'sleep.sri',
      title: 'sleep regularity',
      version: 'v1.0',
      grade: 'B',
      kind: 'measurement',
      display: 'number',
      status: 'insufficient_baseline',
      value: 78,
      unit: '/ 100',
      decimals: 0,
      line: 'adults’ median 81 (middle half 74–86)',
      baselineForming: { needed: 14, have: 9 },
      device: RING,
    },
    'temp.deviation': {
      scoreId: 'temp.deviation',
      title: 'temperature change',
      version: 'v1.0',
      grade: 'C',
      kind: 'measurement',
      display: 'number',
      status: 'ok',
      value: 0.3,
      unit: '°C',
      decimals: 1,
      trendOnly: true,
      vsNormalText: '+0.3 °C vs your normal',
      device: RING,
    },
  };
}

const PRIMARY = ['sleep.tst', 'hrv.status', 'hr.rhr_night', 'illness.nightsignal', 'fitness.vo2max', 'readiness.index'] as const;
const TODAY_IDS = ['sleep.tst', 'hrv.status', 'hr.rhr_night'] as const;
const MORE = ['load.trimp', 'sleep.midpoint', 'sleep.sri', 'temp.deviation'] as const;

interface DetailText {
  heading: string;
  readings: string[];
  confidence: string | null;
  flagText?: string;
  formula: string;
  inputs: string[];
  evidence: { grade: ScoreGrade; text: string };
  planEffects: string;
  changesPlan: boolean;
  decisions: Array<{ ago: number; text: string; changeId: string | null }>;
  deviceText: string;
  versions: Array<{ version: string; ago: number; text: string }>;
  contributors?: ScoreDetailModel['contributors'];
  history: { base: number; spread: number; normal?: [number, number]; decimals: number; unit: string; category: ScoreHistoryData['category']; versionAgo?: number; versionLabel?: string };
}

const TIER_C_TEXT = 'tier C — not independently checked.';

const DETAILS: Record<string, DetailText> = {
  'sleep.tst': {
    heading: 'Sleep',
    readings: ['last night 7 h 10 asleep (likely 6 h 10–8 h 10)', '7-night average 6 h 55'],
    confidence: 'medium — the ring covered 96 % of the night',
    formula: 'Time asleep in your main sleep, from the ring’s sleep stages. Minutes the ring couldn’t classify are not counted as sleep. For a tier C ring the likely range is about ±60 min.',
    inputs: ['sleep stages (night) · 1 night · ring'],
    evidence: { grade: 'B', text: 'probably measures time asleep to within about an hour' },
    planEffects: 'Replaces the sleep the plan assumed with the sleep you actually got. A short night makes the next session lighter — applied by itself with Undo while Let the plan ease itself is on, otherwise proposed on Today.',
    changesPlan: true,
    decisions: [{ ago: 0, text: 'plan assumed 7 h 30, you slept 6 h 10 → today’s session is shorter', changeId: 'chg-ease-session' }],
    deviceText: `${TIER_C_TEXT} Vitals uses its sleep stages for time asleep with a wide likely range.`,
    versions: [{ version: 'v1.0', ago: 40, text: 'first version.' }],
    history: { base: 7, spread: 0.9, decimals: 1, unit: 'h', category: 'recovery' },
  },
  'hrv.status': {
    heading: 'HRV status',
    readings: ['7-day mean +3 % vs your normal (likely −1 to +7 %) · your normal −8 to +8 %', 'last night +5 % vs your normal'],
    confidence: 'medium — 6 of 7 nights',
    formula: 'The average of the last 7 nights of heart-rate variability, compared with your normal: the 60 nights before that, ± half a standard deviation. Needs 3 nights in the last 7 and 14 nights of history.',
    inputs: ['heart-rate variability (night) · 7 nights · ring'],
    evidence: { grade: 'B', text: 'probably tracks recovery' },
    planEffects: 'Below your normal → the next hard session becomes easy or rest, and no fast over 24 h starts. Proposed on Today; applied by itself only when it makes the plan lighter.',
    changesPlan: true,
    decisions: [{ ago: 19, text: 'below → eased Tuesday’s lift', changeId: null }],
    deviceText: `${TIER_C_TEXT} Vitals uses its heart-rate variability only as change from your own normal, never as an absolute number.`,
    versions: [
      { version: 'v1.2', ago: 11, text: 'heart-rate variability now ignores the first 30 min of sleep. Typical change: −2 % vs your normal.' },
      { version: 'v1.1', ago: 60, text: 'nights with less than 3 h of data are left out.' },
      { version: 'v1.0', ago: 120, text: 'first version.' },
    ],
    history: { base: 2, spread: 9, normal: [-8, 8], decimals: 0, unit: '%', category: 'recovery', versionAgo: 11, versionLabel: 'v1.2' },
  },
  'hr.rhr_night': {
    heading: 'Resting heart rate',
    readings: ['last night 54 bpm · 2 below your normal', 'your normal 53–59 bpm'],
    confidence: 'high — 7 of 7 nights',
    formula: 'The lowest steady 30-minute heart rate in your main sleep, compared with your normal: the middle of the last 28 nights.',
    inputs: ['heart rate (night) · 1 night · ring'],
    evidence: { grade: 'B', text: 'probably tracks fitness and recovery over weeks' },
    planEffects: 'Updates the resting heart rate the model uses. It never flags overreaching on its own.',
    changesPlan: true,
    decisions: [],
    deviceText: `${TIER_C_TEXT} Resting heart rate from a ring is usually within a few beats of a chest strap, so it is shown as a number.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: 56, spread: 3, normal: [53, 59], decimals: 0, unit: 'bpm', category: 'recovery' },
  },
  'illness.nightsignal': {
    heading: 'Illness watch',
    readings: ['signs of strain · 2 nights'],
    confidence: 'medium — 7 of 7 nights',
    flagText: 'Your temperature has been up about 0.4 °C for 2 nights. That often comes before a cold — or after alcohol, travel, a late meal or a hard session. This week’s fasts are paused; Undo puts them back.',
    formula: 'Each night, resting heart rate and temperature change are compared with your normal. Two nights in a row above the thresholds raise the watch one step; normal nights lower it.',
    inputs: ['heart rate (night) · 7 nights · ring', 'temperature change (night) · 7 nights · ring'],
    evidence: { grade: 'C', text: 'may give a day or two of warning before a cold' },
    planEffects: 'Signs of strain or strong signs of strain → training easy or rest and planned fasts paused (applied with Undo), and a re-plan is offered. Worth watching → the Coach is told.',
    changesPlan: true,
    decisions: [{ ago: 0, text: 'signs of strain → this week’s fasts paused', changeId: 'chg-fasts-paused' }],
    deviceText: `${TIER_C_TEXT} The watch uses changes from your own normal only.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: 0.1, spread: 0.3, normal: [-0.3, 0.3], decimals: 1, unit: '°C', category: 'recovery' },
  },
  'fitness.vo2max': {
    heading: 'Cardio fitness',
    readings: ['needs 14 nights of resting heart rate · 9 so far'],
    confidence: null,
    formula: 'From your runs (speed and heart rate on steady efforts), or from your resting and maximum heart rate, or from a field or lab test. Needs 14 nights of resting heart rate for the heart-rate method.',
    inputs: ['resting heart rate · 14 nights · ring', 'workouts with heart rate · any'],
    evidence: { grade: 'B', text: 'probably estimates cardio fitness within about 10 %' },
    planEffects: 'Sets the intensity of cardio sessions and is an observation for the model.',
    changesPlan: true,
    decisions: [],
    deviceText: `${TIER_C_TEXT} Ring-only heart rate can’t estimate cardio fitness from workouts; the resting-heart-rate method is used.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: Number.NaN, spread: 0, decimals: 0, unit: 'ml/kg/min', category: 'performance' },
  },
  'readiness.index': {
    heading: 'Readiness',
    readings: ['64 / 100 today · from 4 of 6 parts', 'a normal day lands around 60–70'],
    confidence: 'medium — 4 of 6 parts available',
    formula: 'Readiness is a convenience index, not a measurement. It is a weighted mean of the parts available today: HRV 25 %, resting heart rate 15 %, sleep 30 %, temperature 10 %, yesterday’s training 10 %, food 10 % (4 of 6 available today, re-weighted).',
    inputs: ['hrv status', 'resting heart rate', 'sleep', 'temperature change'],
    evidence: { grade: 'D', text: 'might reflect how rested you are, by mechanism' },
    planEffects: 'Shown and trended only — no established link to your plan. The plan reacts to the parts, not to this number.',
    changesPlan: false,
    decisions: [],
    deviceText: `${TIER_C_TEXT} The parts from the ring are used as changes from your normal.`,
    versions: [{ version: 'v4.0', ago: 120, text: 'first version in Vitals.' }],
    contributors: [
      { part: 'hrv', today: '+3 % vs normal', score: 62, weightSet: 0.25, weightUsed: 0.29, available: true },
      { part: 'resting heart rate', today: '54 bpm', score: 70, weightSet: 0.15, weightUsed: 0.18, available: true },
      { part: 'sleep', today: '7 h 10', score: 66, weightSet: 0.3, weightUsed: 0.35, available: true },
      { part: 'temperature', today: '+0.3 °C', score: 52, weightSet: 0.1, weightUsed: 0.12, available: true },
      { part: 'yesterday’s training', today: 'not logged', score: null, weightSet: 0.1, weightUsed: 0, available: false },
      { part: 'food', today: 'not logged', score: null, weightSet: 0.1, weightUsed: 0, available: false },
    ],
    history: { base: 64, spread: 8, decimals: 0, unit: '/ 100', category: 'recovery' },
  },
  'load.trimp': {
    heading: 'Training load',
    readings: ['this week 420 (heart-rate based, likely 360–480)', '4-week average 380'],
    confidence: 'low — ring heart rate during workouts',
    formula: 'Minutes in each heart-rate zone, weighted by how hard the zone is, summed over the week.',
    inputs: ['heart rate (workouts) · 7 days · ring'],
    evidence: { grade: 'C', text: 'may track how much training you are absorbing' },
    planEffects: 'Weekly volume rises at most 10 % over your 4-week average (proposed on Today).',
    changesPlan: true,
    decisions: [],
    deviceText: `${TIER_C_TEXT} Heart rate during workouts from a ring is less reliable, so the range is wide.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: 60, spread: 40, decimals: 0, unit: '', category: 'performance' },
  },
  'sleep.midpoint': {
    heading: 'Sleep timing',
    readings: ['midpoint 03:10 · weekend shift 1 h 20'],
    confidence: 'medium — 3 free and 9 work nights',
    formula: 'The middle of your main sleep, on work nights and free nights, and the shift between them.',
    inputs: ['sleep sessions · 14 nights · ring'],
    evidence: { grade: 'B', text: 'probably relates to how rested you feel' },
    planEffects: 'Timing advice for the Coach only.',
    changesPlan: false,
    decisions: [],
    deviceText: `${TIER_C_TEXT} Bed and wake times from a ring are usually within a few minutes.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: 3.2, spread: 0.8, decimals: 1, unit: 'h', category: 'recovery' },
  },
  'sleep.sri': {
    heading: 'Sleep regularity',
    readings: ['78 / 100 · adults’ median 81 (middle half 74–86)', 'normal range forming · 9 of 14 nights'],
    confidence: 'low — 9 of 14 nights',
    formula: 'How often you are asleep or awake at the same clock times on consecutive days, from 0 to 100.',
    inputs: ['sleep sessions · 14 nights · ring'],
    evidence: { grade: 'B', text: 'probably relates to health over years' },
    planEffects: 'Below 74 for 2 weeks → a regularity suggestion, proposed on Today.',
    changesPlan: true,
    decisions: [],
    deviceText: `${TIER_C_TEXT} Bed and wake times from a ring are usually within a few minutes.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: 78, spread: 6, decimals: 0, unit: '/ 100', category: 'recovery' },
  },
  'temp.deviation': {
    heading: 'Temperature change',
    readings: ['+0.3 °C vs your normal', 'shown as change only: a ring can’t measure body temperature'],
    confidence: 'medium — 7 of 7 nights',
    formula: 'Skin temperature during your main sleep compared with your normal: the middle of the last 28 nights.',
    inputs: ['skin temperature (night) · 14 nights · ring'],
    evidence: { grade: 'C', text: 'may help spot a cold early' },
    planEffects: 'Supports the illness watch; it doesn’t change the plan on its own.',
    changesPlan: false,
    decisions: [],
    deviceText: `${TIER_C_TEXT} Vitals uses its temperature only as change from your own normal, never as an absolute number.`,
    versions: [{ version: 'v1.0', ago: 120, text: 'first version.' }],
    history: { base: 0.1, spread: 0.3, normal: [-0.3, 0.3], decimals: 1, unit: '°C', category: 'recovery' },
  },
};

/**
 * The user-facing wording for a score's evidence and plan effect (the live source uses it in place of the score
 * definitions' maintainer text, which cites research notes and model node names). Null for a score without copy.
 */
export function scoreCopy(scoreId: string): { evidenceText: string; planEffects: string } | null {
  const d = DETAILS[scoreId];
  return d ? { evidenceText: d.evidence.text, planEffects: d.planEffects } : null;
}

const HISTORY_DAYS = 120;

function historyOf(id: string, today: LocalDate, h: DetailText['history']): ScoreHistoryData {
  const start = addDays(today, -(HISTORY_DAYS - 1));
  const nightly: number[] = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    if (!Number.isFinite(h.base) || noise(`${id}:gap:${i}`) < 0.12) nightly.push(Number.NaN);
    else nightly.push(Number((h.base + (noise(`${id}:${i}`) - 0.5) * h.spread * 2).toFixed(Math.max(1, h.decimals))));
  }
  const mean7 = nightly.map((_, i) => {
    const win = nightly.slice(Math.max(0, i - 6), i + 1).filter(Number.isFinite);
    return win.length >= 3 ? Number((win.reduce((a, b) => a + b, 0) / win.length).toFixed(Math.max(1, h.decimals))) : Number.NaN;
  });
  const data: ScoreHistoryData = { startDate: start, days: HISTORY_DAYS, unit: h.unit, decimals: h.decimals, nightly, mean7, category: h.category };
  if (h.normal) {
    const [lo, hi] = h.normal;
    data.normal = { lo: nightly.map((_, i) => (i < 14 ? Number.NaN : lo)), hi: nightly.map((_, i) => (i < 14 ? Number.NaN : hi)) };
  }
  if (h.versionAgo !== undefined && h.versionLabel) {
    data.versions = [{ day: HISTORY_DAYS - 1 - h.versionAgo, label: `${h.versionLabel} from ${fmtDayMonth(addDays(today, -h.versionAgo))}` }];
  }
  return data;
}

/** The synthetic stand-in, anchored at `today`. */
export function createStubScoresSource(today: LocalDate): ScoresSource {
  const cache = new Map<ScoreScope, ScoreTileModel[]>();
  const details = new Map<string, ScoreDetailModel | null>();
  return {
    tiles: (scope) => {
      let out = cache.get(scope);
      if (!out) {
        const all = baseTiles(scope);
        const ids: readonly string[] = scope === 'today' ? [...TODAY_IDS, ...PRIMARY.filter((id) => all[id]?.kind === 'flag')] : PRIMARY;
        out = ids.map((id) => all[id]!).filter(Boolean);
        cache.set(scope, out);
      }
      return out;
    },
    detail: (scoreId) => {
      if (details.has(scoreId)) return details.get(scoreId)!;
      const tile = baseTiles('lastNight')[scoreId];
      const d = DETAILS[scoreId];
      const model: ScoreDetailModel | null =
        tile && d
          ? {
              tile,
              heading: d.heading,
              readings: d.readings,
              confidence: d.confidence,
              ...(d.flagText ? { flagText: d.flagText } : {}),
              history: historyOf(scoreId, today, d.history),
              formula: d.formula,
              inputs: d.inputs,
              evidence: d.evidence,
              planEffects: d.planEffects,
              changesPlan: d.changesPlan,
              decisions: d.decisions.map((x) => ({ date: addDays(today, -x.ago), text: x.text, version: tile.version, changeId: x.changeId })),
              deviceText: d.deviceText,
              versions: d.versions.map((v, i) => ({ version: v.version, date: addDays(today, -v.ago), current: i === 0, text: v.text })),
              ...(d.contributors ? { contributors: d.contributors } : {}),
            }
          : null;
      details.set(scoreId, model);
      return model;
    },
    more: () => [
      ...MORE.map((id) => ({ scoreId: id, title: baseTiles('lastNight')[id]!.title, broughtIn: true })),
      { scoreId: 'spo2.night', title: 'blood oxygen', broughtIn: false },
    ],
    subscribe: () => () => undefined,
    revision: () => 0,
  };
}

/** The app-wide stand-in (synthetic numbers), anchored at today's plan day. */
export const stubScoresSource: ScoresSource = createStubScoresSource(currentDay(systemClock));

export const ScoresSourceContext = createContext<ScoresSource>(stubScoresSource);

export function useScoresSource(): ScoresSource {
  return useContext(ScoresSourceContext);
}

function useRevision(src: ScoresSource): number {
  return useSyncExternalStore(
    (l) => src.subscribe(l),
    () => src.revision(),
    () => src.revision(),
  );
}

/** Tiles for a scope (Today's strip uses 'today': sleep, HRV status, resting heart rate and any active flag). */
export function useScores(scope: ScoreScope): ScoreTileModel[] {
  const src = useScoresSource();
  const rev = useRevision(src);
  return useMemo(() => {
    void rev;
    return src.tiles(scope);
  }, [src, rev, scope]);
}

/** The detail of one score, or null for an unknown id. */
export function useScoreDetail(scoreId: string | undefined): ScoreDetailModel | null {
  const src = useScoresSource();
  const rev = useRevision(src);
  return useMemo(() => {
    void rev;
    return scoreId ? src.detail(scoreId) : null;
  }, [src, rev, scoreId]);
}

/** The quiet "more:" list. */
export function useMoreScores(): ScoreMoreItem[] {
  const src = useScoresSource();
  const rev = useRevision(src);
  return useMemo(() => {
    void rev;
    return src.more();
  }, [src, rev]);
}
