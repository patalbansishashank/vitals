/**
 * Partition the fitted outer body into an illustrative under-skin shell and an
 * inner abdominal boundary. MakeHuman's weight morph includes all fat; without
 * this correction it would wrongly depict visceral fat as extra skin thickness.
 * The boundary is an estimate for display, never a measured tissue surface.
 */
export interface ShellPartition {
  outer: Float32Array;
  inner: Float32Array;
  heightCm: number;
  waistHalfWidthCm: number;
  waistHalfDepthCm: number;
  waistCentreZCm: number;
  visceralKg: number;
  trunkSatKg: number;
  trunkShares: { abdominal: number; backFlank: number };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** Mutates only `inner` (matched vertices); head, limbs and the outer body stay untouched. */
export function partitionSubcutaneousShell({
  outer,
  inner,
  heightCm,
  waistHalfWidthCm,
  waistHalfDepthCm,
  waistCentreZCm,
  visceralKg,
  trunkSatKg,
  trunkShares,
}: ShellPartition): Float32Array {
  if (outer.length !== inner.length) throw new Error('figure shell: mismatched meshes');
  const regionalSat = Math.max(0, trunkSatKg) * clamp01(trunkShares.abdominal + trunkShares.backFlank);
  const total = Math.max(0, visceralKg) + regionalSat;
  const vatFraction = total > 0 ? Math.max(0, visceralKg) / total : 0;
  if (vatFraction <= 0 || heightCm <= 0 || waistHalfWidthCm <= 0 || waistHalfDepthCm <= 0) return inner;

  for (let i = 0; i < outer.length; i += 3) {
    const y = outer[i + 1]! / heightCm;
    const abdomen = smoothstep(0.48, 0.54, y) * (1 - smoothstep(0.62, 0.69, y));
    if (abdomen <= 0) continue;
    const x = outer[i]! / waistHalfWidthCm;
    const z = (outer[i + 2]! - waistCentreZCm) / waistHalfDepthCm;
    const torso = 1 - smoothstep(0.75, 1.3, Math.hypot(x, z));
    const share = abdomen * torso * vatFraction;
    if (share <= 0) continue;
    inner[i] = inner[i]! + (outer[i]! - inner[i]!) * share;
    inner[i + 2] = inner[i + 2]! + (outer[i + 2]! - inner[i + 2]!) * share;
  }
  return inner;
}

interface Adjacency {
  /** Neighbours of vertex i are list[start[i] .. start[i + 1]). */
  start: Uint32Array;
  list: Uint32Array;
}

const adjacencyCache = new WeakMap<ArrayLike<number>, Adjacency>();

function adjacency(indices: ArrayLike<number>, vertexCount: number): Adjacency {
  const cached = adjacencyCache.get(indices);
  if (cached) return cached;
  const sets = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let f = 0; f < indices.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[f + k]!,
        b = indices[f + ((k + 1) % 3)]!;
      sets[a]!.add(b);
      sets[b]!.add(a);
    }
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) start[i + 1] = start[i]! + sets[i]!.size;
  const list = new Uint32Array(start[vertexCount]!);
  for (let i = 0; i < vertexCount; i++) list.set(Array.from(sets[i]!), start[i]!);
  const out = { start, list };
  adjacencyCache.set(indices, out);
  return out;
}

/** Area-weighted vertex normals, normalised. */
function vertexNormals(P: Float32Array, indices: ArrayLike<number>, out: Float32Array): void {
  out.fill(0);
  for (let f = 0; f < indices.length; f += 3) {
    const a = 3 * indices[f]!,
      b = 3 * indices[f + 1]!,
      c = 3 * indices[f + 2]!;
    const ux = P[b]! - P[a]!,
      uy = P[b + 1]! - P[a + 1]!,
      uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!,
      vy = P[c + 1]! - P[a + 1]!,
      vz = P[c + 2]! - P[a + 2]!;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    out[a] = out[a]! + nx;
    out[a + 1] = out[a + 1]! + ny;
    out[a + 2] = out[a + 2]! + nz;
    out[b] = out[b]! + nx;
    out[b + 1] = out[b + 1]! + ny;
    out[b + 2] = out[b + 2]! + nz;
    out[c] = out[c]! + nx;
    out[c + 1] = out[c + 1]! + ny;
    out[c + 2] = out[c + 2]! + nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i]!, out[i + 1]!, out[i + 2]!) || 1;
    out[i] = out[i]! / l;
    out[i + 1] = out[i + 1]! / l;
    out[i + 2] = out[i + 2]! / l;
  }
}

/** Cross product of a face's edges (twice its area along its normal). */
function faceCross(P: Float32Array, indices: ArrayLike<number>, f: number, out: Float64Array): void {
  const a = 3 * indices[f]!,
    b = 3 * indices[f + 1]!,
    c = 3 * indices[f + 2]!;
  const ux = P[b]! - P[a]!,
    uy = P[b + 1]! - P[a + 1]!,
    uz = P[b + 2]! - P[a + 2]!;
  const vx = P[c]! - P[a]!,
    vy = P[c + 1]! - P[a + 1]!,
    vz = P[c + 2]! - P[a + 2]!;
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
}

/** One Jacobi pass of uniform Laplacian smoothing of a scalar field (weight 0.5 toward the neighbour mean). */
function diffuse(field: Float32Array, out: Float32Array, start: Uint32Array, list: Uint32Array): void {
  for (let i = 0; i < field.length; i++) {
    const count = start[i + 1]! - start[i]!;
    let sum = 0;
    for (let e = start[i]!; e < start[i + 1]!; e++) sum += field[list[e]!]!;
    out[i] = count ? 0.5 * field[i]! + (0.5 * sum) / count : field[i]!;
  }
}

/** One uniform Laplacian step of xyz positions by `factor` (Taubin: shrink, then inflate). */
function laplacianStep(
  P: Float32Array,
  out: Float32Array,
  start: Uint32Array,
  list: Uint32Array,
  factor: number,
) {
  const n = P.length / 3;
  for (let i = 0; i < n; i++) {
    const count = start[i + 1]! - start[i]!;
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let e = start[i]!; e < start[i + 1]!; e++) sum += P[3 * list[e]! + k]!;
      out[3 * i + k] = count ? P[3 * i + k]! + factor * (sum / count - P[3 * i + k]!) : P[3 * i + k]!;
    }
  }
}

/**
 * A coarse smoothing basis on the skin: ~PATCH_CM patches grown along the mesh
 * (so an arm and the flank beside it stay apart), their neighbours, and per
 * vertex Gaussian weights to its own and neighbouring patches. Built once from
 * the rest shape. Smoothing a field = average per patch, smooth across
 * patches, blend back: body-region scale for a fraction of a millisecond.
 */
interface PatchBasis {
  patchOf: Uint32Array;
  count: number;
  /** Patch neighbours: neighbours[nStart[p] .. nStart[p + 1]). */
  nStart: Uint32Array;
  neighbours: Uint32Array;
  /** Vertex blend: patch ids and weights at wStart[v] .. wStart[v + 1]. */
  wStart: Uint32Array;
  wPatch: Uint32Array;
  wWeight: Float32Array;
}

const PATCH_CM = 5;
const basisCache = new WeakMap<ArrayLike<number>, PatchBasis>();

function patchBasis(rest: Float32Array, indices: ArrayLike<number>, adj: Adjacency): PatchBasis {
  const cached = basisCache.get(indices);
  if (cached) return cached;
  const n = rest.length / 3;
  const { start, list } = adj;
  // Seeds: one vertex per PATCH_CM cell, the nearest to the cell centre.
  const seedOf = new Map<string, number>();
  const best = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const c = [0, 1, 2].map((k) => rest[3 * v + k]! / PATCH_CM);
    const key = c.map(Math.floor).join(',');
    const d = c.reduce((sum, x) => sum + (x - Math.floor(x) - 0.5) ** 2, 0);
    if (d < (best.get(key) ?? Infinity)) {
      best.set(key, d);
      seedOf.set(key, v);
    }
  }
  // Patches: nearest seed along the mesh (multi-source Dijkstra on edge lengths).
  const patchOf = new Uint32Array(n).fill(0xffffffff);
  const dist = new Float64Array(n).fill(Infinity);
  const heap: Array<[number, number]> = [];
  const push = (d: number, v: number) => {
    heap.push([d, v]);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  let count = 0;
  for (const v of seedOf.values()) {
    patchOf[v] = count++;
    dist[v] = 0;
    push(0, v);
  }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]!) continue;
    for (let e = start[v]!; e < start[v + 1]!; e++) {
      const j = list[e]!;
      const nd =
        d +
        Math.hypot(
          rest[3 * v]! - rest[3 * j]!,
          rest[3 * v + 1]! - rest[3 * j + 1]!,
          rest[3 * v + 2]! - rest[3 * j + 2]!,
        );
      if (nd < dist[j]!) {
        dist[j] = nd;
        patchOf[j] = patchOf[v]!;
        push(nd, j);
      }
    }
  }
  // Patch neighbours (sharing a mesh edge) and centroids.
  const sets = Array.from({ length: count }, () => new Set<number>());
  const centroid = new Float64Array(3 * count);
  const members = new Uint32Array(count);
  for (let v = 0; v < n; v++) {
    const p = patchOf[v]!;
    members[p] = members[p]! + 1;
    for (let k = 0; k < 3; k++) centroid[3 * p + k] = centroid[3 * p + k]! + rest[3 * v + k]!;
    for (let e = start[v]!; e < start[v + 1]!; e++) {
      const q = patchOf[list[e]!]!;
      if (q !== p) sets[p]!.add(q);
    }
  }
  for (let p = 0; p < count; p++)
    for (let k = 0; k < 3; k++) centroid[3 * p + k] = centroid[3 * p + k]! / members[p]!;
  const nStart = new Uint32Array(count + 1);
  for (let p = 0; p < count; p++) nStart[p + 1] = nStart[p]! + sets[p]!.size;
  const neighbours = new Uint32Array(nStart[count]!);
  for (let p = 0; p < count; p++) neighbours.set(Array.from(sets[p]!), nStart[p]!);
  // Vertex weights: Gaussian in distance to the centroids of its patch and the patch's neighbours.
  const wStart = new Uint32Array(n + 1);
  const wPatch: number[] = [];
  const wWeight: number[] = [];
  for (let v = 0; v < n; v++) {
    const p = patchOf[v]!;
    const options = [p, ...neighbours.subarray(nStart[p]!, nStart[p + 1]!)];
    const w = options.map((q) =>
      Math.exp(
        -(
          ((rest[3 * v]! - centroid[3 * q]!) ** 2 +
            (rest[3 * v + 1]! - centroid[3 * q + 1]!) ** 2 +
            (rest[3 * v + 2]! - centroid[3 * q + 2]!) ** 2) /
          PATCH_CM ** 2
        ),
      ),
    );
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    options.forEach((q, k) => {
      wPatch.push(q);
      wWeight.push(w[k]! / sum);
    });
    wStart[v + 1] = wPatch.length;
  }
  const out = {
    patchOf,
    count,
    nStart,
    neighbours,
    wStart,
    wPatch: Uint32Array.from(wPatch),
    wWeight: Float32Array.from(wWeight),
  };
  basisCache.set(indices, out);
  return out;
}

/** Low-pass a per-vertex field at body-region scale with the patch basis. */
function smoothField(field: Float32Array, basis: PatchBasis, passes: number): void {
  const { patchOf, count, nStart, neighbours, wStart, wPatch, wWeight } = basis;
  let value = new Float64Array(count);
  const members = new Float64Array(count);
  for (let v = 0; v < field.length; v++) {
    value[patchOf[v]!] = value[patchOf[v]!]! + field[v]!;
    members[patchOf[v]!] = members[patchOf[v]!]! + 1;
  }
  for (let p = 0; p < count; p++) value[p] = value[p]! / (members[p] || 1);
  let next = new Float64Array(count);
  for (let pass = 0; pass < passes; pass++) {
    for (let p = 0; p < count; p++) {
      const k = nStart[p + 1]! - nStart[p]!;
      let sum = 0;
      for (let e = nStart[p]!; e < nStart[p + 1]!; e++) sum += value[neighbours[e]!]!;
      next[p] = k ? 0.5 * value[p]! + (0.5 * sum) / k : value[p]!;
    }
    [value, next] = [next, value];
  }
  for (let v = 0; v < field.length; v++) {
    let sum = 0;
    for (let e = wStart[v]!; e < wStart[v + 1]!; e++) sum += value[wPatch[e]!]! * wWeight[e]!;
    field[v] = sum;
  }
}

const faceNeighbourCache = new WeakMap<ArrayLike<number>, Int32Array>();

/** For each face, the faces across its three edges (-1 on an open edge). */
function faceNeighbours(indices: ArrayLike<number>): Int32Array {
  const cached = faceNeighbourCache.get(indices);
  if (cached) return cached;
  const out = new Int32Array(indices.length).fill(-1);
  const owner = new Map<string, number>();
  for (let f = 0; f < indices.length / 3; f++)
    for (let k = 0; k < 3; k++) {
      const a = indices[3 * f + k]!,
        b = indices[3 * f + ((k + 1) % 3)]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const g = owner.get(key);
      if (g === undefined) owner.set(key, 3 * f + k);
      else {
        out[3 * f + k] = Math.floor(g / 3);
        out[g] = f;
      }
    }
  faceNeighbourCache.set(indices, out);
  return out;
}

/** Taubin smoothing: alternate shrink and inflate steps, so small relief goes but the shape keeps its volume. */
function taubin(P: Float32Array, spare: Float32Array, start: Uint32Array, list: Uint32Array, passes: number) {
  for (let pass = 0; pass < passes; pass++) {
    laplacianStep(P, spare, start, list, 0.5);
    laplacianStep(spare, P, start, list, -0.53);
  }
}

const dotPair = (a: Float32Array, i: number, j: number) =>
  a[3 * i]! * a[3 * j]! + a[3 * i + 1]! * a[3 * j + 1]! + a[3 * i + 2]! * a[3 * j + 2]!;
const dot3 = (a: Float32Array, b: Float32Array, i: number) =>
  a[3 * i]! * b[3 * i]! + a[3 * i + 1]! * b[3 * i + 1]! + a[3 * i + 2]! * b[3 * i + 2]!;

/**
 * Rebuild the inner boundary of the under-skin fat. The lean core is a
 * separate morph of the same mesh: on the face, hands, feet and knees it lay
 * on or outside the skin (the layer showed holes), and its depth below the
 * skin carries every rib, muscle edge and crease of the lean shape plus
 * vertex-scale noise, which the translucent layer showed as banding and a
 * saw-toothed back. Here the inner surface is a smooth layer:
 * - the skin is first smoothed so small relief (nipples, the navel,
 *   rib and muscle edges) is not copied;
 * - the lean depth is smoothed at body-region scale (patch basis), then held under the
 *   skin's own baked thickness and the curvature of the relaxed skin;
 * - the relaxed skin is offset inward along averaged normals by that depth,
 *   the result relaxed again, and every vertex kept between a thin minimum
 *   and the thickness cap below the real skin;
 * - faces that would still turn over get a shallower inset.
 * It shares the skin's closed topology. Mutates and returns `inner`.
 */
export function insetSubcutaneousShell(
  outer: Float32Array,
  inner: Float32Array,
  indices: ArrayLike<number>,
  heightCm: number,
  /** Baked inward skin thickness per vertex at `referenceHeightCm` (FigureAsset.thickness). */
  thickness?: Float32Array,
  referenceHeightCm = 166,
  /** The rest mesh (FigureModel.base): a stable shape to build the smoothing patches from once. */
  rest?: Float32Array,
  /** Small bumps the layer passes under (the nipples and their 1-ring, FigureManifest.shell.pinned). */
  pinned?: ArrayLike<number>,
  /** Diagnostics: called with the layer after each stage (tests and tools only). */
  trace?: (stage: string, inner: Float32Array) => void,
): Float32Array {
  if (outer.length !== inner.length) throw new Error('figure shell: mismatched meshes');
  const n = outer.length / 3;
  const { start, list } = adjacency(indices, n);
  const normals = new Float32Array(outer.length);
  vertexNormals(outer, indices, normals);
  const spare = new Float32Array(outer.length);
  const minimum = SHELL_MIN_CM * (heightCm / 166);
  const scale = heightCm / referenceHeightCm;

  // The lean shape's depth below the skin, before anything else is changed.
  let depth = new Float32Array(n);
  let next = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += (outer[3 * i + k]! - inner[3 * i + k]!) * normals[3 * i + k]!;
    depth[i] = Math.max(0, d);
  }

  // A smooth depth field: low-passed at body-region scale.
  const basis = patchBasis(rest ?? outer, indices, { start, list });
  smoothField(depth, basis, SHELL_PATCH_PASSES);
  for (let pass = 0; pass < 2; pass++) {
    diffuse(depth, next, start, list);
    [depth, next] = [next, depth];
  }

  // The smoothed skin. Plain Laplacian passes flatten bumps a few vertices
  // wide (Taubin keeps those); the shrinkage they cause counts toward the
  // depth below.
  const base = Float32Array.from(outer);
  for (let pass = 0; pass < SHELL_BASE_PASSES; pass++) {
    laplacianStep(base, spare, start, list, 0.5);
    base.set(spare);
  }
  // Used only where the layer is deep (trunk, hips, thighs) and the body
  // thick: the face, ears, lips, fingers and toes keep the real skin, which
  // smoothing would fold or shrink through itself.
  const smoothed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w =
      Math.max(0, Math.min(1, (depth[i]! - 0.5) / 1.5)) *
      (thickness ? Math.max(0, Math.min(1, (thickness[i]! * scale - 4) / 6)) : 1);
    // Not in concave creases (the armpit): there smoothing moves the copy
    // outward, across the crease, in front of the skin on its far side.
    let out = 0;
    for (let k = 0; k < 3; k++) out += (base[3 * i + k]! - outer[3 * i + k]!) * normals[3 * i + k]!;
    smoothed[i] = w * Math.max(0, Math.min(1, 1 - out / 0.3));
  }
  // The blend weight itself varies smoothly: a weight that jumps between
  // neighbours mixes the relaxed copy and the real skin vertex by vertex,
  // which the layer showed as bumps.
  for (let pass = 0; pass < SHELL_WEIGHT_PASSES; pass++) {
    diffuse(smoothed, next, start, list);
    smoothed.set(next);
  }
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++)
      base[3 * i + k] = outer[3 * i + k]! + (base[3 * i + k]! - outer[3 * i + k]!) * smoothed[i]!;
  trace?.('base', base);
  const direction = new Float32Array(outer.length);
  vertexNormals(base, indices, direction);
  for (let pass = 0; pass < 3; pass++) {
    laplacianStep(direction, spare, start, list, 0.5);
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(spare[3 * i]!, spare[3 * i + 1]!, spare[3 * i + 2]!) || 1;
      for (let k = 0; k < 3; k++) direction[3 * i + k] = spare[3 * i + k]! / l;
    }
  }

  // Caps: a share of the skin's own thickness (the lean morph's arms and hands
  // can sit centimetres to the side of the fitted ones; this one wins over the
  // minimum at the closed lid and lip seams), and a share of the relaxed
  // skin's radius of curvature, where an inset would fold (fingers, toes).
  const floor = new Float32Array(n);
  const thick = new Float32Array(n);
  const cap = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let turn = 0;
    for (let e = start[i]!; e < start[i + 1]!; e++) {
      const j = list[e]!;
      const c = Math.max(-1, Math.min(1, dotPair(direction, i, j)));
      const edge = Math.hypot(
        base[3 * i]! - base[3 * j]!,
        base[3 * i + 1]! - base[3 * j + 1]!,
        base[3 * i + 2]! - base[3 * j + 2]!,
      );
      // The chord between unit normals (for small turns, the angle).
      if (edge > 0) turn = Math.max(turn, Math.sqrt(2 - 2 * c) / edge);
    }
    thick[i] = thickness ? SHELL_MAX_FRACTION * thickness[i]! * scale : Infinity;
    floor[i] = Math.min(minimum, thick[i]!);
    // The belly's inner contour needs a little more radius. Leave concave groin/limb creases on the usual cap.
    const y = outer[3 * i + 1]! / heightCm;
    const reference = rest ?? outer;
    const belly = smoothstep(0.48, 0.54, y) * (1 - smoothstep(0.67, 0.73, y)) *
      smoothstep(0, 8, reference[3 * i + 2]!) * (1 - smoothstep(14, 22, Math.abs(reference[3 * i]!)));
    const share = SHELL_CURVATURE_SHARE - 0.02 * belly;
    cap[i] = Math.min(50, turn > 0 ? share / turn : 50);
  }
  // The curvature cap at patch scale: a small bump (a nipple) must not hold
  // the layer up; thin parts are held by their own thickness cap.
  smoothField(cap, basis, 1);
  for (let i = 0; i < n; i++) cap[i] = Math.max(floor[i]!, Math.min(thick[i]!, cap[i]!));

  // Held under the caps by alternating clamping and smoothing.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) depth[i] = Math.min(depth[i]!, cap[i]!);
    diffuse(depth, next, start, list);
    [depth, next] = [next, depth];
  }

  // Offset the relaxed skin. Where relaxing sank the skin (over a bump), that
  // sink already counts toward the depth below the real skin.
  const sink = new Float32Array(n);
  const along = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += (outer[3 * i + k]! - base[3 * i + k]!) * normals[3 * i + k]!;
    sink[i] = Math.max(0, d);
    along[i] = Math.max(0.5, dot3(direction, normals, i));
  }
  // A smooth sink, so the step from the smoothed copy is smooth too (a
  // nipple sinks a lot, its neighbours little); the same for the step's
  // direction factor, which follows the real skin's vertex normals.
  smoothField(sink, basis, 1);
  for (let pass = 0; pass < SHELL_WEIGHT_PASSES; pass++) {
    diffuse(along, next, start, list);
    along.set(next);
  }
  const target = Float32Array.from(depth, (d, i) => Math.min(Math.max(d, floor[i]!), cap[i]!));
  // The nipples: their few vertices are filled in from the surrounding layer,
  // never from the local bump. A membrane (each takes the mean of its
  // neighbours, everything outside held fixed) first fills the reference
  // surface over the zone, then the layer's offset from it, so the zone stays
  // on the curve of the breast.
  const pinnedList = pinned ? Array.from(pinned) : [];
  const pinnedSet = new Set(pinnedList);
  const membrane = (
    over: number[],
    value: (j: number, k: number) => number,
    set: (i: number, k: number, v: number) => void,
  ) => {
    for (let pass = 0; pass < SHELL_PIN_PASSES; pass++)
      for (const i of over) {
        const count = start[i + 1]! - start[i]!;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (let e = start[i]!; e < start[i + 1]!; e++) sum += value(list[e]!, k);
          set(i, k, sum / count);
        }
      }
  };
  // The bump itself (the pinned vertices whose neighbours are all pinned: the
  // tip and two rings) is filled on the reference; the outer ring keeps the
  // curve of the breast.
  const core = pinnedList.filter((i) => {
    for (let e = start[i]!; e < start[i + 1]!; e++) if (!pinnedSet.has(list[e]!)) return false;
    return true;
  });
  const zone = Float32Array.from(base);
  membrane(
    core,
    (j, k) => zone[3 * j + k]!,
    (i, k, v) => (zone[3 * i + k] = v),
  );
  const collar = new Set<number>(pinnedList);
  for (const i of pinnedList) for (let e = start[i]!; e < start[i + 1]!; e++) collar.add(list[e]!);
  const collarList = [...collar].filter((i) => !pinnedSet.has(i));
  const pin = () => {
    membrane(
      pinnedList,
      (j, k) => inner[3 * j + k]! - zone[3 * j + k]!,
      (i, k, v) => (inner[3 * i + k] = zone[3 * i + k]! + v),
    );
    // The ring around the filled zone meets it without a step: its depth
    // below the skin takes the mean of its neighbours' depths.
    for (let pass = 0; pass < SHELL_COLLAR_PASSES; pass++)
      for (const i of collarList) {
        const count = start[i + 1]! - start[i]!;
        let sum = 0;
        for (let e = start[i]!; e < start[i + 1]!; e++) {
          const j = list[e]!;
          for (let k = 0; k < 3; k++) sum += (outer[3 * j + k]! - inner[3 * j + k]!) * normals[3 * j + k]!;
        }
        const held = Math.min(thick[i]!, Math.max(sum / count, floor[i]!));
        let d = 0;
        for (let k = 0; k < 3; k++) d += (outer[3 * i + k]! - inner[3 * i + k]!) * normals[3 * i + k]!;
        for (let k = 0; k < 3; k++) inner[3 * i + k] = inner[3 * i + k]! + normals[3 * i + k]! * (d - held);
        depth[i] = held;
      }
  };
  const build = () => {
    for (let i = 0; i < n; i++) {
      const step = Math.max(0, target[i]! - sink[i]!) / along[i]!;
      for (let k = 0; k < 3; k++) inner[3 * i + k] = base[3 * i + k]! - direction[3 * i + k]! * step;
    }
    trace?.('offset', inner);
    taubin(inner, spare, start, list, SHELL_TAUBIN_PASSES);
    trace?.('taubin', inner);
    // Between the thin minimum and the thickness cap below the real skin.
    for (let i = 0; i < n; i++) {
      let d = 0;
      for (let k = 0; k < 3; k++) d += (outer[3 * i + k]! - inner[3 * i + k]!) * normals[3 * i + k]!;
      // On thin parts (the real skin, not the smoothed copy) never deeper than
      // the thickness cap; on the trunk the layer passes under small
      // protrusions (a nipple), whose own thickness is no limit.
      const held =
        Math.max(d, floor[i]!) > thick[i]! && smoothed[i]! < 0.5 ? thick[i]! : Math.max(d, floor[i]!);
      for (let k = 0; k < 3; k++) inner[3 * i + k] = inner[3 * i + k]! + normals[3 * i + k]! * (d - held);
      depth[i] = held;
    }
    trace?.('clamp', inner);
    // The clamp moves single vertices along their own normals. Relax the
    // layer's offset from the skin where the body is thick (the trunk, hips
    // and thighs), then hold the depth again, so what remains is smooth and
    // still between the minimum and the cap.
    for (let pass = 0; pass < SHELL_OFFSET_PASSES; pass++) {
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) spare[3 * i + k] = inner[3 * i + k]! - outer[3 * i + k]!;
      for (let i = 0; i < n; i++) {
        if (smoothed[i]! < 0.5) continue;
        const count = start[i + 1]! - start[i]!;
        if (!count) continue;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (let e = start[i]!; e < start[i + 1]!; e++) sum += spare[3 * list[e]! + k]!;
          inner[3 * i + k] = outer[3 * i + k]! + 0.5 * spare[3 * i + k]! + (0.5 * sum) / count;
        }
        let d = 0;
        for (let k = 0; k < 3; k++) d += (outer[3 * i + k]! - inner[3 * i + k]!) * normals[3 * i + k]!;
        const held = Math.min(thick[i]!, Math.max(d, floor[i]!));
        for (let k = 0; k < 3; k++) inner[3 * i + k] = inner[3 * i + k]! + normals[3 * i + k]! * (d - held);
        depth[i] = held;
      }
    }
    trace?.('relax', inner);
    pin();
    trace?.('pin', inner);
  };
  const s = new Float64Array(3),
    q = new Float64Array(3);
  // A fold: a face of the layer turned against its neighbours on the layer,
  // or against the smoothed copy it is offset from, or shrunk to a sliver.
  // (Not against the skin: under a nipple the skin's faces point every way.)
  const across = faceNeighbours(indices);
  const faceCount = indices.length / 3;
  const innerCross = new Float64Array(indices.length);
  const baseCross = new Float64Array(indices.length);
  for (let f = 0; f < faceCount; f++) {
    faceCross(base, indices, 3 * f, s);
    baseCross[3 * f] = s[0]!;
    baseCross[3 * f + 1] = s[1]!;
    baseCross[3 * f + 2] = s[2]!;
  }
  const folding = (deepOnly: boolean): Set<number> => {
    const out = new Set<number>();
    for (let f = 0; f < faceCount; f++) {
      faceCross(inner, indices, 3 * f, q);
      innerCross[3 * f] = q[0]!;
      innerCross[3 * f + 1] = q[1]!;
      innerCross[3 * f + 2] = q[2]!;
    }
    for (let f = 0; f < faceCount; f++) {
      const a = indices[3 * f]!,
        b = indices[3 * f + 1]!,
        c = indices[3 * f + 2]!;
      if (deepOnly && Math.max(target[a]!, target[b]!, target[c]!) < 0.15) continue;
      // The filled-in nipples are placed from their surroundings, not judged.
      if (pinnedSet.has(a) || pinnedSet.has(b) || pinnedSet.has(c)) continue;
      const qx = innerCross[3 * f]!,
        qy = innerCross[3 * f + 1]!,
        qz = innerCross[3 * f + 2]!;
      let nx = 0,
        ny = 0,
        nz = 0;
      for (let k = 0; k < 3; k++) {
        const g = across[3 * f + k]!;
        if (g < 0) continue;
        nx += innerCross[3 * g]!;
        ny += innerCross[3 * g + 1]!;
        nz += innerCross[3 * g + 2]!;
      }
      const bx = baseCross[3 * f]!,
        by = baseCross[3 * f + 1]!,
        bz = baseCross[3 * f + 2]!;
      if (
        qx * nx + qy * ny + qz * nz <= 0 ||
        bx * qx + by * qy + bz * qz <= 0 ||
        qx * qx + qy * qy + qz * qz < 0.0025 * (bx * bx + by * by + bz * bz)
      ) {
        out.add(a);
        out.add(b);
        out.add(c);
      }
    }
    return out;
  };
  build();
  // A deep inset folds where the skin is concave (under a heavy belly, a bent
  // elbow). Make the layer shallower around the fold, smoothly over a few
  // rings, rather than denting single vertices or thinning the whole region.
  let relief = new Float32Array(n);
  let reliefNext = new Float32Array(n);
  for (let round = 0; round < 2; round++) {
    const bad = folding(true);
    if (!bad.size) break;
    relief.fill(0);
    for (const i of bad) relief[i] = 1;
    for (let pass = 0; pass < 4; pass++) {
      diffuse(relief, reliefNext, start, list);
      [relief, reliefNext] = [reliefNext, relief];
    }
    for (let i = 0; i < n; i++) target[i] = target[i]! * (1 - Math.min(0.5, 1.5 * relief[i]!));
    build();
  }
  trace?.('relief', inner);
  // Last resort for the few faces still turned (fingertips, lid seams): halve
  // the depth at their corners.
  for (let round = 0; round < 3; round++) {
    const bad = folding(false);
    if (!bad.size) break;
    for (const i of bad) {
      depth[i] = Math.max(depth[i]! / 2, floor[i]!);
      for (let k = 0; k < 3; k++) inner[3 * i + k] = outer[3 * i + k]! - normals[3 * i + k]! * depth[i]!;
    }
  }
  // The final fill. On an extreme breast it can turn a face at the zone's
  // edge: then the zone moves halfway back toward its unfilled place.
  trace?.('lastResort', inner);
  const unfilled = Float32Array.from(
    pinnedList.flatMap((i) => [inner[3 * i]!, inner[3 * i + 1]!, inner[3 * i + 2]!]),
  );
  pin();
  const zoneFaces: number[] = [];
  for (let f = 0; f < faceCount; f++)
    if ([0, 1, 2].some((k) => pinnedSet.has(indices[3 * f + k]!))) zoneFaces.push(f);
  for (let round = 0, share = 0.5; round < 3; round++, share /= 2) {
    const turned = zoneFaces.some((f) => {
      faceCross(inner, indices, 3 * f, q);
      let nx = 0,
        ny = 0,
        nz = 0;
      for (let k = 0; k < 3; k++) {
        const g = across[3 * f + k]!;
        if (g < 0) continue;
        faceCross(inner, indices, 3 * g, s);
        nx += s[0]!;
        ny += s[1]!;
        nz += s[2]!;
      }
      return q[0]! * nx + q[1]! * ny + q[2]! * nz <= 0;
    });
    if (!turned) break;
    pinnedList.forEach((i, m) => {
      for (let k = 0; k < 3; k++)
        inner[3 * i + k] = inner[3 * i + k]! + (unfilled[3 * m + k]! - inner[3 * i + k]!) * share;
    });
  }
  trace?.('final', inner);
  return inner;
}

/** Membrane passes that fill in the pinned nipple vertices from the surrounding layer. */
export const SHELL_PIN_PASSES = 16;
/** Thinnest fat drawn under the skin (face, fingers, toes) at a 166 cm stature. */
export const SHELL_MIN_CM = 0.06;
/** Keep at least 80% of the outer curvature radius: a deep parallel inset sharpens the belly underside. */
export const SHELL_CURVATURE_SHARE = 0.2;
/** Smoothing passes across the ~5 cm patches: the depth field varies over about 10-15 cm. */
export const SHELL_PATCH_PASSES = 6;
/** Laplacian passes that smooth the copy of the skin the inset is offset from. */
export const SHELL_BASE_PASSES = 16;
/** Taubin passes that relax the inset surface. */
export const SHELL_TAUBIN_PASSES = 2;
/** Diffusion passes over the blend weight of the relaxed skin copy and over the step's direction factor. */
export const SHELL_WEIGHT_PASSES = 3;
/** Passes that give the ring around the filled nipple zone its neighbours' mean depth. */
export const SHELL_COLLAR_PASSES = 1;
/** Relaxation passes of the layer's offset from the skin after the depth clamp (thick parts only). */
export const SHELL_OFFSET_PASSES = 4;
/** Deepest inset as a share of the skin's inward thickness at that vertex. */
export const SHELL_MAX_FRACTION = 0.45;
