// @vitest-environment node
/** Review pass V1e: model output that must not slip through validation, truncated JSON, a stopped report read. */
import { describe, expect, it } from 'vitest';
import { stripStrictNulls, validate } from '../tools/validate';
import { askJson, ModelOutputError } from '../coach/modelJson';
import { settleJob } from '../coach/markers';
import type { ChatModel, ChatResult } from '../providers/types';
import type { CoachBus } from '../coach/tools';

describe('validate: only own properties count', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  it('rejects inherited names (constructor, toString, __proto__) as extra properties', () => {
    expect(validate(schema, { a: 'x', constructor: 'evil' }).ok).toBe(false);
    expect(validate(schema, JSON.parse('{"a":"x","__proto__":{"b":1}}')).ok).toBe(false);
  });
  it('does not treat an inherited name as present for required', () => {
    expect(validate({ type: 'object', required: ['toString'] }, {}).ok).toBe(false);
  });
  it('stripStrictNulls keeps an own __proto__ key as data, not as the prototype', () => {
    const out = stripStrictNulls(schema, JSON.parse('{"a":"x","__proto__":{"b":1}}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('askJson', () => {
  it('refuses a reply cut off at the token limit instead of returning an inner object', async () => {
    const res: ChatResult = {
      message: { role: 'assistant', parts: [{ type: 'text', text: '{"saw":"x","components":[{"name":"rice","grams":100},{"name":"da' }] },
      usage: null,
      stopReason: 'length',
    };
    const model = { complete: async () => res } as unknown as ChatModel;
    await expect(askJson(model, { system: 's', user: [{ type: 'text', text: 'u' }], schemaName: 'n', schema: { type: 'object' } })).rejects.toBeInstanceOf(ModelOutputError);
  });
});

describe('settleJob', () => {
  it('returns at once when the signal is already aborted, and survives a failing status call', async () => {
    const bus = {
      on: () => () => undefined,
      dispatch: async () => {
        throw new Error('bus down');
      },
    } as unknown as CoachBus;
    const ac = new AbortController();
    ac.abort();
    const r = await Promise.race([settleJob(bus, 'j1', { kind: 'ai', id: 'x' }, ac.signal), new Promise((res) => setTimeout(() => res('hung'), 300))]);
    expect(r).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });
});
