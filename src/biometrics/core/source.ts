/** Source identity, tiers and stream policies (SUITE_SPEC §4.3, §4.5; tier P). */
import { RAW_STREAMS } from './types';
import { isRingSource, ringStartPolicies, type RingChoice, type RingFold } from './policy';
import type { BioProvenance, BioRecord, BioSourceDoc, DeviceTier, PolicyStream, StreamPolicy } from './types';

const slug = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '_');

/** The ring Lumen Health reads, as every Lumen record names it in provenance (never the model id Lumen reports). */
export const LUMEN_DEVICE_MODEL = 'J-Style 2301';

/** The one source key of Lumen data, whatever path it came through (MQTT, CloudEvents file, archive). Equal to the key
 * the archive and file importers have always produced, so data imported before stays under it. */
export const LUMEN_SOURCE_KEY = `file:lumen_cloudevents|:${slug(LUMEN_DEVICE_MODEL)}`;

/** The pipeline's `fold` option from the stored ring fold: Lumen data filed under the person's one J-Style 2301 ring
 * source (§15.2), with the provenance maker and model the ring's own records carry. Undefined when there is no fold. */
export function lumenFold(fold: RingFold | undefined): Record<string, { key: string; maker: string; model: string }> | undefined {
  return fold?.lumen ? { [LUMEN_SOURCE_KEY]: { key: fold.lumen, maker: 'J-Style', model: '2301' } } : undefined;
}

/** Stable source key: `<channel>|<manufacturer:model>` for device-backed data, `<channel>|app:<source_app>` for app-backed
 * data, `<channel>` alone otherwise. Re-imports from the same device or app map to the same source. */
export function sourceKeyOf(p: BioProvenance): string {
  // a ring key (`ble:<family>/<model>/<ringId>`, SUITE_SPEC §15.2) is already the source key
  if (p.channel.startsWith('ble:') && p.channel.includes('/')) return p.channel;
  // Lumen over MQTT, Lumen's CloudEvents dump and its own archive are one source (§14.5 identical-batch rule): samples
  // merge into the same chunks. The key never depends on the device model Lumen reports (R20-ID-01).
  if (p.channel === 'mqtt:lumen' || p.channel === 'file:lumen_archive' || p.channel === 'file:lumen_cloudevents') return LUMEN_SOURCE_KEY;
  const ch = p.channel;
  const d = p.device;
  const dev = d && (d.manufacturer || d.model) ? `${slug(d.manufacturer ?? '')}:${slug(d.model ?? '')}` : '';
  if (dev) return `${ch}|${dev}`;
  if (p.source_app) return `${ch}|app:${slug(p.source_app)}`;
  return ch;
}

/** Tier: the device's declared tier; otherwise the conservative 'C' (consumer optical / unvalidated; R9 §3 treats tier C
 * HRV, SpO2 and stress as within-person trends only). */
export function inferTier(p: BioProvenance): DeviceTier {
  return p.device?.tier ?? 'C';
}

/** Human label for a source. */
export function sourceLabel(p: BioProvenance): string {
  const d = p.device;
  if (d && (d.manufacturer || d.model)) return [d.manufacturer, d.model].filter(Boolean).join(' ');
  return p.source_app ?? p.channel;
}

export const POLICY_STREAMS: readonly PolicyStream[] = [...RAW_STREAMS, 'workouts', 'sleep_sessions', 'vendor_scores', 'daily_summary', 'body'];

/** Everything off until the user turns a device on (§4.5). */
export function defaultPolicies(): StreamPolicy[] {
  return POLICY_STREAMS.map((stream) => ({ stream, imported: false, coach: 'hidden', engine: false, scores: false }));
}

/** Engine-eligible streams per §4.5 table: sleep sessions, steps, workouts, weight/body, resting HR/HRV/skin temperature
 * (observations). SpO2, vendor stress and vendor scores never feed the engine. */
const ENGINE_STREAMS = new Set<PolicyStream>(['sleep_sessions', 'steps', 'workouts', 'body', 'hr', 'ibi', 'hrv', 'skin_temp', 'daily_summary']);

/** Policy a stream gets when its device is turned on: imported + scores (+ engine when eligible), coach hidden until the
 * person chooses. Vendor opinion streams are imported but never feed scores or the engine (§4.4). */
export function suggestedPolicies(streams: readonly PolicyStream[]): StreamPolicy[] {
  return streams.map((stream) => {
    const vendor = stream === 'vendor_scores' || stream.startsWith('vendor:');
    return { stream, imported: true, coach: 'hidden', engine: !vendor && ENGINE_STREAMS.has(stream), scores: !vendor };
  });
}

/** Which policy governs a record. */
export function policyStreamOf(rec: BioRecord): PolicyStream {
  switch (rec.kind) {
    case 'series': return rec.metric;
    case 'sleep': return 'sleep_sessions';
    case 'workout': return 'workouts';
    case 'spot':
      return ['weight_kg', 'body_fat_pct', 'lean_mass_kg', 'waist_cm'].includes(rec.metric) ? 'body' : 'daily_summary';
    default: return 'daily_summary';
  }
}

export function policyOf(policies: readonly StreamPolicy[] | undefined, stream: PolicyStream): StreamPolicy | undefined {
  return policies?.find((p) => p.stream === stream);
}

/** Streams a set of records touches, for `suggestedPolicies`. */
export function policyStreamsOf(records: readonly BioRecord[]): PolicyStream[] {
  return [...new Set(records.map(policyStreamOf))];
}

export { ringDefaultPolicies } from './policy';

/** A source doc for a new source. Lower priority number = preferred; new sources go after existing ones. A ring connected
 * through Vitals starts with the ring defaults on every stream (plan 04 item 11), or everything off but brought in when
 * the person's master switch (`ringSharing`, stored in `ringSharing:me`) is off; any other source with the device-on
 * suggestion for the streams it brought in. */
export function newSourceDoc(p: BioProvenance, priority: number, streams: readonly PolicyStream[], ringSharing: RingChoice = 'on'): BioSourceDoc {
  const sourceKey = sourceKeyOf(p);
  const policies = isRingSource({ sourceKey }) ? ringStartPolicies(ringSharing) : suggestedPolicies(streams);
  return { sourceKey, label: sourceLabel(p), tier: inferTier(p), priority, policies, baselineEpochs: [] };
}
