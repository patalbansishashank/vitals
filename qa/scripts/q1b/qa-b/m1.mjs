import { open, BASE, shot, text } from './lib.mjs';
const { browser, page, errors } = await open({ mobile: true, profile: 'p1' });

for (const r of ['today', 'food', 'train', 'coach', 'progress']) {
  await page.goto(BASE + '/' + r, { waitUntil: 'networkidle' }); await page.waitForTimeout(2800);
  const m = await page.evaluate(() => {
    const vw = innerWidth; const over = [...document.querySelectorAll('main *')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > vw + 1 && !e.closest('[data-scroll],.overflow-x-auto,[role=tablist]'); }).slice(0, 4).map(e => e.tagName + '.' + String(e.className).slice(0, 40) + ':' + Math.round(e.getBoundingClientRect().right));
    const small = [...document.querySelectorAll('button,a,input')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.height < 24 || b.width < 24) && getComputedStyle(e).visibility !== 'hidden'; }).length;
    return { sw: document.documentElement.scrollWidth, vw, over, smallTargets: small, nav: !!document.querySelector('nav') };
  });
  console.log(r, JSON.stringify(m));
  await shot(page, `50-mobile-${r}`);
}
// mobile progress signals + detail
await page.goto(BASE + '/progress', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
await page.getByRole('heading', { name: 'Body signals', exact: true }).scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await shot(page, '51-mobile-progress-signals');
console.log('ERRORS', errors);
await browser.close();
