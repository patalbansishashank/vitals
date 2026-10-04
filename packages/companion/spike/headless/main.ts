/**
 * R17: the person store as a plain Node program (bundled by `vite.node.config.ts`, run with `node dist/main.mjs <dir>`).
 * Measures cold start, RSS and one command outside vitest. The owner secret comes from `<dir>/owner.key` (32 raw bytes,
 * mode 0600, created on first run); it is never printed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { newOwnerSecret } from '@/sync/pairing';
import { attachToCommandBus, openPersonStore } from './personStore.ts';

const t0 = performance.now();
const mib = () => Math.round((process.memoryUsage().rss / 2 ** 20) * 10) / 10;
const rss0 = mib();
const dir = process.argv[2] ?? join(process.cwd(), 'person');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const keyFile = join(dir, 'owner.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, newOwnerSecret(), { mode: 0o600 });
chmodSync(keyFile, 0o600);
const secret = new Uint8Array(readFileSync(keyFile));

const { dispatch } = await import('@/commands');
const tBus = performance.now();
const rssBus = mib();
const person = await openPersonStore({ dir, secret, relayUrl: process.argv[3] ?? null, deviceId: 'SERVERHME0000001' as never, instance: 'main' });
await attachToCommandBus(person);
const tStore = performance.now();
const w = await dispatch('log.steps', { date: '2026-10-01', steps: 7000 });
const t1 = performance.now();
const r = await dispatch('today.get', {});
const t2 = performance.now();
await (person.backend as { settled(): Promise<void> }).settled();
console.log(JSON.stringify({ rssStartMiB: rss0, busImportMs: Math.round(tBus - t0), rssAfterBusMiB: rssBus, storeOpenAndAttachMs: Math.round(tStore - tBus), rssAfterStoreMiB: mib(), logStepsOk: w.ok, logStepsMs: Math.round(t1 - tStore), todayOk: r.ok, todayMs: Math.round((t2 - t1) * 10) / 10, totalMs: Math.round(t2 - t0) }));
// as a worker thread (multi.mjs): report, then hold the person open until told to close
if (parentPort) {
  parentPort.postMessage('ready');
  await new Promise((r) => parentPort!.once('message', r));
}
await person.close();
process.exit(0);
