/** Test-only: builds a one-entry ZIP (stored or deflate-raw). CRC is left 0 (readers here do not verify it). */
export async function zipOne(name: string, data: Uint8Array, method: 0 | 8): Promise<Blob> {
  let body = data;
  if (method === 8) {
    const cs = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    body = new Uint8Array(await new Response(cs).arrayBuffer());
  }
  const nameB = new TextEncoder().encode(name);
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true);
  lh.setUint16(4, 20, true);
  lh.setUint16(8, method, true);
  lh.setUint32(18, body.length, true);
  lh.setUint32(22, data.length, true);
  lh.setUint16(26, nameB.length, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true);
  cd.setUint16(4, 20, true);
  cd.setUint16(6, 20, true);
  cd.setUint16(10, method, true);
  cd.setUint32(20, body.length, true);
  cd.setUint32(24, data.length, true);
  cd.setUint16(28, nameB.length, true);
  cd.setUint32(42, 0, true);
  const cdSize = 46 + nameB.length;
  const cdOff = 30 + nameB.length + body.length;
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, 1, true);
  eo.setUint16(10, 1, true);
  eo.setUint32(12, cdSize, true);
  eo.setUint32(16, cdOff, true);
  return new Blob([lh, nameB, body as BlobPart, cd, nameB, eo]);
}
