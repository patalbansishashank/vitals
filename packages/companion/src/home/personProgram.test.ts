// @vitest-environment node
/**
 * One person's program in-process (production runs it in a Worker): the command bus on the person's Evolu replica,
 * "today" in the person's zone, local-only collections and the undo/idempotency ledgers surviving a restart, file
 * modes, and the Lumen ingest.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { newOwnerSecret } from '@/sync/pairing';
import { openPersonProgram } from './personProgram.ts';
import type { IngestLumenResult, PersonInit, PersonProgram, PersonResponse, PersonStats } from './personRpc.ts';

const root = join(process.env.TMPDIR ?? '/tmp', `person-program-${process.pid}`);
const init: PersonInit = { personId: '0123456789abcdef', dir: join(root, 'persons', '0123456789abcdef'), timeZone: 'Pacific/Kiritimati', deviceId: 'SERVERHME0000001', relayUrl: null, instance: 'pp1' };
const secret = newOwnerSecret();
const fixture = readFileSync(join(import.meta.dirname, '../../spike/headless/fixtures/ring.jsonl'), 'utf8').trim().split('\n');

// 16:00 UTC = 06:00 the next day in Kiritimati (UTC+14), past the 04:00 rollover: the person's day is 2 October
const NOW = new Date('2026-10-01T16:00:00.000Z');

beforeAll(() => {
  mkdirSync(root, { recursive: true });
  vi.useFakeTimers({ toFake: ['Date'], now: NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const value = <T>(r: PersonResponse): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value as T;
};
type Envelope = { ok: boolean; output?: unknown };

it('runs the bus in the person zone, persists local-only collections and ingests Lumen events', async () => {
  let p: PersonProgram = await openPersonProgram(init, secret);

  const logged = value<Envelope>(await p.handle({ op: 'dispatch', command: 'log.steps', input: { steps: 7000 }, source: 'ui' }));
  expect(logged.ok).toBe(true);
  const today = value<Envelope>(await p.handle({ op: 'dispatch', command: 'today.get', input: {}, source: 'ui' }));
  expect(today.ok).toBe(true);
  expect((today.output as { date: string }).date).toBe('2026-10-02');
  const day = value<Envelope>(await p.handle({ op: 'dispatch', command: 'log.get', input: { from: '2026-10-02', to: '2026-10-02' }, source: 'ui' }));
  expect(JSON.stringify(day.output)).toContain('7000');

  const keyed = value<Envelope>(await p.handle({ op: 'dispatch', command: 'log.steps', input: { date: '2026-10-01', steps: 4321 }, source: 'agent', idempotencyKey: 'mqtt-replay-1' }));
  expect(keyed.ok).toBe(true);

  // the planner pool is not on the server: planner runs (past their safety gate) fail with rule not_on_server
  const { getPorts } = await import('@/commands');
  expect(() => getPorts().planner!.prepare()).toThrow(expect.objectContaining({ error: expect.objectContaining({ code: 'precondition_failed', detail: expect.objectContaining({ rule: 'not_on_server' }) }) }));

  const odd = { specversion: '1.0', id: 'odd-1', type: 'health.unheard_of', source: 'urn:pulseloop:installation:spike', data: {} };
  const ingest = value<IngestLumenResult>(await p.handle({ op: 'ingestLumen', events: [...fixture.slice(0, 40).map((l) => JSON.parse(l) as unknown), odd], installations: {} }));
  expect(ingest.added).toBeGreaterThan(0);
  expect(ingest.rejected).toEqual([{ index: 40, reason: 'unknown_type', type: 'health.unheard_of' }]);
  const again = value<IngestLumenResult>(await p.handle({ op: 'ingestLumen', events: fixture.slice(0, 40).map((l) => JSON.parse(l) as unknown), installations: {} }));
  expect(again.added).toBe(0);

  const stats = value<PersonStats>(await p.handle({ op: 'stats' }));
  expect(stats).toMatchObject({ personId: init.personId, timeZone: 'Pacific/Kiritimati', deviceId: init.deviceId });
  expect(stats.documents).toBeGreaterThan(2);
  expect(value(await p.handle({ op: 'flush' }))).toBeNull();
  await p.close();

  // 0700 directories, 0600 files, local.db and the blob store on disk
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const path = join(d, f);
      const s = statSync(path);
      expect([path, (s.mode & 0o777).toString(8)]).toEqual([path, s.isDirectory() ? '700' : '600']);
      if (s.isDirectory()) walk(path);
      else files.push(path.slice(init.dir.length + 1));
    }
  };
  walk(init.dir);
  expect(files).toContain('local.db');
  expect(files).toContain(join('blobs', 'index.db'));
  expect(files.some((f) => f.endsWith('.db') && f !== 'local.db' && !f.startsWith('blobs'))).toBe(true);

  // a restart: the module singletons forget their in-memory ledger and undo log; the person's files hold them
  const { resetBusState, resetHistory, changeSets } = await import('@/commands');
  resetBusState();
  resetHistory();
  p = await openPersonProgram({ ...init, instance: 'pp2' }, secret);
  const after = value<Envelope>(await p.handle({ op: 'dispatch', command: 'log.get', input: { from: '2026-10-01', to: '2026-10-02' }, source: 'ui' }));
  expect(JSON.stringify(after.output)).toContain('7000');
  expect(changeSets().some((c) => c.commandId === 'log.steps')).toBe(true);
  // the same idempotency key replays the stored result instead of logging again
  const replay = value<Envelope>(await p.handle({ op: 'dispatch', command: 'log.steps', input: { date: '2026-10-01', steps: 4321 }, source: 'agent', idempotencyKey: 'mqtt-replay-1' }));
  expect(replay).toEqual(keyed);
  expect(changeSets().filter((c) => c.commandId === 'log.steps')).toHaveLength(2);
  await p.close();
}, 120_000);
