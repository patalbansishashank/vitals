/**
 * Mounts the Coach runtime at the app root: provides the real `CoachAdapter` (CoachAdapterContext) and the AI
 * `RecipeProvider` (RecipeProviderContext) once an AI provider is configured. Import-light: the runtime, the AI layer
 * and the briefing renderer load in their own chunk only when a configuration exists (or appears); until then the
 * contexts keep the app defaults (no-provider Coach, plain meal targets).
 */
import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { aiConfigSettled, onAiConfigChange, readAiConfig } from '@/commands/ai/config';
import type { CoachAdapter } from '@/features/living/coach/adapter';
import { CoachAdapterContext } from '@/features/living/coach/adapterContext';
import { setCoachAvailable, setCoachProblem } from '@/features/living/coach/availability';
import type { RecipeProvider } from '@/features/living/food/recipes';
import { RecipeProviderContext } from '@/features/living/food/recipeContext';
import type { CoachRuntime } from './runtime';

// planner.find from the Coach needs the Planner's current request (src/features/planner/run.ts); its own chunk
const PlannerRequestPublisher = lazy(() => import('@/features/planner/RequestPublisher'));

const noop = () => () => undefined;
const zero = () => 0;

async function loadRuntime(): Promise<CoachRuntime> {
  const [{ coachRuntime }, { buildCoachBriefing }, { getBlobStore }, { defaultAiDeps }] = await Promise.all([
    import('./runtime'),
    import('@/features/living/coach/briefing'),
    import('@/state/blobStore'),
    import('@/features/settings/ai/services'),
  ]);
  let n = 0;
  // the same vault and capability cache as Settings › AI provider (session-only keys live in the vault instance)
  const shared = defaultAiDeps();
  return coachRuntime({
    setAvailable: setCoachAvailable,
    setProblem: setCoachProblem,
    keyVault: shared.vault,
    capabilityCache: shared.cache,
    ...(shared.serverOptions ? { serverOptions: shared.serverOptions } : {}),
    adapterExtras: {
      visibleBriefing: (input) => buildCoachBriefing(input),
      putPhoto: async (file) => {
        const id = `photo-${Date.now().toString(36)}-${(++n).toString(36)}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { chunkId } = await (await getBlobStore()).put(bytes, { purpose: 'photo', aadId: id });
        let url: string;
        try {
          url = URL.createObjectURL(file);
        } catch {
          url = '';
        }
        return { attachmentId: chunkId, url };
      },
    },
  });
}

export function CoachRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<CoachRuntime | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      void loadRuntime().then(
        (rt) => !cancelled && setRuntime(rt),
        () => (loading = false),
      );
    };
    void aiConfigSettled()
      .catch(() => undefined)
      .then(() => {
        if (!cancelled && readAiConfig()) load();
      });
    const off = onAiConfigChange((c) => {
      if (c) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useSyncExternalStore(runtime ? runtime.subscribe : noop, runtime ? runtime.revision : zero, runtime ? runtime.revision : zero);
  // compile-time check that the headless adapter matches the Coach surface's contract
  const adapter: CoachAdapter | null = runtime?.adapter() ?? null;
  // null: `useRecipeProvider` falls back to `noRecipeProvider` (plain meal targets)
  const recipes: RecipeProvider | null = runtime?.recipes() ?? null;

  return (
    <CoachAdapterContext.Provider value={adapter}>
      <RecipeProviderContext.Provider value={recipes}>
        {runtime ? (
          <Suspense fallback={null}>
            <PlannerRequestPublisher />
          </Suspense>
        ) : null}
        {children}
      </RecipeProviderContext.Provider>
    </CoachAdapterContext.Provider>
  );
}
