/**
 * The one tool manifest (SUITE_SPEC §1.8, §7.3): `toolManifest()` is exact `vitals.tools/1` (the Companion's own parser
 * accepts it with the same hash), `TOOLSET_HASH` is its hash, the Companion's MCP `tools/list` serves exactly
 * `toMcpTools(manifest)`, and the Coach's `ToolRegistry` is built from it.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, MANIFEST_FORMAT, parseToolManifest, sha256Hex, toManifestEntry, toMcpTools, type ToolManifest } from '@/agents/manifest';
import { registryFromManifest } from '@/ai/tools/manifest';
import { allCommands, toolsetHash, type Surface } from '..';
import { createAiToolRegistry } from '../ai/tools';
import { AGENT_SURFACES, plainSchema, toolManifest } from '../manifest';

const agentDefs = () => allCommands().filter((d) => d.surfaces.some((s) => AGENT_SURFACES.includes(s)));

describe('toolManifest (vitals.tools/1)', () => {
  const m = toolManifest();

  it('is every agent-surface command, sorted by id, built by the contract’s toManifestEntry', () => {
    expect(m.format).toBe(MANIFEST_FORMAT);
    const ids = agentDefs().map((d) => d.id as string);
    expect(m.tools.map((t) => t.id)).toEqual([...ids].sort());
    for (const t of m.tools) {
      const d = allCommands().find((x) => x.id === t.id)!;
      const entry = toManifestEntry({
        id: d.id,
        version: d.version,
        title: d.title,
        description: d.description,
        input: plainSchema(d.input) as Record<string, unknown>,
        output: plainSchema(d.output) as Record<string, unknown>,
        perm: d.perm,
        ...(d.impact ? { impact: d.impact } : {}),
        surfaces: d.surfaces,
        idempotency: d.idempotency,
      });
      expect(t).toEqual(entry);
    }
  });

  it('every input schema is an object schema (MCP and the Companion’s parser require it; a top-level anyOf is refused)', () => {
    expect(m.tools.filter((t) => t.inputSchema.type !== 'object').map((t) => t.id)).toEqual([]);
  });

  it('hash = SHA-256(canonicalJson(tools)) = TOOLSET_HASH, and the Companion’s parser accepts it unchanged', async () => {
    expect(m.hash).toBe(await sha256Hex(canonicalJson(m.tools)));
    expect(toolsetHash()).toBe(m.hash);
    const parsed = await parseToolManifest(JSON.parse(JSON.stringify(m)));
    expect(parsed).toEqual(m);
  });

  it.each(['ai', 'webmcp', 'mcp'] as Surface[])('the %s manifest is that surface’s tools with its own hash', async (s) => {
    const sm = toolManifest(s);
    expect(sm.tools.every((t) => t.surfaces.includes(s))).toBe(true);
    expect(sm.tools.length).toBe(allCommands().filter((d) => d.surfaces.includes(s)).length);
    expect(sm.hash).toBe(await sha256Hex(canonicalJson(sm.tools)));
    expect(toolsetHash(s)).toBe(sm.hash);
  });

  it('is cached per registry state (same object until a definition changes)', () => {
    expect(toolManifest()).toBe(m);
  });
});

/**
 * What the Companion serves: the tab sends `toolManifest()` in its bridge `hello`; the hub keeps
 * `parseToolManifest(msg.manifest)` and `tools/list` answers `toMcpTools(thatManifest)` (`hubBackend`,
 * packages/companion/src/mcp.ts; `mcp.test.ts` checks the MCP server serves exactly that for a manifest). The SDK and
 * Node modules stay out of the app's tests, so the parity is asserted through the same contract functions.
 */
describe('Companion parity', () => {
  it('tools/list over the app manifest is exactly toMcpTools(manifest): no destructive, only mcp tools', async () => {
    const app = toolManifest();
    const hub: ToolManifest = await parseToolManifest(JSON.parse(JSON.stringify(app)));
    expect(hub.hash).toBe(app.hash);
    const list = toMcpTools(hub);
    expect(list).toEqual(toMcpTools(app));
    expect(list.map((t) => t.name)).toEqual(app.tools.filter((t) => t.surfaces.includes('mcp') && t.perm !== 'destructive').map((t) => t.name));
    for (const t of list) {
      const entry = app.tools.find((x) => x.name === t.name)!;
      expect(t.inputSchema).toEqual(entry.inputSchema);
      expect(t.annotations).toEqual({ ...entry.annotations, title: entry.title });
      if (entry.confirm === 'edit') expect(t.description).toMatch(/Staged: the person reviews/);
    }
  });
});

describe('registryFromManifest', () => {
  it('builds the Coach’s registry from the ai manifest: same tools, names and hash', async () => {
    const ai = toolManifest('ai');
    const reg = createAiToolRegistry();
    expect(reg.defs().map((d) => d.id)).toEqual(ai.tools.map((t) => t.id));
    expect(await reg.manifestHash()).toBe(ai.hash);
    for (const t of ai.tools) {
      const d = reg.byToolName(t.name)!;
      expect(d).toMatchObject({ id: t.id, namespace: t.namespace, title: t.title, confirm: t.confirm, input: t.inputSchema });
    }
  });

  it('keeps only ai-surface tools and carries per-command extras', async () => {
    const m = toolManifest();
    const reg = registryFromManifest(m, { extras: (id) => (id === 'today.get' ? { aiLimit: { perTurn: 2 } } : undefined) });
    expect(reg.defs().every((d) => m.tools.find((t) => t.id === d.id)!.surfaces.includes('ai'))).toBe(true);
    const today = reg.get('today.get');
    if (today) expect(today.aiLimit).toEqual({ perTurn: 2 });
    expect(await reg.manifestHash()).toBe(m.hash);
  });
});
