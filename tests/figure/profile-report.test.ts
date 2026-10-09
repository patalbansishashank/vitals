// Side profile of the trunk: the front (belly) and back outlines sampled per cm of height, with the turning angle
// per cm along each outline. Writes to PROFILE_OUT when set; FIGURE_PACK=<path> measures another pack (an old one).
import { writeFileSync } from 'node:fs';
import { estimateInitialState, stateToAvatarParams, type BodyInputs } from '@/engine/body';
import { FigureScene, coreState } from '@/features/body/figure3d/scene';
import { insetSubcutaneousShell } from '@/features/body/figure3d/subcutaneousShell';
import { loadTestAsset } from '@/features/body/figure3d/__tests__/loadAsset';

const asset = loadTestAsset();
const scene = new FigureScene(asset);
const model = scene.model;
const V = model.vertexCount;
const armL = asset.manifest.armPose!.leftWeights, armR = asset.manifest.armPose!.rightWeights;

/** Midsagittal section of the trunk: the mesh's edges cut by the plane x = 0 (arms excluded), then per 1 cm band of
 * height the largest z (front outline) and the smallest z (back outline). */
export function sideProfile(P: Float32Array, heightCm: number) {
  const lo = Math.round(0.5 * heightCm), hi = Math.round(0.82 * heightCm);
  const front = new Float64Array(hi - lo + 1).fill(-Infinity), back = new Float64Array(hi - lo + 1).fill(Infinity);
  const idx = model.indices;
  // front and back halves of the section are told apart by their z against the trunk's middle plane (the mean z of
  // central vertices at this height range)
  let zSum = 0, zCount = 0;
  for (let v = 0; v < V; v++) if (armL[v]! < 0.3 && armR[v]! < 0.3 && Math.abs(P[3 * v]!) < 8 && P[3 * v + 1]! > lo && P[3 * v + 1]! < hi) { zSum += P[3 * v + 2]!; zCount++; }
  const middle = zSum / (zCount || 1);
  const seen = new Set<number>();
  for (let f = 0; f < idx.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = idx[f + k]!, b = idx[f + ((k + 1) % 3)]!;
      const key = a < b ? a * V + b : b * V + a;
      if (seen.has(key)) continue;
      seen.add(key);
      if (armL[a]! > 0.3 || armR[a]! > 0.3 || armL[b]! > 0.3 || armR[b]! > 0.3) continue;
      const xa = P[3 * a]!, xb = P[3 * b]!;
      if ((xa > 0 && xb > 0) || (xa < 0 && xb < 0)) continue;
      const t = xa === xb ? 0 : xa / (xa - xb);
      const y = P[3 * a + 1]! + t * (P[3 * b + 1]! - P[3 * a + 1]!);
      const z = P[3 * a + 2]! + t * (P[3 * b + 2]! - P[3 * a + 2]!);
      const band = Math.round(y) - lo;
      if (band < 0 || band >= front.length) continue;
      if (z > middle) front[band] = Math.max(front[band]!, z);
      else back[band] = Math.min(back[band]!, z);
    }
  // bands without a crossing take the line between their finite neighbours
  for (const a of [front, back])
    for (let i = 0; i < a.length; i++)
      if (!Number.isFinite(a[i]!)) {
        let p = i - 1, q = i + 1;
        while (p >= 0 && !Number.isFinite(a[p]!)) p--;
        while (q < a.length && !Number.isFinite(a[q]!)) q++;
        a[i] = p >= 0 && q < a.length ? a[p]! + ((a[q]! - a[p]!) * (i - p)) / (q - p) : p >= 0 ? a[p]! : a[q]!;
      }
  return { lo, front, back };
}

/** Turning angle (degrees) at each sample of a polyline (x_i = z, y_i = height, 1 cm apart), and the largest. */
export function turning(z: Float64Array) {
  const out = new Float64Array(z.length);
  for (let i = 1; i < z.length - 1; i++) {
    const a = Math.atan2(1, z[i]! - z[i - 1]!), b = Math.atan2(1, z[i + 1]! - z[i]!);
    out[i] = Math.abs((b - a) * 180) / Math.PI;
  }
  return out;
}

it('reports the side profile', () => {
  const lines: string[] = [];
  const cases: Array<[string, BodyInputs, number]> = [
    ['owner', { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 86, sliders: { muscleTorso: 0.37, muscleArms: 0.37, muscleLegs: -0.37, muscularity: 0.24 } }, 57.4],
    ['male 45', { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 86 }, 45],
    ['male 65', { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 86 }, 65],
    ['male belly max 57', { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 86, sliders: { bellyVsHips: 1 } }, 57.4],
    ['male belly min 57', { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 86, sliders: { bellyVsHips: -1 } }, 57.4],
    ['female 57', { sex: 'female', ageYears: 40, heightCm: 164, weightKg: 70 }, 57.4],
    ['male hips extreme 75', { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 130, sliders: { bellyVsHips: -1 } }, 75],
    ['female belly extreme 75', { sex: 'female', ageYears: 40, heightCm: 164, weightKg: 110, sliders: { bellyVsHips: 1 } }, 75],
  ];
  for (const [name, inputs, bf] of cases) {
    const params = stateToAvatarParams(estimateInitialState(inputs, { bodyFatPctOverride: bf }));
    const fit = scene.fit(params, params.figure.frame);
    const h = inputs.heightCm;
    const placed = scene.place(fit.state, h);
    const inner = scene.place(coreState(fit.state), h, undefined, placed.armSpacing).positions;
    insetSubcutaneousShell(placed.positions, inner, model.indices, h, asset.thickness, Number(asset.manifest.stats.referenceHeightCm), model.base, asset.manifest.shell?.pinned);
    const s = fit.state;
    lines.push(`${name}: weight=${s.weight.toFixed(2)} muscle=${s.muscle.toFixed(2)} ${Object.entries(s.locals).filter(([, x]) => Math.abs(x) > 0.05).map(([k, x]) => `${k}=${x.toFixed(2)}`).join(' ')}`);
    for (const [label, P] of [['skin', placed.positions], ['fat', inner]] as const) {
      const prof = sideProfile(P, h);
      for (const [side, z] of [['front', prof.front], ['back', prof.back]] as const) {
        const t = turning(z);
        const worst = Array.from(t).map((a, i) => [a, i] as const).sort((p, q) => q[0] - p[0]).slice(0, 3).map(([a, i]) => `${a.toFixed(0)}°@${prof.lo + i}cm(z=${z[i]!.toFixed(1)})`);
        lines.push(`  ${label} ${side}: max turn ${Math.max(...t).toFixed(1)}° worst ${worst.join(' ')}`);
        if (label === 'skin' && side === 'front') lines.push(`    z per cm from ${prof.lo}: ${Array.from(z, (v) => v.toFixed(1)).join(' ')}`);
      }
    }
  }
  if (process.env.PROFILE_OUT) writeFileSync(process.env.PROFILE_OUT, lines.join('\n') + '\n');
  expect(lines.length).toBeGreaterThan(0);
});

it('attributes the belly corner to targets (owner state)', () => {
  if (!process.env.PROFILE_OUT) return;
  const inputs: BodyInputs = { sex: 'male', ageYears: 40, heightCm: 176, weightKg: 86, sliders: { muscleTorso: 0.37, muscleArms: 0.37, muscleLegs: -0.37, muscularity: 0.24 } };
  const params = stateToAvatarParams(estimateInitialState(inputs, { bodyFatPctOverride: 57.4 }));
  const fit = scene.fit(params, params.figure.frame);
  const h = 176;
  const lines: string[] = [];
  const run = (label: string, state: typeof fit.state) => {
    const placed = scene.place(state, h);
    const prof = sideProfile(placed.positions, h);
    const t = turning(prof.front);
    const i0 = 92 - prof.lo;
    lines.push(`${label.padEnd(26)} max turn ${Math.max(...t).toFixed(0)}° @${prof.lo + t.indexOf(Math.max(...t))}cm; z 92..112: ${Array.from(prof.front.subarray(i0, i0 + 21), (v) => v.toFixed(1)).join(' ')}`);
  };
  run('full', fit.state);
  for (const id of ['waist', 'belly', 'torsoDepth', 'shoulders', 'hips', 'thigh', 'bust']) run(`without ${id}`, { ...fit.state, locals: { ...fit.state.locals, [id]: 0 } });
  run('weight 0.5', { ...fit.state, weight: 0.5 });
  run('weight 1.0', { ...fit.state, weight: 1.0 });
  run('locals off', { ...fit.state, locals: {} });
  run('only waist 1.76', { frame: 1, muscle: 0.5, weight: 0.5, locals: { waist: 1.76 } });
  run('only belly 1', { frame: 1, muscle: 0.5, weight: 0.5, locals: { belly: 1 } });
  run('only weight 1', { frame: 1, muscle: 0.5, weight: 1, locals: {} });
  run('neutral', { frame: 1, muscle: 0.5, weight: 0.5, locals: {} });
  writeFileSync(process.env.PROFILE_OUT.replace('.txt', '-attrib.txt'), lines.join('\n') + '\n');
});

it('profiles each target alone', () => {
  if (!process.env.PROFILE_OUT) return;
  const h = Number(asset.manifest.stats.referenceHeightCm);
  const lines: string[] = [];
  const show = (label: string, P: Float32Array) => {
    // place: floor at 0
    const Q = Float32Array.from(P);
    const floor = Q[3 * asset.manifest.height.bottom + 1]!;
    for (let i = 1; i < Q.length; i += 3) Q[i] = Q[i]! - floor;
    const prof = sideProfile(Q, h);
    const t = turning(prof.front);
    const i0 = 88 - prof.lo;
    lines.push(`${label.padEnd(34)} max turn ${Math.max(...t).toFixed(0)}°@${prof.lo + t.indexOf(Math.max(...t))} z 88..118: ${Array.from(prof.front.subarray(i0, i0 + 31), (v) => v.toFixed(1)).join(' ')}`);
  };
  const neutral = model.evaluate({ frame: 1, muscle: 0.5, weight: 0.5, locals: {} });
  show('neutral male', neutral);
  for (const id of ['macro-shouldersLed-min-max', 'macro-shouldersLed-average-max', 'macro-shouldersLed-max-max', 'macro-shouldersLed-min-average', 'local-waist-incr', 'local-belly-incr', 'local-torsoDepth-decr', 'local-hips-decr', 'local-shoulders-decr']) {
    const t = asset.targets.get(id)!;
    const P = Float32Array.from(neutral);
    if (!t.indices) for (let i = 0; i < P.length; i++) P[i] = P[i]! + t.deltas[i]!;
    else t.indices.forEach((v, j) => { for (let k = 0; k < 3; k++) P[3 * v + k] = P[3 * v + k]! + t.deltas[3 * j + k]!; });
    show(`${id} x1`, P);
  }
  writeFileSync(process.env.PROFILE_OUT.replace('.txt', '-targets.txt'), lines.join('\n') + '\n');
});
