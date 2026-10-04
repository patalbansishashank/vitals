/**
 * The ring service over the app's real store port (SUITE_SPEC §15.2): records from a ring sync land in the biometrics
 * store through `appStorePort` -> `ingestRingBatch` -> `ingestAndScore` -> `openBioStore`, on a real in-process document
 * store, with the scripted fake ring from `./fakes.ts` as the connector (no hardware). Synthetic data only.
 *
 * Covers: records with the ring provenance under the A5a key; the ring source with the ring default policies; the
 * device-local cursor document saved after the ingest and never before; a second read of the same data adds nothing;
 * a failing ingest leaves the cursor where it was; the same data through `bio.daily`, `bio.series`, `bio.sources` and
 * `bio.scores`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePolicy, ringDefaultPolicies } from '@/biometrics/core/policy';
import { sourceLabel } from '@/biometrics/core/source';
import type { BioRecord } from '@/biometrics/core/types';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { dispatch, type CommandResult } from '@/commands';
import { resetBioRuntime } from '@/commands/bio/runtime';
import { createMemoryBlobStore, getBlobStore, setBlobStore } from '@/state/blobStore';
import { openBioStore } from '@/commands/bio/store';
import { getDocumentStore } from '@/state/runtime';
import { freshState } from '@/commands/__tests__/harness';
import type { RingEvent, SleepStage } from '../../../../packages/rings/src/types';
import { appLocalPort, appStorePort } from '../app';
import type { RingServicePorts, RingStorePort } from '../ports';
import { createRingService } from '../ringService';
import { FakeClock, FakeRing, fakeConnector, RING_KEY, settle, syncPort } from './fakes';

const MIN = 60_000;
/** The fake ring reads at the clock's start; `Date` follows it so the store's own "today" agrees. */
const NOW = '2026-10-04T08:00:00.000Z';
const DAY1 = '2026-10-03';
const DAY2 = '2026-10-04';
const NIGHT_START = Date.parse('2026-10-03T22:30:00.000Z');
const NIGHT_MIN = 420;
const CURSOR_DOC = `ringCursor:${RING_KEY}`;
const CURSOR = { hr: 'j1|55.1', steps: 's1|9', sleep_stage: 'z1|3' };

// ---------------------------------------------------------------- one synthetic read: a night, heart rate, steps

/** 420 minutes in bed, 400 asleep: awake 10, light 90, deep 60, light 80, rem 50, awake 10, light 100, rem 20. */
function nightEvent(): RingEvent {
  const plan: Array<[SleepStage, number]> = [['awake', 10], ['light', 90], ['deep', 60], ['light', 80], ['rem', 50], ['awake', 10], ['light', 100], ['rem', 20]];
  const stages = plan.flatMap(([s, n]) => Array<SleepStage>(n).fill(s));
  const code: Record<SleepStage, number> = { unknown: 0, awake: 3, light: 1, deep: 2, rem: 4 };
  return { type: 'sleepEpochs', start: NIGHT_START, epochS: 60, stages, rawCodes: stages.map((s) => code[s]), firmware: 'V0525', complete: true };
}

/** 21 readings through the night, 20 minutes apart, 54/55/56 repeating: their mean is exactly 55. */
const nightHr = (): RingEvent[] =>
  Array.from({ length: 21 }, (_, k) => ({ type: 'sample', stream: 'hr', t: NIGHT_START + k * 20 * MIN, value: 54 + (k % 3), unit: 'bpm', origin: 'history' }) as RingEvent);

const dayHr = (): RingEvent[] =>
  [0, 10, 20].map((k) => ({ type: 'sample', stream: 'hr', t: Date.parse(`${DAY1}T12:00:00.000Z`) + k * MIN, value: 70 + k / 10, unit: 'bpm', origin: 'history' }) as RingEvent);

/** DAY1: three 15-minute buckets (9000 steps) and the ring's own day total; DAY2: two buckets (1000 steps), no total. */
const steps = (): RingEvent[] => [
  { type: 'activityBucket', start: Date.parse(`${DAY1}T08:00:00.000Z`), durS: 900, steps: 3000 },
  { type: 'activityBucket', start: Date.parse(`${DAY1}T08:15:00.000Z`), durS: 900, steps: 3200 },
  { type: 'activityBucket', start: Date.parse(`${DAY1}T17:00:00.000Z`), durS: 900, steps: 2800 },
  { type: 'dailyTotal', localDay: Date.parse(`${DAY1}T00:00:00.000Z`), steps: 9000, distanceM: 6400, kcal: 310 },
  { type: 'activityBucket', start: Date.parse(`${DAY2}T06:30:00.000Z`), durS: 900, steps: 600 },
  { type: 'activityBucket', start: Date.parse(`${DAY2}T07:00:00.000Z`), durS: 900, steps: 400 },
];

const cursorEvents = (): RingEvent[] => [
  { type: 'status', key: 'cursor', value: CURSOR.hr, stream: 'hr' },
  { type: 'status', key: 'cursor', value: CURSOR.steps, stream: 'steps' },
  { type: 'status', key: 'cursor', value: CURSOR.sleep_stage, stream: 'sleep_stage' },
];

const history = (): RingEvent[] => [nightEvent(), ...nightHr(), ...dayHr(), ...steps(), ...cursorEvents()];

// ---------------------------------------------------------------- the service over the app's port

/** The app's real store port with a recorder around `ingest`, plus the device-local cursor document as the store sees it. */
function build(o: { wrapIngest?: (real: RingStorePort['ingest'], seen: string[]) => RingStorePort['ingest'] } = {}) {
  const clock = new FakeClock(NOW);
  const store = getDocumentStore();
  const ring = new FakeRing({ history: history(), platformIds: ['aa:bb:cc:dd:ee:01'] });
  const real = appStorePort(store);
  const events: string[] = [];
  const cursorDoc = () => store.peek<Record<string, unknown>>('deviceSettings', CURSOR_DOC) ?? undefined;
  const base: RingStorePort['ingest'] = async (batch, ctx) => {
    events.push(`ingest:start cursor=${JSON.stringify(cursorDoc()?.['cursor'] ?? null)}`);
    const rep = await real.ingest(batch, ctx);
    events.push('ingest:done');
    return rep;
  };
  const storePort: RingStorePort = { ...real, ingest: o.wrapIngest ? o.wrapIngest(base, events) : base };
  const local = appLocalPort(store);
  const origSet = local.set.bind(local);
  local.set = async (k, s) => {
    events.push(`cursor:set ${JSON.stringify(s.cursor)}`);
    await origSet(k, s);
  };
  const connector = fakeConnector({ rings: [ring], clock, canReconnect: true });
  const ports: RingServicePorts = {
    connector, store: storePort, local, sync: syncPort('TESTDEVICE000001', 'Test phone', false), clock, platform: 'android', producer: { name: 'vitals-ring', version: '1' },
  };
  return { clock, store, ring, ports, svc: createRingService(ports), events, cursorDoc, ix: sharedBioIndex(store) };
}

/** Scan, pick the one ring, pair: the first read takes everything the ring holds and creates the source. */
async function pairRing(svc: ReturnType<typeof createRingService>) {
  const found = [];
  for await (const c of svc.scan(new AbortController().signal)) found.push(c);
  expect(found).toHaveLength(1);
  return svc.pair(found[0]!.candidateId);
}

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}

type Daily = { days: Array<{ date: string; values: Record<string, { value: number; source: string; sourceKey: string }>; sleep?: { asleepH: number; source: string } }>; hidden: string[] };
type Sources = { sources: Array<{ sourceKey: string; label: string; kind: string; driver: string | null; records: number; lastSyncAt: string | null; battery: number | null; policies: unknown[]; streams: string[] }>; ringSharing: string };
type Series = { points: Array<{ value: number; source: string }>; hidden: boolean };
type Scores = { results: Array<{ scoreId: string; status: string; value: number | null; source: string | null }> };

const recordsOf = (ix: ReturnType<typeof sharedBioIndex>): BioRecord[] => ix.latestRecords().map((e) => e.record);
const ofKind = <K extends BioRecord['kind']>(rs: BioRecord[], kind: K) => rs.filter((r): r is Extract<BioRecord, { kind: K }> => r.kind === kind);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------- the tests

/** What the store holds besides records: raw samples per stream, as the chunk manifests and the samples themselves say. */
async function samplesOf(stream: 'hr' | 'steps') {
  const bio = await openBioStore();
  return bio.samples({ stream, from: '2026-10-01', to: '2026-10-05' });
}
const chunkCounts = (ix: ReturnType<typeof sharedBioIndex>) => {
  const out: Record<string, number> = {};
  for (const m of ix.chunks.values()) if (!m.superseded) out[`${m.sourceKey}|${m.stream}`] = (out[`${m.sourceKey}|${m.stream}`] ?? 0) + m.n;
  return out;
};

describe('a ring sync lands in the biometrics store through the ring service', () => {
  it('pair reads the night, the heart rate and the steps into records under the ring key, with the ring provenance', { timeout: 30_000 }, async () => {
    const { svc, ix, ring } = build();
    await svc.start();
    await settle();
    const st = await pairRing(svc);
    expect(st).toMatchObject({ ringKey: RING_KEY, state: 'connected', label: 'J-Style 2301' });
    expect(ring.held?.syncCalls).toEqual([{}]);

    // the night, and the day totals, are records
    const records = recordsOf(ix);
    expect(records.map((r) => r.kind).sort()).toEqual(['daily', 'daily', 'sleep']);
    const sleeps = ofKind(records, 'sleep');
    const dailies = ofKind(records, 'daily');
    expect(sleeps[0]).toMatchObject({ is_main: true, asleep_s: 400 * 60, time: { start: '2026-10-03T22:30:00.000Z', end: '2026-10-04T05:30:00.000Z', local_date: DAY2 } });
    expect(sleeps[0]!.stages!.length).toBeGreaterThan(0);
    expect(dailies.map((d) => [d.time.local_date, d.steps]).sort()).toEqual([[DAY1, 9000], [DAY2, 1000]]);
    expect(dailies.find((d) => d.time.local_date === DAY1)).toMatchObject({ distance_m: 6400, active_kcal: 310 });

    // the heart-rate series and the step buckets are raw samples in chunks under the same source key
    expect(chunkCounts(ix)).toEqual({ [`${RING_KEY}|hr`]: 24, [`${RING_KEY}|steps`]: 5 });
    const hr = await samplesOf('hr');
    expect(hr).toHaveLength(24);
    expect(hr.every((x) => x.sourceKey === RING_KEY)).toBe(true);
    const night = hr.filter((x) => x.t >= NIGHT_START && x.t < NIGHT_START + NIGHT_MIN * MIN);
    expect(night).toHaveLength(21);
    expect(night.reduce((a, x) => a + x.value, 0) / night.length).toBeCloseTo(55, 6);

    // §15.2: channel = ring key; device from the driver table; the fixed method/modality; the Vitals app; one decoder tag
    const prov = { channel: RING_KEY, recording_method: 'automatic', modality: 'sensed', source_app: 'Vitals', decoder: 'jstyle2301/V0525@1', device: { type: 'ring', manufacturer: 'J-Style', model: '2301', firmware: 'V0525', tier: 'C' } };
    for (const e of ix.latestRecords()) {
      expect(e.sourceKey, e.record.record_id).toBe(RING_KEY);
      expect(e.record.provenance, e.record.record_id).toMatchObject(prov);
      // which phone read it is not part of a record
      expect(JSON.stringify(e.record)).not.toContain('Test phone');
      expect(JSON.stringify(e.record)).not.toContain('TESTDEVICE');
    }
    for (const m of ix.chunks.values()) expect(m.decoder ?? 'jstyle2301/V0525@1').toBe('jstyle2301/V0525@1');
    // the maker and the model read as the one label every screen shows
    expect(sourceLabel(sleeps[0]!.provenance)).toBe('J-Style 2301');
  });

  it('creates the ring source with the ring default policies and the ring facts, and no cursor in the synced document', { timeout: 30_000 }, async () => {
    const { svc, ix } = build();
    await svc.start();
    await settle();
    await pairRing(svc);
    const src = ix.source(RING_KEY)!;
    expect(src).toBeDefined();
    expect(src).toMatchObject({ sourceKey: RING_KEY, label: 'J-Style 2301', tier: 'C', deviceType: 'ring' });
    expect(src.ble).toMatchObject({ driver: 'jstyle2301', ringId: 'mac:aa:bb:cc:dd:ee:01', address: 'aa:bb:cc:dd:ee:01', firmware: 'V0525', battery: 77, lastSyncBy: 'Test phone', clockOffsetS: 0 });
    expect(src.ble?.lastSyncAt).toBe(NOW);
    expect(src.ble).not.toHaveProperty('cursor');
    expect(src.createdAt).toBeDefined();
    // the ring defaults on every stream, not the person's matrix and not the "device on" suggestion
    expect(src.policies.map(normalizePolicy)).toEqual(ringDefaultPolicies().map(normalizePolicy));
    for (const stream of ['hr', 'steps', 'sleep_sessions'] as const) expect(src.policies.find((p) => p.stream === stream), stream).toMatchObject({ imported: true, scores: true, engine: true, coach: 'daily+series' });
    expect(src.policies.every((p) => p.imported && p.coach !== 'hidden')).toBe(true);
    // the advertised name never reaches the store
    expect(JSON.stringify([...ix.sourceDocs.values()])).not.toContain('Fake Ring');
  });

  it('saves the cursor only after the batch is ingested', { timeout: 30_000 }, async () => {
    const { svc, events, cursorDoc } = build();
    await svc.start();
    await settle();
    await pairRing(svc);
    const iStart = events.findIndex((e) => e.startsWith('ingest:start'));
    const iDone = events.indexOf('ingest:done');
    const iCursor = events.findIndex((e) => e.startsWith('cursor:set') && e.includes(CURSOR.hr));
    expect(iStart).toBeGreaterThanOrEqual(0);
    expect(iDone).toBeGreaterThan(iStart);
    expect(iCursor).toBeGreaterThan(iDone);
    // connecting stored the platform id (a cursor document with no stream cursor yet); no stream cursor existed when the batch went in
    expect(events[iStart]).toBe('ingest:start cursor={}');
    expect(cursorDoc()?.['cursor']).toEqual(CURSOR);
  });

  it('stores the cursor and the platform id as deviceSettings/ringCursor:<ringKey>; a restarted service passes that cursor', { timeout: 30_000 }, async () => {
    const first = build();
    await first.svc.start();
    await settle();
    expect(first.cursorDoc()).toBeUndefined();
    await pairRing(first.svc);
    // `deviceSettings` takes the ring's cursor document id (it once accepted only `me`, so nothing was ever stored)
    const doc = first.cursorDoc()!;
    expect(doc).toBeDefined();
    expect(doc['cursor']).toEqual(CURSOR);
    expect(doc['platformId']).toBe('aa:bb:cc:dd:ee:01');
    // device-local: not in any biometrics collection
    for (const col of ['bioRecords', 'bioSources', 'bioChunks'] as const) expect(first.store.peekAll<{ _id: string }>(col).some((d) => d._id === CURSOR_DOC)).toBe(false);
    // a new service instance on this device (an app restart) reads the stored cursor and reconnects with the stored id
    await first.svc.stop();
    first.ring.held?.drop();
    const second = createRingService({ ...first.ports, local: appLocalPort(first.store), connector: fakeConnector({ rings: [first.ring], clock: first.clock, canReconnect: true }) });
    await second.start();
    await settle();
    expect(first.ring.held?.syncCalls).toEqual([CURSOR]);
  });

  it('a second read of the same data adds no records, samples, chunks or sources', { timeout: 30_000 }, async () => {
    const { svc, ix, ring, cursorDoc } = build();
    await svc.start();
    await settle();
    await pairRing(svc);
    const snapshot = () => ({
      records: ix.latestRecords().map((e) => `${e.record.record_id}@${e.record.version}`).sort(),
      allDocs: ix.recDocs.size,
      chunks: [...ix.chunks.values()].filter((m) => !m.superseded).map((m) => `${m.sourceKey}|${m.stream}|${m.local_date}|${m.n}`).sort(),
      allChunkDocs: ix.chunks.size,
      sources: ix.sources().map((s) => s.sourceKey).sort(),
    });
    const first = snapshot();
    expect(first.records).toHaveLength(3);
    expect(first.chunks.length).toBeGreaterThan(0);

    await svc.syncNow(RING_KEY);
    // the second read passed the cursor the first one saved
    expect(ring.held?.syncCalls).toEqual([{}, CURSOR]);
    expect(cursorDoc()?.['cursor']).toEqual(CURSOR);
    expect(snapshot()).toEqual(first);
    expect(await samplesOf('hr')).toHaveLength(24);
    expect(await samplesOf('steps')).toHaveLength(5);
  });

  it('a read ten minutes later (the ring sends the night again) supersedes the sleep record instead of duplicating it', { timeout: 30_000 }, async () => {
    const { svc, ix, clock } = build();
    await svc.start();
    await settle();
    await pairRing(svc);
    const v1 = ofKind(recordsOf(ix), 'sleep')[0]!.version;
    await clock.advance(10 * MIN);
    vi.setSystemTime(new Date(clock.now()));
    await svc.syncNow(RING_KEY);
    const rs = recordsOf(ix);
    expect(ofKind(rs, 'sleep')).toHaveLength(1);
    expect(ofKind(rs, 'sleep')[0]!.version).toBeGreaterThan(v1);
    expect(ofKind(rs, 'daily')).toHaveLength(2);
    expect(chunkCounts(ix)).toEqual({ [`${RING_KEY}|hr`]: 24, [`${RING_KEY}|steps`]: 5 });
    expect(ix.sources().map((s) => s.sourceKey)).toEqual([RING_KEY]);
  });

  it('a failing ingest does not advance the cursor: nothing is handed to the local port and the next read asks from the old one', { timeout: 30_000 }, async () => {
    let fail = false;
    const { svc, ix, ring, events, cursorDoc } = build({
      wrapIngest: (real) => async (batch, ctx) => {
        if (fail) throw new Error('ingest failed on purpose');
        return real(batch, ctx);
      },
    });
    await svc.start();
    await settle();
    await pairRing(svc);
    const recordsBefore = ix.latestRecords().length;
    const lastSync = ix.source(RING_KEY)?.ble?.lastSyncAt;

    // the ring now reports a newer cursor; the ingest of that read fails
    ring.history = [...ring.history.filter((e) => !(e.type === 'status' && e.key === 'cursor')), { type: 'status', key: 'cursor', value: 'j1|99.9', stream: 'hr' }];
    fail = true;
    events.length = 0;
    await expect(svc.syncNow(RING_KEY)).rejects.toThrow('ingest failed on purpose');
    expect(events.filter((e) => e.startsWith('cursor:set'))).toEqual([]);
    expect(svc.rings()[0]!.state).toBe('error');
    expect(cursorDoc()?.['cursor']).toEqual(CURSOR);
    expect(ix.latestRecords()).toHaveLength(recordsBefore);
    // the source is not marked as read either
    expect(ix.source(RING_KEY)?.ble?.lastSyncAt).toBe(lastSync);

    // the failure was transient: the next read asks for the old cursor again, then moves it
    fail = false;
    await svc.syncNow(RING_KEY);
    expect(ring.held?.syncCalls.at(-1)).toEqual(CURSOR);
    // the failed read let the link go: Sync now reconnects (saving the old cursor with the cleared pause), then moves it once
    expect(events.filter((e) => e.startsWith('cursor:set') && e.includes('j1|99.9'))).toEqual([`cursor:set ${JSON.stringify({ ...CURSOR, hr: 'j1|99.9' })}`]);
    expect(cursorDoc()?.['cursor']).toEqual({ ...CURSOR, hr: 'j1|99.9' });
    expect(svc.rings()[0]!.state).toBe('connected');
  });

  it('a failing store write inside the real ingest path (the sample chunks cannot be written) leaves the cursor unsaved', { timeout: 30_000 }, async () => {
    const { svc, ring, events, cursorDoc } = build();
    await svc.start();
    await settle();
    const blobs = await getBlobStore();
    setBlobStore({ ...blobs, put: () => Promise.reject(new Error('disk full')) });
    resetBioRuntime();
    await expect(pairRing(svc)).rejects.toThrow();
    expect(events.filter((e) => e.startsWith('cursor:set') && e.includes(CURSOR.hr))).toEqual([]);
    expect(svc.rings()[0]!.state).toBe('error');
    expect(cursorDoc()?.['cursor']).toEqual({});
    // the disk is back: the next read still asks for everything, and then saves the cursor
    setBlobStore(blobs);
    resetBioRuntime();
    await svc.syncNow(RING_KEY);
    // the failed read let the link go: the new link's read asks for everything again
    expect(ring.held?.syncCalls).toEqual([{}]);
    expect(events.filter((e) => e.startsWith('cursor:set') && e.includes(CURSOR.hr))).toHaveLength(1);
    expect(cursorDoc()?.['cursor']).toEqual(CURSOR);
    expect(chunkCounts(sharedBioIndex(getDocumentStore()))).toEqual({ [`${RING_KEY}|hr`]: 24, [`${RING_KEY}|steps`]: 5 });
  });
});

describe('the same data through the bio commands', () => {
  it('bio.sources lists the ring under its key with the ring facts; bio.daily, bio.series and bio.scores read what the sync wrote', { timeout: 60_000 }, async () => {
    const { svc } = build();
    await svc.start();
    await settle();
    await pairRing(svc);

    const sources = out<Sources>(await dispatch('bio.sources', {}));
    const ring = sources.sources.find((s) => s.sourceKey === RING_KEY)!;
    expect(ring).toMatchObject({ label: 'J-Style 2301', kind: 'ring', driver: 'jstyle2301', lastSyncAt: NOW, battery: 77, records: 3 });
    expect(ring.streams).toEqual(expect.arrayContaining(['hr', 'steps', 'sleep_sessions']));
    expect(sources.sources.filter((s) => s.sourceKey.startsWith('ble:'))).toHaveLength(1);
    expect(sources.ringSharing).toBe('on');

    // the person's daily view: steps from the day total and the buckets, the night under the wake date
    const daily = out<Daily>(await dispatch('bio.daily', { from: DAY1, to: DAY2 }));
    expect(daily.hidden).toEqual([]);
    const d1 = daily.days.find((d) => d.date === DAY1)!;
    const d2 = daily.days.find((d) => d.date === DAY2)!;
    expect(d1.values['steps']).toMatchObject({ value: 9000, source: 'J-Style 2301', sourceKey: RING_KEY });
    expect(d2.values['steps']).toMatchObject({ value: 1000, source: 'J-Style 2301', sourceKey: RING_KEY });
    expect(d2.sleep?.source).toBe('J-Style 2301');
    expect(d2.sleep?.asleepH).toBeCloseTo(400 / 60, 1);

    // the heart-rate series of the night; an agent (MCP) sees it too with no switch pressed (item 11)
    const hr = out<Series>(await dispatch('bio.series', { metric: 'hr', from: DAY2, to: DAY2, resolution: 'raw' }));
    expect(hr.points.length).toBeGreaterThanOrEqual(18);
    expect(hr.points.every((p) => p.source === 'J-Style 2301')).toBe(true);
    const hrAgent = out<Series>(await dispatch('bio.series', { metric: 'hr', from: DAY2, to: DAY2, resolution: 'raw' }, { actor: { kind: 'mcp', id: 'claude-desktop' } }));
    expect(hrAgent.hidden).toBe(false);
    expect(hrAgent.points).toHaveLength(hr.points.length);

    // the ingest scored the night: total sleep time and resting heart rate (mean of the night's readings) are in the store
    const scores = out<Scores>(await dispatch('bio.scores', { from: DAY2, to: DAY2 }));
    const tst = scores.results.find((r) => r.scoreId === 'sleep.tst')!;
    const rhr = scores.results.find((r) => r.scoreId === 'hr.rhr_night')!;
    expect(tst).toMatchObject({ status: 'ok', source: 'J-Style 2301' });
    expect(tst.value).toBeCloseTo(400, 0);
    expect(rhr).toMatchObject({ status: 'ok', source: 'J-Style 2301' });
    expect(rhr.value).toBeCloseTo(55, 1);
  });
});
