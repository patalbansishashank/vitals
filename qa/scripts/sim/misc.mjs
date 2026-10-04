import { open, firstRun, BASE, forbidden } from './lib.mjs';
const { browser, page, errors } = await open(false);
await firstRun(page);
for (const p of ['/safety', '/evidence/topics/safety-limits', '/evidence/topics/extended-water-fasting', '/evidence/topics/evidence-policy']) {
  await page.goto(BASE + p); await page.waitForTimeout(3000);
  console.log(p, JSON.stringify((await forbidden(page)).slice(0, 4)));
}
// open the Explain drawer from a mechanism in the safety-limits topic
await page.goto(BASE + '/evidence/topics/safety-limits'); await page.waitForTimeout(2500);
const btns = page.getByRole('button', { name: /explain|why/i }); console.log('explain buttons', await btns.count());
console.log(errors); await browser.close();
