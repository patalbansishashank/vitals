// @vitest-environment node
/**
 * R17 spike: the Vitals data layer headless in Node. One run measures and records (results/r17-results.json):
 *   (a) the command bus against a person's Evolu store, (b) the Lumen ring ingest from a JSONL fixture through
 *   `bio.import`, (c) a Coach/MCP tool call through the same guard the browser bridge uses, (d) sync through the
 *   in-process relay to a second "device", plus start-up time, RSS, the person directory on disk, 1 vs 5 persons.
 * Every step records its outcome instead of failing fast, so one run lists every blocker.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { newOwnerSecret } from '@/sync/pairing';
import { createEvoluSyncStore } from '@/sync/evolu/adapter';
import type { SyncStore } from '@/sync/types';
import { createNodeEvoluPlatform } from '../../src/evoluNode.ts';
import { startCompanion } from '../../src/server.ts';
import { attachToCommandBus, isSynced, openPersonStore, type PersonStore } from './personStore.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(process.env.TMPDIR ?? join(here, '.tmp'), `r17-${process.pid}`);
const results: Record<string, unknown> = { node: process.version, platform: `${process.platform}-${process.arch}` };
const mib = (n: number) => Math.round((n / 2 ** 20) * 10) / 10;
const rss = () => mib(process.memoryUsage().rss);
const heap = () => mib(process.memoryUsage().heapUsed);
let relayUrl = '';
let stopRelay = async () => {};

function layout(dir: string) {
  const out: { path: string; bytes: number; mode: string }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const s = statSync(p);
      out.push({ path: relative(root, p) + (s.isDirectory() ? '/' : ''), bytes: s.size, mode: (s.mode & 0o777).toString(8) });
      if (s.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = performance.now();
  try {
    const v = await fn();
    results[name] = { ok: true, ms: Math.round(performance.now() - t0), ...(v && typeof v === 'object' ? (v as object) : { value: v }) };
    return v;
  } catch (e) {
    results[name] = { ok: false, ms: Math.round(performance.now() - t0), error: String((e as Error)?.stack ?? e).split('\n').slice(0, 6).join(' | ') };
    return undefined;
  }
}

async function perCollection(s: SyncStore): Promise<Record<string, number>> {
  const { COLLECTIONS } = await import('@/store');
  const out: Record<string, number> = {};
  for (const col of Object.keys(COLLECTIONS)) if (isSynced(col)) { const n = (await s.list(col)).filter((d) => !d._deleted).length; if (n) out[col] = n; }
  return out;
}
async function syncedCount(s: SyncStore): Promise<number> {
  return Object.values(await perCollection(s)).reduce((a, b) => a + b, 0);
}

beforeAll(async () => {
  mkdirSync(root, { recursive: true });
  const c = await startCompanion({ port: 0, dataDir: join(root, 'relay'), allowedOrigins: [], log: () => {} });
  relayUrl = `http://127.0.0.1:${c.port}`;
  stopRelay = () => c.close();
  results.rssBaselineMiB = rss();
});

afterAll(async () => {
  await stopRelay();
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', 'r17-results.json'), JSON.stringify(results, null, 2) + '\n');
  rmSync(root, { recursive: true, force: true });
});

it('one person: store, command bus, ingest, agent tool call, sync to a second device', async () => {
  const secret = newOwnerSecret(); // in E25: read from the person's 0600 key file, never logged
  const rss0 = rss();
  const cmds = await step('importCommandBus', async () => {
    const m = await import('@/commands');
    return { commands: m.allCommands().length, rssMiB: rss(), heapMiB: heap(), deltaMiB: Math.round((rss() - rss0) * 10) / 10 };
  });
  expect(cmds).toBeTruthy();
  const { dispatch, installPorts, jobs, allCommands, toolName } = await import('@/commands');

  const rss1 = rss();
  const person = (await step('openPersonStore', async () => {
    const p = await openPersonStore({ dir: join(root, 'persons', 'p1'), secret, relayUrl, deviceId: 'SERVERHME0000001' as never, instance: 'p1' });
    return Object.assign(p, { rssDeltaMiB: Math.round((rss() - rss1) * 10) / 10 });
  })) as PersonStore | undefined;
  expect(person).toBeTruthy();
  await step('attachToCommandBus', () => attachToCommandBus(person!).then(() => ({ rssMiB: rss() })));
  // the object step() stored above holds the store itself: keep only numbers
  results.openPersonStore = { ok: true, openMs: Math.round(person!.openMs), rssDeltaMiB: (results.openPersonStore as { rssDeltaMiB: number }).rssDeltaMiB };

  // (a) reads and writes through the bus, no DOM
  const ran: Record<string, unknown> = {};
  const run = async (id: string, input: unknown) => {
    const t0 = performance.now();
    try {
      const r = await dispatch(id, input);
      ran[id] = r.ok ? { ok: true, ms: Math.round(performance.now() - t0), kind: 'job' in r ? 'job' : 'pending' in r ? 'pending' : 'output' } : { ok: false, code: r.error.code, message: r.error.message.slice(0, 160) };
      return r;
    } catch (e) {
      ran[id] = { ok: false, threw: String((e as Error)?.message ?? e).slice(0, 200) };
      return undefined;
    }
  };
  await run('settings.update', { patch: { units: 'imperial' } });
  await run('profile.get', {});
  await run('today.get', {});
  await run('plan.get', {});
  await run('day.get', {});
  await run('food.dayTargets', { date: '2026-10-01' });
  await run('goals.get', {});
  await run('safety.status', {});
  await run('pantry.add', { items: [{ label: 'oats' }] });
  await run('log.steps', { date: '2026-10-01', steps: 8000 });
  await run('log.sleep', { bedAt: '2026-09-30T21:30:00.000Z', wakeAt: '2026-10-01T05:30:00.000Z', quality: 'good' });
  await run('log.measurement', { date: '2026-10-01', metric: 'weightKg', value: 80.4, context: 'morningFasted', method: 'scale' });
  await run('log.note', { date: '2026-10-01', text: 'headless spike' });
  await run('log.get', { from: '2026-10-01', to: '2026-10-01' });
  // commands whose executors need a port the browser installs (planner worker pool, downloads, navigation)
  await run('planner.find', { tier: 'S' });
  await run('data.export', {});
  await run('nav.open', { route: 'today' });
  await run('markers.import', { attachmentId: 'nope', allowVision: false });
  results.commandContext = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, device: (await import('@/state/runtime')).getDocumentStore().device };
  await step('livingAutomation', async () => {
    const { startLivingAutomation, runRollover } = await import('@/commands');
    const stop = startLivingAutomation() as unknown;
    await runRollover();
    if (typeof stop === 'function') (stop as () => void)();
    return { started: true };
  });
  results.logLikeCommands = allCommands().map((c) => c.id).filter((id) => /log|meal|living|checkIn/i.test(id));
  results.commands = ran;
  const rssCmd = rss();
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) await dispatch('today.get', {});
  results.todayGetx20 = { msEach: Math.round(((performance.now() - t1) / 20) * 10) / 10, rssDeltaMiB: Math.round((rss() - rssCmd) * 10) / 10 };

  // (b) ring ingest: the bio port hands the command a Blob, as the screen's file picker would
  const jsonl = readFileSync(join(here, 'fixtures', 'ring.jsonl'), 'utf8');
  installPorts({ bio: { takeFile: (ref: string) => (ref === 'ring' ? ({ blob: new Blob([jsonl]), name: 'ring.jsonl' } as never) : undefined), takeLink: () => undefined } });
  await step('bioImport', async () => {
    const r = await dispatch('bio.import', { fileRef: 'ring', format: 'lumen_cloudevents' });
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    if (!('job' in r)) throw new Error('expected a job');
    const s = await jobs.wait(r.job.jobId);
    const res = await dispatch('job.result', { jobId: r.job.jobId });
    return { state: s.state, error: (s as { error?: unknown }).error, result: res.ok && 'output' in res ? res.output : res, events: jsonl.trim().split('\n').length };
  });
  await run('bio.daily', { from: '2026-09-30', to: '2026-10-01' });

  // (c) a Coach/MCP tool call through the guard the browser bridge uses (agentHub forwards to it today)
  await step('agentToolCall', async () => {
    const { createBusAgentDispatcher } = await import('@/commands/ai/agentDispatcher');
    const { guardedCall } = await import('@/agents/dispatcher');
    const d = createBusAgentDispatcher({ directApply: () => false });
    const manifest = await d.manifest();
    const { toolsFor } = await import('@/agents/manifest');
    const mcpTools = toolsFor(manifest, 'mcp');
    const read = await guardedCall(d, manifest, 'mcp', toolName('today.get'), {}, { actor: { kind: 'mcp', id: 'r17-spike' } });
    const write = await guardedCall(d, manifest, 'mcp', toolName('settings.update'), { patch: { units: 'metric' } }, { actor: { kind: 'mcp', id: 'r17-spike' }, idempotencyKey: 'r17-1' });
    const log = await guardedCall(d, manifest, 'mcp', toolName('log.steps'), { date: '2026-10-02', steps: 4321 }, { actor: { kind: 'mcp', id: 'r17-spike' }, idempotencyKey: 'r17-2' });
    const plan = await guardedCall(d, manifest, 'mcp', toolName('plan.get'), {}, { actor: { kind: 'mcp', id: 'r17-spike' } });
    return { mcpTools: mcpTools.length, read: read.status, settingsUpdate: write.status, logSteps: log.status, planGet: plan.status, logStepsEnvelope: JSON.stringify(log).slice(0, 300) };
  });

  // (d) a second device with the same secret sees the writes through the relay
  await step('secondDeviceSync', async () => {
    await (person!.backend as { settled(): Promise<void> }).settled();
    await person!.sync.push();
    const want = await syncedCount(person!.sync);
    const b = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: root, instance: 'deviceB' }), appName: 'vitalsB' });
    const t0 = performance.now();
    await b.open({ secret, relayUrl, deviceId: 'DEVICEBDEVICEB01' as never, memoryOnly: true });
    let got = 0;
    for (let i = 0; i < 150 && (got = await syncedCount(b)) < want; i++) await new Promise((r) => setTimeout(r, 100));
    const onB = await perCollection(b);
    await b.close();
    return { syncedDocsOnA: want, seenOnB: got, ms: Math.round(performance.now() - t0), perCollectionOnA: await perCollection(person!.sync), perCollectionOnB: onB };
  });

  results.personDirLayout = layout(join(root, 'persons'));
  results.browserGlobalsTouched = (globalThis as { __r17hits?: unknown }).__r17hits;
  results.mode = (import.meta as { env?: { MODE?: string } }).env?.MODE;
  results.rssAfterOnePersonMiB = rss();
  await person!.close();
  // reopen from disk: the Evolu database survives a restart
  await step('reopenFromDisk', async () => {
    const p = await openPersonStore({ dir: join(root, 'persons', 'p1'), secret, relayUrl: null, deviceId: 'SERVERHME0000001' as never, instance: 'p1b' });
    const n = await syncedCount(p.sync);
    await p.close();
    return { syncedDocs: n, openMs: Math.round(p.openMs) };
  });
}, 300_000);

it('five persons in one process (Evolu stores only; the bus is a singleton)', async () => {
  const base = rss();
  const persons: PersonStore[] = [];
  const opens: number[] = [];
  for (let i = 2; i <= 6; i++) {
    const p = await openPersonStore({ dir: join(root, 'persons', `p${i}`), secret: newOwnerSecret(), relayUrl, deviceId: `SERVERHME000000${i}` as never, instance: `p${i}` });
    persons.push(p);
    opens.push(Math.round(p.openMs));
  }
  const afterOpen = rss();
  const t0 = performance.now();
  for (const p of persons) for (let k = 0; k < 200; k++) await p.sync.put('kv', `vitals.k${k}`, { k, pad: 'x'.repeat(500) });
  const writeMs = Math.round(performance.now() - t0);
  const after = rss();
  results.fivePersonsOpenOnlyMiB = Math.round((afterOpen - base) * 10) / 10;
  results.fivePersonsWrites = { docs: 1000, ms: writeMs };
  results.fivePersons = { openMs: opens, rssBeforeMiB: base, rssAfterMiB: after, perPersonMiB: Math.round(((after - base) / 5) * 10) / 10 };
  await Promise.all(persons.map((p) => p.close()));
  results.fivePersons = { ...(results.fivePersons as object), rssAfterCloseMiB: rss() };
  expect(persons).toHaveLength(5);
}, 300_000);
