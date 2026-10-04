/**
 * Interpreter-style JSON Schema validation for the subset `T` builds (tier P; TypeBox `Value.Check` / `Value.Errors`
 * equivalents). Errors carry a JSON pointer (`/days/3`) and a plain-language message.
 */
import type { JsonSchema, Static, TSchema } from './types';

export interface ValueError {
  /** JSON pointer of the offending value ('' = the root). */
  path: string;
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const regexCache = new Map<string, RegExp>();
const regex = (p: string): RegExp => {
  let r = regexCache.get(p);
  if (!r) {
    r = new RegExp(p, 'u');
    regexCache.set(p, r);
  }
  return r;
};

const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function typeOk(type: NonNullable<JsonSchema['type']>, v: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    case 'object':
      return isObj(v);
    case 'array':
      return Array.isArray(v);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function walk(s: JsonSchema, v: unknown, path: string, out: ValueError[], limit: number): void {
  if (out.length >= limit) return;
  if (s.anyOf) {
    for (const alt of s.anyOf) {
      const sub: ValueError[] = [];
      walk(alt, v, path, sub, 1);
      if (sub.length === 0) return;
    }
    out.push({ path, message: 'matches none of the allowed shapes' });
    return;
  }
  if (s.type && !typeOk(s.type, v)) {
    out.push({ path, message: `expected ${s.type}` });
    return;
  }
  if ('const' in s && s.const !== undefined && !deepEqual(s.const, v)) {
    out.push({ path, message: `expected ${JSON.stringify(s.const)}` });
    return;
  }
  if (s.enum && !s.enum.some((e) => deepEqual(e, v))) {
    out.push({ path, message: `expected one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}` });
    return;
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) out.push({ path, message: `shorter than ${s.minLength}` });
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push({ path, message: `longer than ${s.maxLength}` });
    if (s.pattern !== undefined && !regex(s.pattern).test(v)) out.push({ path, message: 'has the wrong format' });
    if (s.format === 'date' && !DATE.test(v)) out.push({ path, message: 'expected a date (YYYY-MM-DD)' });
    if (s.format === 'date-time' && !DATE_TIME.test(v)) out.push({ path, message: 'expected an ISO date-time' });
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push({ path, message: `below ${s.minimum}` });
    if (s.maximum !== undefined && v > s.maximum) out.push({ path, message: `above ${s.maximum}` });
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) out.push({ path, message: `not above ${s.exclusiveMinimum}` });
    if (s.exclusiveMaximum !== undefined && v >= s.exclusiveMaximum) out.push({ path, message: `not below ${s.exclusiveMaximum}` });
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push({ path, message: `fewer than ${s.minItems} items` });
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push({ path, message: `more than ${s.maxItems} items` });
    const prefix = s.prefixItems ?? [];
    v.forEach((item, i) => {
      const sub = i < prefix.length ? prefix[i] : s.items;
      if (sub === false) {
        if (i >= prefix.length) out.push({ path: `${path}/${i}`, message: 'unexpected item' });
        return;
      }
      if (sub) walk(sub, item, `${path}/${i}`, out, limit);
    });
  }
  if (isObj(v)) {
    const props = s.properties ?? {};
    for (const k of s.required ?? []) if (v[k] === undefined) out.push({ path: `${path}/${esc(k)}`, message: 'is required' });
    const keys = Object.keys(v);
    if (s.minProperties !== undefined && keys.length < s.minProperties) out.push({ path, message: `fewer than ${s.minProperties} fields` });
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) out.push({ path, message: `more than ${s.maxProperties} fields` });
    for (const k of keys) {
      const val = v[k];
      if (val === undefined) continue; // absent (JSON has no undefined)
      const p = props[k];
      if (p) walk(p, val, `${path}/${esc(k)}`, out, limit);
      else if (s.additionalProperties === false) out.push({ path: `${path}/${esc(k)}`, message: 'is not an allowed field' });
      else if (typeof s.additionalProperties === 'object') walk(s.additionalProperties, val, `${path}/${esc(k)}`, out, limit);
    }
  }
}

export const Value = {
  /** All errors (up to `limit`). */
  Errors(schema: JsonSchema, value: unknown, limit = 20): ValueError[] {
    const out: ValueError[] = [];
    walk(schema, value, '', out, limit);
    return out;
  },
  Check<S extends TSchema>(schema: S, value: unknown): value is Static<S> {
    return Value.Errors(schema, value, 1).length === 0;
  },
  Equal: deepEqual,
};
