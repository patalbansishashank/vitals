/**
 * Tool manifest contract (SUITE_SPEC §1.8, §7.3): the JSON the app generates from its command registry
 * (`CommandBus.manifest(surface)`, package E4) and every agent surface consumes: the Companion's MCP server (stdio and
 * Streamable HTTP), the app's WebMCP registration and the Coach. One manifest, so every surface exposes exactly the
 * tools generated from the registry and nothing hand-written.
 *
 * Shared source: the app imports this file (`src/agents/manifest.ts` re-exports it), so it must stay free of Node and
 * DOM APIs. Hashing uses Web Crypto, available in browsers and Node ≥ 22.
 *
 * Rules enforced here, not only in the app (defence in depth, SUITE_SPEC §1.4):
 * - external agents (`mcp`, `webmcp`) never see or call `destructive` tools;
 * - their `consequential` writes (confirm class `edit`) are staged as proposals for the person to apply in the app.
 */

export const MANIFEST_FORMAT = 'vitals.tools/1';

/** JSON Schema draft 2020-12 object (no `$ref`, `additionalProperties:false`; §1.8). */
export type JsonSchema = { [key: string]: unknown };

export type Surface = 'ui' | 'ai' | 'webmcp' | 'mcp';
export type Perm = 'read' | 'write' | 'destructive';
export type Impact = 'low' | 'consequential';
/** R8 §5.2 confirmation class, derived from perm/impact (§1.4). */
export type ConfirmClass = 'read' | 'log' | 'edit' | 'destructive';
export type Idempotency = 'natural' | 'key' | 'none';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface ToolManifestEntry {
  /** Command id, `domain.lowerCamel` (`log.mealFromPhoto`). */
  id: string;
  /** Tool name per §1.8 (`log_meal_from_photo`), `[a-z0-9_]{1,64}`. */
  name: string;
  /** The command domain (`log`); used for tool groups and the Responses `namespace` wrapping. */
  namespace: string;
  version: number;
  title: string;
  description: string;
  /** Input schema without `idempotencyKey` (adapters inject it). */
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  perm: Perm;
  impact?: Impact;
  confirm: ConfirmClass;
  surfaces: Surface[];
  idempotency: Idempotency;
  annotations: ToolAnnotations;
}

export interface ToolManifest {
  format: typeof MANIFEST_FORMAT;
  /** App version that generated it (informational). */
  appVersion?: string;
  /** `TOOLSET_HASH`: hex SHA-256 of `canonicalJson(tools)`. */
  hash: string;
  tools: ToolManifestEntry[];
}

/** What a registry entry must provide to become a manifest entry (projection of `CommandDef`, §1.2). */
export interface CommandDefLike {
  id: string;
  version?: number;
  title: string;
  description: string;
  input: JsonSchema;
  output?: JsonSchema;
  perm: Perm;
  impact?: Impact;
  surfaces: readonly Surface[];
  idempotency?: Idempotency;
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ID_RE = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const NAME_RE = /^[a-z0-9_]{1,64}$/;
const SURFACES: readonly Surface[] = ['ui', 'ai', 'webmcp', 'mcp'];
const PERMS: readonly Perm[] = ['read', 'write', 'destructive'];
const IDEMPOTENCY: readonly Idempotency[] = ['natural', 'key', 'none'];

/** `log.mealFromPhoto` → `log_meal_from_photo` (§1.8). */
export function toolNameOf(id: string): string {
  const name = id.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (!NAME_RE.test(name)) throw new ManifestError(`command id ${JSON.stringify(id)} does not map to a valid tool name`);
  return name;
}

/** §1.4 table: perm / impact → confirmation class. A write without impact counts as `low`. */
export function confirmClassOf(perm: Perm, impact?: Impact): ConfirmClass {
  if (perm === 'read') return 'read';
  if (perm === 'destructive') return 'destructive';
  return impact === 'consequential' ? 'edit' : 'log';
}

/** Removes `idempotencyKey` from an object schema (top level only). */
function withoutIdempotencyKey(schema: JsonSchema): JsonSchema {
  const props = schema.properties as Record<string, unknown> | undefined;
  if (!props || !('idempotencyKey' in props)) return schema;
  const { idempotencyKey: _drop, ...rest } = props;
  const required = Array.isArray(schema.required) ? (schema.required as string[]).filter((k) => k !== 'idempotencyKey') : undefined;
  return { ...schema, properties: rest, ...(required ? { required } : {}) };
}

export function toManifestEntry(def: CommandDefLike): ToolManifestEntry {
  if (!ID_RE.test(def.id)) throw new ManifestError(`bad command id ${JSON.stringify(def.id)}`);
  const confirm = confirmClassOf(def.perm, def.impact);
  const idempotency = def.idempotency ?? (def.perm === 'read' ? 'none' : 'key');
  return {
    id: def.id,
    name: toolNameOf(def.id),
    namespace: def.id.slice(0, def.id.indexOf('.')),
    version: def.version ?? 1,
    title: def.title,
    description: def.description,
    inputSchema: withoutIdempotencyKey(def.input),
    ...(def.output ? { outputSchema: def.output } : {}),
    perm: def.perm,
    ...(def.perm === 'write' ? { impact: def.impact ?? 'low' } : {}),
    confirm,
    surfaces: [...def.surfaces],
    idempotency,
    annotations: {
      readOnlyHint: def.perm === 'read',
      destructiveHint: def.perm === 'destructive',
      idempotentHint: def.perm === 'read' || idempotency === 'natural',
      openWorldHint: false,
    },
  };
}

/** Deterministic JSON: object keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Builds a manifest from registry entries (sorted by id, so the hash does not depend on registration order). */
export async function buildToolManifest(defs: readonly CommandDefLike[], appVersion?: string): Promise<ToolManifest> {
  const tools = defs.map(toManifestEntry).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assertUniqueNames(tools);
  return { format: MANIFEST_FORMAT, ...(appVersion ? { appVersion } : {}), hash: await sha256Hex(canonicalJson(tools)), tools };
}

function assertUniqueNames(tools: readonly ToolManifestEntry[]): void {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new ManifestError(`duplicate tool name ${t.name}`);
    seen.add(t.name);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates untrusted manifest JSON (a file, or a message from the paired tab) and recomputes the hash.
 * Throws `ManifestError` naming the first problem.
 */
export async function parseToolManifest(json: unknown): Promise<ToolManifest> {
  if (!isObj(json)) throw new ManifestError('manifest must be an object');
  if (json.format !== MANIFEST_FORMAT) throw new ManifestError(`unsupported manifest format ${JSON.stringify(json.format)}`);
  if (!Array.isArray(json.tools)) throw new ManifestError('manifest.tools must be an array');
  const tools = json.tools.map((t: unknown, i: number): ToolManifestEntry => {
    const where = `tools[${i}]`;
    if (!isObj(t)) throw new ManifestError(`${where} must be an object`);
    for (const k of ['id', 'name', 'namespace', 'title', 'description'] as const) {
      if (typeof t[k] !== 'string' || !t[k]) throw new ManifestError(`${where}.${k} must be a non-empty string`);
    }
    if (!ID_RE.test(t.id as string)) throw new ManifestError(`${where}.id is not a command id`);
    if (t.name !== toolNameOf(t.id as string)) throw new ManifestError(`${where}.name must be ${toolNameOf(t.id as string)}`);
    if (!PERMS.includes(t.perm as Perm)) throw new ManifestError(`${where}.perm is invalid`);
    if (t.impact !== undefined && t.impact !== 'low' && t.impact !== 'consequential') throw new ManifestError(`${where}.impact is invalid`);
    if (t.confirm !== confirmClassOf(t.perm as Perm, t.impact as Impact | undefined)) throw new ManifestError(`${where}.confirm does not match perm/impact`);
    if (!Array.isArray(t.surfaces) || !t.surfaces.every((s) => SURFACES.includes(s as Surface))) throw new ManifestError(`${where}.surfaces is invalid`);
    if (!IDEMPOTENCY.includes(t.idempotency as Idempotency)) throw new ManifestError(`${where}.idempotency is invalid`);
    if (!isObj(t.inputSchema) || t.inputSchema.type !== 'object') throw new ManifestError(`${where}.inputSchema must be an object schema`);
    if (t.outputSchema !== undefined && !isObj(t.outputSchema)) throw new ManifestError(`${where}.outputSchema must be a schema`);
    if (typeof t.version !== 'number' || !Number.isInteger(t.version) || t.version < 1) throw new ManifestError(`${where}.version must be a positive integer`);
    return toManifestEntry({
      id: t.id as string,
      version: t.version,
      title: t.title as string,
      description: t.description as string,
      input: t.inputSchema,
      ...(t.outputSchema ? { output: t.outputSchema as JsonSchema } : {}),
      perm: t.perm as Perm,
      ...(t.impact ? { impact: t.impact as Impact } : {}),
      surfaces: t.surfaces as Surface[],
      idempotency: t.idempotency as Idempotency,
    });
  });
  assertUniqueNames(tools);
  const hash = await sha256Hex(canonicalJson(tools));
  if (typeof json.hash === 'string' && json.hash !== hash) throw new ManifestError('manifest hash does not match its tools');
  return { format: MANIFEST_FORMAT, ...(typeof json.appVersion === 'string' ? { appVersion: json.appVersion } : {}), hash, tools };
}

export type ExternalSurface = 'mcp' | 'webmcp';

/** Whether an external agent may call this tool at all: listed for the surface and never destructive. */
export function exposedTo(tool: ToolManifestEntry, surface: ExternalSurface): boolean {
  return tool.surfaces.includes(surface) && tool.perm !== 'destructive';
}

/** The tools an external agent sees, in manifest order. */
export function toolsFor(manifest: ToolManifest, surface: ExternalSurface): ToolManifestEntry[] {
  return manifest.tools.filter((t) => exposedTo(t, surface));
}

/** Consequential writes from external agents are staged as proposals; low-impact writes and reads run (§1.4). */
export function mustStage(tool: ToolManifestEntry): boolean {
  return tool.confirm === 'edit';
}

/** MCP `tools/list` entry (§1.8 `toMcpTools`). */
export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations: ToolAnnotations & { title: string };
}

export function toMcpTools(manifest: ToolManifest): McpToolDescriptor[] {
  return toolsFor(manifest, 'mcp').map((t) => ({
    name: t.name,
    title: t.title,
    description: mustStage(t) ? `${t.description} (Staged: the person reviews and applies this change in Vitals.)` : t.description,
    inputSchema: t.inputSchema,
    // MCP requires `outputSchema.type === "object"`; strict clients (OpenCode 2.0) drop the whole server otherwise.
    // Tools whose data is an array keep no output schema (their structuredContent is then the envelope). Staged tools
    // keep none either: their usual answer is `pending_user` with no data, which no output schema can describe.
    // Clients check answers against it with their own validator: hence `portableSchema` (inputs are checked by the app).
    ...(t.outputSchema && (t.outputSchema as { type?: unknown }).type === 'object' && !mustStage(t) ? { outputSchema: portableSchema(t.outputSchema) } : {}),
    annotations: { ...t.annotations, title: t.title },
  }));
}

/** Keywords whose value is one schema, a list of schemas or a map of schemas (everything else is copied as it is). */
const ONE_SCHEMA = new Set(['items', 'additionalItems', 'additionalProperties', 'not', 'contains', 'if', 'then', 'else', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties']);
const SCHEMA_LIST = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const SCHEMA_MAP = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

/**
 * A schema every MCP client reads the same way. The manifest is draft 2020-12, but clients compile the schemas with
 * their validator's default draft: the MCP SDK's client (and the agents built on it) uses Ajv's draft-07, which ignores
 * a tuple's `prefixItems` and reads its `items: false` as "no items at all". Every answer carrying a tuple then failed
 * the client's output check (`profile_get`'s `estimate.maintenanceBand80`, "Structured content does not match the
 * tool's output schema"). A tuple becomes an array of the union of its item types with the same length bounds, which
 * reads the same in every draft. Unchanged nodes are returned as they are.
 */
export function portableSchema(s: JsonSchema): JsonSchema {
  const fix = (v: unknown): unknown => (isObj(v) ? portableSchema(v) : v);
  let out: JsonSchema | null = null;
  const set = (k: string, v: unknown) => {
    if (v !== s[k]) (out ??= { ...s })[k] = v;
  };
  for (const [k, v] of Object.entries(s)) {
    if (ONE_SCHEMA.has(k)) set(k, fix(v));
    else if (SCHEMA_LIST.has(k) && Array.isArray(v)) {
      const next = v.map(fix);
      if (next.some((x, i) => x !== v[i])) set(k, next);
    } else if (SCHEMA_MAP.has(k) && isObj(v)) {
      const next = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, fix(x)]));
      if (Object.keys(v).some((n) => next[n] !== v[n])) set(k, next);
    }
  }
  const cur: JsonSchema = out ?? s;
  if (!Array.isArray(cur.prefixItems)) return cur;
  const { prefixItems, items: rest, ...base } = cur;
  // an open tuple (no `items`, or `items: true`) takes anything after its prefix: no item schema can say that
  if (rest === undefined || rest === true) return base;
  const seen = new Map<string, unknown>();
  for (const x of [...(prefixItems as unknown[]), ...(isObj(rest) ? [rest] : [])]) seen.set(canonicalJson(x), x);
  const kinds = [...seen.values()];
  return { ...base, items: kinds.length === 0 ? false : kinds.length === 1 ? kinds[0] : { anyOf: kinds } };
}

/** A food an agent can pick for a meal component that `log_meal` could not place (`needs_choice`). */
export interface FoodCandidate {
  /** The component's name as the agent sent it. */
  component: string;
  /** Pass this as the component's `foodId` when calling the tool again. */
  foodId: string;
  name: string;
}

/**
 * SUITE_SPEC §1.8 tool result envelope, as returned by the app's dispatcher bridge. `needs_choice`: the call was
 * understood but wrote nothing (`saved: false`) because one answer is missing; `candidates` lists foods to pick from.
 */
export interface ToolResultEnvelope {
  ok: boolean;
  status: 'applied' | 'pending_user' | 'needs_choice' | 'rejected' | 'running';
  changeId?: string;
  jobId?: string;
  summary: string;
  /** Set with `needs_choice`: false, nothing was saved. */
  saved?: boolean;
  /** With `needs_choice`, when the app has foods to offer. */
  candidates?: FoodCandidate[];
  data?: unknown;
  error?: { code: string; message: string; detail?: Record<string, unknown> };
}

export function rejected(code: string, message: string): ToolResultEnvelope {
  return { ok: false, status: 'rejected', summary: message, error: { code, message } };
}

// ---------------------------------------------------------------------------------------------------------------
// Agent token scopes on the server (SUITE_SPEC §14.4)

/** `read` lists read tools; `log` adds low-impact writes (applied, with undo); `edit` adds consequential writes (staged). */
export type ToolScope = 'read' | 'log' | 'edit';

const SCOPE_CLASSES: Record<ToolScope, readonly ConfirmClass[]> = {
  read: ['read'],
  log: ['read', 'log'],
  edit: ['read', 'log', 'edit'],
};

/** Destructive tools are never in any scope. */
export function scopeAllows(tool: ToolManifestEntry, scope: ToolScope): boolean {
  return exposedTo(tool, 'mcp') && SCOPE_CLASSES[scope].includes(tool.confirm);
}

/** The manifest an agent token sees: MCP tools within its scope, minus the commands the server cannot run. */
export function manifestForScope(manifest: ToolManifest, scope: ToolScope, notOnServer: ReadonlySet<string> = new Set()): ToolManifest {
  return { ...manifest, tools: manifest.tools.filter((t) => scopeAllows(t, scope) && !notOnServer.has(t.id)) };
}
