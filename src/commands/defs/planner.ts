/**
 * `planner.*` (SUITE_SPEC §1.9). The optimiser runs as a job through the Planner port (the Planner feature installs
 * the request builder and the worker pool); progress, result and failure are written to the planner projection as
 * derived results. `planner.stop` is the cooperative stop (keeps what was found); `job.cancel` is the hard stop.
 */
import type { PlannerProgressInfo, PlannerRequest, PlannerResult } from '@/engine/planner/domain/types';
import * as planner from '@/state/internal/planner';
import * as sched from '@/state/internal/schedule';
import { defineCommand, fail } from '../registry';
import { registerPrecondition } from '../gates';
import { appDay } from '@/living/appDay'; // E20: markers
import { markerRuleContext } from '@/markers/context'; // E20: markers
import { blockingReasks, evaluateMarkers } from '@/markers/rules'; // E20: markers
import { readMarkerContextSources } from '@/markers/ui/contextSources'; // E20: markers
import { metaOf } from '@/markers/table'; // E20: markers
import { reaskMessage, screeningAnsweredOn } from '@/markers/ui/request'; // E20: markers
import { readMarkersDoc } from '@/markers/ui/useMarkers'; // E20: markers
import { safetyAccessNow, safetyValues } from '@/state/internal/safety'; // E20: markers
import { simulatorProfileNow } from '@/state/internal/simulatorProfile'; // E20: markers
import { T } from '../schema';
import './safety'; // registers the safety gates this domain declares
import type { CommandContext } from '../types';
import { ALL, UNDO } from './_shared';

// E20: markers — a blood result that re-asks a safety question (diabetes, kidney, gout, food allergy) pauses the search
// until the safety questions are answered again (SUITE_SPEC §13.5.3; it asks, it does not refuse).
export function pendingMarkerReask(nowIso: string = new Date().toISOString()): { about: string; markerId: string } | null {
  const doc = readMarkersDoc();
  if (doc.readings.length === 0) return null;
  const profile = simulatorProfileNow(nowIso);
  const ctx = markerRuleContext({ profile, flags: safetyAccessNow(nowIso).outcome.flags, ...readMarkerContextSources() }, appDay(new Date(nowIso)));
  return blockingReasks(evaluateMarkers(doc, ctx), screeningAnsweredOn(safetyValues().answeredAt))[0] ?? null;
}
registerPrecondition('markerReask', () => {
  const q = pendingMarkerReask();
  return q ? reaskMessage(q.about, metaOf(q.markerId as never)?.label) : null;
});

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Current {
  jobId: string;
  stop: AbortController;
  hard: boolean;
}
let current: Current | null = null;

export const PlannerRunSummary = T.Object({
  status: T.String({ description: 'idle | running | stopping | done | failed | cancelled' }),
  resultStatus: T.Nullable(T.String()),
  complete: T.Nullable(T.Boolean()),
  options: T.Array(T.Object({ id: T.String(), name: T.String(), utility: T.Number(), explanation: T.Array(T.String()), safetyNotes: T.Array(T.String()) })),
  message: T.Nullable(T.String()),
  relations: T.Array(T.String()),
  ladder: T.Optional(
    T.Nullable(
      T.Object({
        tier: T.String({ description: 'S quick | M standard | L thorough | X exhaustive' }),
        rungs: T.Array(T.Object({ kind: T.String(), title: T.String(), effort: T.Number(), burdens: T.Array(T.Object({ id: T.String(), value: T.Number(), active: T.Boolean() })) })),
        collapsed: T.Array(T.Object({ rung: T.String(), reason: T.String(), text: T.String(), carried: T.Boolean() })),
        ideal: T.Nullable(T.Object({ sameAsHard: T.Boolean(), effort: T.Number(), burdens: T.Array(T.Object({ id: T.String(), value: T.Number(), active: T.Boolean() })) })),
        convergencePoints: T.Number(),
        idealSkipped: T.Optional(T.String({ description: "Why there is no Ideal: 'stopped' (the search was stopped before the Ideal stage)." })),
        keptAfterStop: T.Optional(T.String({ description: "Tier of a longer search that was stopped with a result worse than or less complete than this ladder; this is the earlier search's ladder, kept." })),
      }, { description: 'The plan ladder: Hard, Medium, Easy present, the rungs it did not keep with the reason shown, the Ideal, and the search tier.' }),
    ),
  ),
});

type DifficultyLike = { D: number; components: Array<{ id: string; value: number; active: boolean }> };
const burdens = (d: DifficultyLike) => d.components.map((c) => ({ id: c.id, value: Math.round(c.value * 1000) / 1000, active: c.active }));

/** The ladder view of a v2 result (plan 02 item 10: every level shown or its reason stated; QA reads it). */
export function ladderSummary(r: PlannerResult | null) {
  const v2 = r?.v2;
  if (!v2) return null;
  const ideal = v2.ideal;
  const same = !!ideal && !!v2.rungs.hard && (ideal.sameAsHard ? true : ideal.sameAsHard === undefined && !!ideal.nothingBinds);
  return {
    tier: v2.provenance.tier,
    rungs: (['hard', 'medium', 'easy'] as const).flatMap((k) => {
      const p = v2.rungs[k];
      return p ? [{ kind: k, title: p.summary.title, effort: Math.round(p.summary.difficulty.D * 100), burdens: burdens(p.summary.difficulty) }] : [];
    }),
    collapsed: v2.ladder.collapsed.map((c) => ({ rung: c.rung, reason: c.reason, text: c.text, carried: !!c.carried })),
    ideal: ideal ? { sameAsHard: same, effort: Math.round(ideal.summary.difficulty.D * 100), burdens: burdens(ideal.summary.difficulty) } : null,
    convergencePoints: v2.convergence?.length ?? 0,
    ...(v2.idealSkipped ? { idealSkipped: v2.idealSkipped } : {}),
    ...(v2.keptAfterStop ? { keptAfterStop: v2.keptAfterStop.tier } : {}),
  };
}

function runSummary() {
  const run = planner.runState();
  const r = run.result;
  return {
    status: run.status,
    resultStatus: r?.status ?? null,
    complete: r ? r.complete : null,
    options: (r?.options ?? []).map((o) => ({ id: o.id, name: o.name, utility: Math.round(o.utility * 1000) / 1000, explanation: o.explanation, safetyNotes: o.safetyNotes })),
    message: r?.message ?? run.error ?? null,
    relations: r?.relations ?? [],
    ladder: ladderSummary(r ?? null),
  };
}

const isAbort = (e: unknown) => (e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && e.name === 'AbortError');

function startRun(ctx: CommandContext) {
  const port = ctx.ports.planner ?? fail('precondition_failed', 'Open the Planner to find plans.', { retryable: true });
  const s = planner.runState().status;
  if (s === 'running' || s === 'stopping') fail('busy', 'The Planner is already running.', { retryable: true });
  const prepared = port.prepare() ?? fail('precondition_failed', 'Add a goal the Planner can work on first.');
  planner.runStarted(prepared.hash, prepared.request as PlannerRequest, clock());
  const stop = new AbortController();
  const entry: Current = { jobId: '', stop, hard: false };
  const job = ctx.jobs.start(
    'planner',
    async (handle) => {
      try {
        const result = (await port.run(prepared.request, {
          signal: stop.signal,
          onProgress: (p) => {
            if (current === entry) handle.write(() => planner.runProgress(p as PlannerProgressInfo));
          },
        })) as PlannerResult;
        if (current === entry) handle.write(() => (entry.hard ? planner.runCancelled(clock()) : planner.runFinished(result, clock())));
        return runSummary();
      } catch (e) {
        if (current === entry) {
          if (entry.hard || isAbort(e)) handle.write(() => planner.runCancelled(clock()));
          else handle.write(() => planner.runFailed(e instanceof Error ? `${e.name}: ${e.message}` : String(e), clock()));
        }
        throw e;
      } finally {
        if (current === entry) current = null;
      }
    },
    {
      onCancel: () => {
        entry.hard = true;
        port.cancel();
      },
    },
  );
  entry.jobId = job.jobId;
  current = entry;
  return job;
}

export const plannerFind = defineCommand({
  id: 'planner.find',
  version: 1,
  title: 'Find plans',
  description:
    'Run the Planner on the current goal set, limits, body profile and safety settings. Returns a job; the result lists up to three plans (A, B, C) with their explanation and safety notes. tier sets the search budget (the v0.1 search runs one budget; the tier is recorded).',
  input: T.Object({ tier: T.Enum(['S', 'M', 'L', 'X']), overrides: T.Optional(T.OpenObject({ description: 'PlannerRequestOverrides (PLANNER_V2); ignored by the v0.1 search.' })) }),
  output: PlannerRunSummary,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'key',
  longRunning: { kind: 'job', softTimeoutMs: 25_000 },
  sideEffects: ['planner', 'docs'],
  safety: ['plannerAccess'],
  preconditions: ['markerReask'], // E20: markers
  execute: (ctx) => startRun(ctx),
});

export const plannerStop = defineCommand({
  id: 'planner.stop',
  version: 1,
  title: 'Stop the Planner',
  description: 'Stop a Planner run: it finishes its current step and keeps the best plans found so far.',
  input: T.Object({}),
  output: T.Object({ stopped: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'natural',
  sideEffects: ['planner'],
  execute: () => {
    if (!current) return { stopped: false };
    planner.runStopping();
    current.stop.abort();
    return { stopped: true };
  },
});

export const plannerResult = defineCommand({
  id: 'planner.result',
  version: 1,
  title: 'Read the Planner result',
  description: 'The current Planner run: status and, when done, the plans found (A, B, C) with explanations and safety notes; message when no safe plan exists.',
  input: T.Object({ kind: T.Optional(T.String()) }),
  output: PlannerRunSummary,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: (_ctx, input) => {
    const s = runSummary();
    return input.kind ? { ...s, options: s.options.filter((o) => o.id === input.kind) } : s;
  },
});

export const plannerOpenInSimulator = defineCommand({
  id: 'planner.openInSimulator',
  version: 1,
  title: 'Open a plan in the Simulator',
  description: 'Copy a found plan (kind A, B or C) into a new Simulator scenario and make it active. The plan stays as found; undo deletes the copy.',
  input: T.Object({ kind: T.Enum(['A', 'B', 'C']), name: T.Optional(T.String({ maxLength: 120 })), provenance: T.Optional(T.String({ maxLength: 120 })) }),
  output: T.Object({ scenarioId: T.String() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.TS,
  idempotency: 'key',
  sideEffects: ['docs', 'ui'],
  execute: (_ctx, input) => {
    const option = planner.runState().result?.options.find((o) => o.id === input.kind) ?? fail('not_found', `There is no Plan ${input.kind} in the current result.`);
    const scenarioId = sched.createScenario({
      name: input.name ?? `Plan ${option.id} · ${option.name}`,
      schedule: option.schedule,
      provenance: input.provenance ?? `from Plan ${option.id}`,
      started: true,
      activate: true,
    });
    return { scenarioId };
  },
});

/** The running planner job (UI hard cancel). */
export function currentPlannerJob(): string | null {
  return current?.jobId ?? null;
}

declare module '../types' {
  interface CommandMap {
    'planner.find': typeof plannerFind;
    'planner.stop': typeof plannerStop;
    'planner.result': typeof plannerResult;
    'planner.openInSimulator': typeof plannerOpenInSimulator;
  }
}
