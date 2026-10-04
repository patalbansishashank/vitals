/**
 * In-memory job runner (SUITE_SPEC §1.7). Long-running commands (`sim.run`, `planner.find`, `sim.whatIf`) start a job
 * and return a `JobRef`; `job.status` / `job.result` / `job.cancel` read and stop it. Job writes to projections run in
 * a `derive` scope (they are results, not user edits).
 */
import { ulid, type Id } from '@/store';
import { createScope, runInScope } from '@/state/scope';
import type { CommandError, JobHandle, JobRef, JobRunner, JobStatus } from './types';

interface Entry {
  ref: JobRef;
  status: JobStatus;
  result: unknown;
  controller: AbortController;
  onCancel?: () => void;
  settled: Promise<JobStatus>;
}

type Listener = (s: JobStatus) => void;

export function createJobRunner(onStatus?: Listener): JobRunner {
  const jobs = new Map<Id, Entry>();
  const KEEP = 50;

  const publish = (e: Entry) => onStatus?.({ ...e.status });

  const prune = () => {
    if (jobs.size <= KEEP) return;
    for (const [id, e] of jobs) {
      if (jobs.size <= KEEP) break;
      if (e.status.state !== 'running' && e.status.state !== 'queued') jobs.delete(id);
    }
  };

  const runner: JobRunner = {
    start(kind, run, options = {}) {
      const jobId = options.id ?? ulid();
      const ref: JobRef = { jobId, kind, startedAt: new Date().toISOString() };
      const controller = new AbortController();
      const status: JobStatus = { jobId, state: 'running', progress: 0 };
      const scope = createScope('derive', { label: `job ${kind}` });
      let resolveSettled!: (s: JobStatus) => void;
      const entry: Entry = {
        ref,
        status,
        result: undefined,
        controller,
        onCancel: options.onCancel,
        settled: new Promise<JobStatus>((r) => (resolveSettled = r)),
      };
      jobs.set(jobId, entry);
      prune();
      const handle: JobHandle = {
        jobId,
        signal: controller.signal,
        progress(p, stage, partial) {
          if (entry.status.state !== 'running') return;
          entry.status = { ...entry.status, progress: Math.max(0, Math.min(1, p)), ...(stage ? { stage } : {}), ...(partial !== undefined ? { partial } : {}) };
          publish(entry);
        },
        write: (fn) => runInScope(scope, fn),
      };
      publish(entry);
      void Promise.resolve()
        .then(() => run(handle))
        .then(
          (result) => {
            if (entry.status.state === 'cancelled') return;
            entry.result = result;
            entry.status = { ...entry.status, state: 'done', progress: 1 };
          },
          (e: unknown) => {
            if (entry.status.state === 'cancelled') return;
            const aborted = controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
            const error: CommandError = { code: aborted ? 'cancelled' : 'internal', message: e instanceof Error ? e.message : String(e) };
            entry.status = { ...entry.status, state: aborted ? 'cancelled' : 'failed', error };
          },
        )
        .finally(() => {
          publish(entry);
          resolveSettled({ ...entry.status });
        });
      return ref;
    },
    status: (jobId) => {
      const e = jobs.get(jobId);
      return e ? { ...e.status } : null;
    },
    result: (jobId) => jobs.get(jobId)?.result,
    cancel(jobId) {
      const e = jobs.get(jobId);
      if (!e || (e.status.state !== 'running' && e.status.state !== 'queued')) return false;
      e.status = { ...e.status, state: 'cancelled' };
      e.controller.abort();
      e.onCancel?.();
      publish(e);
      return true;
    },
    wait: (jobId) => jobs.get(jobId)?.settled ?? Promise.resolve({ jobId, state: 'failed', progress: 0, error: { code: 'not_found', message: 'No such job.' } }),
    list: () => Array.from(jobs.values(), (e) => ({ ...e.status })),
  };
  return runner;
}
