/** The Gauge client: the tool JSON from `/v1/gauge/*`, null when unpaired or offline, the last good answer, 304 polling. */
import { describe, expect, it, vi } from 'vitest';
import { ServerError } from '../server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adaptGaugeData, createGaugeApi, gaugeData, type GaugeBaselines, type GaugeSleep } from '../gauge';
import { sleepNight, vsUsual } from '@/living/sensors/sleepNight';
import { recoveryIndex } from '@/living/sensors/indices';

const BASE = 'https://home.example:8443';
const SLEEP = {
  from: '2026-10-19', to: '2026-10-20', units: { minutes: 'min' },
  sessions: [{ wakingDate: '2026-10-20', start: '2026-10-19T23:10:00+05:30', end: '2026-10-20T06:52:00+05:30', inBedMinutes: 462, asleepMinutes: 412, minutes: { deep: 80, light: 250, rem: 82, awake: 50, unknown: 0 }, efficiencyPercent: 89, blocks: [] }],
  source: 'lumen_health', timeZone: 'Asia/Kolkata', installations: [], freshness: { lastUploadAt: null, lastReadingAt: null, minutesSinceLastUpload: null, minutesSinceLastReading: null },
};
const envelope = (data: unknown) => ({ ok: true, status: 'applied', summary: 'ok', data });

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'down';

function fakeServer(replies: Reply[], paired = true) {
  const calls: Array<{ url: string; headers: Record<string, string>; method: string; body: string | null }> = [];
  let state = { paired, base: BASE, personId: 'person-a', deviceId: 'device-a' };
  const listeners = new Set<() => void>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(input), headers, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
    const r = replies.shift() ?? { status: 500 };
    if (r === 'down') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? {} });
  };
  const server = {
    isPaired: () => state.paired,
    pairing: () => state.paired ? { baseUrl: state.base, person: { id: state.personId, label: '' }, deviceId: state.deviceId, pairedAt: state.deviceId } : null,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    chatModelOptions: () => {
      if (!state.paired) throw new ServerError('not_paired');
      return { serverUrl: `${state.base}/`, deps: { fetch: fetchImpl } };
    },
    unpair: () => {
      state = { ...state, paired: false };
      listeners.forEach((l) => l());
    },
    replace: (base: string, personId: string) => {
      state = { ...state, paired: true, base, personId, deviceId: `device-${personId}` };
      listeners.forEach((l) => l());
    },
  };
  return { server, calls };
}

describe('gaugeApi', () => {
  it('reads the tool JSON out of the envelope, with the tool arguments as the query', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: envelope(SLEEP) }, { status: 200, body: envelope({ points: [] }) }]);
    const api = createGaugeApi({ server, now: () => Date.parse('2026-10-20T07:00:00Z'), tz: () => 'Asia/Kolkata' });
    expect(await api.sleep('2026-10-19', '2026-10-20')).toEqual(SLEEP);
    // (F10) every read carries the device zone
    expect(calls[0]!.url).toBe(`${BASE}/v1/gauge/sleep?from=2026-10-19&to=2026-10-20&tz=Asia%2FKolkata`);
    await api.series({ kind: 'hr', from: '2026-10-20', to: '2026-10-20' });
    // an absent bucket is left out (the server refuses unknown or repeated parameters)
    expect(calls[1]!.url).toBe(`${BASE}/v1/gauge/series?kind=hr&from=2026-10-20&to=2026-10-20&tz=Asia%2FKolkata`);
    expect(api.status()).toEqual({ lastOkAt: '2026-10-20T07:00:00.000Z', problem: null });
  });

  it('builds every endpoint of the brief', async () => {
    const { server, calls } = fakeServer(Array.from({ length: 9 }, () => ({ status: 200, body: envelope({}) })));
    const api = createGaugeApi({ server, tz: () => 'UTC' });
    await api.availability();
    await api.daily('2026-10-20');
    await api.activity('2026-10-14', '2026-10-20');
    await api.scores('2026-10-14', '2026-10-20', 'sleep_score');
    await api.scores('2026-10-14', '2026-10-20');
    await api.device();
    await api.shortVideo('2026-10-14', '2026-10-20');
    await api.workouts('2026-10-14', '2026-10-20');
    await api.series({ kind: 'spo2', from: '2026-10-20', to: '2026-10-20', bucket: 'hour' });
    expect(calls.map((c) => c.url.slice(BASE.length))).toEqual([
      '/v1/gauge/availability?tz=UTC',
      '/v1/gauge/daily?date=2026-10-20&tz=UTC',
      '/v1/gauge/activity?from=2026-10-14&to=2026-10-20&tz=UTC',
      '/v1/gauge/scores?from=2026-10-14&to=2026-10-20&key=sleep_score&tz=UTC',
      '/v1/gauge/scores?from=2026-10-14&to=2026-10-20&tz=UTC',
      '/v1/gauge/device?tz=UTC',
      '/v1/gauge/short-video?from=2026-10-14&to=2026-10-20&tz=UTC',
      '/v1/gauge/workouts?from=2026-10-14&to=2026-10-20&tz=UTC',
      '/v1/gauge/series?kind=spo2&from=2026-10-20&to=2026-10-20&bucket=hour&tz=UTC',
    ]);
  });

  it('builds the energy SPEC §2.2 routes (steps, timeline, baselines, hc)', async () => {
    const { server, calls } = fakeServer(Array.from({ length: 4 }, () => ({ status: 200, body: envelope({}) })));
    const api = createGaugeApi({ server, tz: () => 'UTC' });
    await api.steps('2026-10-14', '2026-10-20');
    await api.timeline('2026-10-20');
    await api.baselines('2026-10-20');
    await api.hc('HeartRate', '2026-10-20', '2026-10-20');
    expect(calls.map((c) => c.url.slice(BASE.length))).toEqual([
      '/v1/gauge/steps?from=2026-10-14&to=2026-10-20&tz=UTC',
      '/v1/gauge/timeline?date=2026-10-20&tz=UTC',
      '/v1/gauge/baselines?date=2026-10-20&tz=UTC',
      '/v1/gauge/hc?type=HeartRate&from=2026-10-20&to=2026-10-20&tz=UTC',
    ]);
  });

  it('is null when this device is not paired (and asks nothing)', async () => {
    const { server, calls } = fakeServer([], false);
    const api = createGaugeApi({ server });
    expect(await api.sleep('2026-10-19', '2026-10-20')).toBeNull();
    expect(calls).toHaveLength(0);
    expect(api.status().problem).toBe('not_paired');
  });

  it('offline: the last good answer, or null when asked for fresh data only', async () => {
    const { server } = fakeServer([{ status: 200, body: envelope(SLEEP) }, 'down', 'down', 'down']);
    const api = createGaugeApi({ server });
    await api.sleep('2026-10-19', '2026-10-20');
    expect(await api.sleep('2026-10-19', '2026-10-20')).toEqual(SLEEP);
    expect(api.status().problem).toBe('offline');
    expect(await api.sleep('2026-10-19', '2026-10-20', { cached: false })).toBeNull();
    // a request never answered before has nothing to fall back on
    expect(await api.activity('2026-10-19', '2026-10-20')).toBeNull();
  });

  it('polls conditionally and keeps the cached body on a 304', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: envelope(SLEEP), headers: { etag: 'W/"abc"', 'last-modified': 'Tue, 20 Oct 2026 01:00:00 GMT' } }, { status: 304 }]);
    const api = createGaugeApi({ server });
    await api.sleep('2026-10-19', '2026-10-20');
    expect(await api.sleep('2026-10-19', '2026-10-20', { cached: false })).toEqual(SLEEP);
    expect(calls[1]!.headers['if-none-match']).toBe('W/"abc"');
    expect(api.status().problem).toBeNull();
  });

  it('a rejected envelope, a 403 (not a Vitals device token) or a 401 is null; 401/403 forget the cache', async () => {
    const { server } = fakeServer([
      { status: 200, body: envelope(SLEEP) },
      { status: 200, body: { ok: false, status: 'rejected', summary: 'bad', error: { code: 'invalid_input', message: 'bad' } } },
      { status: 403, body: { error: { code: 'wrong_kind' } } },
      'down',
    ]);
    const api = createGaugeApi({ server });
    await api.sleep('2026-10-19', '2026-10-20');
    expect(await api.sleep('2026-10-19', '2026-10-20', { cached: false })).toBeNull();
    expect(await api.sleep('2026-10-19', '2026-10-20')).toBeNull();
    expect(api.status().problem).toBe('unauthorized');
    expect(await api.sleep('2026-10-19', '2026-10-20')).toBeNull();
  });

  it('unpairing forgets the cached answers', async () => {
    const { server } = fakeServer([{ status: 200, body: envelope(SLEEP) }]);
    const api = createGaugeApi({ server });
    await api.sleep('2026-10-19', '2026-10-20');
    server.unpair();
    expect(await api.sleep('2026-10-19', '2026-10-20')).toBeNull();
  });

  it('a direct pairing replacement cannot reuse cached data or validators', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: envelope(SLEEP), headers: { etag: '"person-a"' } }, 'down']);
    const api = createGaugeApi({ server, tz: () => 'UTC' });
    expect(await api.sleep('2026-10-19', '2026-10-20')).toEqual(SLEEP);
    server.replace('https://other.example:8443', 'person-b');
    expect(await api.sleep('2026-10-19', '2026-10-20')).toBeNull();
    expect(calls[1]!.url).toContain('other.example');
    expect(calls[1]!.headers['if-none-match']).toBeUndefined();
  });

  it('a response begun for the old pairing cannot refill the new pairing cache', async () => {
    let finish!: (response: Response) => void;
    const listeners = new Set<() => void>();
    let personId = 'person-a';
    const calls: Array<Record<string, string>> = [];
    const server = {
      isPaired: () => true,
      pairing: () => ({ baseUrl: BASE, person: { id: personId, label: '' }, deviceId: personId, pairedAt: personId }),
      subscribe: (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); },
      chatModelOptions: () => ({ serverUrl: BASE, deps: { fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
        calls.push(headers);
        if (calls.length === 1) return new Promise<Response>((resolve) => { finish = resolve; });
        throw new TypeError('offline');
      }) as typeof fetch } }),
    };
    const api = createGaugeApi({ server, tz: () => 'UTC' });
    const old = api.sleep('2026-10-19', '2026-10-20');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    personId = 'person-b';
    listeners.forEach((l) => l());
    finish(new Response(JSON.stringify(envelope(SLEEP)), { status: 200, headers: { etag: '"person-a"' } }));
    expect(await old).toBeNull();
    expect(await api.sleep('2026-10-19', '2026-10-20')).toBeNull();
    expect(calls[1]!['if-none-match']).toBeUndefined();
  });

  it('gaugeData takes an envelope or a bare tool body', () => {
    expect(gaugeData(envelope({ a: 1 }))).toEqual({ a: 1 });
    expect(gaugeData({ a: 1 })).toEqual({ a: 1 });
    expect(gaugeData([1])).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------- audit fixes (2026-10-27)
const FIXTURES = join(__dirname, '..', '..', '..', 'packages', 'companion', 'fixtures', 'gauge-v2');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { route: string; envelope: unknown };

describe('audit F4: S2 fixtures through the one adapter into V2', () => {
  it('maps S2 sleep metrics and baselines to the V2 shapes, and V2 sleepNight / vsUsual / recoveryIndex read them', async () => {
    const sl = fixture('sleep');
    const bl = fixture('baselines');
    const { server } = fakeServer([{ status: 200, body: sl.envelope }, { status: 200, body: bl.envelope }]);
    const api = createGaugeApi({ server, tz: () => 'Asia/Kolkata' });
    const sleep = (await api.sleep('2026-10-20', '2026-10-20')) as GaugeSleep;
    const base = (await api.baselines('2026-10-20')) as GaugeBaselines;
    const m = sleep.sessions[0]!.metrics!;
    // S2 sends {bpm, bins}, {ms, n, firmware}, {c, n} and trace objects: V2 reads numbers
    expect(m.nightlyLowHrP10).toBe(50);
    expect(m.hrvNightlyMs).toBe(42.5);
    expect(m.skinTempNightC).toBe(35.6);
    expect(m.trace5min.every((v) => v === null || typeof v === 'number')).toBe(true);
    expect(m.trace5min).toHaveLength(67);
    expect(m.timeToLowReason).toBe('cadenceUnknown');
    expect(base.sleepLowHr).toMatchObject({ median: 51.5, s: 3, n: 8, ready: true });
    expect(base.hrvBaseline).toMatchObject({ median: 3.85, s: 0.095, medianMs: 47 });
    expect(base.tempBaseline).toMatchObject({ median: 35.7, deltaT: -0.1 });
    expect(base.usualMidpoint).toMatchObject({ minutes: 129, Rbar: 0.999, n: 8, suppressed: false });
    expect(base.sampledIdleHr).toBeNull();

    const n = sleepNight({ metrics: m, baselines: base, utcOffsetMin: 330 });
    expect(n.vsUsual.learning).toBe(false);
    expect(n.vsUsual.lowHrWord).toBe('Near usual'); // 50 vs 51.5 ± 3
    expect(n.vsUsual.hrvMs).toBeCloseTo(-4.5, 5);
    expect(n.vsUsual.tempC).toBeCloseTo(-0.1, 5);
    expect(n.vsUsual.midpointMin).toBe(-11); // 01:58 vs 02:09
    expect(vsUsual(m, base, 330).lowHrBpm).toBeCloseTo(-1.5, 5);
    const r = recoveryIndex({ hrvNightlyMs: m.hrvNightlyMs, nightlyLowHrP10: m.nightlyLowHrP10, baselines: base, sleepIndex: 80, loadBalance: null });
    expect(r.status).toBe('inferred');
    expect(r.contributors.find((c) => c.id === 'hrv')!.score).not.toBeNull();
    expect(r.contributors.find((c) => c.id === 'lowHr')!.score).not.toBeNull();
  });

  it('a baseline S2 does not call ready is shown but never compared against; the adapter is idempotent', () => {
    const data = gaugeData(fixture('baselines').envelope)!;
    const raw = JSON.parse(JSON.stringify(data)) as Record<string, Record<string, unknown>>;
    raw.sleepLowHr!.ready = false;
    raw.usualMidpoint = { minutes: null, clock: null, R: 0.2, n: 8, ready: false, reason: 'dispersed' };
    const b = adaptGaugeData('/v1/gauge/baselines', raw) as unknown as GaugeBaselines;
    expect(b.sleepLowHr).toMatchObject({ median: 51.5, ready: false });
    expect(b.usualMidpoint).toMatchObject({ minutes: null, Rbar: 0.2, suppressed: true, reason: 'dispersed' });
    const m = { tstLowerMin: 400, tstUpperMin: 400, onset: null, finalWake: null, midpoint: '2026-10-20T02:00:00+05:30', nightlyLowHrP10: 60, hrvNightlyMs: null, skinTempNightC: null };
    expect(vsUsual(m, b).lowHrWord).toBeNull();
    expect(vsUsual(m, b).midpointMin).toBeNull();
    expect(adaptGaugeData('/v1/gauge/baselines', b as unknown as Record<string, unknown>)).toEqual(b);
  });

  it('daily sleep sessions and HC records are mapped too (origin → originPackage)', () => {
    const daily = adaptGaugeData('/v1/gauge/daily', gaugeData(fixture('daily').envelope)!) as { sleep: GaugeSleep['sessions'] };
    expect(daily.sleep[0]!.metrics!.nightlyLowHrP10).toBe(50);
    const hc = adaptGaugeData('/v1/gauge/hc', gaugeData(fixture('hc').envelope)!) as { records: Array<{ originPackage: string; originIsDeviceNative: boolean }> };
    expect(hc.records[0]).toMatchObject({ originPackage: 'com.google.android.apps.fitness', originIsDeviceNative: false });
  });
});

describe('audit F10: tz on every read', () => {
  it('sends the device zone; a server that refuses tz (400) is asked again without it, then no more', async () => {
    const { server, calls } = fakeServer([{ status: 400, body: { ok: false, status: 'rejected', summary: 'This endpoint takes date', data: null } }, { status: 200, body: envelope({ date: '2026-10-20' }) }, { status: 200, body: envelope({}) }]);
    const api = createGaugeApi({ server, tz: () => 'Asia/Kolkata' });
    expect(await api.daily('2026-10-20')).toEqual({ date: '2026-10-20' });
    await api.activity('2026-10-20', '2026-10-20');
    expect(calls.map((c) => c.url.slice(BASE.length))).toEqual(['/v1/gauge/daily?date=2026-10-20&tz=Asia%2FKolkata', '/v1/gauge/daily?date=2026-10-20', '/v1/gauge/activity?from=2026-10-20&to=2026-10-20']);
  });

  it('a call option overrides the zone', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: envelope({}) }]);
    await createGaugeApi({ server, tz: () => 'UTC' }).timeline('2026-10-20', { tz: 'Europe/Berlin' });
    expect(calls[0]!.url).toBe(`${BASE}/v1/gauge/timeline?date=2026-10-20&tz=Europe%2FBerlin`);
  });
});

describe('audit F3: POST /steps/fuse with the activity context', () => {
  const body = { from: '2026-10-20', to: '2026-10-20', activities: [{ start: '2026-10-20T01:30:00.000Z', end: '2026-10-20T02:00:00.000Z', kind: 'nonLocomotor' as const }], preference: { stepsPreference: ['phone', 'ring'], soleSustainedGait: false } };

  it('posts the body with the zone and answers the steps JSON', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: envelope({ fusionVersion: 'steps-fuse/1', intervals: [], days: [] }) }]);
    const r = await createGaugeApi({ server, tz: () => 'Asia/Kolkata' }).stepsFuse(body, { cached: false });
    expect(r).toMatchObject({ fusionVersion: 'steps-fuse/1' });
    expect(calls[0]).toMatchObject({ url: `${BASE}/v1/gauge/steps/fuse`, method: 'POST' });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ ...body, tz: 'Asia/Kolkata' });
  });

  it('an older server without the route (404): GET /steps for the same range and zone', async () => {
    const { server, calls } = fakeServer([{ status: 404 }, { status: 200, body: envelope({ fusionVersion: 'steps-fuse/1', intervals: [], days: [{ date: '2026-10-20', located: 10 }] }) }]);
    const r = await createGaugeApi({ server, tz: () => 'Asia/Kolkata' }).stepsFuse(body);
    expect(r?.days[0]?.located).toBe(10);
    expect(calls.map((c) => `${c.method} ${c.url.slice(BASE.length)}`)).toEqual(['POST /v1/gauge/steps/fuse', 'GET /v1/gauge/steps?from=2026-10-20&to=2026-10-20&tz=Asia%2FKolkata']);
  });
});

describe('series pagination (SPEC §2.2 cursor/next; Codex UI #15)', () => {
  const pt = (at: string, value: number) => ({ at, value, provenance: 'ring' });
  it('follows `next` (and `nextCursor`) with `cursor` until the last page, and returns every reading', async () => {
    const { server, calls } = fakeServer([
      { status: 200, body: envelope({ kind: 'stress', bucket: 'raw', count: 2, truncated: true, next: 'c2', points: [pt('2026-10-20T08:00:00', 30), pt('2026-10-20T08:05:00', 32)] }) },
      { status: 200, body: envelope({ kind: 'stress', bucket: 'raw', count: 1, nextCursor: 'c3', points: [pt('2026-10-20T08:10:00', 40)] }) },
      { status: 200, body: envelope({ kind: 'stress', bucket: 'raw', count: 1, next: null, points: [pt('2026-10-20T08:15:00', 55)] }) },
    ]);
    const api = createGaugeApi({ server, tz: () => 'UTC' });
    const s = (await api.series({ kind: 'stress', from: '2026-10-20', to: '2026-10-20', bucket: 'raw' }))!;
    expect(s.points.map((p) => (p as { value: number }).value)).toEqual([30, 32, 40, 55]);
    expect(s.count).toBe(4);
    expect(s.truncated).toBe(false);
    expect(s.next).toBeUndefined();
    expect(calls.map((c) => c.url.slice(BASE.length))).toEqual([
      '/v1/gauge/series?kind=stress&from=2026-10-20&to=2026-10-20&bucket=raw&tz=UTC',
      '/v1/gauge/series?kind=stress&from=2026-10-20&to=2026-10-20&bucket=raw&cursor=c2&tz=UTC',
      '/v1/gauge/series?kind=stress&from=2026-10-20&to=2026-10-20&bucket=raw&cursor=c3&tz=UTC',
    ]);
  });

  it('a page that does not arrive (or a cursor that repeats) leaves the series marked truncated, never silently whole', async () => {
    const { server } = fakeServer([
      { status: 200, body: envelope({ kind: 'hr', bucket: 'raw', next: 'c2', points: [pt('2026-10-20T08:00:00', 60)] }) },
      'down',
    ]);
    const api = createGaugeApi({ server, tz: () => 'UTC' });
    const s = (await api.series({ kind: 'hr', from: '2026-10-20', to: '2026-10-20', bucket: 'raw' }, { cached: false }))!;
    expect(s.points).toHaveLength(1);
    expect(s.truncated).toBe(true);
    const loop = fakeServer([
      { status: 200, body: envelope({ kind: 'hr', bucket: 'raw', next: 'same', points: [pt('2026-10-20T08:00:00', 60)] }) },
      { status: 200, body: envelope({ kind: 'hr', bucket: 'raw', next: 'same', points: [pt('2026-10-20T08:05:00', 61)] }) },
    ]);
    const s2 = (await createGaugeApi({ server: loop.server, tz: () => 'UTC' }).series({ kind: 'hr', from: '2026-10-20', to: '2026-10-20', bucket: 'raw' }))!;
    expect(s2.points).toHaveLength(2);
    expect(s2.truncated).toBe(true);
    expect(loop.calls).toHaveLength(2);
  });
});

describe('hr-intervals (Codex #11: the raw readings for exact zone time)', () => {
  const iv = (t: number, bpm: number) => ({ t, bpm, cadenceS: 10, nextT: t + 10_000, start: t - 5_000, end: t + 5_000 });
  const page = (intervals: unknown[], next: string | null, inputsHash = 'sha256:a') => envelope({ from: '2026-10-20T07:00:00Z', to: '2026-10-20T08:00:00Z', intervals, count: 3, supportedS: 30, next, inputsHash });
  it('follows next with cursor to the end and returns every reading, untruncated', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: page([iv(1, 100), iv(2, 110)], '2') }, { status: 200, body: page([iv(3, 120)], null) }]);
    const r = (await createGaugeApi({ server, tz: () => 'UTC' }).hrIntervals('2026-10-20T07:00:00Z', '2026-10-20T08:00:00Z'))!;
    expect(r.intervals.map((x) => x.bpm)).toEqual([100, 110, 120]);
    expect(r.truncated).toBe(false);
    expect('next' in r).toBe(false);
    expect(calls.map((c) => c.url.slice(BASE.length))).toEqual([
      '/v1/gauge/hr-intervals?from=2026-10-20T07%3A00%3A00Z&to=2026-10-20T08%3A00%3A00Z&tz=UTC',
      '/v1/gauge/hr-intervals?from=2026-10-20T07%3A00%3A00Z&to=2026-10-20T08%3A00%3A00Z&cursor=2&tz=UTC',
    ]);
  });

  it('a missing page, or a page whose inputsHash changed meanwhile, leaves it truncated (never used as exact)', async () => {
    const a = fakeServer([{ status: 200, body: page([iv(1, 100)], '1') }, 'down']);
    expect((await createGaugeApi({ server: a.server, tz: () => 'UTC' }).hrIntervals('a', 'b', { cached: false }))!.truncated).toBe(true);
    const b = fakeServer([{ status: 200, body: page([iv(1, 100)], '1') }, { status: 200, body: page([iv(2, 100)], null, 'sha256:b') }]);
    expect((await createGaugeApi({ server: b.server, tz: () => 'UTC' }).hrIntervals('a', 'b'))!.truncated).toBe(true);
    // an older server without the route: null
    const c = fakeServer([{ status: 404, body: { error: 'not_found' } }]);
    expect(await createGaugeApi({ server: c.server, tz: () => 'UTC' }).hrIntervals('a', 'b')).toBeNull();
  });
});
