// Windows .ico container with PNG payloads (Vista and later read PNG entries at every size).
// Layout: ICONDIR (6 bytes), one ICONDIRENTRY (16 bytes) per image, then the PNG files back to back.

/**
 * @param {{ size: number, png: Buffer }[]} images square images, smallest first
 * @returns {Buffer}
 */
export function encodeIco(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type 1 = icon
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    if (size < 1 || size > 256) throw new Error(`ico: size ${size} out of range`);
    const e = 6 + 16 * i;
    head.writeUInt8(size === 256 ? 0 : size, e); // width, 0 means 256
    head.writeUInt8(size === 256 ? 0 : size, e + 1); // height
    head.writeUInt8(0, e + 2); // no palette
    head.writeUInt8(0, e + 3); // reserved
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((im) => im.png)]);
}

/**
 * Reads an .ico back into its entries (used by the asset tests).
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, data: Buffer }[]}
 */
export function decodeIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('ico: bad header');
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const e = 6 + 16 * i;
    const len = buf.readUInt32LE(e + 8);
    const at = buf.readUInt32LE(e + 12);
    return {
      width: buf.readUInt8(e) || 256,
      height: buf.readUInt8(e + 1) || 256,
      data: buf.subarray(at, at + len),
    };
  });
}
