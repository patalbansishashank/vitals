// E23 helpers: a persistent profile (seeded once), the three widths, both themes, sheet screenshots.
import { chromium } from 'playwright-core';
export const ROOT = '/media/DEV/Hobby/Lumen Health';
export const BASE = process.env.BASE || 'http://127.0.0.1:5188';
export const PROFILE = `${ROOT}/.e6-tmp/e23-profile`;
export const WIDTHS = { 390: { width: 390, height: 844 }, 768: { width: 768, height: 1024 }, 1440: { width: 1440, height: 900 } };
export async function open(w = 1440, scheme = 'light') {
  process.env.TMPDIR = `${ROOT}/.e6-tmp`;
  const mobile = w === 390;
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], viewport: WIDTHS[w], colorScheme: scheme,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}), serviceWorkers: 'block',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  return { ctx, page, errors };
}
export async function go(page, route) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}
export async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const hs = [...document.querySelectorAll('h1,h2,h3,legend,[role=dialog]')].filter(vis).map((h) => h.tagName + ':' + name(h));
    const ctl = [...document.querySelectorAll('button,a[href],[role=button],[role=tab],[role=radio]')].filter(vis).map((e) => name(e));
    return { url: location.pathname, hs, ctl };
  });
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
}
