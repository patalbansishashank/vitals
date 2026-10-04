/**
 * Wire protocol between an open Vitals tab and the Companion's agent hub (SUITE_SPEC §7.3), over the WebSocket
 * `/v1/agent/bridge` on the Companion's one localhost port. The tab publishes its tool manifest and executes tool calls
 * that MCP clients send to the Companion; the Companion never executes commands itself in the relay/proxy roles.
 *
 * Shared source: the app imports these types (`src/agents/companion.ts`), so no Node or DOM APIs here.
 *
 * Auth: browsers cannot set headers on a WebSocket, so the first frame is `hello` with the local pairing token
 * (from `POST /v1/pair/local`). The Companion closes the socket (4401) if `hello` is missing, late (5 s) or wrong,
 * and checks `Origin` at the upgrade like every other route.
 */
import type { ToolManifest, ToolResultEnvelope } from './toolManifest.ts';

export const BRIDGE_PATH = '/v1/agent/bridge';
export const BRIDGE_PROTOCOL = 'vitals-bridge.v1';
/** Close codes. */
export const BRIDGE_CLOSE = { unauthorized: 4401, badMessage: 4400, replaced: 4409 } as const;

/** Tab → Companion. */
export type TabMessage =
  | { type: 'hello'; token: string; manifest: ToolManifest }
  | { type: 'manifest'; manifest: ToolManifest }
  | { type: 'result'; callId: string; envelope: ToolResultEnvelope };

/** Companion → tab. */
export type CompanionMessage =
  | { type: 'ready'; companionVersion: string; toolCount: number }
  | {
      type: 'call';
      callId: string;
      /** Command id (`log.meal`) and tool name (`log_meal`). */
      commandId: string;
      tool: string;
      args: Record<string, unknown>;
      /** Always `mcp` from the Companion; the MCP client's name goes in `clientName`. */
      actor: { kind: 'mcp'; id: string };
      /** SUITE_SPEC §1.6: MCP keys derive from (clientName, requestId). ≤ 64 chars. */
      idempotencyKey: string;
      /**
       * Consequential write (`mustStage(entry)`): the tab stages it as a pending change, unless the person let this MCP
       * client (`actor.id`) apply plan edits directly in Settings › Agents. Only the tab knows that setting, so the tab
       * decides, from its own manifest (`guardedCall`); this flag is informational, not binding.
       */
      stage: boolean;
    }
  | { type: 'cancel'; callId: string }
  | { type: 'error'; message: string };

/** How long the Companion waits for a tab's `result` before answering the MCP client with `running`/timeout. */
export const CALL_TIMEOUT_MS = 30_000;
