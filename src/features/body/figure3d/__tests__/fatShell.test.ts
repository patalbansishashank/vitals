// The "Fat under skin" layer: an inner boundary inset from the fitted skin. Before, the lean morph was used as is; on
// the face, hands, knees and feet it coincided with the skin or lay outside it, and the layer showed holes.
import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { compositionFromParams } from '../composition';
import { FigureScene, coreState } from '../scene';
import { insetSubcutaneousShell, partitionSubcutaneousShell, SHELL_MIN_CM } from '../subcutaneousShell';
import { Surface } from '../surface';
import { loadTestAsset } from './loadAsset';

const asset = loadTestAsset();
const scene = new FigureScene(asset);
const indices = scene.model.indices;
const referenceHeightCm = Number(asset.manifest.stats.referenceHeightCm);
const pinned = asset.manifest.shell?.pinned;

const cases: Array<[string, Sex, number, number, BodyInputs['sliders']?]> = [
  ['lean female', 'female', 170, 48],
  ['average female', 'female', 164, 66],
  ['heavy female', 'female', 162, 118],
  ['lean male', 'male', 185, 62],
  ['average male', 'male', 178, 84],
  ['heavy male', 'male', 175, 128],
  ['muscular male, no fat slider', 'male', 190, 100, { muscularity: 1, adiposity: 0 }],
  [
    'maximum sliders',
    'female',
    192,
    184,
    { adiposity: 1, muscularity: 1, arms: 1, chest: 1, bellyVsHips: 1 },
  ],
  ['minimum sliders', 'male', 160, 45, { adiposity: 0, muscularity: 0 }],
];

function normals(P: Float32Array): Float32Array {
  const out = new Float32Array(P.length);
  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [3 * indices[f]!, 3 * indices[f + 1]!, 3 * indices[f + 2]!];
    const u = [0, 1, 2].map((k) => P[b + k]! - P[a + k]!);
    const w = [0, 1, 2].map((k) => P[c + k]! - P[a + k]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) out[v + k] = out[v + k]! + n[k]!;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i]!, out[i + 1]!, out[i + 2]!) || 1;
    for (let k = 0; k < 3; k++) out[i + k] = out[i + k]! / l;
  }
  return out;
}

describe('under-skin fat shell', () => {
  it('has a thickness for every skin vertex in the pack', () => {
    expect(asset.thickness).toBeDefined();
    expect(asset.thickness!.length).toBe(scene.model.vertexCount);
    expect(Math.min(...asset.thickness!)).toBeGreaterThan(0);
  });

  it('shares the closed, consistently wound skin topology', () => {
    const directed = new Set<string>();
    for (let f = 0; f < indices.length; f += 3)
      for (let k = 0; k < 3; k++) {
        const key = `${indices[f + k]}>${indices[f + ((k + 1) % 3)]}`;
        expect(directed.has(key)).toBe(false);
        directed.add(key);
      }
    for (const key of directed) expect(directed.has(key.split('>').reverse().join('>'))).toBe(true);
  });

  it.each(cases)(
    '%s: whole, inside the skin and never through a thin part',
    (_name, sex, heightCm, weightKg, sliders) => {
      const params = stateToAvatarParams(
        estimateInitialState({ sex, ageYears: 40, heightCm, weightKg, sliders }),
      );
      const frame = params.figure.frame;
      const fit = scene.fit(params, frame);
      const body = scene.place(fit.state, heightCm);
      const outer = body.positions;
      const inner = scene.place(coreState(fit.state), heightCm, undefined, body.armSpacing).positions;
      const composition = compositionFromParams(params, frame);
      partitionSubcutaneousShell({
        outer,
        inner,
        heightCm,
        waistHalfWidthCm: params.visceral.waist.halfWidthCm,
        waistHalfDepthCm: params.visceral.waist.halfDepthCm,
        waistCentreZCm: body.centre.side,
        visceralKg: composition.visceral.massKg,
        trunkSatKg: composition.subcutaneous.trunk.massKg,
        trunkShares: composition.subcutaneous.trunkShares,
      });
      insetSubcutaneousShell(
        outer,
        inner,
        indices,
        heightCm,
        asset.thickness,
        referenceHeightCm,
        scene.model.base,
        pinned,
      );
      const n = normals(outer);
      const skin = new Surface(outer, indices);
      const minimum = SHELL_MIN_CM * (heightCm / 166);
      const inside = (p: number[]) => {
        let votes = 0;
        for (const d of [
          [0.31, 0.12, 0.94],
          [-0.27, 0.21, -0.94],
          [0.95, 0.05, 0.3],
        ]) {
          let crossings = 0,
            from = p;
          for (;;) {
            const t = skin.distance(from, d, 400);
            if (t === null) break;
            crossings++;
            from = from.map((v, k) => v + d[k]! * (t + 1e-4));
          }
          if (crossings % 2 === 1) votes++;
        }
        return votes >= 2;
      };
      let through = 0,
        shallow = 0,
        flipped = 0,
        collapsed = 0;
      for (let i = 0; i < outer.length; i += 3) {
        const offset = [0, 1, 2].map((k) => outer[i + k]! - inner[i + k]!);
        const depth = offset.reduce((sum, v, k) => sum + v * n[i + k]!, 0);
        // Inward of the skin by at least the thin minimum (or the thickness cap in a fold).
        const cap = 0.45 * asset.thickness![i / 3]! * (heightCm / referenceHeightCm);
        if (depth < Math.min(minimum, cap) - 1e-4) shallow++;
        // Inside the closed skin, within 1 mm: an odd number of skin crossings on the way out. Where a heavy body's thighs touch,
        // the inset may cross into the other thigh, which is still inside the body.
        // Within 1 mm of the skin (toe gaps, ear rims, lid corners) the crossing count is unreliable and nothing shows.
        if (depth > 0.1 && !inside([inner[i]!, inner[i + 1]!, inner[i + 2]!])) through++;
      }
      const area = (P: Float32Array, f: number) => {
        const [a, b, c] = [3 * indices[f]!, 3 * indices[f + 1]!, 3 * indices[f + 2]!];
        const u = [0, 1, 2].map((k) => P[b + k]! - P[a + k]!);
        const w = [0, 1, 2].map((k) => P[c + k]! - P[a + k]!);
        return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      };
      // A fold: a shell face turned against its neighbours on the shell (the skin's own relief, which the layer passes
      // under, is no reference: under the navel its faces shrink by design), or a degenerate face. A few faces under
      // 0.2 cm² or 1 mm across (lid and lip seams, toe and finger tips, a heavy wrist) may tilt, invisibly.
      const cross = new Float64Array(indices.length);
      const skinCross = new Float64Array(indices.length);
      for (let f = 0; f < indices.length; f += 3) {
        cross.set(area(inner, f), f);
        skinCross.set(area(outer, f), f);
      }
      const owners = new Map<string, number[]>();
      for (let f = 0; f < indices.length; f += 3)
        for (let k = 0; k < 3; k++) {
          const p = indices[f + k]!,
            r = indices[f + ((k + 1) % 3)]!;
          const key = p < r ? `${p}:${r}` : `${r}:${p}`;
          owners.set(key, [...(owners.get(key) ?? []), f]);
        }
      const around = Array.from({ length: indices.length / 3 }, () => [0, 0, 0]);
      const skinAround = Array.from({ length: indices.length / 3 }, () => [0, 0, 0]);
      for (const faces of owners.values())
        if (faces.length === 2)
          for (const [f, g] of [faces, [faces[1]!, faces[0]!]] as const)
            for (let k = 0; k < 3; k++) {
              around[f / 3]![k]! += cross[g + k]!;
              skinAround[f / 3]![k]! += skinCross[g + k]!;
            }
      let tiny = 0;
      for (let f = 0; f < indices.length; f += 3) {
        const s = area(outer, f);
        const ls = Math.hypot(...s),
          lq = Math.hypot(cross[f]!, cross[f + 1]!, cross[f + 2]!);
        if (ls < 1e-8) continue;
        const nb = around[f / 3]!;
        const sb = skinAround[f / 3]!;
        // Where the skin itself is creased over (a heavy wrist), the shell follows it.
        const skinTurned =
          skinCross[f]! * sb[0]! + skinCross[f + 1]! * sb[1]! + skinCross[f + 2]! * sb[2]! <= 0;
        const turned =
          !skinTurned && cross[f]! * nb[0]! + cross[f + 1]! * nb[1]! + cross[f + 2]! * nb[2]! <= 0;
        const bad = lq < 1e-6 || turned;
        if (!bad) continue;
        const [a, b, c] = [indices[f]!, indices[f + 1]!, indices[f + 2]!];
        const edge = (p: number, r: number) =>
          Math.hypot(
            outer[3 * p]! - outer[3 * r]!,
            outer[3 * p + 1]! - outer[3 * r + 1]!,
            outer[3 * p + 2]! - outer[3 * r + 2]!,
          );
        if (ls / 2 < 0.2 || Math.min(edge(a, b), edge(b, c), edge(c, a)) < 0.1) tiny++;
        else if (lq < 1e-6) collapsed++;
        else flipped++;
      }
      expect(tiny / (indices.length / 3)).toBeLessThan(0.005);
      expect({ through, shallow, flipped, collapsed }).toEqual({
        through: 0,
        shallow: 0,
        flipped: 0,
        collapsed: 0,
      });
    },
  );
});

/**
 * Roughness over the trunk, measured on each surface itself: the umbrella offset (how far a vertex sits from its
 * neighbours' centroid along the normal, per unit edge length) and how much more the shell bends between neighbouring
 * faces than the skin. 95th percentiles.
 */
export function roughness(outer: Float32Array, inner: Float32Array, heightCm: number) {
  const central = new Set(asset.manifest.armClearance!.centralBody);
  const trunk = (v: number) =>
    central.has(v) && outer[3 * v + 1]! > 0.45 * heightCm && outer[3 * v + 1]! < 0.8 * heightCm;
  const near = Array.from({ length: outer.length / 3 }, () => new Set<number>());
  const edgeFaces = new Map<string, number[]>();
  for (let f = 0; f < indices.length; f += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[f + k]!,
        b = indices[f + ((k + 1) % 3)]!;
      near[a]!.add(b);
      near[b]!.add(a);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeFaces.set(key, [...(edgeFaces.get(key) ?? []), f]);
    }
  const umbrella = (P: Float32Array) => {
    const n = normals(P);
    const out: number[] = [];
    for (let v = 0; v < near.length; v++) {
      if (!trunk(v)) continue;
      const c = [0, 0, 0];
      let edge = 0;
      for (const j of near[v]!) {
        for (let k = 0; k < 3; k++) c[k] = c[k]! + P[3 * j + k]! / near[v]!.size;
        edge += Math.hypot(
          P[3 * j]! - P[3 * v]!,
          P[3 * j + 1]! - P[3 * v + 1]!,
          P[3 * j + 2]! - P[3 * v + 2]!,
        );
      }
      edge /= near[v]!.size;
      const off = [0, 1, 2].reduce((sum, k) => sum + (c[k]! - P[3 * v + k]!) * n[3 * v + k]!, 0);
      out.push(Math.abs(off) / (edge || 1));
    }
    return out;
  };
  const faceNormal = (P: Float32Array, f: number) => {
    const [a, b, c] = [3 * indices[f]!, 3 * indices[f + 1]!, 3 * indices[f + 2]!];
    const u = [0, 1, 2].map((k) => P[b + k]! - P[a + k]!);
    const w = [0, 1, 2].map((k) => P[c + k]! - P[a + k]!);
    const m = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const l = Math.hypot(...m) || 1;
    return m.map((x) => x / l);
  };
  const angle = (p: number[], q: number[]) =>
    Math.acos(Math.max(-1, Math.min(1, p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!)));
  const bend: number[] = [];
  for (const [key, faces] of edgeFaces) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    if (faces.length !== 2 || !trunk(a) || !trunk(b)) continue;
    const skin = angle(faceNormal(outer, faces[0]!), faceNormal(outer, faces[1]!));
    const shell = angle(faceNormal(inner, faces[0]!), faceNormal(inner, faces[1]!));
    bend.push(((shell - skin) * 180) / Math.PI);
  }
  const p95 = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length * 0.95)]!;
  return { shell: p95(umbrella(inner)), skin: p95(umbrella(outer)), bendDeg: p95(bend) };
}

describe('under-skin fat shell smoothness', () => {
  it.each(cases.slice(0, 6))(
    '%s: a smooth layer over the trunk, no rougher than the skin',
    (_name, sex, heightCm, weightKg, sliders) => {
      const params = stateToAvatarParams(
        estimateInitialState({ sex, ageYears: 40, heightCm, weightKg, sliders }),
      );
      const fit = scene.fit(params, params.figure.frame);
      const body = scene.place(fit.state, heightCm);
      const inner = scene.place(coreState(fit.state), heightCm, undefined, body.armSpacing).positions;
      insetSubcutaneousShell(
        body.positions,
        inner,
        indices,
        heightCm,
        asset.thickness,
        referenceHeightCm,
        scene.model.base,
        pinned,
      );
      const r = roughness(body.positions, inner, heightCm);
      // The previous shell, which followed the lean shape vertex by vertex, was 1.3-2.0 times rougher than the skin
      // and bent 21-36 degrees more between neighbouring faces. Since the targets were repaired (C-FIX) the skin's
      // own roughness fell from 0.19-0.20 to 0.17-0.18; the layer, which relaxes its offset from that skin, measures
      // 0.17-0.19, so it is allowed up to a tenth more than the skin.
      expect(r.shell).toBeLessThan(1.12 * r.skin);
      expect(r.bendDeg).toBeLessThan(15);
    },
  );
});

describe('under-skin fat shell thickness', () => {
  const depthAt = (sex: Sex, heightCm: number, weightKg: number, sliders?: BodyInputs['sliders']) => {
    const params = stateToAvatarParams(
      estimateInitialState({ sex, ageYears: 40, heightCm, weightKg, sliders }),
    );
    const fit = scene.fit(params, params.figure.frame);
    const body = scene.place(fit.state, heightCm);
    const inner = scene.place(coreState(fit.state), heightCm, undefined, body.armSpacing).positions;
    insetSubcutaneousShell(
      body.positions,
      inner,
      indices,
      heightCm,
      asset.thickness,
      referenceHeightCm,
      scene.model.base,
    );
    const n = normals(body.positions);
    const central = new Set(asset.manifest.armClearance!.centralBody);
    const band = (lo: number, hi: number) => {
      let sum = 0,
        count = 0;
      for (const v of central) {
        const y = body.positions[3 * v + 1]! / heightCm;
        if (y < lo || y > hi || n[3 * v + 2]! < 0.5) continue;
        sum += [0, 1, 2].reduce(
          (s, k) => s + (body.positions[3 * v + k]! - inner[3 * v + k]!) * n[3 * v + k]!,
          0,
        );
        count++;
      }
      return sum / count;
    };
    return { trunk: band(0.5, 0.76), belly: band(0.55, 0.62), chest: band(0.7, 0.76) };
  };

  it('grows with body fat and is thicker over the belly than the chest', () => {
    for (const sex of ['male', 'female'] as const) {
      const [lean, average, heavy] = [55, 80, 115].map((w) => depthAt(sex, 172, w));
      // Over the front of the trunk as a whole (a heavy belly's overhang thins the layer at its crease only).
      expect(lean!.trunk).toBeLessThan(average!.trunk);
      expect(average!.trunk).toBeLessThan(heavy!.trunk);
      expect(lean!.belly).toBeLessThan(heavy!.belly);
      for (const body of [average!, heavy!]) expect(body.belly).toBeGreaterThan(body.chest);
    }
  });
});

describe('under-skin fat shell at the nipples', () => {
  const near = Array.from({ length: scene.model.vertexCount }, () => new Set<number>());
  for (let f = 0; f < indices.length; f += 3)
    for (let k = 0; k < 3; k++) {
      near[indices[f + k]!]!.add(indices[f + ((k + 1) % 3)]!);
      near[indices[f + ((k + 1) % 3)]!]!.add(indices[f + k]!);
    }
  const ring2 = (v: number) => {
    const out = new Set<number>();
    for (const a of near[v]!) {
      out.add(a);
      for (const b of near[a]!) out.add(b);
    }
    out.delete(v);
    return out;
  };

  it('finds one nipple on each side of the chest', () => {
    const tips = asset.manifest.shell!.nippleTips!;
    expect(tips).toHaveLength(2);
    const P = asset.base;
    expect(P[3 * tips[0]!]! * P[3 * tips[1]!]!).toBeLessThan(0);
    expect(Math.abs(P[3 * tips[0]!]! + P[3 * tips[1]!]!)).toBeLessThan(0.1);
    for (const tip of tips) expect(pinned).toContain(tip);
  });

  it.each(cases.slice(0, 6))(
    '%s: the layer passes smoothly under both nipples',
    (_name, sex, heightCm, weightKg, sliders) => {
      const params = stateToAvatarParams(
        estimateInitialState({ sex, ageYears: 40, heightCm, weightKg, sliders }),
      );
      const fit = scene.fit(params, params.figure.frame);
      const body = scene.place(fit.state, heightCm);
      const inner = scene.place(coreState(fit.state), heightCm, undefined, body.armSpacing).positions;
      insetSubcutaneousShell(
        body.positions,
        inner,
        indices,
        heightCm,
        asset.thickness,
        referenceHeightCm,
        scene.model.base,
        pinned,
      );
      const n = normals(inner);
      // The nipples, their rings and one ring more: no vertex of the layer stands out of (or into) the mean of its 2-ring.
      const region = new Set<number>();
      for (const v of pinned!) {
        region.add(v);
        for (const j of near[v]!) region.add(j);
      }
      const offset = (v: number) => {
        const ring = ring2(v);
        const c = [0, 0, 0];
        for (const j of ring) for (let k = 0; k < 3; k++) c[k] = c[k]! + inner[3 * j + k]! / ring.size;
        return Math.abs([0, 1, 2].reduce((sum, k) => sum + (inner[3 * v + k]! - c[k]!) * n[3 * v + k]!, 0));
      };
      let worst = 0;
      for (const v of region) worst = Math.max(worst, offset(v));
      // The rest of the chest's front: the same measure there is mostly the surface's own curvature.
      const skinNormals = normals(body.positions);
      const chest: number[] = [];
      for (let v = 0; v < near.length; v++) {
        const y = body.positions[3 * v + 1]! / heightCm;
        if (region.has(v) || y < 0.66 || y > 0.8 || Math.abs(body.positions[3 * v]!) > 0.12 * heightCm)
          continue;
        if (skinNormals[3 * v + 2]! > 0.5) chest.push(offset(v));
      }
      chest.sort((a, b) => a - b);
      // Before the nipples were filled in, the tip stood 0.5-1.3 cm out of its neighbourhood, about twice the rest
      // of the chest; now the nipple area is no rougher than its surroundings (within 5 %: the repaired targets
      // made the chest itself smoother, 0.49 vs 0.49 on the average male).
      expect(worst).toBeLessThan(1.05 * chest[Math.floor(chest.length * 0.95)]!);
    },
  );
});
