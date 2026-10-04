// @vitest-environment node
import type { Key } from './cmaes';
import {
  Archive,
  RegularGrid,
  cvtCentroids,
  emitterRankKey,
  featureRanges,
  gowerDistance,
  selectActiveDescriptors,
  selectAlternatives,
} from './archive';
import { argsortKeys } from './cmaes';
import { Rng } from './rng';

interface Item {
  d: number[];
  u: number;
}

describe('cell indexers', () => {
  it('CVT centroids are deterministic, inside the cube, and cellOf returns the nearest centroid', () => {
    const a = cvtCentroids(20, 3, new Rng('cvt'), 2000);
    const b = cvtCentroids(20, 3, new Rng('cvt'), 2000);
    expect(Array.from(a.centroids)).toEqual(Array.from(b.centroids));
    expect(a.cells).toBe(20);
    for (const v of a.centroids) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const c = 7;
    const p = Array.from(a.centroids.subarray(c * 3, c * 3 + 3));
    expect(a.cellOf(p)).toBe(c);
    expect(cvtCentroids(8, 0, new Rng('x')).cells).toBe(1);
  });

  it('regular grid indexing and active-descriptor selection', () => {
    const g = new RegularGrid([4, 2]);
    expect(g.cells).toBe(8);
    expect(g.cellOf([0, 0])).toBe(0);
    expect(g.cellOf([0.99, 0.99])).toBe(7);
    expect(g.cellOf([0.3, 0.6])).toBe(3);
    expect(
      selectActiveDescriptors([
        [0.1, 0.5, 0.2],
        [0.15, 0.9, 0.2],
        [0.12, 0.2, 0.25],
      ]),
    ).toEqual([1]);
  });
});

describe('MAP-Elites archive', () => {
  const key = (t: Item): Key => [-t.u];

  it('insertion statuses, per-cell elites and comparator switching', () => {
    const arch = new Archive<Item>(new RegularGrid([2, 2]), [0, 1], (t) => t.d, key);
    expect(arch.offer({ d: [0.1, 0.1], u: 1 }).status).toBe('new');
    const imp = arch.offer({ d: [0.2, 0.2], u: 3 });
    expect(imp.status).toBe('improved');
    expect(imp.improvement).toEqual([-2]);
    expect(arch.offer({ d: [0.3, 0.3], u: 2 }).status).toBe('rejected');
    arch.offer({ d: [0.9, 0.9], u: 0.5 });
    expect(arch.size).toBe(2);
    expect(arch.coverage).toBe(0.5);
    expect(arch.best()!.u).toBe(3);
    arch.setComparator((t) => [t.u]); // now smaller u is better
    expect(arch.best()!.u).toBe(0.5);
    expect(arch.offer({ d: [0.1, 0.1], u: 1 }).status).toBe('improved');
  });

  it('CMA-ME ranking: new cells first, then larger improvements, then rejected', () => {
    const keys = [
      emitterRankKey({ status: 'rejected', cell: 0, improvement: null }, [-5]),
      emitterRankKey({ status: 'improved', cell: 0, improvement: [-0.1] }, [-1]),
      emitterRankKey({ status: 'new', cell: 1, improvement: null }, [-0.2]),
      emitterRankKey({ status: 'improved', cell: 2, improvement: [-0.5] }, [-0.3]),
    ];
    expect(argsortKeys(keys)).toEqual([2, 3, 1, 0]);
  });

  it('illuminates the descriptor space: random samples of a toy fill most CVT cells with one elite each', () => {
    const grid = cvtCentroids(32, 2, new Rng('illum'), 2000);
    const arch = new Archive<Item>(grid, [0, 1], (t) => t.d, key);
    const r = new Rng('samples');
    for (let i = 0; i < 2000; i++) {
      const d = [r.float(), r.float()];
      arch.offer({ d, u: -((d[0]! - 0.5) ** 2) });
    }
    expect(arch.coverage).toBeGreaterThan(0.95);
    const cells = arch.all().map((e) => arch.cellOf(e));
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('plan distance and selection of alternatives (§4.12)', () => {
  it('Gower distance handles numeric, circular, categorical and set features', () => {
    const schema = [
      { kind: 'numeric' as const, weight: 2 },
      { kind: 'circular' as const, period: 24 },
      { kind: 'categorical' as const },
      { kind: 'set' as const },
    ];
    const x = [1, 23, 0, 0b011];
    const y = [3, 1, 1, 0b110];
    const ranges = featureRanges([x, y, [5, 0, 0, 0]], 4);
    const d = gowerDistance(x, y, schema, ranges);
    // numeric 2/4 (w 2), circular 2/12, categorical 1, set 1 − 1/3
    expect(d).toBeCloseTo((2 * 0.5 + 2 / 12 + 1 + 2 / 3) / 5, 12);
    expect(gowerDistance(y, x, schema, ranges)).toBeCloseTo(d, 15);
    expect(gowerDistance(x, x, schema, ranges)).toBe(0);
  });

  it('A = best utility in F, then MMR among relaxed-feasible candidates with D ≥ D_min', () => {
    const pos = [0, 0.05, 0.5, 0.9, 0.95, 0.3];
    const cands = [
      { utility: 0.9, safe: true, strictFeasible: true, relaxedFeasible: true },
      { utility: 0.95, safe: true, strictFeasible: false, relaxedFeasible: true }, // near-duplicate of 0, higher U
      { utility: 0.7, safe: true, strictFeasible: false, relaxedFeasible: true },
      { utility: 0.6, safe: true, strictFeasible: false, relaxedFeasible: true },
      { utility: 0.99, safe: false, strictFeasible: true, relaxedFeasible: true }, // unsafe
      { utility: 0.99, safe: true, strictFeasible: false, relaxedFeasible: false }, // outside relaxed floors
    ];
    const dist = (i: number, j: number) => Math.abs(pos[i]! - pos[j]!);
    const r = selectAlternatives(cands, dist);
    expect(r.chosen[0]).toBe(0);
    expect(r.aStrict).toBe(true);
    expect(r.chosen).toEqual([0, 3, 2]);
    for (let i = 1; i < r.chosen.length; i++) expect(r.distances[i]!).toBeGreaterThanOrEqual(0.2);
    const two = selectAlternatives(cands.slice(0, 2), dist);
    expect(two.chosen).toEqual([0]);
    expect(two.shortfall).toBe('noDistinctAlternative');
  });

  it('falls back to the safe set ordered by floor violation when nothing meets the relaxed floors', () => {
    const cands = [
      { utility: 0.9, safe: true, strictFeasible: false, relaxedFeasible: false, floorViolation: 0.3 },
      { utility: 0.5, safe: true, strictFeasible: false, relaxedFeasible: false, floorViolation: 0.1 },
      { utility: 0.9, safe: false, strictFeasible: false, relaxedFeasible: false, floorViolation: 0 },
    ];
    const r = selectAlternatives(cands, () => 1);
    expect(r.fallback).toBe(true);
    expect(r.chosen).toEqual([1]);
    expect(selectAlternatives([cands[2]!], () => 1).shortfall).toBe('noCandidates');
  });
});
