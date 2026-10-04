/**
 * `sim.*` (SUITE_SPEC §1.9). `sim.run` is a read command that starts a job: the nominal run, then the uncertainty
 * ensemble, with the same profile the Simulator screen uses (`simulatorProfileNow`). Its derived writes (the inputs of
 * the last run) are not user edits. `sim.whatIf` / `sim.compare` run variants of a scenario's schedule and persist
 * nothing.
 */
import type { SimulationResult } from '@/engine';
import { METRIC_IDS } from '@/engine/types/metrics';
import * as sched from '@/state/internal/schedule';
import * as sim from '@/state/internal/simulation';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import './safety'; // registers the safety gates this domain declares
import { ALL, UNDO, stub } from './_shared';
import { ScheduleOp } from '../schema/scheduleOp';

const r2 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

function metricsOf(values: Partial<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of METRIC_IDS) {
    const v = r2(values[id]);
    if (v !== null) out[id] = v;
  }
  return out;
}

export const SimSummary = T.Object({
  scenarioId: T.String(),
  status: T.String(),
  hash: T.Nullable(T.String()),
  days: T.Integer(),
  initial: T.Record(T.Number(), { description: 'Metric values at day 0 (engine units: kg, %, mmol/L …).' }),
  final: T.Record(T.Number(), { description: 'Metric values on the last day.' }),
  warnings: T.Array(T.Object({ id: T.String(), severity: T.String(), startDay: T.Integer(), endDay: T.Integer(), message: T.String() })),
});

function summarize(scenarioId: string, result: SimulationResult | null, status: string, hash: string | null) {
  return {
    scenarioId,
    status,
    hash,
    days: result?.meta ? Number((result.meta as { nDays?: number }).nDays ?? 0) : 0,
    initial: metricsOf(result?.initial ?? {}),
    final: metricsOf(result?.final ?? {}),
    warnings: (result?.warnings ?? []).map((w) => ({ id: String(w.id), severity: String(w.severity), startDay: w.startDay, endDay: w.endDay, message: w.message })),
  };
}

export const simRun = defineCommand({
  id: 'sim.run',
  version: 1,
  title: 'Run the simulation',
  description:
    'Simulate a scenario day by day with the body profile and safety settings, then its uncertainty band (draws: 0, 16 or 32 parameter draws; default by device). Returns a job; the result summarises day-0 and last-day values of every metric and the warnings with their day ranges.',
  input: T.Object({
    scenarioId: T.Optional(T.String({ minLength: 1 })),
    planId: T.Optional(T.String({ minLength: 1 })),
    draws: T.Optional(T.NumberEnum([0, 16, 32])),
  }),
  output: SimSummary,
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'natural',
  longRunning: { kind: 'job', softTimeoutMs: 25_000 },
  sideEffects: ['engine'],
  safety: ['screeningReady'],
  execute: (ctx, input) => {
    if (input.planId) fail('precondition_failed', 'Plans are not available in this version yet.', { precondition: 'activePlan' });
    const sid = input.scenarioId ?? sched.activeId() ?? fail('invalid_input', 'Name a scenario.', { path: '/scenarioId' });
    const sc = sched.scenarioById(sid) ?? fail('not_found', 'That scenario does not exist.', { path: '/scenarioId' });
    const profile = simulatorProfileNow(ctx.now);
    const done = sim.run(sid, profile, sc.schedule, input.draws !== undefined ? { draws: input.draws } : {});
    const job = ctx.jobs.start(
      'sim',
      async () => {
        await done;
        const run = sim.runOf(sid);
        return summarize(sid, run?.result ?? null, run?.status ?? 'idle', run?.resultHash ?? null);
      },
      { onCancel: () => void sim.cancel(sid) },
    );
    sim.setRunJob(sid, job.jobId);
    return job;
  },
});

export const simSeries = defineCommand({
  id: 'sim.series',
  version: 1,
  title: 'Read simulated series',
  description:
    'Daily (or weekly mean) values of simulated series from the last run of a scenario, e.g. series ["weight", "fatMass"], days from..to (inclusive). Values in engine units, rounded. Run sim.run first.',
  input: T.Object({
    source: T.Object({ scenarioId: T.String({ minLength: 1 }) }),
    series: T.Array(T.String({ minLength: 1 }), { minItems: 1, maxItems: 12 }),
    from: T.Optional(T.Integer({ minimum: 0 })),
    to: T.Optional(T.Integer({ minimum: 0 })),
    resolution: T.Enum(['day', 'week']),
  }),
  output: T.Object({ days: T.Array(T.Integer()), series: T.Record(T.Array(T.Nullable(T.Number()))), missing: T.Array(T.String()) }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the Results screen reads the simulation projection' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: (_ctx, input) => {
    const result = sim.runOf(input.source.scenarioId)?.result;
    if (!result) fail('precondition_failed', 'There is no simulation result yet: run the simulation first.', { precondition: 'scenarioExists', allowedAlternatives: ['sim.run'] });
    const daily = result.daily as Record<string, Float32Array | undefined>;
    const n = Object.values(daily).find((a) => a)?.length ?? 0;
    const from = Math.min(input.from ?? 0, Math.max(0, n - 1));
    const to = Math.min(input.to ?? n - 1, n - 1);
    const days: number[] = [];
    const series: Record<string, Array<number | null>> = {};
    const missing: string[] = [];
    const step = input.resolution === 'week' ? 7 : 1;
    for (let d = from; d <= to; d += step) days.push(d);
    for (const id of input.series) {
      const arr = daily[id];
      if (!arr) {
        missing.push(id);
        continue;
      }
      series[id] = days.map((d) => {
        if (step === 1) return r2(arr[d]);
        let sum = 0;
        let k = 0;
        for (let i = d; i < Math.min(d + 7, to + 1); i++) {
          if (!Number.isFinite(arr[i]!)) continue;
          sum += arr[i]!;
          k++;
        }
        return k ? r2(sum / k) : null;
      });
    }
    return { days, series, missing };
  },
});

const WhatIfInput = T.Object({ base: T.Object({ scenarioId: T.String({ minLength: 1 }) }), variants: T.Array(T.Array(ScheduleOp, { maxItems: 20 }), { minItems: 1, maxItems: 4 }) });
const WhatIfResult = T.Object({
  base: T.Object({ final: T.Record(T.Number()), warnings: T.Array(T.String()) }),
  variants: T.Array(T.Object({ final: T.Record(T.Number()), deltas: T.Record(T.Number()), newWarnings: T.Array(T.String()) })),
});

function whatIf(kind: 'whatIf' | 'compare') {
  return (ctx: Parameters<typeof simRun.execute>[0], input: { base: { scenarioId: string }; variants: unknown[][] }) => {
    const sc = sched.scenarioById(input.base.scenarioId) ?? fail('not_found', 'That scenario does not exist.', { path: '/base/scenarioId' });
    const profile = simulatorProfileNow(ctx.now);
    const schedules = input.variants.map((ops) => sched.applyOpsToSchedule(sc, ops as never));
    return ctx.jobs.start('whatIf', async (job) => {
      const base = await sim.simulateOnce(profile, sc.schedule);
      job.progress(1 / (schedules.length + 1), kind);
      const baseFinal = metricsOf(base.final);
      const baseWarnings = new Set(base.warnings.map((w) => String(w.id)));
      const variants = [];
      for (const [i, s] of schedules.entries()) {
        const r = await sim.simulateOnce(profile, s);
        job.progress((i + 2) / (schedules.length + 1), kind);
        const final = metricsOf(r.final);
        const deltas: Record<string, number> = {};
        for (const [k, v] of Object.entries(final)) if (baseFinal[k] !== undefined) deltas[k] = Math.round((v - baseFinal[k]!) * 100) / 100;
        variants.push({ final, deltas, newWarnings: r.warnings.map((w) => String(w.id)).filter((id) => !baseWarnings.has(id)) });
      }
      return { base: { final: baseFinal, warnings: [...baseWarnings] }, variants };
    });
  };
}

export const simWhatIf = defineCommand({
  id: 'sim.whatIf',
  version: 1,
  title: 'What if…',
  description:
    'Simulate up to four variants of a scenario (each a list of schedule ops applied to a copy) and report how the last-day values move against the base, plus warnings that only the variant raises. Nothing is saved.',
  input: WhatIfInput,
  output: WhatIfResult,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'no what-if screen yet (Living mode, E13)' },
  undo: UNDO.none,
  idempotency: 'natural',
  longRunning: { kind: 'job', softTimeoutMs: 25_000 },
  sideEffects: ['engine'],
  safety: ['screeningReady'],
  execute: (ctx, input) => whatIf('whatIf')(ctx, input as never),
});

export const simCompare = defineCommand({
  id: 'sim.compare',
  version: 1,
  title: 'Compare variants',
  description: 'Side-by-side last-day values of a scenario and up to four variants (lists of schedule ops on a copy). Nothing is saved.',
  input: WhatIfInput,
  output: WhatIfResult,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'no what-if screen yet (Living mode, E13)' },
  undo: UNDO.none,
  idempotency: 'natural',
  longRunning: { kind: 'job', softTimeoutMs: 25_000 },
  sideEffects: ['engine'],
  safety: ['screeningReady'],
  execute: (ctx, input) => whatIf('compare')(ctx, input as never),
});

export const simExplain = stub({
  id: 'sim.explain',
  title: 'Explain a simulated change',
  description: 'Why a metric moved ("why did the scale move"): the breakdown of a simulated change on a day into its drivers.',
  input: T.Object({ source: T.Object({ scenarioId: T.String({ minLength: 1 }) }), metric: T.String({ minLength: 1 }), day: T.Optional(T.Integer({ minimum: 0 })) }),
  perm: 'read',
  owner: 'E13 (results breakdown as a headless function)',
});

declare module '../types' {
  interface CommandMap {
    'sim.run': typeof simRun;
    'sim.series': typeof simSeries;
    'sim.whatIf': typeof simWhatIf;
    'sim.compare': typeof simCompare;
  }
}
