import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('_') ? undefined : v)));
for (const k of Object.keys(a.collections)) {
  const x = JSON.stringify(clean(a.collections[k])), y = JSON.stringify(clean(b.collections[k] ?? null));
  console.log(k, x === y ? 'EQUAL' : 'DIFF ' + x.length + ' vs ' + y.length);
  if (x !== y) { const xs = clean(a.collections[k]), ys = clean(b.collections[k]); const ln = (v) => (Array.isArray(v) ? v : [v]);
    console.log('  names1', ln(xs).map(d => d?.id || d?.name || d?.kind).join(','), ' names2', ln(ys).map(d => d?.id + '/' + d?.name).join(','));
    if (k === 'safety') { for (const kk of new Set([...Object.keys(ln(xs)[0]), ...Object.keys(ln(ys)[0])])) if (JSON.stringify(ln(xs)[0][kk]) !== JSON.stringify(ln(ys)[0][kk])) console.log('  safety field', kk, JSON.stringify(ln(xs)[0][kk])?.slice(0, 160), '=>', JSON.stringify(ln(ys)[0][kk])?.slice(0, 160)); } }
}
console.log('blobs/stores', JSON.stringify(a.blobs)?.slice(0, 100), JSON.stringify(a.stores)?.slice(0, 200), '=>', JSON.stringify(b.stores)?.slice(0, 200));
