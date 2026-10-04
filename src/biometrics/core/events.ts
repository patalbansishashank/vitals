/**
 * RingDecodedEvent[] -> canonical BioBatch (SUITE_SPEC §4.6). Shared by the BLE drivers and the CloudEvents importer.
 * Tier P: a fixed UTC offset is supplied by the caller (no Intl), no clock (`ingestedAt`/`exportedAt` are parameters).
 *
 * Grouping: samples/vendor values become one series record per (stream, local date, origin); sleep epochs one sleep record
 * per decoded packet run; activity buckets steps/distance series (aggregation 'sum') plus one daily record per local date
 * carrying the sums of the buckets seen; workouts one workout record. `status` events are ignored. Record ids are
 * deterministic, so a re-sync that decodes the same data yields the same ids.
 */
import { recordId } from './hash';
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

const MODE: Record<'history' | 'spot' | 'live', 'periodic' | 'spot' | 'continuous'> = { history: 'periodic', spot: 'spot', live: 'continuous' };
const METHOD: Record<'history' | 'spot' | 'live', 'automatic' | 'active'> = { history: 'automatic', spot: 'active', live: 'automatic' };

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
  const off = ctx.tzOffsetS;
  const drift = ctx.clockOffsetS !== undefined && Math.abs(ctx.clockOffsetS) > CLOCK_DRIFT_THRESHOLD_S;
  const device = ctx.device ? { ...ctx.device, ...(ctx.firmware ? { firmware: ctx.firmware } : {}) } : ctx.device;
  const srcKey = `${ctx.channel}:${device?.model ?? device?.type ?? 'device'}`;
  const prov = (extra: Partial<BioProvenance> = {}): BioProvenance =>
    provenanceOf(ctx.channel, ctx.ingestedAt, { device, decoder: ctx.decoder, ...extra });
  const flags = (...f: QualityFlag[]): QualityFlag[] => (drift ? [...f, 'clock_drift'] : f);

  const series = new Map<string, { stream: BioStream; unit: string; origin: 'history' | 'spot' | 'live'; agg: 'sample' | 'sum'; interval?: number; pts: Array<[number, number]> }>();
  const addPt = (stream: BioStream, unit: string, origin: 'history' | 'spot' | 'live', agg: 'sample' | 'sum', t: number, v: number, interval?: number): void => {
    const key = `${stream}|${localDateAt(t, off)}|${origin}|${agg}|${unit}`;
    let g = series.get(key);
    if (!g) series.set(key, (g = { stream, unit, origin, agg, interval, pts: [] }));
    g.pts.push([t, v]);
  };

  const sleeps: Array<{ rec: ReturnType<typeof buildSleepRecord> }> = [];
  const days = new Map<string, { steps: number; distance: number; hasDistance: boolean }>();
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
        addPt('steps', 'count', 'history', 'sum', ev.start, ev.steps, ev.durS);
        if (ev.distanceM !== undefined) addPt('distance', 'm', 'history', 'sum', ev.start, ev.distanceM, ev.durS);
        const d = localDateAt(ev.start, off);
        const day = days.get(d) ?? { steps: 0, distance: 0, hasDistance: false };
        day.steps += ev.steps;
        if (ev.distanceM !== undefined) { day.distance += ev.distanceM; day.hasDistance = true; }
        days.set(d, day);
        break;
      }
      case 'sleepEpochs': {
        const segs: StageSeg[] = [];
        ev.stages.forEach((name, i) => {
          const stage = STAGE_NAMES[name.toLowerCase()] ?? 'unknown';
          const s = ev.start + i * ev.epochS * 1000;
          const last = segs[segs.length - 1];
          if (last && last.stage === stage && last.e === s) last.e = s + ev.epochS * 1000;
          else segs.push({ s, e: s + ev.epochS * 1000, stage });
        });
        const rec = buildSleepRecord({
          segs, offsetS: off, sourceKey: srcKey,
          provenance: prov({ native_version: ev.firmware || undefined }),
          quality: qualityOf('vendor_proprietary', flags(...(ev.complete ? [] : (['provisional_stages'] as QualityFlag[]))), {
            confidence: ev.complete ? null : 'low', ...(ev.rawCodes.length > 0 ? { vendor_state: rleCodes(ev.rawCodes) } : {}),
          }),
          isMain: false,
          version: ev.complete ? 2 : 1,
        });
        sleeps.push({ rec });
        break;
      }
      case 'workout': {
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
        });
        break;
      }
      case 'status':
        break;
    }
  }

  const records: BioRecord[] = [];

  for (const g of series.values()) g.pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ordered = [...series.values()].sort((a, b) => a.pts[0]![0] - b.pts[0]![0] || (a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.origin < b.origin ? -1 : 1));
  for (const g of ordered) {
    // identical (t, value) pairs are one sample
    const pts = g.pts.filter((p, i) => i === 0 || p[0] !== g.pts[i - 1]![0] || p[1] !== g.pts[i - 1]![1]);
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
      // sums only grow as a re-sync fills the day, so the larger total wins
      version: Math.max(1, Math.round(d.steps)),
      time: { tz_offset_s: off, local_date: date },
      provenance: prov(),
      quality: qualityOf('vendor_proprietary', flags('partial_day')),
      steps: d.steps,
      ...(d.hasDistance ? { distance_m: d.distance } : {}),
    };
    records.push(daily);
  }
  records.push(...workouts);

  return { schema: BIO_SCHEMA, producer: ctx.producer, exported_at: ctx.exportedAt, tz: ctx.tz, records };
}
