#!/usr/bin/env node
/**
 * Bundle report for SUITE_SPEC §9.5 (QA_FINDINGS Q1-BUNDLE): what loads before first paint, per route, gzip -9.
 *
 *   node qa/scripts/bundle-report.mjs                 # build into .tmp-bundle/dist (vite build --manifest), then report
 *   node qa/scripts/bundle-report.mjs --no-build      # report on an existing .tmp-bundle/dist
 *   node qa/scripts/bundle-report.mjs --out dist      # another build directory (must have been built with --manifest)
 *   node qa/scripts/bundle-report.mjs --json          # machine-readable output
 *
 * "Shell" is what index.html loads: the entry script, its modulepreloads and the stylesheets. A route adds the static
 * import closure of the lazy chunks it renders before anything useful is on screen (its page, and for Living routes the
 * page under the guard). Chunks loaded after the first paint (sync check, workers, the engine) are not counted.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../..');
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : '.tmp-bundle/dist';
const outDir = resolve(root, outArg);
const json = args.includes('--json');

if (!args.includes('--no-build')) {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--manifest', '--outDir', outDir, '--emptyOutDir'], { cwd: root, stdio: json ? 'ignore' : 'inherit' });
}

const manifestPath = join(outDir, '.vite/manifest.json');
if (!existsSync(manifestPath)) throw new Error(`${manifestPath} is missing: build with \`vite build --manifest\``);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// The pages each measured route renders before first paint (source paths as keys of the Vite manifest).
const ROUTES = {
  '/ (first run) → /welcome': ['src/features/onboarding/WelcomePage.tsx'],
  '/body': ['src/features/body/BodyPage.tsx'],
  '/simulate': ['src/features/simulator/SimulatePage.tsx'],
  '/plan': ['src/features/planner/PlannerPage.tsx'],
  '/ (active plan) → /today': ['src/features/living/today/TodayPage.tsx'],
};

const gzCache = new Map();
const gz = (file) => {
  if (!gzCache.has(file)) gzCache.set(file, gzipSync(readFileSync(join(outDir, file)), { level: 9 }).length);
  return gzCache.get(file);
};

/** Files of the static import closure of the given manifest keys (JS and CSS). */
function closure(keys) {
  const files = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`not in the manifest: ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  keys.forEach(visit);
  return files;
}

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry && key.endsWith('index.html'));
const shell = closure([entryKey]);
const sum = (files, ext) => [...files].filter((f) => f.endsWith(ext)).reduce((total, f) => total + gz(f), 0);

const rows = [{ route: 'shell (index.html)', files: shell }];
for (const [route, pages] of Object.entries(ROUTES)) {
  // a page missing from the manifest (moved, or an older build such as v0.1 without Living mode) is reported as n/a
  const missing = pages.filter((page) => !manifest[page]);
  rows.push({ route, files: missing.length ? null : new Set([...shell, ...closure(pages)]), missing });
}

const kb = (bytes) => (bytes / 1000).toFixed(1);
const report = rows.map(({ route, files, missing }) =>
  files ? { route, js: sum(files, '.js'), css: sum(files, '.css'), files: files.size } : { route, missing },
);
const biggest = [...shell].map((file) => ({ file, gz: gz(file) })).sort((a, b) => b.gz - a.gz);

if (json) {
  console.log(JSON.stringify({ report, shell: biggest }, null, 2));
} else {
  console.log('\nBefore first paint (gzip -9, kB = 1000 B)');
  console.log('| Route | JS | CSS | JS+CSS | Files |\n|---|---:|---:|---:|---:|');
  for (const r of report) {
    console.log(r.missing ? `| ${r.route} | n/a (not built: ${r.missing.join(', ')}) | | | |` : `| ${r.route} | ${kb(r.js)} | ${kb(r.css)} | ${kb(r.js + r.css)} | ${r.files} |`);
  }
  console.log('\nShell files (gzip -9):');
  for (const { file, gz: size } of biggest) console.log(`  ${kb(size).padStart(7)} kB  ${file}`);
}
