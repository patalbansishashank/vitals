// Keeps the "Fat under skin" layer outside the placed muscles and bones. The anatomy is placed under the fat's inner
// boundary where it can be (anatomyPose.ts); where a bone or a squeezed muscle still reaches higher (a heavy shoulder
// or upper arm), the fat gives way there instead, easing back to its own depth around it.
import { SHELL_MIN_CM } from './subcutaneousShell';

const SLOPE = 1;
const PASSES = 3;
// The depth taken away is widened by DILATE rings, then averaged SPREAD_PASSES times: about 4-5 cm across the trunk.
const DILATE = 0;
const SPREAD_PASSES = 8;
const adjacencies = new WeakMap<ArrayLike<number>, { start: Uint32Array; list: Uint32Array }>();

function adjacency(indices: ArrayLike<number>, count: number) {
  const cached = adjacencies.get(indices);
  if (cached) return cached;
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let f = 0; f < indices.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[f + k]!,
        b = indices[f + ((k + 1) % 3)]!;
      sets[a]!.add(b);
      sets[b]!.add(a);
    }
  const start = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) start[i + 1] = start[i]! + sets[i]!.size;
  const list = new Uint32Array(start[count]!);
  sets.forEach((set, i) => list.set([...set].sort((x, y) => x - y), start[i]!));
  const out = { start, list };
  adjacencies.set(indices, out);
  return out;
}

/**
 * Make the fat layer no deeper than `room` (per skin vertex, from fatRoom) and never thinner than the shell minimum.
 * Each limit opens up as a cone along the skin (SLOPE cm deeper per cm away), so the layer has no step and gives way
 * only around what needs the room. Mutates `inner` only.
 */
export function clampFatToAnatomy(
  outer: Float32Array,
  inner: Float32Array,
  indices: ArrayLike<number>,
  room: Float32Array,
  heightCm: number,
): Float32Array {
  const count = outer.length / 3;
  const { start, list } = adjacency(indices, count);
  const minimum = SHELL_MIN_CM * (heightCm / 166);
  const limit = Float32Array.from(room, (r) => Math.max(r, minimum));
  if (!limit.some((r, i) => r < depthAt(outer, inner, i))) return inner;
  const rise = new Float32Array(list.length);
  for (let i = 0; i < count; i++)
    for (let j = start[i]!; j < start[i + 1]!; j++) {
      const w = list[j]!;
      rise[j] = SLOPE * Math.hypot(outer[3 * i]! - outer[3 * w]!, outer[3 * i + 1]! - outer[3 * w + 1]!, outer[3 * i + 2]! - outer[3 * w + 2]!);
    }
  // Relax along the edges, forward and back, until the cones have spread over their reach.
  for (let pass = 0; pass < 2 * PASSES; pass++)
    for (let n = 0; n < count; n++) {
      const i = pass % 2 ? count - 1 - n : n;
      let value = limit[i]!;
      for (let j = start[i]!; j < start[i + 1]!; j++) value = Math.min(value, limit[list[j]!]! + rise[j]!);
      limit[i] = value;
    }
  // The depth to take away follows each bone's relief (spine, shoulder blade, collarbone, ribs) and left the layer
  // jagged. Spread it over about 5 cm of surface: the layer stays smooth, and a few bone vertices may touch it.
  let cut = new Float32Array(count),
    next = new Float32Array(count);
  let any = false;
  for (let i = 0; i < count; i++) {
    cut[i] = Math.max(0, depthAt(outer, inner, i) - limit[i]!);
    if (cut[i]! > 0) any = true;
  }
  if (!any) return inner;
  // First widen each cut to its neighbours (the largest within DILATE rings), so the averaging below keeps its size.
  for (let pass = 0; pass < DILATE; pass++) {
    for (let i = 0; i < count; i++) {
      let value = cut[i]!;
      for (let j = start[i]!; j < start[i + 1]!; j++) value = Math.max(value, cut[list[j]!]!);
      next[i] = value;
    }
    [cut, next] = [next, cut];
  }
  for (let pass = 0; pass < SPREAD_PASSES; pass++) {
    for (let i = 0; i < count; i++) {
      let sum = cut[i]!;
      for (let j = start[i]!; j < start[i + 1]!; j++) sum += cut[list[j]!]!;
      next[i] = sum / (1 + start[i + 1]! - start[i]!);
    }
    [cut, next] = [next, cut];
  }
  for (let i = 0; i < count; i++) {
    if (cut[i]! <= 1e-5) continue;
    const depth = depthAt(outer, inner, i);
    const k = Math.max(depth - cut[i]!, Math.min(depth, minimum)) / depth;
    for (let axis = 0; axis < 3; axis++)
      inner[3 * i + axis] = outer[3 * i + axis]! + (inner[3 * i + axis]! - outer[3 * i + axis]!) * k;
  }
  return inner;
}

const depthAt = (outer: Float32Array, inner: Float32Array, i: number) =>
  Math.hypot(outer[3 * i]! - inner[3 * i]!, outer[3 * i + 1]! - inner[3 * i + 1]!, outer[3 * i + 2]! - inner[3 * i + 2]!);
