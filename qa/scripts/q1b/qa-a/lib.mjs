import { chromium } from 'playwright-core';
import fs from 'node:fs';
export const BASE = process.env.BASE || 'http://127.0.0.1:4311';
export async function open({ mobile = false, offlineOk = false } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true } : { viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { browser, ctx, page, errors };
}
export const shot = (page, n) => page.screenshot({ path: `qa/screenshots/q1b-a-${n}.png` });
export const base = JSON.parse(fs.readFileSync(new URL('./base-train.json', import.meta.url), 'utf8'));
export async function view(page, label = '', quiet = false) {
  const t = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const nm = el => (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const f = [...document.querySelectorAll('main fieldset')].filter(vis).pop();
    const lg = f?.querySelector('legend')?.innerText.replace(/\s+/g, ' ');
    const c = [...(f || document.querySelector('main')).querySelectorAll('button,input,[role=checkbox],[role=radio],[role=switch],select')].filter(vis).map(e => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '/' + e.getAttribute('role') : ''}${e.type ? '[' + e.type + ']' : ''}${(e.getAttribute('aria-pressed') || e.getAttribute('aria-checked')) === 'true' || e.checked ? '*' : ''}:${nm(e)}`);
    return { url: location.pathname + location.search, lg, c };
  });
  if (!quiet) console.log(`--- ${label} ${t.url}\nLEGEND: ${t.lg}\nC: ${t.c.join(' | ').slice(0, 420)}`);
  return t;
}
