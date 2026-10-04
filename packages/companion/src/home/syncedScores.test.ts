// @vitest-environment node
/**
 * Scores are derived on each device and never synced. Device A (the server's person program in a real Worker, as in
 * production) ingests the ring; device B (the same app code in this process, paired with the same owner secret) gets
 * the records and sample chunks through the relay (/sync and /blobs) and must compute the same scores.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { openPersonProgram } from './personProgram.ts';
import type { PersonProgram, PersonResponse } from './personRpc.ts';
import { SITE } from './testHome.ts';
import { threadWorkerFactory } from './workers.ts';

const pkg = new URL('../../', import.meta.url);
const outDir = `dist/scoretest-${process.pid}`;
const bundle = new URL(`${outDir}/person-worker.mjs`, pkg);
const done: Array<() => Promise<unknown>> = [];

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'vite', 'build', '-c', 'vite.person.config.ts', '--outDir', outDir], { cwd: pkg, stdio: 'ignore' });
}, 300_000);
afterAll(async () => {
  for (const d of done.reverse()) await d().catch(() => undefined);
  await rm(new URL(outDir, pkg), { recursive: true, force: true });
});

const ok = <T>(r: PersonResponse): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value as T;
};
type Envelope = { ok: boolean; output?: unknown; error?: unknown };
type Score = { scoreId: string; version: string; scope: { kind: string; localDate: string }; value?: unknown; state?: unknown };
const key = (s: Score) => `${s.scoreId}@${s.version}|${s.scope.kind}:${s.scope.localDate}`;
const summary = (xs: Score[]) => Object.fromEntries(xs.map((s) => [key(s), JSON.stringify([s.value ?? null, s.state ?? null])]).sort());

it('a device that receives ring data by sync scores it like the device that imported it', async () => {
  const dataDir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'synced-scores-'));
  done.push(() => rm(dataDir, { recursive: true, force: true }));
  const c: Companion = await startCompanion({
    port: 0,
    dataDir: join(dataDir, 'relay'),
    allowedOrigins: [],
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', workerFactory: threadWorkerFactory(bundle) },
  });
  done.push(() => c.close());
  const home = c.home!;
  const secret = new Uint8Array(32).fill(9);
  const relayUrl = `${c.url.replace('http', 'ws')}/sync`;
  const range = { from: '2026-09-29', to: '2026-10-03' };

  // device A: the server's person, fed by the broker path
  const a = await home.persons.add({ label: 'A', timeZone: 'Europe/Berlin', secret, relayUrl });
  const ring = (await readFile(new URL('spike/headless/fixtures/ring.jsonl', pkg), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as unknown);
  ok(await home.pool.call(a.id, { op: 'ingestLumen', events: ring, installations: {} }));
  ok(await home.pool.call(a.id, { op: 'flush' }));
  const scoresA = async () => (ok<Envelope>(await home.pool.call(a.id, { op: 'dispatch', command: 'bio.scores', input: range, source: 'ui' })).output as { results: Score[] }).results;
  let fromA: Score[] = [];
  for (let i = 0; i < 100 && fromA.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 200));
    fromA = await scoresA();
  }
  expect(fromA.length).toBeGreaterThan(0);

  // device B: same owner, its own replica and chunk store, nothing imported; it rescores on its own as a browser does
  // (automatic rescoring is off under test unless turned on; no explicit flush below)
  const { setAutoRescore } = await import('@/commands/bio/runtime');
  setAutoRescore(true);
  const b: PersonProgram = await openPersonProgram({ personId: 'b'.repeat(16), dir: join(dataDir, 'device-b'), timeZone: 'Europe/Berlin', deviceId: 'DEVICEB000000001', relayUrl, instance: 'b' }, secret);
  done.push(() => b.close());
  const scoresB = async () => (ok<Envelope>(await b.handle({ op: 'dispatch', command: 'bio.scores', input: range, source: 'ui' })).output as { results: Score[] }).results;
  let fromB: Score[] = [];
  for (let i = 0; i < 150 && Object.keys(summary(fromB)).length < Object.keys(summary(fromA)).length; i++) {
    await new Promise((r) => setTimeout(r, 200));
    fromB = await scoresB();
  }
  console.log(JSON.stringify({ scoresA: fromA.length, scoresB: fromB.length }));
  expect(summary(fromB)).toEqual(summary(fromA));
}, 300_000);
