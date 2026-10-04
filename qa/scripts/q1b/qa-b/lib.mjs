import { chromium } from 'playwright-core';
export const BASE = process.env.BASE || 'http://127.0.0.1:4312';
// profile: persistent user data dir name (state kept between scripts)
export async function open({ mobile = false, profile = null, args = [] } = {}) {
  process.env.TMPDIR = '/media/DEV/Hobby/Lumen Health/.tmp-q1b';
  const opts0 = mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } };
  const opts = { ...opts0, serviceWorkers: 'block' };
  let browser, ctx;
  const launch = { executablePath: '/usr/bin/chromium', args: ['--no-sandbox', ...args] };
  if (profile) { ctx = await chromium.launchPersistentContext('/media/DEV/Hobby/Lumen Health/.tmp-q1b/profiles/' + profile, { ...launch, ...opts }); browser = ctx; }
  else { browser = await chromium.launch(launch); ctx = await browser.newContext(opts); }
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
  return { browser, ctx, page, errors };
}
export async function dump(page, label = '') {
  const info = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const name = el => (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const hs = [...document.querySelectorAll('h1,h2,h3,legend')].filter(vis).map(h => h.tagName + ':' + name(h));
    const ctl = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab],[role=switch],[role=radio]')].filter(vis).map(e => `${e.tagName.toLowerCase()}${e.type && e.tagName!=='BUTTON' ? '[' + e.type + ']' : ''}${e.getAttribute('aria-pressed') ? '{p=' + e.getAttribute('aria-pressed') + '}' : ''}${e.getAttribute('aria-current') ? '{cur}' : ''}${e.disabled ? '{dis}' : ''}:${name(e)}`);
    return { url: location.pathname + location.search, hs, ctl };
  });
  console.log(`--- ${label} ${info.url}\nH: ${info.hs.join(' | ')}\nC: ${info.ctl.join(' | ')}`);
  return info;
}
export const text = async (page, n = 2500) => (await page.evaluate(() => (document.querySelector('main') || document.body).innerText)).slice(0, n);
export const shot = (page, name, full = false) => page.screenshot({ path: `qa/screenshots/q1b-b-${name}.png`, fullPage: full });
