/**
 * Shared importer helpers (tier H: Intl and Blob streams allowed, no DOM). Importers for every channel use these so
 * time-zone handling and batching behave identically.
 */
import { BIO_SCHEMA } from '../core/types';
import type { BioBatch, BioRecord } from '../core/types';

export { fractionToPct, fahrenheitToC, kjToKcal, kmToM, milesToM, lbToKg } from '../core/validate';

/** Whole Blob as text (UTF-8; a BOM is stripped). */
export async function readText(blob: Blob): Promise<string> {
  const s = await blob.text();
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Streams a Blob line by line without holding it in memory (CRLF and LF; blank lines are skipped). Throws the signal's
 * reason when aborted. */
export async function* readLines(blob: Blob, signal?: AbortSignal): AsyncIterable<string> {
  signal?.throwIfAborted();
  const dec = new TextDecoder('utf-8');
  let first = true;
  let carry = '';
  const emit = function* (text: string): Generator<string> {
    carry += text;
    let i: number;
    while ((i = carry.indexOf('\n')) >= 0) {
      let line = carry.slice(0, i);
      carry = carry.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (first) {
        first = false;
        if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      }
      if (line.length > 0) yield line;
    }
  };
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        yield* emit(dec.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    yield* emit(await blob.text());
  }
  yield* emit(dec.decode());
  let rest = carry.endsWith('\r') ? carry.slice(0, -1) : carry;
  if (first && rest.charCodeAt(0) === 0xfeff) rest = rest.slice(1);
  if (rest.length > 0) yield rest;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function partsOf(epochMs: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const o: Record<string, number> = {};
  for (const p of fmtFor(tz).formatToParts(new Date(Math.floor(epochMs / 1000) * 1000))) {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
  }
  return { y: o.year ?? 1970, mo: o.month ?? 1, d: o.day ?? 1, h: (o.hour ?? 0) % 24, mi: o.minute ?? 0, s: o.second ?? 0 };
}

/** UTC offset of an IANA zone at an instant, seconds east of UTC (DST aware). 'UTC' and unknown-free zones give 0. */
export function tzOffsetSeconds(epochMs: number, tz: string): number {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  const p = partsOf(epochMs, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 1000);
}

/** 'YYYY-MM-DD' of an instant in an IANA zone. */
export function localDateOf(epochMs: number, tz: string): string {
  const p = partsOf(epochMs, tz);
  return `${String(p.y).padStart(4, '0')}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** ISO-8601 UTC with 'Z' and millisecond precision. */
export function isoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Wraps records in a canonical batch. */
export function makeBatch(records: BioRecord[], opts: { producer: { name: string; version: string }; tz: string; exportedAt: string }): BioBatch {
  return { schema: BIO_SCHEMA, producer: opts.producer, exported_at: opts.exportedAt, tz: opts.tz, records };
}

/** Groups a (possibly async) record stream into arrays of at most `size` records. */
export async function* batchRecords(iter: Iterable<BioRecord> | AsyncIterable<BioRecord>, size: number): AsyncGenerator<BioRecord[]> {
  const n = Math.max(1, Math.floor(size));
  let cur: BioRecord[] = [];
  for await (const r of iter) {
    cur.push(r);
    if (cur.length >= n) {
      yield cur;
      cur = [];
    }
  }
  if (cur.length > 0) yield cur;
}
