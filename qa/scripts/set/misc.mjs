import { open, openPersistent, BASE } from './lib.mjs';
const d = await openPersistent('/media/DEV/tmp/qa-set-prof1');
await d.page.goto(BASE + '/settings#data', { waitUntil: 'load' }); await d.page.waitForTimeout(4000);
console.log('PAIRED data line:', (await d.page.locator('section#data').innerText()).slice(0, 220).replace(/\n+/g, ' | '));
console.log('PAIRED about privacy:', (await d.page.locator('section#about').innerText()).split('privacy')[1]?.replace(/\n+/g, ' ').slice(0, 200));
console.log('PAIRED install:', (await d.page.locator('section#install').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
await d.ctx.close();
const { browser, page } = await open({ mobile: true });
for (const p of ['/settings/devices', '/settings/sync', '/settings/coach', '/settings/data-sources', '/settings/agents', '/settings/nope']) {
  await page.goto(BASE + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const hs = [...document.querySelectorAll('h2')].map(h => [h.innerText, Math.round(h.getBoundingClientRect().top)]); const vis = hs.filter(([, t]) => t >= 0 && t < 500).map(([n]) => n); return { nf: document.body.innerText.includes("This page doesn't exist"), vis }; });
  console.log(p, JSON.stringify(r));
}
await browser.close();
