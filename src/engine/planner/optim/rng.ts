/**
 * Deterministic seeded randomness for the planner (dossier 18 §4.19, "Determinism").
 *
 * - Generator: xoshiro128** (Blackman & Vigna [70]) — 128-bit state, 32-bit output, period 2^128 − 1.
 * - Seeding: a string key is hashed (two independent 32-bit FNV-1a + murmur3 finalisers) and expanded
 *   with SplitMix32 into the four state words (never all zero).
 * - Streams: every stream is *named*; `fork(label)` derives the child from the parent's key, not from
 *   its state, so a stream's numbers never depend on how much any other stream was consumed. All
 *   randomness stays in the coordinator, therefore results are identical for any worker count.
 * - Normals: Box-Muller (pairs; the second value is cached and is part of the stream state).
 *
 * No `Math.random`, no clocks.
 */

export type Seed = number | string;

/** murmur3 32-bit finaliser (avalanche). */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit hash of a string: FNV-1a with a configurable offset basis, then fmix32. */
export function hashString(s: string, basis = 0x811c9dc5): number {
  let h = basis >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** 32-bit hash of a list of 32-bit integers (order-sensitive). */
export function hashInts(values: ArrayLike<number>, basis = 0x811c9dc5): number {
  let h = basis >>> 0;
  for (let i = 0; i < values.length; i++) {
    h = Math.imul(h ^ (values[i]! | 0), 0x01000193);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  }
  return fmix32(h ^ values.length);
}

function splitmix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

function seedKey(seed: Seed): string {
  return typeof seed === 'number' ? `#${seed}` : seed;
}

const TWO_PI = 2 * Math.PI;
const INV_2_32 = 1 / 4294967296;

/**
 * Complete serialisable state of an `Rng` (plain data, structured-clone safe): the stream name, the four
 * xoshiro128** words and the cached Box-Muller spare. `Rng.fromState(rng.getState())` continues bitwise
 * identically to `rng`.
 */
export interface RngState {
  key: string;
  s: [number, number, number, number];
  spare: number;
  hasSpare: boolean;
}

export class Rng {
  /** The stream's name; children are derived from it. */
  readonly key: string;
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: Seed) {
    this.key = seedKey(seed);
    const a = hashString(this.key, 0x811c9dc5);
    const b = hashString(this.key, 0x9747b28c);
    this.s0 = splitmix32(a);
    this.s1 = splitmix32(b ^ this.s0);
    this.s2 = splitmix32(a ^ 0x6a09e667 ^ this.s1);
    this.s3 = splitmix32(b ^ 0xbb67ae85 ^ this.s2);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Independent child stream named `${key}/${label}` (independent of this stream's consumption). */
  fork(label: string | number): Rng {
    return new Rng(`${this.key}/${label}`);
  }

  /** Exact copy including state (for replay tests). */
  clone(): Rng {
    const r = new Rng(this.key);
    r.s0 = this.s0;
    r.s1 = this.s1;
    r.s2 = this.s2;
    r.s3 = this.s3;
    r.spare = this.spare;
    r.hasSpare = this.hasSpare;
    return r;
  }

  /** Full state (xoshiro words + Box-Muller spare): a stream restored from it continues bitwise identically. */
  getState(): RngState {
    return {
      key: this.key,
      s: [this.s0, this.s1, this.s2, this.s3],
      spare: this.spare,
      hasSpare: this.hasSpare,
    };
  }

  /** Restore a stream captured with `getState()` (the state object is copied, never aliased). */
  static fromState(st: RngState): Rng {
    const s = st.s;
    if (!Array.isArray(s) || s.length !== 4 || !s.every((v) => Number.isInteger(v)))
      throw new RangeError('Rng.fromState: `s` must hold four 32-bit integers');
    if ((s[0] | s[1] | s[2] | s[3]) === 0) throw new RangeError('Rng.fromState: all-zero xoshiro state');
    const r = new Rng(st.key);
    r.s0 = s[0];
    r.s1 = s[1];
    r.s2 = s[2];
    r.s3 = s[3];
    r.spare = st.spare;
    r.hasSpare = st.hasSpare;
    return r;
  }

  /** Next unsigned 32-bit integer (xoshiro128**). */
  nextU32(): number {
    const s1 = this.s1;
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1) with 53 bits of resolution. */
  float(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform in the open interval (0, 1) (32-bit resolution). */
  floatOpen(): number {
    return (this.nextU32() + 0.5) * INV_2_32;
  }

  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** Uniform integer in [0, n) without modulo bias (n ≤ 2^32). */
  int(n: number): number {
    if (!(n >= 1)) throw new RangeError(`Rng.int: n must be ≥ 1, got ${n}`);
    const bound = Math.floor(n);
    const limit = 4294967296 - (4294967296 % bound);
    let r = this.nextU32();
    while (r >= limit) r = this.nextU32();
    return r % bound;
  }

  /** Standard normal variate (Box-Muller). */
  normal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    const u1 = this.floatOpen();
    const u2 = this.float();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = TWO_PI * u2;
    this.spare = r * Math.sin(th);
    this.hasSpare = true;
    return r * Math.cos(th);
  }

  /** Fill `out` with standard normal variates. */
  normals(out: Float64Array): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = this.normal();
    return out;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Random permutation of 0..n-1. */
  permutation(n: number): number[] {
    return this.shuffle(Array.from({ length: n }, (_, i) => i));
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Latin hypercube sample (McKay et al. [36]) of `m` points in (0,1)^d, row-major Float64Array(m × d).
 * Used for S1 probes (§4.11) and for the parameter ensemble in quantile space (§4.15); the caller maps
 * quantiles to parameter values with each parameter's inverse CDF.
 */
export function latinHypercube(m: number, d: number, rng: Rng): Float64Array {
  const out = new Float64Array(m * d);
  for (let j = 0; j < d; j++) {
    const perm = rng.permutation(m);
    for (let i = 0; i < m; i++) out[i * d + j] = (perm[i]! + rng.floatOpen()) / m;
  }
  return out;
}

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

/** Halton low-discrepancy point `index` (≥ 1) in [0,1)^d (d ≤ 16). */
export function halton(index: number, d: number, out = new Float64Array(d)): Float64Array {
  for (let j = 0; j < d; j++) {
    const base = PRIMES[j % PRIMES.length]!;
    let f = 1;
    let r = 0;
    let i = index;
    while (i > 0) {
      f /= base;
      r += f * (i % base);
      i = Math.floor(i / base);
    }
    out[j] = r;
  }
  return out;
}
