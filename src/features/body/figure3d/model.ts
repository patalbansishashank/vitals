// Morph model: shape = base + sum_k c_k * target_k, with MakeHuman's macro semantics (R2 sec. 2.2):
//   frame f in [0,1] mixes the two adult end shapes linearly (0 = hips-led, 1 = shoulders-led),
//   muscle m and weight w in [0,1] blend piecewise-linearly min (0) -> average (0.5) -> max (1), as products m x w,
//   locals l in [-L, L] use the incr target for l > 0 and the decr target for l < 0.
// Evaluation is CPU-side (R2 sec. 2.3): weights only change when inputs change.

import type { FigureAsset } from './asset';
import type { FrameEnd, MacroLevel } from './manifest';

export interface MorphState {
  frame: number;
  muscle: number;
  weight: number;
  /** Local target weights by id (see manifest.model.locals). */
  locals: Record<string, number>;
}

export interface Coefficient {
  target: number;
  c: number;
}

/**
 * MakeHuman factors within the authored range. Above max, a C2 saturation bounds the extension to 40% of
 * the parameter range: derivative 1 at the join, tending smoothly to zero. Both full and subset evaluation use
 * these coefficients, so the fitter measures the exact same extension that is drawn.
 */
export function macroFactors(x: number): Record<MacroLevel, number> {
  const nonnegative = Math.max(0, x);
  const v = nonnegative <= 1 ? nonnegative : 1 + 0.4 * Math.tanh((nonnegative - 1) / 0.4);
  return v < 0.5
    ? { min: 1 - 2 * v, average: 2 * v, max: 0 }
    : { min: 0, average: 2 - 2 * v, max: 2 * v - 1 };
}

export class FigureModel {
  readonly vertexCount: number;
  readonly base: Float32Array;
  readonly indices: Uint16Array;
  readonly localIds: string[];
  /** Targets as an array; index = position. */
  readonly targets: { indices: Uint16Array | null; deltas: Float32Array }[];
  private readonly ids = new Map<string, number>();

  constructor(readonly asset: FigureAsset) {
    this.vertexCount = asset.manifest.vertexCount;
    this.base = asset.base;
    this.indices = asset.indices;
    this.targets = [];
    for (const [id, t] of asset.targets) {
      this.ids.set(id, this.targets.length);
      this.targets.push(t);
    }
    this.localIds = asset.manifest.model.locals.map((l) => l.id);
  }

  get manifest() {
    return this.asset.manifest;
  }

  /** Target coefficients of a morph state (sparse list). */
  coefficients(s: MorphState): Coefficient[] {
    const out: Coefficient[] = [];
    const m = this.manifest.model;
    const push = (id: string | undefined, c: number) => {
      if (!id || c === 0) return;
      const k = this.ids.get(id);
      if (k !== undefined) out.push({ target: k, c });
    };
    const f = Math.min(1, Math.max(0, s.frame));
    const ends: [FrameEnd, number][] = [
      ['hipsLed', 1 - f],
      ['shouldersLed', f],
    ];
    const M = macroFactors(s.muscle);
    const W = macroFactors(s.weight);
    for (const [end, k] of ends) {
      if (k === 0) continue;
      push(m.frame[end], k);
      for (const [key, id] of Object.entries(m.macro[end])) {
        const [ml, wl] = key.split('-') as [MacroLevel, MacroLevel];
        push(id, k * M[ml] * W[wl]);
      }
    }
    for (const l of m.locals) {
      const raw = s.locals[l.id] ?? 0;
      // The pregnancy key supplies distribution, not a second unbounded weight macro.
      // Broad waist/weight keys carry the remaining girth; the fitted and drawn coefficients agree.
      const v = l.id === 'belly' && raw > 0 ? 1.2 * Math.tanh(raw / 1.2) : raw;
      if (v > 0) push(l.incr, v);
      else if (v < 0) push(l.decr, -v);
    }
    return out;
  }

  /** Full evaluation into `out` (interleaved xyz, cm, MakeHuman frame: y up, z front). */
  evaluate(s: MorphState, out: Float32Array = new Float32Array(this.base.length)): Float32Array {
    out.set(this.base);
    for (const { target, c } of this.coefficients(s)) addTarget(out, this.targets[target]!, c);
    return out;
  }
}

function addTarget(
  out: Float32Array,
  t: { indices: Uint16Array | null; deltas: Float32Array },
  c: number,
): void {
  const d = t.deltas;
  if (!t.indices) {
    for (let i = 0; i < d.length; i++) out[i] = out[i]! + c * d[i]!;
    return;
  }
  const idx = t.indices;
  for (let j = 0; j < idx.length; j++) {
    const v = 3 * idx[j]!;
    out[v] = out[v]! + c * d[3 * j]!;
    out[v + 1] = out[v + 1]! + c * d[3 * j + 1]!;
    out[v + 2] = out[v + 2]! + c * d[3 * j + 2]!;
  }
}

/**
 * The same model restricted to a vertex subset (the ones the tape measure reads), for the fitter's inner loop.
 * Positions are dense over the subset; `slot[v]` maps a full vertex index to its subset slot (-1 = not kept).
 */
export class SubsetModel {
  readonly slot: Int32Array;
  readonly base: Float32Array;
  readonly targets: Float32Array[];
  readonly size: number;

  constructor(
    readonly model: FigureModel,
    vertices: Iterable<number>,
  ) {
    const list = [...new Set(vertices)].sort((a, b) => a - b);
    this.size = list.length;
    this.slot = new Int32Array(model.vertexCount).fill(-1);
    list.forEach((v, i) => (this.slot[v] = i));
    this.base = new Float32Array(3 * list.length);
    list.forEach((v, i) => this.base.set(model.base.subarray(3 * v, 3 * v + 3), 3 * i));
    this.targets = model.targets.map((t) => {
      const d = new Float32Array(3 * list.length);
      if (!t.indices) list.forEach((v, i) => d.set(t.deltas.subarray(3 * v, 3 * v + 3), 3 * i));
      else
        t.indices.forEach((v, j) => {
          const i = this.slot[v]!;
          if (i >= 0) d.set(t.deltas.subarray(3 * j, 3 * j + 3), 3 * i);
        });
      return d;
    });
  }

  evaluate(s: MorphState, out: Float32Array): Float32Array {
    out.set(this.base);
    for (const { target, c } of this.model.coefficients(s)) {
      const d = this.targets[target]!;
      for (let i = 0; i < d.length; i++) out[i] = out[i]! + c * d[i]!;
    }
    return out;
  }

  /** Dense coefficient vector (one entry per target) of a morph state. */
  coefficientVector(s: MorphState, out = new Float64Array(this.targets.length)): Float64Array {
    out.fill(0);
    for (const { target, c } of this.model.coefficients(s)) out[target] = out[target]! + c;
    return out;
  }

  /** out = P0 + sum_k (c1_k - c0_k) T_k: cheap re-evaluation when only a few coefficients change (Jacobian columns). */
  evaluateDiff(P0: Float32Array, c0: Float64Array, c1: Float64Array, out: Float32Array): Float32Array {
    out.set(P0);
    for (let k = 0; k < c0.length; k++) {
      const dc = c1[k]! - c0[k]!;
      if (dc === 0) continue;
      const d = this.targets[k]!;
      for (let i = 0; i < d.length; i++) out[i] = out[i]! + dc * d[i]!;
    }
    return out;
  }
}
