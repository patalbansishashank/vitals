/**
 * When a meal photo was taken (C1/D5-05): the JPEG's EXIF `DateTimeOriginal` with its `OffsetTimeOriginal`, as an ISO
 * instant. Without the offset the local time has no zone and is not turned into an instant (never guessed); the upload
 * time is never used. Reads only the first APP1 segment; any malformed structure returns undefined. Pure.
 */

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TYPE_ASCII = 2;
/** Bytes read from the head of the image: EXIF sits in APP1 within the first 64 KiB of a JPEG. */
export const EXIF_HEAD_BYTES = 128 * 1024;

function ascii(view: DataView, at: number, count: number): string {
  let s = '';
  for (let i = 0; i < count && at + i < view.byteLength; i++) {
    const c = view.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** ASCII tag values of one IFD (tag → string) and the Exif sub-IFD pointer, if any. */
function readIfd(view: DataView, tiff: number, offset: number, le: boolean): { strings: Map<number, string>; exifIfd?: number } {
  const strings = new Map<number, string>();
  let exifIfd: number | undefined;
  const at = tiff + offset;
  if (at + 2 > view.byteLength) return { strings };
  const n = view.getUint16(at, le);
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    const tag = view.getUint16(e, le);
    const type = view.getUint16(e + 2, le);
    const count = view.getUint32(e + 4, le);
    if (tag === TAG_EXIF_IFD) exifIfd = view.getUint32(e + 8, le);
    else if (type === TYPE_ASCII && (tag === TAG_DATETIME_ORIGINAL || tag === TAG_OFFSET_TIME_ORIGINAL)) {
      const valueAt = count <= 4 ? e + 8 : tiff + view.getUint32(e + 8, le);
      strings.set(tag, ascii(view, valueAt, count));
    }
  }
  return exifIfd !== undefined ? { strings, exifIfd } : { strings };
}

/** `2026:10:18 07:30:00` + `+05:30` → `2026-10-18T07:30:00+05:30`; undefined when either is missing or malformed. */
export function exifInstant(dateTimeOriginal: string | undefined, offsetTimeOriginal: string | undefined): string | undefined {
  const d = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec((dateTimeOriginal ?? '').trim());
  const o = /^([+-])(\d{2}):(\d{2})$/.exec((offsetTimeOriginal ?? '').trim());
  if (!d || !o) return undefined;
  const iso = `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}${o[1]}${o[2]}:${o[3]}`;
  return Number.isFinite(Date.parse(iso)) ? iso : undefined;
}

/** The capture instant of a JPEG from its bytes (see the module note), or undefined. */
export function exifCapturedAt(bytes: ArrayBuffer): string | undefined {
  const view = new DataView(bytes);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return undefined;
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) return undefined;
    const marker = view.getUint8(p + 1);
    const len = view.getUint16(p + 2);
    if (marker === 0xda || marker === 0xd9 || len < 2) return undefined; // start of scan / end: no EXIF before the image data
    if (marker === 0xe1 && p + 10 <= view.byteLength && ascii(view, p + 4, 4) === 'Exif') {
      const tiff = p + 10;
      if (tiff + 8 > view.byteLength) return undefined;
      const order = view.getUint16(tiff);
      if (order !== 0x4949 && order !== 0x4d4d) return undefined;
      const le = order === 0x4949;
      const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, le), le);
      const exif = ifd0.exifIfd !== undefined ? readIfd(view, tiff, ifd0.exifIfd, le).strings : new Map<number, string>();
      return exifInstant(exif.get(TAG_DATETIME_ORIGINAL), exif.get(TAG_OFFSET_TIME_ORIGINAL));
    }
    p += 2 + len;
  }
  return undefined;
}

/** The capture instant of an image blob (JPEG EXIF only), or undefined; never throws. */
export async function blobCapturedAt(blob: Blob): Promise<string | undefined> {
  try {
    const head = typeof blob.slice === 'function' ? blob.slice(0, EXIF_HEAD_BYTES) : blob;
    if (typeof head.arrayBuffer !== 'function') return undefined;
    return exifCapturedAt(await head.arrayBuffer());
  } catch {
    return undefined;
  }
}
