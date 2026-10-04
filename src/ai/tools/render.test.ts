// @vitest-environment node
/**
 * Tool renderers (SUITE_SPEC §1.8) over the one strict projection (`src/commands/adapters/strict.ts`): optional `T`
 * becomes `anyOf [T, null]`, every object is closed, rejected keywords are stripped; a schema strict mode cannot
 * express (free-key object, optional nullable, unconstrained value) makes that tool non-strict.
 */
import { describe, expect, it } from 'vitest';
import type { ToolSpec } from '../providers/types';
import { fromStrictInput, strictProjection, toAnthropicTools, toOpenAIChatTools, toOpenAIResponsesTools, tryStrict } from './render';

const schema = {
  type: 'object',
  properties: {
    metric: { type: 'string', enum: ['weight', 'waist'] },
    value: { type: 'number', minimum: 0, maximum: 500 },
    unit: { type: 'string', enum: ['kg', 'cm'] },
    date: { type: 'string', pattern: '^\\d{4}$', format: 'date', default: 'today' },
    tags: { type: 'array', items: { type: 'object', properties: { t: { type: 'string', maxLength: 9 } } }, minItems: 1 },
    nested: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'string' } }, required: ['a'], additionalProperties: false },
    choice: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
  },
  required: ['metric', 'value'],
  additionalProperties: false,
};
const spec: ToolSpec = { name: 'log_measurement', description: 'Log a measurement.', inputSchema: schema };
const orNull = (t: unknown) => ({ anyOf: [t, { type: 'null' }] });

describe('strictProjection', () => {
  const p = strictProjection(schema);
  const props = p.properties as Record<string, Record<string, unknown>>;

  it('is strict for an expressible schema', () => {
    expect(tryStrict(schema).strict).toBe(true);
  });

  it('makes every property required and closes objects', () => {
    expect(p.required).toEqual(Object.keys(schema.properties));
    expect(p.additionalProperties).toBe(false);
    const nested = (props.nested!.anyOf as Record<string, unknown>[])[0]!;
    expect(nested.required).toEqual(['a', 'b']);
    expect(nested.additionalProperties).toBe(false);
  });

  it('turns optional properties into anyOf [T, null] and leaves required ones', () => {
    expect(props.metric).toEqual({ type: 'string', enum: ['weight', 'waist'] });
    expect(props.unit).toEqual(orNull({ type: 'string', enum: ['kg', 'cm'] }));
    expect(props.choice).toEqual(orNull({ anyOf: [{ type: 'string' }, { type: 'integer' }] }));
    const nested = (props.nested!.anyOf as Record<string, unknown>[])[0]!;
    expect((nested.properties as Record<string, unknown>).a).toEqual({ type: 'integer' });
    expect((nested.properties as Record<string, unknown>).b).toEqual(orNull({ type: 'string' }));
  });

  it('strips keywords strict mode rejects, recursively', () => {
    expect(props.value).toEqual({ type: 'number' });
    expect(props.date).toEqual(orNull({ type: 'string' }));
    const tags = (props.tags!.anyOf as Record<string, unknown>[])[0]!;
    expect(tags).not.toHaveProperty('minItems');
    const item = tags.items as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    expect((item.properties as Record<string, unknown>).t).toEqual(orNull({ type: 'string' }));
  });

  it('does not mutate the input', () => {
    expect(schema.required).toEqual(['metric', 'value']);
    expect(schema.properties.value).toEqual({ type: 'number', minimum: 0, maximum: 500 });
  });

  it.each([
    ['a free-key object', { type: 'object', properties: { m: { type: 'object', additionalProperties: { type: 'number' } } }, required: ['m'] }],
    ['an open object', { type: 'object', properties: { m: { type: 'object' } }, required: ['m'] }],
    ['an optional nullable property', { type: 'object', properties: { note: { type: ['string', 'null'] } } }],
    ['an unconstrained value', { type: 'object', properties: { v: {} }, required: ['v'] }],
  ])('goes out non-strict (schema unchanged) for %s', (_, s) => {
    const r = tryStrict(s);
    expect(r.strict).toBe(false);
    expect(r.schema).toBe(s);
  });

  it('maps strict input back: null for an optional field means absent', () => {
    expect(fromStrictInput({ metric: 'weight', value: 80, unit: null, nested: { a: 1, b: null } }, schema)).toEqual({ metric: 'weight', value: 80, nested: { a: 1 } });
  });
});

describe('renderers', () => {
  const free: ToolSpec = { name: 'set_map', description: 'Free keys.', inputSchema: { type: 'object', properties: { m: { type: 'object', additionalProperties: { type: 'number' } } }, required: ['m'] } };

  it('openai chat: function wrapper, strict flag only when strict', () => {
    const [loose] = toOpenAIChatTools([spec]);
    expect(loose).toEqual({ type: 'function', function: { name: 'log_measurement', description: 'Log a measurement.', parameters: schema } });
    const [strict, nonStrict] = toOpenAIChatTools([spec, free], { strict: true });
    expect(strict!.function.strict).toBe(true);
    expect(strict!.function.parameters).toEqual(strictProjection(schema));
    expect(nonStrict!.function).not.toHaveProperty('strict');
    expect(nonStrict!.function.parameters).toBe(free.inputSchema);
  });

  it('openai responses: flat functions (non-strict by default) or one namespace wrapper', () => {
    const flat = toOpenAIResponsesTools([spec, free], { strict: true });
    expect(flat).toEqual([
      { type: 'function', name: 'log_measurement', description: 'Log a measurement.', parameters: strictProjection(schema), strict: true },
      { type: 'function', name: 'set_map', description: 'Free keys.', parameters: free.inputSchema, strict: false },
    ]);
    const wrapped = toOpenAIResponsesTools([spec, { ...spec, name: 'other' }], { namespace: 'vitals' });
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]).toMatchObject({ type: 'namespace', name: 'vitals', description: expect.stringMatching(/^Vitals: /) });
    expect((wrapped[0] as { tools: { name: string; strict: boolean }[] }).tools.map((t) => [t.name, t.strict])).toEqual([['log_measurement', false], ['other', false]]);
  });

  it('anthropic: name, description, input_schema', () => {
    expect(toAnthropicTools([spec])).toEqual([{ name: 'log_measurement', description: 'Log a measurement.', input_schema: schema }]);
    const [strict, nonStrict] = toAnthropicTools([spec, free], { strict: true });
    expect(strict).toEqual({ name: 'log_measurement', description: 'Log a measurement.', input_schema: strictProjection(schema), strict: true });
    expect(nonStrict).toEqual({ name: 'set_map', description: 'Free keys.', input_schema: free.inputSchema });
  });

  it('anthropic: a non-object input schema is wrapped as { value }', () => {
    const [t] = toAnthropicTools([{ name: 'n', description: 'd', inputSchema: { type: 'string' } }]);
    expect(t!.input_schema).toEqual({ type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false });
  });
});
