/**
 * (r087 C3) Reading a day store from a screen (`@/features/living/progress/data/dayStore`): the days asked for that have
 * an answer so far, filled in as the others arrive. The store decides what is asked and when (two requests at a time,
 * this week first, the readers taking turns behind it, an older day kept for hours); this hook only says which days the
 * screen shows, and asks again when the store calls for it (new data was announced, the pairing changed) or the app
 * comes back to the front.
 */
import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import type { DayStore } from '@/features/living/progress/data/dayStore';

/** What the store holds for `asked`, read again only when the store moved; the same map while none of its days changed. */
function heldReader<T>(store: DayStore<T>, asked: readonly string[]): () => ReadonlyMap<string, T | null> {
  let seen = -1;
  let last: ReadonlyMap<string, T | null> = new Map();
  return () => {
    const rev = store.revision();
    if (rev === seen) return last;
    seen = rev;
    const next = new Map<string, T | null>();
    for (const d of asked) {
      const v = store.peek(d);
      if (v !== undefined) next.set(d, v);
    }
    if (next.size !== last.size || [...next].some(([d, v]) => !last.has(d) || last.get(d) !== v)) last = next;
    return last;
  };
}

/**
 * The answers held for `dates` (those after `today` are never asked): a date missing from the map has not been answered
 * yet; null is a day the server could not answer. The map keeps its identity while none of its days changed.
 */
export function useDayAnswers<T>(store: DayStore<T>, dates: readonly string[], today: string): ReadonlyMap<string, T | null> {
  const key = dates.filter((d) => d <= today).join(',');
  const epoch = useSyncExternalStore(store.subscribe, store.epoch, store.epoch);
  // this card's name in the shared queue, where the readers take turns
  const reader = useId();
  useEffect(() => {
    const asked = key ? key.split(',') : [];
    if (asked.length === 0) return;
    const ask = () => void store.load(asked, today, undefined, reader);
    ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [store, key, today, epoch, reader]);
  const held = useMemo(() => heldReader(store, key ? key.split(',') : []), [store, key]);
  return useSyncExternalStore(store.subscribe, held, held);
}
