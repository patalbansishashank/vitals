// Q6 visual pass helpers: seeded persistent profiles (copied fresh per run), the three widths, both themes,
// error capture, command-bus reads (window.__vitals, ?qa=1), screenshots ≤ 200 kB, layout measurements.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
export const ROOT = process.env.VITALS_ROOT || new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
process.env.TMPDIR = `${ROOT}/.e6-tmp`;
export const BASE = process.env.BASE || 'http://127.0.0.1:5194';
export const PROFILES = `${ROOT}/.e6-tmp/q6-profiles`;
export const SHOTS = `${ROOT}/qa/screenshots/Q6`;
export const WIDTHS = {
  390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  768: { viewport: { width: 768, height: 1024 } },
  1440: { viewport: { width: 1440, height: 900 } },
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Persistent context on PROFILES/<name>; `from` copies a seeded profile first (fresh copy per run). */
export async function openProfile(name, { w = 1440, theme = 'light', from = null, keep = false } = {}) {
  const dir = path.join(PROFILES, name);
  if (!keep || from) fs.rmSync(dir, { recursive: true, force: true });
  if (from) fs.cpSync(path.join(PROFILES, from), dir, { recursive: true });
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(dir, f), { force: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'], ignoreHTTPSErrors: true, colorScheme: theme, serviceWorkers: 'block', ...WIDTHS[w],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));
  return { ctx, page, errors, close: () => ctx.close() };
}
export async function go(page, route = '/', { wait = 1200 } = {}) {
  const u = new URL(route, BASE);
  u.searchParams.set('qa', '1');
  // a paired server keeps a connection open (sync, status), so the page never goes network-idle there
  await page.goto(u.toString(), { waitUntil: process.env.Q6_SERVER ? 'load' : 'networkidle' });
  await page.waitForFunction(() => !!window.__vitals, null, { timeout: 30000 }).catch(() => {});
  await sleep(process.env.Q6_SERVER ? wait + 1500 : wait);
}
export async function read(page, id, input = {}) {
  const r = await page.evaluate(([id, input]) => window.__vitals.read(id, input), [id, input]);
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.error).slice(0, 300)}`);
  return r.output ?? r.value ?? r;
}
export const btn = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
export const mainText = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText);
export async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const hs = [...document.querySelectorAll('h1,h2,h3,legend,[role=dialog]')].filter(vis).map((h) => h.tagName + ':' + name(h));
    const ctl = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=radio],[role=checkbox],[role=switch]')].filter(vis).map((e) => `${e.tagName.toLowerCase()}${e.type && e.tagName !== 'BUTTON' ? '[' + e.type + ']' : ''}${e.getAttribute('aria-pressed') ? '{p=' + e.getAttribute('aria-pressed') + '}' : ''}:${name(e)}`);
    return { url: location.pathname + location.search, hs, ctl };
  });
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
  return info;
}
/** Viewport screenshot ≤ 200 kB: PNG, then a JPEG-free fallback (scale: 'css' + clip to 0.75 quality via webp is not
 *  available in Chromium screenshots), so we re-encode with the browser canvas to WebP when the PNG is too large. */
export async function shot(page, name, { maxKB = 200, mask = null } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const png = path.join(SHOTS, `${name}.png`);
  // `mask` (a selector) paints over shown-once values (pairing codes, broker passwords) so no secret reaches a file
  const buf = await page.screenshot({ path: png, scale: 'css', ...(mask ? { mask: [page.locator(mask)] } : {}) });
  if (buf.length <= maxKB * 1024) { fs.rmSync(path.join(SHOTS, `${name}.webp`), { force: true }); return path.relative(ROOT, png); }
  fs.rmSync(png, { force: true });
  const b64 = buf.toString('base64');
  let out = null;
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const data = await page.evaluate(async ([b64, q]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', q).split(',')[1];
    }, [b64, q]).catch(() => null);
    if (!data) break;
    out = Buffer.from(data, 'base64');
    if (out.length <= maxKB * 1024) break;
  }
  const webp = path.join(SHOTS, `${name}.webp`);
  if (out) fs.writeFileSync(webp, out);
  return path.relative(ROOT, webp);
}
