/**
 * OpenAI tool projections (SUITE_SPEC §1.8), pure functions over tool descriptors (the manifest's entries, or the
 * Coach's `ToolSpec`s: anything with `name`, `description`, `inputSchema`). The one implementation: the Coach's
 * provider adapters render through `src/ai/tools/render.ts`, which re-exports these.
 *
 * - `toOpenAIChatTools`: `/chat/completions` (every OpenAI-compatible server).
 * - `toOpenAIResponsesTools`: Responses API (OpenAI direct and Sign in with ChatGPT); with `namespace` the functions
 *   are wrapped in one `{type:'namespace', name, tools}` entry, which plan usage requires.
 *
 * With `strict: true` each tool carries the strict projection (`./strict.ts`) where its schema allows it; a schema
 * strict mode cannot express goes out non-strict for that tool only. The dispatcher re-validates the original schema
 * either way.
 */
import { tryStrict, type StrictSchema } from './strict';

export { acceptsNull, fromStrictInput, NotStrict, STRICT_STRIP, strictProjection, strictSchema, tryStrict, type SchemaLike, type StrictSchema } from './strict';

/** What a renderer needs from a tool: a manifest entry, an E4 `ToolDescriptor` or an `src/ai` `ToolSpec`. */
export interface ToolLike {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface RenderOptions {
  /** Strict projection where expressible (`Capabilities.strictTools`). Default false. */
  strict?: boolean;
}

function params(t: ToolLike, strict: boolean): { parameters: StrictSchema; strict: boolean } {
  const schema = (t.inputSchema ?? {}) as StrictSchema;
  if (!strict) return { parameters: schema, strict: false };
  const p = tryStrict(schema);
  return { parameters: p.schema, strict: p.strict };
}

// type aliases (not interfaces), so results are assignable to `Record<string, unknown>` request bodies
export type OpenAIChatTool = {
  type: 'function';
  function: { name: string; description: string; parameters: StrictSchema; strict?: boolean };
};

/** `/chat/completions` tools; `strict: true` only on tools whose schema strict mode can express. */
export function toOpenAIChatTools(tools: readonly ToolLike[], opts: RenderOptions = {}): OpenAIChatTool[] {
  return tools.map((t) => {
    const p = params(t, Boolean(opts.strict));
    return { type: 'function', function: { name: t.name, description: t.description, parameters: p.parameters, ...(p.strict ? { strict: true } : {}) } };
  });
}

export type OpenAIResponsesFunction = {
  type: 'function';
  name: string;
  description: string;
  parameters: StrictSchema;
  strict: boolean;
};
export type OpenAIResponsesNamespace = {
  type: 'namespace';
  name: string;
  /** Required by the API (400 "Missing required parameter: 'tools[0].description'" without it). */
  description: string;
  tools: OpenAIResponsesFunction[];
};

/** What the namespace says about itself; the model sees it next to the tool names. */
export const RESPONSES_NAMESPACE_DESCRIPTION = "Vitals: the person's plan, logs, measurements and settings. Call these to read or change them.";
export type OpenAIResponsesTool = OpenAIResponsesFunction | OpenAIResponsesNamespace;

/** Responses API tools; with `namespace` (Sign in with ChatGPT) one `{type:'namespace', name, tools}` wrapper. */
export function toOpenAIResponsesTools(tools: readonly ToolLike[], opts: RenderOptions & { namespace?: string } = {}): OpenAIResponsesTool[] {
  const fns: OpenAIResponsesFunction[] = tools.map((t) => {
    const p = params(t, Boolean(opts.strict));
    return { type: 'function', name: t.name, description: t.description, parameters: p.parameters, strict: p.strict };
  });
  return opts.namespace ? [{ type: 'namespace', name: opts.namespace, description: RESPONSES_NAMESPACE_DESCRIPTION, tools: fns }] : fns;
}
