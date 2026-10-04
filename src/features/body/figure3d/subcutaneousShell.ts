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
