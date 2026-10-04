import { describe, expect, it } from 'vitest';
import { chunkIdFor, chooseScale, decodeChunk, encodeChunk, mergeSamples, seriesToSamples, splitByLocalDayAndStream } from '../chunks';
import type { RawSample, SeriesRecord } from '../types';

const T0 = Date.parse('2026-03-10T00:00:00Z');
const regular = (n: number, f: (i: number) => number, dt = 60_000): RawSample[] => Array.from({ length: n }, (_, i) => ({ t: T0 + i * dt, value: f(i), origin: 'history' as const }));

describe('chunk codec', () => {
  it('round-trips a regular Int16 series without time offsets', () => {
    const s = regular(100, (i) => 60 + (i % 40));
    const bytes = encodeChunk(s, 3600, 'hr');
    const { header, samples } = decodeChunk(bytes);
    expect(header).toEqual({ t0_ms: T0, dt_ms: 60_000, scale: 1, n: 100, tz_offset_s: 3600 });
    expect(samples).toEqual(s);
    expect(bytes.length).toBe(27 + 100 * 2 + 100);
  });
  it('round-trips an irregular series with delta times', () => {
    const s: RawSample[] = [0, 1000, 2500, 2500, 90_000].map((d, i) => ({ t: T0 + d, value: 36 + i / 100, origin: i === 3 ? 'live' : 'spot' }));
    const { header, samples } = decodeChunk(encodeChunk(s, -18000, 'skin_temp'));
    expect(header.dt_ms).toBeNull();
    expect(header.scale).toBe(100);
    expect(samples).toEqual(s);
  });
  it('uses Float32 when no scale is lossless', () => {
    const s = regular(5, (i) => 0.123456789 * (i + 1));
    const { header, samples } = decodeChunk(encodeChunk(s, 0, 'hr'));
    expect(header.scale).toBe(0);
    samples.forEach((x, i) => expect(x.value).toBeCloseTo(s[i]!.value, 6));
  });
  it('falls back to a finer scale or Float32 on overflow', () => {
    expect(chooseScale(regular(3, () => 36.55), 'hr')).toBe(100);
    expect(chooseScale(regular(3, () => 40_000), 'steps')).toBe(0);
    expect(chooseScale(regular(3, (i) => i * 0.1), 'spo2')).toBe(10);
  });
  it('keeps quality mask and origins', () => {
    const s = regular(4, (i) => 70 + i);
    s[1]!.quality = 3;
    s[2]!.origin = 'workout_stream';
    const { samples } = decodeChunk(encodeChunk(s, 0, 'hr'));
    expect(samples[1]!.quality).toBe(3);
    expect(samples[0]!.quality).toBeUndefined();
    expect(samples[2]!.origin).toBe('workout_stream');
  });
  it('handles empty and single sample chunks', () => {
    expect(decodeChunk(encodeChunk([], 0)).samples).toEqual([]);
    const one = regular(1, () => 5);
    expect(decodeChunk(encodeChunk(one, 0, 'hr')).samples).toEqual(one);
  });
  it('rejects garbage', () => {
    expect(() => decodeChunk(new Uint8Array(40))).toThrow();
  });
});

describe('mergeSamples', () => {
  it('dedupes by (origin, t), sorts, and honours tombstones', () => {
    const a = regular(3, (i) => 60 + i);
    const incoming: RawSample[] = [
      { t: a[1]!.t, value: 99, origin: 'history' }, // dup, existing wins
      { t: a[1]!.t, value: 61, origin: 'live' }, // different origin: new
      { t: T0 + 10 * 60_000, value: 70, origin: 'history' },
      { t: T0 + 10 * 60_000, value: 70, origin: 'history' }, // dup within incoming
      { t: T0 + 20 * 60_000, value: 80, origin: 'history' }, // tombstoned
    ];
    const r = mergeSamples(a, incoming, [{ origin: 'history', t: T0 + 20 * 60_000 }, { origin: 'history', t: a[2]!.t }]);
    expect(r.added).toBe(2);
    expect(r.duplicates).toBe(2);
    expect(r.tombstoned).toBe(1);
    expect(r.samples.map((s) => s.t)).toEqual([T0, T0 + 60_000, T0 + 60_000, T0 + 600_000]);
    expect(r.samples.find((s) => s.t === a[1]!.t && s.origin === 'history')!.value).toBe(61);
    const again = mergeSamples(r.samples, incoming);
    expect(again.added).toBe(1); // only the previously tombstoned one without a tombstone list
  });
});

describe('splitting', () => {
  it('groups by local day from the tz offset', () => {
    const s: RawSample[] = [Date.parse('2026-03-10T18:00:00Z'), Date.parse('2026-03-10T23:30:00Z')].map((t) => ({ t, value: 70, origin: 'import' as const }));
    const g = splitByLocalDayAndStream([{ sourceKey: 'x', stream: 'hr', tz_offset_s: 19800, samples: s }]);
    expect(g.map((x) => x.key.local_date)).toEqual(['2026-03-10', '2026-03-11']);
    expect(g[0]!.samples).toHaveLength(1);
  });
  it('splits by UTC hour when over the limit', () => {
    const s = regular(3 * 3600, (i) => 60 + (i % 7), 1000);
    const day = splitByLocalDayAndStream([{ sourceKey: 'x', stream: 'hr', tz_offset_s: 0, samples: s }]);
    expect(day).toHaveLength(1);
    const hours = splitByLocalDayAndStream([{ sourceKey: 'x', stream: 'hr', tz_offset_s: 0, samples: s }], 8000);
    expect(hours.map((h) => h.key.hourStartUtc)).toEqual(['2026-03-10T00:00:00.000Z', '2026-03-10T01:00:00.000Z', '2026-03-10T02:00:00.000Z']);
    expect(hours.every((h) => h.key.local_date === '2026-03-10')).toBe(true);
  });
  it('expands series records', () => {
    const rec = {
      kind: 'series', metric: 'hr', unit: 'bpm', aggregation: 'sample', interval_s: 60, sampling: { mode: 'continuous' }, values: [60, 61, 62], quality_mask: [0, 2, 0],
      time: { start: '2026-03-10T00:00:00.000Z', tz_offset_s: 0, local_date: '2026-03-10' },
    } as unknown as SeriesRecord;
    const s = seriesToSamples(rec);
    expect(s.map((x) => x.t - T0)).toEqual([0, 60_000, 120_000]);
    expect(s[1]!.quality).toBe(2);
  });
});

describe('chunkIdFor', () => {
  it('is 22 url-safe chars and depends on every part', () => {
    const k = { sourceKey: 's', stream: 'hr' as const, local_date: '2026-03-10' };
    const id = chunkIdFor(k, 'abc');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(chunkIdFor(k, 'abd')).not.toBe(id);
    expect(chunkIdFor({ ...k, hourStartUtc: 'h' }, 'abc')).not.toBe(id);
    expect(chunkIdFor(k, 'abc')).toBe(id);
  });
});
