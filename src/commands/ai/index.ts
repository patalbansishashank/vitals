/**
 * `ai` executors (E9b): `ai.configure` (UI-only; writes the non-secret provider config, never a key) and `ai.usage`
 * (token totals and estimated cost by provider and period). Ids, schemas and permissions stay as declared in
 * `../defs/coach.ts`; `implement()` only replaces the stub executors.
 *
 * `agents.configure` (I1, declared in `../defs/sync.ts`) and, at load, the bus side of the agent surfaces: the
 * `AgentDispatcher` over `dispatch` and the person's direct-apply policy (`src/agents/registry.ts`, headless).
 * Also here for the Coach: `./tools.ts` (`createAiToolRegistry`, `createBusCommandPort`).
 */
import { getAgentDispatcher, setAgentDispatcher, setDirectApplyPolicy } from '@/agents/registry';
import { bodyOf } from '@/store';
import { createBusAgentDispatcher } from './agentDispatcher';
import { AGENT_SETTINGS_FIELD, CLIENT_KEY, directApplyFromSettings, normalizeAgentSettings, type AgentSettings } from './settings';
import { implement } from '../implement';
import { fail } from '../registry';
import type { CommandContext } from '../types';
import { aiConfigPatch, readAiConfig, SECRET_FIELD, writeAiConfig, type AiProviderConfig } from './config';
import { summarizeAiUsage, type UsageSummary } from './usage';

export { aiConfigSettled, bindAiConfig, onAiConfigChange, readAiConfig, writeAiConfig, type AiProviderConfig } from './config';
export { createBusAgentDispatcher } from './agentDispatcher';
export { readAgentSettings, directApplyFromSettings, agentClientKey, type AgentSettings } from './settings';
export { onAiUsageChange, readUsageBuckets, recordAiUsage, summarizeAiUsage, type UsageBucket, type UsagePrice, type UsageSummary, type UsageTotals } from './usage';

const BY = 'E9b';
const ALLOWED = new Set(['presetId', 'baseUrl', 'adapter', 'model', 'visionModel', 'effort', 'smallEditsWithoutAsking', 'spendCapUsdMonthly', 'stopAtCap', 'remove']);
const ADAPTERS = ['openai-chat', 'openai-responses', 'anthropic-messages'];
const MODEL_ID = /^[\w.:/@+-]{1,200}$/;

/** Path of the first field whose name could carry a secret, anywhere in the input. */
function secretPath(v: unknown, path = ''): string | null {
  if (!v || typeof v !== 'object') return null;
  for (const [k, child] of Object.entries(v)) {
    if (SECRET_FIELD.test(k)) return `${path}/${k}`;
    const deeper = secretPath(child, `${path}/${k}`);
    if (deeper) return deeper;
  }
  return null;
}

function checkBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') fail('invalid_input', 'The base URL must be text.', { path: '/preset/baseUrl' });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('invalid_input', 'The base URL is not a valid address.', { path: '/preset/baseUrl' });
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    fail('invalid_input', 'The base URL must be https, or http on this computer.', { path: '/preset/baseUrl' });
  }
  if (url.username || url.password || url.search) fail('invalid_input', 'Put no credentials or query in the base URL.', { path: '/preset/baseUrl' });
  return url.href.replace(/\/+$/, '');
}

/** Validates `input.preset` into a config (null = remove the provider). Throws `invalid_input`. */
export function parseConfigureInput(input: { preset: Record<string, unknown> }): AiProviderConfig | null {
  const p = input.preset;
  const secret = secretPath(input);
  if (secret) fail('invalid_input', 'Keys are never part of the provider settings. Enter the key in Settings › AI provider.', { path: secret });
  for (const k of Object.keys(p)) if (!ALLOWED.has(k)) fail('invalid_input', `Unknown provider setting "${k}".`, { path: `/preset/${k}` });
  if (p.remove === true) return null;
  if (p.remove !== undefined) fail('invalid_input', '"remove" must be true when present.', { path: '/preset/remove' });

  const presetId = p.presetId;
  if (typeof presetId !== 'string' || !/^(custom(-[a-z0-9-]{1,40})?|[a-z0-9-]{1,40})$/.test(presetId)) {
    fail('invalid_input', 'Choose a provider.', { path: '/preset/presetId' });
  }
  const custom = presetId.startsWith('custom');
  if (typeof p.model !== 'string' || !MODEL_ID.test(p.model)) fail('invalid_input', 'Choose a model.', { path: '/preset/model' });
  const out: AiProviderConfig = { presetId, model: p.model, smallEditsWithoutAsking: false };

  if (p.baseUrl !== undefined) out.baseUrl = checkBaseUrl(p.baseUrl);
  if (custom && !out.baseUrl) fail('invalid_input', 'A custom endpoint needs a base URL.', { path: '/preset/baseUrl' });
  if (p.adapter !== undefined) {
    if (typeof p.adapter !== 'string' || !ADAPTERS.includes(p.adapter)) fail('invalid_input', 'Unknown API style.', { path: '/preset/adapter' });
    out.adapter = p.adapter as AiProviderConfig['adapter'];
  }
  if (custom && !out.adapter) fail('invalid_input', 'A custom endpoint needs an API style.', { path: '/preset/adapter' });
  if (p.visionModel !== undefined && p.visionModel !== '') {
    if (typeof p.visionModel !== 'string' || !MODEL_ID.test(p.visionModel)) fail('invalid_input', 'The photo model id is not valid.', { path: '/preset/visionModel' });
    out.visionModel = p.visionModel;
  }
  if (p.effort !== undefined) {
    if (p.effort !== 'low' && p.effort !== 'medium' && p.effort !== 'high') fail('invalid_input', 'Effort is low, medium or high.', { path: '/preset/effort' });
    out.effort = p.effort;
  }
  if (p.smallEditsWithoutAsking !== undefined) {
    if (typeof p.smallEditsWithoutAsking !== 'boolean') fail('invalid_input', 'Must be on or off.', { path: '/preset/smallEditsWithoutAsking' });
    out.smallEditsWithoutAsking = p.smallEditsWithoutAsking;
  }
  if (p.spendCapUsdMonthly !== undefined && p.spendCapUsdMonthly !== null) {
    const cap = p.spendCapUsdMonthly;
    if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0 || cap > 10_000) {
      fail('invalid_input', 'The monthly cap is between $0 and $10,000.', { path: '/preset/spendCapUsdMonthly' });
    }
    if (cap > 0) out.spendCapUsdMonthly = cap;
  }
  if (p.stopAtCap !== undefined) {
    if (typeof p.stopAtCap !== 'boolean') fail('invalid_input', 'Must be on or off.', { path: '/preset/stopAtCap' });
    if (p.stopAtCap) out.stopAtCap = true;
  }
  return out;
}

implement<{ preset: Record<string, unknown> }>(
  'ai.configure',
  async (ctx: CommandContext, input) => {
    const next = parseConfigureInput(input);
    if (ctx.dryRun) return { configured: next !== null, config: next };
    await ctx.docs.patch('uiPrefs', 'me', aiConfigPatch(next));
    writeAiConfig(next, { persist: false });
    return { configured: next !== null, config: readAiConfig() };
  },
  BY,
);

implement<{ from?: string; to?: string }>(
  'ai.usage',
  (ctx: CommandContext, input): UsageSummary => {
    if (input.from && input.to && input.from > input.to) fail('invalid_input', '"from" is after "to".', { path: '/from' });
    return summarizeAiUsage({ today: ctx.today, from: input.from, to: input.to });
  },
  BY,
);

/* ---------------------------------------------------------------- agents.configure */

export interface AgentsConfigureInput {
  webmcp?: boolean;
  clients?: Record<string, { directApply: boolean }>;
}

implement<AgentsConfigureInput>(
  'agents.configure',
  async (ctx, input): Promise<AgentSettings> => {
    for (const k of Object.keys(input.clients ?? {})) {
      if (!CLIENT_KEY.test(k)) fail('invalid_input', 'An agent name is 1 to 64 letters, digits, spaces or . : @ / - _', { path: `/clients/${k.replace(/~/g, '~0').replace(/\//g, '~1')}` });
    }
    const doc = await ctx.docs.get<Record<string, unknown>>('uiPrefs', 'me');
    const body = doc ? bodyOf<Record<string, unknown>>(doc) : {};
    const current = normalizeAgentSettings(body[AGENT_SETTINGS_FIELD]);
    const next: AgentSettings = {
      ...(input.webmcp !== undefined ? { webmcp: input.webmcp } : current.webmcp !== undefined ? { webmcp: current.webmcp } : {}),
      clients: { ...current.clients },
    };
    for (const [k, v] of Object.entries(input.clients ?? {})) next.clients[k] = { directApply: v.directApply };
    await ctx.docs.put('uiPrefs', { ...body, [AGENT_SETTINGS_FIELD]: next, _id: 'me' });
    return next;
  },
  'I1 (agents)',
);

/* ---------------------------------------------------------------- agent surfaces */

/**
 * Installs the bus's `AgentDispatcher` and the direct-apply policy (idempotent). Runs when this module loads, i.e. at
 * boot with the command bus; WebMCP and the Companion bridge still stay off until the person turns them on and the app
 * shell mounts `<AgentSurfaces />`.
 */
export function installAgentDispatcher(): void {
  setDirectApplyPolicy((actor) => directApplyFromSettings(actor));
  if (!getAgentDispatcher()) setAgentDispatcher(createBusAgentDispatcher());
}

installAgentDispatcher();
