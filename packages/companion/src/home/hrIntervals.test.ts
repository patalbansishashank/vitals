// @vitest-environment node
/**
 * `gauge_hr_intervals` (docs/SERVER.md "Heart-rate intervals"): the raw HR readings of a bounded window with each one's
 * `hr-support/1` interval, for exact zone time on the device. Paged, capped, the supports independent of the page.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hr, INSTALL, lumenEvent, workout } from './lumenFixtures.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet, type LumenToolSet } from './lumenTools.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

const TZ = 'UTC';
const NOW = Date.parse('2026-10-21T00:00:00Z');
const T0 = Date.parse('2026-10-20T07:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
/** A reading of the ring's workout stream (declared 10-s cadence). */
const workoutHr = (ms: number, bpm: number) =>
  lumenEvent('metrics/hr', 'hr', 'health.metric.observed', iso(ms), { metric: 'hr', value: bpm, unit: 'bpm', provenance: 'device_workout', quality: 'unverified' });

let dir: string;
let store: LumenStore;
let tools: LumenToolSet;
const run = async (args: Record<string, unknown>) => (await tools.call('gauge_hr_intervals', args)) as unknown as { ok: boolean; summary: string; data: Json; error?: { code: string } };

beforeAll(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'hr-intervals-'));
  store = openLumenStore(join(dir, 'lumen.db'));
  store.noteInstallation(INSTALL, { deviceName: 'Pixel 8', appVersion: '2.9.0', pairedAt: '2026-10-01T00:00:00.000Z' });
  const ev = [
    // a workout 07:00–07:01:30 with a pause 07:00:30–07:00:40; the 10-s stream: 110 for 30 s, then 170 for 60 s
    workout('w1', iso(T0 + 90_000), { start: iso(T0), end: iso(T0 + 90_000), pauses: [{ start: iso(T0 + 30_000), end: iso(T0 + 40_000) }], durationS: 90, moving_s: 80, distanceM: null, kcal: null, avgHr: 150, maxHr: 170, zones: null, steps: null, route: null }),
    ...Array.from({ length: 9 }, (_, k) => workoutHr(T0 + 5_000 + k * 10_000, k < 3 ? 110 : 170)),
    // sampled readings without a declared cadence (no support) later that day
    hr(iso(T0 + 3_600_000), 70),
    hr(iso(T0 + 3_600_000 + 900_000), 72),
  ];
  expect(store.ingest(INSTALL, ev, NOW).rejected).toEqual([]);
  tools = lumenToolSet(() => store, TZ, () => NOW);
});
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('gauge_hr_intervals', () => {
  it('each reading with its time, bpm, cadence, the next reading and its supported interval', async () => {
    const r = await run({ from: '2026-10-20T06:59', to: '2026-10-20T09:00' });
    expect(r.ok).toBe(true);
    const iv: Json = r.data.intervals;
    expect(iv).toHaveLength(11);
    expect(iv[0]).toEqual({ t: T0 + 5_000, bpm: 110, cadenceS: 10, nextT: T0 + 15_000, start: T0, end: T0 + 10_000 });
    // the pause edge (07:00:30) clips the third reading's support; the next one starts at the pause's end
    expect([iv[2].start - T0, iv[2].end - T0]).toEqual([20_000, 30_000]);
    expect([iv[3].start - T0, iv[3].end - T0]).toEqual([30_000, 40_000]);
    // the workout's end clips the last stream reading
    expect([iv[8].t - T0, iv[8].start - T0, iv[8].end - T0]).toEqual([85_000, 80_000, 90_000]);
    // undeclared cadence: no support, but the reading and its neighbour are there
    expect(iv[9]).toEqual({ t: T0 + 3_600_000, bpm: 70, cadenceS: null, nextT: T0 + 4_500_000, start: null, end: null });
    expect(iv[10].nextT).toBeNull();
    expect(r.data).toMatchObject({ count: 11, supportedS: 90, next: null, hrSupportVersion: 'hr-support/1', inputsHash: expect.stringMatching(/^sha256:/) });
    // supports never overlap
    const sup: Json = iv.filter((x: Json) => x.start !== null);
    for (let k = 1; k < sup.length; k++) expect(sup[k].start).toBeGreaterThanOrEqual(sup[k - 1].end);
  });

  it('pages with next → cursor; the supports and inputsHash do not depend on the page', async () => {
    const whole = await run({ from: '2026-10-20T06:59', to: '2026-10-20T09:00' });
    const got: Json[] = [];
    let cursor: string | null = null;
    const hashes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const p = await run({ from: '2026-10-20T06:59', to: '2026-10-20T09:00', limit: 4, ...(cursor ? { cursor } : {}) });
      got.push(...(p.data.intervals as Json[]));
      hashes.add(p.data.inputsHash);
      cursor = p.data.next;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(got).toEqual(whole.data.intervals);
    expect([...hashes]).toEqual([whole.data.inputsHash]);
  });

  it('clips supports at the window, and a date as `to` is the whole day', async () => {
    const r = await run({ from: '2026-10-20T07:00:20Z', to: '2026-10-20T07:00:50Z' });
    const iv: Json = r.data.intervals;
    expect(iv.map((x: Json) => x.t - T0)).toEqual([25_000, 35_000, 45_000]);
    expect(iv[0].start - T0).toBe(20_000);
    // a neighbour outside the window still clips at the midpoint (not returned)
    expect(iv[2].nextT - T0).toBe(55_000);
    expect((await run({ from: '2026-10-20', to: '2026-10-20' })).data.count).toBe(11);
  });

  it('bounds the window and the page; checks the cursor', async () => {
    expect((await run({ from: '2026-10-19', to: '2026-10-20' })).error?.code).toBe('invalid_input');
    expect((await run({ from: '2026-10-20T00:00', to: '2026-10-21T12:00' })).ok).toBe(true);
    expect((await run({ from: '2026-10-20T00:00', to: '2026-10-21T12:01' })).error?.code).toBe('invalid_input');
    expect((await run({ from: '2026-10-20', to: '2026-10-20', limit: 5001 })).error?.code).toBe('invalid_input');
    expect((await run({ from: '2026-10-20', to: '2026-10-20', limit: 0 })).error?.code).toBe('invalid_input');
    expect((await run({ from: '2026-10-20', to: '2026-10-20', cursor: 'abc' })).error?.code).toBe('invalid_input');
    expect((await run({ from: '2026-10-20T09:00', to: '2026-10-20T08:00' })).error?.code).toBe('invalid_input');
  });

  it('answers no data without a store', async () => {
    const t = lumenToolSet(() => null, TZ, () => NOW);
    const r = (await t.call('gauge_hr_intervals', { from: '2026-10-20', to: '2026-10-20' })) as unknown as { ok: boolean; data: Json };
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ intervals: [], count: 0, next: null });
  });
});
