/**
 * `sync.*` executors (I1) for the stubs declared in `../defs/sync.ts`. The sync runtime (`@/state/sync`) is imported
 * inside each executor, so the bus in the main chunk carries none of it, and the Evolu engine loads only when a device
 * pairs. None of these write user documents through `ctx.docs`: switching engines moves data with sync write tokens
 * (`src/state/sync/controller.ts`), and nothing here can be undone (`undo: none`).
 */
import type { SyncRuntime as Runtime, SyncView as View } from '@/state/sync';
import { implement } from '../implement';
import { fail } from '../registry';

const BY = 'I1 (sync)';

async function runtime(): Promise<Runtime> {
  const rt = (await import('@/state/sync')).getSyncRuntime();
  await rt.load();
  return rt;
}

/** `SyncStatus` + paired / enabled / this device's name, without undefined fields. */
function statusOf(v: View) {
  const { status } = v;
  return {
    state: status.state,
    lastSyncedAt: status.lastSyncedAt,
    pendingChanges: status.pendingChanges,
    pendingBlobs: status.pendingBlobs,
    ...(status.lastError ? { lastError: { code: status.lastError.code, message: status.lastError.message, at: status.lastError.at } } : {}),
    ...(status.endpoint ? { endpoint: status.endpoint } : {}),
    paired: v.paired,
    enabled: v.enabled,
    ...(v.label ? { deviceLabel: v.label } : {}),
  };
}

/** SyncError → typed command errors; anything else stays an internal error. */
async function mapped<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    if (err?.name !== 'SyncError') throw e;
    const message = err.message ?? 'Sync failed.';
    switch (err.code) {
      case 'invalid_code':
        return fail('invalid_input', message, { path: '/code' });
      case 'invalid_relay':
        return fail('invalid_input', message, { path: '/relayUrl' });
      case 'already_paired':
        return fail('conflict', message);
      case 'not_paired':
        return fail('precondition_failed', message, { rule: 'sync:not-paired', retryable: false });
      default:
        return fail('precondition_failed', message, { rule: `sync:${err.code ?? 'failed'}`, retryable: true });
    }
  }
}

implement(
  'sync.status',
  async () => {
    const rt = await runtime();
    return statusOf(rt.view());
  },
  BY,
);

implement(
  'sync.now',
  async () =>
    mapped(async () => {
      const rt = await runtime();
      await rt.syncNow();
      return statusOf(rt.view());
    }),
  BY,
);

implement<{ relayUrl: string; label?: string }>(
  'sync.pair',
  async (_ctx, input) =>
    mapped(async () => {
      const rt = await runtime();
      const code = await rt.pair(input.relayUrl, input.label?.trim() || undefined);
      return { uri: code.uri, words: code.words, relayUrl: code.relayUrl, ...(code.label ? { label: code.label } : {}) };
    }),
  BY,
);

implement<{ code: string; relayUrl?: string; onExisting: 'merge' | 'replace' }>(
  'sync.join',
  async (_ctx, input) =>
    mapped(async () => {
      const text = input.code.trim();
      const isUri = /^vitals-sync:/i.test(text);
      if (!isUri && !input.relayUrl?.trim()) fail('invalid_input', 'With the 24 words, also give the sync server address.', { path: '/relayUrl' });
      const rt = await runtime();
      await rt.join(isUri ? text : { words: text, relayUrl: input.relayUrl! }, input.onExisting);
      return statusOf(rt.view());
    }),
  BY,
);

implement<{ full?: boolean }>(
  'sync.rotate',
  async (_ctx, input) =>
    mapped(async () => {
      // Evolu 8.14 derives the write key from the owner secret and cannot delete an owner on the relay, so a lost
      // device cannot be locked out on its own: the honest option is a whole new key (a new owner).
      if (input.full !== true)
        fail(
          'precondition_failed',
          "This sync server can't lock out one lost device on its own. Make a new key instead (full: true): this device moves its data to the new key, and every other device joins again with the new code.",
          { rule: 'sync:rotate-needs-full', retryable: false },
        );
      const rt = await runtime();
      const code = await rt.rotate();
      return { code: { uri: code.uri, words: code.words, relayUrl: code.relayUrl, ...(code.label ? { label: code.label } : {}) }, status: statusOf(rt.view()) };
    }),
  BY,
);

implement<{ relayUrl?: string; label?: string; enabled?: boolean }>(
  'sync.configure',
  async (_ctx, input) =>
    mapped(async () => {
      const rt = await runtime();
      await rt.configure(input);
      return statusOf(rt.view());
    }),
  BY,
);

implement(
  'sync.unpair',
  async () =>
    mapped(async () => {
      const rt = await runtime();
      await rt.unpair();
      return statusOf(rt.view());
    }),
  BY,
);
