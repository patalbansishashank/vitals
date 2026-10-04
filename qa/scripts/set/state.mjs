import { openPersistent, BASE } from './lib.mjs';
for (const p of process.argv.slice(2)) {
  const d = await openPersistent(p);
  await d.page.goto(BASE + '/settings#units', { waitUntil: 'load' });
  await d.page.waitForTimeout(5000);
  const st = await d.page.evaluate(() => [...document.querySelectorAll('#units [role=radio][aria-checked=true]')].map(e => e.textContent).join(','));
  const sy = (await d.page.locator('section#sync').innerText()).slice(0, 90).replace(/\n/g, ' | ');
  console.log(p, 'units:', st, '|', sy);
  console.log(d.errors.filter(e => !/preload|Permissions-Policy/.test(e)));
  await d.ctx.close();
}
