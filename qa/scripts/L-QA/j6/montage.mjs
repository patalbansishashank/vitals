// usage: node montage.mjs <outPng> <dirA> <dirB> <name1> [name2 ...]  -> side by side (A=light, B=dark) per name, names laid left to right
import sharp from 'sharp';
const [out, dirA, dirB, ...names] = process.argv.slice(2);
const cells = [];
for (const n of names) for (const d of [dirA, dirB]) cells.push(`${d}/${n}.png`);
const metas = await Promise.all(cells.map((c) => sharp(c).metadata()));
const H = Math.max(...metas.map((m) => m.height)); const W = metas.reduce((s, m) => s + m.width + 6, 0);
let x = 0; const comp = cells.map((c, i) => { const o = { input: c, left: x, top: 0 }; x += metas[i].width + 6; return o; });
await sharp({ create: { width: W, height: H, channels: 3, background: '#e00' } }).composite(comp).png().toFile(out);
console.log(out, W, H);
