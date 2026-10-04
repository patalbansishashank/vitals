/**
 * Effective stream policy (SUITE_SPEC §4.5) for the app wiring (tier P, pure).
 *
 * Two levels: the person's matrix (set in the intake's devices chapter or Settings › Devices through `bio.setPolicy`
 * without a source; stored in `bioSources/policy:me`) and each source's own `BioSourceDoc.policies` (set when a device
 * or file first brings data in, or through `bio.setPolicy` with a source). The effective policy of a stream for a source
 * is the source's entry, else the person's, else — for data the person brought in themselves (an import or a device
 * they connected) — the "device turned on" suggestion (imported, scores, engine where eligible, Coach hidden).
 * Without a source and without a person entry everything is off.
 */
import { DAILY_METRIC_GROUPS } from './resolve';
import { normalizePolicy, POLICY_STREAMS, suggestedOnPolicy, type PolicyMatrix } from './policy';
import type { BioBatch, BioRecord, BioSourceDoc, DailyRecord, PolicyStream, SpotMetric, StreamPolicy } from './types';

/** Id of the person-level policy document in `bioSources` (never a source key: source keys start with a channel). */
export const PERSON_POLICY_ID = 'policy:me';

/** The intake's stream ids (src/features/intake `StreamId`) and other spellings, mapped to E10's policy streams. */
export const STREAM_ALIASES: Readonly<Record<string, PolicyStream>> = {
  heart_rate: 'hr',
  resting_hr: 'hr',
  weight: 'body',
  body_fat: 'body',
  sleep: 'sleep_sessions',
  workout: 'workouts',
  vendor: 'vendor_scores',
};

/** A known policy stream for `s` (an E10 stream, an alias or a `vendor:<key>` stream), else null. */
export function policyStreamId(s: string): PolicyStream | null {
  if ((POLICY_STREAMS as readonly string[]).includes(s)) return s as PolicyStream;
  if (STREAM_ALIASES[s]) return STREAM_ALIASES[s]!;
  if (/^vendor:[a-z0-9_.-]{1,40}$/i.test(s)) return s as PolicyStream;
  return null;
}

const off = (stream: PolicyStream): StreamPolicy => ({ stream, imported: false, coach: 'hidden', engine: false, scores: false });

function entry(list: readonly StreamPolicy[] | undefined, stream: PolicyStream): StreamPolicy | undefined {
  return list?.find((p) => p.stream === stream);
}

/** The effective policy of `stream` for data from `source` (see the module comment). Always normalised. */
export function effectivePolicy(source: Pick<BioSourceDoc, 'policies'> | null | undefined, person: readonly StreamPolicy[], stream: PolicyStream): StreamPolicy {
  const own = entry(source?.policies, stream) ?? entry(person, stream);
  if (own) return normalizePolicy({ ...own, stream });
  return source ? suggestedOnPolicy(stream) : off(stream);
}

/** The person's matrix for every policy stream: their explicit entries, else the device-on suggestion. Used where no
 * single source applies (score visibility, which scores run). */
export function personMatrix(person: readonly StreamPolicy[]): PolicyMatrix {
  const out: Record<string, StreamPolicy> = {};
  for (const s of POLICY_STREAMS) out[s] = normalizePolicy(entry(person, s) ?? suggestedOnPolicy(s));
  for (const p of person) if (!out[p.stream]) out[p.stream] = normalizePolicy(p);
  return out;
}

/** Replace or add one stream's entry in a policy list (normalised). */
export function withPolicy(list: readonly StreamPolicy[], p: StreamPolicy): StreamPolicy[] {
  const n = normalizePolicy(p);
  const out = list.filter((x) => x.stream !== n.stream);
  out.push(n);
  return out.sort((a, b) => a.stream.localeCompare(b.stream));
}

/** Policies for a source that has just appeared: the person's explicit entries replace the device-on suggestions. */
export function adoptPersonPolicies(sourcePolicies: readonly StreamPolicy[], person: readonly StreamPolicy[]): StreamPolicy[] {
  return sourcePolicies.map((p) => normalizePolicy(entry(person, p.stream) ?? p));
}

// ------------------------------------------------------------------------------------------- metrics → streams

const SPOT_STREAM: Readonly<Record<SpotMetric, PolicyStream>> = {
  weight_kg: 'body',
  body_fat_pct: 'body',
  lean_mass_kg: 'body',
  waist_cm: 'body',
  hr_bpm: 'hr',
  spo2_pct: 'spo2',
  hrv_ms: 'hrv',
  body_temp_c: 'body_temp',
  bp_sys_mmhg: 'daily_summary',
  bp_dia_mmhg: 'daily_summary',
  glucose_mg_dl: 'daily_summary',
};

const DAILY_GROUP_STREAM: Readonly<Record<string, PolicyStream>> = {
  steps: 'steps',
  distance_m: 'distance',
  active_kcal: 'active_kcal',
  total_kcal: 'active_kcal',
  active_min: 'active_kcal',
  resting_hr_bpm: 'hr',
  hr: 'hr',
  hrv: 'hrv',
  spo2: 'spo2',
  resp_rate_brpm: 'resp_rate',
  skin_temp: 'skin_temp',
  body_temp_c: 'body_temp',
  vo2max: 'daily_summary',
  vendor: 'vendor_scores',
};

/** The stream that governs a resolved metric (`ResolvedDay.sourceByMetric` keys: daily metric groups, `sleep`,
 * `workouts`, `spot:<metric>`). */
export function streamOfMetric(metric: string): PolicyStream {
  if (metric === 'sleep') return 'sleep_sessions';
  if (metric === 'workouts') return 'workouts';
  if (metric.startsWith('spot:')) return SPOT_STREAM[metric.slice(5) as SpotMetric] ?? 'daily_summary';
  return DAILY_GROUP_STREAM[metric] ?? 'daily_summary';
}

/** Metric groups of a daily record, with the stream each belongs to. */
export const DAILY_GROUPS: ReadonlyArray<{ metric: string; stream: PolicyStream; fields: readonly (keyof DailyRecord)[] }> = Object.entries(DAILY_METRIC_GROUPS).map(([metric, fields]) => ({
  metric,
  stream: streamOfMetric(metric),
  fields,
}));

// ------------------------------------------------------------------------------------------- import filter

/** The filter an import applies: per stream, the person's explicit choice, else on (the person chose to import). */
export function importPolicies(person: readonly StreamPolicy[]): StreamPolicy[] {
  const out = POLICY_STREAMS.map((s) => normalizePolicy(entry(person, s) ?? suggestedOnPolicy(s)));
  for (const p of person) if (!out.some((x) => x.stream === p.stream)) out.push(normalizePolicy(p));
  return out;
}

const imported = (person: readonly StreamPolicy[], stream: PolicyStream): boolean => entry(person, stream)?.imported ?? true;

/** Drops what the person said not to bring in before the pipeline stores it: daily metric groups and spot values whose
 * stream is off (the pipeline itself filters whole records and series by their stream). Records left empty are dropped. */
export function applyImportPolicy(batch: BioBatch, person: readonly StreamPolicy[]): BioBatch {
  if (person.every((p) => p.imported)) return batch;
  const records: BioRecord[] = [];
  for (const r of batch.records) {
    if (r.kind === 'spot') {
      if (imported(person, SPOT_STREAM[r.metric] ?? 'daily_summary')) records.push(r);
      continue;
    }
    if (r.kind !== 'daily') {
      records.push(r);
      continue;
    }
    const copy: Record<string, unknown> = { ...r };
    let kept = 0;
    for (const g of DAILY_GROUPS) {
      const has = g.fields.some((f) => r[f] !== undefined);
      if (!has) continue;
      if (imported(person, g.stream)) kept++;
      else for (const f of g.fields) delete copy[f];
    }
    if (kept > 0) records.push(copy as unknown as DailyRecord);
  }
  return { ...batch, records };
}
