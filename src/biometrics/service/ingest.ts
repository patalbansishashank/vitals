/**
 * Ring events → one batch of records with the provenance every ring record carries (SUITE_SPEC §15.2 "Provenance on
 * every ring record"). Tier P. Ids come from content through A5a's `ringRecords` (`recordIds.ts` with
 * `source = ringKey`), so two devices reading the same night write the same record; which device read it is not in
 * the record. A source from before v0.5.0 (`ble:<driver>|…`) keeps its key: its records go through the old mapper
 * with the same content ids.
 */
import { mapEventsToBatch } from '@/biometrics/core/events';
import type { BioBatch, BioChannel, BioProvenance, BioRecord } from '@/biometrics/core/types';
import { contentId, ringRecords, toDecodedEvents } from '../../../packages/rings/src/records';
import type { FamilyId, RingEvent, RingFamily, RingIdentity } from '../../../packages/rings/src/types';
import { familyIdentity, parseRingKey } from './identity';

export interface RingBatchContext {
  ringKey: string;
  driverId: string;
  firmware: string;
  clockOffsetS: number;
  tz: string;
  tzOffsetS: number;
  /** Epoch ms of the read: `ingested_at` and the sleep version. */
  nowMs: number;
  producer: { name: string; version: string };
  /** A5a family when the driver has one (its `decoderTag`); else `<driverId>/<firmware>@1`. */
  family?: Pick<RingFamily, 'decoderTag'>;
}

export const SOURCE_APP = 'Vitals';

export const decoderTagOf = (ctx: Pick<RingBatchContext, 'driverId' | 'firmware' | 'family'>): string =>
  ctx.family ? ctx.family.decoderTag(ctx.firmware) : `${ctx.driverId}/${ctx.firmware || 'unknown'}@1`;

/** The provenance device block: maker and model from the driver table, never from the advertised name. */
export function ringDeviceOf(ctx: Pick<RingBatchContext, 'driverId' | 'firmware' | 'ringKey'>): NonNullable<BioProvenance['device']> {
  const fam = familyIdentity(ctx.driverId);
  const parsed = parseRingKey(ctx.ringKey);
  return { type: 'ring', manufacturer: fam.maker, model: (!parsed?.legacy && parsed?.model) || fam.model, tier: 'C', ...(ctx.firmware ? { firmware: ctx.firmware } : {}) };
}

function stamp(records: BioRecord[]): BioRecord[] {
  return records.map((r) => ({ ...r, provenance: { ...r.provenance, source_app: SOURCE_APP, recording_method: 'automatic', modality: 'sensed' } }));
}

/** Events of one read → records keyed by content under `ringKey`. `status` and `progress` events never become records. */
export function buildRingBatch(events: readonly RingEvent[], ctx: RingBatchContext): BioBatch {
  const parsed = parseRingKey(ctx.ringKey);
  const device = ringDeviceOf(ctx);
  const ingestedAt = new Date(ctx.nowMs).toISOString();
  if (parsed && !parsed.legacy && parsed.ringId) {
    const identity: RingIdentity = { family: parsed.family as FamilyId, model: parsed.model, ringId: parsed.ringId, basis: parsed.ringId.startsWith('serial:') ? 'serial' : parsed.ringId.startsWith('mac:') ? 'mac' : 'advertised' };
    // `ringRecords` takes the maker from `family.label` and the model from `identity.model`
    const family = { id: identity.family, label: device.manufacturer!, models: [device.model!], tier: 'C', decoderTag: () => decoderTagOf(ctx) } as unknown as RingFamily;
    const batch = ringRecords(events, {
      identity, family, firmware: ctx.firmware, tz: ctx.tz, tzOffsetS: ctx.tzOffsetS, receivedS: Math.floor(ctx.nowMs / 1000), ingestedAt, producer: ctx.producer, clockOffsetS: ctx.clockOffsetS,
    });
    return { ...batch, records: stamp(batch.records) };
  }
  // pre-v0.5.0 key: the old channel and mapper, content ids under the stored key
  const channel = (parsed ? `ble:${parsed.family}` : ctx.ringKey) as BioChannel;
  const batch = mapEventsToBatch(toDecodedEvents(events), {
    tz: ctx.tz, tzOffsetS: ctx.tzOffsetS, channel, device, decoder: decoderTagOf(ctx), ...(ctx.firmware ? { firmware: ctx.firmware } : {}),
    producer: ctx.producer, ingestedAt, exportedAt: ingestedAt, clockOffsetS: ctx.clockOffsetS,
  });
  const seen = new Map<string, BioRecord>();
  for (const r of stamp(batch.records)) {
    const id = contentId(r, ctx.ringKey);
    const prev = seen.get(id);
    if (!prev || prev.version <= r.version) seen.set(id, { ...r, record_id: id });
  }
  return { ...batch, records: [...seen.values()] };
}

/** Folds the housekeeping of one read: cursors per stream, the clock offset, and errors the ring reported. */
export function foldStatus(events: readonly RingEvent[], cursor: Partial<Record<string, string>>, clockOffsetS: number): { cursor: Partial<Record<string, string>>; clockOffsetS: number; errors: string[]; battery?: number; charging?: boolean } {
  const out = { cursor: { ...cursor }, clockOffsetS, errors: [] as string[], battery: undefined as number | undefined, charging: undefined as boolean | undefined };
  for (const e of events) {
    if (e.type !== 'status') continue;
    if (e.key === 'cursor' && e.stream && typeof e.value === 'string') out.cursor[e.stream] = e.value;
    else if (e.key === 'clock_offset_s' && typeof e.value === 'number') out.clockOffsetS = Math.abs(e.value) > Math.abs(out.clockOffsetS) ? e.value : out.clockOffsetS;
    else if (e.key === 'error') out.errors.push(String(e.value));
    else if (e.key === 'battery' && typeof e.value === 'number') out.battery = e.value;
    else if (e.key === 'charging') out.charging = e.value === 1 || e.value === 'true' || e.value === 'yes';
  }
  return out;
}
