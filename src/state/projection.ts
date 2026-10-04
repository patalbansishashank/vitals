/**
 * `createProjection`: a Zustand store that is a projection of documents (SUITE_SPEC §2.1, §2.7).
 *
 * The store keeps its v0.1 shape and hook API (including `useX.persist.rehydrate()`); `persist` now reads and writes
 * through the bridge (`docStorage`), the strict-store guard wraps every write, and the binding maps the persisted
 * state to documents and back.
 */
import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { bindDocs, docStorage, guarded, type Binding, type BindingSpec } from './bridge';
import { createScope, runInScope } from './scope';

export type ProjectionHook<S> = UseBoundStore<StoreApi<S>> & {
  persist: {
    rehydrate: () => Promise<void> | void;
    hasHydrated: () => boolean;
    clearStorage: () => void;
    onFinishHydration: (fn: (state: S) => void) => () => void;
  };
};

export interface ProjectionOptions<S extends object, P> {
  /** Store name for guard messages ('profile', 'scenarios'). */
  name: string;
  key: string;
  version: number;
  /** Top-level fields that are user data (guarded). */
  persistedFields: readonly (keyof S & string)[];
  creator: StateCreator<S, [], []>;
  partialize: (s: S) => P;
  migrate: (persisted: unknown, version: number) => P;
  /** Merge of a stored state into the live one (hydration, import). `persisted` is undefined when nothing is stored. */
  merge: (persisted: P | undefined, current: S) => S;
  /** Merge of a document-derived state (remote change, undo); defaults to `merge`. */
  mergeDocs?: (persisted: P, current: S) => S;
  binding: Omit<BindingSpec<P>, 'key' | 'version'>;
}

export function createProjection<S extends object, P>(o: ProjectionOptions<S, P>): ProjectionHook<S> & { binding: Binding<P> } {
  const storage = docStorage<P>({ key: o.key, version: o.version, ...o.binding });
  const persisted = persist<S, [], [], P>(o.creator, {
    name: o.key,
    version: o.version,
    storage,
    partialize: o.partialize,
    migrate: o.migrate,
    merge: (p, current) => o.merge(p as P | undefined, current),
  });
  const hook = runInScope(createScope('hydrate', { label: `hydrate ${o.key}` }), () =>
    create<S>()(guarded<S>(o.name, o.persistedFields, persisted as unknown as StateCreator<S, [], []>)),
  ) as unknown as ProjectionHook<S>;
  const rehydrate = hook.persist.rehydrate.bind(hook.persist);
  hook.persist.rehydrate = () => runInScope(createScope('hydrate', { label: `rehydrate ${o.key}` }), () => rehydrate());
  const binding = bindDocs(hook as unknown as StoreApi<S>, {
    key: o.key,
    version: o.version,
    ...o.binding,
    partialize: o.partialize,
    merge: o.mergeDocs ?? ((p: P, cur: S) => o.merge(p, cur)),
  });
  return Object.assign(hook, { binding });
}
