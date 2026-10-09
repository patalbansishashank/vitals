// The committed figure pack: format, budget, licence note, mesh sanity, quantisation.
import { decodeFigure, inflate } from '../asset';
import { measureMesh } from '../measure';
import { FigureModel, macroFactors } from '../model';
import { RING_IDS } from '../manifest';
import { loadTestAsset, readPackGz } from './loadAsset';

/** Detailed outer body stays below 600 kB; anatomy + lazy code have a separate total 3 MB gate. */
const ASSET_GZIP_BUDGET = 600_000;

describe('figure pack', () => {
  const asset = loadTestAsset();
  const m = asset.manifest;

  it('stays inside the size budget and carries its CC0 source note', () => {
    expect(readPackGz().byteLength).toBeLessThan(ASSET_GZIP_BUDGET);
    expect(m.source.licence).toMatch(/CC0/);
    expect(m.source.repo).toContain('makehumancommunity/makehuman');
    expect(m.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('decodes through the browser path (DecompressionStream) to the same data', async () => {
    const viaStream = decodeFigure(await inflate(readPackGz()));
    expect(viaStream.base).toEqual(asset.base);
    expect(viaStream.targets.size).toBe(asset.targets.size);
  });

  it('is a closed 2-manifold triangle mesh with in-range indices', () => {
    expect(m.vertexCount).toBeGreaterThanOrEqual(9000);
    expect(m.vertexCount).toBeLessThan(10000);
    const idx = asset.indices;
    expect(idx.length).toBe(3 * m.triangleCount);
    const count = new Map<number, number>();
    for (let f = 0; f < idx.length; f += 3)
      for (let k = 0; k < 3; k++) {
        const a = idx[f + k]!,
          b = idx[f + ((k + 1) % 3)]!;
        expect(a).toBeLessThan(m.vertexCount);
        expect(a).not.toBe(b);
        const key = a < b ? a * 65536 + b : b * 65536 + a;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    expect([...count.values()].every((c) => c === 2)).toBe(true);
  });

  it('has the macro and local targets the fitter uses, all finite', () => {
    expect(Object.keys(m.model.macro.hipsLed).length).toBe(8);
    expect(Object.keys(m.model.macro.shouldersLed).length).toBe(8);
    expect(m.model.locals.map((l) => l.id)).toEqual(
      expect.arrayContaining(['waist', 'hips', 'bust', 'neck', 'thigh', 'calf', 'upperarm', 'belly']),
    );
    for (const t of asset.targets.values()) expect(t.deltas.every(Number.isFinite)).toBe(true);
  });

  it('macro factors preserve authored values and smoothly bound the heavy extension', () => {
    for (const x of [0, 0.2, 0.5, 0.8, 1]) {
      const f = macroFactors(x);
      expect(f.min + f.average + f.max).toBeCloseTo(1, 12);
    }
    expect(macroFactors(1).max).toBe(1);
    expect(macroFactors(1.2).max).toBeCloseTo(1 + 0.8 * Math.tanh(0.5), 12);
    expect(macroFactors(100).max).toBeCloseTo(1.8, 12);
    const h = 1e-5;
    expect((macroFactors(1 + h).max - macroFactors(1).max) / h).toBeCloseTo(2, 6);
    let previous = 1;
    for (const x of [1.01, 1.1, 1.4, 2, 5]) {
      const f = macroFactors(x);
      expect(f.min + f.average + f.max).toBeCloseTo(1, 12);
      expect(f.max).toBeGreaterThan(previous);
      expect(f.max).toBeLessThanOrEqual(1.8);
      previous = f.max;
    }
  });

  it('measures plausible girths on the default body (mesh cm)', () => {
    const model = new FigureModel(asset);
    const P = model.evaluate({ frame: 0.5, muscle: 0.5, weight: 0.5, locals: {} });
    const r = measureMesh(P, m);
    expect(r.height).toBeGreaterThan(155);
    expect(r.height).toBeLessThan(180);
    const ranges: Record<string, [number, number]> = {
      neck: [28, 42],
      chest: [75, 105],
      waist: [60, 90],
      hip: [80, 105],
      thigh: [40, 62],
      calf: [30, 42],
      arm: [22, 34],
    };
    for (const id of RING_IDS) {
      expect(r.rings[id].girth).toBeGreaterThan(ranges[id]![0]);
      expect(r.rings[id].girth).toBeLessThan(ranges[id]![1]);
    }
    expect(r.breadth).toBeGreaterThan(35);
    expect(r.breadth).toBeLessThan(50);
  });
});
