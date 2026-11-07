// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIN_NODE_VERSION } from '../bin/node-runtime.mjs';
import { tempDir } from './testHelpers.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string; engines: { node: string } };
const entries = ['vitals-server', 'vitals-companion'] as const;

/** Exercise the real guard under this installed Node; only its reported version is injected. */
function entryHelp(entry: typeof entries[number], version: string) {
  const bin = join(packageDir, 'bin', `${entry}.mjs`);
  const script = [
    `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });`,
    `process.argv = [process.execPath, ${JSON.stringify(bin)}, '--help'];`,
    `await import(${JSON.stringify(pathToFileURL(bin).href)});`,
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10_000 });
}

it('declares the same package minimum that the entrypoints and doctor enforce', () => {
  expect(MIN_NODE_VERSION).toBe('26.10.0');
  expect(pkg.engines.node).toBe(`>=${MIN_NODE_VERSION}`);
});

for (const entry of entries) describe(`${entry} runtime contract`, () => {
  it.each(['22.18.0', '23.6.0', '24.21.0', '26.9.99'])('rejects Node %s before loading the CLI', (version) => {
    const result = entryHelp(entry, version);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${entry} needs Node.js 26.10.0 or newer (found ${version}).\n`);
  });

  it.each(['26.10.0', '27.0.0'])('retains --help behavior for supported Node %s', (version) => {
    const result = entryHelp(entry, version);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${entry} ${pkg.version}`);
    expect(result.stderr).not.toContain('needs Node.js');
    if (entry === 'vitals-companion') expect(result.stderr).toContain('vitals-companion is now vitals-server');
  });
});

it('lets the server switch from an old launcher to its existing pinned runtime before checking the minimum', () => {
  const tmp = tempDir();
  try {
    const companion = join(tmp.dir, 'packages', 'companion');
    const bin = join(companion, 'bin', 'vitals-server.mjs');
    mkdirSync(dirname(bin), { recursive: true });
    for (const file of ['vitals-server.mjs', 'node-runtime.mjs']) copyFileSync(join(packageDir, 'bin', file), join(dirname(bin), file));
    const pinned = join(tmp.dir, 'node', 'bin', 'node');
    mkdirSync(dirname(pinned), { recursive: true });
    symlinkSync(process.execPath, pinned);
    const oldLauncher = join(tmp.dir, 'old-node');
    writeFileSync(oldLauncher, 'synthetic previous launcher');
    const polyfills = join(companion, 'node_modules', '@evolu', 'common');
    mkdirSync(polyfills, { recursive: true });
    writeFileSync(join(polyfills, 'package.json'), JSON.stringify({ type: 'module', exports: { './polyfills': './polyfills.mjs' } }));
    writeFileSync(join(polyfills, 'polyfills.mjs'), 'export function installPolyfills() {}');
    const cli = join(companion, 'src', 'home', 'serverCli.ts');
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(cli, 'export async function serverMain(args: string[]) { console.log(JSON.stringify({ args, node: process.versions.node })); return 7; }');
    const bootstrap = join(tmp.dir, 'bootstrap.mjs');
    writeFileSync(bootstrap, [
      `Object.defineProperty(process.versions, 'node', { value: '22.18.0' });`,
      `Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(oldLauncher)} });`,
      `process.execArgv = [];`,
      `process.argv = [process.execPath, ${JSON.stringify(bin)}, '--probe', 'two words'];`,
      `await import(${JSON.stringify(pathToFileURL(bin).href)});`,
    ].join('\n'));
    const result = spawnSync(process.execPath, [bootstrap], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual({ args: ['--probe', 'two words'], node: process.versions.node });
    expect(result.stderr).not.toContain('needs Node.js');
  } finally { tmp.cleanup(); }
});
