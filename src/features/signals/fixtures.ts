/**
 * Synthetic Body signals data for tests and the screenshot harness (qa/scripts/L-PAGES). One `SignalsSource` per
 * scenario, built from deterministic pseudo-random records: no clock, no network, no personal data. Everything is a
 * function of the scenario, "today" and the time-zone offset, so the same options always give the same bytes.
 *
 * `full` is about 400 days ending today (a Sunday, 2026-10-04 by default) shaped to hit every state of
 * design/screens/ring-pages.md §6.3 and §7.2:
 *  - nights with stages, every fourth with some unknown time, every seventh with a stretch no stage covers;
 *    the night to Mon 28 Sep has only unknown stages; last night is provisional; Sat 3 Oct has an afternoon nap;
 *  - missing: Thu 1 Oct has nothing at all (so the nights ending Thu 1 and Fri 2 are missing too), more days and
 *    nights in older weeks, and one whole calendar month with no records (four months before this one);
 *  - heart rate every 5 minutes while worn (workouts reach zones 3–4 for a 41-year-old), spot checks, resting heart
 *    rate, heart-rate variability, blood oxygen and skin temperature at night, steps per hour (a worn hour with 0
 *    steps every day; no record in the hour the ring charges), active minutes and energy, workouts (one logged by
 *    hand), battery;
 *  - goals steps 8000, active minutes 30, sleep 8 h; baselines from the last 60 days (14 nights or more).
 * `noAge` is `full` without an age (no zones), `empty` has nothing ever, `sparse` has three days of last week and
 * nothing in the current period, `vendor` is `full` with the ring maker's scores on.
 */
import type {
  BioProvenance, BioQuality, BioSourceDoc, DailyRecord, ResolvedDay, SleepRecord, SleepStageInterval, SleepStageName, SpotRecord, WorkoutRecord,
} from '@/biometrics/core/types';
import { resolveDays, type SourcedRecord } from '@/biometrics/core/resolve';
import { addDays, daysBetween, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { fixedClock, type LivingClock } from '@/features/living/clock';
import type { SeriesPoint } from './charts/ringData';
import { zoneModel, zoneOf } from './charts/zones';
import { monthStart, nextMonthStart, prevMonthStart, weekStart } from './models';
import type { SeriesMetric, SignalBaseline, SignalsPerson, SignalsSource } from './data';

export type SignalsScenario = 'full' | 'noAge' | 'empty' | 'sparse' | 'vendor';

export const SIGNALS_SCENARIOS: readonly SignalsScenario[] = ['full', 'noAge', 'empty', 'sparse', 'vendor'];

/** The fixed "today" of the fixtures (a Sunday). */
export const FIXTURE_TODAY: LocalDate = '2026-10-04';

/** The wall-clock time "now" is fixed at on `today` (local). */
export const FIXTURE_NOW_LOCAL = '14:30';

/** A Living clock frozen at FIXTURE_TODAY 14:30 in the runtime's zone (tests wrap the pages in `LivingClockContext`). */
export function fixtureClock(): LivingClock {
  return fixedClock(`${FIXTURE_TODAY}T${FIXTURE_NOW_LOCAL}`);
}

/** The runtime's UTC offset on a date, seconds east (what the pages' day windows use). */
export function browserTzOffsetS(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return -new Date(y, m - 1, d, 12).getTimezoneOffset() * 60;
}

export interface FixtureOptions {
  /** The current day. Default FIXTURE_TODAY. */
  today?: LocalDate;
  /** Seconds east of UTC: one number, or a function of the date (zones with daylight saving). Default: the runtime's. */
  tzOffsetS?: number | ((date: LocalDate) => number);
  /** "Now" in ms. Default: `today` 14:30 local. */
  now?: number;
}

interface Cfg {
  empty?: boolean;
  sparse?: boolean;
  noAge?: boolean;
  vendor?: boolean;
}

const CFG: Record<SignalsScenario, Cfg> = { full: {}, noAge: { noAge: true }, empty: { empty: true }, sparse: { sparse: true }, vendor: { vendor: true } };

const DAYS = 400;
const AGE = 41;
const RING_KEY = 'ble:jstyle2301|j-style:2301#c3d94f2a';
const MANUAL_KEY = 'manual';
const RING_LABEL = 'J-Style 2301';
/** The normal skin temperature the nightly deviation is measured from. */
const TEMP_NORMAL = 33.5;
const MIN = 60_000;

/* ------------------------------------------------------------------------------------------------ randomness */

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 seeded by a string: the same key always gives the same sequence. */
function rng(key: string): () => number {
  let a = hashOf(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x: number, d = 0): number => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ------------------------------------------------------------------------------------------------ shapes of a day */

interface Plan {
  date: LocalDate;
  /** Days before today (0 = today). */
  idx: number;
  rest: number;
  /** Minutes from local midnight of the wake date (negative: the evening before). */
  bedMin: number;
  wakeMin: number;
  hrv: number;
  /** Mean skin temperature of the night minus the normal. */
  dev: number;
  spo2: number;
  dip: boolean;
}

interface WorkoutPlan {
  type: string;
  startMin: number;
  durMin: number;
  base: number;
  peak: number;
  stepsPerMin: number;
  kcalPerMin: number;
  metersPerMin: number;
  manual: boolean;
}

interface Seg {
  stage: SleepStageName;
  start: number;
  end: number;
}

/** Steps per hour of a plain day, before the day's factor. */
const STEP_PROFILE = [0, 0, 0, 0, 0, 0, 40, 350, 900, 350, 150, 600, 450, 200, 120, 300, 700, 900, 600, 400, 200, 100, 40, 0];

function overlay(segs: readonly Seg[], from: number, to: number, stage: SleepStageName | null): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (s.end <= from || s.start >= to) {
      out.push(s);
      continue;
    }
    if (s.start < from) out.push({ ...s, end: from });
    if (s.end > to) out.push({ ...s, start: to });
  }
  if (stage) out.push({ stage, start: from, end: to });
  return out.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------------------------------------ the world */

function build(scenario: SignalsScenario, opts: FixtureOptions) {
  const cfg = CFG[scenario];
  const today = opts.today ?? FIXTURE_TODAY;
  const offOf = typeof opts.tzOffsetS === 'function' ? opts.tzOffsetS : typeof opts.tzOffsetS === 'number' ? () => opts.tzOffsetS as number : browserTzOffsetS;
  const idxOf = (d: LocalDate): number => daysBetween(d, today);
  const dayStart = (d: LocalDate): number => {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, dd) - offOf(d) * 1000;
  };
  const at = (d: LocalDate, min: number): number => dayStart(d) + min * MIN;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const nowMs = opts.now ?? at(today, 14 * 60 + 30);
  const nowMin = (nowMs - dayStart(today)) / MIN;
  const ingestedAt = iso(nowMs - 6 * MIN);

  // which dates the ring was on
  const mondayThisWeek = weekStart(today);
  const sparseDates = [addDays(mondayThisWeek, -6), addDays(mondayThisWeek, -4), addDays(mondayThisWeek, -2)];
  let gapStart = monthStart(today);
  for (let i = 0; i < 4; i++) gapStart = prevMonthStart(gapStart);
  const gapEnd = nextMonthStart(gapStart);
  const first = cfg.sparse ? sparseDates[0]! : addDays(today, -(DAYS - 1));
  const inWindow = (d: LocalDate): boolean => !cfg.empty && d >= first && d <= today;
  const dayGap = (d: LocalDate): boolean => {
    const i = idxOf(d);
    return i === 3 || i === 20 || i === 21 || (i > 40 && i % 17 === 9) || (d >= gapStart && d < gapEnd);
  };
  const nightGap = (d: LocalDate): boolean => idxOf(d) > 40 && idxOf(d) % 11 === 7;
  const dayPresent = (d: LocalDate): boolean => inWindow(d) && (cfg.sparse ? sparseDates.includes(d) : !dayGap(d));
  // a night belongs to the date it ends; it spans the evening of the day before
  const nightPresent = (d: LocalDate): boolean =>
    inWindow(d) && (cfg.sparse ? sparseDates.includes(d) : !dayGap(d) && !dayGap(addDays(d, -1)) && !nightGap(d));
  const charging = (d: LocalDate, m: number): boolean => idxOf(d) % 6 === 2 && m >= 19 * 60 && m < 20 * 60;

  const plans = new Map<LocalDate, Plan>();
  const plan = (d: LocalDate): Plan => {
    let p = plans.get(d);
    if (p) return p;
    const idx = idxOf(d);
    const r = rng(`plan|${d}`);
    const weekend = weekdayOf(d) >= 5;
    p = {
      date: d,
      idx,
      rest: 57 + Math.round(4 * Math.sin(idx / 11)) + Math.round(r() * 3 - 1.5),
      bedMin: idx === 0 ? -55 : -90 + Math.floor(r() * 110),
      wakeMin: idx === 0 ? 405 : 370 + Math.floor(r() * 80) + (weekend ? 50 : 0),
      hrv: Math.round(48 + 8 * Math.sin(idx / 5) + (r() * 10 - 5)),
      dev: round(0.25 * Math.sin(idx / 6) + (r() * 0.4 - 0.2), 2),
      spo2: 96.2 + r() * 0.8,
      dip: idx % 9 === 4,
    };
    plans.set(d, p);
    return p;
  };

  /** Is the ring on the finger at minute `m` of local day `d`? */
  const worn = (d: LocalDate, m: number): boolean => {
    const p = plan(d);
    if (m < p.wakeMin && m >= p.bedMin) return nightPresent(d);
    const next = addDays(d, 1);
    const eveningBed = 1440 + plan(next).bedMin;
    if (m >= eveningBed) return nightPresent(next);
    return dayPresent(d) && !charging(d, m);
  };

  const napOf = (d: LocalDate): [number, number] | null => (idxOf(d) === 1 && dayPresent(d) ? [14 * 60 + 10, 14 * 60 + 40] : null);

  const workoutPlan = (d: LocalDate): WorkoutPlan | null => {
    if (!dayPresent(d)) return null;
    const i = idxOf(d);
    const p = plan(d);
    const r = rng(`workout|${d}`);
    if (i === 8) {
      return { type: 'strength_training', startMin: 18 * 60, durMin: 45, base: 0, peak: 0, stepsPerMin: 0, kcalPerMin: 5, metersPerMin: 0, manual: true };
    }
    if (i % 3 !== 0) return null;
    const jitter = 5 * Math.floor(r() * 6);
    const k = (i / 3) % 3;
    if (k === 0) {
      return { type: 'running', startMin: Math.max(7 * 60 + 30 + jitter, p.wakeMin + 30), durMin: 38 + Math.floor(r() * 8), base: 100, peak: 156, stepsPerMin: 150, kcalPerMin: 11, metersPerMin: 160, manual: false };
    }
    if (k === 1) {
      return { type: 'biking', startMin: 17 * 60 + 30 + jitter, durMin: 45 + Math.floor(r() * 10), base: 95, peak: 148, stepsPerMin: 8, kcalPerMin: 8, metersPerMin: 380, manual: false };
    }
    return { type: 'walking', startMin: 12 * 60 + 30 + jitter, durMin: 30 + Math.floor(r() * 10), base: 82, peak: 118, stepsPerMin: 100, kcalPerMin: 5, metersPerMin: 85, manual: false };
  };

  /* ---- steps per hour: null = no record (ring off, charging, hour not here yet) */
  const stepsCache = new Map<LocalDate, Array<number | null>>();
  const stepsHours = (d: LocalDate): Array<number | null> => {
    const hit = stepsCache.get(d);
    if (hit) return hit;
    const p = plan(d);
    const eveningBed = 1440 + plan(addDays(d, 1)).bedMin;
    const r = rng(`steps|${d}`);
    const wp = workoutPlan(d);
    const f = 0.9 + r() * 0.8;
    const desk = idxOf(d) === 0 ? 10 : 9 + Math.floor(r() * 8);
    const out: Array<number | null> = [];
    for (let h = 0; h < 24; h++) {
      const noise = 0.8 + r() * 0.4;
      if (!worn(d, h * 60 + 30) || (d === today && h * 60 >= nowMin)) {
        out.push(null);
        continue;
      }
      const asleep = h * 60 + 60 <= p.wakeMin || h * 60 >= eveningBed;
      let v = asleep ? 0 : Math.round(STEP_PROFILE[h]! * f * noise);
      let worked = 0;
      if (wp && !wp.manual) {
        worked = Math.max(0, Math.min(h * 60 + 60, wp.startMin + wp.durMin) - Math.max(h * 60, wp.startMin));
        v += Math.round(worked * wp.stepsPerMin);
      }
      if (!asleep && h === desk && worked === 0) v = 0; // a worn hour with 0 steps
      if (d === today && (h + 1) * 60 > nowMin) v = Math.round((v * (nowMin - h * 60)) / 60);
      out.push(v);
    }
    stepsCache.set(d, out);
    return out;
  };

  /* ---- heart rate, every 5 minutes while worn */
  const hrCache = new Map<LocalDate, SeriesPoint[]>();
  const hrDay = (d: LocalDate): SeriesPoint[] => {
    const hit = hrCache.get(d);
    if (hit) return hit;
    const p = plan(d);
    const pn = plan(addDays(d, 1));
    const wp = workoutPlan(d);
    const nap = napOf(d);
    const steps = stepsHours(d);
    const r = rng(`hr|${d}`);
    const start = dayStart(d);
    const eveningBed = 1440 + pn.bedMin;
    const out: SeriesPoint[] = [];
    for (let m = 0; m < 1440; m += 5) {
      const t = start + m * MIN;
      if (t > nowMs) break;
      const noise = r();
      const noise2 = r();
      if (!worn(d, m)) continue;
      let v: number;
      const sh = steps[Math.floor(m / 60)] ?? 0;
      const daytime = p.rest + 12 + Math.min(30, sh / 45) + 3 * Math.sin(m / 37) + (noise * 5 - 2.5);
      if (m >= p.bedMin && m < p.wakeMin) {
        const frac = (m - p.bedMin) / (p.wakeMin - p.bedMin);
        v = p.rest - 1 + 9 * Math.pow(1 - Math.sin(Math.PI * clamp(frac, 0, 1)), 1.2) + (noise * 3 - 1.5);
      } else if (m >= eveningBed) {
        const frac = (m - eveningBed) / (pn.wakeMin - pn.bedMin);
        v = p.rest - 1 + 9 * Math.pow(1 - Math.sin(Math.PI * clamp(frac, 0, 1)), 1.2) + (noise * 3 - 1.5);
      } else if (nap && m >= nap[0] && m < nap[1]) {
        v = p.rest + 3 + noise * 2;
      } else if (wp && !wp.manual && m >= wp.startMin && m <= wp.startMin + wp.durMin) {
        const phase = m - wp.startMin;
        const end = wp.startMin + wp.durMin;
        let f = Math.min(1, phase / 8);
        if (m > end - 4) f *= Math.max(0.3, (end - m) / 4);
        const wave = 0.5 + 0.5 * Math.sin((phase / wp.durMin) * Math.PI * 4);
        v = wp.base + f * (wp.peak - wp.base) * (0.55 + 0.45 * wave) + (noise2 * 6 - 3);
      } else if (wp && !wp.manual && m > wp.startMin + wp.durMin && m <= wp.startMin + wp.durMin + 12) {
        v = daytime + 30 * (1 - (m - wp.startMin - wp.durMin) / 12);
      } else {
        v = daytime;
      }
      out.push({ t, v: Math.round(clamp(v, 42, 185)) });
    }
    hrCache.set(d, out);
    return out;
  };
  /** Heart-rate samples between two instants (a night spans two dates). */
  const hrBetween = (from: number, to: number, dates: readonly LocalDate[]): SeriesPoint[] =>
    dates.flatMap((d) => hrDay(d)).filter((x) => x.t >= from && x.t <= to);

  /* ---- the night: stages and the overnight series */
  const stageSegs = (p: Plan, bed: number, wake: number): Seg[] => {
    if (p.idx === 6) return [{ stage: 'unknown', start: bed, end: wake }];
    const r = rng(`stages|${p.date}`);
    const cap = wake - 6 * MIN;
    let t = bed;
    let segs: Seg[] = [];
    const put = (stage: SleepStageName, min: number, limit = cap) => {
      const end = Math.min(limit, t + min * MIN);
      if (end > t) {
        segs.push({ stage, start: t, end });
        t = end;
      }
    };
    put('awake', 6 + Math.floor(r() * 9));
    for (let k = 0; t < cap; k++) {
      put('light', 18 + Math.floor(r() * 16));
      put('deep', k < 2 ? 26 + Math.floor(r() * 22) : 6 + Math.floor(r() * 12));
      put('light', 10 + Math.floor(r() * 14));
      put('rem', 8 + k * 4 + Math.floor(r() * 14));
      if (r() < 0.4) put('awake', 2 + Math.floor(r() * 5));
    }
    if (t < wake) segs.push({ stage: 'awake', start: t, end: wake });
    if (p.idx > 0 && p.idx % 4 === 1) {
      const u0 = bed + (110 + Math.floor(r() * 40)) * MIN;
      segs = overlay(segs, u0, u0 + (18 + Math.floor(r() * 22)) * MIN, 'unknown');
    }
    if (p.idx > 0 && p.idx % 7 === 3) {
      const g0 = bed + 300 * MIN;
      segs = overlay(segs, g0, g0 + 15 * MIN, null);
    }
    return segs;
  };

  interface NightSeries {
    hrv: SeriesPoint[];
    spo2: SeriesPoint[];
    skin_temp: SeriesPoint[];
  }
  const nightCache = new Map<LocalDate, NightSeries>();
  const NO_NIGHT: NightSeries = { hrv: [], spo2: [], skin_temp: [] };
  const nightSeries = (d: LocalDate): NightSeries => {
    if (!nightPresent(d)) return NO_NIGHT;
    const hit = nightCache.get(d);
    if (hit) return hit;
    const p = plan(d);
    const bed = at(d, p.bedMin);
    const wake = at(d, p.wakeMin);
    const r = rng(`night|${d}`);
    const hrv: SeriesPoint[] = [];
    for (let t = bed + 20 * MIN; t <= wake - 10 * MIN; t += 30 * MIN) hrv.push({ t, v: Math.round(p.hrv * (0.82 + 0.36 * r())) });
    const spo2: SeriesPoint[] = [];
    const skin_temp: SeriesPoint[] = [];
    for (let t = bed + 10 * MIN; t <= wake; t += 10 * MIN) {
      const minOfDay = (t - dayStart(d)) / MIN;
      const dipNow = p.dip && minOfDay >= 180 && minOfDay <= 200;
      spo2.push({ t, v: dipNow ? 91 + Math.round(r()) : Math.round(clamp(p.spo2 + 0.8 * Math.sin(((t - bed) / MIN) / 38 + p.idx) + (r() * 0.8 - 0.5), 93, 99)) });
      const frac = (t - bed) / (wake - bed);
      skin_temp.push({ t, v: round(TEMP_NORMAL + p.dev + 0.25 * Math.sin(Math.PI * frac * 1.4) - 0.1 + (r() * 0.12 - 0.06), 2) });
    }
    const out = { hrv, spo2, skin_temp };
    nightCache.set(d, out);
    return out;
  };

  /* ---- battery: charged for an hour at 19:00 every sixth day, down 0.55 % an hour */
  const batteryDay = (d: LocalDate): SeriesPoint[] => {
    if (!dayPresent(d)) return [];
    const out: SeriesPoint[] = [];
    const daysSince = (((2 - idxOf(d)) % 6) + 6) % 6;
    for (let h = 0; h < 24; h += 3) {
      const t = at(d, h * 60);
      if (t > nowMs) break;
      const hours = daysSince * 24 + h - 20 + (daysSince === 0 && h < 20 ? 144 : 0);
      out.push({ t, v: Math.round(clamp(100 - 0.55 * hours, 8, 100)) });
    }
    return out;
  };

  /* ---- records ----------------------------------------------------------------------------------------------- */
  const ringProv = (): BioProvenance => ({
    channel: 'ble:jstyle2301',
    device: { type: 'ring', manufacturer: 'J-Style', model: '2301', firmware: 'V0789', tier: 'C' },
    recording_method: 'automatic',
    modality: 'sensed',
    decoder: 'jstyle2301/V0789@1',
    ingested_at: ingestedAt,
  });
  const activeProv = (): BioProvenance => ({ ...ringProv(), recording_method: 'active' });
  const handProv = (): BioProvenance => ({ channel: 'manual', recording_method: 'manual', modality: 'self_reported', ingested_at: ingestedAt });
  const measured = (): BioQuality => ({ validation: 'measured', confidence: null, flags: [] });
  const records: SourcedRecord[] = [];
  const add = (sourceKey: string, record: SourcedRecord['record']) => records.push({ sourceKey, record });
  const age = cfg.noAge ? undefined : AGE;
  const zones = age === undefined ? null : zoneModel({ ageYears: age });

  const dates: LocalDate[] = [];
  if (!cfg.empty) for (let d = first; d <= today; d = addDays(d, 1)) dates.push(d);

  for (const d of dates) {
    const p = plan(d);
    const off = offOf(d);
    const time = (extra: { start?: string; end?: string; at?: string } = {}) => ({ tz_offset_s: off, local_date: d, ...extra });

    // main night (wake date d) and its summary numbers
    let night: { hrMin?: number; hrv?: number; spo2Avg?: number; spo2Min?: number; tempAvg?: number } = {};
    let sleepId: string | undefined;
    if (nightPresent(d)) {
      const bed = at(d, p.bedMin);
      const wake = at(d, p.wakeMin);
      const segs = stageSegs(p, bed, wake);
      const secs = (...st: SleepStageName[]) => Math.round(segs.filter((s) => st.includes(s.stage)).reduce((a, s) => a + (s.end - s.start), 0) / 1000);
      const only = p.idx === 6;
      const unknown = secs('unknown');
      const asleep = secs('deep', 'light', 'rem') + unknown;
      const inBed = Math.round((wake - bed) / 1000);
      const awakeSegs = segs.filter((s) => s.stage === 'awake');
      const lat = segs[0]?.stage === 'awake' ? Math.round((segs[0].end - segs[0].start) / 1000) : 0;
      const series = nightSeries(d);
      const hrs = hrBetween(bed, wake, [addDays(d, -1), d]);
      const spo = series.spo2.map((x) => x.v);
      const tmp = series.skin_temp.map((x) => x.v);
      const hrvAvg = series.hrv.length ? round(mean(series.hrv.map((x) => x.v))) : undefined;
      night = {
        ...(hrs.length ? { hrMin: Math.min(...hrs.map((x) => x.v)) } : {}),
        ...(hrvAvg !== undefined ? { hrv: hrvAvg } : {}),
        ...(spo.length ? { spo2Avg: round(mean(spo), 1), spo2Min: Math.min(...spo) } : {}),
        ...(tmp.length ? { tempAvg: round(mean(tmp), 2) } : {}),
      };
      sleepId = `sleep-${d}`;
      const provisional = p.idx === 0;
      const rec: SleepRecord = {
        kind: 'sleep',
        record_id: sleepId,
        version: 1,
        is_main: true,
        in_bed_s: inBed,
        asleep_s: asleep,
        ...(only ? {} : { awake_s: secs('awake'), light_s: secs('light'), deep_s: secs('deep'), rem_s: secs('rem') }),
        ...(unknown > 0 ? { unknown_s: unknown } : {}),
        ...(only ? {} : { latency_s: lat, waso_s: Math.max(0, secs('awake') - lat), awakenings: Math.max(0, awakeSegs.length - 2) }),
        efficiency_pct: round((asleep / inBed) * 100, 1),
        stages: segs.map((s): SleepStageInterval => ({ start: iso(s.start), end: iso(s.end), stage: s.stage })),
        time: time({ start: iso(bed), end: iso(wake) }),
        provenance: ringProv(),
        quality: { validation: 'vendor_proprietary', confidence: provisional ? 'low' : null, flags: provisional ? ['provisional_stages'] : [] },
        night: {
          ...(night.hrMin !== undefined ? { hr_min_bpm: night.hrMin } : {}),
          ...(night.hrv !== undefined ? { hrv: { metric: 'rmssd' as const, value_ms: night.hrv } } : {}),
          ...(night.spo2Avg !== undefined ? { spo2_avg_pct: night.spo2Avg } : {}),
          ...(night.tempAvg !== undefined ? { skin_temp_delta_c: round(night.tempAvg - TEMP_NORMAL, 2) } : {}),
        },
      };
      add(RING_KEY, rec);
    }

    const nap = napOf(d);
    if (nap) {
      const nap0 = at(d, nap[0]);
      const nap1 = at(d, nap[1] - 2);
      add(RING_KEY, {
        kind: 'sleep', record_id: `sleep-${d}-nap`, version: 1, is_main: false, in_bed_s: (nap1 - nap0) / 1000, asleep_s: (nap1 - nap0) / 1000, light_s: (nap1 - nap0) / 1000,
        stages: [{ start: iso(nap0), end: iso(nap1), stage: 'light' }],
        time: time({ start: iso(nap0), end: iso(nap1) }), provenance: ringProv(), quality: { validation: 'vendor_proprietary', confidence: null, flags: [] },
      } satisfies SleepRecord);
    }

    if (!dayPresent(d)) continue;

    // workouts
    const wp = workoutPlan(d);
    let workoutKcal = 0;
    if (wp) {
      const w0 = at(d, wp.startMin);
      const w1 = at(d, wp.startMin + wp.durMin);
      const kcal = Math.round(wp.kcalPerMin * wp.durMin);
      workoutKcal = kcal;
      const base = {
        kind: 'workout' as const, record_id: `workout-${d}`, version: 1, exercise_type: wp.type, active_duration_s: wp.durMin * 60, active_kcal: kcal,
        time: time({ start: iso(w0), end: iso(w1) }),
      };
      if (wp.manual) {
        add(MANUAL_KEY, { ...base, title: 'Gym session', rpe_0_10: 6, provenance: handProv(), quality: { validation: 'self_reported', confidence: null, flags: [] } } satisfies WorkoutRecord);
      } else {
        const hrs = hrBetween(w0, w1, [d]);
        const zs = [0, 0, 0, 0, 0];
        if (zones) {
          for (const x of hrs) {
            const z = zoneOf(x.v, zones);
            if (z > 0) zs[z - 1]! += 300;
          }
        }
        add(RING_KEY, {
          ...base,
          distance_m: Math.round(wp.metersPerMin * wp.durMin),
          ...(hrs.length ? { hr_avg_bpm: Math.round(mean(hrs.map((x) => x.v))), hr_max_bpm: Math.max(...hrs.map((x) => x.v)) } : {}),
          ...(zones && hrs.length ? { hr_zones_s: zs } : {}),
          provenance: ringProv(), quality: measured(),
        } satisfies WorkoutRecord);
      }
    }

    // spot checks (Check now)
    const spot = (metric: SpotRecord['metric'], value: number, min: number, id: string) =>
      add(RING_KEY, { kind: 'spot', metric, value, record_id: `spot-${d}-${id}`, version: 1, time: time({ at: iso(at(d, min)) }), provenance: activeProv(), quality: measured() } satisfies SpotRecord);
    if (p.idx === 0) {
      spot('hr_bpm', 71, 9 * 60 + 12, 'hr');
      spot('spo2_pct', 97, 9 * 60 + 12, 'spo2');
      spot('hrv_ms', 46, 9 * 60 + 14, 'hrv');
    } else if (p.idx % 5 === 4) {
      spot('hr_bpm', p.rest + 10 + Math.round(rng(`spot|${d}`)() * 6), 21 * 60 + 40, 'hr');
    }

    // the day
    const hours = stepsHours(d);
    const steps = hours.reduce<number>((a, v) => a + (v ?? 0), 0);
    let light = 0, moderate = 0, vigorous = 0;
    for (const v of hours) {
      if (v === null || v <= 200) continue;
      const m = Math.min(60, Math.round(v / 90));
      if (v >= 3000) vigorous += m;
      else if (v >= 1200) moderate += m;
      else light += m;
    }
    const hr = hrDay(d);
    const hrv = night.hrv;
    const vendorBase = 62 + Math.round(14 * Math.sin(p.idx / 4));
    add(RING_KEY, {
      kind: 'daily', record_id: `daily-${d}`, version: 1, time: time(), provenance: ringProv(),
      quality: { validation: 'measured', confidence: null, flags: p.idx === 0 ? ['partial_day'] : [] },
      steps, distance_m: Math.round(steps * 0.74), active_kcal: Math.round(steps * 0.045 + workoutKcal),
      active_min: { light, moderate, vigorous },
      resting_hr_bpm: p.rest,
      ...(hr.length ? { hr_avg_bpm: Math.round(mean(hr.map((x) => x.v))), hr_min_bpm: Math.min(...hr.map((x) => x.v)), hr_max_bpm: Math.max(...hr.map((x) => x.v)) } : {}),
      ...(hrv !== undefined ? { hrv: { metric: 'rmssd' as const, value_ms: hrv, window: 'night' as const, n: nightSeries(d).hrv.length } } : {}),
      ...(night.spo2Avg !== undefined ? { spo2_avg_pct: night.spo2Avg, spo2_min_pct: night.spo2Min } : {}),
      ...(night.tempAvg !== undefined ? { skin_temp_c: night.tempAvg, skin_temp_delta_c: round(night.tempAvg - TEMP_NORMAL, 2) } : {}),
      ...(sleepId ? { main_sleep_id: sleepId } : {}),
      ...(cfg.vendor ? { vendor: { sleep: clamp(vendorBase + 12, 0, 100), readiness: clamp(vendorBase + 8, 0, 100), recovery: clamp(vendorBase, 0, 100), stress: { value: clamp(80 - vendorBase, 0, 100), scale: '0-100' } } } : {}),
    } satisfies DailyRecord);
  }

  const sources: BioSourceDoc[] = [
    { sourceKey: RING_KEY, label: RING_LABEL, tier: 'C', policies: [], baselineEpochs: [] },
    { sourceKey: MANUAL_KEY, label: 'By hand', tier: 'C', policies: [], baselineEpochs: [] },
  ];
  const byDate = new Map<LocalDate, SourcedRecord[]>();
  for (const sr of records) {
    const k = sr.record.time.local_date;
    const list = byDate.get(k);
    if (list) list.push(sr);
    else byDate.set(k, [sr]);
  }
  const withData = [...byDate.keys()].sort();

  return { cfg, today, first, withData, byDate, sources, nowMs, age, hrDay, stepsHours, nightSeries, batteryDay, dayStart };
}

/* ------------------------------------------------------------------------------------------------ the source */

/** A full `SignalsSource` of one scenario. Deterministic: the same options give the same records and samples. */
export function createFixtureSignalsSource(scenario: SignalsScenario, opts: FixtureOptions = {}): SignalsSource {
  const w = build(scenario, opts);
  const dayCache = new Map<string, ResolvedDay[]>();

  const days = (from: LocalDate, to: LocalDate): ResolvedDay[] => {
    const key = `${from}|${to}`;
    const hit = dayCache.get(key);
    if (hit) return hit;
    const lo = from < w.first ? w.first : from;
    const hi = to > w.today ? w.today : to;
    const list: SourcedRecord[] = [];
    if (!w.cfg.empty) for (let d = lo; d <= hi; d = addDays(d, 1)) list.push(...(w.byDate.get(d) ?? []));
    const out = resolveDays(list, w.sources, { from, to }).filter((d) => d.daily || d.mainSleep || d.sleeps.length || d.workouts.length || d.spots.length);
    dayCache.set(key, out);
    return out;
  };

  const inDay = (t: number, d: LocalDate) => t >= w.dayStart(d) && t < w.dayStart(addDays(d, 1));
  const onDate = (metric: SeriesMetric, d: LocalDate): SeriesPoint[] => {
    switch (metric) {
      case 'hr':
        return w.hrDay(d);
      case 'steps':
        return w.stepsHours(d).flatMap((v, h) => (v === null ? [] : [{ t: w.dayStart(d) + h * 3_600_000, v }]));
      case 'battery':
        return w.batteryDay(d);
      default: {
        const next = addDays(d, 1);
        return [...w.nightSeries(d)[metric], ...w.nightSeries(next)[metric]].filter((x) => inDay(x.t, d));
      }
    }
  };

  let baselineList: SignalBaseline[] | null = null;
  const baselines = (): SignalBaseline[] => {
    if (baselineList) return baselineList;
    const from = addDays(w.today, -59);
    const list = days(from, w.today);
    const specs: Array<{ metric: string; unit: string; get: (d: ResolvedDay) => number | undefined }> = [
      { metric: 'resting_hr_bpm', unit: 'bpm', get: (d) => d.daily?.resting_hr_bpm },
      { metric: 'hrv_rmssd_ms', unit: 'ms', get: (d) => (d.daily?.hrv?.metric === 'rmssd' ? d.daily.hrv.value_ms : undefined) },
      { metric: 'sleep_h', unit: 'h', get: (d) => (d.mainSleep ? d.mainSleep.asleep_s / 3600 : undefined) },
      { metric: 'skin_temp_delta_c', unit: '°C', get: (d) => d.daily?.skin_temp_delta_c },
      { metric: 'spo2_avg_pct', unit: '%', get: (d) => d.daily?.spo2_avg_pct },
    ];
    const out: SignalBaseline[] = [];
    for (const s of specs) {
      const vals = list.map(s.get).filter((v): v is number => v !== undefined && Number.isFinite(v));
      if (vals.length < 3) continue;
      const m = mean(vals);
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
      const dec = s.unit === 'h' || s.unit === '°C' ? 2 : 1;
      out.push({ metric: s.metric, unit: s.unit, mean: round(m, dec), lo: round(m - 0.5 * sd, dec), hi: round(m + 0.5 * sd, dec), nights: vals.length, forming: vals.length < 14 });
    }
    baselineList = out;
    return out;
  };

  const person: SignalsPerson = {
    ...(w.age !== undefined ? { ageYears: w.age } : {}),
    goals: { steps: 8000, activeMin: 30, sleepH: 8 },
    vendorScores: w.cfg.vendor === true,
    tempUnit: 'C',
  };
  const lastDate = w.withData.length ? w.withData[w.withData.length - 1]! : null;

  return {
    subscribe: () => () => {},
    revision: () => 1,
    days,
    async series(metric, fromMs, toMs, dates) {
      if (w.cfg.empty) return [];
      const out: SeriesPoint[] = [];
      for (const d of [...new Set(dates)].sort()) out.push(...onDate(metric, d));
      return out.filter((p) => p.t >= fromMs && p.t <= toMs && p.t <= w.nowMs).sort((a, b) => a.t - b.t);
    },
    async baselines() {
      return baselines();
    },
    firstDate: () => w.withData[0] ?? null,
    datesWithData: () => [...w.withData],
    person: () => person,
    sourceInfo(from, to) {
      const fed = w.withData.some((d) => d >= from && d <= to && (w.byDate.get(d) ?? []).some((r) => r.sourceKey === RING_KEY));
      const lastReadAt = w.cfg.empty || lastDate === null ? null : w.cfg.sparse ? w.dayStart(lastDate) + 22 * 3_600_000 : w.nowMs - 6 * MIN;
      return { labels: fed ? [RING_LABEL] : [], lastReadAt };
    },
  };
}
