/**
 * One local day minute by minute (energy SPEC §2.2 `timeline?date`, `gauge_timeline`). Pure. Every array has one entry
 * per minute of the local day (1440; 1380 or 1500 on a DST change) and null where nothing is known: a null is never 0.
 *
 * - `steps.selected` / `steps.source`: the fused choice of each minute unit (§2.3). A coarse unit is never placed in a
 *   minute: its minutes carry the chosen lineage in `source` and null in `selected`, and the unit is listed whole in
 *   `steps.coarse`. `steps.ring` / `steps.phone`: each lineage's own minute records (the phone's observed zeros too);
 *   (r068 B1) `steps.ringCoarse` / `steps.phoneCoarse` their coarse records, whole. A component unit whose chosen records
 *   are minute records is `placed`: those minutes carry its counts in `selected`; an unplaced one lists its `parts`.
 * - `steps.support` (r063 S1): `minute` where `selected` holds a minute unit's count (minute-supported cadence),
 *   `coarse` across a coarse unit's minutes (`selected` null there), null where nothing was selected.
 * - `hr.bpm`: the time-weighted mean over supported seconds (`hr-support/1`), `hr.supportedS` those seconds; without a
 *   declared cadence both stay null / 0 and only `hr.sampledBpm` (the mean of the minute's readings) is filled.
 *   (r063 S16) Gauge's own readings come first: a minute with any Gauge reading takes only Gauge's values. A minute
 *   without one takes Health Connect's HeartRate samples (never Gauge's own exports), one origin per minute; their
 *   cadence is the record's own regular spacing (`inferred`), else none (sampled only). `hr.source` names the source
 *   of each minute (`gauge` or `hc:<origin>`), so a reading arriving both ways is never counted twice.
 * - `hc` (r063 S16): Health Connect speed (m/s) and power (W) per minute, the sampled mean of one origin's samples, with
 *   their source; null when the day has none. `evidence` lists which sources each stream used (lineage, minutes, quality).
 * - `gps` (0.6.3 FX5): Gauge's route-derived moving speed per minute (m/s) inside its GPS workouts, with `accepted` (a
 *   measurement) and the workout it came from; null when the day has none. `evidence.gpsSpeed` names each workout used.
 *   Gauge's GPS and Health Connect speed stay apart: the estimator takes one source per activity.
 * - `stress`: the day's raw readings and their median gap, for the stress strip (A.1.3 #27): nothing is bridged here.
 */
import type { GpsSpeedEvidence } from './gpsMotion.ts';
import type { Segment } from './hrSupport.ts';
import { medianGapS, minuteMeans } from './hrSupport.ts';
import type { Stage } from './sleepMetrics.ts';
import { fuseSteps, type FusionResult } from './stepFusion.ts';

/** One origin's Health Connect samples of a stream (HeartRate, Speed, Power) for the timeline. */
export interface HcStream {
  /** `hc:<origin package>`. */
  source: string;
  lineage: string | null;
  /** Readings inside the day. */
  readings: ReadonlyArray<{ tMs: number; value: number }>;
  /** HeartRate only: the supported segments (`hr-support/1`) when the cadence was inferred; else empty. */
  segments?: readonly Segment[];
  cadence?: 'inferred' | 'none';
  recordingMethod?: unknown;
  records: number;
}

export interface TimelineInput {
  date: string;
  tz: string;
  startMs: number;
  endMs: number;
  fusion: FusionResult;
  hrSegments: readonly Segment[];
  hrReadings: ReadonlyArray<{ tMs: number; value: number }>;
  /** The ring's stage at a minute start, or undefined outside any sleep packet. */
  sleepStage: (minuteMs: number) => Stage | undefined;
  workouts: ReadonlyArray<{ id: string; startMs: number; endMs: number; type: string; source: string }>;
  /** (r067) `exerciseType` the normalised symbolic name, `exerciseTypeCode` the Health Connect integer (`./hcExercise.ts`). */
  hcExercise: ReadonlyArray<{ id: string; startMs: number; endMs: number; exerciseType: unknown; exerciseTypeCode?: number | null; title: string | null; origin: string | null; lineage: string | null }>;
  phoneAcquisition: ReadonlyArray<{ startMs: number; endMs: number; state: string }>;
  stress: ReadonlyArray<{ tMs: number; value: number }>;
  /** (r063 S16) Health Connect HeartRate, Speed and Power by origin (Gauge's own exports already left out). */
  hcHr?: readonly HcStream[];
  hcSpeed?: readonly HcStream[];
  hcPower?: readonly HcStream[];
  /** (0.6.3 FX5) Gauge's route-derived moving speed on this day's minute grid (`gpsSpeedMinutes`). */
  gpsSpeed?: { speedMps: ReadonlyArray<number | null>; accepted: readonly boolean[]; session: ReadonlyArray<string | null>; evidence: readonly GpsSpeedEvidence[] } | null;
  iso: (ms: number) => string;
}

const MIN = 60_000;

export function buildTimeline(t: TimelineInput) {
  const n = Math.round((t.endMs - t.startMs) / MIN);
  const at = (i: number) => t.startMs + i * MIN;
  const idx = (ms: number) => Math.floor((ms - t.startMs) / MIN);
  const nulls = <T>() => Array.from({ length: n }, () => null as T | null);

  const selected = nulls<number>();
  const source = nulls<string>();
  const support = nulls<'minute' | 'coarse'>();
  const coarse: Array<{ start: string; end: string; steps: number | null; source: string | null; lineage: string | null; support: string | null; selectionReason: string; placed: boolean; parts: Array<{ at: string; steps: number }> }> = [];
  for (const u of t.fusion.intervals) {
    if (u.endMs <= t.startMs || u.startMs >= t.endMs) continue;
    // (r068 B1) `placed`: its chosen minute records are in `selected`; otherwise `parts` names each chosen record's steps
    // at its last instant (the day rule), so a chart can put a coarse count in the hour it ended without splitting it
    if (u.unit === 'component') coarse.push({
      start: t.iso(u.startMs), end: t.iso(u.endMs), steps: u.steps, source: u.source, lineage: u.lineage, support: u.support, selectionReason: u.selectionReason,
      placed: u.placed === true, parts: u.placed ? [] : (u.parts ?? []).map((p) => ({ at: t.iso(p.atMs), steps: p.steps })),
    });
    for (let i = Math.max(0, idx(u.startMs)); i < n && at(i) < u.endMs; i++) {
      source[i] = u.lineage;
      if (u.unit === 'component' && u.steps !== null) support[i] = 'coarse';
    }
  }
  for (const [m, v] of t.fusion.minuteSelected) {
    const i = idx(m);
    if (i >= 0 && i < n) {
      selected[i] = v.steps;
      support[i] = 'minute';
    }
  }
  const lineageMinutes = (lineage: string) => {
    const out = nulls<number>();
    for (const r of t.fusion.tracks.get(lineage as never) ?? []) {
      if (r.endMs - r.startMs > MIN || Math.floor(r.startMs / MIN) !== Math.floor((r.endMs - 1) / MIN)) continue;
      const i = idx(r.startMs);
      if (i >= 0 && i < n) out[i] = (out[i] ?? 0) + r.steps;
    }
    return out;
  };
  // (r068 B1) each lineage's coarse records of the day (a counter span, a ten-minute fallback), whole: never in a minute
  const lineageCoarse = (lineage: string) =>
    (t.fusion.tracks.get(lineage as never) ?? [])
      .filter((r) => !r.synthetic && r.endMs > t.startMs && r.startMs < t.endMs && (r.endMs - r.startMs > MIN || Math.floor(r.startMs / MIN) !== Math.floor((r.endMs - 1) / MIN)))
      .map((r) => ({ start: t.iso(r.startMs), end: t.iso(r.endMs), steps: r.steps, support: r.support }));

  const hr = minuteMeans(t.hrSegments, t.startMs, n);
  const sampled = (readings: ReadonlyArray<{ tMs: number; value: number }>) => {
    const sums = Array.from({ length: n }, () => [0, 0] as [number, number]);
    for (const r of readings) {
      const i = idx(r.tMs);
      if (i >= 0 && i < n) {
        sums[i]![0] += r.value;
        sums[i]![1]++;
      }
    }
    return sums;
  };
  const sums = sampled(t.hrReadings);
  const sampledBpm = sums.map(([s, c]) => (c ? Math.round((s / c) * 10) / 10 : null));
  const hrBpm: Array<number | null> = [...hr.bpm];
  const hrSupported: number[] = [...hr.supportedS];
  const hrSource = sums.map(([, c], i) => (c > 0 || hr.supportedS[i]! > 0 ? 'gauge' : null) as string | null);
  // (r063 S16) Health Connect fills only the minutes Gauge has no reading of (Gauge first; one origin per minute: the
  // one with the most supported time there, then the most readings, then by name)
  const hrEvidence: Array<Record<string, unknown>> = [];
  const gaugeMinutes = hrSource.filter((x) => x === 'gauge').length;
  if (gaugeMinutes) hrEvidence.push({ source: 'gauge', minutes: gaugeMinutes, supportedS: hrSupported.reduce((a, x, i) => a + (hrSource[i] === 'gauge' ? x : 0), 0) });
  const hcHr = [...(t.hcHr ?? [])].map((x) => ({ x, means: minuteMeans(x.segments ?? [], t.startMs, n), sums: sampled(x.readings) }))
    .sort((a, b) => (a.x.source < b.x.source ? -1 : a.x.source > b.x.source ? 1 : 0));
  const used = new Map<string, { minutes: number; supportedS: number }>();
  for (let i = 0; i < n; i++) {
    if (hrSource[i] !== null) continue;
    let best: (typeof hcHr)[number] | null = null;
    for (const h of hcHr) {
      if (!h.sums[i]![1] && !h.means.supportedS[i]) continue;
      if (!best || h.means.supportedS[i]! > best.means.supportedS[i]! || (h.means.supportedS[i] === best.means.supportedS[i] && h.sums[i]![1] > best.sums[i]![1])) best = h;
    }
    if (!best) continue;
    const [s, c] = best.sums[i]!;
    hrSource[i] = best.x.source;
    hrBpm[i] = best.means.bpm[i]!;
    hrSupported[i] = best.means.supportedS[i]!;
    sampledBpm[i] = c ? Math.round((s / c) * 10) / 10 : null;
    const u = used.get(best.x.source) ?? { minutes: 0, supportedS: 0 };
    u.minutes++;
    u.supportedS += best.means.supportedS[i]!;
    used.set(best.x.source, u);
  }
  for (const h of hcHr) {
    const u = used.get(h.x.source);
    if (u) hrEvidence.push({ source: h.x.source, lineage: h.x.lineage, minutes: u.minutes, supportedS: u.supportedS, cadence: h.x.cadence ?? 'none', records: h.x.records, recordingMethod: h.x.recordingMethod ?? null });
  }
  // speed and power: one origin per minute (the most samples there, then by name), the sampled mean
  const perMinute = (streams: readonly HcStream[] | undefined, extra: Record<string, unknown> = {}) => {
    const list = [...(streams ?? [])].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)).map((x) => ({ x, sums: sampled(x.readings) }));
    if (!list.some((l) => l.sums.some(([, c]) => c > 0))) return { values: null, sources: null, evidence: [] as Array<Record<string, unknown>> };
    const values = nulls<number>();
    const sources = nulls<string>();
    const count = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      let best: (typeof list)[number] | null = null;
      for (const l of list) if (l.sums[i]![1] > (best?.sums[i]![1] ?? 0)) best = l;
      if (!best) continue;
      const [s, c] = best.sums[i]!;
      values[i] = Math.round((s / c) * 100) / 100;
      sources[i] = best.x.source;
      count.set(best.x.source, (count.get(best.x.source) ?? 0) + 1);
    }
    const evidence = list.filter((l) => count.has(l.x.source)).map((l) => ({ source: l.x.source, lineage: l.x.lineage, minutes: count.get(l.x.source)!, records: l.x.records, recordingMethod: l.x.recordingMethod ?? null, ...extra }));
    return { values, sources, evidence };
  };
  const speed = perMinute(t.hcSpeed);
  // HC power is not calibrated or verified on this path: an estimator may use it only as unverified evidence
  const power = perMinute(t.hcPower, { verified: false });

  const gps = t.gpsSpeed && t.gpsSpeed.speedMps.some((v) => v !== null)
    ? { speedMps: Array.from({ length: n }, (_, i) => t.gpsSpeed!.speedMps[i] ?? null), accepted: Array.from({ length: n }, (_, i) => t.gpsSpeed!.accepted[i] === true), session: Array.from({ length: n }, (_, i) => t.gpsSpeed!.session[i] ?? null) }
    : null;

  const stage = nulls<Stage>();
  for (let i = 0; i < n; i++) stage[i] = t.sleepStage(at(i)) ?? null;

  const ringObserved = nulls<'observed'>();
  for (const r of t.fusion.tracks.get('ring') ?? []) for (let i = Math.max(0, idx(r.startMs)); i < n && at(i) < r.endMs; i++) ringObserved[i] = 'observed';
  const phone = nulls<string>();
  for (const a of t.phoneAcquisition) for (let i = Math.max(0, idx(a.startMs)); i < n && at(i) < a.endMs; i++) phone[i] = a.state;

  const stress = [...t.stress].sort((a, b) => a.tMs - b.tMs);
  return {
    date: t.date, tz: t.tz, start: t.iso(t.startMs), end: t.iso(t.endMs), minutes: n,
    steps: { selected, source, support, ring: lineageMinutes('ring'), phone: lineageMinutes('phone'), coarse, ringCoarse: lineageCoarse('ring'), phoneCoarse: lineageCoarse('phone') },
    hr: { bpm: hrBpm, supportedS: hrSupported, sampledBpm, source: hrSource },
    hc: speed.values || power.values ? { speedMps: speed.values, speedSource: speed.sources, powerW: power.values, powerSource: power.sources } : null,
    gps,
    evidence: { hr: hrEvidence, speed: speed.evidence, power: power.evidence, ...(gps ? { gpsSpeed: [...t.gpsSpeed!.evidence] } : {}) },
    sleep: { stage },
    sessions: t.workouts.filter((w) => w.endMs > t.startMs && w.startMs < t.endMs).map((w) => ({ id: w.id, start: t.iso(w.startMs), end: t.iso(w.endMs), type: w.type, source: w.source })),
    hcExercise: t.hcExercise.filter((w) => w.endMs > t.startMs && w.startMs < t.endMs).map((w) => ({ id: w.id, start: t.iso(w.startMs), end: t.iso(w.endMs), exerciseType: w.exerciseType, exerciseTypeCode: w.exerciseTypeCode ?? null, title: w.title, origin: w.origin, originPackage: w.origin, lineage: w.lineage })),
    acquisition: { ring: ringObserved, phone },
    stress: { readings: stress.map((s) => ({ at: t.iso(s.tMs), value: s.value })), medianGapS: medianGapS(stress.map((s) => s.tMs)) },
  };
}

/**
 * (r063 S5) The full timeline shape of a day with no evidence: every per-minute array present and null-filled (no
 * store yet, or nothing uploaded), so a consumer never meets a missing `steps`, `sleep` or `hr`.
 */
export function emptyTimeline(date: string, tz: string, startMs: number, endMs: number, iso: (ms: number) => string) {
  return buildTimeline({
    date, tz, startMs, endMs, fusion: fuseSteps([]), hrSegments: [], hrReadings: [], sleepStage: () => undefined, workouts: [], hcExercise: [],
    phoneAcquisition: [], stress: [], iso,
  });
}
