// Builds everything electron-builder packs: the root web app (unless VITALS_SKIP_WEB=1) copied to dist/web, the icons
// to dist/icons, and the three bundles (main, preload, mcp) with esbuild for Electron 44's Node. Only `electron` stays
// external: electron-updater, the MCP SDK and the companion sources are bundled, so the package ships no node_modules.
// The CSP every app:// response carries is read from netlify.toml here (src/main/csp.ts) and compiled in.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { cspFromNetlifyToml } from '../src/main/csp.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const rootDir = path.resolve(appDir, '..', '..');
const dist = path.join(appDir, 'dist');
const src = path.join(appDir, 'src');

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

// 1. the web app
if (process.env.VITALS_SKIP_WEB !== '1') {
  // Run pnpm's JavaScript entry with Node: Windows cannot execFile a pnpm.cmd shim.
  if (!process.env.npm_execpath) throw new Error('Run this build through pnpm run build');
  run(process.execPath, [process.env.npm_execpath, '--dir', rootDir, 'build'], rootDir);
}
const webBuild = path.join(rootDir, 'dist');
if (!existsSync(path.join(webBuild, 'index.html'))) throw new Error(`no web build at ${webBuild}; run pnpm build at the root`);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(webBuild, path.join(dist, 'web'), { recursive: true });

// 2. icons (scripts/icons.mjs fills build/icons; the app loads the window and tray icons from dist/icons)
run(process.execPath, [path.join(here, 'icons.mjs')], appDir);
mkdirSync(path.join(dist, 'icons'), { recursive: true });
for (const f of ['icon.png', 'tray/tray-16.png', 'tray/tray-32.png', 'tray/trayTemplate.png', 'tray/trayTemplate@2x.png']) {
  cpSync(path.join(appDir, 'build', 'icons', f), path.join(dist, 'icons', path.basename(f)));
}

// 3. the bundles
const csp = cspFromNetlifyToml(readFileSync(path.join(rootDir, 'netlify.toml'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
  define: { __VITALS_CSP__: JSON.stringify(csp), 'process.env.NODE_ENV': '"production"' },
};

await build({ ...common, entryPoints: [path.join(src, 'main', 'index.ts')], outfile: path.join(dist, 'main.cjs') });
await build({ ...common, entryPoints: [path.join(src, 'preload', 'index.ts')], outfile: path.join(dist, 'preload.cjs') });
await build({ ...common, entryPoints: [path.join(src, 'mcp', 'node.ts')], outfile: path.join(dist, 'mcp.cjs') });

// the preload runs sandboxed: nothing from Node may be left in it
const preload = readFileSync(path.join(dist, 'preload.cjs'), 'utf8');
const nodeRequire = /require\(["'](?:node:)?(?!electron["'])[a-z_:/]+["']\)/g.exec(preload);
if (nodeRequire) throw new Error(`preload.cjs requires a Node module: ${nodeRequire[0]}; the sandboxed preload may only require electron`);

console.log(`built dist/main.cjs, dist/preload.cjs, dist/mcp.cjs, dist/web (${pkg.name} ${pkg.version}); CSP from netlify.toml compiled in`);
