import { launch, open, UA } from './lib.mjs';
const b = await launch();
const { page } = await open(b, { viewport: { width: 1440, height: 900 }, ua: UA.linux, routes: async (p) => p.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v0.5.0', assets: [{ name: 'Vitals-linux-x86_64.AppImage', size: 123456789, browser_download_url: 'https://github.com/patalbansishashank/vitals/releases/download/v0.5.0/Vitals-linux-x86_64.AppImage' }] }) })) });
await page.waitForSelector('.lm-dl__key'); await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const pick = (el) => { const cs = getComputedStyle(el); const l = el.querySelector('.lm-key__label'); const lc = l && getComputedStyle(l); return { cls: el.className, color: cs.color, bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 80), opacity: cs.opacity, label: lc && { color: lc.color, opacity: lc.opacity, vis: lc.visibility, bg: lc.backgroundColor, clip: lc.webkitBackgroundClip, fill: lc.webkitTextFillColor }, rect: el.getBoundingClientRect().toJSON() }; };
  const dl = document.querySelector('.lm-dl__key');
  const gs = [...document.querySelectorAll('.lm-key')].filter((e) => !e.closest('.lm-dl'))[0];
  return { dl: pick(dl), gs: gs && pick(gs), theme: document.documentElement.getAttribute('data-theme') };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
