import { open, firstRun, BASE, text, forbidden } from './lib.mjs';
const mobile = process.argv[2] === 'm'; const tag = mobile ? 'm' : 'd';
const { browser, page, errors } = await open(mobile);
await firstRun(page);
const visit = async (path, shot) => {
  await page.goto(BASE + path); await page.waitForTimeout(2500);
  const t = await text(page); const f = await forbidden(page);
  const h = await page.evaluate(() => [...document.querySelectorAll('h1,h2')].map(e => e.innerText.trim()).slice(0, 25));
  console.log(`\n=== ${path} len=${t.length} forbidden=${f.length}`, f.slice(0, 5));
  console.log('H:', h.join(' | '));
  if (shot) await page.screenshot({ path: `qa/screenshots/sim-${shot}-${tag}.png` });
  return t;
};
let t = await visit('/evidence', '10-evidence-index');
console.log(t.slice(0, 1500));
for (const s of ['daily-activity-maintenance', 'wearable-scores', 'tracking-replanning', 'training-catalogue', 'supplements', 'evidence-policy']) {
  t = await visit('/evidence/topics/' + s, s === 'supplements' ? '11-topic-supplements' : null);
  console.log(t.slice(0, 300).replace(/\n+/g, ' / '));
}
t = await visit('/evidence/validation', '12-validation');
console.log(t.slice(0, 6000));
t = await visit('/evidence/24-weigh-in-noise', '13-mechanism-params');
const i = t.indexOf('Mechanism\n'); console.log('PARAMCARD', i, t.slice(Math.max(0, i - 400), i + 600));
for (const [p, id] of [['/evidence/topics/safety-limits#ref-54', 'ref-54'], ['/evidence/topics/transitions-periodisation#ref-73', 'ref-73'], ['/evidence/topics/safety-limits#ref-6', 'ref-6']]) {
  await page.goto(BASE + p); await page.waitForTimeout(3000);
  const r = await page.evaluate((id) => { const e = document.getElementById(id) || document.querySelector(`[data-ref="${id}"]`); const tgt = document.querySelector(':target'); return { exists: !!e, target: tgt ? tgt.id + ' ' + tgt.innerText.slice(0, 120) : null, inView: e ? (e.getBoundingClientRect().top >= 0 && e.getBoundingClientRect().top < innerHeight) : null, text: e ? e.innerText.slice(0, 160) : null }; }, id);
  console.log('REF', p, JSON.stringify(r));
}
console.log(errors); await browser.close();
