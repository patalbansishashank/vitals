/**
 * Mounts the Coach runtime at the app root: provides the real `CoachAdapter` (CoachAdapterContext) and the AI
 * `RecipeProvider` (RecipeProviderContext) once an AI provider is configured. Import-light: the runtime, the AI layer
 * and the briefing renderer load in their own chunk only when a configuration exists (or appears); until then the
 * contexts keep the app defaults (no-provider Coach, plain meal targets).
 *
 * While this device is paired with the person's server, the Coach runs there instead (server-coach contract): the
 * server adapter is provided, the local runtime is not loaded (or is suspended: no model, no model ports, no recipes),
 * so nothing on this device calls an AI service. Unpaired again, the saved provider comes back unchanged.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { aiConfigSettled, onAiConfigChange, readAiConfig } from '@/commands/ai/config';
import type { CoachAdapter } from '@/features/living/coach/adapter';
import { CoachAdapterContext } from '@/features/living/coach/adapterContext';
import { setCoachAvailable, setCoachProblem } from '@/features/living/coach/availability';
import type { RecipeProvider } from '@/features/living/food/recipes';
import { RecipeProviderContext } from '@/features/living/food/recipeContext';
import { getServerClient } from '@/net/server';
import type { CoachRuntime } from './runtime';
import type { ServerCoachAdapter } from './serverAdapter';


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
  // the same vault and capability cache as Settings › Coach (session-only keys live in the vault instance)
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

/** Tab storage for the open server session's id (reattach after a reload); null where there is none. */
function tabStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

async function loadServerAdapter(): Promise<ServerCoachAdapter> {
  const [{ createServerCoachAdapter }, { createServerCoachClient }, { dispatch, getCommand }] = await Promise.all([import('./serverAdapter'), import('@/net/coach'), import('@/commands')]);
  return createServerCoachAdapter({
    client: createServerCoachClient({ server: getServerClient() }),
    bus: { dispatch: (id, input, opts) => dispatch(id, input, opts), getCommand: (id) => getCommand(id) },
    storage: tabStorage(),
    setAvailable: setCoachAvailable,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  });
}

/** The pairing with the person's server ('' when unpaired): while there is one, the Coach runs there. */
function usePairingKey(): string {
  const client = getServerClient();
  const key = () => {
    const p = client.pairing();
    return p ? `${p.baseUrl}|${p.deviceId}|${p.pairedAt}` : '';
  };
  return useSyncExternalStore(client.subscribe, key, key);
}

export function CoachRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<CoachRuntime | null>(null);
  const runtimeRef = useRef<CoachRuntime | null>(null);
  const pairing = usePairingKey();
  const paired = pairing !== '';
  const [server, setServer] = useState<{ adapter: ServerCoachAdapter; pairing: string } | null>(null);

  // paired: the server's Coach (a new adapter per pairing); the local provider stays off meanwhile
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let made: ServerCoachAdapter | null = null;
    void runtimeRef.current?.setSuspended(true);
    setCoachProblem(null);
    void loadServerAdapter().then(
      (a) => {
        if (cancelled) return a.dispose();
        made = a;
        setServer({ adapter: a, pairing });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      made?.dispose();
      setCoachAvailable(false);
    };
  }, [pairing]);

  // unpaired: the local provider, loaded once a configuration exists (resumed if it was suspended)
  useEffect(() => {
    if (paired) return;
    let cancelled = false;
    let loading = false;
    void runtimeRef.current?.setSuspended(false);
    const load = () => {
      if (loading || runtimeRef.current) return;
      loading = true;
      void loadRuntime().then(
        (rt) => {
          runtimeRef.current = rt;
          // paired while it loaded: it stays off
          void rt.setSuspended(getServerClient().isPaired());
          if (!cancelled) setRuntime(rt);
        },
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
  }, [paired]);

  const serverAdapter = paired && server?.pairing === pairing ? server.adapter : null;
  useSyncExternalStore(runtime ? runtime.subscribe : noop, runtime ? runtime.revision : zero, runtime ? runtime.revision : zero);
  useSyncExternalStore(serverAdapter ? serverAdapter.subscribe : noop, serverAdapter ? serverAdapter.revision : zero, serverAdapter ? serverAdapter.revision : zero);
  // compile-time check that the headless adapters match the Coach surface's contract
  const local: CoachAdapter | null = paired ? null : (runtime?.adapter() ?? null);
  const onServer: CoachAdapter | null = serverAdapter;
  const adapter = onServer ?? local;
  // null: `useRecipeProvider` falls back to `noRecipeProvider` (plain meal targets); none while paired
  const recipes: RecipeProvider | null = paired ? null : (runtime?.recipes() ?? null);

  return (
    <CoachAdapterContext.Provider value={adapter}>
      <RecipeProviderContext.Provider value={recipes}>
        {children}
      </RecipeProviderContext.Provider>
    </CoachAdapterContext.Provider>
  );
}
