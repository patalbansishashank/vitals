// E22: two-device sync proof through the Companion relay on oci-arm (phone offline).
// Two separate browser contexts (A, B) on the production build. A sets up sync against the relay, B joins with the
// 24 words, A logs a weight value (bio.manual through the app's WebMCP surface = the command bus), B must receive it.
// The 24 words are never printed or saved; the pairing panel is hidden before the screenshots.
//
// Usage: node qa/scripts/e22/two-profiles-sync.mjs
//   BASE  app origin            (default http://127.0.0.1:5187, a `vite preview` of the production build)
//   RELAY sync server address   (default: serverUrl in qa/local.config.json)
import { chromium } from 'playwright-core';
import { serverUrl } from '../lib/localConfig.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:5187';
const RELAY = process.env.RELAY || serverUrl();
const SHOTS = process.env.SHOTS || 'qa/screenshots';
const VALUE = Number(process.env.VALUE || (80 + Math.round(Math.random() * 1000) / 100).toFixed(2));
const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const fail = [];

const health = async () => {
  try {
    const r = await fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(10000) });
    return `${r.status} ${await r.text()}`;
  } catch (e) {
    return `error ${e.message}`;
  }
};

/** Polyfill for WebMCP: the app registers its webmcp-surface tools here (src/agents/webmcp.ts). */
function webmcpPolyfill() {
  localStorage.setItem('vitals-agents.webmcp', 'true'); // device-local flag, default off
  window.__tools = {};
  const mc = {
    registerTool(t) {
      window.__tools[t.name] = t;
      return { unregister() { delete window.__tools[t.name]; } };
    },
    unregisterTool(n) { delete window.__tools[n]; },
  };
  Object.defineProperty(navigator, 'modelContext', { value: mc, configurable: true });
}

async function profile(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(webmcpPolyfill);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(RELAY.replace(/^http/, 'ws')) || r.url().startsWith(RELAY)) errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('websocket', (ws) => log(`${name} websocket ${ws.url()}`));
  return { name, ctx, page, errors };
}

const tool = async (p, name, input = {}) => {
  await p.page.waitForFunction((n) => window.__tools && window.__tools[n], name, { timeout: 20000 });
  const res = await p.page.evaluate(async ([n, i]) => (await window.__tools[n].execute(i)).content[0].text, [name, input]);
  return JSON.parse(res);
};
const syncText = async (p) => (await p.page.locator('section#sync').innerText()).replace(/\s*\n\s*/g, ' | ').slice(0, 300);
/** bioRecords in the device's local IndexedDB mirror (vitals-docs) whose JSON mentions the value. */
const idbHas = (p, value) =>
  p.page.evaluate(
    (value) =>
      new Promise((resolve) => {
        const open = indexedDB.open('vitals-docs');
        open.onerror = () => resolve({ error: String(open.error) });
        open.onsuccess = () => {
          const db = open.result;
          const store = [...db.objectStoreNames].find((s) => db.transaction(s).objectStore(s).indexNames.contains('col'));
          if (!store) return resolve({ error: 'no store with col index' });
          const req = db.transaction(store).objectStore(store).index('col').getAll('bioRecords');
          req.onsuccess = () => {
            const rows = req.result;
            const hits = rows.filter((r) => JSON.stringify(r).includes(String(value)));
            resolve({ bioRecords: rows.length, hits: hits.length });
          };
          req.onerror = () => resolve({ error: String(req.error) });
        };
      }),
    value,
  );

log(`BASE=${BASE} RELAY=${RELAY} value=${VALUE} kg date=${today}`);
const before = await health();
log(`health before: ${before}`);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const A = await profile(browser, 'A');
const B = await profile(browser, 'B');
try {
  // ---- A: set up sync
  await A.page.goto(`${BASE}/settings#sync`, { waitUntil: 'load' });
  const secA = A.page.locator('section#sync');
  await secA.getByLabel('sync server address').fill(RELAY);
  await secA.getByRole('button', { name: 'Test', exact: true }).click();
  await A.page.waitForTimeout(3000);
  log(`A test: ${await syncText(A)}`);
  await secA.getByRole('button', { name: 'Set up sync on this device' }).click();
  const words = A.page.locator('ol[aria-label="The 24 words"] li span:last-child');
  await words.first().waitFor({ timeout: 30000 });
  const wordList = await words.allTextContents();
  log(`A pairing panel shown: ${wordList.length} words (not printed)`);
  if (wordList.length !== 24) fail.push(`A shows ${wordList.length} words, expected 24`);
  // hide the secret before any screenshot
  await secA.getByLabel("I've saved the words").check();
  await secA.getByRole('button', { name: 'Hide', exact: true }).click();
  await A.page.waitForTimeout(1500);
  log(`A sync section: ${await syncText(A)}`);

  // ---- B: join with the words + server address
  await B.page.goto(`${BASE}/settings#sync`, { waitUntil: 'load' });
  const secB = B.page.locator('section#sync');
  await secB.getByLabel('sync server address').fill(RELAY);
  await secB.getByRole('button', { name: 'Join with a pairing code' }).click();
  await secB.getByLabel('pairing code').fill(wordList.join(' '));
  await secB.getByRole('button', { name: 'Join', exact: true }).click();
  for (let i = 0; i < 20; i++) {
    await B.page.waitForTimeout(1000);
    const dlg = B.page.getByRole('alertdialog');
    if (await dlg.count()) {
      log(`B existing-data dialog: ${(await dlg.innerText()).replace(/\n/g, ' | ')} -> Merge`);
      await dlg.getByRole('button', { name: 'Merge' }).click();
    }
    if ((await secB.getByRole('button', { name: 'Join with a pairing code' }).count()) === 0) break;
  }
  await B.page.waitForTimeout(2000);
  log(`B sync section: ${await syncText(B)}`);
  const statusB0 = await tool(B, 'sync_status');
  log(`B sync_status: ${JSON.stringify(statusB0.data ?? statusB0).slice(0, 300)}`);
  log(`B before entry: idb=${JSON.stringify(await idbHas(B, VALUE))}`);

  // ---- A: log a weight value through the command bus (WebMCP surface → guardedCall → dispatch)
  const r = await tool(A, 'bio_manual', { date: today, metric: 'weight_kg', value: VALUE, note: 'E22 two-device sync proof' });
  log(`A bio_manual: ${JSON.stringify(r).slice(0, 300)}`);
  if (!r.ok) fail.push('A bio_manual failed');
  log(`A local: idb=${JSON.stringify(await idbHas(A, VALUE))}`);
  log(`A sync_now: ${JSON.stringify(await tool(A, 'sync_now')).slice(0, 200)}`);

  // ---- B: wait for it (≤ 60 s, Sync now every round)
  let got = null;
  const tStart = Date.now();
  while (Date.now() - tStart < 60000) {
    await tool(B, 'sync_now').catch(() => undefined);
    await B.page.waitForTimeout(3000);
    const idb = await idbHas(B, VALUE);
    if (idb.hits > 0) {
      got = { idb, ms: Date.now() - tStart };
      break;
    }
  }
  if (got) log(`PASS: B received ${VALUE} kg after ${(got.ms / 1000).toFixed(1)} s: idb=${JSON.stringify(got.idb)}`);
  else fail.push('B did not receive the entry within 60 s');
  const srcB = await tool(B, 'bio_sources');
  const manualB = srcB.data?.sources?.find((s) => s.sourceKey === 'manual');
  log(`B bio_sources manual: ${JSON.stringify(manualB ? { records: manualB.records, firstDate: manualB.firstDate, lastDate: manualB.lastDate } : null)}`);
  log(`A sync section: ${await syncText(A)}`);
  log(`B sync section: ${await syncText(B)}`);

  await A.page.locator('section#sync').scrollIntoViewIfNeeded();
  await A.page.locator('section#sync').screenshot({ path: `${SHOTS}/E22-sync-A.png` });
  await B.page.locator('section#sync').scrollIntoViewIfNeeded();
  await B.page.locator('section#sync').screenshot({ path: `${SHOTS}/E22-sync-B.png` });
} catch (e) {
  fail.push(`exception: ${e.message.split('\n')[0]}`);
} finally {
  log(`health after: ${await health()}`);
  for (const p of [A, B]) log(`${p.name} console errors/warnings (${p.errors.length}):\n  ${p.errors.slice(0, 30).join('\n  ')}`);
  await browser.close();
  log(fail.length ? `RESULT: FAIL\n  ${fail.join('\n  ')}` : 'RESULT: PASS');
  process.exitCode = fail.length ? 1 : 0;
}
