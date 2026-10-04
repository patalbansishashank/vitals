import { chromium } from 'playwright-core';
export const BASE = process.env.BASE || 'http://127.0.0.1:4173';
export async function open({ mobile = false, args = [] } = {}) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', ...args] });
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { browser, ctx, page, errors };
}
export async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = el => (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    const hs = [...document.querySelectorAll('h1,h2,h3,legend')].filter(vis).map(h => h.tagName + ':' + name(h));
    const ctl = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=slider],[role=switch]')].filter(vis).map(e => `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}${e.getAttribute('aria-pressed') ? '{p=' + e.getAttribute('aria-pressed') + '}' : ''}${e.checked ? '{x}' : ''}:${name(e)}`);
    return { url: location.pathname + location.search + location.hash, hs, ctl };
  });
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
  return info;
}
export const shot = (page, name) => page.screenshot({ path: `qa/screenshots/onb-${name}.png` });
