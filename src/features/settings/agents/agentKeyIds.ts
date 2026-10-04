/**
 * The server ids of the agent keys "Connect your AI tools" made on this computer, per AI tool, so Remove revokes
 * exactly those keys. An id is not a secret (the keys themselves stay in the app's secret store, which the page cannot
 * read). The storage key starts with `vitals-`, not `vitals.`, so it is never exported, imported or synced.
 */
import type { AiToolId } from './desktop';

const KEY = 'vitals-desktop-agent-key-ids';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): Partial<Record<AiToolId, unknown>> {
  try {
    const v = JSON.parse(storage()?.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Record<AiToolId, unknown>>) : {};
  } catch {
    return {};
  }
}

export function agentKeyIds(tool: AiToolId): string[] {
  const ids = readAll()[tool];
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

export function setAgentKeyIds(tool: AiToolId, ids: string[]): void {
  const all = readAll();
  if (ids.length) all[tool] = [...new Set(ids)];
  else delete all[tool];
  try {
    const s = storage();
    if (Object.keys(all).length) s?.setItem(KEY, JSON.stringify(all));
    else s?.removeItem(KEY);
  } catch {
    // storage blocked: Remove falls back to the key's label
  }
}
