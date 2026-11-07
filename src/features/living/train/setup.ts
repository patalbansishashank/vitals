/**
 * The person's training setup Train composes, swaps and prices for: equipment, places and days, injuries, likes
 * (`TrainingProfile`), and the body context the stimulus and energy terms need (`StimulusContext`).
 *
 * (0.6.3 A33) The app's source is store-backed and says whether it is `loading`, `ready` or in `error`: it never serves
 * the fixture body (83.4 kg, VO2max 40) in production. Train waits for `ready` before composing or estimating anything.
 * The fixed and stub sources (tests, demos, the screenshot harness) are always ready.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { Catalogue, StimulusContext, TrainingProfile } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { loadCatalogueModules, trainingSetupNow, type CatalogueModules } from '@/commands/catalogue/setup';
import { getDocumentStore } from '@/state/runtime';
import { STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE } from '../data/fixtures';

export type TrainingSetupStatus = 'loading' | 'error' | 'ready';

export interface TrainingSetupSource {
  /** Null until the person's own setup is read (a live source while `status()` is not `ready`). */
  profile(): TrainingProfile | null;
  context(): StimulusContext | null;
  /** Live sources: loading, read, or not readable. Absent = ready (fixed sources). */
  status?(): TrainingSetupStatus;
  /** The catalogue to compose with (the person's own items included); the seed when absent. */
  catalogue?(): Catalogue;
  /** (0.6.3 INT, S2) The body context's mass is the typical placeholder (no weight entered). Absent = the person's own. */
  typicalBody?(): boolean;
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
  let failed = false;
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
      failed = false;
    } catch {
      failed = true;
      return null;
    }
    return snap;
  };
  const start = () => {
    void loadCatalogueModules().then(
      (m) => {
        mods = m;
        bump();
      },
      () => {
        failed = true;
        bump();
      },
    );
    try {
      off = getDocumentStore().subscribe((c) => {
        if (WATCHED.has(c.col)) bump();
      });
    } catch {
      off = null;
    }
  };
  return {
    // (0.6.3 A33) no fixture fallback: null until the person's documents are read
    profile: () => current()?.profile ?? null,
    context: () => current()?.ctx ?? null,
    catalogue: () => current()?.catalogue ?? SEED_CATALOGUE,
    typicalBody: () => current()?.typicalBody ?? true,
    status: () => (current() ? 'ready' : failed ? 'error' : 'loading'),
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

/** What Train reads: the person's setup once ready; while loading or after an error, no profile and no body context. */
export type TrainingSetupView =
  | { status: 'ready'; profile: TrainingProfile; ctx: StimulusContext; catalogue: Catalogue; typicalBody: boolean }
  | { status: 'loading' | 'error'; profile: null; ctx: null; catalogue: Catalogue; typicalBody: boolean };

/** The current profile, body context and catalogue (live for store-backed sources), with the source's state. */
export function useTrainingSetup(): TrainingSetupView {
  const s = useContext(Ctx) ?? fallback;
  const v = useSyncExternalStore(s.subscribe ?? noop, s.version ?? zero, s.version ?? zero);
  return useMemo(() => {
    void v;
    const catalogue = s.catalogue?.() ?? SEED_CATALOGUE;
    const status = s.status?.() ?? 'ready';
    const profile = status === 'ready' ? s.profile() : null;
    const ctx = status === 'ready' ? s.context() : null;
    const typicalBody = s.typicalBody?.() ?? false;
    if (profile && ctx) return { status: 'ready', profile, ctx, catalogue, typicalBody };
    return { status: status === 'error' ? 'error' : 'loading', profile: null, ctx: null, catalogue, typicalBody };
  }, [s, v]);
}
