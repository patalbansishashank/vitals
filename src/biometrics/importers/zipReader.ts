/**
 * Minimal ZIP reader for SQLite exports (tier H: DecompressionStream, no DOM). Supports stored (0) and deflate (8)
 * entries, no ZIP64, no encryption. Reads only the central directory plus the entries asked for.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const u16 = (d: DataView, o: number): number => d.getUint16(o, true);
const u32 = (d: DataView, o: number): number => d.getUint32(o, true);

async function sliceBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Lists the entries of a ZIP Blob (directories excluded). Throws on a malformed archive. */
export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 65557);
  const tail = await sliceBytes(blob, blob.size - tailLen, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tv, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (end of central directory not found).');
  const count = u16(tv, eocd + 10);
  const cdSize = u32(tv, eocd + 12);
  const cdOffset = u32(tv, eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('ZIP64 archives are not supported.');
  const cd = await sliceBytes(blob, cdOffset, cdOffset + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (u32(dv, p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = u16(dv, p + 10);
    const compressedSize = u32(dv, p + 20);
    const size = u32(dv, p + 24);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const offset = u32(dv, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    if (!name.endsWith('/')) out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Extracts one entry's bytes. */
export async function readZipEntry(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  const head = await sliceBytes(blob, e.offset, e.offset + 30);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (u32(hv, 0) !== 0x04034b50) throw new Error('Corrupt ZIP local header.');
  const dataStart = e.offset + 30 + u16(hv, 26) + u16(hv, 28);
  const raw = blob.slice(dataStart, dataStart + e.compressedSize);
  if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
  if (e.method !== 8) throw new Error(`Unsupported ZIP compression method ${e.method}.`);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot inflate ZIP entries.');
  const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
