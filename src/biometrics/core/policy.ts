/**
 * Opt-in matrix (SUITE_SPEC §4.5). Tier P. Defaults: everything off. The owner's brief reads it as
 * (imported, visibleToTrainer, usedByEngine): visibleToTrainer = coach !== 'hidden'; usedByEngine = engine on,
 * imported and engine-eligible.
 */
import type { BioSourceDoc, BioStream, PolicyStream, ScoreDef, StreamPolicy } from './types';

/** Stream policies by stream name. Streams not listed (e.g. a new `vendor:*` stream) read as everything off. */
export type PolicyMatrix = Readonly<Record<string, StreamPolicy>>;

export const FAMILY_STREAMS = ['workouts', 'sleep_sessions', 'vendor_scores', 'daily_summary', 'body'] as const satisfies readonly PolicyStream[];
export const BASE_STREAMS = [
  'hr', 'ibi', 'hrv', 'spo2', 'skin_temp', 'body_temp', 'resp_rate', 'steps', 'distance', 'active_kcal', 'motion', 'sleep_state', 'sleep_stage',
] as const satisfies readonly BioStream[];
export const POLICY_STREAMS: readonly PolicyStream[] = [...BASE_STREAMS, ...FAMILY_STREAMS];

/** SUITE_SPEC §4.5 table: which streams may ever drive the engine. Not listed there = never. VO2max rides on
 * `daily_summary` (the daily record carries the lab/field value); weight and body fat on `body`. */
const ENGINE_ELIGIBLE: ReadonlySet<string> = new Set([
  'sleep_sessions', 'steps', 'workouts', 'body', 'daily_summary', 'hr', 'ibi', 'hrv', 'skin_temp',
]);

export function engineEligible(stream: PolicyStream): boolean {
  return ENGINE_ELIGIBLE.has(stream);
}

/** Vendor opinions are never inputs to scores or the engine (§4.4); stream `vendor:*` likewise. */
function vendorOnly(stream: string): boolean {
  return stream === 'vendor_scores' || stream.startsWith('vendor:');
}

const off = (stream: PolicyStream): StreamPolicy => ({ stream, imported: false, coach: 'hidden', engine: false, scores: false });

export function defaultMatrix(): PolicyMatrix {
  return Object.fromEntries(POLICY_STREAMS.map((s) => [s, off(s)]));
}

export function policyOf(matrix: PolicyMatrix, stream: PolicyStream): StreamPolicy {
  return matrix[stream] ?? off(stream);
}

/** Clamp a policy to the invariants: engine/scores/coach require imported; ineligible streams never engine; vendor never engine/scores. */
export function normalizePolicy(p: StreamPolicy): StreamPolicy {
  if (!p.imported) return { stream: p.stream, imported: false, coach: 'hidden', engine: false, scores: false };
  const vendor = vendorOnly(p.stream);
  return { stream: p.stream, imported: true, coach: p.coach, engine: !vendor && engineEligible(p.stream) && p.engine, scores: !vendor && p.scores };
}

export function setPolicy(matrix: PolicyMatrix, stream: PolicyStream, patch: Partial<Omit<StreamPolicy, 'stream'>>): PolicyMatrix {
  return { ...matrix, [stream]: normalizePolicy({ ...policyOf(matrix, stream), ...patch, stream }) };
}

/** Suggested policy when a device is turned on (§4.5): imported + scores + engine where eligible, coach hidden until chosen. */
export function suggestedOnPolicy(stream: PolicyStream): StreamPolicy {
  return normalizePolicy({ stream, imported: true, coach: 'hidden', engine: engineEligible(stream), scores: !vendorOnly(stream) });
}

export function visibleToTrainer(p: StreamPolicy): boolean {
  return p.imported && p.coach !== 'hidden';
}

export function usedByEngine(p: StreamPolicy): boolean {
  return p.imported && p.engine && engineEligible(p.stream) && !vendorOnly(p.stream);
}

export function engineOn(matrix: PolicyMatrix, stream: PolicyStream): boolean {
  return usedByEngine(policyOf(matrix, stream));
}

/** Human-readable invariant violations of a (possibly hand-edited or synced) matrix. */
export function policyViolations(matrix: PolicyMatrix): string[] {
  const out: string[] = [];
  for (const [k, p] of Object.entries(matrix)) {
    if (!p.imported && (p.engine || p.scores || p.coach !== 'hidden')) out.push(`${k}: engine/scores/coach need imported`);
    if (p.engine && !engineEligible(p.stream)) out.push(`${k}: not engine-eligible`);
    if (vendorOnly(k) && (p.engine || p.scores)) out.push(`${k}: vendor data is never an engine or score input`);
  }
  return out;
}

/** A score may run only when every opt-in stream is imported with scores on. */
export function scoreAllowed(def: Pick<ScoreDef, 'optInStreams'>, matrix: PolicyMatrix): boolean {
  return def.optInStreams.every((s) => {
    const p = policyOf(matrix, s);
    return p.imported && p.scores && !vendorOnly(s);
  });
}

export interface CoachItem {
  stream: PolicyStream;
  /** 'series' items are reachable only through a visible tool call. */
  shape: 'daily' | 'series';
}

/** Filters items to what the Coach may see (vendor items keep their vendor_opinion label upstream). */
export function coachView<T extends CoachItem>(items: readonly T[], matrix: PolicyMatrix): T[] {
  return items.filter((it) => {
    const p = policyOf(matrix, it.stream);
    if (!p.imported || p.coach === 'hidden') return false;
    return it.shape === 'daily' || p.coach === 'daily+series';
  });
}

/* ---------------------------------------------------------------- stream ownership (SUITE_SPEC §14.6 a) */

/** Families a device can own. While a device owns one, entries by hand for it become corrections. */
export type OwnedFamily = 'sleep_sessions' | 'steps' | 'body' | 'resting_hr' | 'hrv' | 'workouts';
export const OWNED_FAMILIES: readonly OwnedFamily[] = ['sleep_sessions', 'steps', 'body', 'resting_hr', 'hrv', 'workouts'];

/** The policy stream that decides ownership of a family (resting heart rate rides on `hr`). */
export const FAMILY_POLICY_STREAM: Readonly<Record<OwnedFamily, PolicyStream>> = {
  sleep_sessions: 'sleep_sessions',
  steps: 'steps',
  body: 'body',
  resting_hr: 'hr',
  hrv: 'hrv',
  workouts: 'workouts',
};

/** Policy streams whose presence on a source shows it brings the family in (daily totals arrive as `daily_summary`). */
const FAMILY_EVIDENCE: Readonly<Record<OwnedFamily, readonly PolicyStream[]>> = {
  sleep_sessions: ['sleep_sessions', 'sleep_stage', 'sleep_state'],
  steps: ['steps', 'daily_summary'],
  body: ['body'],
  resting_hr: ['hr', 'daily_summary'],
  hrv: ['hrv', 'ibi', 'daily_summary'],
  workouts: ['workouts'],
};

const TIER_ORDER = { A: 0, B: 1, C: 2 } as const;

/** The source's channel: the part of its key before the first `|` (`manual`, `file:…`, `mqtt:lumen`, `ble:…`). */
export function channelOfSourceKey(sourceKey: string): string {
  return sourceKey.split('|')[0]!;
}

/**
 * The device that owns a stream family for the person: a source whose channel is not `manual`, that brings the family
 * in (a policy entry for one of its streams with `imported` on; daily totals arrive as `daily_summary`) and whose own
 * entry for the family's stream, if any, has `imported` on. Several owners → the fixed device order (tier, then source
 * key). Null = no device owns it, so manual logging stays as it was.
 */
export function streamOwner(
  family: OwnedFamily,
  sources: readonly Pick<BioSourceDoc, 'sourceKey' | 'label' | 'tier' | 'policies'>[],
): { sourceKey: string; label: string } | null {
  const stream = FAMILY_POLICY_STREAM[family];
  const owners = sources
    .filter((s) => channelOfSourceKey(s.sourceKey) !== 'manual' && s.sourceKey !== 'correction')
    .filter((s) => {
      const own = s.policies.find((p) => p.stream === stream);
      if (own) return normalizePolicy(own).imported;
      return s.policies.some((p) => FAMILY_EVIDENCE[family].includes(p.stream) && normalizePolicy(p).imported);
    })
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3) || a.sourceKey.localeCompare(b.sourceKey));
  const o = owners[0];
  return o ? { sourceKey: o.sourceKey, label: o.label } : null;
}

/** Every owned family with its owner (families no device owns are left out). */
export function ownedFamilies(sources: readonly Pick<BioSourceDoc, 'sourceKey' | 'label' | 'tier' | 'policies'>[]): Partial<Record<OwnedFamily, { sourceKey: string; label: string }>> {
  const out: Partial<Record<OwnedFamily, { sourceKey: string; label: string }>> = {};
  for (const f of OWNED_FAMILIES) {
    const o = streamOwner(f, sources);
    if (o) out[f] = o;
  }
  return out;
}

/* ---------------------------------------------------------------- ring sources (SUITE_SPEC §15.2, plan 04 item 11) */

/** A ring connected through Vitals: a `ring` device, a Bluetooth channel, or the same ring's data from Lumen. */
export function isRingSource(src: Pick<BioSourceDoc, 'sourceKey'> & { deviceType?: string }): boolean {
  const ch = channelOfSourceKey(src.sourceKey);
  return src.deviceType === 'ring' || ch.startsWith('ble:') || ch === 'file:lumen_cloudevents';
}

/** Ring data is first-party: every stream in, scores and plan where eligible, the Coach sees daily + detail. */
export function ringDefaultPolicy(stream: PolicyStream): StreamPolicy {
  return normalizePolicy({ stream, imported: true, coach: 'daily+series', engine: engineEligible(stream), scores: true });
}

export function ringDefaultPolicies(): StreamPolicy[] {
  return POLICY_STREAMS.map(ringDefaultPolicy);
}

/** The master switch "Use my ring data in my plan and Coach" turned off: still shown, not used or shared. */
export function ringSharingOffPolicy(stream: PolicyStream, current?: StreamPolicy): StreamPolicy {
  return normalizePolicy({ stream, imported: current?.imported ?? true, coach: 'hidden', engine: false, scores: false });
}

/** What the master switch reads over the person's ring sources: 'none' when there is no ring source. */
export function ringSharing(sources: readonly (Pick<BioSourceDoc, 'sourceKey' | 'policies'> & { deviceType?: string })[]): 'on' | 'off' | 'some' | 'none' {
  const rings = sources.filter(isRingSource);
  if (rings.length === 0) return 'none';
  const same = (a: StreamPolicy, b: StreamPolicy) => JSON.stringify(normalizePolicy(a)) === JSON.stringify(normalizePolicy(b));
  const each = (want: (s: PolicyStream, cur: StreamPolicy | undefined) => StreamPolicy) =>
    rings.every((r) => POLICY_STREAMS.every((s) => {
      const cur = r.policies.find((p) => p.stream === s);
      return cur ? same(cur, want(s, cur)) : false;
    }));
  if (each((s) => ringDefaultPolicy(s))) return 'on';
  if (each((s, cur) => ringSharingOffPolicy(s, cur))) return 'off';
  return 'some';
}
