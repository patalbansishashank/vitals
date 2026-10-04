import path from 'node:path';
import { launch, open, UA, OUT } from './lib.mjs';
const b = await launch();
const rel = async (p) => p.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: [{ name: 'Vitals-linux-x86_64.AppImage', size: 123456789 }, { name: 'Vitals-android.apk', size: 61234567 }] }) }));
for (const scheme of ['light', 'dark']) {
  const { page } = await open(b, { viewport: { width: 1440, height: 900 }, ua: UA.linux, scheme, routes: rel });
  await page.waitForSelector('.lm-dl__key'); await page.waitForTimeout(2500);
  const k = await page.evaluate(() => { const e = document.querySelector('.lm-dl__key'); const g = document.querySelector('.lm-onb-intro__start'); return [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, getComputedStyle(g).backgroundColor, getComputedStyle(g).color]; });
  console.log(scheme, JSON.stringify(k));
  await page.screenshot({ path: path.join(OUT, `layerfix-patched-${scheme}-1440.png`) });
}
await b.close();
