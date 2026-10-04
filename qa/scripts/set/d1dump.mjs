import { openPersistent, dump, text, BASE } from './lib.mjs';
const d1 = await openPersistent(process.argv[2] || '/media/DEV/tmp/qa-set-prof1');
await d1.page.goto(BASE + (process.argv[3] || '/settings#units'), { waitUntil: 'load' });
await d1.page.waitForTimeout(4000);
console.log(await d1.page.locator('section#units').evaluate(e => e.outerHTML.slice(0, 1500)).catch(e => 'ERR ' + e.message));
await dump(d1.page, 'd1', 'body');
console.log(d1.errors);
await d1.ctx.close();
