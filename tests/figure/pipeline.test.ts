// Offline figure pipeline (scripts/figure) on small synthetic meshes: parsing, decimation, posing, quantisation and the
// pack format round trip into the runtime decoder.
import { decodeFigure } from '@/features/body/figure3d/asset';
import type { FigureManifest } from '@/features/body/figure3d/manifest';
import { boundaryLoops, decimate } from '../../scripts/figure/lib/decimate.ts';
import { BinWriter, dequantise, packFile, pickStep, quantise, sparsify } from '../../scripts/figure/lib/encode.ts';
import { parseObj, parseTarget } from '../../scripts/figure/lib/parse.ts';
import { normalise, poseDeltas, posePositions, rotBetween, rotZ } from '../../scripts/figure/lib/pose.ts';
import { allSourceFiles } from '../../scripts/figure/lib/sources.ts';

/** UV sphere: (rings-1)*seg + 2 vertices, closed. */
function sphere(r: number, rings = 24, seg = 32) {
  const P: number[] = [0, r, 0];
  for (let i = 1; i < rings; i++) {
    const t = (Math.PI * i) / rings;
    for (let j = 0; j < seg; j++) {
      const p = (2 * Math.PI * j) / seg;
      P.push(r * Math.sin(t) * Math.cos(p), r * Math.cos(t), r * Math.sin(t) * Math.sin(p));
    }
  }
  P.push(0, -r, 0);
  const south = P.length / 3 - 1;
  const T: number[] = [];
  const at = (i: number, j: number) => 1 + (i - 1) * seg + (j % seg);
  for (let j = 0; j < seg; j++) T.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < rings - 1; i++)
    for (let j = 0; j < seg; j++) T.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  for (let j = 0; j < seg; j++) T.push(south, at(rings - 1, j), at(rings - 1, j + 1));
  return { positions: Float64Array.from(P), triangles: Uint32Array.from(T), vertexCount: P.length / 3 };
}

describe('parse', () => {
  it('reads one group of an OBJ, splitting quads, and a sparse target', () => {
    const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'v 9 9 9', 'g body', 'f 1/1 2/2 3/3 4/4', 'g helper', 'f 3 4 5'].join('\n');
    const m = parseObj(obj, 'body');
    expect(m.vertexCount).toBe(4);
    expect(m.triangles.length).toBe(6);
    const t = parseTarget('# c\n2 .5 0 -1\n7 1 1 1\n', 4);
    expect(Array.from(t.slice(6, 9))).toEqual([0.5, 0, -1]);
    expect(t.length).toBe(12);
  });

  it('lists every source file at one pinned commit', () => {
    const files = allSourceFiles();
    expect(files).toContain('makehuman/data/3dobjs/base.obj');
    expect(files.filter((f) => f.includes('/macrodetails/universal-')).length).toBe(18);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe('decimate (vertex-preserving quadric collapse)', () => {
  const s = sphere(10);
  const shapes = [s.positions, s.positions.map((v, i) => (i % 3 === 0 ? v * 1.5 : v))];
  const out = decimate({ shapes, triangles: s.triangles, vertexCount: s.vertexCount, targetVertices: 200, locked: new Set([0]) });

  it('keeps a subset of the original vertices, reaches the target and keeps locked ones', () => {
    expect(out.kept.length).toBeLessThanOrEqual(200);
    expect(out.kept.length).toBeGreaterThan(150);
    expect(Array.from(out.kept)).toContain(0);
    expect(new Set(out.kept).size).toBe(out.kept.length);
  });

  it('stays a closed manifold without degenerate triangles, close to the sphere', () => {
    expect(boundaryLoops(out.triangles)).toEqual([]);
    for (let f = 0; f < out.triangles.length; f += 3) {
      const [a, b, c] = [out.triangles[f]!, out.triangles[f + 1]!, out.triangles[f + 2]!];
      expect(a !== b && b !== c && a !== c).toBe(true);
    }
    for (const v of out.kept) expect(Math.hypot(s.positions[3 * v]!, s.positions[3 * v + 1]!, s.positions[3 * v + 2]!)).toBeCloseTo(10, 6);
    expect(out.triangles.length / 3).toBe(2 * out.kept.length - 4); // Euler: closed genus-0 mesh
  });

  it('finds the boundary loop of an open mesh', () => {
    const tri = Uint32Array.from([0, 1, 2, 0, 2, 3]);
    const loops = boundaryLoops(tri);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('pose', () => {
  it('rotates positions about a pivot and deltas by the same linear map', () => {
    const p = Float64Array.of(2, 0, 0);
    const d = Float64Array.of(1, 0, 0);
    const arm = { pivot: [1, 0, 0] as [number, number, number], rot: rotZ(Math.PI / 2), weight: Float64Array.of(1) };
    posePositions(p, [arm]);
    poseDeltas(d, [arm]);
    expect(Array.from(p).map((v) => +v.toFixed(9))).toEqual([1, 1, 0]);
    expect(Array.from(d).map((v) => +v.toFixed(9))).toEqual([0, 1, 0]);
  });

  it('rotBetween maps a onto b', () => {
    const a = normalise([1, -1, 0.4]);
    const b = normalise([0.1, -1, 0.2]);
    const R = rotBetween(a, b);
    const r = [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]];
    r.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));
  });
});

describe('quantise and pack', () => {
  it('round-trips int16 planar data within half a step and picks a step that fits', () => {
    const v = Float64Array.from({ length: 300 }, (_, i) => Math.sin(i) * 40);
    const step = pickStep(v, [0.001, 0.01, 0.05]);
    expect(step).toBe(0.01);
    const back = dequantise(quantise(v, step), step);
    back.forEach((x, i) => expect(Math.abs(x - v[i]!)).toBeLessThanOrEqual(step / 2 + 1e-12));
    expect(sparsify(Float64Array.of(0, 0, 0, 1, 0, 0), 1e-3).indices).toEqual(Uint16Array.of(1));
  });

  it('a packed synthetic mesh decodes in the runtime to the same positions, indices and target', () => {
    const s = sphere(10, 6, 8);
    const bin = new BinWriter();
    const positions = { step: 0.01, section: bin.add(quantise(s.positions, 0.01)) };
    const indices = { section: bin.add(Uint16Array.from(s.triangles)) };
    const delta = s.positions.map((x) => x * 0.1);
    const sp = sparsify(delta, 1e-6);
    const t = { id: 'grow', step: 0.01, count: sp.indices.length, indices: bin.add(sp.indices), deltas: bin.add(quantise(sp.deltas, 0.01)) };
    const bytes = bin.bytes();
    const manifest = {
      format: 'vitals-figure',
      version: 1,
      vertexCount: s.vertexCount,
      triangleCount: s.triangles.length / 3,
      bin: { file: 'x', byteLength: bytes.byteLength },
      positions,
      indices,
      targets: [t],
    } as unknown as FigureManifest;
    const asset = decodeFigure(packFile(JSON.stringify(manifest), bytes));
    expect(Array.from(asset.indices)).toEqual(Array.from(s.triangles));
    asset.base.forEach((x, i) => expect(Math.abs(x - s.positions[i]!)).toBeLessThan(0.006));
    const g = asset.targets.get('grow')!;
    expect(g.indices!.length).toBe(sp.indices.length);
    g.deltas.forEach((x, i) => expect(Math.abs(x - sp.deltas[i]!)).toBeLessThan(0.006));
  });
});
