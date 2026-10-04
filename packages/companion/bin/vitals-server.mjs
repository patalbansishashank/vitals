#!/usr/bin/env node
// The Vitals Server admin CLI (`vitals-server`). Runs the TypeScript sources through Node's type stripping (Node 22.18+).
// On a host deployed by deploy/oci-arm.sh, ~/vitals-server/node is the pinned Node the native modules were built for:
// started by any other node, this file runs itself again under that one (docs/SERVER.md "Operations").
import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const pinned = fileURLToPath(new URL('../../../node/bin/node', import.meta.url));
if (existsSync(pinned) && realpathSync(pinned) !== realpathSync(process.execPath)) {
  const r = spawnSync(pinned, [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18))) {
  process.stderr.write(`vitals-server needs Node.js 22.18 or newer (found ${process.versions.node}).\n`);
  process.exit(1);
}
const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const { serverMain } = await import('../src/home/serverCli.ts');
try {
  process.exitCode = await serverMain(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
