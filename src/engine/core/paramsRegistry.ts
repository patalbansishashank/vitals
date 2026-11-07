/**
 * Parameter registry (docs/MODEL_SPEC.md §8, §0.5): collects every module's ParamDefs in module order, validates them,
 * builds `ModelParams`, applies ensemble overrides and samples Latin-hypercube draws.
 *
 * 2026-10-18 contracts (D4-03, C6/C7): the registry hash covers each parameter's draw kind and its distribution metadata
 * (what a draw represents) plus the contract fingerprint, so changed draw semantics invalidate snapshots, caches and
 * worker results; declared distribution metadata must agree with the draw the sampler actually performs (nominal value =
 * the triangular mode / a design point, bounds = the support), never relabelled as a predictive interval.
 *
 * W1 (D8-02): a latent mixture selector (`nominal: 'designPoint'`, uniform draw) is a quantile on [0, 1] with nominal 0.5
 * (inverse-CDF sampling); a structural alternative that is not part of the production mode stays out of the draws (a
 * `fixed` production value, the alternative documented in `note`). Parameters that declare the same `correlationGroup`
 * are drawn jointly: they share one latent quantile per member (perfect rank correlation, the only joint law that needs no
 * fitted correlation coefficient; a fitted copula would be a new distribution version).
 */
import { CONTRACT_FINGERPRINT, stableStringify } from '@/lib/bodyContracts';
import type { AnyEngineModule } from '../types/module';
import type { DrawKind, ModelParams, ParamDef, ParamDrawSpec } from '../types/params';
import { fnv1a, mulberry32, triangularInv } from './math';
import { ENGINE_VERSION } from './defaults';

export interface RegistryIssue {
  id: string;
  problem: string;
}

/**
 * D4-03/D8-02: problems of a parameter's declared distribution metadata against the draw `sampleParams` /
 * `quantilesToParams` perform. Triangular draws use `value` as the mode and [low, high] as the support; uniform draws have no
 * mode; a fixed parameter is never sampled, so it cannot claim a sampled uncertainty kind; quantile bounds are not what the
 * sampler draws; a calibrated predictive distribution must be labelled empirical (held-out evaluation lives elsewhere); a
 * uniform design-point latent selector has support [0, 1] and nominal 0.5.
 */
export function distributionIssues(p: ParamDef): string[] {
  const m = p.distribution;
  if (!m) return [];
  const out: string[] = [];
  const kind = drawKindOf(p);
  const span = Math.max(Math.abs(p.high - p.low), Math.abs(p.value), 1) * 1e-9;
  if (!Number.isInteger(m.version) || m.version < 1) out.push('distribution.version must be a positive integer');
  if (!m.basis || !m.basis.trim()) out.push('distribution.basis missing');
  if (kind !== 'fixed' && m.bounds === 'quantiles') out.push(`distribution.bounds 'quantiles' but the ${kind} draw samples the support [low, high]`);
  if (kind === 'fixed' && (m.uncertaintyKind === 'parameterSensitivity' || m.uncertaintyKind === 'calibratedPrediction'))
    out.push(`fixed parameter (never drawn) cannot declare uncertaintyKind '${m.uncertaintyKind}'`);
  if (m.nominal === 'mode' && kind === 'uniform') out.push("distribution.nominal 'mode' but a uniform draw has no mode");
  if (m.nominal === 'median') {
    const sym =
      kind === 'fixed'
        ? true
        : kind === 'logTri'
          ? Math.abs(Math.log(p.value) - Math.log(p.low) - (Math.log(p.high) - Math.log(p.value))) <= 1e-9
          : Math.abs(p.value - p.low - (p.high - p.value)) <= span;
    if (!sym) out.push(`distribution.nominal 'median' but value is not the median of the ${kind} draw on [low, high]`);
  }
  if (m.uncertaintyKind === 'calibratedPrediction' && m.label !== 'empirical') out.push("uncertaintyKind 'calibratedPrediction' requires label 'empirical'");
  if (m.nominal === 'designPoint' && kind === 'uniform' && !(p.low === 0 && p.high === 1 && p.value === 0.5))
    out.push('a uniform design-point selector is a latent quantile: support [0, 1], nominal 0.5');
  if (m.correlationGroup !== undefined && !m.correlationGroup.trim()) out.push('distribution.correlationGroup must be a non-empty id');
  return out;
}

/**
 * Validation rules: unique id, `<module>.` prefix, finite value, low ≤ value ≤ high, non-empty source/dossier, and
 * distribution metadata consistent with the performed draw (`distributionIssues`).
 */
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
      for (const problem of distributionIssues(p)) issues.push({ id: p.id, problem });
    }
  }
  return issues;
}

/**
 * The registry hash input of one parameter: id, nominal value, bounds, the draw kind the sampler performs and the
 * distribution metadata (C7: changed draw semantics are a different registry).
 */
function paramHashKey(d: ParamDef): string {
  const dist = d.distribution ? `|${stableStringify(d.distribution)}` : '';
  return `${d.id}=${d.value}[${d.low},${d.high}]${drawKindOf(d)}${dist}`;
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
  const registryHash = fnv1a(`${ENGINE_VERSION}|${CONTRACT_FINGERPRINT}|${defs.map(paramHashKey).join(';')}`);
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

/** Inverse CDF of a parameter's draw at latent quantile u ∈ [0, 1). */
function drawAt(d: ParamDef, kind: DrawKind, u: number): number {
  if (kind === 'logTri') return Math.exp(triangularInv(u, Math.log(d.low), Math.log(d.value), Math.log(d.high)));
  if (kind === 'uniform') return d.low + u * (d.high - d.low);
  return triangularInv(u, d.low, d.value, d.high);
}

/** Correlation group of a parameter (D8-02), or undefined when it is drawn independently. */
const groupOf = (d: ParamDef): string | undefined => {
  const g = d.distribution?.correlationGroup;
  return g !== undefined && g.trim() ? g : undefined;
};

/**
 * Latin-hypercube (default) or independent draws of every non-fixed parameter (MODEL_SPEC §8.1).
 * Deterministic in (defs, spec). Parameters are independent unless they declare the same `distribution.correlationGroup`
 * (D8-02): the group's members then share the latent quantiles of its first varied member (perfect rank correlation; the
 * members consume no random numbers of their own, so ungrouped parameters draw exactly as before). Triangular(low, value,
 * high), triangular in log space for 'logTri', uniform on [low, high] for 'uniform'. Returns `count` full vectors in
 * registry order.
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
  const groupU = new Map<string, Float64Array>();
  defs.forEach((d, i) => {
    const kind = drawKindOf(d);
    if (kind === 'fixed' || (only && !only.has(d.id))) return;
    const g = groupOf(d);
    let us = g !== undefined ? groupU.get(g) : undefined;
    if (us === undefined) {
      us = new Float64Array(n);
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
      for (let k = 0; k < n; k++) us[k] = (spec.method ?? 'lhs') === 'lhs' ? ((perm[k] as number) + rng()) / n : rng();
      if (g !== undefined) groupU.set(g, us);
    }
    for (let k = 0; k < n; k++) (out[k] as Float64Array)[i] = drawAt(d, kind, us[k]!);
  });
  return out;
}

/**
 * Map one row of ensemble quantiles u ∈ [0,1)^P (e.g. the planner's `latinHypercube(M, P, rng)` row, dossier 18 §4.15)
 * onto a full parameter vector in registry order. `u.length` must equal the number of non-fixed parameters; fixed
 * parameters keep their nominal value. Members of a correlation group (D8-02) take the quantile of the group's first
 * member (their own column is kept so P is unchanged). Used by the planner domain layer's `simulate(schedule, draw)`.
 */
export function quantilesToParams(defs: readonly ParamDef[], u: ArrayLike<number>): Float64Array {
  const out = new Float64Array(defs.length);
  const groupQ = new Map<string, number>();
  let j = 0;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const kind = drawKindOf(d);
    if (kind === 'fixed') {
      out[i] = d.value;
      continue;
    }
    let q = Math.min(1 - 1e-12, Math.max(0, u[j++] ?? 0.5));
    const g = groupOf(d);
    if (g !== undefined) {
      const lead = groupQ.get(g);
      if (lead === undefined) groupQ.set(g, q);
      else q = lead;
    }
    out[i] = drawAt(d, kind, q);
  }
  return out;
}

/** Number of parameters that vary in draws (the dimension P of the planner's ensemble LHS). */
export function variableParamCount(defs: readonly ParamDef[]): number {
  let n = 0;
  for (const d of defs) if (drawKindOf(d) !== 'fixed') n++;
  return n;
}
