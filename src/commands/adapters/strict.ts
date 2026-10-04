/**
 * Strict projection of a tool's input schema (SUITE_SPEC §1.8), the one implementation every renderer uses: the OpenAI
 * and Anthropic adapters here and the Coach's `src/ai/tools/render.ts` (which re-exports this module).
 *
 * Strict mode (OpenAI `strict: true`, Anthropic `strict: true`): every property listed in `required`, an optional `T`
 * becomes `T | null`, `additionalProperties: false` on every object, keywords some strict modes reject are stripped.
 * The dispatcher re-validates the original schema, so stripping only loosens the model-side hint.
 *
 * Some schemas cannot be expressed that way, and then the tool goes out non-strict instead (`tryStrict`):
 * - free-key objects (`T.Record`, open objects): strict mode would close them and the model could send no key at all;
 * - optional properties that already accept `null` (merge patches, where `null` means "clear"): strict mode sends
 *   `null` for "absent", which would read as "clear";
 * - unconstrained values (`T.Unknown()`).
 *
 * Pure functions (shared by `src/commands` and `src/ai`). Inputs are any JSON Schema object (`src/commands/schema`'s
 * `JsonSchema` or `src/ai`'s); outputs fit both.
 */
import type { JsonSchema } from '../schema';

/** A JSON Schema both type systems accept: E4's `JsonSchema` that is also a plain record (the Coach's `JsonSchema`). */
export type StrictSchema = JsonSchema & { [key: string]: unknown };
/** Any schema object. */
export type SchemaLike = object;
type Schema = Record<string, unknown>;

/** Keywords removed in the strict projection (the union of what OpenAI and Anthropic strict modes reject). */
export const STRICT_STRIP: ReadonlySet<string> = new Set([
  '$schema',
  '$id',
  'title',
  'default',
  'examples',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

export class NotStrict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotStrict';
  }
}

const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);
const schemas = (v: unknown): Schema[] => (Array.isArray(v) ? v.filter(isObj) : []);

function hasType(s: Schema, t: string): boolean {
  return s.type === t || (Array.isArray(s.type) && s.type.includes(t));
}

/** Whether a schema already accepts `null` (type, enum or a branch). */
export function acceptsNull(s: SchemaLike | undefined): boolean {
  if (!s) return false;
  const o = s as Schema;
  if (hasType(o, 'null')) return true;
  if (Array.isArray(o.enum) && o.enum.includes(null)) return true;
  return [...schemas(o.anyOf), ...schemas(o.oneOf)].some((b) => acceptsNull(b));
}

/** Strict projection of `s`; throws `NotStrict` when strict mode cannot express it. Never mutates `s`. */
export function strictSchema(s: SchemaLike, optional = false): StrictSchema {
  const src = s as Schema;
  if (Object.keys(src).length === 0) throw new NotStrict('unconstrained value');
  const out: Schema = {};
  for (const [k, v] of Object.entries(src)) if (!STRICT_STRIP.has(k)) out[k] = v;
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(src[key])) out[key] = schemas(src[key]).map((x) => strictSchema(x));
  }
  if (hasType(src, 'object') || isObj(src.properties)) {
    if (src.additionalProperties !== false && src.additionalProperties !== undefined) throw new NotStrict('free-key object');
    if (!isObj(src.properties)) throw new NotStrict('object without properties');
    const required = new Set(Array.isArray(src.required) ? (src.required as string[]) : []);
    const props: Schema = {};
    for (const [k, v] of Object.entries(src.properties)) {
      if (!isObj(v)) throw new NotStrict(`property "${k}" has no schema`);
      if (!required.has(k) && acceptsNull(v)) throw new NotStrict(`optional nullable property "${k}"`);
      props[k] = strictSchema(v, !required.has(k));
    }
    out.properties = props;
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  if (Array.isArray(src.prefixItems)) {
    // tuples: an array of the union of the item types (strict modes have no prefixItems)
    const items = schemas(src.prefixItems);
    delete out.prefixItems;
    out.items = items.length === 1 ? strictSchema(items[0]!) : { anyOf: items.map((x) => strictSchema(x)) };
  } else if (isObj(src.items)) out.items = strictSchema(src.items);
  return (optional ? { anyOf: [out, { type: 'null' }] } : out) as StrictSchema;
}

/** The strict projection when expressible, else the schema unchanged with `strict: false`. */
export function tryStrict(s: SchemaLike): { schema: StrictSchema; strict: boolean } {
  try {
    return { schema: strictSchema(s), strict: true };
  } catch (e) {
    if (e instanceof NotStrict) return { schema: s as StrictSchema, strict: false };
    throw e;
  }
}

/** `tryStrict(s).schema`: the schema a strict-mode tool carries (the original when strict mode cannot express it). */
export function strictProjection(s: SchemaLike): StrictSchema {
  return tryStrict(s).schema;
}

/** Strict-projected input back to the original shape: `null` for an optional field means "absent". */
export function fromStrictInput(value: unknown, original: SchemaLike): unknown {
  if (value === null || typeof value !== 'object') return value;
  const o = original as Schema;
  const alts = schemas(o.anyOf);
  if (alts.length) {
    const alt = alts.find((a) => (Array.isArray(value) ? hasType(a, 'array') : hasType(a, 'object') || isObj(a.properties))) ?? alts[0]!;
    return fromStrictInput(value, alt);
  }
  if (Array.isArray(value)) {
    const prefix = schemas(o.prefixItems);
    return value.map((x, i) => {
      const item = prefix[i] ?? (isObj(o.items) ? o.items : null);
      return item ? fromStrictInput(x, item) : x;
    });
  }
  if (!isObj(o.properties)) return value;
  const props = o.properties;
  const required = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
  const out: Schema = {};
  for (const [k, v] of Object.entries(value as Schema)) {
    if (v === null && !required.has(k)) continue;
    out[k] = isObj(props[k]) ? fromStrictInput(v, props[k]) : v;
  }
  return out;
}
