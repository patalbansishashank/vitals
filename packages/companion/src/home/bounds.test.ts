// @vitest-environment node
/** E6 review of the home role: files that grow with traffic stay bounded, workers never overlap, a revoked token stays revoked. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, open, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { createDeviceStore } from './devices.ts';
import { createIngestState, DEADLETTER_DAY_MAX_BYTES, WAL_COMPACT_BYTES } from './ingest.ts';
import { createPersonRegistry } from './persons.ts';
import { createWorkerPool } from './workers.ts';

const tmp = () => mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'e6-'));
async function rig(now?: () => number, walPendingMaxBytes?: number) {
  const dir = await tmp();
  const persons = createPersonRegistry(dir);
  const p = await persons.add({ label: 'Ana', timeZone: 'UTC', secret: new Uint8Array(32).fill(1), relayUrl: null });
  return { dir, persons, id: p.id, ingest: createIngestState({ persons, ...(now ? { now } : {}), ...(walPendingMaxBytes ? { walPendingMaxBytes } : {}) }), devices: createDeviceStore({ dataDir: dir, persons, ...(now ? { now } : {}) }) };
}
const entry = (n: number, bytes = 10) => ({ envelopeId: `e${n}`, topic: 't', receivedAt: 'x', payload: 'x'.repeat(bytes) });

describe('dead letters', { timeout: 60_000 }, () => {
  it('stop taking lines at the day cap and keep a count of what was dropped', async () => {
    const { ingest, persons, id } = await rig();
    const N = 700;
    for (let i = 0; i < N; i++) await ingest.deadLetter(id, { reason: 'not_json', bytes: 5000, sample: 'z'.repeat(2048) }, false);
    const dir = persons.paths(id).deadletter;
    const files = await readdir(dir);
    const jsonl = files.filter((f) => f.endsWith('.jsonl'));
    expect(jsonl).toHaveLength(1);
    expect((await stat(join(dir, jsonl[0]!))).size).toBeLessThanOrEqual(DEADLETTER_DAY_MAX_BYTES);
    const lines = (await readFile(join(dir, jsonl[0]!), 'utf8')).split('\n').filter(Boolean).length;
    const dropped = (await stat(join(dir, jsonl[0]!.replace('.jsonl', '.dropped')))).size;
    expect(lines + dropped).toBe(N);
    const s = await ingest.status(id, { enabled: true, address: null, connected: () => false });
    expect(s.deadLetters.today).toBe(N);
  });

  it('old files are pruned while the server runs, not only at start-up', async () => {
    const { ingest, persons, id } = await rig();
    const dir = persons.paths(id).deadletter;
    await mkdir(dir, { recursive: true });
    const old = join(dir, '2020-01-01.jsonl');
    await writeFile(old, '{}\n');
    await ingest.deadLetter(id, { reason: 'not_json', bytes: 1, sample: 'x' });
    expect(await readdir(dir)).not.toContain('2020-01-01.jsonl');
    await utimes(dir, new Date(), new Date());
  });
});

describe('write-ahead log', { timeout: 60_000 }, () => {
  it('refuses new messages once too many are waiting for import (no PUBACK), and accepts again after they are imported', async () => {
    const MiB = 1024 * 1024;
    const { ingest, id } = await rig(undefined, 8 * MiB);
    const fit = 8;
    for (let i = 0; i < fit; i++) expect(await ingest.walWrite(id, entry(i, MiB))).toBe('written');
    await expect(ingest.walWrite(id, entry(9999, MiB))).rejects.toMatchObject({ code: 'wal_full' });
    await ingest.walDone(id, 'e0');
    expect(await ingest.walWrite(id, entry(9999, MiB))).toBe('written');
  });

  it('is compacted under a stream that never goes idle, and pending entries survive the rewrite', async () => {
    const { ingest, persons, id } = await rig();
    const MiB = 4 * 1024 * 1024;
    expect(await ingest.walWrite(id, entry(0, 100))).toBe('written'); // stays pending
    for (let i = 1; i <= 12; i++) {
      await ingest.walWrite(id, entry(i, MiB));
      await ingest.walDone(id, `e${i}`);
    }
    expect((await stat(persons.paths(id).wal)).size).toBeLessThan(WAL_COMPACT_BYTES + 2 * MiB);
    expect((await ingest.walPending(id)).map((e) => e.envelopeId)).toEqual(['e0']);
    expect(await ingest.walWrite(id, entry(5, 10))).toBe('duplicate'); // done markers still recognise a resend
  });
});

describe('worker pool', () => {
  it('never opens a second worker for a person while the first is still closing', async () => {
    const dir = await tmp();
    const persons = createPersonRegistry(dir);
    const p = await persons.add({ label: 'Ana', timeZone: 'UTC', secret: new Uint8Array(32).fill(1), relayUrl: null });
    let live = 0;
    let peak = 0;
    const pool = createWorkerPool({
      persons,
      idleMs: 5,
      factory: async () => {
        live++;
        peak = Math.max(peak, live);
        return {
          call: async () => ({ ok: true, value: null }),
          close: async () => {
            await new Promise((r) => setTimeout(r, 60));
            live--;
          },
        };
      },
    });
    await pool.call(p.id, { op: 'stats' });
    await new Promise((r) => setTimeout(r, 30)); // the idle timer fires, the close is under way
    await pool.call(p.id, { op: 'stats' });
    await pool.closeAll();
    expect(peak).toBe(1);
  });
});

describe('device tokens', () => {
  it('a revoke that lands while the token index is being built is not undone by the build', async () => {
    const { devices, persons, id, dir } = await rig();
    const second = await persons.add({ label: 'Ben', timeZone: 'UTC', secret: new Uint8Array(32).fill(2), relayUrl: null });
    const { token, deviceId } = await devices.mint(id, { kind: 'device', label: 'Phone' });
    // the build reads the first person, then blocks on the second person's devices.json (a named pipe) until we open it
    const fifo = persons.paths(second.id).devices;
    await rm(fifo);
    execFileSync('mkfifo', [fifo]);
    const stale = devices.resolve(token); // has read the first person's file (token valid), waits on the pipe
    await new Promise((r) => setTimeout(r, 100));
    await devices.revoke(id, deviceId);
    const w = await open(fifo, 'w');
    await w.writeFile('[]');
    await w.close();
    await stale;
    await rm(fifo);
    await writeFile(fifo, '[]');
    expect(await devices.resolve(token)).toEqual({ ok: false, error: 'revoked' });
    void dir;
  });
});

describe('limits', () => {
  it('a NaN, zero or negative daily cap or per-minute limit is no setting, never a block', async () => {
    const { createUsageLog } = await import('../usage.ts');
    const { positiveInt } = await import('../providers.ts');
    const dir = await tmp();
    for (const bad of [Number.NaN, -3, 0, Infinity]) {
      const u = createUsageLog({ personDir: dir, timeZone: () => 'UTC', requestsPerDay: bad });
      await u.append({ preset: 'nim', model: null, inputTokens: 1, outputTokens: 1, status: 200 });
      expect(await u.capReached()).toBe(false);
      expect((await u.summary()).cap).toBeUndefined();
      expect(positiveInt(bad)).toBeUndefined();
    }
    expect(positiveInt(2.9)).toBe(2);
  });

  it('the pairing limiter keys on the address the proxy saw, not on a client-chosen X-Forwarded-For', async () => {
    const { startTestHome } = await import('./testHome.ts');
    const t = await startTestHome({ mqtt: false });
    try {
      let limited = 0;
      for (let i = 0; i < 80; i++) {
        const r = await fetch(`${t.c.url}/v1/pair/device`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${i}.1, 203.0.113.9` }, body: JSON.stringify({ code: '00000000' }) });
        if (r.status === 429) limited++;
      }
      expect(limited).toBeGreaterThan(0);
    } finally {
      await t.c.close();
    }
  });
});
