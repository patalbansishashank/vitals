/**
 * Decoder (dossier 18 §4.4.3-4.4.5; MODEL_SPEC §10.1): genome x ∈ [0,1]ⁿ → decoded plan (phases, day-types, weekly
 * pattern, overlays, events) → engine `Schedule`. Pure and deterministic; no engine calls.
 *
 * Layers, in the 18 §4.4.4 precedence order: (1) phase templates → a day-spec per date via the weekly pattern anchored
 * at the start date, (2) ramps (novice RT sets, steps, fibre — applied by repair, which logs them), (3) recurring
 * overlays (low / zero / refeed / 24-h fast days), (4) events with locked recovery spans. User hard constraints and
 * input-space safety (layers 5-6) are enforced by `repair`. Gene values are mapped into ranges that already respect
 * the person's caps (decoder clamp, 18 §4.4.6 layer 2), so repair rarely has to act.
 */
import { habitualTemplate } from '../../core/compileSchedule';
import type { RepairEntry } from '../optim/types';
import type { CardioModality, DayTemplate, ExerciseSession, FastEvent, MacroSpec, Schedule, ScheduleBlock, ScheduleDay, TrainingRegion } from '../../types/schedule';
import { IDEAL_SLEEP, mod24, sleepFromMidpoint, sleepMidpointRange } from './ideal';
import { BLOCKS, type BlockId } from './registry/blocks';
import { LATE_EATING_GAP_H, MIN_MEAL_SPACING_H, type PlanningContext } from './context';
import { estimateDay, mealClocks, mergeDay } from './dayMath';
import { HC } from './safety';
import { eatingGapNeedH, fastEndDay, recoveryDayCount, refeedDayFactors, type WaterFastH } from './fastMath';
import { CARDIO_BANDS, OVERLAY_HOSTS, RT_SETS_RANGE, energyRange, proteinRange, rtPrescription, type SkeletonStructure, type SegmentSkeleton } from './skeleton';
import { equipmentRegionCap, equipmentSetsCap } from './equipment';

export const REGIONS: readonly TrainingRegion[] = ['chest', 'upperBack', 'shoulders', 'arms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
/** 09 §4.13 default minutes per set incl. rest (core/defaults DEFAULTS.rtMinPerSet). */
export const MIN_PER_SET = 2.5;
/** Share of a session's time assumed available for resistance sets when sizing the minimum session count (PROPOSED). */
export const SESSION_TIME_SHARE = 0.85;
/** Check-in re-anchoring of '% of maintenance' every 4 weeks (18 §5 `checkIn`; MODEL_SPEC §10.1). */
export const CHECK_IN_DAYS = 28;
/** Event spacing periods (13 B14: ≤ 1 per 2 weeks; B15: ≤ 1 per month; 17 HC-F2 T4: ≤ 1 per 12 weeks). */
/** Planned fat share floor, % of energy (17 HC-M3 15 % plus headroom for the Simulator's W-M06, R-PLAN-SAFETY). */
export const FAT_PLAN_PCT_E = 17;
/** Sodium on fast-touched days, g (17 §4.3.3: T2 ≥ 36 h 1.5-2.5, T3/T4 2.0-3.0). */
export const FAST_SODIUM_G = 2.5;
/** Sodium floor on very-low-carbohydrate days, g (17 §3 W-M08/W-M12). */
export const KETO_SODIUM_G = 3;
/**
 * Sodium on low-energy days (B11, ≈ 600 kcal), g: the day's food sodium falls with its energy, and with protein kept up
 * such a day is very low in carbohydrate, where the Simulator's W-M12 wants ≥ 1.5 g (17 HC-M6: plan 1.5-2.3 g/d).
 */
export const LOW_DAY_SODIUM_G = 2;
export const EVENT_PERIOD_DAYS: Readonly<Record<WaterFastH, number>> = { 48: 14, 72: 30, 120: 84, 168: 84 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (lo: number, hi: number, u: number) => lo + clamp(u, 0, 1) * (hi - lo);

export type DayKind = 'normal' | 'low' | 'zero' | 'refeed';

export interface DecodedPhase {
  index: number;
  segment: number;
  blockId: BlockId;
  role: 'phase' | 'cycleOn' | 'cycleOff';
  startDay: number;
  /** Exclusive. */
  endDay: number;
  energyPct: number;
  proteinGPerKg: number;
  fatGPerKg: number | null;
  carbG: number | null;
  lowKcal: number | null;
  zeroPerWeek: number;
  /** Weekday sets for this phase's special days (0 = Monday). */
  lowWeekdays: number[];
  zeroWeekdays: number[];
  refeedWeekdays: number[];
  fast24Weekdays: number[];
  rtWeekdays: number[];
  cardioWeekdays: number[];
}

export interface Lifestyle {
  windowStartH: number;
  windowLengthH: number;
  meals: number;
  rtSessions: number;
  rtSetsPerRegionWeek: number;
  cardioSessions: number;
  cardioMinutes: number;
  /** Clock hour sessions start (resistance training first, cardio right after), on the 15-minute grid. */
  trainingStartH: number;
  cardioPctVo2max: number;
  steps: number;
  fibreG: number;
  sleepExtraH: number;
  bedH: number;
  wakeH: number;
  creatineG: number;
  omega3G: number;
  viscousG: number;
  refeedPct: number;
  refeedCarbGPerKg: number;
  /** Cardio modality of the sessions (the user's, or the Ideal's modality gene). */
  cardioModality: CardioModality;
  /** Bed and wake come from the Ideal's sleep genes (written on every day's template). */
  sleepGenes: boolean;
}

export interface PlannedEvent {
  lever: 'fastDay24' | 'waterFast';
  startDay: number;
  /** Clock hour of the last meal before the fast; `durationH` is meal to meal (ruling 18:10) = `nominalH`. */
  startH: number;
  durationH: number;
  nominalH: number;
  /** Locked recovery days after the fast (day indices). */
  recoveryDays: number[];
}

export interface DecodedPlan {
  structureId: string;
  horizonDays: number;
  lifestyle: Lifestyle;
  phases: DecodedPhase[];
  /** Per day: phase index and day kind. */
  dayPhase: Int16Array;
  dayKind: DayKind[];
  events: PlannedEvent[];
  /** Decoder-level adjustments (logged by repair as RepairEntry). */
  notes: RepairEntry[];
  schedule: Schedule;
  /** Gene values (value units) and their run-time ranges, in layout order. */
  values: Float64Array;
  ranges: Float64Array;
}

// ---------------------------------------------------------------------------------------------------------------
// gene values with run-time ranges (sequential: later ranges may depend on earlier values)
// ---------------------------------------------------------------------------------------------------------------

interface ValueReader {
  /** Decode gene `path` into [lo, hi]; returns `def` when the gene is absent. */
  real(path: string, lo: number, hi: number, def: number): number;
  int(path: string, lo: number, hi: number, def: number): number;
}

function makeReader(st: SkeletonStructure, x: ArrayLike<number>, values: Float64Array, ranges: Float64Array, round: boolean): ValueReader {
  const pick = (path: string, lo: number, hi: number, def: number, isInt: boolean): number => {
    const i = st.geneIndex[path];
    if (hi < lo) hi = lo;
    if (i === undefined) return clamp(isInt ? Math.round(def) : def, lo, hi);
    const g = st.genes[i]!;
    let v = lerp(lo, hi, x[i]!);
    if (isInt) v = Math.round(v);
    else if (round && g.grid) v = clamp(Math.round(v / g.grid) * g.grid, lo, hi);
    values[i] = v;
    ranges[2 * i] = lo;
    ranges[2 * i + 1] = hi;
    return v;
  };
  return {
    real: (p, lo, hi, def) => pick(p, lo, hi, def, false),
    int: (p, lo, hi, def) => pick(p, Math.ceil(lo - 1e-9), Math.floor(hi + 1e-9), def, true),
  };
}

/** Session length for `setsPerRegion` hard sets in each of the 9 regions, rounded to 5 min (09 §4.13 2.5 min per set). */
export function rtSessionMinutes(setsPerRegion: number): number {
  return Math.max(10, 5 * Math.round((setsPerRegion * REGIONS.length * MIN_PER_SET) / 5));
}

/** Hours of one training day's sessions (resistance training, then cardio on the 5-minute grid, ≥ 20 min). */
export function sessionHoursOf(rtSessions: number, rtSetsPerRegionWeek: number, cardioSessions: number, cardioMinutes: number): number {
  const rtMin = rtSessions > 0 ? rtSessionMinutes(rtSetsPerRegionWeek / rtSessions) : 0;
  const cardioMin5 = cardioSessions > 0 ? Math.max(20, 5 * Math.round(cardioMinutes / 5)) : 0;
  return (rtMin + cardioMin5) / 60;
}

/** Range the Ideal's `train.clockH` gene decodes over: 1 h after waking to 1.5 h + the session before bed (clock h). */
export function trainingClockRange(wakeH: number, bedClock: number, sessionH: number): { lo: number; hi: number } {
  const lo = wakeH + 1;
  return { lo, hi: Math.max(lo, bedClock - 1.5 - sessionH) };
}

/** Nearest quarter hour inside [lo, hi] (the raw value when no quarter hour fits). */
export function quarterIn(v: number, lo: number, hi: number): number {
  let q = Math.round(v * 4) / 4;
  if (q < lo - 1e-9) q = Math.ceil(lo * 4 - 1e-9) / 4;
  if (q > hi + 1e-9) q = Math.floor(hi * 4 + 1e-9) / 4;
  return q >= lo - 1e-9 && q <= hi + 1e-9 ? q : v;
}

/** Window length on the multiple of 15 min × (meals − 1) nearest to `L` inside [lo, hi] (else `L`). */
export function gridLength(L: number, meals: number, lo: number, hi: number): number {
  const step = 0.25 * Math.max(1, meals - 1);
  const cands = [Math.floor(L / step + 1e-9) * step, Math.ceil(L / step - 1e-9) * step, Math.ceil(lo / step - 1e-9) * step, Math.floor(hi / step + 1e-9) * step];
  let best = L;
  let bd = Infinity;
  for (const c of cands) {
    if (c < lo - 1e-9 || c > hi + 1e-9) continue;
    const dist = Math.abs(c - L);
    if (dist < bd - 1e-12) {
      bd = dist;
      best = c;
    }
  }
  return best;
}

/** Evenly split meal clocks of a window (MODEL_SPEC §5.2.4, the engine's 'even' split). */
export function mealClockList(startH: number, lengthH: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (n <= 1 ? startH : startH + (lengthH * i) / (n - 1)));
}

/**
 * Session start on the 15-minute grid (QA item 9): within ± `maxShiftH` of the preferred hour and inside waking hours
 * (≥ 1 h after waking, ending ≥ 1.5 h before bed), no meal from 30 min before the start to the end of the session; among
 * those, closest to the preferred hour with a meal 45 min-4 h before and a meal within 2 h after (08 §4.15 feedings around
 * training; 09: timing earns no hypertrophy multiplier, so this is practicality, not physiology credit).
 */
export function placeTraining(meals: readonly number[], preferredH: number, durH: number, wakeH: number, bedClockH: number, maxShiftH = 3): number {
  if (durH <= 0) return preferredH;
  const lo = Math.max(wakeH + 1, preferredH - maxShiftH);
  const hi = Math.min(bedClockH - 1.5 - durH, preferredH + maxShiftH);
  let best = preferredH;
  let bestScore = Infinity;
  const scan = (from: number, to: number) => {
    for (let s = Math.ceil(from * 4) / 4; s <= to + 1e-9; s += 0.25) {
      const e = s + durH;
      if (meals.some((m) => m > s - 0.5 + 1e-9 && m < e - 1e-9)) continue;
      const pre = meals.some((m) => m <= s - 0.75 + 1e-9 && m >= s - 4 - 1e-9);
      const post = meals.some((m) => m >= e - 1e-9 && m <= e + 2 + 1e-9);
      const score = Math.abs(s - preferredH) + (pre ? 0 : 0.75) + (post ? 0 : 0.75);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = s;
      }
    }
  };
  scan(lo, hi);
  // no meal-free slot near the preferred time (e.g. resistance training plus cardio inside a 6-h window): search the
  // whole waking day rather than put a session over a meal (QA item 9)
  if (bestScore === Infinity) scan(wakeH + 1, bedClockH - 1.5 - durH);
  return best;
}

/** Choose k weekdays from `cands` maximising the minimum circular gap (ties: fewest minimal gaps, then lexicographic). */
export function pickSpaced(cands: readonly number[], k: number, minGap = 1): number[] {
  const c = [...new Set(cands)].sort((a, b) => a - b);
  if (k <= 0) return [];
  if (k >= c.length) return c.length && gapsOk(c, minGap) ? c : k >= c.length ? pickBest(c, Math.min(k, c.length), minGap) : [];
  return pickBest(c, k, minGap);
}

function gaps(sel: readonly number[]): number[] {
  const g: number[] = [];
  for (let i = 0; i < sel.length; i++) g.push(i + 1 < sel.length ? sel[i + 1]! - sel[i]! : sel[0]! + 7 - sel[i]!);
  return g;
}

function gapsOk(sel: readonly number[], minGap: number): boolean {
  return sel.length <= 1 || Math.min(...gaps(sel)) >= minGap;
}

function pickBest(c: readonly number[], k: number, minGap: number): number[] {
  let best: number[] | null = null;
  let bestMin = -1;
  let bestCount = Infinity;
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) {
      const g = k === 1 ? [7] : gaps(acc);
      const mn = Math.min(...g);
      if (mn < minGap) return;
      const cnt = g.filter((v) => v === mn).length;
      if (mn > bestMin || (mn === bestMin && cnt < bestCount)) {
        best = acc.slice();
        bestMin = mn;
        bestCount = cnt;
      }
      return;
    }
    for (let i = start; i < c.length; i++) {
      acc.push(c[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return best ?? [];
}

// ---------------------------------------------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------------------------------------------

function rwFactor(ctx: PlanningContext): number {
  return ctx.caps.rwKg / ctx.rp.weightKg;
}

function segmentDays(ctx: PlanningContext, st: SkeletonStructure, r: ValueReader): number[] {
  const segs = st.skeleton.segments;
  const T = ctx.horizonDays;
  const n = segs.length;
  const minW = segs.map((s) => (s.kind === 'cycle' ? (s.on === 'B2' ? 5 : 3) : Math.max(BLOCKS[s.block].durationWeeks?.min ?? 2, 2)));
  const maxW = segs.map((s) => (s.kind === 'cycle' ? Infinity : BLOCKS[s.block].durationWeeks?.max ?? Infinity));
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push(T - used);
      break;
    }
    const remainingW = (T - used) / 7;
    let restMin = 0;
    let restMax = 0;
    for (let j = i + 1; j < n; j++) {
      restMin += minW[j]!;
      restMax += maxW[j]!;
    }
    const lo = Math.max(minW[i]!, Math.ceil(remainingW - restMax - 1e-9));
    const hi = Math.min(maxW[i]!, Math.floor(remainingW - restMin + 1e-9));
    const w = r.int(`seg${i}.weeks`, lo, Math.max(lo, hi), Math.round((lo + Math.max(lo, hi)) / 2));
    const days = Math.max(0, Math.min(T - used, 7 * w));
    out.push(days);
    used += days;
  }
  return out;
}

interface PhaseDraft {
  segment: number;
  blockId: BlockId;
  role: DecodedPhase['role'];
  startDay: number;
  endDay: number;
}

function phaseDrafts(_ctx: PlanningContext, st: SkeletonStructure, r: ValueReader, segDays: number[]): PhaseDraft[] {
  const out: PhaseDraft[] = [];
  let day = 0;
  st.skeleton.segments.forEach((s: SegmentSkeleton, i) => {
    const end = day + segDays[i]!;
    if (s.kind === 'phase') {
      if (end > day) out.push({ segment: i, blockId: s.block, role: 'phase', startDay: day, endDay: end });
    } else {
      const onLo = s.on === 'B2' ? 3 : 2;
      const on = r.int(`seg${i}.onWeeks`, onLo, 12, 4) * 7;
      const off = (s.on === 'B2' ? 2 : r.int(`seg${i}.offWeeks`, 1, 2, 2)) * 7;
      let d = day;
      let isOn = true;
      while (d < end) {
        const len = Math.min(isOn ? on : off, end - d);
        out.push({ segment: i, blockId: isOn ? s.on : s.off, role: isOn ? 'cycleOn' : 'cycleOff', startDay: d, endDay: d + len });
        d += len;
        isOn = !isOn;
      }
    }
    day = end;
  });
  return out;
}

/** Share of a day's energy lost to a 24-h fast that ends at the last meal (only that meal is eaten on the exit day). */
function fast24Loss(meals: number): number {
  return (meals - 1) / meals;
}

interface Built {
  plan: Omit<DecodedPlan, 'schedule' | 'values' | 'ranges'>;
}

function decodeCore(ctx: PlanningContext, st: SkeletonStructure, x: ArrayLike<number>, round: boolean, values: Float64Array, ranges: Float64Array): Built {
  const r = makeReader(st, x, values, ranges, round);
  const p = ctx.practical;
  const caps = ctx.caps;
  const sk = st.skeleton;
  const notes: RepairEntry[] = [];

  // ---- sleep (L5) first: bedtime moves earlier, wake time kept (regularity), which moves the L19 latest meal
  // Ideal (PLANNER_V2_SPEC §2.2): duration and midpoint genes set bed and wake (same every day, quarter hours)
  const ig = p.idealGenes;
  let sleepExtraH = 0;
  let bedH: number;
  let wakeH = p.wakeH;
  if (ig?.sleep) {
    const mr = sleepMidpointRange(p.bedH, p.wakeH);
    const dur = clamp(Math.round(r.real('sleep.durationH', IDEAL_SLEEP.minH, IDEAL_SLEEP.maxH, IDEAL_SLEEP.defH) * 4) / 4, IDEAL_SLEEP.minH, IDEAL_SLEEP.maxH);
    const s = sleepFromMidpoint(r.real('sleep.midpointH', mr.lo, mr.hi, mr.centre), dur);
    bedH = mod24(Math.round(s.bedH * 4) / 4);
    wakeH = mod24(bedH + dur);
  } else {
    sleepExtraH = sk.sleepExtension ? r.real('sleep.extraH', 0.5, 1.5, 1) : 0;
    bedH = (p.bedH - sleepExtraH + 24) % 24;
  }
  const bedClock = bedH < 12 ? bedH + 24 : bedH;
  let latest = p.latestH;
  if (bedClock - LATE_EATING_GAP_H - p.earliestH >= caps.minWindowH) latest = Math.min(latest, bedClock - LATE_EATING_GAP_H);
  // Ideal: the first meal comes ≥ 30 min after waking (meal clock relative to wake, §2.2)
  let earliest = p.earliestH;
  if (ig?.sleep && latest - (wakeH + 0.5) >= caps.minWindowH) earliest = Math.max(earliest, wakeH + 0.5);

  // ---- eating window and meals (HC-F5 minimum; L19; 18 §4.2 ≤ 14 h). Zero-energy days (B12) need a ≥ 12-h window so
  // each zero day is a ≤ 36-h fast (48 − window): 17 HC-F2 allows 2 fasts > 36 h per 7 days, and at 2 a week on fixed
  // weekdays a third one always resumes exactly 7 days after the first
  const zeroDays = sk.segments.some((g) => g.kind === 'phase' && g.block === 'B12');
  const minW = Math.min(Math.max(caps.minWindowH, zeroDays ? 48 - HC.t2SplitH : 0), latest - earliest);
  const windowStartRaw = r.real('window.startH', earliest, latest - minW, earliest);
  const windowLengthRaw = r.real('window.lengthH', minW, Math.min(14, latest - windowStartRaw), minW);
  const mealsHi = Math.min(p.meals.max, 1 + Math.floor(windowLengthRaw / MIN_MEAL_SPACING_H + 1e-9));
  const meals = r.int('meals', Math.min(p.meals.min, mealsHi), mealsHi, Math.min(3, mealsHi));
  // 15-minute meal grid (QA item 9): the window starts on a quarter hour and its length is a multiple of 15 min × (meals
  // − 1), so every evenly split meal time falls on the grid (no 10:18 meals)
  const windowStartH = quarterIn(windowStartRaw, earliest, latest - minW);
  const windowLengthH = gridLength(windowLengthRaw, meals, Math.max(minW, MIN_MEAL_SPACING_H * (meals - 1)), Math.min(14, latest - windowStartH));

  // ---- training
  // productive ranges for the ranked goals (dossier 09; QA item 9), inside the user's days and session length
  const rx = rtPrescription(ctx);
  // enough sessions for the minimum productive volume inside the session length (e.g. 10 sets need 3 × 90 min)
  const perSessionSets = p.maxSessionMin / MIN_PER_SET / REGIONS.length;
  // (sessions sharing a day with cardio lose part of their time, so the productive minimum is met with a 15 % margin: two
  // 90-min sessions cannot carry 8 hard sets per muscle group a week next to the cardio a fat-loss plan uses)
  const sessMin = Math.min(p.rtDays.max, Math.max(rx.sessionsMin, rx.sessionsMin > 0 ? Math.ceil(rx.setsMin / (SESSION_TIME_SHARE * perSessionSets) - 1e-9) : 0));
  const rtSessions = p.rtDays.max > 0 ? r.int('rt.sessions', sessMin, p.rtDays.max, sessMin) : 0;
  const setsCap = rtSessions > 0 ? (p.maxSessionMin / MIN_PER_SET / REGIONS.length) * rtSessions : 0;
  const setsHi = Math.min(rx.setsMax, setsCap, equipmentSetsCap(ctx, rtSessions, rx.loadPct)); // §8.2 equipment envelope
  const setsLo = Math.min(rx.setsMin, setsHi);
  const rtSets = rtSessions > 0 ? r.real('rt.sets', Math.max(RT_SETS_RANGE.min, setsLo), Math.max(RT_SETS_RANGE.min, setsHi), 11) : 0;
  // Ideal: the modality is a gene over the modalities the caps allow (HC-X4/X5); intensity within its band
  const mods = p.idealModalities;
  const modality: CardioModality =
    ig?.modality && p.cardioDays.max > 0 && mods.length > 1 ? mods[r.int('cardio.modality', 0, mods.length - 1, Math.max(0, mods.indexOf(p.cardioModality)))]! : p.cardioModality;
  const band = CARDIO_BANDS[modality] ?? CARDIO_BANDS.other!;
  const cardioSessions = p.cardioDays.max > 0 ? r.int('cardio.sessions', p.cardioDays.min, p.cardioDays.max, p.cardioDays.min) : 0;
  const cardioMinutes = p.cardioDays.max > 0 ? r.real('cardio.minutes', 20, Math.max(20, Math.min(90, p.maxSessionMin)), 40) : 0;
  const cardioPct = p.cardioDays.max > 0 ? r.real('cardio.intensity', band.min, band.max, (band.min + band.max) / 2) : 0;
  const steps = r.real('steps', p.steps.min, p.steps.max, p.steps.min);
  const fibreG = r.real('fibre', 15, 45, 25);
  const creatineG = sk.creatine ? r.real('creatine.g', 3, HC.creatineMaxG, 4) : 0;
  const omega3G = sk.omega3 ? r.real('omega3.g', 2, 3, 2.5) : 0;
  const viscousG = sk.viscousFibre ? r.real('viscous.g', 5, 15, 10) : 0;

  // ---- session clock: never over a meal, with a meal before and after where possible (QA item 9)
  const cardioMin5 = cardioSessions > 0 ? Math.max(20, 5 * Math.round(cardioMinutes / 5)) : 0;
  const sessionH = sessionHoursOf(rtSessions, rtSets, cardioSessions, cardioMinutes);
  // Ideal: the preferred clock is a gene inside the waking day (sessions end ≥ 1 h before bed; placement keeps 1.5 h)
  const clockGene = !!ig?.clock && (p.rtDays.max > 0 || p.cardioDays.max > 0);
  const cr = trainingClockRange(wakeH, bedClock, sessionH);
  const preferredH = clockGene ? r.real('train.clockH', cr.lo, cr.hi, clamp(p.trainingTimeH, cr.lo, cr.hi)) : p.trainingTimeH;
  const trainingStartH = placeTraining(
    mealClockList(windowStartH, windowLengthH, meals),
    clockGene ? quarterIn(preferredH, cr.lo, cr.hi) : preferredH,
    sessionH,
    wakeH,
    bedClock,
    clockGene ? 0.75 : ctx.request.constraints?.trainingTimeH !== undefined ? 1.5 : 3,
  );

  // ---- weekly training pattern (18 §4.4.3: maximise rest spacing over allowed weekdays)
  const rtWeek = pickSpaced(p.allowedTrainingWeekdays, rtSessions);
  if (rtWeek.length < rtSessions) notes.push({ rule: 'user.trainingWeekdays', amount: rtSessions - rtWeek.length });

  // ---- phases
  const segDays = segmentDays(ctx, st, r);
  const drafts = phaseDrafts(ctx, st, r, segDays);
  const T = ctx.horizonDays;
  const floorPct = (100 * caps.energyFloorKcal) / caps.tdee0Kcal;
  const need = Math.max(100 - caps.deficitCapPct, floorPct);
  const ov = sk.overlay;
  const refeedPct = ov?.lever === 'refeedDay' ? r.real('ov.pct', 100, Math.min(120, caps.maxPctTdee), 110) : 0;
  const refeedCarb = ov?.lever === 'refeedDay' ? r.real('ov.carb', 6, 10, 8) : 0;

  const segParams = new Map<number, { energy: number; protein: number; fat: number | null; carbG: number | null; lowKcal: number | null }>();
  const phases: DecodedPhase[] = [];
  drafts.forEach((d, idx) => {
    const seg = sk.segments[d.segment]!;
    const prefix = `seg${d.segment}`;
    const onBlock: BlockId = seg.kind === 'cycle' ? seg.on : seg.block;
    if (!segParams.has(d.segment)) {
      const er = energyRange(ctx, onBlock);
      let lo = er.lo;
      let hi = er.hi;
      if (onBlock === 'B11') {
        lo = BLOCKS.B11.energyPct!.min;
        hi = Math.min(BLOCKS.B11.energyPct!.max, caps.maxPctTdee);
      }
      if (onBlock === 'B12') {
        const z = seg.kind === 'phase' ? seg.perWeek ?? 2 : 2;
        lo = Math.max(100, (floorPct * 7) / (7 - z));
        hi = Math.min(120, caps.maxPctTdee);
      }
      if (ov?.lever === 'fastDay24' && OVERLAY_HOSTS.fastDay24.includes(onBlock)) {
        // fast days are governed by the tier rules; the 28-day mean must still meet the intake floor (ruling 18:10)
        const f = (ov.perWeek * fast24Loss(meals)) / 7;
        lo = Math.max(lo, floorPct / (1 - f));
      }
      const energy = BLOCKS[onBlock].energyPct && BLOCKS[onBlock].energyPct!.min < BLOCKS[onBlock].energyPct!.max ? r.real(`${prefix}.energy`, lo, Math.max(lo, hi), (lo + hi) / 2) : clamp(100, lo, Math.max(lo, hi));
      if (lo > hi + 1e-9) notes.push({ rule: 'decode.energyEnvelope', amount: lo - hi });
      // macro ranges narrowed so the day's fixed macros always fit its energy (estimated at TDEE0 with a 5 % margin,
      // because runtime maintenance and body weight fall together over a block)
      const Eest = 0.95 * (energy / 100) * caps.tdee0Kcal;
      const fibreKcal = 2 * (fibreG + viscousG);
      const ob = BLOCKS[onBlock];
      const carbMinG = Math.max(caps.carbFloorG, (ob.carbGPerKgBw?.min ?? 0) * ctx.rp.weightKg, ob.carbG ? Math.max(ob.carbG.min, caps.carbFloorG) : 0);
      const fatMinKcal = ob.fatPctEnergy ? 9 * Math.max(HC.fat.minG, ((HC.fat.minPctEnergy / 100) * Eest) / 9) : 9 * (ob.fatGPerKgBw?.min ?? 0) * ctx.rp.weightKg;
      const pr = proteinRange(ctx, onBlock);
      const pHiFit = (Eest - fibreKcal - 4 * carbMinG - fatMinKcal) / 4 / ctx.caps.rwKg;
      const protein = r.real(`${prefix}.protein`, pr.lo, Math.max(pr.lo, Math.min(pr.hi, pHiFit)), (pr.lo + pr.hi) / 2);
      let fat: number | null = null;
      let carbG: number | null = null;
      if (ob.carbG && ob.remainder === 'fat') {
        const cl = Math.max(ob.carbG.min, caps.carbFloorG);
        carbG = r.real(`${prefix}.carbG`, cl, Math.max(cl, ob.carbG.max), cl);
      } else if (ob.fatGPerKgBw) {
        const fHiFit = (Eest - fibreKcal - 4 * carbMinG - 4 * protein * ctx.caps.rwKg) / 9 / ctx.rp.weightKg;
        const fHi = Math.max(ob.fatGPerKgBw.min, Math.min(ob.fatGPerKgBw.max, fHiFit));
        // fat keeps ≥ 17 % of the day's energy with 10 % slack for the resolved intake (R-MAINT: maintenance at the
        // planned activity can exceed TDEE0), so the Simulator's 15 % fat floor (W-M06) holds (R-PLAN-SAFETY)
        const fLo = Math.min(fHi, Math.max(ob.fatGPerKgBw.min, (FAT_PLAN_PCT_E / 100) * (energy / 100) * caps.tdee0Kcal * 1.1 / 9 / ctx.rp.weightKg));
        fat = r.real(`${prefix}.fat`, fLo, fHi, (fLo + fHi) / 2);
      }
      let lowKcal: number | null = null;
      if (onBlock === 'B11') {
        const kLo = Math.max(500, caps.restrictedDayMinKcal);
        const kHi = Math.min(700, caps.restrictedDayUpperKcal);
        // weekly mean (5·p + 2·k/TDEE0·100)/7 ≥ need  →  k ≥ (7·need − 5·p)·TDEE0/200
        const kNeed = ((7 * need - 5 * energy) * caps.tdee0Kcal) / 200;
        const lo2 = Math.max(kLo, kNeed);
        if (lo2 > kHi + 1e-9) notes.push({ rule: 'decode.lowDayEnvelope', amount: lo2 - kHi });
        lowKcal = r.real(`${prefix}.lowKcal`, Math.min(lo2, kHi), kHi, kHi);
      }
      segParams.set(d.segment, { energy, protein, fat, carbG, lowKcal });
    }
    const sp = segParams.get(d.segment)!;
    const isOff = d.role === 'cycleOff';
    const zeroPerWeek = d.blockId === 'B12' && seg.kind === 'phase' ? seg.perWeek ?? 2 : 0;
    // special weekdays (13 B11/B12/B9/B13; prefer non-training days; low/zero days never consecutive)
    const nonRt = [0, 1, 2, 3, 4, 5, 6].filter((w) => !rtWeek.includes(w));
    let lowW: number[] = [];
    let zeroW: number[] = [];
    let refW: number[] = [];
    let f24W: number[] = [];
    if (d.blockId === 'B11') {
      lowW = pickSpaced(nonRt, 2, 2);
      if (lowW.length < 2) lowW = pickSpaced([0, 1, 2, 3, 4, 5, 6], 2, 2);
    }
    if (zeroPerWeek > 0) {
      zeroW = pickSpaced(nonRt, zeroPerWeek, 2);
      if (zeroW.length < zeroPerWeek) zeroW = pickSpaced([0, 1, 2, 3, 4, 5, 6], zeroPerWeek, 2);
    }
    if (ov && OVERLAY_HOSTS[ov.lever].includes(d.blockId) && !isOff) {
      if (ov.lever === 'refeedDay') refW = ov.days === 1 ? [5] : [5, 6];
      else {
        // fast from the last meal on w to the same clock on w+1; neither w+1 a training day (17 HC-F4 T1)
        const cands = [0, 1, 2, 3, 4, 5, 6].filter((w) => !rtWeek.includes((w + 1) % 7));
        f24W = pickSpaced(cands, ov.perWeek, 2);
        if (f24W.length < ov.perWeek) notes.push({ rule: 'decode.fast24Placement', amount: ov.perWeek - f24W.length });
      }
    }
    const blockedForRt = new Set<number>([...lowW, ...zeroW, ...f24W.map((w) => (w + 1) % 7)]);
    const rtW = rtWeek.filter((w) => !blockedForRt.has(w));
    if (rtW.length < rtWeek.length) notes.push({ rule: 'decode.rtOnSpecialDay', amount: rtWeek.length - rtW.length });
    const cardioCands = p.allowedTrainingWeekdays.filter((w) => !zeroW.includes(w) && !lowW.includes(w) && !blockedForRt.has(w));
    const nonRtCardio = cardioCands.filter((w) => !rtW.includes(w));
    let cardioW = pickSpaced(nonRtCardio, Math.min(cardioSessions, nonRtCardio.length));
    if (cardioW.length < cardioSessions) {
      const extra = pickSpaced(cardioCands.filter((w) => !cardioW.includes(w)), cardioSessions - cardioW.length);
      cardioW = [...cardioW, ...extra].sort((a, b) => a - b);
    }
    // ≥ 1 full rest day per week (17 §2.5): drop cardio on the last day that would make 7 active days
    const active = new Set([...rtW, ...cardioW]);
    if (active.size >= 7 && cardioW.length) cardioW = cardioW.slice(0, -1);
    phases.push({
      index: idx,
      segment: d.segment,
      blockId: d.blockId,
      role: d.role,
      startDay: d.startDay,
      endDay: d.endDay,
      energyPct: isOff ? 100 : sp.energy,
      proteinGPerKg: sp.protein,
      fatGPerKg: isOff ? sp.fat ?? BLOCKS.B0.fatGPerKgBw!.min : sp.fat,
      carbG: isOff ? null : sp.carbG,
      lowKcal: sp.lowKcal,
      zeroPerWeek,
      lowWeekdays: lowW,
      zeroWeekdays: zeroW,
      refeedWeekdays: refW,
      fast24Weekdays: f24W,
      rtWeekdays: rtW,
      cardioWeekdays: cardioW,
    });
  });

  // ---- day kinds
  const dayPhase = new Int16Array(T);
  const dayKind: DayKind[] = new Array<DayKind>(T).fill('normal');
  for (const ph of phases) {
    for (let d = ph.startDay; d < ph.endDay; d++) {
      dayPhase[d] = ph.index;
      const w = (ctx.startWeekday + d) % 7;
      dayKind[d] = ph.zeroWeekdays.includes(w) ? 'zero' : ph.lowWeekdays.includes(w) ? 'low' : ph.refeedWeekdays.includes(w) ? 'refeed' : 'normal';
    }
  }

  // ---- events: weekly 24-h fasts (overlay) and multi-day water fasts
  const inDietBreak = (d: number) => phases[dayPhase[d]!]?.blockId === 'B8';
  const windowEnd = windowStartH + windowLengthH;
  // the fast starts at the last meal of the day (meal-to-meal durations, ruling 18:10)
  const fastStartH = windowEnd; // unrounded: must coincide with the last meal clock
  const events: PlannedEvent[] = [];
  for (const ph of phases) {
    if (!ph.fast24Weekdays.length) continue;
    for (let d = ph.startDay; d < ph.endDay; d++) {
      const w = (ctx.startWeekday + d) % 7;
      if (ph.fast24Weekdays.includes(w) && d + 1 < T && dayKind[d] === 'normal' && dayKind[d + 1] !== 'zero')
        events.push({ lever: 'fastDay24', startDay: d, startH: fastStartH, durationH: 24, nominalH: 24, recoveryDays: [] });
    }
  }
  if (sk.event) {
    const D = sk.event.durationH;
    const period = EVENT_PERIOD_DAYS[D];
    const span = Math.floor((fastStartH + D + 1e-9) / 24) + 1; // start day through end day
    const recovery = Math.max(0, recoveryDayCount(D) - 1); // locked days after the end day (17 HC-F3, 13 rule 4)
    const maxCount = Math.max(1, Math.floor((T - 7) / period));
    const count = r.int('ev.count', 1, maxCount, 1);
    const pos = r.real('ev.pos', 0, 1, 0.25);
    const lastStartMax = T - span - recovery;
    const first = Math.floor(pos * Math.max(0, Math.min(period, lastStartMax - (count - 1) * period)));
    for (let k = 0; k < count; k++) {
      let s = first + k * period;
      // snap to a start whose span and recovery days are plain days (no other overlay days) outside a diet break,
      // searching forward ≤ 6 d: a diet break (B8) is a stretch at maintenance, so it never hosts a fast (QA PLN-04)
      let ok = -1;
      for (let dd = 0; dd <= 6 && ok < 0; dd++) {
        const c = s + dd;
        if (c + span + recovery > T) break;
        let clean = true;
        for (let j = c; j < c + span + recovery && clean; j++) if (dayKind[j] !== 'normal' || inDietBreak(j)) clean = false;
        if (clean) ok = c;
      }
      if (ok < 0) {
        notes.push({ rule: 'decode.eventPlacement', day: s, amount: D });
        continue;
      }
      s = ok;
      const endDay = fastEndDay({ startDay: s, startH: fastStartH, durationH: D });
      const rec = Array.from({ length: recoveryDayCount(D) }, (_, i) => endDay + i).filter((x) => x < T);
      events.push({ lever: 'waterFast', startDay: s, startH: fastStartH, durationH: D, nominalH: D, recoveryDays: rec });
    }
  }
  // weekly 24-h fasts give way to a multi-day fast: the tier's eating gap (24 h; 7 d around a 72-h fast; 28 d around an
  // expert-tier fast, ruling R-T4CAP) is kept on both sides, so repair never has to drop fasts for spacing
  const multi = events.filter((e) => e.lever === 'waterFast');
  if (multi.length) {
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k]!;
      if (e.lever !== 'fastDay24') continue;
      const a = e.startDay * 24 + e.startH;
      const b = a + e.durationH;
      const clash = multi.some((m) => {
        const ma = m.startDay * 24 + m.startH;
        const need = eatingGapNeedH(m.durationH, e.durationH);
        return a < ma + m.durationH + need && b > ma - need;
      });
      if (clash) events.splice(k, 1);
    }
  }
  events.sort((a, b) => a.startDay - b.startDay || (a.lever < b.lever ? -1 : 1));

  const lifestyle: Lifestyle = {
    windowStartH,
    windowLengthH,
    meals,
    rtSessions: rtWeek.length,
    rtSetsPerRegionWeek: rtSets,
    cardioSessions,
    cardioMinutes: cardioMin5 || cardioMinutes,
    trainingStartH,
    cardioPctVo2max: cardioPct,
    steps,
    fibreG,
    sleepExtraH,
    bedH,
    wakeH,
    creatineG,
    omega3G,
    viscousG,
    refeedPct,
    refeedCarbGPerKg: refeedCarb,
    cardioModality: modality,
    sleepGenes: !!ig?.sleep,
  };
  return { plan: { structureId: st.id, horizonDays: T, lifestyle, phases, dayPhase, dayKind, events, notes } };
}

// ---------------------------------------------------------------------------------------------------------------
// templates and schedule
// ---------------------------------------------------------------------------------------------------------------

const KIND_LABEL: Record<DayKind, string> = { normal: 'day', low: 'low-energy day', zero: 'zero-energy day', refeed: 'refeed day' };

function macrosFor(ctx: PlanningContext, ph: DecodedPhase, kind: DayKind, ls: Lifestyle): MacroSpec {
  const rwf = rwFactor(ctx);
  const blk = BLOCKS[ph.blockId];
  const fibreTotal = ls.fibreG + ls.viscousG;
  const base: MacroSpec = {
    protein: { unit: 'gPerKgBw', value: +(ph.proteinGPerKg * rwf).toFixed(4) },
    carbs: { unit: 'remainder' },
    fat: { unit: 'gPerKgBw', value: ph.fatGPerKg ?? blk.fatGPerKgBw?.min ?? 0.6 },
    fibre: { unit: 'g', value: +fibreTotal.toFixed(2) },
  };
  if (ls.viscousG > 0) base.viscousFibreShare = +(ls.viscousG / fibreTotal).toFixed(4);
  if (ls.omega3G > 0) base.fatTypes = { omega3G: ls.omega3G };
  if (ph.blockId === 'B2' && ph.carbG !== null) {
    base.carbs = { unit: 'g', value: ph.carbG };
    base.fat = { unit: 'remainder' };
  }
  if (ph.blockId === 'B6') base.fat = { unit: 'pctEnergy', value: HC.fat.minPctEnergy + 1 };
  if (kind === 'low') {
    // 13 B11: protein ≥ 1.0-1.2 g/kg on low days (upper value used), ≥ 10 g fat in one meal (17 HC-M3 meal rule)
    const kcal = ph.lowKcal ?? 600;
    const prot = Math.min(1.2 * ctx.caps.rwKg, (0.6 * kcal) / 4);
    return { protein: { unit: 'g', value: +prot.toFixed(1) }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: HC.fat.mealMinG }, fibre: { unit: 'g', value: Math.min(fibreTotal, 15) } };
  }
  if (kind === 'refeed') {
    // 13 B9: carbohydrate 6-10 g/kg, fat ≤ 0.6 g/kg, protein unchanged; carbohydrate expressed as % energy of the
    // estimated refeed energy so the day never exceeds its energy (the remainder is fat)
    const E = (ls.refeedPct / 100) * ctx.caps.tdee0Kcal;
    const pG = ph.proteinGPerKg * ctx.caps.rwKg;
    const fatMinKcal = 9 * Math.max(HC.fat.minG, (HC.fat.minPctEnergy / 100) * E / 9);
    const room = Math.max(0, E - 4 * pG - 2 * fibreTotal - fatMinKcal);
    const carbKcal = Math.min(4 * ls.refeedCarbGPerKg * ctx.rp.weightKg, room);
    return { ...base, carbs: { unit: 'pctEnergy', value: +((100 * carbKcal) / E).toFixed(2) }, fat: { unit: 'remainder' } };
  }
  return base;
}

function sessionsFor(ctx: PlanningContext, ls: Lifestyle, rt: boolean, cardio: boolean): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  let t = ls.trainingStartH;
  if (rt && ls.rtSessions > 0) {
    const perRegion = ls.rtSetsPerRegionWeek / ls.rtSessions;
    const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
    const rx = rtPrescription(ctx);
    // §8.2: each region at most what the person's equipment delivers (Infinity without a training profile → unchanged)
    for (const reg of REGIONS) setsByRegion[reg] = +Math.min(perRegion, equipmentRegionCap(ctx, reg, rx.loadPct)).toFixed(3);
    const durationMin = rtSessionMinutes(perRegion);
    out.push({ kind: 'resistance', startH: t, durationMin, setsByRegion, rir: 2, loadPct1RM: rx.loadPct, style: rx.style });
    t = Math.min(22, t + durationMin / 60);
  }
  if (cardio && ls.cardioSessions > 0) out.push({ kind: 'cardio', modality: ls.cardioModality, startH: +t.toFixed(2), durationMin: Math.round(ls.cardioMinutes), pctVo2max: +ls.cardioPctVo2max.toFixed(3) });
  return out;
}

function templateFor(ctx: PlanningContext, ph: DecodedPhase, kind: DayKind, rt: boolean, cardio: boolean, ls: Lifestyle): DayTemplate {
  const energy: DayTemplate['energy'] =
    kind === 'zero'
      ? { kind: 'zero' }
      : kind === 'low'
        ? { kind: 'kcal', kcal: ph.lowKcal ?? 600 }
        : { kind: 'pctMaintenance', pct: +(kind === 'refeed' ? ls.refeedPct : ph.energyPct).toFixed(2), reference: 'blockStart' };
  const t: DayTemplate = {
    id: '',
    label: `${BLOCKS[ph.blockId].name} · ${KIND_LABEL[kind]}${rt ? ' · resistance training' : ''}${cardio ? ' · cardio' : ''}`,
    energy,
    macros: macrosFor(ctx, ph, kind, ls),
    // full precision: fast events start exactly at the last meal clock (start + length)
    meals: { count: ls.meals, window: { startH: ls.windowStartH, lengthH: ls.windowLengthH }, split: 'even' },
    steps: Math.round(ls.steps),
  };
  const ex = kind === 'zero' ? [] : sessionsFor(ctx, ls, rt && kind !== 'low', cardio);
  if (ex.length) t.exercise = ex;
  if (ls.sleepExtraH > 0) t.sleep = { bedH: +ls.bedH.toFixed(2), wakeH: ls.wakeH };
  else if (ls.sleepGenes) t.sleep = { bedH: +ls.bedH.toFixed(2), wakeH: +ls.wakeH.toFixed(2) };
  if (ls.creatineG > 0) t.substances = { creatineG: ls.creatineG };
  if (kind === 'zero') t.hydration = { electrolytes: true, fluidL: (HC.fastingFluidL.min + HC.fastingFluidL.max) / 2, sodiumG: FAST_SODIUM_G };
  // very-low-carbohydrate days lose sodium (17 §3 W-M08/W-M12: keep fluids and sodium up): at least 3 g/day
  else if (ph.blockId === 'B2') t.hydration = { sodiumG: Math.max(KETO_SODIUM_G, ctx.rp.habits.habitualSodiumG) };
  else if (kind === 'low') t.hydration = { sodiumG: Math.max(LOW_DAY_SODIUM_G, ctx.rp.habits.habitualSodiumG) };
  return t;
}

function blocksFor(phases: readonly DecodedPhase[]): ScheduleBlock[] {
  const out: ScheduleBlock[] = [];
  for (const ph of phases) {
    for (let s = ph.startDay; s < ph.endDay; s += CHECK_IN_DAYS) {
      const e = Math.min(ph.endDay, s + CHECK_IN_DAYS);
      out.push({ name: `${BLOCKS[ph.blockId].name} (days ${s + 1}-${e})`, startDay: s, endDay: e, buildingBlockId: ph.blockId });
    }
  }
  return out;
}

/** Remove sessions that overlap [a, b) absolute hours on day d (or all sessions when `all`). */
function sessionsOutside(t: DayTemplate, d: number, a: number, b: number, all: boolean): ExerciseSession[] | null {
  const ex = t.exercise ?? [];
  if (!ex.length) return null;
  const kept = all ? [] : ex.filter((s) => {
    const s0 = d * 24 + s.startH;
    const s1 = s0 + (s.durationMin ?? 60) / 60;
    return s1 <= a || s0 >= b;
  });
  return kept.length === ex.length ? null : kept;
}

function buildSchedule(ctx: PlanningContext, plan: Built['plan']): Schedule {
  const T = plan.horizonDays;
  const ls = plan.lifestyle;
  const programs: DayTemplate[] = [];
  const keyIndex = new Map<string, number>();
  const days: ScheduleDay[] = [];
  const recovery = new Set<number>();
  for (const e of plan.events) for (const d of e.recoveryDays) recovery.add(d);
  for (let d = 0; d < T; d++) {
    const ph = plan.phases[plan.dayPhase[d]!]!;
    const w = (ctx.startWeekday + d) % 7;
    const kind = plan.dayKind[d]!;
    const rt = ph.rtWeekdays.includes(w);
    const cardio = ph.cardioWeekdays.includes(w);
    const t = templateFor(ctx, ph, kind, rt, cardio, ls);
    const key = JSON.stringify([ph.index, t.energy, t.macros, t.exercise ?? null, t.hydration ?? null]);
    let idx = keyIndex.get(key);
    if (idx === undefined) {
      idx = programs.length;
      keyIndex.set(key, idx);
      programs.push({ ...t, id: String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? String(Math.floor(idx / 26)) : '') });
    }
    days.push({ program: idx });
  }
  // fast events: keep only the part of each touched day's eating outside the span (18 §4.4.5); no training inside the
  // span; multi-day fasts also lock their recovery days (no training, energy ≤ 100 %, 17 HC-F3/F4, 13 rule 4)
  const events: FastEvent[] = [];
  for (const e of plan.events) {
    const a = e.startDay * 24 + e.startH;
    const b = a + e.durationH;
    events.push({ kind: 'fast', startDay: e.startDay, startH: e.startH, durationH: e.durationH, electrolytes: true, refeed: e.nominalH > 48 ? 'auto' : 'none' });
    for (let d = Math.floor(a / 24); d <= Math.min(T - 1, Math.floor((b - 1e-9) / 24)); d++) {
      const sd = days[d]!;
      const base = mergeDay(programs[sd.program]!, sd.override);
      const ov: NonNullable<ScheduleDay['override']> = { ...(sd.override ?? {}) };
      const d0 = d * 24;
      const covered = Math.min(b, d0 + 24) - Math.max(a, d0);
      const ex = sessionsOutside(base, d, a, b, e.lever === 'waterFast');
      if (ex) ov.exercise = ex;
      if (covered < 24 - 1e-9 && base.energy.kind !== 'zero') {
        const clocks = mealClocks(base);
        // the last intake (at t0) and the first intake (at t1) are eaten; meals strictly inside are not
        const kept = clocks.filter((c) => d0 + c <= a + 1e-6 || d0 + c >= b - 1e-6);
        // the meal clocks of fast-touched days are frozen (explicit meals) so later window repairs cannot move a meal
        // into or out of the fast
        if (kept.length === clocks.length && kept.length > 0) ov.meals = { meals: kept.map((c) => ({ clockH: c })) };
        if (kept.length < clocks.length) {
          const f = kept.length / clocks.length;
          if (kept.length === 0) {
            ov.energy = { kind: 'kcal', kcal: 0 };
            ov.macros = { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 }, fibre: { unit: 'g', value: 0 } };
          } else {
            ov.meals = { meals: kept.map((c) => ({ clockH: c })) };
            const en = base.energy;
            ov.energy = en.kind === 'pctMaintenance' ? { ...en, pct: +(en.pct * f).toFixed(3) } : en.kind === 'kcal' ? { kind: 'kcal', kcal: +(en.kcal * f).toFixed(1) } : en;
            const scale = (m: MacroSpec['protein']): MacroSpec['protein'] => (m.unit === 'g' || m.unit === 'gPerKgBw' || m.unit === 'gPerKgFfm' ? { ...m, value: +(m.value * f).toFixed(4) } : m);
            ov.macros = { ...base.macros, protein: scale(base.macros.protein), carbs: scale(base.macros.carbs), fat: scale(base.macros.fat), ...(base.macros.fibre && base.macros.fibre.unit === 'g' ? { fibre: { unit: 'g' as const, value: +(base.macros.fibre.value * f).toFixed(2) } } : {}) };
          }
        }
      }
      // sodium on every fast-touched day (17 §4.3.3: 1.5-2.5 g on T2 fasts, 2-3 g on T3/T4; W-M12 below 1.5 g): the
      // partial days eat fewer meals, so their food sodium alone falls short
      if (covered >= 24 - 1e-9 && e.lever === 'waterFast') ov.hydration = { ...(base.hydration ?? {}), electrolytes: true, fluidL: (HC.fastingFluidL.min + HC.fastingFluidL.max) / 2, sodiumG: FAST_SODIUM_G };
      else if (base.energy.kind !== 'zero') ov.hydration = { ...(base.hydration ?? {}), electrolytes: true, sodiumG: Math.max(FAST_SODIUM_G, base.hydration?.sodiumG ?? 0) };
      if (Object.keys(ov).length) sd.override = ov;
    }
    for (const d of e.recoveryDays) {
      const sd = days[d]!;
      const base = mergeDay(programs[sd.program]!, sd.override);
      const ov: NonNullable<ScheduleDay['override']> = { ...(sd.override ?? {}) };
      if (base.exercise?.length) ov.exercise = [];
      if (base.energy.kind === 'pctMaintenance' && base.energy.pct > 100) ov.energy = { ...base.energy, pct: 100 };
      if (Object.keys(ov).length) sd.override = ov;
    }
  }
  return {
    schemaVersion: 1,
    startDate: ctx.startDate,
    horizonDays: T,
    programs,
    days,
    blocks: blocksFor(plan.phases),
    events,
    defaults: { energyReference: 'blockStart' },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// baseline (status quo, 18 §4.6)
// ---------------------------------------------------------------------------------------------------------------

/** Habitual intake at maintenance with habitual activity made explicit (sessions × 1 h, as in resolveProfile's EAT0). */
export function baselineSchedule(ctx: PlanningContext): Schedule {
  const rp = ctx.rp;
  const T = ctx.horizonDays;
  const hab = habitualTemplate(rp);
  const spw = Math.round(rp.habits.sessionsPerWeek);
  const nRt = Math.round(spw * (1 - rp.habits.lifingCardioMix));
  const nC = spw - nRt;
  const rtW = pickSpaced([0, 1, 2, 3, 4, 5, 6], nRt);
  const cW = pickSpaced([0, 1, 2, 3, 4, 5, 6].filter((w) => !rtW.includes(w)), Math.min(nC, 7 - rtW.length));
  const programs: DayTemplate[] = [];
  const idx = new Map<string, number>();
  const days: ScheduleDay[] = [];
  const perSession = 60 / MIN_PER_SET / REGIONS.length; // 1-h sessions (resolveProfile EAT0 convention)
  for (let d = 0; d < T; d++) {
    const w = (ctx.startWeekday + d) % 7;
    const rt = rtW.includes(w);
    const c = cW.includes(w);
    const key = `${rt}|${c}`;
    let i = idx.get(key);
    if (i === undefined) {
      const ex: ExerciseSession[] = [];
      if (rt) {
        const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
        for (const reg of REGIONS) setsByRegion[reg] = +perSession.toFixed(3);
        ex.push({ kind: 'resistance', startH: 18, durationMin: 60, setsByRegion, style: 'general' });
      }
      if (c) ex.push({ kind: 'cardio', modality: ctx.practical.cardioModality, startH: 18, durationMin: 60 });
      i = programs.length;
      idx.set(key, i);
      programs.push({ ...hab, id: `H${i}`, label: `Habitual day${rt ? ' · resistance training' : ''}${c ? ' · cardio' : ''}`, ...(ex.length ? { exercise: ex } : {}) });
    }
    days.push({ program: i });
  }
  return { schemaVersion: 1, startDate: ctx.startDate, horizonDays: T, programs, days, blocks: [{ name: 'Current habits', startDay: 0, endDay: T, buildingBlockId: 'B0' }], defaults: { energyReference: 'baseline' } };
}

// ---------------------------------------------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------------------------------------------

/** Full decode: plan description + Schedule. `round` applies the friendly grids (18 §4.9). */
export function decodePlan(ctx: PlanningContext, st: SkeletonStructure, x: ArrayLike<number>, round = false): DecodedPlan {
  const values = new Float64Array(st.dim);
  const ranges = new Float64Array(2 * st.dim);
  if (st.skeleton.baseline) {
    const schedule = baselineSchedule(ctx);
    const T = ctx.horizonDays;
    const ph: DecodedPhase = {
      index: 0, segment: 0, blockId: 'B0', role: 'phase', startDay: 0, endDay: T, energyPct: 100,
      proteinGPerKg: ctx.rp.habitualProteinG / ctx.rp.weightKg, fatGPerKg: ctx.rp.habitualFatG / ctx.rp.weightKg, carbG: null, lowKcal: null,
      zeroPerWeek: 0, lowWeekdays: [], zeroWeekdays: [], refeedWeekdays: [], fast24Weekdays: [], rtWeekdays: [], cardioWeekdays: [],
    };
    const h = ctx.rp.habits;
    const ls: Lifestyle = {
      windowStartH: h.habitualWindowStartH, windowLengthH: h.habitualWindowLengthH, meals: h.habitualMealsPerDay, rtSessions: 0, rtSetsPerRegionWeek: 0,
      cardioSessions: 0, cardioMinutes: 0, trainingStartH: 18, cardioPctVo2max: 0, steps: h.typicalSteps, fibreG: ctx.rp.habitualFibreG, sleepExtraH: 0, bedH: h.bedTimeH,
      wakeH: h.wakeTimeH, creatineG: 0, omega3G: 0, viscousG: 0, refeedPct: 0, refeedCarbGPerKg: 0, cardioModality: ctx.practical.cardioModality, sleepGenes: false,
    };
    return { structureId: st.id, horizonDays: T, lifestyle: ls, phases: [ph], dayPhase: new Int16Array(T), dayKind: new Array<DayKind>(T).fill('normal'), events: [], notes: [], schedule, values, ranges };
  }
  const { plan } = decodeCore(ctx, st, x, round, values, ranges);
  const schedule = buildSchedule(ctx, plan);
  return { ...plan, schedule, values, ranges };
}

/** Genome whose decode reproduces the given (value, range) pairs — the inverse of the value reader. */
export function encodeValues(st: SkeletonStructure, values: ArrayLike<number>, ranges: ArrayLike<number>): Float64Array {
  const x = new Float64Array(st.dim);
  for (let i = 0; i < st.dim; i++) {
    const lo = ranges[2 * i]!;
    const hi = ranges[2 * i + 1]!;
    x[i] = hi > lo ? clamp((values[i]! - lo) / (hi - lo), 0, 1) : st.x0[i]!;
  }
  return x;
}

/** Friendly rounding (18 §4.9): decode with grids, re-encode (the result decodes to the rounded plan). */
export function roundGenome(ctx: PlanningContext, st: SkeletonStructure, x: ArrayLike<number>): Float64Array {
  if (st.skeleton.baseline || st.dim === 0) return Float64Array.from(x);
  const values = new Float64Array(st.dim);
  const ranges = new Float64Array(2 * st.dim);
  decodeCore(ctx, st, x, true, values, ranges);
  return encodeValues(st, values, ranges);
}

/** Grid step per gene in genome units (for round-and-verify pattern search). */
export function gridStep(st: SkeletonStructure): Float64Array {
  return Float64Array.from(st.genes, (g) => {
    const span = g.max - g.min;
    if (!(span > 0)) return 0.1;
    if (g.kind === 'int') return 1 / span;
    return g.grid ? Math.min(0.5, g.grid / span) : 0.05;
  });
}

/** Estimated planned energy of every day at baseline references (maintenance = TDEE0), kcal. */
export function plannedKcal(ctx: PlanningContext, schedule: Schedule): Float64Array {
  const refs = { maintenanceKcal: ctx.rp.tdee0Kcal, bwKg: ctx.rp.weightKg, ffmKg: ctx.rp.ffm0Kg };
  const out = new Float64Array(schedule.horizonDays);
  const covered = new Float64Array(schedule.horizonDays);
  for (const e of schedule.events ?? []) {
    const a = e.startDay * 24 + e.startH;
    const b = a + e.durationH;
    for (let d = Math.max(0, Math.floor(a / 24)); d <= Math.min(schedule.horizonDays - 1, Math.floor((b - 1e-9) / 24)); d++)
      covered[d] = covered[d]! + Math.min(b, d * 24 + 24) - Math.max(a, d * 24);
  }
  const rf = refeedDayFactors(schedule);
  for (let d = 0; d < schedule.horizonDays; d++) {
    const sd = schedule.days[d]!;
    const t = mergeDay(schedule.programs[sd.program]!, sd.override);
    out[d] = covered[d]! >= 24 - 1e-9 ? 0 : estimateDay(t, refs).kcal * rf[d]!;
  }
  return out;
}
