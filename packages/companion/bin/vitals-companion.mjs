#!/usr/bin/env node
// Runs the TypeScript sources directly through Node's built-in type stripping (Node 22.18+, 23.6+).
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
if (!supported) {
  process.stderr.write(`vitals-companion needs Node.js 22.18 or newer (found ${process.versions.node}).\n`);
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
