// @vitest-environment node
/**
 * E4's DocumentStore conformance suite against the real Evolu engine (`engine: 'evolu'`) as a `PersistenceBackend`,
 * in Node through the Companion's in-process platform (SQLite via better-sqlite3, memory-only, no relay). The browser
 * platform (OPFS + SQLite-WASM) is not covered here: it only supplies workers and storage to the same adapter.
 * The suite's optional `remote` injection hook needs engine internals, so those cases are skipped; remote merges are
 * covered by `packages/companion/src/twoDevices.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeEvoluPlatform } from '../../../../packages/companion/src/evoluNode';
import { createDocumentStore, mintWriteToken } from '@/store';
import { conformanceCases, sealedCases } from '@/store/__tests__/conformance';
import { createEvoluSyncStore } from '@/sync/evolu/adapter';
import { newOwnerSecret } from '@/sync/pairing';
import type { SyncStore } from '@/sync/types';

const opened: SyncStore[] = [];
let n = 0;

async function makeEngine(): Promise<{ engine: SyncStore; device: string }> {
  const instance = `conf${++n}`;
  const engine = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ instance }), appName: `vitalsConf${n}` });
  const device = `CONFDEVICE${String(n).padStart(6, '0')}`;
  await engine.open({ secret: newOwnerSecret(), relayUrl: null, deviceId: device, memoryOnly: true });
  opened.push(engine);
  return { engine, device };
}

afterEach(async () => {
  for (const e of opened.splice(0)) await e.close().catch(() => undefined);
});

describe('DocumentStore conformance · Evolu engine (Node)', { timeout: 60_000 }, () => {
  conformanceCases(async () => {
    const { engine, device } = await makeEngine();
    return { store: createDocumentStore({ backend: engine, device, strict: 'strict' }) };
  });
  sealedCases(async (encryptor) => {
    const { engine, device } = await makeEngine();
    return { store: createDocumentStore({ backend: engine, device, strict: 'strict', encryptor }) };
  });

  it('reports itself as the evolu engine and reads its own writes after a reopen of the store layer', async () => {
    const { engine, device } = await makeEngine();
    const first = createDocumentStore({ backend: engine, device, strict: 'strict' });
    await first.transact(mintWriteToken('command'), (tx) => tx.put('recipes', { _id: '01J0000000000000000000000A', name: 'oats' }));
    expect(engine.engine).toBe('evolu');
    const second = createDocumentStore({ backend: engine, device, strict: 'strict' });
    expect(await second.get('recipes', '01J0000000000000000000000A')).toMatchObject({ name: 'oats' });
  });

  it('forgets the derived keys when it closes or erases', async () => {
    const a = await makeEngine();
    expect(a.engine.keys).not.toBeNull();
    await a.engine.close();
    expect(a.engine.keys).toBeNull();
    const b = await makeEngine();
    await b.engine.eraseLocal();
    expect(b.engine.keys).toBeNull();
  });
});
