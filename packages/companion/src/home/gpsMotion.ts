/**
 * (0.6.3 FX5, cross-verification M18) Gauge's own motion evidence for the activity estimators and detectors:
 *
 * - `gpsSpeedMinutes`: each Gauge workout's route-derived moving speed per minute of a day grid, from its accepted GPS
 *   points (`activity/gps`, chunk subject `<session id>:<n>`). Two consecutive accepted points no more than
 *   `GPS_MAX_GAP_S` apart, each within `GPS_MAX_ACC_M`, make a segment; its great-circle distance and time are spread
 *   over the minutes it covers, inside the workout's window and outside its pauses. A minute with at least
 *   `GPS_MIN_COVER_S` seconds of segments gets distance ÷ time; it is `accepted` (a measurement) when that speed is at most
 *   `GPS_MAX_MPS`. A `gauge_gps` workout whose points give no minute (none arrived, or too sparse) but which carries
 *   Gauge's route distance and moving time gets that session mean on each of its moving minutes (`method: 'sessionMean'`): walking and running energy are
 *   linear in speed, so the mean stands for the session. Nothing here decides eligibility: the estimator checks coverage
 *   (`measuredMinCoverage`) and the activity type (outdoor cycling never reads speed, energy SPEC V2.4(3)).
 * - `sportWindows`: the ring's sport telemetry (`activity/sport_telemetry`, ~10 s points) cut into windows at gaps over
 *   `SPORT_GAP_MS`, at least `SPORT_MIN_MS` long, each with the Gauge workout it belongs to (≥ half of the shorter one
 *   overlaps) so the importer never offers the same session twice.
 *
 * Every read is windowed (`intervalsAll`) and every expanded GPS point counts in the call's row budget. Pure apart from
 * the store reads; product defaults throughout (P).
 */
import { chargeReadBudget, intervalsAll, type Inputs, type Workout } from './gaugeDerive.ts';
import { instantMs, type LumenStore } from './lumenStore.ts';

const MIN = 60_000;
/** The version of these derivations (in the route's `inputsHash`). */
export const GPS_MOTION_VERSION = 'gps-motion/1';
/** (P) A point less accurate than this (m, the fix's reported accuracy) is not used. */
export const GPS_MAX_ACC_M = 25;
/** (P) Two accepted points further apart than this (s) are a gap, not a segment. */
export const GPS_MAX_GAP_S = 30;
/** (P) A minute needs this many seconds of segments for a speed. */
export const GPS_MIN_COVER_S = 30;
/** (P) Above this (m/s) a minute's speed is kept as shown evidence, never as an accepted measurement. */
export const GPS_MAX_MPS = 12;
/** (P) Ring sport telemetry further apart than this splits a window. */
export const SPORT_GAP_MS = 2 * MIN;
/** (P) A shorter sport window is not offered. */
export const SPORT_MIN_MS = 5 * MIN;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GpsSpeedEvidence {
  source: 'gauge_gps';
  session: string;
  type: string | null;
  method: 'route' | 'sessionMean';
  minutes: number;
  accepted: number;
  points?: number;
  pointsUsed?: number;
}

export interface GpsSpeedMinutes {
  /** Per minute of the grid, m/s; null where no workout's route gives one. */
  speedMps: Array<number | null>;
  /** Per minute: a measurement (enough segments, in range). */
  accepted: boolean[];
  /** Per minute: the workout id the speed came from. */
  session: Array<string | null>;
  evidence: GpsSpeedEvidence[];
}

const pausesOf = (w: Workout): Array<{ s: number; e: number }> =>
  (Array.isArray(w.data.pauses) ? w.data.pauses : []).flatMap((p) => {
    const s = isObj(p) ? instantMs(p.start) : null;
    const e = isObj(p) ? instantMs(p.end) : null;
    return s !== null && e !== null && e > s ? [{ s, e }] : [];
  });

/** `[a, b)` minus the pauses, as parts. */
function movingParts(a: number, b: number, pauses: ReadonlyArray<{ s: number; e: number }>): Array<[number, number]> {
  let parts: Array<[number, number]> = [[a, b]];
  for (const p of pauses) parts = parts.flatMap(([x, y]) => (p.e <= x || p.s >= y ? [[x, y] as [number, number]] : [...(p.s > x ? [[x, p.s] as [number, number]] : []), ...(p.e < y ? [[p.e, y] as [number, number]] : [])]));
  return parts;
}

/**
 * The route-derived moving speed per minute of `[startMs, startMs + n·60 s)` from the given workouts' GPS points (one
 * workout per minute: the earliest-starting one with a value there). Empty (every minute null) without GPS.
 */
export function gpsSpeedMinutes(store: LumenStore, workouts: readonly Workout[], startMs: number, n: number, inputs: Inputs): GpsSpeedMinutes {
  const speedMps: Array<number | null> = new Array(n).fill(null);
  const accepted: boolean[] = new Array(n).fill(false);
  const session: Array<string | null> = new Array(n).fill(null);
  const evidence: GpsSpeedEvidence[] = [];
  const endMs = startMs + n * MIN;
  const ws = [...workouts].filter((w) => w.endMs > startMs && w.startMs < endMs).sort((a, b) => a.startMs - b.startMs || a.sessionId.localeCompare(b.sessionId));
  if (!ws.length || !(n > 0)) return { speedMps, accepted, session, evidence };
  const lo = Math.min(...ws.map((w) => w.startMs));
  const hi = Math.max(...ws.map((w) => w.endMs));
  // the GPS chunks inside the workouts' span only (windowed), each point charged to the budget
  const chunks = intervalsAll(store, 'activity/gps', lo, hi);
  const bySession = new Map<string, Array<{ t: number; lat: number; lon: number; ok: boolean }>>();
  const ids = new Set(ws.map((w) => w.sessionId));
  for (const c of chunks) {
    const k = c.subject.lastIndexOf(':');
    const sid = k > 0 ? c.subject.slice(0, k) : c.subject;
    if (!ids.has(sid)) continue;
    const pts = Array.isArray(c.data.points) ? c.data.points : [];
    chargeReadBudget(pts.length);
    inputs.add(c.id);
    const list = bySession.get(sid) ?? [];
    for (const p of pts) {
      if (!isObj(p)) continue;
      const t = instantMs(p.t);
      const lat = num(p.lat);
      const lon = num(p.lon);
      if (t === null || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const acc = num(p.acc);
      list.push({ t, lat, lon, ok: p.accepted !== false && acc !== null && acc >= 0 && acc <= GPS_MAX_ACC_M });
    }
    bySession.set(sid, list);
  }
  for (const w of ws) {
    const pauses = pausesOf(w);
    const raw = bySession.get(w.sessionId) ?? [];
    const dist: number[] = new Array(n).fill(0);
    const time: number[] = new Array(n).fill(0);
    let used = 0;
    if (raw.length) {
      // one point per instant (a re-sent chunk), the accepted fixes in time order
      const seen = new Set<number>();
      const pts = raw.filter((p) => p.ok).sort((a, b) => a.t - b.t).filter((p) => (seen.has(p.t) ? false : (seen.add(p.t), true)));
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const dt = (b.t - a.t) / 1000;
        if (!(dt > 0) || dt > GPS_MAX_GAP_S) continue;
        const d = haversineM(a, b);
        used++;
        // the segment's part inside the workout and outside its pauses, spread over its minutes by time
        for (const [x, y] of movingParts(Math.max(a.t, w.startMs, startMs), Math.min(b.t, w.endMs, endMs), pauses)) {
          for (let m = Math.floor((x - startMs) / MIN); m < n && startMs + m * MIN < y; m++) {
            const s = Math.max(x, startMs + m * MIN);
            const e = Math.min(y, startMs + (m + 1) * MIN);
            if (!(e > s) || m < 0) continue;
            const share = (e - s) / 1000 / dt;
            dist[m]! += d * share;
            time[m]! += (e - s) / 1000;
          }
        }
      }
    }
    let minutes = 0;
    let ok = 0;
    for (let m = 0; m < n; m++) {
      if (session[m] !== null || time[m]! < GPS_MIN_COVER_S) continue;
      const v = Math.round((dist[m]! / time[m]!) * 100) / 100;
      speedMps[m] = v;
      session[m] = w.sessionId;
      accepted[m] = v <= GPS_MAX_MPS;
      minutes++;
      if (accepted[m]) ok++;
    }
    const type = typeof w.data.type === 'string' ? w.data.type : null;
    if (minutes > 0) {
      evidence.push({ source: 'gauge_gps', session: w.sessionId, type, method: 'route', minutes, accepted: ok, points: raw.length, pointsUsed: used });
      continue;
    }
    // no per-minute route (no points, or fixes too sparse for segments): a GPS-recorded workout's own route distance over
    // its moving time, on each moving minute; never when every uploaded fix was rejected (the distance rests on them)
    const distanceM = num(w.data.distanceM);
    const movingS = num(w.data.moving_s) ?? num(w.data.durationS);
    if (raw.length > 0 && raw.filter((p) => p.ok).length < 2) continue;
    if (w.data.source !== 'gauge_gps' || distanceM === null || !(distanceM > 0) || movingS === null || !(movingS > 0)) continue;
    const mean = Math.round((distanceM / movingS) * 100) / 100;
    for (const [x, y] of movingParts(Math.max(w.startMs, startMs), Math.min(w.endMs, endMs), pauses)) {
      for (let m = Math.max(0, Math.floor((x - startMs) / MIN)); m < n && startMs + m * MIN < y; m++) {
        const s = Math.max(x, startMs + m * MIN);
        const e = Math.min(y, startMs + (m + 1) * MIN);
        if (session[m] !== null || (e - s) / 1000 < GPS_MIN_COVER_S) continue;
        speedMps[m] = mean;
        session[m] = w.sessionId;
        accepted[m] = mean <= GPS_MAX_MPS;
        minutes++;
        if (accepted[m]) ok++;
      }
    }
    if (minutes > 0) evidence.push({ source: 'gauge_gps', session: w.sessionId, type, method: 'sessionMean', minutes, accepted: ok });
  }
  return { speedMps, accepted, session, evidence };
}

export interface SportWindow {
  /** `sport:<first point ms>` (stable while no earlier point arrives). */
  id: string;
  /** `<last point ms>|<points>`: changes when the window grows. */
  revision: string;
  startMs: number;
  endMs: number;
  points: number;
  /** The Gauge workout the window belongs to (≥ half of the shorter overlaps), else null. */
  workoutId: string | null;
  installationId: string;
}

/** The ring's sport telemetry of `[fromMs, toMs)` as windows (gaps over `SPORT_GAP_MS` split; shorter than `SPORT_MIN_MS` dropped). */
export function sportWindows(store: LumenStore, fromMs: number, toMs: number, workouts: readonly Workout[], inputs: Inputs): SportWindow[] {
  const rows = intervalsAll(store, 'activity/sport_telemetry', fromMs, toMs);
  inputs.addAll(rows);
  const byInstall = new Map<string, number[]>();
  for (const r of rows) {
    const list = byInstall.get(r.installationId) ?? [];
    list.push(r.startMs);
    byInstall.set(r.installationId, list);
  }
  const out: SportWindow[] = [];
  for (const [installationId, ts] of byInstall) {
    const t = [...new Set(ts)].sort((a, b) => a - b);
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const startMs = run[0]!;
        // the last point stands for its own sample interval (the window's median gap, at most a minute)
        const gaps = run.slice(1).map((x, i) => x - run[i]!).sort((a, b) => a - b);
        const endMs = run.at(-1)! + Math.min(MIN, gaps[Math.floor(gaps.length / 2)]!);
        if (endMs - startMs >= SPORT_MIN_MS) {
          const own = workouts.find((w) => {
            const ov = Math.min(w.endMs, endMs) - Math.max(w.startMs, startMs);
            return ov > 0 && ov >= 0.5 * Math.min(w.endMs - w.startMs, endMs - startMs);
          });
          out.push({ id: `sport:${startMs}`, revision: `${run.at(-1)!}|${run.length}`, startMs, endMs, points: run.length, workoutId: own?.sessionId ?? null, installationId });
        }
      }
      run = [];
    };
    for (const x of t) {
      if (run.length && x - run.at(-1)! > SPORT_GAP_MS) flush();
      run.push(x);
    }
    flush();
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}
