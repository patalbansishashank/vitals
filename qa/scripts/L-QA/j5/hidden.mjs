// J5 check 3 (browser part) + fold behaviour + Settings › Install mount. Runs against the integrated build.
import path from 'node:path';
import { launch, open, inspectBlock, UA, OUT } from './lib.mjs';
const b = await launch();
const D = { viewport: { width: 1440, height: 900 }, ua: UA.linux };
const none = async (p) => p.route('https://api.github.com/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
const mm = `const o=matchMedia.bind(window);window.matchMedia=(q)=>/display-mode: standalone/.test(q)?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:o(q);`;
const cases = {
  'pwa-standalone-matchMedia': mm,
  'pwa-ios-navigator.standalone': `Object.defineProperty(navigator,'standalone',{get:()=>true});`,
  'electron-bridge-stub': `window.vitalsDesktop = {};`,
  'android-capacitor-stub': `window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };`,
  'capacitor-web-page (not native)': `window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };`,
  'ordinary-tab': ``,
};
const res = {};
for (const [name, init] of Object.entries(cases)) {
  for (const route of ['/', '/settings#install']) {
    const { page, errors } = await open(b, { ...D, routes: none, init, path: route });
    await page.waitForTimeout(3500);
    const info = await inspectBlock(page);
    const n = await page.locator('text=Get the app').count();
    res[name + ' ' + route] = { block: info.present, getTheAppTextCount: n, h1: info.h1 ?? (await page.locator('h1').first().textContent().catch(() => null)), url: page.url() };
    if (route === '/' && name !== 'ordinary-tab') await page.screenshot({ path: path.join(OUT, `hidden-${name.replace(/[^a-z]+/gi, '-')}.png`) });
    if (route !== '/' ) await page.screenshot({ path: path.join(OUT, `settings-install-${name.replace(/[^a-z]+/gi, '-')}.png`) });
  }
}
console.log(JSON.stringify(res, null, 1));

// fold / unfold / persistence
{
  const { ctx, page } = await open(b, { ...D, routes: none });
  await page.waitForSelector('.lm-dl');
  await page.getByRole('button', { name: 'Or keep using the website' }).click();
  await page.waitForTimeout(300);
  const f1 = await inspectBlock(page);
  const ls = await page.evaluate(() => localStorage.getItem('vitals.downloads.v1'));
  await page.screenshot({ path: path.join(OUT, 'fold-1-folded.png') });
  await page.reload(); await page.waitForTimeout(2500);
  const f2 = await inspectBlock(page);
  await page.getByRole('button', { name: 'Get the app' }).click();
  await page.waitForTimeout(300);
  const f3 = await inspectBlock(page);
  const ls3 = await page.evaluate(() => localStorage.getItem('vitals.downloads.v1'));
  console.log('FOLD', JSON.stringify({ afterClick: { folded: f1.folded, text: f1.text, ls }, afterReload: { folded: f2.folded, text: f2.text }, afterReopen: { folded: f3.folded, ls3 } }));
  // does folding leave the page usable: the Get started key still there
  console.log('get started visible after fold:', await page.getByRole('button', { name: /Get started/ }).first().isVisible().catch(() => false));
  await ctx.close();
}
await b.close();
