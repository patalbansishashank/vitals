// @vitest-environment node
/**
 * The command channel from Vitals to Gauge (energy SPEC §A.4): idempotent enqueue, coalescing and supersession, expiry
 * by the sweep and the clock, the 30 s lease, write-once acks, held polls and watches, cancel, the token kinds, person
 * isolation, the pending cap, logs without payloads and the CORS preflight.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { MAX_PENDING } from './commandStore.ts';
import type { PersonRequest, PersonResponse } from './personRpc.ts';
import type { WorkerFactory } from './workers.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const SITE = 'https://vitals.creative.desi';
const NOW = Date.parse('2026-10-27T04:00:00Z');
const INSTALL = '0123456789abcdef0123456789abcdef';
const INSTALL_2 = 'fedcba9876543210fedcba9876543210';
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;
/** Letters only for random test IDs; the hygiene test uses fixed IDs with numeric collisions. */
const newId = () => `cmd-${Array.from({ length: 16 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;

async function boot() {
  const dataDir = mkdtempSync(join(TMP, 'commands-'));
  const clock = { now: NOW };
  const lines: string[] = [];
  const factory: WorkerFactory = async () => ({
    async call(_req: PersonRequest): Promise<PersonResponse> {
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false, log: (l: string) => void lines.push(l),
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: factory, now: () => clock.now },
  });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
  const home = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; origin?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.origin) headers.origin = init.origin;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, redirect: 'manual', ...(init.signal ? { signal: init.signal } : {}), ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    return { status: r.status, text, body: (text ? JSON.parse(text) : null) as Json, headers: r.headers };
  };
  const person = async (label = 'Ana') => {
    const p = await home.persons.add({ label, timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(label.length), relayUrl: null });
    const { code } = await home.devices.issueCode(p.id);
    const d = await call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code, label: 'Phone' } });
    return { id: p.id, device: d.body.token as string };
  };
  const pairGauge = async (personId: string, installationId = INSTALL) => {
    const { code } = await home.devices.issueCode(personId);
    return (await call('/v1/lumen/pair', { method: 'POST', body: { code, installationId, deviceName: 'Pixel', appVersion: '2.8.0' } })).body.token as string;
  };
  const send = (device: string, body: Json) => call('/v1/gauge/commands', { method: 'POST', token: device, origin: SITE, body });
  /** A Gauge poll; the clock moves 2 s first (one poll per 2 s). */
  const poll = async (lumen: string, wait = 0) => {
    clock.now += 2000;
    return call(`/v1/lumen/commands?wait=${wait}`, { token: lumen });
  };
  const ack = (lumen: string, id: string, body: Json) => call(`/v1/lumen/commands/${id}/ack`, { method: 'POST', token: lumen, body });
  const get = (device: string, id: string, q = '') => call(`/v1/gauge/commands/${id}${q}`, { token: device, origin: SITE });
  return { c, home, call, person, pairGauge, send, poll, ack, get, clock, lines };
}

async function paired() {
  const t = await boot();
  const ana = await t.person('Ana');
  const lumen = await t.pairGauge(ana.id);
  return { ...t, ana, lumen };
}

describe('enqueue', () => {
  it('creates a command, then answers a retry with the same id and body from the store', async () => {
    const t = await paired();
    const id = newId();
    const body = { id, type: 'workout.start', payload: { type: 'walk' } };
    const first = await t.send(t.ana.device, body);
    expect(first.status).toBe(201);
    expect(first.body.command).toMatchObject({ id, type: 'workout.start', state: 'queued', installationId: INSTALL, attempt: 0 });
    expect(Date.parse(first.body.command.expiresAt) - Date.parse(first.body.command.issuedAt)).toBe(60_000);
    expect(first.body.online).toBe(false);
    // key order does not matter
    const again = await t.send(t.ana.device, { payload: { type: 'walk' }, type: 'workout.start', id });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ deduped: true, command: { id, state: 'queued' } });
    const other = await t.send(t.ana.device, { id, type: 'workout.start', payload: { type: 'run' } });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('id_reused');
  });

  it('checks the closed schemas and the time to live', async () => {
    const t = await paired();
    const cases: Json[] = [
      { id: 'short', type: 'hr.measure' },
      { id: 'commands-state-xx/1', type: 'hr.measure' },
      { id: newId(), type: 'ring.reboot' },
      { id: newId(), type: 'reels.set', payload: {} },
      { id: newId(), type: 'reels.set', payload: { dailyLimit: 0 } },
      { id: newId(), type: 'reels.set', payload: { dailyLimit: 501 } },
      { id: newId(), type: 'reels.set', payload: { countdownSeconds: 2 } },
      { id: newId(), type: 'reels.set', payload: { apps: ['tiktok'] } },
      { id: newId(), type: 'reels.set', payload: { apps: ['instagram', 'instagram'] } },
      { id: newId(), type: 'reels.set', payload: { disclosureAccepted: true } },
      { id: newId(), type: 'workout.start', payload: { type: 'swim' } },
      { id: newId(), type: 'workout.start', payload: {} },
      { id: newId(), type: 'workout.start', payload: { type: 'cycle', activityTypeId: 'Air Bike' } },
      { id: newId(), type: 'workout.start', payload: { type: 'cycle', activityTypeId: 7 } },
      { id: newId(), type: 'workout.start', payload: { type: 'cycle', activityTypeId: 'x'.repeat(49) } },
      { id: newId(), type: 'workout.stop', payload: { sessionId: 'a b' } },
      { id: newId(), type: 'hr.measure', payload: { bpm: 60 } },
      { id: newId(), type: 'hr.measure', extra: 1 },
      { id: newId(), type: 'update.check', occurredAt: 'yesterday' },
    ];
    for (const body of cases) {
      const r = await t.send(t.ana.device, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe('bad_command');
    }
    // a shorter TTL is kept, a longer one is cut to the type's default
    const short = await t.send(t.ana.device, { id: newId(), type: 'update.check', ttlS: 10 });
    expect(Date.parse(short.body.command.expiresAt) - NOW).toBe(10_000);
    const long = await t.send(t.ana.device, { id: newId(), type: 'workout.pause', ttlS: 9999 });
    expect(Date.parse(long.body.command.expiresAt) - NOW).toBe(120_000);
    // occurredAt is advisory and clamped to ±5 min
    const occurred = await t.send(t.ana.device, { id: newId(), type: 'reels.set', payload: { dailyLimit: 20 }, occurredAt: '2020-01-01T00:00:00Z' });
    expect(occurred.body.command.occurredAt).toBe(new Date(NOW - 5 * 60_000).toISOString());
  });

  it('needs a paired Gauge, and names one when there are two', async () => {
    const t = await boot();
    const ana = await t.person('Ana');
    expect((await t.send(ana.device, { id: newId(), type: 'hr.measure' })).body.error).toBe('no_gauge');
    await t.pairGauge(ana.id, INSTALL);
    await t.pairGauge(ana.id, INSTALL_2);
    const r = await t.send(ana.device, { id: newId(), type: 'hr.measure' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('ambiguous_target');
    expect((await t.send(ana.device, { id: newId(), type: 'hr.measure', installationId: 'aaaaaaaabbbbbbbb' })).status).toBe(404);
    expect((await t.send(ana.device, { id: newId(), type: 'hr.measure', installationId: INSTALL_2 })).status).toBe(201);
  });

  it('answers a retry of a known id from the store even after a second Gauge paired (claude-core F17)', async () => {
    const t = await paired();
    const body = { id: newId(), type: 'hr.measure' };
    expect((await t.send(t.ana.device, body)).status).toBe(201);
    await t.pairGauge(t.ana.id, INSTALL_2);
    const again = await t.send(t.ana.device, body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ deduped: true, command: { id: body.id, installationId: INSTALL } });
    // naming another installation for the same id is still a different command
    expect((await t.send(t.ana.device, { ...body, installationId: INSTALL_2 })).body.error).toBe('id_reused');
    // a new id still has to name its Gauge
    expect((await t.send(t.ana.device, { id: newId(), type: 'hr.measure' })).body.error).toBe('ambiguous_target');
  });

  it('coalesces a pending measurement or update check, and supersedes older Reels settings', async () => {
    const t = await paired();
    const hr1 = await t.send(t.ana.device, { id: newId(), type: 'hr.measure' });
    const hr2 = await t.send(t.ana.device, { id: newId(), type: 'hr.measure' });
    expect(hr2.status).toBe(200);
    expect(hr2.body).toMatchObject({ coalesced: true, command: { id: hr1.body.command.id } });
    const u1 = await t.send(t.ana.device, { id: newId(), type: 'update.check' });
    const u2 = await t.send(t.ana.device, { id: newId(), type: 'update.check' });
    expect(u2.body.command.id).toBe(u1.body.command.id);

    const r1 = await t.send(t.ana.device, { id: newId(), type: 'reels.set', payload: { dailyLimit: 20 } });
    const r2 = await t.send(t.ana.device, { id: newId(), type: 'reels.set', payload: { dailyLimit: 25, apps: ['youtube'] } });
    expect(r2.status).toBe(201);
    expect((await t.get(t.ana.device, r1.body.command.id)).body.command.state).toBe('superseded');
    const delivered = (await t.poll(t.lumen)).body.commands as Json[];
    expect(delivered.map((c) => c.type)).toEqual(['hr.measure', 'update.check', 'reels.set']);
    expect(delivered[2]).toMatchObject({ id: r2.body.command.id, payload: { dailyLimit: 25, apps: ['youtube'] }, attempt: 1 });
    // once done, a new measurement is a new command
    await t.ack(t.lumen, hr1.body.command.id, { status: 'done', result: { bpm: 61, observedAt: new Date(NOW).toISOString() } });
    expect((await t.send(t.ana.device, { id: newId(), type: 'hr.measure' })).status).toBe(201);
  });

  it('caps the pending commands of a person', async () => {
    const t = await paired();
    for (let i = 0; i < MAX_PENDING; i++) expect((await t.send(t.ana.device, { id: newId(), type: 'workout.pause' })).status).toBe(201);
    const r = await t.send(t.ana.device, { id: newId(), type: 'workout.pause' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('too_many_pending');
  });

  it('limits enqueues to 30 a minute per Vitals device', async () => {
    const t = await paired();
    let limited = 0;
    for (let i = 0; i < 32; i++) {
      const r = await t.send(t.ana.device, { id: newId(), type: 'reels.set', payload: { dailyLimit: 10 + i } });
      if (r.status === 429) {
        limited++;
        expect(r.body.error).toBe('rate_limited');
        expect(r.headers.get('retry-after')).toBeTruthy();
      }
    }
    expect(limited).toBe(2);
  });
});

describe('delivery and acks', () => {
  it('delivers in seq order with the server clock, re-offers after the 30 s lease, and keeps terminal acks write-once', async () => {
    const t = await paired();
    const a = (await t.send(t.ana.device, { id: newId(), type: 'workout.start', payload: { type: 'run', useGps: true } })).body.command;
    const b = (await t.send(t.ana.device, { id: newId(), type: 'reels.set', payload: { enabled: false } })).body.command;
    const p1 = await t.poll(t.lumen);
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ personId: t.ana.id, maxWaitS: 25, now: new Date(t.clock.now).toISOString() });
    expect(p1.body.commands.map((c: Json) => c.id)).toEqual([a.id, b.id]);
    expect(p1.body.commands[0].seq).toBeLessThan(p1.body.commands[1].seq);
    expect((await t.get(t.ana.device, a.id)).body.command.state).toBe('delivered');
    // inside the lease nothing is offered again
    expect((await t.poll(t.lumen)).body.commands).toEqual([]);
    await t.ack(t.lumen, b.id, { status: 'done', result: { applied: { enabled: false } } });
    t.clock.now += 30_000;
    const p2 = await t.poll(t.lumen);
    expect(p2.body.commands).toEqual([expect.objectContaining({ id: a.id, attempt: 2 })]);

    const result = { state: 'recording', sessionId: 'w-1', type: 'run', startedAt: new Date(t.clock.now).toISOString() };
    expect((await t.ack(t.lumen, a.id, { status: 'done', result })).status).toBe(204);
    expect((await t.ack(t.lumen, a.id, { status: 'done', result })).status).toBe(204);
    const conflict = await t.ack(t.lumen, a.id, { status: 'failed', code: 'failed' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('already_terminal');
    expect((await t.get(t.ana.device, a.id)).body).toMatchObject({ terminal: true, command: { state: 'done', result } });
    expect((await t.ack(t.lumen, 'no-such-command-0000', { status: 'done' })).status).toBe(404);
    expect((await t.ack(t.lumen, a.id, { status: 'finished' })).status).toBe(400);
  });

  it('lets a measurement go running, then times it out after 90 s without a final ack', async () => {
    const t = await paired();
    const hr = (await t.send(t.ana.device, { id: newId(), type: 'hr.measure' })).body.command;
    await t.poll(t.lumen);
    expect((await t.ack(t.lumen, hr.id, { status: 'running' })).status).toBe(204);
    // running is never re-offered, and the TTL no longer applies
    t.clock.now += 70_000;
    expect((await t.poll(t.lumen)).body.commands).toEqual([]);
    expect((await t.get(t.ana.device, hr.id)).body.command.state).toBe('running');
    t.clock.now += 30_000;
    expect((await t.get(t.ana.device, hr.id)).body.command).toMatchObject({ state: 'failed', code: 'timeout' });
  });

  it('expires unacked commands by the sweep and on read; a late Gauge answer never rewrites that terminal expiry (Codex #18)', async () => {
    const t = await paired();
    const start = (await t.send(t.ana.device, { id: newId(), type: 'workout.start', payload: { type: 'walk' } })).body.command;
    const stop = (await t.send(t.ana.device, { id: newId(), type: 'workout.stop' })).body.command;
    t.clock.now += 61_000;
    t.home.commands.sweepNow();
    expect((await t.get(t.ana.device, start.id)).body.command.state).toBe('expired');
    // the stop lives 30 min
    expect((await t.get(t.ana.device, stop.id)).body.command.state).toBe('queued');
    const p = await t.poll(t.lumen);
    expect(p.body.commands.map((c: Json) => c.id)).toEqual([stop.id]);
    t.clock.now += 31 * 60_000;
    expect((await t.get(t.ana.device, stop.id)).body.command.state).toBe('expired');
    // terminal acks are write-once, the sweep's expiry included: a late answer from a Gauge that held it is 409
    const late = await t.ack(t.lumen, stop.id, { status: 'done', result: { state: 'idle', sessionId: 'w-1' } });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('already_terminal');
    expect((await t.get(t.ana.device, stop.id)).body.command.state).toBe('expired');
    // a never-delivered expiry stays
    expect((await t.ack(t.lumen, start.id, { status: 'done' })).status).toBe(409);
  });

  it('cancels only while queued', async () => {
    const t = await paired();
    const a = (await t.send(t.ana.device, { id: newId(), type: 'update.check' })).body.command;
    const del = await t.call(`/v1/gauge/commands/${a.id}`, { method: 'DELETE', token: t.ana.device, origin: SITE });
    expect(del.status).toBe(200);
    expect(del.body.command.state).toBe('cancelled');
    expect((await t.poll(t.lumen)).body.commands).toEqual([]);
    const b = (await t.send(t.ana.device, { id: newId(), type: 'update.check' })).body.command;
    await t.poll(t.lumen);
    const late = await t.call(`/v1/gauge/commands/${b.id}`, { method: 'DELETE', token: t.ana.device, origin: SITE });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('already_delivered');
  });

  it('lists recent commands newest first, filtered by type and state', async () => {
    const t = await paired();
    const a = (await t.send(t.ana.device, { id: newId(), type: 'update.check' })).body.command;
    const b = (await t.send(t.ana.device, { id: newId(), type: 'reels.set', payload: { dailyLimit: 9 } })).body.command;
    const list = await t.call('/v1/gauge/commands?limit=5', { token: t.ana.device, origin: SITE });
    expect(list.body.commands.map((c: Json) => c.id)).toEqual([b.id, a.id]);
    expect((await t.call('/v1/gauge/commands?type=reels.set', { token: t.ana.device, origin: SITE })).body.commands.map((c: Json) => c.id)).toEqual([b.id]);
    expect((await t.call('/v1/gauge/commands?state=done', { token: t.ana.device, origin: SITE })).body.commands).toEqual([]);
    expect((await t.call('/v1/gauge/commands?limit=500', { token: t.ana.device, origin: SITE })).status).toBe(400);
  });
});

describe('holding requests', () => {
  it('holds a poll until a command is enqueued, and answers wait=0 at once', async () => {
    const t = await paired();
    const t0 = Date.now();
    const empty = await t.poll(t.lumen, 0);
    expect(empty.body.commands).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);

    const held = t.poll(t.lumen, 10);
    await new Promise((r) => setTimeout(r, 150));
    const id = newId();
    const started = Date.now();
    await t.send(t.ana.device, { id, type: 'hr.measure' });
    const r = await held;
    expect(r.body.commands.map((c: Json) => c.id)).toEqual([id]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ends an empty hold after `wait` seconds', async () => {
    const t = await paired();
    const t0 = Date.now();
    const r = await t.poll(t.lumen, 1);
    expect(r.body.commands).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it('holds a Vitals watch while the state equals `since`, and wakes it on the ack', async () => {
    const t = await paired();
    const id = (await t.send(t.ana.device, { id: newId(), type: 'hr.measure' })).body.command.id as string;
    await t.poll(t.lumen);
    const watch = t.get(t.ana.device, id, '?wait=10&since=delivered');
    await new Promise((r) => setTimeout(r, 150));
    await t.ack(t.lumen, id, { status: 'running' });
    const r = await watch;
    expect(r.body).toMatchObject({ terminal: false, online: true, command: { state: 'running' } });
    // a different state answers at once
    expect((await t.get(t.ana.device, id, '?wait=10&since=queued')).body.command.state).toBe('running');
    expect((await t.get(t.ana.device, id, '?wait=99')).status).toBe(400);
  });

  it('enforces one poll per 2 s', async () => {
    const t = await paired();
    expect((await t.poll(t.lumen)).status).toBe(200);
    const r = await t.call('/v1/lumen/commands?wait=0', { token: t.lumen });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
});

describe('Gauge state', () => {
  it('reports online from the last poll and the state Gauge posted', async () => {
    const t = await paired();
    const before = await t.call('/v1/gauge/commands/state', { token: t.ana.device, origin: SITE });
    expect(before.body).toMatchObject({ paired: true, online: false, lastPollAt: null, reels: null, recording: null, serverNow: new Date(NOW).toISOString() });
    await t.poll(t.lumen);
    const reels = { enabled: true, dailyLimit: 30, countdownSeconds: 5, apps: ['instagram', 'youtube'] };
    const recording = { sessionId: 'w-9', status: 'recording', type: 'walk', startedAt: new Date(NOW).toISOString() };
    const post = await t.call('/v1/lumen/commands/state', { method: 'POST', token: t.lumen, body: { appVersion: '2.8.0', capabilities: ['reels.set', 'hr.measure', 'made.up'], reels, recording } });
    expect(post.status).toBe(204);
    const s = await t.call('/v1/gauge/commands/state', { token: t.ana.device, origin: SITE });
    expect(s.body).toMatchObject({ online: true, appVersion: '2.8.0', capabilities: ['reels.set', 'hr.measure'], reels, recording, installationId: INSTALL });
    // the recording ends; reels left out keep their last value
    await t.call('/v1/lumen/commands/state', { method: 'POST', token: t.lumen, body: { appVersion: '2.8.0', capabilities: [], recording: null } });
    expect((await t.call('/v1/gauge/commands/state', { token: t.ana.device, origin: SITE })).body).toMatchObject({ reels, recording: null });
    t.clock.now += 56_000;
    expect((await t.call('/v1/gauge/commands/state', { token: t.ana.device, origin: SITE })).body.online).toBe(false);
    expect((await t.call('/v1/lumen/commands/state', { method: 'POST', token: t.lumen, body: { appVersion: '2.8.0', capabilities: [], reels: { enabled: 'yes' } } })).status).toBe(400);
  });
});

describe('tokens and isolation', () => {
  it('refuses the wrong token kind on each side', async () => {
    const t = await paired();
    const agent = (await t.home.devices.mint(t.ana.id, { kind: 'agent', label: 'Agent', scope: 'write' })).token;
    const enqueue = await t.send(agent, { id: newId(), type: 'hr.measure' });
    expect(enqueue.status).toBe(403);
    expect(enqueue.body.error).toBe('wrong_kind');
    expect((await t.call('/v1/gauge/commands/state', { token: t.lumen })).status).toBe(403);
    expect((await t.call('/v1/gauge/commands', { method: 'POST', token: t.lumen, body: { id: newId(), type: 'hr.measure' } })).status).toBe(403);
    expect((await t.call('/v1/lumen/commands?wait=0', { token: t.ana.device, origin: SITE })).status).toBe(403);
    expect((await t.call('/v1/lumen/commands?wait=0', { token: agent })).status).toBe(403);
    expect((await t.call('/v1/lumen/commands?wait=0')).status).toBe(401);
    // revoking the Gauge token stops delivery
    await t.call('/v1/lumen/unpair', { method: 'POST', token: t.lumen, body: {} });
    expect((await t.poll(t.lumen)).status).toBe(401);
  });

  it('keeps each person’s commands to their own Gauge', async () => {
    const t = await boot();
    const ana = await t.person('Ana');
    const bo = await t.person('Bo');
    const anaGauge = await t.pairGauge(ana.id, INSTALL);
    const boGauge = await t.pairGauge(bo.id, INSTALL_2);
    const a = (await t.send(ana.device, { id: newId(), type: 'hr.measure' })).body.command;
    expect((await t.poll(boGauge)).body.commands).toEqual([]);
    expect((await t.get(bo.device, a.id)).status).toBe(404);
    expect((await t.ack(boGauge, a.id, { status: 'done' })).status).toBe(404);
    expect((await t.poll(anaGauge)).body.commands.map((c: Json) => c.id)).toEqual([a.id]);
    // the same id is free for another person (each person has their own store)
    expect((await t.send(bo.device, { id: a.id, type: 'update.check' })).status).toBe(201);
  });
});

describe('hygiene', () => {
  it('never logs a payload, a result or a detail', async () => {
    const t = await paired();
    // These legal command IDs contain the numeric payload values on purpose: IDs are safe to log, values are not.
    const id = 'cmd-hygiene-417-id';
    await t.send(t.ana.device, { id, type: 'reels.set', payload: { dailyLimit: 417, apps: ['youtube'] } });
    await t.poll(t.lumen);
    await t.ack(t.lumen, id, { status: 'done', detail: 'secret-detail', result: { applied: { dailyLimit: 417 } } });
    const hr = 'cmd-hygiene-173-id';
    await t.send(t.ana.device, { id: hr, type: 'hr.measure' });
    await t.poll(t.lumen);
    await t.ack(t.lumen, hr, { status: 'done', result: { bpm: 173, observedAt: new Date(NOW).toISOString() } });
    const log = t.lines.join('\n');
    expect(log).toContain(id);
    expect(log).toContain(hr);
    expect(log).toContain('reels.set');
    expect(log).toContain('hr.measure');
    for (const secret of ['youtube', 'secret-detail', t.ana.device, t.lumen]) expect(log).not.toContain(secret);
    // Strip only known metadata IDs, whose random digits can otherwise match a short secret by chance.
    const deviceIds = (await t.home.devices.list(t.ana.id)).map((d) => d.id);
    let contentLog = log;
    for (const metadataId of [t.ana.id, ...deviceIds, id, hr]) contentLog = contentLog.replaceAll(metadataId, '[id]');
    for (const secret of ['417', '173']) expect(contentLog).not.toContain(secret);
  });

  it('answers the CORS preflight on the Vitals paths', async () => {
    const t = await paired();
    for (const path of ['/v1/gauge/commands', '/v1/gauge/commands/state', '/v1/gauge/commands/abcdefghijklmnop']) {
      const r = await t.call(path, { method: 'OPTIONS', origin: SITE, headers: { 'access-control-request-method': 'POST' } });
      expect(r.status).toBe(204);
      expect(r.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE');
      expect(r.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
      expect(r.headers.get('access-control-allow-origin')).toBe(SITE);
    }
  });

  it('leaves the other Gauge routes to their owners', async () => {
    const t = await paired();
    expect((await t.call('/v1/gauge/availability', { token: t.ana.device, origin: SITE })).status).toBe(200);
    expect((await t.call('/v1/lumen/status', { token: t.lumen })).status).toBe(200);
  });
});

describe('the recording activity (0.6.3 S26)', () => {
  it('takes a catalogue activityTypeId on workout.start, hands it to Gauge, and keeps Gauge\'s feature token', async () => {
    const t = await paired();
    const a = await t.send(t.ana.device, { id: newId(), type: 'workout.start', payload: { type: 'cycle', useGps: false, activityTypeId: 'air_bike' } });
    expect(a.status).toBe(201);
    const p = await t.poll(t.lumen);
    expect(p.body.commands[0].payload).toEqual({ type: 'cycle', useGps: false, activityTypeId: 'air_bike' });
    const state = { appVersion: '2.8.1', capabilities: ['workout.start', 'workout.start.activity_type_id', 'made.up'], recording: null };
    expect((await t.call('/v1/lumen/commands/state', { method: 'POST', token: t.lumen, body: state })).status).toBe(204);
    const s = await t.call('/v1/gauge/commands/state', { token: t.ana.device, origin: SITE });
    expect(s.body.capabilities).toEqual(['workout.start', 'workout.start.activity_type_id']);
  });
});

describe('a ring sync asked from another device (r068 B2)', () => {
  it('takes ring.sync with no payload, coalesces a pending one, lets it run up to 3 min, and keeps the capability', async () => {
    const t = await paired();
    expect((await t.send(t.ana.device, { id: newId(), type: 'ring.sync', payload: { days: 2 } })).body.error).toBe('bad_command');
    const a = await t.send(t.ana.device, { id: newId(), type: 'ring.sync' });
    expect(a.status).toBe(201);
    expect(Date.parse(a.body.command.expiresAt) - NOW).toBe(120_000);
    const b = await t.send(t.ana.device, { id: newId(), type: 'ring.sync' });
    expect(b.body).toMatchObject({ coalesced: true, command: { id: a.body.command.id } });
    const p = await t.poll(t.lumen);
    expect(p.body.commands).toEqual([expect.objectContaining({ id: a.body.command.id, type: 'ring.sync', payload: {} })]);
    expect((await t.ack(t.lumen, a.body.command.id, { status: 'running' })).status).toBe(204);
    // a history sync plus the upload outlasts the 90 s a measurement gets
    t.clock.now += 150_000;
    expect((await t.get(t.ana.device, a.body.command.id)).body.command.state).toBe('running');
    const result = { syncedAt: new Date(t.clock.now).toISOString(), complete: true, uploaded: true };
    expect((await t.ack(t.lumen, a.body.command.id, { status: 'done', result })).status).toBe(204);
    expect((await t.get(t.ana.device, a.body.command.id)).body.command).toMatchObject({ state: 'done', result });
    const state = { appVersion: '2.8.4', capabilities: ['hr.measure', 'ring.sync'], recording: null };
    expect((await t.call('/v1/lumen/commands/state', { method: 'POST', token: t.lumen, body: state })).status).toBe(204);
    expect((await t.call('/v1/gauge/commands/state', { token: t.ana.device, origin: SITE })).body.capabilities).toEqual(['hr.measure', 'ring.sync']);
  });

  it('fails a sync that never finishes after 3 min', async () => {
    const t = await paired();
    const a = (await t.send(t.ana.device, { id: newId(), type: 'ring.sync' })).body.command;
    await t.poll(t.lumen);
    await t.ack(t.lumen, a.id, { status: 'running' });
    t.clock.now += 181_000;
    expect((await t.get(t.ana.device, a.id)).body.command).toMatchObject({ state: 'failed', code: 'timeout' });
  });

  it('logs when a quiet Gauge polls again, with the gap (and nothing while it keeps polling)', async () => {
    const t = await paired();
    await t.poll(t.lumen);
    await t.poll(t.lumen);
    expect(t.lines.join('\n')).not.toContain('polling again');
    t.clock.now += 600_000;
    await t.poll(t.lumen);
    expect(t.lines.join('\n')).toContain('commands: Gauge polling again after 602 s');
  });
});
