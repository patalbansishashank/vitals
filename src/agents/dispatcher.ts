/**
 * The seam between the agent surfaces (WebMCP in this tab, MCP clients through the Companion bridge) and the command
 * bus. The bus implements `AgentDispatcher` (`src/commands/ai/agentDispatcher.ts`) and installs it at boot with
 * `setAgentDispatcher()` (`./registry.ts`, headless); until then every surface stays dark.
 *
 * `guardedCall` re-checks the SUITE_SPEC §1.4 rules before any call reaches the dispatcher, whatever the dispatcher
 * does (defence in depth): only tools exposed to the calling surface, never destructive ones, consequential writes
 * staged as proposals — unless the person let this client apply plan edits directly (Settings › Agents) and the
 * caller did not insist on staging (`opts.stage: true`). The Companion bridge's `call.stage` is informational
 * (`bridgeProtocol.ts`): the bridge client does not pass it, so MCP clients get the same direct-apply rule as WebMCP.
 */
import { useSyncExternalStore } from 'react';
import { recordAgentActivity } from './activity';
import { exposedTo, mustStage, rejected, type ExternalSurface, type ToolManifest, type ToolManifestEntry, type ToolResultEnvelope } from './manifest';
import { directApplyAllowed, getAgentRegistrySnapshot, subscribeAgentDispatcher, type AgentActor, type AgentDispatcher, type RegistrySnapshot } from './registry';

export {
  directApplyAllowed,
  getAgentDispatcher,
  notifyAgentManifestChanged,
  setAgentDispatcher,
  setDirectApplyPolicy,
  subscribeAgentDispatcher,
  type AgentActor,
  type AgentCallOptions,
  type AgentDispatcher,
  type DirectApplyPolicy,
} from './registry';

/** `{dispatcher, version}`; re-renders when the bus sets the dispatcher or reports a manifest change. */
export function useAgentDispatcher(): RegistrySnapshot {
  return useSyncExternalStore(subscribeAgentDispatcher, getAgentRegistrySnapshot, getAgentRegistrySnapshot);
}

/* ---- guarded call --------------------------------------------------------------------------------------------- */

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

const isEnvelope = (v: unknown): v is ToolResultEnvelope =>
  isPlainObject(v) &&
  typeof v.ok === 'boolean' &&
  typeof v.summary === 'string' &&
  (v.status === 'applied' || v.status === 'pending_user' || v.status === 'needs_choice' || v.status === 'rejected' || v.status === 'running');

/** Finds a tool by name (`log_meal`) or command id (`log.meal`). */
export function findTool(manifest: ToolManifest, nameOrId: string): ToolManifestEntry | undefined {
  return manifest.tools.find((t) => t.name === nameOrId) ?? manifest.tools.find((t) => t.id === nameOrId);
}

/**
 * Runs one external-agent tool call through `dispatcher` after enforcing the surface rules. Never throws: every
 * failure becomes a `rejected` envelope. Records the call for the activity indicator.
 */
export async function guardedCall(
  dispatcher: AgentDispatcher | null,
  manifest: ToolManifest,
  surface: ExternalSurface,
  toolName: string,
  args: unknown,
  opts: { actor: AgentActor; idempotencyKey?: string; stage?: boolean; correlationId?: string; signal?: AbortSignal },
): Promise<ToolResultEnvelope> {
  const actorId = typeof opts.actor?.id === 'string' && opts.actor.id ? opts.actor.id.slice(0, 128) : surface;
  const finish = (envelope: ToolResultEnvelope, tool = toolName): ToolResultEnvelope => {
    recordAgentActivity({ surface, actor: actorId, tool: String(tool).slice(0, 64), status: envelope.status });
    return envelope;
  };

  const tool = typeof toolName === 'string' ? findTool(manifest, toolName) : undefined;
  if (!tool || !exposedTo(tool, surface)) {
    return finish(rejected('surface_forbidden', `The tool ${JSON.stringify(String(toolName))} is not available to this agent.`));
  }
  if (!isPlainObject(args)) return finish(rejected('invalid_input', 'Tool arguments must be a JSON object.'), tool.name);
  if (!dispatcher) return finish(rejected('internal', 'Vitals is not ready for agents yet.'), tool.name);
  if (opts.signal?.aborted) return finish(rejected('cancelled', 'The call was cancelled.'), tool.name);

  const idempotencyKey = typeof opts.idempotencyKey === 'string' && opts.idempotencyKey ? opts.idempotencyKey.slice(0, 64) : undefined;
  try {
    const envelope = await dispatcher.call(tool.id, args, {
      // the actor kind always matches the surface the call arrived on
      actor: { kind: surface, id: actorId },
      ...(idempotencyKey ? { idempotencyKey } : {}),
      stage: opts.stage === true || (mustStage(tool) && !directApplyAllowed({ kind: surface, id: actorId })),
      ...(opts.correlationId ? { correlationId: opts.correlationId.slice(0, 64) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!isEnvelope(envelope)) return finish(rejected('internal', 'Vitals returned an unexpected result.'), tool.name);
    return finish(envelope, tool.name);
  } catch (e) {
    if (opts.signal?.aborted) return finish(rejected('cancelled', 'The call was cancelled.'), tool.name);
    const message = e instanceof Error && e.message ? e.message : 'Something went wrong in Vitals.';
    return finish(rejected('internal', message), tool.name);
  }
}
