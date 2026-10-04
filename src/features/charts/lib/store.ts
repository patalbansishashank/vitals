/* ==========================================================================
   A minimal external store (useSyncExternalStore-compatible). Chart state that
   changes per frame (window, cursor) lives here so lanes update imperatively
   without React re-renders (CHART_SPEC §8.2: crosshair < 4 ms, no re-render).
   ========================================================================== */
export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(fn: (value: T, prev: T) => void): () => void;
}

export function createStore<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Store<T> {
  let value = initial;
  const subs = new Set<(value: T, prev: T) => void>();
  const set = (next: T) => {
    if (equals(value, next)) return;
    const prev = value;
    value = next;
    for (const fn of Array.from(subs)) fn(value, prev);
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof T)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}
