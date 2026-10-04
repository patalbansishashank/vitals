import { open, dump, BASE, shot } from './lib.mjs';
const mobile = process.argv[2] === 'mobile';
const KEY = 'sk-qa-SECRETKEY-9f8e7d6c5b4a';
const { browser, ctx, page, errors } = await open({ mobile });
const logs = []; page.on('console', m => logs.push(m.text()));
const reqs = []; page.on('request', r => reqs.push(r.method() + ' ' + r.url() + ' ' + JSON.stringify(r.headers()['authorization'] || '')));
await page.goto(BASE + '/settings#coach', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const sec = page.locator('section#coach');
await sec.locator('input[type=radio][value=custom]').check();
await page.waitForTimeout(800);
await dump(page, 'custom', 'section#coach');
console.log((await sec.innerText()).split('Custom endpoint')[1]?.slice(0, 1500));
await shot(page, `ai-custom-${mobile ? 'm' : 'd'}`);
const fillIf = async (label, v) => { const l = sec.getByLabel(label, { exact: true }); if (await l.count()) { await l.first().fill(v); return true; } console.log('NO FIELD', label); return false; };
await fillIf('base URL', 'http://127.0.0.1:4199/v1');
await fillIf('API key', KEY);
const sk = sec.getByRole('button', { name: 'Save key' }); if (await sk.count()) { await sk.click(); await page.waitForTimeout(800); }
const mid = sec.getByLabel('model id', { exact: true }); if (await mid.count()) await mid.fill('qa-model'); else { const m = sec.getByLabel('model', { exact: true }); if (await m.count()) { const tag = await m.evaluate(e => e.tagName); console.log('model tag', tag); if (tag === 'INPUT') await m.fill('qa-model'); } }
await page.waitForTimeout(500);
await dump(page, 'filled', 'section#coach');
const test = sec.getByRole('button', { name: /Test connection|Check/ }).first();
if (await test.count()) { await test.click(); await page.waitForTimeout(6000); }
{ const t = await sec.innerText(); console.log('AFTER TEST:', t.slice(t.indexOf('API key'), t.indexOf('coach behaviour'))); }
await shot(page, `ai-test-${mobile ? 'm' : 'd'}`);
const save = sec.getByRole('button', { name: 'Save provider' }); console.log('save disabled?', await save.isDisabled()); if (!(await save.isDisabled())) { await save.click(); await page.waitForTimeout(1500); }
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
{ const t = await page.locator('section#coach').innerText(); console.log('AFTER RELOAD:', t.slice(0,200), '...', t.slice(t.indexOf('API key'), t.indexOf('coach behaviour'))); console.log('VALUES', await page.locator('section#coach input:not([type=radio]):not([type=checkbox])').evaluateAll(es => es.map(e => (e.getAttribute('aria-label')||e.id)+'='+e.value+'('+e.type+')'))); }
// leak scan
const leak = await page.evaluate(async (KEY) => {
  const out = [];
  if (document.body.innerText.includes(KEY)) out.push('DOM text');
  for (const i of document.querySelectorAll('input,textarea')) if (i.value.includes(KEY)) out.push('input ' + (i.name || i.id || i.type));
  if (document.documentElement.outerHTML.includes(KEY)) out.push('HTML');
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if ((localStorage.getItem(k) || '').includes(KEY)) out.push('LS ' + k); }
  for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if ((sessionStorage.getItem(k) || '').includes(KEY)) out.push('SS ' + k); }
  const dbs = await indexedDB.databases(); const names = [];
  for (const { name } of dbs) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const s of db.objectStoreNames) {
      names.push(name + '/' + s);
      const all = await new Promise((res) => { const t = db.transaction(s).objectStore(s).getAll(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); });
      const str = JSON.stringify(all, (k, v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder().decode(v) : v);
      if (str.includes(KEY)) out.push('IDB ' + name + '/' + s);
    }
    db.close();
  }
  return { out, names };
}, KEY);
console.log('LEAK', JSON.stringify(leak));
console.log('LOG LEAK', logs.filter(l => l.includes(KEY)).length);
console.log('REQS to 4199', reqs.filter(r => r.includes('4199')));
console.log('ERRORS', errors.filter(e => !/preload|Permissions-Policy/.test(e)));
await browser.close();
