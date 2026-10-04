/**
 * Where the agent permissions live (device-local, never synced): `uiPrefs/me.agents`, written only by
 * `agents.configure` — WebMCP on or off and, per agent client, "may apply plan edits directly". (The Coach's provider
 * config is E9b's `uiPrefs/me.aiProvider`, `./config.ts`.)
 *
 * Why `uiPrefs`: the settings projection owns `deviceSettings` whole (every settings change rewrites it), while
 * `uiPrefs` is shared field by field. Both are local-only (`LOC`). Exports carry `uiPrefs`, imports never restore this
 * field (only projection-owned ones), so turning on an agent surface stays a decision made on this device.
 */
import type { Doc } from '@/store';
import { getDocumentStore } from '@/state/runtime';

export const AGENT_SETTINGS_FIELD = 'agents';

export interface AgentClientSettings {
  directApply: boolean;
}

export interface AgentSettings {
  /** Undefined until the person first chooses (the device flag's own default, off, applies). */
  webmcp?: boolean;
  /** Keyed by client: `webmcp` for agents in this browser, else the MCP client's name. */
  clients: Record<string, AgentClientSettings>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Client keys: what the Companion lets through (`[\w .:@/-]`, ≤ 64). */
export const CLIENT_KEY = /^[\w .:@/-]{1,64}$/;

/** Sanitises a stored `agents` field. */
export function normalizeAgentSettings(raw: unknown): AgentSettings {
  const out: AgentSettings = { clients: {} };
  if (!isObj(raw)) return out;
  if (typeof raw.webmcp === 'boolean') out.webmcp = raw.webmcp;
  if (isObj(raw.clients)) {
    for (const [k, v] of Object.entries(raw.clients)) {
      if (CLIENT_KEY.test(k) && isObj(v) && typeof v.directApply === 'boolean') out.clients[k] = { directApply: v.directApply };
    }
  }
  return out;
}

function uiPrefs(): Record<string, unknown> | null {
  try {
    return getDocumentStore().peek<Record<string, unknown>>('uiPrefs', 'me') as (Doc<Record<string, unknown>> & Record<string, unknown>) | null;
  } catch {
    return null;
  }
}

/** The agent settings as the store holds them now (empty before the store has loaded). */
export function readAgentSettings(): AgentSettings {
  return normalizeAgentSettings(uiPrefs()?.[AGENT_SETTINGS_FIELD]);
}

/** The settings key of an agent: `webmcp` for agents in this browser, the client's name for MCP clients. */
export function agentClientKey(actor: { kind: string; id: string }): string {
  return actor.kind === 'webmcp' ? 'webmcp' : actor.id;
}

/** Whether the person let this agent apply plan edits directly (default no). */
export function directApplyFromSettings(actor: { kind: string; id: string }, settings: AgentSettings = readAgentSettings()): boolean {
  return settings.clients[agentClientKey(actor)]?.directApply === true;
}
