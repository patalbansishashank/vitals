/**
 * Seeded Gauge data for tests, the screenshot harness and the development demo (`api.ts`): a believable year of ring
 * readings ending at `now`, in the shapes the server's `gauge_*` tools and S2's routes return (`sleep-metrics/1`
 * session metrics, `/baselines`, `/timeline`, `/steps`, the `daily` `derived` block; SPEC §2.2, A.1.1). Deterministic
 * for a given `now`. Last night carries the owner's readings (7 h 56 asleep, sleeping low HR 53, HRV 70). No
 * breathing rate, glucose or blood pressure: the ring does not measure them (A.2 #6). Never shipped to a person: only
 * tests and the development build import it.
 */
import type {
  GaugeActivity,
  GaugeActivityDay,
  GaugeBaselines,
  GaugeClockBaseline,
  GaugeDayDerived,
  GaugeSleepMetrics,
  GaugeStepDay,
  GaugeSteps,
  GaugeTimeline,
  RingApi,
  GaugeAvailability,
  GaugeBucketPoint,
  GaugeDaily,
  GaugeDeviceState,
  GaugeProvenance,
  GaugeRawPoint,
  GaugeScoreEntry,
  GaugeScores,
  GaugeSeries,
  GaugeSeriesQuery,
  GaugeShortVideo,
  GaugeShortVideoDay,
  GaugeSleep,
  GaugeStats,
  GaugeSleepSession,
  GaugeSleepStage,
  GaugeWorkout,
  GaugeWorkouts,
} from './types';

export type GaugeApi = RingApi;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of an instant in this device's zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An ISO instant with this device's offset, as the server writes them. */
export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${localDay(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Local midnight of a date. */
function midnight(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

const addDays = (date: string, n: number) => localDay(midnight(date) + n * DAY + 2 * HOUR);

/** A tool's `from` / `to` (a date, a local date-time or an instant) as ms. */
function when(v: string, edge: 'start' | 'end'): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return edge === 'start' ? midnight(v) : midnight(addDays(v, 1)) - 1;
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (local) return new Date(+local[1]!, +local[2]! - 1, +local[3]!, +local[4]!, +local[5]!, +(local[6] ?? 0)).getTime();
  return Date.parse(v);
}

/** A small deterministic generator per key. */
function rng(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Google's encoded polyline (precision 5). */
export function encodePolyline(points: ReadonlyArray<readonly [number, number]>): string {
  let out = '';
  let lastLat = 0;
  let lastLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lng * 1e5);
    out += enc(a - lastLat) + enc(b - lastLng);
    lastLat = a;
    lastLng = b;
  }
  return out;
}

export interface GaugeFixtureOptions {
  /** The moment the data ends (default: now). */
  now?: number;
  /** Minutes since Gauge last uploaded (default 4). */
  uploadedMinutesAgo?: number;
  /** Days of history (default 400, the server's longest range). */
  historyDays?: number;
  /** Last night's readings (default the owner's: 476 min asleep, sleeping low HR 53, HRV 70 ms). */
  lastNight?: { asleepMin?: number; lowHr?: number; hrvMs?: number };
  /** Serve S2's routes and fields (default true). False: an older server with only the §2.2 tools. */
  v2?: boolean;
  /**
   * (r064 VIZ) 'raw': the texture of the owner's real ring data, for the screenshot harness: a night of 1–3 minute stage
   * flips with short and one long "no reading" gap, and minute-by-minute day signals with jitter, spikes, short dropouts
   * and a charging gap. Default 'clean' (every test reads the clean data).
   */
  texture?: 'clean' | 'raw';
}

/** A Gauge client over seeded data. */
export function makeGaugeFixture(opts: GaugeFixtureOptions = {}): GaugeApi {
  const now = opts.now ?? Date.now();
  const today = localDay(now);
  const first = addDays(today, -((opts.historyDays ?? 400) - 1));
  const uploadMs = now - (opts.uploadedMinutesAgo ?? 4) * MIN;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const v2 = opts.v2 !== false;
  const textured = opts.texture === 'raw';
  const last = { asleepMin: 476, lowHr: 53, hrvMs: 70, ...opts.lastNight };

  const prov = (lastMs: number | null): GaugeProvenance => ({
    source: 'lumen_health',
    timeZone: tz,
    installations: [{ id: 'gauge-1', deviceName: 'Pixel 8', appVersion: '2.8.0', lastUploadAt: isoLocal(uploadMs) }],
    freshness: {
      lastUploadAt: isoLocal(uploadMs),
      lastReadingAt: lastMs === null ? null : isoLocal(lastMs),
      minutesSinceLastUpload: Math.round((now - uploadMs) / MIN),
      minutesSinceLastReading: lastMs === null ? null : Math.max(0, Math.round((now - lastMs) / MIN)),
    },
  });

  const inRange = (date: string) => date >= first && date <= today;
  const dayIndex = (date: string) => Math.round((midnight(date) - midnight(first)) / DAY);

  // --- sleep: one night per waking day, 22:15–23:45 to about 06:30–07:45, in 90-minute cycles

  interface Night {
    session: GaugeSleepSession;
    onsetMs: number;
    wakeMs: number;
    /** 5-min HR bins over [onset, finalWake), null inside unknown time. */
    trace: Array<number | null>;
    hrvMs: number;
    tempC: number;
  }
  const nights = new Map<string, Night | null>();

  function night(date: string): Night | null {
    if (nights.has(date)) return nights.get(date)!;
    const n = buildNight(date);
    nights.set(date, n);
    return n;
  }

  function buildNight(date: string): Night | null {
    if (!inRange(date) || date > today) return null;
    const isLast = date === today;
    const r = rng(`sleep:${date}`);
    const i = dayIndex(date);
    const startMs = midnight(date) - (isLast ? 58 : 30 + Math.floor(r() * 75)) * MIN;
    const target = isLast ? last.asleepMin : 400 + Math.floor(r() * 95);
    const unknownNight = !isLast && r() < 0.08;
    const blocks: GaugeSleepSession['blocks'] = [];
    const minutes: Record<GaugeSleepStage, number> = { deep: 0, light: 0, rem: 0, awake: 0, unknown: 0 };
    let t = startMs;
    let asleep = 0;
    const cap = date === today ? now : Infinity;
    const tex = rng(`tex:${date}`);
    const put = (stage: GaugeSleepStage, len: number) => {
      const asleepStage = stage === 'deep' || stage === 'light' || stage === 'rem';
      len = Math.min(len, Math.floor((cap - t) / MIN));
      if (len <= 0) return;
      const prev = blocks.at(-1);
      if (prev && prev.stage === stage) {
        prev.minutes += len;
        prev.end = isoLocal(t + len * MIN);
      } else blocks.push({ start: isoLocal(t), end: isoLocal(t + len * MIN), stage, minutes: len });
      minutes[stage] += len;
      if (asleepStage) asleep += len;
      t += len * MIN;
    };
    // (texture 'raw') the ring's minute epochs: a block breaks into runs of 2–9 minutes with 1–3 minute flips between
    const FLIP: Record<GaugeSleepStage, GaugeSleepStage[]> = { deep: ['light', 'light', 'unknown'], light: ['deep', 'rem', 'awake', 'unknown', 'deep'], rem: ['light', 'awake', 'light'], awake: ['light'], unknown: ['light'] };
    const push = (stage: GaugeSleepStage, m: number) => {
      const asleepStage = stage === 'deep' || stage === 'light' || stage === 'rem';
      const len = Math.max(0, Math.round(asleepStage ? Math.min(m, target - asleep) : m));
      if (!textured || !asleepStage || len < 6) return put(stage, len);
      let left = len;
      while (left > 0) {
        const run = Math.min(left, 2 + Math.floor(tex() * 8));
        put(stage, run);
        left -= run;
        if (left > 0) {
          const flips = FLIP[stage];
          put(flips[Math.floor(tex() * flips.length)]!, 1 + Math.floor(tex() * 3));
        }
      }
    };
    push('awake', isLast ? 12 : 5 + Math.floor(r() * 14));
    // (a night still running at `now`: stop once less than a minute is left, or a 0-minute push never moves `t`)
    for (let cycle = 0; asleep < target && t + MIN <= cap; cycle++) {
      const deep = Math.max(0, Math.round((cycle < 2 ? 40 : cycle < 3 ? 18 : 5) * (0.7 + r() * 0.6)));
      push('light', 18 + Math.floor(r() * 16));
      if (deep) push('deep', deep);
      push('light', 12 + Math.floor(r() * 10));
      if ((unknownNight || (textured && isLast)) && cycle === 2) push('unknown', 20 + Math.floor(r() * 16));
      push('rem', Math.round((cycle < 2 ? 12 : 26) * (0.7 + r() * 0.6)));
      if (r() < (isLast ? 0.5 : 0.4) && asleep < target) push('awake', 2 + Math.floor(r() * 8));
    }
    push('awake', 3 + Math.floor(r() * 6));
    const endMs = t;
    if (date === today && endMs > now - 5 * MIN && now < midnight(date) + 3 * HOUR) return null;
    const firstAsleep = blocks.find((b) => b.stage !== 'awake' && b.stage !== 'unknown');
    const lastAsleep = [...blocks].reverse().find((b) => b.stage !== 'awake' && b.stage !== 'unknown');
    if (!firstAsleep || !lastAsleep) return null;
    const onsetMs = Date.parse(firstAsleep.start);
    const wakeMs = Date.parse(lastAsleep.end);

    // inside [onset, finalWake)
    const inside = blocks.filter((b) => Date.parse(b.start) >= onsetMs && Date.parse(b.end) <= wakeMs);
    const sum = (st: string) => inside.filter((b) => b.stage === st).reduce((a, b) => a + b.minutes, 0);
    const K = sum('deep') + sum('light') + sum('rem');
    const A = sum('awake');
    const U = sum('unknown');
    const awakeRuns = inside.filter((b) => b.stage === 'awake');
    const named = K + A + U > 0 ? (100 * (K + A)) / (K + A + U) : 0;

    // heart rate: high at onset, a low two thirds in, a slight rise toward morning; awake blocks lift it
    const bins = Math.ceil((wakeMs - onsetMs) / (5 * MIN));
    const lowBase = isLast ? last.lowHr : 52 + 2.5 * Math.sin(i / 5) + (r() - 0.5) * 3;
    const raw: Array<number | null> = Array.from({ length: bins }, (_, k) => {
      const at = onsetMs + k * 5 * MIN;
      const b = inside.find((x) => at >= Date.parse(x.start) && at < Date.parse(x.end));
      if (b?.stage === 'unknown') return null;
      const f = k / Math.max(1, bins - 1);
      const n = rng(`nhr:${date}:${k}`)();
      return lowBase + 9 * Math.exp(-f * 5) + Math.max(0, f - 0.72) * 14 + (b?.stage === 'awake' ? 7 : 0) + (n - 0.5) * 2.4;
    });
    // the low (10th percentile) lands exactly on the night's value
    const p10 = pct(raw.filter((v): v is number => v !== null), 0.1);
    const shift = isLast && p10 !== null ? last.lowHr - p10 : 0;
    const trace = raw.map((v) => (v === null ? null : Math.round(v + shift)));
    const hrvMs = isLast ? last.hrvMs : Math.round(72 + 7 * Math.sin(i / 7) + (r() - 0.5) * 10);
    const tempC = r1(34.6 + 0.15 * Math.sin(i / 6) + (r() - 0.5) * 0.2);

    const vals = trace.filter((v): v is number => v !== null);
    const lowBin = vals.length ? trace.indexOf(Math.min(...vals)) : -1;
    const third = Math.floor(vals.length / 3);
    const med = (xs: number[]) => pct(xs, 0.5)!;
    let hrTrend: GaugeSleepMetrics['hrTrend'] = null;
    if (vals.length >= 9) {
      const d = med(vals.slice(2 * third)) - med(vals.slice(third, 2 * third));
      const a = Math.abs(d);
      hrTrend = a < 2 ? { word: 'steady', magnitude: null, deltaBpm: r1(d) } : { word: d > 0 ? 'rising' : 'falling', magnitude: a < 5 ? 'slight' : a < 10 ? 'moderate' : 'strong', deltaBpm: r1(d) };
    }
    const spo2 = rng(`spo2n:${date}`);
    const metrics: GaugeSleepMetrics = {
      version: 'sleep-metrics/1',
      K,
      A,
      U,
      G: 0,
      tstLowerMin: K,
      tstUpperMin: K + U,
      onset: isoLocal(onsetMs),
      finalWake: isoLocal(wakeMs),
      midpoint: isoLocal(onsetMs + (wakeMs - onsetMs) / 2),
      windowContinuityPct: named >= 95 ? r1((100 * K) / Math.max(1, K + A)) : null,
      wasoMin: A,
      awakeningRuns: awakeRuns.length,
      restorativeEstimatedMin: sum('deep') + sum('rem'),
      avgSleepHr: vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : null,
      hrReadings: vals.length ? vals.length : null,
      sampledMeanSleepHr: vals.length ? { bpm: Math.round(vals.reduce((x, y) => x + y, 0) / vals.length), n: vals.length } : null,
      nightlyLowHrP10: vals.length ? Math.round(pct(vals, 0.1)!) : null,
      timeToLowMin: lowBin >= 0 ? lowBin * 5 : null,
      trace5min: trace,
      hrvNightlyMs: hrvMs,
      skinTempNightC: tempC,
      respRate: null,
      tossesTurns: null,
      sleepLatency: null,
      reason: { respRate: 'unsupported', tossesTurns: 'unsupported', sleepLatency: 'unsupported' },
      nativeEpochS: 60,
      coveragePct: r1(named),
      stageMinutes: { deep: sum('deep'), light: sum('light'), rem: sum('rem'), asleepUnspecified: 0, awake: A, unknown: U },
      leadingWakeMin: Math.round((onsetMs - startMs) / MIN),
      wakeUps: awakeRuns.filter((b) => b.minutes >= 5).length,
      namedCoveragePct: r1(named),
      incomplete: named < 95,
      hrTrend,
      tooFewHrReadings: vals.length < 8,
      hrvWithinNightMs: isLast ? 9 : Math.round((r() - 0.3) * 14),
      spo2Night: { meanPct: Math.round(95.5 + spo2() * 1.5), minPct: Math.round(90 + spo2() * 3), count: Math.round((wakeMs - onsetMs) / (30 * MIN)) },
      minutesBelow90: null,
      minutesBelow90Reason: 'cadenceUnknown',
    };
    const inBed = Math.round((endMs - startMs) / MIN);
    const session: GaugeSleepSession = {
      wakingDate: date,
      start: isoLocal(startMs),
      end: isoLocal(endMs),
      inBedMinutes: inBed,
      asleepMinutes: minutes.deep + minutes.light + minutes.rem,
      minutes,
      efficiencyPercent: Math.round(((minutes.deep + minutes.light + minutes.rem) / inBed) * 100),
      blocks,
      ...(v2 ? { recordedWindowMinutes: inBed, metrics } : {}),
    };
    return { session, onsetMs, wakeMs, trace, hrvMs, tempC };
  }

  /** The night whose window holds `ms` (sleep from 19:00 counts toward the next day). */
  const nightAt = (ms: number): Night | null => {
    const d = new Date(ms);
    const date = d.getHours() >= 19 ? localDay(ms + 6 * HOUR) : localDay(ms);
    const n = night(date);
    return n && ms >= Date.parse(n.session.start) && ms < Date.parse(n.session.end) ? n : null;
  };

  // --- metrics: a smooth daily level plus an intraday shape and noise; overnight HR follows the night's trace
  const BASE: Record<string, { mean: number; drift: number; day: number; noise: number }> = {
    hr: { mean: 68, drift: 3, day: 14, noise: 6 },
    hrv: { mean: 66, drift: 6, day: -8, noise: 7 },
    spo2: { mean: 97, drift: 0.6, day: 0.4, noise: 1 },
    stress: { mean: 36, drift: 9, day: 22, noise: 12 },
    temp: { mean: 34.0, drift: 0.25, day: -0.6, noise: 0.15 },
  };
  const KINDS = Object.keys(BASE);
  const dailyLevel = (kind: string, date: string) => {
    const b = BASE[kind]!;
    const i = dayIndex(date);
    return b.mean + b.drift * Math.sin(i / 9) + b.drift * 0.4 * Math.sin(i / 2.3);
  };
  /** One reading at `ms`: the day's level, shaped by the hour (lower at night for HR, higher HRV at night). */
  const reading = (kind: string, ms: number) => {
    const b = BASE[kind]!;
    const d = new Date(ms);
    const h = d.getHours() + d.getMinutes() / 60;
    const r = rng(`${kind}:${Math.floor(ms / MIN)}`)();
    if (kind === 'hr') {
      const w = workoutsOn(localDay(ms)).find((x) => ms >= Date.parse(x.start) && ms <= Date.parse(x.end));
      if (w && w.avgHr) {
        const f = (ms - Date.parse(w.start)) / (Date.parse(w.end) - Date.parse(w.start));
        return w.avgHr - 22 * Math.exp(-f * 12) + 10 * Math.sin(f * 9) * (1 - f) + (r - 0.5) * 6;
      }
      const n = nightAt(ms);
      if (n && ms >= n.onsetMs && ms < n.wakeMs) {
        const v = n.trace[Math.floor((ms - n.onsetMs) / (5 * MIN))];
        if (v != null) return v + (r - 0.5) * 2;
      }
    }
    if (kind === 'hrv' && nightAt(ms)) return nightAt(ms)!.hrvMs + (r - 0.5) * 12;
    if (kind === 'temp' && nightAt(ms)) return nightAt(ms)!.tempC + (r - 0.5) * 0.2;
    const awake = h >= 7 && h < 23 ? 1 : 0;
    const shape = awake * (0.5 + 0.5 * Math.sin(((h - 7) / 16) * Math.PI));
    // stress: a busy late morning and a calmer evening
    const extra = kind === 'stress' ? awake * 18 * Math.exp(-(((h - 11.5) / 1.6) ** 2)) : 0;
    return dailyLevel(kind, localDay(ms)) + b.day * (shape - 0.35) + extra + (r - 0.5) * b.noise;
  };
  /** Reading times: every 10 min (HR), every 30 min for the rest, up to now; every minute while a workout records. */
  const times = (kind: string, from: number, to: number) => {
    // (texture 'raw', a day or two) every minute for HR, every 5 for the rest, with dropouts and a charging gap 14:20–16:05
    const fine = textured && to - from <= 2 * DAY;
    const step = fine ? (kind === 'hr' ? MIN : 5 * MIN) : kind === 'hr' ? 10 * MIN : 30 * MIN;
    const out: number[] = [];
    const start = Math.ceil(Math.max(from, midnight(first)) / step) * step;
    for (let t = start; t <= Math.min(to, now - 2 * MIN); t += step) {
      if (fine) {
        const d = new Date(t);
        const h = d.getHours() + d.getMinutes() / 60;
        if (h >= 14.33 && h < 16.08) continue;
        if (rng(`drop:${Math.floor(t / (7 * MIN))}`)() < 0.12) continue;
      }
      out.push(t);
    }
    if (kind === 'hr' && to - from <= 2 * DAY) {
      const extra = days(localDay(from), localDay(to))
        .flatMap(workoutsOn)
        .flatMap((w) => {
          const xs: number[] = [];
          for (let t = Math.ceil(Date.parse(w.start) / MIN) * MIN; t <= Date.parse(w.end); t += MIN) if (t >= from && t <= to && t % step) xs.push(t);
          return xs;
        });
      return [...out, ...extra].sort((a, b) => a - b);
    }
    return out;
  };
  const value = (kind: string, ms: number) => {
    let v = reading(kind, ms);
    if (textured) {
      // the raw texture: jitter and the odd motion spike (up for HR and stress, down for SpO2 and HRV)
      const j = rng(`jit:${kind}:${Math.floor(ms / MIN)}`);
      const b = BASE[kind]!;
      v += (j() - 0.5) * b.noise * 1.6;
      const spike = j();
      if (spike < 0.025) v += (kind === 'spo2' || kind === 'hrv' ? -1 : 1) * b.noise * (3 + j() * 3);
      else if (spike > 0.99) v -= b.noise * 2;
    }
    return kind === 'temp' ? r1(v) : Math.round(kind === 'spo2' ? Math.min(100, v) : kind === 'stress' ? Math.max(1, Math.min(99, v)) : v);
  };

  const stats = (xs: number[]): GaugeStats | null =>
    xs.length ? { count: xs.length, mean: r1(xs.reduce((a, b) => a + b, 0) / xs.length), min: r1(Math.min(...xs)), max: r1(Math.max(...xs)) } : null;

  const UNITS: Record<string, string> = { hr: 'bpm', hrv: 'ms', spo2: '%', stress: 'index (device scale)', temp: '°C' };

  function series(q: GaugeSeriesQuery): GaugeSeries {
    const from = when(q.from, 'start');
    const to = when(q.to, 'end');
    const bucket = q.bucket ?? 'raw';
    const kind = q.kind;
    const ts = kind in BASE ? times(kind, from, to) : [];
    let points: Array<GaugeRawPoint | GaugeBucketPoint>;
    if (bucket === 'raw') {
      points = ts.map((t) => ({ at: isoLocal(t), value: value(kind, t), provenance: 'device' }));
    } else {
      const groups = new Map<string, { start: number; ts: number[] }>();
      for (const t of ts) {
        const d = new Date(t);
        const key = bucket === 'day' ? localDay(t) : `${localDay(t)}T${pad(d.getHours())}`;
        const start = bucket === 'day' ? midnight(localDay(t)) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
        const g = groups.get(key) ?? { start, ts: [] };
        g.ts.push(t);
        groups.set(key, g);
      }
      points = [...groups.entries()].map(([key, g]) => ({
        ...(bucket === 'day' ? { date: key } : {}),
        start: isoLocal(g.start),
        ...(stats(g.ts.map((t) => value(kind, t))) ?? { count: 0 }),
      }));
    }
    return { kind, bucket, unit: UNITS[kind] ?? null, from: isoLocal(from), to: isoLocal(to), count: ts.length, truncated: false, points, ...prov(ts.length ? ts.at(-1)! : null) };
  }

  const days = (fromDate: string, toDate: string) => {
    const out: string[] = [];
    for (let d = fromDate < first ? first : fromDate; d <= toDate && d <= today; d = addDays(d, 1)) out.push(d);
    return out;
  };

  function sleep(from: string, to: string): GaugeSleep {
    const f = localDay(when(from, 'start'));
    const t = localDay(when(to, 'end'));
    const sessions = days(f, t)
      .map((d) => night(d)?.session ?? null)
      .filter((s): s is GaugeSleepSession => !!s);
    return { from: f, to: t, units: { minutes: 'min', efficiencyPercent: '% of time in bed asleep' }, sessions, ...prov(sessions.length ? Date.parse(sessions.at(-1)!.end) : null) };
  }

  // --- activity: hourly steps through the waking day, a walk most days; the phone adds what the ring misses
  const hourSteps = (date: string, h: number) => {
    if (h < 7 || h > 22) return 0;
    const r = rng(`steps:${date}:${h}`);
    const commute = h === 8 || h === 18 ? 1100 : 0;
    const lunch = h === 13 ? 900 : 0;
    return Math.round(140 + r() * 320 + commute * (0.6 + r() * 0.6) + lunch * r());
  };
  const RING_STEP_GOAL = 9000;
  function activityDay(date: string): { day: GaugeActivityDay & { fusedHeadline?: number | null }; hourly: Array<{ start: string; steps: number; distanceM: number }> } | null {
    if (!inRange(date)) return null;
    const hourly: Array<{ start: string; steps: number; distanceM: number }> = [];
    let steps = 0;
    let lastMs = midnight(date);
    for (let h = 0; h < 24; h++) {
      const start = midnight(date) + h * HOUR;
      if (start > now) break;
      const frac = Math.min(1, (now - start) / HOUR);
      const s = Math.round(hourSteps(date, h) * frac);
      if (s > 0) {
        hourly.push({ start: isoLocal(start), steps: s, distanceM: Math.round(s * 0.74) });
        lastMs = start + frac * HOUR;
      }
      steps += s;
    }
    steps += workoutsOn(date).reduce((a, w) => a + (w.steps ?? 0), 0);
    const exerciseS = workoutsOn(date).reduce((a, w) => a + w.durationS, 0);
    return {
      day: {
        date,
        steps,
        distanceM: Math.round(steps * 0.74),
        caloriesKcal: Math.round(steps * 0.042),
        activeMinutes: Math.round(exerciseS / 60 + steps / 900),
        bucketSteps: steps,
        bucketDistanceM: Math.round(steps * 0.74),
        lastUpdate: isoLocal(Math.min(now, lastMs)),
        ...(v2 ? { ringStepGoal: RING_STEP_GOAL, fusedHeadline: fusedOf(date, steps) } : {}),
      },
      hourly,
    };
  }
  /**
   * `steps-fuse/1` located total: the ring's, plus the phone's minutes the ring missed (hands fixed on a trolley, 10:00–
   * 10:30). (r068 B1) The same minutes are the timeline's phone lane, so the Steps by source sheet adds up: ring + phone =
   * counted, the ring's lane = its day total.
   */
  const TROLLEY_H = 10;
  const phoneExtra = (date: string) => (midnight(date) + (TROLLEY_H + 0.5) * HOUR <= now ? Math.round(rng(`phone:${date}`)() * 700) : 0);
  const fusedOf = (date: string, ring: number) => ring + phoneExtra(date);

  function activity(from: string, to: string): GaugeActivity {
    const f = when(from, 'start');
    const t = when(to, 'end');
    const list = days(localDay(f), localDay(t))
      .map(activityDay)
      .filter((x): x is NonNullable<typeof x> => !!x);
    const hourly = t - f <= 7 * DAY ? list.flatMap((x) => x.hourly) : undefined;
    return {
      from: isoLocal(f),
      to: isoLocal(t),
      units: { steps: 'steps', distanceM: 'm', caloriesKcal: 'kcal (phone estimate, method unstated)', activeMinutes: 'min' },
      days: list.map((x) => x.day),
      ...(v2 ? { fusionVersion: 'steps-fuse/1' } : {}),
      ...(hourly ? { hourly } : {}),
      ...prov(list.length ? Date.parse(list.at(-1)!.day.lastUpdate) : null),
    };
  }

  // --- workouts: a run every third day with a GPS loop, a walk on others
  const workoutCache = new Map<string, GaugeWorkout[]>();
  function workoutsOn(date: string): GaugeWorkout[] {
    const hit = workoutCache.get(date);
    if (hit) return hit;
    const out = buildWorkouts(date);
    workoutCache.set(date, out);
    return out;
  }
  function buildWorkouts(date: string): GaugeWorkout[] {
    if (!inRange(date)) return [];
    const i = dayIndex(date);
    const r = rng(`workout:${date}`);
    const out: GaugeWorkout[] = [];
    if ((i + 1) % 3 === 0) {
      const startMs = midnight(date) + (8 * 60 + 5) * MIN;
      const durationS = 2280 + Math.floor(r() * 900);
      if (startMs + durationS * 1000 <= now) {
        const distanceM = Math.round(durationS * (2.6 + r() * 0.4));
        const loop = Array.from({ length: 48 }, (_, k) => {
          const a = (k / 47) * Math.PI * 2;
          return [12.9716 + 0.012 * Math.sin(a) + 0.003 * Math.sin(3 * a), 77.5946 + 0.016 * Math.cos(a) + 0.002 * Math.cos(5 * a)] as const;
        });
        const zone = (f: number) => Math.round(durationS * f);
        out.push({
          id: `run-${date}`,
          date,
          start: isoLocal(startMs),
          end: isoLocal(startMs + durationS * 1000),
          type: 'run',
          source: 'gauge_gps',
          durationS,
          distanceM,
          kcal: Math.round(durationS * 0.17),
          avgHr: 146 + Math.floor(r() * 10),
          maxHr: 168 + Math.floor(r() * 10),
          zones: { rest: zone(0.02), fat_burn: zone(0.12), cardio: zone(0.52), peak: zone(0.3), max: zone(0.04) },
          steps: Math.round(distanceM * 1.3),
          route: { polyline: encodePolyline(loop), points: loop.length },
          updatedAt: isoLocal(startMs + durationS * 1000 + 2 * MIN),
          ...(v2 ? { pauses: [], kcalMethod: 'gauge-met/1', energyBasis: 'gross' as const, zonesVersion: 'gauge-220-age-5min' } : {}),
        });
      }
    } else if ((i + 1) % 3 === 1) {
      const startMs = midnight(date) + (17 * 60 + 40) * MIN;
      const durationS = 1500 + Math.floor(r() * 900);
      if (startMs + durationS * 1000 <= now)
        out.push({
          id: `walk-${date}`,
          date,
          start: isoLocal(startMs),
          end: isoLocal(startMs + durationS * 1000),
          type: 'walk',
          source: 'gauge',
          durationS,
          distanceM: Math.round(durationS * 1.35),
          kcal: Math.round(durationS * 0.07),
          avgHr: 104 + Math.floor(r() * 8),
          maxHr: 121 + Math.floor(r() * 8),
          zones: { rest: Math.round(durationS * 0.3), fat_burn: Math.round(durationS * 0.6), cardio: Math.round(durationS * 0.1), peak: 0, max: 0 },
          steps: Math.round(durationS * 1.8),
          route: null,
          updatedAt: isoLocal(startMs + durationS * 1000 + 2 * MIN),
          ...(v2 ? { pauses: [], kcalMethod: 'gauge-met/1', energyBasis: 'gross' as const, zonesVersion: 'gauge-220-age-5min' } : {}),
        });
    }
    return out;
  }

  function workouts(from: string, to: string): GaugeWorkouts {
    const f = when(from, 'start');
    const t = when(to, 'end');
    const sessions = days(localDay(f), localDay(t))
      .flatMap(workoutsOn)
      .filter((w) => Date.parse(w.start) >= f && Date.parse(w.start) <= t);
    const sum = (g: (w: GaugeWorkout) => number | null) => sessions.reduce((a, w) => a + (g(w) ?? 0), 0);
    return {
      from: isoLocal(f),
      to: isoLocal(t),
      units: { durationS: 's (moving time)', distanceM: 'm', kcal: 'kcal (device estimate)', avgHr: 'bpm', maxHr: 'bpm', zones: 's per heart-rate zone', steps: 'steps' },
      sessions,
      totals: { count: sessions.length, durationS: sum((w) => w.durationS), distanceM: sum((w) => w.distanceM), kcal: sum((w) => w.kcal) },
      ...prov(sessions.length ? Date.parse(sessions.at(-1)!.end) : null),
    };
  }

  // --- scores: one per day from the phone's insight engine (legacy `insights/*`)
  const SCORE_KEYS = ['recovery_score', 'sleep_score', 'activity_score', 'workout_score', 'hrv_balance', 'resting_load', 'workout_load', 'vo2max_estimate'];
  function scoreOn(key: string, date: string): GaugeScoreEntry | null {
    if (!inRange(date)) return null;
    const i = dayIndex(date);
    const r = rng(`score:${key}:${date}`);
    if ((key === 'workout_score' || key === 'workout_load') && workoutsOn(date).length === 0) return null;
    if (key === 'activity_score' && date === today) return null;
    const base: Record<string, number> = { recovery_score: 72, sleep_score: 78, activity_score: 68, workout_score: 61, hrv_balance: 50, resting_load: 48, workout_load: 96, vo2max_estimate: 44 };
    const swing = key === 'vo2max_estimate' ? 0.6 : key === 'workout_load' ? 30 : 9;
    const v = base[key]! + swing * Math.sin(i / 6 + key.length) + (r() - 0.5) * swing;
    const unit = key === 'vo2max_estimate' ? 'mL/kg/min' : key === 'workout_load' ? 'AU' : 'score';
    return {
      date,
      scopeStart: isoLocal(midnight(date)),
      value: key === 'vo2max_estimate' ? r1(v) : key === 'workout_load' ? Math.round(v) : Math.round(Math.max(0, Math.min(100, v))),
      unit,
      confidence: r() > 0.25 ? 'medium' : 'low',
      algorithmVersion: `lumen-${key}-v1`,
      note: null,
      inputs: key === 'sleep_score' ? { duration_min: 412, efficiency_percent: 91 } : null,
    };
  }

  function scores(from: string, to: string, key?: string): GaugeScores {
    const f = localDay(when(from, 'start'));
    const t = localDay(when(to, 'end'));
    const out: Record<string, GaugeScoreEntry[]> = {};
    for (const k of key ? [key] : SCORE_KEYS)
      for (const d of days(f, t)) {
        const e = scoreOn(k, d);
        if (e) (out[k] ??= []).push(e);
      }
    return { from: isoLocal(when(from, 'start')), to: isoLocal(when(to, 'end')), units: { value: 'see each entry\'s unit ("score" is 0–100)' }, scores: out, ...prov(now - 30 * MIN) };
  }

  // --- short videos: counts per app against a limit of 30
  function shortVideoOn(date: string): GaugeShortVideoDay | null {
    if (!inRange(date)) return null;
    const r = rng(`sv:${date}`);
    const scale = date === today ? Math.min(1, (now - midnight(date)) / DAY) * 1.4 : 1;
    const instagram = Math.round((8 + r() * 22) * scale);
    const youtube = Math.round((3 + r() * 12) * scale);
    const total = instagram + youtube;
    return { date, counts: { instagram, youtube }, total, limit: 30, limitHits: total >= 30 ? 1 : 0, cancels: total >= 30 && r() > 0.5 ? 1 : 0 };
  }

  function shortVideo(from: string, to: string): GaugeShortVideo {
    const f = localDay(when(from, 'start'));
    const t = localDay(when(to, 'end'));
    const list = days(f, t)
      .map(shortVideoOn)
      .filter((d): d is GaugeShortVideoDay => !!d);
    const avg = (n: number) => {
      const xs = days(addDays(t, -(n - 1)), t)
        .map(shortVideoOn)
        .filter((d): d is GaugeShortVideoDay => !!d);
      const mean = (g: (d: GaugeShortVideoDay) => number) => (xs.length ? r1(xs.reduce((a, d) => a + g(d), 0) / xs.length) : null);
      return {
        from: addDays(t, -(n - 1)),
        to: t,
        daysWithData: xs.length,
        total: mean((d) => d.total),
        counts: { instagram: mean((d) => d.counts.instagram ?? 0), youtube: mean((d) => d.counts.youtube ?? 0) },
        limitHits: mean((d) => d.limitHits ?? 0),
        cancels: mean((d) => d.cancels ?? 0),
      };
    };
    return { from: f, to: t, units: { counts: 'videos per day' }, days: list, averages: { last7Days: avg(7), last30Days: avg(30) }, ...prov(uploadMs) };
  }

  // --- the day summary, with S2's `derived` block and the median reading gaps
  function derivedOn(date: string): GaugeDayDerived {
    const ts = times('hr', midnight(date), midnight(addDays(date, 1)) - 1);
    const ws = workoutsOn(date);
    const inWorkout = (t: number) => ws.some((w) => t >= Date.parse(w.start) && t <= Date.parse(w.end));
    const asleep = (t: number) => {
      const n = nightAt(t);
      return !!n && t >= n.onsetMs && t < n.wakeMs;
    };
    const vals = ts.map((t) => ({ t, v: value('hr', t) }));
    const peak = vals.reduce<{ t: number; v: number } | null>((a, x) => (!a || x.v > a.v ? x : a), null);
    const idle = vals.filter((x) => !inWorkout(x.t) && !asleep(x.t) && new Date(x.t).getHours() >= 9).map((x) => x.v);
    const wsHr = ws.filter((w) => w.avgHr);
    const wsS = wsHr.reduce((a, w) => a + w.durationS, 0);
    return {
      version: 'day-metrics/1',
      peakHr: peak ? { bpm: peak.v, at: isoLocal(peak.t), source: inWorkout(peak.t) ? 'workout' : 'ring', lowerBound: !inWorkout(peak.t) } : null,
      nonExerciseHr: idle.length >= 5 ? { median: Math.round(pct(idle, 0.5)!), n: idle.length } : null,
      avgWorkoutHr: wsS ? { bpm: Math.round(wsHr.reduce((a, w) => a + w.avgHr! * w.durationS, 0) / wsS), workoutS: wsS } : null,
    };
  }

  function daily(date: string): GaugeDaily {
    const a = activityDay(date);
    const s = night(date)?.session ?? null;
    const sc: Record<string, GaugeScoreEntry> = {};
    for (const k of SCORE_KEYS) {
      const e = scoreOn(k, date);
      if (e) sc[k] = e;
    }
    const metrics: NonNullable<GaugeDaily['metrics']> = {};
    if (inRange(date))
      for (const kind of KINDS) {
        const ts = times(kind, midnight(date), midnight(addDays(date, 1)) - 1);
        if (!ts.length) continue;
        const lastT = ts.at(-1)!;
        const xs = ts.map((t) => value(kind, t));
        const st = stats(xs)!;
        const gaps = ts.slice(1).map((t, i) => (t - ts[i]!) / 1000);
        metrics[kind] = {
          unit: UNITS[kind] ?? null,
          count: st.count,
          mean: st.mean,
          min: st.min,
          max: st.max,
          latest: { at: isoLocal(lastT), value: xs.at(-1)! },
          ...(v2 && ts.length >= 3 ? { medianGapS: pct(gaps, 0.5) } : {}),
        };
      }
    return {
      date,
      from: isoLocal(midnight(date)),
      to: isoLocal(midnight(addDays(date, 1))),
      activity: a?.day ?? null,
      sleep: s ? [s] : [],
      scores: sc,
      metrics,
      ...(v2 && inRange(date) ? { derived: derivedOn(date) } : {}),
      ...prov(inRange(date) ? Math.min(now - 2 * MIN, midnight(addDays(date, 1)) - 1) : null),
    };
  }

  // --- S2: baselines (excluding that night), the minute timeline, fused steps

  const clockMin = (ms: number) => {
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  };
  const circular = (mins: number[]): GaugeClockBaseline | null => {
    if (!mins.length) return null;
    const a = mins.map((m) => (m / 1440) * 2 * Math.PI);
    const c = a.reduce((x, y) => x + Math.cos(y), 0) / a.length;
    const sn = a.reduce((x, y) => x + Math.sin(y), 0) / a.length;
    const Rbar = Math.hypot(c, sn);
    const minutes = ((((Math.atan2(sn, c) / (2 * Math.PI)) * 1440) % 1440) + 1440) % 1440;
    const ok = mins.length >= 7 && Rbar >= 0.3;
    return { minutes: ok ? Math.round(minutes) : null, Rbar: Math.round(Rbar * 1000) / 1000, n: mins.length, ...(ok ? {} : { suppressed: true }) };
  };
  const scale = (xs: number[], floor: number) => Math.max(floor, ((pct(xs, 0.75) ?? 0) - (pct(xs, 0.25) ?? 0)) / 1.349);

  function baselines(date: string): GaugeBaselines {
    const prior = days(addDays(date, -28), addDays(date, -1))
      .map((d) => night(d))
      .filter((n): n is Night => !!n && (n.session.metrics?.tstLowerMin ?? n.session.asleepMinutes) >= 180);
    const n14 = prior.slice(-14);
    const lows = n14.map((n) => n.session.metrics?.nightlyLowHrP10).filter((v): v is number => typeof v === 'number');
    const lnHrv = prior.map((n) => Math.log(n.hrvMs));
    const temps = prior.map((n) => n.tempC);
    const span = (xs: Night[]) => (xs.length ? Math.round((xs.at(-1)!.wakeMs - xs[0]!.wakeMs) / DAY) + 1 : 0);
    const tonight = night(date);
    const tMed = pct(temps, 0.5);
    const learning = prior.length < 7;
    return {
      date,
      usualOnset: circular(prior.map((n) => clockMin(n.onsetMs))),
      usualWake: circular(prior.map((n) => clockMin(n.wakeMs))),
      usualMidpoint: circular(prior.map((n) => clockMin(n.onsetMs + (n.wakeMs - n.onsetMs) / 2))),
      sleepLowHr: lows.length ? { median: pct(lows, 0.5)!, s: r1(scale(lows, 3)), n: lows.length, spanDays: span(n14) } : null,
      hrvBaseline: lnHrv.length ? { median: pct(lnHrv, 0.5)!, s: Math.round(scale(lnHrv, 0.05) * 1000) / 1000, medianMs: Math.round(Math.exp(pct(lnHrv, 0.5)!)), n: lnHrv.length, spanDays: span(prior) } : null,
      tempBaseline: tMed !== null ? { median: r1(tMed), n: temps.length, spanDays: span(prior), deltaT: tonight ? r1(tonight.tempC - tMed) : null } : null,
      sampledIdleHr: (() => {
        const d = derivedOn(addDays(date, -1)).nonExerciseHr;
        return d ? { median: d.median, n: d.n } : null;
      })(),
      learning: { nights: prior.length, needed: 7, learning },
      ...prov(uploadMs),
    };
  }

  function timeline(date: string): GaugeTimeline {
    const start = midnight(date);
    const minutes = Math.round((midnight(addDays(date, 1)) - start) / MIN);
    const bpm: Array<number | null> = Array(minutes).fill(null);
    const supportedS: Array<number | null> = Array(minutes).fill(null);
    for (const t of times('hr', start, start + minutes * MIN - 1)) {
      const k = Math.floor((t - start) / MIN);
      bpm[k] = value('hr', t);
      supportedS[k] = 60;
    }
    const stage: GaugeTimeline['sleep']['stage'] = Array(minutes).fill(null);
    for (const d of [date, addDays(date, 1)]) {
      const n = night(d);
      if (!n) continue;
      for (const b of n.session.blocks) {
        const b0 = Date.parse(b.start);
        for (let k = 0; k < b.minutes; k++) {
          const i = Math.floor((b0 + k * MIN - start) / MIN);
          if (i >= 0 && i < minutes) stage[i] = b.stage as NonNullable<GaugeTimeline['sleep']['stage'][number]>;
        }
      }
    }
    // (r068 B1) the minute lanes add up to the day's own totals: every hour's steps spread exactly over its minutes, the
    // workouts' steps over their minutes, and the phone's trolley minutes (the ring saw nothing then) in the phone lane
    const ring: Array<number | null> = Array(minutes).fill(null);
    const phone: Array<number | null> = Array(minutes).fill(null);
    const spread = (lane: Array<number | null>, k0: number, n: number, total: number) => {
      const each = Math.floor(total / n);
      let rest = total - each * n;
      for (let k = 0; k < n; k++) {
        const i = k0 + k;
        if (i < 0 || i >= minutes) continue;
        lane[i] = (lane[i] ?? 0) + each + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
      }
    };
    for (const h of activityDay(date)?.hourly ?? []) spread(ring, Math.floor((Date.parse(h.start) - start) / MIN), 60, h.steps);
    for (const w of workoutsOn(date)) {
      const k0 = Math.floor((Date.parse(w.start) - start) / MIN);
      const n = Math.max(1, Math.round((Date.parse(w.end) - Date.parse(w.start)) / MIN));
      if (w.steps) spread(ring, k0, n, w.steps);
    }
    const extra = phoneExtra(date);
    if (extra > 0) {
      const t0 = Math.floor((midnight(date) + TROLLEY_H * HOUR - start) / MIN);
      // the ring's own steps in those minutes move to the minutes after (its hour total stays), the phone fills the gap
      let moved = 0;
      for (let k = 0; k < 30; k++) {
        moved += ring[t0 + k] ?? 0;
        ring[t0 + k] = null;
      }
      if (moved) spread(ring, t0 + 30, 30, moved);
      spread(phone, t0, 30, extra);
    }
    const selected = ring.map((v, i) => v ?? phone[i] ?? null);
    const source = ring.map((v, i) => (v !== null ? 'ring' : phone[i] !== null ? 'phone' : null));
    return {
      date,
      tz,
      start: new Date(start).toISOString(),
      minutes,
      steps: { selected, source, ring, phone, support: selected.map((v) => (v === null ? null : 'minute' as const)) },
      hr: { bpm, supportedS },
      sleep: { stage },
      sessions: workoutsOn(date).map((w) => ({ id: w.id, start: w.start, end: w.end, type: w.type, source: w.source })),
      hcExercise: [],
      acquisition: { ring: [], phone: [] },
      ...prov(uploadMs),
    };
  }

  function steps(from: string, to: string): GaugeSteps {
    const f = localDay(when(from, 'start'));
    const t = localDay(when(to, 'end'));
    const list: GaugeStepDay[] = days(f, t).flatMap((d) => {
      const a = activityDay(d);
      if (!a || a.day.steps === null) return [];
      const located = fusedOf(d, a.day.steps);
      return [{ date: d, located, ringDailyTotal: a.day.steps, ringResidual: 0, phoneDailyTotal: located - a.day.steps, headline: located, headlinePolicy: 'located' as const, resolved: true, coverage: { ringMin: 900, phoneMin: 760, eitherMin: 960, unknownMin: 480 } }];
    });
    return { fusionVersion: 'steps-fuse/1', intervals: [], days: list, ...prov(uploadMs) };
  }

  function device(): GaugeDeviceState {
    const at = isoLocal(uploadMs);
    return {
      units: { 'battery.percent': '%' },
      devices: [
        {
          installationId: 'gauge-1',
          deviceName: 'Pixel 8',
          state: {
            battery: { percent: 64, event: 'health.device.battery.updated', at },
            connection: { state: 'connected', device_type: 'colmi_r02', firmware: 'V138', event: 'health.device.connection.updated', at },
            firmware: { version: 'V138', event: 'health.device.firmware.updated', at },
            sync: { stage: 'idle', event: 'health.sync.progress', at },
          },
        },
      ],
      ...prov(uploadMs),
    };
  }

  function availability(): GaugeAvailability {
    return {
      categories: [
        { category: 'metrics/hr', count: 40_000, firstReadingAt: isoLocal(midnight(first)), lastReadingAt: isoLocal(now - 2 * MIN), readWith: 'gauge_metric_series' },
        { category: 'sleep/timeline', count: 400, firstReadingAt: isoLocal(midnight(first)), lastReadingAt: isoLocal(now - 2 * HOUR), readWith: 'gauge_sleep' },
      ],
      metricKinds: ['hr', 'hrv', 'spo2', 'stress', 'temp'],
      shortVideoDays: 400,
      workoutSessions: 260,
      deletions: 0,
      ...prov(now - 2 * MIN),
    };
  }

  const api: GaugeApi = {
    status: () => ({ lastOkAt: isoLocal(now), problem: null }),
    subscribe: () => () => undefined,
    clearCache: () => undefined,
    availability: async () => availability(),
    series: async (q) => series(q),
    daily: async (d) => daily(d),
    sleep: async (f, t) => sleep(f, t),
    activity: async (f, t) => activity(f, t),
    scores: async (f, t, k) => scores(f, t, k),
    device: async () => device(),
    shortVideo: async (f, t) => shortVideo(f, t),
    workouts: async (f, t) => workouts(f, t),
  };
  if (!v2) return api;
  return {
    ...api,
    steps: async (f, t) => steps(f, t),
    timeline: async (d) => timeline(d),
    baselines: async (d) => baselines(d),
    hc: async (type, f, t) => ({ type, from: f, to: t, records: [], ...prov(uploadMs) }),
  };
}

/** The p-quantile (linear) of the values, null when empty. */
function pct(values: readonly number[], p: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const i = (xs.length - 1) * p;
  const lo = Math.floor(i);
  return xs[lo]! + (xs[Math.ceil(i)]! - xs[lo]!) * (i - lo);
}

let demo: GaugeApi | null = null;
/** The development demo client (one per tab). */
export function demoGaugeApi(): GaugeApi {
  const texture = typeof window !== 'undefined' && (window as { __VITALS_GAUGE_DEMO_TEXTURE__?: string }).__VITALS_GAUGE_DEMO_TEXTURE__ === 'raw' ? 'raw' : 'clean';
  return (demo ??= makeGaugeFixture({ texture }));
}
