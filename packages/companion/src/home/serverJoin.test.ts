// @vitest-environment node
/**
 * Pairing turns sync on (plan decision 5, R20-PAIR): a person added on a `home` server with a random sync key (what
 * `persons add` without `--join` does) is already a group of one. A browser paired by code gets that key once from
 * `POST /v1/sync/key`, builds the same `vitals-sync:1` code the 24 words stand for, and its store sees the documents
 * the server's replica wrote. The replica here is a node Evolu store opened with the key from `owner.key`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEvoluSyncStore } from '../../../../src/sync/evolu/adapter.ts';
import { formatPairingUri, newOwnerSecret, parsePairingUri } from '../../../../src/sync/pairing.ts';
import { KV_COLLECTION } from '../../../../src/sync/types.ts';
import { createNodeEvoluPlatform } from '../evoluNode.ts';
import { startCompanion, type Companion } from '../server.ts';
import { fakeWorkers, SITE } from './testHome.ts';

let dir = '';
let c: Companion;
beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'server-join-'));
  c = await startCompanion({
    port: 0,
    dataDir: join(dir, 'relay'),
    allowedOrigins: [],
    log: () => {},
    home: { dataDir: dir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', mqtt: { enabled: false }, workerFactory: fakeWorkers().factory },
  });
});
afterAll(async () => {
  await c.close();
  rmSync(dir, { recursive: true, force: true });
});

it('a browser paired by code joins the group the server already holds', async () => {
  const home = c.home!;
  const relayUrl = c.url;
  const p = await home.persons.add({ label: 'Ana', timeZone: 'UTC', secret: newOwnerSecret(), relayUrl: null });

  // the server's replica: opened with the key on disk, writes a document and pushes it to the relay
  const replica = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'SRV' }), appName: 'vitalsSRV' });
  await replica.open({ secret: await home.persons.readSecret(p.id), relayUrl, deviceId: 'SERVERREPLICA001', memoryOnly: true });
  await replica.put(KV_COLLECTION, 'vitals.settings', { state: { units: 'metric' }, version: 3 }, { schema: 3 });
  await replica.push();

  // the browser: pair by code, then ask for the key once
  const { code } = await home.devices.issueCode(p.id);
  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${c.url}${path}`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const paired = (await (await post('/v1/pair/device', { code, label: 'Browser' })).json()) as { token: string };
  const res = await post('/v1/sync/key', {}, paired.token);
  expect(res.status).toBe(200);
  const { key, format } = (await res.json()) as { key: string; format: string };
  expect(format).toBe('owner-secret-v1');
  // the same join code the words and QR give
  const joined = parsePairingUri(formatPairingUri(relayUrl, Buffer.from(key, 'base64url'), 'Ana'));
  expect(joined.relayUrl).toBe(relayUrl);

  const browser = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance: 'WEB' }), appName: 'vitalsWEB' });
  await browser.open({ secret: joined.secret, relayUrl: joined.relayUrl, deviceId: 'BROWSERDEVICE001', memoryOnly: true });
  expect(browser.keys!.ownerIdHash).toBe(replica.keys!.ownerIdHash);
  for (let i = 0; i < 100 && !(await browser.get(KV_COLLECTION, 'vitals.settings')); i++) await new Promise((r) => setTimeout(r, 100));
  expect((await browser.get(KV_COLLECTION, 'vitals.settings'))?.value).toEqual({ state: { units: 'metric' }, version: 3 });

  // a second request for the key is refused; the group still works for this device
  expect((await post('/v1/sync/key', {}, paired.token)).status).toBe(409);
  await Promise.all([replica.close(), browser.close()]);
}, 30_000);
