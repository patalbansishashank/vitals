// @vitest-environment node
/**
 * Per-field last-writer-wins through the real engine: two (or three) in-process Evolu devices paired with one owner
 * secret, editing while offline and then syncing through the Companion's relay (twoDevices.test.ts pattern).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppOwner, createOwnerWebSocketTransport, NonNegativeInt, OwnerSecret } from '@evolu/common';
import { AppName, createEvolu, type Evolu } from '@evolu/common/local-first';
import { createNodeEvoluPlatform } from '../../../packages/companion/src/evoluNode';
import { startCompanion } from '../../../packages/companion/src/server';
import { newOwnerSecret, relaySocketUrl } from '../pairing';
import type { SyncStore } from '../types';
import { deepEqual } from '../../store/json';
import { createEvoluSyncStore } from './adapter';
import { docRowId, vitalsEvoluSchema, type VitalsEvoluSchema } from './schema';

let dir = '';
let relayUrl = '';
let stopRelay: () => Promise<void> = async () => {};
let n = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vitals-fields-'));
  const companion = await startCompanion({ port: 0, dataDir: join(dir, 'companion'), allowedOrigins: [], log: () => {} });
  relayUrl = `http://127.0.0.1:${companion.port}`;
  stopRelay = () => companion.close();
});
afterAll(async () => {
  await stopRelay();
  rmSync(dir, { recursive: true, force: true });
});

async function device(secret: Uint8Array, name: string, opts: { deepFields?: Record<string, string[]> } = {}): Promise<SyncStore> {
  const instance = `F${++n}${name}`;
  const s = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: dir, instance }), appName: `vitalsF${n}`, ...opts });
  await s.open({ secret, relayUrl: null, deviceId: `DEVICE${name}${n}`, memoryOnly: true });
  return s;
}

const COL = 'profile';
const ID = 'me';

/** Polls until every device shows the same value of `col/id` and `done(value)` holds. */
async function converged(stores: SyncStore[], done: (v: unknown) => boolean, col = COL, id = ID, ms = 20_000): Promise<unknown> {
  const until = Date.now() + ms;
  let last: unknown[] = [];
  while (Date.now() < until) {
    last = await Promise.all(stores.map(async (s) => (await s.get(col, id))?.value));
    if (last.every((v) => deepEqual(v, last[0])) && done(last[0])) return last[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`devices did not converge: ${JSON.stringify(last)}`);
}

async function shared(secret: Uint8Array, value: unknown, ...stores: SyncStore[]) {
  const [first, ...rest] = stores;
  for (const s of stores) await s.setRelay(relayUrl);
  await first!.put(COL, ID, value);
  await converged(stores, (v) => deepEqual(v, value));
  void rest;
  void secret;
}

describe('per-field merge between devices', () => {
  for (const order of ['A first', 'B first'] as const) {
    it(`different fields edited offline on two devices both survive (${order})`, async () => {
      const secret = newOwnerSecret();
      const a = await device(secret, 'A');
      const b = await device(secret, 'B');
      await shared(secret, { name: 'Sam', weightKg: 80, labs: { ldl: 3 } }, a, b);
      await a.setRelay(null);
      await b.setRelay(null);

      await a.put(COL, ID, { name: 'Sam', weightKg: 78, labs: { ldl: 3 } });
      await new Promise((r) => setTimeout(r, 5));
      await b.put(COL, ID, { name: 'Sam', weightKg: 80, labs: { ldl: 2.4 } });

      const [first, second] = order === 'A first' ? [a, b] : [b, a];
      await first.setRelay(relayUrl);
      await first.push();
      await second.setRelay(relayUrl);
      const v = await converged([a, b], (x) => (x as { weightKg: number }).weightKg === 78 && (x as { labs: { ldl: number } }).labs.ldl === 2.4);
      expect(v).toEqual({ name: 'Sam', weightKg: 78, labs: { ldl: 2.4 } });
      await Promise.all([a.close(), b.close()]);
    }, 60_000);
  }

  it('the same field edited on both devices: the newer edit wins and both devices agree', async () => {
    const secret = newOwnerSecret();
    const a = await device(secret, 'A');
    const b = await device(secret, 'B');
    await shared(secret, { units: 'metric', week: 'mon' }, a, b);
    await a.setRelay(null);
    await b.setRelay(null);
    await b.put(COL, ID, { units: 'imperial', week: 'mon' });
    await new Promise((r) => setTimeout(r, 20));
    await a.put(COL, ID, { units: 'us', week: 'mon' }); // newer
    await b.setRelay(relayUrl);
    await b.push();
    await a.setRelay(relayUrl);
    expect(await converged([a, b], (x) => (x as { units: string }).units === 'us')).toEqual({ units: 'us', week: 'mon' });
    const [da, db] = await Promise.all([a.get(COL, ID), b.get(COL, ID)]);
    expect(da?._deleted).toBeUndefined();
    expect(db?._deleted).toBeUndefined();
    await Promise.all([a.close(), b.close()]);
  }, 60_000);

  it('deeper paths declared for a collection merge per nested key', async () => {
    const secret = newOwnerSecret();
    const deepFields = { kv: ['/state'] };
    const a = await device(secret, 'A', { deepFields });
    const b = await device(secret, 'B', { deepFields });
    for (const s of [a, b]) await s.setRelay(relayUrl);
    await a.put('kv', 'vitals.settings', { state: { units: 'metric', week: 'mon' }, version: 3 });
    await converged([a, b], (v) => v !== undefined, 'kv', 'vitals.settings');
    await a.setRelay(null);
    await b.setRelay(null);
    await a.put('kv', 'vitals.settings', { state: { units: 'imperial', week: 'mon' }, version: 3 });
    await b.put('kv', 'vitals.settings', { state: { units: 'metric', week: 'sun' }, version: 3 });
    await a.setRelay(relayUrl);
    await b.setRelay(relayUrl);
    const v = await converged([a, b], (x) => deepEqual(x, { state: { units: 'imperial', week: 'sun' }, version: 3 }), 'kv', 'vitals.settings');
    expect(v).toEqual({ state: { units: 'imperial', week: 'sun' }, version: 3 });
    await Promise.all([a.close(), b.close()]);
  }, 60_000);

  it('random offline edits on three devices converge to one state with every last edit per field', async () => {
    const secret = newOwnerSecret();
    const devs = [await device(secret, 'A'), await device(secret, 'B'), await device(secret, 'C')];
    await shared(secret, { a: 0, b: 0, c: 0, d: 0 }, ...devs);
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 3; round++) {
      for (const s of devs) await s.setRelay(null);
      // expected: for each field, the value of its last edit in time (edits are spaced so clocks are distinct)
      const expected = (await devs[0]!.get(COL, ID))!.value as Record<string, number>;
      for (let i = 0; i < 6; i++) {
        const s = devs[Math.floor(rand() * devs.length)]!;
        const field = ['a', 'b', 'c', 'd'][Math.floor(rand() * 4)]!;
        const value = round * 100 + i + 1;
        const cur = (await s.get(COL, ID))!.value as Record<string, number>;
        await s.put(COL, ID, { ...cur, [field]: value });
        expected[field] = value;
        await new Promise((r) => setTimeout(r, 3));
      }
      // reconnect in a random order
      const order = [...devs].sort(() => rand() - 0.5);
      for (const s of order) {
        await s.setRelay(relayUrl);
        await s.push();
      }
      expect(await converged(devs, (v) => deepEqual(v, expected))).toEqual(expected);
    }
    await Promise.all(devs.map((s) => s.close()));
  }, 120_000);

  it('a document written by an app from before per-field clocks merges with new edits', async () => {
    const secret = newOwnerSecret();
    // an older app version: writes the document body as plain JSON (no clocks)
    const platform = createNodeEvoluPlatform({ dataDir: dir, instance: `F${++n}OLD` });
    const owner = createAppOwner(OwnerSecret.orThrow(secret as never));
    const old = await platform.run<Evolu<VitalsEvoluSchema>>(createEvolu(vitalsEvoluSchema, { appName: AppName.orThrow(`vitalsF${n}`), appOwner: owner, memoryOnly: true, transports: [] }));
    if (!old.ok) throw new Error('old device did not start');
    const unuse = old.value.useOwner(owner, [createOwnerWebSocketTransport({ url: relaySocketUrl(relayUrl), ownerId: owner.id })]);
    const legacy = { name: 'Sam', weightKg: 80, labs: { ldl: 3 } };
    old.value.upsert('doc', { id: docRowId(COL, ID), col: COL, key: ID, json: JSON.stringify(legacy), schema: NonNegativeInt.orThrow(1), device: 'OLDDEVICE', created: new Date().toISOString() });

    const a = await device(secret, 'A');
    const b = await device(secret, 'B');
    for (const s of [a, b]) await s.setRelay(relayUrl);
    expect(await converged([a, b], (v) => deepEqual(v, legacy))).toEqual(legacy);
    unuse();
    await old.value[Symbol.asyncDispose]();
    await platform.dispose();

    await a.setRelay(null);
    await b.setRelay(null);
    await a.put(COL, ID, { ...legacy, weightKg: 77 });
    await b.put(COL, ID, { ...legacy, labs: { ldl: 2 } });
    await b.setRelay(relayUrl);
    await b.push();
    await a.setRelay(relayUrl);
    expect(await converged([a, b], (v) => deepEqual(v, { name: 'Sam', weightKg: 77, labs: { ldl: 2 } }))).toEqual({ name: 'Sam', weightKg: 77, labs: { ldl: 2 } });
    await Promise.all([a.close(), b.close()]);
  }, 60_000);
});
