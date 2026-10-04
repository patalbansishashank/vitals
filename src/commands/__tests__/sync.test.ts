/**
 * `sync.*` executors (I1-A): they drive the app's sync runtime (here over in-memory engines and one simulated relay),
 * map `SyncError`s to typed command errors, need a confirmation for `sync.unpair`, and are not reachable by agents.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSyncRuntimeForTests } from '@/state/sync';
import { createSyncRuntime } from '@/state/sync/controller';
import { createMemoryVault } from '@/state/sync/vault';
import { createMemorySyncStore, createMemoryHub } from '@/sync/memoryStore';
import { createMemoryBackend } from '@/store';
import { dispatch, mintConfirmation, type CommandResult } from '..';
import { AI, MCP, freshState } from './harness';

const RELAY = 'https://relay.example.ts.net';

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}
const errorOf = (r: CommandResult) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

beforeEach(() => {
  const { backend } = freshState({ cleared: true });
  const hub = createMemoryHub();
  setSyncRuntimeForTests(
    createSyncRuntime({
      vault: createMemoryVault(),
      createEngine: async () => {
        const e = createMemorySyncStore();
        e.link(hub);
        return e;
      },
      localBackend: () => backend ?? createMemoryBackend(),
    }),
  );
});
afterEach(() => setSyncRuntimeForTests(null));

describe('sync.* executors', { timeout: 30_000 }, () => {
  it('sync.status is off before setup', async () => {
    const s = out<{ state: string; paired: boolean; enabled: boolean }>(await dispatch('sync.status', {}));
    expect(s).toMatchObject({ state: 'off', paired: false, enabled: false });
  });

  it('sync.pair returns the code; status, now and configure follow', async () => {
    const code = out<{ uri: string; words: string[]; relayUrl: string; label?: string }>(await dispatch('sync.pair', { relayUrl: RELAY, label: ' Laptop ' }));
    expect(code.words).toHaveLength(24);
    expect(code.uri).toMatch(/^vitals-sync:1\?/);
    expect(code.label).toBe('Laptop');
    const status = out<{ paired: boolean; deviceLabel?: string; endpoint?: string }>(await dispatch('sync.status', {}));
    expect(status).toMatchObject({ paired: true, deviceLabel: 'Laptop' });
    expect(out<{ paired: boolean }>(await dispatch('sync.now', {})).paired).toBe(true);
    const after = out<{ enabled: boolean; deviceLabel?: string }>(await dispatch('sync.configure', { label: 'Desk', enabled: false }));
    expect(after).toMatchObject({ enabled: false, deviceLabel: 'Desk' });
    expect(errorOf(await dispatch('sync.pair', { relayUrl: RELAY })).code).toBe('conflict');
  });

  it('maps bad input to invalid_input and missing setup to precondition_failed', async () => {
    expect(errorOf(await dispatch('sync.pair', { relayUrl: 'http://insecure.example' }))).toMatchObject({ code: 'invalid_input', detail: { path: '/relayUrl' } });
    expect(errorOf(await dispatch('sync.join', { code: 'garbage', relayUrl: RELAY, onExisting: 'merge' }))).toMatchObject({ code: 'invalid_input', detail: { path: '/code' } });
    // 24 words without a server address
    expect(errorOf(await dispatch('sync.join', { code: 'abandon '.repeat(23) + 'art', onExisting: 'merge' })).code).toBe('invalid_input');
    expect(errorOf(await dispatch('sync.configure', { label: 'x' })).code).toBe('precondition_failed');
    expect(errorOf(await dispatch('sync.now', {})).code).toBe('precondition_failed');
  });

  it('sync.join with a pairing URI joins the same owner', async () => {
    const code = out<{ uri: string }>(await dispatch('sync.pair', { relayUrl: RELAY }));
    // a fresh runtime stands for the second device
    const hub = createMemoryHub();
    setSyncRuntimeForTests(
      createSyncRuntime({
        vault: createMemoryVault(),
        createEngine: async () => {
          const e = createMemorySyncStore();
          e.link(hub);
          return e;
        },
        localBackend: () => createMemoryBackend(),
      }),
    );
    expect(out<{ paired: boolean }>(await dispatch('sync.join', { code: code.uri, onExisting: 'merge' })).paired).toBe(true);
  });

  it('sync.rotate needs full: true; with it the device gets a new code', async () => {
    const first = out<{ words: string[] }>(await dispatch('sync.pair', { relayUrl: RELAY }));
    expect(errorOf(await dispatch('sync.rotate', {}))).toMatchObject({ code: 'precondition_failed', detail: { rule: 'sync:rotate-needs-full' } });
    expect(errorOf(await dispatch('sync.rotate', { full: false })).code).toBe('precondition_failed');
    const r = out<{ code: { words: string[] }; status: { paired: boolean } }>(await dispatch('sync.rotate', { full: true }));
    expect(r.code.words).not.toEqual(first.words);
    expect(r.status.paired).toBe(true);
  });

  it('sync.unpair needs the person’s confirmation and leaves the device unpaired', async () => {
    out(await dispatch('sync.pair', { relayUrl: RELAY }));
    expect(errorOf(await dispatch('sync.unpair', {})).code).toBe('confirmation_required');
    const done = out<{ paired: boolean; state: string }>(await dispatch('sync.unpair', {}, { confirmation: mintConfirmation('sync.unpair', {}) }));
    expect(done).toMatchObject({ paired: false, state: 'off' });
  });

  it('agents cannot pair, join, rotate, configure or unpair, and never get the pairing code', async () => {
    for (const actor of [AI, MCP]) {
      for (const [id, input] of [
        ['sync.pair', { relayUrl: RELAY }],
        ['sync.join', { code: 'x', onExisting: 'merge' }],
        ['sync.rotate', { full: true }],
        ['sync.configure', { label: 'x' }],
        ['sync.unpair', {}],
      ] as const) {
        const r = await dispatch(id, input as never, { actor });
        expect(r.ok, `${id} as ${actor.kind}`).toBe(false);
      }
    }
  });
});
