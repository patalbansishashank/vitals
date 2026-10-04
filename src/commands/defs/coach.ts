/**
 * `coach.*` and `ai.*` (SUITE_SPEC §1.4, §1.9, §5). Pending changes are part of the command bus (consequential writes
 * by agents are staged as `pendingChanges` documents): listing, applying (re-dispatch as the person, on behalf of the
 * proposer; refused as stale when a touched document changed) and discarding live here. Conversations, notes and
 * provider configuration are E9's.
 */
import { bodyOf, type Doc } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { defineCommand, fail, getCommand } from '../registry';
import { T } from '../schema';
import type { Actor, CommandContext } from '../types';
import { CONSENT, UI_ONLY, UNDO, stub } from './_shared';

const OWNER = 'E9 (AI layer)';

interface PendingBody {
  commandId: string;
  input: unknown;
  actor: Actor;
  createdAt: string;
  expiresAt: string;
  preview: unknown;
  baseRevs: Record<string, string>;
  status: 'pending' | 'applied' | 'discarded' | 'expired' | 'stale';
}

const PendingView = T.Object({
  pendingId: T.String(),
  commandId: T.String(),
  input: T.Unknown(),
  actor: T.OpenObject(),
  createdAt: T.String(),
  expiresAt: T.String(),
  preview: T.Unknown(),
  status: T.String(),
});

async function pendingDoc(ctx: CommandContext, id: string): Promise<PendingBody> {
  const d = await ctx.docs.get<PendingBody>('pendingChanges', id);
  return d ? (bodyOf(d as unknown as Record<string, unknown>) as unknown as PendingBody) : fail('not_found', 'That proposal no longer exists.');
}

export const coachPending = defineCommand({
  id: 'coach.pending',
  version: 1,
  title: 'Proposals waiting',
  description: 'Changes the Coach or an agent proposed that wait for the person (what, when, by whom, until when).',
  input: T.Object({}),
  output: T.Array(PendingView),
  perm: 'read',
  surfaces: ['ui', 'ai'],
  excludedReason: { webmcp: 'proposals are reviewed in the app', mcp: 'proposals are reviewed in the app' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    const store = getDocumentStore();
    await store.ready;
    return store
      .peekAll<PendingBody>('pendingChanges')
      .filter((d) => d.status === 'pending' && d.expiresAt > ctx.now)
      .map((d: Doc<PendingBody>) => ({ pendingId: d._id, commandId: d.commandId, input: d.input, actor: d.actor as never, createdAt: d.createdAt, expiresAt: d.expiresAt, preview: d.preview, status: d.status }));
  },
});

export const coachApplyPending = defineCommand({
  id: 'coach.applyPending',
  version: 1,
  title: 'Apply a proposal',
  description: 'Apply a staged proposal as the person (on behalf of the proposer). Refused as stale when something it touches changed since it was proposed.',
  input: T.Object({ pendingId: T.String({ minLength: 1 }) }),
  output: T.Unknown(),
  perm: 'write',
  impact: 'consequential',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(CONSENT),
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: async (ctx, input) => {
    // a double click applies once: the second call is refused while the first one runs
    if (applying.has(input.pendingId)) fail('conflict', 'That proposal is being applied.');
    applying.add(input.pendingId);
    let out: Awaited<ReturnType<typeof applyPending>> | undefined;
    try {
      return (out = await applyPending(ctx, input.pendingId));
    } finally {
      // an applied proposal stays blocked: its "applied" status is written after this returns
      if (!out?.applied) applying.delete(input.pendingId);
    }
  },
});

const applying = new Set<string>();

async function applyPending(ctx: CommandContext, pendingId: string): Promise<{ applied: boolean; error?: unknown; result?: unknown }> {
  const p = await pendingDoc(ctx, pendingId);
  if (p.status !== 'pending') fail('conflict', `That proposal was already ${p.status}.`);
  if (p.expiresAt <= ctx.now) {
    await ctx.docs.patch('pendingChanges', pendingId, { status: 'expired' });
    fail('conflict', 'That proposal expired.');
  }
  const store = getDocumentStore();
  const stale = Object.entries(p.baseRevs).some(([key, rev]) => {
    const [col, ...rest] = key.split('/');
    return (store.peek(col as never, rest.join('/'))?._rev ?? '') !== rev;
  });
  if (stale) {
    await ctx.docs.patch('pendingChanges', pendingId, { status: 'stale' });
    fail('conflict', 'Something it changes was edited since: ask for a fresh proposal.', { retryable: true });
  }
  if (!getCommand(p.commandId)) fail('not_found', 'That proposal’s command no longer exists.');
  const { dispatch } = await import('../bus');
  const result = await dispatch(p.commandId, p.input, { actor: { kind: 'user', id: 'local-user', onBehalfOf: p.actor } });
  if (!result.ok) return { applied: false, error: result.error };
  await ctx.docs.patch('pendingChanges', pendingId, { status: 'applied' });
  return { applied: true, result: 'output' in result ? result.output : null };
}

export const coachDiscardPending = defineCommand({
  id: 'coach.discardPending',
  version: 1,
  title: 'Discard a proposal',
  description: 'Discard a staged proposal.',
  input: T.Object({ pendingId: T.String({ minLength: 1 }) }),
  output: T.Object({ discarded: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui', 'ai'],
  excludedReason: { webmcp: 'proposals are reviewed in the app', mcp: 'proposals are reviewed in the app' },
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: async (ctx, input) => {
    const p = await pendingDoc(ctx, input.pendingId);
    if (p.status !== 'pending') return { discarded: false };
    await ctx.docs.patch('pendingChanges', input.pendingId, { status: 'discarded' });
    return { discarded: true };
  },
});

stub({ id: 'coach.conversations', title: 'Conversations', description: 'Coach conversations with their titles and last activity.', input: T.Object({}), output: T.Array(T.OpenObject()), perm: 'read', surfaces: ['ui', 'ai'], excludedReason: { webmcp: 'Coach history stays in the app', mcp: 'Coach history stays in the app' }, owner: OWNER });
stub({ id: 'coach.history', title: 'Conversation history', description: 'Messages of one Coach conversation.', input: T.Object({ conversationId: T.String({ minLength: 1 }), before: T.Optional(T.String({ minLength: 1, description: 'Message id: return the page of messages before it.' })), limit: T.Optional(T.Integer({ minimum: 1, maximum: 200 })) }), output: T.Array(T.OpenObject()), perm: 'read', surfaces: ['ui', 'ai'], excludedReason: { webmcp: 'Coach history stays in the app', mcp: 'Coach history stays in the app' }, owner: OWNER });
stub({ id: 'coach.searchNotes', title: 'Search Coach notes', description: 'Search the Coach’s notes and summaries of earlier conversations.', input: T.Object({ q: T.String({ minLength: 1, maxLength: 200 }) }), output: T.Array(T.OpenObject()), perm: 'read', surfaces: ['ui', 'ai'], excludedReason: { webmcp: 'Coach history stays in the app', mcp: 'Coach history stays in the app' }, owner: OWNER });
stub({ id: 'coach.delete', title: 'Delete a conversation', description: 'Delete a Coach conversation and its messages.', input: T.Object({ conversationId: T.String({ minLength: 1 }) }), output: T.Object({ deleted: T.Boolean() }), perm: 'destructive', surfaces: UI_ONLY.surfaces, excludedReason: UI_ONLY.excludedReason(CONSENT), owner: OWNER });

stub({ id: 'ai.configure', title: 'Configure the AI provider', description: 'Provider presets, models and keys.', input: T.Object({ preset: T.OpenObject() }), perm: 'write', impact: 'consequential', surfaces: UI_ONLY.surfaces, excludedReason: UI_ONLY.excludedReason('keys and providers are configured by the person in the app'), undo: UNDO.IP, owner: OWNER });
stub({ id: 'ai.usage', title: 'AI usage', description: 'Token totals and estimated cost by provider and period.', input: T.Object({ from: T.Optional(T.Date()), to: T.Optional(T.Date()) }), perm: 'read', owner: OWNER });

declare module '../types' {
  interface CommandMap {
    'coach.pending': typeof coachPending;
    'coach.applyPending': typeof coachApplyPending;
    'coach.discardPending': typeof coachDiscardPending;
  }
}
