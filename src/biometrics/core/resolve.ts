/**
 * Daily view resolution (SUITE_SPEC §4.3, §14.6; tier P): one truth per record key — a correction, else a device, else
 * nothing (an entry by hand counts only where no device reports the metric that day). Values are never averaged across
 * devices and a metric group (e.g. SpO2 avg and min) always comes from one source.
 *
 * When several device sources report the same metric on a day the order is fixed (no priority lists): device tier
 * A > B > C, then the source with more coverage that day (sleep: more time asleep recorded; daily: more fields present;
 * spots and workouts: more readings or time), then the most recent `ingested_at`, then `sourceKey`. Stored `priority`
 * and `priorityByMetric` on a source are ignored.
 */
import type {
  BioCorrection, BioProvenance, BioQuality, BioRecord, BioSourceDoc, DailyRecord, DeviceTier, LocalDate, ResolvedDay, SleepRecord, SpotRecord,
  WorkoutRecord, CorrectionTarget,
} from './types';
import { inferTier } from './source';
import { reconcileSleep } from './reconcileSleep';

/** Daily-record fields grouped into metrics; each group is resolved as a unit. Key = metric name in sourceByMetric. */
export const DAILY_METRIC_GROUPS: Readonly<Record<string, readonly (keyof DailyRecord)[]>> = {
  steps: ['steps'],
  distance_m: ['distance_m'],
  active_kcal: ['active_kcal'],
  total_kcal: ['total_kcal'],
  active_min: ['active_min'],
  resting_hr_bpm: ['resting_hr_bpm'],
  hr: ['hr_avg_bpm', 'hr_min_bpm', 'hr_max_bpm'],
  hrv: ['hrv'],
  spo2: ['spo2_avg_pct', 'spo2_min_pct'],
  resp_rate_brpm: ['resp_rate_brpm'],
  skin_temp: ['skin_temp_delta_c', 'skin_temp_c'],
  body_temp_c: ['body_temp_c'],
  vo2max: ['vo2max'],
  vendor: ['vendor'],
};

/** `sourceByMetric` value of a metric that only a correction supplies (no device record that day). */
export const CORRECTION_SOURCE = 'correction';

export interface SourcedRecord {
  sourceKey: string;
  record: BioRecord;
}

export interface ResolveOpts {
  from?: LocalDate;
  to?: LocalDate;
}

/** The record key a correction targets (§14.6 b): `sleep:<date>`, `daily:<date>:<group>`, `spot:<date>:<metric>[:<at>]`. */
export function correctionKey(t: CorrectionTarget): string {
  switch (t.kind) {
    case 'sleep':
      return `sleep:${t.localDate}`;
    case 'daily':
      return `daily:${t.localDate}:${t.metric}`;
    case 'spot':
      return `spot:${t.localDate}:${t.metric}${t.at ? `:${t.at}` : ''}`;
  }
}

/** The `ResolvedDay.sourceByMetric` key a correction target belongs to. */
export function metricOfTarget(t: CorrectionTarget): string {
  return t.kind === 'sleep' ? 'sleep' : t.kind === 'daily' ? t.metric : `spot:${t.metric}`;
}

/** An entry by hand (the `manual` source or channel): the fallback below every device. */
export function isManualSource(sourceKey: string, r?: BioRecord): boolean {
  return sourceKey === 'manual' || sourceKey.startsWith('manual|') || r?.provenance.channel === 'manual';
}

const TIER_RANK: Record<DeviceTier, number> = { A: 0, B: 1, C: 2 };

interface Candidate {
  sk: string;
  tier: DeviceTier;
  manual: boolean;
  coverage: number;
  ingestedAt: string;
}

/** The fixed device order: devices before entries by hand, tier, coverage, recency, source key. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    Number(a.manual) - Number(b.manual) ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    b.coverage - a.coverage ||
    (a.ingestedAt < b.ingestedAt ? 1 : a.ingestedAt > b.ingestedAt ? -1 : 0) ||
    a.sk.localeCompare(b.sk)
  );
}

const latestIngest = (list: readonly BioRecord[]): string => list.reduce((m, r) => (r.provenance.ingested_at > m ? r.provenance.ingested_at : m), '');

/** Builds ascending `ResolvedDay`s from records and the person's active corrections. Series and device_profile records
 * are ignored; a cleared correction (`clearedAt`) is ignored. */
export function resolveDays(
  records: readonly SourcedRecord[],
  sources: readonly BioSourceDoc[],
  opts: ResolveOpts = {},
  corrections: readonly BioCorrection[] = [],
): ResolvedDay[] {
  const doc = new Map(sources.map((s) => [s.sourceKey, s]));
  const tierOf = (k: string, r: BioRecord): DeviceTier => doc.get(k)?.tier ?? inferTier(r.provenance);
  const inRange = (d: LocalDate) => !((opts.from && d < opts.from) || (opts.to && d > opts.to));

  // latest version per record_id
  const latest = new Map<string, SourcedRecord>();
  for (const sr of records) {
    const prev = latest.get(sr.record.record_id);
    if (!prev || sr.record.version > prev.record.version) latest.set(sr.record.record_id, sr);
  }
  const byDate = new Map<LocalDate, SourcedRecord[]>();
  for (const sr of reconcileSleep([...latest.values()])) {
    const k = sr.record.kind;
    if (k === 'series' || k === 'device_profile') continue;
    const d = sr.record.time.local_date;
    if (!inRange(d)) continue;
    const arr = byDate.get(d);
    if (arr) arr.push(sr);
    else byDate.set(d, [sr]);
  }
  const corrByDate = new Map<LocalDate, BioCorrection[]>();
  for (const c of corrections) {
    if (c.clearedAt) continue;
    const d = c.target.localDate;
    if (!inRange(d)) continue;
    const arr = corrByDate.get(d);
    if (arr) arr.push(c);
    else corrByDate.set(d, [c]);
  }

  const out: ResolvedDay[] = [];
  for (const date of [...new Set([...byDate.keys(), ...corrByDate.keys()])].sort()) {
    const recs = byDate.get(date) ?? [];
    const day: ResolvedDay = { localDate: date, sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [] };
    const mark = (metric: string, sk: string, r: BioRecord): void => {
      day.sourceByMetric[metric] = sk;
      day.tierByMetric[metric] = tierOf(sk, r);
      day.basisByMetric[metric] = isManualSource(sk, r) ? 'manual' : 'device';
    };
    const group = <T extends BioRecord>(kind: T['kind']): Map<string, T[]> => {
      const g = new Map<string, T[]>();
      for (const { sourceKey, record } of recs) {
        if (record.kind !== kind) continue;
        const a = g.get(sourceKey);
        if (a) a.push(record as T);
        else g.set(sourceKey, [record as T]);
      }
      return g;
    };
    const order = <T extends BioRecord>(g: Map<string, T[]>, coverage: (sk: string, list: T[]) => number): string[] =>
      [...g.entries()]
        .map(([sk, list]): Candidate => ({ sk, tier: tierOf(sk, list[0]!), manual: isManualSource(sk, list[0]), coverage: coverage(sk, list), ingestedAt: latestIngest(list) }))
        .sort(compareCandidates)
        .map((c) => c.sk);

    // daily: overlay per metric group from the first source in the fixed order that has it
    const dailies = group<DailyRecord>('daily');
    if (dailies.size > 0) {
      const merged = new Map<string, DailyRecord>();
      for (const [sk, list] of dailies) {
        list.sort((a, b) => a.version - b.version || a.provenance.ingested_at.localeCompare(b.provenance.ingested_at) || a.record_id.localeCompare(b.record_id));
        const m: Record<string, unknown> = {};
        for (const r of list) Object.assign(m, r); // later versions overwrite earlier fields; absent fields persist
        merged.set(sk, m as unknown as DailyRecord);
      }
      const fieldsPresent = (sk: string) => Object.values(DAILY_METRIC_GROUPS).flat().filter((f) => merged.get(sk)![f] !== undefined).length;
      const ranked = order(dailies, (sk) => fieldsPresent(sk));
      const best = merged.get(ranked[0]!)!;
      const result: Record<string, unknown> = { ...best };
      for (const f of Object.values(DAILY_METRIC_GROUPS).flat()) delete result[f];
      for (const [metric, fields] of Object.entries(DAILY_METRIC_GROUPS)) {
        const sk = ranked.find((k) => fields.some((f) => merged.get(k)![f] !== undefined));
        if (sk === undefined) continue;
        const src = merged.get(sk)! as unknown as Record<string, unknown>;
        for (const f of fields) if (src[f] !== undefined) result[f] = src[f];
        mark(metric, sk, merged.get(sk)!);
      }
      day.daily = result as unknown as DailyRecord;
    }

    // sleep / workouts: the first source in the fixed order; its sessions only
    const sleeps = group<SleepRecord>('sleep');
    const ssk = order(sleeps, (_sk, list) => list.reduce((s, r) => s + (r.asleep_s ?? 0), 0))[0];
    if (ssk !== undefined) {
      day.sleeps = [...sleeps.get(ssk)!].sort((a, b) => (a.time.start ?? '').localeCompare(b.time.start ?? ''));
      day.mainSleep = mainOf(day.sleeps);
      mark('sleep', ssk, day.mainSleep);
    }
    const workouts = group<WorkoutRecord>('workout');
    const wsk = order(workouts, (_sk, list) => list.reduce((s, r) => s + (r.active_duration_s ?? 0), 0))[0];
    if (wsk !== undefined) {
      day.workouts = [...workouts.get(wsk)!].sort((a, b) => (a.time.start ?? '').localeCompare(b.time.start ?? ''));
      mark('workouts', wsk, day.workouts[0]!);
    }

    // spots: per metric, first source in the fixed order
    const spots = new Map<string, Map<string, SpotRecord[]>>();
    for (const { sourceKey, record } of recs) {
      if (record.kind !== 'spot') continue;
      let m = spots.get(record.metric);
      if (!m) spots.set(record.metric, (m = new Map()));
      const a = m.get(sourceKey);
      if (a) a.push(record);
      else m.set(sourceKey, [record]);
    }
    for (const [metric, m] of [...spots].sort(([a], [b]) => a.localeCompare(b))) {
      const sk = order(m, (_sk, list) => list.length)[0]!;
      const list = m.get(sk)!.sort(bySpotTime);
      day.spots.push(...list);
      mark(`spot:${metric}`, sk, list[0]!);
    }

    for (const c of (corrByDate.get(date) ?? []).sort((a, b) => a.key.localeCompare(b.key))) applyCorrection(day, c);
    out.push(day);
  }
  return out;
}

const bySpotTime = (a: SpotRecord, b: SpotRecord) => (a.time.at ?? a.time.start ?? '').localeCompare(b.time.at ?? b.time.start ?? '');

function mainOf(sleeps: readonly SleepRecord[]): SleepRecord {
  const mains = sleeps.filter((s) => s.is_main);
  const pool = mains.length > 0 ? mains : sleeps;
  return pool.reduce((a, b) => (b.asleep_s > a.asleep_s ? b : a));
}

const corrProvenance = (c: BioCorrection): BioProvenance => ({ channel: 'manual', recording_method: 'manual', modality: 'self_reported', ingested_at: c.createdAt });
const corrQuality = (): BioQuality => ({ validation: 'self_reported', confidence: null, flags: [] });

/** Fields of a sleep record that describe the night's structure; a corrected total no longer matches them. */
const SLEEP_STRUCTURE: readonly (keyof SleepRecord)[] = ['stages', 'light_s', 'deep_s', 'rem_s', 'awake_s', 'unknown_s', 'latency_s', 'waso_s', 'awakenings', 'efficiency_pct', 'raw_codes_chunk'];

/** Puts one correction over the device view of `day` (mutates `day`; never the input records). */
function applyCorrection(day: ResolvedDay, c: BioCorrection): void {
  const t = c.target;
  const metric = metricOfTarget(t);
  const keep = (deviceValue: unknown | null) => {
    if (!day.sourceByMetric[metric]) {
      day.sourceByMetric[metric] = CORRECTION_SOURCE;
      day.tierByMetric[metric] = 'C';
    }
    day.basisByMetric[metric] = 'correction';
    day.corrections.push({ key: c.key, correctionId: c.correctionId, deviceValue });
  };
  if (t.kind === 'sleep') {
    if (!('asleepS' in c.value)) return;
    const v = c.value;
    const prev = day.mainSleep;
    const base = prev && day.basisByMetric['sleep'] !== 'manual' ? prev : undefined;
    const start = v.bedAt ?? base?.time.start;
    const end = v.wakeAt ?? base?.time.end;
    const inBed = start && end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000)) : base?.in_bed_s;
    const rec: Record<string, unknown> = {
      ...(base ?? { kind: 'sleep', is_main: true }),
      record_id: c.correctionId,
      version: 1,
      is_main: true,
      asleep_s: v.asleepS,
      time: { ...(base?.time ?? { tz_offset_s: 0 }), local_date: t.localDate, ...(start ? { start } : {}), ...(end ? { end } : {}) },
      provenance: corrProvenance(c),
      quality: corrQuality(),
    };
    for (const f of SLEEP_STRUCTURE) delete rec[f];
    if (inBed !== undefined) {
      rec.in_bed_s = inBed;
      if (inBed > 0) rec.efficiency_pct = Math.min(100, Math.round((v.asleepS / inBed) * 1000) / 10);
    } else delete rec.in_bed_s;
    const corrected = rec as unknown as SleepRecord;
    day.sleeps = prev ? day.sleeps.map((s) => (s === prev ? corrected : s)) : [...day.sleeps, corrected];
    day.mainSleep = corrected;
    keep(base ? { asleepS: base.asleep_s, ...(base.time.start ? { bedAt: base.time.start } : {}), ...(base.time.end ? { wakeAt: base.time.end } : {}) } : null);
    return;
  }
  if (t.kind === 'daily') {
    if (!('fields' in c.value)) return;
    const fields = DAILY_METRIC_GROUPS[t.metric] ?? [];
    const before = day.daily as unknown as Record<string, unknown> | undefined;
    const fromDevice = day.basisByMetric[metric] === 'device' && before ? Object.fromEntries(fields.filter((f) => before[f] !== undefined).map((f) => [f, before[f]])) : {};
    const next: Record<string, unknown> = before
      ? { ...before }
      : { kind: 'daily', record_id: c.correctionId, version: 1, time: { tz_offset_s: 0, local_date: t.localDate }, provenance: corrProvenance(c), quality: corrQuality() };
    for (const f of fields) delete next[f];
    const given = c.value.fields as Record<string, unknown>;
    for (const f of fields) if (given[f] !== undefined) next[f] = given[f];
    day.daily = next as unknown as DailyRecord;
    keep(Object.keys(fromDevice).length ? fromDevice : null);
    return;
  }
  if (!('value' in c.value)) return;
  const value = c.value.value;
  const same = day.spots.filter((s) => s.metric === t.metric).sort(bySpotTime);
  const fromDevice = day.basisByMetric[metric] === 'device';
  const target = t.at ? same.find((s) => s.time.at === t.at) : same[same.length - 1];
  const at = t.at ?? target?.time.at ?? target?.time.start;
  const corrected: SpotRecord = {
    kind: 'spot',
    metric: t.metric,
    value,
    record_id: c.correctionId,
    version: 1,
    time: { ...(target?.time ?? { tz_offset_s: 0 }), local_date: t.localDate, ...(at ? { at } : {}) },
    provenance: corrProvenance(c),
    quality: corrQuality(),
  };
  // with `at`, only that reading changes; without it, the corrected value stands for the day
  const drop = new Set<SpotRecord>(t.at ? (target ? [target] : []) : same);
  day.spots = [...day.spots.filter((s) => !drop.has(s)), corrected].sort((a, b) => a.metric.localeCompare(b.metric) || bySpotTime(a, b));
  keep(target && fromDevice ? target.value : null);
}
