// R17: N persons in one process, one worker_threads Worker per person (each its own module graph, so its own
// command bus and document runtime). Usage: node multi.mjs <N> <baseDir>. Prints RSS with all persons open.
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
const n = Number(process.argv[2] ?? 5);
const base = process.argv[3];
const mib = () => Math.round((process.memoryUsage().rss / 2 ** 20) * 10) / 10;
const rss0 = mib();
const t0 = performance.now();
const workers = [];
const ready = [];
for (let i = 1; i <= n; i++) {
  const w = new Worker(new URL('./dist/main.mjs', import.meta.url), { argv: [join(base, `p${i}`)], stdout: true });
  ready.push(new Promise((r) => w.on('message', (m) => m === 'ready' && r())));
  workers.push(w);
}
await Promise.all(ready);
const all = mib();
console.log(JSON.stringify({ persons: n, rssBeforeMiB: rss0, rssAllOpenMiB: all, perPersonMiB: Math.round(((all - rss0) / n) * 10) / 10, allReadyMs: Math.round(performance.now() - t0) }));
for (const w of workers) w.postMessage('close');
await Promise.all(workers.map((w) => new Promise((r) => w.on('exit', r))));
