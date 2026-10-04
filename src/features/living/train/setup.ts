/**
 * The person's training setup Train composes, swaps and prices for: equipment, places and days, injuries, likes
 * (`TrainingProfile`), and the body context the stimulus and energy terms need (`StimulusContext`).
 *
 * TODO(E7b): read the intake's equipment, places and injuries (intake document, training chapter).
 * TODO(E5): read the trend weight and the engine's VO2max state for the context.
 * Until then the default returns the fixture setup the stand-in plan was composed for.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Catalogue, StimulusContext, TrainingProfile } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { loadCatalogueModules, trainingSetupNow, type CatalogueModules } from '@/commands/catalogue/setup';
import { getDocumentStore } from '@/state/runtime';
import { STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE } from '../data/fixtures';

export interface TrainingSetupSource {
  profile(): TrainingProfile;
  context(): StimulusContext;
  /** The catalogue to compose with (the person's own items included); the seed when absent. */
  catalogue?(): Catalogue;
  /** Live sources: notify on change, and change `version()` whenever anything above changes. */
  subscribe?(listener: () => void): () => void;
  version?(): unknown;
}

/** The stand-in: the fixture profile and body context. */
export const stubTrainingSetup: TrainingSetupSource = {
  profile: () => STUB_TRAINING_PROFILE,
  context: () => STUB_STIMULUS_CONTEXT,
};

/** A fixed setup (tests, demos). */
export function fixedTrainingSetup(profile: TrainingProfile, context: StimulusContext = STUB_STIMULUS_CONTEXT): TrainingSetupSource {
  return { profile: () => profile, context: () => context };
}

const Ctx = createContext<TrainingSetupSource | null>(null);
/** Mount a different setup source (tests; later the store-backed one). */
export const TrainingSetupProvider = Ctx.Provider;

/** Collections whose changes can move the setup (catalogue items, the intake answers, the profile, the trend weight). */
const WATCHED: ReadonlySet<string> = new Set(['catalogueCustom', 'intake', 'profile', 'derived', 'labs']);

/**
 * The store-backed source: `trainingSetupNow()` over the person's documents (intake answers, their own equipment and
 * exercises, the trend weight). Until the catalogue modules have loaded it serves the stand-in.
 */
export function createStoreTrainingSetup(): TrainingSetupSource {
  let mods: CatalogueModules | null = null;
  let snap: ReturnType<typeof trainingSetupNow> | null = null;
  let ver = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    snap = null;
    ver++;
    for (const l of [...listeners]) l();
  };
  let off: (() => void) | null = null;
  const current = () => {
    if (!mods) return null;
    try {
      snap ??= trainingSetupNow(mods, getDocumentStore());
    } catch {
      return null;
    }
    return snap;
  };
  const start = () => {
    void loadCatalogueModules().then((m) => {
      mods = m;
      bump();
    });
    try {
      off = getDocumentStore().subscribe((c) => {
        if (WATCHED.has(c.col)) bump();
      });
    } catch {
      off = null;
    }
  };
  return {
    profile: () => current()?.profile ?? STUB_TRAINING_PROFILE,
    context: () => current()?.ctx ?? STUB_STIMULUS_CONTEXT,
    catalogue: () => current()?.catalogue ?? SEED_CATALOGUE,
    subscribe: (l) => {
      if (listeners.size === 0 && !off) start();
      listeners.add(l);
      return () => {
        listeners.delete(l);
        if (listeners.size === 0) {
          off?.();
          off = null;
        }
      };
    },
    version: () => ver,
  };
}

// The app reads the person's documents; the screen suites (vitest) render the fixture setup unless they mount a source.
let fallback: TrainingSetupSource = import.meta.env.MODE === 'test' ? stubTrainingSetup : createStoreTrainingSetup();
/** Install the app-wide setup source (tests: `setDefaultTrainingSetup(stubTrainingSetup)`). */
export function setDefaultTrainingSetup(s: TrainingSetupSource): void {
  fallback = s;
}

const noop = () => () => undefined;
const zero = () => 0;

/** The current profile, body context and catalogue (live for store-backed sources). */
export function useTrainingSetup(): { profile: TrainingProfile; ctx: StimulusContext; catalogue: Catalogue } {
  const s = useContext(Ctx) ?? fallback;
  const v = useSyncExternalStore(s.subscribe ?? noop, s.version ?? zero, s.version ?? zero);
  return useMemo(() => {
    void v;
    return { profile: s.profile(), ctx: s.context(), catalogue: s.catalogue?.() ?? SEED_CATALOGUE };
  }, [s, v]);
}
