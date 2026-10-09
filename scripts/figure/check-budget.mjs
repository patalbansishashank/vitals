// Run after `pnpm exec vite build`. Packs are already gzip-compressed on disk.
// Count figure-specific bundles, including the existing vector fallback; shared
// React/app/engine chunks already needed by their pages are not incremental cost.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const limit = 3_000_000;
const rows = [];
for (const file of ['figure-v2.bin', 'anatomy-v1.bin']) {
  const source = await readFile(resolve(root, 'public/figure', file));
  const built = await readFile(resolve(root, 'dist/figure', file));
  if (!source.equals(built)) throw new Error(`${file} changed after the build; rebuild before measuring.`);
  rows.push({ file: `figure/${file}`, compressedBytes: built.length });
}
for (const file of ['NOTICE.html', 'NOTICE.txt']) {
  const source = await readFile(resolve(root, 'public/figure', file));
  const built = await readFile(resolve(root, 'dist/figure', file));
  if (!source.equals(built)) throw new Error(`${file} changed after the build; rebuild before measuring.`);
  rows.push({ file: `figure/${file}`, compressedBytes: gzipSync(built, { level: 9 }).length });
}
const names = (await readdir(resolve(root, 'dist/assets'))).filter((name) => /^(Figure3D(?:Canvas)?|AvatarMorph|BodyAvatar|renderer|scene|manifest|anatomy\.worker)-.*\.(js|css)$/.test(name));
if (!names.some((name) => name.startsWith('Figure3DCanvas-'))) throw new Error('Build the lazy figure chunk first.');
for (const file of names.sort()) {
  rows.push({ file: `assets/${file}`, compressedBytes: gzipSync(await readFile(resolve(root, 'dist/assets', file)), { level: 9 }).length });
}
const total = rows.reduce((sum, row) => sum + row.compressedBytes, 0);
const report = { budgetBytes: limit, totalCompressedBytes: total, passes: total <= limit, files: rows };
const output = resolve(root, 'bench-results/C-BODY/download-budget.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passes) process.exitCode = 1;
