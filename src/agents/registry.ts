/**
 * Where the command bus plugs into the agent surfaces, without React (the bus side, `src/commands/ai`, installs its
 * `AgentDispatcher` from a headless module). `./dispatcher.ts` re-exports these and adds the React binding.
 *
 * - `setAgentDispatcher` / `getAgentDispatcher`: the dispatcher every surface uses (null until the bus installs one,
 *   and then every surface stays dark).
 * - `setDirectApplyPolicy`: the person's per-client "may apply plan edits directly" setting (SUITE_SPEC §1.4,
 *   Settings › Agents, `agents.configure`). Default: never.
 */
import type { ExternalSurface, ToolManifest, ToolResultEnvelope } from './manifest';

export interface AgentActor {
  kind: ExternalSurface;
  /** `webmcp`, or the MCP client's name. */
  id: string;
}

export interface AgentCallOptions {
  actor: AgentActor;
  /** ≤ 64 chars (SUITE_SPEC §1.3). */
  idempotencyKey?: string;
  /**
   * Stage as a pending change for the person to apply; never apply directly. False for a consequential write only
   * when the person let this client apply plan edits directly (`directApplyAllowed`).
   */
  stage: boolean;
  /** The turn this call belongs to for the bus's per-turn limits. Without one every call of the current minute shares a turn. */
  correlationId?: string;
  signal?: AbortSignal;
}

export interface AgentDispatcher {
  /** The full manifest (`vitals.tools/1`); surfaces filter it with `toolsFor`. */
  manifest(): ToolManifest | Promise<ToolManifest>;
  /** Runs one command for an external agent. Must honour `stage` and `actor`; should never throw. */
  call(commandId: string, args: Record<string, unknown>, opts: AgentCallOptions): Promise<ToolResultEnvelope>;
}

export interface RegistrySnapshot {
  dispatcher: AgentDispatcher | null;
  /** Bumped by `setAgentDispatcher` and `notifyAgentManifestChanged`; surfaces re-read the manifest when it changes. */
  version: number;
}

let snapshot: RegistrySnapshot = { dispatcher: null, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The bus calls this once at boot (and `null` on teardown). */
export function setAgentDispatcher(dispatcher: AgentDispatcher | null): void {
  snapshot = { dispatcher, version: snapshot.version + 1 };
  emit();
}

export function getAgentDispatcher(): AgentDispatcher | null {
  return snapshot.dispatcher;
}

/** The bus calls this when the command registry (and so the manifest) changes at runtime. */
export function notifyAgentManifestChanged(): void {
  snapshot = { ...snapshot, version: snapshot.version + 1 };
  emit();
}

export function subscribeAgentDispatcher(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getAgentRegistrySnapshot(): RegistrySnapshot {
  return snapshot;
}

/* ---- direct apply --------------------------------------------------------------------------------------------- */

export type DirectApplyPolicy = (actor: AgentActor) => boolean;

let directApply: DirectApplyPolicy | null = null;

/** Installs the person's per-client direct-apply setting (the bus does, from `agents.configure`). */
export function setDirectApplyPolicy(policy: DirectApplyPolicy | null): void {
  directApply = policy;
}

/** Whether the person let this agent apply plan edits directly. False when no policy is installed or it throws. */
export function directApplyAllowed(actor: AgentActor): boolean {
  try {
    return directApply?.(actor) === true;
  } catch {
    return false;
  }
}
