/**
 * Loader of the kitchen catalogue (the generated `./kitchen` module is large: screens and commands import it lazily
 * through `loadKitchen()`; tests may use `kitchenNow()` after a load). One catalogue and one search index per app.
 */
import { buildKitchenIndex, createKitchenCatalogue, type KitchenCatalogue, type KitchenIndex } from '@/catalogues/kitchen';

export interface LoadedKitchen {
  cat: KitchenCatalogue;
  index: KitchenIndex;
}

let loaded: LoadedKitchen | null = null;
let loading: Promise<LoadedKitchen> | null = null;

export function loadKitchen(): Promise<LoadedKitchen> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import('./kitchen').then(({ KITCHEN_SEED }) => {
    const cat = createKitchenCatalogue(KITCHEN_SEED);
    loaded = { cat, index: buildKitchenIndex(cat) };
    return loaded;
  });
  // a failed load (offline chunk fetch) may be retried
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** The catalogue when already loaded, else null. */
export function kitchenNow(): LoadedKitchen | null {
  return loaded;
}
