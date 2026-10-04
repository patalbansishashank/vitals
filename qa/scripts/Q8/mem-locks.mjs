// E34 evidence: Node's Web Locks across worker threads, with no Vitals code. Each worker holds one lock for ever (as an
// Evolu leader lock does) and, with SELF=1, also waits for that same lock (a second request in the same thread); with
// PENDING=1 it waits for its neighbour's lock instead. The main thread prints every worker's event-loop use and the RSS.
//   SELF=1 N=3 node qa/scripts/Q8/mem-locks.mjs
// Measured on oci-arm (2 cores, arm64), 2026-10-03, after 12 s:
//   Node 24.21.0  SELF=1 N=1: elu 0.00             rss  59 MB
//   Node 24.21.0  SELF=1 N=2: elu 0.42 0.42        rss  71 MB
//   Node 24.21.0  SELF=1 N=3: elu 1.00 1.00 1.00   rss 825 MB (and climbing)
//   Node 26.10.0  SELF=1 N=3: elu 0.00 0.00 0.00   rss  62 MB
import { Worker, isMainThread, workerData } from 'node:worker_threads';
if (isMainThread) {
  const n = Number(process.env.N ?? 3);
  const ws = Array.from({ length: n }, (_, i) => new Worker(new URL(import.meta.url), { workerData: { i } }));
  const last = new Map();
  for (let k = 0; k < 6; k++) {
    await new Promise((r) => setTimeout(r, 2000));
    const elu = ws.map((w) => { const now = w.performance.eventLoopUtilization(); const u = last.has(w) ? w.performance.eventLoopUtilization(now, last.get(w)).utilization : now.utilization; last.set(w, now); return u.toFixed(2); });
    console.log(process.version, 'rss', Math.round(process.memoryUsage().rss / 2 ** 20), 'elu', elu.join(' '));
  }
  process.exit(0);
} else {
  const { i } = workerData;
  navigator.locks.request(`leader-${i}`, () => new Promise(() => {}));
  if (process.env.PENDING) navigator.locks.request(`leader-${(i + 1) % 3}`, () => {});
  if (process.env.SELF) navigator.locks.request(`leader-${i}`, () => {});
  setInterval(() => {}, 1 << 30);
}
