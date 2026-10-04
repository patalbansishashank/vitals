/**
 * Streaming single-entry ZIP reader (tier H). Reads only the end-of-central-directory record, the central directory and one
 * entry's bytes via Blob.slice(); the entry is exposed as a ReadableStream, inflated with DecompressionStream('deflate-raw')
 * (CSP-safe, no wasm). Supports stored (0) and deflate (8), ZIP64 sizes/offsets, no encryption, no multi-disk archives.
 */

export interface ZipStreamEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const u16 = (d: DataView, o: number): number => d.getUint16(o, true);
const u32 = (d: DataView, o: number): number => d.getUint32(o, true);
const u64 = (d: DataView, o: number): number => Number(d.getBigUint64(o, true));

async function bytes(blob: Blob, a: number, b: number): Promise<DataView> {
  const buf = await blob.slice(a, b).arrayBuffer();
  return new DataView(buf);
}

/** Lists central-directory entries (directories excluded). */
export async function listZipEntries(blob: Blob): Promise<ZipStreamEntry[]> {
  const tailLen = Math.min(blob.size, 65535 + 22 + 20);
  const tailStart = blob.size - tailLen;
  const tail = await bytes(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  let count = u16(tail, eocd + 10);
  if ((cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) && eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
    const z64Off = u64(tail, eocd - 20 + 8);
    const z = await bytes(blob, z64Off, z64Off + 56);
    if (u32(z, 0) !== 0x06064b50) throw new Error('corrupt ZIP64 end-of-central-directory');
    count = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  }
  const cd = await bytes(blob, cdOffset, cdOffset + cdSize);
  const raw = new Uint8Array(cd.buffer);
  const dec = new TextDecoder();
  const out: ZipStreamEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    let csize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    const name = dec.decode(raw.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extra (id 0x0001): values appear only for fields that are 0xFFFFFFFF, in the order size, csize, offset
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
        if (offset === 0xffffffff) offset = u64(cd, q);
      }
      e += 4 + len;
    }
    if ((flags & 1) !== 0) throw new Error(`encrypted ZIP entry: ${name}`);
    if (!name.endsWith('/')) out.push({ name, method, compressedSize: csize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Byte stream of one entry (inflated when method 8). */
export async function openZipEntry(blob: Blob, e: ZipStreamEntry): Promise<ReadableStream<Uint8Array>> {
  const lh = await bytes(blob, e.offset, e.offset + 30);
  if (u32(lh, 0) !== 0x04034b50) throw new Error('corrupt ZIP local header');
  const start = e.offset + 30 + u16(lh, 26) + u16(lh, 28);
  const slice = blob.slice(start, start + e.compressedSize);
  if (e.method === 0) return slice.stream() as ReadableStream<Uint8Array>;
  if (e.method !== 8) throw new Error(`unsupported ZIP compression method ${e.method}`);
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot inflate ZIP entries (no DecompressionStream)');
  return (slice.stream() as ReadableStream<Uint8Array>).pipeThrough(
    new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
}
