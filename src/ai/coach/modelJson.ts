/**
 * One-shot structured calls for the Coach's model-backed ports (photo recognition, recipes, exercise resolution).
 * Asks for a JSON object with `responseSchema`; when the provider ignores it the reply is still parsed out of plain
 * text (fenced block or first balanced object), so weaker providers work too.
 */
import { ProviderError } from '../providers/errors';
import type { ChatModel, JsonSchema, Part } from '../providers/types';

export interface AskJsonRequest {
  system: string;
  user: Part[];
  schemaName: string;
  schema: JsonSchema;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/** The model answered but not with parseable JSON. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

/** First JSON object in free text: whole text, a ```json fence, or the first balanced `{…}`. */
export function extractJsonObject(text: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const t = text.trim();
  const whole = tryParse(t);
  if (whole && typeof whole === 'object') return whole;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    const v = tryParse(fence[1]!.trim());
    if (v && typeof v === 'object') return v;
  }
  for (let start = t.indexOf('{'); start >= 0; start = t.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i]!;
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        const v = tryParse(t.slice(start, i + 1));
        if (v && typeof v === 'object') return v;
        break;
      }
    }
  }
  throw new ModelOutputError('The model did not return JSON.');
}

export async function askJson(model: ChatModel, req: AskJsonRequest): Promise<Record<string, unknown>> {
  const res = await model.complete(
    {
      messages: [
        { role: 'system', parts: [{ type: 'text', text: req.system }] },
        { role: 'user', parts: req.user },
      ],
      responseSchema: { name: req.schemaName, schema: req.schema },
      maxOutputTokens: req.maxOutputTokens ?? 2000,
      temperature: 0.2,
    },
    req.signal,
  );
  if (res.error) throw new ProviderError(res.error);
  // a reply cut off at the token limit is unfinished JSON; the scanner would pick an inner object as the answer
  if (res.stopReason === 'length') throw new ModelOutputError('The model’s reply was cut off before it was complete.');
  const text = res.message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
  const v = extractJsonObject(text);
  if (Array.isArray(v)) throw new ModelOutputError('The model returned a list, not an object.');
  return v as Record<string, unknown>;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
