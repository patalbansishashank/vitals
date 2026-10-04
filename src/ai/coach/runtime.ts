/**
 * The Coach runtime (one per app): follows the AI provider configuration (`onAiConfigChange`), reads the key from the
 * KeyVault, probes capabilities (cached per base URL and model), builds the `ChatModel`, installs the model-backed
 * command ports (photo recognition, exercise resolution), reports whether a tool-capable provider is connected and
 * exposes the current Coach adapter and recipe provider. Loaded lazily by `CoachRuntimeProvider.tsx`.
 *
 * Tier H: UI-specific pieces (availability flag, visible briefing, blob store) are injected.
 */
import { aiConfigSettled, onAiConfigChange, readAiConfig, type AiProviderConfig } from '@/commands/ai/config';
import { localDay, recordAiUsage, summarizeAiUsage } from '@/commands/ai/usage';
import { installAiPorts } from '@/commands/aiPorts';
import { allCommands, buildManifest, dispatch, getCommand, on } from '@/commands';
import { createBrowserKeyVault, type KeyVault } from '../keys';
import { createChatModel, getPreset, makeCustomPreset, priceOf, resolvePreset, type ChatModel, type Preset } from '../providers';
import { CapabilityCache, degradeFor, probeCapabilities, shouldReprobe } from '../providers/probe';
import { addUsage, ledgerRow } from '../providers/usage';
import { IdbKv } from '../storage/kv';
import { netFetch } from '../../net/net';
import type { Capabilities, ChatModel as Model, StreamEvent, Usage } from '../providers/types';
import { createCoachAdapter, type CoachAdapter, type CoachAdapterDeps } from './adapter';
import { createDocumentConversationStore } from './documentStore';
import { createAiRecipeProvider } from './recipes';
import type { CoachBus } from './tools';
import { installModelPorts } from './vision';

export type AiRecipeProvider = ReturnType<typeof createAiRecipeProvider>;

/** The app's command bus as the Coach sees it. */
export const appBus: CoachBus = {
  dispatch: (id, input, opts) => dispatch(id, input, opts),
  manifest: () => buildManifest('ai'),
  getCommand: (id) => getCommand(id),
  commandIds: () => allCommands().map((d) => d.id),
  on: (l) => on(l),
};

export interface CoachRuntimeDeps {
  /** Tool-capable provider connected (`setCoachAvailable`). */
  setAvailable(on: boolean): void;
  /** The configured provider couldn't be set up: the reason, or null (`setCoachProblem`). */
  setProblem?(problem: string | null): void;
  /** UI pieces of the adapter: visible briefing, photo storage. */
  adapterExtras?: Partial<CoachAdapterDeps>;
  bus?: CoachBus;
  keyVault?: KeyVault;
  capabilityCache?: CapabilityCache;
  /**
   * For presets with `via: 'server'`: the paired server's address and the fetch that adds this device's token
   * (SUITE_SPEC §14.3). Throws `ServerError('not_paired')` when this device is not paired.
   */
  serverOptions?: (presetId: string) => { serverUrl: string; deps: { fetch: typeof fetch } };
  /** Builds the model (tests inject a fake fetch through it). */
  createModel?: typeof createChatModel;
  installPorts?: (model: ChatModel, caps: Pick<Capabilities, 'vision'>) => void;
  clearPorts?: () => void;
  now?: () => Date;
  /** Appends a usage row (default `recordAiUsage`); tests observe it. */
  recordUsage?: typeof recordAiUsage;
}

/**
 * The model with every call's usage recorded: photo recognition, exercise resolution and recipes call the model
 * outside the Coach's turn loop, and their tokens count toward the spend ledger and the monthly cap too.
 */
export function meteredModel(model: Model, record: (usage: Usage) => void): Model {
  return {
    ...model,
    complete: async (req, signal) => {
      const res = await model.complete(req, signal);
      if (res.usage) record(res.usage);
      return res;
    },
    stream: async function* (req, signal): AsyncGenerator<StreamEvent> {
      let usage: Usage | null = null;
      try {
        for await (const ev of model.stream(req, signal)) {
          if (ev.type === 'usage') usage = addUsage(usage, ev.usage);
          yield ev;
        }
      } finally {
        if (usage) record(usage);
      }
    },
  };
}

export interface CoachRuntime {
  adapter(): CoachAdapter | null;
  recipes(): AiRecipeProvider | null;
  /** Last configuration error (no key, unknown preset), in plain words. */
  problem(): string | null;
  subscribe(listener: () => void): () => void;
  revision(): number;
  /** Resolves when the current configuration has been applied. */
  settled(): Promise<void>;
  stop(): void;
}

function presetOf(cfg: AiProviderConfig): Preset {
  if (cfg.presetId === 'custom' || cfg.presetId.startsWith('custom-')) {
    const existing = getPreset(cfg.presetId);
    if (existing) return existing;
    return makeCustomPreset({ id: cfg.presetId === 'custom' ? 'custom-endpoint' : cfg.presetId, label: 'Custom endpoint', adapter: cfg.adapter ?? 'openai-chat', baseUrl: cfg.baseUrl ?? '', defaultModel: cfg.model });
  }
  return resolvePreset(cfg.presetId);
}

export function createCoachRuntime(deps: CoachRuntimeDeps): CoachRuntime {
  const bus = deps.bus ?? appBus;
  const now = deps.now ?? (() => new Date());
  const makeModel = deps.createModel ?? createChatModel;
  const install = deps.installPorts ?? ((m, caps) => installModelPorts(m, caps));
  const clear = deps.clearPorts ?? (() => installAiPorts({}));
  const recordUsage = deps.recordUsage ?? recordAiUsage;
  let vault: KeyVault | null = deps.keyVault ?? null;
  const conversations = deps.adapterExtras?.store ?? createDocumentConversationStore();
  let cache: CapabilityCache | null = deps.capabilityCache ?? null;
  let current: CoachAdapter | null = null;
  let recipes: AiRecipeProvider | null = null;
  let problem: string | null = null;
  let rev = 0;
  let generation = 0;
  let pending: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const bump = () => {
    rev++;
    listeners.forEach((l) => l());
  };

  async function apply(cfg: AiProviderConfig | null): Promise<void> {
    const gen = ++generation;
    if (!cfg) {
      current = null;
      recipes = null;
      problem = null;
      deps.setProblem?.(null);
      clear();
      deps.setAvailable(false);
      bump();
      return;
    }
    try {
      const preset = presetOf(cfg);
      const baseUrl = (cfg.baseUrl ?? preset.baseUrl).replace(/\/+$/, '');
      vault ??= createBrowserKeyVault();
      const apiKey = preset.via === 'server' || preset.authHeader === 'none' ? '' : ((await vault.get(cfg.presetId, baseUrl)) ?? ''); // Settings files the key under the config's preset id ('custom' for a custom endpoint)
      if (gen !== generation) return;
      const server = preset.via === 'server' && deps.serverOptions ? deps.serverOptions(preset.id) : null;
      const route = {
        ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
        ...(server ? { serverUrl: server.serverUrl, deps: server.deps } : {}),
      };
      const base = makeModel({ preset, model: cfg.model, ...route, apiKey });
      let caps = base.capabilities;
      try {
        cache ??= new CapabilityCache(new IdbKv('capabilities'));
        caps = await probeCapabilities({
          cfg: { preset, baseUrl: base.baseUrl, model: base.model, apiKey, capabilities: base.capabilities, deps: { fetch: server?.deps.fetch ?? netFetch } },
          cache,
          nowIso: now().toISOString(),
          allowSelfTest: false,
        });
      } catch {
        // a probe failure keeps the preset's defaults
      }
      if (gen !== generation) return;
      const model = makeModel({ preset, model: cfg.model, ...route, apiKey, capabilities: caps });
      const degrade = degradeFor(caps, { model: model.model, presetId: preset.id });
      const price = priceOf(preset, model.model);
      const record = (usage: Usage, conversationId: string | null) => {
        void recordUsage(ledgerRow(now().toISOString(), preset.id, model.model, usage, conversationId), price ? { input: price.input, output: price.output, ...(price.cachedInput !== undefined ? { cachedInput: price.cachedInput } : {}) } : undefined).catch(() => undefined);
      };
      const sideModel = meteredModel(model, (usage) => record(usage, null));
      install(sideModel, caps);
      current = createCoachAdapter({
        bus,
        model,
        provider: { name: preset.label, model: preset.recommendedModels.find((m) => m.id === model.model)?.label ?? model.model, keyOwner: preset.authHeader === 'none' || preset.via === 'server' ? 'local' : 'your key' },
        tier: degrade.basicTier ? 'basic' : 'full',
        smallEditsWithoutAsking: () => readAiConfig()?.smallEditsWithoutAsking ?? false,
        aiActorId: preset.id,
        store: conversations,
        isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
        spend: {
          capUsd: () => {
            const c = readAiConfig();
            return c?.stopAtCap ? c.spendCapUsdMonthly : undefined;
          },
          spentUsd: () => {
            try {
              return summarizeAiUsage({ today: localDay(now()) }).periods.thisMonth.costUsd;
            } catch {
              return 0;
            }
          },
          record,
        },
        // A 400 naming an unsupported parameter means the cached capabilities are wrong: drop them so the next
        // setup probes again instead of keeping them for 30 days (R8 §3.3).
        onProviderError: (error) => {
          if (shouldReprobe(error) && cache) void cache.invalidate(base.baseUrl, base.model).catch(() => undefined);
        },
        ...deps.adapterExtras,
      });
      recipes = caps.tools || caps.jsonSchema || caps.jsonObject ? createAiRecipeProvider({ model: sideModel }) : null;
      problem = null;
      deps.setProblem?.(null);
      deps.setAvailable(caps.tools);
    } catch (e) {
      if (gen !== generation) return;
      current = null;
      recipes = null;
      problem = e instanceof Error ? e.message : String(e);
      deps.setProblem?.(problem);
      clear();
      deps.setAvailable(false);
    }
    bump();
  }

  const off = onAiConfigChange((cfg) => {
    pending = apply(cfg);
  });
  pending = aiConfigSettled()
    .catch(() => undefined)
    .then(() => apply(readAiConfig()));

  return {
    adapter: () => current,
    recipes: () => recipes,
    problem: () => problem,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => rev,
    settled: () => pending,
    stop: () => {
      off();
      generation++;
    },
  };
}

let singleton: CoachRuntime | null = null;

/** The app's runtime (created on first use). */
export function coachRuntime(deps: CoachRuntimeDeps): CoachRuntime {
  singleton ??= createCoachRuntime(deps);
  return singleton;
}
