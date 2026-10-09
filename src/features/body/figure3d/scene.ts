// Engine params -> placed mesh positions (no DOM). Fits morph weights (warm-started), evaluates the full mesh, scales
// it to stature and puts the floor at y = 0. Also builds the lean core (two-layer mode) and interpolates morph states.

import type { AvatarParams } from '@/engine/body';
import { FigureFitter, type FitResult } from './fit';
import { FigureModel, type MorphState } from './model';
import type { FigureAsset } from './asset';
import { spaceArms, type ArmSpacing } from './armPose';

export interface PlacedMesh {
  positions: Float32Array;
  /** Bounding-box centres for the front (x) and side (z) views, cm. */
  centre: { front: number; side: number };
  /** Bounding-box half extents about those centres, cm. */
  half: { front: number; side: number };
  heightCm: number;
  armSpacing: ArmSpacing;
}

export function lerpState(a: MorphState, b: MorphState, t: number): MorphState {
  const locals: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.locals), ...Object.keys(b.locals)])) locals[k] = (a.locals[k] ?? 0) + ((b.locals[k] ?? 0) - (a.locals[k] ?? 0)) * t;
  return {
    frame: a.frame + (b.frame - a.frame) * t,
    muscle: a.muscle + (b.muscle - a.muscle) * t,
    weight: a.weight + (b.weight - a.weight) * t,
    locals,
  };
}

/**
 * Lean core of a fitted body (R2 sec. 5.2): weight macro at its lean end (0), girth-adding locals dropped. Locals that
 * shrink the body are kept, otherwise the core would poke through an envelope that the fit made slimmer than MakeHuman's.
 */
export function coreState(s: MorphState): MorphState {
  const locals: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.locals)) if (v < 0) locals[k] = v;
  return { frame: s.frame, muscle: s.muscle, weight: 0, locals };
}

export class FigureScene {
  readonly model: FigureModel;
  readonly fitter: FigureFitter;

  constructor(asset: FigureAsset) {
    this.model = new FigureModel(asset);
    this.fitter = new FigureFitter(this.model);
  }

  fit(params: AvatarParams, frame: number, warm?: FitResult): FitResult {
    return this.fitter.fit(params, frame, { warm });
  }

  /**
   * Evaluates a morph state and places it: uniformly scaled to `heightCm` (crown to sole), floor at 0. Placing by
   * stature (not by a fitted scale factor) keeps the lean core, which MakeHuman makes slightly taller than a heavy
   * body, inside the envelope.
   */
  place(state: MorphState, heightCm: number, out?: Float32Array, armSpacing?: ArmSpacing): PlacedMesh {
    const P = this.model.evaluate(state, out);
    const { top, bottom } = this.model.manifest.height;
    const floor = P[3 * bottom + 1]!;
    const scale = heightCm / (P[3 * top + 1]! - floor);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      P[i] = P[i]! * scale;
      P[i + 1] = (P[i + 1]! - floor) * scale;
      P[i + 2] = P[i + 2]! * scale;
      if (P[i]! < x0) x0 = P[i]!;
      if (P[i]! > x1) x1 = P[i]!;
      if (P[i + 2]! < z0) z0 = P[i + 2]!;
      if (P[i + 2]! > z1) z1 = P[i + 2]!;
    }
    const spacing = spaceArms(P, this.model.indices, this.model.manifest, heightCm, state.frame, armSpacing);
    // The pose correction can widen the figure, so include it in every mount's
    // framing and overlay extents.
    x0 = Infinity; x1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]!); x1 = Math.max(x1, P[i]!); }
    return {
      positions: P,
      centre: { front: (x0 + x1) / 2, side: (z0 + z1) / 2 },
      half: { front: (x1 - x0) / 2, side: (z1 - z0) / 2 },
      heightCm: P[3 * top + 1]!,
      armSpacing: spacing,
    };
  }
}
