import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
for (const port of [4173, 4185]) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  await p.goto(`http://127.0.0.1:${port}/welcome`, { waitUntil: 'networkidle' });
  const v = await p.evaluate(() => { const a = document.createElement('div'); a.className = 'lm-app'; const d = document.createElement('main'); d.className = 'lm-main'; a.append(d); document.body.append(a); return getComputedStyle(d).paddingBottom; });
  console.log(port, v);
  await c.close();
}
await b.close();
