/**
 * Gauge (formerly Lumen Health) → home server (docs/SERVER.md "Gauge"): pairing, the upload route and its status, and the
 * per-person Lumen stores the `gauge_*` MCP tools read.
 *
 *   POST /v1/lumen/pair    { code, installationId, deviceName?, appVersion? } → { token, personId, deviceId, serverVersion, maxBatch, maxBytes }
 *   POST /v1/lumen/pair-device  a Vitals device token (no code); { installationId, deviceName?, appVersion? } → the same answer as
 *                          /pair, for the Gauge engine built into the Vitals app (r070): `app: 'vitals'`, idempotent per installation
 *   POST /v1/lumen/events  lumen token; { installationId, events: [CloudEvent…] }, optional Content-Encoding: gzip
 *                          → { accepted, duplicates, rejected: [{ id, index, reason }] }; 403 wrong_installation when
 *                          installationId is not the one the token paired as
 *   GET  /v1/lumen/status  lumen token → { personId, lastEventAt, lastObservedAt, counts, deletions, serverVersion }
 *   POST /v1/lumen/unpair  lumen token → 204; the token is revoked (Lumen's Unpair). Its uploads stay on the server.
 *
 * Every answer is direct (never a redirect): Lumen does not follow 30x.
 *
 * The code is the person's ordinary one-time pairing code (`POST /v1/pair/code`, `vitals-server pair-code`). The token
 * is a device token of kind `lumen` (hash only, in `persons/<id>/devices.json`): `resolvePerson` refuses it on every
 * route but these. A person's `lumen.db` is opened on first use in the main thread (it never needs the person's
 * worker or Evolu replica) and closed after 10 minutes idle. Payloads are never logged; only counts are.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import type { DeviceStore } from './devices.ts';
import type { PersonContext } from './home.ts';
import { INSTALLATION_ID, LUMEN_MAX_BATCH, LUMEN_MAX_BYTES, openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet, type LumenToolSet } from './lumenTools.ts';
import { createFusionContextStore, type FusionContextStore } from './fusionContext.ts';
import { createDetectionJob, type DetectionJob } from './detect/job.ts';
import { createGaugePulse, readingsOf, type GaugePulse } from './gaugePulse.ts';
import type { PersonRegistry } from './persons.ts';
import { createRateLimiter, HttpError, readBody, readJson, sendJson, type Logger } from '../security.ts';

const gunzipAsync = promisify(gunzip);
export const LUMEN_EVENTS_PER_MINUTE = 120;
const IDLE_MS = 10 * 60_000;

export interface LumenHub {
  /** The person's store, created on first use. */
  store(personId: string): LumenStore;
  /** The person's store only when Lumen has paired or uploaded before (reads never create the file). */
  peek(personId: string): LumenStore | null;
  toolsFor(personId: string, timeZone: string): LumenToolSet;
  /** (r063 S6) Each person's stored step-fusion context; every fused read of `toolsFor` resolves it. */
  fusionContext: FusionContextStore;
  /**
   * (r067 AD-SERVER) Automatic detection (`./detect/job.ts`): an upload queues its ranges in the ingest transaction and
   * kicks the person's job, which runs after a short debounce in bounded windows off the request path.
   */
  detection: DetectionJob;
  /**
   * (r069 sync) The Gauge pulse (`./gaugePulse.ts`): every upload and every detection run that wrote episodes moves it,
   * and `GET /v1/gauge/pulse` wakes the person's Vitals devices held on it.
   */
  pulse: GaugePulse;
  /**
   * Opens every person's existing `lumen.db` now (r063): a pending schema migration (v3 → v4 builds the materialised
   * state, a few seconds on 180k events) runs right after start instead of inside the first Gauge request.
   */
  warm(): Promise<void>;
  owns(path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
  close(): void;
}

export interface LumenHubOptions {
  persons: PersonRegistry;
  devices: DeviceStore;
  resolve: (req: IncomingMessage) => Promise<PersonContext>;
  /** (r070) The Vitals device behind `POST /v1/lumen/pair-device`: a `device` token only. */
  resolveDevice: (req: IncomingMessage) => Promise<PersonContext>;
  /** (r067) The detection job's debounce (ms); tests pass 0 or call `detection.run`. */
  detectDebounceMs?: number;
  /** The per-address limit of the pairing routes. */
  limitPairing: (req: IncomingMessage) => void;
  log: Logger;
  version: string;
  eventsPerMinute?: number;
  maxBatch?: number;
  maxBytes?: number;
  now?: () => number;
}

export function createLumenHub(o: LumenHubOptions): LumenHub {
  const { persons, devices, log, version, now = Date.now } = o;
  const maxBatch = o.maxBatch ?? LUMEN_MAX_BATCH;
  const maxBytes = o.maxBytes ?? LUMEN_MAX_BYTES;
  const perMinute = o.eventsPerMinute ?? LUMEN_EVENTS_PER_MINUTE;
  const limiter = createRateLimiter({ capacity: perMinute, perMinute }, now);
  const pairDeviceLimiter = createRateLimiter({ capacity: 10, perMinute: 10 }, now);
  const open = new Map<string, { store: LumenStore; usedAt: number }>();
  const fusionContext = createFusionContextStore((personId) => persons.paths(personId).fusionContext);
  let closed = false;
  const pulse = createGaugePulse({ now });
  const detection = createDetectionJob({
    open: (personId) => (closed ? null : peek(personId)),
    tzOf: async (personId) => (await persons.get(personId))?.timeZone ?? 'UTC',
    now,
    log,
    onWrites: (personId) => pulse.noteDerived(personId),
    ...(o.detectDebounceMs !== undefined ? { debounceMs: o.detectDebounceMs } : {}),
  });

  const store = (personId: string): LumenStore => {
    const hit = open.get(personId);
    if (hit) {
      hit.usedAt = now();
      return hit.store;
    }
    const p = persons.paths(personId);
    if (!existsSync(p.dir)) throw new HttpError(401, 'unauthorized', 'Pair the phone with the server again', { 'WWW-Authenticate': 'Bearer' });
    const s = openLumenStore(p.lumen);
    open.set(personId, { store: s, usedAt: now() });
    return s;
  };
  const peek = (personId: string) => (open.has(personId) || existsSync(persons.paths(personId).lumen) ? store(personId) : null);
  const sweep = setInterval(() => {
    for (const [id, s] of open) if (now() - s.usedAt > IDLE_MS) {
      s.store.close();
      open.delete(id);
    }
  }, 60_000);
  sweep.unref();

  const method = (req: IncomingMessage, m: string) => {
    if (req.method !== m) throw new HttpError(405, 'method', `Use ${m}`, { Allow: m });
  };
  const lumenOnly = async (req: IncomingMessage) => {
    const ctx = await o.resolve(req);
    if (ctx.kind !== 'lumen') throw new HttpError(403, 'wrong_kind', 'This route is for the ring app');
    return ctx;
  };

  async function pair(req: IncomingMessage, res: ServerResponse) {
    method(req, 'POST');
    o.limitPairing(req);
    const body = await readJson(req, 4096);
    const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
    const { installationId, deviceName, appVersion } = body;
    if (!/^\d{8}$/.test(code)) throw new HttpError(400, 'bad_request', 'Send the 8-digit pairing code');
    if (typeof installationId !== 'string' || !INSTALLATION_ID.test(installationId)) throw new HttpError(400, 'bad_request', 'Send the installation id');
    if (deviceName !== undefined && (typeof deviceName !== 'string' || deviceName.length > 80)) throw new HttpError(400, 'bad_request', 'deviceName is a short name');
    if (appVersion !== undefined && (typeof appVersion !== 'string' || !/^[\w.+-]{1,40}$/.test(appVersion))) throw new HttpError(400, 'bad_request', 'appVersion is a version like 1.2.3');
    const r = await devices.pair(code, { kind: 'lumen', ...(deviceName ? { label: deviceName } : {}), installationId, ...(appVersion ? { appVersion } : {}) });
    if (!r.ok) {
      const [status, message] = {
        invalid_code: [401, 'That code is wrong. Check it, or ask for a new one.'],
        expired: [410, 'That code has expired. Ask for a new one (vitals-server pair-code).'],
        used: [410, 'That code was already used. Ask for a new one (vitals-server pair-code).'],
        locked: [410, 'Too many wrong codes. Ask for a new one (vitals-server pair-code).'],
      }[r.error] as [number, string];
      return sendJson(res, status, { error: r.error, message, ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) });
    }
    store(r.personId).noteInstallation(installationId, { ...(deviceName ? { deviceName: deviceName.slice(0, 80) } : {}), ...(appVersion ? { appVersion } : {}), pairedAt: new Date(now()).toISOString() });
    log(`person ${r.personId}: paired Gauge as device ${r.deviceId}`);
    return sendJson(res, 200, { token: r.token, personId: r.personId, deviceId: r.deviceId, serverVersion: version, maxBatch, maxBytes });
  }

  /**
   * (r070) The Gauge engine inside the Vitals app pairs with the credential the app already holds: no pairing code. The
   * answer is `/pair`'s. Idempotent per installation id (the same lumen device, a rotated token each call), and recorded as
   * `app: 'vitals'` so the installation lists and `gauge_device_state` say so and the standalone Gauge installation reads
   * as superseded. A standalone Gauge installation's own id is refused (409): it must not be taken over.
   */
  async function pairDevice(req: IncomingMessage, res: ServerResponse) {
    method(req, 'POST');
    const ctx = await o.resolveDevice(req);
    if (ctx.kind !== 'device' || ctx.scope !== 'full') throw new HttpError(403, 'wrong_kind', 'Only a paired Vitals device can pair its ring engine');
    const l = pairDeviceLimiter.take(ctx.deviceId);
    if (!l.ok) throw new HttpError(429, 'rate_limited', 'Too many pairings; wait and try again', { 'Retry-After': String(l.retryAfterSec) });
    const body = await readJson(req, 4096);
    const { installationId, deviceName, appVersion } = body;
    if (typeof installationId !== 'string' || !INSTALLATION_ID.test(installationId)) throw new HttpError(400, 'bad_request', 'Send the installation id');
    if (deviceName !== undefined && (typeof deviceName !== 'string' || deviceName.length > 80)) throw new HttpError(400, 'bad_request', 'deviceName is a short name');
    if (appVersion !== undefined && (typeof appVersion !== 'string' || !/^[\w.+-]{1,40}$/.test(appVersion))) throw new HttpError(400, 'bad_request', 'appVersion is a version like 1.2.3');
    const live = (await devices.list(ctx.personId)).find((d) => d.kind === 'lumen' && d.installationId === installationId);
    if (live && live.app !== 'vitals') throw new HttpError(409, 'installation_is_gauge', 'That installation id belongs to the old ring app');
    const r = await devices.upsertLumen(ctx.personId, { installationId, label: typeof deviceName === 'string' && deviceName.trim() ? deviceName : 'Vitals', ...(appVersion ? { appVersion } : {}), app: 'vitals' });
    store(ctx.personId).noteInstallation(installationId, {
      ...(typeof deviceName === 'string' && deviceName ? { deviceName: deviceName.slice(0, 80) } : {}), ...(appVersion ? { appVersion } : {}), pairedAt: new Date(now()).toISOString(), app: 'vitals',
    });
    ctx.log(`lumen: Gauge engine of Vitals device ${ctx.deviceId} ${r.rotated ? 're-paired' : 'paired'} as device ${r.deviceId}`);
    return sendJson(res, 200, { token: r.token, personId: ctx.personId, deviceId: r.deviceId, serverVersion: version, maxBatch, maxBytes });
  }

  async function events(req: IncomingMessage, res: ServerResponse) {
    method(req, 'POST');
    const ctx = await lumenOnly(req);
    const l = limiter.take(ctx.deviceId);
    if (!l.ok) throw new HttpError(429, 'rate_limited', 'Too many uploads; wait and send again', { 'Retry-After': String(l.retryAfterSec) });
    const encoding = String(req.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    if (encoding !== 'identity' && encoding !== 'gzip') throw new HttpError(415, 'unsupported_encoding', 'Send the body as JSON, gzip or not');
    let raw = await readBody(req, maxBytes);
    if (encoding === 'gzip') {
      try {
        raw = await gunzipAsync(raw, { maxOutputLength: maxBytes });
      } catch (e) {
        if ((e as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) throw new HttpError(413, 'body_too_large', `Request body over ${maxBytes} bytes`);
        throw new HttpError(400, 'bad_gzip', 'The body is not valid gzip');
      }
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'bad_json', 'Body must be JSON');
    }
    const b = body as { installationId?: unknown; events?: unknown };
    if (typeof b !== 'object' || b === null || typeof b.installationId !== 'string' || !INSTALLATION_ID.test(b.installationId)) throw new HttpError(400, 'bad_request', 'Send installationId and events');
    if (!Array.isArray(b.events)) throw new HttpError(400, 'bad_request', 'events must be a list');
    if (b.events.length > maxBatch) throw new HttpError(413, 'too_many_events', `At most ${maxBatch} events per request`);
    // the token is bound to the installation it paired as (energy F16): it uploads only as that installation. A token
    // minted before installations were recorded carries none and keeps the old behaviour.
    const bound = (await devices.list(ctx.personId)).find((d) => d.id === ctx.deviceId)?.installationId;
    if (bound && bound !== b.installationId) throw new HttpError(403, 'wrong_installation', 'This token belongs to another ring app installation; pair this one with the server');
    let out;
    try {
      out = store(ctx.personId).ingest(b.installationId, b.events, now());
    } catch (e) {
      if (e instanceof HttpError) throw e;
      ctx.log(`lumen: store write failed (${e instanceof Error ? e.name : 'error'})`);
      throw new HttpError(503, 'store_unavailable', 'The server could not store this batch; send it again later', { 'Retry-After': '30' });
    }
    ctx.log(`lumen: ${out.accepted} accepted, ${out.duplicates} duplicates, ${out.rejected.length} rejected`);
    if (out.accepted > 0 || out.duplicates > 0) {
      detection.kick(ctx.personId);
      // (r069 sync) wake the person's Vitals devices: new readings ask them to read again, a re-send moves "last sent"
      pulse.noteUpload(ctx.personId, out.accepted > 0 ? readingsOf(b.events) : 0);
    }
    return sendJson(res, 200, out);
  }

  async function status(req: IncomingMessage, res: ServerResponse) {
    method(req, 'GET');
    const ctx = await lumenOnly(req);
    const s = store(ctx.personId).status();
    return sendJson(res, 200, { personId: ctx.personId, lastEventAt: s.lastEventAt, lastObservedAt: s.lastObservedAt, counts: s.counts, deletions: s.deletions, serverVersion: version });
  }

  async function unpair(req: IncomingMessage, res: ServerResponse) {
    method(req, 'POST');
    const ctx = await lumenOnly(req);
    await readBody(req, 4096);
    const installationId = (await devices.list(ctx.personId)).find((d) => d.id === ctx.deviceId)?.installationId;
    await devices.revoke(ctx.personId, ctx.deviceId);
    // (r070) an embedded installation that unpaired no longer supersedes the standalone Gauge
    if (installationId) store(ctx.personId).retireInstallation(installationId, new Date(now()).toISOString());
    log(`person ${ctx.personId}: Gauge device ${ctx.deviceId} unpaired itself`);
    res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
  }

  return {
    store,
    peek,
    toolsFor: (personId, timeZone) => lumenToolSet(() => peek(personId), timeZone, now, () => fusionContext.get(personId)),
    fusionContext,
    detection,
    pulse,
    async warm() {
      for (const p of await persons.list()) {
        if (closed) return;
        if (open.has(p.id) || !existsSync(persons.paths(p.id).lumen)) continue;
        const t = performance.now();
        try {
          store(p.id);
          log(`person ${p.id}: lumen.db ready in ${Math.round(performance.now() - t)} ms`);
          // whatever the migration (or an earlier run cut short) left queued
          detection.kick(p.id);
        } catch (e) {
          log(`person ${p.id}: lumen.db could not be opened (${e instanceof Error ? e.message : 'error'})`);
        }
      }
    },
    owns: (path) => path.startsWith('/v1/lumen/'),
    async handle(req, res, path) {
      if (path === '/v1/lumen/pair') return pair(req, res);
      if (path === '/v1/lumen/pair-device') return pairDevice(req, res);
      if (path === '/v1/lumen/events') return events(req, res);
      if (path === '/v1/lumen/status') return status(req, res);
      if (path === '/v1/lumen/unpair') return unpair(req, res);
      throw new HttpError(404, 'not_found', 'Not found');
    },
    close() {
      closed = true;
      detection.close();
      pulse.close();
      clearInterval(sweep);
      for (const s of open.values()) s.store.close();
      open.clear();
    },
  };
}
