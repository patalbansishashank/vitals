import { open, view, BASE, base, shot } from './lib.mjs';
import { run } from '../../onb/steps.mjs';
const PLAN = process.argv.includes('plan'); const MOB = process.argv.includes('mobile'); const DIET = process.argv.includes('omni') ? 'everything' : 'vegetarian (with dairy)'; const TAG = (PLAN ? 'p' : '') + (MOB ? 'm' : 'd') + '-' + (DIET === 'everything' ? 'omni' : 'veg');
const { browser, page, errors } = await open({ mobile: MOB });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await run(page, base);
const m = page.locator('main');
const w = () => page.waitForTimeout(700);
const btn = async (n, o = {}) => { await m.getByRole('button', { name: n, ...o }).or(m.getByRole('checkbox', { name: n, ...o })).or(m.getByRole('radio', { name: n, ...o })).last().click(); await w(); };
const done = async () => { await m.getByRole('button', { name: /^Done/ }).last().click(); await w(); };
const rg = async (n, v) => { await m.getByRole('radiogroup', { name: n }).getByRole('radio', { name: v, exact: true }).click(); };
const A = [
  [/Food first, or open/, () => btn('open to supplements')],
  [/How long have you trained/, () => btn('1–3 years', { exact: true })],
  [/Which of these would you do/, async () => { await rg('Indian traditional (dand, baithak, mudgar, gada)', 'like'); await rg('lifting weights', 'no'); await done(); }],
  [/Where can you train/, async () => { await btn('home', { exact: true }); await btn('a gym', { exact: true }); await done(); }],
  [/Which days can/, async () => { for (const d of ['Mon','Wed','Sat']) await btn(d, { exact: true }); await done(); }],
  [/What do you have/, async () => { await btn('Indian traditional set'); await btn('Indian clubs', { exact: true }); await btn('dumbbells', { exact: true }); await shot(page, 'train-kit-' + TAG); await done(); }],
  [/How heavy/, async () => { const c = (n, i) => m.getByRole('checkbox', { name: n, exact: true }).nth(i).click(); await c('10 kg', 0); await c('5 kg', 1); await c('not sure', 2); await c('7.5 kg', 3); await shot(page, 'train-weights-' + TAG); await done(); }],
  [/How much time/, async () => { const sp = m.getByRole('spinbutton', { name: 'days a week' }); console.log('DAYS start', await sp.inputValue()); for (let k = 0; k < 2; k++) { await m.getByRole('button', { name: 'Increase days a week' }).click(); await w(); console.log('DAYS after +', await sp.inputValue()); } await btn('45', { exact: true }); await btn('evening', { exact: true }); await done(); }],
  [/Any pain or injury/, async () => { await btn('knee', { exact: true }); await btn('low back', { exact: true }); await done(); }],
  [/Do any of these apply/, async () => { await btn('none', { exact: true }); await done(); }],
  [/Anything you won/, async () => { await btn('jumping', { exact: false }); await done(); }],
  [/small purchase/, () => btn('up to ₹1 000')],
  [/log workouts/, () => btn('quick', { exact: false })],
  [/Which of these do you eat/, async () => { await btn(DIET); await shot(page, 'food-diet-' + TAG); await done(); }],
  [/Do you avoid any dairy/, () => btn('all dairy is fine')],
  [/Which food do you eat most often/, async () => { await btn('south Indian', { exact: true }); await btn('Gujarati', { exact: true }); await done(); }],
  [/Do you wear or use any/, async () => { await btn('ring', { exact: true }); await btn('smart scale', { exact: true }); await done(); }],
  [/Which one\?/, async () => { for (const n of ['which ring', 'which smart scale']) { const cb = m.getByRole('combobox', { name: n }); if (await cb.evaluate(e => e.tagName) === 'SELECT') { await cb.selectOption({ index: 2 }); await w(); continue; } await cb.click(); await w(); const o = page.getByRole('option'); console.log('OPTIONS', n, (await o.allInnerTexts()).join(' / ').slice(0, 300)); await o.nth(1).click(); await w(); } await shot(page, 'dev-models-' + TAG); await done(); }],
  [/What should Vitals do with each stream/, async () => { await btn('Use recommended'); await shot(page, 'dev-streams-' + TAG); const st = await page.evaluate(() => [...document.querySelectorAll('main input[type=checkbox]')].filter(e => e.checked).map(e => e.getAttribute('aria-label') || e.closest('label')?.innerText).concat([...document.querySelectorAll('main [role=radio][aria-checked=true]')].map(e => 'RADIO:' + e.innerText + '@' + (e.closest('[role=radiogroup]')?.getAttribute('aria-label') || ''))));
console.log('STREAMS-ON>>', JSON.stringify(st)); await done(); throw new Error('STOP'); }],
];
const FAILS = []; page.on('requestfailed', r => FAILS.push('FAILED ' + r.url() + ' ' + r.failure()?.errorText)); page.on('response', r => { if (r.status() >= 400) FAILS.push(r.status() + ' ' + r.url()); });
let STREAMS = '';
const seen = new Set();
for (let i = 0; i < 60; i++) {
  const v = await view(page, 'Q' + i, true);
  if (!v.lg) { const nb = page.getByRole('link', { name: /^Next part|See what we.ll use/ }); if (await nb.count()) { console.log('NEXT'); await nb.last().click(); await w(); continue; } break; }
  const a = A.find(([re]) => re.test(v.lg));
  if (!a) {
    console.log('GENERIC', v.lg);
    const cs = v.c.filter(x => !/ask me later|Done|why/.test(x));
    const isMulti = cs.some(x => x.includes('/checkbox'));
    const nm = x => x.replace(/^[^:]*:/, '');
    try {
      if (isMulti) { const none = cs.find(x => /^[^:]*:(none|nothing|no)$/.test(x)); if (none) await btn(nm(none), { exact: true }); await done(); }
      else { const first = cs.find(x => x.startsWith('button')); await btn(nm(first), { exact: true }); }
    } catch (e) { console.log('GFAIL', e.message.split('\n')[0]); break; }
    continue;
  }
  try { await a[1](); } catch (e) { if (e.message === 'STOP') break; console.log('FAIL', v.lg, e.message.split('\n')[0]); await shot(page, 'fail-' + TAG); break; }
}
const txt = async (sel = 'main') => (await page.locator(sel).first().innerText()).replace(/\n+/g, ' | ');
await page.getByRole('link', { name: /See what we.ll use/ }).click(); await w(); await page.waitForTimeout(800);
console.log('SUMMARY URL', page.url());
await shot(page, 'summary-' + TAG);
console.log('SUMMARY>>', (await txt()).slice(0, 2500));
await page.reload({ waitUntil: 'networkidle' }); await w();
console.log('SUMMARY-RELOAD>>', (await txt()).slice(0, 2500));
const cont = page.getByRole('button', { name: /Looks right/ }); if (await cont.count()) { await cont.click(); await page.waitForTimeout(1500); }
console.log('AFTER CONTINUE', page.url());

import fs from 'node:fs';

if (PLAN) {
  await page.getByRole('link', { name: /See what we.ll use/ }).count();
  await page.goto(BASE + '/plan/goals', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Fat mass ↓' }).click(); await page.getByRole('button', { name: 'Lean tissue (protein-based): keep' }).click(); await page.getByRole('radio', { name: '2 mo' }).click().catch(() => page.getByRole('button', { name: '2 mo' }).click());
  await page.getByRole('button', { name: /Find plans/ }).click(); await page.waitForTimeout(3000);
  await page.getByText('Start this plan').first().waitFor({ timeout: 240000 });
  await page.getByRole('button', { name: 'Start this plan' }).first().click(); await page.waitForTimeout(1500);
  console.log('after start url', page.url());
  const sp = page.getByRole('button', { name: 'Start plan' }); if (await sp.count()) { await sp.first().click(); await page.waitForTimeout(3000); }
  await page.clock.setFixedTime(new Date('2026-10-03T10:00:00')); 
  const tabs = ['/food', '/food/supplements', '/today'];
  for (const t of tabs) { await page.goto(BASE + t, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); const body = (await page.locator('main').innerText()).replace(/\n+/g, ' | '); console.log('LIVING', t, '->', new URL(page.url()).pathname, 'B12?', /B12/i.test(body), 'len', body.length, body.slice(0, 200)); }
  await page.goto(BASE + '/food', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  console.log('FOOD LINKS/BUTTONS', JSON.stringify(await page.locator('main').getByRole('button').allInnerTexts()).slice(0, 700));
  const sup = page.getByRole('button', { name: /supplement/i }).or(page.getByRole('tab', { name: /supplement/i })).or(page.getByRole('link', { name: /supplement/i })).first();
  if (await sup.count()) { await sup.click(); await page.waitForTimeout(1500); }
  const fb = (await page.locator('main').innerText()).replace(/\n+/g, ' | ');
  console.log('FOOD SUPPLEMENTS B12?', /B12/i.test(fb)); const k = fb.search(/supplement/i); console.log('FOOD SUPP TEXT>>', k >= 0 ? fb.slice(Math.max(0, k - 100), k + 900) : 'no supplement text');
  await shot(page, 'food-supplements-' + TAG);
  console.log('ERRORS', errors.filter(e => !/Failed to load resource/.test(e))); await browser.close(); process.exit(0);
}
await page.goto(BASE + '/settings#devices', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const dv = page.locator('section#devices');
console.log('DEVICES-SECTION>>', (await dv.innerText()).replace(/\n+/g, ' | ').slice(0, 1500));
await dv.getByRole('button', { name: /Choose devices/ }).or(dv.getByRole('link', { name: /Choose devices/ })).first().click().catch(e => console.log('choose-devices click fail'));
await page.waitForTimeout(1500); console.log('DEVICES-AFTER-CLICK url', page.url());
console.log('DEVICES-PANEL>>', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 2500));
await shot(page, 'settings-devices-' + TAG);
await page.goto(BASE + '/settings#data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
const data = page.locator('section#data');
const exportNow = async (file) => { const [dl] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: 'Export data' }).click()]); await dl.saveAs(file); return JSON.parse(fs.readFileSync(file, 'utf8')); };
const F1 = 'qa/fixtures/q1b/export-' + TAG + '.json';
const ex1 = await exportNow(F1);
const summarize = (ex) => ({ keys: Object.keys(ex), ver: ex.vitalsVersion ?? ex.version, cols: Object.fromEntries(Object.entries(ex.collections || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 1)])) });
console.log('EXPORT1', JSON.stringify(summarize(ex1)));
const raw1 = fs.readFileSync(F1, 'utf8');
console.log('EXPORT1 mentions', JSON.stringify(Object.fromEntries(['mudgar', 'gada', 'knee', 'vegetarian', 'supplement', 'Apple Watch', 'ring', 'sleep'].map(k => [k, raw1.includes(k)]))));
await data.getByRole('button', { name: 'Reset everything' }).click(); await page.waitForTimeout(800);
const dlg = page.getByRole('alertdialog');
await dlg.getByRole('textbox').fill('reset');
await Promise.all([page.waitForLoadState('load').catch(() => {}), dlg.getByRole('button').last().click()]);
await page.waitForTimeout(5000);
console.log('after erase url', page.url());
await page.goto(BASE + '/settings#data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const d2 = page.locator('section#data');
console.log('DATA after erase:', (await d2.innerText()).replace(/\n+/g, ' | ').slice(0, 300));
await d2.locator('input[type=file]').setInputFiles(F1); await page.waitForTimeout(1500);
const idlg = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
console.log('IMPORT DIALOG>>', (await idlg.innerText()).replace(/\n+/g, ' | ').slice(0, 900));
console.log('IMPORT RADIOS', JSON.stringify(await idlg.evaluate(e => [...e.querySelectorAll('[role=radio],input[type=radio]')].map(r => (r.getAttribute('aria-label') || r.closest('label')?.innerText || r.innerText || r.value) + ':' + (r.getAttribute('aria-checked') ?? r.checked)))));
await shot(page, 'import-dialog-' + TAG);
console.log('IMPORT BUTTONS', JSON.stringify(await idlg.getByRole('button').allInnerTexts()));
await idlg.getByRole('button').last().click(); await page.waitForTimeout(3500);
console.log('url after import', page.url());
await page.goto(BASE + '/settings#data', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
const ex2 = await exportNow('qa/fixtures/q1b/export-' + TAG + '-after.json');
console.log('EXPORT2', JSON.stringify(summarize(ex2)));
const strip = (o) => JSON.stringify(o, (k, v) => (/^(exportedAt|createdAt|updatedAt|at|ts|time|generatedAt)$/.test(k) ? undefined : v));
const a = strip(ex1.collections), b = strip(ex2.collections);
console.log('COLLECTIONS EQUAL (ignoring timestamps)?', a === b, a.length, b.length);
if (a !== b) for (const k of Object.keys(ex1.collections || {})) { const x = strip(ex1.collections[k]), y = strip((ex2.collections || {})[k]); if (x !== y) console.log('DIFF in', k, x?.length, y?.length, '\n  1:', x?.slice(0, 250), '\n  2:', y?.slice(0, 250)); }
await page.goto(BASE + '/onboarding/summary', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
console.log('SUMMARY AFTER IMPORT>>', (await txt()).slice(0, 1200));
await shot(page, 'after-import-summary-' + TAG);
console.log('NETFAILS', JSON.stringify([...new Set(FAILS)]));
console.log('ERRORS', errors); await browser.close();
