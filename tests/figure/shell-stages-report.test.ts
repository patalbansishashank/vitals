// Where the fat layer's bumps come from: the bump measure after each stage of insetSubcutaneousShell for two states.
// Writes the lines when STAGES_OUT=<path> is set:
//   STAGES_OUT=.e6-tmp/C-FIX/shell-stages.txt TMPDIR=$PWD/.e6-tmp pnpm exec vitest run tests/figure/shell-stages-report
import { writeFileSync } from 'node:fs';
import { estimateInitialState, stateToAvatarParams } from '@/engine/body';
import { FigureScene, coreState } from '@/features/body/figure3d/scene';
import { insetSubcutaneousShell } from '@/features/body/figure3d/subcutaneousShell';
import { loadTestAsset } from '@/features/body/figure3d/__tests__/loadAsset';
import { distribution, normalBump, oneRing } from '../../scripts/figure/lib/smoothness';

it('reports the fat layer bump per stage', () => {
  const asset = loadTestAsset();
  const scene = new FigureScene(asset);
  const model = scene.model, V = model.vertexCount, indices = model.indices;
  const rings = oneRing(indices, V);
  const armL = asset.manifest.armPose!.leftWeights, armR = asset.manifest.armPose!.rightWeights;
  const lines: string[] = [];
  for (const [name, sex, h, w, bf] of [['owner', 'male', 176, 86, 57.4], ['female 15', 'female', 164, 70, 15]] as const) {
    const params = stateToAvatarParams(estimateInitialState({ sex, ageYears: 40, heightCm: h, weightKg: w }, { bodyFatPctOverride: bf }));
    const fit = scene.fit(params, params.figure.frame);
    const placed = scene.place(fit.state, h);
    const P = placed.positions;
    const body = (v: number) => armL[v]! < 0.5 && armR[v]! < 0.5 && P[3 * v + 1]! > 0.08 * h && P[3 * v + 1]! < 0.84 * h;
    const inner = scene.place(coreState(fit.state), h, undefined, placed.armSpacing).positions;
    const stage = (label: string, I: Float32Array) => {
      const off = new Float64Array(3 * V);
      for (let i = 0; i < off.length; i++) off[i] = I[i]! - P[i]!;
      const b = normalBump(P, off, rings, indices);
      const d = distribution(b, 0.2, body);
      const top = Array.from({ length: V }, (_, v) => v).filter(body).sort((x, y) => b[y]! - b[x]!).slice(0, 4).map((v) => `${v}@(${P[3 * v]!.toFixed(0)},${P[3 * v + 1]!.toFixed(0)},${P[3 * v + 2]!.toFixed(0)})=${b[v]!.toFixed(2)}`);
      lines.push(`${name} ${label.padEnd(11)} mean=${d.mean.toFixed(4)} p99=${d.p99.toFixed(3)} max=${d.max.toFixed(3)} >2mm=${d.over} top ${top.join(' ')}`);
    };
    // the baked thickness field's own roughness (scalar: |t - mean of neighbours|), trunk
    const t = asset.thickness!;
    const rough = new Float64Array(V);
    for (let v = 0; v < V; v++) { let m = 0; const c = rings.start[v + 1]! - rings.start[v]!; for (let e = rings.start[v]!; e < rings.start[v + 1]!; e++) m += t[rings.list[e]!]!; rough[v] = Math.abs(t[v]! - m / c); }
    const dr = distribution(rough, 1, body);
    lines.push(`${name} thickness roughness: mean=${dr.mean.toFixed(3)} p99=${dr.p99.toFixed(2)} max=${dr.max.toFixed(2)} >1cm=${dr.over}; at 2529: ${[2529, 2530, 4110, 4111, 6754].map((v) => `${v}:t=${t[v]!.toFixed(1)} nb=[${Array.from(rings.list.subarray(rings.start[v]!, rings.start[v + 1]!), (j) => t[j]!.toFixed(1)).join(',')}]`).join(' ')}`);
    stage('lean', inner);
    insetSubcutaneousShell(P, inner, indices, h, asset.thickness, Number(asset.manifest.stats.referenceHeightCm), model.base, asset.manifest.shell?.pinned, stage);
  }
  if (process.env.STAGES_OUT) writeFileSync(process.env.STAGES_OUT, lines.join('\n') + '\n');
  expect(lines.length).toBeGreaterThan(0);
});
