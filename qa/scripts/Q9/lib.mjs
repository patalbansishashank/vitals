// Shared helpers of the Q9 ring-path journeys (qa/scripts/Q9/*.mjs).
// Secrets (sync words, pairing codes, device tokens, broker passwords) stay in memory or under .e6-tmp/q9 (0600);
// nothing here prints them.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { serverUrl, localConfig } from '../lib/localConfig.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const TMP = join(ROOT, '.e6-tmp', 'q9');
mkdirSync(TMP, { recursive: true, mode: 0o700 });
export const SERVER = process.env.Q9_SERVER || serverUrl();
/** oci-arm allows only the production origin; the local build is served under it by request routing. */
export const ORIGIN = 'https://vitals.creative.desi';
export const PREVIEW = `http://127.0.0.1:${process.env.Q9_PORT || 5282}`;
export const TZ = 'Asia/Kolkata';
// mqtt.js is a dev dependency of packages/companion only
export const { default: mqtt } = await import(pathToFileURL(createRequire(join(ROOT, 'packages/companion/package.json')).resolve('mqtt')).href);

const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Check list per journey: { journey, name, ok, detail }. */
export function checker() {
  const checks = [];
  let journey = '';
  return {
    checks,
    journey: (j) => { journey = j; log(`==== ${j}`); },
    check(name, ok, detail = '') {
      checks.push({ journey, name, ok: Boolean(ok), detail: String(detail).slice(0, 600) });
      log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
      return Boolean(ok);
    },
    summary() {
      const by = {};
      for (const c of checks) (by[c.journey] ??= { pass: 0, fail: 0 })[c.ok ? 'pass' : 'fail']++;
      return by;
    },
  };
}

// ---- server CLI over ssh, only for persons labelled q9-… -------------------------------------------------------------
const CLI = '~/vitals-server/current/bin/vitals-server.mjs';
const myPersons = new Map(); // id → label
export function cli(args, { input } = {}) {
  return execFileSync('ssh', ['-o', 'ConnectTimeout=15', localConfig(['serverSsh']).serverSsh, `${CLI} ${args}`], { input, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
}
export function listPersons() {
  return cli('persons list').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^[0-9a-f]{16}$/.test(p[0] ?? '')).map(([id, label]) => ({ id, label }));
}
export function addPerson(label, phrase) {
  if (!/^q9-/.test(label)) throw new Error('Q9 creates only q9-… persons');
  const out = cli(`persons add ${JSON.stringify(label)} --tz ${TZ}${phrase ? ' --join' : ''}`, { input: phrase ? `${phrase}\n` : '' });
  const id = /\b([0-9a-f]{16})\s+q9-/.exec(out)?.[1];
  if (!id) throw new Error(`persons add gave no id: ${out.replace(/[a-z]+( [a-z]+){11,}/g, '…').slice(0, 200)}`);
  myPersons.set(id, label);
  return id;
}
const mine = (id) => {
  if (!myPersons.has(id) && !listPersons().some((p) => p.id === id && p.label.startsWith('q9-'))) throw new Error(`refusing to touch person ${id}`);
};
export function pairCode(id, label = 'Q9 browser') {
  mine(id);
  const out = cli(`pair code ${id} --label ${JSON.stringify(label)}`);
  const code = /Code (\d{8})/.exec(out)?.[1];
  if (!code) throw new Error('no pairing code in the CLI output');
  return code;
}
export function removePerson(id) {
  mine(id);
  return cli(`persons remove ${id}`).trim();
}
export function removeAllQ9() {
  const gone = [];
  for (const p of listPersons()) if (p.label.startsWith('q9-')) gone.push(`${p.label}: ${cli(`persons remove ${p.id}`).trim()}`);
  return gone;
}

// ---- local preview under the production origin ------------------------------------------------------------------------
export async function startPreview() {
  try {
    const r = await fetch(`${PREVIEW}/`);
    if (r.ok) return null; // already running
  } catch { /* start it */ }
  const p = spawn('npx', ['vite', 'preview', '--outDir', 'dist', '--port', PREVIEW.split(':').pop(), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { if ((await fetch(`${PREVIEW}/`)).ok) return p; } catch { /* wait */ }
  }
  throw new Error('vite preview did not start');
}

/**
 * A browser profile kept under .e6-tmp/q9/prof-<name> (so a journey can be re-run on the same profile): pages of ORIGIN
 * come from the local preview (its headers, CSP included), everything else goes to the real network.
 */
export async function profile(name, { width = 1440, height = 900, colorScheme = 'light', fresh = false } = {}) {
  const dir = join(TMP, `prof-${name}`);
  if (fresh) rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWarningOnly'],
    viewport: { width, height }, timezoneId: TZ, locale: 'en-IN', colorScheme, serviceWorkers: 'block', acceptDownloads: true,
  });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(`${PREVIEW}${u.pathname}${u.search}`, { method: route.request().method(), headers: { accept: route.request().headers().accept ?? '*/*' } });
    const headers = {};
    r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v; });
    await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  return { ctx, page, errors, name };
}

export const qaRead = (page, id, input = {}) => page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
export async function waitQa(page) {
  await page.waitForFunction(() => Boolean(window.__vitals), null, { timeout: 30000 });
}
/** All documents of a collection from `data.export` (format 2). */
export async function exportDocs(page) {
  const r = await qaRead(page, 'data.export', {});
  if (!r.ok) throw new Error(`data.export: ${JSON.stringify(r.error)}`);
  return JSON.parse(r.output.text);
}

/** A profile with a person's answers (fixture export) and the screener, as I3's smoke did. */
export async function seedProfile(page) {
  await page.goto(`${ORIGIN}/settings?qa=1`, { waitUntil: 'load' });
  await page.locator('section:has(h2:text("Your data")) input[type=file], #your-data input[type=file]').first().setInputFiles(join(ROOT, 'qa/fixtures/q1b/export-m-veg.json'));
  await page.getByRole('radio', { name: 'replace' }).check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await sleep(2500);
  await page.goto(`${ORIGIN}/coach`, { waitUntil: 'load' });
  await sleep(1500);
  if (await page.getByRole('button', { name: 'Save answers' }).count()) {
    await page.getByRole('radio', { name: '18–64' }).click();
    const fs = page.locator('fieldset');
    for (let i = 1; i < (await fs.count()); i++) {
      const no = fs.nth(i).getByRole('radio', { name: 'no', exact: true });
      if (await no.count()) await no.first().click();
    }
    await page.getByRole('button', { name: 'Save answers' }).click();
    await sleep(2000);
  }
}

/** Settings › Sync against the server's relay; returns the 24 words (kept in memory, never printed). */
export async function setUpSync(page) {
  await page.goto(`${ORIGIN}/settings?qa=1#sync`, { waitUntil: 'load' });
  const sync = page.locator('section#sync');
  await sync.getByLabel('sync server address').fill(SERVER);
  await sync.getByRole('button', { name: 'Set up sync on this device' }).click();
  const words = page.locator('ol[aria-label="The 24 words"] li span:last-child');
  await words.first().waitFor({ timeout: 45000 });
  const phrase = (await words.allTextContents()).join(' ').trim();
  await sync.getByLabel("I've saved the words").check();
  await sync.getByRole('button', { name: 'Hide', exact: true }).click();
  await sleep(1500);
  return phrase;
}

/** Settings › Server: pair with a code from the CLI. */
export async function pairBrowser(page, code) {
  await page.goto(`${ORIGIN}/settings?section=server&qa=1`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Enter code' }).first().click();
  await page.getByLabel('server address').first().fill(SERVER);
  const first = page.getByLabel('first 4 digits');
  if (await first.count()) {
    await first.fill(code.slice(0, 4));
    await page.getByLabel('last 4 digits').fill(code.slice(4));
  } else await page.getByLabel('pairing code').first().fill(code);
  await page.getByRole('button', { name: /^Pair( this device)?$/ }).first().click();
  await page.getByText(/Paired with/).first().waitFor({ timeout: 30000 }).catch(() => undefined);
  return page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('vitals.server.v1') || 'null')?.token));
}

/** A call to the paired server with this page's device token (the token never leaves the page). */
export const serverCall = (page, method, path, body) =>
  page.evaluate(async ([method, path, body]) => {
    const s = JSON.parse(localStorage.getItem('vitals.server.v1'));
    const r = await fetch(`${s.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json };
  }, [method, path, body]);

/** Saves a value under .e6-tmp/q9 (0600); used for broker logins so a rerun can find them. Never printed. */
export function keep(name, value) {
  writeFileSync(join(TMP, name), JSON.stringify(value), { mode: 0o600 });
}
export const kept = (name) => (existsSync(join(TMP, name)) ? JSON.parse(readFileSync(join(TMP, name), 'utf8')) : null);

// ---- Lumen Health-shaped events ---------------------------------------------------------------------------------------
const enc = (o) => JSON.stringify(o);
/** The envelope and id rule of make_stream.py (BroadcastEventMapper.kt): id = pl- + sha256(type|subject|observed|data − received_at)[:40]. */
export function lumenEvent(inst, type, subject, suffix, observed, values, received) {
  const data = { schema_version: 1, observed_at: observed, received_at: received, ...values };
  const { received_at: _r, ...ident } = data;
  const id = `pl-${createHash('sha256').update(`${type}|${subject}|${observed}|${enc(ident)}`).digest('hex').slice(0, 40)}`;
  const env = { specversion: '1.0', id, type, source: `urn:pulseloop:installation:${inst}`, subject, time: observed, datacontenttype: 'application/json', data };
  return { topic: `lumen-health/v1/${inst}/${suffix}`, payload: enc(env) };
}

/** Topic suffix Lumen Health uses for a bare CloudEvent (R16 §2 topic table). */
export function topicSuffix(ev) {
  const t = ev.type;
  if (t === 'health.metric.observed') return `metrics/${ev.subject}`;
  if (t === 'health.vendor_metric.observed') return `vendor/${String(ev.subject).replace(/^vendor\./, '')}`;
  if (t === 'health.activity.bucket.observed') return 'activity/buckets';
  if (t === 'health.activity.updated') return 'activity/daily';
  if (t === 'health.sleep.timeline.updated') return 'sleep/timeline';
  if (t.startsWith('health.insight')) return `insights/${ev.subject}`;
  if (t === 'health.device.battery.updated') return 'state/battery';
  if (t === 'health.device.firmware.updated') return 'state/firmware';
  if (t === 'health.device.wear_state.updated') return 'state/wear';
  if (t === 'health.sync.progress') return 'state/sync';
  if (t.startsWith('health.device.')) return `state/${t.split('.')[2]}`;
  return `other/${t}`;
}

/** Last night (bed yesterday 23:10, woke today 06:40, Asia/Kolkata), today's steps and some HR, as Lumen would send. */
export function lastNightStream(inst, today, { steps = 4210, battery = 64 } = {}) {
  const [y, m, d] = today.split('-').map(Number);
  const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
  // 23:10 IST yesterday = 17:40 UTC yesterday
  const bed = Date.UTC(y, m - 1, d - 1, 17, 40);
  const stagesPattern = [['awake', 12], ['light', 50], ['deep', 45], ['light', 40], ['rem', 25], ['light', 45], ['deep', 30], ['rem', 35], ['light', 50], ['awake', 4], ['light', 30], ['rem', 40], ['light', 30], ['awake', 14]];
  const stages = stagesPattern.flatMap(([s, n]) => Array(n).fill(s));
  const wake = bed + stages.length * 60000; // 450 min → 06:40 IST
  const recv = iso(wake + 50 * 60000);
  const out = [];
  out.push(lumenEvent(inst, 'health.sleep.timeline.updated', 'sleep_timeline', 'sleep/timeline', iso(bed), { sample_interval_minutes: 1, complete_session: true, stages, provenance: 'device_classified', replayed: true }, recv));
  for (let i = 0; i < 8; i++) {
    const t = iso(bed + i * 55 * 60000);
    out.push(lumenEvent(inst, 'health.metric.observed', 'hr', 'metrics/hr', t, { metric: 'hr', value: [58, 54, 51, 49, 50, 52, 55, 60][i], unit: 'bpm', provenance: 'device_history', quality: 'unverified', replayed: true }, recv));
  }
  for (let h = 0; h < 4; h++) {
    const t = iso(wake + (h + 1) * 3600000);
    out.push(lumenEvent(inst, 'health.metric.observed', 'hr', 'metrics/hr', t, { metric: 'hr', value: [72, 81, 77, 69][h], unit: 'bpm', provenance: 'device_history', quality: 'unverified', replayed: true }, iso(wake + (h + 1) * 3600000 + 300000)));
  }
  const nowish = iso(wake + 4.5 * 3600000);
  out.push(lumenEvent(inst, 'health.activity.updated', 'daily_activity', 'activity/daily', nowish, { steps, distance_m: 3010.0, calories_kcal: 150.0, calories_provenance: 'device_estimate', calories_energy_basis: 'unspecified_by_device', active_minutes: 22, provenance: 'device_reported' }, nowish));
  out.push(lumenEvent(inst, 'health.device.battery.updated', 'battery', 'state/battery', nowish, { percent: battery, provenance: 'device_reported' }, nowish));
  return { messages: out, bed: iso(bed), wake: iso(wake), asleepMin: stages.filter((s) => s !== 'awake').length };
}

/** A Lumen-like publisher: MQTT 3.1.1, clean session, QoS 1, at most 10 in flight, resend on a missing PUBACK. */
export async function lumenClient(url, username, password, clientId = `q9-${Math.random().toString(36).slice(2, 8)}`) {
  return mqtt.connectAsync(url, { username, password, clientId, protocolVersion: 4, clean: true, reconnectPeriod: 0, keepalive: 60, connectTimeout: 20000 });
}
/** Publishes with at most `inflight` unacknowledged messages (Lumen's outbox window). */
export async function publishAll(client, messages, inflight = 10) {
  const queue = [...messages];
  const run = async () => {
    while (queue.length) {
      const m = queue.shift();
      await client.publishAsync(m.topic, m.payload, { qos: 1 });
    }
  };
  await Promise.all(Array.from({ length: Math.min(inflight, messages.length) }, run));
}
