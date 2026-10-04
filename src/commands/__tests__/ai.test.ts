/**
 * The `agents` side of the bus (I1): `agents.configure` (E9b's `ai.configure` / `ai.usage` are tested in
 * `src/commands/ai/__tests__`), the
 * Coach's `CommandPort` and the agents' `AgentDispatcher` over `dispatch`, and undo of the unshared `uiPrefs/me` fields
 * they write.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directApplyAllowed, getAgentDispatcher } from '@/agents/registry';
import { KeyVault, setSharedKeyVault } from '@/ai/keys';
import { MemoryKv } from '@/ai/storage/kv';
import { resetNetAllowlist } from '@/net/net';
import type { PortActor } from '@/ai/tools/types';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, LOCAL_USER, settleCommits } from '..';
import { createBusAgentDispatcher, directApplyFromSettings } from '../ai';
import { aiIdempotencyKey, createBusCommandPort } from '../ai/port';
import { toolManifest } from '../manifest';
import { AI, freshState, MCP } from './harness';

const NOW = '2026-10-01T10:00:00.000Z';
let vault: KeyVault;

const uiPrefs = () => getDocumentStore().peek<Record<string, unknown>>('uiPrefs', 'me') as Record<string, unknown> | null;

beforeEach(() => {
  freshState({ cleared: true });
  resetNetAllowlist();
  vault = new KeyVault({ keys: new MemoryKv(), meta: new MemoryKv(), now: () => NOW });
  setSharedKeyVault(vault);
});
afterEach(() => setSharedKeyVault(null));

describe('agents.configure', () => {
  it('records WebMCP and per-client direct apply in uiPrefs/me.agents; the policy follows', async () => {
    expect(directApplyAllowed({ kind: 'mcp', id: 'claude-code' })).toBe(false);
    const r = await dispatch('agents.configure', { webmcp: true, clients: { 'claude-code': { directApply: true } } });
    expect(r).toMatchObject({ ok: true, output: { webmcp: true, clients: { 'claude-code': { directApply: true } } } });
    await settleCommits();
    expect(uiPrefs()!.agents).toEqual({ webmcp: true, clients: { 'claude-code': { directApply: true } } });
    expect(directApplyFromSettings({ kind: 'mcp', id: 'claude-code' })).toBe(true);
    expect(directApplyAllowed({ kind: 'mcp', id: 'claude-code' })).toBe(true);
    expect(directApplyAllowed({ kind: 'mcp', id: 'other' })).toBe(false);
    // a later call merges
    await dispatch('agents.configure', { clients: { other: { directApply: false } } });
    await settleCommits();
    expect(uiPrefs()!.agents).toEqual({ webmcp: true, clients: { 'claude-code': { directApply: true }, other: { directApply: false } } });
  });

  it('refuses client names the Companion would not pass', async () => {
    expect(await dispatch('agents.configure', { clients: { 'bad\nname': { directApply: true } } })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('history.undo restores the unshared agents field of the bound uiPrefs/me document', async () => {
    await dispatch('profile.patch', { weightKg: 81 }, { actor: LOCAL_USER });
    const first = await dispatch('agents.configure', { webmcp: false });
    const second = await dispatch('agents.configure', { clients: { 'claude-code': { directApply: true } } });
    await settleCommits();
    expect(directApplyAllowed({ kind: 'mcp', id: 'claude-code' })).toBe(true);
    const u = await dispatch('history.undo', { changeSetId: (second as { changeSet: { id: string } }).changeSet.id });
    expect(u).toMatchObject({ ok: true, output: { undone: true, skipped: [] } });
    await settleCommits();
    expect(uiPrefs()!.agents).toEqual({ webmcp: false, clients: {} });
    expect(directApplyAllowed({ kind: 'mcp', id: 'claude-code' })).toBe(false);
    expect(first.ok).toBe(true);
  });

  it('is UI only: agents cannot change their own permissions', async () => {
    expect(await dispatch('agents.configure', { clients: { 'claude-desktop': { directApply: true } } }, { actor: MCP })).toMatchObject({ ok: false });
    expect(await dispatch('agents.configure', { webmcp: true }, { actor: AI })).toMatchObject({ ok: false });
  });
});

describe('CommandPort over the bus', () => {
  const port = createBusCommandPort();
  const PORT_AI = { kind: 'ai', id: AI.id, conversationId: 'conv', toolCallId: 'call-1' } as PortActor;

  it('derives the idempotency key from the conversation and tool call (hashed past 64 chars)', () => {
    expect(aiIdempotencyKey('c1', 't1')).toBe('c1:t1');
    const long = aiIdempotencyKey('c'.repeat(40), 't'.repeat(40));
    expect(long).toMatch(/^h:[0-9a-f]{62}$/);
  });

  it('reads, stages consequential writes as pending, and reports errors', async () => {
    expect(await port.dispatch('ai.usage', {}, { actor: PORT_AI })).toMatchObject({ ok: true, output: { totals: { requests: 0 } } });
    const p = await port.dispatch('profile.patch', { weightKg: 79 }, { actor: PORT_AI });
    expect(p).toMatchObject({ ok: true, pending: { pendingId: expect.any(String) } });
    expect(await port.dispatch('ai.usage', { from: 'nope' }, { actor: PORT_AI })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('applies on behalf of the AI with an undo token, and undo() undoes it as the person', async () => {
    const actor = { kind: 'user', id: 'local-user', onBehalfOf: { ...PORT_AI, toolCallId: 'call-9' } } as PortActor;
    const r = await port.dispatch('profile.patch', { weightKg: 77 }, { actor });
    expect(r).toMatchObject({ ok: true, changeId: expect.any(String), undoToken: expect.any(String) });
    await settleCommits();
    const u = await port.undo((r as { undoToken: string }).undoToken);
    expect(u).toMatchObject({ ok: true, output: { undone: true }, summary: 'Undone.' });
  });
});

describe('AgentDispatcher over the bus', () => {
  const agent = (kind: 'mcp' | 'webmcp', id: string) => ({ kind, id });

  it('is installed when the bus loads and serves the app manifest', async () => {
    const d = getAgentDispatcher();
    expect(d).not.toBeNull();
    expect(await d!.manifest()).toBe(toolManifest());
  });

  it('reads apply; consequential writes are pending; unknown and UI-only tools are refused', async () => {
    const d = createBusAgentDispatcher({ directApply: () => false });
    expect(await d.call('ai.usage', {}, { actor: agent('mcp', 'claude-code'), stage: false })).toMatchObject({ ok: true, status: 'applied', data: { totals: { requests: 0 } } });
    expect(await d.call('profile.patch', { weightKg: 78 }, { actor: agent('mcp', 'claude-code'), stage: true })).toMatchObject({ ok: true, status: 'pending_user', changeId: expect.any(String) });
    // stage:false without the person's permission still goes out as the agent, so the bus stages it
    expect(await d.call('profile.patch', { weightKg: 78.5 }, { actor: agent('mcp', 'claude-code'), stage: false })).toMatchObject({ status: 'pending_user' });
    expect(await d.call('nope.nothing', {}, { actor: agent('mcp', 'x'), stage: false })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await d.call('agents.configure', { webmcp: true }, { actor: agent('webmcp', 'webmcp'), stage: false })).toMatchObject({ ok: false, status: 'rejected' });
    expect(await d.call('ai.usage', {}, { actor: { kind: 'ai' as never, id: 'x' }, stage: false })).toMatchObject({ ok: false, error: { code: 'surface_forbidden' } });
  });

  it('applies a consequential write directly only when the person allowed that client', async () => {
    const d = createBusAgentDispatcher({ directApply: (a) => a.kind === 'mcp' && a.id === 'trusted' });
    expect(await d.call('profile.patch', { weightKg: 76 }, { actor: agent('mcp', 'trusted'), stage: false })).toMatchObject({ ok: true, status: 'applied', changeId: expect.any(String) });
    expect(await d.call('profile.patch', { weightKg: 75 }, { actor: agent('mcp', 'other'), stage: false })).toMatchObject({ status: 'pending_user' });
    // staging a low-impact write is not something the bus can do
    const low = toolManifest().tools.find((t) => t.perm === 'write' && t.impact === 'low' && t.surfaces.includes('mcp'));
    if (low) expect(await d.call(low.id, {}, { actor: agent('mcp', 'trusted'), stage: true })).toMatchObject({ ok: false, error: { code: 'precondition_failed' } });
  });
});

