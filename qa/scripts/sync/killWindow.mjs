// S4 kill window (local, no server): how long after `store.put()` resolves is a SIGKILL still able to lose the write?
// One Node replica (the app's Evolu adapter on the server's Node platform), relay cut off, so nothing leaves the
// process. For each delay: write one food entry, wait, SIGKILL, restart, read it back. Writes
// qa/results/sync/S4-kill-window.json.
//   node qa/scripts/sync/killWindow.mjs [trials per delay, default 5]
import './lib/tsResolve.mjs';
import fs from 'node:fs';
import { ROOT, log, runDir, sleep } from './lib/config.mjs';
import { todayIn } from './lib/docs.mjs';
import { openReplica } from './lib/replica.mjs';

const { newOwnerSecret } = await import('../../../src/sync/pairing.ts');
const { ulid } = await import('../../../src/store/ids.ts');

const TRIALS = Number(process.argv[2] ?? 5);
const DELAYS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 100];
const run = `killwindow-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const dir = runDir(run);
// a relay address nobody answers on: the proxy is switched off before any write anyway
const A = await openReplica('node', { name: 'A', secret: newOwnerSecret(), relayTarget: 'http://127.0.0.1:9', dir: `${dir}/A` });
await A.goOffline();
const date = todayIn();
const rows = [];
try {
  for (const delay of DELAYS) {
    let kept = 0;
    for (let i = 0; i < TRIALS; i++) {
      const id = ulid();
      await A.write({ op: 'logFood', id, date, text: `kill window ${delay} ms #${i + 1}` });
      if (delay) await sleep(delay);
      await A.kill();
      await A.restart();
      if ((await A.read({ col: 'dailyLogs', id }))[id]) kept += 1;
    }
    rows.push({ delayMs: delay, trials: TRIALS, kept, lost: TRIALS - kept });
    log(`kill ${String(delay).padStart(3)} ms after put() resolved: ${kept}/${TRIALS} writes on disk after restart`);
  }
} finally {
  await A.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
const out = { scenario: 'S4-kill-window', at: new Date().toISOString(), note: 'SIGKILL of the Node replica process N ms after store.put() resolved, relay cut off; kept = the write was read back after restart', rows };
fs.mkdirSync(`${ROOT}/qa/results/sync`, { recursive: true });
fs.writeFileSync(`${ROOT}/qa/results/sync/S4-kill-window.json`, JSON.stringify(out, null, 1) + '\n');
console.table(rows);
