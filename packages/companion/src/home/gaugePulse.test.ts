// @vitest-environment node
/**
 * (r069 sync) The Gauge pulse: `GET /v1/gauge/pulse` answers at once without `since`, holds while `since` is current,
 * wakes when Gauge uploads (readings move `data`, its own status reports only `uploads`), takes only the person's Vitals
 * device tokens and checks its parameters.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startCompanion, type Companion } from '../server.ts';
import { createGaugePulse, readingsOf } from './gaugePulse.ts';
import { battery, hr, INSTALL } from './lumenFixtures.ts';
import type { PersonRequest, PersonResponse } from './personRpc.ts';
import type { WorkerFactory } from './workers.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const SITE = 'https://vitals.creative.desi';
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

async function boot() {
  const dataDir = mkdtempSync(join(TMP, 'gauge-pulse-'));
  const factory: WorkerFactory = async () => ({
    async call(req: PersonRequest): Promise<PersonResponse> {
      if (req.op === 'agentManifest') return { ok: true, value: { format: 'vitals.tools/1', hash: '0', tools: [] } };
      return { ok: true, value: null };
    },
    close: async () => undefined,
  });
  const c: Companion = await startCompanion({
    port: 0, dataDir: join(dataDir, 'relay'), allowedOrigins: [], relay: false,
    home: { dataDir, allowedOrigins: [SITE], publicOrigin: 'https://host.tail0.ts.net:8443', rateLimit: { capacity: 1000, perMinute: 60_000 }, workerFactory: factory },
  });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }), () => c.close());
  const home = c.home!;
  const call = async (path: string, init: { method?: string; token?: string; origin?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.origin) headers.origin = init.origin;
    const r = await fetch(`${c.url}${path}`, { method: init.method ?? 'GET', headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as Json, headers: r.headers };
  };
  const p = await home.persons.add({ label: 'Ana', timeZone: 'Asia/Kolkata', secret: new Uint8Array(32).fill(3), relayUrl: null });
  const device = (await call('/v1/pair/device', { method: 'POST', origin: SITE, body: { code: (await home.devices.issueCode(p.id)).code, label: 'Phone' } })).body.token as string;
  const gauge = (await call('/v1/lumen/pair', { method: 'POST', body: { code: (await home.devices.issueCode(p.id)).code, installationId: INSTALL, deviceName: 'OnePlus CPH2661', appVersion: '2.8.7' } })).body.token as string;
  const upload = async (events: unknown[]) => (await call('/v1/lumen/events', { method: 'POST', token: gauge, body: { installationId: INSTALL, events } })).body;
  return { call, device, gauge, upload };
}

describe('GET /v1/gauge/pulse (r069 sync)', () => {
  it('answers at once without since; a held request wakes on the upload of readings, which moves data and last sent', async () => {
    const t = await boot();
    const first = await t.call('/v1/gauge/pulse', { token: t.device });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.body).toMatchObject({ uploads: 0, data: 0, lastUploadAt: null, dataAt: null });
    expect(first.body.token).toBe(`${first.body.boot}.0.0`);

    const started = Date.now();
    const held = t.call(`/v1/gauge/pulse?since=${first.body.token}&wait=20`, { token: t.device });
    await new Promise((r) => setTimeout(r, 150));
    expect((await t.upload([hr('2026-10-29T11:00:00Z', 61)])).accepted).toBe(1);
    const woke = await held;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(woke.status).toBe(200);
    expect(woke.body).toMatchObject({ uploads: 1, data: 1 });
    expect(typeof woke.body.lastUploadAt).toBe('string');
    expect(woke.body.dataAt).toBe(woke.body.lastUploadAt);
  });

  it('Gauge\'s own status reports move only uploads; a re-sent batch moves uploads, never data', async () => {
    const t = await boot();
    await t.upload([battery('2026-10-29T11:00:00Z', 42)]);
    let s = (await t.call('/v1/gauge/pulse', { token: t.device })).body;
    expect(s).toMatchObject({ uploads: 1, data: 0 });
    const reading = hr('2026-10-29T11:05:00Z', 64);
    await t.upload([reading]);
    await t.upload([reading]);
    s = (await t.call('/v1/gauge/pulse', { token: t.device })).body;
    expect(s).toMatchObject({ uploads: 3, data: 1 });
  });

  it('a token of another server run answers at once; a current one is held for wait seconds', async () => {
    const t = await boot();
    const now = (await t.call('/v1/gauge/pulse', { token: t.device })).body;
    const other = await t.call('/v1/gauge/pulse?since=zzzz.4.2&wait=20', { token: t.device });
    expect(other.body.token).toBe(now.token);
    const started = Date.now();
    const same = await t.call(`/v1/gauge/pulse?since=${now.token}&wait=1`, { token: t.device });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(same.body.token).toBe(now.token);
  });

  it('takes Vitals device tokens only and checks since and wait', async () => {
    const t = await boot();
    expect((await t.call('/v1/gauge/pulse')).status).toBe(401);
    expect((await t.call('/v1/gauge/pulse', { token: t.gauge })).status).toBe(403);
    expect((await t.call('/v1/gauge/pulse?wait=26', { token: t.device })).status).toBe(400);
    expect((await t.call('/v1/gauge/pulse?since=not%20a%20token', { token: t.device })).status).toBe(400);
    expect((await t.call('/v1/gauge/pulse?other=1', { token: t.device })).status).toBe(400);
    expect((await t.call('/v1/gauge/pulse', { token: t.device, method: 'POST', body: {} })).status).toBe(405);
  });
});

describe('the pulse itself', () => {
  it('counts readings without Gauge\'s state reports, and a detection write moves data', () => {
    expect(readingsOf([{ category: 'state/connection' }, { category: 'metrics/hr' }, { category: 'state/sync' }, { category: 'activity/phone_steps' }])).toBe(2);
    const p = createGaugePulse({ now: () => Date.parse('2026-10-29T12:00:00Z') });
    p.noteUpload('a', 0);
    p.noteDerived('a');
    expect(p.state('a')).toMatchObject({ uploads: 1, data: 1, lastUploadAt: '2026-10-29T12:00:00.000Z', dataAt: '2026-10-29T12:00:00.000Z' });
    expect(p.state('b')).toMatchObject({ uploads: 0, data: 0 });
  });
});
