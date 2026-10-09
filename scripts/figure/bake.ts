// Bakes public/figure/figure-v2.bin from the cached MakeHuman sources (run fetch.ts first).
// Steps (R2 sec. 5.5): read the hm08 body group and the chosen targets -> compose the two adult frame shapes -> lower the
// arms to ARM_ANGLE_DEG with MakeHuman's rig weights -> remove inward eye/mouth pockets and zip the lids and lips shut -> decimate ->
// derive the tape-measure rings -> quantise to int16 -> write one binary + JSON manifest, and print the sizes.
// Run: node scripts/figure/bake.ts [targetVertices]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import type { FigureJoint, FigureManifest, FrameEnd, MacroLevel, RingDef, RingId, TargetEntry } from '../../src/features/body/figure3d/manifest.ts';
import { bellyStencils, recenterWaist, projectWaistProfile } from './lib/belly.ts';
import { boundaryLoops, decimate } from './lib/decimate.ts';
import { BinWriter, packFile, pickStep, quantise, sparsify } from './lib/encode.ts';
import { parseObj, parseTarget } from './lib/parse.ts';
import { armChainWeight, centroid, normalise, poseDeltas, posePositions, rotBetween, rotZ, type ArmPose } from './lib/pose.ts';
import { cutRing, hullPerimeter } from './lib/rings.ts';
import { closeHead, expandHead } from './lib/head.ts';
import { Surface } from '../../src/features/body/figure3d/surface.ts';
import { affineResidual, distribution, laplacianStep, oneRing, repairOutliers, taubinField, twoRing } from './lib/smoothness.ts';
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
const outDir = process.env.FIGURE_OUT_DIR ?? join(here, '../../public/figure');
const TARGET_VERTICES = Number(process.argv[2] ?? 9000);
const ARM_ANGLE_DEG = 18;
const FOREARM_BEND_DEG = 12;
/**
 * Target repair (docs/wp/C-FIX-morph-smoothing.md): a vertex whose delta differs from the affine fit of its two-ring by
 * more than this (cm) takes the fit instead, in a few rounds; then two light Laplacian passes take the vertex-scale
 * noise out of every target. Head, hands and feet keep their authored deltas.
 */
const REPAIR_LIMIT_CM = 0.15;
const REPAIR_ROUNDS = 3;
const SMOOTH_PASSES = 2;
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
  let n = body.vertexCount;
  let base = scaled(body.positions, DM_TO_CM);
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
  const closedHead = closeHead(compose(0.5, 0.5, 0.5), body.triangles);
  base = expandHead(base, closedHead.stencils, closedHead.smoothing);
  frame.hipsLed = expandHead(frame.hipsLed, closedHead.stencils, closedHead.smoothing);
  frame.shouldersLed = expandHead(frame.shouldersLed, closedHead.stencils, closedHead.smoothing);
  for (const entries of [macro.hipsLed, macro.shouldersLed, locals])
    for (const [id, values] of entries) entries.set(id, expandHead(values, closedHead.stencils, closedHead.smoothing));
  for (const side of ['L', 'R'] as const) {
    const weights = new Float64Array(base.length / 3); weights.set(armWeight[side]); armWeight[side] = weights;
  }
  n = base.length / 3;

  // ---- repair and smooth every target's delta field on the full mesh (before decimation). MakeHuman's targets carry
  // single-vertex kinks (up to 4 cm against the surroundings in the max-weight targets, 2.5 cm in the frame shapes)
  // and vertex-scale noise; at the fitter's large coefficients they show as points pulled out of the belly and a
  // jagged outline. Head, hands and feet keep their authored deltas (fine detail, small deltas).
  const smoothRings = oneRing(closedHead.triangles, n);
  const smoothTwo = twoRing(smoothRings);
  const handWeight = new Float64Array(n);
  for (const [bone, list] of Object.entries(weights))
    if (/^(wrist|metacarpal\d|finger\d-\d)\.[LR]$/.test(bone)) for (const [v, w] of list) if (v < body.vertexCount) handWeight[v] = handWeight[v]! + w;
  const smoothable = new Uint8Array(n);
  {
    let lo = Infinity, hi = -Infinity;
    for (let v = 0; v < body.vertexCount; v++) { lo = Math.min(lo, base[3 * v + 1]!); hi = Math.max(hi, base[3 * v + 1]!); }
    for (let v = 0; v < n; v++) {
      const y = (base[3 * v + 1]! - lo) / (hi - lo);
      smoothable[v] = y > 0.06 && y < 0.84 && handWeight[v]! < 0.5 ? 1 : 0;
    }
  }
  const repaired: Record<string, number> = {};
  const smoothTarget = (id: string, d: Float64Array) => {
    repaired[id] = repairOutliers(base, d, smoothTwo, REPAIR_LIMIT_CM, REPAIR_ROUNDS, smoothable);
    const spare = new Float64Array(d.length);
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) laplacianStep(d, spare, smoothRings, 0.5, smoothable);
  };
  smoothTarget('frame-hipsLed', frame.hipsLed);
  smoothTarget('frame-shouldersLed', frame.shouldersLed);
  for (const end of ['hipsLed', 'shouldersLed'] as const) for (const [key, d] of macro[end]) smoothTarget(`macro-${end}-${key}`, d);
  for (const [id, d] of locals) smoothTarget(`local-${id}`, d);

  // Continuous proportional-edit weights, shared by all keys; no hard selection boundary.
  const bellyProfile = bellyStencils(compose(0.5, 0.5, 0.5), closedHead.triangles, armWeight.L, armWeight.R);
  for (const d of [frame.hipsLed, frame.shouldersLed, ...macro.hipsLed.values(), ...macro.shouldersLed.values(), ...locals.values()]) bellyProfile.apply(d);

  // Do not stack the pregnancy key's sag on the max-weight key's sag: at the navel they lower the mesh
  // by about 3.3 cm and 7.7 cm respectively, compressing the underside into a corner. Retain 35% of that
  // local vertical motion with the same C2 falloff; horizontal girth remains available to the fitter.
  for (const d of [...macro.hipsLed.values(), ...macro.shouldersLed.values(), locals.get('belly-incr')!])
    for (let v = 0; v < n; v++) d[3*v+1] = d[3*v+1]! * (1 - .65 * bellyProfile.mask[v]!);
  bellyProfile.apply(base, true);
  // The waist control can reach seven authored units; keep its lateral displacement field smooth too.
  for (const id of ['waist-incr', 'waist-decr']) {
    const d = locals.get(id)!;
    repairOutliers(base, d, smoothTwo, 0.075, 4, smoothable);
    const spare = new Float64Array(d.length);
    for (let pass = 0; pass < 4; pass++) laplacianStep(d, spare, smoothRings, 0.5, smoothable);
  }

  recenterWaist(compose(0.5, 0.5, 0.5), locals.get('waist-incr')!, armWeight.L, armWeight.R);
  projectWaistProfile(compose(0.5, 0.5, 0.5), locals.get('waist-incr')!, bellyProfile.mask);
  const reference = compose(0.5, 0.5, 0.5);
  const shapes = [reference, compose(0, 0.5, 0.5), compose(1, 0.5, 0.5), compose(0, 0, 1), compose(1, 1, 0), compose(1, 0.5, 1), compose(0, 1, 0.2)];

  // ---- decimate
  const dec = decimate({ shapes, triangles: closedHead.triangles, vertexCount: n, targetVertices: TARGET_VERTICES, locked: closedHead.locked });
  const loops = boundaryLoops(dec.triangles);
  if (loops.length) throw new Error('Repaired skin must stay closed through decimation');
  const tris = Array.from(dec.triangles);

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

  // ---- diagnostics (FIGURE_DIAGNOSE=<json path>): how smooth every target's displacement field is, on the source
  // mesh and on the decimated one, so a kink can be traced to the target itself or to the decimation.
  if (process.env.FIGURE_DIAGNOSE) {
    const srcRings = twoRing(oneRing(closedHead.triangles, n));
    const decRings = twoRing(oneRing(triangles, V));
    const yFrac = (P: Float64Array, v: number, lo: number, hi: number) => (P[3 * v + 1]! - lo) / (hi - lo);
    const lo = Math.min(...Array.from({ length: V }, (_, v) => ref[3 * v + 1]!)), hi = Math.max(...Array.from({ length: V }, (_, v) => ref[3 * v + 1]!));
    const rows: Record<string, unknown>[] = [];
    const all: [string, Float64Array][] = [['frame-hipsLed', frame.hipsLed], ['frame-shouldersLed', frame.shouldersLed]];
    for (const end of ['hipsLed', 'shouldersLed'] as const) for (const [key, d] of macro[end]) all.push([`macro-${end}-${key}`, d]);
    for (const [id, d] of locals) all.push([`local-${id}`, d]);
    for (const [id, dense] of all) {
      const src = affineResidual(reference, dense, srcRings);
      const d = pick(dense);
      const dec = affineResidual(ref, d, decRings);
      const s = distribution(src, 0.3), e = distribution(dec, 0.3);
      const worst = Array.from({ length: V }, (_, v) => v).sort((a, b) => dec[b]! - dec[a]!).slice(0, 5).map((v) => ({ v, old: kept[v], residual: +dec[v]!.toFixed(3), srcResidual: +src[kept[v]!]!.toFixed(3), x: +ref[3 * v]!.toFixed(1), yFrac: +yFrac(ref, v, lo, hi).toFixed(3), z: +ref[3 * v + 2]!.toFixed(1), arm: Math.max(armW.L[v]!, armW.R[v]!) > 0.5 }));
      rows.push({ id, source: { mean: +s.mean.toFixed(4), p99: +s.p99.toFixed(3), max: +s.max.toFixed(3), over3mm: s.over }, decimated: { mean: +e.mean.toFixed(4), p99: +e.p99.toFixed(3), max: +e.max.toFixed(3), over3mm: e.over }, worst });
    }
    // Candidate smoothing methods on the source mesh, judged by the residual left and by how far the target moved.
    const srcOne = oneRing(closedHead.triangles, n);
    const trials: Record<string, unknown>[] = [];
    for (const id of ['frame-shouldersLed', 'macro-shouldersLed-min-max', 'macro-hipsLed-min-max', 'local-waist-incr', 'local-belly-incr']) {
      const dense = all.find(([k]) => k === id)![1];
      const before = distribution(affineResidual(reference, dense, srcRings), 0.3);
      const methods: Record<string, (d: Float64Array) => void> = {
        'laplacian x2 (0.5)': (d) => { const sp = new Float64Array(d.length); laplacianStep(d, sp, srcOne, 0.5); laplacianStep(d, sp, srcOne, 0.5); },
        'laplacian x6 (0.5)': (d) => { const sp = new Float64Array(d.length); for (let i = 0; i < 6; i++) laplacianStep(d, sp, srcOne, 0.5); },
        'taubin x3': (d) => taubinField(d, srcOne, 3),
        'taubin x8': (d) => taubinField(d, srcOne, 8),
        'repair >3mm x3': (d) => { repairOutliers(reference, d, srcRings, 0.3); },
        'repair >1.5mm x3': (d) => { repairOutliers(reference, d, srcRings, 0.15); },
        'repair >1.5mm + taubin x2': (d) => { repairOutliers(reference, d, srcRings, 0.15); taubinField(d, srcOne, 2); },
      };
      for (const [name, run] of Object.entries(methods)) {
        const d = Float64Array.from(dense);
        run(d);
        const after = distribution(affineResidual(reference, d, srcRings), 0.3);
        let moved = 0, movedSum = 0;
        for (let v = 0; v < n; v++) { const m = Math.hypot(d[3 * v]! - dense[3 * v]!, d[3 * v + 1]! - dense[3 * v + 1]!, d[3 * v + 2]! - dense[3 * v + 2]!); moved = Math.max(moved, m); movedSum += m; }
        trials.push({ id, method: name, before: { mean: +before.mean.toFixed(4), p99: +before.p99.toFixed(3), max: +before.max.toFixed(3), over3mm: before.over }, after: { mean: +after.mean.toFixed(4), p99: +after.p99.toFixed(3), max: +after.max.toFixed(3), over3mm: after.over }, movedMaxCm: +moved.toFixed(3), movedMeanCm: +(movedSum / n).toFixed(4) });
      }
    }
    // The source mesh and the worst targets for the Blender comparison (scripts/figure/blender/smooth_targets.py).
    await writeFile(process.env.FIGURE_DIAGNOSE.replace(/\.json$/, '-source.json'), JSON.stringify({
      positions: Array.from(reference, (x) => +x.toFixed(4)),
      triangles: Array.from(closedHead.triangles),
      bellyWeights: Array.from(bellyProfile.mask, w => +w.toFixed(6)),
      targets: Object.fromEntries(['frame-shouldersLed', 'macro-shouldersLed-min-max', 'macro-hipsLed-min-max', 'local-belly-incr'].map((id) => [id, Array.from(all.find(([k]) => k === id)![1], (x) => +x.toFixed(4))])),
    }));
    await writeFile(process.env.FIGURE_DIAGNOSE, JSON.stringify({ targets: rows, trials }, null, 1));
  }

  // ---- nipples: the sharpest small cone on each side of the chest (umbrella offset over squared edge length, in
  // both frame shapes). The fat layer passes under them; their tip and three rings are filled in from the
  // surrounding layer.
  const nipples = (() => {
    const near = Array.from({ length: V }, () => new Set<number>());
    for (let f = 0; f < triangles.length; f += 3)
      for (let k = 0; k < 3; k++) {
        near[triangles[f + k]!]!.add(triangles[f + ((k + 1) % 3)]!);
        near[triangles[f + ((k + 1) % 3)]!]!.add(triangles[f + k]!);
      }
    const sharpness = (S: Float64Array) => {
      const normals = new Float64Array(3 * V);
      for (let f = 0; f < triangles.length; f += 3) {
        const [a, b, c] = [triangles[f]!, triangles[f + 1]!, triangles[f + 2]!];
        const u = [0, 1, 2].map((k) => S[3 * b + k]! - S[3 * a + k]!);
        const w = [0, 1, 2].map((k) => S[3 * c + k]! - S[3 * a + k]!);
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[3 * v + k] = normals[3 * v + k]! + n[k]!;
      }
      return (v: number) => {
        const n = normalise([normals[3 * v]!, normals[3 * v + 1]!, normals[3 * v + 2]!]);
        let offset = 0,
          edge = 0;
        for (const j of near[v]!)
          for (let k = 0; k < 3; k++) offset += ((S[3 * v + k]! - S[3 * j + k]!) * n[k]!) / near[v]!.size;
        for (const j of near[v]!)
          edge += Math.hypot(S[3 * v]! - S[3 * j]!, S[3 * v + 1]! - S[3 * j + 1]!, S[3 * v + 2]! - S[3 * j + 2]!) / near[v]!.size;
        return { cone: offset / (edge * edge), front: n[2] };
      };
    };
    const frames = [sharpness(decShapes[1]!), sharpness(decShapes[2]!)];
    let low = Infinity,
      high = -Infinity;
    for (let v = 0; v < V; v++) {
      low = Math.min(low, ref[3 * v + 1]!);
      high = Math.max(high, ref[3 * v + 1]!);
    }
    const stature = high - low;
    const at = (frac: number) => low + frac * stature;
    const tips: number[] = [];
    for (const side of [1, -1]) {
      let best = -1,
        score = -Infinity;
      for (let v = 0; v < V; v++) {
        const x = side * ref[3 * v]!,
          y = ref[3 * v + 1]!;
        if (y < at(0.65) || y > at(0.82) || x < 0.03 * stature || x > 0.1 * stature) continue;
        const [hips, shoulders] = frames.map((f) => f(v));
        if (hips!.front < 0.3 || shoulders!.front < 0.3) continue;
        if (hips!.cone + shoulders!.cone > score) {
          score = hips!.cone + shoulders!.cone;
          best = v;
        }
      }
      tips.push(best);
    }
    // The tip and three rings: the lean shape and the caps make the layer shallow under the whole small cone, and
    // in the hips-led frame the areola is broader.
    const pinned = new Set<number>();
    for (const tip of tips) {
      let ring = [tip];
      pinned.add(tip);
      for (let depth = 0; depth < 3; depth++) {
        const next: number[] = [];
        for (const v of ring)
          for (const j of near[v]!)
            if (!pinned.has(j)) {
              pinned.add(j);
              next.push(j);
            }
        ring = next;
      }
    }
    return { tips, pinned: [...pinned].sort((a, b) => a - b) };
  })();
  const nippleZone = new Set(nipples.pinned);
  // ---- inward thickness: the distance from each skin vertex along its inward normal to the opposite wall of its
  // own part (body, left arm, right arm), the least over the composite shapes. The under-skin fat shell is an inset of the fitted skin and must stay
  // well inside thin parts (fingers, toes, ears, the nose), whatever the lean morph says.
  const thickness = new Float64Array(V).fill(Infinity);
  for (const S of decShapes) {
    const normals = new Float64Array(3 * V);
    for (let f = 0; f < triangles.length; f += 3) {
      const [a, b, c] = [triangles[f]!, triangles[f + 1]!, triangles[f + 2]!];
      const u = [0, 1, 2].map((k) => S[3 * b + k]! - S[3 * a + k]!);
      const w = [0, 1, 2].map((k) => S[3 * c + k]! - S[3 * a + k]!);
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[3 * v + k] = normals[3 * v + k]! + n[k]!;
    }
    // Rays meet only the vertex's own part: in the heavier composites an arm passes into the flank, and the flank
    // would read as a few millimetres thick.
    const partOf = (v: number) => (armW.L[v]! >= 0.5 ? 1 : armW.R[v]! >= 0.5 ? 2 : 0);
    const surfaces = [0, 1, 2].map((part) => {
      const own: number[] = [];
      for (let f = 0; f < triangles.length; f += 3) {
        const votes = [0, 0, 0];
        for (let k = 0; k < 3; k++) votes[partOf(triangles[f + k]!)]!++;
        // The nipple cone is not the opposite wall of the chest around it.
        const nipple = [0, 1, 2].every((k) => nippleZone.has(triangles[f + k]!));
        if (votes[part]! >= 2 && !nipple) own.push(triangles[f]!, triangles[f + 1]!, triangles[f + 2]!);
      }
      return new Surface(S, own);
    });
    for (let v = 0; v < V; v++) {
      const surface = surfaces[partOf(v)]!;
      const n = normalise([normals[3 * v]!, normals[3 * v + 1]!, normals[3 * v + 2]!]);
      // A cone of rays: a fitted shape tilts the normal, and closed lids or lips touch at a grazing angle.
      const a = normalise(Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]);
      const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
      const tilt = Math.tan((25 * Math.PI) / 180);
      for (const [p, q] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const inward = normalise([0, 1, 2].map((k) => -n[k]! + tilt * (p! * a[k]! + q! * b[k]!)));
        const origin = [0, 1, 2].map((k) => S[3 * v + k]! + inward[k]! * 0.005);
        const hit = surface.distance(origin, inward, 60);
        // Measured along the normal: a tilted ray's wall is that far below the surface.
        const along = -inward.reduce((sum, c, k) => sum + c * n[k]!, 0);
        thickness[v] = Math.min(thickness[v]!, ((hit ?? 60) + 0.005) * along);
      }
    }
  }

  // ---- stature anchors (reference shape)
  let top = 0, bottom = 0;
  for (let i = 0; i < V; i++) {
    if (ref[3 * i + 1]! > ref[3 * top + 1]!) top = i;
    if (ref[3 * i + 1]! < ref[3 * bottom + 1]!) bottom = i;
  }
  const floorY = ref[3 * bottom + 1]!;
  const H = ref[3 * top + 1]! - floorY;
  const yAt = (frac: number) => floorY + frac * H;

  // Helper vertices have their own macro deltas, beyond the body vertex range.
  // Pose those helpers with the same chain transforms used by the visible skin.
  const rigFrames = { hipsLed: Float64Array.from(allPos), shouldersLed: Float64Array.from(allPos) };
  for (const sex of ['female', 'male'] as const) {
    const end = FRAME_OF[sex];
    for (const eth of ETHNICITIES)
      addInto(rigFrames[end], scaled(parseTarget(await read(ethnicTarget(eth, sex)), allPos.length / 3), DM_TO_CM), 1 / ETHNICITIES.length);
  }
  const jointNames: Record<string, string> = {
    pelvis: 'root____head', neck: 'neck01____head', head: 'head____head', crown: 'head____tail',
  };
  for (const side of ['L', 'R'] as const) {
    for (const [id, bone] of Object.entries({ shoulder: 'upperarm01', elbow: 'lowerarm01', wrist: 'wrist', hip: 'upperleg01', knee: 'lowerleg01', ankle: 'foot' }))
      jointNames[`${id}${side}`] = `${bone}.${side}____head`;
    jointNames[`foot${side}`] = `foot.${side}____tail`;
    for (let finger = 1; finger <= 5; finger++) {
      for (let phalanx = 1; phalanx <= 3; phalanx++)
        jointNames[`finger${finger}-${phalanx}${side}`] = `finger${finger}-${phalanx}.${side}____head`;
      jointNames[`finger${finger}-tip${side}`] = `finger${finger}-3.${side}____tail`;
      for (let phalanx = 1; phalanx <= 3; phalanx++) {
        const name = `toe${finger}-${phalanx}.${side}____head`;
        if (skel.joints[name]) jointNames[`toe${finger}-${phalanx}${side}`] = name;
      }
      const tip = `toe${finger}-${finger === 1 ? 2 : 3}.${side}____tail`;
      jointNames[`toe${finger}-tip${side}`] = tip;
    }
  }
  const placedFrames = { hipsLed: pick(compose(0, 0.5, 0.5)), shouldersLed: pick(compose(1, 0.5, 0.5)) };
  const placement = (P: Float64Array) => ({ floor: P[3 * bottom + 1]!, scale: H / (P[3 * top + 1]! - P[3 * bottom + 1]!) });
  const skinJoints: FigureJoint[] = Object.entries(jointNames).map(([id, name]) => {
    const output = { id } as FigureJoint;
    for (const end of ['hipsLed', 'shouldersLed'] as const) {
      const point = Float64Array.from(centroid(rigFrames[end], skel.joints[name]!));
      const side = id.endsWith('L') ? 0 : id.endsWith('R') ? 1 : -1;
      if (/^(shoulder|elbow|wrist|finger)/.test(id) && side >= 0) {
        posePositions(point, [{ ...arms[side]!, weight: Float64Array.of(1) }]);
        if (/^(wrist|finger)/.test(id)) posePositions(point, [{ ...forearms[side]!, weight: Float64Array.of(1) }]);
      }
      const { floor, scale } = placement(placedFrames[end]);
      output[end] = [point[0]! * scale, (point[1]! - floor) * scale, point[2]! * scale];
    }
    return output;
  });
  for (const end of ['hipsLed', 'shouldersLed'] as const) {
    const { floor, scale } = placement(placedFrames[end]);
    for (let i = 0; i < placedFrames[end].length; i += 3) {
      placedFrames[end][i] = placedFrames[end][i]! * scale;
      placedFrames[end][i + 1] = (placedFrames[end][i + 1]! - floor) * scale;
      placedFrames[end][i + 2] = placedFrames[end][i + 2]! * scale;
    }
  }
  const newIndex = new Map(kept.map((old, i) => [old, i]));
  const limbBones: Record<string, string> = { shoulder: 'upperarm01', elbow: 'lowerarm01', wrist: 'wrist', hip: 'upperleg01', knee: 'lowerleg01', ankle: 'foot' };
  for (const joint of skinJoints) {
    const match = /^(shoulder|elbow|wrist|hip|knee|ankle)([LR])$/.exec(joint.id);
    if (!match) continue;
    const bone = `${limbBones[match[1]!]}.${match[2]}`;
    const samples = (weights[bone] ?? []).filter(([old, w]) => old < body.vertexCount && w > 0.15 && newIndex.has(old)).map(([old]) => newIndex.get(old)!);
    if (samples.length < 8) throw new Error(`No skin stencil for ${joint.id}`);
    // Surface weights locate the visible limb's centre. Helpers alone can sit
    // outside a thin elbow after the adult shape and forearm pose are applied.
    samples.sort((a, b) => {
      const distance = (v: number) => [0, 1, 2].reduce((sum, k) => sum + (placedFrames.hipsLed[3 * v + k]! - joint.hipsLed[k]!) ** 2, 0);
      return distance(a) - distance(b);
    });
    const stencil = samples.slice(0, Math.max(12, Math.ceil(samples.length * 0.25)));
    joint.skinVertices = stencil;
    for (const end of ['hipsLed', 'shouldersLed'] as const) joint[end] = centroid(placedFrames[end], stencil);
  }
  for (const joint of skinJoints) {
    const match = /^(finger|toe)([1-5])-(\d|tip)([LR])$/.exec(joint.id);
    if (!match) continue;
    const [, kind, digit, section, side] = match;
    const last = kind === 'toe' && digit === '1' ? '2' : '3';
    const bone = `${kind}${digit}-${section === 'tip' ? last : section}.${side}`;
    const samples = (weights[bone] ?? []).filter(([old, w]) => old < body.vertexCount && w > 0.35 && newIndex.has(old)).map(([old]) => newIndex.get(old)!);
    if (samples.length < 4) continue;
    const startJoint = skinJoints.find((j) => j.id === `${kind}${digit}-${section === 'tip' ? last : section}${side}`)!;
    const endJoint = skinJoints.find((j) => j.id === `${kind}${digit}-${section === 'tip' || section === last ? 'tip' : Number(section) + 1}${side}`)!;
    const axis = normalise(endJoint.hipsLed.map((v, a) => v - startJoint.hipsLed[a]!));
    samples.sort((a, b) => {
      const along = (v: number) => [0, 1, 2].reduce((sum, k) => sum + placedFrames.hipsLed[3 * v + k]! * axis[k]!, 0);
      return (section === 'tip' ? -1 : 1) * (along(a) - along(b));
    });
    const stencil = samples.slice(0, Math.max(4, Math.ceil(samples.length * 0.22)));
    joint.skinVertices = stencil;
    for (const end of ['hipsLed', 'shouldersLed'] as const)
      joint[end] = centroid(placedFrames[end], stencil);
  }
  await writeFile(join(cache, 'skin-registration.json'), JSON.stringify({
    heightCm: H, joints: skinJoints,
    skin: { hipsLed: Array.from(placedFrames.hipsLed), shouldersLed: Array.from(placedFrames.shouldersLed), indices: Array.from(triangles) },
  }));

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
  const SHELL_STEP = 0.05;
  const shell = {
    step: SHELL_STEP,
    thickness: bin.add(Uint8Array.from(thickness, (t) => Math.max(1, Math.min(255, Math.floor(t / SHELL_STEP))))),
    nippleTips: nipples.tips,
    pinned: nipples.pinned,
  };
  const indices = { section: bin.add(triangles) };
  const targets: TargetEntry[] = [];
  const STEPS = [0.01, 0.05, 0.1, 0.2]; // 0.1 mm: large fitted coefficients must not amplify rounding into contour steps
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
    joints: skinJoints,
    shell,
    headSurface: {
      removedSourceTriangles: closedHead.removedTriangles,
      caps: closedHead.caps.map((cap) => ({
        id: cap.id,
        rim: cap.rim.map((old) => newIndex.get(old)!),
        triangles: cap.triangles.map((old) => newIndex.get(old)!),
        faces: Array.from({ length: cap.triangles.length / 3 }, (_, i) => {
          const wanted = cap.triangles.slice(3 * i, 3 * i + 3).map((old) => newIndex.get(old)!).sort((a, b) => a - b).join(':');
          for (let f = 0; f < triangles.length / 3; f++)
            if (Array.from(triangles.subarray(3 * f, 3 * f + 3)).sort((a, b) => a - b).join(':') === wanted) return f;
          throw new Error('Head cap was lost during decimation');
        }),
      })),
    },
    armClearance: {
      leftArm: Array.from({ length: V }, (_, i) => i).filter((i) => armW.L[i]! > 0.8),
      rightArm: Array.from({ length: V }, (_, i) => i).filter((i) => armW.R[i]! > 0.8),
      centralBody: Array.from({ length: V }, (_, i) => i).filter((i) => Math.max(armW.L[i]!, armW.R[i]!) < 0.05),
    },
    armPose: {
      leftWeights: Array.from(armW.L, (w) => Math.round(w * 10000) / 10000),
      rightWeights: Array.from(armW.R, (w) => Math.round(w * 10000) / 10000),
      clearanceCm: 0.4,
    },
    stats: {
      sourceVertices: body.vertexCount,
      sourceTriangles: body.triangles.length / 3,
      holesClosed: loops.length,
      headPocketsRemoved: closedHead.caps.length,
      headSourceTrianglesRemoved: closedHead.removedTriangles,
      headCapVerticesAdded: closedHead.stencils.length,
      restArmAngleDeg: Math.round(joints.restL![0] * 10) / 10,
      repairedVertices: Object.values(repaired).reduce((a, b) => a + b, 0),
      posedArmAngleDeg: ARM_ANGLE_DEG,
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
    bellyProfile: { kernelXCm: 4, kernelYCm: 8, retainedSag: 0.35, waistRepairCm: 0.075, waistSmoothPasses: 4, waistForwardShare: 0.8, targetStepCm: 0.01 },
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, FILE), gz);
  await writeFile(join(here, 'bake-report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({ ...report, ms: Math.round(performance.now() - t0) }, null, 1));
}

await main();
