// usage: node setunit.mjs <profileDir> <radioName...>
import { openPersistent, BASE } from './lib.mjs';
const [dir, ...names] = process.argv.slice(2);
const d = await openPersistent(dir);
await d.page.goto(BASE + '/settings#units', { waitUntil: 'load' });
await d.page.waitForTimeout(4000);
for (const n of names) await d.page.getByRole('radio', { name: n, exact: true }).click();
await d.page.waitForTimeout(1500);
await d.page.locator('section#sync').getByRole('button', { name: 'Sync now' }).click();
await d.page.waitForTimeout(4000);
console.log('sync:', (await d.page.locator('section#sync').innerText()).slice(0, 120).replace(/\n/g, ' | '));
console.log(d.errors.filter(e => !/preload|Permissions-Policy/.test(e)));
await d.ctx.close();
