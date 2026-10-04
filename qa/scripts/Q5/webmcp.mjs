// Q5 (from E22): WebMCP end to end in headless Chromium 153 over CDP (R14 §5 recipe).
// usage: node qa/scripts/e22/webmcp-cdp.mjs [--headless-new]   (env BASE, default http://127.0.0.1:5193)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:5193';
const LOG = 'qa/results/Q5/webmcp-cdp.log';
const out = [];
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(s); out.push(s); };
const checks = [];
const check = (name, ok, extra = '') => { checks.push({ name, ok }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DESTRUCTIVE = ['plan_end', 'plan_replace', 'coach_delete', 'bio_delete_source', 'data_import', 'data_erase_all', 'sync_unpair'];
const headlessNew = process.argv.includes('--headless-new');

async function launch(flag) {
  const args = ['--no-sandbox', ...(flag ? ['--enable-features=WebMCP'] : [])];
  if (headlessNew) args.push('--headless=new');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('vitals.qa', '1'); } catch { /* none */ } }); // read-only command-bus hook
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return { browser, ctx, page, errors };
}
const webmcpSwitch = (page) => page.locator('#agents').getByRole('switch').first();
async function gotoAgents(page) {
  await page.goto(BASE + '/settings?r=' + Date.now().toString(36) + '#agents', { waitUntil: 'networkidle' }); // query: a full load, never a same-document hash change
  await page.locator('#agents').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
}

/* ---- run 1: without the flag ---- */
{
  log(`== run A: no --enable-features=WebMCP ${headlessNew ? '(--headless=new)' : ''}`);
  const { browser, page } = await launch(false);
  await gotoAgents(page);
  const mc = await page.evaluate(() => ({ doc: typeof document.modelContext, nav: typeof navigator.modelContext, ua: navigator.userAgent }));
  log('modelContext', mc);
  check('A: document.modelContext absent without flag', mc.doc === 'undefined' && mc.nav === 'undefined');
  const sec = await page.locator('#agents').innerText();
  check("A: Settings shows \"can't share tools\" text", /can.t share tools with agents yet/.test(sec));
  check('A: switch disabled', await webmcpSwitch(page).isDisabled());
  await page.locator('#agents').screenshot({ path: 'qa/screenshots/Q5-webmcp-settings-noflag.png' });
  await browser.close();
}

/* ---- run 2: with the flag ---- */
log(`== run B: --enable-features=WebMCP ${headlessNew ? '(--headless=new)' : ''}`);
const { browser, ctx, page, errors } = await launch(true);
const cdp = await ctx.newCDPSession(page);
const tools = new Map(); const removed = []; const responded = new Map(); const invoked = [];
let addedEvents = 0, removedEvents = 0;
cdp.on('WebMCP.toolsAdded', (e) => { addedEvents++; for (const t of e.tools ?? []) tools.set(t.name, t); });
cdp.on('WebMCP.toolsRemoved', (e) => { removedEvents++; removed.push(...(e.tools ?? [])); });
cdp.on('WebMCP.toolInvoked', (e) => invoked.push(e));
cdp.on('WebMCP.toolResponded', (e) => responded.set(e.invocationId, e));
// a first-run profile (welcome steps) so the app routes render; Settings is outside the gate anyway
process.env.BASE = BASE;
const { firstRun } = await import('../set/lib.mjs');
await firstRun(page);
log('onboarded (welcome steps) ->', page.url());

await gotoAgents(page);
const mc = await page.evaluate(() => ({ doc: typeof document.modelContext, nav: typeof navigator.modelContext, secure: isSecureContext, proto: document.modelContext ? Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext)) : null }));
log('modelContext', mc);
check('B: document.modelContext present with flag', mc.doc === 'object');
log('WebMCP.enable', await cdp.send('WebMCP.enable'));
const sw = webmcpSwitch(page);
check('B: switch enabled', !(await sw.isDisabled()));
log('switch before', await sw.getAttribute('aria-checked'));
await sw.focus(); await page.keyboard.press("Space");
for (let i = 0; i < 40 && tools.size === 0; i++) await page.waitForTimeout(250);
log('switch after', await sw.getAttribute('aria-checked'), 'toolsAdded events', addedEvents);
await page.waitForTimeout(500);
await page.locator('#agents').screenshot({ path: 'qa/screenshots/Q5-webmcp-settings.png' });
const pageTools = await page.evaluate(() => (document.modelContext.getTools ? Promise.resolve(document.modelContext.getTools()).then((t) => t.map((x) => x.name)) : null));
log('page getTools', pageTools);
const names = [...tools.keys()].sort();
log('tools (' + names.length + ')', names);
if (process.argv.includes('--verbose')) for (const t of tools.values()) log('  tool', t.name, JSON.stringify({ annotations: t.annotations, frameId: t.frameId, schema: t.inputSchema }).slice(0, 600));
log('tools whose CDP toolsAdded entry has no inputSchema:', [...tools.values()].filter((t) => !t.inputSchema).map((t) => t.name).join(',') || 'none');
check('B: tools registered (toolsAdded)', names.length > 0, `${names.length} tools`);
const bad = names.filter((n) => DESTRUCTIVE.includes(n));
check('B: no destructive tool (manifest perm destructive: ' + DESTRUCTIVE.join(',') + ')', bad.length === 0, bad.join(','));
check('B: no tool annotated destructive', [...tools.values()].every((t) => !t.annotations?.destructive && !t.annotations?.destructiveHint));

let seq = 0;
async function invoke(toolName, input) {
  const t = tools.get(toolName);
  if (!t) { log('MISSING tool', toolName); return null; }
  const r = await cdp.send('WebMCP.invokeTool', { toolName, frameId: t.frameId, input });
  for (let i = 0; i < 80 && !responded.has(r.invocationId); i++) await page.waitForTimeout(250);
  const ev = responded.get(r.invocationId);
  let env = null;
  try { env = JSON.parse(ev?.output?.content?.[0]?.text ?? 'null'); } catch {}
  log(`invoke#${++seq} ${toolName} ${JSON.stringify(input)} -> status=${ev?.status}`, JSON.stringify(ev ?? null).slice(0, 1500));
  return { ev, env };
}
globalThis.__invoke = invoke;
const discoverOnly = process.argv.includes('--discover');
if (!discoverOnly) {
  const { steps } = await import('./webmcp-steps.mjs');
  await steps({ get removedEvents() { return removedEvents; }, invoke, tools, page, check, log, BASE, cdp, removed, gotoAgents, webmcpSwitch });
}
log('page errors', errors);
check('no console errors / unhandled rejections in the page', errors.length === 0, errors.slice(0, 3).join(' ; '));
await browser.close();
const failed = checks.filter((c) => !c.ok);
log(`== ${checks.length - failed.length}/${checks.length} checks passed`);
fs.appendFileSync(LOG, `\n##### ${new Date().toISOString()} ${process.argv.slice(2).join(' ')}\n` + out.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
