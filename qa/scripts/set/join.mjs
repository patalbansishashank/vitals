// usage: node join.mjs <profileDir> <merge|replace> [mobile]
import { openPersistent, BASE } from './lib.mjs';
import fs from 'node:fs';
const [dir, mode, mob] = process.argv.slice(2);
const RELAY = process.env.RELAY || 'http://127.0.0.1:4191';
const words = fs.readFileSync(process.env.WORDS || '/media/DEV/tmp/qa-set-words.txt', 'utf8').trim();
fs.rmSync(dir, { recursive: true, force: true });
const d = await openPersistent(dir, { mobile: mob === 'mobile' });
await d.page.goto(BASE + '/settings#sync', { waitUntil: 'load' });
await d.page.waitForTimeout(3000);
const s = d.page.locator('section#sync');
await s.getByLabel('sync server address').fill(RELAY);
await s.getByRole('button', { name: 'Join with a pairing code' }).click();
await s.getByLabel('pairing code').fill(words);
await s.getByRole('button', { name: 'Join', exact: true }).click();
await d.page.waitForTimeout(6000);
const dlg = d.page.getByRole('alertdialog');
if (await dlg.count()) { console.log('existing-data dialog:', (await dlg.innerText()).replace(/\n+/g, ' | ')); await dlg.getByRole('button', { name: mode === 'replace' ? 'Replace with synced data' : 'Merge' }).click(); await d.page.waitForTimeout(6000); }
console.log('sync:', (await s.innerText()).slice(0, 120).replace(/\n/g, ' | '));
const st = await d.page.evaluate(() => [...document.querySelectorAll('#units [role=radio][aria-checked=true]')].map(e => e.textContent).join(','));
console.log('units:', st);
console.log(d.errors.filter(e => !/preload|Permissions-Policy/.test(e)));
await d.ctx.close();
