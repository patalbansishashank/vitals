// int16 quantisation (KHR_mesh_quantization style: value = q * step) and the binary layout of figure.bin.
// All sections are little-endian and 4-byte aligned so the runtime can view them without copying.

export interface Section {
  offset: number;
  byteLength: number;
}

/**
 * xyz triples -> int16, PLANAR (all x, then all y, then all z): ~20 % smaller after gzip than interleaved, because each
 * plane is a smooth signal. The runtime reads component a of vertex i at [a * n + i].
 */
export function quantise(values: ArrayLike<number>, step: number): Int16Array {
  const n = values.length / 3;
  const out = new Int16Array(values.length);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      const q = Math.round(values[3 * i + a]! / step);
      if (q > 32767 || q < -32768) throw new Error(`value ${values[3 * i + a]} out of int16 range at step ${step}`);
      out[a * n + i] = q;
    }
  return out;
}

/** Inverse of `quantise` back to interleaved xyz (tests and tools). */
export function dequantise(q: Int16Array, step: number): Float64Array {
  const n = q.length / 3;
  const out = new Float64Array(q.length);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) out[3 * i + a] = q[a * n + i]! * step;
  return out;
}

const MAGIC = 0x47494656; // 'VFIG'

/**
 * One file: [u32 magic][u32 jsonByteLength][json utf-8][pad to 4][binary sections], then gzip. Section offsets in the
 * manifest are relative to the start of the binary part.
 */
export function packFile(manifestJson: string, binary: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(manifestJson);
  const head = 8 + json.byteLength;
  const pad = (4 - (head % 4)) % 4;
  const out = new Uint8Array(head + pad + binary.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.byteLength, true);
  out.set(json, 8);
  out.set(binary, head + pad);
  return out;
}

/** Smallest step from `steps` that keeps every value in int16 range. */
export function pickStep(values: ArrayLike<number>, steps: readonly number[]): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) max = Math.max(max, Math.abs(values[i]!));
  for (const s of steps) if (max / s <= 32767) return s;
  throw new Error(`no int16 step for max |value| ${max}`);
}

export class BinWriter {
  private parts: Uint8Array[] = [];
  private length = 0;

  add(view: ArrayBufferView): Section {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.parts.push(new Uint8Array(pad));
      this.length += pad;
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const section = { offset: this.length, byteLength: bytes.byteLength };
    this.parts.push(bytes.slice());
    this.length += bytes.byteLength;
    return section;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }
}

/** Sparse form of a dense delta array: indices of vertices whose delta exceeds `eps` in any axis. */
export function sparsify(dense: Float64Array, eps: number): { indices: Uint16Array; deltas: Float64Array } {
  const n = dense.length / 3;
  const idx: number[] = [];
  for (let v = 0; v < n; v++)
    if (Math.abs(dense[3 * v]!) > eps || Math.abs(dense[3 * v + 1]!) > eps || Math.abs(dense[3 * v + 2]!) > eps) idx.push(v);
  const deltas = new Float64Array(idx.length * 3);
  idx.forEach((v, i) => {
    deltas[3 * i] = dense[3 * v]!;
    deltas[3 * i + 1] = dense[3 * v + 1]!;
    deltas[3 * i + 2] = dense[3 * v + 2]!;
  });
  return { indices: Uint16Array.from(idx), deltas };
}
