import path from 'node:path';
import { launch, open, inspectBlock, cls, UA, OUT } from './lib.mjs';
process.env.J5_BASE = 'https://vitals.creative.desi';
const b = await launch();
for (const [n, vp, ua, extra] of [['390', { width: 390, height: 844 }, UA.android, { touch: true, mobile: true, dpr: 2 }], ['1440', { width: 1440, height: 900 }, UA.linux, {}]]) {
  const { page, errors } = await open(b, { viewport: vp, ua, ...extra });
  await page.waitForTimeout(4000);
  const info = await inspectBlock(page);
  const keyBg = await page.evaluate(() => { const k = document.querySelector('.lm-key'); return k ? [getComputedStyle(k).backgroundColor, getComputedStyle(k).color, k.textContent] : null; });
  await page.screenshot({ path: path.join(OUT, `live-${n}.png`) });
  console.log(n, 'block present:', info.present, 'h1:', info.h1, 'firstKey', JSON.stringify(keyBg), 'cls', JSON.stringify((await cls(page)).cls), 'errors', errors.filter((e) => !/GL Driver/.test(e)).length);
}
await b.close();
