// Bakes public/figure/figure-v2.bin from the cached MakeHuman sources (run fetch.ts first).
// Steps (R2 sec. 5.5): read the hm08 body group and the chosen targets -> compose the two adult frame shapes -> lower the
// arms to ARM_ANGLE_DEG with MakeHuman's rig weights -> decimate (vertex-preserving) -> close the eye/mouth holes ->
// derive the tape-measure rings -> quantise to int16 -> write one binary + JSON manifest, and print the sizes.
// Run: node scripts/figure/bake.ts [targetVertices]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import type { FigureManifest, FrameEnd, MacroLevel, RingDef, RingId, TargetEntry } from '../../src/features/body/figure3d/manifest.ts';
import { boundaryLoops, decimate } from './lib/decimate.ts';
import { BinWriter, packFile, pickStep, quantise, sparsify } from './lib/encode.ts';
import { parseObj, parseTarget } from './lib/parse.ts';
import { armChainWeight, centroid, normalise, poseDeltas, posePositions, rotBetween, rotZ, type ArmPose } from './lib/pose.ts';
import { cutRing, hullPerimeter } from './lib/rings.ts';
import {
  BASE_OBJ,
  ETHNICITIES,
  LEVELS,
  LOCALS,
  SKELETON,
  SOURCE_COMMIT,
  SOURCE_REPO,
  WEIGHTS,
  allSourceFiles,
  ethnicTarget,
  localTarget,
  universalTarget,
  type Level,
  type Sex,
} from './lib/sources.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const outDir = join(here, '../../public/figure');
const TARGET_VERTICES = Number(process.argv[2] ?? 9000);
const ARM_ANGLE_DEG = 10;
const FOREARM_BEND_DEG = 12;
/** Gzip-compressed pack (see lib/encode.ts packFile). Bump the version when the format or the bake changes. */
const FILE = 'figure-v2.bin';
const DM_TO_CM = 10;
const FRAME_OF: Record<Sex, FrameEnd> = { female: 'hipsLed', male: 'shouldersLed' };
const LEVEL_KEY: Record<Level, MacroLevel> = { min: 'min', average: 'average', max: 'max' };

const read = (rel: string) => readFile(join(cache, rel), 'utf8');

function scaled(a: Float64Array, k: number): Float64Array {
  const o = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i]! * k;
  return o;
}
function addInto(out: Float64Array, a: Float64Array, k = 1): void {
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + k * a[i]!;
}
function maxAbs(a: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const objText = await read(BASE_OBJ);
  const body = parseObj(objText, 'body');
  const n = body.vertexCount;
  const base = scaled(body.positions, DM_TO_CM);
  // all vertices (joint helpers sit beyond the body range)
  const allPos = scaled(
    Float64Array.from(
      objText
        .split('\n')
        .filter((l) => l.startsWith('v '))
        .flatMap((l) => l.trim().split(/\s+/).slice(1, 4).map(Number)),
    ),
    DM_TO_CM,
  );
  const target = async (rel: string) => scaled(parseTarget(await read(rel), n), DM_TO_CM);

  // ---- targets (cm)
  const frame: Record<FrameEnd, Float64Array> = { hipsLed: new Float64Array(3 * n), shouldersLed: new Float64Array(3 * n) };
  const macro: Record<FrameEnd, Map<string, Float64Array>> = { hipsLed: new Map(), shouldersLed: new Map() };
  for (const sex of ['female', 'male'] as const) {
    const end = FRAME_OF[sex];
    for (const eth of ETHNICITIES) addInto(frame[end], await target(ethnicTarget(eth, sex)), 1 / ETHNICITIES.length);
    for (const m of LEVELS)
      for (const w of LEVELS) {
        const d = await target(universalTarget(sex, m, w));
        if (maxAbs(d) > 0) macro[end].set(`${LEVEL_KEY[m]}-${LEVEL_KEY[w]}`, d);
      }
  }
  const locals = new Map<string, Float64Array>();
  for (const l of LOCALS)
    for (const s of ['incr', 'decr'] as const) {
      const d = await target(localTarget(l.dir, l.name, s));
      if (maxAbs(d) > 0) locals.set(`${l.id}-${s}`, d);
    }

  // ---- pose: lower the arms to ARM_ANGLE_DEG from vertical about the shoulder joint (rotation about the front axis)
  const skel = JSON.parse(await read(SKELETON)) as { joints: Record<string, number[]> };
  const weights = (JSON.parse(await read(WEIGHTS)) as { weights: Record<string, Array<[number, number]>> }).weights;
  const arms: ArmPose[] = [];
  const armWeight: Record<'L' | 'R', Float64Array> = { L: armChainWeight(weights, 'L', n), R: armChainWeight(weights, 'R', n) };
  const joints: Record<string, [number, number, number]> = {};
  for (const side of ['L', 'R'] as const) {
    const sh = centroid(allPos, skel.joints[`upperarm01.${side}____head`]!);
    const el = centroid(allPos, skel.joints[`lowerarm01.${side}____head`]!);
    joints[`shoulder${side}`] = sh;
    joints[`elbow${side}`] = el;
    const current = Math.atan2(Math.abs(el[0] - sh[0]), sh[1] - el[1]);
    const delta = current - (ARM_ANGLE_DEG * Math.PI) / 180;
    arms.push({ pivot: sh, rot: rotZ(side === 'L' ? delta : -delta), weight: armWeight[side] });
    // keep the measured rest angle for the report
    joints[`rest${side}`] = [(current * 180) / Math.PI, 0, 0];
  }
  // sign check: the left (+x) elbow must move inward
  {
    const probe = new Float64Array(joints.elbowL!);
    const w1 = { ...arms[0]!, weight: Float64Array.of(1) };
    posePositions(probe, [w1]);
    if (Math.abs(probe[0]!) > Math.abs(joints.elbowL![0])) arms[0]!.rot = rotZ(-Math.atan2(arms[0]!.rot[3], arms[0]!.rot[0]));
    const probeR = new Float64Array(joints.elbowR!);
    posePositions(probeR, [{ ...arms[1]!, weight: Float64Array.of(1) }]);
    if (Math.abs(probeR[0]!) > Math.abs(joints.elbowR![0])) arms[1]!.rot = rotZ(-Math.atan2(arms[1]!.rot[3], arms[1]!.rot[0]));
  }
  posePositions(base, arms);
  for (const d of [frame.hipsLed, frame.shouldersLed, ...macro.hipsLed.values(), ...macro.shouldersLed.values(), ...locals.values()]) poseDeltas(d, arms);
  const posedJoint = (p: [number, number, number]) => {
    const a = Float64Array.from(p);
    // joints are not skinned: pose them as fully arm-weighted points of their side
    posePositions(a, [{ ...(p[0] > 0 ? arms[0]! : arms[1]!), weight: Float64Array.of(1) }]);
    return [a[0]!, a[1]!, a[2]!] as [number, number, number];
  };
  // MakeHuman's rest forearm points ~55 deg forward and out; straighten it onto the upper-arm line with a slight
  // FOREARM_BEND_DEG forward bend so the hands hang beside the thighs in the side view
  const forearms: ArmPose[] = [];
  for (const side of ['L', 'R'] as const) {
    const sh = joints[`shoulder${side}`]!;
    const el = posedJoint(joints[`elbow${side}`]!);
    const wr = posedJoint(centroid(allPos, skel.joints[`wrist.${side}____head`]!));
    const upper = normalise([el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]]);
    const b = (FOREARM_BEND_DEG * Math.PI) / 180;
    const target = normalise([upper[0] * Math.cos(b), upper[1] * Math.cos(b), upper[2] * Math.cos(b) + Math.sin(b)]);
    const current = normalise([wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]]);
    forearms.push({ pivot: el, rot: rotBetween(current, target), weight: armChainWeight(weights, side, n, 'forearm') });
  }
  posePositions(base, forearms);
  for (const d of [frame.hipsLed, frame.shouldersLed, ...macro.hipsLed.values(), ...macro.shouldersLed.values(), ...locals.values()]) poseDeltas(d, forearms);
  const shoulderL = joints.shoulderL!; // pivot does not move
  const elbowL = posedJoint(joints.elbowL!);

  // ---- composite shapes for decimation and ring selection
  const mv = (x: number): Record<Level, number> =>
    x < 0.5 ? { min: 1 - 2 * x, average: 2 * x, max: 0 } : { min: 0, average: 2 - 2 * x, max: 2 * x - 1 };
  const compose = (f: number, m: number, w: number, extra?: Float64Array): Float64Array => {
    const p = Float64Array.from(base);
    addInto(p, frame.hipsLed, 1 - f);
    addInto(p, frame.shouldersLed, f);
    const M = mv(m), W = mv(w);
    for (const [end, k] of [['hipsLed', 1 - f], ['shouldersLed', f]] as const)
      for (const [key, d] of macro[end]) {
        const [ml, wl] = key.split('-') as [Level, Level];
        const c = k * M[ml] * W[wl];
        if (c) addInto(p, d, c);
      }
    if (extra) addInto(p, extra);
    return p;
  };
  const reference = compose(0.5, 0.5, 0.5);
  const shapes = [reference, compose(0, 0.5, 0.5), compose(1, 0.5, 0.5), compose(0, 0, 1), compose(1, 1, 0), compose(1, 0.5, 1), compose(0, 1, 0.2)];

  // ---- decimate
  const dec = decimate({ shapes, triangles: body.triangles, vertexCount: n, targetVertices: TARGET_VERTICES });
  const loops = boundaryLoops(dec.triangles);
  const tris = Array.from(dec.triangles);
  for (const loop of loops) for (let i = 1; i + 1 < loop.length; i++) tris.push(loop[0]!, loop[i]!, loop[i + 1]!);

  // reorder vertices top-to-bottom (spatially coherent deltas compress better)
  const keptOld = Array.from(dec.kept);
  const order = keptOld.map((_, i) => i).sort((a, b) => reference[3 * keptOld[b]! + 1]! - reference[3 * keptOld[a]! + 1]! || reference[3 * keptOld[a]!]! - reference[3 * keptOld[b]!]!);
  const newOf = new Uint32Array(keptOld.length);
  order.forEach((oldNew, i) => (newOf[oldNew] = i));
  const kept = order.map((i) => keptOld[i]!);
  const V = kept.length;
  const triangles = Uint16Array.from(tris.map((t) => newOf[t]!));
  const pick = (a: Float64Array): Float64Array => {
    const o = new Float64Array(3 * V);
    kept.forEach((old, i) => {
      o[3 * i] = a[3 * old]!;
      o[3 * i + 1] = a[3 * old + 1]!;
      o[3 * i + 2] = a[3 * old + 2]!;
    });
    return o;
  };
  const pickW = (a: Float64Array): Float64Array => Float64Array.from(kept.map((old) => a[old]!));
  const ref = pick(reference);
  const decShapes = shapes.map(pick);
  const armW = { L: pickW(armWeight.L), R: pickW(armWeight.R) };

  // ---- stature anchors (reference shape)
  let top = 0, bottom = 0;
  for (let i = 0; i < V; i++) {
    if (ref[3 * i + 1]! > ref[3 * top + 1]!) top = i;
    if (ref[3 * i + 1]! < ref[3 * bottom + 1]!) bottom = i;
  }
  const floorY = ref[3 * bottom + 1]!;
  const H = ref[3 * top + 1]! - floorY;
  const yAt = (frac: number) => floorY + frac * H;

  // ---- rings
  const edgesOf = (mask: (v: number) => boolean): number[] => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (let f = 0; f < triangles.length / 3; f++)
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * f + k]!, b = triangles[3 * f + ((k + 1) % 3)]!;
        const key = a < b ? a * V + b : b * V + a;
        if (seen.has(key) || !mask(a) || !mask(b)) continue;
        seen.add(key);
        out.push(a, b);
      }
    return out;
  };
  const torso = (v: number) => armW.L[v]! < 0.5 && armW.R[v]! < 0.5;
  const legL = (v: number) => torso(v) && ref[3 * v]! > 0 && ref[3 * v + 1]! < yAt(0.47);
  const armL = (v: number) => armW.L[v]! >= 0.5;
  const torsoEdges = edgesOf(torso);
  const legEdges = edgesOf(legL);
  const armEdges = edgesOf(armL);
  const Y: [number, number, number] = [0, 1, 0], X: [number, number, number] = [1, 0, 0], Z: [number, number, number] = [0, 0, 1];
  const BAND_CM = 5;

  const ringAt = (id: RingId, edges: number[], mask: (v: number) => boolean, frac: number, normal = Y, u = X, v = Z, through?: [number, number, number]): RingDef => {
    // anchor: the masked vertex closest to the plane, preferring the most anterior one (front of the body)
    const py = through ? through : ([0, yAt(frac), 0] as [number, number, number]);
    let anchor = -1, best = Infinity;
    for (let i = 0; i < V; i++) {
      if (!mask(i)) continue;
      const d = Math.abs((ref[3 * i]! - py[0]) * normal[0] + (ref[3 * i + 1]! - py[1]) * normal[1] + (ref[3 * i + 2]! - py[2]) * normal[2]);
      const score = d - 0.05 * ref[3 * i + 2]!;
      if (d < 1 && score < best) {
        best = score;
        anchor = i;
      }
    }
    if (anchor < 0) throw new Error(`no anchor for ring ${id}`);
    const keep: number[] = [];
    const ax = ref[3 * anchor]!, ay = ref[3 * anchor + 1]!, az = ref[3 * anchor + 2]!;
    for (let e = 0; e < edges.length; e += 2) {
      let near = false;
      for (const S of decShapes) {
        const aS = [S[3 * anchor]!, S[3 * anchor + 1]!, S[3 * anchor + 2]!];
        for (const w of [edges[e]!, edges[e + 1]!]) {
          const d = (S[3 * w]! - aS[0]!) * normal[0] + (S[3 * w + 1]! - aS[1]!) * normal[1] + (S[3 * w + 2]! - aS[2]!) * normal[2];
          if (Math.abs(d) < BAND_CM) near = true;
        }
      }
      if (near) keep.push(edges[e]!, edges[e + 1]!);
    }
    void ax; void ay; void az;
    return { id, anchor, normal, u, v, edges: keep };
  };
  const girthOf = (ring: RingDef, P: Float64Array) => hullPerimeter(cutRing(P, ring));
  const search = (id: RingId, edges: number[], mask: (v: number) => boolean, lo: number, hi: number, mode: 'min' | 'max'): RingDef => {
    let bestRing: RingDef | null = null, bestG = mode === 'min' ? Infinity : -Infinity;
    for (let f = lo; f <= hi + 1e-9; f += 0.005) {
      const r = ringAt(id, edges, mask, f);
      const g = girthOf(r, ref);
      if (mode === 'min' ? g < bestG : g > bestG) {
        bestG = g;
        bestRing = r;
      }
    }
    return bestRing!;
  };
  const armAxis = (() => {
    const d = [elbowL[0] - shoulderL[0], elbowL[1] - shoulderL[1], elbowL[2] - shoulderL[2]];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    return [d[0]! / l, d[1]! / l, d[2]! / l] as [number, number, number];
  })();
  const armU: [number, number, number] = [armAxis[1] * Z[2] - armAxis[2] * Z[1], armAxis[2] * Z[0] - armAxis[0] * Z[2], armAxis[0] * Z[1] - armAxis[1] * Z[0]];
  const armMid: [number, number, number] = [(shoulderL[0] + elbowL[0]) / 2, (shoulderL[1] + elbowL[1]) / 2, (shoulderL[2] + elbowL[2]) / 2];
  const rings: RingDef[] = [
    search('neck', torsoEdges, torso, 0.83, 0.865, 'min'),
    search('chest', torsoEdges, torso, 0.69, 0.75, 'max'),
    search('waist', torsoEdges, torso, 0.58, 0.66, 'min'),
    search('hip', torsoEdges, torso, 0.48, 0.56, 'max'),
    ringAt('thigh', legEdges, legL, 0.41),
    search('calf', legEdges, legL, 0.16, 0.24, 'max'),
    ringAt('arm', armEdges, armL, 0, armAxis, armU, Z, armMid),
  ];
  // bideltoid: all vertices in a band from 6 cm below to 2 cm above the shoulder joint (deltoid prominence; a wider band
  // picks up the outward-sloping upper arm)
  const breadth: number[] = [];
  for (let i = 0; i < V; i++) {
    const y = ref[3 * i + 1]!;
    if (y > shoulderL[1] - 6 && y < shoulderL[1] + 2) breadth.push(i);
  }

  // ---- encode
  const bin = new BinWriter();
  const posStep = 0.01;
  const positions = { step: posStep, section: bin.add(quantise(pick(base), posStep)) };
  const indices = { section: bin.add(triangles) };
  const targets: TargetEntry[] = [];
  const STEPS = [0.05, 0.1, 0.2]; // 0.5 mm (R2 planned 1 mm)
  const addTarget = (id: string, dense: Float64Array) => {
    const d = pick(dense);
    const sp = sparsify(d, 0.004);
    if (sp.indices.length === 0) return false;
    if (sp.indices.length > 0.6 * V) {
      const step = pickStep(d, STEPS);
      targets.push({ id, step, count: V, deltas: bin.add(quantise(d, step)) });
    } else {
      const step = pickStep(sp.deltas, STEPS);
      const idx = bin.add(sp.indices);
      targets.push({ id, step, count: sp.indices.length, deltas: bin.add(quantise(sp.deltas, step)), indices: idx });
    }
    return true;
  };
  const model: FigureManifest['model'] = {
    frame: { hipsLed: 'frame-hipsLed', shouldersLed: 'frame-shouldersLed' },
    macro: { hipsLed: {}, shouldersLed: {} },
    locals: [],
    armAngleDeg: ARM_ANGLE_DEG,
  };
  addTarget('frame-hipsLed', frame.hipsLed);
  addTarget('frame-shouldersLed', frame.shouldersLed);
  for (const end of ['hipsLed', 'shouldersLed'] as const)
    for (const [key, d] of macro[end]) {
      const id = `macro-${end}-${key}`;
      if (addTarget(id, d)) model.macro[end][key as `${MacroLevel}-${MacroLevel}`] = id;
    }
  for (const l of LOCALS) {
    const entry: { id: string; incr?: string; decr?: string } = { id: l.id };
    for (const s of ['incr', 'decr'] as const) {
      const d = locals.get(`${l.id}-${s}`);
      if (d && addTarget(`local-${l.id}-${s}`, d)) entry[s] = `local-${l.id}-${s}`;
    }
    model.locals.push(entry);
  }
  const bytes = bin.bytes();

  const manifest: FigureManifest = {
    format: 'vitals-figure',
    version: 1,
    source: {
      repo: `https://github.com/${SOURCE_REPO}`,
      commit: SOURCE_COMMIT,
      files: allSourceFiles(),
      licence: 'CC0 1.0 (MakeHuman assets: base mesh hm08, targets, default rig weights). Derived data: CC0.',
    },
    units: 'cm',
    vertexCount: V,
    triangleCount: triangles.length / 3,
    bin: { file: FILE, byteLength: bytes.byteLength },
    positions,
    indices,
    targets,
    model,
    rings,
    breadth,
    height: { top, bottom },
    stats: {
      sourceVertices: n,
      sourceTriangles: body.triangles.length / 3,
      holesClosed: loops.length,
      restArmAngleDeg: Math.round(joints.restL![0] * 10) / 10,
      referenceHeightCm: Math.round(H * 10) / 10,
      binBytes: bytes.byteLength,
      ...Object.fromEntries(rings.map((r) => [`refGirth_${r.id}`, Math.round(girthOf(r, ref) * 10) / 10])),
    },
  };
  const packed = packFile(JSON.stringify(manifest), bytes);
  const gz = gzipSync(packed, { level: 9 });
  const report = {
    file: `public/figure/${FILE}`,
    ...manifest.stats,
    packedBytes: packed.byteLength,
    gzipBytes: gz.byteLength,
    brotliBytes: brotliCompressSync(packed, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).byteLength,
    targets: targets.length,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, FILE), gz);
  await writeFile(join(here, 'bake-report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({ ...report, ms: Math.round(performance.now() - t0) }, null, 1));
}

await main();
