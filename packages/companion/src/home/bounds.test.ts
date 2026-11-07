// @vitest-environment node
/** E6 review of the home role: workers never overlap, a revoked token stays revoked. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { createDeviceStore } from './devices.ts';
import { createPersonRegistry } from './persons.ts';
import { createWorkerPool } from './workers.ts';

const tmp = () => mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'e6-'));
async function rig(now?: () => number) {
  const dir = await tmp();
  const persons = createPersonRegistry(dir);
  const p = await persons.add({ label: 'Ana', timeZone: 'UTC', secret: new Uint8Array(32).fill(1), relayUrl: null });
  return { dir, persons, id: p.id, devices: createDeviceStore({ dataDir: dir, persons, ...(now ? { now } : {}) }) };
}

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
  it('ignores forwarded addresses on direct connections', async () => {
    const { pairingClientAddress } = await import('./home.ts');
    const loopbackV4 = [127, 0, 0, 1].join('.');
    const directV6 = ['2001', 'db8', '', '1'].join(':');
    expect(pairingClientAddress('direct-peer', 'chosen-peer, chosen-peer-2')).toBe('direct-peer');
    expect(pairingClientAddress('localhost', 'chosen-peer, proxy-saw-peer')).toBe('proxy-saw-peer');
    expect(pairingClientAddress('localhost', undefined)).toBe('localhost');
    expect(pairingClientAddress('::1', 'chosen-peer, proxy-saw-peer')).toBe('proxy-saw-peer');
    expect(pairingClientAddress(`::ffff:${loopbackV4}`, 'chosen-peer, proxy-saw-peer')).toBe('proxy-saw-peer');
    expect(pairingClientAddress(directV6, 'chosen-peer')).toBe(directV6);
    expect(pairingClientAddress(undefined, 'chosen-peer')).toBe('?');
  });

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
    const t = await startTestHome();
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
