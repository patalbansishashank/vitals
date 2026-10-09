// Runtime fitter (R2 sec. 5.4): morph weights are fitted so the mesh's tape-measure girths, two sagittal depths and the
// bideltoid breadth match the engine's AvatarParams. The engine's numbers stay the truth; the mesh follows them.
//
//   x = [muscle m, weight w, locals l_1..l_k]   m in [0, 1], w in [0, 1.4], l in [-limit, limit]; frame fixed
//   r(x) = s*C_mesh_j - C_engine_j (7 rings)  +  beta*(s*D - D_engine) (waist, chest)  +  beta*(s*B - bideltoid)
//          + sqrt(lambda)*l_i  +  sqrt(mu)*(m - m0), sqrt(mu)*(w - w0)        s = stature / mesh height
//   projected Levenberg-Marquardt, forward-difference Jacobian on the measured-vertex subset only.
// Constants are PROPOSED (R2): lambda 0.05, mu 0.5 as R2; beta 0.38 (see FIT.beta); priors m0 from FFMI, w0 from FMI.

import type { AvatarParams } from '@/engine/body';
import type { RingId } from './manifest';
import { RING_IDS } from './manifest';
import { measureMesh, measuredVertices, type MeshMeasures } from './measure';
import { SubsetModel, type FigureModel, type MorphState } from './model';

export const FIT = {
  lambda: 0.05,
  mu: 0.5,
  /** Weight of the depth/breadth residuals relative to girths. 0.38 keeps girths (the gate) primary when the
   * engine's depth ratio and girth conflict on a very large body; calibrated with the rounded keys on the 304-body gate. */
  beta: 0.38,
  /**
   * Local targets may be extrapolated beyond MakeHuman's own slider range (+-1): the engine reaches bodies (BMI 50,
   * waist 160 cm) that MakeHuman's weight macro does not. Waist and thigh need the most room. PROPOSED.
   */
  localLimit: 2.5,
  /** Heavy input range; model.ts saturates the extension beyond the authored max. */
  weightLimit: 1.4,
  localLimitById: { waist: 7, thigh: 4, belly: 3, neck: 3.5 } as Record<string, number>,
  /** FFMI0 19.6 M / 16.0 F (dossier 14), span 4.5 (R2, PROPOSED). */
  ffmi0: { male: 19.6, female: 16.0 },
  ffmiSpan: 4.5,
  /** FMI_ref 5.5 M / 8.0 F, span 6 / 8 (R2, PROPOSED, calibrate). */
  fmiRef: { male: 5.5, female: 8.0 },
  fmiSpan: { male: 6, female: 8 },
} as const;

export interface FitTargets {
  heightCm: number;
  girths: Record<RingId, number>;
  waistDepthCm: number;
  chestDepthCm: number;
  bideltoidCm: number;
}

export function targetsFromParams(p: AvatarParams): FitTargets {
  const c = p.circumferences;
  const depth = (id: string) => p.levels.find((l) => l.id === id)?.sideDepthCm ?? 0;
  return {
    heightCm: p.heightCm,
    girths: { neck: c.neckCm, chest: c.chestCm, waist: c.waistCm, hip: c.hipCm, thigh: c.thighCm, calf: c.calfCm, arm: c.armCm },
    waistDepthCm: depth('waist'),
    chestDepthCm: depth('chest'),
    bideltoidCm: c.bideltoidCm,
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function priors(p: AvatarParams): { muscle: number; weight: number } {
  const sex = p.sex === 'female' ? 'female' : 'male';
  return {
    muscle: clamp(0.5 + (0.5 * (p.outputs.ffmi - FIT.ffmi0[sex])) / FIT.ffmiSpan, 0, 1),
    weight: clamp(0.5 + (0.5 * (p.outputs.fmi - FIT.fmiRef[sex])) / FIT.fmiSpan[sex], 0, 1),
  };
}

export interface FitResult {
  state: MorphState;
  /** cm per mesh unit so that the mesh has the target stature. */
  scale: number;
  /** Signed errors (cm) of the scaled mesh against the targets. */
  errors: { girths: Record<RingId, number>; waistDepth: number; chestDepth: number; bideltoid: number };
  maxGirthErrorCm: number;
  iterations: number;
  ms: number;
}

/** Solves A x = b for a small dense SPD system (Gaussian elimination with partial pivoting). */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]!) > Math.abs(M[p * n + c]!)) p = r;
    if (p !== c) {
      for (let k = 0; k < n; k++) [M[c * n + k], M[p * n + k]] = [M[p * n + k]!, M[c * n + k]!];
      [x[c], x[p]] = [x[p]!, x[c]!];
    }
    const d = M[c * n + c]! || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c]! / d;
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] = M[r * n + k]! - f * M[c * n + k]!;
      x[r] = x[r]! - f * x[c]!;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]!;
    for (let k = r + 1; k < n; k++) s -= M[r * n + k]! * x[k]!;
    x[r] = s / (M[r * n + r]! || 1e-12);
  }
  return x;
}

export class FigureFitter {
  private readonly sub: SubsetModel;
  private readonly buf: Float32Array;
  private readonly buf2: Float32Array;
  private readonly slot: (v: number) => number;
  readonly localIds: string[];

  constructor(readonly model: FigureModel) {
    this.sub = new SubsetModel(model, measuredVertices(model.manifest));
    this.buf = new Float32Array(3 * this.sub.size);
    this.buf2 = new Float32Array(3 * this.sub.size);
    const s = this.sub.slot;
    this.slot = (v) => s[v]!;
    this.localIds = model.localIds;
  }

  private stateOf(x: Float64Array, frame: number): MorphState {
    const locals: Record<string, number> = {};
    this.localIds.forEach((id, i) => (locals[id] = x[2 + i]!));
    return { frame, muscle: x[0]!, weight: x[1]!, locals };
  }

  /** Mesh measures of a morph state (unscaled). */
  measure(state: MorphState): MeshMeasures {
    return measureMesh(this.sub.evaluate(state, this.buf), this.model.manifest, this.slot);
  }

  private residuals(x: Float64Array, frame: number, t: FitTargets, prior: { muscle: number; weight: number }, out: Float64Array, positions?: Float32Array): void {
    const m = positions ? measureMesh(positions, this.model.manifest, this.slot) : this.measure(this.stateOf(x, frame));
    const s = t.heightCm / m.height;
    let k = 0;
    for (const id of RING_IDS) out[k++] = s * m.rings[id].girth - t.girths[id];
    out[k++] = FIT.beta * (s * m.rings.waist.depth - t.waistDepthCm);
    out[k++] = FIT.beta * (s * m.rings.chest.depth - t.chestDepthCm);
    out[k++] = FIT.beta * (s * m.breadth - t.bideltoidCm);
    for (let i = 2; i < x.length; i++) out[k++] = Math.sqrt(FIT.lambda) * x[i]!;
    out[k++] = Math.sqrt(FIT.mu) * (x[0]! - prior.muscle);
    out[k] = Math.sqrt(FIT.mu) * (x[1]! - prior.weight);
  }

  /**
   * Fits morph weights to engine params. `warm` (a previous result) starts from its weights and needs few iterations,
   * e.g. while a before -> after morph animates.
   */
  fit(params: AvatarParams, frame: number, options: { warm?: FitResult; maxIterations?: number } = {}): FitResult {
    const t0 = performance.now();
    const t = targetsFromParams(params);
    const prior = priors(params);
    const L = this.localIds.length;
    const n = 2 + L;
    const nr = RING_IDS.length + 3 + L + 2;
    const lo = new Float64Array(n), hi = new Float64Array(n);
    hi[0] = 1;
    hi[1] = FIT.weightLimit;
    for (let i = 2; i < n; i++) {
      const lim = FIT.localLimitById[this.localIds[i - 2]!] ?? FIT.localLimit;
      lo[i] = -lim;
      hi[i] = lim;
    }
    let x = new Float64Array(n);
    if (options.warm) {
      const w = options.warm.state;
      x[0] = w.muscle;
      x[1] = w.weight;
      this.localIds.forEach((id, i) => (x[2 + i] = w.locals[id] ?? 0));
    } else {
      x[0] = prior.muscle;
      x[1] = prior.weight;
    }
    const maxIt = options.maxIterations ?? (options.warm ? 6 : 30);
    const r = new Float64Array(nr), r2 = new Float64Array(nr);
    const J = new Float64Array(nr * n);
    const cost = (v: Float64Array) => v.reduce((a, b) => a + b * b, 0);
    this.residuals(x, frame, t, prior, r);
    let c = cost(r);
    let damping = 1e-3;
    let it = 0;
    let converged = false;
    const c0 = new Float64Array(this.sub.targets.length), c1 = new Float64Array(this.sub.targets.length);
    for (; it < maxIt && !converged; it++) {
      // Jacobian (forward differences stepping into the feasible side); positions are updated incrementally because
      // a step in one weight changes only a few target coefficients
      const P0 = this.sub.evaluate(this.stateOf(x, frame), this.buf);
      this.sub.coefficientVector(this.stateOf(x, frame), c0);
      for (let j = 0; j < n; j++) {
        const h = j < 2 ? 1e-3 : 2e-3;
        const xj = x[j]!;
        const step = xj + h > hi[j]! ? -h : h;
        x[j] = xj + step;
        this.sub.coefficientVector(this.stateOf(x, frame), c1);
        this.residuals(x, frame, t, prior, r2, this.sub.evaluateDiff(P0, c0, c1, this.buf2));
        x[j] = xj;
        for (let i = 0; i < nr; i++) J[i * n + j] = (r2[i]! - r[i]!) / step;
      }
      const JtJ = new Float64Array(n * n), Jtr = new Float64Array(n);
      for (let a = 0; a < n; a++) {
        for (let i = 0; i < nr; i++) Jtr[a] = Jtr[a]! + J[i * n + a]! * r[i]!;
        for (let b = a; b < n; b++) {
          let s = 0;
          for (let i = 0; i < nr; i++) s += J[i * n + a]! * J[i * n + b]!;
          JtJ[a * n + b] = s;
          JtJ[b * n + a] = s;
        }
      }
      // active set: a parameter at a bound whose descent direction points outward is frozen this iteration
      const free: number[] = [];
      for (let a = 0; a < n; a++) {
        const atLo = x[a]! <= lo[a]! + 1e-9 && Jtr[a]! > 0;
        const atHi = x[a]! >= hi[a]! - 1e-9 && Jtr[a]! < 0;
        if (!atLo && !atHi) free.push(a);
      }
      const nf = free.length;
      let improved = false;
      for (let tries = 0; tries < 8 && !improved && nf > 0; tries++) {
        const A = new Float64Array(nf * nf), g = new Float64Array(nf);
        for (let a = 0; a < nf; a++) {
          g[a] = -Jtr[free[a]!]!;
          for (let b = 0; b < nf; b++) A[a * nf + b] = JtJ[free[a]! * n + free[b]!]!;
          A[a * nf + a] = A[a * nf + a]! * (1 + damping) + 1e-9;
        }
        const d = solve(A, g, nf);
        const xn = Float64Array.from(x);
        for (let a = 0; a < nf; a++) xn[free[a]!] = clamp(x[free[a]!]! + d[a]!, lo[free[a]!]!, hi[free[a]!]!);
        this.residuals(xn, frame, t, prior, r2);
        const cn = cost(r2);
        if (cn < c) {
          improved = true;
          const gain = c - cn;
          x = xn;
          r.set(r2);
          c = cn;
          damping = Math.max(damping / 3, 1e-6);
          if (gain < 1e-7) converged = true;
        } else damping *= 4;
      }
      if (!improved) break;
    }
    const state = this.stateOf(x, frame);
    const m = this.measure(state);
    const s = t.heightCm / m.height;
    const girths = {} as Record<RingId, number>;
    let maxErr = 0;
    for (const id of RING_IDS) {
      girths[id] = s * m.rings[id].girth - t.girths[id];
      maxErr = Math.max(maxErr, Math.abs(girths[id]));
    }
    const result: FitResult = {
      state,
      scale: s,
      errors: {
        girths,
        waistDepth: s * m.rings.waist.depth - t.waistDepthCm,
        chestDepth: s * m.rings.chest.depth - t.chestDepthCm,
        bideltoid: s * m.breadth - t.bideltoidCm,
      },
      maxGirthErrorCm: maxErr,
      iterations: it,
      ms: performance.now() - t0,
    };
    // Extreme measured waists can trap a projected solve at several bounds together. Retry from a neutral macro
    // only when the girth contract was missed; warm slider updates keep their six-iteration path.
    if (!options.warm && maxErr > 1) {
      const retry = this.fit(params, frame, { maxIterations: maxIt, warm: { ...result, state: { frame, muscle: prior.muscle, weight: 0.5, locals: {} } } });
      if (retry.maxGirthErrorCm < result.maxGirthErrorCm) return { ...retry, ms: performance.now() - t0 };
    }
    return result;
  }
}
