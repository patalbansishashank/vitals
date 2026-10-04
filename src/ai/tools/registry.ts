/**
 * Tool registry over `AiCommandDef`s (SUITE_SPEC §1.8, R8 §5.1): tool names, tiers, groups, rendering per dialect and
 * the manifest hash (`TOOLSET_HASH`).
 *
 * Tool names follow SUITE_SPEC §1.8 literally: id `.` → `_` and camelCase → snake_case
 * (`log.mealFromPhoto` → `log_meal_from_photo`, `sim.whatIf` → `sim_what_if`), `[a-z0-9_]`, ≤ 64 chars. The spec's
 * core-group list uses exactly these names. The mapping is one function (`toolNameOf`) so a change is one line.
 */
import { canonicalJson, sha256Hex, toolNameOf as contractToolName } from '@/agents/manifest';
import type { AdapterKind, JsonSchema, ToolSpec } from '../providers/types';
import { toAnthropicTools, toOpenAIChatTools, toOpenAIResponsesTools } from './render';
import type { AiCommandDef, ConfirmClass } from './types';

/** Canonical JSON and SHA-256: the tool contract's functions (one implementation for every manifest hash). */
export { canonicalJson, sha256Hex };

/** `domain.lowerCamel`. */
const ID_RE = /^[a-z][a-z0-9]*\.[a-z][A-Za-z0-9]*$/;
const TOOL_NAME_RE = /^[a-z0-9_]{1,64}$/;
const MAX_DESCRIPTION = 600;

export type ToolTier = 'full' | 'basic';

/** The contract's mapping; ids that do not map to a valid name come back unchecked so the registry can say why. */
export function toolNameOf(id: string): string {
  try {
    return contractToolName(id);
  } catch {
    return id.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }
}

/** Default per-turn AI call limits (SUITE_SPEC §1.2 `aiLimit`). */
const DEFAULT_PER_TURN: Record<ConfirmClass, number> = { read: 20, log: 5, edit: 5, destructive: 1 };

export function perTurnLimit(def: AiCommandDef): number {
  return def.aiLimit?.perTurn ?? DEFAULT_PER_TURN[def.confirm];
}

export function isBasic(def: AiCommandDef): boolean {
  return def.basic ?? (def.confirm === 'read' || def.confirm === 'log');
}

/** The adapter injects `idempotencyKey`, so the model never sees it (SUITE_SPEC §1.8). */
export function modelInputSchema(input: JsonSchema): JsonSchema {
  const props = input.properties as Record<string, JsonSchema> | undefined;
  if (!props || !('idempotencyKey' in props)) return input;
  const { idempotencyKey: _drop, ...rest } = props;
  const out: JsonSchema = { ...input, properties: rest };
  if (Array.isArray(input.required)) out.required = (input.required as string[]).filter((r) => r !== 'idempotencyKey');
  return out;
}

export interface ToolSpecOptions {
  tier?: ToolTier;
  /** Namespaces to include; omitted = all. */
  groups?: readonly string[];
  /** Command ids added on top of `groups` (still filtered by tier). */
  include?: readonly string[];
}

export interface RenderToolOptions extends ToolSpecOptions {
  strict?: boolean;
  /** Responses API only: wrap in `{type:'namespace', name}` (Sign in with ChatGPT). */
  namespace?: string;
}

export interface ToolRegistryOptions {
  /** The `hash` of the manifest these defs came from (`registryFromManifest`); `manifestHash()` returns it. */
  manifestHash?: string;
}

export class ToolRegistry {
  private readonly byId = new Map<string, AiCommandDef>();
  private readonly byName = new Map<string, AiCommandDef>();
  private readonly list: readonly AiCommandDef[];
  private readonly sourceHash: string | undefined;

  constructor(defs: readonly AiCommandDef[], opts: ToolRegistryOptions = {}) {
    this.sourceHash = opts.manifestHash;
    for (const def of defs) {
      if (!ID_RE.test(def.id)) throw new Error(`Invalid command id "${def.id}" (expected domain.lowerCamel)`);
      const ns = def.id.slice(0, def.id.indexOf('.'));
      if (def.namespace !== ns) throw new Error(`Command "${def.id}" has namespace "${def.namespace}", expected "${ns}"`);
      if (def.description.length > MAX_DESCRIPTION) throw new Error(`Command "${def.id}" description exceeds ${MAX_DESCRIPTION} chars`);
      const name = toolNameOf(def.id);
      if (!TOOL_NAME_RE.test(name)) throw new Error(`Tool name "${name}" for "${def.id}" is not [a-z0-9_]{1,64}`);
      if (this.byId.has(def.id)) throw new Error(`Duplicate command id "${def.id}"`);
      const clash = this.byName.get(name);
      if (clash) throw new Error(`Tool name "${name}" collides: "${clash.id}" and "${def.id}"`);
      this.byId.set(def.id, def);
      this.byName.set(name, def);
    }
    this.list = [...defs];
  }

  defs(): readonly AiCommandDef[] {
    return this.list;
  }

  get(id: string): AiCommandDef | undefined {
    return this.byId.get(id);
  }

  byToolName(name: string): AiCommandDef | undefined {
    return this.byName.get(name);
  }

  toolName(def: AiCommandDef): string {
    return toolNameOf(def.id);
  }

  toolSpecs(opts: ToolSpecOptions = {}): ToolSpec[] {
    const tier = opts.tier ?? 'full';
    const groups = opts.groups ? new Set(opts.groups) : null;
    const include = new Set(opts.include ?? []);
    return this.list
      .filter((d) => !groups || groups.has(d.namespace) || include.has(d.id))
      .filter((d) => tier === 'full' || isBasic(d))
      .map((d) => ({ name: toolNameOf(d.id), description: d.description, inputSchema: modelInputSchema(d.input) }));
  }

  render(adapter: AdapterKind, opts: RenderToolOptions = {}) {
    const specs = this.toolSpecs(opts);
    const strict = Boolean(opts.strict);
    switch (adapter) {
      case 'openai-chat':
        return toOpenAIChatTools(specs, { strict });
      case 'openai-responses':
        return toOpenAIResponsesTools(specs, { strict, ...(opts.namespace ? { namespace: opts.namespace } : {}) });
      case 'anthropic-messages':
        return toAnthropicTools(specs, { strict });
    }
  }

  /**
   * SHA-256 (hex) of the canonical manifest JSON, sorted by id (SUITE_SPEC §1.8 `TOOLSET_HASH`). A registry built from
   * the app's manifest (`registryFromManifest`) returns that manifest's `hash`.
   */
  async manifestHash(): Promise<string> {
    if (this.sourceHash) return this.sourceHash;
    const manifest = [...this.list]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((d) => ({
        id: d.id,
        name: toolNameOf(d.id),
        version: d.version ?? 1,
        title: d.title,
        description: d.description,
        input: modelInputSchema(d.input),
        output: d.output,
        confirm: d.confirm,
        perTurn: perTurnLimit(d),
        basic: isBasic(d),
      }));
    return sha256Hex(canonicalJson(manifest));
  }
}
