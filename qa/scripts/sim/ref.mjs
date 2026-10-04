import { open, firstRun, BASE } from './lib.mjs';
const { browser, page, errors } = await open();
await firstRun(page);
for (const p of process.argv.slice(2)) {
  await page.goto(BASE + p); await page.waitForTimeout(3500);
  const r = await page.evaluate(() => { const els = [...document.querySelectorAll('[id^=src-], [id=citations]')]; const vis = els.filter(e => { const b = e.getBoundingClientRect(); return b.top > -5 && b.top < innerHeight; }); const hl = document.querySelector('[data-highlight], [data-flash], .is-target, [aria-current=true]'); return { n: els.length, hash: location.hash, scrollY, firstVisible: vis[0] ? vis[0].id + ' :: ' + vis[0].innerText.replace(/\s+/g, ' ').slice(0, 220) : null, focus: document.activeElement?.id + ' ' + (document.activeElement?.innerText || '').slice(0, 100), hl: hl ? hl.outerHTML.slice(0, 150) : null }; });
  console.log(p, JSON.stringify(r, null, 1));
}
console.log(errors); await browser.close();
