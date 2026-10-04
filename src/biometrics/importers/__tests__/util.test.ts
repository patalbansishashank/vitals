import { describe, expect, it } from 'vitest';
import { batchRecords, isoUtc, localDateOf, makeBatch, readLines, readText, tzOffsetSeconds } from '../util';
import type { BioRecord } from '../../core/types';

describe('importer util', () => {
  it('tz offsets honour DST', () => {
    expect(tzOffsetSeconds(Date.parse('2026-01-15T12:00:00Z'), 'Europe/Berlin')).toBe(3600);
    expect(tzOffsetSeconds(Date.parse('2026-07-15T12:00:00Z'), 'Europe/Berlin')).toBe(7200);
    expect(tzOffsetSeconds(Date.parse('2026-07-15T12:00:00Z'), 'Asia/Kolkata')).toBe(19800);
    expect(tzOffsetSeconds(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-14400);
    expect(tzOffsetSeconds(0, 'UTC')).toBe(0);
  });
  it('local date crosses midnight by zone', () => {
    const t = Date.parse('2026-03-10T23:30:00Z');
    expect(localDateOf(t, 'UTC')).toBe('2026-03-10');
    expect(localDateOf(t, 'Asia/Kolkata')).toBe('2026-03-11');
    expect(localDateOf(t, 'America/Los_Angeles')).toBe('2026-03-10');
    expect(isoUtc(t)).toBe('2026-03-10T23:30:00.000Z');
  });
  it('reads lines streaming, CRLF, BOM, no trailing newline', async () => {
    const b = new Blob(['﻿a,b\r\n\r\nc,d\ne,f']);
    const out: string[] = [];
    for await (const l of readLines(b)) out.push(l);
    expect(out).toEqual(['a,b', 'c,d', 'e,f']);
    expect(await readText(b)).toBe('a,b\r\n\r\nc,d\ne,f');
  });
  it('aborts', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(async () => {
      for await (const l of readLines(new Blob(['x\ny']), ac.signal)) void l;
    }).rejects.toBeDefined();
  });
  it('batches', async () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({ record_id: String(i) }) as unknown as BioRecord);
    const sizes: number[] = [];
    for await (const b of batchRecords(recs, 2)) sizes.push(b.length);
    expect(sizes).toEqual([2, 2, 1]);
    expect(makeBatch(recs, { producer: { name: 'p', version: '1' }, tz: 'UTC', exportedAt: 'x' }).schema).toBe('vitals.biometrics/1');
  });
});
