/**
 * Small JSON Schema validator for the subset tool schemas use (R8 §3.4 step 3): `type` (incl. arrays, `integer`,
 * `null`), `properties`, `required`, `additionalProperties: false` (or a schema), `enum`, `const`, `items`,
 * `minimum`/`maximum`, `exclusiveMinimum`/`exclusiveMaximum`, `minLength`/`maxLength`, `pattern`,
 * `minItems`/`maxItems`, `anyOf`/`oneOf`. Unknown keywords are ignored. Interpretive only: no code generation
 * (`new Function` is blocked by the CSP).
 *
 * Messages are written for the model to read and correct its call.
 */
import type { JsonSchema } from '../providers/types';

export interface ValidationError {
  /** JSON pointer to the offending value ('' = the whole input). */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

const MAX_ERRORS = 20;

function pointer(base: string, key: string | number): string {
  return `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return true;
  }
}

function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function check(schema: JsonSchema, v: unknown, path: string, errs: ValidationError[]): void {
  if (errs.length >= MAX_ERRORS) return;
  const where = path || 'input';
  const push = (message: string, at = path) => errs.push({ path: at, message: `${at || 'input'}: ${message}` });

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => matchesType(v, t))) {
      push(`must be ${types.join(' or ')} (got ${typeOf(v)})`);
      return;
    }
  }
  if ('const' in schema && !deepEqual(v, schema.const)) push(`must be exactly ${show(schema.const)} (got ${show(v)})`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, v))) {
    push(`must be one of ${schema.enum.map(show).join(', ')} (got ${show(v)})`);
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key];
    if (!Array.isArray(branches)) continue;
    let best: ValidationError[] | null = null;
    let matched = 0;
    for (const b of branches as JsonSchema[]) {
      const sub: ValidationError[] = [];
      check(b, v, path, sub);
      if (sub.length === 0) {
        matched++;
        if (key === 'anyOf' || matched > 1) break; // oneOf: exactly one branch may match
        continue;
      }
      if (!best || sub.length < best.length) best = sub;
    }
    if (matched === 0 && best) push(`does not match any allowed shape; closest: ${best[0]!.message}`);
    else if (key === 'oneOf' && matched > 1) push('matches more than one allowed shape');
  }

  if (typeof v === 'number') {
    if (typeof schema.minimum === 'number' && v < schema.minimum) push(`must be at least ${schema.minimum} (got ${v})`);
    if (typeof schema.maximum === 'number' && v > schema.maximum) push(`must be at most ${schema.maximum} (got ${v})`);
    if (typeof schema.exclusiveMinimum === 'number' && v <= schema.exclusiveMinimum) push(`must be greater than ${schema.exclusiveMinimum} (got ${v})`);
    if (typeof schema.exclusiveMaximum === 'number' && v >= schema.exclusiveMaximum) push(`must be less than ${schema.exclusiveMaximum} (got ${v})`);
  }

  if (typeof v === 'string') {
    const len = [...v].length;
    if (typeof schema.minLength === 'number' && len < schema.minLength) push(`must be at least ${schema.minLength} characters (got ${len})`);
    if (typeof schema.maxLength === 'number' && len > schema.maxLength) push(`must be at most ${schema.maxLength} characters (got ${len})`);
    if (typeof schema.pattern === 'string') {
      let re: RegExp | null;
      try { re = new RegExp(schema.pattern, 'u'); } catch { re = null; }
      if (re && !re.test(v)) push(`must match the pattern ${schema.pattern} (got ${show(v)})`);
    }
  }

  if (Array.isArray(v)) {
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) push(`must have at least ${schema.minItems} items (got ${v.length})`);
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) push(`must have at most ${schema.maxItems} items (got ${v.length})`);
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      v.forEach((item, i) => check(schema.items as JsonSchema, item, pointer(path, i), errs));
    }
  }

  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    if (Array.isArray(schema.required)) {
      for (const r of schema.required as string[]) if (!Object.hasOwn(obj, r) || obj[r] === undefined) push('is required', pointer(path, r));
    }
    for (const [k, val] of Object.entries(obj)) {
      if (val === undefined) continue;
      // own keys only: `constructor`, `toString` or a parsed `__proto__` are not declared properties
      const sub = Object.hasOwn(props, k) ? props[k] : undefined;
      if (sub) check(sub, val, pointer(path, k), errs);
      else if (schema.additionalProperties === false) {
        const allowed = Object.keys(props);
        push(`is not allowed${allowed.length ? ` (allowed in ${where}: ${allowed.join(', ')})` : ''}`, pointer(path, k));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        check(schema.additionalProperties as JsonSchema, val, pointer(path, k), errs);
      }
    }
  }
}

export function validate(schema: JsonSchema, value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  check(schema, value, '', errors);
  return errors.length ? { ok: false, errors: errors.slice(0, MAX_ERRORS) } : { ok: true };
}

/** One line per error, for a tool result the model reads. */
export function formatErrors(errors: readonly ValidationError[]): string {
  return errors.map((e) => `- ${e.message}`).join('\n');
}

function allowsNull(schema: JsonSchema): boolean {
  const t = schema.type;
  if (t === 'null' || (Array.isArray(t) && t.includes('null'))) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[key]) && (schema[key] as JsonSchema[]).some(allowsNull)) return true;
  }
  return false;
}

/**
 * Undo the strict projection on the way back: strict models send `null` for optional properties they leave out
 * (render.ts makes optionals `T | null`). Drops such `null`s where the original schema has the property optional and
 * not nullable, recursively, so the original schema validates. Returns a new value; the input is not mutated.
 */
export function stripStrictNulls(schema: JsonSchema, value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  // unions (discriminated ops): the first branch the stripped value satisfies
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key];
    if (!Array.isArray(branches)) continue;
    for (const b of branches as JsonSchema[]) {
      const stripped = stripStrictNulls(b, value);
      if (validate(b, stripped).ok) return stripped;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as JsonSchema[]) : [];
    const items = schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items) ? (schema.items as JsonSchema) : null;
    return value.map((v, i) => {
      const sub = prefix[i] ?? items;
      return sub ? stripStrictNulls(sub, v) : v;
    });
  }
  const props = schema.properties as Record<string, JsonSchema> | undefined;
  if (!props) return value;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const sub = Object.hasOwn(props, k) ? props[k] : undefined;
    if (k === '__proto__') {
      // kept as data (validation then rejects it where extra keys are not allowed), never as the prototype
      Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
      continue;
    }
    if (v === null && sub && !required.has(k) && !allowsNull(sub)) continue;
    out[k] = sub ? stripStrictNulls(sub, v) : v;
  }
  return out;
}
