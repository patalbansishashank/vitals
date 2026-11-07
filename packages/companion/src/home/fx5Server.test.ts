// @vitest-environment node
/**
 * 0.6.3 FX5 (cross-verification M18): uploaded evidence reaches its primary derivation. Gauge's GPS gives the timeline a
 * route-derived moving speed; the ring's sport telemetry becomes windows on the workouts route; Health Connect's
 * SleepSession, RestingHeartRate and Distance fill in only where the ring has none (one origin, labelled), never twice.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFusionContextStore } from './fusionContext.ts';
import { Inputs, withReadBudget, ReadBudgetError } from './gaugeDerive.ts';
import { GPS_MAX_MPS, gpsSpeedMinutes, haversineM } from './gpsMotion.ts';
import { activityDaily, gpsChunk, hcRecord, INSTALL, sleepPacket, sportTelemetry, workout } from './lumenFixtures.ts';
import { openLumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const NOW = Date.parse('2026-10-22T12:00:00Z');
const TZ = 'Asia/Kolkata';
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

function setup() {
  const dir = mkdtempSync(join(TMP, 'fx5-srv-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  const fc = createFusionContextStore(() => join(dir, 'fusion-context.json'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  const tools = lumenToolSet(() => store, TZ, () => NOW, () => fc.get('p'));
  const run = async (name: string, args: Record<string, unknown>) => {
    const env = await tools.call(name, args);
    expect(env.ok, JSON.stringify(env.error ?? null)).toBe(true);
    return env.data as Json;
  };
  const ingest = (events: unknown[]) => {
    const r = store.ingest(INSTALL, events, NOW);
    expect(r.rejected).toEqual([]);
  };
  return { store, run, ingest };
}

const ist = (local: string) => `${local}+05:30`;
const iso = (local: string) => new Date(Date.parse(ist(local))).toISOString();
/** Points every `stepS` seconds heading north at `mps` from `local` for `n` points. */
const northPoints = (local: string, n: number, mps: number, stepS = 5, extra: Record<string, unknown> = {}) => {
  const t0 = Date.parse(ist(local));
  const dLat = (mps * stepS) / 111_195; // metres per degree of latitude on the haversine sphere
  return Array.from({ length: n }, (_, k) => ({ t: new Date(t0 + k * stepS * 1000).toISOString(), lat: 12.9 + k * dLat, lon: 77.6, ...extra }));
};

describe('Gauge GPS: the timeline carries a route-derived moving speed per minute', () => {
  it('a 10-minute GPS walk at 1.4 m/s gives ten accepted minutes near 1.4 m/s, with its lineage', async () => {
    const t = setup();
    t.ingest([
      workout('w-gps', iso('2026-10-21T07:10:00'), { start: iso('2026-10-21T07:00:00'), end: iso('2026-10-21T07:10:00'), type: 'walk', source: 'gauge_gps', durationS: 600, distanceM: 840, moving_s: 600, route: null }),
      gpsChunk('w-gps', 0, northPoints('2026-10-21T07:00:00', 121, 1.4)),
    ]);
    const tl = await t.run('gauge_timeline', { date: '2026-10-21' });
    expect(tl.gps).not.toBeNull();
    const k0 = 7 * 60;
    const speeds = tl.gps.speedMps.slice(k0, k0 + 10);
    expect(speeds.every((v: number | null) => v !== null && Math.abs(v - 1.4) < 0.05)).toBe(true);
    expect(tl.gps.accepted.slice(k0, k0 + 10).every(Boolean)).toBe(true);
    expect(tl.gps.session[k0]).toBe('w-gps');
    // outside the workout: nothing
    expect(tl.gps.speedMps[k0 - 1]).toBeNull();
    expect(tl.gps.speedMps[k0 + 10]).toBeNull();
    expect(tl.evidence.gpsSpeed).toEqual([expect.objectContaining({ source: 'gauge_gps', session: 'w-gps', method: 'route', minutes: 10, accepted: 10 })]);
    // Health Connect speed stays its own stream
    expect(tl.hc).toBeNull();
  });

  it('pauses and inaccurate fixes are left out; a fast minute is shown but not accepted', async () => {
    const t = setup();
    const pts = [
      ...northPoints('2026-10-21T08:00:00', 25, 2.5), // 08:00-08:02
      ...northPoints('2026-10-21T08:02:05', 23, 2.5, 5, { acc: 80 }), // inaccurate: no segments
      ...northPoints('2026-10-21T08:04:00', 13, GPS_MAX_MPS + 3), // 08:04-08:05 too fast
    ];
    t.ingest([
      workout('w-run', iso('2026-10-21T08:06:00'), { start: iso('2026-10-21T08:00:00'), end: iso('2026-10-21T08:06:00'), type: 'run', source: 'gauge_gps', durationS: 360, distanceM: 900, moving_s: 300, route: null, pauses: [{ start: iso('2026-10-21T08:01:00'), end: iso('2026-10-21T08:02:00') }] }),
      gpsChunk('w-run', 0, pts),
    ]);
    const tl = await t.run('gauge_timeline', { date: '2026-10-21' });
    const k0 = 8 * 60;
    expect(tl.gps.speedMps[k0]).toBeCloseTo(2.5, 1);
    expect(tl.gps.speedMps[k0 + 1]).toBeNull(); // the paused minute
    expect(tl.gps.speedMps[k0 + 2]).toBeNull(); // only inaccurate fixes
    expect(tl.gps.speedMps[k0 + 4]).toBeGreaterThan(GPS_MAX_MPS);
    expect(tl.gps.accepted[k0 + 4]).toBe(false);
  });

  it('a GPS workout without its points uses its own route distance over its moving time (session mean)', async () => {
    const t = setup();
    t.ingest([workout('w-mean', iso('2026-10-21T09:20:00'), { start: iso('2026-10-21T09:00:00'), end: iso('2026-10-21T09:20:00'), type: 'run', source: 'gauge_gps', durationS: 1200, distanceM: 3000, moving_s: 1200, route: null })]);
    const tl = await t.run('gauge_timeline', { date: '2026-10-21' });
    const k0 = 9 * 60;
    expect(tl.gps.speedMps.slice(k0, k0 + 20).every((v: number) => v === 2.5)).toBe(true);
    expect(tl.evidence.gpsSpeed[0]).toMatchObject({ method: 'sessionMean', minutes: 20 });
  });

  it('sparse fixes give no minute: the session mean stands in; fixes that were all rejected give nothing', async () => {
    const t = setup();
    const sparse = (local: string, acc: number) => Array.from({ length: 4 }, (_, k) => ({ t: iso(local.replace(/:00:00$/, `:${String(k * 10).padStart(2, '0')}:00`)), lat: 12.9 + k * 0.005, lon: 77.6, acc }));
    t.ingest([
      workout('w-sp', iso('2026-10-21T11:40:00'), { start: iso('2026-10-21T11:00:00'), end: iso('2026-10-21T11:40:00'), type: 'walk', source: 'gauge_gps', durationS: 2400, distanceM: 3000, moving_s: 2400, route: null }),
      gpsChunk('w-sp', 0, sparse('2026-10-21T11:00:00', 5)),
      workout('w-bad', iso('2026-10-21T13:40:00'), { start: iso('2026-10-21T13:00:00'), end: iso('2026-10-21T13:40:00'), type: 'walk', source: 'gauge_gps', durationS: 2400, distanceM: 3000, moving_s: 2400, route: null }),
      gpsChunk('w-bad', 0, sparse('2026-10-21T13:00:00', 90)),
    ]);
    const tl = await t.run('gauge_timeline', { date: '2026-10-21' });
    expect(tl.gps.speedMps[11 * 60 + 5]).toBe(1.25);
    expect(tl.gps.speedMps[13 * 60 + 5]).toBeNull();
    expect(tl.evidence.gpsSpeed.map((e: Json) => [e.session, e.method])).toEqual([['w-sp', 'sessionMean']]);
  });

  it('a workout not recorded with GPS gets no speed (treadmill distance is not a measurement)', async () => {
    const t = setup();
    t.ingest([workout('w-tm', iso('2026-10-21T10:30:00'), { start: iso('2026-10-21T10:00:00'), end: iso('2026-10-21T10:30:00'), type: 'treadmill', source: 'gauge', durationS: 1800, distanceM: 2100, moving_s: 1800, route: null })]);
    const tl = await t.run('gauge_timeline', { date: '2026-10-21' });
    expect(tl.gps).toBeNull();
  });

  it('GPS points count in the row budget', () => {
    const t = setup();
    t.ingest([
      workout('w-b', iso('2026-10-21T07:10:00'), { start: iso('2026-10-21T07:00:00'), end: iso('2026-10-21T07:10:00'), type: 'walk', source: 'gauge_gps', durationS: 600, distanceM: 840, moving_s: 600, route: null }),
      gpsChunk('w-b', 0, northPoints('2026-10-21T07:00:00', 121, 1.4)),
    ]);
    const ws = [{ eventId: 'x', sessionId: 'w-b', installationId: INSTALL, receivedMs: 0, startMs: Date.parse(ist('2026-10-21T07:00:00')), endMs: Date.parse(ist('2026-10-21T07:10:00')), data: { source: 'gauge_gps' } }];
    expect(() => withReadBudget(() => gpsSpeedMinutes(t.store, ws, Date.parse(ist('2026-10-21T00:00:00')), 1440, new Inputs()), 50)).toThrow(ReadBudgetError);
  });

  it('haversine: one degree of latitude is about 111.2 km', () => {
    expect(haversineM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('ring sport telemetry: windows on the workouts route, tied to the workout they belong to', () => {
  it('telemetry inside a Gauge workout names it; telemetry on its own is a window of its own; a blip is not one', async () => {
    const t = setup();
    const tele = (local: string, n: number) => Array.from({ length: n }, (_, k) => sportTelemetry(new Date(Date.parse(ist(local)) + k * 10_000).toISOString(), k * 3, k * 1.5, 120));
    t.ingest([
      workout('w-bike', iso('2026-10-21T08:20:00'), { start: iso('2026-10-21T08:00:00'), end: iso('2026-10-21T08:20:00'), type: 'gym', source: 'gauge', durationS: 1200, route: null }),
      ...tele('2026-10-21T08:01:00', 100), // ~16.5 min inside the workout
      ...tele('2026-10-21T18:00:00', 60), // 10 min alone
      ...tele('2026-10-21T20:00:00', 6), // 1 min: too short
    ]);
    const w = await t.run('gauge_workouts', { from: '2026-10-21', to: '2026-10-21' });
    expect(w.sportWindows).toHaveLength(2);
    expect(w.sportWindows[0]).toMatchObject({ workoutId: 'w-bike', points: 100, source: 'ring' });
    expect(w.sportWindows[1]).toMatchObject({ workoutId: null, points: 60 });
    expect(w.sportWindows[1].id).toBe(`sport:${Date.parse(ist('2026-10-21T18:00:00'))}`);
  });
});

describe('Health Connect SleepSession: the sleep read only for nights with no ring sleep', () => {
  const hcSleep = (id: string, start: string, end: string, stages: Array<[string, string, string]>, origin = 'com.example.watch') =>
    hcRecord('SleepSession', id, iso(start), iso(end), { stages: stages.map(([s, e, stage]) => ({ start: iso(s), end: iso(e), stage })) }, { origin, native: false });

  it('a night only Health Connect saw appears, labelled; a night the ring saw keeps the ring (no double count)', async () => {
    const t = setup();
    t.ingest([
      // the night into the 20th: the ring saw it (and Health Connect again, the same night)
      sleepPacket(iso('2026-10-19T23:00:00'), Array.from({ length: 360 }, (_, k) => (k % 3 === 0 ? 'deep' : 'light'))),
      hcSleep('n20', '2026-10-19T23:00:00', '2026-10-20T05:00:00', [['2026-10-19T23:00:00', '2026-10-20T05:00:00', 'light']]),
      // the night into the 21st: only Health Connect, two origins
      hcSleep('n21a', '2026-10-20T23:00:00', '2026-10-21T06:00:00', [['2026-10-20T23:00:00', '2026-10-21T01:00:00', 'deep'], ['2026-10-21T01:00:00', '2026-10-21T05:30:00', 'light'], ['2026-10-21T05:30:00', '2026-10-21T06:00:00', 'awake']]),
      hcSleep('n21b', '2026-10-20T23:30:00', '2026-10-21T05:00:00', [['2026-10-20T23:30:00', '2026-10-21T05:00:00', 'sleeping']], 'com.google.android.apps.fitness'),
    ]);
    const s = await t.run('gauge_sleep', { from: '2026-10-20', to: '2026-10-22' });
    const by = new Map<string, Json[]>();
    for (const x of s.sessions) by.set(x.wakingDate, [...(by.get(x.wakingDate) ?? []), x]);
    // the 20th: one night, the ring's, its minutes counted once
    expect(by.get('2026-10-20')).toHaveLength(1);
    expect(by.get('2026-10-20')![0]!).toMatchObject({ source: 'ring', asleepMinutes: 360 });
    expect(by.get('2026-10-20')![0]!.sourceLabel).toBeUndefined();
    // the 21st: one origin (the one with the most asleep minutes), labelled
    expect(by.get('2026-10-21')).toHaveLength(1);
    expect(by.get('2026-10-21')![0]!).toMatchObject({ source: 'healthConnect', origin: 'com.example.watch', sourceLabel: 'from Health Connect', asleepMinutes: 390, kind: 'primary' });
    expect(by.get('2026-10-21')![0]!.minutes).toMatchObject({ deep: 120, light: 270, awake: 30 });
    expect(by.get('2026-10-21')![0]!.metrics).toBeDefined();
    // (Gauge's own exports never reach the store: ingest refuses them as own_origin)
  });

  it('Health Connect generic sleep counts as asleep with its stage unnamed, and feeds the timeline\'s sleep stages', async () => {
    const t = setup();
    t.ingest([hcSleep('g', '2026-10-21T01:00:00', '2026-10-21T03:00:00', [['2026-10-21T01:00:00', '2026-10-21T03:00:00', 'sleeping']], 'com.google.android.apps.fitness')]);
    const s = await t.run('gauge_sleep', { from: '2026-10-21', to: '2026-10-21' });
    expect(s.sessions[0]).toMatchObject({ source: 'healthConnect', asleepMinutes: 120 });
    expect(s.sessions[0].minutes.asleepUnspecified).toBe(120);
    const tl = await t.run('gauge_timeline', { date: '2026-10-21' });
    expect(tl.sleep.stage[60]).toBe('asleepUnspecified');
  });
});

describe('Health Connect RestingHeartRate: a labelled baseline fallback while the ring\'s sleeping low is not ready', () => {
  const rhr = (id: string, local: string, bpm: number, origin = 'com.example.watch') => hcRecord('RestingHeartRate', id, iso(local), iso(local), { bpm }, { origin, native: false });

  it('eight days of Health Connect resting HR give a ready fallback from one origin a day', async () => {
    const t = setup();
    const days = Array.from({ length: 8 }, (_, k) => `2026-10-${String(13 + k).padStart(2, '0')}`);
    t.ingest([...days.map((d, k) => rhr(`a${k}`, `${d}T07:00:00`, 58 + (k % 3))), ...days.map((d, k) => rhr(`b${k}`, `${d}T08:00:00`, 90, 'com.other.app')), ...days.map((d, k) => rhr(`c${k}`, `${d}T09:00:00`, 58 + (k % 3)))]);
    const b = await t.run('gauge_baselines', { date: '2026-10-21' });
    expect(b.sleepLowHr.ready).toBe(false);
    expect(b.restingHrFallback).toMatchObject({ source: 'healthConnect', origins: ['com.example.watch'], n: 8, ready: true });
    expect(b.restingHrFallback.medianBpm).toBeGreaterThanOrEqual(58);
    expect(b.restingHrFallback.medianBpm).toBeLessThanOrEqual(60);
    expect(b.restingHrFallback.label).toMatch(/Health Connect/);
  });

  it('nothing is read or shown when there is none', async () => {
    const t = setup();
    const b = await t.run('gauge_baselines', { date: '2026-10-21' });
    expect(b.restingHrFallback).toMatchObject({ n: 0, ready: false, medianBpm: null });
  });
});

describe('Health Connect Distance: the daily distance only on a day the ring has none', () => {
  const dist = (id: string, from: string, to: string, m: number, origin = 'com.google.android.apps.fitness') => hcRecord('Distance', id, iso(from), iso(to), { m }, { origin });

  it('a ring day keeps the ring\'s distance; a day without it takes one Health Connect origin, labelled', async () => {
    const t = setup();
    t.ingest([
      activityDaily(iso('2026-10-20T20:00:00'), 5000), // the ring: 3,500 m
      dist('d1', '2026-10-20T09:00:00', '2026-10-20T10:00:00', 4000),
      dist('d2', '2026-10-21T09:00:00', '2026-10-21T10:00:00', 2500),
      dist('d3', '2026-10-21T11:00:00', '2026-10-21T11:30:00', 500),
      // a second app wrote the same walk: never added to the first
      dist('d4', '2026-10-21T09:00:00', '2026-10-21T09:20:00', 2400, 'com.example.watch'),
    ]);
    const a = await t.run('gauge_activity', { from: '2026-10-20', to: '2026-10-21' });
    const d20 = a.days.find((d: Json) => d.date === '2026-10-20');
    const d21 = a.days.find((d: Json) => d.date === '2026-10-21');
    expect(d20).toMatchObject({ distanceM: 3500 });
    expect(d20.distanceSource).toBeUndefined();
    expect(d20.distanceOrigin).toBeUndefined();
    expect(d21).toMatchObject({ distanceM: 3000, distanceSource: 'healthConnect', distanceOrigin: 'com.google.android.apps.fitness', distanceLabel: 'from Health Connect', steps: null });
  });

  it('a record across midnight is split by time between its days', async () => {
    const t = setup();
    t.ingest([dist('x', '2026-10-20T23:30:00', '2026-10-21T00:30:00', 1000)]);
    const a = await t.run('gauge_activity', { from: '2026-10-20', to: '2026-10-21' });
    expect(a.days.map((d: Json) => [d.date, d.distanceM])).toEqual([['2026-10-20', 500], ['2026-10-21', 500]]);
  });
});
