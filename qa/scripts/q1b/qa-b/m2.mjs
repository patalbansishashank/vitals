import { open, BASE, shot } from './lib.mjs';
for (const clock of [null, '2026-10-02T12:00:00', '2026-10-05T12:00:00']) {
  const { browser, page } = await open({ profile: 'p1' });
  if (clock) await page.clock.install({ time: new Date(clock) });
  await page.goto(BASE + '/progress', { waitUntil: 'networkidle' }); await page.waitForTimeout(3500);
  const t = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(x => /Body signals/.test(x.innerText)); return (h.closest('section') || h.parentElement).innerText.replace(/\n+/g, ' / ').slice(0, 260); });
  console.log(clock, '=>', t);
  if (clock === '2026-10-02T12:00:00') { await page.getByRole('heading', { name: 'Body signals', exact: true }).scrollIntoViewIfNeeded(); await shot(page, '52-signals-stale-clock'); }
  await browser.close();
}
