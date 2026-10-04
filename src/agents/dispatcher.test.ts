import { getAgentActivity, resetAgentActivityForTests } from './activity';
import { getAgentDispatcher, guardedCall, setAgentDispatcher, subscribeAgentDispatcher, type AgentDispatcher } from './dispatcher';
import { parseToolManifest, toolsFor } from './manifest';
import { fixtureManifest } from './testing/fixture';
import { createMockDispatcher } from './testing/mockDispatcher';

const M = fixtureManifest();
const webmcp = { actor: { kind: 'webmcp' as const, id: 'webmcp' } };
const mcp = { actor: { kind: 'mcp' as const, id: 'claude-desktop' } };

beforeEach(() => resetAgentActivityForTests());

describe('fixture', () => {
  it('is a valid vitals.tools/1 manifest', async () => {
    const parsed = await parseToolManifest(M);
    expect(parsed.hash).toBe(M.hash);
    expect(toolsFor(M, 'webmcp').map((t) => t.name)).toEqual(['log_get', 'log_measurement', 'nav_open', 'plan_shift', 'today_get']);
  });
});

describe('guardedCall', () => {
  it('runs an exposed read tool with the surface as actor kind', async () => {
    const d = createMockDispatcher(M);
    const r = await guardedCall(d, M, 'webmcp', 'today_get', {}, webmcp);
    expect(r).toMatchObject({ ok: true, status: 'applied' });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ commandId: 'today.get', args: {}, opts: { actor: { kind: 'webmcp', id: 'webmcp' }, stage: false } });
  });

  it.each(['webmcp', 'mcp'] as const)('never sends destructive plan_end to the dispatcher (%s)', async (surface) => {
    const d = createMockDispatcher(M);
    const r = await guardedCall(d, M, surface, 'plan_end', { reason: 'x' }, surface === 'mcp' ? mcp : webmcp);
    expect(r).toMatchObject({ ok: false, status: 'rejected', error: { code: 'surface_forbidden' } });
    expect(d.calls).toHaveLength(0);
  });

  it.each(['webmcp', 'mcp'] as const)('never sends ui-only settings_update to the dispatcher (%s)', async (surface) => {
    const d = createMockDispatcher(M);
    const r = await guardedCall(d, M, surface, 'settings.update', { patch: {} }, surface === 'mcp' ? mcp : webmcp);
    expect(r.error?.code).toBe('surface_forbidden');
    expect(d.calls).toHaveLength(0);
  });

  it('rejects unknown tools', async () => {
    const d = createMockDispatcher(M);
    expect((await guardedCall(d, M, 'mcp', 'drop_tables', {}, mcp)).error?.code).toBe('surface_forbidden');
    expect(d.calls).toHaveLength(0);
  });

  it('forces stage for the consequential plan_shift even when the caller says no', async () => {
    const d = createMockDispatcher(M);
    const r = await guardedCall(d, M, 'mcp', 'plan_shift', { days: 2 }, { ...mcp, stage: false, idempotencyKey: 'k1' });
    expect(r.status).toBe('pending_user');
    expect(d.calls[0]!.opts).toMatchObject({ stage: true, idempotencyKey: 'k1', actor: { kind: 'mcp', id: 'claude-desktop' } });
  });

  it('does not stage low-impact writes unless asked', async () => {
    const d = createMockDispatcher(M);
    await guardedCall(d, M, 'mcp', 'log_measurement', { kind: 'weight', value: 80 }, mcp);
    await guardedCall(d, M, 'mcp', 'log_measurement', { kind: 'weight', value: 80 }, { ...mcp, stage: true });
    expect(d.calls.map((c) => c.opts.stage)).toEqual([false, true]);
  });

  it('allows webmcp-only nav_open for webmcp but not for mcp', async () => {
    const d = createMockDispatcher(M);
    expect((await guardedCall(d, M, 'webmcp', 'nav_open', { route: 'plan' }, webmcp)).ok).toBe(true);
    expect((await guardedCall(d, M, 'mcp', 'nav_open', { route: 'plan' }, mcp)).error?.code).toBe('surface_forbidden');
    expect(d.calls.map((c) => c.commandId)).toEqual(['nav.open']);
  });

  it('accepts a command id as well as a tool name', async () => {
    const d = createMockDispatcher(M);
    expect((await guardedCall(d, M, 'mcp', 'log.get', { from: '2026-10-01', to: '2026-10-01' }, mcp)).ok).toBe(true);
  });

  it('requires a plain object for args', async () => {
    const d = createMockDispatcher(M);
    for (const bad of [[1], 'x', null, 3, new Date()]) {
      expect((await guardedCall(d, M, 'webmcp', 'today_get', bad, webmcp)).error?.code).toBe('invalid_input');
    }
    expect(d.calls).toHaveLength(0);
  });

  it('never throws: dispatcher errors, bad results and a missing dispatcher become internal rejections', async () => {
    const throwing: AgentDispatcher = { manifest: () => M, call: () => Promise.reject(new Error('boom')) };
    expect(await guardedCall(throwing, M, 'webmcp', 'today_get', {}, webmcp)).toMatchObject({ ok: false, status: 'rejected', error: { code: 'internal', message: 'boom' } });
    const weird = { manifest: () => M, call: async () => ({ nope: true }) } as unknown as AgentDispatcher;
    expect((await guardedCall(weird, M, 'webmcp', 'today_get', {}, webmcp)).error?.code).toBe('internal');
    expect((await guardedCall(null, M, 'webmcp', 'today_get', {}, webmcp)).error?.code).toBe('internal');
  });

  it('returns cancelled when the signal is already aborted', async () => {
    const d = createMockDispatcher(M);
    const ac = new AbortController();
    ac.abort();
    expect((await guardedCall(d, M, 'mcp', 'today_get', {}, { ...mcp, signal: ac.signal })).error?.code).toBe('cancelled');
    expect(d.calls).toHaveLength(0);
  });

  it('records each call in the activity log', async () => {
    const d = createMockDispatcher(M);
    await guardedCall(d, M, 'webmcp', 'today_get', {}, webmcp);
    await guardedCall(d, M, 'mcp', 'plan_end', {}, mcp);
    expect(getAgentActivity().map((a) => [a.surface, a.actor, a.tool, a.status])).toEqual([
      ['mcp', 'claude-desktop', 'plan_end', 'rejected'],
      ['webmcp', 'webmcp', 'today_get', 'applied'],
    ]);
  });
});

describe('dispatcher registry', () => {
  it('is null until set and notifies subscribers', () => {
    setAgentDispatcher(null);
    expect(getAgentDispatcher()).toBeNull();
    const seen = vi.fn();
    const off = subscribeAgentDispatcher(seen);
    const d = createMockDispatcher(M);
    setAgentDispatcher(d);
    expect(getAgentDispatcher()).toBe(d);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    setAgentDispatcher(null);
  });
});
