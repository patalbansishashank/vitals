import { launch, open, UA } from './lib.mjs';
const b = await launch();
const rel = async (p) => p.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: [['Vitals-android.apk', 61e6], ['Vitals-windows-x64-setup.exe', 1e8], ['Vitals-macos-universal.dmg', 1e8], ['Vitals-linux-x86_64.AppImage', 1e8], ['Vitals-linux-amd64.deb', 1e8]].map(([name, size]) => ({ name, size })) }) }));
for (const [n, vp, ua, x] of [['390', { width: 390, height: 844 }, UA.android, { touch: true, mobile: true, dpr: 2 }], ['1440', { width: 1440, height: 900 }, UA.linux, {}]]) {
  const { page } = await open(b, { viewport: vp, ua, ...x, routes: rel });
  await page.waitForSelector('.lm-dl a'); await page.waitForTimeout(2000);
  const t = await page.evaluate(() => [...document.querySelectorAll('.lm-dl a, .lm-dl button')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return `${e.textContent.trim().slice(0, 28)} ${Math.round(r.width)}x${Math.round(r.height)} underline=${cs.textDecorationLine}`; }));
  console.log(n, JSON.stringify(t));
}
await b.close();
