#!/usr/bin/env node
// Assembles a deployable Vitals Server directory (default dist/server): bin/, the TypeScript sources the main thread
// runs through Node's type stripping, the bundled person program and a package.json with runtime dependencies only.
// On the host: `npm install --omit=dev` inside it, then `node bin/vitals-server.mjs …`. Tests, spikes and dev
// dependencies are left out. Run `pnpm build:person` first (`pnpm build` does both).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const out = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(pkgDir, 'dist', 'server');
const worker = join(pkgDir, 'dist', 'person-worker.mjs');
if (!existsSync(worker)) {
  process.stderr.write('dist/person-worker.mjs is missing: run pnpm build:person first.\n');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });

const skip = (p) => /\.test\.ts$|\.live\.|testHome\.ts$|mcpTestClient\.ts$|__tests__|__snapshots__/.test(p);
const copyTree = (from, to) => {
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) copyTree(src, dst);
    else if (!skip(src)) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
    }
  }
};
copyTree(join(pkgDir, 'bin'), join(out, 'bin'));
copyTree(join(pkgDir, 'src'), join(out, 'src'));
copyTree(join(pkgDir, 'deploy'), join(out, 'deploy'));
cpSync(worker, join(out, 'dist', 'person-worker.mjs'));
cpSync(join(pkgDir, 'README.md'), join(out, 'README.md'));

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
// npm 12 runs no dependency install script unless allowed: better-sqlite3 builds or fetches its native module in one
const allowScripts = { [`better-sqlite3@${pkg.dependencies['better-sqlite3']}`]: true };
const runtime = { name: pkg.name, version: pkg.version, private: true, description: pkg.description, license: pkg.license, type: 'module', engines: pkg.engines, bin: pkg.bin, dependencies: pkg.dependencies, allowScripts };
writeFileSync(join(out, 'package.json'), `${JSON.stringify(runtime, null, 2)}\n`);
process.stdout.write(`Vitals Server ${pkg.version} packed to ${relative(process.cwd(), out) || '.'}\n`);
