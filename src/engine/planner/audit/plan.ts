/**
 * Planner runs of the slow audit (`pnpm audit:planner`; PLANNER_V2_SPEC §6.3 checks 1c and 5), split into parts that
 * vitest runs in parallel processes. Every part builds the same deterministic job list and runs the jobs whose index falls
 * to it; results go to a cache directory and `report.audit.ts` merges them.
 *
 *  1c  dynamic reachability: for each usable lever with an edge that helps a ranked goal of some corpus request, the
 *      final plans (options and the best plan of each structure family) of that request hold a safe plan using the lever,
 *      or the explanation names the lever as considered and rejected with its numbers (a contribution, a fasting rival);
 *  5   gate cost: each switchable gate of kind evidence, feasibility or user limit is removed in turn and the requests
 *      where it removes something are re-planned at tier S; a safe plan that improves a ranked goal by more than its
 *      tolerance δ_k flags the gate for review, with the numbers. Safety and consent gates are never relaxed (owner
 *      assumption): the audit reports what they remove from the structure set, without re-planning.
 */
import type { MetricId } from '../../types/metrics';
import { compileRequest } from '../domain/context';
import { EVIDENCE_EDGES } from '../domain/evidenceGraph';
import { GATES, SWITCHABLE_GATES, withGatesDisabled, withGatesDisabledSync } from '../domain/gates';
import { LEVER_INDEX } from '../domain/registry/levers';
import { runDomainPlanner } from '../domain/planner';
import { enumerateStructures, type SkeletonStructure } from '../domain/skeleton';
import type { PlannerRequest, PlannerResult } from '../domain/types';
import type { PlannerResult as OptimResult } from '../optim/pipeline';
import { coverageCorpus, type CorpusEntry } from './corpus';
import { auditedLevers, structureLevers } from './static';

/** Tier and budget of every audit planner run. */
export const AUDIT_RUN = { tier: 'S' as const, totalEU: 1500 };
/** Default priority tolerances δ_k (goal 1, 2, 3+; balanced strictness). */
export const DELTA = [0.05, 0.1, 0.15] as const;
/** Levers 1c does not run: outside the grammar (L2, L6) or applied by construction (L19). */
export const NOT_DYNAMIC = new Set(['L2', 'L6', 'L19']);

export interface Job {
  key: string;
  requestId: string;
  /** Gate switched off for this run (null = the baseline). */
  gate: string | null;
}

export interface JobPlan {
  jobs: Job[];
  /** 1c: lever → corpus requests where an edge says it helps a ranked goal and the grammar reaches it. */
  leverRequests: Record<string, string[]>;
  /** 5: gate → active corpus requests (the gate removes structures or changes the fasting gate there). */
  gateRequests: Record<string, string[]>;
  /** Safety and consent gates: structures they remove on the corpus (summed), not re-planned. */
  safetyRemoves: Record<string, number>;
}

const goalWants = (g: PlannerRequest['goals'][number], startEstimate: number): 1 | -1 => {
  if (g.direction === 'maximise') return 1;
  if (g.direction === 'minimise') return -1;
  const target = g.targetKind === 'change' ? (g.target ?? 0) : (g.target ?? startEstimate) - startEstimate;
  return target >= 0 ? 1 : -1;
};

/** Does an edge from `lever` help one of the request's ranked goals (sign in the goal's direction, or condition-dependent)? */
export function leverHelps(lever: string, req: PlannerRequest): boolean {
  const ctx = compileRequest(req);
  return ctx.goals.some((g) => {
    const want = goalWants(g.spec, g.startEstimate);
    return EVIDENCE_EDGES.some((e) => e.from.id === lever && e.metric === g.metric && e.status !== 'infoOnly' && (e.sign === 0 || e.sign === want));
  });
}

function structureIds(req: PlannerRequest, disabled: string[] = []): { ids: Set<string>; fasting: boolean } {
  return withGatesDisabledSync(
    disabled,
    () => {
      const ctx = compileRequest(req);
      return { ids: new Set(enumerateStructures(ctx, 100000).map((s) => s.id)), fasting: ctx.fastingRelevant };
    },
    { audit: true },
  );
}

/** The deterministic job list (same in every part). */
export function jobPlan(corpus: readonly CorpusEntry[] = coverageCorpus(), perLever = 1, perGate = 1): JobPlan {
  const byId = new Map(corpus.map((e) => [e.id, e]));
  const leverRequests: Record<string, string[]> = {};
  const reach = new Map<string, Set<string>>();
  const leversOf = (e: CorpusEntry) => {
    let s = reach.get(e.id);
    if (!s) {
      s = new Set<string>();
      for (const st of enumerateStructures(compileRequest(e.request))) for (const l of structureLevers(st)) s.add(l);
      reach.set(e.id, s);
    }
    return s;
  };
  for (const lever of auditedLevers()) {
    if (NOT_DYNAMIC.has(lever)) continue;
    const picks: string[] = [];
    for (const e of corpus) {
      if (picks.length >= perLever) break;
      if (leversOf(e).has(lever) && leverHelps(lever, e.request)) picks.push(e.id);
    }
    leverRequests[lever] = picks;
  }
  const gateRequests: Record<string, string[]> = {};
  const safetyRemoves: Record<string, number> = {};
  const baseIds = new Map<string, { ids: Set<string>; fasting: boolean }>();
  const base = (e: CorpusEntry) => {
    let b = baseIds.get(e.id);
    if (!b) baseIds.set(e.id, (b = structureIds(e.request)));
    return b;
  };
  // a cheap, diverse sample of the corpus for the activity scan (one request per goal list × opt-in)
  const scan = corpus.filter((e) => e.limits !== 'tight' || e.optIn === 'none');
  for (const g of GATES) {
    if (!SWITCHABLE_GATES.has(g.id)) continue;
    const isSafety = g.kind === 'safety' || g.kind === 'consent';
    const n = g.id.startsWith('fasting.') ? 2 * perGate : perGate;
    const active: string[] = [];
    let removed = 0;
    for (const e of scan) {
      if (!isSafety && active.length >= n) break;
      const b = base(e);
      const off = structureIds(e.request, [g.id]);
      const extra = [...off.ids].filter((id) => !b.ids.has(id)).length;
      if (extra > 0 || off.fasting !== b.fasting) {
        removed += extra;
        if (active.length < n) active.push(e.id);
      }
    }
    if (isSafety) safetyRemoves[g.id] = removed;
    else gateRequests[g.id] = active;
  }
  const jobs: Job[] = [];
  const seen = new Set<string>();
  const add = (requestId: string, gate: string | null) => {
    const key = `${requestId}#${gate ?? 'baseline'}`;
    if (seen.has(key) || !byId.has(requestId)) return;
    seen.add(key);
    jobs.push({ key, requestId, gate });
  };
  for (const ids of Object.values(leverRequests)) for (const id of ids) add(id, null);
  for (const [gate, ids] of Object.entries(gateRequests))
    for (const id of ids) {
      add(id, null);
      add(id, gate);
    }
  return { jobs, leverRequests, gateRequests, safetyRemoves };
}

// ---------------------------------------------------------------------------------------------------------------
// one run, summarised
// ---------------------------------------------------------------------------------------------------------------

export interface RunSummary {
  key: string;
  ms: number;
  status: PlannerResult['status'] | 'error';
  error?: string;
  fastingOffered: boolean;
  options: Array<{
    id: string;
    structureId: string;
    levers: string[];
    goals: Array<{ metric: MetricId; value: number; start: number; target: number | null; percentOfAchievable: number }>;
    contributions: Array<{ label: string; deltaGoal1Metric: number | null; safe: boolean }>;
    fasting: { used: boolean; kind: string; rival: { structureId: string; levers: string[]; reason: string; goalDeltas: Array<{ goal: number; delta: number }> } | null };
  }>;
  /** Best safe plan per structure family (the run's archive view used by 1c). */
  families: Array<{ structureId: string; levers: string[]; safe: boolean }>;
}

export async function runJob(job: Job, corpus: readonly CorpusEntry[], now: () => number): Promise<RunSummary> {
  const e = corpus.find((c) => c.id === job.requestId)!;
  const t0 = now();
  const disabled = job.gate ? [job.gate] : [];
  try {
    let raw: OptimResult<SkeletonStructure> | undefined;
    const res = await withGatesDisabled(
      disabled,
      () => runDomainPlanner({ ...e.request, seed: `audit|${e.id}` }, { ...AUDIT_RUN, timeToTarget: false, onOptimResult: (r) => (raw = r) }),
      { audit: true },
    );
    const sts = withGatesDisabledSync(disabled, () => enumerateStructures(compileRequest(e.request), 100000), { audit: true });
    const byId = new Map(sts.map((s) => [s.id, s]));
    const leversOfId = (id: string) => [...(byId.get(id) ? structureLevers(byId.get(id)!) : [])].sort();
    return {
      key: job.key,
      ms: now() - t0,
      status: res.status,
      fastingOffered: !!res.fasting?.offered,
      options: res.options.map((o, k) => {
        const sid = raw?.options[k]?.structure.id ?? '';
        const rival = o.fasting?.rival;
        return {
          id: o.id,
          structureId: sid,
          levers: leversOfId(sid),
          goals: o.scorecard.map((g) => ({ metric: g.metric, value: g.value, start: g.start, target: g.target, percentOfAchievable: g.percentOfAchievable })),
          contributions: o.contributions.map((c) => ({ label: c.label, deltaGoal1Metric: c.deltaGoal1Metric ?? null, safe: c.safe !== false })),
          fasting: {
            used: !!o.fasting?.used,
            kind: o.fasting?.kind ?? 'none',
            rival: rival ? { structureId: rival.structureId, levers: leversOfId(rival.structureId), reason: rival.reason, goalDeltas: rival.goalDeltas.map((g) => ({ goal: g.goal, delta: g.delta })) } : null,
          },
        };
      }),
      families: Object.values(raw?.groupBest ?? {}).map((g) => ({ structureId: g.structureId, levers: leversOfId(g.structureId), safe: g.vS === 0 })),
    };
  } catch (err) {
    return { key: job.key, ms: now() - t0, status: 'error', error: String((err as Error)?.message ?? err), fastingOffered: false, options: [], families: [] };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------------------------------------------

export type DynamicStatus = 'used' | 'rejectedWithNumbers' | 'missing' | 'noRequest' | 'runFailed';

/** The words the explanations use for a lever (ablation labels, fasting phrases). */
const LEVER_WORDS: Readonly<Record<string, RegExp>> = {
  refeedDay: /refeed/i,
  fastDay24: /24-hour fast|fasts?\b/i,
  waterFast: /hour fast|day fast|fasts?\b/i,
  zeroDay: /zero-energy|fasts?\b/i,
  L7: /creatine/i,
  cardio: /cardio/i,
  resistanceTraining: /resistance/i,
  L1: /steps/i,
  dietBreak: /diet break/i,
};

export function dynamicReachability(plan: JobPlan, runs: ReadonlyMap<string, RunSummary>): Record<string, { status: DynamicStatus; request: string | null; detail: string }> {
  const out: Record<string, { status: DynamicStatus; request: string | null; detail: string }> = {};
  for (const [lever, ids] of Object.entries(plan.leverRequests)) {
    if (!ids.length) {
      out[lever] = { status: 'noRequest', request: null, detail: 'no corpus request where an edge says it helps a ranked goal' };
      continue;
    }
    const id = ids[0]!;
    const r = runs.get(`${id}#baseline`);
    if (!r || r.status === 'error') {
      out[lever] = { status: 'runFailed', request: id, detail: r?.error ?? 'not run' };
      continue;
    }
    const usedBy = r.options.find((o) => o.levers.includes(lever)) ?? r.families.find((f) => f.safe && f.levers.includes(lever));
    if (usedBy) {
      out[lever] = { status: 'used', request: id, detail: `in ${'id' in usedBy ? `option ${usedBy.id}` : 'the best plan of its family'} (${usedBy.structureId})` };
      continue;
    }
    const words = LEVER_WORDS[lever] ?? new RegExp(LEVER_INDEX.get(lever)?.explain.name ?? lever, 'i');
    const contrib = r.options.flatMap((o) => o.contributions.map((c) => ({ o, c }))).find(({ c }) => words.test(c.label) && c.deltaGoal1Metric !== null);
    const rival = r.options.find((o) => o.fasting.rival && o.fasting.rival.levers.includes(lever));
    if (contrib) out[lever] = { status: 'rejectedWithNumbers', request: id, detail: `option ${contrib.o.id}: "${contrib.c.label}" changes goal 1 by ${contrib.c.deltaGoal1Metric}` };
    else if (rival) out[lever] = { status: 'rejectedWithNumbers', request: id, detail: `option ${rival.id}: the plan with it (${rival.fasting.rival!.structureId}) lost (${rival.fasting.rival!.reason})` };
    else out[lever] = { status: 'missing', request: id, detail: `no final plan uses it and no explanation names it (options ${r.options.map((o) => o.structureId).join(', ')})` };
  }
  return out;
}

export interface GateCost {
  gate: string;
  kind: string;
  requests: number;
  flagged: boolean;
  /** Largest improvement of a ranked goal without the gate, in units of that goal's tolerance δ_k. */
  worst: { request: string; goal: number; metric: string; gain: number; delta: number; with: number; without: number } | null;
  note: string;
}

function scaleOf(g: RunSummary['options'][number]['goals'][number]): number {
  if (g.target !== null && Math.abs(g.target - g.start) > 1e-9) return Math.abs(g.target - g.start);
  const p = g.percentOfAchievable / 100;
  if (Math.abs(p) > 0.01) return Math.abs(g.value - g.start) / Math.abs(p);
  return Math.max(Math.abs(g.start) * 0.05, 1e-6);
}

export function gateCosts(plan: JobPlan, runs: ReadonlyMap<string, RunSummary>, corpus: readonly CorpusEntry[]): GateCost[] {
  const out: GateCost[] = [];
  for (const g of GATES) {
    if (!SWITCHABLE_GATES.has(g.id)) {
      out.push({ gate: g.id, kind: g.kind, requests: 0, flagged: false, worst: null, note: 'decoder clamp: registered, not switchable' });
      continue;
    }
    if (g.kind === 'safety' || g.kind === 'consent') {
      out.push({ gate: g.id, kind: g.kind, requests: 0, flagged: false, worst: null, note: `kept by design; removes ${plan.safetyRemoves[g.id] ?? 0} structures over the corpus scan` });
      continue;
    }
    const ids = plan.gateRequests[g.id] ?? [];
    if (!ids.length) {
      out.push({ gate: g.id, kind: g.kind, requests: 0, flagged: false, worst: null, note: 'removes nothing on the corpus' });
      continue;
    }
    let worst: GateCost['worst'] = null;
    let failed = 0;
    for (const id of ids) {
      const on = runs.get(`${id}#baseline`);
      const off = runs.get(`${id}#${g.id}`);
      if (!on || !off || on.status === 'error' || off.status === 'error') {
        failed++;
        continue;
      }
      const a = on.options[0];
      const b = off.status === 'ok' ? off.options[0] : undefined;
      if (!a || !b) continue;
      const req = corpus.find((c) => c.id === id)!.request;
      a.goals.forEach((ga, k) => {
        const gb = b.goals[k];
        if (!gb) return;
        const want = goalWants(req.goals[k]!, ga.start);
        const gain = (want * (gb.value - ga.value)) / scaleOf(ga);
        const delta = DELTA[Math.min(k, DELTA.length - 1)]!;
        if (!worst || gain / delta > worst.gain / worst.delta) worst = { request: id, goal: k, metric: ga.metric, gain, delta, with: ga.value, without: gb.value };
      });
    }
    const w = worst as GateCost['worst'];
    out.push({ gate: g.id, kind: g.kind, requests: ids.length, flagged: !!w && w.gain > w.delta, worst: w, note: failed ? `${failed} run(s) failed` : '' });
  }
  return out;
}
