/**
 * The minute evidence `detect/2` reads (`./detect.ts`), built from the store's existing views over one bounded UTC window
 * `[loMs, hiMs)` (r065 autodetect CONTRACT §2). Every read is windowed and counts in the caller's row budget
 * (`withReadBudget`, `./job.ts`).
 *
 * - Steps: the same evidence and fusion as `gauge_steps` (`stepEvidence`, `fuseSteps` with the phone's observed-zero
 *   windows), without the person's activity context: a pending detection must never feed back into the selection that
 *   detects it. Each lineage's own track gives the minute counts: a minute record is `counted`, a fused observed zero
 *   (a listening window, its step detector registered, no record; Gauge's open-interval checkpoint counts up to its
 *   `to`) is `zero`, a coarse record (a counter span, the ring's ten-minute fallback) is `coarse`, nothing is
 *   `unknown`. The fused selection is reported beside them.
 * - HR: Gauge's readings with their declared cadence (`hr-support/1`, cut at workout edges), Health Connect's only in
 *   minutes Gauge has none; the sampled mean apart.
 * - Sleep: the ring's (or Health Connect's) stage per minute; asleep stages true, awake false.
 * - Activity recognition: the transitions and acquisition intervals (`./detect.ts` `arStateMinutes`). Gauge uploads a
 *   recognition interval only once it closes (at the UTC hour at the latest), so the newest closed `listening` interval
 *   of a registration is carried on (to the next hour, never past now) while no other interval follows it.
 * - GPS: Gauge's accepted route speed inside its workouts, and each minute's mean accurate fix (stationary test).
 * - Recordings: Gauge workouts (`gauge:<session>`) and Health Connect exercise sessions (`hc:<id>`) overlapping.
 */
import { stepEvidence, intervalsAll, metricSamples, hcStreams, sleepRead, workoutsOverlapping, Inputs, chargeReadBudget, type Workout } from '../gaugeDerive.ts';
import { gpsSpeedMinutes, GPS_MAX_ACC_M } from '../gpsMotion.ts';
import { minuteMeans, supportSegments } from '../hrSupport.ts';
import { instantMs, type LumenStore } from '../lumenStore.ts';
import { fuseSteps } from '../stepFusion.ts';
import { AR_ACTIVITIES, arStateMinutes, type ArActivity, type ArInterval, type ArTransition, type DetectInput, type MinuteEvidence } from './detect.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** How far before the window recognition events are read (the state an earlier ENTER set). */
export const AR_LOOKBACK_MS = 6 * HOUR;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isMinute = (r: { startMs: number; endMs: number; support: string }) =>
  r.support === 'minute' && r.endMs - r.startMs <= MIN && Math.floor(r.startMs / MIN) === Math.floor((r.endMs - 1) / MIN);

function cutsOf(ws: readonly Workout[]): number[] {
  return ws.flatMap((w) => [w.startMs, w.endMs, ...(Array.isArray(w.data.pauses) ? w.data.pauses.flatMap((p) => (isObj(p) ? [instantMs(p.start), instantMs(p.end)].filter((x): x is number => x !== null) : [])) : [])]);
}

const ASLEEP = new Set(['deep', 'light', 'rem', 'asleepUnspecified']);

/** (r069, P) The app's session blocks (`hcBlocks` in `src/living/sensors/activityDetect.ts`): the same rule, the same values. */
export const HC_BLOCK_GAP_MIN = 10;
export const HC_NEAR_ZERO_STEPS = 20;
export const HC_MIN_BLOCK_MIN = 5;
const HC_GAIT = new Set([37, 56, 57, 79]);

/**
 * (r069) The separate activities inside one Health Connect exercise session (its `payload.segments`, else its steps), or []
 * when it is one: a gap of `HC_BLOCK_GAP_MIN` or more with no segment ends a block unless a known minute above
 * `HC_NEAR_ZERO_STEPS` says the person kept walking (gait sessions); without segments, an interior run of near-zero minutes
 * between walking splits a gait session. Blocks shorter than `HC_MIN_BLOCK_MIN` are dropped.
 */
export function hcSessionBlocks(startMs: number, endMs: number, data: Record<string, unknown>, stepAt: (minuteMs: number) => number | null): Array<{ start: number; end: number }> {
  const p = isObj(data.payload) ? data.payload : {};
  const code = num(p.exercise_type_code) ?? num(p.exercise_type);
  const gait = code !== null && HC_GAIT.has(code);
  const quiet = (a: number, b: number): boolean => {
    if (!gait) return true;
    for (let t = Math.ceil(a / MIN) * MIN; t + MIN <= b; t += MIN) {
      const v = stepAt(t);
      if (v !== null && v > HC_NEAR_ZERO_STEPS) return false;
    }
    return true;
  };
  const gap = HC_BLOCK_GAP_MIN * MIN;
  const segs = (Array.isArray(p.segments) ? p.segments : [])
    .flatMap((g) => {
      const a = isObj(g) ? instantMs(g.start) : null;
      const b = isObj(g) ? instantMs(g.end) : null;
      return a !== null && b !== null ? [{ start: Math.max(a, startMs), end: Math.min(b, endMs) }] : [];
    })
    .filter((g) => g.end > g.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: Array<{ start: number; end: number }> = [];
  if (segs.length > 0) {
    for (const g of segs) {
      const last = blocks.at(-1);
      if (last && (g.start - last.end < gap || !quiet(last.end, g.start))) last.end = Math.max(last.end, g.end);
      else blocks.push({ ...g });
    }
  } else if (gait) {
    let a = startMs;
    let run: number | null = null;
    let walked = false;
    for (let t = Math.ceil(startMs / MIN) * MIN; t + MIN <= endMs; t += MIN) {
      const v = stepAt(t);
      if (v !== null && v <= HC_NEAR_ZERO_STEPS) run ??= t;
      else if (v !== null) {
        if (run !== null && walked && t - run >= gap) {
          blocks.push({ start: a, end: run });
          a = t;
        }
        run = null;
        walked = true;
      }
    }
    if (blocks.length > 0) blocks.push({ start: a, end: endMs });
  }
  const kept = blocks.filter((b) => b.end - b.start >= HC_MIN_BLOCK_MIN * MIN);
  return kept.length >= 2 ? kept : [];
}

export interface DetectWindow {
  input: DetectInput;
  inputs: Inputs;
}

/** The detector's input for `[loMs, hiMs)` (minute-aligned). `tz` only groups Health Connect nights by waking day. */
export function detectionInput(store: LumenStore, loMs: number, hiMs: number, o: { tz: string; nowMs: number; profile?: DetectInput['profile'] }): DetectWindow {
  const lo = Math.floor(loMs / MIN) * MIN;
  const hi = Math.ceil(hiMs / MIN) * MIN;
  const n = Math.max(0, (hi - lo) / MIN);
  const inputs = new Inputs();
  const idx = (ms: number) => Math.floor((ms - lo) / MIN);
  const minutes: MinuteEvidence[] = Array.from({ length: n }, () => ({
    phone: null, phoneState: 'unknown', ring: null, ringState: 'unknown', fused: null, fusedLineage: null, hr: null, hrS: 0, hrSampled: null, sleep: null, ar: null, gpsMps: null, gpsPos: null,
  }));
  chargeReadBudget(n);
  const edges: NonNullable<DetectInput['edges']> = {};
  const edge = (k: keyof typeof edges, ms: number) => {
    edges[k] = Math.max(edges[k] ?? -Infinity, ms);
  };

  // steps: each lineage's own track
  const ev = stepEvidence(store, lo, hi, inputs);
  const fusion = fuseSteps(ev.records, { zeroWindows: ev.zeroWindows });
  const ringCoarse: Array<{ startMs: number; endMs: number; steps: number }> = [];
  for (const lineage of ['phone', 'ring'] as const) {
    for (const r of fusion.tracks.get(lineage) ?? []) {
      if (lineage === 'phone' && !r.synthetic) edge('phone', r.endMs);
      if (lineage === 'ring') edge('ring', r.endMs);
      if (!r.valid) continue;
      if (isMinute(r)) {
        const i = idx(r.startMs);
        if (i < 0 || i >= n) continue;
        const x = minutes[i]!;
        if (lineage === 'phone') {
          if (r.synthetic) {
            if (x.phoneState === 'unknown') x.phoneState = 'zero';
          } else {
            x.phone = (x.phoneState === 'counted' ? x.phone ?? 0 : 0) + r.steps;
            x.phoneState = 'counted';
          }
        } else {
          x.ring = (x.ringState === 'counted' ? x.ring ?? 0 : 0) + r.steps;
          x.ringState = 'counted';
        }
        continue;
      }
      if (lineage === 'ring') ringCoarse.push({ startMs: r.startMs, endMs: r.endMs, steps: r.steps });
      for (let i = Math.max(0, idx(r.startMs)); i < n && lo + i * MIN < r.endMs; i++) {
        const x = minutes[i]!;
        if (lineage === 'phone' && x.phoneState === 'unknown') x.phoneState = 'coarse';
        if (lineage === 'ring' && x.ringState === 'unknown') x.ringState = 'coarse';
      }
    }
  }
  for (const a of ev.phoneAcquisition) if (a.state === 'listening') edge('phone', a.endMs);
  for (const [t, v] of fusion.minuteSelected) {
    const i = idx(t);
    if (i >= 0 && i < n) {
      minutes[i]!.fused = v.steps;
      minutes[i]!.fusedLineage = v.lineage;
    }
  }

  // HR: Gauge's first, Health Connect's only where Gauge has no reading
  const ws = workoutsOverlapping(store, lo, hi, inputs);
  const cuts = cutsOf(ws);
  const hr = metricSamples(store, 'hr', lo - MIN, hi + MIN, inputs);
  const means = minuteMeans(supportSegments(hr, lo, hi, cuts), lo, n);
  const sums = Array.from({ length: n }, () => [0, 0] as [number, number]);
  for (const s of hr) {
    const i = idx(s.tMs);
    if (i >= 0 && i < n) {
      sums[i]![0] += s.value;
      sums[i]![1]++;
    }
    edge('hr', s.tMs);
  }
  for (let i = 0; i < n; i++) {
    const x = minutes[i]!;
    x.hr = means.bpm[i]!;
    x.hrS = means.supportedS[i]!;
    x.hrSampled = sums[i]![1] ? Math.round((sums[i]![0] / sums[i]![1]) * 10) / 10 : null;
  }
  for (const h of hcStreams(store, 'HeartRate', lo, hi, inputs, cuts).sort((a, b) => (a.source < b.source ? -1 : 1))) {
    const hm = minuteMeans(h.segments ?? [], lo, n);
    const hs = Array.from({ length: n }, () => [0, 0] as [number, number]);
    for (const r of h.readings) {
      const i = idx(r.tMs);
      if (i >= 0 && i < n) {
        hs[i]![0] += r.value;
        hs[i]![1]++;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = minutes[i]!;
      if (sums[i]![1] > 0 || x.hrS > 0 || x.hrSampled !== null) continue;
      if (!hm.supportedS[i] && !hs[i]![1]) continue;
      x.hr = hm.bpm[i]!;
      x.hrS = hm.supportedS[i]!;
      x.hrSampled = hs[i]![1] ? Math.round((hs[i]![0] / hs[i]![1]) * 10) / 10 : null;
    }
  }

  // sleep
  const sleep = sleepRead(store, o.tz, lo - DAY, hi, inputs).minutes;
  for (let i = 0; i < n; i++) {
    const st = sleep.get(lo + i * MIN);
    minutes[i]!.sleep = st === undefined || st === 'unknown' ? null : ASLEEP.has(st) ? true : st === 'awake' ? false : null;
  }

  // activity recognition
  const trRows = store.all<{ id: string; installation_id: string; activity: string; occurred_ms: number; transition: string; boot_id: unknown; elapsed_ns: unknown; registration_epoch: unknown }>(
    `SELECT id, installation_id, activity, occurred_ms, transition, boot_id, elapsed_ns, registration_epoch FROM activity_transitions WHERE occurred_ms >= ? AND occurred_ms < ? ORDER BY occurred_ms, id`,
    lo - AR_LOOKBACK_MS, hi);
  chargeReadBudget(trRows.length);
  const acq = intervalsAll(store, 'phone/activity_recognition_acquisition', lo - AR_LOOKBACK_MS, hi);
  inputs.addAll(trRows);
  inputs.addAll(acq);
  const installs = [...new Set([...trRows.map((r) => r.installation_id), ...acq.map((a) => a.installationId)])].sort();
  const arByInstall = installs.map((inst) => {
    const transitions: ArTransition[] = trRows.filter((r) => r.installation_id === inst && (AR_ACTIVITIES as readonly string[]).includes(r.activity) && (r.transition === 'ENTER' || r.transition === 'EXIT'))
      .map((r) => ({ occurredMs: r.occurred_ms, activity: r.activity as ArActivity, transition: r.transition as 'ENTER' | 'EXIT', bootId: String(r.boot_id ?? ''), elapsedNs: String(r.elapsed_ns ?? '0'), epoch: num(r.registration_epoch) }));
    const intervals: ArInterval[] = acq.filter((a) => a.installationId === inst && a.endMs !== null).map((a) => ({ startMs: a.startMs, endMs: a.endMs!, state: a.support ?? 'unknown', epoch: num(a.data.registration_epoch) }));
    // the still-open hour: Gauge uploads an interval once it closes, so the newest closed `listening` one carries on
    const newest = [...intervals].sort((a, b) => b.endMs - a.endMs)[0];
    if (newest && newest.state === 'listening') {
      const to = Math.min(o.nowMs, (Math.floor(newest.endMs / HOUR) + 1) * HOUR);
      const rolled = newest.endMs % HOUR === 0;
      const later = transitions.some((t) => t.occurredMs >= newest.endMs && t.epoch === newest.epoch);
      if (to > newest.endMs && (rolled || later)) intervals.push({ startMs: newest.endMs, endMs: to, state: 'listening', epoch: newest.epoch });
    }
    for (const x of intervals) if (x.state === 'listening') edge('ar', Math.min(x.endMs, o.nowMs));
    return arStateMinutes(transitions, intervals, lo, n);
  });
  for (let i = 0; i < n; i++) {
    // two installations: a known state wins over unknown; a disagreement is unknown
    const states = [...new Set(arByInstall.map((a) => a[i]).filter((x): x is ArActivity => x !== null))];
    minutes[i]!.ar = states.length === 1 ? states[0]! : null;
  }

  // GPS (workout routes only)
  const gps = gpsSpeedMinutes(store, ws, lo, n, inputs);
  for (let i = 0; i < n; i++) if (gps.accepted[i] && gps.speedMps[i] !== null) minutes[i]!.gpsMps = gps.speedMps[i]!;
  if (ws.length) {
    const pos = Array.from({ length: n }, () => [0, 0, 0] as [number, number, number]);
    for (const c of intervalsAll(store, 'activity/gps', lo, hi)) {
      const pts = Array.isArray(c.data.points) ? c.data.points : [];
      chargeReadBudget(pts.length);
      for (const p of pts) {
        if (!isObj(p) || p.accepted === false) continue;
        const t = instantMs(p.t);
        const lat = num(p.lat);
        const lon = num(p.lon);
        const acc = num(p.acc);
        if (t === null || lat === null || lon === null || acc === null || acc > GPS_MAX_ACC_M) continue;
        edge('gps', t);
        const i = idx(t);
        if (i < 0 || i >= n) continue;
        pos[i]![0] += lat;
        pos[i]![1] += lon;
        pos[i]![2]++;
      }
    }
    for (let i = 0; i < n; i++) if (pos[i]![2] > 0) minutes[i]!.gpsPos = { lat: pos[i]![0] / pos[i]![2], lon: pos[i]![1] / pos[i]![2] };
  }

  // recordings
  const recordings = ws.map((w) => ({ ref: `gauge:${w.sessionId}`, startMs: w.startMs, endMs: w.endMs }));
  const hc = intervalsAll(store, 'hc/record', lo, hi, { recordType: 'ExerciseSession' });
  inputs.addAll(hc);
  // (r069) a session over separate activities (Google Fit's one "walking" session over two walks) overlaps where its blocks
  // are, never across the break between them
  for (const x of hc) {
    if (x.endMs === null || !(x.endMs > x.startMs)) continue;
    const ref = `hc:${x.subject.slice('ExerciseSession:'.length)}`;
    const blocks = hcSessionBlocks(x.startMs, x.endMs, x.data, (t) => {
      const i = idx(t);
      return i >= 0 && i < n ? (minutes[i]!.fused ?? null) : null;
    });
    if (blocks.length === 0) recordings.push({ ref, startMs: x.startMs, endMs: x.endMs });
    else for (const b of blocks) recordings.push({ ref, startMs: b.start, endMs: b.end });
  }

  for (const k of Object.keys(edges) as Array<keyof typeof edges>) if (!Number.isFinite(edges[k] ?? NaN)) delete edges[k];
  return { input: { startMs: lo, minutes, ringCoarse, profile: o.profile ?? null, recordings, edges, nowMs: o.nowMs }, inputs };
}
