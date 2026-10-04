/**
 * Tool specs → wire formats (R8 §5.1, SUITE_SPEC §1.8). One implementation for the whole app: the renderers and the
 * strict projection live in `src/commands/adapters/` (SUITE_SPEC §1.8 places the adapters there) and are re-exported
 * here, so the Coach's provider adapters and the command manifest render tools identically.
 *
 * Strict projection (`strict: true`): every property listed in `required`, optional properties become `T | null`,
 * `additionalProperties:false` on every object, and keywords strict modes reject are stripped. A schema strict mode
 * cannot express (free-key objects, optional properties where `null` already means something, unconstrained values)
 * goes out non-strict for that tool only. The dispatcher re-validates against the original schema either way.
 */
export {
  acceptsNull,
  fromStrictInput,
  NotStrict,
  STRICT_STRIP,
  strictProjection,
  strictSchema,
  toOpenAIChatTools,
  toOpenAIResponsesTools,
  tryStrict,
  type OpenAIChatTool,
  type OpenAIResponsesFunction,
  type OpenAIResponsesNamespace,
  type OpenAIResponsesTool,
  type RenderOptions,
  type StrictSchema,
  type ToolLike,
} from '@/commands/adapters/openai';
export { toAnthropicTools, type AnthropicTool } from '@/commands/adapters/anthropic';
