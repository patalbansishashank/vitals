// Reproducible proportional editing of the anterior trunk in rest-space cm.
// Gaussian local-linear stencils preserve translations and linear stretch, but remove the short-wavelength tent
// in the pregnancy/waist targets. Area weights keep the dense navel topology from dominating the fitted profile.
// The same operator is applied to every key, so blending keys blends the corrected profiles too.
const ramp = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * t * (10 + t * (-15 + 6 * t));
};
export function bellyStencils(
  P: Float64Array,
  triangles: ArrayLike<number>,
  armL: Float64Array,
  armR: Float64Array,
) {
  const n = P.length / 3;
  let lo = Infinity,
    hi = -Infinity;
  for (let v = 0; v < n; v++) {
    lo = Math.min(lo, P[3 * v + 1]!);
    hi = Math.max(hi, P[3 * v + 1]!);
  }
  const area = new Float64Array(n);
  for (let f = 0; f < triangles.length; f += 3) {
    const a = triangles[f]!,
      b = triangles[f + 1]!,
      c = triangles[f + 2]!;
    const u = [0, 1, 2].map((k) => P[3 * b + k]! - P[3 * a + k]!);
    const w = [0, 1, 2].map((k) => P[3 * c + k]! - P[3 * a + k]!);
    const A = Math.hypot(
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    );
    for (const v of [a, b, c]) area[v] += A;
  }
  const mask = Float64Array.from({ length: n }, (_, v) => {
    const y = (P[3 * v + 1]! - lo) / (hi - lo);
    const centre = 1 - ramp(4, 10, Math.abs(P[3 * v]!));
    return (
      ramp(0.46, 0.53, y) *
      (1 - ramp(0.66 + 0.06 * centre, 0.72 + 0.06 * centre, y)) *
      ramp(-1, 7, P[3 * v + 2]!) *
      (1 - ramp(13, 24, Math.abs(P[3 * v]!))) *
      (1 - ramp(0.02, 0.2, Math.max(armL[v]!, armR[v]!)))
    );
  });
  const candidates = Array.from({ length: n }, (_, v) => v).filter(
    (v) => P[3 * v + 2]! > -1 && Math.max(armL[v]!, armR[v]!) < 0.2,
  );
  const rows: { v: number; ids: number[]; weights: number[] }[] = [];
  for (let v = 0; v < n; v++) {
    if (mask[v]! < 1e-6) continue;
    const ids: number[] = [],
      ws: number[] = [],
      dxs: number[] = [],
      dys: number[] = [];
    let a = 0,
      b = 0,
      c = 0,
      d = 0,
      e = 0,
      f = 0;
    for (const j of candidates) {
      const x = (P[3 * j]! - P[3 * v]!) / 4,
        y = (P[3 * j + 1]! - P[3 * v + 1]!) / 8;
      const r2 = x * x + y * y;
      if (r2 > 16) continue;
      const w = Math.exp(-r2 / 2) * area[j]!;
      ids.push(j);
      ws.push(w);
      dxs.push(x);
      dys.push(y);
      a += w;
      b += w * x;
      c += w * y;
      d += w * x * x;
      e += w * x * y;
      f += w * y * y;
    }
    const det = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
    if (Math.abs(det) < 1e-9) continue;
    const A = (d * f - e * e) / det,
      B = (c * e - b * f) / det,
      C = (b * e - c * d) / det;
    rows.push({ v, ids, weights: ws.map((w, k) => w * (A + B * dxs[k]! + C * dys[k]!)) });
  }
  return {
    mask,
    apply(D: Float64Array, navelOnly = false) {
      const source = D.slice();
      for (const { v, ids, weights } of rows)
        for (let k = 0; k < 3; k++) {
          let fitted = 0;
          for (let j = 0; j < ids.length; j++) fitted += weights[j]! * source[3 * ids[j]! + k]!;
          const y = (P[3 * v + 1]! - lo) / (hi - lo);
          const navel = navelOnly
            ? (1 - ramp(2, 7, Math.abs(P[3 * v]!))) * ramp(0.51, 0.55, y) * (1 - ramp(0.68, 0.74, y))
            : 1;
          D[3 * v + k] = source[3 * v + k]! + mask[v]! * navel * (fitted - source[3 * v + k]!);
        }
    },
  };
}

/** A large waist is not a second belly on the lumbar spine. Move most of the waist key's rearward growth to the
 * front by translating each trunk cross-section, rather than shrinking its girth. The smooth shift is derived from
 * the key's own posterior midline displacement; arms are excluded by the source rig weights.
 */
export function recenterWaist(
  P: Float64Array,
  D: Float64Array,
  armL: Float64Array,
  armR: Float64Array,
): void {
  const n = P.length / 3;
  let lo = Infinity,
    hi = -Infinity;
  for (let v = 0; v < n; v++) {
    lo = Math.min(lo, P[3 * v + 1]!);
    hi = Math.max(hi, P[3 * v + 1]!);
  }
  const back = Array.from({ length: n }, (_, v) => v).filter(
    (v) => Math.abs(P[3 * v]!) < 6 && P[3 * v + 2]! < -2 && Math.max(armL[v]!, armR[v]!) < 0.02,
  );
  const source = D.slice();
  for (let v = 0; v < n; v++) {
    const y = (P[3 * v + 1]! - lo) / (hi - lo);
    const mask =
      ramp(0.46, 0.53, y) * (1 - ramp(0.69, 0.77, y)) * (1 - ramp(0.02, 0.2, Math.max(armL[v]!, armR[v]!)));
    if (mask < 1e-6) continue;
    let sum = 0,
      total = 0;
    for (const j of back) {
      const dy = (P[3 * j + 1]! - P[3 * v + 1]!) / 6;
      if (Math.abs(dy) > 4) continue;
      const w = Math.exp((-dy * dy) / 2);
      sum += w * source[3 * j + 2]!;
      total += w;
    }
    if (total) D[3 * v + 2] = D[3 * v + 2]! - 0.8 * mask * Math.min(0, sum / total);
  }
}

/** Project the anterior waist key onto a broad profile with continuous tangents. A Gaussian-smoothed authored tent can still become
 * conical at seven times its authored influence. The rounded apex and lower transition keep that high-girth
 * shape bulbous; the measured waist keeps the key's peak depth and the flank/arm falloffs remain continuous.
 */
export function projectWaistProfile(P: Float64Array, D: Float64Array, mask: Float64Array): void {
  const n=P.length/3;
  let lo=Infinity,hi=-Infinity,amplitude=0;
  for(let v=0;v<n;v++){lo=Math.min(lo,P[3*v+1]!);hi=Math.max(hi,P[3*v+1]!);}
  for(let v=0;v<n;v++) {
    const y=(P[3*v+1]!-lo)/(hi-lo);
    if(mask[v]!>.95 && Math.abs(P[3*v]!)<4 && y>.57 && y<.65)amplitude=Math.max(amplitude,D[3*v+2]!);
  }
  for(let v=0;v<n;v++) {
    const y=(P[3*v+1]!-lo)/(hi-lo);
    const r = (y - .625) / .14;
    const profile = Math.max(0, 1 - r*r) ** 2;
    D[3*v+2]=D[3*v+2]!+mask[v]!*(amplitude*profile-D[3*v+2]!);
  }
}
