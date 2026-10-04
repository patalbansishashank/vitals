/**
 * The desktop app's contract between the main process, the preload and the page (SUITE_SPEC §15.6). The page declares
 * the same shape structurally (`src/platform/bridge.ts`, `src/features/settings/agents/desktop.ts`); it never imports
 * desktop code. Every channel starts with `vitals:` and main rejects a call whose sender frame is not `app://vitals`.
 *
 * Bluetooth is L-XPORT's (`../ble/contract.ts`) and is exposed as `window.vitalsDesktop.bluetooth`.
 */
import type { DesktopBluetoothBridge } from '../ble/contract';

export const APP_SCHEME = 'app';
export const APP_HOST = 'vitals';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Command-line flags of the app binary. */
export const FLAGS = {
  /** Start in the tray, no window (autostart). */
  hidden: '--hidden',
  /** Run as a stdio MCP server for an AI tool (no window); `--client <AiToolId>` names the tool. */
  mcp: '--mcp',
  client: '--client',
} as const;

export const CHANNELS = {
  info: 'vitals:info', // sync (sendSync) → { version, os }
  trayStatus: 'vitals:tray:status',
  autostartGet: 'vitals:autostart:get',
  autostartSet: 'vitals:autostart:set',
  updatesState: 'vitals:updates:state', // main → page
  updatesCheck: 'vitals:updates:check',
  updatesRestart: 'vitals:updates:restart',
  mcpTools: 'vitals:mcp:tools',
  mcpAdd: 'vitals:mcp:add',
  mcpRemove: 'vitals:mcp:remove',
  mcpCall: 'vitals:mcp:call', // main → page: McpCallRequest
  mcpResult: 'vitals:mcp:result', // page → main: McpCallResponse
  mcpManifest: 'vitals:mcp:manifest', // page → main: the tool manifest (or null)
  mcpServer: 'vitals:mcp:server', // page → main: McpServerInfo | null
  secretsGet: 'vitals:secrets:get',
  secretsSet: 'vitals:secrets:set',
  keepAlive: 'vitals:keepalive',
  show: 'vitals:show', // main → page: the window was shown (ShellBridge.onResume)
  syncNow: 'vitals:sync:now', // main → page: the tray's "Sync now"
} as const;

export type DesktopOs = 'linux' | 'win32' | 'darwin';

export type AiToolId = 'claude-code' | 'codex' | 'opencode' | 'chatgpt-desktop';
export const AI_TOOL_IDS: readonly AiToolId[] = ['claude-code', 'codex', 'opencode', 'chatgpt-desktop'];

export interface AiToolRow {
  id: AiToolId;
  label: string;
  /** The tool's program or config was found on this computer. */
  found: boolean;
  /** The Vitals entry is in the tool's config. */
  added: boolean;
  /** The file that changes (or, for Claude Code, the file its own CLI changes). */
  file?: string;
  /** Exactly what Add writes (the lines, or the command that is run). */
  preview?: string;
  /** One plain line for the person (for example "Needs your Vitals server"). */
  note?: string;
  /** False when Add cannot be offered on this row (not found, or remote-only without a server). */
  canAdd?: boolean;
}

export type UpdateState = { state: 'idle' | 'checking' | 'downloading' | 'ready' | 'manual' | 'error'; version?: string; url?: string };

/** Main → page: run one MCP tool call through the command bus. */
export interface McpCallRequest {
  callId: string;
  /** The AI tool's MCP client name (sanitised, ≤ 64 chars). */
  client: string;
  tool: string;
  args: unknown;
  /** Write tools with `idempotency: 'key'`: the key main derives from (client, session, JSON-RPC id), SUITE_SPEC §1.6. */
  idempotencyKey?: string;
}
/** Page → main: the result envelope (`ToolResultEnvelope` from packages/companion/src/toolManifest.ts). */
export interface McpCallResponse {
  callId: string;
  envelope: unknown;
}

/** What main needs to forward to the paired server's `/mcp` (the agent tokens themselves go through `secrets`). */
export interface McpServerInfo {
  mcpUrl: string;
}

/** Secrets kept by main with Electron `safeStorage`; never written to an AI tool's config. One agent token per tool. */
export type SecretKey = `agentToken:${AiToolId}`;

export interface DesktopBridge {
  version: string;
  os: DesktopOs;
  bluetooth: DesktopBluetoothBridge;
  tray: { setStatus(s: { ring?: string; sync?: string }): void };
  autostart: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  updates: {
    onState(cb: (s: UpdateState) => void): () => void;
    check(): Promise<void>;
    restart(): void;
  };
  mcp: {
    tools(): Promise<AiToolRow[]>;
    /** Only from the consent dialog's confirm handler (a user gesture); writes exactly the row's preview. */
    add(id: AiToolId): Promise<AiToolRow>;
    remove(id: AiToolId): Promise<AiToolRow>;
    /** The page runs calls from AI tools when no server is paired. One handler; a new one replaces the old. */
    onCall(handler: (call: { client: string; tool: string; args: unknown; idempotencyKey?: string }) => Promise<unknown>): () => void;
    /** The page's current tool manifest (null while the command bus is not ready). */
    setManifest(manifest: unknown): void;
    /** The paired server's MCP address, or null when no server is paired. */
    setServer(info: McpServerInfo | null): void;
  };
  secrets: { get(key: SecretKey): Promise<string | null>; set(key: SecretKey, value: string | null): Promise<void> };
  /** ShellBridge on desktop: tray status line, and keeps the window running in the background. */
  keepAlive(on: boolean, text: string): void;
  /** The window was shown again (from the tray or a second launch). */
  onShow(cb: () => void): () => void;
  /** The person chose "Sync now" in the tray. */
  onSyncNow(cb: () => void): () => void;
}
