import { open, BASE, shot, base } from './lib.mjs';
const { browser, ctx, page, errors } = await open();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); if (!l) return null; const r = await fetch(l.href); return { href: l.href, ct: r.headers.get('content-type'), json: await r.json() }; });
console.log('MANIFEST', man?.ct, JSON.stringify(man?.json));
const j = man.json; const need = ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons', 'id', 'description', 'lang'];
console.log('MISSING FIELDS', need.filter(k => !(k in j)));
console.log('head', await page.evaluate(() => [...document.querySelectorAll('link[rel*=icon],link[rel=apple-touch-icon],meta[name=theme-color],meta[name=viewport]')].map(l => l.outerHTML.slice(0, 140))));
for (const ic of j.icons || []) { const r = await page.request.get(new URL(ic.src, man.href).href); const b = await r.body(); const dim = b[0] === 0x89 ? `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` : 'non-png'; console.log('ICON', ic.src, ic.sizes, ic.purpose || '', r.status(), r.headers()['content-type'], dim, dim.startsWith(ic.sizes.split(' ')[0]) ? 'size-ok' : 'SIZE-MISMATCH'); }
console.log('start_url resolves', (await page.request.get(new URL(j.start_url, man.href).href)).status());
await page.waitForTimeout(4000);
await page.reload({ waitUntil: 'networkidle' });
console.log('SW', await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r?.scope, active: r?.active?.scriptURL, state: r?.active?.state, controller: !!navigator.serviceWorker.controller }; }));
console.log('caches', await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; }));
// install hint
await page.goto(BASE + '/settings#install', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const ins = page.locator('section#install');
console.log('INSTALL before event>>', (await ins.innerText()).replace(/\n+/g, ' | '));
console.log('INSTALL buttons', JSON.stringify(await ins.getByRole('button').allInnerTexts()));
await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' }); window.__bip = e; window.dispatchEvent(e); });
await page.waitForTimeout(800);
console.log('defaultPrevented', await page.evaluate(() => window.__bip.defaultPrevented));
console.log('INSTALL after event>>', (await ins.innerText()).replace(/\n+/g, ' | '));
const bs = await ins.getByRole('button').allInnerTexts(); console.log('INSTALL buttons', JSON.stringify(bs));
await shot(page, 'pwa-install-prompt-available');
const ib = ins.getByRole('button', { name: /install/i }).first();
if (await ib.count()) { await ib.click(); await page.waitForTimeout(800); console.log('prompt() called', await page.evaluate(() => !!window.__prompted)); console.log('INSTALL after click>>', (await ins.innerText()).replace(/\n+/g, ' | ').slice(0, 500)); }
await page.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await page.waitForTimeout(800);
console.log('INSTALL after appinstalled>>', (await ins.innerText()).replace(/\n+/g, ' | ').slice(0, 500));
await shot(page, 'pwa-installed');
// any banner elsewhere?
await page.goto(BASE + '/welcome', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
console.log('welcome mentions install?', /install/i.test(await page.locator('body').innerText()));
// offline
await ctx.setOffline(true);
for (const p of ['/', '/welcome', '/settings', '/settings#install', '/settings/devices', '/body', '/simulate', '/plan', '/plan/goals', '/evidence', '/evidence/supplements', '/today', '/food', '/train', '/coach', '/progress', '/onboarding/training', '/no-such-route']) {
  try { const r = await page.goto(BASE + p, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(1200); const t = await page.evaluate(() => (document.querySelector('h1,h2') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 70)); console.log('OFFLINE', p, r?.status(), '->', new URL(page.url()).pathname, '|', t); }
  catch (e) { console.log('OFFLINE', p, 'FAIL', e.message.split('\n')[0]); }
}
await shot(page, 'pwa-offline');
console.log('offline in-app nav + new fetch of /health', await page.evaluate(() => fetch('/health').then(r => r.status).catch(e => 'err ' + e.message)));
await ctx.setOffline(false);
console.log('ERRORS', errors.filter(e => !/Failed to load resource/.test(e)).slice(0, 5));
await browser.close();
