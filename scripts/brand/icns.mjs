// macOS .icns container with PNG payloads. Layout: 'icns' + total length (big-endian), then one block per image:
// four-character type + block length (header included) + the PNG file.

/** Pixel size of each icon type we write (ic11..ic14 are the @2x retina entries of 16, 32, 128 and 256 pt). */
export const ICNS_TYPES = {
  icp4: 16,
  icp5: 32,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
};

/**
 * @param {{ type: string, png: Buffer }[]} entries
 * @returns {Buffer}
 */
export function encodeIcns(entries) {
  const blocks = entries.map(({ type, png }) => {
    if (!/^[a-z0-9]{4}$/.test(type)) throw new Error(`icns: bad type ${type}`);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(8 + blocks.reduce((n, b) => n + b.length, 0), 4);
  return Buffer.concat([head, ...blocks]);
}

/**
 * Reads an .icns back into its blocks (used by the asset tests).
 * @param {Buffer} buf
 * @returns {{ type: string, data: Buffer }[]}
 */
export function decodeIcns(buf) {
  if (buf.toString('latin1', 0, 4) !== 'icns') throw new Error('icns: bad magic');
  const total = buf.readUInt32BE(4);
  if (total !== buf.length) throw new Error(`icns: length ${total} but file is ${buf.length}`);
  const out = [];
  for (let at = 8; at < total;) {
    const len = buf.readUInt32BE(at + 4);
    if (len < 8 || at + len > total) throw new Error('icns: bad block length');
    out.push({ type: buf.toString('latin1', at, at + 4), data: buf.subarray(at + 8, at + len) });
    at += len;
  }
  return out;
}
