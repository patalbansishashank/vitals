#!/usr/bin/env node
// Runs the TypeScript sources directly through Node's built-in type stripping (Node 26.10.0+).
import { MIN_NODE_VERSION, nodeSupported } from './node-runtime.mjs';
if (!nodeSupported(process.versions.node)) {
  process.stderr.write(`vitals-companion needs Node.js ${MIN_NODE_VERSION} or newer (found ${process.versions.node}).\n`);
  process.exit(1);
}
// @evolu/common relies on Map/WeakMap getOrInsert[Computed] (TC39 upsert), which Node 24 lacks; without this the relay
// crashes on its first sync message ("getOrInsertComputed is not a function"). Harmless where the methods exist.
const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
process.stderr.write('vitals-companion is now vitals-server; this name stays for one release.\n');
const { main } = await import('../src/cli.ts');
const code = await main(process.argv.slice(2));
if (code !== 0) process.exitCode = code;
