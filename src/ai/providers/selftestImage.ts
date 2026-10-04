/**
 * Self-test image for the vision probe (R8 §3.3 b): a 64×64 PNG with a solid background and one dark digit.
 * Pure TypeScript (no canvas, tier H): 5×7 bitmap font scaled ×6, RGB 8-bit, zlib stream made of stored (uncompressed)
 * deflate blocks, CRC-32 per chunk and Adler-32 over the raw scanlines.
 */

/** 5×7 font, one string per row, `1` = ink. */
export const DIGIT_FONT: readonly (readonly string[])[] = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
];

export const SELFTEST_IMAGE_SIZE = 64;
export const DIGIT_SCALE = 6;
/** Pale yellow background, near-black ink. */
export const SELFTEST_BG: readonly [number, number, number] = [255, 236, 179];
export const SELFTEST_FG: readonly [number, number, number] = [20, 20, 20];

/** Top-left pixel of the scaled glyph so it is centred: (17, 11) for 64 px. */
export const DIGIT_ORIGIN = {
  x: Math.floor((SELFTEST_IMAGE_SIZE - 5 * DIGIT_SCALE) / 2),
  y: Math.floor((SELFTEST_IMAGE_SIZE - 7 * DIGIT_SCALE) / 2),
};

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream (RFC 1950) with stored deflate blocks (RFC 1951 BTYPE=00), each at most 65535 bytes. */
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x78; // CM=8 (deflate), CINFO=7 (32K window)
  out[1] = 0x01; // FLEVEL=0, FCHECK so that 0x7801 % 31 === 0
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const chunk = data.subarray(i * 65535, Math.min(data.length, (i + 1) * 65535));
    const len = chunk.length;
    out[o++] = i === blocks - 1 ? 1 : 0; // BFINAL, BTYPE=00
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(chunk, o);
    o += len;
  }
  const ad = adler32(data);
  out[o++] = ad >>> 24;
  out[o++] = (ad >>> 16) & 0xff;
  out[o++] = (ad >>> 8) & 0xff;
  out[o] = ad & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes 8-bit RGB pixels (`width*height*3` bytes, row-major) as a PNG. */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.length !== width * height * 3) throw new RangeError('Pixel buffer size does not match the image size');
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  // compression 0, filter 0, interlace 0
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** True when pixel (x, y) of the self-test image is ink for `digit`. */
export function isDigitInk(digit: number, x: number, y: number): boolean {
  const gx = Math.floor((x - DIGIT_ORIGIN.x) / DIGIT_SCALE);
  const gy = Math.floor((y - DIGIT_ORIGIN.y) / DIGIT_SCALE);
  if (x < DIGIT_ORIGIN.x || y < DIGIT_ORIGIN.y || gx > 4 || gy > 6) return false;
  return DIGIT_FONT[digit]?.[gy]?.[gx] === '1';
}

/** 64×64 PNG showing `digit` (0–9). */
export function digitPng(digit: number): Uint8Array {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new RangeError('digit must be 0–9');
  const n = SELFTEST_IMAGE_SIZE;
  const rgb = new Uint8Array(n * n * 3);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = isDigitInk(digit, x, y) ? SELFTEST_FG : SELFTEST_BG;
      rgb.set(c, (y * n + x) * 3);
    }
  }
  return encodePngRgb(n, n, rgb);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
