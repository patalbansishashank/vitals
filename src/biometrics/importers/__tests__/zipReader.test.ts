import { describe, expect, it } from 'vitest';
import { listZip, readZipEntry } from '../zipReader';
import { createHealthConnectImporter } from '../healthConnect';

function storedZip(name: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const nm = new TextEncoder().encode(name);
  const lh = new Uint8Array(30 + nm.length);
  const lv = new DataView(lh.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nm.length, true);
  lh.set(nm, 30);
  const cd = new Uint8Array(46 + nm.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nm.length, true);
  cd.set(nm, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, lh.length + data.length, true);
  return new Uint8Array([...lh, ...data, ...cd, ...eocd]);
}

describe('zipReader', () => {
  it('reads a stored entry', async () => {
    const zip = new Blob([storedZip('a/health_connect_export.db', new Uint8Array([1, 2, 3]))]);
    const [e] = await listZip(zip);
    expect(e?.name).toBe('a/health_connect_export.db');
    expect(Array.from(await readZipEntry(zip, e!))).toEqual([1, 2, 3]);
  });
  it('imports a JSON dump from inside a zip', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ tables: { steps_record_table: [{ start_time: 1_790_000_000_000, start_zone_offset: 0, count: 7 }] } }));
    const zip = new Blob([storedZip('export.json', json)]);
    const out = [];
    const ctx = { tz: 'UTC', now: '2026-10-01T00:00:00.000Z', signal: new AbortController().signal, onProgress: () => {} };
    for await (const b of createHealthConnectImporter().run(zip, ctx)) out.push(...b.records);
    expect(out[0]).toMatchObject({ kind: 'daily', steps: 7 });
  });
});
