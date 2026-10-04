/**
 * The persistence bridge: Zustand projections ⇄ the document store (SUITE_SPEC §2.1, §2.7 `bindDocs`).
 *
 *   create(guarded('profile', PERSISTED_FIELDS, persist(creator, { storage: docStorage(binding), … })))
 *   bindDocs(useProfileStore, { key: 'vitals.body', toDocs, fromDocs, … })
 *
 * - `guarded` is the strict-store guard: a persisted field may change only inside a write scope (./scope.ts).
 * - `docStorage` replaces zustand's localStorage storage. Every persisted write is diffed into document ops
 *   (`toDocs`), recorded on the active write scope (the dispatcher turns them into a ChangeSet and commits them in one
 *   document-store transaction), and mirrored synchronously into the v0.1 `vitals.*` key: that boot cache keeps the
 *   first paint synchronous (theme, onboarding gate) and doubles as the rollback copy the spec keeps for two releases.
 * - Remote changes (sync) and undo flow the other way: documents → `fromDocs` → projection, in a `sync` scope; so does
 *   the rollback of a ChangeSet whose commit failed (`restoreProjections`, `rollback` scope: boot cache rewritten, no
 *   document ops).
 */
import type { StateCreator, StoreApi } from 'zustand';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { deepEqual, isPlainObject, jsonClone, type CollectionId } from '@/store';
import { assertWritable, createScope, currentScope, runInScope, type DocOpRecord, type ScopeKind } from './scope';

/* ---------------------------------------------------------------- guard middleware */

/**
 * Strict-store guard. Wraps both the creator's `set` and `api.setState`, so actions, external `setState` calls and
 * hydration all pass through it. Updater functions are resolved once and passed on as objects.
 */
export function guarded<S extends object>(storeName: string, persistedFields: readonly (keyof S & string)[], creator: StateCreator<S, [], []>): StateCreator<S, [], []> {
  return (set, get, api) => {
    const check = (partial: unknown, replace: boolean | undefined): unknown => {
      const prev = get() as Record<string, unknown> | undefined;
      const resolved = typeof partial === 'function' ? (partial as (s: S) => unknown)(get()) : partial;
      if (prev && resolved && typeof resolved === 'object') {
        const r = resolved as Record<string, unknown>;
        const changed = persistedFields.filter((f) => (replace || f in r) && r[f] !== prev[f]);
        assertWritable(storeName, changed);
      }
      return resolved;
    };
    const guardedSet = ((partial: unknown, replace?: boolean) => {
      const resolved = check(partial, replace);
      (set as (p: unknown, r?: boolean) => void)(resolved, replace);
    }) as typeof set;
    const rawApiSet = api.setState;
    api.setState = ((partial: unknown, replace?: boolean) => {
      const resolved = check(partial, replace);
      (rawApiSet as (p: unknown, r?: boolean) => void)(resolved, replace);
    }) as typeof api.setState;
    return creator(guardedSet, get, api);
  };
}

/* ---------------------------------------------------------------- bindings */

export interface DocReader {
  /** Body without metadata, or null. */
  get(col: CollectionId, id: string): Record<string, unknown> | null;
  list(col: CollectionId): Array<{ id: string; body: Record<string, unknown> }>;
}

export interface DocWrite {
  col: CollectionId;
  id: string;
  body: Record<string, unknown>;
  /** Shared document (uiPrefs): the fields this binding owns. */
  fields?: readonly string[];
  /** Source object of the body: when identical to the last write, the document is unchanged (skips the deep compare). */
  src?: unknown;
}

export interface BindingSpec<P> {
  /** v0.1 localStorage key, kept as the boot cache and the export/import key. */
  key: string;
  version: number;
  /** Collections whose documents this binding owns entirely (ids absent from `toDocs` are removals). */
  owns: readonly CollectionId[];
  /** Collections where the binding owns only the ids with this prefix (e.g. `derived` → `sim:`). */
  ownsPrefix?: Partial<Record<CollectionId, string>>;
  /** Shared documents this binding writes some fields of (uiPrefs). */
  shares?: ReadonlyArray<{ col: CollectionId; id: string; fields: readonly string[] }>;
  toDocs(state: P): DocWrite[];
  /** Persisted state rebuilt from documents; null when the documents hold nothing for this binding. */
  fromDocs(read: DocReader): P | null;
  /** Mirror write debounce, ms (the profile autosaves at 300 ms). */
  mirrorDebounceMs?: number;
  onSaveStatus?: (s: 'saved' | 'saving' | 'unavailable') => void;
}

interface Known {
  body: Record<string, unknown>;
  src?: unknown;
  fields?: readonly string[];
  owned: boolean;
}

export interface Binding<P = unknown> extends BindingSpec<P> {
  api: StoreApi<unknown>;
  /** What the bridge believes the document store holds for this binding (keyed `col\0id`). */
  known: Map<string, Known>;
  /** Persisted state now (partialized). */
  snapshot(): P;
  /**
   * Apply a persisted state to the projection (merge rule of the store). `kind` opens a scope ('sync' never writes
   * back); 'current' runs in the caller's scope (undo inside a command records its ops there).
   */
  apply(state: P, kind?: ScopeKind | 'current'): void;
  /** Diff the current projection against `known` and record ops on the active scope (import, explicit capture). */
  capture(): DocOpRecord[];
  /** Write the pending mirror value now. */
  flushMirror(): void;
}

const bindings = new Map<string, Binding<unknown>>();
const docKey = (col: string, id: string) => `${col}\u0000${id}`;

export function getBindings(): Binding[] {
  return Array.from(bindings.values());
}
export function getBinding(key: string): Binding | undefined {
  return bindings.get(key);
}

/** Does the binding own this document entirely? */
export function ownsDoc(b: Pick<BindingSpec<unknown>, 'owns' | 'ownsPrefix'>, col: CollectionId, id: string): boolean {
  if (b.owns.includes(col)) return true;
  const prefix = b.ownsPrefix?.[col];
  return prefix !== undefined && id.startsWith(prefix);
}

/** Collections a binding reads documents from (owned, prefix-owned and shared). */
export function bindingCollections(b: Pick<BindingSpec<unknown>, 'owns' | 'ownsPrefix' | 'shares'>): CollectionId[] {
  return Array.from(new Set([...b.owns, ...(Object.keys(b.ownsPrefix ?? {}) as CollectionId[]), ...(b.shares ?? []).map((x) => x.col)]));
}

/** Bindings that own a document (by collection, or because they write fields of a shared doc). */
export function bindingsFor(col: CollectionId, id: string): Binding[] {
  return getBindings().filter((b) => ownsDoc(b, col, id) || b.known.has(docKey(col, id)) || (b.shares ?? []).some((x) => x.col === col && x.id === id));
}

/** The binding's fields of a shared document (absent and null are the same: shared fields never store null). */
function pick(body: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (body[f] !== undefined && body[f] !== null) out[f] = body[f];
  return out;
}

/* ---------------------------------------------------------------- mirror (v0.1 keys, boot cache) */

export const MIRROR_STAMP = 'at';

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readMirror(key: string): (StorageValue<unknown> & { at?: string }) | null {
  const s = ls();
  const raw = s?.getItem(key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StorageValue<unknown> & { at?: string };
    return v && typeof v === 'object' && 'state' in v ? v : null;
  } catch {
    return null;
  }
}

interface MirrorPending {
  timer: ReturnType<typeof setTimeout> | null;
  value: string | null;
}
const mirrorPending = new Map<string, MirrorPending>();

function writeMirrorNow(b: BindingSpec<unknown>, raw: string): void {
  const s = ls();
  try {
    if (!s) throw new Error('no storage');
    s.setItem(b.key, raw);
    b.onSaveStatus?.('saved');
  } catch {
    b.onSaveStatus?.('unavailable');
  }
}

function writeMirror(b: BindingSpec<unknown>, value: StorageValue<unknown>): void {
  const raw = JSON.stringify({ ...value, [MIRROR_STAMP]: new Date().toISOString() });
  if (!b.mirrorDebounceMs) return writeMirrorNow(b, raw);
  const p = mirrorPending.get(b.key) ?? { timer: null, value: null };
  p.value = raw;
  if (p.timer) clearTimeout(p.timer);
  b.onSaveStatus?.('saving');
  p.timer = setTimeout(() => flushMirror(b.key), b.mirrorDebounceMs);
  mirrorPending.set(b.key, p);
}

export function flushMirror(key: string): void {
  const p = mirrorPending.get(key);
  const b = bindings.get(key) ?? pendingSpecs.get(key);
  if (!p || !b) return;
  if (p.timer) clearTimeout(p.timer);
  p.timer = null;
  const v = p.value;
  p.value = null;
  if (v !== null) writeMirrorNow(b, v);
}

export function cancelMirror(key: string): void {
  const p = mirrorPending.get(key);
  if (!p) return;
  if (p.timer) clearTimeout(p.timer);
  p.timer = null;
  p.value = null;
}

export function flushAllMirrors(): void {
  for (const key of mirrorPending.keys()) flushMirror(key);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAllMirrors);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllMirrors();
  });
}

/* ---------------------------------------------------------------- ops */

type OpSink = (kind: ScopeKind | null, ops: DocOpRecord[]) => void;
let unscopedSink: OpSink = () => undefined;

/** The document-store writer for ops produced outside a command (system, migration, derive, production fallbacks). */
export function setUnscopedSink(sink: OpSink): void {
  unscopedSink = sink;
}

function diff(b: Binding<unknown>, state: unknown, commit: boolean): DocOpRecord[] {
  const writes = b.toDocs(state);
  const ops: DocOpRecord[] = [];
  const seen = new Set<string>();
  const nextKnown: Array<[string, Known]> = [];
  for (const w of writes) {
    const k = docKey(w.col, w.id);
    seen.add(k);
    const last = b.known.get(k);
    if (last && w.src !== undefined && last.src === w.src) continue;
    const after = w.fields ? pick(w.body, w.fields) : w.body;
    const owned = ownsDoc(b, w.col, w.id);
    if (last && deepEqual(last.body, after)) {
      if (commit) last.src = w.src;
      continue;
    }
    ops.push({ col: w.col, id: w.id, before: last ? jsonClone(last.body) : null, after: jsonClone(after), fields: w.fields, binding: b.key });
    nextKnown.push([k, { body: jsonClone(after), src: w.src, fields: w.fields, owned }]);
  }
  const removed: string[] = [];
  for (const [k, last] of b.known) {
    if (seen.has(k) || !last.owned) continue;
    const [col, id] = k.split('\u0000') as [CollectionId, string];
    ops.push({ col, id, before: jsonClone(last.body), after: null, binding: b.key });
    removed.push(k);
  }
  if (commit) {
    for (const [k, v] of nextKnown) b.known.set(k, v);
    for (const k of removed) b.known.delete(k);
  }
  return ops;
}

function route(ops: DocOpRecord[]): void {
  if (ops.length === 0) return;
  const scope = currentScope();
  if (scope?.kind === 'command' || scope?.kind === 'dryRun') scope.ops.push(...ops);
  else if (scope?.kind === 'sync' || scope?.kind === 'hydrate' || scope?.kind === 'rollback') return;
  else unscopedSink(scope?.kind ?? null, ops);
}

/** Storage for zustand `persist`: synchronous mirror reads, mirror + document writes. */
export function docStorage<P>(spec: BindingSpec<P>): PersistStorage<P> {
  pendingSpecs.set(spec.key, spec as BindingSpec<unknown>);
  return {
    getItem: (name) => readMirror(name) as StorageValue<P> | null,
    setItem: (name, value) => {
      const scope = currentScope();
      if (scope?.kind === 'dryRun') {
        const b = bindings.get(name);
        if (b) scope.ops.push(...diff(b, value.state, false));
        return;
      }
      writeMirror(spec as BindingSpec<unknown>, value as StorageValue<unknown>);
      const b = bindings.get(name);
      if (!b || scope?.kind === 'hydrate') return;
      route(diff(b, value.state, true));
    },
    removeItem: (name) => {
      cancelMirror(name);
      ls()?.removeItem(name);
    },
  };
}
const pendingSpecs = new Map<string, BindingSpec<unknown>>();

/**
 * Bind a persisted Zustand store to the documents. `partialize` and `merge` are the store's persist options (the
 * persisted subset and how a stored state merges into the live one).
 */
export function bindDocs<S, P>(
  api: StoreApi<S>,
  spec: BindingSpec<P> & { partialize: (s: S) => P; merge: (persisted: P, current: S) => S },
): Binding<P> {
  const binding: Binding<P> = {
    ...spec,
    api: api as unknown as StoreApi<unknown>,
    known: new Map(),
    snapshot: () => spec.partialize(api.getState()),
    apply(state, kind = 'sync') {
      const set = () => api.setState((cur) => spec.merge(state, cur), true);
      if (kind === 'current') set();
      else runInScope(createScope(kind, { label: `apply ${spec.key}` }), set);
    },
    capture() {
      const ops = diff(binding as unknown as Binding<unknown>, binding.snapshot(), true);
      route(ops);
      return ops;
    },
    flushMirror: () => flushMirror(spec.key),
  };
  bindings.set(spec.key, binding as unknown as Binding<unknown>);
  // What the hydrated (boot-cache) state maps to is assumed to be in the store; boot reconciliation verifies it.
  for (const w of spec.toDocs(binding.snapshot())) {
    binding.known.set(docKey(w.col, w.id), {
      body: jsonClone(w.fields ? pick(w.body, w.fields) : w.body),
      src: w.src,
      fields: w.fields,
      owned: ownsDoc(spec, w.col, w.id),
    });
  }
  return binding;
}

/** Reset what a binding believes is stored (after erase/replace). */
export function forgetKnown(binding: Binding): void {
  binding.known.clear();
}

/** A reader over `known` (the freshest view of every binding's documents) with optional overrides. */
export function knownReader(overrides: Map<string, Record<string, unknown> | null> = new Map(), fallback?: DocReader): DocReader {
  const merged = new Map<string, Record<string, unknown>>();
  for (const b of getBindings()) {
    for (const [k, v] of b.known) {
      const cur = merged.get(k);
      merged.set(k, cur ? { ...cur, ...v.body } : { ...v.body });
    }
  }
  for (const [k, v] of overrides) {
    if (v === null) merged.delete(k);
    else merged.set(k, v);
  }
  return {
    get(col, id) {
      const v = merged.get(docKey(col, id));
      if (v) return jsonClone(v);
      return fallback?.get(col, id) ?? null;
    },
    list(col) {
      const out: Array<{ id: string; body: Record<string, unknown> }> = [];
      const seen = new Set<string>();
      for (const [k, body] of merged) {
        const [c, id] = k.split('\u0000') as [string, string];
        if (c === col) {
          out.push({ id, body: jsonClone(body) });
          seen.add(id);
        }
      }
      for (const x of fallback?.list(col) ?? []) if (!seen.has(x.id) && !overrides.has(docKey(col, x.id))) out.push(x);
      return out;
    },
  };
}

/** A document body to restore (null = the document goes away; for a shared doc, `fields` are the writer's only). */
export interface RestoreTarget {
  col: CollectionId;
  id: string;
  body: Record<string, unknown> | null;
  fields?: readonly string[];
}

/**
 * Put the projections holding these documents back to the given bodies (undo plans, the rollback of a failed commit):
 * each binding that holds one of them rebuilds its persisted state from the documents (`fromDocs`, targets laid over
 * `known` and `fallback`) and applies it in a `kind` scope ('current' records the ops on the caller's scope, as undo
 * inside a command does; 'rollback' only rewrites the boot cache and `known`). Returns the restored body per doc key.
 */
export function restoreProjections(targets: readonly RestoreTarget[], fallback: DocReader, kind: ScopeKind | 'current'): Map<string, Record<string, unknown> | null> {
  const overrides = new Map<string, Record<string, unknown> | null>();
  for (const t of targets) {
    let body = t.body;
    if (body === null && t.fields) {
      // a shared document keeps the other writers' fields
      const cur = { ...(knownReader(new Map(), fallback).get(t.col, t.id) ?? {}) };
      for (const f of t.fields) delete cur[f];
      body = cur;
    }
    overrides.set(docKey(t.col, t.id), body);
  }
  const read = knownReader(overrides, fallback);
  const touched = new Set(targets.flatMap((t) => bindingsFor(t.col, t.id)));
  for (const b of touched) {
    const next = b.fromDocs(read);
    if (next && !deepEqual(next, b.snapshot())) b.apply(next, kind);
  }
  return overrides;
}

export { docKey, pick as pickFields };
export const isRecord = isPlainObject;
