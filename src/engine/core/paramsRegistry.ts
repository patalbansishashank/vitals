/**
 * Parameter registry (docs/MODEL_SPEC.md §8, §0.5): collects every module's ParamDefs in module order, validates them,
 * builds `ModelParams`, applies ensemble overrides and samples Latin-hypercube draws.
 */
import type { AnyEngineModule } from '../types/module';
import type { DrawKind, ModelParams, ParamDef, ParamDrawSpec } from '../types/params';
import { fnv1a, mulberry32, triangularInv } from './math';
import { ENGINE_VERSION } from './defaults';

export interface RegistryIssue {
  id: string;
  problem: string;
}

/** Validation rules: unique id, `<module>.` prefix, finite value, low ≤ value ≤ high, non-empty source/dossier. */
export function validateParamDefs(modules: readonly AnyEngineModule[]): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    for (const p of m.params) {
      if (seen.has(p.id)) issues.push({ id: p.id, problem: 'duplicate id' });
      seen.add(p.id);
      if (!p.id.startsWith(`${m.id}.`)) issues.push({ id: p.id, problem: `id must start with "${m.id}."` });
      if (!Number.isFinite(p.value)) issues.push({ id: p.id, problem: 'value not finite' });
      if (!(p.low <= p.value && p.value <= p.high)) issues.push({ id: p.id, problem: 'requires low ≤ value ≤ high' });
      if (!p.source.trim()) issues.push({ id: p.id, problem: 'missing source' });
      if (!p.dossier.trim()) issues.push({ id: p.id, problem: 'missing dossier section' });
      if (drawKindOf(p) === 'logTri' && p.low <= 0) issues.push({ id: p.id, problem: 'logTri needs low > 0' });
    }
  }
  return issues;
}

export function drawKindOf(p: ParamDef): DrawKind {
  if (p.draw) return p.draw;
  return p.low < p.high ? 'tri' : 'fixed';
}

const registryCache = new WeakMap<readonly AnyEngineModule[], ModelParams>();

/** Nominal parameters for a module list (cached per list instance). */
export function buildModelParams(modules: readonly AnyEngineModule[]): ModelParams {
  const cached = registryCache.get(modules);
  if (cached) return cached;
  const defs: ParamDef[] = [];
  for (const m of modules) for (const p of m.params) defs.push(p);
  const values = new Float64Array(defs.length);
  const index = new Map<string, number>();
  defs.forEach((d, i) => {
    values[i] = d.value;
    index.set(d.id, i);
  });
  const registryHash = fnv1a(`${ENGINE_VERSION}|${defs.map((d) => `${d.id}=${d.value}[${d.low},${d.high}]`).join(';')}`);
  const mp: ModelParams = { defs, values, index, registryHash };
  registryCache.set(modules, mp);
  return mp;
}

/** Same registry with a different value vector (ensemble member). Length must match. */
export function withOverrides(base: ModelParams, overrides: Float64Array): ModelParams {
  if (overrides.length !== base.values.length) {
    throw new Error(`paramOverrides length ${overrides.length} ≠ registry length ${base.values.length}`);
  }
  return { defs: base.defs, values: overrides, index: base.index, registryHash: base.registryHash };
}

/** Read one value by id (prepare-time only). Throws on unknown ids so typos fail fast in tests. */
export function param(p: ModelParams, id: string): number {
  const i = p.index.get(id);
  if (i === undefined) throw new Error(`unknown parameter "${id}"`);
  return p.values[i] as number;
}

/**
 * Latin-hypercube (default) or independent draws of every non-fixed parameter (MODEL_SPEC §8.1).
 * Deterministic in (defs, spec). Parameters are independent (correlations ignored, §8.1). Triangular(low, value, high),
 * or triangular in log space for 'logTri'. Returns `count` full vectors in registry order.
 */
export function sampleParams(defs: readonly ParamDef[], spec: ParamDrawSpec): Float64Array[] {
  const n = Math.max(0, Math.floor(spec.count));
  const rng = mulberry32(spec.seed);
  const only = spec.only ? new Set(spec.only) : null;
  const out: Float64Array[] = [];
  for (let k = 0; k < n; k++) {
    const v = new Float64Array(defs.length);
    defs.forEach((d, i) => (v[i] = d.value));
    out.push(v);
  }
  defs.forEach((d, i) => {
    const kind = drawKindOf(d);
    if (kind === 'fixed' || (only && !only.has(d.id))) return;
    // one stratum per draw, randomly permuted (LHS) or plain uniforms (independent)
    const perm = Array.from({ length: n }, (_, k) => k);
    if ((spec.method ?? 'lhs') === 'lhs') {
      for (let k = n - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        const tmp = perm[k] as number;
        perm[k] = perm[j] as number;
        perm[j] = tmp;
      }
    }
    for (let k = 0; k < n; k++) {
      const u = (spec.method ?? 'lhs') === 'lhs' ? ((perm[k] as number) + rng()) / n : rng();
      let x: number;
      if (kind === 'logTri') {
        x = Math.exp(triangularInv(u, Math.log(d.low), Math.log(d.value), Math.log(d.high)));
      } else if (kind === 'uniform') {
        x = d.low + u * (d.high - d.low);
      } else {
        x = triangularInv(u, d.low, d.value, d.high);
      }
      (out[k] as Float64Array)[i] = x;
    }
  });
  return out;
}

/**
 * Map one row of ensemble quantiles u ∈ [0,1)^P (e.g. the planner's `latinHypercube(M, P, rng)` row, dossier 18 §4.15)
 * onto a full parameter vector in registry order. `u.length` must equal the number of non-fixed parameters; fixed
 * parameters keep their nominal value. Used by the planner domain layer's `simulate(schedule, draw)`.
 */
export function quantilesToParams(defs: readonly ParamDef[], u: ArrayLike<number>): Float64Array {
  const out = new Float64Array(defs.length);
  let j = 0;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const kind = drawKindOf(d);
    if (kind === 'fixed') {
      out[i] = d.value;
      continue;
    }
    const q = Math.min(1 - 1e-12, Math.max(0, u[j++] ?? 0.5));
    out[i] =
      kind === 'logTri'
        ? Math.exp(triangularInv(q, Math.log(d.low), Math.log(d.value), Math.log(d.high)))
        : kind === 'uniform'
          ? d.low + q * (d.high - d.low)
          : triangularInv(q, d.low, d.value, d.high);
  }
  return out;
}

/** Number of parameters that vary in draws (the dimension P of the planner's ensemble LHS). */
export function variableParamCount(defs: readonly ParamDef[]): number {
  let n = 0;
  for (const d of defs) if (drawKindOf(d) !== 'fixed') n++;
  return n;
}
