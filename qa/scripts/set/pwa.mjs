import { open, BASE, shot } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, ctx, page, errors } = await open({ mobile });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); if (!l) return null; const r = await fetch(l.href); return { href: l.href, ct: r.headers.get('content-type'), json: await r.json() }; });
console.log('MANIFEST', JSON.stringify(man).slice(0, 1500));
const apple = await page.evaluate(() => [...document.querySelectorAll('link[rel*=icon],link[rel=apple-touch-icon],meta[name=theme-color]')].map(l => l.outerHTML));
console.log('HEAD ICONS', apple);
if (man) for (const ic of man.json.icons || []) {
  const r = await page.request.get(new URL(ic.src, man.href).href);
  const b = await r.body();
  const dim = b[0] === 0x89 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : 'non-png';
  console.log('ICON', ic.src, ic.sizes, ic.purpose || '', r.status(), r.headers()['content-type'], dim);
}
for (const p of ['/apple-touch-icon.png', '/favicon.svg']) { const r = await page.request.get(BASE + p); console.log(p, r.status(), r.headers()['content-type']); }
const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); return { reg: !!reg, scope: reg?.scope, active: reg?.active?.scriptURL, controller: !!navigator.serviceWorker.controller }; });
console.log('SW before reload', sw);
await page.waitForTimeout(4000);
await page.reload({ waitUntil: 'networkidle' });
console.log('SW after reload', await page.evaluate(() => ({ controller: navigator.serviceWorker.controller?.scriptURL })));
console.log('caches', await page.evaluate(async () => { const ks = await caches.keys(); const o = {}; for (const k of ks) o[k] = (await (await caches.open(k)).keys()).length; return o; }));
// offline
await ctx.setOffline(true);
const results = [];
for (const path of ['/settings', '/body', '/simulate', '/plan', '/evidence', '/welcome', '/settings#install']) {
  try {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 140));
    results.push(path + ' => ' + t);
  } catch (e) { results.push(path + ' => FAIL ' + e.message.split('\n')[0]); }
}
console.log(results.join('\n'));
const inst = await page.locator('section#install').innerText().catch(() => 'n/a');
console.log('INSTALL (offline):', inst.replace(/\n+/g, ' | '));
await shot(page, `offline-install-${mobile ? 'm' : 'd'}`);
// click nav in-app while offline
await page.goto(BASE + '/body', { waitUntil: 'load' }); await page.waitForTimeout(1500);
for (const n of ['evidence', 'simulate', 'settings']) { try { await page.getByRole('link', { name: n, exact: true }).first().click(); await page.waitForTimeout(2000); console.log('nav', n, page.url(), (await page.evaluate(() => document.querySelector('h1')?.innerText))); } catch (e) { console.log('nav fail', n, e.message.split('\n')[0]); } }
await ctx.setOffline(false);
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy/.test(e)));
await browser.close();
