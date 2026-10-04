/** Token accounting (R8 §3.5): estimates when the server reports nothing, cost from preset or catalogue prices. */
import { imageTokens } from './images';
import type { ChatMessage, ChatRequest, Usage } from './types';

/** Characters per token for estimates (R8 §3.1). */
export const CHARS_PER_TOKEN = 3.5;
/** Per-message framing overhead (role markers), a planning number. */
const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(m: ChatMessage): number {
  let t = MESSAGE_OVERHEAD_TOKENS;
  for (const p of m.parts) t += p.type === 'text' ? estimateTextTokens(p.text) : imageTokens(p.width, p.height);
  for (const c of m.toolCalls ?? []) t += estimateTextTokens(c.name) + estimateTextTokens(c.rawArgs);
  return t;
}

/** Input-side estimate of a request (messages, tool schemas, response schema). */
export function estimateRequestTokens(req: ChatRequest): number {
  let t = 0;
  for (const m of req.messages) t += estimateMessageTokens(m);
  for (const tool of req.tools ?? []) {
    t += estimateTextTokens(tool.name) + estimateTextTokens(tool.description) + estimateTextTokens(JSON.stringify(tool.inputSchema));
  }
  if (req.responseSchema) t += estimateTextTokens(JSON.stringify(req.responseSchema.schema));
  return t;
}

export function estimateUsage(req: ChatRequest, outputText: string): Usage {
  return { inputTokens: estimateRequestTokens(req), outputTokens: estimateTextTokens(outputText), estimated: true };
}

/** USD for a usage record. Prices are USD per 1M tokens; cached input billed at `cachedInput` when given. */
export function costUsd(usage: Usage, price: { input: number; output: number; cachedInput?: number } | undefined): number | undefined {
  if (!price) return undefined;
  const cached = usage.cachedInputTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cached);
  const cachedRate = price.cachedInput ?? price.input;
  return (fresh * price.input + cached * cachedRate + usage.outputTokens * price.output) / 1e6;
}

export function addUsage(a: Usage | null, b: Usage): Usage {
  if (!a) return b;
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const out: Usage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimated: a.estimated || b.estimated,
  };
  const cached = sum(a.cachedInputTokens, b.cachedInputTokens);
  if (cached !== undefined) out.cachedInputTokens = cached;
  const writes = sum(a.cacheWriteTokens, b.cacheWriteTokens);
  if (writes !== undefined) out.cacheWriteTokens = writes;
  const reasoning = sum(a.reasoningTokens, b.reasoningTokens);
  if (reasoning !== undefined) out.reasoningTokens = reasoning;
  const cost = sum(a.costUsd, b.costUsd);
  if (cost !== undefined) out.costUsd = cost;
  return out;
}

/** One ledger row per request (R8 §3.5), appended to `ai.usage` by the caller. */
export interface UsageLedgerRow {
  ts: string;
  preset: string;
  model: string;
  in: number;
  out: number;
  cached: number;
  costUsd: number | null;
  estimated: boolean;
  conversationId: string | null;
}

export function ledgerRow(ts: string, preset: string, model: string, usage: Usage, conversationId: string | null): UsageLedgerRow {
  return {
    ts, preset, model,
    in: usage.inputTokens,
    out: usage.outputTokens,
    cached: usage.cachedInputTokens ?? 0,
    costUsd: usage.costUsd ?? null,
    estimated: usage.estimated,
    conversationId,
  };
}
