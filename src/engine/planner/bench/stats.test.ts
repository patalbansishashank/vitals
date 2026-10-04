// @vitest-environment node
/**
 * Statistics of the planner benchmark against known values: exact and approximate Wilcoxon signed-rank p-values
 * (textbook data set, brute-force enumeration with ties), Holm adjustment, Vargha-Delaney Â₁₂, bootstrap intervals,
 * ERT and the acceptance gate.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../optim/rng';
import { a12Magnitude, averageRanks, bootstrap, bootstrapBound, ert, gateVerdict, holm, median, normCdf, quantile, suiteGate, varghaDelaney, wilcoxonSignedRank, type PairedUnit } from './stats';

/** Brute-force exact distribution: P(W+ ≥ w) and P(W+ ≤ w) over all 2^n sign assignments of the (tied) ranks. */
function bruteForce(d: number[]): { ge: number; le: number; w: number } {
  const nz = d.filter((v) => v !== 0);
  const r = averageRanks(nz.map(Math.abs));
  const w = nz.reduce((s, v, i) => s + (v > 0 ? r[i]! : 0), 0);
  let ge = 0;
  let le = 0;
  const N = 1 << nz.length;
  for (let m = 0; m < N; m++) {
    let s = 0;
    for (let i = 0; i < nz.length; i++) if ((m >> i) & 1) s += r[i]!;
    if (s >= w - 1e-9) ge++;
    if (s <= w + 1e-9) le++;
  }
  return { ge: ge / N, le: le / N, w };
}

describe('Wilcoxon signed-rank', () => {
  it('textbook data (Hollander & Wolfe; scipy reference values): W− = 24, exact p = 0.041259765625 two-sided', () => {
    const d = [6, 8, 14, 16, 23, 24, 28, 29, 41, -48, 49, 56, 60, -67, 75];
    const zero = d.map(() => 0);
    const r = wilcoxonSignedRank(d, zero);
    expect(r.method).toBe('exact');
    expect(r.wMinus).toBe(24);
    expect(r.wPlus).toBe(96);
    expect(r.p).toBeCloseTo(0.041259765625, 12);
    expect(wilcoxonSignedRank(d, zero, 'greater').p).toBeCloseTo(676 / 32768, 12);
    expect(wilcoxonSignedRank(d, zero, 'less').p).toBeGreaterThan(0.97);
    // normal approximation with continuity correction: z = (|96 − 60| − ½)/√(15·16·31/24) → p = 0.0437723237630412
    const a = wilcoxonSignedRank(d, zero, 'two-sided', { exactMaxN: 0 });
    expect(a.method).toBe('normal');
    expect(a.p).toBeCloseTo(0.0437723237630412, 9);
  });

  it('all five differences positive: p = 1/32 one-sided, 1/16 two-sided', () => {
    const x = [3, 4, 5, 6, 7];
    const y = [1, 1, 1, 1, 1];
    expect(wilcoxonSignedRank(x, y, 'greater').p).toBeCloseTo(1 / 32, 12);
    expect(wilcoxonSignedRank(x, y).p).toBeCloseTo(1 / 16, 12);
  });

  it('exact distribution with tied ranks and zero differences equals brute-force enumeration', () => {
    const rng = new Rng('stats/wilcoxon');
    for (let t = 0; t < 20; t++) {
      const d = Array.from({ length: 13 }, () => rng.int(9) - 3); // many ties, some zeros
      const bf = bruteForce(d);
      const zero = d.map(() => 0);
      expect(wilcoxonSignedRank(d, zero, 'greater').p).toBeCloseTo(bf.ge, 12);
      expect(wilcoxonSignedRank(d, zero, 'less').p).toBeCloseTo(bf.le, 12);
      expect(wilcoxonSignedRank(d, zero).p).toBeCloseTo(Math.min(1, 2 * Math.min(bf.ge, bf.le)), 12);
    }
  });

  it('identical samples give p = 1; the normal approximation agrees with the exact test for n = 40', () => {
    expect(wilcoxonSignedRank([1, 2, 3], [1, 2, 3]).p).toBe(1);
    const rng = new Rng('stats/approx');
    const d = Array.from({ length: 40 }, () => rng.normal() + 0.3);
    const zero = d.map(() => 0);
    const ex = wilcoxonSignedRank(d, zero).p;
    const ap = wilcoxonSignedRank(d, zero, 'two-sided', { exactMaxN: 0 }).p;
    expect(Math.abs(ex - ap)).toBeLessThan(0.01);
  });
});

describe('multiple comparisons, effect size, intervals', () => {
  it('Holm: p = (0.01, 0.04, 0.03, 0.005) → (0.03, 0.06, 0.06, 0.02)', () => {
    const a = holm([0.01, 0.04, 0.03, 0.005]);
    [0.03, 0.06, 0.06, 0.02].forEach((v, i) => expect(a[i]).toBeCloseTo(v, 12));
    expect(holm([0.5, 0.9])).toEqual([1, 1]);
  });

  it('Vargha-Delaney Â₁₂ and its magnitude labels', () => {
    expect(varghaDelaney([5, 6, 7], [1, 6, 8])).toBeCloseTo(0.5, 12); // (4 + ½)/9
    expect(varghaDelaney([1, 2, 3, 4], [0, 0, 0, 0])).toBe(1);
    expect(varghaDelaney([0, 0], [1, 1])).toBe(0);
    expect(varghaDelaney([1, 2], [1, 2])).toBe(0.5);
    expect(varghaDelaney([2, 3, 4], [1, 2, 3])).toBeCloseTo(7 / 9, 12); // 2: 1 + ½; 3: 2 + ½; 4: 3 → 7/9
    expect([0.5, 0.57, 0.65, 0.75, 0.3].map(a12Magnitude)).toEqual(['negligible', 'small', 'medium', 'large', 'medium']);
  });

  it('normal CDF, quantiles and the median', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 15);
    expect(normCdf(1.959963984540054)).toBeCloseTo(0.975, 12);
    expect(normCdf(-3)).toBeCloseTo(0.0013498980316301, 13);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12); // type 7
    expect(median([5, 1, 3])).toBe(3);
  });

  it('bootstrap: deterministic, exact for constant data, ≈ 1.96 σ/√n for the mean of normal data', () => {
    const c = bootstrap([2, 2, 2, 2], (s) => s.reduce((a, b) => a + b, 0) / s.length, { B: 2000 });
    expect([c.lo, c.hi]).toEqual([2, 2]);
    const rng = new Rng('stats/boot');
    const xs = Array.from({ length: 200 }, () => rng.normal());
    const m = (s: readonly number[]) => s.reduce((a, b) => a + b, 0) / s.length;
    const a = bootstrap(xs, m, { seed: 7 });
    const b = bootstrap(xs, m, { seed: 7 });
    expect(a.lo).toBe(b.lo);
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m(xs)) ** 2, 0) / (xs.length - 1));
    expect((a.hi - a.lo) / 2).toBeGreaterThan(0.85 * 1.96 * (sd / Math.sqrt(200)));
    expect((a.hi - a.lo) / 2).toBeLessThan(1.15 * 1.96 * (sd / Math.sqrt(200)));
    expect(bootstrapBound(a, 'lower')).toBeGreaterThan(a.lo);
  });

  it('ERT counts unsuccessful runs in full', () => {
    expect(ert([{ hit: 100, used: 500 }, { hit: null, used: 500 }, { hit: 300, used: 500 }])).toBe(450);
    expect(ert([{ hit: null, used: 10 }])).toBe(Infinity);
  });
});

describe('acceptance gate', () => {
  const unit = (problem: string, seed: number, d: { ls: [number, number]; r: [number, number]; q: [number, number]; w?: [number, number] }): PairedUnit => ({
    problem,
    seed,
    ls1: d.ls[0],
    ls2: d.ls[1],
    r1a: d.r[0],
    r1b: d.r[1],
    q1: d.q[0],
    q2: d.q[1],
    wall1: d.w?.[0] ?? 1000,
    wall2: d.w?.[1] ?? 1000,
  });

  it('identical algorithms are non-inferior but not better (the v1-vs-v1 sanity case)', () => {
    const units = Array.from({ length: 31 }, (_, i) => unit(`p${i % 3}`, i, { ls: [i % 2, i % 2], r: [0.01 * (i % 5), 0.01 * (i % 5)], q: [0.9, 0.9] }));
    const g = suiteGate(units, 't');
    expect(g.nonInferior).toBe(true);
    expect(g.p).toBe(1);
    expect(g.lexSuccessDelta).toBe(0);
    const v = gateVerdict({ T: g });
    expect(v.pass).toBe(false);
    expect(v.nonInferiorAll).toBe(true);
  });

  it('a clearly better candidate passes; a clearly worse one fails non-inferiority', () => {
    const rng = new Rng('gate');
    const better = Array.from({ length: 40 }, (_, i) => unit(`p${i % 4}`, i, { ls: [0, 1], r: [0.05, 0.0], q: [0.8 + 0.05 * rng.float(), 0.95 + 0.05 * rng.float()] }));
    const vb = gateVerdict({ T: suiteGate(better, 'b') });
    expect(vb.pass).toBe(true);
    expect(vb.superiorSuites).toEqual(['T']);
    const worse = better.map((u) => ({ ...u, ls1: u.ls2, ls2: u.ls1, r1a: u.r1b, r1b: u.r1a, q1: u.q2, q2: u.q1 }));
    const vw = gateVerdict({ T: suiteGate(worse, 'w') });
    expect(vw.pass).toBe(false);
    expect(vw.nonInferiorAll).toBe(false);
  });

  it('equal quality at ≥ 20 % less wall time passes', () => {
    const units = Array.from({ length: 31 }, (_, i) => unit('p', i, { ls: [1, 1], r: [0, 0], q: [1, 1], w: [1000, 700] }));
    const v = gateVerdict({ T: suiteGate(units, 'f') });
    expect(v.pass).toBe(true);
    expect(v.fasterSuites).toEqual(['T']);
  });
});
