// @vitest-environment node
/** JSON Schema subset validator (R8 §3.4 step 3). */
import { describe, expect, it } from 'vitest';
import { formatErrors, stripStrictNulls, validate } from './validate';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 5 },
    count: { type: 'integer', minimum: 1, maximum: 10 },
    ratio: { type: 'number', exclusiveMinimum: 0 },
    unit: { type: 'string', enum: ['kg', 'lb'] },
    kind: { const: 'meal' },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
    note: { type: ['string', 'null'] },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    'a/b': { type: 'boolean' },
    nested: {
      type: 'object',
      properties: { grams: { type: 'number', maximum: 100 } },
      required: ['grams'],
      additionalProperties: false,
    },
    either: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] },
  },
  required: ['name'],
  additionalProperties: false,
};

const errorsOf = (v: unknown) => {
  const r = validate(schema, v);
  return r.ok ? [] : r.errors;
};

describe('validate', () => {
  it('accepts a valid value', () => {
    expect(validate(schema, { name: 'rice', count: 3, ratio: 0.5, unit: 'kg', kind: 'meal', tags: ['a'], note: null, date: '2026-10-01', nested: { grams: 5 }, either: 4 })).toEqual({ ok: true });
  });

  it('reports types including integer and null', () => {
    expect(errorsOf({ name: 'x', count: 1.5 })).toEqual([{ path: '/count', message: '/count: must be integer (got number)' }]);
    expect(errorsOf({ name: 'x', note: 3 })[0]!.message).toContain('must be string or null');
    expect(errorsOf(null)[0]!.message).toBe('input: must be object (got null)');
    expect(errorsOf({ name: 'x', tags: 'a' })[0]!.message).toContain('must be array (got string)');
  });

  it('reports required and additional properties with JSON pointers', () => {
    const errs = errorsOf({ extra: 1, 'a/b': true });
    expect(errs.map((e) => e.path).sort()).toEqual(['/extra', '/name']);
    expect(errs.find((e) => e.path === '/name')!.message).toBe('/name: is required');
    expect(errs.find((e) => e.path === '/extra')!.message).toContain('is not allowed');
    expect(errorsOf({ name: 'x', 'a/b': 1 })[0]!.path).toBe('/a~1b');
  });

  it('checks enum, const, bounds, lengths, items, pattern', () => {
    expect(errorsOf({ name: 'x', unit: 'stone' })[0]!.message).toBe('/unit: must be one of "kg", "lb" (got "stone")');
    expect(errorsOf({ name: 'x', kind: 'fast' })[0]!.message).toContain('must be exactly "meal"');
    expect(errorsOf({ name: 'x', count: 0 })[0]!.message).toContain('at least 1');
    expect(errorsOf({ name: 'x', count: 11 })[0]!.message).toContain('at most 10');
    expect(errorsOf({ name: 'x', ratio: 0 })[0]!.message).toContain('greater than 0');
    expect(errorsOf({ name: '' })[0]!.message).toContain('at least 1 characters');
    expect(errorsOf({ name: 'toolong' })[0]!.message).toContain('at most 5 characters');
    expect(errorsOf({ name: 'x', tags: [] })[0]!.message).toContain('at least 1 items');
    expect(errorsOf({ name: 'x', tags: ['a', 'b', 'c'] })[0]!.message).toContain('at most 2 items');
    expect(errorsOf({ name: 'x', tags: ['a', 2] })[0]!.path).toBe('/tags/1');
    expect(errorsOf({ name: 'x', date: '1 Oct' })[0]!.message).toContain('pattern');
  });

  it('validates nested objects and anyOf', () => {
    expect(errorsOf({ name: 'x', nested: {} })[0]!.path).toBe('/nested/grams');
    expect(errorsOf({ name: 'x', nested: { grams: 200, y: 1 } }).map((e) => e.path).sort()).toEqual(['/nested/grams', '/nested/y']);
    expect(errorsOf({ name: 'x', either: 'a' })).toEqual([]);
    const e = errorsOf({ name: 'x', either: -1 });
    expect(e).toHaveLength(1);
    expect(e[0]!.message).toContain('does not match any allowed shape');
  });

  it('accepts integers for number and rejects NaN', () => {
    expect(validate({ type: 'number' }, 3)).toEqual({ ok: true });
    expect(validate({ type: 'number' }, Number.NaN).ok).toBe(false);
  });

  it('formats errors as lines', () => {
    expect(formatErrors([{ path: '/a', message: '/a: is required' }, { path: '/b', message: '/b: bad' }])).toBe('- /a: is required\n- /b: bad');
  });
});

describe('stripStrictNulls', () => {
  it('drops null for optional non-nullable properties only, recursively', () => {
    const out = stripStrictNulls(schema, { name: 'x', count: null, note: null, tags: null, nested: { grams: 1 } });
    expect(out).toEqual({ name: 'x', note: null, nested: { grams: 1 } });
    expect(validate(schema, out)).toEqual({ ok: true });
    const arr = stripStrictNulls(
      { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } },
      [{ a: null }, { a: 'x' }],
    );
    expect(arr).toEqual([{}, { a: 'x' }]);
  });

  it('keeps null for required properties so validation reports it', () => {
    const out = stripStrictNulls(schema, { name: null });
    expect(errorsOf(out)[0]!.message).toContain('must be string (got null)');
  });
});
