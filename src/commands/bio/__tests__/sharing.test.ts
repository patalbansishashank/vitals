/**
 * Plan 04 item 11 (SUITE_SPEC §15.2): the ring master switch `bio.setRingSharing`, its state on `bio.sources`, the
 * one-time migration `biometrics.ringDefaults` and its notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batch, daily, hrSeries, prov } from '@/biometrics/core/__tests__/factory';
import { POLICY_STREAMS, ringDefaultPolicies, ringDefaultPolicy, ringSharingOffPolicy } from '@/biometrics/core/policy';
import { suggestedPolicies } from '@/biometrics/core/source';
import type { BioProvenance, BioSourceDoc, StreamPolicy } from '@/biometrics/core/types';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { COLLECTIONS, createDocumentStore, createMemoryBackend, isCollectionId } from '@/store';
import { createMemoryHub, createMemorySyncStore } from '@/sync/memoryStore';
import { createSyncedBackend } from '@/sync/syncedBackend';
import { dispatch, getCommand, settleCommits, type CommandResult } from '../..';
import { SYSTEM_ACTOR } from '../../types';
import { freshState } from '../../__tests__/harness';
import { ingestRingBatch } from '../exec';
import { deriveWriter, openBioStore } from '../store';
import { resetBioRuntime } from '../runtime';
import { RING_DEFAULTS_ID, RING_SHARING_ID } from '../sharing';

const BLE = 'ble:jstyle|j-style:2301';
const LUMEN = 'file:lumen_cloudevents|:j-style_2301';
const APPLE = 'file:apple_health|other:ring';

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}
const changeSetOf = (r: CommandResult): string => {
  if (!r.ok || !('changeSet' in r) || !r.changeSet) throw new Error(`no change set: ${JSON.stringify(r)}`);
  return r.changeSet.id;
};

async function seed(...docs: Array<Pick<BioSourceDoc, 'sourceKey' | 'policies'>>) {
  const store = await openBioStore({ writer: deriveWriter() });
  for (const d of docs) await store.putSource({ label: d.sourceKey, tier: 'C', baselineEpochs: [], ...d });
  await store.flush();
}

type SourcesOut = { sources: Array<{ sourceKey: string; policies: StreamPolicy[] }>; ringSharing: string; ringDefaultsNotice: boolean };
const sources = async () => out<SourcesOut>(await dispatch('bio.sources', {}));
const policiesOf = async (sk: string) => (await sources()).sources.find((s) => s.sourceKey === sk)!.policies;
const oldDefaults = () => suggestedPolicies(['hr', 'hrv', 'sleep_sessions', 'steps', 'daily_summary']);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('bio.setRingSharing', () => {
  it('is a consequential, undoable write the app alone sends', () => {
    const d = getCommand('bio.setRingSharing')!;
    expect(d).toMatchObject({ perm: 'write', impact: 'consequential', undo: { kind: 'inversePatch' } });
    expect(d.notImplemented).toBeUndefined();
    expect(d.surfaces).toEqual(['ui']);
    expect(d.excludedReason?.ui).toBeUndefined();
    expect(getCommand('bio.dismissRingDefaultsNotice')?.surfaces).toEqual(['ui']);
    expect(getCommand('biometrics.ringDefaults')?.surfaces).toEqual(['ui']);
  });

  it('off: every stream of every ring source out of scores, plan and Coach, still brought in; on: the ring defaults', async () => {
    await seed({ sourceKey: BLE, policies: ringDefaultPolicies() }, { sourceKey: LUMEN, policies: oldDefaults() }, { sourceKey: APPLE, policies: oldDefaults() });
    expect((await sources()).ringSharing).toBe('some');

    expect(out(await dispatch('bio.setRingSharing', { on: false }))).toEqual({ state: 'off' });
    await settleCommits();
    for (const sk of [BLE, LUMEN]) {
      const ps = await policiesOf(sk);
      for (const s of POLICY_STREAMS) expect(ps.find((p) => p.stream === s), `${sk} ${s}`).toEqual(ringSharingOffPolicy(s));
    }
    // another vendor's import is not a ring: untouched
    expect(await policiesOf(APPLE)).toEqual(oldDefaults());
    expect((await sources()).ringSharing).toBe('off');

    expect(out(await dispatch('bio.setRingSharing', { on: true }))).toEqual({ state: 'on' });
    await settleCommits();
    for (const sk of [BLE, LUMEN]) for (const s of POLICY_STREAMS) expect((await policiesOf(sk)).find((p) => p.stream === s)).toEqual(ringDefaultPolicy(s));
    expect((await sources()).ringSharing).toBe('on');
  });

  it('a per-stream change after the switch makes it read "some"', async () => {
    await seed({ sourceKey: BLE, policies: ringDefaultPolicies() });
    expect((await sources()).ringSharing).toBe('on');
    await dispatch('bio.setRingSharing', { on: true });
    await settleCommits();
    out(await dispatch('bio.setPolicy', { stream: 'hrv', sourceKey: BLE, policy: { coach: 'daily' } }));
    await settleCommits();
    expect((await sources()).ringSharing).toBe('some');
  });

  it('reads none without a ring source', async () => {
    await seed({ sourceKey: APPLE, policies: oldDefaults() });
    expect((await sources()).ringSharing).toBe('none');
    expect(out(await dispatch('bio.setRingSharing', { on: false }))).toEqual({ state: 'none' });
  });

  it('a ring-only person’s change of one field without a source starts from the ring default', async () => {
    await seed({ sourceKey: BLE, policies: ringDefaultPolicies() });
    const list = out<StreamPolicy[]>(await dispatch('bio.setPolicy', { stream: 'hrv', policy: { scores: false } }));
    expect(list.find((p) => p.stream === 'hrv')).toEqual({ stream: 'hrv', imported: true, coach: 'daily+series', engine: true, scores: false });
    await settleCommits();
    expect((await policiesOf(BLE)).find((p) => p.stream === 'hrv')).toMatchObject({ coach: 'daily+series', scores: false });
  });
});

describe('biometrics.ringDefaults (one-time migration)', () => {
  const run = () => dispatch('biometrics.ringDefaults', {}, { actor: SYSTEM_ACTOR });

  it('moves an untouched ring source, leaves a person-changed one alone, shows the notice once, runs once', async () => {
    const changed = [...oldDefaults().filter((p) => p.stream !== 'hr'), { stream: 'hr' as const, imported: true, coach: 'daily' as const, engine: false, scores: true }];
    await seed({ sourceKey: LUMEN, policies: oldDefaults() }, { sourceKey: BLE, policies: changed }, { sourceKey: APPLE, policies: oldDefaults() });
    expect((await sources()).ringDefaultsNotice).toBe(false);

    const r = out<{ ran: boolean; moved: string[]; kept: string[] }>(await run());
    expect(r).toEqual({ ran: true, moved: [LUMEN], kept: [BLE] });
    await settleCommits();
    for (const s of POLICY_STREAMS) expect((await policiesOf(LUMEN)).find((p) => p.stream === s)).toEqual(ringDefaultPolicy(s));
    expect((await policiesOf(BLE)).find((p) => p.stream === 'hr')).toMatchObject({ coach: 'daily', engine: false });
    expect((await policiesOf(APPLE)).every((p) => p.coach === 'hidden')).toBe(true);
    expect(getDocumentStore().peek('bioSources', RING_DEFAULTS_ID)).toMatchObject({ kind: 'ringDefaults', moved: 1, kept: 1, notice: 'show' });
    // the marker is not a source
    expect((await sources()).sources.map((s) => s.sourceKey).sort()).toEqual([APPLE, BLE, LUMEN].sort());
    expect((await sources()).ringDefaultsNotice).toBe(true);

    // runs once: a later run changes nothing, even after the person switched sharing off
    await dispatch('bio.setRingSharing', { on: false });
    await settleCommits();
    expect(out(await run())).toEqual({ ran: false, moved: [], kept: [] });
    await settleCommits();
    expect((await sources()).ringSharing).toBe('off');

    expect(out(await dispatch('bio.dismissRingDefaultsNotice', {}))).toEqual({ dismissed: true });
    await settleCommits();
    expect((await sources()).ringDefaultsNotice).toBe(false);
    expect(out(await dispatch('bio.dismissRingDefaultsNotice', {}))).toEqual({ dismissed: false });
  });

  it('a ring source the person changed through bio.setPolicy (change log) is left alone even when it still looks like a default', async () => {
    await seed({ sourceKey: LUMEN, policies: oldDefaults() });
    // the person hides HRV from the Coach on this source: the result equals the old default, so only the log tells
    out(await dispatch('bio.setPolicy', { stream: 'hrv', sourceKey: LUMEN, policy: { coach: 'hidden' } }));
    await settleCommits();
    expect(out(await run())).toEqual({ ran: true, moved: [], kept: [LUMEN] });
    await settleCommits();
    expect((await policiesOf(LUMEN)).find((p) => p.stream === 'hrv')?.coach).toBe('hidden');
    expect((await sources()).ringDefaultsNotice).toBe(false);
  });

  it('records nothing on a device with no data yet, and refuses other callers', async () => {
    expect(out(await run())).toEqual({ ran: false, moved: [], kept: [] });
    await settleCommits();
    expect(getDocumentStore().peek('bioSources', RING_DEFAULTS_ID)).toBeFalsy();
    const r = await dispatch('biometrics.ringDefaults', {});
    expect(r.ok).toBe(false);
  });

  it('records nothing while no ring source has synced in; a ring source that arrives later is moved (SVC-03)', async () => {
    // a second device: an earlier file import (or the first sync batch) holds a non-ring source only
    await seed({ sourceKey: APPLE, policies: oldDefaults() });
    expect(out(await run())).toEqual({ ran: false, moved: [], kept: [] });
    await settleCommits();
    expect(getDocumentStore().peek('bioSources', RING_DEFAULTS_ID)).toBeFalsy();
    // a ring source already on the ring defaults is neither moved nor kept: still nothing recorded
    await seed({ sourceKey: BLE, policies: ringDefaultPolicies() });
    expect(out(await run())).toEqual({ ran: false, moved: [], kept: [] });
    await settleCommits();
    expect(getDocumentStore().peek('bioSources', RING_DEFAULTS_ID)).toBeFalsy();

    // the owner's ring source syncs in later: the next run moves it and records itself
    await seed({ sourceKey: LUMEN, policies: oldDefaults() });
    expect(out(await run())).toEqual({ ran: true, moved: [LUMEN], kept: [] });
    await settleCommits();
    for (const s of POLICY_STREAMS) expect((await policiesOf(LUMEN)).find((p) => p.stream === s)).toEqual(ringDefaultPolicy(s));
    expect(await policiesOf(APPLE)).toEqual(oldDefaults());
    expect(getDocumentStore().peek('bioSources', RING_DEFAULTS_ID)).toMatchObject({ moved: 1, notice: 'show' });
    expect(out(await run())).toEqual({ ran: false, moved: [], kept: [] });
  });

  it('with the master switch off before it runs, an untouched ring source gets the switch’s off, and no notice', async () => {
    await seed({ sourceKey: APPLE, policies: oldDefaults() });
    await dispatch('bio.setRingSharing', { on: false });
    await settleCommits();
    await seed({ sourceKey: LUMEN, policies: oldDefaults() });
    expect(out(await run())).toEqual({ ran: true, moved: [LUMEN], kept: [] });
    await settleCommits();
    for (const s of POLICY_STREAMS) expect((await policiesOf(LUMEN)).find((p) => p.stream === s)).toEqual(ringSharingOffPolicy(s));
    expect((await sources()).ringDefaultsNotice).toBe(false);
  });
});

/* =============================================================================== J7-01: the choice is remembered */

const RING_DEVICE = { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' } as const;
let recN = 0;

/** A ring's first read through the app's ring ingest (`ingestRingBatch`, the path `bio.import` shares): the source is new. */
async function connect(channel: string) {
  const p = prov({ channel: channel as BioProvenance['channel'], device: RING_DEVICE, ingested_at: '2026-10-04T06:00:00.000Z' });
  const b = batch([daily(`ring-day-${++recN}`, '2026-10-03', { steps: 9000, resting_hr_bpm: 55 }, p), hrSeries(`ring-hr-${recN}`, '2026-10-03T01:00:00.000Z', [60, 61, 62], 60, p)]);
  const rep = await ingestRingBatch(b, { ringKey: channel, signal: new AbortController().signal, progress: () => {} });
  await settleCommits();
  return rep;
}

const NEW_RING = 'ble:jstyle2301/2301/serial:TEST0002';
const THIRD_RING = 'ble:jstyle2301/2301/serial:TEST0003';
const isOff = (ps: readonly StreamPolicy[]) => POLICY_STREAMS.every((s) => JSON.stringify(ps.find((p) => p.stream === s)) === JSON.stringify(ringSharingOffPolicy(s)));
const isOn = (ps: readonly StreamPolicy[]) => POLICY_STREAMS.every((s) => JSON.stringify(ps.find((p) => p.stream === s)) === JSON.stringify(ringDefaultPolicy(s)));
const choice = () => getDocumentStore().peek<{ choice?: string }>('bioSources', RING_SHARING_ID)?.choice;

describe('the master switch is remembered for rings connected later (J7-01)', () => {
  it('off: a ring connected afterwards starts off and the switch reads off; on again: new rings get the defaults', async () => {
    await seed({ sourceKey: BLE, policies: ringDefaultPolicies() });
    expect(out(await dispatch('bio.setRingSharing', { on: false }))).toEqual({ state: 'off' });
    await settleCommits();
    expect(choice()).toBe('off');

    expect((await connect(NEW_RING)).records).toBe(1);
    expect(isOff(await policiesOf(NEW_RING))).toBe(true);
    // Lumen's data by the same path (its MQTT feed and its files share one source) starts off too
    await connect('mqtt:lumen');
    expect(isOff(await policiesOf(LUMEN))).toBe(true);
    expect((await sources()).ringSharing).toBe('off');
    // the marker is not a source
    expect((await sources()).sources.map((s) => s.sourceKey)).not.toContain(RING_SHARING_ID);

    expect(out(await dispatch('bio.setRingSharing', { on: true }))).toEqual({ state: 'on' });
    await settleCommits();
    expect(choice()).toBe('on');
    await connect(THIRD_RING);
    expect(isOn(await policiesOf(THIRD_RING))).toBe(true);
    expect((await sources()).ringSharing).toBe('on');
  });

  it('a non-ring import keeps the device-on suggestion whatever the switch says', async () => {
    await dispatch('bio.setRingSharing', { on: false });
    await settleCommits();
    const p = prov({ channel: 'file:apple_health', device: { type: 'ring', manufacturer: 'Other', model: 'Ring', tier: 'B' }, ingested_at: '2026-10-04T06:00:00.000Z' });
    await ingestRingBatch(batch([daily('apple-day', '2026-10-03', { steps: 9000 }, p)]), { ringKey: 'x', signal: new AbortController().signal, progress: () => {} });
    await settleCommits();
    expect(await policiesOf(APPLE)).toEqual(suggestedPolicies(['daily_summary']));
    expect((await sources()).ringSharing).toBe('none');
  });

  it('Undo of the switch restores the previous choice as well', async () => {
    await seed({ sourceKey: BLE, policies: ringDefaultPolicies() });
    const offRun = await dispatch('bio.setRingSharing', { on: false });
    await settleCommits();
    const onRun = await dispatch('bio.setRingSharing', { on: true });
    await settleCommits();
    expect(choice()).toBe('on');

    out(await dispatch('history.undo', { changeSetId: changeSetOf(onRun) }));
    await settleCommits();
    expect(choice()).toBe('off');
    expect((await sources()).ringSharing).toBe('off');
    await connect(NEW_RING);
    expect(isOff(await policiesOf(NEW_RING))).toBe(true);

    // undoing the first change leaves no stored choice: rings start with the defaults again
    out(await dispatch('history.undo', { changeSetId: changeSetOf(offRun) }));
    await settleCommits();
    expect(choice()).toBeUndefined();
    await connect(THIRD_RING);
    expect(isOn(await policiesOf(THIRD_RING))).toBe(true);
  });
});

/* =============================================================================== J7-03: a second device joins */

/** One device: its own document store over a memory sync engine linked to `hub` (the relay), with the app's split:
 * synced collections (`bioSources`) go through the engine, device-local ones (the change log) stay on the device. */
async function device(name: string, hub: ReturnType<typeof createMemoryHub>) {
  const id = `DEVICE${name}`.padEnd(16, '0');
  const engine = createMemorySyncStore();
  await engine.open({ secret: new Uint8Array(32).fill(7), relayUrl: 'memory://relay', deviceId: id as never, memoryOnly: true });
  engine.link(hub);
  const backend = createSyncedBackend({ synced: engine, local: createMemoryBackend({ device: id }), isSynced: (c) => isCollectionId(c) && COLLECTIONS[c].sync === 'yes' });
  const docs = createDocumentStore({ backend, device: id as never });
  await docs.ready;
  return {
    docs,
    /** Make this device the one the app runs on. */
    use: () => setDocumentStore(docs),
    /** Pull from `from` (default: the relay this device is linked to), then push. */
    async sync(from: ReturnType<typeof createMemoryHub> = hub) {
      await settleCommits();
      engine.link(from);
      await engine.pull();
      engine.link(hub);
      await engine.push();
      await backend.settled();
      await new Promise((r) => setTimeout(r, 5));
    },
  };
}

describe('ring policies survive a second device joining (J7-03)', () => {
  const run = () => dispatch('biometrics.ringDefaults', {}, { actor: SYSTEM_ACTOR });
  const snapshot = async () => {
    const s = await sources();
    return { ringSharing: s.ringSharing, policies: Object.fromEntries(s.sources.map((x) => [x.sourceKey, x.policies])), choice: choice() };
  };

  /** Device A: the migration ran, the person turned the switch off, then let one stream of one ring feed the scores. */
  async function firstDevice(hub: ReturnType<typeof createMemoryHub>) {
    const a = await device('A', hub);
    a.use();
    await seed({ sourceKey: BLE, policies: oldDefaults() }, { sourceKey: LUMEN, policies: oldDefaults() }, { sourceKey: APPLE, policies: oldDefaults() });
    expect(out(await run())).toMatchObject({ ran: true, moved: [BLE, LUMEN].sort() });
    await settleCommits();
    await dispatch('bio.setRingSharing', { on: false });
    await settleCommits();
    out(await dispatch('bio.setPolicy', { stream: 'steps', sourceKey: BLE, policy: { scores: true } }));
    await settleCommits();
    const before = await snapshot();
    expect(before).toMatchObject({ ringSharing: 'some', choice: 'off' });
    await a.sync();
    return { a, before };
  }

  it('a device that joins gets the choice and the per-stream choices; its migration and its new ring keep them', async () => {
    const hub = createMemoryHub();
    const { a, before } = await firstDevice(hub);

    const b = await device('B', hub);
    b.use();
    await b.sync();
    // the change log stays on device A: B knows the person's changes only from the synced documents
    expect(getDocumentStore().peekAll('changeLog')).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(out(await run())).toEqual({ ran: false, moved: [], kept: [] });
    await settleCommits();
    expect(await snapshot()).toEqual(before);

    // a ring paired on B starts off, and A sees it that way
    await connect(NEW_RING);
    expect(isOff(await policiesOf(NEW_RING))).toBe(true);
    await b.sync();
    a.use();
    await a.sync();
    expect(isOff(await policiesOf(NEW_RING))).toBe(true);
    expect((await snapshot()).policies[BLE]).toEqual(before.policies[BLE]);
    expect(choice()).toBe('off');
  });

  it('a device whose first sync brings the ring sources before the migration’s record leaves them alone', async () => {
    const hub = createMemoryHub();
    const { a, before } = await firstDevice(hub);
    // B's first batch: every document but the migration's record
    const partial = new Map([...hub].filter(([k]) => !k.endsWith(`\u0000${RING_DEFAULTS_ID}`)));

    const b = await device('B', hub);
    b.use();
    await b.sync(partial);
    expect(getDocumentStore().peek('bioSources', RING_DEFAULTS_ID)).toBeFalsy();
    expect(await snapshot()).toEqual(before);
    // the person's changes are not the old defaults, so B's run keeps both rings as they are
    expect(out(await run())).toEqual({ ran: true, moved: [], kept: [BLE, LUMEN].sort() });
    await settleCommits();
    expect(await snapshot()).toEqual(before);

    await b.sync();
    expect(await snapshot()).toEqual(before);
    a.use();
    await a.sync();
    expect(await snapshot()).toEqual(before);
  });
});
