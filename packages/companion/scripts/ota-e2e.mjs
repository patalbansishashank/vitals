#!/usr/bin/env node
// Over-the-air updates end to end against a REAL server process (vitals-research/ota/CONTRACT.md, docs/SERVER.md
// "Updates"); no mocks of the server.
//
// 1. Starts `vitals-server serve` (home role, 127.0.0.1, a free port) from this checkout with its config and data in
//    <data dir>, after `init` and `persons add` through the same CLI. A small TLS front on another loopback port stands
//    in for Caddy / `tailscale serve` (self-signed certificate, X-Forwarded-For appended): the app only fetches https.
// 2. Pairs a Vitals device with the app's own ServerClient (src/net/server.ts) and a `vitals-server pair-code` code.
// 3. Publishes with the CLI: a dummy APK (versionCode 602), the real web bundle from scripts/release/web-bundle.mjs, then
//    an OLDER build published later (must never be offered over it) and a newer build that needs a newer APK (must
//    not reach a 0.6.1 phone). Both extra builds are signed with the same key; the key is never printed.
// 4. Asks `/latest` for many installed states (bundle names, `apk-<versionName>`, versionCodes) and checks each answer.
// 5. Runs the app's own check (`checkForUpdates`, src/platform/androidUpdates.ts, bundled with Vite) with a Node port of
//    the native side: ranged download in two parts, sha256, the ed25519 check of OtaVerify.kt with the public key read
//    from OtaVerify.kt itself, and OtaLogic.acceptable.
// 6. Checks the token-free `/install` page and APK on loopback and through the front, its refusals, token scoping,
//    HEAD, 416, and that the server log holds no token or signature. Stops the server.
//
//   pnpm --filter vitals-companion build:person          # once: `serve` needs dist/person-worker.mjs
//   pnpm build && node scripts/release/web-bundle.mjs --use-dist
//   node packages/companion/scripts/ota-e2e.mjs [--bundle <zip>] [--key <pem>] [--data-dir <dir>] [--keep] [--verbose]
//
// --bundle defaults to the newest apps/android/release/web/vitals-web-*.zip (its .sig next to it). The data dir
// (default $PWD/.e6-tmp/ota-e2e) is wiped first and, without --keep, at the end. Exit code 1 on any failed check.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, verify as edVerify } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(pkgDir, '..', '..');
const bin = join(pkgDir, 'bin', 'vitals-server.mjs');
const { values: opt } = parseArgs({
  options: {
    bundle: { type: 'string' },
    key: { type: 'string' },
    'data-dir': { type: 'string' },
    keep: { type: 'boolean' },
    verbose: { type: 'boolean' },
  },
});
const root = resolve(opt['data-dir'] ?? join(process.cwd(), '.e6-tmp', 'ota-e2e'));
const keyPath = opt.key ?? process.env.VITALS_WEB_BUNDLE_KEY ?? join(homedir(), '.config/vitals-release/web-bundle-ed25519.key');

const { makeZip, collect, sha256Hex, signSha, bundleVersion } = await import(pathToFileURL(join(repo, 'scripts/release/web-bundle.mjs')).href);
const { readZipEntry } = await import(pathToFileURL(join(pkgDir, 'src/home/releases.ts')).href);

// ---------------------------------------------------------------------------------------------------------------
// checks

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    if (opt.verbose) console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`}`);
  }
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
const section = (t) => console.log(`\n${t}`);

// ---------------------------------------------------------------------------------------------------------------
// the bundle under test

function newestBundle() {
  const dir = join(repo, 'apps/android/release/web');
  const zips = existsSync(dir) ? readdirSync(dir).filter((f) => /^vitals-web-.+\.zip$/.test(f)).map((f) => join(dir, f)) : [];
  zips.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!zips[0]) throw new Error('No web bundle: run `pnpm build && node scripts/release/web-bundle.mjs --use-dist` first, or pass --bundle');
  return zips[0];
}
const bundlePath = resolve(opt.bundle ?? newestBundle());
const sigPath = `${bundlePath}.sig`;
if (!existsSync(sigPath)) throw new Error(`No signature next to the bundle: ${sigPath}`);
const bundleZip = readFileSync(bundlePath);
const bundleMeta = JSON.parse((await readZipEntry(bundlePath, 'bundle.json')).toString('utf8'));

// ---------------------------------------------------------------------------------------------------------------
// the Android side, ported from Kotlin (OtaVerify.kt, OtaLogic.kt) — pure functions, no server knowledge

const otaVerifyKt = readFileSync(join(repo, 'apps/android/android/app/src/main/java/desi/creative/vitals/OtaVerify.kt'), 'utf8');
const pubHex = /WEB_BUNDLE_PUBLIC_KEY: ByteArray = hex\("([0-9a-f]{64})"\)/.exec(otaVerifyKt)?.[1];
if (!pubHex) throw new Error('OtaVerify.kt: WEB_BUNDLE_PUBLIC_KEY not found');
const appPublicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubHex, 'hex').toString('base64url') }, format: 'jwk' });

/** OtaVerify.decodeSignature: 128 hex, else base64 (URL-safe when it has - or _), 64 bytes. */
function decodeSignature(sig) {
  if (/^[0-9a-fA-F]{128}$/.test(sig)) return Buffer.from(sig, 'hex');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(sig)) return null;
  const bytes = Buffer.from(sig, sig.includes('-') || sig.includes('_') ? 'base64url' : 'base64');
  return bytes.length === 64 ? bytes : null;
}
/** OtaVerify.signatureOk: ed25519 over the lowercase sha256 hex string. */
function signatureOk(sha256Hex, sig) {
  if (!/^[0-9a-fA-F]{64}$/.test(sha256Hex) || typeof sig !== 'string') return false;
  const bytes = decodeSignature(sig.trim());
  return bytes !== null && edVerify(null, Buffer.from(sha256Hex.toLowerCase(), 'ascii'), appPublicKey, bytes);
}
/** OtaLogic.acceptable. */
function acceptable(state, advertised, info, installedVersionCode, embeddedBuiltAtMs) {
  if (info.version !== advertised) return 'bundle.json names another version';
  if (info.minNativeVersionCode > installedVersionCode) return 'needs a newer app';
  if (info.builtAtMs <= embeddedBuiltAtMs) return "older than the app's own bundle";
  if (state.bad.includes(advertised) || advertised === state.current || advertised === state.pending) return 'not wanted';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// the server, through its own CLI, behind a TLS front

const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') };
function cli(...args) {
  const r = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`vitals-server ${args.slice(0, 3).join(' ')} failed (${r.status}): ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
}
const cliStatus = (...args) => spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
const freePort = () => new Promise((res, rej) => {
  const s = createServer().once('error', rej).listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

let server = null;
let front = null;
let logFile = '';
async function startServer() {
  if (!existsSync(join(pkgDir, 'dist', 'person-worker.mjs'))) throw new Error('Build the person program first: pnpm --filter vitals-companion build:person');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const port = await freePort();
  cli('init', '--role', 'home', '--port', String(port));
  const added = cli('persons', 'add', 'OTA E2E', '--tz', 'UTC');
  const personId = added.trim().split(/\s+/)[0];
  logFile = join(root, 'server.log');
  const fd = openSync(logFile, 'a');
  server = spawn(process.execPath, [bin, 'serve'], { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`the server exited (${server.exitCode}); see ${logFile}`);
    const h = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null);
    if (h?.role === 'home') return { url, port, personId, health: h };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the server did not answer /health; see ${logFile}`);
}
async function stopServer() {
  front?.close();
  if (!server || server.exitCode !== null) return true;
  const exited = new Promise((r) => server.once('exit', r));
  server.kill('SIGTERM');
  const t = setTimeout(() => server.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(t);
  return server.signalCode !== 'SIGKILL';
}

/** A self-signed certificate for 127.0.0.1, and the TLS front (as Caddy: X-Forwarded-For gets the peer appended). */
async function startFront(backendPort) {
  const keyFile = join(root, 'tls.key');
  const certFile = join(root, 'tls.crt');
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', keyFile, '-out', certFile, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '2'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  const cert = readFileSync(certFile);
  const port = await freePort();
  front = createHttpsServer({ key: readFileSync(keyFile), cert }, (req, res) => {
    const prior = req.headers['x-forwarded-for'];
    const xff = [prior, req.socket.remoteAddress].filter(Boolean).join(', ');
    const up = httpRequest({ host: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-for': xff } }, (b) => {
      res.writeHead(b.statusCode ?? 502, b.headers);
      b.pipe(res);
    });
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });
  await new Promise((ok) => front.listen(port, '127.0.0.1', ok));
  return { base: `https://127.0.0.1:${port}`, ca: cert };
}

/** `fetch` over https with the front's certificate trusted; never follows a redirect (as the app's native download). */
function tlsFetch(ca) {
  return (input, init = {}) => new Promise((ok, fail) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    const method = init.method ?? 'GET';
    const req = httpsRequest(url, { method, headers, ca }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = res.statusCode ?? 0;
        const body = method === 'HEAD' || [204, 205, 304].includes(status) ? null : Buffer.concat(parts);
        ok(new Response(body, { status, headers: h }));
      });
    });
    req.on('error', fail);
    init.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (init.body) req.write(init.body);
    req.end();
  });
}

/** The app's TypeScript (net/server.ts, platform/androidUpdates.ts) bundled for Node with the `@` alias. */
async function loadAppCode() {
  const req = createRequire(join(repo, 'package.json'));
  const { build } = await import(pathToFileURL(req.resolve('vite')).href);
  const out = join(root, 'app-code');
  const entry = join(root, 'app-entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(repo, 'src/platform/androidUpdates.ts'))};\nexport { createServerClient, SERVER_KEY } from ${JSON.stringify(join(repo, 'src/net/server.ts'))};\n`);
  await build({
    configFile: false, root: repo, logLevel: 'silent', resolve: { alias: { '@': join(repo, 'src') } },
    build: { outDir: out, emptyOutDir: true, minify: false, target: 'esnext', lib: { entry, formats: ['es'], fileName: () => 'app.mjs' } },
  });
  return import(pathToFileURL(join(out, 'app.mjs')).href);
}

// ---------------------------------------------------------------------------------------------------------------
// fixtures: a dummy APK and two more signed builds of the same dist

/** A stand-in APK: a zip with no readable manifest (the version comes from the flags). */
const dummyApk = makeZip([{ name: 'classes.dex', data: Buffer.from(`dex ota-e2e ${'x'.repeat(40_000)}`) }, { name: 'res/raw/a.bin', data: Buffer.alloc(9_000, 3) }]);
const APK_CODE = 602;
const APK_NAME = '0.6.2';
const INSTALLED_CODE = 601; // 0.6.1, as apps/android/android/app/build.gradle computes it
const stampMs = (v) => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
};

/** The dist in the real bundle, with another bundle.json, signed with the release key (never printed). */
function variant(builtAtMs, minNativeVersionCode) {
  const files = [];
  const dir = join(root, 'unzipped');
  spawnSync('rm', ['-rf', dir]);
  const u = spawnSync('unzip', ['-q', '-o', bundlePath, '-d', dir]);
  if (u.status !== 0) throw new Error('unzip failed');
  for (const f of collect(dir)) if (f.name !== 'bundle.json') files.push(f);
  const at = new Date(builtAtMs);
  const meta = { version: bundleVersion(at, bundleMeta.version.split('-')[1]), minNativeVersionCode, builtAt: at.toISOString() };
  files.push({ name: 'bundle.json', data: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`) });
  const zip = makeZip(files);
  const sig = signSha(sha256Hex(zip), readFileSync(keyPath, 'utf8'));
  const path = join(root, `vitals-web-${meta.version}.zip`);
  writeFileSync(path, zip);
  writeFileSync(`${path}.sig`, `${sig}\n`);
  return { path, meta, zip, sig };
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  console.log(`bundle ${bundleMeta.version} (built ${bundleMeta.builtAt}, needs versionCode ${bundleMeta.minNativeVersionCode}+), ${bundleZip.length} bytes`);
  // the key on this machine must be the app's key (checked without printing either)
  check('the release key matches the public key embedded in OtaVerify.kt', createPublicKey(createPrivateKey(readFileSync(keyPath, 'utf8'))).export({ format: 'jwk' }).x === Buffer.from(pubHex, 'hex').toString('base64url'));
  check('the bundle needs at most the installed versionCode (0.6.1 = 601)', bundleMeta.minNativeVersionCode <= INSTALLED_CODE, bundleMeta);

  const s = await startServer();
  const { base, ca } = await startFront(s.port);
  const f = tlsFetch(ca);
  console.log(`server ${s.health.version} on ${s.url}, TLS front ${base}`);

  section('pair a Vitals device with the app\'s own client');
  const app = await loadAppCode();
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  const client = app.createServerClient({ storage: store, fetchImpl: f, localNetworkDenied: async () => false });
  const code = /Code (\d{8})/.exec(cli('pair-code'))?.[1];
  check('`vitals-server pair-code` prints an 8-digit code', Boolean(code));
  const pairing = await client.pair({ baseUrl: base, code, label: 'OTA e2e phone' });
  check('the app paired through the TLS front', client.isPaired() && pairing.baseUrl === base, pairing);
  const token = JSON.parse(store.getItem(app.SERVER_KEY)).token;
  const auth = { authorization: `Bearer ${token}` };

  section('publish with the CLI');
  const apkPath = join(root, 'dummy.apk');
  writeFileSync(apkPath, dummyApk);
  const pubApk = cli('release', 'publish', 'vitals', '--apk', apkPath, '--version-name', APK_NAME, '--version-code', String(APK_CODE));
  check('the dummy APK is published with its sha256', pubApk.includes(sha256Hex(dummyApk)), pubApk);
  const pubWeb = cli('release', 'publish', 'vitals', '--web', bundlePath, '--version', bundleMeta.version, '--sig', sigPath);
  check('the web bundle is published with --version and --sig', pubWeb.includes(bundleMeta.version) && pubWeb.includes(sha256Hex(bundleZip)), pubWeb);
  check('the CLI does not print the signature', !pubWeb.includes(readFileSync(sigPath, 'utf8').trim()));
  const wrongVersion = cliStatus('release', 'publish', 'vitals', '--web', bundlePath, '--version', '0.6.1', '--sig', sigPath);
  check('a --version that is not the bundle.json version is refused', wrongVersion.status === 1, wrongVersion.stdout);
  const builtMs = Date.parse(bundleMeta.builtAt);
  const older = variant(builtMs - 3_600_000, bundleMeta.minNativeVersionCode);
  const olderPub = cliStatus('release', 'publish', 'vitals', '--web', older.path, '--version', older.meta.version, '--sig', `${older.path}.sig`);
  check('an older build published later is accepted (and kept below)', olderPub.status === 0, olderPub.stdout + olderPub.stderr);
  const future = variant(builtMs + 3_600_000, 9_999);
  const futurePub = cliStatus('release', 'publish', 'vitals', '--web', future.path, '--sig', `${future.path}.sig`);
  check('a newer build that needs versionCode 9999 is accepted', futurePub.status === 0, futurePub.stdout + futurePub.stderr);
  const list = cli('release', 'list', 'vitals');
  const order = [...list.matchAll(/web {2}(\S+)/g)].map((m) => m[1]);
  eq('the store lists web bundles newest build first, not by publish order', order, [future.meta.version, bundleMeta.version, older.meta.version]);

  section('/latest for each installed state');
  const latest = async (versionCode, web) => {
    const q = new URLSearchParams({ channel: 'stable', versionCode: String(versionCode), ...(web !== undefined ? { web } : {}) });
    const r = await f(`${base}/v1/apps/vitals/latest?${q}`, { headers: auth });
    return { status: r.status, body: await r.json() };
  };
  const embedded = bundleVersion(new Date(builtMs - 86_400_000), 'abcdef0'); // the APK's own bundle, a day older
  const first = await latest(INSTALLED_CODE, embedded);
  check('/latest answers 200', first.status === 200, first);
  const w = first.body.web;
  eq('the newest compatible bundle is offered to 0.6.1', w?.version, bundleMeta.version);
  check('its sha256 is the file\'s', w?.sha256 === sha256Hex(bundleZip) && w?.size === bundleZip.length, w);
  check('its sig is base64 and verifies with the app\'s key (Kotlin port)', /^[A-Za-z0-9+/]+={0,2}$/.test(w?.sig ?? '') && signatureOk(w.sha256, w.sig));
  check('its url is relative to the paired origin', /^\/v1\/apps\/vitals\/files\/stable\/web-[^/]+\.zip$/.test(w?.url ?? ''), w?.url);
  eq('the newer APK is offered with its sha256', first.body.apk && { code: first.body.apk.versionCode, sha: first.body.apk.sha256 }, { code: APK_CODE, sha: sha256Hex(dummyApk) });
  eq('a phone on the older build is offered the newer one', (await latest(INSTALLED_CODE, older.meta.version)).body.web?.version, bundleMeta.version);
  eq('a phone on the newest compatible build is offered nothing', (await latest(INSTALLED_CODE, bundleMeta.version)).body.web, null);
  eq('the older build is never offered, even to a phone with nothing installed', (await latest(INSTALLED_CODE)).body.web?.version, bundleMeta.version);
  eq('an APK whose own bundle is newer is offered nothing', (await latest(INSTALLED_CODE, bundleVersion(new Date(builtMs + 120_000), 'abcdef0'))).body.web, null);
  eq('the build that needs versionCode 9999 reaches only such an app', (await latest(9_999, bundleMeta.version)).body.web?.version, future.meta.version);
  eq('nothing compatible below the bundle\'s minNativeVersionCode', (await latest(bundleMeta.minNativeVersionCode - 1, embedded)).body.web, null);
  eq('apk-<name> of an APK published after the build: nothing newer', (await latest(APK_CODE, `apk-${APK_NAME}`)).body.web, null);
  eq('apk-<name> of an APK this server never published: nothing (unknown age)', (await latest(INSTALLED_CODE, 'apk-0.6.1')).body.web, null);
  eq('the APK is not offered to an app at its versionCode', (await latest(APK_CODE, bundleMeta.version)).body.apk, null);

  section('the app\'s own check with a Node port of the native side');
  const files = new Map();
  const downloads = [];
  const native = {
    state: { current: null, pending: null, bad: [] },
    status: {
      versionName: '0.6.1', versionCode: INSTALLED_CODE, webVersion: embedded, webEmbedded: true, webPending: null, bad: [], metered: false, apk: null,
    },
    async ready() {},
    async install() { return { result: 'none' }; },
    addListener() { return { remove() {} }; },
  };
  const plugin = {
    ready: native.ready,
    status: async () => structuredClone(native.status),
    install: native.install,
    addListener: native.addListener,
    async download(o) {
      downloads.push({ kind: o.kind, url: o.url, version: o.version, versionCode: o.versionCode, tokenSent: o.token === token });
      if (!o.url.startsWith(`${base}/`)) return { result: 'failed', reason: 'not the paired origin' };
      // OtaDownloads.fetch: GET with the bearer token, no redirects; here in two ranged parts, as a resumed download
      const head = await f(o.url, { method: 'HEAD', headers: { authorization: `Bearer ${o.token}` } });
      const size = Number(head.headers.get('content-length'));
      const half = Math.floor(size / 2);
      const p1 = await f(o.url, { headers: { authorization: `Bearer ${o.token}`, range: `bytes=0-${half - 1}` } });
      const p2 = await f(o.url, { headers: { authorization: `Bearer ${o.token}`, range: `bytes=${half}-`, 'if-range': head.headers.get('etag') } });
      const body = Buffer.concat([Buffer.from(await p1.arrayBuffer()), Buffer.from(await p2.arrayBuffer())]);
      files.set(o.kind, { size, p1: p1.status, p2: p2.status, range1: p1.headers.get('content-range'), range2: p2.headers.get('content-range'), body });
      if (body.length !== o.size) return { result: 'failed', reason: 'size' };
      const sha = sha256Hex(body);
      if (sha !== o.sha256.toLowerCase()) return { result: 'failed', reason: 'sha256 mismatch' };
      if (o.kind === 'apk') {
        native.status.apk = { versionName: o.versionName, versionCode: o.versionCode };
        return { result: 'ready' };
      }
      if (!signatureOk(sha, o.sig)) return { result: 'failed', reason: 'bad signature' };
      const zipPath = join(root, 'downloaded.zip');
      writeFileSync(zipPath, body);
      const bj = JSON.parse((await readZipEntry(zipPath, 'bundle.json')).toString('utf8'));
      const index = await readZipEntry(zipPath, 'index.html');
      if (!index) return { result: 'failed', reason: 'no index.html' };
      const why = acceptable(native.state, o.version, { version: bj.version, minNativeVersionCode: bj.minNativeVersionCode, builtAtMs: Date.parse(bj.builtAt) }, INSTALLED_CODE, stampMs(embedded));
      if (why) return { result: 'skipped', reason: why };
      native.state.pending = o.version;
      native.status.webPending = o.version;
      return { result: 'staged' };
    },
  };
  await app.checkForUpdates({ plugin, client });
  const view = app.getUpdatesView();
  const web = downloads.find((d) => d.kind === 'web');
  const apk = downloads.find((d) => d.kind === 'apk');
  check('checkForUpdates reached the server', view.checked === true, view);
  eq('it asked the native side for the newest compatible bundle', web?.version, bundleMeta.version);
  check('…on the paired origin, absolute, with the device token', web?.url === `${base}${w.url}` && web.tokenSent, web);
  const wf = files.get('web');
  check('the bundle downloaded in two ranges (206 + Content-Range)', wf?.p1 === 206 && wf?.p2 === 206 && wf.range1 === `bytes 0-${Math.floor(wf.size / 2) - 1}/${wf.size}` && wf.range2 === `bytes ${Math.floor(wf.size / 2)}-${wf.size - 1}/${wf.size}`, wf && { ...wf, body: undefined });
  check('the reassembled bundle is byte-identical to the published zip', wf?.body.equals(bundleZip));
  eq('the native port staged it (sha256, ed25519, bundle.json, built after the APK\'s own)', native.state.pending, bundleMeta.version);
  eq('it asked for the newer APK too', apk && { code: apk.versionCode, token: apk.tokenSent }, { code: APK_CODE, token: true });
  check('the downloaded APK is the published one', files.get('apk')?.body.equals(dummyApk));
  eq('Settings shows "Update ready"', app.updateState(app.getUpdatesView()), 'ready');
  // a second check: the bundle is pending and the APK downloaded, so nothing is fetched again
  downloads.length = 0;
  await app.checkForUpdates({ plugin, client });
  eq('a second check downloads nothing', downloads.length, 0);
  // a bad version is never fetched again; a tampered signature never verifies
  native.status = { ...native.status, webPending: null, bad: [bundleMeta.version] };
  await app.checkForUpdates({ plugin, client });
  eq('a version marked bad is not downloaded', downloads.filter((d) => d.kind === 'web').length, 0);
  const tampered = Buffer.from(w.sig, 'base64');
  tampered[5] ^= 1;
  check('a tampered signature fails the Kotlin-port check', !signatureOk(w.sha256, tampered.toString('base64')));
  check('the signature also verifies as hex (OtaVerify accepts both)', signatureOk(w.sha256, Buffer.from(w.sig, 'base64').toString('hex')));
  check('…and not for another sha256', !signatureOk(sha256Hex(older.zip), w.sig));

  section('file route');
  const fileUrl = `${base}${w.url}`;
  const head = await f(fileUrl, { method: 'HEAD', headers: auth });
  check('HEAD gives Content-Length, Accept-Ranges and the sha256 ETag', head.status === 200 && Number(head.headers.get('content-length')) === bundleZip.length && head.headers.get('accept-ranges') === 'bytes' && head.headers.get('etag') === `"${w.sha256}"`);
  const tail = await f(fileUrl, { headers: { ...auth, range: 'bytes=-100' } });
  check('a suffix range gives the last 100 bytes', tail.status === 206 && Buffer.from(await tail.arrayBuffer()).equals(bundleZip.subarray(-100)));
  eq('an unsatisfiable range is 416', (await f(fileUrl, { headers: { ...auth, range: `bytes=${bundleZip.length}-` } })).status, 416);
  const stale = await f(fileUrl, { headers: { ...auth, range: 'bytes=0-9', 'if-range': '"stale"' } });
  check('a stale If-Range sends the whole file', stale.status === 200 && Number(stale.headers.get('content-length')) === bundleZip.length);
  eq('no token: 401', (await f(fileUrl)).status, 401);
  eq('no token on /latest: 401', (await f(`${base}/v1/apps/vitals/latest?versionCode=1`)).status, 401);
  eq('a Vitals token cannot see gauge', (await f(`${base}/v1/apps/gauge/latest?versionCode=1`, { headers: auth })).status, 403);
  eq('a file the index does not name: 404', (await f(`${base}/v1/apps/vitals/files/stable/web-nope.zip`, { headers: auth })).status, 404);
  check('the file answer is not a redirect', ![301, 302, 303, 307, 308].includes((await f(fileUrl, { method: 'HEAD', headers: auth })).status));

  section('/install on loopback, no token');
  const direct = await fetch(`${s.url}/install`);
  const html = await direct.text();
  check('GET /install answers 200 HTML on loopback', direct.status === 200 && /text\/html/.test(direct.headers.get('content-type') ?? ''), direct.status);
  check('it links the Vitals APK and says Gauge is not published', html.includes('href="/install/vitals.apk"') && /Gauge <span>\(not published yet\)/.test(html));
  check('it shows no versions or data', !html.includes(APK_NAME) && !html.includes(bundleMeta.version));
  const dl = await fetch(`${s.url}/install/vitals.apk`);
  const dlBody = Buffer.from(await dl.arrayBuffer());
  check('GET /install/vitals.apk gives the latest APK', dl.status === 200 && dlBody.equals(dummyApk) && dl.headers.get('content-type') === 'application/vnd.android.package-archive');
  check('…named after its version', (dl.headers.get('content-disposition') ?? '').includes(`vitals-${APK_NAME}.apk`));
  eq('/install/gauge.apk is 404 until published', (await fetch(`${s.url}/install/gauge.apk`)).status, 404);
  eq('/install through the TLS front (X-Forwarded-For 127.0.0.1) answers', (await f(`${base}/install`)).status, 200);
  // the proxy appends the client's address; only that last entry counts
  eq('a proxied public client (last X-Forwarded-For 203.0.113.7) gets 404', (await fetch(`${s.url}/install`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 404);
  eq('…for the APK as well', (await fetch(`${s.url}/install/vitals.apk`, { headers: { 'x-forwarded-for': '100.64.0.1, 203.0.113.7' } })).status, 404);
  eq('a proxied tailnet client (100.64.0.2) gets the page', (await fetch(`${s.url}/install`, { headers: { 'x-forwarded-for': '100.64.0.2' } })).status, 200);
  eq('a spoofed earlier X-Forwarded-For entry through the front changes nothing', (await f(`${base}/install`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 200);
  eq('a Funnel request gets 404', (await fetch(`${s.url}/install`, { headers: { 'tailscale-funnel-request': '?1' } })).status, 404);

  section('server log');
  const log = readFileSync(logFile, 'utf8');
  check('the server log holds no token', !log.includes(token));
  check('the server log holds no signature', !log.includes(w.sig) && !log.includes(older.sig));

  section('stop');
  check('the server stops on SIGTERM', await stopServer());
}

let crashed = null;
try {
  await main();
} catch (e) {
  crashed = e;
  console.log(`\nCRASH ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  await stopServer().catch(() => undefined);
  if (!opt.keep) await rm(root, { recursive: true, force: true }).catch(() => undefined);
}
console.log(`\n${passed} passed, ${failures.length} failed${crashed ? ', crashed' : ''}`);
process.exit(failures.length || crashed ? 1 : 0);
