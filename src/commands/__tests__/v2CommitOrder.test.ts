/**
 * Review V2 (V1c-13): a gesture still coalescing (written after its 300 ms idle window) and a later sealed edit of the
 * same document. The later edit must win in the stored document: the coalesced ChangeSet must not commit its older
 * snapshot over it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, settleCommits } from '..';
import { getDocumentStore } from '@/state/runtime';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { UNDO } from '../defs/_shared';
import { freshState } from './harness';

for (const id of ['data.v2WriteA', 'data.v2WriteB'] as const) {
  defineCommand({
    id,
    version: 1,
    title: 'Write',
    description: 'Test only.',
    input: T.Object({ status: T.String() }),
    output: T.Object({}),
    perm: 'write',
    impact: 'low',
    surfaces: ['ui'],
    excludedReason: { webmcp: 'test', mcp: 'test', ai: 'test' },
    undo: UNDO.none,
    idempotency: 'natural',
    sideEffects: [],
    execute: async (ctx: { docs: { put: (c: string, d: Record<string, unknown>) => Promise<unknown> }; actor: unknown; now: string }, input: { status: string }) => {
      await ctx.docs.put('pendingChanges', { _id: '01J00000000000000000000SAM', commandId: id, input: {}, actor: ctx.actor, createdAt: ctx.now, expiresAt: ctx.now, preview: {}, baseRevs: {}, status: input.status });
      return {};
    },
  } as never);
}

beforeEach(() => {
  freshState();
});

describe('commit order of a coalescing gesture and a later edit', () => {
  it('keeps the later edit', async () => {
    expect((await dispatch('data.v2WriteA', { status: 'gesture' }, { coalesceKey: 'drag' })).ok).toBe(true);
    expect((await dispatch('data.v2WriteB', { status: 'later' })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    await settleCommits();
    expect(getDocumentStore().peek<{ status: string }>('pendingChanges', '01J00000000000000000000SAM')?.status).toBe('later');
  });
});
