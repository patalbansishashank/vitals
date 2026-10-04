// J4 driver: launches the QA candidate's packaged Linux app with a throwaway HOME under <repo>/.e6-tmp/j4-*, then serves
// a tiny local HTTP endpoint (127.0.0.1 only) that runs JS snippets against the Playwright `page`/`app`, so the journey
// can be driven step by step like a person would. Output is redacted (server address, pairing code, key-shaped strings).
// Usage: node driver.mjs [port]  ->  POST http://127.0.0.1:<port>/eval  (body: async function body using page, app, ctx)
import { chmodSync, existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const R2 = process.env.J4_ROUND === '2'; // round 2: the app built in the worktree itself, results under round2/
const cand = R2 ? repo : path.join(repo, '.e6-tmp', 'cand');
const APP = path.join(cand, 'apps', 'desktop', 'release', 'linux-unpacked', 'vitals');
const req = createRequire(path.join(cand, 'apps', 'desktop', 'package.json'));
const { _electron } = req('playwright-core');
const PORT = Number(process.argv[2] || 47304);
const priv = R2 ? path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'private', 'j4') : path.join(repo, 'qa', 'results', 'L-QA', 'private', 'j4');
const pub = R2 ? path.join(repo, 'qa', 'results', 'L-QA', 'round2', 'j4') : path.join(repo, 'qa', 'results', 'L-QA', 'j4');
mkdirSync(priv, { recursive: true });
mkdirSync(pub, { recursive: true });

const local = JSON.parse(readFileSync(path.join(repo, 'qa', 'local.config.json'), 'utf8'));
const secretDir = path.join(repo, '.e6-tmp', R2 ? 'r2j4-secret' : 'j4-secret');
function secrets() {
  const out = [];
  for (const k of ['serverUrl', 'serverHost', 'serverIp4', 'serverIp6', 'pcHost', 'pcIp4']) if (local[k]) out.push(String(local[k]));
  try {
    const u = new URL(local.serverUrl);
    out.push(u.host, u.hostname);
  } catch {}
  for (const f of ['code', 'qr']) {
    const p = path.join(secretDir, f);
    if (existsSync(p)) {
      const v = readFileSync(p, 'utf8').trim();
      if (v) out.push(v, v.replace(/\D/g, ''), encodeURIComponent(v));
    }
  }
  return [...new Set(out.filter((x) => x && x.length >= 4))].sort((a, b) => b.length - a.length);
}
export function redact(text) {
  let t = String(text);
  for (const x of secrets()) t = t.split(x).join('[redacted]');
  t = t.replace(/\b(https?|wss?):\/\/(?!localhost|127\.0\.0\.1)[A-Za-z0-9.-]+(:\d+)?/g, '$1://[host]'); // any other address too
  return t.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[key-shaped]').replace(/\b\d{4}[ -]?\d{4}\b/g, '[8 digits]');
}

const base = process.env.J4_BASE || path.join(repo, '.e6-tmp', `${R2 ? 'r2j4' : 'j4'}-${Date.now()}`);
const home = path.join(base, 'home');
const bin = path.join(base, 'bin');
for (const d of [home, path.join(home, '.config'), path.join(home, '.local', 'share'), bin, path.join(base, 'tmp')]) mkdirSync(d, { recursive: true });
// `claude` on PATH: logs its arguments, then runs the real Claude Code CLI (HOME is the temp HOME, so `claude mcp add -s
// user` writes <temp HOME>/.claude.json). codex/opencode: the real programs are on PATH already (the app only edits
// their config files under HOME).
const claudeLog = path.join(home, 'claude-args.log');
if (!existsSync(path.join(bin, 'claude'))) {
  writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "$*" >> '${claudeLog}'\nexec /home/${process.env.USER}/.local/bin/claude "$@"\n`);
  chmodSync(path.join(bin, 'claude'), 0o755);
}
writeFileSync(path.join(priv, 'base.txt'), `${base}\n`);

function appEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|VITALS_|ELECTRON_RUN_AS_NODE|APPIMAGE|CODEX_HOME|DISPLAY$|NPM_CONFIG_PREFIX)/.test(k)) env[k] = v;
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    TMPDIR: path.join(base, 'tmp'),
    PATH: `${bin}:${process.env.PATH}`,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-1',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`,
  };
}
writeFileSync(path.join(base, 'env.json'), JSON.stringify(appEnv(), null, 1));

const consoleLog = path.join(priv, 'console.log');
const ctx = { base, home, bin, APP, priv, pub, run: null, launches: 0, errors: [], lines: [], redact, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

ctx.launch = async (args = ['--hidden']) => {
  ctx.launches++;
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: APP, args: args.some((a) => a.startsWith('--ozone-platform')) ? args : ['--ozone-platform=wayland', ...args], env: appEnv(), timeout: 60_000 });
  app.process().stderr?.on('data', (d) => appendFileSync(path.join(priv, 'app-stderr.log'), redact(String(d))));
  app.process().stdout?.on('data', (d) => appendFileSync(path.join(priv, 'app-stdout.log'), redact(String(d))));
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('console', (m) => {
    const line = `${new Date().toISOString()} L${ctx.launches} ${m.type()} ${redact(m.text()).slice(0, 600)}`;
    appendFileSync(consoleLog, `${line}\n`);
    if (m.type() === 'error') ctx.errors.push(line);
  });
  page.on('pageerror', (e) => {
    const line = `${new Date().toISOString()} L${ctx.launches} pageerror ${redact(e.message).slice(0, 600)}`;
    appendFileSync(consoleLog, `${line}\n`);
    ctx.errors.push(line);
  });
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  ctx.run = { app, page, t0, readyMs: Date.now() - t0 };
  return { readyMs: ctx.run.readyMs, url: page.url() };
};
ctx.quit = async () => {
  if (!ctx.run) return 'not running';
  const { app } = ctx.run;
  const proc = app.process();
  await Promise.race([app.close().catch(() => undefined), ctx.sleep(10_000)]);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  ctx.run = null;
  return 'quit';
};
ctx.shot = async (name, opts = {}) => {
  // the window is hidden (--hidden), so Playwright's screenshot never paints: capture in the main process instead
  const dir = opts.private ? priv : pub;
  const b64 = await ctx.run.app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
  return name;
};
ctx.text = async (sel = 'main') => ctx.run.page.evaluate((s) => (document.querySelector(s) ?? document.body).innerText.replace(/\n{2,}/g, '\n'), sel);
ctx.buttons = async () =>
  ctx.run.page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], input, textarea, select')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((b) => `${b.tagName.toLowerCase()}${b.getAttribute('role') ? `[${b.getAttribute('role')}]` : ''}${b.disabled ? '(disabled)' : ''}: ${(b.getAttribute('aria-label') || b.innerText || b.getAttribute('placeholder') || b.getAttribute('name') || '').trim().split('\n')[0].slice(0, 80)}`),
  );
// client-side navigation inside app://vitals
ctx.go = async (route) => {
  await ctx.run.page.evaluate((r) => {
    history.pushState({}, '', r);
    dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await ctx.sleep(1200);
  return ctx.run.page.url();
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const server = createServer(async (rq, rs) => {
  let body = '';
  for await (const c of rq) body += c;
  let out;
  try {
    const fn = new AsyncFunction('page', 'app', 'ctx', body);
    const r = await fn(ctx.run?.page, ctx.run?.app, ctx);
    out = typeof r === 'string' ? r : JSON.stringify(r, null, 1);
  } catch (e) {
    out = `ERROR ${e instanceof Error ? e.message : String(e)}`;
  }
  rs.writeHead(200, { 'content-type': 'text/plain' });
  rs.end(`${redact(out ?? 'undefined')}\n`);
  if (body.trim() === 'EXIT') process.exit(0);
});
server.listen(PORT, '127.0.0.1', () => console.log(`j4 driver on ${PORT}; base ${base}`));
