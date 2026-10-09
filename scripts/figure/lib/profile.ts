// Exact sagittal triangle sections, sampled at fixed physical heights. Never round vertices into height bins:
// that produces artificial corners when a sample jumps between two different heights on a sloping surface.
export function frontProfile(
  P: Float32Array,
  indices: ArrayLike<number>,
  height: number,
  arm: (v: number) => boolean,
  fraction = 0.0,
) {
  const lo = 0.5 * height,
    hi = 0.72 * height,
    step = 0.5;
  const front = new Float64Array(Math.floor((hi - lo) / step) + 1).fill(-Infinity);
  const crossings: number[][] = Array.from(front, () => []);
  const xPlane = fraction * height;
  for (let f = 0; f < indices.length; f += 3) {
    const vertices = [indices[f]!, indices[f + 1]!, indices[f + 2]!];
    if (vertices.some(arm)) continue;
    const cuts: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = vertices[k]!,
        b = vertices[(k + 1) % 3]!;
      const x = P[3 * a]! - xPlane,
        X = P[3 * b]! - xPlane;
      if (x === 0) cuts.push([P[3 * a + 1]!, P[3 * a + 2]!]);
      if (x * X < 0) {
        const t = x / (x - X);
        cuts.push([
          P[3 * a + 1]! + t * (P[3 * b + 1]! - P[3 * a + 1]!),
          P[3 * a + 2]! + t * (P[3 * b + 2]! - P[3 * a + 2]!),
        ]);
      }
    }
    for (let a = 0; a < cuts.length; a++)
      for (let b = a + 1; b < cuts.length; b++) {
        const [y, z] = cuts[a]!,
          [Y, Z] = cuts[b]!;
        if (Math.abs(Y - y) < 1e-6) continue;
        const first = Math.max(0, Math.ceil((Math.min(y, Y) - lo) / step));
        const last = Math.min(front.length - 1, Math.floor((Math.max(y, Y) - lo) / step));
        for (let i = first; i <= last; i++) {
          const depth = z + ((lo + i * step - y) / (Y - y)) * (Z - z);
          front[i] = Math.max(front[i]!, depth);
          if (depth > 3 && !crossings[i]!.some((d) => Math.abs(d - depth) < 0.01)) crossings[i]!.push(depth);
        }
      }
  }
  return { lo, step, front, crossings };
}
// Turn across 2 cm chords / arc length, in degrees per cm. This sees a regional corner without confusing
// the 0.5 mm quantisation or the small navel dent with the whole belly's curvature.
export function profileCurvature(z: Float64Array, step: number) {
  const span = Math.round(2 / step),
    out: number[] = [];
  for (let i = span; i < z.length - span; i++) {
    const a = z[i]! - z[i - span]!,
      b = z[i + span]! - z[i]!,
      dy = span * step;
    out.push(
      (Math.abs(Math.atan2(dy, b) - Math.atan2(dy, a)) * 180) /
        Math.PI /
        ((Math.hypot(a, dy) + Math.hypot(b, dy)) / 2),
    );
  }
  return out;
}

/** True orthographic side silhouette: project all trunk triangles, excluding the rig-weighted arms.
 * A navel section is useful for diagnosis, but a navel dent inside the outline is not a silhouette corner.
 */
export function sideSilhouette(
  P: Float32Array,
  indices: ArrayLike<number>,
  height: number,
  arm: (v: number) => boolean,
) {
  const lo = 0.5 * height,
    hi = 0.69 * height,
    step = 0.5;
  const front = new Float64Array(Math.floor((hi - lo) / step) + 1).fill(-Infinity);
  for (let f = 0; f < indices.length; f += 3) {
    const vertices = [indices[f]!, indices[f + 1]!, indices[f + 2]!];
    if (vertices.some(arm)) continue;
    for (let k = 0; k < 3; k++) {
      const a = vertices[k]!,
        b = vertices[(k + 1) % 3]!;
      const y = P[3 * a + 1]!,
        Y = P[3 * b + 1]!;
      if (Math.abs(Y - y) < 1e-6) continue;
      const first = Math.max(0, Math.ceil((Math.min(y, Y) - lo) / step));
      const last = Math.min(front.length - 1, Math.floor((Math.max(y, Y) - lo) / step));
      for (let i = first; i <= last; i++)
        front[i] = Math.max(
          front[i]!,
          P[3 * a + 2]! + ((lo + i * step - y) / (Y - y)) * (P[3 * b + 2]! - P[3 * a + 2]!),
        );
    }
  }
  return { lo, step, front };
}
