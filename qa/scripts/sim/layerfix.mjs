import { open, firstRun, BASE } from './lib.mjs';
const { browser, page, ctx } = await open(process.argv[3] === 'm'); await ctx.route(/sw\.js/, r => r.abort());
await page.route(/assets\/index-.*\.css$/, async (route) => { const r = await route.fetch(); const body = '@layer theme, base, components, utilities;' + await r.text(); await route.fulfill({ response: r, body }); });
await firstRun(page);
await page.goto(BASE + process.argv[2]); await page.waitForTimeout(3500);
await page.screenshot({ path: '/media/DEV/tmp/layerfix.png' });
console.log(await page.evaluate(() => [getComputedStyle(document.querySelector('.lm-bank__key')).padding, [...document.styleSheets[0].cssRules].slice(0,3).map(r => r.cssText.slice(0,60))]));
await browser.close();
