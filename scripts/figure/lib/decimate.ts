// Vertex-preserving mesh decimation: quadric-error half-edge collapse (Garland-Heckbert) onto EXISTING vertices, so the
// kept vertices are a subset of the input and every morph target stays valid by index (R2 sec. 2.2).
// Quadrics are accumulated over several shapes (base + extreme morphs) so regions that only bulge under a morph keep
// enough vertices. Boundary vertices and `locked` vertices are never removed; collapses that flip or squash a
// triangle in any shape, or break the manifold link condition, are rejected.

export interface DecimateInput {
  /** One or more shapes of the same mesh, xyz per vertex. shapes[0] is the reference. */
  shapes: readonly Float64Array[];
  triangles: Uint32Array;
  vertexCount: number;
  targetVertices: number;
  locked?: ReadonlySet<number>;
  /** Optional per-vertex cost multiplier (e.g. > 1 on the face/hands to keep detail). */
  importance?: Float64Array;
}

export interface DecimateResult {
  /** Old vertex index of each kept vertex (new index = position in this array). */
  kept: Uint32Array;
  /** Triangles in NEW indices. */
  triangles: Uint32Array;
}

type Quadric = Float64Array; // 10 coefficients of the symmetric 4x4 matrix

function planeQuadric(q: Float64Array, o: number, a: number, b: number, c: number, d: number, w: number): void {
  q[o] = q[o]! + w * a * a;
  q[o + 1] = q[o + 1]! + w * a * b;
  q[o + 2] = q[o + 2]! + w * a * c;
  q[o + 3] = q[o + 3]! + w * a * d;
  q[o + 4] = q[o + 4]! + w * b * b;
  q[o + 5] = q[o + 5]! + w * b * c;
  q[o + 6] = q[o + 6]! + w * b * d;
  q[o + 7] = q[o + 7]! + w * c * c;
  q[o + 8] = q[o + 8]! + w * c * d;
  q[o + 9] = q[o + 9]! + w * d * d;
}

function evalQ(q: Quadric, o: number, o2: number, x: number, y: number, z: number): number {
  const s = (k: number) => q[o + k]! + q[o2 + k]!;
  return (
    s(0) * x * x +
    2 * s(1) * x * y +
    2 * s(2) * x * z +
    2 * s(3) * x +
    s(4) * y * y +
    2 * s(5) * y * z +
    2 * s(6) * y +
    s(7) * z * z +
    2 * s(8) * z +
    s(9)
  );
}

/** Binary min-heap of (cost, u, v, stamp). */
class Heap {
  private cost: number[] = [];
  private u: number[] = [];
  private v: number[] = [];
  private stamp: number[] = [];
  get size(): number {
    return this.cost.length;
  }
  push(c: number, u: number, v: number, s: number): void {
    this.cost.push(c);
    this.u.push(u);
    this.v.push(v);
    this.stamp.push(s);
    let i = this.cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p]! <= this.cost[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number, number, number] {
    const top: [number, number, number, number] = [this.cost[0]!, this.u[0]!, this.v[0]!, this.stamp[0]!];
    const last = this.cost.length - 1;
    this.swap(0, last);
    this.cost.pop();
    this.u.pop();
    this.v.pop();
    this.stamp.pop();
    let i = 0;
    const n = this.cost.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.cost[l]! < this.cost[m]!) m = l;
      if (r < n && this.cost[r]! < this.cost[m]!) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(i: number, j: number): void {
    for (const a of [this.cost, this.u, this.v, this.stamp]) {
      const t = a[i]!;
      a[i] = a[j]!;
      a[j] = t;
    }
  }
}

export function decimate(input: DecimateInput): DecimateResult {
  const { shapes, vertexCount: n, targetVertices } = input;
  const S = shapes.length;
  const tri = Uint32Array.from(input.triangles);
  const F = tri.length / 3;
  const faceAlive = new Uint8Array(F).fill(1);
  const vAlive = new Uint8Array(n);
  const vf: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) vf[tri[3 * f + k]!]!.add(f);
  for (let v = 0; v < n; v++) if (vf[v]!.size) vAlive[v] = 1;

  // boundary vertices (edge used by one face)
  const edgeCount = new Map<number, number>();
  const ekey = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) {
      const key = ekey(tri[3 * f + k]!, tri[3 * f + ((k + 1) % 3)]!);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  const fixed = new Uint8Array(n);
  for (const [key, c] of edgeCount)
    if (c !== 2) {
      fixed[Math.floor(key / n)] = 1;
      fixed[key % n] = 1;
    }
  for (const v of input.locked ?? []) fixed[v] = 1;

  // quadrics per shape per vertex
  const Q = new Float64Array(S * n * 10);
  for (let s = 0; s < S; s++) {
    const P = shapes[s]!;
    for (let f = 0; f < F; f++) {
      const [a, b, c] = [tri[3 * f]!, tri[3 * f + 1]!, tri[3 * f + 2]!];
      const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!;
      const wx = P[3 * c]! - P[3 * a]!, wy = P[3 * c + 1]! - P[3 * a + 1]!, wz = P[3 * c + 2]! - P[3 * a + 2]!;
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;
      const area = len / 2;
      nx /= len;
      ny /= len;
      nz /= len;
      const d = -(nx * P[3 * a]! + ny * P[3 * a + 1]! + nz * P[3 * a + 2]!);
      for (const v of [a, b, c]) planeQuadric(Q, (s * n + v) * 10, nx, ny, nz, d, area);
    }
  }

  const imp = input.importance;
  const stamp = new Uint32Array(n);
  const cost = (u: number, v: number): number => {
    let c = 0;
    for (let s = 0; s < S; s++) {
      const P = shapes[s]!;
      c += evalQ(Q, (s * n + u) * 10, (s * n + v) * 10, P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!);
    }
    return Math.max(c, 0) * (imp ? Math.max(imp[u]!, imp[v]!) : 1);
  };
  const neighbours = (v: number): Set<number> => {
    const out = new Set<number>();
    for (const f of vf[v]!) for (let k = 0; k < 3; k++) out.add(tri[3 * f + k]!);
    out.delete(v);
    return out;
  };

  const heap = new Heap();
  const pushVertex = (u: number) => {
    if (!vAlive[u] || fixed[u]) return;
    stamp[u] = stamp[u]! + 1;
    for (const v of neighbours(u)) heap.push(cost(u, v), u, v, stamp[u]!);
  };
  for (let u = 0; u < n; u++) pushVertex(u);

  // would collapsing u -> v flip/squash a remaining face in any shape?
  const flips = (u: number, v: number): boolean => {
    for (const f of vf[u]!) {
      const a = tri[3 * f]!, b = tri[3 * f + 1]!, c = tri[3 * f + 2]!;
      if (a === v || b === v || c === v) continue; // removed by the collapse
      for (let s = 0; s < S; s++) {
        const P = shapes[s]!;
        const nOld = normal(P, a, b, c);
        const nNew = normal(P, a === u ? v : a, b === u ? v : b, c === u ? v : c);
        const lo = Math.hypot(...nOld), ln = Math.hypot(...nNew);
        if (ln < 1e-12) return true;
        const dot = (nOld[0] * nNew[0] + nOld[1] * nNew[1] + nOld[2] * nNew[2]) / (lo * ln);
        if (dot < 0.3) return true;
        // reject slivers: new triangle's min angle-ish quality
        if (quality(P, a === u ? v : a, b === u ? v : b, c === u ? v : c) < 0.08) return true;
      }
    }
    return false;
  };

  let alive = 0;
  for (let v = 0; v < n; v++) alive += vAlive[v]!;
  while (alive > targetVertices && heap.size) {
    const [, u, v, s] = heap.pop();
    if (!vAlive[u] || !vAlive[v] || s !== stamp[u] || fixed[u]) continue;
    // still adjacent?
    let shared = 0;
    for (const f of vf[u]!) if (vf[v]!.has(f)) shared++;
    if (shared !== 2) continue;
    // link condition: common neighbours must be exactly the 2 opposite vertices
    const nu = neighbours(u);
    let common = 0;
    for (const w of neighbours(v)) if (nu.has(w)) common++;
    if (common !== 2) continue;
    if (flips(u, v)) continue;
    // collapse
    for (const f of [...vf[u]!]) {
      const has = tri[3 * f] === v || tri[3 * f + 1] === v || tri[3 * f + 2] === v;
      if (has) {
        faceAlive[f] = 0;
        for (let k = 0; k < 3; k++) vf[tri[3 * f + k]!]!.delete(f);
      } else {
        for (let k = 0; k < 3; k++) if (tri[3 * f + k] === u) tri[3 * f + k] = v;
        vf[v]!.add(f);
      }
    }
    vf[u]!.clear();
    vAlive[u] = 0;
    alive--;
    for (let s2 = 0; s2 < S; s2++) for (let k = 0; k < 10; k++) Q[(s2 * n + v) * 10 + k] = Q[(s2 * n + v) * 10 + k]! + Q[(s2 * n + u) * 10 + k]!;
    pushVertex(v);
    for (const w of neighbours(v)) pushVertex(w);
  }

  const map = new Int32Array(n).fill(-1);
  const kept: number[] = [];
  for (let v = 0; v < n; v++)
    if (vAlive[v]) {
      map[v] = kept.length;
      kept.push(v);
    }
  const out: number[] = [];
  for (let f = 0; f < F; f++) if (faceAlive[f]) out.push(map[tri[3 * f]!]!, map[tri[3 * f + 1]!]!, map[tri[3 * f + 2]!]!);
  return { kept: Uint32Array.from(kept), triangles: Uint32Array.from(out) };
}

function normal(P: Float64Array, a: number, b: number, c: number): [number, number, number] {
  const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!;
  const wx = P[3 * c]! - P[3 * a]!, wy = P[3 * c + 1]! - P[3 * a + 1]!, wz = P[3 * c + 2]! - P[3 * a + 2]!;
  return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
}

/** 4*sqrt(3)*area / sum of squared edge lengths: 1 for equilateral, 0 for degenerate. */
function quality(P: Float64Array, a: number, b: number, c: number): number {
  const n = normal(P, a, b, c);
  const area2 = Math.hypot(...n);
  const e = (i: number, j: number) => (P[3 * i]! - P[3 * j]!) ** 2 + (P[3 * i + 1]! - P[3 * j + 1]!) ** 2 + (P[3 * i + 2]! - P[3 * j + 2]!) ** 2;
  const s = e(a, b) + e(b, c) + e(c, a);
  return s > 0 ? (2 * Math.sqrt(3) * area2) / s : 0;
}

/** Boundary loops (ordered vertex lists) of a triangle mesh. */
export function boundaryLoops(triangles: Uint32Array): number[][] {
  const next = new Map<number, number>();
  const count = new Map<string, number>();
  const F = triangles.length / 3;
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * f + k]!, b = triangles[3 * f + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * f + k]!, b = triangles[3 * f + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (count.get(key) === 1) next.set(b, a); // reversed: loop runs opposite to the face winding
    }
  const loops: number[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let v: number | undefined = start;
    while (v !== undefined && !seen.has(v)) {
      seen.add(v);
      loop.push(v);
      v = next.get(v);
    }
    loops.push(loop);
  }
  return loops;
}
