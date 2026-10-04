/**
 * Worker-thread entry of the planner benchmark (bundled by `bundle.ts`). Two roles:
 *
 * - 'evaluator': serves evaluation ports with the browser pool code (`attachEvaluator` of `src/workers/planner.pool.ts`):
 *   each port holds one `EvaluatorHost`, exactly as an evaluator worker in the app.
 * - 'job': the coordinator side. Holds one `EvaluatorPort` per evaluator worker, turns them into a pooled evaluator
 *   (`workerCallsFor` + `createPooledEvaluator`, as the engine worker does) and runs benchmark jobs (`../jobs.ts`) and
 *   performance jobs (`../perf.ts`).
 */
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { EvaluatorPort, attachEvaluator, workerCallsFor, type PortLike } from '../../../../workers/planner.pool';
import { createPooledEvaluator } from '../../optim/pipeline';
import type { HostInit } from '../../domain/evaluatorHost';
import { runJob, type JobEnv } from '../jobs';
import { runPerf, type PerfJob } from '../perf';
import type { Job } from '../types';

type InMessage = { type: 'port'; port: MessagePort } | { type: 'ports'; ports: MessagePort[] } | { type: 'job'; job: Job | PerfJob };

const role = (workerData as { role: 'evaluator' | 'job' }).role;
const parent = parentPort!;
const now = () => performance.now();

if (role === 'evaluator') {
  parent.on('message', (m: InMessage) => {
    if (m.type === 'port') attachEvaluator(m.port as unknown as PortLike, now);
  });
} else {
  let ports: EvaluatorPort[] = [];
  let calls: ReturnType<typeof workerCallsFor> | null = null;
  let current = '';
  const initAll = async (init: HostInit) => {
    const key = JSON.stringify(init);
    if (key !== current) {
      await Promise.all(ports.map((p) => p.init(init)));
      current = key;
    }
  };
  const env: JobEnv = {
    now,
    evaluatorFor: async (init: HostInit) => {
      await initAll(init);
      return createPooledEvaluator(calls!({ kind: 'main' }));
    },
  };
  parent.on('message', (m: InMessage) => {
    if (m.type === 'ports') {
      ports = m.ports.map((p) => new EvaluatorPort(p as unknown as PortLike));
      calls = workerCallsFor(ports);
      return;
    }
    if (m.type !== 'job') return;
    const job = m.job;
    const run: Promise<unknown> =
      job.kind === 'perf'
        ? runPerf(
            job,
            {
              count: ports.length,
              init: async (init) => {
                current = '';
                await initAll(init);
              },
              calls: (v) => calls!(v),
              bands: (option, v, structure, x, draws, series, drawBase) => ports[option % ports.length]!.bands(v, structure, x, draws, series, drawBase),
              env,
            },
            now,
          ).then((result) => ({ kind: 'perf', id: job.id, result }))
        : runJob(job, env);
    run.then(
      (result) => parent.postMessage({ type: 'done', id: job.id, result }),
      (e: unknown) => parent.postMessage({ type: 'error', id: job.id, message: e instanceof Error ? (e.stack ?? e.message) : String(e) }),
    );
  });
}
