// Shape and placement checks for the baked atlas layer that the registration test's 0.6 cm skin tolerance cannot see:
// the skull's place inside the head, closed and outward-wound part surfaces, no slivers or spikes, and no tearing
// when the parts are placed in fitted bodies.
import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { decodeAnatomy } from '../anatomyAsset';
import { fatRoom, placeAnatomy } from '../anatomyPose';
import { compositionFromParams } from '../composition';
import { clampFatToAnatomy } from '../fatClearance';
import { FigureScene } from '../scene';
import { Surface } from '../surface';
import { depthUnder } from './anatomyDepth';
import { fittedLayers, type LayerCase } from './fittedLayers';
import { loadTestAsset } from './loadAsset';

const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  ?.getBuiltinModule;
if (!get) throw new Error('anatomy quality test needs Node');
const fs = get('node:fs') as { readFileSync(path: string): Uint8Array };
const zlib = get('node:zlib') as { gunzipSync(bytes: Uint8Array): Uint8Array };
const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const scene = new FigureScene(loadTestAsset());
const parts = anatomy.manifest.source.selected;
const part = (name: string) => parts.find((p) => p.name === name)!;
type Part = (typeof parts)[number];

const faces = (p: Part) => {
  const out: [number, number, number][] = [];
  for (let i = p.indexStart; i < p.indexStart + p.indexCount; i += 3)
    out.push([anatomy.indices[i]!, anatomy.indices[i + 1]!, anatomy.indices[i + 2]!]);
  return out;
};
const sub = (P: Float32Array, a: number, b: number) => [0, 1, 2].map((k) => P[3 * a + k]! - P[3 * b + k]!);
const cross = (u: number[], v: number[]) => [
  u[1]! * v[2]! - u[2]! * v[1]!,
  u[2]! * v[0]! - u[0]! * v[2]!,
  u[0]! * v[1]! - u[1]! * v[0]!,
];

const cases: Array<[string, Sex, number, number, number, BodyInputs['sliders']?]> = [
  ['lean hips-led', 'female', 154, 45, 0],
  ['average shoulders-led', 'male', 178, 82, 1],
  ['heavy hips-led', 'female', 165, 118, 0, { adiposity: 1 }],
  ['muscular shoulders-led', 'male', 190, 100, 1, { muscularity: 1, adiposity: 0 }],
];
const placed = cases.map(([name, sex, heightCm, weightKg, frame, sliders]) => {
  const params = stateToAvatarParams(
    estimateInitialState({ sex, ageYears: 35, heightCm, weightKg, sliders }),
    {
      frame,
    },
  );
  const fit = scene.fit(params, frame);
  const skin = scene.place(fit.state, heightCm).positions;
  const bones = placeAnatomy(anatomy, skin, heightCm, fit.state.frame, compositionFromParams(params, frame));
  return { name, heightCm, skin, bones };
});

describe('baked anatomy surfaces', () => {
  it('keeps every part closed, outward-wound and free of slivers', () => {
    const P = anatomy.positions;
    const open: string[] = [];
    const inward: string[] = [];
    let slivers = 0,
      triangles = 0;
    for (const p of parts) {
      const f = faces(p);
      expect(f.length, p.name).toBeGreaterThanOrEqual(20);
      const edges = new Map<string, number>();
      let volume = 0;
      for (const [a, b, c] of f) {
        for (const [u, v] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const)
          edges.set(`${u}>${v}`, (edges.get(`${u}>${v}`) ?? 0) + 1);
        const n = cross(sub(P, b, a), sub(P, c, a));
        volume += (P[3 * a]! * n[0]! + P[3 * a + 1]! * n[1]! + P[3 * a + 2]! * n[2]!) / 6;
        const area = Math.hypot(...n) / 2;
        const longest = Math.max(...[sub(P, b, a), sub(P, c, b), sub(P, a, c)].map((e) => Math.hypot(...e)));
        // Height over the longest edge: a needle or a collapsed triangle has almost none.
        if ((2 * area) / longest < 0.01 * longest) slivers++;
        triangles++;
      }
      // Each directed edge once, and its reverse once: closed and consistently wound.
      if ([...edges].some(([key, n]) => n !== 1 || edges.get(key.split('>').reverse().join('>')) !== 1))
        open.push(p.name);
      if (volume <= 0) inward.push(p.name);
    }
    expect(open.length, `open or inconsistently wound parts: ${open.join(', ')}`).toBeLessThanOrEqual(0);
    expect(inward, 'parts wound inward').toEqual([]);
    // Repaired holes leave a few needle triangles; they cannot show as spikes.
    expect(slivers / triangles).toBeLessThan(0.01);
  });

  it.each(placed.map((c) => [c.name, c] as const))('%s: places the skull inside the head', (_name, c) => {
    const k = c.heightCm / anatomy.heightCm;
    const vertices = (names: string[]) =>
      names.flatMap((n) => {
        const p = part(n);
        return Array.from({ length: p.vertexCount }, (_, i) => p.vertexStart + i);
      });
    const vault = vertices(['Frontal bone', 'Left parietal bone', 'Right parietal bone', 'Occipital bone']);
    const at = (P: Float32Array, i: number, axis: number) => P[3 * i + axis]!;
    const crown = Math.max(...vault.map((i) => at(c.bones, i, 1)));
    let skinTop = -Infinity;
    for (let i = 0; i < c.skin.length; i += 3) skinTop = Math.max(skinTop, c.skin[i + 1]!);
    // Scalp over the crown: present, and thin.
    expect(skinTop - crown).toBeGreaterThan(0.15 * k);
    expect(skinTop - crown).toBeLessThan(1.6 * k);
    // At the widest level of the vault, the skull sits centred front to back inside the head.
    const level = crown - 6 * k;
    const band = (P: Float32Array, ids: Iterable<number>) => {
      const z: number[] = [];
      for (const i of ids)
        if (Math.abs(at(P, i, 1) - level) < 0.8 * k && Math.abs(at(P, i, 0)) < 2 * k) z.push(at(P, i, 2));
      return [Math.min(...z), Math.max(...z)] as const;
    };
    const skull = band(c.bones, vault);
    const head = band(
      c.skin,
      Array.from({ length: c.skin.length / 3 }, (_, i) => i),
    );
    expect(skull[0] - head[0], 'back of the head').toBeGreaterThan(0.15 * k);
    expect(head[1] - skull[1], 'forehead').toBeGreaterThan(0.15 * k);
    expect(Math.abs((skull[0] + skull[1]) / 2 - (head[0] + head[1]) / 2)).toBeLessThan(1.2 * k);
  });

  // Forearms, hands, lower legs, feet and the skull. Trunk parts at the armpit
  // and hips still stretch where the fitted skin moves most (see README).
  const joint = (id: string) => anatomy.manifest.registration!.joints.find((j) => j.id === id)!.hipsLed[1];
  const centroidY = (p: Part) => {
    let y = 0;
    for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i++) y += anatomy.positions[3 * i + 1]!;
    return y / p.vertexCount;
  };
  const distal = parts.filter(
    (p) =>
      (p.region === 'arms' && centroidY(p) < joint('elbowL')) ||
      (p.region === 'legs' && centroidY(p) < joint('kneeL')) ||
      (p.region === 'head' && p.kind === 'bone' && !/vertebra|intervertebral|rib|axis|atlas/i.test(p.name)),
  );
  it.each(placed.map((c) => [c.name, c] as const))(
    '%s: no hand, foot, knee or skull part tears',
    (_name, c) => {
      const k = c.heightCm / anatomy.heightCm;
      const torn: string[] = [];
      expect(distal.length).toBeGreaterThan(200);
      for (const p of distal) {
        let worst = 0;
        for (const [a, b, cc] of faces(p))
          for (const [u, v] of [
            [a, b],
            [b, cc],
            [cc, a],
          ] as const) {
            const rest = Math.hypot(...sub(anatomy.positions, u, v)) * k;
            const now = Math.hypot(...sub(c.bones, u, v));
            // A visible tear or spike: an edge at least twice its baked length and
            // 1.5 cm longer (one sole muscle edge still stretches 1.2 cm).
            if (now > 2 * rest && now - rest > 1.5 * k) worst = Math.max(worst, now - rest);
          }
        if (worst > 0) torn.push(`${p.name} +${worst.toFixed(1)} cm`);
      }
      expect(torn).toEqual([]);
    },
  );
});

// The muscle and bone layers against the skin and the fat under it, and the shape of the muscle layer on its own.
describe('muscle and bone layers', () => {
  const layerCases: LayerCase[] = [
    { name: 'lean female', sex: 'female', heightCm: 170, weightKg: 48, frame: 0 },
    { name: 'heavy female', sex: 'female', heightCm: 162, weightKg: 118, frame: 0 },
    { name: 'female, body fat set to 60 %', sex: 'female', heightCm: 165, weightKg: 66, frame: 0, bodyFatPct: 60 },
    { name: 'average male', sex: 'male', heightCm: 178, weightKg: 84, frame: 1 },
    { name: 'heavy male', sex: 'male', heightCm: 175, weightKg: 128, frame: 1 },
    { name: 'muscular male', sex: 'male', heightCm: 190, weightKg: 100, frame: 1, sliders: { muscularity: 1, adiposity: 0 } },
    {
      name: 'maximum sliders',
      sex: 'female',
      heightCm: 192,
      weightKg: 184,
      frame: 0,
      sliders: { adiposity: 1, muscularity: 1, arms: 1, chest: 1, bellyVsHips: 1 },
    },
  ];
  const layers = layerCases.map((c) => {
    const { outer, inner, composition, frame } = fittedLayers(scene, c);
    const before = inner.slice();
    const positions = placeAnatomy(anatomy, outer, c.heightCm, frame, composition, inner);
    clampFatToAnatomy(outer, inner, scene.model.indices, fatRoom(anatomy, outer, inner, positions, c.heightCm), c.heightCm);
    return { c, outer, inner, before, positions, frame };
  });

  it.each(layers.map((l) => [l.c.name, l] as const))(
    '%s: every muscle and bone stays under the fat layer',
    (_name, l) => {
      const k = l.c.heightCm / anatomy.heightCm;
      const depth = depthUnder(anatomy, l.outer, l.inner, l.positions, l.c.heightCm, l.frame);
      const skin = depthUnder(anatomy, l.outer, l.outer, l.positions, l.c.heightCm, l.frame);
      let outside = 0,
        close = 0;
      depth.forEach((d, i) => {
        // What shows through the translucent layers: within 3 cm of the skin. Deeper down, in the pelvis behind the
        // groin crease of a heavy body, the fat's inner boundary folds in and a chord can miss it.
        if (skin[i]! > 3 * k) return;
        if (d < 0) outside++;
        else if (d < 0.05 * k) close++;
      });
      // Before, 5,000 to 14,500 of the 53,000 vertices (330 to 360 parts) crossed the fat's inner surface: dark red
      // patches at the elbows and blotches over the trunk. Now at most a few single vertices, one or two per part,
      // cross between skin vertices (or their chord runs into the other thigh), and a few toe bones lie within half
      // a millimetre of it.
      // The push under the fat is smoothed over each part (no tears), and the fat layer gives way only as a smooth
      // swell (a bone's relief imprinted on it read as a jagged back and neck): up to 1 % of the vertices, mostly on the
      // spine, shoulder blades and breastbone, touch or cross the translucent layer.
      expect(outside / depth.length, 'outside the fat layer').toBeLessThan(0.01);
      expect(close / depth.length, 'within 0.5 mm of it').toBeLessThan(0.01);
    },
  );

  it.each(layers.map((l) => [l.c.name, l] as const))(
    '%s: the fat layer gives way only around what needs the room',
    (_name, l) => {
      const n = l.outer.length / 3;
      let was = 0,
        now = 0;
      for (let i = 0; i < n; i++) {
        const depth = (P: Float32Array) =>
          Math.hypot(l.outer[3 * i]! - P[3 * i]!, l.outer[3 * i + 1]! - P[3 * i + 1]!, l.outer[3 * i + 2]! - P[3 * i + 2]!);
        expect(depth(l.inner)).toBeLessThanOrEqual(depth(l.before) + 1e-4);
        if (depth(l.before) > 1) {
          was += depth(l.before);
          now += depth(l.inner);
        }
      }
      // Where a bone leaves no room (a heavy shoulder or upper arm) the fat is shallower; a spread-out limit once
      // halved the whole layer.
      if (was > 0) expect(now / was).toBeGreaterThan(0.7);
    },
  );

  it.each(layers.map((l) => [l.c.name, l] as const))(
    '%s: placing under the fat tears no muscle',
    (_name, l) => {
      const free = placeAnatomy(anatomy, l.outer, l.c.heightCm, l.frame, compositionFromParams(stateToAvatarParams(estimateInitialState({ sex: l.c.sex, ageYears: 40, heightCm: l.c.heightCm, weightKg: l.c.weightKg, sliders: l.c.sliders }, l.c.bodyFatPct ? { bodyFatPctOverride: l.c.bodyFatPct } : undefined), { frame: l.c.frame }), l.c.frame));
      const torn: string[] = [];
      for (const p of parts) {
        if (p.kind !== 'muscle') continue;
        let count = 0;
        for (const [a, b, c] of faces(p))
          for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
          ] as const) {
            const before = Math.hypot(...sub(free, u, v)),
              after = Math.hypot(...sub(l.positions, u, v));
            if (after > 2 * before && after - before > 1) count++;
          }
        if (count) torn.push(`${p.name} ${count}`);
      }
      // Pushed by their own amounts, neighbours moved apart by up to 8 cm: the psoas, external obliques and lower
      // pectorals tore into strands and holes (50 edges in the heavy female, 34 in the heavy male).
      expect(torn).toEqual([]);
    },
  );

  it.each(layers.map((l) => [l.c.name, l] as const))('%s: every bone stays inside the skin', (_name, l) => {
    const k = l.c.heightCm / anatomy.heightCm;
    const depth = depthUnder(anatomy, l.outer, l.outer, l.positions, l.c.heightCm, l.frame);
    const shallow: string[] = [];
    for (const p of parts) {
      if (p.kind !== 'bone') continue;
      let least = Infinity;
      for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i++) least = Math.min(least, depth[i]!);
      // The breastbone and the front of the rib cage showed as a bright tip on heavy bodies at 1.8 mm.
      const chest = /sternum|xiphoid|costal cartilage/i.test(p.name) && l.c.weightKg >= 66 && (l.c.bodyFatPct ?? 40) >= 40;
      // Between the toes a toe bone's chord can pass into the next toe; the digits are checked by registration.
      const digit = /phalanx/i.test(p.name);
      if ((!digit && least <= 0) || (chest && least < 0.5 * k)) shallow.push(`${p.name} ${least.toFixed(2)} cm`);
    }
    expect(shallow).toEqual([]);
  });

  const P = anatomy.positions;
  const joints = anatomy.manifest.registration!.joints;
  const joint = (id: string) => joints.find((j) => j.id === id)!.hipsLed;
  const muscles = parts.filter((p) => p.kind === 'muscle');

  it('closes the front of the belly between the obliques', () => {
    const triangles: number[] = [];
    for (const p of muscles)
      if (p.region === 'trunk') for (let i = p.indexStart; i < p.indexStart + p.indexCount; i++) triangles.push(anatomy.indices[i]!);
    const surface = new Surface(P, triangles);
    const front = (x: number, y: number) => {
      const hit = surface.ray([x, y, 60], [0, 0, -1]);
      return hit ? 60 - hit.distance : -Infinity;
    };
    // From the lower ribs to the pubis the midline meets muscle where the obliques do (it fell through a slit).
    for (let y = 92; y <= 116; y += 2) {
      const sides = Math.min(front(-3, y), front(3, y));
      for (const x of [-0.5, 0, 0.5]) expect(sides - front(x, y), `x ${x}, y ${y}`).toBeLessThan(2);
    }
  });

  it('caps the neck below the skull and keeps the trapezius on the shoulder girdle', () => {
    // Only the jaw muscles reach the skull; the neck muscles stood up there as a ragged crown.
    let top = -Infinity;
    for (const p of muscles)
      if (!/masseter|temporalis/i.test(p.name))
        for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i++) top = Math.max(top, P[3 * i + 1]!);
    expect(top - joint('head')[1]!).toBeLessThan(1.2);
    // The trapezius ends on the collarbone and shoulder blade; it overhung them by 1.4 cm as a flat blade.
    const ids = (re: RegExp, kind: string) =>
      parts
        .filter((p) => p.kind === kind && re.test(p.name))
        .flatMap((p) => Array.from({ length: p.vertexCount }, (_, i) => p.vertexStart + i));
    const trapezius = ids(/trapezius/i, 'muscle'),
      girdle = ids(/scapula|clavicle/i, 'bone');
    for (const sign of [-1, 1]) {
      const reach = (list: number[]) => Math.max(...list.map((i) => sign * P[3 * i]!));
      expect(reach(trapezius) - reach(girdle)).toBeLessThan(0.5);
    }
  });

  it('joins the forearm and shin muscles to the hand and foot muscles', () => {
    const reach = (region: string, side: string, above: boolean) => {
      const wrist = joint(region === 'arms' ? `wrist${side}` : `ankle${side}`)[1]!;
      let edge = above ? Infinity : -Infinity;
      for (const p of muscles) {
        if (p.region !== region || !p.name.toLowerCase().includes(side === 'L' ? 'left' : 'right')) continue;
        let centre = 0;
        for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i++) centre += P[3 * i + 1]! / p.vertexCount;
        if (above !== centre > wrist + 3) continue;
        for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i++)
          edge = above ? Math.min(edge, P[3 * i + 1]!) : Math.max(edge, P[3 * i + 1]!);
      }
      return edge;
    };
    // Forearm and shin muscles were cut up to 10 cm short of the wrist and ankle: the hand and foot floated.
    for (const side of ['L', 'R'])
      for (const region of ['arms', 'legs']) {
        const gap = reach(region, side, true) - reach(region, side, false);
        expect(gap, `${region} ${side}`).toBeLessThan(region === 'arms' ? 0.5 : 2.5);
      }
  });

  it('leaves no spike on top of the neck', () => {
    const k = placed[1]!.heightCm / anatomy.heightCm;
    const tops: number[] = [];
    for (const p of muscles) {
      if (/masseter|temporalis/i.test(p.name)) continue;
      let top = -Infinity;
      for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i++) top = Math.max(top, placed[1]!.bones[3 * i + 1]!);
      tops.push(top);
    }
    tops.sort((x, y) => y - x);
    // The two sternocleidomastoids rose 1.4 cm above every other neck muscle as thin posts.
    expect(tops[0]! - tops[2]!).toBeLessThan(0.5 * k);
  });
});
