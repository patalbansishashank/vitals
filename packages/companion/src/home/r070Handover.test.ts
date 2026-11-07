// @vitest-environment node
/**
 * r070: the Gauge engine built into the Vitals app takes over from the standalone Gauge app on one phone and one ring.
 *
 * - `POST /v1/lumen/pair-device`: a Vitals device credential, no code; idempotent per installation; recorded as `app: 'vitals'`.
 * - The new installation starts with an empty local database, so it re-syncs the ring's stored history and re-reads Health
 *   Connect under its own installation id, overlapping what the old installation uploaded: that must change nothing
 *   (identical records are duplicates by id; records that differ in content but name the same ring instant, Health Connect
 *   record or phone counter span are one record), whichever installation uploads first.
 * - The old installation reads as superseded while an embedded one is active; commands go to the embedded one.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { activityDaily, deletion, hcRecord, hr, INSTALL, lumenEvent, phoneAcquisition, phoneSteps, RING_ID, ringSteps, shortVideo, sleepPacket, type LumenTestEvent } from './lumenFixtures.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';
import type { PersonRequest, PersonResponse } from './personRpc.ts';
import type { WorkerFactory } from './workers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;
const TMP = process.env.TMPDIR ?? '/tmp';
const SITE = 'https://vitals.creative.desi';
const OLD = INSTALL; // the standalone Gauge installation
const NEW = '5e1d2c3b4a594e8f9d0123456789ffff'; // the Vitals app's engine
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

// --- the endpoint and the roles, over HTTP

async function boot() {
  const dataDir = mkdtempSync(join(TMP, 'r070-home-'));
  const clock = { now: Date.parse('2026-10-30T04:00:00Z') };
  const factory: WorkerFactory = async () => ({
    async call(_req: PersonRequest): Promise<PersonResponse> {
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false,
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: factory, now: () => clock.now },
  });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
  const home = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, redirect: 'manual', ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as Json };
  };
  const person = async () => {
    const p = await home.persons.add({ label: 'Ana', timeZone: 'UTC', secret: new Uint8Array(32).fill(7), relayUrl: null });
    const { code } = await home.devices.issueCode(p.id);
    const d = await call('/v1/pair/device', { method: 'POST', body: { code, label: 'Phone (Vitals app)' } });
    return { id: p.id, device: d.body.token as string };
  };
  const pairOld = async (personId: string) => {
    const { code } = await home.devices.issueCode(personId);
    return (await call('/v1/lumen/pair', { method: 'POST', body: { code, installationId: OLD, deviceName: 'OnePlus CPH2661', appVersion: '2.8.7' } })).body;
  };
  const pairNew = (device: string, body: Json = { installationId: NEW, deviceName: 'Vitals · OnePlus CPH2661', appVersion: '0.7.0' }) => call('/v1/lumen/pair-device', { method: 'POST', token: device, body });
  const upload = (token: string, installationId: string, events: unknown[]) => call('/v1/lumen/events', { method: 'POST', token, body: { installationId, events } });
  return { c, home, call, person, pairOld, pairNew, upload, clock };
}

describe('POST /v1/lumen/pair-device', () => {
  it('pairs the Vitals device\'s engine without a code and answers /pair\'s shape; the token uploads as that installation only', async () => {
    const t = await boot();
    const a = await t.person();
    const r = await t.pairNew(a.device);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['deviceId', 'maxBatch', 'maxBytes', 'personId', 'serverVersion', 'token']);
    expect(r.body).toMatchObject({ personId: a.id, maxBatch: 500, maxBytes: 1048576 });
    const up = await t.upload(r.body.token, NEW, [hr('2026-10-20T01:00:00Z', 60, { install: NEW })]);
    expect([up.status, up.body.accepted]).toEqual([200, 1]);
    expect((await t.upload(r.body.token, OLD, [])).status).toBe(403); // wrong_installation
    expect((await t.call('/v1/lumen/status', { token: r.body.token })).status).toBe(200);
    // the lists say what it is
    const list = (await t.call('/v1/devices', { token: a.device })).body.devices as Json[];
    expect(list.filter((d) => d.kind === 'lumen')).toEqual([expect.objectContaining({ id: r.body.deviceId, label: 'Vitals · OnePlus CPH2661', scope: 'lumen', app: 'vitals' })]);
    expect(t.home.lumen.store(a.id).installations()).toEqual([expect.objectContaining({ id: NEW, app: 'vitals', deviceName: 'Vitals · OnePlus CPH2661', appVersion: '0.7.0', status: 'active', supersededBy: null })]);
  });

  it('is idempotent per installation: the same lumen device with a rotated token, the old one revoked', async () => {
    const t = await boot();
    const a = await t.person();
    const first = (await t.pairNew(a.device)).body;
    const second = (await t.pairNew(a.device, { installationId: NEW, deviceName: 'Vitals · OnePlus CPH2661', appVersion: '0.7.1' })).body;
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.token).not.toBe(first.token);
    expect((await t.call('/v1/lumen/status', { token: first.token })).status).toBe(401); // its hash is gone: the token is not known any more
    expect((await t.call('/v1/lumen/status', { token: second.token })).status).toBe(200);
    const lumen = ((await t.call('/v1/devices', { token: a.device })).body.devices as Json[]).filter((d) => d.kind === 'lumen');
    expect(lumen).toHaveLength(1);
    expect(t.home.lumen.store(a.id).installations()).toEqual([expect.objectContaining({ id: NEW, appVersion: '0.7.1' })]);
  });

  it('refuses without a Vitals device token, with a bad body, a wrong method, and the standalone Gauge\'s own installation id', async () => {
    const t = await boot();
    const a = await t.person();
    expect((await t.call('/v1/lumen/pair-device', { method: 'POST', body: { installationId: NEW } })).status).toBe(401);
    const old = await t.pairOld(a.id);
    expect((await t.call('/v1/lumen/pair-device', { method: 'POST', token: old.token, body: { installationId: NEW } })).status).toBe(403);
    const agent = await t.home.devices.mint(a.id, { kind: 'agent', label: 'Agent', scope: 'edit' });
    expect((await t.call('/v1/lumen/pair-device', { method: 'POST', token: agent.token, body: { installationId: NEW } })).status).toBe(403);
    for (const body of [{}, { installationId: 'x' }, { installationId: NEW, deviceName: 5 }, { installationId: NEW, appVersion: 'not a version!' }]) {
      expect((await t.pairNew(a.device, body as Json)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await t.call('/v1/lumen/pair-device', { token: a.device })).status).toBe(405);
    const taken = await t.pairNew(a.device, { installationId: OLD });
    expect([taken.status, taken.body.error]).toEqual([409, 'installation_is_gauge']);
    // the standalone Gauge's token still works
    expect((await t.call('/v1/lumen/status', { token: old.token })).status).toBe(200);
  });

  it('the standalone Gauge reads as superseded while the embedded installation is paired, and active again once it unpairs', async () => {
    const t = await boot();
    const a = await t.person();
    const old = await t.pairOld(a.id);
    await t.upload(old.token, OLD, [hr('2026-10-20T01:00:00Z', 58)]);
    const tools = t.home.lumen.toolsFor(a.id, 'UTC');
    const roster = async () => ((await tools.call('gauge_data_availability', {})) as unknown as { data: Json }).data.installations as Json[];
    expect(await roster()).toEqual([expect.objectContaining({ id: OLD, app: 'gauge', status: 'active', supersededBy: null })]);
    const n = (await t.pairNew(a.device)).body;
    expect(await roster()).toEqual([
      expect.objectContaining({ id: NEW, app: 'vitals', status: 'active', supersededBy: null }),
      expect.objectContaining({ id: OLD, app: 'gauge', status: 'superseded', supersededBy: NEW }),
    ].sort((x, y) => (x.id < y.id ? -1 : 1)).map((x) => x));
    // the old one's data stays, and a late backlog from it is still accepted
    const late = await t.upload(old.token, OLD, [hr('2026-10-20T01:05:00Z', 59)]);
    expect([late.status, late.body.accepted]).toEqual([200, 1]);
    // device state says the same
    await t.upload(old.token, OLD, [lumenEvent('state/battery', 'battery', 'health.device.battery.updated', '2026-10-20T02:00:00Z', { percent: 50 }, { install: OLD })]);
    const ds = ((await tools.call('gauge_device_state', {})) as unknown as { data: Json }).data.devices as Json[];
    expect(ds).toEqual([expect.objectContaining({ installationId: OLD, app: 'gauge', status: 'superseded', supersededBy: NEW })]);
    // the embedded one unpairs: nothing supersedes the old one any more
    expect((await t.call('/v1/lumen/unpair', { method: 'POST', token: n.token })).status).toBe(204);
    expect((await roster()).find((i) => i.id === OLD)).toMatchObject({ status: 'active', supersededBy: null });
    expect((await roster()).find((i) => i.id === NEW)).toMatchObject({ status: 'unpaired' });
  });
});

describe('commands go to the embedded installation', () => {
  it('the standalone Gauge before an embedded one exists, the embedded one after (old one still addressable by id)', async () => {
    const t = await boot();
    const a = await t.person();
    const old = await t.pairOld(a.id);
    const send = (body: Json) => t.call('/v1/gauge/commands', { method: 'POST', token: a.device, body });
    const id = (n: number) => `cmd-r070-${'abcdefghij'[n]}-0000000000`;
    const first = await send({ id: id(0), type: 'ring.sync', payload: {} });
    expect([first.status, first.body.command.installationId]).toEqual([201, OLD]);
    expect((await t.call('/v1/gauge/commands/state', { token: a.device })).body).toMatchObject({ installationId: OLD, app: 'gauge' });

    const n = (await t.pairNew(a.device)).body;
    // no ambiguity: two installations are paired, but only the embedded one is the default target
    const second = await send({ id: id(1), type: 'hr.measure' });
    expect([second.status, second.body.command.installationId]).toEqual([201, NEW]);
    expect((await t.call('/v1/gauge/commands/state', { token: a.device })).body).toMatchObject({ installationId: NEW, app: 'vitals' });
    // the embedded one polls and gets it (its capabilities need no `update.check`); the old one does not
    t.clock.now += 2000;
    const polled = await t.call('/v1/lumen/commands?wait=0', { token: n.token });
    expect(polled.body.commands.map((c: Json) => c.type)).toEqual(['hr.measure']);
    await t.call('/v1/lumen/commands/state', { method: 'POST', token: n.token, body: { appVersion: '0.7.0', capabilities: ['ring.sync', 'hr.measure', 'workout.start', 'workout.pause', 'workout.resume', 'workout.stop'] } });
    expect((await t.call('/v1/gauge/commands/state', { token: a.device })).body.capabilities).not.toContain('update.check');
    t.clock.now += 2000;
    const polledOld = await t.call('/v1/lumen/commands?wait=0', { token: old.token });
    expect(polledOld.body.commands.map((c: Json) => c.type)).toEqual(['ring.sync']);
    // naming the old installation still reaches it (its pending ring.sync coalesces: the same command)
    const third = await send({ id: id(2), type: 'ring.sync', payload: {}, installationId: OLD });
    expect([[200, 201].includes(third.status), third.body.command.installationId]).toEqual([true, OLD]);
    // ring.sync and the rest go to the embedded one when sent plainly
    const fourth = await send({ id: id(3), type: 'ring.sync', payload: {} });
    expect([[200, 201].includes(fourth.status), fourth.body.command.installationId]).toEqual([true, NEW]);
  });
});

// --- the backfill: the new installation re-sends everything the old one uploaded

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const D0 = Date.parse('2026-10-20T01:00:00Z');
const NOW = Date.parse('2026-10-21T00:00:00Z');
const at = (min: number) => iso(D0 + min * 60_000);
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40);

/** What one phone and one ring produced: ring minutes, a daily total, heart rate, a sleep packet, phone counter minutes, Health Connect, a short-video day. */
function day(install: string): LumenTestEvent[] {
  const o = { install, receivedAt: '2026-10-20T10:00:00Z' };
  // (the ring names itself on every reading since Gauge 2.7; the fixtures' hr, daily and sleep rows do not)
  const ring = (e: LumenTestEvent): LumenTestEvent => ({ ...e, data: { ...e.data, device_key: RING_ID.device_key } });
  return [
    ...Array.from({ length: 20 }, (_, i) => ringSteps(at(i), 5, {}, o)), // 100 ring steps, 01:00–01:20
    ring(activityDaily('2026-10-19T18:30:00Z', 100, o)),
    ...Array.from({ length: 6 }, (_, i) => ring(hr(at(i * 5), 60 + i, o))),
    ring(sleepPacket(at(-300), ['light', 'deep', 'deep', 'rem'], o)),
    ...Array.from({ length: 10 }, (_, i) => phoneSteps(at(60 + i), at(61 + i), 10, {}, o)), // 100 phone steps, 02:00–02:10
    phoneAcquisition(at(55), at(75), 'listening', o),
    hcRecord('Steps', 'hc-1', at(120), at(130), { count: 50 }, { origin: 'com.google.android.apps.fitness', native: false }, o), // Fit's, 03:00–03:10
    shortVideo('2026-10-20', at(200), { instagram: 12, youtube: 3 }, {}, o),
  ];
}
/** The same events as another installation sends them: the same ids (the id is the content's), its own `source`. */
const asInstall = (events: readonly LumenTestEvent[], install: string, extra: (e: LumenTestEvent) => Record<string, unknown> = () => ({}), receivedAt?: string): LumenTestEvent[] =>
  events.map((e) => {
    const x = extra(e);
    const changed = Object.keys(x).length > 0;
    return {
      ...e, source: `urn:pulseloop:installation:${install}`, ...(changed ? { id: `pl-${sha(`${e.id}|${JSON.stringify(x)}`)}` } : {}),
      data: { ...e.data, ...x, ...(receivedAt ? { received_at: receivedAt } : {}) },
    };
  });

function readAll(store: LumenStore) {
  const tools = lumenToolSet(() => store, 'UTC', () => NOW);
  const run = async (name: string, args: Record<string, unknown>) => ((await tools.call(name, args)) as unknown as { ok: boolean; data: Json }).data;
  return (async () => {
    const steps = await run('gauge_steps', { from: '2026-10-20', to: '2026-10-20' });
    const act = await run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' });
    const series = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20' });
    const hrDay = await run('gauge_metric_series', { kind: 'hr', from: '2026-10-20', to: '2026-10-20', bucket: 'day' });
    const hc = await run('gauge_hc', { type: 'Steps', from: '2026-10-20', to: '2026-10-20' });
    const sv = await run('gauge_short_video', { from: '2026-10-20', to: '2026-10-20' });
    const sleep = store.all<{ n: number }>('SELECT COUNT(*) AS n FROM sleep_timeline')[0]!.n;
    // the records each category reads as: the current ones (Health Connect: the latest revisions, short video: one per date)
    const n = (sql: string) => store.all<{ n: number }>(sql)[0]!.n;
    const cur = (c: string) => n(`SELECT COUNT(*) AS n FROM event_state WHERE category = '${c}' AND current = 1`);
    const counts: Record<string, number> = {
      'activity/buckets': cur('activity/buckets'), 'activity/daily': cur('activity/daily'), 'metrics/hr': cur('metrics/hr'), 'sleep/timeline': cur('sleep/timeline'),
      'activity/phone_steps': cur('activity/phone_steps'), 'hc/record': n('SELECT COUNT(*) AS n FROM hc_records'), 'habits/short_video': n('SELECT COUNT(*) AS n FROM short_video_days'),
    };
    return {
      located: (steps.days[0]?.located ?? 0) as number, headline: (steps.days[0]?.headline ?? 0) as number, bucketSteps: (act.days[0]?.bucketSteps ?? 0) as number,
      intervals: (steps.intervals as Json[]).map((u) => [u.start, u.end, u.lineage, u.steps]),
      hrPoints: (series.points as Json[]).map((p) => [p.at, p.value]), hrCount: (hrDay.points[0]?.count ?? 0) as number,
      hcRecords: (hc.records as Json[]).map((r) => r.id), shortVideo: sv.days as Json[], sleep, counts,
    };
  })();
}

describe('the new installation\'s backfill changes nothing', () => {
  let dir = '';
  const open = () => {
    dir = mkdtempSync(join(TMP, 'r070-store-'));
    const s = openLumenStore(join(dir, 'lumen.db'));
    cleanup.push(() => s.close(), () => rmSync(dir, { recursive: true, force: true }));
    return s;
  };

  it('the old installation alone reads what it uploaded (the baseline the next tests compare with)', async () => {
    const s = open();
    s.ingest(OLD, day(OLD), NOW);
    const r = await readAll(s);
    expect(r.counts).toEqual({ 'activity/buckets': 20, 'activity/daily': 1, 'metrics/hr': 6, 'sleep/timeline': 1, 'activity/phone_steps': 10, 'hc/record': 1, 'habits/short_video': 1 });
    expect(r.bucketSteps).toBe(100);
    expect(r.hcRecords).toEqual(['hc-1']);
    expect(r.hrCount).toBe(6);
    expect(r.located).toBe(100 + 100 + 50);
  });

  it('identical records re-sent by the new installation are duplicates, whichever uploads first', async () => {
    const baseline = open();
    baseline.ingest(OLD, day(OLD), NOW);
    const want = await readAll(baseline);

    const s = open();
    const r = s.ingest(NEW, asInstall(day(OLD), NEW), NOW + 60_000);
    s.ingest(OLD, day(OLD), NOW + 120_000);
    expect(r.rejected).toEqual([]);
    expect(await readAll(s)).toEqual(want);
    // and the other way round: the old installation's late backlog after the new one's full re-sync
    const again = s.ingest(OLD, day(OLD), NOW + 180_000);
    expect([again.accepted, again.duplicates]).toEqual([0, day(OLD).length]);
    expect(await readAll(s)).toEqual(want);
    // identical content is stored once: nothing but the first sender's rows
    expect(s.all<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0]!.n).toBe(day(OLD).length);
  });

  it('records the new installation read differently (another decoder, received later, a Health Connect revision) are the same record', async () => {
    const baseline = open();
    baseline.ingest(OLD, day(OLD), NOW);
    const want = await readAll(baseline);

    const s = open();
    s.ingest(OLD, day(OLD), NOW);
    // the engine's decoder names itself differently and re-reads the ring's history: new ids, the same ring and instants
    const changed = asInstall(day(OLD), NEW, (e) => (e.category === 'hc/record' || e.category === 'activity/phone_steps' || e.category === 'phone/acquisition' || e.category === 'habits/short_video' ? {} : { decoder_version: 'gauge-2301/3' }), '2026-10-21T00:30:00Z');
    const out = s.ingest(NEW, changed, NOW + 3_600_000);
    expect(out.rejected).toEqual([]);
    const got = await readAll(s);
    // nothing is counted twice: the same minutes, readings, records and days as before
    expect(got.located).toBe(want.located);
    expect(got.headline).toBe(want.headline);
    expect(got.bucketSteps).toBe(want.bucketSteps);
    expect(got.hrPoints).toEqual(want.hrPoints);
    expect(got.hrCount).toBe(6);
    expect(got.sleep).toBe(1);
    expect(got.counts).toEqual(want.counts);
    expect(got.hcRecords).toEqual(['hc-1']);
    expect(got.shortVideo).toHaveLength(1);
    // the ring's minutes are the new copy (received last), still one per minute
    expect(s.all<{ n: number }>("SELECT COUNT(*) AS n FROM ring_step_intervals WHERE subject = 'ring_steps'")[0]!.n).toBe(20);
    expect(s.all<{ d: string }>("SELECT DISTINCT json_extract(data, '$.decoder_version') AS d FROM ring_step_intervals WHERE subject = 'ring_steps'")).toEqual([{ d: 'gauge-2301/3' }]);
  });

  it('phone counter spans the two installations both read are one record; differently cut spans over the same minutes count once', async () => {
    const s = open();
    s.ingest(OLD, day(OLD), NOW);
    const before = await readAll(s);
    // the same counter spans with another count (the engine's own shares), under the same boot and counter timestamps
    const o = { install: NEW, receivedAt: '2026-10-21T00:10:00Z' };
    s.ingest(NEW, Array.from({ length: 10 }, (_, i) => phoneSteps(at(60 + i), at(61 + i), 12, {}, o)), NOW + 600_000);
    let r = await readAll(s);
    expect(r.counts['activity/phone_steps']).toBe(10);
    expect(r.located).toBe(before.located + 20); // 10 spans × (12 − 10): replaced, not added
    // spans cut differently (30 s spans across the same minutes) overlap them: the fusion keeps one track, never both
    s.ingest(NEW, Array.from({ length: 20 }, (_, i) => phoneSteps(iso(D0 + 60 * 60_000 + i * 30_000), iso(D0 + 60 * 60_000 + (i + 1) * 30_000), 6, { support: 'minute' }, { install: NEW, receivedAt: '2026-10-21T00:20:00Z' })), NOW + 1_200_000);
    r = await readAll(s);
    expect(r.located).toBeLessThanOrEqual(100 + 120 + 50 + 120); // one phone track at most (the 20 half-minutes read 120): never 120 + 120
    const phone = r.intervals.filter((i) => i[2] === 'phone');
    for (let k = 1; k < phone.length; k++) expect((phone[k]![0] as string) >= (phone[k - 1]![1] as string)).toBe(true); // disjoint
  });

  it('a short-video day: the last write wins whichever installation sent it', async () => {
    const s = open();
    s.ingest(OLD, [shortVideo('2026-10-20', at(200), { instagram: 12 }, {}, { install: OLD, receivedAt: '2026-10-20T10:00:00Z' })], NOW);
    s.ingest(NEW, [shortVideo('2026-10-20', at(210), { instagram: 14, youtube: 1 }, {}, { install: NEW, receivedAt: '2026-10-20T11:00:00Z' })], NOW + 60_000);
    let r = await readAll(s);
    expect(r.shortVideo).toEqual([expect.objectContaining({ date: '2026-10-20', counts: { instagram: 14, youtube: 1 }, total: 15 })]);
    // a late backlog from the old installation, received earlier, does not bring the day back
    s.ingest(OLD, [shortVideo('2026-10-20', at(205), { instagram: 13 }, {}, { install: OLD, receivedAt: '2026-10-20T10:30:00Z' })], NOW + 120_000);
    r = await readAll(s);
    expect(r.shortVideo).toHaveLength(1);
    expect(r.shortVideo[0]).toMatchObject({ counts: { instagram: 14, youtube: 1 } });
  });

  it('Health Connect: the same record id from both installations is one record, and one tombstone retracts it', async () => {
    const s = open();
    const rec = (install: string, count: number, lm: string, recv: string) => hcRecord('Steps', 'hc-9', at(120), at(130), { count }, { lastModified: lm, origin: 'com.google.android.apps.fitness', native: false }, { install, receivedAt: recv });
    s.ingest(OLD, [rec(OLD, 50, at(130), '2026-10-20T10:00:00Z')], NOW);
    s.ingest(NEW, [rec(NEW, 55, at(140), '2026-10-21T00:10:00Z')], NOW + 1000);
    const hc = async () => (await readAll(s)).hcRecords;
    expect(await hc()).toEqual(['hc-9']);
    expect(s.all<{ c: number }>("SELECT json_extract(payload, '$.count') AS c FROM hc_records")).toEqual([{ c: 55 }]); // the latest revision, from either
    // the step fusion counts it once
    const steps = await lumenToolSet(() => s, 'UTC', () => NOW).call('gauge_steps', { from: '2026-10-20', to: '2026-10-20' });
    expect((steps as unknown as { data: Json }).data.days[0].located).toBe(55);
    s.ingest(NEW, [lumenEvent('hc/deleted', 'Steps:hc-9', 'com.pulseloop.hc.deleted.v1', at(150), { record_type: 'Steps' }, { install: NEW })], NOW + 2000);
    expect(await hc()).toEqual([]);
  });

  it('the new installation\'s re-send brings back what the old one\'s reset hid (a re-delivery counts from any installation)', async () => {
    const s = open();
    s.ingest(OLD, day(OLD), NOW);
    s.ingest(OLD, [deletion('2026-10-21T01:00:00Z', { category: '*' }, { install: OLD })], Date.parse('2026-10-21T01:00:00Z'));
    expect((await readAll(s)).bucketSteps).toBe(0);
    const out = s.ingest(NEW, asInstall(day(OLD), NEW, () => ({}), '2026-10-21T02:00:00Z'), Date.parse('2026-10-21T02:00:00Z'));
    expect(out.accepted).toBe(0);
    const r = await readAll(s);
    expect(r.bucketSteps).toBe(100);
    expect(r.hrCount).toBe(6);
    expect(r.located).toBe(250);
  });

  it('a Gauge deletion of the old installation hides only its own rows; the other installation\'s version of the record stays', async () => {
    const s = open();
    const o = (install: string, recv: string) => ({ install, receivedAt: recv });
    s.ingest(OLD, [ringSteps(at(0), 5, {}, o(OLD, '2026-10-20T10:00:00Z'))], NOW);
    s.ingest(NEW, asInstall([ringSteps(at(0), 5, {}, o(NEW, '2026-10-20T10:00:00Z'))], NEW, () => ({ decoder_version: 'gauge-2301/3' }), '2026-10-21T00:30:00Z'), NOW + 1000);
    expect((await readAll(s)).bucketSteps).toBe(5);
    expect(s.ingest(NEW, [deletion('2026-10-22T00:00:00Z', { category: 'activity/buckets', from: at(-10), to: at(10) }, { install: NEW })], Date.parse('2026-10-22T00:00:00Z')).rejected).toEqual([]);
    // the new installation's copy is hidden by its own deletion; the old installation's remains and is current again
    expect((await readAll(s)).bucketSteps).toBe(5);
    expect(s.all<{ installation_id: string }>("SELECT installation_id FROM ring_step_intervals WHERE subject = 'ring_steps'")).toEqual([{ installation_id: OLD }]);
  });
});
