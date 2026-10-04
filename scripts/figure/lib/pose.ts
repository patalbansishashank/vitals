// Bakes a lowered-arm pose into the mesh with linear blend skinning, using MakeHuman's own (CC0) default rig weights.
// MakeHuman's rest pose is an A-pose with the upper arm ~40 deg from vertical; the figure wants ~10 deg (as the SVG avatar).
// LBS is linear in position, so a target delta d is posed as M_v d with M_v = sum_b w_b R_b (the same per-vertex matrix).

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Rotation about the z axis (MakeHuman: x = left/right, y = up, z = front). */
export function rotZ(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotation taking unit direction a onto unit direction b (Rodrigues), row-major. */
export function rotBetween(a: readonly number[], b: readonly number[]): Mat3 {
  const [ax, ay, az] = a as [number, number, number];
  const [bx, by, bz] = b as [number, number, number];
  let kx = ay * bz - az * by, ky = az * bx - ax * bz, kz = ax * by - ay * bx;
  const sin = Math.hypot(kx, ky, kz);
  const cos = ax * bx + ay * by + az * bz;
  if (sin < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  kx /= sin;
  ky /= sin;
  kz /= sin;
  const C = 1 - cos;
  return [
    cos + kx * kx * C, kx * ky * C - kz * sin, kx * kz * C + ky * sin,
    ky * kx * C + kz * sin, cos + ky * ky * C, ky * kz * C - kx * sin,
    kz * kx * C - ky * sin, kz * ky * C + kx * sin, cos + kz * kz * C,
  ];
}

export function normalise(v: readonly number[]): [number, number, number] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

export interface ArmPose {
  /** Shoulder joint centre (rotation pivot). */
  pivot: [number, number, number];
  /** Rotation of this arm. */
  rot: Mat3;
  /** Per-vertex skin weight of the arm chain (0..1). */
  weight: Float64Array;
}

/** Per-vertex 3x3 matrices M_v = (1 - w) I + w R and the pivot offset; applied in place to positions. */
export function posePositions(pos: Float64Array, arms: readonly ArmPose[]): void {
  const n = pos.length / 3;
  for (const arm of arms) {
    const [px, py, pz] = arm.pivot;
    const R = arm.rot;
    for (let v = 0; v < n; v++) {
      const w = arm.weight[v]!;
      if (w <= 0) continue;
      const x = pos[3 * v]! - px;
      const y = pos[3 * v + 1]! - py;
      const z = pos[3 * v + 2]! - pz;
      const rx = R[0] * x + R[1] * y + R[2] * z;
      const ry = R[3] * x + R[4] * y + R[5] * z;
      const rz = R[6] * x + R[7] * y + R[8] * z;
      pos[3 * v] = px + x + w * (rx - x);
      pos[3 * v + 1] = py + y + w * (ry - y);
      pos[3 * v + 2] = pz + z + w * (rz - z);
    }
  }
}

/** Poses a target delta array in place (rotation part only; pivots cancel). */
export function poseDeltas(d: Float64Array, arms: readonly ArmPose[]): void {
  const n = d.length / 3;
  for (const arm of arms) {
    const R = arm.rot;
    for (let v = 0; v < n; v++) {
      const w = arm.weight[v]!;
      if (w <= 0) continue;
      const x = d[3 * v]!;
      const y = d[3 * v + 1]!;
      const z = d[3 * v + 2]!;
      d[3 * v] = x + w * (R[0] * x + R[1] * y + R[2] * z - x);
      d[3 * v + 1] = y + w * (R[3] * x + R[4] * y + R[5] * z - y);
      d[3 * v + 2] = z + w * (R[6] * x + R[7] * y + R[8] * z - z);
    }
  }
}

/** Bones whose skin weights move rigidly with the arm. `shoulder01` follows at half weight (spreads the bend). */
export function armChainWeight(
  weights: Record<string, Array<[number, number]>>,
  side: 'L' | 'R',
  vertexCount: number,
  part: 'arm' | 'forearm' = 'arm',
): Float64Array {
  const out = new Float64Array(vertexCount);
  const rigid =
    part === 'arm' ? /^(upperarm0[12]|lowerarm0[12]|wrist|metacarpal\d|finger\d-\d)\.[LR]$/ : /^(lowerarm0[12]|wrist|metacarpal\d|finger\d-\d)\.[LR]$/;
  for (const [bone, list] of Object.entries(weights)) {
    if (!bone.endsWith(`.${side}`)) continue;
    const share = rigid.test(bone) ? 1 : part === 'arm' && bone.startsWith('shoulder01.') ? 0.5 : 0;
    if (!share) continue;
    for (const [v, w] of list) if (v < vertexCount) out[v] = out[v]! + share * w;
  }
  for (let v = 0; v < vertexCount; v++) out[v] = Math.min(1, out[v]!);
  return out;
}

/** Centroid of a list of vertices. */
export function centroid(pos: Float64Array, ids: readonly number[]): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  for (const i of ids) {
    c[0] += pos[3 * i]! / ids.length;
    c[1] += pos[3 * i + 1]! / ids.length;
    c[2] += pos[3 * i + 2]! / ids.length;
  }
  return c;
}
