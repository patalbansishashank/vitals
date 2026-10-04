/**
 * Static checks of the evidence-coverage audit (PLANNER_V2_SPEC §6.3 checks 1a and 1b; decode level, no engine runs).
 *
 * 1a  every `plannerUsable` lever and every phase / overlay / event block appears in at least one enumerated structure
 *     over the coverage corpus;
 * 1b  decoding gene corners 0 and 1 moves the gene's engine input (a gene that never moves anything is dead) and reaches
 *     the lever registry's parameter range where the person's limits allow it; a gene that repair overrides on more than
 *     half of the days in more than half of Latin-hypercube samples is reported as effectively fixed.
 */
import { SERIES, SERIES_INDEX, type MetricId } from '../../types/metrics';
import type { Schedule } from '../../types/schedule';
import { Rng, latinHypercube } from '../optim/rng';
import { compileRequest, type PlanningContext } from '../domain/context';
import { servesFasting } from '../domain/evidenceGraph';
import { mergeDay } from '../domain/dayMath';
import { decodePlan } from '../domain/decode';
import { BLOCKS, type BlockId } from '../domain/registry/blocks';
import { LEVERS } from '../domain/registry/levers';
import { repairSchedule } from '../domain/repair';
import { BLOCK_OF_FAST, enumerateStructures, type SkeletonStructure } from '../domain/skeleton';
import type { PlannerRequest } from '../domain/types';

// ---------------------------------------------------------------------------------------------------------------
// what a structure contains
// ---------------------------------------------------------------------------------------------------------------

/** Gene path → the lever whose parameter it is. */
export function leverOfGene(path: string): string | null {
  if (/^seg\d+\.energy$/.test(path)) return 'energy';
  if (/^seg\d+\.protein$/.test(path)) return 'protein';
  if (/^seg\d+\.(fat|carbG)$/.test(path)) return 'carbFat';
  if (/^seg\d+\.lowKcal$/.test(path)) return 'lowDays';
  if (/^seg\d+\.(weeks|onWeeks|offWeeks)$/.test(path)) return null; // phase durations (grammar, not a lever)
  if (path === 'fibre') return 'fibre';
  if (path.startsWith('window.') || path === 'meals') return 'eatingWindow';
  if (path.startsWith('rt.')) return 'resistanceTraining';
  if (path.startsWith('cardio.')) return 'cardio';
  if (path === 'steps') return 'L1';
  if (path === 'sleep.extraH') return 'L5';
  if (path === 'creatine.g') return 'L7';
  if (path === 'omega3.g') return 'L8';
  if (path === 'viscous.g') return 'L9';
  if (path.startsWith('ov.')) return 'refeedDay';
  if (path.startsWith('ev.')) return 'waterFast';
  return null; // Ideal-only genes (sleep duration/midpoint, training clock) and others
}

/** Levers a structure lets the planner use. The no-late-eating rule (L19) holds by construction in every planned day. */
export function structureLevers(st: SkeletonStructure): Set<string> {
  const out = new Set<string>();
  const sk = st.skeleton;
  if (sk.baseline) return out;
  for (const g of st.genes) {
    const l = leverOfGene(g.path);
    if (l && g.max > g.min) out.add(l);
  }
  for (const s of sk.segments) {
    if (s.kind === 'cycle') out.add('dietBreak');
    else if (s.block === 'B11') out.add('lowDays');
    else if (s.block === 'B12') out.add('zeroDay');
  }
  if (sk.overlay) out.add(sk.overlay.lever);
  if (sk.event) out.add('waterFast');
  if (sk.creatine) out.add('L7');
  if (sk.omega3) out.add('L8');
  if (sk.viscousFibre) out.add('L9');
  if (sk.sleepExtension) out.add('L5');
  out.add('L19');
  return out;
}

/** Blocks a structure places (phases, the diet-break half of a cycle, overlay and event blocks). */
export function structureBlocks(st: SkeletonStructure): Set<BlockId> {
  const out = new Set<BlockId>();
  const sk = st.skeleton;
  if (sk.baseline) return out;
  for (const s of sk.segments) {
    if (s.kind === 'phase') out.add(s.block);
    else {
      out.add(s.on);
      out.add(s.off);
    }
  }
  if (sk.overlay) out.add(sk.overlay.lever === 'refeedDay' ? 'B9' : 'B13');
  if (sk.event) out.add(BLOCK_OF_FAST[sk.event.durationH]);
  return out;
}

/** Levers and blocks check 1a must find: every usable lever and every phase, cycle-off, overlay and event block. */
export function auditedLevers(): string[] {
  return LEVERS.filter((l) => l.plannerUsable).map((l) => l.id);
}
export function auditedBlocks(): BlockId[] {
  return (Object.keys(BLOCKS) as BlockId[]).filter((b) => ['phase', 'cycleOff', 'overlay', 'event'].includes(BLOCKS[b].use));
}

// ---------------------------------------------------------------------------------------------------------------
// 1a reachability
// ---------------------------------------------------------------------------------------------------------------

export interface ReachabilityReport {
  requests: number;
  structures: { min: number; max: number; mean: number; truncated: number };
  /** Requests whose structure set contains the lever / block. */
  levers: Record<string, number>;
  blocks: Record<string, number>;
  unreachableLevers: string[];
  unreachableBlocks: string[];
  /** One corpus request id per lever / block (where it was first seen). */
  witness: Record<string, string>;
}

export function reachability(entries: ReadonlyArray<{ id: string; request: PlannerRequest }>): ReachabilityReport {
  const levers: Record<string, number> = Object.fromEntries(auditedLevers().map((l) => [l, 0]));
  const blocks: Record<string, number> = Object.fromEntries(auditedBlocks().map((b) => [b, 0]));
  const witness: Record<string, string> = {};
  let min = Infinity;
  let max = 0;
  let sum = 0;
  let truncated = 0;
  for (const e of entries) {
    const ctx = compileRequest(e.request);
    const sts = enumerateStructures(ctx);
    const big = enumerateStructures(ctx, 100000);
    if (big.length > sts.length) truncated++;
    min = Math.min(min, sts.length);
    max = Math.max(max, sts.length);
    sum += sts.length;
    const L = new Set<string>();
    const B = new Set<string>();
    for (const st of sts) {
      for (const l of structureLevers(st)) L.add(l);
      for (const b of structureBlocks(st)) B.add(b);
    }
    for (const l of L)
      if (l in levers) {
        levers[l]!++;
        witness[l] ??= e.id;
      }
    for (const b of B)
      if (b in blocks) {
        blocks[b]!++;
        witness[b] ??= e.id;
      }
  }
  return {
    requests: entries.length,
    structures: { min, max, mean: entries.length ? sum / entries.length : 0, truncated },
    levers,
    blocks,
    unreachableLevers: Object.keys(levers).filter((l) => levers[l] === 0),
    unreachableBlocks: Object.keys(blocks).filter((b) => blocks[b] === 0),
    witness,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 1b gene range
// ---------------------------------------------------------------------------------------------------------------

/** The part of a schedule a gene writes (string projection, day by day), for "did this gene reach the engine". */
export function geneProjection(schedule: Schedule, path: string): string[] {
  if (/^seg\d+\.(weeks|onWeeks|offWeeks)$/.test(path)) return [JSON.stringify(schedule.blocks ?? [])];
  if (path.startsWith('ev.')) return [JSON.stringify(schedule.events ?? [])];
  const pick = (t: ReturnType<typeof mergeDay>): unknown => {
    if (/^seg\d+\.(energy|lowKcal)$/.test(path) || path === 'ov.pct') return t.energy;
    if (/^seg\d+\.protein$/.test(path)) return t.macros.protein;
    if (/^seg\d+\.fat$/.test(path)) return t.macros.fat;
    if (/^seg\d+\.carbG$/.test(path) || path === 'ov.carb') return t.macros.carbs;
    if (path === 'fibre' || path === 'viscous.g') return [t.macros.fibre, t.macros.viscousFibreShare];
    if (path === 'omega3.g') return t.macros.fatTypes;
    if (path.startsWith('window.') || path === 'meals') return t.meals;
    if (path.startsWith('rt.')) return (t.exercise ?? []).filter((x) => x.kind === 'resistance');
    if (path.startsWith('cardio.')) return (t.exercise ?? []).filter((x) => x.kind === 'cardio');
    if (path === 'train.clockH') return (t.exercise ?? []).map((x) => x.startH);
    if (path === 'steps') return t.steps;
    if (path.startsWith('sleep.')) return t.sleep;
    if (path === 'creatine.g') return t.substances;
    return t;
  };
  const out: string[] = [];
  for (let d = 0; d < schedule.horizonDays; d++) {
    const sd = schedule.days[d]!;
    out.push(JSON.stringify(pick(mergeDay(schedule.programs[sd.program]!, sd.override)) ?? null));
  }
  return out;
}

const differs = (a: readonly string[], b: readonly string[]) => a.length !== b.length || a.some((x, i) => x !== b[i]);

export interface GeneRangeReport {
  /** Gene paths seen, with the corpus requests / structures examined. */
  genes: Record<string, { structures: number; moved: number; decodedMin: number; decodedMax: number }>;
  /** Genes whose corners never change the engine input in any examined structure. */
  dead: string[];
  /** Registry parameter ranges vs the decoded union over the corpus (lever.param). */
  registry: Array<{ lever: string; param: string; registry: [number, number]; decoded: [number, number] | null; covered: number }>;
}

/** Gene path → the registry parameter it decodes (lever id, param key, value transform from the decoded gene value). */
const GENE_PARAM: ReadonlyArray<{ re: RegExp; lever: string; param: string }> = [
  { re: /^seg\d+\.energy$/, lever: 'energy', param: 'pct' },
  { re: /^seg\d+\.protein$/, lever: 'protein', param: 'gPerKg' },
  { re: /^seg\d+\.fat$/, lever: 'carbFat', param: 'fatGPerKg' },
  { re: /^seg\d+\.carbG$/, lever: 'carbFat', param: 'carbG' },
  { re: /^fibre$/, lever: 'fibre', param: 'g' },
  { re: /^window\.startH$/, lever: 'eatingWindow', param: 'startH' },
  { re: /^window\.lengthH$/, lever: 'eatingWindow', param: 'lengthH' },
  { re: /^meals$/, lever: 'eatingWindow', param: 'meals' },
  { re: /^rt\.sessions$/, lever: 'resistanceTraining', param: 'sessions' },
  { re: /^rt\.sets$/, lever: 'resistanceTraining', param: 'setsPerRegionWeek' },
  { re: /^cardio\.sessions$/, lever: 'cardio', param: 'sessions' },
  { re: /^cardio\.minutes$/, lever: 'cardio', param: 'minutes' },
  { re: /^cardio\.intensity$/, lever: 'cardio', param: 'pctVo2max' },
  { re: /^steps$/, lever: 'L1', param: 'steps' },
  { re: /^sleep\.extraH$/, lever: 'L5', param: 'extraH' },
  { re: /^creatine\.g$/, lever: 'L7', param: 'g' },
  { re: /^omega3\.g$/, lever: 'L8', param: 'g' },
  { re: /^viscous\.g$/, lever: 'L9', param: 'g' },
  { re: /^ov\.pct$/, lever: 'refeedDay', param: 'pct' },
  { re: /^ov\.carb$/, lever: 'refeedDay', param: 'carbGPerKg' },
  { re: /^seg\d+\.lowKcal$/, lever: 'lowDays', param: 'kcal' },
];

/**
 * Decode every structure of the requests at x0 with one gene at 0 and at 1: the gene's run-time range and whether the
 * engine input changes. `maxStructures` caps the structures per request (the corners of the first ones suffice).
 */
export function geneRanges(requests: readonly PlannerRequest[], maxStructures = 60): GeneRangeReport {
  const genes: GeneRangeReport['genes'] = {};
  const reg = new Map<string, [number, number]>();
  for (const req of requests) {
    const ctx = compileRequest(req);
    for (const st of enumerateStructures(ctx).slice(1, maxStructures)) {
      st.genes.forEach((g, i) => {
        const at = (u: number) => {
          const x = Float64Array.from(st.x0);
          x[i] = u;
          return decodePlan(ctx, st, x);
        };
        const lo = at(0);
        const hi = at(1);
        const rec = (genes[g.path] ??= { structures: 0, moved: 0, decodedMin: Infinity, decodedMax: -Infinity });
        rec.structures++;
        const vLo = lo.values[i]!;
        const vHi = hi.values[i]!;
        rec.decodedMin = Math.min(rec.decodedMin, vLo, vHi);
        rec.decodedMax = Math.max(rec.decodedMax, vLo, vHi);
        if (differs(geneProjection(lo.schedule, g.path), geneProjection(hi.schedule, g.path))) rec.moved++;
        const gp = GENE_PARAM.find((m) => m.re.test(g.path));
        if (gp) {
          const k = `${gp.lever}.${gp.param}`;
          const r = reg.get(k) ?? [Infinity, -Infinity];
          // the decoder's protein is per kg reference weight; the registry's is per kg body weight: compare like with like
          const f = gp.lever === 'protein' ? ctx.caps.rwKg / ctx.rp.weightKg : 1;
          reg.set(k, [Math.min(r[0], Math.min(vLo, vHi) * f), Math.max(r[1], Math.max(vLo, vHi) * f)]);
        }
      });
    }
  }
  const registry: GeneRangeReport['registry'] = [];
  for (const l of LEVERS) {
    if (!l.plannerUsable) continue;
    for (const p of l.params) {
      if (p.kind === 'cat') continue;
      const d = reg.get(`${l.id}.${p.key}`) ?? null;
      const span = p.max - p.min;
      const covered = d && span > 0 ? Math.max(0, Math.min(p.max, d[1]) - Math.max(p.min, d[0])) / span : d ? 1 : 0;
      registry.push({ lever: l.id, param: p.key, registry: [p.min, p.max], decoded: d, covered });
    }
  }
  return { genes, dead: Object.keys(genes).filter((p) => genes[p]!.moved === 0), registry };
}

export interface RepairRateReport {
  samples: number;
  /** Per gene path: share of samples in which repair overrode the gene's engine input on more than half of the days. */
  rates: Record<string, { samples: number; fixed: number; share: number }>;
  effectivelyFixed: string[];
}

/** LHS samples per structure, decode → repair; a gene is overridden in a sample when > 50 % of its days changed. */
export function repairRates(requests: readonly PlannerRequest[], samples = 16, maxStructures = 12, seed = 'audit-repair'): RepairRateReport {
  const rates: RepairRateReport['rates'] = {};
  let n = 0;
  for (const [ri, req] of requests.entries()) {
    const ctx: PlanningContext = compileRequest(req);
    const sts = enumerateStructures(ctx).slice(1, maxStructures);
    for (const [si, st] of sts.entries()) {
      if (st.dim === 0) continue;
      const U = latinHypercube(samples, st.dim, new Rng(`${seed}|${ri}|${si}`));
      for (let k = 0; k < samples; k++) {
        const x = U.subarray(k * st.dim, (k + 1) * st.dim);
        const plan = decodePlan(ctx, st, x);
        const rep = repairSchedule(ctx, plan.schedule, plan).schedule;
        n++;
        for (const g of st.genes) {
          const a = geneProjection(plan.schedule, g.path);
          const b = geneProjection(rep, g.path);
          let changed = 0;
          for (let d = 0; d < a.length; d++) if (a[d] !== b[d]) changed++;
          const r = (rates[g.path] ??= { samples: 0, fixed: 0, share: 0 });
          r.samples++;
          if (changed > 0.5 * a.length) r.fixed++;
        }
      }
    }
  }
  for (const r of Object.values(rates)) r.share = r.samples ? r.fixed / r.samples : 0;
  return { samples: n, rates, effectivelyFixed: Object.keys(rates).filter((p) => rates[p]!.share > 0.5).sort() };
}

// ---------------------------------------------------------------------------------------------------------------
// the fasting gate's class set vs the evidence graph (§3.1)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Known divergences between the fasting gate and the evidence graph (owner ruling 2026-10-01): the gate offers fasting
 * for these goal classes although no zero-intake mechanism credits the goal's direction. Offering is harmless (the
 * optimiser keeps a fast only where it helps the ranked goals), so they stay offered and are reported with their reason.
 * The reverse direction (the graph credits a goal the gate does not offer) is never expected: the gate offers every
 * goal the graph credits (`fastingServes`). Reasons are user-facing text.
 */
export const KNOWN_FASTING_DIVERGENCES: Readonly<Record<string, string>> = {
  'hunger:down': 'hunger rises during a fast in the model; offered because the goal type covers hunger and adherence, and a person may simply prefer eating this way',
  'adherence:up': 'every fast lowers modelled plan adherence; offered for the same reason as hunger',
  'ketoInduction:down': 'the keto-induction symptom index does not respond to fasts in the model; offered with the comfort goals',
  'igf1:up': 'fasts lower IGF-1 in the model, never raise it; offered because IGF-1 is a transient marker and the other direction is served',
  'bhb:down': 'fasts raise blood ketones in the model, never lower them; offered because ketones are a transient marker and the other direction is served',
};

/**
 * Where the fasting gate (`fastingServes` through the compiled context's served goal) and `servesFasting` (the
 * evidence graph alone) disagree, per goal metric and direction: `graphOnly` = the graph credits a fast and the gate does
 * not offer one (a failure under the owner ruling), `gateOnly` = the gate offers and the graph gives no credit (expected
 * when listed in `KNOWN_FASTING_DIVERGENCES`).
 */
export function fastingGateAgreement(profile: PlannerRequest['profile']): Record<string, 'graphOnly' | 'gateOnly'> {
  const found: Record<string, 'graphOnly' | 'gateOnly'> = {};
  for (const d of SERIES) {
    if (d.kind !== 'metric' || d.goal === 'none') continue;
    const metric = d.id as MetricId;
    const dirs = d.goal === 'maximise' ? (['up'] as const) : d.goal === 'minimise' ? (['down'] as const) : (['up', 'down'] as const);
    for (const dir of dirs) {
      const ctx = compileRequest({ profile, goals: [{ metric, direction: dir === 'up' ? 'maximise' : 'minimise' }], horizonDays: 84 });
      const gate = ctx.fastingServedGoal === 0;
      const graph = servesFasting(metric, dir);
      if (gate !== graph) found[`${metric}:${dir}`] = graph ? 'graphOnly' : 'gateOnly';
    }
  }
  return found;
}

/** The fasting gate vs graph comparison split into known divergences (with their reason) and unexpected ones. */
export interface FastingGateReport {
  expected: Array<{ pair: string; reason: string }>;
  unexpected: Array<{ pair: string; kind: 'graphOnly' | 'gateOnly' }>;
}

export function fastingGateReport(found: Record<string, 'graphOnly' | 'gateOnly'>): FastingGateReport {
  const out: FastingGateReport = { expected: [], unexpected: [] };
  for (const [pair, kind] of Object.entries(found)) {
    const reason = kind === 'gateOnly' ? KNOWN_FASTING_DIVERGENCES[pair] : undefined;
    if (reason) out.expected.push({ pair, reason });
    else out.unexpected.push({ pair, kind });
  }
  return out;
}

export const metricLabel = (m: string): string => (SERIES[SERIES_INDEX[m as MetricId]]?.label ?? m) as string;
