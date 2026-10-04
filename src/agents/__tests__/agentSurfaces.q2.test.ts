// @vitest-environment node
/**
 * Release gate Q2 (SUITE_SPEC §1.4, §7.3): the external agent surfaces never receive destructive tools — checked over
 * the app's REAL manifest (`toolManifest()` from the command registry), not a fixture. WebMCP registers none; a forged
 * WebMCP or MCP call naming one (by tool name or command id) is refused before any dispatcher sees it; the Companion's
 * own MCP gate (`checkCall`) refuses them too.
 */
import { allCommands } from '@/commands';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { toolManifest } from '@/commands/manifest';
import { checkCall } from '../../../packages/companion/src/agentHub';
import { guardedCall } from '../dispatcher';
import { toMcpTools, toolNameOf, toolsFor } from '../manifest';
import type { AgentDispatcher } from '../registry';
import { registerWebMcpTools, type WebMcpToolDescriptor } from '../webmcp';

const destructiveDefs = () => allCommands().filter((d) => d.perm === 'destructive');

function spyDispatcher(): AgentDispatcher & { calls: string[] } {
  const real = createBusAgentDispatcher({ directApply: () => true });
  const calls: string[] = [];
  return {
    calls,
    manifest: () => real.manifest(),
    call: async (id, args, opts) => {
      calls.push(id);
      return real.call(id, args, opts);
    },
  };
}

describe('agent surfaces over the real manifest', () => {
  const m = toolManifest();

  it('the manifest carries destructive tools on agent surfaces (so the filters below are exercised)', () => {
    const onAgentSurfaces = m.tools.filter((t) => t.perm === 'destructive').map((t) => t.id);
    expect(onAgentSurfaces.length).toBeGreaterThan(0);
    expect(m.tools.some((t) => t.perm === 'destructive' && t.surfaces.includes('webmcp'))).toBe(true);
    expect(m.tools.some((t) => t.perm === 'destructive' && t.surfaces.includes('mcp'))).toBe(true);
  });

  it('WebMCP registers exactly the non-destructive webmcp tools', () => {
    const registered = new Map<string, WebMcpToolDescriptor>();
    const ctx = { registerTool: (t: WebMcpToolDescriptor) => void registered.set(t.name, t), unregisterTool: (n: string) => void registered.delete(n) };
    const unregister = registerWebMcpTools(m, spyDispatcher(), ctx);
    expect([...registered.keys()].sort()).toEqual(toolsFor(m, 'webmcp').map((t) => t.name).sort());
    expect(registered.size).toBeGreaterThan(5);
    for (const d of destructiveDefs()) expect(registered.has(toolNameOf(d.id)), d.id).toBe(false);
    for (const t of registered.values()) expect(t.annotations?.destructiveHint, t.name).toBe(false);
    unregister();
  });

  it('MCP tools/list (toMcpTools) carries no destructive tool', () => {
    const names = new Set(toMcpTools(m).map((t) => t.name));
    expect(names.size).toBeGreaterThan(5);
    for (const d of destructiveDefs()) expect(names.has(toolNameOf(d.id)), d.id).toBe(false);
  });

  it.each(['webmcp', 'mcp'] as const)('a forged %s call naming a destructive tool is refused before dispatch', async (surface) => {
    const d = spyDispatcher();
    for (const def of destructiveDefs()) {
      for (const name of [toolNameOf(def.id), def.id]) {
        const r = await guardedCall(d, m, surface, name, { reason: 'abandoned' }, { actor: { kind: surface, id: 'forger' }, idempotencyKey: `forged-${name}` });
        expect(r, `${surface} ${name}`).toMatchObject({ ok: false, status: 'rejected', error: { code: 'surface_forbidden' } });
      }
    }
    expect(d.calls).toEqual([]);
  });

  it('the Companion refuses every destructive tool by name (its own MCP gate)', () => {
    for (const def of destructiveDefs()) {
      const r = checkCall(m, toolNameOf(def.id));
      expect(r.ok, def.id).toBe(false);
      if (!r.ok) expect(r.envelope).toMatchObject({ status: 'rejected', error: { code: 'surface_forbidden' } });
    }
    // and still lets a plain read through
    const read = toolsFor(m, 'mcp').find((t) => t.perm === 'read')!;
    expect(checkCall(m, read.name).ok).toBe(true);
  });
});
