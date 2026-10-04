/**
 * Anthropic tool projection (SUITE_SPEC §1.8): `{ name, description, input_schema }`, pure. The one implementation:
 * the Coach's Messages adapter renders through `src/ai/tools/render.ts`, which re-exports this.
 */
import { tryStrict, type StrictSchema } from './strict';
import type { RenderOptions, ToolLike } from './openai';

/** Tool-result envelope shared by every adapter (SUITE_SPEC §1.8): the agent contract's type. */
export type { ToolResultEnvelope } from '@/agents/manifest';

// a type alias (not an interface), so results are assignable to `Record<string, unknown>` request bodies
export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: StrictSchema;
  strict?: boolean;
};

export function toAnthropicTools(tools: readonly ToolLike[], opts: RenderOptions = {}): AnthropicTool[] {
  return tools.map((t) => {
    const raw = (t.inputSchema ?? {}) as StrictSchema;
    // input_schema must be an object schema
    const schema = (raw.type === 'object' ? raw : { type: 'object', properties: { value: raw }, required: ['value'], additionalProperties: false }) as StrictSchema;
    if (!opts.strict) return { name: t.name, description: t.description, input_schema: schema };
    const p = tryStrict(schema);
    return { name: t.name, description: t.description, input_schema: p.schema, ...(p.strict ? { strict: true } : {}) };
  });
}
