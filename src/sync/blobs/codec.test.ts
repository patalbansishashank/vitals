import { decodeChunk, decodeSamples, encodeChunk, encodeSamples } from './codec';

const H = Date.UTC(2026, 9, 1, 14);

describe('blob codec', () => {
  it('round-trips a regular series without storing time deltas', async () => {
    const t = Array.from({ length: 60 }, (_, i) => H + i * 60_000);
    const v = t.map((_, i) => 60 + (i % 7));
    const raw = encodeSamples({ t, v });
    expect(raw[0]).toBe(1);
    expect(raw.length).toBe(21 + 4 * 60);
    const out = await decodeChunk(await encodeChunk({ t, v }));
    expect([...out.t]).toEqual(t);
    expect([...out.v]).toEqual(v);
  });

  it('round-trips irregular timestamps, negative values and a scale', () => {
    const t = [H, H + 1, H + 1000, H + 1003, H + 3_599_999];
    const v = [-12.5, 0, 36.6, -0.1, 1234.5];
    const raw = encodeSamples({ t, v }, 10);
    expect(raw.length).toBe(21 + 4 * 4 + 4 * 5);
    const out = decodeSamples(raw);
    expect([...out.t]).toEqual(t);
    expect([...out.v]).toEqual(v);
  });

  it('quantises to the scale', () => {
    const out = decodeSamples(encodeSamples({ t: [H, H + 5], v: [1.26, 1.24] }, 10));
    expect([...out.v]).toEqual([1.3, 1.2]);
  });

  it('keeps a single sample', () => {
    const out = decodeSamples(encodeSamples({ t: [H], v: [42] }));
    expect([...out.t]).toEqual([H]);
    expect([...out.v]).toEqual([42]);
  });

  it('rejects bad input', () => {
    expect(() => encodeSamples({ t: [], v: [] })).toThrow(/at least one/);
    expect(() => encodeSamples({ t: [H, H + 1], v: [1] })).toThrow(/mismatch/);
    expect(() => encodeSamples({ t: [H, H + 1], v: [1, NaN] })).toThrow(/finite/);
    expect(() => encodeSamples({ t: [H, H + 1], v: [1, Infinity] })).toThrow(/finite/);
    expect(() => encodeSamples({ t: [H + 1, H], v: [1, 2] })).toThrow(/increasing/);
    expect(() => encodeSamples({ t: [H, H], v: [1, 2] })).toThrow(/increasing/);
    expect(() => encodeSamples({ t: [H, H + 0.5], v: [1, 2] })).toThrow(/integer/);
    expect(() => encodeSamples({ t: [H, NaN], v: [1, 2] })).toThrow(/integer/);
    expect(() => encodeSamples({ t: [H], v: [1e10] })).toThrow(/Int32/);
    expect(() => encodeSamples({ t: [H], v: [1] }, 0)).toThrow(/scale/);
  });

  it('rejects corrupt bytes', () => {
    const raw = encodeSamples({ t: [H, H + 7, H + 9], v: [1, 2, 3] });
    expect(() => decodeSamples(raw.subarray(0, raw.length - 1))).toThrow(/length/);
    const bad = raw.slice();
    bad[0] = 9;
    expect(() => decodeSamples(bad)).toThrow(/version/);
  });

  it('packs one day of 1-min heart rate small', async () => {
    const t = Array.from({ length: 1440 }, (_, i) => H + i * 60_000);
    let hr = 62;
    const v = t.map((_, i) => (hr = Math.max(45, Math.min(160, hr + (((i * 7919) % 5) - 2)))));
    const gz = await encodeChunk({ t, v });
    expect(gz.length).toBeLessThan(2 * 1024);
    const out = await decodeChunk(gz);
    expect([...out.v]).toEqual(v);
  });
});
