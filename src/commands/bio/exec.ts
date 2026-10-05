/**
 * `bio.*` executors (I1-B over E10's src/biometrics; SUITE_SPEC §4). Loaded lazily by `./index.ts`, so the importers,
 * score catalogue and Bluetooth drivers stay out of the main chunk.
 *
 * Reads come from the shared document index (`bioIndex`) and are filtered by the person's stream policy for agents
 * (§4.5: the Coach sees a stream only when its `coach` setting is not `hidden`; series need `daily+series`). Writes go
 * through `./store.ts`: small edits in the command's transaction, jobs and bulk deletions in derive transactions.
 */
import { getScoreDef, SCORE_CATALOGUE, compareVersions } from '@/biometrics/core/scores';
import { rescoreHistory, type RescoreReport } from '@/biometrics/ingest/rescoreJob';
import { ingestBatches, type IngestOutcome } from '@/biometrics/ingest/pipeline';
import { addDays, daysBetween } from '@/biometrics/core/scores/util';
import { CORRECTION_SOURCE, resolveDays } from '@/biometrics/core/resolve';
import { isRingSource, normalizePolicy, RING_FOLD_ID, ringDefaultPolicy, ringFoldOf, ringSharing, scoreAllowed, suggestedOnPolicy } from '@/biometrics/core/policy';
import { lumenFold, policyStreamOf, sourceKeyOf, suggestedPolicies } from '@/biometrics/core/source';
import { ringAliases, ringSourceLabel } from '@/biometrics/service/identity';
import { recordId } from '@/biometrics/core/hash';
import { validateBatch, CANONICAL_UNIT } from '@/biometrics/core/validate';
import { RAW_STREAMS, BIO_SCHEMA } from '@/biometrics/core/types';
import type {
  Basis, BioBatch, BioProvenance, BioRecord, BioSourceDoc, BioStream, BiometricsImporter, DailyRecord, DeviceTier, LocalDate, PolicyStream, ResolvedDay,
  ScoreProfile, ScoreResult, SleepRecord, SpotMetric, SpotRecord, StreamPolicy,
} from '@/biometrics/core/types';
import {
  adoptPersonPolicies, applyImportPolicy, DAILY_GROUPS, effectivePolicy, importPolicies, personMatrix, policyStreamId, streamOfMetric, withPolicy,
} from '@/biometrics/core/effective';
import type { BleLink } from '@/biometrics/core/ble/types';
import type { RingSyncReport } from '@/biometrics/service/types';
import { bioActivity } from '@/biometrics/app/activity';
import type { BioDocIndex } from '@/biometrics/store/docIndex';
import type { DocBioStore } from '@/biometrics/store/docStore';
import { SqliteUnavailableError, isSqliteHead, isZipHead, isJsonHead } from '@/biometrics/importers/sqlite';
import { localDateOf, tzOffsetSeconds } from '@/biometrics/importers/util';
import { fail } from '../registry';
import type { CommandContext, JobHandle, JobRef } from '../types';
import { bioIndex, commandWriter, deriveWriter, openBioStore } from './store';
import { defaultBioPorts, scheduleRescore, type BioPorts } from './runtime';
import { ringDefaultsNotice, storedRingChoice } from './sharing';

const BUILD = 'vitals-web';
const MAX_DAYS = 92;
export const SQLITE_HELP =
  'This file is a SQLite database, and this version of Vitals cannot open SQLite files in the browser. Export its tables as a JSON dump (see the help for this format) and import that file instead.';

/* =============================================================================== helpers */

const isAgent = (ctx: CommandContext): boolean => ctx.actor.kind !== 'user' && ctx.actor.kind !== 'system';
const ports = (ctx: CommandContext): BioPorts => ctx.ports.bio ?? defaultBioPorts;

function range(ctx: CommandContext, input: { from?: LocalDate; to?: LocalDate }, defaultDays: number, max = MAX_DAYS): { from: LocalDate; to: LocalDate } {
  const to = input.to ?? (input.from && input.from > ctx.today ? input.from : ctx.today);
  const from = input.from ?? addDays(to, -(defaultDays - 1));
  if (from > to) fail('invalid_input', 'The start date is after the end date.', { path: '/from' });
  if (daysBetween(from, to) + 1 > max) fail('invalid_input', `Ask for at most ${max} days at a time.`, { path: '/from' });
  return { from, to };
}

/** A source's label. An agent gets a ring's from the family table, never a stored one (an older build stored the ring's
 * advertised name) nor its key when the document is missing (L-REV2 R3-10, R3-11); other keys hold no hardware id. */
const labelOf = (ix: BioDocIndex, sk: string | undefined, agent = false): string => {
  if (!sk) return 'device';
  const src = ix.source(sk);
  return (agent ? ringSourceLabel(src ?? { sourceKey: sk }) : undefined) ?? src?.label ?? (sk === 'manual' ? 'Entered by hand' : sk === CORRECTION_SOURCE ? 'Your correction' : sk);
};
const tierOf = (ix: BioDocIndex, sk: string | undefined, day?: ResolvedDay, metric?: string): DeviceTier =>
  (metric && day?.tierByMetric[metric]) || (sk ? ix.source(sk)?.tier : undefined) || 'C';

/** The policy that governs data of `stream` from `sourceKey` (a source without a document is data the person brought in). */
function policyFor(ix: BioDocIndex, sourceKey: string | undefined, stream: PolicyStream): StreamPolicy {
  const src = sourceKey ? (ix.source(sourceKey) ?? { policies: [] }) : null;
  return effectivePolicy(src, ix.personPolicies, stream);
}

/** Agents see a stream only when the person shares it with the Coach. */
function coachSees(ix: BioDocIndex, ctx: CommandContext, sourceKey: string | undefined, stream: PolicyStream, shape: 'daily' | 'series' = 'daily'): boolean {
  if (!isAgent(ctx)) return true;
  const p = policyFor(ix, sourceKey, stream);
  if (!p.imported || p.coach === 'hidden') return false;
  return shape === 'daily' || p.coach === 'daily+series';
}

function sourced(ix: BioDocIndex, from?: LocalDate, to?: LocalDate) {
  return ix.latestRecords(from, to).map((e) => ({ sourceKey: e.sourceKey, record: e.record }));
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/* =============================================================================== bio.daily */

interface DailyIn {
  from?: LocalDate;
  to?: LocalDate;
  metrics?: string[];
}

type Val = { value: number; unit: string; source: string; sourceKey: string; tier: DeviceTier; basis: Basis };

const FIELD_UNITS: Partial<Record<keyof DailyRecord, string>> = {
  steps: 'count', distance_m: 'm', active_kcal: 'kcal', total_kcal: 'kcal', resting_hr_bpm: 'bpm', hr_avg_bpm: 'bpm', hr_min_bpm: 'bpm', hr_max_bpm: 'bpm',
  spo2_avg_pct: '%', spo2_min_pct: '%', resp_rate_brpm: 'breaths/min', skin_temp_delta_c: '°C', skin_temp_c: '°C', body_temp_c: '°C',
};
const SPOT_UNITS: Record<SpotMetric, string> = {
  weight_kg: 'kg', body_fat_pct: '%', lean_mass_kg: 'kg', waist_cm: 'cm', bp_sys_mmhg: 'mmHg', bp_dia_mmhg: 'mmHg', glucose_mg_dl: 'mg/dL', body_temp_c: '°C', hr_bpm: 'bpm', spo2_pct: '%', hrv_ms: 'ms',
};

export async function daily(ctx: CommandContext, input: DailyIn) {
  const ix = await bioIndex();
  const { from, to } = range(ctx, input, 14);
  const days = resolveDays(sourced(ix, from, to), ix.sources(), { from, to }, ix.corrections());
  const hidden = new Set<string>();
  const want = input.metrics?.length ? new Set(input.metrics) : null;
  const keep = (k: string) => !want || want.has(k);
  // an agent gets a ring key as its alias (`…/ring1`: no serial, address or advertised id; L-REV2 R3-10)
  const agent = isAgent(ctx);
  const label = (sk: string) => labelOf(ix, sk, agent);
  const key = agent ? ringAliases(ix.sources()) : (sk: string) => sk;
  const out = [];
  for (const day of days) {
    const values: Record<string, Val> = {};
    const vendor: Array<{ source: string; key: string; value: number; label: 'vendor_opinion' }> = [];
    const put = (k: string, value: number, unit: string, sk: string, metric: string) => {
      if (keep(k)) values[k] = { value: round(value), unit, source: label(sk), sourceKey: key(sk), tier: tierOf(ix, sk, day, metric), basis: day.basisByMetric[metric] ?? 'device' };
    };
    const correctionIds = new Set(day.corrections.map((c) => c.correctionId));
    const d = day.daily;
    for (const g of DAILY_GROUPS) {
      const sk = day.sourceByMetric[g.metric];
      if (!sk || !d) continue;
      if (!policyFor(ix, sk, g.stream).imported) continue;
      if (!coachSees(ix, ctx, sk, g.stream)) {
        hidden.add(g.stream);
        continue;
      }
      if (g.metric === 'vendor') {
        for (const [key, v] of Object.entries(d.vendor ?? {})) {
          const num = typeof v === 'number' ? v : (v as { value?: number } | undefined)?.value;
          if (typeof num === 'number' && keep('vendor')) vendor.push({ source: label(sk), key, value: num, label: 'vendor_opinion' });
        }
        continue;
      }
      if (g.metric === 'hrv' && d.hrv) {
        if (d.hrv.metric === 'vendor') {
          if (policyFor(ix, sk, 'vendor_scores').imported && coachSees(ix, ctx, sk, 'vendor_scores') && keep('vendor')) vendor.push({ source: label(sk), key: 'hrv', value: d.hrv.value_ms, label: 'vendor_opinion' });
        } else put(`hrv_${d.hrv.metric}_ms`, d.hrv.value_ms, 'ms', sk, 'hrv');
        continue;
      }
      if (g.metric === 'vo2max' && d.vo2max) {
        if (d.vo2max.method === 'vendor_estimate') {
          if (policyFor(ix, sk, 'vendor_scores').imported && coachSees(ix, ctx, sk, 'vendor_scores') && keep('vendor')) vendor.push({ source: label(sk), key: 'vo2max', value: d.vo2max.ml_kg_min, label: 'vendor_opinion' });
        } else put('vo2max_ml_kg_min', d.vo2max.ml_kg_min, 'ml/kg/min', sk, 'vo2max');
        continue;
      }
      if (g.metric === 'active_min' && d.active_min) {
        for (const lvl of ['light', 'moderate', 'vigorous'] as const) put(`active_min_${lvl}`, d.active_min[lvl], 'min', sk, 'active_min');
        continue;
      }
      for (const f of g.fields) {
        const v = d[f];
        if (typeof v === 'number') put(f, v, FIELD_UNITS[f] ?? '', sk, g.metric);
      }
    }
    for (const s of day.spots) {
      const metric = `spot:${s.metric}`;
      const sk = day.sourceByMetric[metric];
      if (!sk || (!correctionIds.has(s.record_id) && sk !== sourceKeyFor(ix, s))) continue;
      const stream = streamOfMetric(metric);
      if (!policyFor(ix, sk, stream).imported) continue;
      if (!coachSees(ix, ctx, sk, stream)) {
        hidden.add(stream);
        continue;
      }
      put(s.metric, s.value, SPOT_UNITS[s.metric] ?? '', sk, metric); // the last value of the day wins (spots are ascending)
    }
    let sleep: (ReturnType<typeof sleepView> & { basis: Basis }) | undefined;
    const ssk = day.sourceByMetric['sleep'];
    if (day.mainSleep && ssk && policyFor(ix, ssk, 'sleep_sessions').imported) {
      if (coachSees(ix, ctx, ssk, 'sleep_sessions')) {
        if (keep('sleep')) sleep = { ...sleepView(day.mainSleep, label(ssk), tierOf(ix, ssk, day, 'sleep')), basis: day.basisByMetric['sleep'] ?? 'device' };
      } else hidden.add('sleep_sessions');
    }
    const wsk = day.sourceByMetric['workouts'];
    const workouts: Array<{ type: string; start?: string; durationMin: number; activeKcal?: number; avgHrBpm?: number; source: string }> = [];
    if (wsk && day.workouts.length && policyFor(ix, wsk, 'workouts').imported) {
      if (coachSees(ix, ctx, wsk, 'workouts')) {
        if (keep('workouts'))
          for (const w of day.workouts)
            workouts.push({
              type: w.exercise_type,
              ...(w.time.start ? { start: w.time.start } : {}),
              durationMin: round(w.active_duration_s / 60, 1),
              ...(w.active_kcal !== undefined ? { activeKcal: round(w.active_kcal, 0) } : {}),
              ...(w.hr_avg_bpm !== undefined ? { avgHrBpm: round(w.hr_avg_bpm, 0) } : {}),
              source: label(wsk),
            });
      } else hidden.add('workouts');
    }
    if (Object.keys(values).length === 0 && !sleep && workouts.length === 0 && vendor.length === 0) continue;
    out.push({ date: day.localDate, values, ...(sleep ? { sleep } : {}), workouts, vendor });
  }
  return { days: out, hidden: [...hidden].sort() };
}

function sourceKeyFor(ix: BioDocIndex, r: BioRecord): string {
  const id = ix.latest.get(r.record_id);
  return (id && ix.recDocs.get(id)?.sourceKey) || sourceKeyOf(r.provenance);
}

function sleepView(s: SleepRecord, source: string, tier: DeviceTier) {
  const h = (x: number | undefined) => (x === undefined ? undefined : round(x / 3600));
  const o: Record<string, unknown> = { asleepH: h(s.asleep_s)!, source, tier };
  if (s.in_bed_s !== undefined) o.inBedH = h(s.in_bed_s);
  if (s.time.start) o.bedAt = s.time.start;
  if (s.time.end) o.wakeAt = s.time.end;
  if (s.efficiency_pct !== undefined) o.efficiencyPct = round(s.efficiency_pct, 1);
  if (s.deep_s !== undefined) o.deepH = h(s.deep_s);
  if (s.rem_s !== undefined) o.remH = h(s.rem_s);
  if (s.light_s !== undefined) o.lightH = h(s.light_s);
  if (s.awake_s !== undefined) o.awakeH = h(s.awake_s);
  return o as { asleepH: number; source: string; tier: DeviceTier };
}

/* =============================================================================== bio.series */

interface SeriesIn {
  metric: string;
  from?: LocalDate;
  to?: LocalDate;
  resolution?: 'raw' | 'hour' | 'day';
}

const MAX_RAW = 5000;

export async function series(ctx: CommandContext, input: SeriesIn) {
  const stream = input.metric as BioStream;
  if (!(RAW_STREAMS as readonly string[]).includes(stream) && !/^vendor:[a-z0-9_.-]+$/i.test(stream))
    fail('invalid_input', `“${input.metric}” is not a device stream. Use one of: ${RAW_STREAMS.join(', ')}.`, { path: '/metric' });
  const res = input.resolution;
  const span = res === 'day' ? 28 : res === 'hour' ? 7 : 1;
  const { from, to } = range(ctx, input, span, 366);
  const resolution: 'raw' | 'hour' | 'day' = res ?? (from === to ? 'raw' : daysBetween(from, to) < 14 ? 'hour' : 'day');
  const ix = await bioIndex();
  const store = await openBioStore();
  // one source per day: the first source in the fixed device order that has samples that day
  const samples = await store.samples({ stream, from: addDays(from, -1), to: addDays(to, 1) });
  const visible = (sk: string) => policyFor(ix, sk, stream).imported && coachSees(ix, ctx, sk, stream, 'series');
  const anyHidden = samples.some((s) => !visible(s.sourceKey));
  const tierRank = (sk: string) => ({ A: 0, B: 1, C: 2 })[ix.source(sk)?.tier ?? 'C'];
  const byDay = new Map<LocalDate, Map<string, typeof samples>>();
  for (const s of samples) {
    if (!visible(s.sourceKey)) continue;
    const d = localDateOf(s.t, ctx.tz);
    if (d < from || d > to) continue;
    let m = byDay.get(d);
    if (!m) byDay.set(d, (m = new Map()));
    const a = m.get(s.sourceKey);
    if (a) a.push(s);
    else m.set(s.sourceKey, [s]);
  }
  const chosen: Array<{ t: number; value: number; sourceKey: string }> = [];
  for (const d of [...byDay.keys()].sort()) {
    const m = byDay.get(d)!;
    // the fixed device order (SUITE_SPEC §14.6): tier, then more samples that day, then source key
    const sk = [...m.keys()].sort((a, b) => tierRank(a) - tierRank(b) || m.get(b)!.length - m.get(a)!.length || a.localeCompare(b))[0]!;
    for (const s of m.get(sk)!) if (!s.quality) chosen.push({ t: s.t, value: s.value, sourceKey: sk });
  }
  chosen.sort((a, b) => a.t - b.t);
  let points: Array<{ t: string; value: number; min?: number; max?: number; n: number; source: string }>;
  let truncated = false;
  if (resolution === 'raw') {
    const slice = chosen.length > MAX_RAW ? chosen.slice(-MAX_RAW) : chosen;
    truncated = chosen.length > MAX_RAW;
    points = slice.map((s) => ({ t: new Date(s.t).toISOString(), value: round(s.value, 3), n: 1, source: labelOf(ix, s.sourceKey, isAgent(ctx)) }));
  } else {
    const buckets = new Map<string, { sum: number; n: number; min: number; max: number; sk: string }>();
    for (const s of chosen) {
      const key = resolution === 'day' ? localDateOf(s.t, ctx.tz) : `${new Date(s.t).toISOString().slice(0, 13)}:00:00.000Z`;
      const b = buckets.get(key);
      if (b) {
        b.sum += s.value;
        b.n++;
        b.min = Math.min(b.min, s.value);
        b.max = Math.max(b.max, s.value);
      } else buckets.set(key, { sum: s.value, n: 1, min: s.value, max: s.value, sk: s.sourceKey });
    }
    points = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, b]) => ({ t, value: round(stream === 'steps' || stream === 'distance' || stream === 'active_kcal' ? b.sum : b.sum / b.n, 2), min: round(b.min, 2), max: round(b.max, 2), n: b.n, source: labelOf(ix, b.sk, isAgent(ctx)) }));
  }
  return { metric: stream, unit: CANONICAL_UNIT[stream] ?? '', resolution, points, truncated, hidden: anyHidden && isAgent(ctx) };
}

/* =============================================================================== bio.baselines */

const BASELINE_DAYS = 60;
const BASELINE_MIN = 14;

export async function baselines(ctx: CommandContext) {
  const ix = await bioIndex();
  const to = ctx.today;
  const from = addDays(to, -(BASELINE_DAYS - 1));
  const days = resolveDays(sourced(ix, from, to), ix.sources(), { from, to }, ix.corrections());
  const hidden = new Set<string>();
  const specs: Array<{ metric: string; unit: string; key: string; stream: PolicyStream; get: (d: ResolvedDay) => number | undefined }> = [
    { metric: 'resting_hr_bpm', unit: 'bpm', key: 'resting_hr_bpm', stream: 'hr', get: (d) => d.daily?.resting_hr_bpm },
    { metric: 'hrv_rmssd_ms', unit: 'ms', key: 'hrv', stream: 'hrv', get: (d) => (d.daily?.hrv?.metric === 'rmssd' ? d.daily.hrv.value_ms : undefined) },
    { metric: 'sleep_h', unit: 'h', key: 'sleep', stream: 'sleep_sessions', get: (d) => (d.mainSleep ? d.mainSleep.asleep_s / 3600 : undefined) },
    { metric: 'skin_temp_delta_c', unit: '°C', key: 'skin_temp', stream: 'skin_temp', get: (d) => d.daily?.skin_temp_delta_c },
    { metric: 'spo2_avg_pct', unit: '%', key: 'spo2', stream: 'spo2', get: (d) => d.daily?.spo2_avg_pct },
  ];
  const out = [];
  for (const spec of specs) {
    const rows = days.map((d) => ({ d, sk: d.sourceByMetric[spec.key], v: spec.get(d) })).filter((r) => r.sk && r.v !== undefined && Number.isFinite(r.v));
    if (rows.length === 0) continue;
    const current = rows[rows.length - 1]!.sk!;
    if (!policyFor(ix, current, spec.stream).imported) continue;
    if (!coachSees(ix, ctx, current, spec.stream)) {
      hidden.add(spec.stream);
      continue;
    }
    // a new device starts a new normal range: values of the current source since its latest epoch
    const epochs = [...(ix.source(current)?.baselineEpochs ?? [])].filter((e) => e <= to).sort();
    const since = epochs.length ? epochs[epochs.length - 1]! : rows[0]!.d.localDate;
    const vals = rows.filter((r) => r.sk === current && r.d.localDate >= since).map((r) => r.v!);
    if (vals.length < 3) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1));
    const dec = spec.unit === 'h' || spec.unit === '°C' ? 2 : 1;
    out.push({
      metric: spec.metric, unit: spec.unit, mean: round(mean, dec), lo: round(mean - 0.5 * sd, dec), hi: round(mean + 0.5 * sd, dec), nights: vals.length,
      forming: vals.length < BASELINE_MIN, since: since < from ? from : since, source: labelOf(ix, current, isAgent(ctx)), tier: tierOf(ix, current),
    });
  }
  return { baselines: out, hidden: [...hidden].sort() };
}

/* =============================================================================== bio.sources */

export async function sources(ctx: CommandContext) {
  const ix = await bioIndex();
  // an agent learns only what the Coach sees: a source with no stream shared is left out, a partly shared one lists and
  // counts its shared streams only (L-REV2 R3-12); a ring is named from the table, its key is the alias (R3-10, R3-11)
  const agent = isAgent(ctx);
  const alias = agent ? ringAliases(ix.sources()) : (sk: string) => sk;
  const seen = new Map<string, boolean>();
  const shared = (sk: string, stream: string): boolean => {
    if (!agent) return true;
    const k = `${sk}\u0000${stream}`;
    let v = seen.get(k);
    if (v === undefined) seen.set(k, (v = coachSees(ix, ctx, sk, stream as PolicyStream)));
    return v;
  };
  const stats = new Map<string, { n: number; first: LocalDate | null; last: LocalDate | null; streams: Set<string> }>();
  const stat = (sk: string) => {
    let s = stats.get(sk);
    if (!s) stats.set(sk, (s = { n: 0, first: null, last: null, streams: new Set() }));
    return s;
  };
  const see = (s: { first: LocalDate | null; last: LocalDate | null }, d: LocalDate) => {
    if (!s.first || d < s.first) s.first = d;
    if (!s.last || d > s.last) s.last = d;
  };
  for (const e of ix.latestRecords()) {
    if (!shared(e.sourceKey, policyStreamOf(e.record))) continue;
    const s = stat(e.sourceKey);
    s.n++;
    see(s, e.record.time.local_date);
  }
  for (const m of ix.chunks.values()) {
    if (m.superseded || !shared(m.sourceKey, m.stream)) continue;
    const s = stat(m.sourceKey);
    s.streams.add(m.stream);
    see(s, m.local_date);
  }
  const rows = ix
    .sources()
    .map((src) => ({ src, streams: [...new Set<string>([...(stats.get(src.sourceKey)?.streams ?? []), ...src.policies.map((p) => p.stream)])].filter((st) => shared(src.sourceKey, st)) }))
    .filter((r) => !agent || r.streams.length > 0);
  const list = rows.map(({ src, streams }) => {
    const s = stats.get(src.sourceKey);
    const sourceKey = alias(src.sourceKey);
    return {
      sourceKey,
      // a ring's label is the table's for everyone (no one renames a source); a driver the table does not know keeps the
      // stored one for the person only (R1 minor 9)
      label: ringSourceLabel(src, agent ? undefined : src.label) ?? src.label,
      tier: src.tier,
      kind: src.deviceType ?? ix.deviceTypes.get(src.sourceKey) ?? (src.sourceKey === 'manual' ? 'manual' : 'unknown'),
      channel: sourceKey.split('|')[0]!,
      policies: src.policies.filter((p) => shared(src.sourceKey, p.stream)).map(normalizePolicy),
      streams: streams.sort(),
      records: s?.n ?? 0,
      firstDate: s?.first ?? null,
      lastDate: s?.last ?? null,
      baselineEpochs: [...(src.baselineEpochs ?? [])],
      driver: src.ble?.driver ?? null,
      lastSyncAt: src.ble?.lastSyncAt ?? null,
      battery: src.ble?.battery ?? null,
    };
  });
  list.sort((a, b) => a.tier.localeCompare(b.tier) || a.sourceKey.localeCompare(b.sourceKey));
  // the Ring page's master switch reads `ringSharing`; `ringDefaultsNotice` is its one-time notice (./sharing.ts). For an
  // agent the switch reads over the sources listed, so a ring it cannot see does not show as "off"; the notice is the
  // person's
  return { sources: list, policies: ix.personPolicies.map(normalizePolicy), ringSharing: ringSharing(rows.map((r) => r.src)), ringDefaultsNotice: !agent && ringDefaultsNotice(ix) };
}

/* =============================================================================== bio.scores */

interface ScoresIn {
  from?: LocalDate;
  to?: LocalDate;
  scoreIds?: string[];
}

export async function scores(ctx: CommandContext, input: ScoresIn) {
  const ix = await bioIndex();
  const { from, to } = range(ctx, input, 7);
  const want = input.scoreIds?.length ? new Set(input.scoreIds) : null;
  const matrix = personMatrix(ix.personPolicies);
  const hidden = new Set<string>();
  const newest = new Map<string, ScoreResult>();
  for (const r of ix.scores()) {
    if (r.scope.localDate < from || r.scope.localDate > to) continue;
    if (want && !want.has(r.scoreId)) continue;
    const k = `${r.scoreId}|${r.scope.kind}|${r.scope.localDate}|${r.scope.workoutId ?? ''}`;
    const p = newest.get(k);
    if (!p || compareVersions(r.version, p.version) > 0) newest.set(k, r);
  }
  const results = [];
  for (const r of [...newest.values()].sort((a, b) => a.scope.localDate.localeCompare(b.scope.localDate) || a.scoreId.localeCompare(b.scoreId))) {
    const def = getScoreDef(r.scoreId, r.version) ?? getScoreDef(r.scoreId);
    const sk = scoreSource(ix, r);
    // the score's own source decides (a ring's defaults let the Coach see it); without one, the person's matrix. A score
    // this build does not know has no streams to check: an agent does not get it (L-REV2 R3-12)
    const sees = (s: PolicyStream) => (sk ? coachSees(ix, ctx, sk, s) : matrix[s]?.imported && matrix[s]?.coach !== 'hidden');
    if (isAgent(ctx) && (!def || !def.optInStreams.every(sees))) {
      hidden.add(r.scoreId);
      continue;
    }
    results.push({
      scoreId: r.scoreId,
      title: def?.title ?? r.scoreId,
      version: r.version,
      scope: { kind: r.scope.kind, localDate: r.scope.localDate },
      status: r.status,
      value: r.value === null || !Number.isFinite(r.value) ? null : round(r.value, 3),
      unit: def?.output.unit ?? '',
      ...(r.state !== undefined ? { state: r.state } : {}),
      ...(r.reason !== undefined ? { reason: r.reason } : {}),
      ...(r.band && Number.isFinite(r.band.lo) && Number.isFinite(r.band.hi) ? { band: { lo: round(r.band.lo, 3), hi: round(r.band.hi, 3), level: r.band.level } } : {}),
      confidence: r.confidence,
      label: def?.label ?? 'measurement',
      source: sk ? labelOf(ix, sk, isAgent(ctx)) : null,
      tier: sk ? tierOf(ix, sk) : typeof r.detail?.['tier'] === 'string' ? (r.detail['tier'] as DeviceTier) : null,
      ...(r.sourceIds.some((id) => id.startsWith('corr:')) ? { corrected: true } : {}),
    });
  }
  return { results, hidden: [...hidden].sort() };
}

/** The source a score result came from: its `detail.sourceKey`, else the source of its first record id. */
export function scoreSource(ix: BioDocIndex, r: ScoreResult): string | null {
  const d = r.detail?.['sourceKey'];
  if (typeof d === 'string' && ix.source(d)) return d;
  for (const id of r.sourceIds) {
    const e = ix.recDocs.get(id) ?? (ix.latest.get(id) ? ix.recDocs.get(ix.latest.get(id)!) : undefined);
    if (e) return e.sourceKey;
    if (ix.source(id)) return id;
  }
  return null;
}

/* =============================================================================== bio.manual */

interface ManualIn {
  date: LocalDate;
  metric: string;
  value: number;
  at?: string;
  note?: string;
}

const SPOT_METRICS: readonly SpotMetric[] = ['weight_kg', 'body_fat_pct', 'lean_mass_kg', 'waist_cm', 'bp_sys_mmhg', 'bp_dia_mmhg', 'glucose_mg_dl', 'body_temp_c', 'hr_bpm', 'spo2_pct', 'hrv_ms'];
const MANUAL_DAILY = ['steps', 'resting_hr_bpm', 'active_kcal', 'distance_m', 'vo2max', 'vo2max_lab', 'sleep_h'] as const;
const MANUAL_ALIASES: Record<string, string> = { weight: 'weight_kg', body_fat: 'body_fat_pct', waist: 'waist_cm', resting_hr: 'resting_hr_bpm', hrv: 'hrv_ms', spo2: 'spo2_pct', temperature: 'body_temp_c', sleep: 'sleep_h' };

export const MANUAL_SOURCE = 'manual';

export async function manual(ctx: CommandContext, input: ManualIn) {
  const metric = MANUAL_ALIASES[input.metric] ?? input.metric;
  const isSpot = (SPOT_METRICS as readonly string[]).includes(metric);
  if (!isSpot && !(MANUAL_DAILY as readonly string[]).includes(metric))
    fail('invalid_input', `Vitals can't store “${input.metric}” by hand. Use one of: ${[...SPOT_METRICS, ...MANUAL_DAILY].join(', ')}.`, { path: '/metric' });
  if (input.date > ctx.today) fail('invalid_input', 'That date is in the future.', { path: '/date' });
  const store = await openBioStore({ writer: commandWriter(ctx.docs) });
  const ix = await bioIndex();
  const atIso = input.at ?? (input.date === ctx.today ? ctx.now : `${input.date}T12:00:00.000Z`);
  const tz_offset_s = tzOffsetSeconds(Date.parse(atIso), ctx.tz);
  const flags = isAgent(ctx) ? (['ai_extracted'] as const) : ([] as const);
  const provenance: BioProvenance = {
    channel: 'manual', recording_method: 'manual', modality: 'self_reported', ingested_at: ctx.now, device: { type: 'manual', tier: 'C' },
    ...(input.note ? { native_version: input.note.slice(0, 120) } : {}),
  };
  const quality = { validation: 'self_reported' as const, confidence: null, flags: [...flags] };
  let rec: BioRecord;
  let stream: PolicyStream;
  if (isSpot) {
    rec = {
      kind: 'spot', record_id: recordId({ source: MANUAL_SOURCE, kind: 'spot', metric, start: atIso }), version: 1,
      time: { at: atIso, tz_offset_s, local_date: input.date }, provenance, quality, metric: metric as SpotMetric, value: input.value,
    } satisfies SpotRecord;
    stream = streamOfMetric(`spot:${metric}`);
  } else if (metric === 'sleep_h') {
    if (!(input.value > 0 && input.value <= 24)) fail('invalid_input', 'Hours asleep must be between 0 and 24.', { path: '/value' });
    rec = {
      kind: 'sleep', record_id: recordId({ source: MANUAL_SOURCE, kind: 'sleep', metric: 'main', start: input.date }), version: 1,
      time: { tz_offset_s, local_date: input.date }, provenance, quality, is_main: true, asleep_s: Math.round(input.value * 3600),
    } satisfies SleepRecord;
    stream = 'sleep_sessions';
  } else {
    const field = metric === 'vo2max' || metric === 'vo2max_lab' ? 'vo2max' : metric;
    const body: Partial<DailyRecord> =
      field === 'vo2max' ? { vo2max: { ml_kg_min: input.value, method: metric === 'vo2max_lab' ? 'lab' : 'field_test' } } : { [field]: input.value };
    rec = {
      kind: 'daily', record_id: recordId({ source: MANUAL_SOURCE, kind: 'daily', metric: field, start: input.date }), version: 1,
      time: { tz_offset_s, local_date: input.date }, provenance, quality, ...body,
    } as DailyRecord;
    stream = streamOfMetric(field === 'vo2max' ? 'vo2max' : field);
  }
  // an earlier value for the same record (same metric and day, or the same instant) is replaced by a new version
  const prev = ix.latestVersion(rec.record_id);
  if (prev !== undefined) rec = { ...rec, version: prev + 1 } as BioRecord;
  const chk = validateBatch({ schema: BIO_SCHEMA, producer: { name: 'vitals-manual', version: '1' }, exported_at: ctx.now, tz: ctx.tz, records: [rec] });
  if (!chk.batch || chk.batch.records.length !== 1 || chk.rejected.length) fail('invalid_input', `That value is outside what a body can measure (${[...chk.rejected, ...chk.warnings].join('; ') || input.metric}).`, { path: '/value' });
  const stored = chk.batch.records[0]!;
  if ((stored.quality.flags ?? []).includes('out_of_range')) fail('invalid_input', 'That value is outside what a body can measure.', { path: '/value' });
  const person = ix.personPolicies;
  const pol = effectivePolicy({ policies: [] }, person, stream);
  if (!pol.imported) fail('precondition_failed', 'You chose not to bring this kind of data into Vitals. Change it in Settings › Devices first.', { rule: `policy:${stream}` });
  await store.putRecord(stored, MANUAL_SOURCE);
  const src = await store.getSource(MANUAL_SOURCE);
  if (!src) {
    const doc: BioSourceDoc = {
      sourceKey: MANUAL_SOURCE, label: 'Entered by hand', tier: 'C',
      policies: adoptPersonPolicies(suggestedPolicies([stream]), person), baselineEpochs: [input.date],
    };
    await store.putSource(doc);
    await store.patchSource(MANUAL_SOURCE, { deviceType: 'manual', createdAt: ctx.now });
  } else if (!src.policies.some((p) => p.stream === stream)) {
    await store.putSource({ ...src, policies: [...src.policies, ...adoptPersonPolicies(suggestedPolicies([stream]), person)] });
  }
  await store.flush();
  scheduleRescore(input.date);
  return { recordId: stored.record_id };
}

/* =============================================================================== bio.setPolicy */

interface PolicyIn {
  stream: string;
  policy: { stream?: string; imported?: boolean; coach?: StreamPolicy['coach']; engine?: boolean; scores?: boolean };
  sourceKey?: string;
}

export async function setPolicy(ctx: CommandContext, input: PolicyIn) {
  const stream = policyStreamId(input.stream);
  if (!stream) fail('invalid_input', `“${input.stream}” is not a stream Vitals knows.`, { path: '/stream' });
  if (input.policy.stream !== undefined && policyStreamId(input.policy.stream) !== stream) fail('invalid_input', 'policy.stream must match stream.', { path: '/policy/stream' });
  const store = await openBioStore({ writer: commandWriter(ctx.docs) });
  const ix = await bioIndex();
  const person = await store.personPolicies();
  const { stream: _s, ...patch } = input.policy;
  void _s;
  // with any source, data of a stream nobody set follows the device-on suggestion, so a single-field change starts there;
  // when every device source is a ring, it starts from what the rings hold (the ring defaults unless changed)
  const all = await store.sources();
  const hasData = all.length > 0;
  const devices = all.filter((s) => s.sourceKey !== MANUAL_SOURCE && s.sourceKey !== CORRECTION_SOURCE);
  const ringOnly = devices.length > 0 && devices.every((s) => isRingSource(s));
  const ringStart = ringOnly ? (devices.map((s) => s.policies.find((p) => p.stream === stream)).find((p) => p !== undefined) ?? ringDefaultPolicy(stream)) : null;
  let result: StreamPolicy[];
  let before: StreamPolicy;
  let after: StreamPolicy;
  if (input.sourceKey) {
    const src = await store.getSource(input.sourceKey);
    if (!src) fail('not_found', 'No such source.', { path: '/sourceKey' });
    before = effectivePolicy(src, person, stream);
    after = normalizePolicy({ ...before, ...patch, stream });
    result = withPolicy(src.policies, after);
    await store.putSource({ ...src, policies: result });
  } else {
    before = person.find((p) => p.stream === stream) ?? (ringStart ? normalizePolicy({ ...ringStart, stream }) : hasData ? suggestedOnPolicy(stream) : effectivePolicy(null, person, stream));
    after = normalizePolicy({ ...before, ...patch, stream });
    result = withPolicy(person, after);
    await store.putPersonPolicies(result, ctx.now);
    // the person's choice applies to every source that brings this stream in
    for (const src of await store.sources()) {
      const own = src.policies.find((p) => p.stream === stream);
      if (own && JSON.stringify(normalizePolicy(own)) !== JSON.stringify(after)) await store.putSource({ ...src, policies: withPolicy(src.policies, after) });
    }
  }
  await store.flush();
  const asked = { ...before, ...patch };
  if ((asked.engine && !after.engine) || (asked.scores && !after.scores) || (asked.coach !== 'hidden' && after.coach === 'hidden' && patch.coach !== undefined)) {
    ctx.notice({
      level: 'info',
      text: !after.imported ? 'Bring this stream in first; nothing else can use it until then.' : stream === 'vendor_scores' || stream.startsWith('vendor:') ? 'Vendor scores are shown as the vendor’s opinion only; they never feed your scores or plan.' : 'This stream can’t feed your plan.',
    });
  }
  if (before.scores !== after.scores || before.imported !== after.imported) scheduleRescore(addDays(ctx.today, -89));
  void ix;
  return result;
}

/* =============================================================================== rescoring */

let rescoreChain: Promise<unknown> = Promise.resolve();

export interface RescoreRun {
  from?: LocalDate | null;
  to?: LocalDate;
  mode: 'missing' | 'verify';
  scoreIds?: readonly string[];
}

function scoreProfileNow(): Promise<ScoreProfile> {
  return import('@/state/profileStore')
    .then(({ useProfileStore }) => {
      const s = useProfileStore.getState() as unknown as { setup?: string; sex?: string; ageYears?: number; heightCm?: number; weightKg?: number };
      if (!s.setup || s.setup === 'basics') return {};
      const p: ScoreProfile = {};
      if (s.sex === 'male' || s.sex === 'female') p.sex = s.sex;
      if (typeof s.ageYears === 'number') p.ageY = s.ageYears;
      if (typeof s.heightCm === 'number') p.heightCm = s.heightCm;
      if (typeof s.weightKg === 'number') p.massKg = s.weightKg;
      return p;
    })
    .catch(() => ({}));
}

/** Defs to run: the catalogue (every version side by side) the person's matrix allows, plus dependencies of a subset. */
function defsFor(person: readonly StreamPolicy[], scoreIds?: readonly string[]) {
  const matrix = personMatrix(person);
  let defs = SCORE_CATALOGUE.filter((d) => scoreAllowed(d, matrix));
  if (scoreIds?.length) {
    const want = new Set(scoreIds);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of defs) if (want.has(d.scoreId)) for (const dep of d.dependsOn ?? []) if (!want.has(dep)) {
        want.add(dep);
        grew = true;
      }
    }
    defs = defs.filter((d) => want.has(d.scoreId));
  }
  return defs;
}

/** Days whose input could not be read yet: tried again a minute later, a few times (a chunk may still be uploading). */
const unavailableTries = new Map<LocalDate, number>();
export const RESCORE_RETRY_MS = 60_000;
const RESCORE_RETRIES = 5;
function retryUnavailable(days: readonly LocalDate[] | undefined): void {
  let from: LocalDate | null = null;
  for (const d of days ?? []) {
    const n = (unavailableTries.get(d) ?? 0) + 1;
    unavailableTries.set(d, n);
    if (n <= RESCORE_RETRIES && (from === null || d < from)) from = d;
  }
  if (from) scheduleRescore(from, RESCORE_RETRY_MS);
}

/** Rescore with an open store (the caller flushes). Runs one at a time; sets `bioActivity.rescoring`. */
export function runRescore(store: DocBioStore, o: RescoreRun, ctx: { today: LocalDate; now: string; tz: string; signal?: AbortSignal; jobId: string; onProgress?: (p: number) => void }): Promise<RescoreReport> {
  const run = async (): Promise<RescoreReport> => {
    const ix = await bioIndex();
    const dates = ix.dates();
    const empty: RescoreReport = { planned: 0, computed: 0, written: 0, skipped: 0, aborted: false };
    if (dates.length === 0) return empty;
    const from = o.from ?? dates[0]!;
    const last = dates[dates.length - 1]!;
    const to = o.to ?? (last > ctx.today ? last : ctx.today);
    const defs = defsFor(await store.personPolicies(), o.scoreIds);
    if (defs.length === 0 || from > to) return empty;
    const versions = [...new Set(defs.map((d) => `v${d.version.split('.').slice(0, 2).join('.')}`))];
    bioActivity.set({ rescoring: { jobId: ctx.jobId, progress: 0, from, to, versions: versions.length === 1 ? versions : [] } });
    try {
      const rep = await rescoreHistory(store, {
        defs, from, to, now: ctx.now, build: BUILD, tz: ctx.tz, profile: await scoreProfileNow(), mode: o.mode, ...(ctx.signal ? { signal: ctx.signal } : {}),
        onProgress: (p) => {
          const f = p.total ? p.done / p.total : 1;
          ctx.onProgress?.(f);
          const cur = bioActivity.get().rescoring;
          if (cur?.jobId === ctx.jobId) bioActivity.set({ rescoring: { ...cur, progress: f } });
        },
      });
      await store.flush();
      retryUnavailable(rep.unavailable);
      return rep;
    } finally {
      if (bioActivity.get().rescoring?.jobId === ctx.jobId) bioActivity.set({ rescoring: null });
    }
  };
  const p = rescoreChain.then(run, run);
  rescoreChain = p.catch(() => undefined);
  return p;
}

let pruned = false;

export function rescore(ctx: CommandContext, input: { scoreIds?: string[]; from?: LocalDate }): JobRef {
  const mode: 'missing' | 'verify' = input.from || input.scoreIds?.length ? 'verify' : 'missing';
  return ctx.jobs.start('rescore', async (h) => {
    const store = await openBioStore({ writer: deriveWriter(undefined, 'rescore') });
    // once per session: sample chunks an older build kept after merging, and files no chunk names, go (Q9-3)
    if (!pruned) {
      pruned = true;
      await store.pruneSuperseded().catch(() => undefined);
    }
    return runRescore(store, { from: input.from ?? null, mode, ...(input.scoreIds ? { scoreIds: input.scoreIds } : {}) }, {
      today: ctx.today, now: ctx.now, tz: ctx.tz, signal: h.signal, jobId: h.jobId, onProgress: (p) => h.progress(p, 'scoring'),
    });
  });
}

/* =============================================================================== bio.import */

interface ImportIn {
  fileRef: string;
  format?: string;
}

const FORMATS = ['apple_health', 'health_connect', 'health_auto_export', 'gadgetbridge', 'canonical', 'lumen_cloudevents', 'lumen_archive'] as const;
type Format = (typeof FORMATS)[number];

async function importerFor(format: Format, p: BioPorts): Promise<BiometricsImporter> {
  switch (format) {
    case 'apple_health':
      return (await import('@/biometrics/importers/appleHealth')).appleHealthImporter;
    case 'health_auto_export':
      return (await import('@/biometrics/importers/healthAutoExport')).healthAutoExportImporter;
    case 'lumen_cloudevents':
      return (await import('@/biometrics/importers/lumenCloudEvents')).lumenCloudEventsImporter;
    case 'lumen_archive':
      return (await import('@/biometrics/importers/lumenArchive')).lumenArchiveImporter;
    case 'canonical':
      return (await import('@/biometrics/importers/canonical')).canonicalImporter;
    case 'health_connect':
      return (await import('@/biometrics/importers/healthConnect')).createHealthConnectImporter(p.openSqlite ? { openSqlite: p.openSqlite } : {});
    case 'gadgetbridge':
      return (await import('@/biometrics/importers/gadgetbridge')).createGadgetbridgeImporter(p.openSqlite ? { openSqlite: p.openSqlite } : {});
  }
}

/** Format of a file from its first bytes and name (the person may also say which). */
export async function detectFormat(blob: Blob, name: string): Promise<Format | null> {
  const head = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
  const text = new TextDecoder().decode(head);
  const lower = name.toLowerCase();
  if (isSqliteHead(head)) return /gadgetbridge/i.test(lower) ? 'gadgetbridge' : 'health_connect';
  if (isZipHead(head)) {
    try {
      const { listZipEntries } = await import('@/biometrics/importers/zipStream');
      const names = (await listZipEntries(blob)).map((e) => e.name.toLowerCase());
      if (names.some((n) => n.endsWith('export.xml'))) return 'apple_health';
      if (names.some((n) => /gadgetbridge/.test(n))) return 'gadgetbridge';
      if (names.some((n) => n.endsWith('.db') || n.endsWith('.json'))) return 'health_connect';
    } catch {
      return null;
    }
    return null;
  }
  if (text.includes('<HealthData') || lower.endsWith('.xml')) return 'apple_health';
  if (/"specversion"\s*:/.test(text) && /"type"\s*:\s*"health\./.test(text)) return 'lumen_cloudevents';
  if (/^\s*\{/.test(text) && /"formatVersion"\s*:/.test(text) && /"appVersion"\s*:/.test(text)) return 'lumen_archive';
  if (/^\s*\{/.test(text) && /"tables"\s*:/.test(text)) return /_record_table"/.test(text) ? 'health_connect' : 'gadgetbridge';
  if (/^\s*\{/.test(text) && /"(metrics|workouts)"\s*:/.test(text)) return 'health_auto_export';
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (/^kind\s*,/i.test(t) || ((t.startsWith('{') || t.startsWith('[')) && (t.includes('vitals.biometrics/1') || /"kind"\s*:/.test(t)))) return 'canonical';
  if (isJsonHead(head)) return null;
  return null;
}

/** True when the file needs a SQLite engine this build does not have. */
async function needsSqlite(blob: Blob, format: Format, p: BioPorts): Promise<boolean> {
  if (p.openSqlite || (format !== 'health_connect' && format !== 'gadgetbridge')) return false;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (isSqliteHead(head)) return true;
  if (isZipHead(head)) {
    try {
      const { listZip } = await import('@/biometrics/importers/zipReader');
      const names = (await listZip(blob)).map((e) => e.name.toLowerCase());
      return !names.some((n) => n.endsWith('.json')) && names.some((n) => /\.(db|sqlite|sqlite3)$/.test(n));
    } catch {
      return false;
    }
  }
  return false;
}

async function* withPolicy$(batches: AsyncIterable<BioBatch> | Iterable<BioBatch>, person: readonly StreamPolicy[]): AsyncGenerator<BioBatch> {
  for await (const b of batches) yield applyImportPolicy(b, person);
}

/** Ingest, adopt the person's choices on new sources (a new ring follows the master switch), rescore what changed. */
async function ingestAndScore(
  store: DocBioStore,
  batches: AsyncIterable<BioBatch> | Iterable<BioBatch>,
  ctx: { today: LocalDate; now: string; tz: string; signal: AbortSignal; jobId: string; progress: (p: number, stage: string) => void },
): Promise<{ rep: IngestOutcome; scored: number }> {
  const person = await store.personPolicies();
  const before = new Set((await store.sources()).map((s) => s.sourceKey));
  const ix = await bioIndex();
  const ringSharing = storedRingChoice(ix);
  const fold = lumenFold(ringFoldOf(ix.sourceDocs.get(RING_FOLD_ID)));
  const rep = await ingestBatches(withPolicy$(batches, person), store, { now: ctx.now, policies: importPolicies(person), ringSharing, ...(fold ? { fold } : {}) });
  for (const sk of rep.sources) {
    if (before.has(sk)) continue;
    const s = await store.getSource(sk);
    // a ring starts from the ring defaults (item 11), not from the person's intake matrix
    if (s && !isRingSource(s)) await store.putSource({ ...s, policies: adoptPersonPolicies(s.policies, person) });
    await store.patchSource(sk, { createdAt: ctx.now });
  }
  await store.flush();
  let scored = 0;
  if (rep.datesTouched.length > 0 && !ctx.signal.aborted) {
    ctx.progress(0.75, 'scoring');
    const r = await runRescore(store, { from: rep.datesTouched[0]!, mode: 'verify' }, { ...ctx, onProgress: (p) => ctx.progress(0.75 + 0.25 * p, 'scoring') });
    scored = r.written;
  }
  await store.flush();
  return { rep, scored };
}

export async function importFile(ctx: CommandContext, input: ImportIn): Promise<JobRef> {
  const p = ports(ctx);
  const staged = p.takeFile(input.fileRef);
  if (!staged) fail('not_found', 'That file is no longer available. Choose it again.', { path: '/fileRef', rule: 'file' });
  let format: Format | null;
  if (input.format !== undefined) {
    if (!(FORMATS as readonly string[]).includes(input.format)) fail('invalid_input', `Unknown format “${input.format}”. Use one of: ${FORMATS.join(', ')}.`, { path: '/format', rule: 'format' });
    format = input.format as Format;
  } else format = await detectFormat(staged.blob, staged.name);
  if (!format) fail('invalid_input', 'Vitals doesn’t recognise this file. Choose the format, or use an Apple Health, Health Connect, Health Auto Export, Gadgetbridge, Lumen Health or Vitals biometrics file.', { path: '/fileRef', rule: 'format' });
  if (await needsSqlite(staged.blob, format, p)) fail('precondition_failed', SQLITE_HELP, { rule: 'sqlite_unavailable' });
  const importer = await importerFor(format, p);
  return ctx.jobs.start('import', async (h: JobHandle) => {
    bioActivity.set({ importing: { jobId: h.jobId, progress: 0, name: staged.name } });
    const progress = (f: number, stage: string) => {
      h.progress(f, stage);
      const cur = bioActivity.get().importing;
      if (cur?.jobId === h.jobId) bioActivity.set({ importing: { ...cur, progress: f } });
    };
    try {
      const store = await openBioStore({ writer: deriveWriter(undefined, 'import') });
      const read = importer.run(staged.blob, { tz: ctx.tz, now: ctx.now, signal: h.signal, onProgress: (f) => progress(0.7 * f, 'reading') });
      // Lumen nights may already be stored from the broker: is_main is decided against them (§14.5), under the ring key
      // once the Lumen source is folded into the ring (§15.2)
      const fold = lumenFold(ringFoldOf((await bioIndex()).sourceDocs.get(RING_FOLD_ID)));
      const batches = format === 'lumen_cloudevents' ? (await import('@/biometrics/importers/lumenIngest')).withLumenMainSleep$(read, store, fold) : read;
      const { rep, scored } = await ingestAndScore(store, batches, { today: ctx.today, now: ctx.now, tz: ctx.tz, signal: h.signal, jobId: h.jobId, progress });
      return {
        importer: format!, records: rep.records, samples: rep.samples, chunks: rep.chunks, duplicates: rep.duplicates, skipped: rep.skipped, rejected: rep.rejected,
        sources: rep.sources, days: rep.days, warnings: rep.warnings.slice(0, 50), scored,
      };
    } catch (e) {
      if (e instanceof SqliteUnavailableError) throw new Error(SQLITE_HELP, { cause: e });
      throw e;
    } finally {
      if (bioActivity.get().importing?.jobId === h.jobId) bioActivity.set({ importing: null });
    }
  });
}

/* =============================================================================== Bluetooth */

/**
 * The one ingest path for ring reads (the ring service is the only ring writer, SUITE_SPEC §15.2): the batch goes
 * through `ingestAndScore` in a derive transaction; the service then marks the source and saves its cursor.
 */
export async function ingestRingBatch(batch: BioBatch, o: { ringKey: string; signal: AbortSignal; progress: (p: number, stage: string) => void }): Promise<RingSyncReport> {
  const now = new Date().toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = localDateOf(Date.now(), tz);
  const store = await openBioStore({ writer: deriveWriter(undefined, 'device sync') });
  const { rep, scored } = await ingestAndScore(store, [batch], { today, now, tz, signal: o.signal, jobId: `ring:${o.ringKey}`, progress: o.progress });
  await store.flush();
  return { sourceKey: o.ringKey, driver: '', firmware: '', battery: null, records: rep.records, samples: rep.samples, duplicates: rep.duplicates, days: rep.days, warnings: rep.warnings.slice(0, 50), scored };
}

/** The staged link a screen opened inside the click, or a precondition failure in plain words. */
function stagedLink(ctx: CommandContext, driverId: string, linkRef: string | undefined): BleLink {
  const staged = linkRef ? ports(ctx).takeLink(linkRef) : undefined;
  if (!staged) fail('precondition_failed', 'Choose the ring in the browser’s Bluetooth window first (close the ring’s own app before you do).', { rule: 'ble:no_link' });
  if (staged.driver !== driverId) {
    void staged.link.disconnect().catch(() => undefined);
    fail('invalid_input', 'That ring was chosen for another kind of device.', { path: '/linkRef' });
  }
  return staged.link;
}

/** Hands the link to the ring service as a job; the service keeps the link afterwards and syncs on its own. */
function ringJob(ctx: CommandContext, link: BleLink, driverId: string, ringKey: string | null, create = false): JobRef {
  return ctx.jobs.start('import', async (h: JobHandle) => {
    bioActivity.set({ syncing: { jobId: h.jobId, progress: 0, sourceKey: ringKey, driver: driverId } });
    const progress = (f: number, stage: string) => {
      h.progress(f, stage);
      const cur = bioActivity.get().syncing;
      if (cur?.jobId === h.jobId) bioActivity.set({ syncing: { ...cur, progress: f } });
    };
    try {
      const { getRingService, RingLinkError } = await import('@/biometrics/service');
      try {
        return await getRingService().syncLink(link, driverId, { ...(ringKey ? { ringKey } : {}), ...(create ? { create } : {}), signal: h.signal, onProgress: progress });
      } catch (e) {
        if (e instanceof RingLinkError) {
          const { errorOf } = await import('@/biometrics/service/ringService');
          throw new Error(e.code === 'failed' && e.message !== e.code ? e.message : errorOf(e).message, { cause: e });
        }
        throw e;
      }
    } finally {
      if (bioActivity.get().syncing?.jobId === h.jobId) bioActivity.set({ syncing: null });
    }
  });
}

export async function deviceConnect(ctx: CommandContext, input: { driver: string; linkRef?: string }): Promise<JobRef> {
  const { getDriver } = await import('@/biometrics/ble/registry');
  const { familyById } = await import('../../../packages/rings/src/index');
  if (!getDriver(input.driver) && !familyById(input.driver)) fail('not_found', `No Bluetooth driver “${input.driver}”.`, { path: '/driver', rule: 'driver' });
  return ringJob(ctx, stagedLink(ctx, input.driver, input.linkRef), input.driver, null, true);
}

export async function deviceSync(ctx: CommandContext, input: { sourceKey: string; linkRef?: string }): Promise<JobRef> {
  const ix = await bioIndex();
  const src = ix.source(input.sourceKey);
  if (!src) fail('not_found', 'No such source.', { path: '/sourceKey' });
  if (!src.ble?.driver) fail('precondition_failed', 'This source isn’t a ring Vitals reads over Bluetooth. Import a new file instead.', { rule: 'ble:not_a_ring' });
  return ringJob(ctx, stagedLink(ctx, src.ble.driver, input.linkRef), src.ble.driver, input.sourceKey);
}

/* =============================================================================== bio.deleteSource */

export async function deleteSource(ctx: CommandContext, input: { sourceKey: string }) {
  const ix = await bioIndex();
  const sk = input.sourceKey;
  const src = ix.source(sk);
  const recIds = new Set<string>();
  for (const e of ix.recDocs.values()) if (e.sourceKey === sk) recIds.add(e.record.record_id);
  const chunks = [...ix.chunks.values()].filter((m) => m.sourceKey === sk);
  if (!src && recIds.size === 0 && chunks.length === 0) return { deleted: false };
  const touched = [...ix.recDocs.values()].filter((e) => e.sourceKey === sk).map((e) => e.record.time.local_date).sort();
  // bulk: the source's records, chunk manifests and the score results they fed (derive transactions, batched)
  const bulk = await openBioStore({ writer: deriveWriter(undefined, 'delete source') });
  await bulk.removeRecords(recIds);
  await bulk.dropChunks(sk);
  await bulk.flush();
  const left = new Set((await bioIndex()).dates());
  const stale: string[] = [];
  for (const [id, r] of ix.scoreDocs) if (!left.has(r.scope.localDate) || scoreSource(ix, r) === sk) stale.push(id);
  await bulk.removeScores(stale);
  await bulk.flush();
  // the source document itself goes with the command's change
  if (src) {
    const own = await openBioStore({ writer: commandWriter(ctx.docs) });
    await own.removeSource(sk);
    await own.flush();
  }
  if (touched.length > 0) scheduleRescore(touched[0]!);
  return { deleted: true };
}

export { MAX_DAYS };
