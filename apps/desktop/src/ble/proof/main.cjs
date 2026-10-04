/*
 * Real-ring proof for the desktop Bluetooth path: Electron main with the app's own bridge (../main.ts, ../preload.ts),
 * a page running the app's Electron transport (src/biometrics/ble/transports) and a ring driver. Run by ./run.sh.
 * Prints one `RESULT {json}` line: counts and times only (no health values, no frames).
 *
 * The page bundle holds the driver (and so its built-in passcode, as the shipped app does); it is built in memory and
 * never written to disk. The preload bundle holds only the bridge and goes to a temp file.
 * Env: PATH_KIND=a5a|legacy (default a5a: @vitals/rings with the J-Style 2301 family; legacy: the app's current driver),
 *      RING_ID=<address> to answer only that ring (else the first ring listed), QUIET_MS (history settle timer), HARD_MS.
 */
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../..');
const SRC = path.join(ROOT, 'src');
const T0 = Date.now();
const log = (...a) => console.log(`[main +${Date.now() - T0}ms]`, ...a);

function esbuild() {
  try {
    return require('esbuild');
  } catch {
    for (const d of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
      if (fs.existsSync(path.join(d, 'esbuild'))) return require(path.join(d, 'esbuild'));
    }
    const dir = path.join(ROOT, 'node_modules/.pnpm');
    const hit = fs.readdirSync(dir).find((d) => /^esbuild@/.test(d));
    if (!hit) throw new Error('esbuild not found: set NODE_PATH to a node_modules folder that has it');
    return require(path.join(dir, hit, 'node_modules/esbuild'));
  }
}
const alias = { name: 'alias', setup(b) { b.onResolve({ filter: /^@\// }, (a) => b.resolve('./' + a.path.slice(2), { resolveDir: SRC, kind: a.kind })); } };
async function bundle(entry, platform, format) {
  const r = await esbuild().build({ entryPoints: [entry], bundle: true, write: false, platform, format, target: platform === 'node' ? 'node22' : 'chrome130', plugins: [alias], external: ['electron'], logLevel: 'error' });
  return r.outputFiles[0].text;
}
function load(code) {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  return m.exports;
}

protocol.registerSchemesAsPrivileged([{ scheme: 'proof', privileges: { standard: true, secure: true } }]);

(async () => {
  const bridgeMain = load(await bundle(path.join(__dirname, '../main.ts'), 'node', 'cjs'));
  bridgeMain.enableWebBluetooth(app);
  await app.whenReady();
  log('electron', process.versions.electron, 'chrome', process.versions.chrome, 'switches', bridgeMain.BLUETOOTH_SWITCHES.join(','));
  const preloadFile = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'xport-proof-')), 'preload.cjs');
  fs.writeFileSync(preloadFile, await bundle(path.join(__dirname, 'preload-entry.ts'), 'node', 'cjs'));
  const page = await bundle(path.join(__dirname, 'page.ts'), 'browser', 'iife');
  protocol.handle('proof', (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/page.js') return new Response(page, { headers: { 'content-type': 'text/javascript' } });
    return new Response('<!doctype html><meta charset=utf-8><title>ring proof</title><script src="/page.js"></script>', { headers: { 'content-type': 'text/html' } });
  });
  const win = new BrowserWindow({ width: 320, height: 200, show: process.env.SHOW === '1', webPreferences: { preload: preloadFile, sandbox: false, contextIsolation: true } });
  const wc = win.webContents;
  wc.on('console-message', (e) => log('page:', e.message));
  const detach = bridgeMain.attachBluetooth(wc, ipcMain);
  wc.session.setBluetoothPairingHandler((d, cb) => {
    log('pairing request', d.pairingKind);
    cb({ confirmed: false });
  });
  await win.loadURL('proof://app/index.html');
  let res;
  try {
    res = await wc.executeJavaScript(`runProof(${JSON.stringify({ kind: process.env.PATH_KIND || 'a5a', ringId: process.env.RING_ID || '', quietMs: Number(process.env.QUIET_MS || 0) })})`, true);
  } catch (e) {
    res = { execError: String(e) };
  }
  console.log('RESULT ' + JSON.stringify(res));
  detach();
  fs.rmSync(path.dirname(preloadFile), { recursive: true, force: true });
  win.destroy();
  app.quit();
})().catch((e) => {
  console.log('RESULT ' + JSON.stringify({ mainError: String(e) }));
  app.exit(1);
});
setTimeout(() => {
  console.log('RESULT {"hardTimeout":true}');
  app.exit(2);
}, Number(process.env.HARD_MS || 300000));
