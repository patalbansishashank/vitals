// Outer face rims measured on the pinned CC0 hm08 mesh. They enclose the eye
// and mouth pockets together with the eyelids and lips. The bake keeps the
// lids and lips, removes only the inward pocket behind them, and zips each
// opening shut along a seam (closed eyes, a closed mouth).
export const HEAD_RIMS = [
  {
    id: 'rightEye',
    vertices: [
      4892, 4894, 4893, 103, 157, 175, 174, 177, 204, 206, 207, 190, 189, 188, 193, 194, 195, 5087, 196, 906,
      905, 908, 5249, 5303, 5306, 5248, 142, 5084, 81, 4873,
    ],
  },
  {
    id: 'leftEye',
    vertices: [
      6970, 6969, 6964, 6965, 6966, 6982, 6981, 6979, 6953, 6950, 6951, 6935, 6887, 11511, 11512, 11510,
      11491, 6865, 11699, 6920, 11856, 11911, 11908, 11857, 7610, 7607, 7608, 6972, 11702, 6971,
    ],
  },
  {
    id: 'mouth',
    vertices: [
      11777, 11770, 11757, 11758, 10407, 7434, 7137, 7134, 11943, 11966, 11938, 7116, 11946, 11945, 5342,
      5343, 5344, 355, 5334, 5364, 5340, 374, 377, 711, 3739, 5144, 5143, 5156, 5164, 5163, 5216, 5217, 5160,
      5159, 5158, 5157, 5162, 11771, 11772, 11773, 11774, 11827, 11826, 11776,
    ],
  },
] as const;

/** Rings of face vertices around each cap whose depth is relaxed, and the
 * per-pass strength by ring (rim first). */
const COLLAR_RINGS = 1;
/** Minimum forward component of a face normal that still counts as outer
 * lid or lip skin rather than the pocket behind the opening. */
const OPENING_FACING = 0.15;
const COLLAR_STRENGTH = [0.35, 0.15];

export interface HeadStencil {
  xy: Array<[number, number]>;
  z: Array<[number, number]>;
  /** Heights (y) that add to the depth: a closed lid bulges with its gap. */
  zy?: Array<[number, number]>;
}

export interface HeadSmoothing extends HeadStencil {
  vertex: number;
}

/** One cyclic Laplacian pass removes the tiny inward corners of the lip rim.
 * These fixed convex weights must also be applied to every morph delta.
 */
function smoothRims(rims: ReadonlyArray<{ vertices: readonly number[] }>): HeadSmoothing[] {
  return rims.flatMap(({ vertices }) =>
    vertices.map((vertex, i) => {
      const weights: Array<[number, number]> = [
        [vertices[(i + vertices.length - 1) % vertices.length]!, 0.25],
        [vertex, 0.5],
        [vertices[(i + 1) % vertices.length]!, 0.25],
      ];
      return { vertex, xy: weights, z: weights };
    }),
  );
}

/** Blend the caps into exterior collar rings instead of leaving a crease at
 * the cut. Only depth is relaxed: moving rim vertices sideways toward the cap
 * pulled the lips into a pucker and the lids into a squint. Compose the
 * relaxation weights back to raw body vertices so the identical operator can
 * be applied independently to every morph target.
 */
function relaxHead(
  source: number[],
  vertexCount: number,
  stencils: HeadStencil[],
  smoothing: HeadSmoothing[],
  rims: ReadonlyArray<{ vertices: readonly number[] }>,
) {
  const neighbours = new Map<number, Set<number>>();
  for (let f = 0; f < source.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = source[f + k]!,
        b = source[f + ((k + 1) % 3)]!;
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      if (!neighbours.has(b)) neighbours.set(b, new Set());
      neighbours.get(a)!.add(b);
      neighbours.get(b)!.add(a);
    }
  const distance = new Map<number, number>();
  for (const rim of rims) for (const v of rim.vertices) distance.set(v, 0);
  for (let i = 0; i < stencils.length; i++) distance.set(vertexCount + i, 0);
  for (let depth = 0; depth < COLLAR_RINGS; depth++)
    for (const [v, d] of [...distance])
      if (d === depth)
        for (const next of neighbours.get(v)!) if (!distance.has(next)) distance.set(next, depth + 1);
  const original = new Map(smoothing.map((s) => [s.vertex, s]));
  const identity = (v: number): HeadStencil => ({ xy: [[v, 1]], z: [[v, 1]] });
  // Drop an empty height term, so the shapes without one are unchanged.
  const stencil = (xy: Array<[number, number]>, z: Array<[number, number]>, zy: Array<[number, number]>) =>
    zy.length ? { xy, z, zy } : { xy, z };
  const weights = (entries: Array<[HeadStencil, number]>): HeadStencil => {
    const merge = (axis: 'xy' | 'z' | 'zy') => {
      const sum = new Map<number, number>();
      for (const [entry, w] of entries)
        for (const [v, k] of entry[axis] ?? []) sum.set(v, (sum.get(v) ?? 0) + w * k);
      return [...sum].sort((a, b) => a[0] - b[0]);
    };
    return stencil(merge('xy'), merge('z'), merge('zy'));
  };
  let operators = new Map<number, HeadStencil>();
  for (const v of distance.keys()) operators.set(v, original.get(v) ?? identity(v));
  stencils.forEach((s, i) => {
    const compose = (from: Array<[number, number]> | undefined, axis: 'xy' | 'z' | 'zy', sum = new Map<number, number>()) => {
      for (const [v, w] of from ?? [])
        for (const [j, k] of (original.get(v) ?? identity(v))[axis] ?? []) sum.set(j, (sum.get(j) ?? 0) + w * k);
      return sum;
    };
    const sorted = (sum: Map<number, number>) => [...sum].sort((a, b) => a[0] - b[0]);
    // A height term reads heights (xy operators); depths may carry their own.
    const zy = compose(s.zy, 'xy', compose(s.z, 'zy'));
    operators.set(vertexCount + i, stencil(sorted(compose(s.xy, 'xy')), sorted(compose(s.z, 'z')), sorted(zy)));
  });
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map(operators);
    for (const [v, d] of distance) {
      const strength = COLLAR_STRENGTH[d]!;
      const adjacent = [...neighbours.get(v)!];
      const smoothed = weights([
        [operators.get(v)!, 1 - strength],
        ...adjacent.map(
          (n) => [operators.get(n) ?? identity(n), strength / adjacent.length] as [HeadStencil, number],
        ),
      ]);
      // Cap vertices relax in all axes; face vertices keep their outline.
      next.set(v, v >= vertexCount ? smoothed : stencil(operators.get(v)!.xy, smoothed.z, smoothed.zy ?? []));
    }
    operators = next;
  }
  return {
    stencils: stencils.map((_, i) => operators.get(vertexCount + i)!),
    smoothing: [...distance.keys()]
      .filter((v) => v < vertexCount)
      .map((vertex) => ({ vertex, ...operators.get(vertex)! })),
  };
}

/** Shut lids: forward bulge as a share of the gap between the lid margins, and
 * how far down the gap the fold lies. */
const LID_BULGE = 0.4;
const LID_FOLD = 0.65;

export function closeHead(reference: ArrayLike<number>, source: Uint32Array) {
  const R = Float64Array.from(reference);
  const edge = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const cuts = new Set<string>();
  for (const rim of HEAD_RIMS)
    for (let i = 0; i < rim.vertices.length; i++)
      cuts.add(edge(rim.vertices[i]!, rim.vertices[(i + 1) % rim.vertices.length]!));
  const owners = new Map<string, number[]>();
  for (let f = 0; f < source.length / 3; f++)
    for (let k = 0; k < 3; k++) {
      const key = edge(source[3 * f + k]!, source[3 * f + ((k + 1) % 3)]!);
      const group = owners.get(key) ?? [];
      group.push(f);
      owners.set(key, group);
    }
  for (const key of cuts)
    if (owners.get(key)?.length !== 2) throw new Error(`Invalid hm08 face rim edge ${key}`);
  const adjacency = Array.from({ length: source.length / 3 }, () => [] as number[]);
  for (const [key, faces] of owners)
    if (!cuts.has(key) && faces.length === 2) {
      adjacency[faces[0]!]!.push(faces[1]!);
      adjacency[faces[1]!]!.push(faces[0]!);
    }
  const seen = new Uint8Array(adjacency.length),
    components: number[][] = [];
  for (let seed = 0; seed < seen.length; seed++) {
    if (seen[seed]) continue;
    const todo = [seed],
      component: number[] = [];
    seen[seed] = 1;
    while (todo.length) {
      const f = todo.pop()!;
      component.push(f);
      for (const next of adjacency[f]!)
        if (!seen[next]) {
          seen[next] = 1;
          todo.push(next);
        }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);
  if (components.length !== 4 || components[0]!.length < 20000)
    throw new Error('Head rims must isolate exactly three pockets');
  // The authored rims enclose the whole eyelids and lips. Keep the lids and
  // lips: walk inward from each rim over front-facing skin only. Where the
  // surface turns back into the head (lid margins, the line between the
  // lips) is the actual opening.
  const exterior = new Uint8Array(source.length / 3);
  for (const face of components[0]!) exterior[face] = 1;
  const facingZ = (f: number) => {
    const [a, b, c] = [0, 1, 2].map((k) => source[3 * f + k]!) as [number, number, number];
    const u = [0, 1, 2].map((k) => R[3 * b + k]! - R[3 * a + k]!);
    const w = [0, 1, 2].map((k) => R[3 * c + k]! - R[3 * a + k]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    return n[2]! / (Math.hypot(...n) || 1);
  };
  for (const pocket of components.slice(1)) {
    const inside = new Set(pocket);
    const todo = pocket.filter((f) =>
      [0, 1, 2].some((k) => cuts.has(edge(source[3 * f + k]!, source[3 * f + ((k + 1) % 3)]!))),
    );
    for (const f of todo) exterior[f] = facingZ(f) > OPENING_FACING ? 1 : 0;
    const queue = todo.filter((f) => exterior[f]);
    while (queue.length) {
      const f = queue.pop()!;
      for (const next of adjacency[f]!)
        if (inside.has(next) && !exterior[next] && facingZ(next) > OPENING_FACING) {
          exterior[next] = 1;
          queue.push(next);
        }
    }
    // Close notches (pocket faces with two outer-skin neighbours) and fill
    // islands, so each opening's edge is one simple loop.
    for (let changed = true; changed;) {
      changed = false;
      for (const f of pocket)
        if (!exterior[f] && adjacency[f]!.filter((g) => exterior[g]).length >= 2) {
          exterior[f] = 1;
          changed = true;
        }
    }
    const holes: number[][] = [];
    const seenHole = new Set<number>();
    for (const f of pocket) {
      if (exterior[f] || seenHole.has(f)) continue;
      const group = [f];
      seenHole.add(f);
      for (let i = 0; i < group.length; i++)
        for (const g of adjacency[group[i]!]!)
          if (inside.has(g) && !exterior[g] && !seenHole.has(g)) {
            seenHole.add(g);
            group.push(g);
          }
      holes.push(group);
    }
    holes.sort((x, y) => y.length - x.length);
    for (const hole of holes.slice(1)) for (const f of hole) exterior[f] = 1;
  }
  const boundary = new Map<number, number[]>();
  for (const [key, faces] of owners) {
    if (faces.length !== 2 || exterior[faces[0]!] === exterior[faces[1]!]) continue;
    const [a, b] = key.split(':').map(Number) as [number, number];
    for (const [p, q] of [
      [a, b],
      [b, a],
    ] as const)
      boundary.set(p, [...(boundary.get(p) ?? []), q]);
  }
  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of boundary.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    for (;;) {
      const options = boundary.get(loop.at(-1)!)!;
      if (options.length !== 2) throw new Error('Head opening is not a simple loop');
      const next = options.find((v) => !used.has(v));
      if (next === undefined) break;
      loop.push(next);
      used.add(next);
    }
    loops.push(loop);
  }
  const centroid = (vs: readonly number[]) =>
    [0, 1, 2].map((k) => vs.reduce((sum, v) => sum + R[3 * v + k]!, 0) / vs.length);
  const openings = HEAD_RIMS.map((rim) => {
    const c = centroid(rim.vertices);
    const near = loops.filter((loop) => {
      const d = centroid(loop);
      return Math.hypot(d[0]! - c[0]!, d[1]! - c[1]!) < 2.5;
    });
    if (near.length !== 1) throw new Error(`Head rim ${rim.id} must enclose exactly one opening`);
    return { id: rim.id, vertices: near[0]! };
  });
  if (loops.length !== openings.length) throw new Error('Unexpected extra head openings');
  const smoothing = smoothRims(openings);
  const P = expandHead(R, [], smoothing);
  const triangles: number[] = [];
  for (let face = 0; face < exterior.length; face++)
    if (exterior[face]) triangles.push(source[3 * face]!, source[3 * face + 1]!, source[3 * face + 2]!);
  const skinEdges = new Set<string>();
  for (let f = 0; f < triangles.length; f += 3)
    for (let k = 0; k < 3; k++) skinEdges.add(`${triangles[f + k]}>${triangles[f + ((k + 1) % 3)]}`);
  const stencils: HeadStencil[] = [];
  const caps = openings.map((rim) => {
    const vertices: number[] = [...rim.vertices];
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i]!,
        b = vertices[(i + 1) % vertices.length]!;
      area += P[3 * a]! * P[3 * b + 1]! - P[3 * b]! * P[3 * a + 1]!;
    }
    if (area < 0) vertices.reverse();
    const n = vertices.length;
    const x = (v: number) => P[3 * v]!;
    // Close each opening like shut lips or lids: split the rim at its two
    // corners into an upper and a lower edge, and zip them together on a seam
    // midway between them. A radial cap read as a pucker or a squint.
    const left = vertices.reduce((p, q) => (x(q) < x(p) ? q : p));
    const right = vertices.reduce((p, q) => (x(q) > x(p) ? q : p));
    const walk = (from: number, step: 1 | -1) => {
      const out = [from];
      let i = vertices.indexOf(from);
      while (out.at(-1) !== right) {
        i = (i + step + n) % n;
        out.push(vertices[i]!);
      }
      return out;
    };
    const meanY = (chain: number[]) => chain.reduce((sum, v) => sum + P[3 * v + 1]!, 0) / chain.length;
    const [upper, lower] = [walk(left, 1), walk(left, -1)].sort((p, q) => meanY(q) - meanY(p)) as [
      number[],
      number[],
    ];
    if (upper.length < 3 || lower.length < 3)
      throw new Error(`Head rim ${rim.id} has no upper and lower edge`);
    const add = (xy: Array<[number, number]>, z: Array<[number, number]>, zy?: Array<[number, number]>) => {
      const id = P.length / 3 + stencils.length;
      stencils.push(zy ? { xy, z, zy } : { xy, z });
      return id;
    };
    // Shut lids meet a little in front of their margins, which turn back into
    // the head: a seam midway between them read as a hollow almond slit. The
    // bulge is a share of the gap (upper height minus lower height), so it is
    // zero at the corners and follows every shape linearly.
    const bulge = /eye/i.test(rim.id) ? LID_BULGE : 0;
    // The upper lid covers most of a shut eye: its fold lies low in the gap.
    const drop = /eye/i.test(rim.id) ? LID_FOLD : 0.5;
    // The point on the opposite edge at the same x, as fixed linear weights.
    const across = (v: number, chain: number[]): Array<[number, number]> => {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i]!,
          b = chain[i + 1]!;
        const lo = Math.min(x(a), x(b)),
          hi = Math.max(x(a), x(b));
        if (x(v) < lo || x(v) > hi) continue;
        const t = hi > lo ? (x(v) - x(a)) / (x(b) - x(a)) : 0.5;
        return [
          [a, 1 - t],
          [b, t],
        ];
      }
      const nearest = chain.reduce((p, q) => (Math.abs(x(q) - x(v)) < Math.abs(x(p) - x(v)) ? q : p));
      return [[nearest, 1]];
    };
    const seam = [
      left,
      ...upper.slice(1, -1).map((v) => {
        const opposite = across(v, lower);
        const w: Array<[number, number]> = [
          [v, 1 - drop],
          ...opposite.map(([j, k]) => [j, k * drop] as [number, number]),
        ];
        if (!bulge) return add(w, w);
        return add(w, w, [[v, bulge], ...opposite.map(([j, k]) => [j, -k * bulge] as [number, number])]);
      }),
      right,
    ];
    const seamX = (i: number) => (i === 0 ? x(left) : i === seam.length - 1 ? x(right) : x(upper[i]!));
    const faces: number[] = [];
    // Triangulate an edge chain against the seam, advancing along x.
    const zip = (chain: number[], chainX: (i: number) => number) => {
      let i = 0,
        j = 0;
      while (i < chain.length - 1 || j < seam.length - 1) {
        const nextChain = j === seam.length - 1 || (i < chain.length - 1 && chainX(i + 1) <= seamX(j + 1));
        const tri = nextChain ? [chain[i]!, chain[i + 1]!, seam[j]!] : [chain[i]!, seam[j + 1]!, seam[j]!];
        if (nextChain) i++;
        else j++;
        if (new Set(tri).size < 3) continue;
        faces.push(...tri);
      }
    };
    zip(upper, (i) => x(upper[i]!));
    zip(lower, (i) => x(lower[i]!));
    // Wind every cap face against the skin across the rim, then propagate
    // across shared seam edges, so the closed surface is consistently oriented.
    const count = faces.length / 3;
    const key = (p: number, q: number) => `${p}>${q}`;
    const oriented = new Int8Array(count);
    const queue: number[] = [];
    for (let f = 0; f < count; f++)
      for (let k = 0; k < 3; k++) {
        const p = faces[3 * f + k]!,
          q = faces[3 * f + ((k + 1) % 3)]!;
        if (skinEdges.has(key(p, q))) oriented[f] = -1;
        else if (skinEdges.has(key(q, p))) oriented[f] = 1;
        if (oriented[f]) {
          queue.push(f);
          break;
        }
      }
    const flip = (f: number) => {
      const t = faces[3 * f + 1]!;
      faces[3 * f + 1] = faces[3 * f + 2]!;
      faces[3 * f + 2] = t;
    };
    for (let f = 0; f < count; f++) if (oriented[f] === -1) flip(f);
    for (let f = 0; f < count; f++) if (oriented[f]) oriented[f] = 1;
    while (queue.length) {
      const f = queue.shift()!;
      for (let g = 0; g < count; g++) {
        if (oriented[g]) continue;
        for (let k = 0; k < 3; k++) {
          const p = faces[3 * f + k]!,
            q = faces[3 * f + ((k + 1) % 3)]!;
          const gv = [0, 1, 2].map((j) => faces[3 * g + j]!);
          const i = gv.indexOf(p);
          if (i < 0 || !gv.includes(q)) continue;
          // A consistent neighbour walks the shared edge q -> p.
          if (gv[(i + 1) % 3] === q) flip(g);
          oriented[g] = 1;
          queue.push(g);
          break;
        }
      }
    }
    if (oriented.some((o) => !o)) throw new Error(`Head cap ${rim.id} is not connected to its rim`);
    return { id: rim.id, rim: vertices, triangles: faces };
  });
  for (const cap of caps) triangles.push(...cap.triangles);
  const relaxed = relaxHead(triangles, P.length / 3, stencils, smoothing, openings);
  return {
    triangles: Uint32Array.from(triangles),
    caps,
    stencils: relaxed.stencils,
    smoothing: relaxed.smoothing,
    removedTriangles:
      source.length / 3 - triangles.length / 3 + caps.reduce((n, cap) => n + cap.triangles.length / 3, 0),
    locked: new Set([
      ...relaxed.smoothing.map(({ vertex }) => vertex),
      ...stencils.map((_, i) => P.length / 3 + i),
    ]),
  };
}

/** Apply the same linear operator to positions and target deltas. Rim updates
 * read only the original input, so replacement order cannot change a shape.
 * Synthetic stencils also read the raw body, never rig helpers.
 */
export function expandHead(
  data: Float64Array,
  stencils: HeadStencil[],
  smoothing: HeadSmoothing[] = [],
): Float64Array {
  const result = new Float64Array(data.length + 3 * stencils.length);
  result.set(data);
  const apply = (source: Float64Array, vertex: number, stencil: HeadStencil) => {
    for (let axis = 0; axis < 3; axis++) {
      const weights = axis === 2 ? stencil.z : stencil.xy;
      result[3 * vertex + axis] = weights.reduce((sum, [v, w]) => {
        if (v < 0 || v >= data.length / 3) throw new Error('Head stencil references a non-body vertex');
        return sum + source[3 * v + axis]! * w;
      }, 0);
      if (axis === 2 && stencil.zy)
        for (const [v, w] of stencil.zy) result[3 * vertex + 2] = result[3 * vertex + 2]! + source[3 * v + 1]! * w;
    }
  };
  for (const stencil of smoothing) apply(data, stencil.vertex, stencil);
  stencils.forEach((stencil, i) => apply(data, data.length / 3 + i, stencil));
  return result;
}
