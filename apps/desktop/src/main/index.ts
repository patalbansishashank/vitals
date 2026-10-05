/**
 * The desktop app's main process (SUITE_SPEC §15.6). `--mcp` is handled first: that run is a stdio MCP bridge for an
 * AI tool and never opens a window. Otherwise: one window on `app://vitals/`, the tray, autostart, updates, the MCP
 * host and the AI-tools wiring, all behind the `vitals:` channels (ipc.ts). `VITALS_SMOKE=1` loads the page, waits for
 * it to render and exits 0 (or 1 on a failure) within a minute, for the release workflow.
 */
import { maybeRunMcp, mcpArgs } from '../mcp/launch';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, powerSaveBlocker, protocol, safeStorage, screen, session, shell, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import { attachBluetooth, enableWebBluetooth } from '../ble/main';
import { createMcpHost } from './mcpHost';
import { createPageRelay } from './pageRelay';
import { createSecrets } from './secrets';
import { mcpSocketPath } from '../shared/mcpSocket';
import { createNodeAiTools } from './aiTools';
import { APP_ORIGIN, CHANNELS, FLAGS, type AiToolId, type DesktopOs, type McpServerInfo } from '../shared/bridge';
import { createAutostart } from './autostart';
import { registerIpc, watchRealInput } from './ipc';
import { DOWNLOAD_URL, packageKind, resourcePaths, secretsFile, selfCommand, windowStateFile } from './paths';
import { SCHEME_PRIVILEGES, createAppHandler } from './protocol';
import { WEB_PREFERENCES, applySecurity } from './security';
import { createTray } from './tray';
import { createUpdates } from './updates';
import { MIN_SIZE, createMainWindow } from './window';

/** netlify.toml's Content-Security-Policy, compiled in by scripts/build.mjs. */
declare const __VITALS_CSP__: string;

const APP_ID = 'desi.creative.vitals';
const SMOKE = process.env.VITALS_SMOKE === '1';
const log = (line: string): void => void process.stderr.write(`vitals: ${line}\n`);

/** dist/mcp.cjs sits next to this file; electron-builder unpacks it from the asar so Node can run it directly. */
const mcpScript = path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'mcp.cjs');

// the `--mcp` parent only waits for its bridge child: it must start without a display (an AI tool run over ssh).
// Chromium has already picked its display platform by now, so the switch below does not stop an X11 start from
// failing; the entries AI tools run carry `--ozone-platform=headless` themselves (mcp/launch.ts `mcpArgs`).
if (process.argv.includes(FLAGS.mcp)) {
  app.commandLine.appendSwitch('ozone-platform', 'headless');
  app.disableHardwareAcceleration();
}
if (!maybeRunMcp({ argv: process.argv, execPath: process.execPath, mcpScript, env: process.env })) startShell();

function startShell(): void {
  app.setName('Vitals');
  app.setAppUserModelId(APP_ID);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  protocol.registerSchemesAsPrivileged([SCHEME_PRIVILEGES]);
  enableWebBluetooth(app);

  const platform = process.platform;
  const osName: DesktopOs = platform === 'win32' || platform === 'darwin' ? platform : 'linux';
  const res = resourcePaths(app.getAppPath(), platform);
  const self = selfCommand({ appImage: process.env.APPIMAGE, packaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath() });
  const kind = packageKind({ env: process.env, platform, packaged: app.isPackaged });
  // the smoke run never shows its window: it only has to load and render
  const startHidden = SMOKE || process.argv.includes(FLAGS.hidden) || (platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);

  // a second launch shows the window, unless it was a hidden start (autostart, or an AI tool's bridge starting the app)
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes(FLAGS.hidden)) shellState.show?.();
  });
  app.on('activate', () => shellState.show?.());

  void app.whenReady().then(() => {
    const userData = app.getPath('userData');
    applySecurity({ app, session, shell });
    protocol.handle(
      'app',
      createAppHandler({
        webDir: res.webDir,
        csp: __VITALS_CSP__,
        isFile: (file) => {
          try {
            return statSync(file).isFile();
          } catch {
            return false;
          }
        },
        body: async (file) => {
          const r = await net.fetch(pathToFileURL(file).toString());
          if (!r.ok || !r.body) throw new Error(`cannot read ${file}`);
          return r.body;
        },
      }),
    );
    if (platform !== 'darwin') Menu.setApplicationMenu(null);

    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    let trayHandle: ReturnType<typeof createTray> = null;
    const main = createMainWindow({
      stateFile: windowStateFile(userData),
      workAreas,
      startHidden,
      hasTray: () => trayHandle !== null,
      quit: () => app.quit(),
      make: (o) =>
        new BrowserWindow({
          ...o,
          minWidth: MIN_SIZE.width,
          minHeight: MIN_SIZE.height,
          title: 'Vitals',
          autoHideMenuBar: true,
          backgroundColor: '#181a1c',
          ...(platform === 'linux' ? { icon: nativeImage.createFromPath(res.appIcon) } : {}),
          webPreferences: { ...WEB_PREFERENCES, preload: res.preload },
        }),
      onShown: () => send(CHANNELS.show),
    });
    const { win } = main;
    shellState.show = () => main.show();
    const send = (channel: string, ...args: unknown[]): void => {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args);
    };
    // only the app's own page may be given the click's worth of activation a reconnect without a click needs
    const detachBluetooth = attachBluetooth(win.webContents, ipcMain, { allowActivation: (url) => url.startsWith(`${APP_ORIGIN}/`) });

    // --- the modules behind the channels ---------------------------------------------------------------------------
    const autostart = createAutostart({ platform, home: os.homedir(), env: process.env, command: self, app });
    const updates = createUpdates({
      updater: autoUpdater,
      packageKind: kind,
      downloadUrl: DOWNLOAD_URL,
      feedUrl: process.env.VITALS_UPDATE_FEED,
      onState: (s) => {
        send(CHANNELS.updatesState, s);
        trayHandle?.refresh();
      },
      log,
    });
    let serverInfo: McpServerInfo | null = null;
    const secrets = createSecrets({ file: secretsFile(userData), safeStorage });
    const relay = createPageRelay({ send: (req) => send(CHANNELS.mcpCall, req) });
    const host = createMcpHost({
      socketPath: mcpSocketPath({ platform, env: process.env, home: os.homedir(), userName: os.userInfo().username }),
      version: app.getVersion(),
      relay,
      remote: async (client: AiToolId | null) => {
        if (!serverInfo || !client) return null;
        // Codex and the ChatGPT app on Linux share one table, registered with the client id `codex`
        const token = (await secrets.get(`agentToken:${client}`)) ?? (client === 'codex' ? await secrets.get('agentToken:chatgpt-desktop') : null);
        return token ? { mcpUrl: serverInfo.mcpUrl, token } : null;
      },
      log,
    });
    // the hardened system calls: symlinked configs written through the link, `.cmd` shims on Windows, the tool's own
    // folder first on PATH, the Windows Store ChatGPT package found by listing
    const aiTools = createNodeAiTools({
      command: { path: self.path, args: (id: AiToolId) => mcpArgs(self.args, id, platform) },
      server: () => serverInfo,
    });
    let blocker: number | null = null;
    const keepAlive = (on: boolean, text: string): void => {
      trayHandle?.setStatus({ ring: on ? text : undefined });
      if (on && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
      if (!on && blocker !== null) {
        powerSaveBlocker.stop(blocker);
        blocker = null;
      }
    };
    const unregisterIpc = registerIpc({
      ipcMain,
      info: { version: app.getVersion(), os: osName, secretsPersistent: secrets.persistent },
      tray: () => trayHandle,
      autostart,
      updates,
      aiTools,
      relay,
      setServer: (info) => void (serverInfo = info),
      secrets,
      keepAlive,
      realInput: watchRealInput(win.webContents),
    });

    trayHandle = createTray({
      // Tray takes `string | NativeImage`; the tray module is typed by the slice it uses (an image it is given)
      electron: { Tray: Tray as unknown as Parameters<typeof createTray>[0]['electron']['Tray'], Menu, nativeImage },
      iconPath: res.trayIcon,
      showWindow: () => main.show(),
      syncNow: () => send(CHANNELS.syncNow),
      quit: () => app.quit(),
      autostart,
      updates,
      openExternal: (url) => void shell.openExternal(url),
    });
    if (trayHandle === null && startHidden && !SMOKE) main.show();

    if (!SMOKE) {
      updates.start();
      host.start().catch((e: unknown) => log(`mcp host did not start: ${e instanceof Error ? e.message : String(e)}`));
    }

    app.on('before-quit', () => {
      main.allowClose();
      unregisterIpc();
      detachBluetooth();
      updates.stop();
      trayHandle?.destroy();
      trayHandle = null;
      relay.detach();
      void host.close().catch(() => undefined);
    });
    app.on('window-all-closed', () => app.quit());

    if (SMOKE) runSmoke(win);
    void win.loadURL(`${APP_ORIGIN}/`).catch((e: unknown) => {
      log(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      if (SMOKE) app.exit(1);
    });
  });
}

/** Shared between the ready handler and the app events that fire before the window exists. */
const shellState: { show: (() => void) | null } = { show: null };

/**
 * `VITALS_SMOKE=1`: print the page's console, wait for the root to render, exit 0; 1 on a load failure or timeout.
 * `VITALS_SMOKE_WAIT_MS=<n>` (debugging) keeps the page running that much longer after the render, prints what the
 * platform offers under app:// (OPFS, WebAssembly, workers, the service worker) and only then exits.
 */
function runSmoke(win: BrowserWindow): void {
  const started = Date.now();
  const wait = Math.min(20_000, Math.max(0, Number(process.env.VITALS_SMOKE_WAIT_MS) || 0));
  const done = (code: number, why: string): void => {
    process.stdout.write(`smoke: ${why} (${Date.now() - started} ms)\n`);
    app.exit(code);
  };
  const overall = setTimeout(() => done(1, 'timed out after 55 s'), 55_000);
  win.webContents.on('console-message', (details) => {
    const where = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : '';
    process.stdout.write(`page:${details.level}: ${details.message}${where}\n`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => done(1, `load failed ${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (_e, d) => done(1, `renderer gone: ${d.reason}`));
  win.webContents.once('did-finish-load', () => {
    const deadline = Date.now() + 30_000;
    const poll = async (): Promise<void> => {
      const rendered = (await win.webContents.executeJavaScript("(document.querySelector('#root')?.childElementCount ?? 0) > 0", true).catch(() => false)) as boolean;
      if (rendered) {
        clearTimeout(overall);
        if (wait === 0) return done(0, 'page rendered');
        process.stdout.write(`smoke: page rendered (${Date.now() - started} ms); watching the console for ${wait} ms\n`);
        void win.webContents.executeJavaScript(SMOKE_PROBE, true).catch((e: unknown) => process.stdout.write(`smoke: probe failed: ${String(e)}\n`));
        setTimeout(() => done(0, 'page rendered'), wait);
      } else if (Date.now() > deadline) {
        done(1, 'root stayed empty for 30 s');
      } else {
        setTimeout(() => void poll(), 250);
      }
    };
    void poll();
  });
}

/** Runs in the page (debug smoke only): one `probe:` console line per platform feature. */
const SMOKE_PROBE = `(async () => {
  const say = (k, v) => console.log('probe: ' + k + ': ' + v);
  say('origin', location.origin + ' secure=' + isSecureContext);
  say('desktop bridge', typeof window.vitalsDesktop + ' v' + window.vitalsDesktop?.version + ' ' + window.vitalsDesktop?.os);
  say('bluetooth', typeof navigator.bluetooth);
  say('serviceWorker', 'serviceWorker' in navigator ? ('controller=' + !!navigator.serviceWorker.controller) : 'absent');
  try { const d = await navigator.storage.getDirectory(); const h = await d.getFileHandle('smoke.txt', { create: true }); await d.removeEntry('smoke.txt'); say('opfs', 'ok ' + h.kind); } catch (e) { say('opfs', 'FAIL ' + e); }
  try { const m = await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0])); say('wasm', 'ok ' + typeof m.instance); } catch (e) { say('wasm', 'FAIL ' + e); }
  try { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }))); await new Promise((ok, no) => { w.onmessage = ok; w.onerror = no; setTimeout(no, 3000); }); w.terminate(); say('blob worker', 'ok'); } catch (e) { say('blob worker', 'FAIL ' + e); }
  try { const r = await fetch('/manifest.webmanifest'); say('fetch same-origin', r.status + ' ' + r.headers.get('content-type') + ' csp=' + (r.headers.get('content-security-policy') || '').slice(0, 40)); } catch (e) { say('fetch same-origin', 'FAIL ' + e); }
  try { const r = await fetch('/no/such/route'); say('fallback', r.status + ' ' + r.headers.get('content-type')); } catch (e) { say('fallback', 'FAIL ' + e); }
  const wasm = [...document.scripts].length; say('scripts', wasm);
})()`;
