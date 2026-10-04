import { estimateInitialState, stateToAvatarParams, type Sex } from '@/engine/body';
import { decodeAnatomy } from '../anatomyAsset';
import { FigureScene } from '../scene';
import { loadTestAsset } from './loadAsset';

interface NodeMods {
  fs: { readFileSync(path: string): Uint8Array };
  zlib: { gunzipSync(bytes: Uint8Array): Uint8Array };
}
const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
if (!get) throw new Error('Node needed');
const fs = get('node:fs') as NodeMods['fs'];
const zlib = get('node:zlib') as NodeMods['zlib'];
const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const scene = new FigureScene(loadTestAsset());

// Packed figure-v2 indices of original hm08 body vertices with >0.8 weight on
// MakeHuman default_weights.mhw finger3-3.L. Derived from the bake's kept-vertex
// map; these identify the hand itself, avoiding thigh/hip vertices in y slices.
const LEFT_MIDDLE_FINGER = [
  6519, 6525, 6563, 6565, 6567, 6583, 6585, 6591, 6593, 6599, 6603, 6605,
  6607, 6621, 6623, 6631, 6633, 6637, 6641, 6643, 6645, 6651, 6657, 6671,
  6673, 6675, 6677, 6679, 6681, 6683, 6685, 6691, 6693, 6695, 6697, 6699,
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function fittedFinger(sex: Sex, heightCm: number, weightKg: number, frame: number): [number, number, number] {
  const estimate = estimateInitialState({ sex, ageYears: 40, heightCm, weightKg });
  const params = stateToAvatarParams(estimate, { frame });
  const fit = scene.fit(params, frame);
  const positions = scene.place(fit.state, heightCm).positions;
  return [0, 1, 2].map((axis) => median(LEFT_MIDDLE_FINGER.map((i) => positions[3 * i + axis]!))) as [number, number, number];
}

function atlasFinger(heightCm: number, frame: number): [number, number, number] {
  const part = anatomy.manifest.source.selected.find((p) => p.id === 'FJ3186');
  if (!part) throw new Error('missing left middle distal phalanx');
  const points = Array.from({ length: part.vertexCount }, (_, j) => part.vertexStart + j);
  const base = [0, 1, 2].map((axis) => median(points.map((i) => anatomy.positions[3 * i + axis]!)));
  // Reference-frame endpoints also used by the WebGL arm shader at y≈72cm:
  // hips-led female base -> shoulders-led male distal-hand displacement.
  const reference = [base[0]! + 4.7 * frame, base[1]! - 6.1 * frame, base[2]! + 8.9 * frame];
  return reference.map((value) => value * heightCm / anatomy.heightCm) as [number, number, number];
}

it.each([
  ['male', 178, 84.9, 1],
  ['female', 165, 65, 0],
  ['female', 165, 65, 0.5],
] as const)('keeps named atlas fingers by the fitted %s hand at %icm', (sex, height, weight, frame) => {
  const skin = fittedFinger(sex, height, weight, frame);
  const bone = atlasFinger(height, frame);
  for (let axis = 0; axis < 3; axis++) expect(Math.abs(skin[axis]! - bone[axis]!)).toBeLessThan(8);
});
