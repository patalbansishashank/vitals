// @vitest-environment node
/**
 * R7 §7.3 spike measurements that can run headlessly (`pnpm spike:sync`, manual; not part of `pnpm test`).
 *
 * (2) import 365 days of logs + daily summaries and 30 days of 1-min HR manifests into Evolu: time and database size;
 * (3) cold pair of a fresh device over a loopback relay (stand-in for Tailscale: no network latency or bandwidth cap);
 * (6) the largest row (≥ 200 KB scenario JSON) syncs.
 * Evolu runs here on better-sqlite3, not SQLite-WASM on OPFS, so browser numbers will be slower; the relay, protocol,
 * encryption and CRDT code paths are the same.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEvoluSyncStore } from '../../../src/sync/evolu/adapter.ts';
import { newOwnerSecret } from '../../../src/sync/pairing.ts';
import { BLOB_MANIFEST_COLLECTION } from '../../../src/sync/types.ts';
import { createNodeEvoluPlatform } from '../src/evoluNode.ts';
import { startCompanion } from '../src/server.ts';

let dir = '';
let relayUrl = '';
let stop: () => Promise<void> = async () => {};
const dirBytes = (d: string, prefix: string) => readdirSync(d).filter((f) => f.startsWith(prefix)).reduce((n, f) => n + statSync(join(d, f)).size, 0);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vitals-spike-'));
  const companion = await startCompanion({ port: 0, dataDir: join(dir, 'companion'), allowedOrigins: [], log: () => {} });
  relayUrl = `http://127.0.0.1:${companion.port}`;
  stop = () => companion.close();
});
afterAll(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

const pad = (n: number) => String(n).padStart(2, '0');
const day = (i: number) => {
  const d = new Date(Date.UTC(2025, 9, 1) + i * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

it('R7 §7.3 (2), (3), (6)', async () => {
  const secret = newOwnerSecret();
  const a = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'A' }), appName: 'spikeA', roundTimeoutMs: 120_000 });
  await a.open({ secret, relayUrl, deviceId: 'SPIKEA', memoryOnly: false });

  const t0 = performance.now();
  const timeline: string[] = [];
  a.onStatus((st) => timeline.push(`${((performance.now() - t0) / 1000).toFixed(2)}s ${st.state} pending=${st.pendingChanges}`));
  let bytes = 0;
  for (let i = 0; i < 365; i++) {
    const log = { date: day(i), entries: Array.from({ length: 6 }, (_, j) => ({ id: `${i}-${j}`, kind: 'food', kcal: 400 + j, note: 'x'.repeat(400) })) };
    const summary = { date: day(i), hrv: 55, rhr: 58, sleep: { stages: Array.from({ length: 120 }, (_, k) => ({ t: k * 240, s: k % 4 })) }, steps: 9000, notes: 'y'.repeat(12_000) };
    bytes += JSON.stringify(log).length + JSON.stringify(summary).length;
    // One import = one Evolu batch per day (puts issued without awaiting share a microtask batch and one sync message).
    await Promise.all([a.put('dailyLogs', `log:${day(i)}`, log), a.put('bioSummaries', `sum:${day(i)}`, summary)]);
  }
  for (let h = 0; h < 30 * 24; h++) {
    const hourStartUtc = new Date(Date.UTC(2026, 8, 1) + h * 3_600_000).toISOString();
    const chunkId = `c${String(h).padStart(21, '0')}`;
    void a.put(BLOB_MANIFEST_COLLECTION, chunkId, { chunkId, source: 'ring', metric: 'hr', hourStartUtc, n: 60, min: 50, max: 140, bytes: 180, contentHash: 'h'.repeat(43), schemaVersion: 1, createdAt: hourStartUtc });
  }
  const big = { list: Array.from({ length: 2500 }, (_, i) => ({ id: `s${i}`, name: `Scenario ${i}`, kcal: 1800 + i, notes: 'x'.repeat(60) })) };
  await a.put('kv', 'vitals.scenarios', big);
  const writeMs = performance.now() - t0;
  await a.push();
  const pushMs = performance.now() - t0;
  const localDb = dirBytes(dir, 'spikeA');

  const t1 = performance.now();
  const b = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'B' }), appName: 'spikeB', roundTimeoutMs: 120_000 });
  await b.open({ secret, relayUrl, deviceId: 'SPIKEB', memoryOnly: false });
  for (let i = 0; i < 1200; i++) {
    if ((await b.list(BLOB_MANIFEST_COLLECTION)).length === 720 && (await b.list('dailyLogs')).length === 365 && (await b.get('kv', 'vitals.scenarios'))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const coldPairMs = performance.now() - t1;
  const relayDb = dirBytes(join(dir, 'companion'), 'relay');

  const report = {
    documents: 365 * 2 + 720 + 1,
    jsonMB: +(bytes / 1e6).toFixed(1),
    importSeconds: +(writeMs / 1000).toFixed(2),
    importAndPushSeconds: +(pushMs / 1000).toFixed(2),
    localDbMB: +(localDb / 1e6).toFixed(1),
    relayDbMB: +(relayDb / 1e6).toFixed(1),
    coldPairSeconds: +(coldPairMs / 1000).toFixed(2),
  };
  process.stderr.write(`R7 §7.3 spike ${JSON.stringify(report)}\n${timeline.filter((l, i, all) => i === 0 || l.split(' ')[1] !== all[i - 1]!.split(' ')[1]).join('\n')}\n`);
  expect(await b.list('dailyLogs')).toHaveLength(365);
  expect(await b.list(BLOB_MANIFEST_COLLECTION)).toHaveLength(720);
  expect(((await b.get('kv', 'vitals.scenarios'))?.value as typeof big).list).toHaveLength(2500);
  expect(report.importSeconds).toBeLessThan(10);
  expect(report.localDbMB).toBeLessThan(50);
  expect(report.coldPairSeconds).toBeLessThan(60);
  await Promise.all([a.close(), b.close()]);
}, 300_000);
