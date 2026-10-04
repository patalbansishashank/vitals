/**
 * The preload: `window.vitalsDesktop`, the `DesktopBridge` of ../shared/bridge.ts, over IPC. Sandboxed, so nothing
 * from Node is used here: only `electron` (scripts/build.mjs bundles the rest to one CommonJS file).
 */
import { contextBridge, ipcRenderer } from 'electron';
import { bluetoothBridge } from '../ble/preload';
import {
  AI_TOOL_IDS,
  CHANNELS,
  type AiToolId,
  type AiToolRow,
  type DesktopBridge,
  type DesktopOs,
  type McpCallRequest,
  type McpCallResponse,
  type McpServerInfo,
  type SecretKey,
  type UpdateState,
} from '../shared/bridge';

type Listener = (event: unknown, ...args: unknown[]) => void;

/** Subscribe to a main → page channel; returns the unsubscribe. */
function on<T>(channel: string, cb: (value: T) => void): () => void {
  const listener: Listener = (_e, value) => cb(value as T);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
}

const info = ipcRenderer.sendSync(CHANNELS.info) as { version?: unknown; os?: unknown; secretsPersistent?: unknown } | null;
const version = typeof info?.version === 'string' ? info.version : '0.0.0';
const os: DesktopOs = info?.os === 'win32' || info?.os === 'darwin' ? info.os : 'linux';
const secretsPersistent = info?.secretsPersistent !== false;

const isToolId = (id: unknown): id is AiToolId => AI_TOOL_IDS.includes(id as AiToolId);
const badId = (): Promise<never> => Promise.reject(new Error('unknown AI tool'));

/** The page's one handler for calls from AI tools; a call with no handler is rejected, never left hanging. */
let callHandler: ((call: { client: string; tool: string; args: unknown; idempotencyKey?: string }) => Promise<unknown>) | null = null;
ipcRenderer.on(CHANNELS.mcpCall, (_e, req: McpCallRequest) => {
  const reply = (envelope: unknown): void => void ipcRenderer.send(CHANNELS.mcpResult, { callId: req.callId, envelope } satisfies McpCallResponse);
  const rejected = (code: string, message: string) => ({ ok: false, status: 'rejected', summary: message, error: { code, message } });
  if (!callHandler) {
    reply(rejected('page_not_ready', 'Vitals is still starting; try again in a moment.'));
    return;
  }
  const idempotencyKey = typeof req.idempotencyKey === 'string' && req.idempotencyKey ? req.idempotencyKey.slice(0, 64) : undefined;
  callHandler({ client: req.client, tool: req.tool, args: req.args, ...(idempotencyKey ? { idempotencyKey } : {}) }).then(reply, (e: unknown) => reply(rejected('page_error', e instanceof Error ? e.message : String(e))));
});

const bridge: DesktopBridge = {
  version,
  os,
  bluetooth: bluetoothBridge(ipcRenderer),
  tray: {
    setStatus: (s) => ipcRenderer.send(CHANNELS.trayStatus, { ring: s.ring, sync: s.sync }),
  },
  autostart: {
    get: () => ipcRenderer.invoke(CHANNELS.autostartGet) as Promise<boolean>,
    set: (on) => ipcRenderer.invoke(CHANNELS.autostartSet, on === true) as Promise<void>,
  },
  updates: {
    onState: (cb) => on<UpdateState>(CHANNELS.updatesState, cb),
    check: () => ipcRenderer.invoke(CHANNELS.updatesCheck) as Promise<void>,
    restart: () => void ipcRenderer.invoke(CHANNELS.updatesRestart),
  },
  mcp: {
    tools: () => ipcRenderer.invoke(CHANNELS.mcpTools) as Promise<AiToolRow[]>,
    add(id) {
      if (!isToolId(id)) return badId();
      // only from a click in the consent dialog: a script cannot add Vitals to an AI tool on its own (main also checks
      // for a real click or key press, since the page can be given activation without one)
      if (!navigator.userActivation?.isActive) return Promise.reject(new Error('Add needs a click in the dialog.'));
      return ipcRenderer.invoke(CHANNELS.mcpAdd, id) as Promise<AiToolRow>;
    },
    remove: (id) => (isToolId(id) ? (ipcRenderer.invoke(CHANNELS.mcpRemove, id) as Promise<AiToolRow>) : badId()),
    onCall(handler) {
      callHandler = handler;
      return () => {
        if (callHandler === handler) callHandler = null;
      };
    },
    setManifest: (manifest) => ipcRenderer.send(CHANNELS.mcpManifest, manifest ?? null),
    setServer: (info: McpServerInfo | null) => ipcRenderer.send(CHANNELS.mcpServer, info && typeof info.mcpUrl === 'string' ? { mcpUrl: info.mcpUrl } : null),
  },
  secrets: {
    set: (key: SecretKey, value) => ipcRenderer.invoke(CHANNELS.secretsSet, key, value ?? null) as Promise<void>,
    persistent: secretsPersistent,
  },
  keepAlive: (keep, text) => ipcRenderer.send(CHANNELS.keepAlive, keep === true, String(text ?? '')),
  onShow: (cb) => on<void>(CHANNELS.show, () => cb()),
  onSyncNow: (cb) => on<void>(CHANNELS.syncNow, () => cb()),
};

contextBridge.exposeInMainWorld('vitalsDesktop', bridge);
