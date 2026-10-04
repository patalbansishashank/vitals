// J1 transport proof in the packaged app (a copy under .e6-tmp/j1): bundles proof-page.ts against L-DESKTOP's sources
// (read-only; esbuild writes nothing) and evaluates it inside the app's window. Also runs L-DESKTOP's own page.ts proof
// when J1_PROOF=desktop. Output (counts, times, aggregates) goes to private/j1 only. Run under ring → phone → pc-ble.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, close, priv, desktopWt, here, stamp } from './lib.mjs';

const req = createRequire(path.join(desktopWt, 'apps', 'desktop', 'package.json'));
const { build } = req('esbuild');
const kind = process.env.J1_PROOF || 'j1';
const alias = {
  name: 'alias',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(desktopWt, 'src'), kind: a.kind }));
  },
};
const proofDir = path.join(desktopWt, 'apps', 'desktop', 'src', 'ble', 'proof');
const bundled = await build({
  ...(kind === 'desktop'
    ? { entryPoints: [path.join(proofDir, 'page.ts')] }
    : { stdin: { contents: readFileSync(path.join(here, 'proof-page.ts'), 'utf8'), resolveDir: proofDir, sourcefile: 'j1-proof-page.ts', loader: 'ts' } }),
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome130', plugins: [alias], logLevel: 'error',
});

if (process.env.J1_BUILD_ONLY === '1') { console.log(`bundle ok, ${bundled.outputFiles[0].text.length} bytes`); process.exit(0); }
// last night window: 2026-10-03 20:00 → 2026-10-04 10:00 local (IST) unless given
const fromMs = Date.parse(process.env.J1_FROM || '2026-10-03T20:00:00+05:30');
const toMs = Date.parse(process.env.J1_TO || '2026-10-04T10:00:00+05:30');
const t0 = Date.now();
const { app, page, consoleLines } = await launch(`proof-${kind}`);
let res;
try {
  console.log(`${stamp()} page ${new URL(page.url()).origin}, bridge ${await page.evaluate(() => typeof window.vitalsDesktop?.bluetooth)}`);
  await page.evaluate(bundled.outputFiles[0].text);
  res = kind === 'desktop'
    ? await page.evaluate((o) => globalThis.runProof(o), { kind: 'a5a', ringId: '', quietMs: 0 })
    : await page.evaluate((o) => globalThis.runJ1Proof(o), { ringId: '', fromMs, toMs, reconnect: process.env.J1_RECONNECT !== '0' });
} catch (e) {
  res = { error: `runner: ${e.message.split('\n')[0]}` };
} finally {
  await close(app);
}
res.wallS = Math.round((Date.now() - t0) / 1000);
const file = path.join(priv, `proof-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ result: res, console: consoleLines.filter((l) => / (error|pageerror|warning) /.test(l)) }, null, 2));
console.log(`${stamp()} ${res.error ? 'FAIL ' + res.error : 'OK'}; wrote ${path.basename(file)}; app closed after ${res.wallS}s`);
// short public-safe summary on stdout: no times of day, no values
const s = res;
console.log(`summary connectMs=${s.connectMs} handshakeMs=${s.handshakeMs} syncMs=${s.syncMs} firmware=${s.firmware ? 'present' : 'none'} battery=${s.battery != null ? 'read' : 'none'} nights=${s.sleep?.nights ?? s.sleep?.nights} hrN=${s.hr?.all?.n ?? s.hr?.n} reconnectMs=${s.reconnectMs} error=${s.error ?? ''}`);
process.exit(res.error ? 1 : 0);
