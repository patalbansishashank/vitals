/**
 * L-REV2 R3-10, R3-11, R3-12 and R1 minor 9: what agents (the Coach, MCP, WebMCP) learn about a ring source. A ring key
 * carries the ring's own id (`serial:…`, `mac:<address>`, `adv:<advertised id>`): agents get `…/ring1`, `…/ring2` instead
 * (numbered in the order the sources were created, nothing taken from the id), wherever they can read it (the bio reads,
 * the log.bulk refusal, a correction, job results, the change list), and the ring's name from the family table, never a
 * label an older build stored from the ring's advertisement. A source the Coach does not see is not listed to them, nor
 * a score this build does not know. The person keeps the real key. Synthetic ids and names only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageBleLink, clearStaged } from '@/biometrics/app/handoff';
import { bioActivity } from '@/biometrics/app/activity';
import { RecordedLink } from '@/biometrics/ble/fakeLink';
import { HISTORY_CATALOG, command } from '@vitals/rings/jstyle2301/commands';
import { POLICY_STREAMS, ringDefaultPolicies, ringSharingOffPolicy } from '@/biometrics/core/policy';
import { SCORE_CATALOGUE } from '@/biometrics/core/scores/catalogue';
import { newSourceDoc, sourceKeyOf, suggestedPolicies } from '@/biometrics/core/source';
import type { BioChannel, BioProvenance, BioRecord, StreamPolicy } from '@/biometrics/core/types';
import { sha256Hex } from '@/biometrics/core/hash';
import { rescoreHistory } from '@/biometrics/ingest/rescoreJob';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { addDays } from '@/living/dates';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { getDocumentStore } from '@/state/runtime';
import { allCommands, dispatch, jobs, settleCommits, SYSTEM_ACTOR, type Actor, type CommandResult } from '@/commands';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { deriveWriter, openBioStore } from '@/commands/bio/store';
import { setTimeZoneSource } from '@/commands/bus';
import { resetBioRuntime } from '@/commands/bio/runtime';
import { ALL, UNDO } from '@/commands/defs/_shared';
import { defineCommand } from '@/commands/registry';
import { T } from '@/commands/schema';
import { AI, MCP, freshState } from './harness';

const TODAY = '2026-10-01';
const YESTERDAY = '2026-09-30';
/** What a build before the label table stored as a ring's label: its advertised name (synthetic). */
const ADVERTISED = 'ADV-NAME 77';
const KEYS = {
  serial: 'ble:jstyle2301/2301/serial:TEST0001',
  mac: 'ble:jstyle2301/2301/mac:aa:bb:cc:00:11:22',
  adv: 'ble:jstyle2301/2301/adv:AbCdEf0123456789==',
} as const;
const RING_IDS = ['serial:TEST0001', 'mac:aa:bb:cc:00:11:22', 'adv:AbCdEf0123456789=='];
/** Anything that would tell an agent which ring this is: the ids, their parts, and a hash of either. */
const IDS = [
  'TEST0001', 'aa:bb:cc:00:11:22', 'AbCdEf0123456789', 'serial:', 'mac:', 'adv:', ADVERTISED,
  ...RING_IDS.flatMap((id) => [id, id.slice(id.indexOf(':') + 1)].map((x) => sha256Hex(x).slice(0, 8))),
];
const leaks = (v: unknown): string[] => {
  const s = JSON.stringify(v).toLowerCase();
  return IDS.filter((id) => s.includes(id.toLowerCase()));
};
const ALIAS = /^ble:jstyle2301\/2301\/ring\d+$/;
const RING1 = 'ble:jstyle2301/2301/ring1';
const AGENTS: Array<[string, Actor]> = [['MCP', MCP], ['the Coach', AI]];

const APPLE_PROV: BioProvenance = {
  channel: 'file:apple_health', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T06:45:00.000Z',
  source_app: 'Health', device: { type: 'watch', tier: 'B' },
};
const ringProv = (key: string): BioProvenance => ({
  channel: key as BioChannel, recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T06:45:00.000Z',
  device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' },
});

const quality = { validation: 'measured', confidence: null, flags: [] } as const;
function records(prov: BioProvenance, tag: string): BioRecord[] {
  const out: BioRecord[] = [];
  for (const d of [YESTERDAY, TODAY]) {
    out.push({ kind: 'sleep', record_id: `${tag}-s-${d}`, version: 1, time: { start: `${addDays(d, -1)}T23:00:00.000Z`, end: `${d}T06:30:00.000Z`, tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, is_main: true, asleep_s: 7 * 3600, in_bed_s: 7.5 * 3600 } as BioRecord);
    out.push({ kind: 'daily', record_id: `${tag}-d-${d}`, version: 1, time: { tz_offset_s: 0, local_date: d }, provenance: prov, quality: { ...quality, flags: [] }, steps: 9000, resting_hr_bpm: 54 } as BioRecord);
  }
  return out;
}

/** A source as the ring service leaves it (records, last night's heart rate, its sleep score); `doc: false` = records
 * that synced before their source document. */
async function seed(key: string, o: { label?: string; policies?: StreamPolicy[]; prov?: BioProvenance; doc?: boolean; tag?: string; createdAt?: string; battery?: number } = {}) {
  const prov = o.prov ?? ringProv(key);
  const store = await openBioStore({ writer: deriveWriter() });
  if (o.doc !== false) {
    await store.putSource({ sourceKey: key, label: o.label ?? ADVERTISED, tier: prov.device?.tier ?? 'C', policies: o.policies ?? ringDefaultPolicies(), baselineEpochs: [] });
    if (prov.device?.type === 'ring') await store.patchSource(key, { deviceType: 'ring', ble: { driver: 'jstyle2301', battery: o.battery ?? 77, lastSyncAt: '2026-10-01T06:40:00.000Z' }, ...(o.createdAt ? { createdAt: o.createdAt } : {}) });
  }
  for (const r of records(prov, o.tag ?? 'r')) await store.putRecord(r, key);
  const t0 = Date.parse(`${TODAY}T01:00:00.000Z`);
  await store.putSamples({ sourceKey: key, stream: 'hr', local_date: TODAY }, [0, 1, 2].map((k) => ({ t: t0 + k * 60_000, value: 52 + k, origin: 'history' as const })), { tz_offset_s: 0, createdAt: '2026-10-01T06:45:00.000Z' });
  await store.flush();
  await rescoreHistory(store, { defs: SCORE_CATALOGUE.filter((d) => d.scoreId === 'sleep.tst'), from: YESTERDAY, to: TODAY, now: '2026-10-01T07:00:00.000Z', build: 't' });
  await store.flush();
  await sharedBioIndex(getDocumentStore()).ready;
}

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}

type Source = { sourceKey: string; label: string; kind: string; channel: string; driver: string | null; streams: string[]; policies: Array<{ stream: string }>; records: number; battery: number | null };
const sourcesAs = async (actor?: Actor) => out<{ sources: Source[] }>(await dispatch('bio.sources', {}, actor ? { actor } : {})).sources;
type Daily = { days: Array<{ date: string; values: Record<string, { value: number; source: string; sourceKey: string }>; sleep?: { source: string } }> };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
  clearStaged();
  bioActivity.reset();
  setTimeZoneSource(() => 'UTC');
});
afterEach(() => {
  setTimeZoneSource(null);
  vi.useRealTimers();
});

/** Test only: a job an agent may start whose result names a ring by its key (as a ring sync's does). */
defineCommand({
  id: 'bio.testRingJob',
  version: 1,
  title: 'Ring job (test)',
  description: 'Test only.',
  input: T.Object({}),
  output: T.Object({ sourceKey: T.String() }),
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  longRunning: { kind: 'job', softTimeoutMs: 5_000 },
  execute: (ctx) => ctx.jobs.start('import', async () => ({ sourceKey: KEYS.mac, note: `Synced ${KEYS.mac}.` })),
});

function fresh() {
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
}

describe('bio.sources: a ring key as its number, its name from the family table (R3-10, R3-11, R1 minor 9)', () => {
  it.each(Object.entries(KEYS))('a %s key and an advertised stored label', { timeout: 30_000 }, async (_basis, key) => {
    await seed(key);
    const aliases = new Set<string>();
    for (const [, actor] of AGENTS) {
      const [s, ...rest] = await sourcesAs(actor);
      expect(rest).toEqual([]);
      expect(s).toMatchObject({ label: 'J-Style 2301', kind: 'ring', driver: 'jstyle2301' });
      expect(s!.sourceKey).toBe(RING1);
      expect(s!.channel).toBe(s!.sourceKey);
      expect(leaks(s)).toEqual([]);
      aliases.add(s!.sourceKey);
    }
    // the same alias for every agent and every call
    expect(aliases.size).toBe(1);
    expect((await sourcesAs(MCP))[0]!.sourceKey).toBe([...aliases][0]);
    // the person keeps the real key; the name comes from the table for them too
    expect(await sourcesAs()).toMatchObject([{ sourceKey: key, channel: key, label: 'J-Style 2301' }]);
  });

  it('two rings of one family: ring1 and ring2 by when their sources were created, the same on two stores', { timeout: 30_000 }, async () => {
    // the serial ring was added first though its key sorts after the other's; the stores get the documents in either order
    const first = { createdAt: '2026-09-01T08:00:00.000Z', battery: 41, tag: 's' };
    const second = { createdAt: '2026-09-20T08:00:00.000Z', battery: 92, tag: 'a' };
    const byAlias = async () => Object.fromEntries((await sourcesAs(MCP)).map((s) => [s.sourceKey, s.battery]));
    await seed(KEYS.serial, first);
    await seed(KEYS.adv, second);
    const one = await byAlias();
    expect(one).toEqual({ [RING1]: 41, 'ble:jstyle2301/2301/ring2': 92 });
    // bio.daily names one of the same aliases on this store
    const daily = out<Daily>(await dispatch('bio.daily', { from: TODAY, to: TODAY }, { actor: AI }));
    expect(Object.keys(one)).toContain(daily.days[0]!.values['steps']!.sourceKey);
    fresh();
    await seed(KEYS.adv, second);
    await seed(KEYS.serial, first);
    expect(await byAlias()).toEqual(one);
    expect(leaks(await sourcesAs(AI))).toEqual([]);
  });
});

describe('the bio reads name the ring from the table and carry no hardware id (R3-10, R3-11)', () => {
  it.each(AGENTS)('bio.daily, bio.series and bio.scores as %s', { timeout: 30_000 }, async (_who, actor) => {
    await seed(KEYS.mac);
    const alias = (await sourcesAs(actor))[0]!.sourceKey;
    const daily = out<Daily>(await dispatch('bio.daily', { from: YESTERDAY, to: TODAY }, { actor }));
    const today = daily.days.find((d) => d.date === TODAY)!;
    expect(today.values['steps']).toMatchObject({ value: 9000, source: 'J-Style 2301', sourceKey: alias });
    expect(today.sleep?.source).toBe('J-Style 2301');
    expect(leaks(daily)).toEqual([]);
    const series = out<{ points: Array<{ source: string }> }>(await dispatch('bio.series', { metric: 'hr', from: TODAY, to: TODAY }, { actor }));
    expect(series.points.map((p) => p.source)).toEqual(['J-Style 2301', 'J-Style 2301', 'J-Style 2301']);
    const scores = out<{ results: Array<{ scoreId: string; source: string | null }> }>(await dispatch('bio.scores', { from: YESTERDAY, to: TODAY }, { actor }));
    expect(scores.results.filter((r) => r.scoreId === 'sleep.tst').map((r) => r.source)).toEqual(['J-Style 2301', 'J-Style 2301']);
    expect(leaks([series, scores])).toEqual([]);
    // the person's own read is as before: the real key
    const mine = out<Daily>(await dispatch('bio.daily', { from: TODAY, to: TODAY }));
    expect(mine.days[0]!.values['steps']?.sourceKey).toBe(KEYS.mac);
  });

  it('a ring whose records synced before its source document is named from its key, never by it', { timeout: 30_000 }, async () => {
    await seed(KEYS.serial, { doc: false });
    // the person shares steps with the Coach (a source without a document follows the person's choices)
    out(await dispatch('bio.setPolicy', { stream: 'steps', policy: { imported: true, coach: 'daily' } }));
    await settleCommits();
    const daily = out<Daily>(await dispatch('bio.daily', { from: TODAY, to: TODAY }, { actor: MCP }));
    expect(daily.days[0]!.values['steps']).toMatchObject({ value: 9000, source: 'J-Style 2301' });
    expect(leaks(daily)).toEqual([]);
    const made = out<{ created: Array<{ source: string }> }>(await dispatch('log.fromBiometrics', { date: TODAY }, { actor: MCP }));
    expect(made.created.length).toBeGreaterThan(0);
    expect(made.created.map((c) => c.source)).toEqual(made.created.map(() => 'J-Style 2301'));
    expect(leaks(made)).toEqual([]);
  });

  it('log.fromBiometrics and briefing.get name the ring from the table', { timeout: 30_000 }, async () => {
    await seed(KEYS.adv);
    const made = out<{ created: Array<{ source: string }> }>(await dispatch('log.fromBiometrics', { date: TODAY }, { actor: MCP }));
    expect(made.created.map((c) => c.source)).toEqual(made.created.map(() => 'J-Style 2301'));
    expect(leaks(made)).toEqual([]);
    await settleCommits();
    expect(leaks(out(await dispatch('today.get', {}, { actor: MCP })))).toEqual([]);
    const briefing = out<{ text: string }>(await dispatch('briefing.get', {}, { actor: MCP })).text;
    expect(briefing).toContain('(J-Style 2301)');
    expect(leaks(briefing)).toEqual([]);
  });
});

describe('errors, corrections, jobs and the change list carry no hardware id (R3-10)', () => {
  it('the log.bulk refusal for a device-owned stream', { timeout: 30_000 }, async () => {
    await seed(KEYS.mac);
    const input = { days: [{ date: TODAY, entries: [{ kind: 'steps', steps: 5000 }] }] };
    const refused = await dispatch('log.bulk', input, { actor: MCP, idempotencyKey: 'b1' });
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.error.detail).toMatchObject({ reason: 'device_owned', sourceKey: RING1 });
    expect(refused.error.message).toMatch(/^J-Style 2301 records your steps/);
    expect(leaks(refused.error)).toEqual([]);
    // as an MCP client gets it, through the agent dispatcher
    const env = await createBusAgentDispatcher({ directApply: () => false }).call('log.bulk', input, { actor: { kind: 'mcp', id: 'test-client' }, idempotencyKey: 'b2', stage: true });
    expect(env.ok).toBe(false);
    expect(leaks(env)).toEqual([]);
    // the person is refused with the real key, as before
    const mine = await dispatch('log.bulk', input);
    expect(!mine.ok && mine.error.detail?.sourceKey).toBe(KEYS.mac);
  });

  it('a correction applied for an agent names the replaced source by its alias', { timeout: 30_000 }, async () => {
    await seed(KEYS.serial);
    const input = { target: { kind: 'daily', localDate: TODAY, metric: 'steps' }, value: { fields: { steps: 5000 } } };
    const forAgent = out<{ replaced: { sourceKey: string } | null }>(await dispatch('biometrics.correct', input, { actor: { kind: 'user', id: 'local-user', onBehalfOf: MCP } }));
    expect(forAgent.replaced?.sourceKey).toBe(RING1);
    expect(leaks(forAgent)).toEqual([]);
    const mine = out<{ replaced: { sourceKey: string } | null }>(await dispatch('biometrics.correct', { ...input, value: { fields: { steps: 6000 } } }));
    expect(mine.replaced?.sourceKey).toBe(KEYS.serial);
  });

  it('the person’s policy change, read back by an agent in history.list', { timeout: 30_000 }, async () => {
    await seed(KEYS.mac);
    out(await dispatch('bio.setPolicy', { stream: 'hr', policy: { coach: 'daily' }, sourceKey: KEYS.mac }));
    await settleCommits();
    const mine = out<unknown[]>(await dispatch('history.list', {}, { actor: { kind: 'user', id: 'local-user' } }));
    expect(JSON.stringify(mine)).toContain(KEYS.mac);
    for (const [, actor] of AGENTS) expect(leaks(out<unknown[]>(await dispatch('history.list', {}, { actor })))).toEqual([]);
  });
});

describe('a ring sync job read by an agent (R3-10)', () => {
  it('the agent dispatcher’s wait for a job gives the alias as job.result does', { timeout: 30_000 }, async () => {
    await seed(KEYS.mac);
    const env = await createBusAgentDispatcher({ directApply: () => false }).call('bio.testRingJob', {}, { actor: { kind: 'mcp', id: 'test-client' }, stage: false });
    expect(env).toMatchObject({ ok: true, status: 'applied', data: { sourceKey: RING1, note: `Synced ${RING1}.` } });
    expect(leaks(env)).toEqual([]);
  });

  const bcd = (v: number): number => (Math.floor(v / 10) << 4) | v % 10;
  const hrRec = (bpm: number, min: number): Uint8Array => Uint8Array.of(0x55, 0, 0, ...[26, 9, 30, 8, min, 0].map(bcd), bpm);
  const ringLink = (hr: Uint8Array): RecordedLink =>
    Object.assign(
      new RecordedLink(
        [
          { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 5, 2, 5)] },
          { expect: command(0x13), reply: [Uint8Array.of(0x13, 88)] },
          ...HISTORY_CATALOG.map((s) => ({ expect: command(s.opcode, 0), reply: s.opcode === 0x55 ? [hr, Uint8Array.of(0x55, 0xff)] : [Uint8Array.of(s.opcode, 0xff)] })),
        ],
        ADVERTISED,
      ),
      { deviceId: 'aa:bb:cc:00:11:22' },
    );

  it('job.result gives an agent the alias; the person’s result keeps the key', { timeout: 30_000 }, async () => {
    const r = await dispatch('bio.deviceConnect', { driver: 'jstyle2301', linkRef: stageBleLink(ringLink(hrRec(61, 0)), 'jstyle2301') });
    if (!r.ok || !('job' in r)) throw new Error(`expected a job: ${JSON.stringify(r)}`);
    expect((await jobs.wait(r.job.jobId)).state).toBe('done');
    expect(jobs.result(r.job.jobId)).toMatchObject({ sourceKey: KEYS.mac });
    for (const [, actor] of AGENTS) {
      const read = out<{ result: { sourceKey: string } }>(await dispatch('job.result', { jobId: r.job.jobId }, { actor }));
      expect(read.result.sourceKey).toBe(RING1);
      expect(read.result.sourceKey).toBe((await sourcesAs(actor))[0]!.sourceKey);
      expect(leaks(read)).toEqual([]);
    }
  });
});

describe('agents see only sources the Coach sees (R3-12)', () => {
  it('a ring hidden from the Coach is not listed; a partly hidden one lists its shared streams only', { timeout: 30_000 }, async () => {
    await seed(KEYS.serial, { policies: POLICY_STREAMS.map((s) => ringSharingOffPolicy(s)), tag: 'h' });
    await seed(KEYS.mac, { policies: ringDefaultPolicies().map((p) => (p.stream === 'hr' ? { ...p, coach: 'hidden' as const } : p)), tag: 'p' });
    await seed(sourceKeyOf(APPLE_PROV), { prov: APPLE_PROV, label: 'Health', policies: newSourceDoc(APPLE_PROV, 0, POLICY_STREAMS).policies, tag: 'a' });
    expect((await sourcesAs()).map((s) => s.sourceKey).sort()).toEqual([sourceKeyOf(APPLE_PROV), KEYS.mac, KEYS.serial].sort());
    for (const [, actor] of AGENTS) {
      const list = await sourcesAs(actor);
      expect(list).toHaveLength(1);
      const [s] = list;
      expect(s!.sourceKey).toMatch(ALIAS);
      expect(leaks(s)).toEqual([]);
      expect(s!.streams).not.toContain('hr');
      expect(s!.streams).toEqual(expect.arrayContaining(['daily_summary', 'sleep_sessions']));
      expect(s!.policies.map((p) => p.stream)).not.toContain('hr');
    }
  });

  it('with only hidden rings an agent is not told a ring exists (the master switch reads none)', { timeout: 30_000 }, async () => {
    await seed(KEYS.serial, { policies: POLICY_STREAMS.map((s) => ringSharingOffPolicy(s)) });
    const mine = out<{ sources: Source[]; ringSharing: string }>(await dispatch('bio.sources', {}));
    expect(mine).toMatchObject({ ringSharing: 'off', sources: [{ sourceKey: KEYS.serial }] });
    for (const [, actor] of AGENTS) expect(out(await dispatch('bio.sources', {}, { actor }))).toMatchObject({ sources: [], ringSharing: 'none' });
  });
});

describe('the ring defaults notice is the person’s (R3-12)', () => {
  it('bio.sources tells an agent no notice is waiting', { timeout: 30_000 }, async () => {
    // a ring source from before the ring defaults: the one-time migration moves it and leaves the notice
    await seed(KEYS.mac, { policies: suggestedPolicies(['hr', 'hrv', 'sleep_sessions', 'steps', 'daily_summary']) });
    out(await dispatch('biometrics.ringDefaults', {}, { actor: SYSTEM_ACTOR }));
    await settleCommits();
    expect(out<{ ringDefaultsNotice: boolean }>(await dispatch('bio.sources', {})).ringDefaultsNotice).toBe(true);
    for (const [, actor] of AGENTS) expect(out<{ ringDefaultsNotice: boolean }>(await dispatch('bio.sources', {}, { actor })).ringDefaultsNotice).toBe(false);
  });
});

describe('agents get no score this build does not know (R3-12)', () => {
  it('bio.scores names it in hidden for an agent; the person still gets it', { timeout: 30_000 }, async () => {
    await seed(KEYS.mac);
    const store = await openBioStore({ writer: deriveWriter() });
    await store.putScore({
      scoreId: 'future.score', version: '9.0.0', scope: { kind: 'day', localDate: TODAY }, status: 'ok', value: 3, confidence: 'high', contributors: [],
      inputsHash: 'h', sourceIds: ['r-d-2026-10-01'], computedAt: '2026-10-01T07:00:00.000Z', build: 'newer',
    });
    await store.flush();
    type Scores = { results: Array<{ scoreId: string }>; hidden: string[] };
    const mine = out<Scores>(await dispatch('bio.scores', { from: TODAY, to: TODAY }));
    expect(mine.results.map((r) => r.scoreId)).toContain('future.score');
    for (const [, actor] of AGENTS) {
      const agent = out<Scores>(await dispatch('bio.scores', { from: TODAY, to: TODAY }, { actor }));
      expect(agent.results.map((r) => r.scoreId)).toEqual(['sleep.tst']);
      expect(agent.hidden).toEqual(['future.score']);
    }
  });
});

describe('no agent tool takes a source key as input', () => {
  // so an alias never has to be resolved back to a key; a tool that starts taking one must accept the alias
  it('every agent-surface command input is free of sourceKey', () => {
    const takers = allCommands().filter((d) => d.surfaces.some((s) => s !== 'ui') && JSON.stringify(d.input).includes('"sourceKey"'));
    expect(takers.map((d) => d.id)).toEqual([]);
  });
});
