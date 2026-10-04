import { open, BASE } from './lib.mjs';
const { browser, page } = await open({ profile: process.argv[2] });
await page.goto(BASE + '/today', { waitUntil: 'networkidle' });
const out = await page.evaluate(async (filter) => {
  const dbs = await indexedDB.databases();
  const res = { dbs: dbs.map((d) => d.name) };
  for (const { name } of dbs) {
    const db = await new Promise((r, j) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); q.onerror = j; });
    for (const st of db.objectStoreNames) {
      const all = await new Promise((r) => { const t = db.transaction(st).objectStore(st).getAll(); t.onsuccess = () => r(t.result); t.onerror = () => r([]); });
      const s = JSON.stringify(all);
      res[name + '/' + st] = all.length + ' ' + (filter ? (s.match(new RegExp('.{0,300}' + filter + '.{0,600}', 'g')) || []).slice(0, 4).join('\n###\n') : '');
    }
  }
  return res;
}, process.argv[3] || '');
console.log(JSON.stringify(out, null, 1).slice(0, 8000));
await browser.close();
