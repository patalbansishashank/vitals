// A loopback-only vitals-companion relay for the two-device check. Prints its URL on stdout and runs until SIGTERM.
// Data dir: L_REV2_RELAY_DIR (git-ignored, deleted by the caller). Nothing listens beyond 127.0.0.1.
import '../sync/lib/tsResolve.mjs';
import { mkdirSync } from 'node:fs';

process.removeAllListeners('warning');
const dir = process.env.L_REV2_RELAY_DIR;
if (!dir) throw new Error('L_REV2_RELAY_DIR is required');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const { startCompanion } = await import('../../../packages/companion/src/server.ts');
const companion = await startCompanion({ host: '127.0.0.1', port: 0, dataDir: dir, allowedOrigins: [], log: () => {} });
console.log(`http://127.0.0.1:${companion.port}`);
const stop = async () => {
  await companion.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
