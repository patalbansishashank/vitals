/**
 * WebMCP in the PWA (SUITE_SPEC §7.3): while Settings › Agents › "agents in this browser" is on (default off) and the
 * browser offers `modelContext`, every `webmcp`-surface tool from the manifest is registered with
 * `modelContext.registerTool({name, description, inputSchema, annotations, execute})` and executes through
 * `guardedCall` with actor `{kind:'webmcp'}`. Destructive tools are never registered (`toolsFor` drops them) and are
 * refused again in `guardedCall`; consequential writes are staged as proposals.
 *
 * API (W3C WebML CG draft, https://webmachinelearning.github.io/webmcp/): `document.modelContext` (older Chrome builds:
 * `navigator.modelContext`). Registration handles differ between builds — an AbortSignal option, a returned
 * `{unregister()}`, or `unregisterTool(name)` — so each is used defensively. Chromium 153 (`--enable-features=WebMCP`,
 * verified over CDP in E22): `document.modelContext.registerTool(tool, {signal})` returns `Promise<undefined>` that
 * rejects on a duplicate or invalid tool, has no `unregisterTool`, and unregisters on abort.
 *
 * Polyfill hook: SUITE_SPEC mentions bundling `@mcp-b/global`. It is NOT a dependency here. If E4/I1 add it, import it
 * for its side effect before `useWebMcpRegistration` first runs (it installs `navigator.modelContext` /
 * `document.modelContext`); `getModelContext()` then finds it with no other change. Note the polyfill makes
 * `isWebMcpSupported()` always true.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { onStopAgents } from './activity';
import { createDeviceFlag, useDeviceFlag } from './deviceFlag';
import { guardedCall, useAgentDispatcher, type AgentDispatcher } from './dispatcher';
import { toolsFor, type JsonSchema, type ToolManifest, type ToolResultEnvelope } from './manifest';

/* ---- local typing of the WebMCP API (no dependency) ----------------------------------------------------------- */

export interface WebMcpToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
  execute: (input: unknown, client?: unknown) => Promise<WebMcpToolResult>;
}

/** MCP `CallToolResult` shape, which WebMCP clients and the MCP-B relay pass through unchanged. */
export interface WebMcpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ModelContextLike {
  registerTool(tool: WebMcpToolDescriptor, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

const isModelContext = (v: unknown): v is ModelContextLike =>
  typeof v === 'object' && v !== null && typeof (v as { registerTool?: unknown }).registerTool === 'function';

/** `document.modelContext`, else `navigator.modelContext`, else null. */
export function getModelContext(): ModelContextLike | null {
  const fromDoc = typeof document === 'undefined' ? undefined : (document as unknown as { modelContext?: unknown }).modelContext;
  if (isModelContext(fromDoc)) return fromDoc;
  const fromNav = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { modelContext?: unknown }).modelContext;
  return isModelContext(fromNav) ? fromNav : null;
}

export function isWebMcpSupported(): boolean {
  return getModelContext() !== null;
}

/** The single place an envelope becomes a WebMCP result: the envelope as JSON text. */
export function toWebMcpResult(envelope: ToolResultEnvelope): WebMcpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }], ...(envelope.ok ? {} : { isError: true }) };
}

/* ---- setting -------------------------------------------------------------------------------------------------- */

/** Device-local (never exported or synced), default off. */
export const webMcpFlag = createDeviceFlag('vitals-agents.webmcp', false);

export function isWebMcpEnabled(): boolean {
  return webMcpFlag.get();
}

export function setWebMcpEnabled(on: boolean): void {
  webMcpFlag.set(on);
}

export function useWebMcpEnabled(): [boolean, (on: boolean) => void] {
  return useDeviceFlag(webMcpFlag);
}

onStopAgents(() => setWebMcpEnabled(false));

/* ---- registration --------------------------------------------------------------------------------------------- */

let keyCounter = 0;
function newIdempotencyKey(): string {
  try {
    return `webmcp:${globalThis.crypto.randomUUID()}`;
  } catch {
    keyCounter += 1;
    return `webmcp:${Date.now().toString(36)}-${keyCounter}`;
  }
}

/**
 * Registers every `webmcp` tool of `manifest`; returns a function that unregisters all of them (idempotent).
 * A tool call made after unregistering, or while the setting is off, is refused.
 */
export function registerWebMcpTools(manifest: ToolManifest, dispatcher: AgentDispatcher, ctx: ModelContextLike | null = getModelContext()): () => void {
  if (!ctx) return () => undefined;
  let active = true;
  const handles: Array<() => void> = [];

  for (const tool of toolsFor(manifest, 'webmcp')) {
    const controller = new AbortController();
    const descriptor: WebMcpToolDescriptor = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.annotations.readOnlyHint, destructiveHint: tool.annotations.destructiveHint },
      execute: async (input) => {
        if (!active || !isWebMcpEnabled()) {
          return toWebMcpResult({ ok: false, status: 'rejected', summary: 'Vitals tools are turned off.', error: { code: 'surface_forbidden', message: 'Vitals tools are turned off.' } });
        }
        // WebMCP gives no request id, so each call gets a fresh key (no retry dedupe across calls).
        const envelope = await guardedCall(dispatcher, manifest, 'webmcp', tool.name, input ?? {}, {
          actor: { kind: 'webmcp', id: 'webmcp' },
          idempotencyKey: newIdempotencyKey(),
        });
        return toWebMcpResult(envelope);
      },
    };

    let result: unknown;
    const register = (retry: boolean): unknown => {
      const r = ctx.registerTool(descriptor, { signal: controller.signal });
      // Chromium 153 returns a Promise and reports a duplicate or invalid tool by rejecting it (never by throwing)
      if (isThenable(r)) {
        r.then(undefined, () => {
          if (!retry || controller.signal.aborted || !ctx.unregisterTool) return;
          try {
            ctx.unregisterTool(tool.name);
            result = register(false);
          } catch {
            // left unregistered
          }
        });
      }
      return r;
    };
    try {
      result = register(true);
    } catch {
      // probably left registered by an earlier page state: drop it and try once more
      try {
        ctx.unregisterTool?.(tool.name);
        result = register(false);
      } catch {
        continue;
      }
    }
    handles.push(() => {
      controller.abort();
      const handle = result as { unregister?: unknown } | null | undefined;
      try {
        if (handle && typeof handle === 'object' && typeof handle.unregister === 'function') (handle.unregister as () => void)();
        else ctx.unregisterTool?.(tool.name);
      } catch {
        // already gone
      }
    });
  }

  return () => {
    if (!active) return;
    active = false;
    for (const h of handles) h();
  };
}

/* ---- React ---------------------------------------------------------------------------------------------------- */

const noopSubscribe = () => () => undefined;

/** Whether `modelContext` exists (checked once per render; the polyfill or a flag can add it before boot). */
export function useWebMcpSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, isWebMcpSupported, () => false);
}

/**
 * Keeps the WebMCP registration in step with the setting, the dispatcher (E4) and the manifest: registers while all
 * three exist, re-registers when the manifest hash changes, unregisters when the setting turns off or on unmount.
 * Mount once near the app root (`<AgentSurfaces />`). Returns the number of tools registered.
 */
export function useWebMcpRegistration(ctx?: ModelContextLike | null): number {
  const [enabled] = useWebMcpEnabled();
  const { dispatcher, version } = useAgentDispatcher();
  const context = ctx === undefined ? getModelContext() : ctx;
  const [manifest, setManifest] = useState<ToolManifest | null>(null);

  useEffect(() => {
    if (!enabled || !dispatcher || !context) return;
    let live = true;
    void Promise.resolve()
      .then(() => dispatcher.manifest())
      .then((m) => {
        if (live) setManifest((prev) => (prev && prev.hash === m.hash ? prev : m));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled, dispatcher, context, version]);

  const ready = enabled && dispatcher && context && manifest ? manifest : null;
  useEffect(() => {
    if (!ready || !dispatcher || !context) return;
    return registerWebMcpTools(ready, dispatcher, context);
  }, [ready, dispatcher, context]);

  return ready ? toolsFor(ready, 'webmcp').length : 0;
}
