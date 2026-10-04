/**
 * A small TypeBox-compatible schema builder (tier P). Every builder returns a plain JSON Schema (draft 2020-12) object
 * that carries its TypeScript type as a phantom, so `Static<typeof S>` is the input/output type of a command.
 *
 * Why not TypeBox itself: the package is not installed and the app ships no new runtime dependency for this; the API
 * mirrors TypeBox (`T.Object`, `T.Optional`, `Static`, `Value.Check`) so swapping it in later is mechanical
 * (SUITE_SPEC §1.2). Only interpreter-style validation is used (no code generation: CSP blocks `new Function`).
 *
 * Objects default to `additionalProperties: false` (SUITE_SPEC §1.2).
 */

declare const STATIC: unique symbol;
declare const OPTIONAL_TYPE: unique symbol;

/** Runtime marker of an optional property (a symbol, so it never reaches JSON). */
export const OPTIONAL = Symbol.for('vitals.schema.optional');

export interface JsonSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
  title?: string;
  description?: string;
  enum?: readonly unknown[];
  const?: unknown;
  anyOf?: readonly JsonSchema[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | false;
  prefixItems?: readonly JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'date' | 'date-time';
  minProperties?: number;
  maxProperties?: number;
  examples?: readonly unknown[];
  default?: unknown;
}

/** A schema whose validated value has type `T`. */
export interface TSchema<T = unknown> extends JsonSchema {
  readonly [STATIC]?: T;
}
/** A property schema that may be absent. */
export type TOptional<S extends TSchema> = S & { readonly [OPTIONAL_TYPE]: true };

export type Static<S> = S extends TSchema<infer T> ? T : never;

type Evaluate<T> = { [K in keyof T]: T[K] } & {};
type OptionalKeys<P> = { [K in keyof P]: P[K] extends { readonly [OPTIONAL_TYPE]: true } ? K : never }[keyof P];
type RequiredKeys<P> = Exclude<keyof P, OptionalKeys<P>>;
export type ObjectStatic<P extends Record<string, TSchema>> = Evaluate<
  { [K in RequiredKeys<P>]: Static<P[K]> } & { [K in OptionalKeys<P>]?: Static<P[K]> }
>;

type Options = Omit<JsonSchema, 'type' | 'properties' | 'required' | 'items' | 'anyOf' | 'const' | 'enum'>;

const isOptional = (s: JsonSchema): boolean => (s as Record<symbol, unknown>)[OPTIONAL] === true;

function stripOptional(s: JsonSchema): JsonSchema {
  if (!isOptional(s)) return s;
  const out: Record<string | symbol, unknown> = { ...s };
  delete out[OPTIONAL];
  return out as JsonSchema;
}

export const T = {
  String<S extends string = string>(opts: Options = {}): TSchema<S> {
    return { type: 'string', ...opts };
  },
  /** 'YYYY-MM-DD'. */
  Date(opts: Options = {}): TSchema<string> {
    return { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', ...opts };
  },
  /** ISO-8601 instant. */
  Instant(opts: Options = {}): TSchema<string> {
    return { type: 'string', format: 'date-time', ...opts };
  },
  Number(opts: Options = {}): TSchema<number> {
    return { type: 'number', ...opts };
  },
  Integer(opts: Options = {}): TSchema<number> {
    return { type: 'integer', ...opts };
  },
  Boolean(opts: Options = {}): TSchema<boolean> {
    return { type: 'boolean', ...opts };
  },
  Null(opts: Options = {}): TSchema<null> {
    return { type: 'null', ...opts };
  },
  Literal<const L extends string | number | boolean>(value: L, opts: Options = {}): TSchema<L> {
    const type = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : 'number';
    return { type, const: value, ...opts };
  },
  /** String enum (`{ type: 'string', enum }`): compact, and what every tool format accepts. */
  Enum<const L extends readonly string[]>(values: L, opts: Options = {}): TSchema<L[number]> {
    return { type: 'string', enum: values, ...opts };
  },
  /** Numeric enum. */
  NumberEnum<const L extends readonly number[]>(values: L, opts: Options = {}): TSchema<L[number]> {
    return { type: 'number', enum: values, ...opts };
  },
  Union<const S extends readonly TSchema[]>(schemas: S, opts: Options = {}): TSchema<Static<S[number]>> {
    return { anyOf: schemas.map(stripOptional), ...opts };
  },
  Nullable<S extends TSchema>(schema: S, opts: Options = {}): TSchema<Static<S> | null> {
    return { anyOf: [stripOptional(schema), { type: 'null' }], ...opts };
  },
  Optional<S extends TSchema>(schema: S): TOptional<S> {
    return { ...schema, [OPTIONAL]: true } as unknown as TOptional<S>;
  },
  Array<S extends TSchema>(items: S, opts: Options = {}): TSchema<Array<Static<S>>> {
    return { type: 'array', items: stripOptional(items), ...opts };
  },
  Tuple<const S extends readonly TSchema[]>(items: S, opts: Options = {}): TSchema<{ [K in keyof S]: Static<S[K]> }> {
    return { type: 'array', prefixItems: items.map(stripOptional), items: false, minItems: items.length, maxItems: items.length, ...opts };
  },
  Object<P extends Record<string, TSchema>>(properties: P, opts: Options = {}): TSchema<ObjectStatic<P>> {
    const props: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [k, s] of Object.entries(properties)) {
      props[k] = stripOptional(s);
      if (!isOptional(s)) required.push(k);
    }
    return { type: 'object', properties: props, required, additionalProperties: false, ...opts };
  },
  /** An object whose keys are free and whose values follow `value`. */
  Record<S extends TSchema>(value: S, opts: Options = {}): TSchema<Record<string, Static<S>>> {
    return { type: 'object', additionalProperties: stripOptional(value), ...opts };
  },
  /** An open object: fields owned by another package, checked by that package's sanitiser (documented per use). */
  OpenObject(opts: Options = {}): TSchema<Record<string, unknown>> {
    return { type: 'object', additionalProperties: true, ...opts };
  },
  Unknown(opts: Options = {}): TSchema<unknown> {
    return { ...opts };
  },
  /** Typed alias of a schema (narrow `Static` without changing the JSON). */
  As<V>(schema: TSchema): TSchema<V> {
    return schema as TSchema<V>;
  },
} as const;

export const EMPTY_INPUT = T.Object({});
export type Empty = Static<typeof EMPTY_INPUT>;
