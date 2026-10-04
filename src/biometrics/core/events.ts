/**
 * RingDecodedEvent[] -> canonical BioBatch (SUITE_SPEC §4.6). Shared by the BLE drivers and the CloudEvents importer.
 * Tier P: UTC offsets are supplied by the caller (no Intl), no clock (`ingestedAt`/`exportedAt` are parameters).
 *
 * Grouping: samples/vendor values become one series record per (stream, local date, origin); sleep epochs one sleep record
 * per contiguous session; activity buckets steps/distance series (aggregation 'sum') plus one daily record per local date
 * carrying the sums of the buckets seen; workouts one workout record. `status` events are ignored. Record ids are
 * deterministic, so a re-sync that decodes the same data yields the same ids.
 */
import { recordId } from './hash';
import { sleepVersion } from './recordIds';
import { buildSleepRecord, isoAt, localDateAt, provenanceOf, qualityOf } from './importKit';
import type { StageSeg } from './importKit';
import type { RingDecodedEvent } from './ble/types';
import type {
  BioBatch, BioChannel, BioProvenance, BioRecord, BioStream, DailyRecord, QualityFlag, SeriesRecord, SleepStageName,
  WorkoutRecord,
} from './types';
import { BIO_SCHEMA } from './types';

export interface EventMapContext {
  /** IANA zone name recorded in the batch (informational). */
  tz: string;
  /** Fixed offset used for every local date in this batch, seconds east of UTC. */
  tzOffsetS: number;
  /** Optional historical offset resolver, for ring history spanning daylight-saving changes. */
  offsetAtMs?: (epochMs: number) => number;
  channel: BioChannel;
  device: BioProvenance['device'];
  /** e.g. 'jstyle2301/V0789@1' */
  decoder: string;
  firmware?: string;
  producer: { name: string; version: string };
  ingestedAt: string;
  exportedAt: string;
  /** Ring clock minus phone clock at sync, seconds. |value| > 120 flags every record 'clock_drift'. Timestamps are not shifted. */
  clockOffsetS?: number;
}

export const CLOCK_DRIFT_THRESHOLD_S = 120;

const STAGE_NAMES: Record<string, SleepStageName> = {
  awake: 'awake', light: 'light', deep: 'deep', rem: 'rem', unknown: 'unknown', asleep: 'asleep_unspecified', in_bed: 'awake_in_bed',
};

type Origin = Extract<RingDecodedEvent, { type: 'sample' }>['origin'];
const MODE: Record<Origin, 'periodic' | 'spot' | 'continuous'> = { history: 'periodic', spot: 'spot', live: 'continuous', workout_stream: 'continuous' };
const METHOD: Record<Origin, 'automatic' | 'active'> = { history: 'automatic', spot: 'active', live: 'automatic', workout_stream: 'active' };
type SleepRun = Extract<RingDecodedEvent, { type: 'sleepEpochs' }>;

/** Resolve packet overlaps by completeness, then arrival, before the generic stage flattener sees them. */
function sleepCoverage(runs: SleepRun[], order: Map<SleepRun, number>): { segs: StageSeg[]; codes: number[]; complete: boolean } {
  type Segment = StageSeg & { complete: boolean; order: number; code: number | undefined };
  const changes = new Map<number, { add: Segment[]; remove: Segment[] }>();
  const changeAt = (t: number) => {
    let c = changes.get(t);
    if (!c) changes.set(t, (c = { add: [], remove: [] }));
    return c;
  };
  for (const run of runs) run.stages.forEach((name, i) => {
    const s = run.start + i * run.epochS * 1000;
    const g: Segment = { s, e: s + run.epochS * 1000, stage: STAGE_NAMES[name.toLowerCase()] ?? 'unknown', complete: run.complete, order: order.get(run) ?? 0, code: run.rawCodes[i] };
    changeAt(g.s).add.push(g);
    changeAt(g.e).remove.push(g);
  });
  const times = [...changes.keys()].sort((a, b) => a - b);
  const active = new Set<Segment>();
  const segs: StageSeg[] = [];
  const codes: number[] = [];
  let complete = true;
  for (let i = 0; i < times.length - 1; i++) {
    const t = times[i]!;
    const change = changes.get(t)!;
    for (const s of change.remove) active.delete(s);
    for (const s of change.add) active.add(s);
    let winner: Segment | undefined;
    for (const s of active) if (!winner || Number(s.complete) > Number(winner.complete) || (s.complete === winner.complete && s.order > winner.order)) winner = s;
    if (!winner) continue;
    complete &&= winner.complete;
    if (winner.code !== undefined) codes.push(winner.code);
    const last = segs[segs.length - 1];
    if (last?.e === t && last.stage === winner.stage) last.e = times[i + 1]!;
    else segs.push({ s: t, e: times[i + 1]!, stage: winner.stage });
  }
  return { segs, codes, complete };
}

/** Run-length code string of the vendor's raw codes, e.g. '1x30,2x12'. Capped so a night stays under ~1 KB. */
export function rleCodes(codes: number[], maxRuns = 200): string {
  const runs: string[] = [];
  let i = 0;
  while (i < codes.length && runs.length < maxRuns) {
    let j = i;
    while (j < codes.length && codes[j] === codes[i]) j++;
    runs.push(`${codes[i]}x${j - i}`);
    i = j;
  }
  return `codes:${runs.join(',')}${i < codes.length ? ',...' : ''}`;
}

export function mapEventsToBatch(events: RingDecodedEvent[], ctx: EventMapContext): BioBatch {
  const offsetAt = ctx.offsetAtMs ?? (() => ctx.tzOffsetS);
  const drift = ctx.clockOffsetS !== undefined && Math.abs(ctx.clockOffsetS) > CLOCK_DRIFT_THRESHOLD_S;
  const device = ctx.device ? { ...ctx.device, ...(ctx.firmware ? { firmware: ctx.firmware } : {}) } : ctx.device;
  const srcKey = `${ctx.channel}:${device?.model ?? device?.type ?? 'device'}`;
  const prov = (extra: Partial<BioProvenance> = {}): BioProvenance =>
    provenanceOf(ctx.channel, ctx.ingestedAt, { device, decoder: ctx.decoder, ...extra });
  const flags = (...f: QualityFlag[]): QualityFlag[] => (drift ? [...f, 'clock_drift'] : f);
  const readAtS = (Date.parse(ctx.ingestedAt) || 0) / 1000;

  const series = new Map<string, { stream: BioStream; unit: string; origin: Origin; agg: 'sample' | 'sum'; interval?: number; off: number; pts: Map<number, number> }>();
  const addPt = (stream: BioStream, unit: string, origin: Origin, agg: 'sample' | 'sum', t: number, v: number, interval?: number): void => {
    const off = offsetAt(t);
    const key = `${stream}|${localDateAt(t, off)}|${origin}|${agg}|${unit}|${off}`;
    let g = series.get(key);
    if (!g) series.set(key, (g = { stream, unit, origin, agg, interval, off, pts: new Map() }));
    g.pts.set(t, v);
  };

  const sleeps: Array<{ rec: ReturnType<typeof buildSleepRecord> }> = [];
  const sleepRuns = new Map<number, SleepRun>();
  const sleepOrder = new Map<SleepRun, number>();
  let sleepSequence = 0;
  const buckets = new Map<number, Extract<RingDecodedEvent, { type: 'activityBucket' }>>();
  const days = new Map<string, { steps: number; distance: number; kcal: number; hasDistance: boolean; hasKcal: boolean; off: number }>();
  const workouts: WorkoutRecord[] = [];

  for (const ev of events) {
    switch (ev.type) {
      case 'sample':
        addPt(ev.stream, ev.unit, ev.origin, 'sample', ev.t, ev.value);
        break;
      case 'vendor':
        addPt(`vendor:${ev.key}`, ev.unit, 'history', 'sample', ev.t, ev.value);
        break;
      case 'activityBucket': {
        // Retransmissions and revised buckets replace the same timestamp before totals are summed.
        buckets.set(ev.start, ev);
        break;
      }
      case 'sleepEpochs': {
        if (!Number.isFinite(ev.start) || !Number.isFinite(ev.epochS) || ev.epochS <= 0 || ev.stages.length === 0) break;
        const prev = sleepRuns.get(ev.start);
        if (!prev?.complete || ev.complete) {
          sleepRuns.set(ev.start, ev);
          sleepOrder.set(ev, sleepSequence++);
        }
        break;
      }
      case 'workout': {
        const off = offsetAt(ev.start);
        const dur = Math.max(0, Math.round((ev.end - ev.start) / 1000));
        workouts.push({
          kind: 'workout',
          record_id: recordId({ source: srcKey, kind: 'workout', metric: ev.kind, start: isoAt(ev.start) }),
          version: 1,
          time: { start: isoAt(ev.start), end: isoAt(ev.end), tz_offset_s: off, local_date: localDateAt(ev.start, off) },
          provenance: prov({ recording_method: 'active' }),
          quality: qualityOf('measured', flags()),
          exercise_type: ev.kind,
          native_type: ev.kind,
          active_duration_s: dur,
          ...(ev.distanceM !== undefined ? { distance_m: ev.distanceM } : {}),
          ...(ev.kcal !== undefined ? { active_kcal: ev.kcal } : {}),
          ...(ev.hrAvg !== undefined ? { hr_avg_bpm: ev.hrAvg } : {}),
          ...(ev.hrMax !== undefined ? { hr_max_bpm: ev.hrMax } : {}),
        });
        break;
      }
      case 'status':
        break;
    }
  }

  for (const ev of buckets.values()) {
    addPt('steps', 'count', 'history', 'sum', ev.start, ev.steps, ev.durS);
    if (ev.distanceM !== undefined) addPt('distance', 'm', 'history', 'sum', ev.start, ev.distanceM, ev.durS);
    if (ev.kcal !== undefined) addPt('active_kcal', 'kcal', 'history', 'sum', ev.start, ev.kcal, ev.durS);
    const off = offsetAt(ev.start);
    const d = localDateAt(ev.start, off);
    const day = days.get(d) ?? { steps: 0, distance: 0, kcal: 0, hasDistance: false, hasKcal: false, off };
    day.steps += ev.steps;
    if (ev.distanceM !== undefined) { day.distance += ev.distanceM; day.hasDistance = true; }
    if (ev.kcal !== undefined) { day.kcal += ev.kcal; day.hasKcal = true; }
    days.set(d, day);
  }

  // A history night may span several packets. Join touching/overlapping runs, keeping naps separated by a gap.
  const groups: SleepRun[][] = [];
  let end = -Infinity;
  for (const ev of [...sleepRuns.values()].sort((a, b) => a.start - b.start)) {
    if (ev.start > end) groups.push([]);
    groups[groups.length - 1]!.push(ev);
    end = Math.max(end, ev.start + ev.epochS * ev.stages.length * 1000);
  }
  for (const group of groups) {
    const { segs, codes, complete } = sleepCoverage(group, sleepOrder);
    const wake = Math.max(...group.map((ev) => ev.start + ev.epochS * ev.stages.length * 1000));
    sleeps.push({ rec: buildSleepRecord({
      segs, offsetS: offsetAt(wake), sourceKey: srcKey,
      provenance: prov({ native_version: group[0]!.firmware || undefined }),
      quality: qualityOf('vendor_proprietary', flags(...(complete ? [] : (['provisional_stages'] as QualityFlag[]))), {
        confidence: complete ? null : 'low', ...(codes.length > 0 ? { vendor_state: rleCodes(codes) } : {}),
      }),
      isMain: false, version: sleepVersion(complete, readAtS),
    }) });
  }

  const records: BioRecord[] = [];

  const ordered = [...series.values()].map((g) => ({ ...g, pts: [...g.pts].sort((a, b) => a[0] - b[0]) }))
    .sort((a, b) => a.pts[0]![0] - b.pts[0]![0] || (a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.origin < b.origin ? -1 : 1));
  for (const g of ordered) {
    const pts = g.pts;
    const off = g.off;
    const t0 = pts[0]![0];
    const hrv = g.stream === 'hrv';
    const vendor = g.stream.startsWith('vendor:');
    const rec: SeriesRecord = {
      kind: 'series',
      record_id: recordId({ source: `${srcKey}:${g.origin}:${g.agg}`, kind: 'series', metric: g.stream, start: isoAt(t0) }),
      version: 1,
      time: { start: isoAt(t0), end: isoAt(pts[pts.length - 1]![0]), tz_offset_s: off, local_date: localDateAt(t0, off) },
      provenance: prov({ recording_method: METHOD[g.origin] }),
      quality: qualityOf(vendor || hrv ? 'vendor_proprietary' : 'measured', flags(...(hrv ? (['hrv_vendor_defined'] as QualityFlag[]) : []))),
      metric: g.stream,
      unit: g.unit,
      aggregation: g.agg,
      ...(g.interval !== undefined ? { interval_s: g.interval } : {}),
      sampling: { mode: MODE[g.origin], ...(g.interval !== undefined ? { nominal_interval_s: g.interval } : {}), ...(device ? { device_tier: device.tier } : {}) },
      ...(g.origin === 'workout_stream' ? { context: 'exercise' } : {}),
      t_offset_s: pts.map((p) => Math.round((p[0] - t0) / 1000)),
      values: pts.map((p) => p[1]),
    };
    records.push(rec);
  }

  for (const s of sleeps) if (s.rec) records.push(s.rec);
  // is_main = longest asleep_s among this batch's records per wake date
  const best = new Map<string, number>();
  for (const r of records) {
    if (r.kind !== 'sleep') continue;
    const b = best.get(r.time.local_date);
    if (b === undefined || r.asleep_s > b) best.set(r.time.local_date, r.asleep_s);
  }
  const taken = new Set<string>();
  for (const r of records) {
    if (r.kind !== 'sleep') continue;
    if (r.asleep_s === best.get(r.time.local_date) && r.asleep_s > 0 && !taken.has(r.time.local_date)) {
      r.is_main = true;
      taken.add(r.time.local_date);
    }
  }

  for (const [date, d] of [...days].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const daily: DailyRecord = {
      kind: 'daily',
      record_id: recordId({ source: srcKey, kind: 'daily', metric: 'activity', start: date }),
      // sums only grow as a re-sync fills the day, so the larger total wins (R20-ID-03, low: two reads with equal steps
      // and a different distance share a version, and the first one stored is kept)
      version: Math.max(1, Math.round(d.steps)),
      time: { tz_offset_s: d.off, local_date: date },
      provenance: prov(),
      quality: qualityOf('vendor_proprietary', flags('partial_day')),
      steps: d.steps,
      ...(d.hasDistance ? { distance_m: d.distance } : {}),
      ...(d.hasKcal ? { active_kcal: d.kcal } : {}),
    };
    records.push(daily);
  }
  records.push(...workouts);

  return { schema: BIO_SCHEMA, producer: ctx.producer, exported_at: ctx.exportedAt, tz: ctx.tz, records };
}
