// The real ring through the packaged desktop app: L-XPORT's proof page (src/ble/proof/page.ts: the app's Electron
// transport and the J-Style 2301 family from @vitals/rings) runs inside the app's own window on app://vitals, so the
// shell's Bluetooth switch, chooser bridge, activation and permission rules are the ones under test. Prints counts and
// times only (the proof never logs written frames). Run under the hardware locks, ring then phone then pc-ble:
//   .jobs/hw-run.sh ring .jobs/hw-run.sh phone .jobs/hw-run.sh pc-ble node apps/desktop/e2e/ring.e2e.mjs
// The ring must be free (the phone's ring app stopped). Env: RING_ID (Bluetooth address; default the first ring listed).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = path.resolve(appDir, '..', '..');
const APP = path.join(appDir, 'release', 'linux-unpacked', 'vitals');

const alias = {
  name: 'alias',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
  },
};
const bundled = await build({
  entryPoints: [path.join(appDir, 'src', 'ble', 'proof', 'page.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  plugins: [alias],
  logLevel: 'error',
});

mkdirSync(path.join(root, '.e6-tmp'), { recursive: true });
const home = mkdtempSync(path.join(root, '.e6-tmp', 'ring-e2e-'));
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local', 'share') };
for (const k of ['VITALS_SMOKE', 'ELECTRON_RUN_AS_NODE', 'DISPLAY']) delete env[k];
env.WAYLAND_DISPLAY ||= 'wayland-1';
env.XDG_RUNTIME_DIR ||= `/run/user/${process.getuid?.() ?? 1000}`;

let code = 1;
const app = await _electron.launch({ executablePath: APP, args: ['--ozone-platform=wayland', '--hidden'], env, timeout: 60_000 });
try {
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 });
  console.log(`page ${new URL(page.url()).origin}, bridge ${await page.evaluate(() => typeof window.vitalsDesktop?.bluetooth)}`);
  // CDP evaluation is not subject to the page's CSP; the proof only defines globalThis.runProof
  await page.evaluate(bundled.outputFiles[0].text);
  const res = await page.evaluate((o) => globalThis.runProof(o), { kind: 'a5a', ringId: process.env.RING_ID || '', quietMs: 0 });
  console.log(`RESULT ${JSON.stringify(res)}`);
  code = res && !res.error ? 0 : 1;
} catch (e) {
  console.log(`FAIL ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
} finally {
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already gone
  }
  rmSync(home, { recursive: true, force: true });
}
process.exit(code);
