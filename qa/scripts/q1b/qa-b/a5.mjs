import { open, BASE, shot, text } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const { browser, page, errors } = await open({ mobile, profile: 'p1' });
await page.goto(BASE + '/progress', { waitUntil: 'networkidle' }); await page.waitForTimeout(3000);
for (const nm of ['sleep', 'resting heart rate']) {
  await page.goto(BASE + '/progress', { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  const t = page.getByRole('link', { name: new RegExp('^' + nm, 'i') }).or(page.getByRole('button', { name: new RegExp('^' + nm, 'i') })).first();
  console.log(nm, 'tile count', await t.count());
  await t.click().catch(e => console.log('fail', e.message.slice(0, 80)));
  await page.waitForTimeout(2000);
  console.log('URL', page.url(), '\n', (await text(page, 2500)).replace(/\n+/g, ' / '));
  await shot(page, mobile ? 'detail-' + nm.slice(0,3) + '-m' : '08-detail-' + nm.slice(0, 3));
}
console.log('ERRORS', errors);
await browser.close();
