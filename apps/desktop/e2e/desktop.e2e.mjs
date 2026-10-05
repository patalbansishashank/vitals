// End-to-end checks of the packaged Linux app (SUITE_SPEC §15.10, Desktop row): the shell, navigation lock, autostart,
// updates against a local feed, "Connect your AI tools" and the stdio MCP. Every run gets its own temp HOME under
// <repo>/.e6-tmp/e2e-*, fake `claude`/`codex`/`opencode` programs first on PATH, and the owner's Wayland session with the
// window kept hidden (`--hidden`). Prints one PASS/FAIL line per check; exits 1 on any failure.
//
// The Coach checks (6d, 8e) type a message into the Coach with the scripted stand-in model as the AI provider
// (qa/scripts/Q4/fakeprovider.mjs following qa/fixtures/Q4/script.json, on a free loopback port, its request log in the
// temp dir): no real model and no real key.
//
// Server checks (8a–8e) run only with VITALS_E2E_PAIR_FILE=<file holding one pairing QR text `vitals-server:1?u=…&c=…`>
// for a test person; VITALS_E2E_ONLY=server skips checks 1–6. The QR text, the server address, the code and every key
// stay out of the output (each printed line is redacted), and the temp HOME is always removed after a server run.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { _electron } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repo = path.resolve(appDir, '..', '..');
const APP = process.env.VITALS_E2E_APP || path.join(appDir, 'release', 'linux-unpacked', 'vitals');
const KEEP = process.env.VITALS_E2E_KEEP === '1'; // keep the temp HOME for a look afterwards
const VERBOSE = process.env.VITALS_E2E_VERBOSE === '1';
const ONLY_SERVER = process.env.VITALS_E2E_ONLY === 'server';
const PAIR_QR = readPairFile(process.env.VITALS_E2E_PAIR_FILE);
/** Printed lines are redacted against these (see redact()). */
const SECRETS_TO_HIDE = secretsOf(PAIR_QR);
/** packages/companion/src/agentsRemote.ts NOT_ON_SERVER_SEED: commands only a browser tab runs, so the server never lists them. */
const NOT_ON_SERVER_SEED = ['planner.find', 'nav.open', 'markers.import', 'log.mealFromPhoto', 'plan.replan', 'plan.declareEvent', 'plan.shift', 'plan.editDay'];
/** `log.mealFromPhoto` → `log_meal_from_photo` (the manifest's tool names). */
const toolNameOf = (id) => id.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** qa/fixtures/Q4/script.json rule J3-meal: the stand-in model answers with one log_meal call, then a plain reply. */
const COACH_MEAL = 'I ate dal, rice and two eggs';
const STAND_IN_MODEL = 'q4-scripted';
const STAND_IN_KEY = 'e2e-fake-key'; // not a real key: the stand-in only notes that one was sent
/** Where the page keeps the server ids of the keys it made (src/features/settings/agents/agentKeyIds.ts). */
const KEY_IDS = 'vitals-desktop-agent-key-ids';
/** The Codex key's server id, from 8b (for 8d). */
let codexKeyId = null;
if (ONLY_SERVER && !PAIR_QR) {
  console.error('VITALS_E2E_ONLY=server needs VITALS_E2E_PAIR_FILE');
  process.exit(2);
}

if (!existsSync(APP)) {
  console.error(`no packaged app at ${APP}; build it first (see e2e/README.md)`);
  process.exit(2);
}

// ---- the temp computer --------------------------------------------------------------------------------------------

const base = path.join(repo, '.e6-tmp', `e2e-${Date.now()}-${process.pid}`);
const home = path.join(base, 'home');
const configHome = path.join(home, '.config');
const dataHome = path.join(home, '.local', 'share');
const bin = path.join(base, 'bin');
for (const d of [home, configHome, dataHome, bin, path.join(base, 'tmp')]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(base, 'package.json'), '{"type":"commonjs"}\n'); // the fake programs below are CommonJS

const claudeLog = path.join(home, 'claude-args.log');
writeFileSync(
  path.join(bin, 'claude'),
  `#!/usr/bin/env node
// fake Claude Code: records its arguments and edits ~/.claude.json like \`claude mcp add|remove -s user\`
const fs = require('fs');
const path = require('path');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(claudeLog)}, JSON.stringify(a) + '\\n');
const file = path.join(process.env.CLAUDE_CONFIG_DIR || process.env.HOME, '.claude.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
if (a[0] === 'mcp' && a[1] === 'add') {
  const dd = a.indexOf('--');
  const name = a[dd - 1];
  const [command, ...args] = a.slice(dd + 1);
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [name]: { type: 'stdio', command, args, env: {} } };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log('Added stdio MCP server ' + name + ' to user config');
} else if (a[0] === 'mcp' && a[1] === 'remove') {
  if (cfg.mcpServers) delete cfg.mcpServers[a[2]];
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log('Removed MCP server ' + a[2]);
} else if (a[0] === '--version') console.log('0.0.0 (fake)');
`,
);
for (const p of ['codex', 'opencode']) writeFileSync(path.join(bin, p), `#!/bin/sh\necho "fake ${p} $*" >&2\nexit 0\n`);
for (const p of ['claude', 'codex', 'opencode']) chmodSync(path.join(bin, p), 0o755);

const CODEX_FILE = path.join(home, '.codex', 'config.toml');
const CODEX_ORIGINAL = '# my own Codex settings\nmodel = "some-model"\n\n[projects."/work/thing"]\ntrust_level = "trusted"\n';
const OPENCODE_FILE = path.join(configHome, 'opencode', 'opencode.json');
const OPENCODE_ORIGINAL = '{\n  "$schema": "https://opencode.ai/config.json",\n  "theme": "dark",\n  "mcp": {\n    "other": { "type": "local", "command": ["other-tool"] }\n  }\n}\n';
mkdirSync(path.dirname(CODEX_FILE), { recursive: true });
mkdirSync(path.dirname(OPENCODE_FILE), { recursive: true });
writeFileSync(CODEX_FILE, CODEX_ORIGINAL);
writeFileSync(OPENCODE_FILE, OPENCODE_ORIGINAL);

const uid = process.getuid?.() ?? 1000;
/** The app's environment: the temp HOME, the fake programs first on PATH, the owner's Wayland display. */
function appEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['VITALS_SMOKE', 'VITALS_SMOKE_WAIT_MS', 'ELECTRON_RUN_AS_NODE', 'VITALS_MCP_BRIDGE', 'VITALS_APP_COMMAND', 'VITALS_MCP_SOCKET', 'APPIMAGE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'NPM_CONFIG_PREFIX', 'VITALS_UPDATE_FEED', 'DISPLAY']) delete env[k];
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    XDG_CACHE_HOME: path.join(home, '.cache'),
    TMPDIR: path.join(base, 'tmp'),
    PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-1',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
    ...extra,
  };
}
const ARGS = ['--ozone-platform=wayland', '--hidden'];

// ---- reporting ------------------------------------------------------------------------------------------------------

let failures = 0;
const notes = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(redact(`PASS ${name}${detail ? ` (${detail})` : ''}`));
  } catch (e) {
    failures++;
    console.log(redact(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`));
    if (VERBOSE && e instanceof Error) console.error(redact(e.stack ?? ''));
  }
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);

// ---- the update feed ------------------------------------------------------------------------------------------------

function feedYml(version) {
  const fake = Buffer.from(`not a real package ${version}\n`);
  const sha512 = createHash('sha512').update(fake).digest('base64');
  return [
    `version: ${version}`,
    'files:',
    `  - url: Vitals-linux-amd64.deb`,
    `    sha512: ${sha512}`,
    `    size: ${fake.length}`,
    `path: Vitals-linux-amd64.deb`,
    `sha512: ${sha512}`,
    `releaseDate: '2026-10-01T00:00:00.000Z'`,
    '',
  ].join('\n');
}
/** A local generic-provider feed; `version` is read on every request, so one server serves both runs. */
async function startFeed() {
  const feed = { version: '9.9.9', hits: 0 };
  const server = createServer((req, res) => {
    feed.hits++;
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname.endsWith('.yml')) {
      res.writeHead(200, { 'content-type': 'text/yaml' });
      res.end(feedYml(feed.version));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { feed, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

// ---- the app --------------------------------------------------------------------------------------------------------

async function launch(extraEnv = {}, { quiet = false } = {}) {
  const app = await _electron.launch({ executablePath: APP, args: ARGS, env: appEnv(extraEnv), timeout: 60_000 });
  const lines = [];
  app.process().stderr?.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  app.process().stdout?.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)));
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('console', (m) => VERBOSE && !quiet && console.error(`page:${m.type()}: ${m.text()}`));
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  return { app, page, lines };
}

async function quit(app) {
  if (!app) return;
  const proc = app.process();
  await Promise.race([app.close().catch(() => undefined), sleep(10_000)]);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
}

/**
 * PIDs of `linux-unpacked/vitals` processes of this run. Chromium rewrites its process title over the environment, so
 * the browser process is found by the files it holds open under the temp dir and the rest as its descendants.
 */
function ourProcesses() {
  let pids = [];
  try {
    pids = appPids();
  } catch {
    return [];
  }
  const ppid = (pid) => {
    try {
      return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\)\s+\S+\s+/, '').split(' ')[0];
    } catch {
      return null;
    }
  };
  const holdsOurFiles = (pid) => {
    try {
      return readdirSync(`/proc/${pid}/fd`).some((fd) => {
        try {
          return readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith(base);
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  };
  const ours = new Set(pids.filter(holdsOurFiles));
  for (let grew = true; grew; ) {
    grew = false;
    for (const pid of pids) if (!ours.has(pid) && ours.has(ppid(pid))) grew = ours.add(pid) && true;
  }
  return [...ours];
}

/** `pgrep -f linux-unpacked/vitals`, without shells whose command line merely mentions it (the binary must be the app). */
function appPids() {
  return execFileSync('pgrep', ['-f', 'linux-unpacked/vitals'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((pid) => {
      try {
        return readlinkSync(`/proc/${pid}/exe`) === APP;
      } catch {
        return false;
      }
    });
}

/** An MCP client on `vitals --mcp --client <id>` (default codex; the same env and temp HOME). */
async function mcpClient(clientId = 'codex') {
  const transport = new StdioClientTransport({
    command: APP,
    args: ['--ozone-platform=wayland', '--mcp', '--client', clientId],
    env: appEnv({ VITALS_UPDATE_FEED: feed.url }),
    stderr: 'pipe',
  });
  const errs = [];
  transport.stderr?.on('data', (d) => errs.push(String(d)));
  const client = new Client({ name: 'vitals-e2e', version: '0.0.0' });
  await client.connect(transport, { timeout: 60_000 });
  return { client, transport, errs };
}

/** The tool result's envelope (structuredContent, or the JSON in the first text block). */
function envelopeOf(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find?.((c) => c.type === 'text')?.text;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// ---- the run --------------------------------------------------------------------------------------------------------

const feed = await startFeed();
/** The scripted stand-in model (startStandIn), started on first use. */
let standIn = null;
let run = null;
const today = new Date();
const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

try {
  if (!ONLY_SERVER) {
  run = await launch({ VITALS_UPDATE_FEED: feed.url });
  const { app, page } = run;

  await check('1 shell: app://vitals page renders with the bridge and no Node', async () => {
    const url = page.url();
    assert(url.startsWith('app://vitals/'), `page URL is ${url}`);
    const p = await page.evaluate(() => ({
      root: document.querySelector('#root')?.childElementCount ?? 0,
      version: window.vitalsDesktop?.version,
      os: window.vitalsDesktop?.os,
      require: typeof require,
      process: typeof process,
      module: typeof module,
    }));
    assert(p.root > 0, 'root is empty');
    assert(typeof p.version === 'string' && p.version.length > 0, `vitalsDesktop.version is ${p.version}`);
    assert(p.os === 'linux', `vitalsDesktop.os is ${p.os}`);
    assert(p.require === 'undefined' && p.process === 'undefined' && p.module === 'undefined', `Node in the page: require=${p.require} process=${p.process} module=${p.module}`);
    return `${url}, v${p.version}, ${p.os}`;
  });

  // first run, as a person: the safety questions and the disclaimer, so the app shell (and its agent surfaces) runs
  await check('1b first run: the welcome questions and disclaimer lead into the app', async () => {
    await completeWelcome(page);
    return page.url();
  });

  await check('2 navigation locked: no navigation away, no new window, web links go to the browser', async () => {
    await app.evaluate(({ shell }) => {
      globalThis.__opened = [];
      shell.openExternal = async (u) => void globalThis.__opened.push(u);
    });
    const before = app.windows().length;
    await page.evaluate(() => void (window.location.href = 'https://example.com/nav')).catch(() => undefined);
    await sleep(1500);
    assert(page.url().startsWith('app://vitals/'), `the window navigated to ${page.url()}`);
    await page.evaluate(() => void window.open('https://example.com/popup', '_blank'));
    await sleep(1500);
    const after = app.windows().length;
    const browserWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert(after === before && browserWindows === 1, `windows: ${before} → ${after}, BrowserWindows: ${browserWindows}`);
    const opened = await app.evaluate(() => globalThis.__opened);
    assert(opened.includes('https://example.com/nav') && opened.includes('https://example.com/popup'), `openExternal got ${JSON.stringify(opened)}`);
    assert(page.url().startsWith('app://vitals/'), `the window is on ${page.url()}`);
    return `openExternal got ${opened.length} links`;
  });

  await check('3 autostart: set(true) writes the XDG entry with --hidden, get() follows, set(false) removes it', async () => {
    const file = path.join(configHome, 'autostart', 'vitals.desktop');
    await page.evaluate(() => window.vitalsDesktop.autostart.set(true));
    const text = read(file);
    assert(text !== null, `${file} was not written`);
    const exec = text.split('\n').find((l) => l.startsWith('Exec='));
    assert(exec?.includes(APP) && exec.includes('--hidden'), `Exec line is ${exec}`);
    assert((await page.evaluate(() => window.vitalsDesktop.autostart.get())) === true, 'get() is not true after set(true)');
    await page.evaluate(() => window.vitalsDesktop.autostart.set(false));
    assert(!existsSync(file), 'the entry is still there after set(false)');
    assert((await page.evaluate(() => window.vitalsDesktop.autostart.get())) === false, 'get() is not false after set(false)');
    return exec;
  });

  await check('4a updates: a newer version on the feed reaches "manual" (deb install)', async () => {
    const state = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = [];
          const off = window.vitalsDesktop.updates.onState((s) => {
            seen.push(s);
            if (s.state === 'manual' || s.state === 'ready' || s.state === 'error' || s.state === 'idle') {
              off();
              resolve({ last: s, seen });
            }
          });
          void window.vitalsDesktop.updates.check();
          setTimeout(() => resolve({ last: null, seen }), 20_000);
        }),
    );
    const log = run.lines.filter((l) => /update/i.test(l)).slice(-3).join(' | ');
    assert(state.last?.state === 'manual' && state.last.version === '9.9.9', `states: ${JSON.stringify(state.seen)}; app log: ${log}; feed hits ${feed.feed.hits}`);
    return `${state.seen.map((s) => s.state).join(' → ')} ${state.last.version} ${state.last.url ?? ''}`.trim();
  });

  // ---- Connect your AI tools ----
  await page.evaluate(() => void (window.location.href = 'app://vitals/settings#connect-tools'));
  await page.waitForLoadState('load');
  const section = page.locator('#connect-tools');
  const rowsReady = section.waitFor({ timeout: 30_000 }).then(() => page.getByRole('button', { name: 'Add Vitals to Codex' }).waitFor({ timeout: 30_000 }));

  await check('5a connect tools: Settings lists Claude Code, Codex, OpenCode and ChatGPT', async () => {
    await rowsReady;
    const text = await section.innerText();
    for (const label of ['Claude Code', 'Codex', 'OpenCode', 'ChatGPT']) assert(text.includes(label), `no row for ${label}`);
    return 'four rows';
  });

  /** Add (with the consent dialog) then Remove for a config-file tool; returns a detail line. */
  async function addRemove(label, file, original) {
    await section.getByRole('button', { name: `Add Vitals to ${label}` }).click();
    const dialog = page.getByRole('dialog', { name: `Add Vitals to ${label}?` });
    await dialog.waitFor({ timeout: 10_000 });
    const dialogText = await dialog.innerText();
    assert(dialogText.includes(file), `the dialog does not show ${file}`);
    const preview = await dialog.locator('pre').innerText();
    assert(preview.trim().length > 0, 'the dialog shows no preview');
    assert(read(file) === original, `${file} changed before confirming`);
    await dialog.getByRole('button', { name: 'Add Vitals' }).click();
    await section.getByRole('button', { name: `Remove Vitals from ${label}` }).waitFor({ timeout: 15_000 });
    const after = read(file);
    assert(after !== original, `${file} did not change`);
    const backup = read(`${file}.vitals-backup`);
    assert(backup === original, `${file}.vitals-backup is ${backup === null ? 'missing' : 'not the original'}`);
    // the dialog's <pre> shows the text as rendered; compare without trailing whitespace per line
    const norm = (s) => s.replace(/[ \t]+$/gm, '').trimEnd();
    if (file.endsWith('.toml')) {
      assert(after.startsWith(original), 'the original content is not kept at the start');
      assert(norm(after.slice(original.length)) === norm(`\n${preview}`) || norm(after.slice(original.length)) === norm(preview), `appended text differs from the preview:\n${after.slice(original.length)}\n---\n${preview}`);
    } else {
      assert(after.includes(preview.trimEnd()) || norm(after).includes(norm(preview)), `the file does not contain the preview:\n${after}\n---\n${preview}`);
      const cfg = JSON.parse(after);
      assert(cfg.theme === 'dark' && cfg.mcp?.other?.command?.[0] === 'other-tool' && Array.isArray(cfg.mcp?.vitals?.command), `unexpected JSON: ${after}`);
      assert(cfg.mcp.vitals.command[0] === APP && cfg.mcp.vitals.command.includes('--mcp'), `vitals command is ${JSON.stringify(cfg.mcp.vitals.command)}`);
    }
    await section.getByRole('button', { name: `Remove Vitals from ${label}` }).click();
    const confirm = page.getByRole('alertdialog', { name: `Remove Vitals from ${label}?` });
    await confirm.waitFor({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await section.getByRole('button', { name: `Add Vitals to ${label}` }).waitFor({ timeout: 15_000 });
    const restored = read(file);
    assert(restored === original, `after Remove the file is not the original bytes:\n${JSON.stringify(restored)}`);
    return `${preview.split('\n').length} lines previewed and appended, backup kept, Remove restored the bytes`;
  }

  await check('5b connect tools: Codex Add (consent, exact preview, backup) and Remove', () => addRemove('Codex', CODEX_FILE, CODEX_ORIGINAL));
  await check('5c connect tools: OpenCode Add (consent, exact preview, backup) and Remove', () => addRemove('OpenCode', OPENCODE_FILE, OPENCODE_ORIGINAL));

  await check('5d connect tools: Claude Code Add runs `claude mcp add -s user vitals -- <app> --mcp --client claude-code`', async () => {
    await section.getByRole('button', { name: 'Add Vitals to Claude Code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Vitals to Claude Code?' });
    await dialog.waitFor({ timeout: 10_000 });
    const preview = await dialog.locator('pre').innerText();
    assert(!existsSync(claudeLog), 'claude ran before confirming');
    await dialog.getByRole('button', { name: 'Add Vitals' }).click();
    await section.getByRole('button', { name: 'Remove Vitals from Claude Code' }).waitFor({ timeout: 15_000 });
    const calls = read(claudeLog).trim().split('\n').map((l) => JSON.parse(l));
    const want = ['mcp', 'add', '-s', 'user', 'vitals', '--', APP, ...(process.platform === 'linux' ? ['--ozone-platform=headless'] : []), '--mcp', '--client', 'claude-code'];
    assert(calls.some((c) => JSON.stringify(c) === JSON.stringify(want)), `claude got ${JSON.stringify(calls)}`);
    assert(preview.includes('claude mcp add -s user vitals --'), `preview is ${preview}`);
    await section.getByRole('button', { name: 'Remove Vitals from Claude Code' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Remove Vitals from Claude Code?' });
    await confirm.waitFor({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await section.getByRole('button', { name: 'Add Vitals to Claude Code' }).waitFor({ timeout: 15_000 });
    const last = read(claudeLog).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
    assert(JSON.stringify(last) === JSON.stringify(['mcp', 'remove', 'vitals', '-s', 'user']), `remove ran ${JSON.stringify(last)}`);
    return want.join(' ').replace(APP, '<app>');
  });

  // ---- MCP with the app running ----
  let mcp = null;
  let mealStatus = null;
  await check('6a MCP (app running): initialize, tools/list without destructive tools, a read and a food log', async () => {
    mcp = await mcpClient();
    const { client } = mcp;
    const server = client.getServerVersion();
    const instructions = client.getInstructions();
    const { tools } = await client.listTools(undefined, { timeout: 30_000 });
    assert(tools.length > 0, 'tools/list is empty');
    if (VERBOSE) console.error(tools.map((t) => `${t.name}: ${JSON.stringify(t.inputSchema).slice(0, 300)}`).join('\n'));
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true);
    assert(destructive.length === 0, `destructive tools listed: ${destructive.map((t) => t.name).join(', ')}`);
    const names = tools.map((t) => t.name);
    const readTool = ['today_get', 'profile_get', 'day_get'].find((n) => names.includes(n));
    assert(readTool, `no read tool among ${names.join(', ')}`);
    const r = await client.callTool({ name: readTool, arguments: {} }, undefined, { timeout: 60_000 });
    const re = envelopeOf(r);
    assert(!r.isError && re.ok !== false, `${readTool} failed: ${JSON.stringify(re).slice(0, 400)}`);
    assert(names.includes('log_meal'), `no log_meal among ${names.join(', ')}`);
    const schema = tools.find((t) => t.name === 'log_meal').inputSchema;
    notes.push(`log_meal schema: ${JSON.stringify(schema).slice(0, 600)}`);
    const args = mealArgs(schema);
    const m = await client.callTool({ name: 'log_meal', arguments: args }, undefined, { timeout: 60_000 });
    const me = envelopeOf(m);
    const soFar = `server ${server?.name} ${server?.version}, instructions ${instructions ? `present (${instructions.length} chars)` : 'absent'}, ${tools.length} tools, none destructive; ${readTool} ok`;
    assert(!m.isError && me.ok !== false, `${soFar}; log_meal failed: ${JSON.stringify(me).slice(0, 600)}`);
    // the envelope's status, or the tool's own data status (`logged`) when the result carries only the data
    const raw = me.status ?? (me.applied ? 'applied' : 'unknown');
    const status = raw === 'pending_user' ? raw : 'applied';
    notes.push(`log_meal status: ${raw}`);
    mealStatus = status;
    // visible in the app: the log for today lists it (read through MCP and through the page)
    let seen = 'not checked';
    if (status === 'applied' && names.includes('log_get')) {
      const g = envelopeOf(await client.callTool({ name: 'log_get', arguments: logGetArgs(tools.find((t) => t.name === 'log_get').inputSchema) }, undefined, { timeout: 60_000 }));
      const dump = JSON.stringify(g);
      assert(/banana/i.test(dump), `log_get for ${localDate} does not list the banana: ${dump.slice(0, 600)}`);
      seen = 'log_get lists it';
    }
    return `${soFar}; log_meal ${status}; ${seen}`;
  });

  await check('6b food logged over MCP is in the app', async () => {
    assert(mealStatus, 'no meal was logged in 6a');
    // the app's own command bus, through the read-only QA hook (`?qa=1`), then the page itself
    await page.evaluate(() => void (window.location.href = 'app://vitals/?qa=1'));
    await page.waitForLoadState('load');
    await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30_000 });
    const what = mealStatus === 'applied' ? 'log.get' : 'coach.pending';
    const found = await until(
      async () => {
        const r = await page.evaluate(
          async ([id, date]) => {
            const tries = id === 'log.get' ? [{ from: date, to: date }, { date }, {}] : [{}];
            for (const input of tries) {
              const res = await window.__vitals.read(id, input);
              if (res.ok) return JSON.stringify(res);
            }
            return '';
          },
          [what, localDate],
        );
        return /banana/i.test(r) ? r : null;
      },
      20_000,
      `the banana in ${what}`,
    );
    return `${what} in the page lists it (${found.length} bytes)`;
  });

  await check('6d Coach: a typed message gets a reply with a tool call (scripted model), the meal is logged', async () => {
    const r = await coachMealExchange(page, (u) => goTo(page, u));
    return r.detail;
  });

  if (mcp) await mcp.client.close().catch(() => undefined);
  await quit(app);
  run = null;

  // ---- updates: an older version on the feed ----
  feed.feed.version = '0.0.1';
  run = await launch({ VITALS_UPDATE_FEED: feed.url });
  await check('4b updates: an older version on the feed never reaches "manual" or "ready"', async () => {
    const r = await run.page.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = [];
          window.vitalsDesktop.updates.onState((s) => seen.push(s));
          void window.vitalsDesktop.updates.check().then(() => setTimeout(() => resolve(seen), 5000));
          setTimeout(() => resolve(seen), 20_000);
        }),
    );
    assert(!r.some((s) => s.state === 'manual' || s.state === 'ready'), `states: ${JSON.stringify(r)}`);
    const log = run.lines.filter((l) => /update/i.test(l)).slice(-3).join(' | ');
    assert(r.length > 0 && r.at(-1).state === 'idle', `states: ${JSON.stringify(r)}; app log: ${log}`);
    return r.map((s) => s.state).join(' → ');
  });
  await quit(run.app);
  run = null;
  await until(() => ourProcesses().length === 0, 15_000, 'the app to exit');

  // ---- MCP with the app not running ----
  await check('6c MCP (app not running): --mcp starts the app hidden and the call works', async () => {
    assert(!existsSync(path.join(configHome, 'Vitals', 'mcp.sock')) || ourProcesses().length === 0, 'the app is still running');
    const mcp2 = await mcpClient();
    try {
      const first = (await mcp2.client.listTools(undefined, { timeout: 60_000 })).tools;
      const tools = first.length ? first : await until(async () => {
        const t = (await mcp2.client.listTools(undefined, { timeout: 60_000 })).tools;
        return t.length ? t : null;
      }, 60_000, 'tools after the page started');
      const started = ourProcesses();
      assert(started.length > 0, 'no app process was started');
      const readTool = ['today_get', 'profile_get', 'day_get'].find((n) => tools.some((t) => t.name === n));
      assert(readTool, `no read tool among ${tools.length} tools`);
      const r = await until(
        async () => {
          const res = envelopeOf(await mcp2.client.callTool({ name: readTool, arguments: {} }, undefined, { timeout: 60_000 }));
          return res.ok !== false ? res : null;
        },
        30_000,
        `${readTool} to work`,
      );
      const hidden = await windowHidden(started);
      assert(hidden === 'started with --hidden', hidden);
      return `first tools/list ${first.length} tools, then ${tools.length} after the page published its manifest; ${readTool} ${r.status ?? 'ok'}; app ${hidden}`;
    } finally {
      await mcp2.client.close().catch(() => undefined);
    }
  });
  }

  if (PAIR_QR) await serverChecks();
} catch (e) {
  failures++;
  console.log(redact(`FAIL run aborted: ${e instanceof Error ? e.message : String(e)}`));
  if (VERBOSE && e instanceof Error) console.error(redact(e.stack ?? ''));
} finally {
  if (run) await quit(run.app);
  await killOurs();
  await feed.close();
  if (standIn) standIn.proc.kill('SIGTERM');
}

await check('7 cleanup: no vitals process of this run is left', async () => {
  await until(() => ourProcesses().length === 0, 10_000, 'no processes').catch(() => undefined);
  const left = ourProcesses();
  assert(left.length === 0, `still running: ${left.join(', ')}`);
  let others = [];
  try {
    others = appPids();
  } catch {}
  return others.length ? `${others.length} other linux-unpacked/vitals processes belong to other runs` : 'pgrep -f linux-unpacked/vitals is empty';
});

if (VERBOSE) for (const n of notes) console.error(n);
// a paired run leaves a device token and an agent key in the temp HOME: never kept
if (!KEEP || PAIR_QR) rmSync(base, { recursive: true, force: true });
else console.log(`temp HOME kept at ${home}`);
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);

// ---- helpers that need the tool schema ------------------------------------------------------------------------------

/** Arguments for log_meal from its schema: one banana (or `food`), as text or as a component. */
function mealArgs(schema, food = 'banana') {
  const props = schema?.properties ?? {};
  const args = {};
  if (props.date) args.date = localDate;
  if (props.slot) args.slot = props.slot.enum?.includes('snack') ? 'snack' : props.slot.enum?.[0] ?? 'snack';
  if (props.components) args.components = [{ name: food, grams: 120 }];
  else if (props.text) args.text = `1 ${food}`;
  else if (props.description) args.description = `1 ${food}`;
  if (props.method) args.method = props.method.enum?.includes('aiText') ? 'aiText' : props.method.enum?.[0];
  return args;
}

/** Walks /welcome: Get started, every screening question (18–64, otherwise "no"), "I understand", Continue. */
async function completeWelcome(page) {
  if (!page.url().includes('/welcome')) return;
  await page.getByRole('button', { name: 'Get started' }).first().click();
  await page.locator('[role=radio]').first().waitFor({ timeout: 20_000 });
  for (let round = 0; round < 4; round++) {
    // a follow-up question can appear after an answer, so go round until every group has one
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
}

/** Arguments for log_get covering today, from its schema. */
function logGetArgs(schema) {
  const props = schema?.properties ?? {};
  if (props.from) return { from: localDate, ...(props.to ? { to: localDate } : {}) };
  if (props.date) return { date: localDate };
  return {};
}

/** How the app the bridge started was run (Chromium rewrites its title, so the command line is read as one string). */
async function windowHidden(pids) {
  const cmds = pids.map((pid) => {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
    } catch {
      return '';
    }
  });
  const main = cmds.find((c) => !c.includes('--type='));
  return main?.includes('--hidden') ? 'started with --hidden' : `started as: ${main ?? cmds.join(' | ')}`;
}

/** The page's own navigation (an evaluate that navigates loses its context; that is expected). */
async function goTo(page, url) {
  await page.evaluate((u) => void (window.location.href = u), url).catch(() => undefined);
  await page.waitForLoadState('load');
}

// ---- the Coach with the scripted stand-in model (6d, 8e) -------------------------------------------------------------

/** Starts qa/scripts/Q4/fakeprovider.mjs on a free loopback port (once per run); its request log is in the temp dir. */
async function startStandIn() {
  if (standIn) return standIn;
  const port = await new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const log = path.join(base, 'stand-in.jsonl');
  writeFileSync(log, '');
  const proc = spawn(process.execPath, [path.join(repo, 'qa', 'scripts', 'Q4', 'fakeprovider.mjs'), String(port)], {
    env: { ...process.env, Q4_LOG: log },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errs = [];
  proc.stderr.on('data', (d) => errs.push(String(d)));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the stand-in model did not start: ${errs.join('').slice(0, 300)}`)), 15_000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('scripted model on')) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`the stand-in model exited (${code}): ${errs.join('').slice(0, 300)}`));
    });
  });
  standIn = { url: `http://127.0.0.1:${port}/v1`, log, proc };
  return standIn;
}

/** The stand-in's request log: one {request, reply} per chat-completions call (Authorization noted as present/absent). */
function standInRequests() {
  return (read(standIn.log) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * Settings › AI provider: Custom endpoint, base URL = the stand-in, OpenAI chat, a fake key (Save key), model id,
 * Test connection (must say the model uses tools), Save provider. Skipped when the stand-in is already the provider.
 */
async function useStandIn(page, go) {
  const s = await startStandIn();
  await go('app://vitals/settings/ai');
  const sec = page.locator('#coach');
  const status = sec.locator('p[role=status]').first(); // "<provider> · <model>" or "No AI provider…"
  await status.waitFor({ timeout: 30_000 });
  if ((await status.innerText()).trim().endsWith(`· ${STAND_IN_MODEL}`)) return 'the stand-in was already the provider';
  await sec.locator('details').first().evaluate((d) => void (d.open = true));
  await sec.locator('input[type=radio][value=custom]').check();
  await sec.getByLabel('base URL').fill(s.url);
  await sec.getByRole('radio', { name: 'OpenAI chat' }).click();
  await sec.locator('input[name=ai-api-key]').fill(STAND_IN_KEY);
  await sec.getByRole('button', { name: 'Save key' }).click();
  await sec.getByText(/key saved/).waitFor({ timeout: 15_000 });
  await sec.getByLabel('model id', { exact: true }).fill(STAND_IN_MODEL);
  await sec.getByRole('button', { name: 'Test connection' }).click();
  const toolsRow = sec.locator('tr', { hasText: 'use Vitals’ tools' });
  const probe = await until(
    async () => {
      const alerts = (await sec.locator('[role=alert]').allInnerTexts()).join(' | ').trim();
      if (alerts) return { error: alerts };
      return (await toolsRow.count()) ? { tools: (await toolsRow.innerText()).replace(/\s+/g, ' ') } : null;
    },
    45_000,
    'the result of Test connection',
  );
  assert(!probe.error, `Test connection against the stand-in failed: ${probe.error}`);
  assert(/yes/.test(probe.tools), `Test connection says the stand-in cannot use tools: ${probe.tools}`);
  await sec.getByRole('button', { name: 'Save provider' }).click();
  await until(async () => (await status.innerText()).trim().endsWith(`· ${STAND_IN_MODEL}`), 15_000, 'the saved provider in Settings');
  return `provider set (Custom endpoint, OpenAI chat, ${STAND_IN_MODEL}; check: ${probe.tools})`;
}

/** The Coach's turns in the conversation log. */
function coachTurns(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role=log] .lv-coach-turn[data-role]')].map((t) => ({
      role: t.getAttribute('data-role'),
      busy: t.getAttribute('aria-busy') === 'true',
      text: (t.querySelector('.lv-coach-body')?.innerText ?? '').trim(),
      error: !!t.querySelector('.lv-coach-error'),
    })),
  );
}

/**
 * Plan item 4 "a typed Coach message with a tool call": the stand-in as provider, COACH_MEAL typed into the Coach and
 * sent; asserts the Coach's reply turn, a real tool round trip in the stand-in's log (the tool definitions sent, a
 * log_meal call answered, then a request carrying that call's result) and the meal in the app's own log (through the
 * read-only QA hook) committed by the Coach. Returns the meal entry's id and a detail line.
 */
async function coachMealExchange(page, go) {
  const setup = await useStandIn(page, go);
  await go('app://vitals/coach?qa=1');
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30_000 });
  const box = page.getByLabel('Message to the Coach').first();
  await box.waitFor({ timeout: 30_000 });
  const n0 = standInRequests().length;
  // the composer stays usable while the Coach starts; a send before it is ready shows the reason and sends nothing
  const sentTurn = async () => {
    const i = (await coachTurns(page)).findLastIndex((t) => t.role === 'you' && t.text.includes(COACH_MEAL));
    return i >= 0 ? i + 1 : null; // 1-based, so the first turn is truthy
  };
  const before = await sentTurn();
  let sentAt = null;
  for (let attempt = 0; attempt < 8 && !sentAt; attempt++) {
    await box.fill(COACH_MEAL);
    await page.getByRole('button', { name: 'Send', exact: true }).first().click({ timeout: 15_000 });
    sentAt = await until(async () => {
      const i = await sentTurn();
      return i && i !== before ? i : null;
    }, 5_000, 'the message').catch(() => null);
    if (!sentAt) await sleep(2000);
  }
  if (!sentAt) {
    const says = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`the typed message never appeared in the conversation; the page says: ${says}`);
  }
  const reply = await until(
    async () => {
      if (await page.getByRole('button', { name: 'Stop the Coach' }).count()) return null;
      const t = (await coachTurns(page)).slice(sentAt - 1);
      const r = t.find((x) => x.role === 'coach');
      return r && !r.busy && r.text ? r : null;
    },
    120_000,
    "the Coach's reply",
  );
  assert(!reply.error, `the Coach's turn ended in an error: ${reply.text.slice(0, 300)}`);

  // the tool round trip, from the stand-in's side
  const asked = standInRequests()
    .slice(n0)
    .filter((e) => JSON.stringify(e.request?.messages ?? []).includes(COACH_MEAL));
  const first = asked.findIndex((e) => (e.reply?.tools ?? []).some((t) => t.name === 'log_meal'));
  assert(first >= 0, `the stand-in never answered with a log_meal call (${asked.length} requests for the message; replies: ${JSON.stringify(asked.map((e) => e.reply)).slice(0, 300)})`);
  const sentTools = (asked[first].request.tools ?? []).map((t) => t.function?.name ?? t.name);
  assert(sentTools.includes('log_meal'), `the app did not send log_meal among its ${sentTools.length} tool definitions`);
  const followUp = asked.slice(first + 1).find((e) => (e.request.messages ?? []).some((m) => m.role === 'tool'));
  assert(followUp, `no request after the log_meal call carried a tool result (${asked.length - first - 1} later requests)`);
  const msgs = followUp.request.messages;
  const call = msgs.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : [])).find((c) => c.function?.name === 'log_meal');
  const result = call && msgs.find((m) => m.role === 'tool' && m.tool_call_id === call.id);
  assert(result, 'the follow-up request has no tool message answering the log_meal call');
  const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {}
  assert(parsed?.ok !== false, `log_meal answered the Coach with an error: ${content.slice(0, 300)}`);

  // the meal in the app's own data, committed by the Coach
  const meal = await until(
    async () => {
      const res = await page.evaluate((date) => window.__vitals.read('log.get', { from: date, to: date }), localDate);
      const list = res?.ok ? (res.output ?? []) : [];
      const isMeal = (e) => {
        const j = JSON.stringify(e);
        return /\bdal\b/i.test(j) && /rice/i.test(j) && /egg/i.test(j) && !e.retracted;
      };
      return [...list].reverse().find(isMeal) ?? null;
    },
    20_000,
    `the Coach's meal in log.get for ${localDate}`,
  );
  const byCoach = await page.evaluate(() =>
    window.__vitals
      .events()
      .filter((e) => e.type === 'committed' && e.actor?.kind === 'ai')
      .map((e) => e.commandId),
  );
  assert(byCoach.includes('log.meal'), `log.meal was not committed by the Coach (ai commits: ${byCoach.join(', ') || 'none'})`);
  const id = typeof meal.id === 'string' ? meal.id : null;
  return {
    id,
    detail: `${setup}; reply "${reply.text.replace(/\s+/g, ' ').slice(0, 70)}"; the app sent ${sentTools.length} tool definitions, the stand-in called log_meal, the next request carried its result (${parsed?.ok === true ? 'ok' : 'not an error'}); log.get lists the meal${id ? ` (entry ${id})` : ''}, committed by the Coach`,
  };
}

// ---- the server checks (VITALS_E2E_PAIR_FILE) -----------------------------------------------------------------------

/** The pairing QR text from the file (a full pairing link is accepted too); null without the variable. Never printed. */
function readPairFile(file) {
  if (!file) return null;
  let t = readFileSync(file, 'utf8').trim();
  if (!t.startsWith('vitals-server:') && t.includes('#')) t = t.slice(t.indexOf('#') + 1);
  if (!t.startsWith('vitals-server:')) t = decodeURIComponent(t);
  if (!/^vitals-server:1\?/.test(t)) {
    console.error('VITALS_E2E_PAIR_FILE does not hold a pairing QR text (vitals-server:1?u=…&c=…)');
    process.exit(2);
  }
  return t;
}

/** What must never be printed: the QR text, the server address and host, the code; plus anything shaped like a key. */
function secretsOf(qr) {
  if (!qr) return [];
  const params = new URLSearchParams(qr.slice(qr.indexOf('?') + 1));
  const out = [qr, encodeURIComponent(qr)];
  const u = params.get('u');
  if (u) {
    out.push(u, u.replace(/\/+$/, ''));
    try {
      const url = new URL(u);
      out.push(url.origin, url.host, url.hostname);
    } catch {}
  }
  const c = params.get('c');
  if (c) out.push(c, c.replace(/\D/g, ''));
  return [...new Set(out.filter((x) => x && x.length >= 4))].sort((a, b) => b.length - a.length);
}
function redact(text) {
  let t = String(text);
  for (const x of SECRETS_TO_HIDE) t = t.split(x).join('[the server]');
  if (PAIR_QR) t = t.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]').replace(/\b\d{8}\b/g, '[redacted]');
  return t;
}

/** Ends every process of this run (the app the bridge started at a cold start too). */
async function killOurs() {
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    for (const pid of ourProcesses()) {
      try {
        process.kill(Number(pid), sig);
      } catch {}
    }
    await sleep(1500);
  }
}


/** Tools of an MCP session, waiting through a cold start's empty list. */
async function toolsOf(client) {
  return until(
    async () => {
      const t = (await client.listTools(undefined, { timeout: 60_000 })).tools;
      return t.length ? t : null;
    },
    60_000,
    'a non-empty tools/list',
  );
}


async function serverChecks() {
  await killOurs(); // the app the bridge started in 6c holds the single-instance lock of this HOME
  run = await launch({ VITALS_UPDATE_FEED: feed.url }, { quiet: true });
  const { page } = run;
  const section = page.locator('#connect-tools');
  const go = async (url) => {
    // the page's own navigation (an evaluate that navigates loses its context; that is expected)
    await page.evaluate((u) => void (window.location.href = u), url).catch(() => undefined);
    await page.waitForLoadState('load');
  };

  await check('8a server: a pairing link opens "Pair this device" and pairs the app with the server', async () => {
    await completeWelcome(page);
    await go(`app://vitals/settings?section=server#${PAIR_QR}`);
    const pairThis = page.getByRole('button', { name: 'Pair this device' });
    await pairThis.waitFor({ timeout: 30_000 });
    await pairThis.click();
    const paired = () =>
      page.evaluate(() => {
        try {
          const v = JSON.parse(localStorage.getItem('vitals.server.v1') ?? 'null');
          return typeof v?.baseUrl === 'string' && v.baseUrl.length > 0 && typeof v?.deviceId === 'string';
        } catch {
          return false;
        }
      });
    await until(paired, 60_000, 'the pairing to be saved').catch(async (e) => {
      const alerts = (await page.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' | ');
      throw new Error(`${e.message}${alerts ? `; the page says: ${alerts}` : ''}`);
    });
    // pairing turns sync on: this device already has data (the welcome answers), so the app asks Merge or Replace
    const sync = await until(
      async () => {
        const existing = page.getByRole('alertdialog', { name: 'This device already has data' });
        if (await existing.count()) {
          await existing.getByRole('button', { name: 'Merge', exact: true }).click();
          return null;
        }
        const text = (await page.locator('#server').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
        if (/Sync didn't start[^.]*\./.test(text)) return text.match(/Sync didn't start[^.]*\./)[0];
        if (/\bthrough\b/.test(text)) return 'sync on through the server';
        return null;
      },
      45_000,
      'sync to start through the server',
    ).catch((e) => `sync not confirmed (${e.message})`);
    return `paired with the server; the pairing is saved on this device; ${sync}`;
  });

  await check('8b server: Codex Add mints an agent key into the app secret store and writes the Codex entry', async () => {
    await go('app://vitals/settings#connect-tools');
    await section.getByRole('button', { name: 'Add Vitals to Codex' }).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Add Vitals to Codex?' });
    await dialog.waitFor({ timeout: 10_000 });
    assert((await dialog.innerText()).includes('through your server'), 'the consent dialog does not say Codex reaches Vitals through the server');
    // the page cannot read the key back from the app (review DESK-06): it is taken from the server's answer, never printed
    const minted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/agents/tokens', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Add Vitals' }).click();
    const key = await (await minted).json().catch(() => null);
    assert(typeof key?.token === 'string' && key.token.length > 0 && typeof key?.id === 'string' && key.id.length > 0, 'the server minted no agent key');
    codexKeyId = key.id;
    await section.getByRole('button', { name: 'Remove Vitals from Codex' }).waitFor({ timeout: 30_000 });
    const alerts = (await section.locator('[role=alert]').allInnerTexts()).join(' | ');
    assert(!alerts, `Connect your AI tools shows: ${alerts}`);
    // the page keeps only the key's id, for Remove (review J4-02)
    await until(
      () => page.evaluate(([k, id]) => (JSON.parse(localStorage.getItem(k) ?? '{}').codex ?? []).includes(id), [KEY_IDS, key.id]),
      20_000,
      'the page to keep the new key id',
    );
    const toml = read(CODEX_FILE) ?? '';
    assert(toml.includes('[mcp_servers.vitals]') && toml.includes('"--client", "codex"'), 'the Codex file has no vitals entry');
    assert(!toml.includes(key.token), 'the agent key was written into the Codex file');
    return 'consent says "through your server"; the server minted a key (not shown), the page kept only its id, the key is not in the Codex file; the Codex file has the vitals table (8c shows the app holds the key)';
  });

  await check('8c server: --mcp --client codex goes to the server with that key; a food log lands there', async () => {
    // OpenCode has no key, so its session stays in this app: the local list to compare with
    const local = await mcpClient('opencode');
    let localNames;
    try {
      localNames = (await toolsOf(local.client)).map((t) => t.name);
    } finally {
      await local.client.close().catch(() => undefined);
    }
    const browserOnly = NOT_ON_SERVER_SEED.map(toolNameOf).filter((n) => localNames.includes(n));
    assert(browserOnly.length > 0, `none of the browser-only tools (${NOT_ON_SERVER_SEED.map(toolNameOf).join(', ')}) is in the local list of ${localNames.length}`);

    const remote = await mcpClient('codex');
    try {
      const info = remote.client.getServerVersion();
      const tools = await toolsOf(remote.client);
      const names = tools.map((t) => t.name);
      const stillThere = browserOnly.filter((n) => names.includes(n));
      assert(stillThere.length === 0, `the codex session lists browser-only tools (${stillThere.join(', ')}): it is not the server's list`);
      assert(names.includes('log_meal'), `no log_meal among the server's ${names.length} tools`);
      const m = await remote.client.callTool({ name: 'log_meal', arguments: mealArgs(tools.find((t) => t.name === 'log_meal').inputSchema, 'banana') }, undefined, { timeout: 60_000 });
      const me = envelopeOf(m);
      assert(!m.isError && me.ok !== false, `log_meal failed: ${JSON.stringify(me).slice(0, 400)}`);
      const raw = me.status ?? 'applied';
      assert(raw !== 'ask', `log_meal asked a question instead of logging: ${JSON.stringify(me).slice(0, 300)}`);
      const status = raw === 'pending_user' ? raw : 'applied';
      let seen = 'not read back (pending your approval)';
      if (status === 'applied') {
        // today_get: the server's per-turn limit never resets for log_get (no turn id over the server's MCP), see the hand-back
        const readTool = names.includes('today_get') ? 'today_get' : 'log_get';
        const schema = tools.find((t) => t.name === readTool)?.inputSchema;
        // one read: the server limits calls of one tool per turn, so polling would only be refused
        const g = envelopeOf(await remote.client.callTool({ name: readTool, arguments: readTool === 'log_get' ? logGetArgs(schema) : {} }, undefined, { timeout: 60_000 }));
        assert(/banana/i.test(JSON.stringify(g)), `${readTool} does not list the banana; log_meal answered ${JSON.stringify(me).slice(0, 200)}; ${readTool} saw ${JSON.stringify(g).slice(0, 700)}`);
        seen = `${readTool} through the same session lists it (${JSON.stringify(g).length} bytes)`;
      }
      return `server session ${info?.name ?? '?'} ${info?.version ?? ''}: ${names.length} tools vs ${localNames.length} local, browser-only ${browserOnly.join(', ')} absent; log_meal ${status} (${raw}); ${seen}`;
    } finally {
      await remote.client.close().catch(() => undefined);
    }
  });

  await check('8e server: a typed Coach message with a tool call while paired; the meal reaches the server', async () => {
    const coach = await coachMealExchange(page, go);
    // the server's own data, through the remote MCP with the Codex key from 8b (still there until 8d)
    const remote = await mcpClient('codex');
    try {
      const tools = await toolsOf(remote.client);
      const names = tools.map((t) => t.name);
      const readTool = names.includes('log_get') ? 'log_get' : 'today_get';
      assert(names.includes(readTool), `no log_get or today_get among the server's ${names.length} tools`);
      const args = readTool === 'log_get' ? logGetArgs(tools.find((t) => t.name === 'log_get').inputSchema) : {};
      const there = (dump) => (coach.id ? dump.includes(coach.id) : /\bdal\b/i.test(dump) && /rice/i.test(dump) && /egg/i.test(dump));
      // sync carries it over; the server allows a bounded number of reads of one tool per agent, so poll sparingly
      const t0 = Date.now();
      let last = '';
      let reads = 0;
      while (Date.now() - t0 < 70_000) {
        reads++;
        const r = await remote.client.callTool({ name: readTool, arguments: args }, undefined, { timeout: 60_000 });
        last = JSON.stringify(envelopeOf(r));
        if (!r.isError && there(last)) {
          return `${coach.detail}; ${readTool} on the server lists it after ${Math.round((Date.now() - t0) / 1000)} s (${reads} read${reads > 1 ? 's' : ''})`;
        }
        await sleep(7000);
      }
      throw new Error(`the Coach's meal${coach.id ? ` (entry ${coach.id})` : ''} did not reach the server within 70 s (${reads} reads of ${readTool}; the last saw ${last.slice(0, 400)}); in the app: ${coach.detail}`);
    } finally {
      await remote.client.close().catch(() => undefined);
    }
  });

  await check('8d server: Codex Remove clears the key and restores the Codex file', async () => {
    await go('app://vitals/settings#connect-tools');
    await section.getByRole('button', { name: 'Remove Vitals from Codex' }).click({ timeout: 30_000 });
    const confirm = page.getByRole('alertdialog', { name: 'Remove Vitals from Codex?' });
    await confirm.waitFor({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await section.getByRole('button', { name: 'Add Vitals to Codex' }).waitFor({ timeout: 30_000 });
    const alerts = (await section.locator('[role=alert]').allInnerTexts()).join(' | ');
    assert(!alerts, `Connect your AI tools shows: ${alerts}`);
    // the server no longer lists the key (review J4-02); asked from the page with its own pairing, only a boolean comes back
    assert(codexKeyId, '8b did not record the key id');
    const listed = await page.evaluate(async (id) => {
      const p = JSON.parse(localStorage.getItem('vitals.server.v1') ?? 'null');
      const r = await fetch(`${p.baseUrl}/v1/agents/tokens`, { headers: { authorization: `Bearer ${p.token}` }, cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return `HTTP ${r.status}`;
      return ((await r.json()).tokens ?? []).some((t) => t.id === id);
    }, codexKeyId);
    assert(listed === false, listed === true ? 'the server still lists the Codex agent key after Remove' : `could not list the server's agent keys (${listed})`);
    assert(read(CODEX_FILE) === CODEX_ORIGINAL, 'the Codex file is not back to its original bytes');
    return 'the key is revoked on the server (no longer listed), Codex file restored';
  });
}
