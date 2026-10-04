/**
 * The main side of every `vitals:` channel (../shared/bridge.ts). Each handler first checks that the message comes
 * from our page (`isAppSender`) and that the arguments have the shape the contract promises; the modules behind the
 * channels are passed in, typed by the slice used here, so this wires W2–W4's modules without importing them.
 */
import { AI_TOOL_IDS, CHANNELS, type AiToolId, type AiToolRow, type DesktopOs, type McpCallResponse, type McpServerInfo, type SecretKey } from '../shared/bridge';
import { isAppSender } from './security';

interface IpcEvent {
  senderFrame?: { url: string } | null;
  returnValue?: unknown;
}

export interface IpcMainSlice {
  on(channel: string, listener: (event: IpcEvent, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: IpcEvent, ...args: unknown[]) => void): unknown;
  handle(channel: string, listener: (event: IpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcDeps {
  ipcMain: IpcMainSlice;
  info: { version: string; os: DesktopOs };
  /** The tray, when there is one (it can be created after the window). */
  tray(): { setStatus(s: { ring?: string; sync?: string }): void } | null;
  autostart: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  updates: { check(): Promise<void>; restart(): void };
  aiTools: { list(): Promise<AiToolRow[]>; add(id: AiToolId): Promise<AiToolRow>; remove(id: AiToolId): Promise<AiToolRow> };
  relay: { handleResult(r: McpCallResponse): void; setManifest(m: unknown): void };
  setServer(info: McpServerInfo | null): void;
  secrets: { get(k: SecretKey): Promise<string | null>; set(k: SecretKey, v: string | null): Promise<void> };
  keepAlive(on: boolean, text: string): void;
}

const isToolId = (id: unknown): id is AiToolId => AI_TOOL_IDS.includes(id as AiToolId);
const isSecretKey = (k: unknown): k is SecretKey => typeof k === 'string' && k.startsWith('agentToken:') && isToolId(k.slice('agentToken:'.length));
const optText = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 200) : undefined);

/** Registers every handler; returns the function that removes them. */
export function registerIpc(d: IpcDeps): () => void {
  const { ipcMain } = d;
  const handled: string[] = [];
  const listened: Array<[string, (event: IpcEvent, ...args: unknown[]) => void]> = [];

  /** `ipcMain.handle` with the sender check; a foreign sender gets a rejection, never the handler. */
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    handled.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      if (!isAppSender(event)) throw new Error('not allowed');
      return fn(...args);
    });
  };
  const on = (channel: string, fn: (event: IpcEvent, ...args: unknown[]) => void): void => {
    const listener = (event: IpcEvent, ...args: unknown[]): void => {
      if (isAppSender(event)) fn(event, ...args);
    };
    listened.push([channel, listener]);
    ipcMain.on(channel, listener);
  };

  // `info` is synchronous (the preload reads it while it loads); a foreign sender gets null
  const infoListener = (event: IpcEvent): void => {
    event.returnValue = isAppSender(event) ? { ...d.info } : null;
  };
  listened.push([CHANNELS.info, infoListener]);
  ipcMain.on(CHANNELS.info, infoListener);

  on(CHANNELS.trayStatus, (_e, s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    d.tray()?.setStatus({ ring: optText(o.ring), sync: optText(o.sync) });
  });
  handle(CHANNELS.autostartGet, () => d.autostart.get());
  handle(CHANNELS.autostartSet, (on) => d.autostart.set(on === true));
  handle(CHANNELS.updatesCheck, () => d.updates.check());
  handle(CHANNELS.updatesRestart, () => d.updates.restart());
  handle(CHANNELS.mcpTools, () => d.aiTools.list());
  handle(CHANNELS.mcpAdd, (id) => {
    if (!isToolId(id)) throw new Error('unknown AI tool');
    return d.aiTools.add(id);
  });
  handle(CHANNELS.mcpRemove, (id) => {
    if (!isToolId(id)) throw new Error('unknown AI tool');
    return d.aiTools.remove(id);
  });
  on(CHANNELS.mcpResult, (_e, r) => {
    const o = r as Partial<McpCallResponse> | null;
    if (o && typeof o.callId === 'string') d.relay.handleResult({ callId: o.callId, envelope: o.envelope });
  });
  on(CHANNELS.mcpManifest, (_e, m) => d.relay.setManifest(m ?? null));
  on(CHANNELS.mcpServer, (_e, info) => {
    const o = info as Partial<McpServerInfo> | null;
    d.setServer(o && typeof o.mcpUrl === 'string' ? { mcpUrl: o.mcpUrl } : null);
  });
  handle(CHANNELS.secretsGet, (k) => {
    if (!isSecretKey(k)) throw new Error('unknown secret');
    return d.secrets.get(k);
  });
  handle(CHANNELS.secretsSet, (k, v) => {
    if (!isSecretKey(k)) throw new Error('unknown secret');
    if (v !== null && typeof v !== 'string') throw new Error('a secret is text or null');
    return d.secrets.set(k, v);
  });
  on(CHANNELS.keepAlive, (_e, keep, text) => d.keepAlive(keep === true, typeof text === 'string' ? text.slice(0, 200) : ''));

  return () => {
    for (const c of handled) ipcMain.removeHandler(c);
    for (const [c, l] of listened) ipcMain.removeListener(c, l);
  };
}
