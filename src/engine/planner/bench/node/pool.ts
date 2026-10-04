/**
 * Thread pool of the planner benchmark (main side): E evaluator workers serving the browser pool protocol and J job
 * workers (coordinators). Every job worker holds one port to every evaluator worker, so concurrent runs share the
 * evaluators the way one app run shares its pool; jobs are handed out as job workers become free.
 */
import { MessageChannel, Worker } from 'node:worker_threads';
import type { Job, JobResult } from '../types';

export interface BenchPool {
  evaluators: number;
  jobs: number;
  run(jobs: readonly Job[], onResult: (r: JobResult, done: number, total: number) => void, onError?: (job: Job, message: string) => void): Promise<void>;
  close(): Promise<void>;
}

export async function startPool(bundle: string, opts: { evaluators: number; jobs: number }): Promise<BenchPool> {
  const evalWorkers = Array.from({ length: opts.evaluators }, () => new Worker(bundle, { workerData: { role: 'evaluator' } }));
  const jobWorkers = Array.from({ length: opts.jobs }, () => new Worker(bundle, { workerData: { role: 'job' } }));
  for (const jw of jobWorkers) {
    const ports = evalWorkers.map((ew) => {
      const ch = new MessageChannel();
      ew.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
      return ch.port2;
    });
    jw.postMessage({ type: 'ports', ports }, ports);
  }
  const fatal: Error[] = [];
  for (const w of [...evalWorkers, ...jobWorkers]) w.on('error', (e: Error) => fatal.push(e));
  return {
    evaluators: opts.evaluators,
    jobs: opts.jobs,
    run: (jobs, onResult, onError) =>
      new Promise<void>((resolve, reject) => {
        let next = 0;
        let done = 0;
        if (!jobs.length) return resolve();
        const feed = (w: Worker) => {
          if (fatal.length) return reject(fatal[0]);
          if (next >= jobs.length) return;
          const job = jobs[next++]!;
          const onMsg = (m: { type: 'done'; id: number; result: JobResult } | { type: 'error'; id: number; message: string }) => {
            if (m.id !== job.id) return;
            w.off('message', onMsg);
            done++;
            if (m.type === 'done') onResult(m.result, done, jobs.length);
            else onError?.(job, m.message);
            if (done === jobs.length) resolve();
            else feed(w);
          };
          w.on('message', onMsg);
          w.postMessage({ type: 'job', job });
        };
        for (const w of jobWorkers) feed(w);
      }),
    close: async () => {
      await Promise.all([...evalWorkers, ...jobWorkers].map((w) => w.terminate()));
    },
  };
}
