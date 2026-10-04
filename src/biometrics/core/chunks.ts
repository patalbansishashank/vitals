/**
 * Raw sample chunk codec (SUITE_SPEC §4.2; tier P, pure, deterministic).
 *
 * Layout (little endian):
 *   u8 magic 0xB1 | u8 format 1 | u8 flags (bit0 regular, bit1 int16, bit2 quality mask)
 *   f64 t0_ms | u32 dt_ms (0 when irregular) | f32 scale (0 = Float32 values) | u32 n | i32 tz_offset_s
 *   [irregular] i32 x (n-1): delta of each sample time from the previous one, ms
 *   values: i16 x n (round(value*scale)) or f32 x n
 *   u8 x n origin index into SAMPLE_ORIGINS
 *   [mask] u8 x n quality (clamped 0..255)
 * Gzip (CompressionStream) and the blob AEAD are applied outside this module (store / E11 path); sizes here are therefore
 * UNcompressed and the 256 KB split limit is applied to the uncompressed size (conservative).
 * A sample with quality 0 decodes without a `quality` property.
 */
import { sha256, sha256Hex, toBase64Url, utf8 } from './hash';
import { SAMPLE_ORIGINS } from './types';
import type { BioStream, ChunkHeader, ChunkKey, RawSample, SampleOrigin, SeriesRecord } from './types';

const MAGIC = 0xb1;
const FORMAT = 1;
const HEADER_BYTES = 3 + 8 + 4 + 4 + 4 + 4;

/** Uncompressed split threshold per chunk (spec: 256 KB compressed; see file doc). */
export const MAX_CHUNK_BYTES = 256 * 1024;

/** Preferred Int16 scale per stream (values stored as round(v*scale)); chosen from sensor resolution:
 * hr/ibi whole bpm/ms, spo2 and resp 0.1, skin/body temperature 0.01 degC (PROPOSED engineering defaults). */
export const DEFAULT_SCALE: Readonly<Record<string, number>> = {
  hr: 1, ibi: 1, hrv: 10, spo2: 10, skin_temp: 100, body_temp: 100, resp_rate: 10, steps: 1, distance: 1, active_kcal: 10, motion: 1, sleep_state: 1, sleep_stage: 1,
};

const originIndex = new Map<SampleOrigin, number>(SAMPLE_ORIGINS.map((o, i) => [o, i]));

/** Identity of a sample inside a source+stream: `${origin}|${t}`. */
export function sampleKey(origin: SampleOrigin, t: number): string {
  return `${origin}|${t}`;
}

function compareSamples(a: RawSample, b: RawSample): number {
  return a.t - b.t || (originIndex.get(a.origin) ?? 0) - (originIndex.get(b.origin) ?? 0);
}

function fitsInt16(samples: readonly RawSample[], scale: number): boolean {
  for (const s of samples) {
    const x = s.value * scale;
    const r = Math.round(x);
    if (!Number.isFinite(x) || Math.abs(x - r) > 1e-6 || r > 32767 || r < -32768) return false;
    // decode is r / scale; require it to reproduce the input exactly
    if (r / scale !== s.value) return false;
  }
  return true;
}

/** Picks the Int16 scale for these samples (stream default first, then 1/10/100/1000); 0 means Float32. */
export function chooseScale(samples: readonly RawSample[], stream?: BioStream): number {
  const first = stream !== undefined ? DEFAULT_SCALE[stream] : undefined;
  const ladder = [...(first !== undefined ? [first] : []), 1, 10, 100, 1000];
  for (const sc of new Set(ladder)) if (fitsInt16(samples, sc)) return sc;
  return 0;
}

/** Encodes samples (any order; sorted here) into a chunk. Duplicates are not removed: use mergeSamples first. */
export function encodeChunk(samples: readonly RawSample[], tzOffsetS: number, stream?: BioStream): Uint8Array {
  const s = [...samples].sort(compareSamples);
  const n = s.length;
  const t0 = n > 0 ? s[0]!.t : 0;
  let regular = n >= 2;
  const dt = n >= 2 ? s[1]!.t - s[0]!.t : 0;
  for (let i = 1; i < n && regular; i++) if (s[i]!.t - s[i - 1]!.t !== dt) regular = false;
  if (dt <= 0 || dt > 0xffffffff) regular = false;
  const scale = chooseScale(s, stream);
  const hasQ = s.some((x) => (x.quality ?? 0) !== 0);
  const vBytes = scale > 0 ? 2 : 4;
  const size = HEADER_BYTES + (regular || n === 0 ? 0 : (n - 1) * 4) + n * vBytes + n + (hasQ ? n : 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = MAGIC;
  out[1] = FORMAT;
  out[2] = (regular ? 1 : 0) | (scale > 0 ? 2 : 0) | (hasQ ? 4 : 0);
  dv.setFloat64(3, t0, true);
  dv.setUint32(11, regular ? dt : 0, true);
  dv.setFloat32(15, scale, true);
  dv.setUint32(19, n, true);
  dv.setInt32(23, tzOffsetS, true);
  let p = HEADER_BYTES;
  if (!regular) {
    for (let i = 1; i < n; i++) {
      const d = s[i]!.t - s[i - 1]!.t;
      if (d > 0x7fffffff) throw new RangeError('chunk time gap exceeds Int32 milliseconds; split the chunk');
      dv.setInt32(p, d, true);
      p += 4;
    }
  }
  for (const x of s) {
    if (scale > 0) {
      dv.setInt16(p, Math.round(x.value * scale), true);
      p += 2;
    } else {
      dv.setFloat32(p, x.value, true);
      p += 4;
    }
  }
  for (const x of s) out[p++] = originIndex.get(x.origin) ?? 0;
  if (hasQ) for (const x of s) out[p++] = Math.max(0, Math.min(255, Math.round(x.quality ?? 0)));
  return out;
}

export function decodeChunk(bytes: Uint8Array): { header: ChunkHeader; samples: RawSample[] } {
  if (bytes.length < HEADER_BYTES || bytes[0] !== MAGIC) throw new Error('not a biometrics chunk');
  if (bytes[1] !== FORMAT) throw new Error(`unsupported chunk format ${bytes[1]}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[2]!;
  const regular = (flags & 1) !== 0;
  const int16 = (flags & 2) !== 0;
  const hasQ = (flags & 4) !== 0;
  const t0 = dv.getFloat64(3, true);
  const dtRaw = dv.getUint32(11, true);
  const scale = dv.getFloat32(15, true);
  const n = dv.getUint32(19, true);
  const tz = dv.getInt32(23, true);
  const header: ChunkHeader = { t0_ms: t0, dt_ms: regular ? dtRaw : null, scale: int16 ? scale : 0, n, tz_offset_s: tz };
  const vBytes = int16 ? 2 : 4;
  const need = HEADER_BYTES + (regular || n === 0 ? 0 : (n - 1) * 4) + n * vBytes + n + (hasQ ? n : 0);
  if (bytes.length < need) throw new Error('truncated chunk');
  const ts: number[] = new Array<number>(n);
  let p = HEADER_BYTES;
  if (n > 0) ts[0] = t0;
  for (let i = 1; i < n; i++) {
    if (regular) ts[i] = t0 + i * dtRaw;
    else {
      ts[i] = ts[i - 1]! + dv.getInt32(p, true);
      p += 4;
    }
  }
  const vals: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (int16) {
      vals[i] = dv.getInt16(p, true) / scale;
      p += 2;
    } else {
      vals[i] = dv.getFloat32(p, true);
      p += 4;
    }
  }
  const samples: RawSample[] = new Array<RawSample>(n);
  for (let i = 0; i < n; i++) samples[i] = { t: ts[i]!, value: vals[i]!, origin: SAMPLE_ORIGINS[bytes[p + i]!] ?? 'import' };
  p += n;
  if (hasQ) {
    for (let i = 0; i < n; i++) {
      const q = bytes[p + i]!;
      if (q !== 0) samples[i]!.quality = q;
    }
  }
  return { header, samples };
}

/** min/max of the values (0/0 for an empty list). */
export function chunkStats(samples: readonly RawSample[]): { n: number; min: number; max: number } {
  if (samples.length === 0) return { n: 0, min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
  }
  return { n: samples.length, min, max };
}

export interface Tombstone {
  origin: SampleOrigin;
  t: number;
}

export interface MergeResult {
  samples: RawSample[];
  /** Incoming samples that were new. */
  added: number;
  /** Incoming samples already present (in existing or repeated within incoming). */
  duplicates: number;
  /** Incoming samples dropped because they were tombstoned. */
  tombstoned: number;
}

/** Union by identity (origin, t); existing wins on conflict; tombstoned samples removed from both sides; sorted by t. */
export function mergeSamples(existing: readonly RawSample[], incoming: readonly RawSample[], tombstones: Iterable<Tombstone> = []): MergeResult {
  const dead = new Set<string>();
  for (const t of tombstones) dead.add(sampleKey(t.origin, t.t));
  const seen = new Map<string, RawSample>();
  for (const s of existing) {
    const k = sampleKey(s.origin, s.t);
    if (!dead.has(k) && !seen.has(k)) seen.set(k, s);
  }
  let added = 0;
  let duplicates = 0;
  let tombstoned = 0;
  for (const s of incoming) {
    const k = sampleKey(s.origin, s.t);
    if (dead.has(k)) tombstoned++;
    else if (seen.has(k)) duplicates++;
    else {
      seen.set(k, s);
      added++;
    }
  }
  return { samples: [...seen.values()].sort(compareSamples), added, duplicates, tombstoned };
}

// ---------------------------------------------------------------- splitting

/** LocalDate of an epoch-ms instant under a fixed UTC offset in seconds. */
export function localDateAt(tMs: number, tzOffsetS: number): string {
  return new Date(tMs + tzOffsetS * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DDTHH:00:00.000Z' of the UTC hour containing tMs. */
export function utcHourStart(tMs: number): string {
  return new Date(Math.floor(tMs / 3_600_000) * 3_600_000).toISOString();
}

export interface SampleGroup {
  key: ChunkKey;
  tz_offset_s: number;
  samples: RawSample[];
}

/** Groups samples into chunk keys by (source, stream, local date from the tz offset). A group whose encoded size would
 * exceed `maxBytes` is split by UTC hour (key.hourStartUtc set). Output is sorted by key. */
export function splitByLocalDayAndStream(
  items: ReadonlyArray<{ sourceKey: string; stream: BioStream; tz_offset_s: number; samples: readonly RawSample[] }>,
  maxBytes: number = MAX_CHUNK_BYTES,
): SampleGroup[] {
  const days = new Map<string, SampleGroup>();
  for (const it of items) {
    for (const s of it.samples) {
      const date = localDateAt(s.t, it.tz_offset_s);
      const id = `${it.sourceKey}\u0000${it.stream}\u0000${date}`;
      let g = days.get(id);
      if (!g) {
        g = { key: { sourceKey: it.sourceKey, stream: it.stream, local_date: date }, tz_offset_s: it.tz_offset_s, samples: [] };
        days.set(id, g);
      }
      g.samples.push(s);
    }
  }
  const out: SampleGroup[] = [];
  for (const g of days.values()) {
    g.samples.sort(compareSamples);
    if (encodeChunk(g.samples, g.tz_offset_s, g.key.stream).length <= maxBytes) {
      out.push(g);
      continue;
    }
    const hours = new Map<string, RawSample[]>();
    for (const s of g.samples) {
      const h = utcHourStart(s.t);
      const arr = hours.get(h);
      if (arr) arr.push(s);
      else hours.set(h, [s]);
    }
    for (const [h, samples] of hours) out.push({ key: { ...g.key, hourStartUtc: h }, tz_offset_s: g.tz_offset_s, samples });
  }
  return out.sort((a, b) => chunkKeyString(a.key).localeCompare(chunkKeyString(b.key)));
}

export function chunkKeyString(k: ChunkKey): string {
  return `${k.sourceKey}\u0000${k.stream}\u0000${k.local_date}\u0000${k.hourStartUtc ?? ''}`;
}

/** Samples of a wire series record: `time.start + t_offset_s[i]` (or `i * interval_s`); quality_mask carried over. */
export function seriesToSamples(rec: SeriesRecord, origin: SampleOrigin = 'import'): RawSample[] {
  const t0 = Date.parse(rec.time.start ?? rec.time.at ?? '');
  if (Number.isNaN(t0)) return [];
  const step = (rec.interval_s ?? rec.sampling.nominal_interval_s ?? 0) * 1000;
  return rec.values.map((value, i) => {
    const s: RawSample = { t: Math.round(t0 + (rec.t_offset_s ? rec.t_offset_s[i]! * 1000 : i * step)), value, origin };
    const q = rec.quality_mask?.[i];
    if (q) s.quality = q;
    return s;
  });
}

// ---------------------------------------------------------------- ids

/** Placeholder chunk id: base64url(sha256(source || stream || date || hour || contentHash))[0..22].
 * E11 REPLACES this with HMAC(K_blobid, ...) so ids do not leak content; this is the only place the id is derived. */
export function chunkIdFor(key: ChunkKey, contentHash: string): string {
  return toBase64Url(sha256(utf8(`${chunkKeyString(key)}\u0000${contentHash}`))).slice(0, 22);
}

/** Hex SHA-256 of the encoded chunk bytes. */
export function contentHashOf(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}
