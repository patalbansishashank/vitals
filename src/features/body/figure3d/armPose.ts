// The authored shoulder angle is relaxed. A broad fitted chest or upper arm
// can still crowd its neighbour; use the same baked rig to make a small gap.
import type { FigureManifest } from './manifest';

export interface ArmSpacing {
  left: number;
  right: number;
}

/** Rig side spacing, shared by the outer skin, lean layer and reference anatomy. */
export function spaceArms(
  P: Float32Array,
  indices: Uint16Array,
  manifest: FigureManifest,
  heightCm: number,
  frame: number,
  spacing?: ArmSpacing,
): ArmSpacing {
  const rig = manifest.armPose,
    regions = manifest.armClearance;
  if (!rig || !regions) return { left: 0, right: 0 };
  const scale = heightCm / Number(manifest.stats.referenceHeightCm);
  if (!spacing) {
    const step = 0.5 * scale;
    const count = Math.ceil(heightCm / step) + 2;
    const leftBody = new Float32Array(count).fill(-Infinity),
      rightBody = new Float32Array(count).fill(-Infinity);
    const body = new Uint8Array(P.length / 3),
      left = new Uint8Array(body.length),
      right = new Uint8Array(body.length);
    for (const v of regions.centralBody) body[v] = 1;
    for (const v of regions.leftArm) left[v] = 1;
    for (const v of regions.rightArm) right[v] = 1;
    const band = (y: number) => Math.max(0, Math.min(count - 1, Math.floor(y / step)));
    // Full triangle bounds make this conservative between vertices and through
    // the curved ribcage/hip contour, rather than checking only sample points.
    for (let face = 0; face < indices.length; face += 3) {
      const a = indices[face]!,
        b = indices[face + 1]!,
        c = indices[face + 2]!;
      if (!body[a] || !body[b] || !body[c]) continue;
      const low = band(Math.min(P[3 * a + 1]!, P[3 * b + 1]!, P[3 * c + 1]!));
      const high = band(Math.max(P[3 * a + 1]!, P[3 * b + 1]!, P[3 * c + 1]!));
      const lx = Math.max(P[3 * a]!, P[3 * b]!, P[3 * c]!);
      const rx = -Math.min(P[3 * a]!, P[3 * b]!, P[3 * c]!);
      for (let k = low; k <= high; k++) {
        leftBody[k] = Math.max(leftBody[k]!, lx);
        rightBody[k] = Math.max(rightBody[k]!, rx);
      }
    }
    const jointY = (name: string) => {
      const joint = manifest.joints!.find((j) => j.id === name)!;
      return (
        (joint.hipsLed[1] + Math.max(0, Math.min(1, frame)) * (joint.shouldersLed[1] - joint.hipsLed[1])) *
        scale
      );
    };
    const bounds = [
      {
        mask: left,
        weights: rig.leftWeights,
        body: leftBody,
        sign: 1,
        shoulder: jointY('shoulderL') - 5 * scale,
        wrist: jointY('wristL') - 2 * scale,
      },
      {
        mask: right,
        weights: rig.rightWeights,
        body: rightBody,
        sign: -1,
        shoulder: jointY('shoulderR') - 5 * scale,
        wrist: jointY('wristR') - 2 * scale,
      },
    ];
    const offsets = [0, 0];
    bounds.forEach((side, i) => {
      for (let face = 0; face < indices.length; face += 3) {
        const vertices = [indices[face]!, indices[face + 1]!, indices[face + 2]!];
        if (!vertices.every((v) => side.mask[v])) continue;
        const lowY = Math.min(...vertices.map((v) => P[3 * v + 1]!)),
          highY = Math.max(...vertices.map((v) => P[3 * v + 1]!));
        if (highY >= side.shoulder || lowY <= side.wrist) continue;
        const low = band(lowY - rig.clearanceCm * scale),
          high = band(highY + rig.clearanceCm * scale);
        let extent = -Infinity;
        for (let k = low; k <= high; k++) extent = Math.max(extent, side.body[k]!);
        const inner = Math.min(...vertices.map((v) => side.sign * P[3 * v]!));
        const weight = Math.min(...vertices.map((v) => Math.max(0, (side.weights[v]! - 0.05) / 0.95)));
        if (weight > 0)
          offsets[i] = Math.max(offsets[i]!, (extent + rig.clearanceCm * scale - inner) / weight);
      }
    });
    spacing = { left: Math.max(0, offsets[0]!), right: Math.max(0, offsets[1]!) };
  }
  for (let v = 0; v < P.length / 3; v++) {
    const l = Math.max(0, (rig.leftWeights[v]! - 0.05) / 0.95),
      r = Math.max(0, (rig.rightWeights[v]! - 0.05) / 0.95);
    P[3 * v] = P[3 * v]! + spacing.left * l - spacing.right * r;
  }
  return spacing;
}
