import { open, BASE, shot, firstRun, dump } from './lib.mjs';
import fs from 'node:fs';
const mobile = process.argv[2] === 'mobile';
const KEY = 'sk-qa-SECRETKEY-9f8e7d6c5b4a';
const { browser, ctx, page, errors } = await open({ mobile });
await firstRun(page, { weight: '93' });
await page.goto(BASE + '/settings#units', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
await page.getByRole('radio', { name: 'Sunday', exact: true }).click();
// AI key
const sec = page.locator('section#coach');
await sec.locator('input[type=radio][value=openai]').check(); await page.waitForTimeout(500);
await sec.getByLabel('API key', { exact: true }).fill(KEY); await sec.getByRole('button', { name: 'Save key' }).click(); await page.waitForTimeout(800);
await sec.getByRole('button', { name: 'Save provider' }).click(); await page.waitForTimeout(1000);
const inv = async (label) => page.evaluate(async () => {
  const ls = Object.keys(localStorage);
  const dbs = (await indexedDB.databases()).map(d => d.name);
  const ck = await caches.keys();
  let opfs = [];
  try { const root = await navigator.storage.getDirectory(); for await (const k of root.keys()) opfs.push(k); } catch (e) { opfs = ['ERR ' + e.message]; }
  return { ls, dbs, caches: ck, opfs };
}).then(r => console.log(label, JSON.stringify(r)));
await inv('BEFORE');
// export
const data = page.locator('section#data');
console.log('DATA:', (await data.innerText()).replace(/\n+/g, ' | '));
const [dl] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: 'Export data' }).click()]);
const file = '/media/DEV/tmp/qa-set-export.json'; await dl.saveAs(file);
const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('EXPORT name', dl.suggestedFilename(), 'keys', Object.keys(ex), 'version', ex.vitalsVersion, 'cols', Object.keys(ex.collections || {}).join(','));
const raw = fs.readFileSync(file, 'utf8');
console.log('export contains key?', raw.includes(KEY), 'contains providerKeys/secrets?', /providerKeys|"secrets"|commandLedger|changeLog|syncState/.test(raw));
console.log('profile in export:', JSON.stringify(ex.collections?.profile)?.slice(0, 300));
// erase
await data.getByRole('button', { name: 'Reset everything' }).click(); await page.waitForTimeout(800);
const dlg = page.getByRole('alertdialog');
console.log('RESET DIALOG:', (await dlg.innerText()).replace(/\n+/g, ' | '));
const confirmBtn = dlg.getByRole('button').last();
console.log('confirm disabled before typing?', await confirmBtn.getAttribute('aria-disabled'), await confirmBtn.isDisabled());
await dlg.getByRole('textbox').fill('reset');
await Promise.all([page.waitForLoadState('load').catch(() => {}), confirmBtn.click()]);
await page.waitForTimeout(5000);
console.log('after erase url', page.url());
await inv('AFTER ERASE');
await page.goto(BASE + '/settings#coach', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
console.log('AI after erase:', (await page.locator('section#coach').innerText()).slice(0, 160).replace(/\n+/g, ' | '));
await inv('AFTER SETTINGS VISIT');
// import
await page.goto(BASE + '/settings#data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const d2 = page.locator('section#data');
await d2.locator('input[type=file]').setInputFiles(file); await page.waitForTimeout(1500);
const idlg = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
console.log('IMPORT DIALOG:', (await idlg.innerText()).replace(/\n+/g, ' | ').slice(0, 600));
await idlg.getByRole('button').last().click(); await page.waitForTimeout(3000);
console.log('url after import', page.url());
await page.goto(BASE + '/body', { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
console.log('BODY after import:', (await page.evaluate(() => document.querySelector('main')?.innerText || '')).replace(/\s+/g, ' ').slice(0, 300));
console.log('spin values', await page.getByRole('spinbutton').evaluateAll(es => es.map(e => e.value || e.getAttribute('aria-valuenow'))));
await page.goto(BASE + '/settings#units', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
console.log('units', await page.evaluate(() => [...document.querySelectorAll('#units [role=radio][aria-checked=true]')].map(e => e.textContent).join(',')));
{ await page.goto(BASE + '/settings#data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('section#data').getByRole('button', { name: 'Export data' }).click()]);
await dl2.saveAs('/media/DEV/tmp/qa-set-export2.json'); const ex2 = JSON.parse(fs.readFileSync('/media/DEV/tmp/qa-set-export2.json', 'utf8'));
for (const c of Object.keys(ex.collections)) { const a = JSON.stringify(ex.collections[c].map(d => { const { _rev, _updated, _created, _device, ...r } = d; return r; })); const b = JSON.stringify((ex2.collections[c]||[]).map(d => { const { _rev, _updated, _created, _device, ...r } = d; return r; })); console.log('roundtrip', c, a === b ? 'SAME' : 'DIFF ' + a.slice(0,200) + ' VS ' + b.slice(0,200)); } }
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy|GL Driver/.test(e)));
await browser.close();
