/**
 * Tool manifest (SUITE_SPEC §1.8, §7.3): every command whose surfaces include a tool surface becomes a tool, generated
 * from the registry — never hand-written. One manifest for every consumer:
 *
 * - `toolManifest(surface?)` is the agent contract `vitals.tools/1` (`packages/companion/src/toolManifest.ts`, through
 *   `@/agents/manifest`): the entries are built by the contract's own `toManifestEntry`, sorted by id, and
 *   `hash = SHA-256(canonicalJson(tools))` — so the Companion's `parseToolManifest` recomputes the same hash and accepts
 *   it. The Companion's MCP server, the app's WebMCP registration (`src/agents`) and the Coach's `ToolRegistry`
 *   (`src/ai/tools`, through `fromManifest`) all read it.
 * - `TOOLSET_HASH` = `toolsetHash()` = the hash of the agent manifest (`toolManifest()`, every tool any agent surface
 *   has), shown in Settings › Agents and snapshot-tested. `toolsetHash(surface)` is the hash of one surface's manifest.
 * - `buildManifest(surface)` keeps E4's `ToolDescriptor` (the contract's fields plus `commandId`, `group`,
 *   `notImplemented`) in registry order for the bus and the parity test.
 *
 * Hashing: the contract hashes with Web Crypto (async); this module needs a synchronous hash for the bus, so it uses
 * E4's pure SHA-256 over the contract's own `canonicalJson`. Same algorithm, same bytes, same hex (tested).
 */
import {
  canonicalJson,
  MANIFEST_FORMAT,
  toManifestEntry,
  toolNameOf,
  type ToolManifest,
  type ToolManifestEntry,
} from '@/agents/manifest';
import { allCommands } from './registry';
import { sha256Hex, type JsonSchema } from './schema';
import { SURFACES, type CommandDef, type CommandDomain, type Surface, type ToolDescriptor } from './types';

/** The surfaces an agent reaches tools through (everything but the app's own screens). */
export const AGENT_SURFACES: readonly Surface[] = ['ai', 'webmcp', 'mcp'];

/** `log.mealFromPhoto` → `log_meal_from_photo` (≤ 64 chars, [a-z0-9_]): the contract's `toolNameOf`. */
export function toolName(id: string): string {
  return toolNameOf(id);
}

/** Plain JSON copy of a schema (drops the optional-property symbols). */
export function plainSchema(s: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(s)) as JsonSchema;
}

/** The contract entry of one command (`vitals.tools/1`). */
export function manifestEntryOf(def: CommandDef): ToolManifestEntry;
/** The contract entry of an E4 descriptor (drops `commandId`, `group`, `notImplemented`). */
export function manifestEntryOf(tool: ToolDescriptor): ToolManifestEntry;
export function manifestEntryOf(x: CommandDef | ToolDescriptor): ToolManifestEntry {
  if ('commandId' in x) {
    const { commandId: _c, group: _g, notImplemented: _n, ...entry } = x;
    return entry as ToolManifestEntry;
  }
  return toManifestEntry({
    id: x.id,
    version: x.version,
    title: x.title,
    description: x.description,
    input: plainSchema(x.input) as Record<string, unknown>,
    output: plainSchema(x.output) as Record<string, unknown>,
    perm: x.perm,
    ...(x.impact ? { impact: x.impact } : {}),
    surfaces: x.surfaces,
    idempotency: x.idempotency,
  });
}

export function toolOf(def: CommandDef): ToolDescriptor {
  const entry = manifestEntryOf(def);
  return {
    ...entry,
    id: def.id,
    commandId: def.id,
    group: def.id.split('.')[0] as CommandDomain,
    ...(def.notImplemented ? { notImplemented: def.notImplemented.owner } : {}),
  } as ToolDescriptor;
}

/** E4 descriptors of `surface`'s tools, in registry order (the bus's `manifest(surface)`). */
export function buildManifest(surface: Surface): ToolDescriptor[] {
  return allCommands()
    .filter((d) => d.surfaces.includes(surface))
    .map(toolOf);
}

const byId = (a: ToolManifestEntry, b: ToolManifestEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `hash` of a contract manifest: hex SHA-256 of `canonicalJson(tools)` (the contract's rule, computed synchronously). */
export function manifestHash(tools: readonly ToolManifestEntry[]): string {
  return sha256Hex(canonicalJson(tools));
}

let cache: { key: string; manifests: Map<string, ToolManifest> } | null = null;

/** Registry fingerprint: a new definition, version or surface list invalidates the cached manifests. */
function registryKey(defs: readonly CommandDef[]): string {
  return defs.map((d) => `${d.id}@${d.version}:${d.surfaces.join(',')}`).join('|');
}

/**
 * The agent contract manifest (`vitals.tools/1`): with no argument, every tool any agent surface (`ai`, `webmcp`,
 * `mcp`) has — what `AgentDispatcher.manifest()` serves; with a surface, that surface's tools. Sorted by id.
 */
export function toolManifest(surface?: Surface): ToolManifest {
  const defs = allCommands();
  const key = registryKey(defs);
  if (!cache || cache.key !== key) cache = { key, manifests: new Map() };
  const slot = surface ?? '*';
  const hit = cache.manifests.get(slot);
  if (hit) return hit;
  const tools = defs
    .filter((d) => (surface ? d.surfaces.includes(surface) : d.surfaces.some((s) => AGENT_SURFACES.includes(s))))
    .map((d) => manifestEntryOf(d))
    .sort(byId);
  const manifest: ToolManifest = { format: MANIFEST_FORMAT, hash: manifestHash(tools), tools };
  cache.manifests.set(slot, manifest);
  return manifest;
}

/**
 * `TOOLSET_HASH`: the hash of the agent manifest (`toolManifest().hash`), shown in Settings › Agents and
 * snapshot-tested; `toolsetHash(surface)` hashes one surface's manifest.
 */
export function toolsetHash(surface?: Surface): string {
  return toolManifest(surface).hash;
}

/** The exclusions: every command without a surface, with its written reason. */
export function exclusions(surface: Surface): Array<{ commandId: string; reason: string | null }> {
  return allCommands()
    .filter((d) => !d.surfaces.includes(surface))
    .map((d) => ({ commandId: d.id, reason: d.excludedReason?.[surface] ?? null }));
}

/** Manifest JSON: tools per surface plus the exclusion list (the reviewed artefact; snapshot-tested). */
export function manifestJson(): { version: 1; surfaces: Record<Surface, { tools: ToolDescriptor[]; excluded: Array<{ commandId: string; reason: string | null }> }> } {
  const surfaces = {} as Record<Surface, { tools: ToolDescriptor[]; excluded: Array<{ commandId: string; reason: string | null }> }>;
  for (const s of SURFACES) surfaces[s] = { tools: buildManifest(s), excluded: exclusions(s) };
  return { version: 1, surfaces };
}

/**
 * The reviewed manifest artefact (snapshot-tested): the agent `TOOLSET_HASH`, per surface the hash of that surface's
 * manifest, each tool with its version, class and a hash of its schemas, plus the exclusions with their reasons.
 * Schemas themselves are generated at runtime (`buildManifest`, `toolManifest`).
 */
export function manifestSummary(): {
  version: 1;
  format: string;
  agentToolsetHash: string;
  toolsetHash: Record<Surface, string>;
  surfaces: Record<Surface, { tools: Array<{ name: string; commandId: string; version: number; perm: string; impact?: string; confirm: string; schemaHash: string; stub?: string }>; excluded: Array<{ commandId: string; reason: string | null }> }>;
} {
  const out = {
    version: 1 as const,
    format: MANIFEST_FORMAT,
    agentToolsetHash: toolsetHash(),
    toolsetHash: {} as Record<Surface, string>,
    surfaces: {} as ReturnType<typeof manifestSummary>['surfaces'],
  };
  for (const s of SURFACES) {
    out.toolsetHash[s] = toolsetHash(s);
    out.surfaces[s] = {
      tools: buildManifest(s).map((t) => ({
        name: t.name,
        commandId: t.commandId,
        version: t.version,
        perm: t.perm,
        ...(t.impact ? { impact: t.impact } : {}),
        confirm: t.confirm,
        schemaHash: sha256Hex(canonicalJson({ i: t.inputSchema, o: t.outputSchema })).slice(0, 16),
        ...(t.notImplemented ? { stub: t.notImplemented } : {}),
      })),
      excluded: exclusions(s),
    };
  }
  return out;
}
