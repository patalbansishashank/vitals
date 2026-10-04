// @vitest-environment node
import { Rng, halton, hashString, latinHypercube } from './rng';

const take = (r: Rng, n: number) => Array.from({ length: n }, () => r.nextU32());

describe('Rng (xoshiro128**, named streams)', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(take(new Rng('a'), 8)).toEqual(take(new Rng('a'), 8));
    expect(take(new Rng('a'), 8)).not.toEqual(take(new Rng('b'), 8));
    expect(take(new Rng(42), 4)).toEqual(take(new Rng(42), 4));
    expect(take(new Rng(42), 4)).not.toEqual(take(new Rng('42'), 4));
  });

  it('forked streams do not depend on parent consumption (worker-count independence)', () => {
    const p1 = new Rng('root');
    const p2 = new Rng('root');
    take(p2, 1000);
    for (let i = 0; i < 7; i++) p2.normal();
    expect(take(p1.fork('S3/0'), 16)).toEqual(take(p2.fork('S3/0'), 16));
    expect(take(p1.fork('S3/0'), 4)).not.toEqual(take(p1.fork('S3/1'), 4));
    expect(p1.fork('a').fork('b').key).toBe('root/a/b');
  });

  it('clone replays exactly, including the cached Box-Muller spare', () => {
    const r = new Rng('c');
    r.normal();
    const c = r.clone();
    expect([r.normal(), r.normal(), r.float()]).toEqual([c.normal(), c.normal(), c.float()]);
  });

  it('getState/fromState continues bitwise identically with a pending Box-Muller spare, through structuredClone', () => {
    const r = new Rng('state');
    take(r, 37);
    for (let i = 0; i < 13; i++) r.normal(); // odd count → the spare is pending
    const st = r.getState();
    expect(st.hasSpare).toBe(true);
    expect(st.key).toBe('state');
    const copy = structuredClone(st);
    expect(copy).toEqual(st);
    const c = Rng.fromState(copy);
    expect(c.getState()).toEqual(st);
    expect(c.key).toBe(r.key);
    // 1000 mixed draws (first one consumes the spare); compare the exact bit patterns
    const draw = (g: Rng, i: number) => (i % 4 === 0 ? g.normal() : i % 4 === 1 ? g.float() : i % 4 === 2 ? g.nextU32() : g.normal());
    const a = Float64Array.from({ length: 1000 }, (_, i) => draw(r, i));
    const b = Float64Array.from({ length: 1000 }, (_, i) => draw(c, i));
    expect(Array.from(new Uint32Array(b.buffer))).toEqual(Array.from(new Uint32Array(a.buffer)));
    expect(c.getState()).toEqual(r.getState());
    // the state is a copy: drawing from the original does not touch the snapshot; forks still derive from the key
    expect(st).toEqual(copy);
    expect(take(c.fork('x'), 4)).toEqual(take(new Rng('state').fork('x'), 4));
    // numeric seeds keep their key; invalid states are rejected
    const n = new Rng(42);
    n.normal();
    expect(take(Rng.fromState(n.getState()), 8)).toEqual(take(n, 8));
    expect(() => Rng.fromState({ ...st, s: [0, 0, 0, 0] })).toThrow();
    expect(() => Rng.fromState({ ...st, s: [1, 2, 3] as unknown as [number, number, number, number] })).toThrow();
  });

  it('produces well-behaved uniform, integer and normal variates', () => {
    const r = new Rng('stats');
    const N = 20000;
    let s = 0;
    let s2 = 0;
    let umin = 1;
    let umax = 0;
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < N; i++) {
      const u = r.float();
      umin = Math.min(umin, u);
      umax = Math.max(umax, u);
      counts[r.int(7)]!++;
      const z = r.normal();
      s += z;
      s2 += z * z;
    }
    expect(umin).toBeGreaterThanOrEqual(0);
    expect(umax).toBeLessThan(1);
    for (const c of counts) expect(Math.abs(c - N / 7)).toBeLessThan(0.08 * (N / 7));
    expect(Math.abs(s / N)).toBeLessThan(0.03);
    expect(Math.abs(s2 / N - 1)).toBeLessThan(0.04);
    expect(() => r.int(0)).toThrow();
  });

  it('permutations are permutations', () => {
    const p = new Rng('perm').permutation(50);
    expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('sampling helpers', () => {
  it('latin hypercube has exactly one point per stratum in every dimension', () => {
    const m = 16;
    const d = 5;
    const x = latinHypercube(m, d, new Rng('lhs'));
    for (let j = 0; j < d; j++) {
      const strata = new Set<number>();
      for (let i = 0; i < m; i++) {
        const v = x[i * d + j]!;
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
        strata.add(Math.floor(v * m));
      }
      expect(strata.size).toBe(m);
    }
  });

  it('halton sequence matches the radical inverse', () => {
    expect(Array.from(halton(1, 2))).toEqual([0.5, 1 / 3]);
    expect(Array.from(halton(4, 2))).toEqual([0.125, 4 / 9]);
  });

  it('hashString is stable and sensitive', () => {
    expect(hashString('vitals')).toBe(hashString('vitals'));
    expect(hashString('vitals')).not.toBe(hashString('vitals!'));
  });
});
