/**
 * Entry point of the provider layer: build a `ChatModel` from a preset id, key and model.
 *
 * Routing: presets with `via: 'server'` (NVIDIA NIM, OpenCode Zen, Sign in with ChatGPT) go through the person's Vitals
 * server at `${serverUrl}/v1/ai/<presetId>/…` (SUITE_SPEC §14.3); the server holds those keys and the ChatGPT sign-in,
 * so none is sent from the page.
 *
 * Network: by default requests use `netFetch`, and building a model grants the model's origin in the net allowlist
 * for purpose `ai` (choosing a provider in Settings is the user's grant). Tests inject `deps.fetch` instead.
 */
import { allowOrigin, netFetch } from '../../net/net';
import { createAnthropicMessagesModel } from './anthropicMessages';
import { createOpenAIChatModel } from './openaiChat';
import { createOpenAIResponsesModel } from './openaiResponses';
import { getPreset, presetCapabilities, type Preset } from './presets';
import type { AdapterConfig, AdapterDeps, Capabilities, ChatModel } from './types';

export interface CreateChatModelOptions {
  preset: string | Preset;
  /** Defaults to the preset's default model. */
  model?: string;
  /** Overrides the preset base URL (local servers on another port, custom hosts). */
  baseUrl?: string;
  apiKey?: string;
  /** Probe result (probe.ts); preset defaults otherwise. */
  capabilities?: Capabilities;
  /** Base URL of the paired Vitals server, required for presets with `via: 'server'`. */
  serverUrl?: string;
  deps?: Partial<AdapterDeps>;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/** Shared across models so a base URL reached once is never misreported as a CORS failure later. */
const reachedBaseUrls = new Set<string>();

export function resolvePreset(p: string | Preset): Preset {
  const preset = typeof p === 'string' ? getPreset(p) : p;
  if (!preset) throw new ProviderConfigError(`Unknown provider "${String(p)}"`);
  return preset;
}

/** Effective base URL: the server's AI route for `via: 'server'` presets, else the override or the preset's. */
export function effectiveBaseUrl(preset: Preset, opts: Pick<CreateChatModelOptions, 'baseUrl' | 'serverUrl'>): string {
  if (preset.via === 'server') {
    if (!opts.serverUrl) throw new ProviderConfigError(`${preset.label} works through your Vitals server. Connect this device in Settings › Server.`);
    return `${opts.serverUrl.replace(/\/+$/, '')}/v1/ai/${preset.id}`;
  }
  return (opts.baseUrl ?? preset.baseUrl).replace(/\/+$/, '');
}

export function createChatModel(opts: CreateChatModelOptions): ChatModel {
  const preset = resolvePreset(opts.preset);
  const baseUrl = effectiveBaseUrl(preset, opts);
  const model = opts.model || preset.defaultModel;
  if (!model) throw new ProviderConfigError(`Choose a model for ${preset.label}`);
  const viaServer = preset.via === 'server';
  const apiKey = viaServer ? '' : (opts.apiKey ?? '');
  if (!apiKey && !viaServer && preset.authHeader !== 'none') throw new ProviderConfigError(`Add an API key for ${preset.label}`);

  if (!opts.deps?.fetch) allowOrigin(baseUrl, viaServer ? 'server' : 'ai');
  const deps: AdapterDeps = { fetch: netFetch, reachedBaseUrls, ...opts.deps };
  const capabilities: Capabilities = { ...(opts.capabilities ?? presetCapabilities(preset)), browserDirect: !viaServer };
  const cfg: AdapterConfig = {
    // Through the server the device token is the only credential the page sends (deps.fetch adds it).
    preset: viaServer ? { ...preset, authHeader: 'none' } : preset,
    baseUrl,
    model,
    apiKey,
    capabilities,
    deps,
  };
  switch (preset.adapter) {
    case 'openai-chat':
      return createOpenAIChatModel(cfg);
    case 'anthropic-messages':
      return createAnthropicMessagesModel(cfg);
    case 'openai-responses':
      return createOpenAIResponsesModel(cfg);
  }
}

export * from './types';
export { ProviderError } from './errors';
export { collect } from './http';
export * from './presets';
export { RETRY_POLICY } from './retry';
export { costUsd, estimateRequestTokens, ledgerRow, type UsageLedgerRow } from './usage';
