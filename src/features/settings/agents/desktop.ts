/**
 * The page's structural copy of the parts of the desktop app's preload bridge (`window.vitalsDesktop`,
 * `apps/desktop/src/shared/bridge.ts` `DesktopBridge`) that Settings › Agents and the MCP host use. The page never
 * imports desktop code; keep these shapes in step with that file.
 */

export type AiToolId = 'claude-code' | 'codex' | 'opencode' | 'chatgpt-desktop';

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
  /** False when Add cannot be offered on this row. */
  canAdd?: boolean;
}

export type SecretKey = `agentToken:${AiToolId}`;

export interface McpServerInfo {
  mcpUrl: string;
}

export interface DesktopMcpBridge {
  mcp: {
    tools(): Promise<AiToolRow[]>;
    /** Only from the consent dialog's confirm handler: main checks for a fresh user gesture. */
    add(id: AiToolId): Promise<AiToolRow>;
    remove(id: AiToolId): Promise<AiToolRow>;
    /** One handler; a new one replaces the old. */
    onCall(handler: (call: { client: string; tool: string; args: unknown; idempotencyKey?: string }) => Promise<unknown>): () => void;
    setManifest(manifest: unknown): void;
    setServer(info: McpServerInfo | null): void;
  };
  /** Write only: the page hands a key to the app and can never read it back. */
  secrets: {
    set(key: SecretKey, value: string | null): Promise<void>;
    /** False when the computer has no keyring: the app forgets the keys when it quits. */
    persistent?: boolean;
  };
}

/** The desktop bridge, or undefined outside the desktop app. */
export function desktopBridge(): DesktopMcpBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const b = (window as Window & { vitalsDesktop?: Partial<DesktopMcpBridge> }).vitalsDesktop;
  return b && typeof b.mcp === 'object' && b.mcp && typeof b.secrets === 'object' && b.secrets ? (b as DesktopMcpBridge) : undefined;
}
