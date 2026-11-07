/**
 * C1/D5-05 + D6-01: a meal photo's capture time comes from its own EXIF DateTimeOriginal with OffsetTimeOriginal (never
 * the upload time, never a zone-less guess), and a label's carbohydrate basis passes through only when stated.
 */
import { describe, expect, it } from 'vitest';
import { blobCapturedAt, exifCapturedAt, exifInstant } from '../exif';
import { normalizeRecognition } from '../vision';

/** A minimal JPEG: SOI, APP1 Exif (big-endian TIFF, IFD0 → Exif IFD with the two ASCII tags), SOS. */
function jpegWithExif(dateTime: string, offset: string | null): ArrayBuffer {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat([0]);
  const dt = ascii(dateTime); // 20 bytes
  const off = offset ? ascii(offset) : []; // 7 bytes
  const tiff: number[] = [];
  const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
  const u32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  // header: MM, 42, IFD0 at 8
  tiff.push(0x4d, 0x4d, ...u16(42), ...u32(8));
  // IFD0 (1 entry) at 8: ExifIFD pointer → 26
  const exifAt = 8 + 2 + 12 + 4;
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt), ...u32(0));
  // Exif IFD at 26
  const n = offset ? 2 : 1;
  const dataAt = exifAt + 2 + n * 12 + 4;
  tiff.push(...u16(n), ...u16(0x9003), ...u16(2), ...u32(dt.length), ...u32(dataAt));
  if (offset) tiff.push(...u16(0x9011), ...u16(2), ...u32(off.length), ...u32(dataAt + dt.length));
  tiff.push(...u32(0), ...dt, ...off);
  const app1 = [...ascii('Exif'), 0, ...tiff];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, ...u16(app1.length + 2), ...app1, 0xff, 0xda, 0x00, 0x02];
  return new Uint8Array(bytes).buffer;
}

describe('EXIF capture time (C1)', () => {
  it('reads DateTimeOriginal with its offset as an instant', () => {
    expect(exifCapturedAt(jpegWithExif('2026:10:18 07:30:00', '+05:30'))).toBe('2026-10-18T07:30:00+05:30');
  });

  it('a local time without an offset is not turned into an instant; non-JPEG bytes give nothing', () => {
    expect(exifCapturedAt(jpegWithExif('2026:10:18 07:30:00', null))).toBeUndefined();
    expect(exifCapturedAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeUndefined();
    expect(exifInstant('2026:13:40 99:00:00', '+05:30')).toBeUndefined();
  });

  it('reads a blob head and never throws', async () => {
    expect(await blobCapturedAt(new Blob([jpegWithExif('2026:10:18 21:05:00', '-04:00')], { type: 'image/jpeg' }))).toBe('2026-10-18T21:05:00-04:00');
    expect(await blobCapturedAt(new Blob(['not an image']))).toBeUndefined();
  });
});

describe('photo label carbohydrate basis (D6-01)', () => {
  const reply = (extra: Record<string, unknown>) => ({ saw: 'a bar', confidence: 0.9, components: [{ name: 'bar', grams: 40, gramsLow: 35, gramsHigh: 45, confidence: 0.9 }], ...extra });

  it('passes a stated basis through with the label, drops anything else', () => {
    expect(normalizeRecognition(reply({ labelPer100g: { energyKcal: 400, carbG: 60 }, labelCarbBasis: 'available' })).labelCarbBasis).toBe('available');
    expect(normalizeRecognition(reply({ labelPer100g: { energyKcal: 400, carbG: 60 }, labelCarbBasis: 'net' })).labelCarbBasis).toBeUndefined();
    expect(normalizeRecognition(reply({ labelCarbBasis: 'available' })).labelCarbBasis).toBeUndefined();
  });
});

describe('photo identity alternatives (D6-06)', () => {
  const comp = (extra: Record<string, unknown>) => ({ saw: 'rice', confidence: 0.6, components: [{ name: 'rice', grams: 150, gramsLow: 120, gramsHigh: 190, confidence: 0.6, ...extra }] });
  const known = (id: string) => ['rice-white', 'rice-basmati', 'rice-brown'].includes(id);

  it('keeps known candidate ids the model could not tell apart, never the pick itself or an unknown id', () => {
    const r = normalizeRecognition(comp({ foodId: 'rice-white', alternatives: ['rice-basmati', 'rice-white', 'made-up', 'rice-brown', 'rice-basmati'] }), known);
    expect(r.components[0]).toMatchObject({ foodId: 'rice-white', alternatives: ['rice-basmati', 'rice-brown'] });
  });
  it('no alternatives without a pick, and none when the list is empty', () => {
    expect(normalizeRecognition(comp({ alternatives: ['rice-basmati'] }), known).components[0]!.alternatives).toBeUndefined();
    expect(normalizeRecognition(comp({ foodId: 'rice-white', alternatives: [] }), known).components[0]!.alternatives).toBeUndefined();
  });
});
