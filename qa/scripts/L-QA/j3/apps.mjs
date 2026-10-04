// J3 (L-QA journey 3): the real apps as replicas of the four-replica sync harness (candidate qa/scripts/sync README,
// "The replica contract"). Desktop = the candidate Electron app through Playwright `_electron` with a temp HOME; website =
// the candidate web build in Chromium (persistent profile) whose site origin is answered by `vite preview` through
// Playwright routing (the server allows the website origin, not http://127.0.0.1). Both reach the server through their
// own switchable loopback CONNECT proxy (`--proxy-server`), so goOffline() cuts every socket the app has to the server.
// Reads go through the app's command bus (`?qa=1` read-only hook), writes through the page's own WebMCP tools
// (navigator.modelContext polyfill, as qa/scripts/Q8 does). No address, code or key is printed or written here.
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const CAND = ROOT; // round 2: this worktree's code and builds
export const TMP = `${ROOT}/.e6-tmp`;
const req = createRequire(`${CAND}/package.json`);
const { _electron, chromium } = req('playwright-core');
export const cfg = JSON.parse(fs.readFileSync(`${ROOT}/qa/local.config.json`, 'utf8'));
export const SERVER = cfg.serverUrl.replace(/\/$/, '');
export const SITE = cfg.siteUrl.replace(/\/$/, '');
export const PREVIEW = 'http://127.0.0.1:4361';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const PHONE_SERVER = fs.existsSync(`${ROOT}/.e6-tmp/r2j3/phone-server`) ? fs.readFileSync(`${ROOT}/.e6-tmp/r2j3/phone-server`, 'utf8').trim() : null;
const SECRETS = [SERVER, new URL(SERVER).host, SITE, new URL(SITE).host, ...(PHONE_SERVER ? [PHONE_SERVER, new URL(PHONE_SERVER).host, new URL(PHONE_SERVER).hostname] : [])];
export const redact = (t) => {
  let s = String(t);
  for (const x of SECRETS) s = s.split(x).join('<server>');
  return s.replace(/\b\d{8}\b/g, '<8 digits>').replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<redacted>');
};
export const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a.map(redact));

/* ------------------------------------------------------------------------------------------ switchable CONNECT proxy */
export async function connectProxy() {
  let offline = false;
  const open = new Set();
  let tunnels = 0;
  const srv = http.createServer((q, s) => {
    s.writeHead(405);
    s.end();
  });
  srv.on('connect', (q, sock, head) => {
    if (offline) return void sock.destroy();
    const [host, port] = q.url.split(':');
    tunnels += 1;
    const up = net.connect(Number(port || 443), host, () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    open.add(sock);
    open.add(up);
    const done = () => {
      open.delete(sock);
      open.delete(up);
      sock.destroy();
      up.destroy();
    };
    up.on('error', done);
    sock.on('error', done);
    up.on('close', done);
    sock.on('close', done);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    port: srv.address().port,
    get offline() {
      return offline;
    },
    get tunnels() {
      return tunnels;
    },
    off() {
      offline = true;
      for (const s of open) s.destroy();
      open.clear();
    },
    on() {
      offline = false;
    },
    close() {
      offline = true;
      for (const s of open) s.destroy();
      return new Promise((r) => srv.close(() => r()));
    },
  };
}

/* ------------------------------------------------------------------------------------------ page helpers */
export function webmcpPolyfill() {
  localStorage.setItem('vitals-agents.webmcp', 'true');
  window.__tools = {};
  // Electron's Chromium offers document.modelContext, which the app prefers: both point at this stand-in
  const ctx = {
      registerTool(t) {
        window.__tools[t.name] = t;
        return { unregister() { delete window.__tools[t.name]; } };
      },
      unregisterTool(n) {
        delete window.__tools[n];
      },
  };
  Object.defineProperty(navigator, 'modelContext', { value: ctx, configurable: true });
  try {
    Object.defineProperty(document, 'modelContext', { value: ctx, configurable: true });
  } catch {}
}
export async function tool(page, name, input = {}) {
  await page.waitForFunction((n) => window.__tools?.[n], name, { timeout: 30000 });
  const t = await page.evaluate(async ([n, i]) => (await window.__tools[n].execute(i)).content[0].text, [name, input]);
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}
export async function busRead(page, id, input = {}) {
  const r = await page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.error).slice(0, 300)}`);
  return r.output ?? r.value ?? r;
}
export const pairingOf = (page) =>
  page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('vitals.server.v1') || 'null');
    return v ? { paired: Boolean(v.baseUrl && v.token), deviceId: v.deviceId ?? null } : { paired: false };
  });

/** Walks /welcome (as apps/desktop/e2e does): first question set, "I understand", Continue. */
export async function completeWelcome(page) {
  if (!page.url().includes('/welcome')) return false;
  await page.getByRole('button', { name: 'Get started' }).first().click();
  await page.locator('[role=radio]').first().waitFor({ timeout: 20_000 });
  for (let round = 0; round < 4; round++) {
    const groups = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('[role=radio]')].map((r) => r.parentElement))].map((p, i) => {
        p.setAttribute('data-e2e-group', String(i));
        const opts = [...p.querySelectorAll('[role=radio]')];
        return { i, checked: opts.some((o) => o.getAttribute('aria-checked') === 'true'), names: opts.map((o) => o.textContent.trim()) };
      }),
    );
    const todo = groups.filter((g) => !g.checked);
    if (!todo.length) break;
    for (const g of todo) {
      const pick = g.names.find((x) => x === '18–64') ?? g.names.find((x) => x === 'no') ?? g.names.at(-1);
      await page.locator(`[data-e2e-group="${g.i}"] [role=radio]`).filter({ hasText: new RegExp(`^${pick}$`) }).first().click();
    }
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').first().check({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 20_000 });
  return true;
}

/* ------------------------------------------------------------------------------------------ an app replica */
/**
 * kind 'desktop' | 'browser'. Returns the replica object of the harness contract plus `page`, `go(route)`,
 * `pairByCode(code)`, `syncStatus()`.
 */
export async function openApp(kind, { name, dir }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const proxy = await connectProxy();
  const origin = kind === 'desktop' ? 'app://vitals' : SITE;
  let app = null; // Electron app or Chromium persistent context
  let page = null;
  let pid = null;
  const proxyArgs = [`--proxy-server=http://127.0.0.1:${proxy.port}`];
  const errors = [];
  let env = null;
  let mcp = null;
  const APP = `${TMP}/r2j3/linux-unpacked/vitals`; // round 2: copy of this worktree's build
  /**
   * Desktop writes: the app's own page relay (what its MCP host uses: main sends `vitals:mcp:call` to the page, the
   * page runs it through `guardedCall` as actor mcp/<client>, answers on `vitals:mcp:result`). Driven from Electron main
   * because a paired desktop forwards a `--mcp` tool to the server instead of the running app.
   */
  const mcpCall = async (name, args) => {
    const once = () =>
      app.evaluate(
        ({ BrowserWindow, ipcMain }, [tool, a, callId]) =>
          new Promise((resolve) => {
            const win = BrowserWindow.getAllWindows()[0];
            const done = (_e, res) => {
              if (res?.callId !== callId) return;
              ipcMain.removeListener('vitals:mcp:result', done);
              resolve(res.envelope);
            };
            ipcMain.on('vitals:mcp:result', done);
            setTimeout(() => {
              ipcMain.removeListener('vitals:mcp:result', done);
              resolve({ ok: false, error: { code: 'j3_timeout', message: 'no answer in 30 s' } });
            }, 30000);
            win.webContents.send('vitals:mcp:call', { callId, client: 'l-qa-j3', tool, args: a, idempotencyKey: callId });
          }),
        [name, args, `j3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
      );
    let out = await once();
    for (let i = 0; i < 20 && ['page_not_ready', 'internal'].includes(out?.error?.code); i++) {
      await sleep(1000);
      out = await once();
    }
    return out;
  };
  const dropMcp = async () => {
    const m = mcp;
    mcp = null;
    await m?.close().catch(() => undefined);
  };

  const start = async () => {
    if (kind === 'desktop') {
      const home = `${dir}/h`;
      for (const d of ['c', 'd', 'k', 't']) fs.mkdirSync(`${home}/${d}`, { recursive: true });
      env = { ...process.env };
      for (const k of ['VITALS_SMOKE', 'ELECTRON_RUN_AS_NODE', 'VITALS_MCP_BRIDGE', 'VITALS_APP_COMMAND', 'VITALS_MCP_SOCKET', 'APPIMAGE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'VITALS_UPDATE_FEED', 'DISPLAY']) delete env[k];
      Object.assign(env, { HOME: home, XDG_CONFIG_HOME: `${home}/c`, XDG_DATA_HOME: `${home}/d`, XDG_CACHE_HOME: `${home}/k`, TMPDIR: `${home}/t`, VITALS_UPDATE_FEED: 'http://127.0.0.1:9/none', WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-1', XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}` });
      app = await _electron.launch({ executablePath: APP, args: ['--ozone-platform=wayland', '--hidden', ...proxyArgs], env, timeout: 60_000 });
      pid = app.process().pid;
      await app.context().addInitScript(webmcpPolyfill);
      page = await app.firstWindow({ timeout: 60_000 });
    } else {
      app = await chromium.launchPersistentContext(`${dir}/profile`, {
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWarningOnly', ...proxyArgs],
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 860 },
        headless: true,
      });
      await app.addInitScript(webmcpPolyfill);
      await app.route(`${SITE}/**`, async (route) => {
        const u = new URL(route.request().url());
        for (let i = 0; i < 4; i++) {
          try {
            const r = await route.fetch({ url: `${PREVIEW}${u.pathname}${u.search}`, maxRedirects: 0, timeout: 60000 });
            return await route.fulfill({ response: r });
          } catch {
            await sleep(500 * (i + 1));
          }
        }
        await route.abort().catch(() => {});
      });
      page = app.pages()[0] ?? (await app.newPage());
      const prof = `${dir}/profile`;
      pid = Number(execFileSync('pgrep', ['-o', '-f', `user-data-dir=${prof}`]).toString().trim().split('\n')[0]);
    }
    page.setDefaultTimeout(45000);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
    await go('/');
  };
  async function go(route = '/') {
    const u = new URL(route, `${origin}/`);
    u.searchParams.set('qa', '1');
    const href = kind === 'desktop' ? u.toString().replace(/^app:\/\/vitals\/?/, 'app://vitals/') : u.toString();
    if (kind === 'desktop' && page.url().startsWith('app://')) await page.evaluate((h) => void (window.location.href = h), href).catch(() => undefined);
    else await page.goto(href, { waitUntil: 'load' }).catch(() => undefined);
    await page.waitForLoadState('load').catch(() => undefined);
    await page.waitForFunction(() => !!window.__vitals, null, { timeout: 90000 });
    await sleep(500);
  }
  const stop = async (hard) => {
    await dropMcp();
    if (!app) return;
    if (hard && pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
      // the Chromium / Electron helpers follow their parent
      await sleep(1500);
      await app.close().catch(() => undefined);
    } else await Promise.race([app.close().catch(() => undefined), sleep(10000)]);
    app = null;
    page = null;
  };
  await start();

  const self = {
    kind,
    name,
    proxy,
    errors,
    get page() {
      return page;
    },
    get app() {
      return app;
    },
    get pid() {
      return pid;
    },
    go,
    mcpCall,
    async ensureQa() {
      if (!(await page.evaluate(() => !!window.__vitals).catch(() => false))) await go('/');
    },
    async onboard() {
      await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
      await sleep(1000);
      return completeWelcome(page);
    },
    /** Settings › Server: pairs by code typed into the two 4-digit fields (the code never leaves this call). */
    async pairByCode(code, label) {
      await go('/settings?section=server');
      const enter = page.getByRole('button', { name: 'Enter code' });
      if (await enter.count()) await enter.first().click();
      const addr = page.getByLabel('server address').first();
      if (await addr.isEditable().catch(() => false)) await addr.fill(SERVER);
      await page.getByLabel('first 4 digits').fill(code.slice(0, 4));
      await page.getByLabel('last 4 digits').fill(code.slice(4));
      if (label) {
        const n = page.getByLabel('name this device');
        if (await n.count()) await n.fill(label);
      }
      await page.getByRole('button', { name: /^Pair( this device)?$/ }).first().click();
      // pairing turns sync on (decision 5): a device that already holds data (the welcome answers) is asked first
      const t = Date.now();
      let asked = null;
      while (Date.now() - t < 30000) {
        const dlg = page.getByRole('alertdialog');
        if (await dlg.count()) {
          asked = (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 300);
          await dlg.first().getByRole('button', { name: 'Merge', exact: true }).click();
          break;
        }
        if ((await busRead(page, 'sync.status', {}).catch(() => ({}))).paired) break;
        await sleep(300);
      }
      await sleep(1000);
      return { ...(await pairingOf(page)), asked };
    },
    async syncStatus() {
      await self.ensureQa();
      return busRead(page, 'sync.status', {});
    },
    async write(cmd) {
      await self.ensureQa();
      const at = Date.now();
      const call = (n, i) => tool(page, n, i);
      if (cmd.op === 'logFood') {
        const r = await call( 'log_meal', { date: cmd.date, text: cmd.text, method: 'aiText', slot: 'snack', confidence: 0.8, components: [{ name: cmd.food ?? 'boiled egg', grams: 100 }] });
        const id = r?.data?.entryId ?? r?.output?.entryId ?? r?.entryId ?? null;
        return { at, id, result: r };
      }
      if (cmd.op === 'patch' && cmd.col === 'settings') return { at, result: await call('settings_update', { patch: cmd.fields }) };
      throw new Error(`${name}: write ${cmd.op} not supported`);
    },
    async read(query) {
      await self.ensureQa();
      if (query.col === 'dailyLogs') {
        const out = await busRead(page, 'log.get', { from: query.date, to: query.date });
        const list = Array.isArray(out) ? out : (out.entries ?? []);
        return Object.fromEntries(list.map(({ id, ...rest }) => [id, rest]));
      }
      if (query.col === 'settings') return { me: await busRead(page, 'settings.get', {}) };
      throw new Error(`${name}: read ${query.col} not supported`);
    },
    async goOffline() {
      proxy.off();
    },
    async goOnline() {
      proxy.on();
    },
    async kill() {
      await stop(true);
    },
    async restart() {
      await stop(true);
      await start();
    },
    async status() {
      if (!app) return { state: 'killed' };
      const s = await self.syncStatus().catch((e) => ({ error: e.message }));
      return { state: proxy.offline ? 'offline' : (s.state ?? s.status ?? 'unknown'), sync: s, tunnels: proxy.tunnels };
    },
    async close() {
      await stop(false);
      await proxy.close();
    },
  };
  return self;
}

/* ------------------------------------------------------------------------------------------ vite preview */
export async function ensurePreview() {
  const up = async () => {
    try {
      return (await fetch(`${PREVIEW}/`)).ok;
    } catch {
      return false;
    }
  };
  if (await up()) return null;
  const out = fs.openSync(`${TMP}/r2j3/preview.log`, 'a');
  const child = spawn(process.execPath, [`${CAND}/node_modules/vite/bin/vite.js`, 'preview', '--outDir', `${TMP}/web-r2j3`, '--port', '4361', '--strictPort', '--host', '127.0.0.1'], { cwd: CAND, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(500);
  if (!(await up())) throw new Error('vite preview did not start');
  return child.pid;
}
