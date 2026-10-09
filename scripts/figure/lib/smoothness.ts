// How smooth a per-vertex displacement field (a morph target, or a whole morph) is on a triangle mesh.
// A vertex is judged against its surroundings: the field over its two-ring neighbours (itself excluded) is fitted
// with one affine map of the rest position (d = A p + b, least squares), and the residual at the vertex is the
// part of its displacement that the surroundings do not explain. An affine field (a scaling, a shear, a rotation,
// a translation) has zero residual everywhere whatever the mesh density, so the measure sees only kinks and spikes.

export interface Rings {
  /** One-ring neighbours of vertex i: list[start[i] .. start[i + 1]). */
  start: Uint32Array;
  list: Uint32Array;
}

export function oneRing(triangles: ArrayLike<number>, vertexCount: number): Rings {
  const sets = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let f = 0; f < triangles.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = triangles[f + k]!, b = triangles[f + ((k + 1) % 3)]!;
      sets[a]!.add(b);
      sets[b]!.add(a);
    }
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) start[i + 1] = start[i]! + sets[i]!.size;
  const list = new Uint32Array(start[vertexCount]!);
  for (let i = 0; i < vertexCount; i++) list.set([...sets[i]!].sort((a, b) => a - b), start[i]!);
  return { start, list };
}

/** Two-ring neighbourhood of each vertex (itself excluded), from the one-ring. */
export function twoRing(rings: Rings): number[][] {
  const n = rings.start.length - 1;
  const out: number[][] = [];
  for (let v = 0; v < n; v++) {
    const s = new Set<number>();
    for (let e = rings.start[v]!; e < rings.start[v + 1]!; e++) {
      const j = rings.list[e]!;
      s.add(j);
      for (let g = rings.start[j]!; g < rings.start[j + 1]!; g++) s.add(rings.list[g]!);
    }
    s.delete(v);
    out.push([...s]);
  }
  return out;
}

/** Solves the small SPD system A x = b (Gaussian elimination), n <= 4. */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = Float64Array.from(A), x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]!) > Math.abs(M[p * n + c]!)) p = r;
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = M[c * n + k]!; M[c * n + k] = M[p * n + k]!; M[p * n + k] = t; }
      const t = x[c]!; x[c] = x[p]!; x[p] = t;
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

/**
 * Per-vertex residual (cm) of the displacement field `d` against the affine fit of its two-ring on the rest shape
 * `rest`. `prediction`, when given, receives the fitted displacement at each vertex (what the surroundings expect).
 */
export function affineResidual(
  rest: ArrayLike<number>,
  d: ArrayLike<number>,
  neighbours: readonly number[][],
  prediction?: Float64Array,
): Float64Array {
  const n = neighbours.length;
  const out = new Float64Array(n);
  const G = new Float64Array(16), rhs = new Float64Array(12);
  for (let v = 0; v < n; v++) {
    const nb = neighbours[v]!;
    if (nb.length < 6) { out[v] = 0; if (prediction) for (let a = 0; a < 3; a++) prediction[3 * v + a] = d[3 * v + a]!; continue; }
    G.fill(0); rhs.fill(0);
    // Tikhonov on the linear part keeps a flat two-ring (no spread along the normal) solvable.
    for (let k = 0; k < 3; k++) G[k * 4 + k] = 1e-6;
    for (const j of nb) {
      const x = [rest[3 * j]! - rest[3 * v]!, rest[3 * j + 1]! - rest[3 * v + 1]!, rest[3 * j + 2]! - rest[3 * v + 2]!, 1];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) G[r * 4 + c] = G[r * 4 + c]! + x[r]! * x[c]!;
        for (let a = 0; a < 3; a++) rhs[a * 4 + r] = rhs[a * 4 + r]! + x[r]! * d[3 * j + a]!;
      }
    }
    let res = 0;
    for (let a = 0; a < 3; a++) {
      const coef = solve(G, rhs.subarray(a * 4, a * 4 + 4), 4);
      const predicted = coef[3]!; // the fit at the vertex itself (x = 0)
      if (prediction) prediction[3 * v + a] = predicted;
      res += (d[3 * v + a]! - predicted) ** 2;
    }
    out[v] = Math.sqrt(res);
  }
  return out;
}

export interface Distribution { n: number; mean: number; p50: number; p99: number; max: number; argmax: number; over: number }

/** Summary of a per-vertex measure, with how many vertices exceed `limit`. */
export function distribution(values: ArrayLike<number>, limit: number, mask?: (v: number) => boolean): Distribution {
  const kept: number[] = [];
  let argmax = -1, max = -Infinity, over = 0;
  for (let v = 0; v < values.length; v++) {
    if (mask && !mask(v)) continue;
    const x = values[v]!;
    kept.push(x);
    if (x > max) { max = x; argmax = v; }
    if (x > limit) over++;
  }
  kept.sort((a, b) => a - b);
  const q = (p: number) => kept[Math.min(kept.length - 1, Math.floor(p * kept.length))] ?? 0;
  return { n: kept.length, mean: kept.reduce((s, x) => s + x, 0) / (kept.length || 1), p50: q(0.5), p99: q(0.99), max: max === -Infinity ? 0 : max, argmax, over };
}

/** One uniform-Laplacian step of a 3-vector field by `factor` toward the one-ring mean (in place via `spare`). */
export function laplacianStep(field: Float64Array, spare: Float64Array, rings: Rings, factor: number, mask?: Uint8Array): void {
  const n = rings.start.length - 1;
  for (let v = 0; v < n; v++) {
    const count = rings.start[v + 1]! - rings.start[v]!;
    for (let a = 0; a < 3; a++) {
      if (!count || (mask && !mask[v])) { spare[3 * v + a] = field[3 * v + a]!; continue; }
      let sum = 0;
      for (let e = rings.start[v]!; e < rings.start[v + 1]!; e++) sum += field[3 * rings.list[e]! + a]!;
      spare[3 * v + a] = field[3 * v + a]! + factor * (sum / count - field[3 * v + a]!);
    }
  }
  field.set(spare);
}

/** Taubin lambda/mu smoothing of a 3-vector field: `passes` shrink/inflate pairs. */
export function taubinField(field: Float64Array, rings: Rings, passes: number, lambda = 0.5, mu = -0.53, mask?: Uint8Array): void {
  const spare = new Float64Array(field.length);
  for (let p = 0; p < passes; p++) {
    laplacianStep(field, spare, rings, lambda, mask);
    laplacianStep(field, spare, rings, mu, mask);
  }
}

/**
 * Outlier repair: where the residual against the two-ring affine fit exceeds `limit`, the vertex's displacement is
 * replaced by the fit (what its surroundings expect), iterated so chains of kinks settle. Everything under the
 * limit is left exactly as authored. Returns the number of vertices changed.
 */
export function repairOutliers(rest: ArrayLike<number>, d: Float64Array, neighbours: readonly number[][], limit: number, rounds = 3, mask?: Uint8Array): number {
  const n = neighbours.length;
  const prediction = new Float64Array(3 * n);
  let changed = 0;
  for (let r = 0; r < rounds; r++) {
    const res = affineResidual(rest, d, neighbours, prediction);
    let any = 0;
    for (let v = 0; v < n; v++)
      if (res[v]! > limit && (!mask || mask[v])) {
        for (let a = 0; a < 3; a++) d[3 * v + a] = prediction[3 * v + a]!;
        any++;
      }
    changed += any;
    if (!any) break;
  }
  return changed;
}

/**
 * Bump of a displacement field: at each vertex, the part of (d_v - mean of the one-ring's d) along the rest normal,
 * cm. A displacement that slides the surface along itself scores nothing; a vertex pushed out of or into the surface
 * relative to its neighbours scores its height. One ring (not two), so smooth bending scores little.
 */
export function normalBump(rest: ArrayLike<number>, d: ArrayLike<number>, rings: Rings, triangles: ArrayLike<number>): Float64Array {
  const n = rings.start.length - 1;
  const normals = new Float64Array(3 * n);
  for (let f = 0; f < triangles.length; f += 3) {
    const a = 3 * triangles[f]!, b = 3 * triangles[f + 1]!, c = 3 * triangles[f + 2]!;
    const ux = rest[b]! - rest[a]!, uy = rest[b + 1]! - rest[a + 1]!, uz = rest[b + 2]! - rest[a + 2]!;
    const wx = rest[c]! - rest[a]!, wy = rest[c + 1]! - rest[a + 1]!, wz = rest[c + 2]! - rest[a + 2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const v of [a, b, c]) { normals[v] = normals[v]! + nx; normals[v + 1] = normals[v + 1]! + ny; normals[v + 2] = normals[v + 2]! + nz; }
  }
  const out = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const count = rings.start[v + 1]! - rings.start[v]!;
    if (!count) continue;
    const l = Math.hypot(normals[3 * v]!, normals[3 * v + 1]!, normals[3 * v + 2]!) || 1;
    let s = 0;
    for (let a = 0; a < 3; a++) {
      let mean = 0;
      for (let e = rings.start[v]!; e < rings.start[v + 1]!; e++) mean += d[3 * rings.list[e]! + a]!;
      s += (d[3 * v + a]! - mean / count) * (normals[3 * v + a]! / l);
    }
    out[v] = Math.abs(s);
  }
  return out;
}
