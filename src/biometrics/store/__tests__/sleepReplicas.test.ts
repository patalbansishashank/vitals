// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveWriter } from '@/commands/bio/store';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { createMemoryHub, createMemorySyncStore } from '@/sync/memoryStore';
import { ringRecords, type RingRecordContext } from '../../../../packages/rings/src/records';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { ringIdentity, ringSourceKey, type RingEvent } from '../../../../packages/rings/src/types';
import { resolveDays } from '../../core/resolve';
import { ingestBatches } from '../../ingest/pipeline';
import { BioDocIndex } from '../docIndex';
import { DocBioStore } from '../docStore';
import { InMemoryBlobStore } from '../memory';

const HALF_HOUR = 30 * 60_000;
const START = Date.UTC(2026, 8, 15, 22);
const END = START + 16 * HALF_HOUR;
const context: RingRecordContext = {
  identity: ringIdentity({ family: 'jstyle2301', model: '2301', serial: 'SYNTHETICNIGHT' }),
  family: jstyle2301, firmware: 'V0525', tz: 'UTC', tzOffsetS: 0,
  receivedS: END / 1000, ingestedAt: new Date(END).toISOString(), producer: { name: 'sleep-test', version: '1' },
};
const sourceKey = ringSourceKey(context.identity);

function read(start: number, end: number, complete: boolean, received = end, revised = false) {
  const stages = Array.from({ length: (end - start) / HALF_HOUR }, (_, i) => revised || i % 2 === 0 ? 'deep' as const : 'light' as const);
  const event: RingEvent = { type: 'sleepEpochs', start, epochS: HALF_HOUR / 1000, stages, rawCodes: stages.map((s) => s === 'deep' ? 1 : 2), firmware: 'V0525', complete };
  return ringRecords([event], { ...context, receivedS: received / 1000, ingestedAt: new Date(received).toISOString() });
}

async function replica(name: 'PHONE' | 'DESKTOP' | 'SERVER', hub: ReturnType<typeof createMemoryHub>) {
  const device = name.padEnd(16, '0');
  const sync = createMemorySyncStore();
  await sync.open({ secret: new Uint8Array(32).fill(7), relayUrl: 'memory://relay', deviceId: device as never, memoryOnly: true });
  sync.link(hub);
  const docs = createDocumentStore({ backend: sync, device: device as never });
  await docs.ready;
  const index = new BioDocIndex(docs);
  const store = new DocBioStore({ index, blobs: new InMemoryBlobStore(), writer: deriveWriter(docs, 'sleep-test') });
  return {
    name, docs, index, store,
    async ingest(batch: ReturnType<typeof read>) {
      expect((await ingestBatches([batch], store, { now: context.ingestedAt })).rejected).toBe(0);
      await store.flush();
    },
    async push() { await sync.push(); },
    async pull() { await sync.pull(); await new Promise((r) => setTimeout(r, 5)); },
  };
}

describe('sleep convergence across offline readers and a server replica', () => {
  it.each([false, true])('one complete night after sixteen half-hourly reads, with either upload order (reverse=%s)', async (reverse) => {
    const hub = createMemoryHub();
    const phone = await replica('PHONE', hub);
    const desktop = await replica('DESKTOP', hub);
    const server = await replica('SERVER', hub);
    // The phone reads throughout the night while offline. Some reads contain only a recent tail; others reach back
    // to the start. Early reads wake before midnight, so containment must be resolved across calendar dates too.
    for (let i = 1; i <= 16; i++) {
      const start = i % 3 === 0 ? START : START + Math.max(0, i - 2) * HALF_HOUR;
      await phone.ingest(read(start, START + i * HALF_HOUR, false));
    }
    expect(phone.index.recDocs.size).toBeGreaterThan(8);
    expect(await server.store.records()).toHaveLength(0);
    // Another offline reader gets the finished night and then its revised classification.
    await desktop.ingest(read(START, END, true));
    const final = read(START, END, true, END + HALF_HOUR, true);
    await desktop.ingest(final);
    const [first, second] = reverse ? [desktop, phone] : [phone, desktop];
    await first.push(); await server.pull();
    await second.push();
    for (const r of [phone, desktop, server]) await r.pull();
    for (const r of [phone, desktop, server]) {
      const records = await r.store.records({ kind: 'sleep' });
      expect(records, r.name).toEqual([{ sourceKey, record: final.records[0] }]);
      expect(r.index.latestRecords().map((e) => e.record), r.name).toEqual(final.records);
      expect(r.index.dates(), r.name).toEqual(['2026-09-16']);
      expect(await r.store.records({ from: '2026-09-15', to: '2026-09-15' }), r.name).toEqual([]);
      expect(r.index.latestRecords('2026-09-15', '2026-09-15'), r.name).toEqual([]);
      const day = resolveDays(r.index.latestRecords(), await r.store.sources())[0]!;
      expect(day.sleeps, r.name).toHaveLength(1);
      expect(day.mainSleep, r.name).toMatchObject({ record_id: final.records[0]!.record_id, asleep_s: 8 * 3600, deep_s: 8 * 3600 });
      // A freshly built index (app/server restart) resolves the same immutable synced deliveries.
      const cold = new BioDocIndex(r.docs);
      await cold.ready;
      expect(cold.latestRecords().map((e) => e.record), r.name).toEqual(final.records);
      cold.dispose();
    }
    // A delayed later-dated tail cannot revive the provisional session after the complete night has synced.
    await phone.ingest(read(END - HALF_HOUR, END, false, END + 2 * HALF_HOUR));
    await phone.push();
    for (const r of [phone, desktop, server]) {
      await r.pull();
      expect((await r.store.records({ kind: 'sleep' })).map((e) => e.record), r.name).toEqual(final.records);
    }
    // A disjoint nap stays a separate sleep on every replica, even on the same sleep-day.
    const nap = read(END + 12 * HALF_HOUR, END + 13 * HALF_HOUR, false);
    await desktop.ingest(nap);
    await desktop.push();
    for (const r of [phone, desktop, server]) {
      await r.pull();
      const sleeps = await r.store.records({ kind: 'sleep' });
      expect(sleeps.map((e) => e.record.record_id), r.name).toEqual([final.records[0]!.record_id, nap.records[0]!.record_id]);
      expect(resolveDays(sleeps, [])[0]!.mainSleep?.record_id, r.name).toBe(final.records[0]!.record_id);
      r.index.dispose();
    }
  });
});

describe('sleep read projection and buffered writes', () => {
  it('reconciles before flush and revives a hidden tail when its complete record is removed', async () => {
    const device = 'SLEEPTEST00000000';
    const docs = createDocumentStore({ backend: createMemoryBackend({ device }), device });
    const index = new BioDocIndex(docs);
    const store = new DocBioStore({ index, blobs: new InMemoryBlobStore(), writer: deriveWriter(docs, 'sleep-test') });
    const tail = read(START + HALF_HOUR, START + 2 * HALF_HOUR, false).records[0]!;
    const full = read(START, END, true).records[0]!;
    await store.putRecord(tail, sourceKey);
    await store.flush();
    expect(index.dates()).toEqual(['2026-09-15']);
    await store.putRecord(full, sourceKey);
    expect((await store.records()).map((e) => e.record)).toEqual([full]);
    await store.flush();
    expect(index.dates()).toEqual(['2026-09-16']);
    await store.removeRecords([full.record_id]);
    expect((await store.records()).map((e) => e.record)).toEqual([tail]);
    await store.flush();
    expect(index.latestRecords().map((e) => e.record)).toEqual([tail]);
    expect(index.dates()).toEqual(['2026-09-15']);
    index.dispose();
  });
});
