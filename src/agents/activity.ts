/**
 * Recent tool calls from external agents (WebMCP in this tab, MCP clients through the Companion bridge), for the top-bar
 * indicator "An agent is using Vitals" (SUITE_SPEC §7.3) and its Stop switch. In memory only; nothing is persisted.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ExternalSurface, ToolResultEnvelope } from './manifest';

export interface AgentActivity {
  /** Epoch ms when the call finished. */
  at: number;
  surface: ExternalSurface;
  /** Actor id: `webmcp`, or the MCP client's name. */
  actor: string;
  /** Tool name (`log_measurement`). */
  tool: string;
  status: ToolResultEnvelope['status'];
}

const MAX_ENTRIES = 50;
const listeners = new Set<() => void>();
let entries: readonly AgentActivity[] = [];
/** Calls finished before this moment no longer light the indicator (set by `stopAgents`). */
let stoppedAt = 0;
let now: () => number = () => Date.now();

const emit = () => listeners.forEach((l) => l());

export function recordAgentActivity(entry: Omit<AgentActivity, 'at'> & { at?: number }): void {
  entries = [{ ...entry, at: entry.at ?? now() }, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

export function getAgentActivity(): readonly AgentActivity[] {
  return entries;
}

export function subscribeAgentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Epoch ms of the latest call that still counts (after the last Stop), or 0. */
export function lastAgentActivityAt(): number {
  const latest = entries[0]?.at ?? 0;
  return latest > stoppedAt ? latest : 0;
}

export function isAgentActive(windowMs = 60_000, at = now()): boolean {
  const last = lastAgentActivityAt();
  return last > 0 && at - last < windowMs;
}

export function useAgentActivity(): readonly AgentActivity[] {
  return useSyncExternalStore(subscribeAgentActivity, getAgentActivity, getAgentActivity);
}

/** True while an agent tool call finished within the last `windowMs`; turns itself off when the window passes. */
export function useAgentActive(windowMs = 60_000): boolean {
  const last = useSyncExternalStore(subscribeAgentActivity, lastAgentActivityAt, lastAgentActivityAt);
  const [, setTick] = useState(0);
  const remaining = last > 0 ? last + windowMs - now() : 0;
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), remaining + 5);
    return () => clearTimeout(t);
  }, [remaining]);
  return remaining > 0;
}

/* ---- Stop switch ---------------------------------------------------------------------------------------------- */

const stoppers = new Set<() => void>();

/**
 * Registers what `stopAgents()` must do. webmcp.ts registers "turn WebMCP off", companion.ts registers "turn the
 * bridge off and close open bridges". Returns an unregister function.
 */
export function onStopAgents(stop: () => void): () => void {
  stoppers.add(stop);
  return () => void stoppers.delete(stop);
}

/** The indicator's Stop: turns WebMCP registration and the Companion bridge off on this device and clears the light. */
export function stopAgents(): void {
  for (const stop of [...stoppers]) {
    try {
      stop();
    } catch {
      // one failing stopper must not keep the others from running
    }
  }
  stoppedAt = now();
  emit();
}

/** Test hook. */
export function resetAgentActivityForTests(clock?: () => number): void {
  entries = [];
  stoppedAt = 0;
  now = clock ?? (() => Date.now());
  emit();
}
