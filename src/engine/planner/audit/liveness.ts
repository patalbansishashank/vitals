/**
 * Mechanism liveness (PLANNER_V2_SPEC §6.3 check 2; R6 §7.2 item 2): for each `modelled` / `mapped` edge, switching its
 * source on in the probe plan moves the metric by more than the noise floor with the stated sign, and replacing the edge's
 * engine module by an inert stub removes the effect. An effect above the floor that no edge explains is reported as an
 * "undocumented mechanism".
 *
 * The reduced form (3 personas, nominal runs, a numerical floor) runs in `pnpm test`; the full form (ensemble noise floor
 * = ½ of the P10-P90 half-width of the metric on the probe's base plan) in `pnpm audit:planner`.
 */
import { buildModelParams, quantilesToParams, variableParamCount } from '../../core/paramsRegistry';
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import type { MetricId } from '../../types/metrics';
import type { SimulationResult } from '../../types/result';
import type { Schedule } from '../../types/schedule';
import { Rng, latinHypercube } from '../optim/rng';
import type { PlanningContext } from '../domain/context';
import type { EvidenceEdge } from '../domain/evidenceGraph';
import { BLOCKS, type BlockId } from '../domain/registry/blocks';
import { BLOCK_OF_FAST } from '../domain/skeleton';
import { GOAL_METRICS, metricValue, modulesWithout, probePair, type ProbePersona, type ProbeSpec } from './probes';

export type LivenessStatus = 'live' | 'weak' | 'mixed' | 'wrongSign' | 'dead' | 'notProbed';

export interface EdgeLiveness {
  edge: string;
  metric: MetricId;
  sign: 1 | -1 | 0;
  status: LivenessStatus;
  /** Toggled − base, per persona (metric units; NaN when a run failed). */
  deltas: Partial<Record<ProbePersona, number>>;
  floors: Partial<Record<ProbePersona, number>>;
  /**
   * Stubbing the edge's module on the primary persona: the remaining effect, the share of the effect the module carries
   * (1 − remaining/effect) and whether the module is on the path at all (the stub changes the effect).
   */
  stub?: { module: string; delta: number; share: number; onPath: boolean };
  note?: string;
}

export interface UndocumentedEffect {
  /** Lever / block ids that share the probe. */
  sources: string[];
  probe: string;
  persona: ProbePersona;
  metric: MetricId;
  delta: number;
  floor: number;
}

export interface LivenessReport {
  edges: EdgeLiveness[];
  undocumented: UndocumentedEffect[];
  runs: number;
  ms: number;
}

export interface LivenessOptions {
  personas: readonly ProbePersona[];
  /**
   * Module-stub check on the persona with the largest effect: 'all' edges (default), 'sampled' = one probe per (channel,
   * module) pair and no catalogue edges (their channel is a lever's), or 'none'.
   */
  stub?: 'all' | 'sampled' | 'none';
  /**
   * Noise floor of a metric on a probe (metric units). Default: numerical, 1e-6 of the base value + 1e-9 (the reduced
   * check: the effect must exist and point the right way).
   */
  floor?: (metric: MetricId, persona: ProbePersona, spec: ProbeSpec, base: number) => number;
  /** Clock for the report (tests pass performance.now; the engine has no clock). */
  now?: () => number;
}

export const numericFloor = (_m: MetricId, _p: ProbePersona, _s: ProbeSpec, base: number): number => 1e-6 * Math.abs(Number.isFinite(base) ? base : 0) + 1e-9;

export const probeKey = (s: Omit<ProbeSpec, 'persona'>): string => JSON.stringify([s.base, s.toggle]);
/** Opposite-sign moves below this share of the largest agreeing move are ignored (second-order pathways). */
export const OPPOSITE_SHARE = 0.25;

const DEFICIT_BLOCKS = new Set(['B1', 'B3', 'B11', 'B12', 'B24']);

/**
 * Whether the planner could switch the probe's source on for this person at all (the block's or lever's tier is not
 * "never", the supplement is allowed, sleep extension is offered): a probe the person can never hold says nothing.
 */
export function probeApplicable(ctx: PlanningContext, spec: Omit<ProbeSpec, 'persona'>): boolean {
  const t = spec.toggle;
  const usable = (b: BlockId) => BLOCKS[b].tier(ctx.caps) !== 'never';
  switch (t.kind) {
    case 'segments':
      return t.segments.every((g) => (g.kind === 'phase' ? usable(g.block) : usable(g.on) && usable(g.off)));
    case 'overlay':
      return t.overlay.lever === 'fastDay24' ? usable('B13') : usable('B9');
    case 'event':
      return usable(BLOCK_OF_FAST[t.durationH]);
    case 'flag':
      return t.flag === 'creatine'
        ? ctx.caps.creatineAllowed && (ctx.caps.optInLevers.has('L7') || ctx.caps.optInLevers.has('creatine'))
        : t.flag === 'omega3'
          ? ctx.caps.optInLevers.has('L8') || ctx.caps.optInLevers.has('omega3')
          : t.flag === 'sleepExtension'
            ? ctx.practical.habitualSleepH < 7
            : true;
    case 'gene':
      return true;
  }
}
/** Whether an edge's condition holds for a persona on a probe (machine check of `EdgeConditionId`). */
export function conditionHolds(cond: EvidenceEdge['condition'], ctx: PlanningContext, spec: Omit<ProbeSpec, 'persona'>): boolean {
  const segs = spec.toggle.kind === 'segments' ? spec.toggle.segments : [];
  const blocks = segs.map((g) => (g.kind === 'phase' ? g.block : g.on));
  if (!probeApplicable(ctx, spec)) return false;
  switch (cond) {
    case undefined:
    case 'weightLoss':
      return true;
    case 'deficit':
      return ctx.caps.deficitCapPct > 0 && (spec.base === 'deficit' || blocks.some((b) => DEFICIT_BLOCKS.has(b)));
    case 'surplus':
      return ctx.caps.surplusAllowed && (spec.base === 'surplus' || blocks.some((b) => b === 'B21' || b === 'B23'));
    case 'rtPresent':
      return ctx.practical.rtDays.max > 0;
    case 'shortSleep':
      return ctx.practical.habitualSleepH < 7;
    case 'lowCarb':
      return ctx.caps.ketogenicAllowed && (spec.base === 'veryLowCarb' || blocks.includes('B2'));
    case 'lowBodyFat':
      return ctx.caps.bodyFatPct <= ctx.caps.bfFloorPct + 6;
    case 'muscleGoal':
      return ctx.classRank.muscle !== undefined;
    case 'trainingNovice':
      return ctx.caps.rtNovice;
  }
}

function run(ctx: PlanningContext, schedule: Schedule, stub: string | null, counter: { n: number }): SimulationResult | null {
  counter.n++;
  try {
    return runEngine(ctx.rp, compileSchedule(schedule, ctx.rp), { mode: 'simulate', record: 'daily', burnInDays: 14 }, modulesWithout(stub));
  } catch {
    return null;
  }
}

/** Probe outcome cache: per persona and probe key, the goal-metric values of the base and toggled runs. */
interface ProbeRun {
  ctx: PlanningContext;
  base: Schedule;
  toggled: Schedule;
  baseVals: Map<MetricId, number>;
  togVals: Map<MetricId, number>;
}

export function checkLiveness(edges: readonly EvidenceEdge[], opts: LivenessOptions): LivenessReport {
  const t0 = opts.now?.() ?? 0;
  const counter = { n: 0 };
  const floorOf = opts.floor ?? numericFloor;
  const probed = edges.filter((e) => e.status !== 'infoOnly');
  const runs = new Map<string, ProbeRun>();
  const baseRuns = new Map<string, Map<MetricId, number>>();
  const valuesOf = (ctx: PlanningContext, sim: SimulationResult | null) => new Map(GOAL_METRICS.map((m) => [m, metricValue(ctx, sim, m)] as const));

  const probeRun = (persona: ProbePersona, probe: NonNullable<EvidenceEdge['probe']>): ProbeRun => {
    const key = `${persona}|${probeKey(probe)}`;
    let r = runs.get(key);
    if (!r) {
      const p = probePair({ persona, base: probe.base, toggle: probe.toggle });
      const bKey = `${persona}|${JSON.stringify(p.base)}`;
      let baseVals = baseRuns.get(bKey);
      if (!baseVals) {
        baseVals = valuesOf(p.ctx, run(p.ctx, p.base, null, counter));
        baseRuns.set(bKey, baseVals);
      }
      r = { ctx: p.ctx, base: p.base, toggled: p.toggled, baseVals, togVals: valuesOf(p.ctx, run(p.ctx, p.toggled, null, counter)) };
      runs.set(key, r);
    }
    return r;
  };

  const results: EdgeLiveness[] = [];
  const stubCache = new Map<string, number>();
  const stubGroups = new Set<string>();
  for (const e of probed) {
    if (!e.probe) {
      results.push({ edge: e.id, metric: e.metric, sign: e.sign, status: 'notProbed', deltas: {}, floors: {}, note: 'no switch in the planner grammar' });
      continue;
    }
    const deltas: Partial<Record<ProbePersona, number>> = {};
    const floors: Partial<Record<ProbePersona, number>> = {};
    let pos = 0;
    let moved = 0;
    let maxAgree = 0;
    const opposite: number[] = [];
    let applicable = 0;
    for (const persona of opts.personas) {
      const r = probeRun(persona, e.probe);
      if (!conditionHolds(e.condition, r.ctx, e.probe)) continue;
      applicable++;
      const b = r.baseVals.get(e.metric)!;
      const d = r.togVals.get(e.metric)! - b;
      const f = e.noiseFloor ?? floorOf(e.metric, persona, { persona, base: e.probe.base, toggle: e.probe.toggle }, b);
      deltas[persona] = d;
      floors[persona] = f;
      if (!Number.isFinite(d)) continue;
      if (Math.abs(d) > f) moved++;
      if (e.sign !== 0) {
        if (d * e.sign > f) {
          pos++;
          maxAgree = Math.max(maxAgree, Math.abs(d));
        } else if (d * e.sign < -f) opposite.push(Math.abs(d));
      }
    }
    // an opposite move smaller than a quarter of the largest agreeing move is second-order (another pathway of the plan)
    const neg = opposite.filter((x) => x > OPPOSITE_SHARE * maxAgree).length;
    let status: LivenessStatus;
    if (applicable === 0) {
      results.push({ edge: e.id, metric: e.metric, sign: e.sign, status: 'notProbed', deltas, floors, note: `the condition (${e.condition}) holds for no probe persona` });
      continue;
    }
    if (e.sign === 0) status = moved > 0 ? 'live' : 'dead';
    else status = pos > 0 && neg === 0 ? 'live' : pos > 0 ? 'mixed' : neg > 0 ? 'wrongSign' : 'dead';
    // a floor above the numerical one (the full audit's ensemble floor) separates "moves, but less than the model's
    // uncertainty" from "does not move at all"
    if (status === 'dead' && opts.floor) {
      const anyMove = opts.personas.some((p) => {
        const d = deltas[p] ?? NaN;
        return Number.isFinite(d) && Math.abs(d) > numericFloor(e.metric, p, { persona: p, base: e.probe!.base, toggle: e.probe!.toggle }, 0) && (e.sign === 0 || d * e.sign > 0);
      });
      if (anyMove) status = 'weak';
    }
    const item: EdgeLiveness = { edge: e.id, metric: e.metric, sign: e.sign, status, deltas, floors };
    const mode = opts.stub ?? 'all';
    const group = `${e.id.split('>')[1]}|${e.mechanism.module}`;
    const sampleOk = mode === 'all' || (mode === 'sampled' && e.from.kind !== 'catalogue' && !stubGroups.has(group));
    if (sampleOk && (status === 'live' || status === 'weak' || status === 'mixed')) {
      stubGroups.add(group);
      // the persona with the largest applicable effect (the probe's own persona on ties)
      let persona = e.probe.persona;
      let best = -1;
      for (const p of opts.personas) {
        const d = Math.abs(deltas[p] ?? NaN);
        if (Number.isFinite(d) && (d > best || (d === best && p === e.probe.persona))) {
          best = d;
          persona = p;
        }
      }
      const r = probeRun(persona, e.probe);
      const mod = e.mechanism.module;
      const sKey = `${persona}|${probeKey(e.probe)}|${mod}|${e.metric}`;
      let ds = stubCache.get(sKey);
      if (ds === undefined) {
        const a = run(r.ctx, r.base, mod, counter);
        const b = run(r.ctx, r.toggled, mod, counter);
        for (const m of GOAL_METRICS) {
          const k = `${persona}|${probeKey(e.probe)}|${mod}|${m}`;
          stubCache.set(k, metricValue(r.ctx, b, m) - metricValue(r.ctx, a, m));
        }
        ds = stubCache.get(sKey)!;
      }
      const d0 = deltas[persona] ?? NaN;
      const share = Number.isFinite(ds) && Math.abs(d0) > 0 ? 1 - ds / d0 : 1;
      const onPath = !Number.isFinite(ds) || Math.abs(ds - d0) > Math.max(floors[persona] ?? 0, 0.05 * Math.abs(d0));
      item.stub = { module: mod, delta: ds, share, onPath };
    }
    results.push(item);
  }

  // undocumented mechanisms: per probe, every goal metric that moves with no edge from any source using that probe
  const sourcesByProbe = new Map<string, Set<string>>();
  const metricsByProbe = new Map<string, Set<MetricId>>();
  const specByProbe = new Map<string, NonNullable<EvidenceEdge['probe']>>();
  for (const e of probed) {
    if (!e.probe) continue;
    const k = probeKey(e.probe);
    specByProbe.set(k, e.probe);
    (sourcesByProbe.get(k) ?? sourcesByProbe.set(k, new Set()).get(k)!).add(e.from.id);
  }
  for (const e of edges) {
    if (!e.probe) continue;
    const k = probeKey(e.probe);
    (metricsByProbe.get(k) ?? metricsByProbe.set(k, new Set()).get(k)!).add(e.metric);
  }
  const undocumented: UndocumentedEffect[] = [];
  for (const [k, spec] of specByProbe) {
    const documented = metricsByProbe.get(k) ?? new Set<MetricId>();
    for (const persona of opts.personas) {
      const r = probeRun(persona, spec);
      for (const m of GOAL_METRICS) {
        if (documented.has(m)) continue;
        const b = r.baseVals.get(m)!;
        const d = r.togVals.get(m)! - b;
        const f = floorOf(m, persona, { persona, base: spec.base, toggle: spec.toggle }, b);
        if (Number.isFinite(d) && Math.abs(d) > f) undocumented.push({ sources: [...(sourcesByProbe.get(k) ?? [])].sort(), probe: k, persona, metric: m, delta: d, floor: f });
      }
    }
  }
  return { edges: results, undocumented, runs: counter.n, ms: (opts.now?.() ?? 0) - t0 };
}

/**
 * Ensemble noise floor (§6.1 default): ½ of the P10-P90 half-width of each goal metric on each probe base plan, from
 * `draws` parameter draws (Latin hypercube in quantile space, seeded). Returns a floor function for `checkLiveness`.
 */
export function ensembleFloor(personas: readonly ProbePersona[], specs: readonly Omit<ProbeSpec, 'persona'>[], draws = 10, seed = 'audit-floor'): LivenessOptions['floor'] {
  const defs = buildModelParams(MODULES).defs;
  const P = variableParamCount(defs);
  const U = latinHypercube(draws, P, new Rng(seed));
  const params = Array.from({ length: draws }, (_, m) => quantilesToParams(defs, U.subarray(m * P, (m + 1) * P)));
  const cache = new Map<string, Map<MetricId, number>>();
  const counter = { n: 0 };
  const floorFor = (persona: ProbePersona, spec: Omit<ProbeSpec, 'persona'>): Map<MetricId, number> => {
    const p = probePair({ persona, ...spec });
    const key = `${persona}|${JSON.stringify(p.base)}`;
    let f = cache.get(key);
    if (f) return f;
    const cs = compileSchedule(p.base, p.ctx.rp);
    const vals = new Map<MetricId, number[]>();
    for (const po of params) {
      counter.n++;
      let sim: SimulationResult | null;
      try {
        sim = runEngine(p.ctx.rp, cs, { mode: 'simulate', record: 'daily', burnInDays: 14, paramOverrides: po });
      } catch {
        sim = null;
      }
      for (const m of GOAL_METRICS) (vals.get(m) ?? vals.set(m, []).get(m)!).push(metricValue(p.ctx, sim, m));
    }
    f = new Map();
    for (const [m, v] of vals) {
      const s = v.filter(Number.isFinite).sort((a, b) => a - b);
      const q = (x: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(x * (s.length - 1))))] ?? NaN;
      f.set(m, s.length >= 3 ? 0.5 * ((q(0.9) - q(0.1)) / 2) : NaN);
    }
    cache.set(key, f);
    return f;
  };
  for (const persona of personas) for (const s of specs) floorFor(persona, s);
  return (m, persona, spec, base) => {
    const v = floorFor(persona, { base: spec.base, toggle: spec.toggle }).get(m);
    return v !== undefined && Number.isFinite(v) ? Math.max(v, numericFloor(m, persona, spec, base)) : numericFloor(m, persona, spec, base);
  };
}
