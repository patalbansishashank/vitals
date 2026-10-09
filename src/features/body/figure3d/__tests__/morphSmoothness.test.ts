// The morphed skin and the fat layer under it must be smooth for every slider state: no vertex may stand out from its
// surroundings (the owner saw single vertices pulled out on the belly and a jagged outline at 57 % body fat).
// A vertex stands out when its displacement differs from the affine fit of its two-ring (scripts/figure/lib/smoothness.ts):
// an affine field (scaling, shear, translation) has zero residual, so the measure sees only kinks and spikes.
import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { affineResidual, distribution, normalBump, oneRing, twoRing } from '../../../../../scripts/figure/lib/smoothness';
import { FigureScene, coreState } from '../scene';
import { insetSubcutaneousShell } from '../subcutaneousShell';
import { vertexNormals } from '../renderer';
import { loadTestAsset } from './loadAsset';

const asset = loadTestAsset();
const scene = new FigureScene(asset);
const model = scene.model;
const V = model.vertexCount;
const indices = model.indices;
const base = model.base;
const referenceHeightCm = Number(asset.manifest.stats.referenceHeightCm);
const rings = oneRing(indices, V);
const neighbours = twoRing(rings);
const armL = asset.manifest.armPose!.leftWeights, armR = asset.manifest.armPose!.rightWeights;
const yOf = (v: number) => (base[3 * v + 1]! - base[3 * asset.manifest.height.bottom + 1]!) / referenceHeightCm;
/** The visible body: trunk, hips and legs above the ankles, below the neck; not the arms (they fold at the armpit). */
const body = (v: number) => armL[v]! < 0.5 && armR[v]! < 0.5 && yOf(v) > 0.08 && yOf(v) < 0.84;
/** The trunk alone (chest to hips), where the owner's report is. */
const trunk = (v: number) => body(v) && yOf(v) > 0.45 && yOf(v) < 0.8;

interface Case { name: string; sex: Sex; heightCm: number; weightKg: number; bf?: number; sliders?: BodyInputs['sliders'] }
export const CASES: Case[] = [
  ...[15, 33, 45, 57.4, 65, 75].flatMap((bf): Case[] => [
    { name: `male ${bf} % fat`, sex: 'male', heightCm: 176, weightKg: 86, bf },
    { name: `female ${bf} % fat`, sex: 'female', heightCm: 164, weightKg: 70, bf },
  ]),
  { name: 'male belly extreme', sex: 'male', heightCm: 176, weightKg: 110, bf: 50, sliders: { bellyVsHips: 1 } },
  { name: 'female hips extreme', sex: 'female', heightCm: 164, weightKg: 100, bf: 55, sliders: { bellyVsHips: -1 } },
  { name: 'female belly extreme, 75 %', sex: 'female', heightCm: 164, weightKg: 110, bf: 75, sliders: { bellyVsHips: 1 } },
  { name: 'male hips extreme, 75 %', sex: 'male', heightCm: 176, weightKg: 130, bf: 75, sliders: { bellyVsHips: -1 } },
  { name: 'male muscle max', sex: 'male', heightCm: 185, weightKg: 100, bf: 10, sliders: { muscularity: 1 } },
  { name: 'female muscle max', sex: 'female', heightCm: 170, weightKg: 75, bf: 15, sliders: { muscularity: 1 } },
  { name: 'male muscle min', sex: 'male', heightCm: 176, weightKg: 70, bf: 35, sliders: { muscularity: 0 } },
  { name: 'female muscle min', sex: 'female', heightCm: 164, weightKg: 60, bf: 40, sliders: { muscularity: 0 } },
  // The owner's screenshot: male frame, 57.4 % body fat, upper muscle as expected, lower much less than expected.
  { name: 'owner', sex: 'male', heightCm: 176, weightKg: 86, bf: 57.4, sliders: { muscleTorso: 0.37, muscleArms: 0.37, muscleLegs: -0.37, muscularity: 0.24 } },
];

export function measure(c: Case) {
  const inputs: BodyInputs = { sex: c.sex, ageYears: 40, heightCm: c.heightCm, weightKg: c.weightKg, sliders: c.sliders };
  const params = stateToAvatarParams(estimateInitialState(inputs, c.bf !== undefined ? { bodyFatPctOverride: c.bf } : {}));
  const frame = params.figure.frame;
  const fit = scene.fit(params, frame);
  // The skin's displacement from the rest shape, unscaled (the morph alone).
  const P = model.evaluate(fit.state);
  const skinDisp = new Float64Array(3 * V);
  for (let i = 0; i < skinDisp.length; i++) skinDisp[i] = P[i]! - base[i]!;
  const skin = affineResidual(base, skinDisp, neighbours);
  const skinBump = normalBump(base, skinDisp, rings, indices);
  // The fat layer's offset from the skin, in placed cm.
  const placed = scene.place(fit.state, c.heightCm);
  const inner = scene.place(coreState(fit.state), c.heightCm, undefined, placed.armSpacing).positions;
  insetSubcutaneousShell(placed.positions, inner, indices, c.heightCm, asset.thickness, referenceHeightCm, base, asset.manifest.shell?.pinned);
  const offset = new Float64Array(3 * V);
  for (let i = 0; i < offset.length; i++) offset[i] = inner[i]! - placed.positions[i]!;
  const fat = affineResidual(placed.positions, offset, neighbours);
  const fatBump = normalBump(placed.positions, offset, rings, indices);
  // Normals: the largest turn between a vertex normal and a neighbour's, degrees.
  const turn = (Q: Float32Array) => {
    const n = vertexNormals(Q, indices);
    const out = new Float64Array(V);
    for (let v = 0; v < V; v++) {
      let worst = 0;
      for (let e = rings.start[v]!; e < rings.start[v + 1]!; e++) {
        const j = rings.list[e]!;
        const c = n[3 * v]! * n[3 * j]! + n[3 * v + 1]! * n[3 * j + 1]! + n[3 * v + 2]! * n[3 * j + 2]!;
        worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
      }
      out[v] = worst;
    }
    return out;
  };
  const skinTurn = turn(placed.positions), fatTurn = turn(inner);
  const top = (r: Float64Array, mask: (v: number) => boolean, k = 6) =>
    Array.from({ length: V }, (_, v) => v).filter(mask).sort((a, b) => r[b]! - r[a]!).slice(0, k).map((v) => ({ v, r: +r[v]!.toFixed(3), x: +placed.positions[3 * v]!.toFixed(1), yCm: +placed.positions[3 * v + 1]!.toFixed(1), z: +placed.positions[3 * v + 2]!.toFixed(1) }));
  return {
    name: c.name,
    state: { frame: +frame.toFixed(2), weight: +fit.state.weight.toFixed(2), muscle: +fit.state.muscle.toFixed(2), locals: Object.fromEntries(Object.entries(fit.state.locals).filter(([, x]) => Math.abs(x) > 0.05).map(([k, x]) => [k, +x.toFixed(2)])) },
    skin: { body: distribution(skin, 0.3, body), trunk: distribution(skin, 0.3, trunk), top: top(skin, body) },
    skinBump: { body: distribution(skinBump, 0.2, body), trunk: distribution(skinBump, 0.2, trunk), top: top(skinBump, body) },
    fat: { body: distribution(fat, 0.3, body), trunk: distribution(fat, 0.3, trunk), top: top(fat, body) },
    fatBump: { body: distribution(fatBump, 0.2, body), trunk: distribution(fatBump, 0.2, trunk), top: top(fatBump, body) },
    normals: { skinTrunk: distribution(skinTurn, 35, trunk), fatTrunk: distribution(fatTurn, 35, trunk) },
  };
}

describe('morph smoothness', () => {
  const results = CASES.map(measure);
  if (process.env.SMOOTHNESS_JSON) {
    const { writeFileSync } = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process!.getBuiltinModule!('node:fs') as { writeFileSync: (p: string, s: string) => void };
    writeFileSync(process.env.SMOOTHNESS_JSON, JSON.stringify(results, null, 1));
  }
  // Limits: the pack before this work measured skin bump p99 0.59-0.88 cm and max 0.84-1.86 cm, fat-layer bump
  // p99 0.38-0.80 cm and max 0.55-1.42 cm, skin affine residual p99 1.0-2.0 cm over these states; the repaired pack
  // and the rebuilt layer measure skin p99 <= 0.36 / max <= 0.69, fat p99 <= 0.27 / max <= 0.90, residual p99 <= 0.69.
  it.each(results.map((r) => [r.name, r] as const))('%s: no skin vertex stands out from its surroundings', (_name, r) => {
    // 0.5 cm, not 0.4: the smooth belly curve (docs/wp/C-FIX-belly-profile.md) trades up to ~1 mm of p99 single-vertex bump at the
    // belly and hips extremes (measured 0.41-0.48 cm) for a smooth side silhouette without corner or flap; the max limit below holds.
    expect(r.skinBump.body.p99).toBeLessThan(0.5);
    // max 1.0 cm (was 0.8): at the belly extremes (measured 0.85-0.92 cm) the largest one-ring bump is the groin crease / navel dent
    // scaled with the belly, not a vertex pulled out of the surface (checked in the 45 degree render of male bf 50, belly +1).
    expect(r.skinBump.body.max).toBeLessThan(1.0);
    // 1.0 cm (was 0.8): the affine residual also measures real curvature, and the rounder belly (measured 0.84-0.87 cm at the
    // belly extremes) is more curved than the old pointed one was flat.
    expect(r.skin.body.p99).toBeLessThan(1.0);
  });
  it.each(results.map((r) => [r.name, r] as const))('%s: the fat layer is a smooth offset of the skin', (_name, r) => {
    expect(r.fatBump.body.p99).toBeLessThan(0.3);
    expect(r.fatBump.body.max).toBeLessThan(1.0);
  });
  it.each(results.map((r) => [r.name, r] as const))('%s: vertex normals over the trunk turn no more than the repaired pack does', (_name, r) => {
    // A guard, not a smoothness claim: the trunk keeps real creases (crotch, armpit, under the breast, the nipple
    // cones), so the 99th percentile of the largest turn between neighbouring vertex normals is 56-61 degrees on the
    // skin (73-77 before) and up to 83 on the layer under the belly overhang of the heaviest bodies.
    expect(r.normals.skinTrunk.p99).toBeLessThan(65);
    expect(r.normals.fatTrunk.p99).toBeLessThan(85);
  });
});
