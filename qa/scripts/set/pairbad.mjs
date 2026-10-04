import { open, BASE, shot } from './lib.mjs';
const { browser, page, errors } = await open({});
await page.goto(BASE + '/settings#sync', { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
const s = page.locator('section#sync');
for (const url of [process.argv[2] || 'http://127.0.0.1:4199']) {
  await s.getByLabel('sync server address').fill(url);
  if (await s.getByRole('button', { name: 'Test' }).count()) { await s.getByRole('button', { name: 'Test' }).click(); await page.waitForTimeout(3000); console.log('AFTER TEST', (await s.innerText()).replace(/\n+/g, ' | ').slice(0, 700)); }
  await s.getByRole('button', { name: 'Set up sync on this device' }).click();
  await page.waitForTimeout(8000);
  console.log(url, '=>', (await s.innerText()).replace(/\n+/g, ' | ').slice(0, 700));
}
await shot(page, 'pair-unreachable');
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy|GL Driver/.test(e)));
await browser.close();
