import { open, BASE } from './lib.mjs';
const { browser, page } = await open({ profile: process.argv[2] });
await page.goto(BASE + '/today', { waitUntil: 'networkidle' });
const out = await page.evaluate(async () => {
  const db = await new Promise((r, j) => { const q = indexedDB.open('vitals-docs'); q.onsuccess = () => r(q.result); q.onerror = j; });
  const res = {};
  for (const st of db.objectStoreNames) {
    const all = await new Promise((r) => { const t = db.transaction(st).objectStore(st).getAll(); t.onsuccess = () => r(t.result); });
    res[st] = all.map((x) => (x.col || x._col || '?') + ':' + (x.doc?.kind || x.doc?.value?.commandId || '')).join(', ');
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
