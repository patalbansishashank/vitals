// Measures how smooth the morphed skin is: for a sweep of slider states it evaluates the mesh through the app's own
// fit -> evaluate path, takes each vertex's displacement from the rest shape, and compares it with the mean displacement
// of its one-ring neighbours (a discrete Laplacian of the displacement field). Lists the outliers, where they are on the
// body and which target made them. Writes the full report when SMOOTHNESS_JSON=<path> is set:
//   SMOOTHNESS_JSON=.e6-tmp/C-FIX/smoothness.json TMPDIR=$PWD/.e6-tmp pnpm exec vitest run tests/figure/morph-smoothness
import { writeFileSync } from 'node:fs';
import { FigureScene, coreState } from '@/features/body/figure3d/scene';
import { insetSubcutaneousShell } from '@/features/body/figure3d/subcutaneousShell';
import { loadTestAsset } from '@/features/body/figure3d/__tests__/loadAsset';
import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import type { MorphState } from '@/features/body/figure3d/model';

const asset = loadTestAsset();
const scene = new FigureScene(asset);
const model = scene.model;
const V = model.vertexCount;
const idx = model.indices;
const base = model.base;
const ref = Number(asset.manifest.stats.referenceHeightCm);

// one-ring
const near: number[][] = Array.from({ length: V }, () => []);
for (let f = 0; f < idx.length; f += 3)
  for (let k = 0; k < 3; k++) {
    const a = idx[f + k]!, b = idx[f + ((k + 1) % 3)]!;
    if (!near[a]!.includes(b)) near[a]!.push(b);
    if (!near[b]!.includes(a)) near[b]!.push(a);
  }
let yLo = Infinity, yHi = -Infinity;
for (let v = 0; v < V; v++) { yLo = Math.min(yLo, base[3 * v + 1]!); yHi = Math.max(yHi, base[3 * v + 1]!); }
const armL = asset.manifest.armPose!.leftWeights, armR = asset.manifest.armPose!.rightWeights;
const region = (v: number) => {
  if (armL[v]! > 0.5 || armR[v]! > 0.5) return 'arm';
  const y = (base[3 * v + 1]! - yLo) / (yHi - yLo);
  if (y > 0.87) return 'head';
  if (y > 0.8) return 'neck/shoulder';
  if (y > 0.66) return 'chest';
  if (y > 0.56) return 'waist/belly';
  if (y > 0.47) return 'hips';
  if (y > 0.28) return 'thigh';
  if (y > 0.05) return 'calf';
  return 'foot';
};

/** Laplacian of a 3-vector field: field[v] - mean(field[neighbours]). Returns |L| per vertex. */
function laplacianNorm(field: Float32Array | Float64Array, out = new Float64Array(V)): Float64Array {
  for (let v = 0; v < V; v++) {
    const nb = near[v]!;
    let lx = field[3 * v]!, ly = field[3 * v + 1]!, lz = field[3 * v + 2]!;
    for (const j of nb) { lx -= field[3 * j]! / nb.length; ly -= field[3 * j + 1]! / nb.length; lz -= field[3 * j + 2]! / nb.length; }
    out[v] = Math.hypot(lx, ly, lz);
  }
  return out;
}

function stats(a: Float64Array, mask?: (v: number) => boolean) {
  const vals: number[] = [];
  for (let v = 0; v < a.length; v++) if (!mask || mask(v)) vals.push(a[v]!);
  vals.sort((x, y) => x - y);
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]!;
  return { n: vals.length, mean, sd, p50: q(0.5), p99: q(0.99), max: vals[vals.length - 1]! };
}

interface Case { name: string; sex: Sex; heightCm: number; weightKg: number; bf?: number; sliders?: BodyInputs['sliders']; frame?: number }
const cases: Case[] = [];
for (const sex of ['male', 'female'] as const)
  for (const bf of [5, 15, 25, 35, 45, 57.4, 65, 75])
    cases.push({ name: `${sex} bf${bf}`, sex, heightCm: sex === 'male' ? 176 : 164, weightKg: sex === 'male' ? 86 : 70, bf });
for (const [name, sliders] of [
  ['belly max', { bellyVsHips: 1 }], ['belly min', { bellyVsHips: -1 }],
  ['muscle max', { muscularity: 1 }], ['muscle min', { muscularity: 0 }],
  ['owner', { muscleTorso: 0.6, muscleArms: 0.6, muscleLegs: -0.6 }],
] as const)
  for (const sex of ['male', 'female'] as const)
    cases.push({ name: `${sex} ${name}`, sex, heightCm: sex === 'male' ? 176 : 164, weightKg: sex === 'male' ? 86 : 70, bf: name === 'owner' ? 57.4 : 45, sliders });
cases.push({ name: 'female bf75 belly max', sex: 'female', heightCm: 164, weightKg: 110, bf: 75, sliders: { bellyVsHips: 1 } });
cases.push({ name: 'male bf75 hips max', sex: 'male', heightCm: 176, weightKg: 130, bf: 75, sliders: { bellyVsHips: -1 } });

const report: Record<string, unknown>[] = [];
const restL = laplacianNorm(base);
function measure(c: Case) {
  const inputs: BodyInputs = { sex: c.sex, ageYears: 40, heightCm: c.heightCm, weightKg: c.weightKg, sliders: c.sliders };
  const est = estimateInitialState(inputs, c.bf !== undefined ? { bodyFatPctOverride: c.bf } : {});
  const params = stateToAvatarParams(est, c.frame !== undefined ? { frame: c.frame } : undefined);
  const frame = params.figure.frame;
  const fit = scene.fit(params, frame);
  const state: MorphState = fit.state;
  const P = model.evaluate(state);
  const disp = new Float64Array(3 * V);
  for (let i = 0; i < disp.length; i++) disp[i] = P[i]! - base[i]!;
  const L = laplacianNorm(disp);
  const trunk = (v: number) => !/arm|head|foot/.test(region(v));
  const s = stats(L, trunk);
  const sAll = stats(L);
  // Outliers: > 0.3 cm or > 5 sd of the trunk, excluding head/arms/feet from the sd reference only.
  const thr = Math.max(0.3, s.mean + 5 * s.sd);
  const outliers: { v: number; L: number; region: string; by: string }[] = [];
  const coefs = model.coefficients(state);
  for (let v = 0; v < V; v++) {
    if (L[v]! < thr) continue;
    // attribute: contribution of each target to the Laplacian at v
    const contrib: [string, number][] = [];
    for (const { target, c: k } of coefs) {
      const t = model.targets[target]!;
      const id = [...asset.targets.keys()][target]!;
      const at = (vv: number): [number, number, number] => {
        if (!t.indices) return [t.deltas[3 * vv]!, t.deltas[3 * vv + 1]!, t.deltas[3 * vv + 2]!];
        const j = t.indices.indexOf(vv);
        return j < 0 ? [0, 0, 0] : [t.deltas[3 * j]!, t.deltas[3 * j + 1]!, t.deltas[3 * j + 2]!];
      };
      const d = at(v);
      const m = [0, 0, 0];
      for (const j of near[v]!) { const dj = at(j); for (let a = 0; a < 3; a++) m[a]! += dj[a]! / near[v]!.length; }
      contrib.push([`${id}×${k.toFixed(2)}`, k * Math.hypot(d[0] - m[0]!, d[1] - m[1]!, d[2] - m[2]!)]);
    }
    contrib.sort((a, b) => b[1] - a[1]);
    outliers.push({ v, L: L[v]!, region: region(v), by: contrib.slice(0, 3).map(([id, x]) => `${id}:${x.toFixed(3)}`).join(' ') });
  }
  outliers.sort((a, b) => b.L - a.L);
  // the skin itself: roughness increase vs rest
  const LP = laplacianNorm(P);
  let rougher = 0;
  for (let v = 0; v < V; v++) if (trunk(v) && LP[v]! > 2 * restL[v]! + 0.15) rougher++;
  // the fat layer
  const body = scene.place(state, c.heightCm);
  const inner = scene.place(coreState(state), c.heightCm, undefined, body.armSpacing).positions;
  insetSubcutaneousShell(body.positions, inner, idx, c.heightCm, asset.thickness, ref, base, asset.manifest.shell?.pinned);
  const Lin = laplacianNorm(inner), Lout = laplacianNorm(body.positions);
  const sIn = stats(Lin, trunk), sOut = stats(Lout, trunk);
  const row = {
    case: c.name, frame: +frame.toFixed(2), weight: +state.weight.toFixed(2), muscle: +state.muscle.toFixed(2),
    locals: Object.fromEntries(Object.entries(state.locals).filter(([, x]) => Math.abs(x) > 0.05).map(([k, x]) => [k, +x.toFixed(2)])),
    dispLap: { trunkMean: +s.mean.toFixed(4), trunkSd: +s.sd.toFixed(4), trunkP99: +s.p99.toFixed(3), trunkMax: +s.max.toFixed(3), allMax: +sAll.max.toFixed(3) },
    threshold: +thr.toFixed(3), outliers: outliers.length, byRegion: Object.fromEntries([...new Set(outliers.map((o) => o.region))].map((r) => [r, outliers.filter((o) => o.region === r).length])),
    top: outliers.slice(0, 6),
    skinRougherThanRest: rougher,
    skinLap: { trunkMean: +sOut.mean.toFixed(4), trunkMax: +sOut.max.toFixed(3) },
    fatLap: { trunkMean: +sIn.mean.toFixed(4), trunkP99: +sIn.p99.toFixed(3), trunkMax: +sIn.max.toFixed(3) },
  };
  report.push(row);
  return row;
}

describe('morph smoothness report', () => {
  it('measures every case', () => {
    for (const c of cases) console.log(JSON.stringify(measure(c)));
    const out = process.env.SMOOTHNESS_JSON;
    if (out) writeFileSync(out, JSON.stringify(report, null, 1));
    expect(report.length).toBe(cases.length);
  });
});
