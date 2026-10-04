/** `job.*` (SUITE_SPEC §1.7). */
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';

/* ---------------------------------------------------------------- jobs */

const JobStatusView = T.Object({
  jobId: T.String(),
  state: T.Enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  progress: T.Number({ minimum: 0, maximum: 1 }),
  stage: T.Optional(T.String()),
  etaMs: T.Optional(T.Number()),
  partial: T.Optional(T.Unknown()),
  resultRef: T.Optional(T.String()),
  error: T.Optional(T.OpenObject()),
});
const JobIn = T.Object({ jobId: T.String({ minLength: 1 }) });

export const jobStatus = defineCommand({
  id: 'job.status',
  version: 1,
  title: 'Job status',
  description: 'State (queued, running, done, failed, cancelled), progress 0–1 and stage of a long-running job (simulation, Planner, what-if).',
  input: JobIn,
  output: JobStatusView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'screens follow runs through the projections' },
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: [],
  execute: (ctx, input) => (ctx.jobs.status(input.jobId) as never) ?? fail('not_found', 'No such job.'),
});

export const jobResult = defineCommand({
  id: 'job.result',
  version: 1,
  title: 'Job result',
  description: 'The result of a finished job (the output its command describes), with its status.',
  input: JobIn,
  output: T.Object({ status: JobStatusView, result: T.Unknown() }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'screens follow runs through the projections' },
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: [],
  execute: (ctx, input) => {
    const status = ctx.jobs.status(input.jobId) ?? fail('not_found', 'No such job.');
    return { status: status as never, result: ctx.jobs.result(input.jobId) ?? null };
  },
});

export const jobCancel = defineCommand({
  id: 'job.cancel',
  version: 1,
  title: 'Cancel a job',
  description: 'Stop a running job now (a simulation or Planner run): nothing it was computing is kept.',
  input: JobIn,
  output: T.Object({ cancelled: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['engine', 'planner'],
  execute: (ctx, input) => ({ cancelled: ctx.jobs.cancel(input.jobId) }),
});

declare module '../types' {
  interface CommandMap {
    'job.status': typeof jobStatus;
    'job.result': typeof jobResult;
    'job.cancel': typeof jobCancel;
  }
}
