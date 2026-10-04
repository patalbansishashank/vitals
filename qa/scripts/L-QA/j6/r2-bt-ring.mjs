/** Round 2 J6 A (Web Bluetooth stub, no radio): Ring page once the availability check has finished, then "Look for rings" (chooser cancelled).
 *  Records how long the first "can't connect here" lasts and the Ring key (size, place, state). OUT dir: qa/results/L-QA/round2/j6/ */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = (process.env.BASE || 'http://127.0.0.1:4336').replace(/\/$/, ''); process.env.BASE = BASE;
const { firstRun } = await import('../../set/lib.mjs');
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OUTD = join(ROOT, 'qa/results/L-QA/round2/j6');
const FIX = join(ROOT, '.e6-tmp/j6-r2/bio-fresh.json');
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const jobs = [[390, 844, 'light'], [390, 844, 'dark'], [768, 1024, 'light'], [768, 1024, 'dark'], [1440, 900, 'light'], [1440, 900, 'dark']];
const out = [];
async function run([w, h, scheme]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getAvailability: async () => true, requestDevice: async () => { throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'); } } }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200))); p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[34]/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  const rec = { w, scheme, errs };
  await firstRun(p);
  await p.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' });
  await p.locator('section#devices input[type=file]').setInputFiles(FIX); await p.waitForTimeout(9000);
  const t0 = Date.now();
  await p.goto(BASE + '/ring', { waitUntil: 'domcontentloaded' });
  await p.getByText(/can.t connect here/i).waitFor({ timeout: 30000 }).then(() => (rec.sawCantConnect = true), () => (rec.sawCantConnect = false));
  rec.cantConnectAt = Date.now() - t0;
  await p.getByText(/Connect your ring/i).first().waitFor({ timeout: 40000 }).then(() => (rec.connectAt = Date.now() - t0), () => (rec.connectAt = null));
  await p.waitForTimeout(1200);
  rec.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  rec.pw = await p.evaluate(() => document.querySelectorAll('input[type=password]').length);
  rec.inputs = await p.evaluate(() => [...document.querySelectorAll('main input,main textarea,main select')].map((e) => `${e.tagName.toLowerCase()}[${e.type}] ${e.getAttribute('aria-label') || ''}`));
  rec.key = await p.evaluate(() => [...document.querySelectorAll('a,button')].filter((e) => /^ring\b/i.test(e.getAttribute('aria-label') || '')).map((e) => { const r = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(e).backgroundColor, pressed: e.dataset.pressed || null }; }).filter((k) => k.w > 0));
  rec.text = (await p.evaluate(() => document.querySelector('main').innerText)).replace(/\n+/g, ' | ').slice(0, 700);
  rec.btns = await p.evaluate(() => [...document.querySelectorAll('main button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const c = getComputedStyle(e); return `${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 24)} pad=${c.paddingLeft}/${c.paddingTop} bg=${c.backgroundColor}`; }));
  await p.screenshot({ path: join(OUTD, `ring-bt-${w}-${scheme}.png`), fullPage: true });
  const look = p.getByRole('button', { name: /look for rings/i }).first();
  if (await look.count()) { await look.click(); await p.waitForTimeout(3000); rec.afterLook = (await p.evaluate(() => document.querySelector('main').innerText)).replace(/\n+/g, ' | ').slice(0, 500); await p.screenshot({ path: join(OUTD, `ring-bt-lookfor-${w}-${scheme}.png`), fullPage: true }); }
  else rec.afterLook = '(no "Look for rings" button)';
  out.push(rec); await ctx.close();
}
let i = 0; await Promise.all([0, 1, 2].map(async () => { while (i < jobs.length) await run(jobs[i++]).catch((e) => out.push({ failed: String(e.message).slice(0, 200) })); }));
await b.close();
writeFileSync(join(OUTD, 'ring-bt-report.json'), JSON.stringify(out, null, 1));
for (const r of out) console.log(JSON.stringify({ ...r, text: undefined, afterLook: r.afterLook?.slice(0, 160) }));
