/**
 * Raw-sample chunk codec (R7 §3). Encodes one chunk's samples as delta-coded Int32 columns and gzips them.
 *
 * Layout v1 (all little-endian), before gzip:
 *
 *   offset  size  field
 *   0       1     version = 1
 *   1       4     n         uint32, number of samples (≥ 1)
 *   5       8     t0_ms     float64, first timestamp (ms since epoch, integer)
 *   13      4     dt_ms     int32, the constant step when the series is regular, else 0
 *   17      4     scale     float32, values are stored as round(v * scale)
 *   21      4·(n−1)          time deltas t[i] − t[i−1] as int32 (only when dt_ms = 0)
 *   …       4·n              q[0], then q[i] − q[i−1] as int32, where q = round(v * scale)
 *
 * The 16 bytes t0/dt/scale are the header R7 describes; version and n precede them. Timestamps must be integer
 * milliseconds and strictly increasing. Decoding returns `q / scale`, so values round-trip exactly at the given scale.
 */
import { buf } from '../crypto';

export const CODEC_VERSION = 1;
const HEAD_BYTES = 21;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

export interface Samples {
  t: ArrayLike<number>;
  v: ArrayLike<number>;
}

export interface DecodedSamples {
  t: Float64Array;
  v: Float64Array;
}

const isInt32 = (x: number) => Number.isInteger(x) && x >= INT32_MIN && x <= INT32_MAX;

/** Quantise values at `scale` (the float32 value actually stored), checking the Int32 range. */
export function quantize(v: ArrayLike<number>, scale: number): Int32Array {
  const s = Math.fround(scale);
  const q = new Int32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (!Number.isFinite(x)) throw new Error(`Sample value ${i} is not a finite number.`);
    const r = Math.round(x * s);
    if (!isInt32(r)) throw new Error(`Sample value ${x} does not fit an Int32 at scale ${scale}.`);
    q[i] = r;
  }
  return q;
}

/** Encode samples into the uncompressed v1 layout. Throws on empty input, length mismatch, NaN or unsorted times. */
export function encodeSamples(samples: Samples, scale = 1): Uint8Array<ArrayBuffer> {
  const { t, v } = samples;
  const n = t.length;
  if (n === 0) throw new Error('A chunk needs at least one sample.');
  if (v.length !== n) throw new Error(`Length mismatch: ${n} timestamps, ${v.length} values.`);
  const s32 = Math.fround(scale);
  if (!(Number.isFinite(s32) && s32 > 0)) throw new Error('The scale must be a positive finite number (as float32).');
  for (let i = 0; i < n; i++) {
    const ti = t[i]!;
    if (!Number.isSafeInteger(ti)) throw new Error(`Timestamp ${i} is not an integer millisecond value.`);
    if (i > 0) {
      const d = ti - t[i - 1]!;
      if (d <= 0) throw new Error(`Timestamps must be strictly increasing (index ${i}).`);
      if (!isInt32(d)) throw new Error(`The gap before timestamp ${i} is too large.`);
    }
  }
  const q = quantize(v, scale);
  const dt0 = n > 1 ? t[1]! - t[0]! : 0;
  let regular = n > 1;
  for (let i = 2; regular && i < n; i++) regular = t[i]! - t[i - 1]! === dt0;
  const dt = regular ? dt0 : 0;

  const out = new Uint8Array(HEAD_BYTES + (regular ? 0 : 4 * (n - 1)) + 4 * n);
  const view = new DataView(out.buffer);
  view.setUint8(0, CODEC_VERSION);
  view.setUint32(1, n, true);
  view.setFloat64(5, t[0]!, true);
  view.setInt32(13, dt, true);
  view.setFloat32(17, scale, true);
  let o = HEAD_BYTES;
  if (!regular) {
    for (let i = 1; i < n; i++, o += 4) view.setInt32(o, t[i]! - t[i - 1]!, true);
  }
  for (let i = 0; i < n; i++, o += 4) {
    const d = i === 0 ? q[0]! : q[i]! - q[i - 1]!;
    if (!isInt32(d)) throw new Error(`The step between values ${i - 1} and ${i} does not fit an Int32 at scale ${scale}.`);
    view.setInt32(o, d, true);
  }
  return out;
}

/** Inverse of `encodeSamples`. */
export function decodeSamples(bytes: Uint8Array): DecodedSamples {
  if (bytes.length < HEAD_BYTES) throw new Error('Chunk too short.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== CODEC_VERSION) throw new Error(`Unsupported chunk version ${version}.`);
  const n = view.getUint32(1, true);
  const t0 = view.getFloat64(5, true);
  const dt = view.getInt32(13, true);
  const scale = view.getFloat32(17, true);
  const regular = dt !== 0;
  if (n === 0 || !(scale > 0)) throw new Error('Corrupt chunk header.');
  if (bytes.length !== HEAD_BYTES + (regular ? 0 : 4 * (n - 1)) + 4 * n) throw new Error('Chunk length does not match its header.');
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  let o = HEAD_BYTES;
  t[0] = t0;
  for (let i = 1; i < n; i++) {
    if (regular) t[i] = t[i - 1]! + dt;
    else {
      t[i] = t[i - 1]! + view.getInt32(o, true);
      o += 4;
    }
  }
  let q = 0;
  for (let i = 0; i < n; i++, o += 4) {
    q += view.getInt32(o, true);
    v[i] = q / scale;
  }
  return { t, v };
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(buf(bytes));
      controller.close();
    },
  });
  return new Uint8Array(await new Response(input.pipeThrough(transform)).arrayBuffer());
}

export const gzip = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('gzip'));

/** `encodeSamples` + gzip. */
export async function encodeChunk(samples: Samples, scale = 1): Promise<Uint8Array<ArrayBuffer>> {
  return gzip(encodeSamples(samples, scale));
}

/** gunzip + `decodeSamples`. */
export async function decodeChunk(bytes: Uint8Array): Promise<DecodedSamples> {
  return decodeSamples(await gunzip(bytes));
}
