/** JSON helpers shared by the store, the bridge and command executors (pure). */
import type { JsonPatchOp } from './types';

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const kb = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** Deep copy through JSON semantics (drops undefined, functions; typed arrays become plain objects). */
export function jsonClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** RFC 7396: apply a merge patch. Arrays and scalars replace; null deletes. Never mutates its inputs. */
export function applyMergePatch<T>(target: T, patch: unknown): T {
  if (!isPlainObject(patch)) return patch as T;
  const base: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__') continue; // would swap the prototype instead of storing a field
    if (v === null) delete base[k];
    else if (v === undefined) continue;
    else base[k] = isPlainObject(v) ? applyMergePatch(base[k], v) : v;
  }
  return base as T;
}

/**
 * RFC 7396: the merge patch that turns `a` into `b` (objects recurse; arrays and scalars replace; removed keys → null).
 * Returns `undefined` when they are equal.
 */
export function diffMergePatch(a: unknown, b: unknown): unknown {
  if (deepEqual(a, b)) return undefined;
  if (!isPlainObject(a) || !isPlainObject(b)) return b === undefined ? null : b;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(a)) if (a[k] !== undefined && (b[k] === undefined || !(k in b))) out[k] = null;
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    const d = diffMergePatch(a[k], v);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

const ptr = (k: string) => `/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
const unptr = (p: string) => p.slice(1).replace(/~1/g, '/').replace(/~0/g, '~');

/** Top-level-field RFC 6902 patch from `from` to `to` (LWW-F granularity). */
export function fieldPatch(from: Record<string, unknown>, to: Record<string, unknown>): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  for (const k of Object.keys(from)) if (from[k] !== undefined && to[k] === undefined) ops.push({ op: 'remove', path: ptr(k) });
  for (const [k, v] of Object.entries(to)) {
    if (v === undefined) continue;
    if (from[k] === undefined) ops.push({ op: 'add', path: ptr(k), value: jsonClone(v) });
    else if (!deepEqual(from[k], v)) ops.push({ op: 'replace', path: ptr(k), value: jsonClone(v) });
  }
  return ops;
}

/** Apply a top-level-field patch (paths of depth 1). */
export function applyFieldPatch(doc: Record<string, unknown>, ops: readonly JsonPatchOp[]): Record<string, unknown> {
  const out = { ...doc };
  for (const op of ops) {
    const k = unptr(op.path);
    if (op.op === 'remove') delete out[k];
    else out[k] = jsonClone(op.value);
  }
  return out;
}

/** Field name of a depth-1 pointer. */
export const fieldOf = (path: string): string => unptr(path);

/** Approximate stored size (UTF-16 code units × 2), for `estimate()`. */
export function jsonBytes(v: unknown): number {
  try {
    return JSON.stringify(v).length * 2;
  } catch {
    return 0;
  }
}
