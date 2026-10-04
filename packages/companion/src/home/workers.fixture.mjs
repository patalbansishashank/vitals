// A stand-in person worker for workers.test.ts: the same message protocol as personWorkerEntry.ts, no store.
// dispatch 'test.hog' allocates until the heap limit ends the worker; 'test.spin' blocks the thread for `input.ms`.
import { parentPort, workerData } from 'node:worker_threads';

const port = parentPort;
const hoard = [];
let queue = Promise.resolve();
port.on('message', (m) => {
  // diagnostics are answered at once, outside the queue, as in personWorkerEntry.ts
  if ('diag' in m) return port.postMessage({ id: m.id, diag: { waiting: 0 } });
  queue = queue.then(async () => {
    if ('close' in m) {
      port.postMessage({ id: m.id, res: { ok: true, value: null } });
      port.close();
      return;
    }
    port.postMessage({ id: m.id, started: true });
    const { req } = m;
    if (req.op === 'dispatch' && req.command === 'test.hog') for (;;) hoard.push(new Array(1e5).fill({ x: Math.random() }));
    if (req.op === 'dispatch' && req.command === 'test.spin') {
      const until = Date.now() + req.input.ms;
      while (Date.now() < until);
    }
    if (req.op === 'dispatch' && req.command === 'test.wait') await new Promise((r) => setTimeout(r, req.input.ms));
    port.postMessage({ id: m.id, res: { ok: true, value: { personId: workerData.init.personId, op: req.op } } });
  });
});
port.postMessage({ ready: true });
