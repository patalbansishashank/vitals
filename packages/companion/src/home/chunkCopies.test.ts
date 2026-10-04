// @vitest-environment node
/**
 * Live ring messages arrive one at a time: each merges into the day's chunk. The merged chunk replaces the previous
 * one (manifest removed, file deleted), so after the whole stream the person holds what one file-sized batch of the
 * same events stores: the same chunk documents and the same chunk files, byte for byte in size.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { newOwnerSecret } from '@/sync/pairing';
import { openPersonProgram } from './personProgram.ts';
import type { PersonInit, PersonResponse, PersonStats } from './personRpc.ts';

const root = join(process.env.TMPDIR ?? '/tmp', `chunk-copies-${process.pid}`);
const secret = newOwnerSecret();
const events = readFileSync(join(import.meta.dirname, '../../spike/headless/fixtures/ring.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as unknown);

beforeAll(() => {
  mkdirSync(root, { recursive: true });
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T16:00:00.000Z'), shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const ok = <T>(r: PersonResponse): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value as T;
};

/** Chunk files on disk (`blobs/<shard>/<chunkId>`; the sqlite index aside): count and total bytes. */
function chunkFiles(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const blobs = join(dir, 'blobs');
  for (const shard of readdirSync(blobs, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue;
    for (const f of readdirSync(join(blobs, shard.name))) {
      files++;
      bytes += statSync(join(blobs, shard.name, f)).size;
    }
  }
  return { files, bytes };
}

async function run(name: string, batches: unknown[][]) {
  const init: PersonInit = { personId: name.padEnd(16, '0'), dir: join(root, name), timeZone: 'Europe/Berlin', deviceId: `SERVER${name.toUpperCase()}`.padEnd(16, '0'), relayUrl: null, instance: name };
  const p = await openPersonProgram(init, secret);
  for (const b of batches) ok(await p.handle({ op: 'ingestLumen', events: b, installations: {} }));
  ok(await p.handle({ op: 'flush' }));
  const { openBioStore } = await import('@/commands/bio/store');
  const store = await openBioStore();
  const manifests = await store.manifests({ includeSuperseded: true });
  const documents = ok<PersonStats>(await p.handle({ op: 'stats' })).documents;
  await p.close();
  return { manifests: manifests.length, manifestBytes: manifests.reduce((n, m) => n + m.bytes, 0), documents, ...chunkFiles(init.dir) };
}

it('a stream of single messages stores the chunks one batch stores', async () => {
  const streamed = await run('streamed', events.map((e) => [e]));
  const batch = await run('batch', [events]);
  expect(batch.manifests).toBeGreaterThan(0);
  expect(streamed).toEqual(batch);
}, 180_000);
