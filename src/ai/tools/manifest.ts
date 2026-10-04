/**
 * The Coach's tools come from the app's one tool manifest (`vitals.tools/1`, SUITE_SPEC §1.8): the command registry
 * generates it (`src/commands/manifest.ts` `toolManifest('ai')`), and these adapters turn its entries into the
 * `AiCommandDef`s the `ToolRegistry` takes. Nothing here is hand-written per tool.
 *
 * The contract types come from `packages/companion/src/toolManifest.ts` (through `@/agents/manifest`), shared with the
 * Companion's MCP server and the app's WebMCP registration.
 */
import type { ToolManifest, ToolManifestEntry } from '@/agents/manifest';
import type { JsonSchema } from '../providers/types';
import { ToolRegistry } from './registry';
import type { AiCommandDef, CommandIdLike } from './types';

/** What the manifest does not carry but the registry may know (per-turn limits, the basic-tier override). */
export interface ManifestExtras {
  aiLimit?: { perTurn: number };
  basic?: boolean;
}

/** One manifest entry → the AI layer's command definition. */
export function fromManifest(entry: ToolManifestEntry, extras: ManifestExtras = {}): AiCommandDef {
  return {
    id: entry.id as CommandIdLike,
    namespace: entry.namespace,
    version: entry.version,
    title: entry.title,
    description: entry.description,
    input: entry.inputSchema as JsonSchema,
    ...(entry.outputSchema ? { output: entry.outputSchema as JsonSchema } : {}),
    confirm: entry.confirm,
    ...(extras.aiLimit ? { aiLimit: extras.aiLimit } : {}),
    ...(extras.basic !== undefined ? { basic: extras.basic } : {}),
  };
}

export interface RegistryFromManifestOptions {
  /** Per-command extras (limits, tier), looked up by command id. */
  extras?: (id: string) => ManifestExtras | undefined;
}

/**
 * The Coach's `ToolRegistry` over a manifest: only tools on the `ai` surface; never `destructive` ones' execution (the
 * runner refuses them anyway). `registry.manifestHash()` returns the manifest's own `hash` (`TOOLSET_HASH`).
 */
export function registryFromManifest(manifest: ToolManifest, opts: RegistryFromManifestOptions = {}): ToolRegistry {
  const defs = manifest.tools.filter((t) => t.surfaces.includes('ai')).map((t) => fromManifest(t, opts.extras?.(t.id)));
  return new ToolRegistry(defs, { manifestHash: manifest.hash });
}
