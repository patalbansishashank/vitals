/**
 * What Settings › AI provider needs from the AI layer: the KeyVault, the capability cache, and a capability probe that
 * measures latency. Injected through `AiSectionDeps` so tests pass in-memory stores and a fake fetch.
 */
import {
  CapabilityCache,
  createBrowserKeyVault,
  createChatModel,
  effectiveBaseUrl,
  IdbKv,
  isBasicTier,
  KeyVault,
  MemoryKv,
  presetCapabilities,
  probeCapabilities,
  type AdapterConfig,
  type Capabilities,
  type ModelInfo,
  type Preset,
} from '@/ai';
import { allowOrigin, netFetch } from '@/net/net';
import { getServerClient, ServerError } from '@/net/server';

export interface AiSectionDeps {
  vault: KeyVault;
  cache: CapabilityCache;
  /** Network for probes; default `netFetch` (granting the provider's origin for purpose `ai`). */
  fetch?: typeof fetch;
  /**
   * For presets with `via: 'server'`: the paired server's address and the fetch that adds this device's token
   * (SUITE_SPEC §14.3). Default: `getServerClient().chatModelOptions()`, which throws `ServerError('not_paired')`.
   */
  serverOptions?: (presetId: string) => { serverUrl: string; deps: { fetch: typeof fetch } };
  now?: () => Date;
}

let defaults: AiSectionDeps | null = null;

/** One vault and cache per page (session-only keys live in the vault instance). */
export function defaultAiDeps(): AiSectionDeps {
  if (!defaults) {
    const hasIdb = typeof indexedDB !== 'undefined';
    defaults = {
      vault: hasIdb ? createBrowserKeyVault() : new KeyVault({ keys: new MemoryKv(), meta: new MemoryKv(), now: () => new Date().toISOString() }),
      cache: new CapabilityCache(hasIdb ? new IdbKv<Capabilities>('capabilities') : new MemoryKv<Capabilities>()),
      serverOptions: () => getServerClient().chatModelOptions(),
    };
  }
  return defaults;
}

/** The URL the page talks to: the server's AI route for `via: 'server'` presets, else the override or the preset's. */
export function resolveBaseUrl(preset: Preset, baseUrl: string | undefined, deps: AiSectionDeps): string {
  if (preset.via === 'server') {
    const s = deps.serverOptions?.(preset.id);
    if (!s) throw new ServerError('not_paired');
    return effectiveBaseUrl(preset, { serverUrl: s.serverUrl });
  }
  return effectiveBaseUrl(preset, { baseUrl });
}

/** Where the key is filed: the preset's own base URL (or the custom base URL). */
export function keyBaseUrl(preset: Preset, baseUrl: string | undefined): string {
  return (baseUrl || preset.baseUrl).replace(/\/+$/, '');
}

/** Address and fetch for a preset: through the paired server for `via: 'server'` presets, else the given deps. */
function wireFor(preset: Preset, baseUrlOverride: string | undefined, deps: AiSectionDeps): { baseUrl: string; serverUrl?: string; fetchFn: typeof fetch } {
  if (preset.via === 'server') {
    const s = deps.serverOptions?.(preset.id);
    if (!s) throw new ServerError('not_paired');
    return { baseUrl: effectiveBaseUrl(preset, { serverUrl: s.serverUrl }), serverUrl: s.serverUrl, fetchFn: s.deps.fetch };
  }
  const baseUrl = effectiveBaseUrl(preset, { baseUrl: baseUrlOverride });
  let fetchFn = deps.fetch;
  if (!fetchFn) {
    allowOrigin(baseUrl, 'ai');
    fetchFn = netFetch;
  }
  return { baseUrl, fetchFn };
}

export { ServerError };

export interface ProbeOutcome {
  caps: Capabilities;
  latencyMs: number;
  basicTier: boolean;
}

/**
 * Probes `model` afresh (the cached entry is dropped first: "Test connection" means test now), caching the result.
 * Throws the provider error on auth, network, model and similar failures.
 */
export async function runProbe(args: { preset: Preset; model: string; baseUrl?: string; apiKey: string; deps: AiSectionDeps; signal?: AbortSignal }): Promise<ProbeOutcome> {
  const { preset, model, deps } = args;
  const viaServer = preset.via === 'server';
  const { baseUrl, serverUrl, fetchFn } = wireFor(preset, args.baseUrl, deps);
  const wirePreset = viaServer ? { ...preset, authHeader: 'none' as const } : preset;
  const apiKey = viaServer ? '' : args.apiKey;
  const cfg: AdapterConfig = { preset: wirePreset, baseUrl, model, apiKey, capabilities: presetCapabilities(preset), deps: { fetch: fetchFn } };
  await deps.cache.invalidate(baseUrl, model);
  const now = deps.now?.() ?? new Date();
  const started = performance.now();
  const caps = await probeCapabilities({
    cfg,
    cache: deps.cache,
    nowIso: now.toISOString(),
    allowSelfTest: true,
    signal: args.signal,
    makeModel: (c) => createChatModel({ preset, model, baseUrl: args.baseUrl, apiKey, capabilities: c, ...(serverUrl ? { serverUrl } : {}), deps: { fetch: fetchFn } }),
  });
  return { caps, latencyMs: Math.round(performance.now() - started), basicTier: isBasicTier(model, preset.id) };
}

/**
 * Lists the provider's models for the picker (`GET …/models`, through the server for `via: 'server'` presets).
 * Throws the provider error (network, server not reachable, auth) for the screen to word.
 */
export async function listModelsFor(args: { preset: Preset; baseUrl?: string; apiKey: string; deps: AiSectionDeps; signal?: AbortSignal }): Promise<ModelInfo[]> {
  const { preset, deps } = args;
  const viaServer = preset.via === 'server';
  const { serverUrl, fetchFn } = wireFor(preset, args.baseUrl, deps);
  const model = createChatModel({ preset, model: preset.defaultModel || 'list', baseUrl: args.baseUrl, apiKey: viaServer ? '' : args.apiKey, ...(serverUrl ? { serverUrl } : {}), deps: { fetch: fetchFn } });
  const list = await model.listModels(args.signal);
  return [...list].sort((a, b) => a.id.localeCompare(b.id));
}
