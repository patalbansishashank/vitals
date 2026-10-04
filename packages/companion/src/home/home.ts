/**
 * The `home` role (SUITE_SPEC §14.1, §14.2, §14.5): persons, device tokens and pairing, the person workers and the MQTT
 * broker, behind one `HomeServer` that `server.ts` mounts on its HTTP server.
 *
 * Every authenticated route gets its person from `resolvePerson(req)` and nothing else: no person id is read from a
 * path, query, body or other header (the admin-only `person` field of `POST /v1/pair/code` is the one exception).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { createBroker, type Broker } from './broker.ts';
import { createDeviceStore, type DeviceStore, type Principal } from './devices.ts';
import { createIngestState, type IngestState } from './ingest.ts';
import type { PersonRequest, PersonResponse } from './personRpc.ts';
import { createPersonRegistry, type PersonRegistry } from './persons.ts';
import { createWorkerPool, type WorkerFactory, type WorkerPool } from './workers.ts';
import { APP_SHELL_ORIGINS, bearerOf, createRateLimiter, hostName, HttpError, normalizeOrigin, PUBLIC_APP_ORIGIN, readJson, sendError, sendJson, type Logger } from '../security.ts';

export const HOME_ALLOW_HEADERS = 'authorization, content-type, mcp-session-id';
const QUERY_TOKEN = /[?&](token|access_token|bearer|auth)=/i;
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const TS_NET = /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i;

/** Trust the last forwarded address only when the request came through a local reverse proxy. */
export function pairingClientAddress(remoteAddress: string | undefined, forwardedFor: string | undefined): string {
  const peer = remoteAddress ?? '?';
  const fromLocalProxy = peer === '::1' || LOOPBACK_HOST.test(peer.replace(/^::ffff:/i, ''));
  if (!fromLocalProxy || !forwardedFor) return peer;
  return forwardedFor.split(',').at(-1)?.trim() || peer;
}

/** What every person-scoped handler receives (§14.2). E26 builds its routes on this. */
export interface PersonContext {
  personId: string;
  deviceId: string;
  kind: 'device' | 'agent';
  scope: string;
  worker: { call(req: PersonRequest): Promise<PersonResponse> };
  log: (line: string) => void;
}

export interface HomeOptions {
  dataDir: string;
  version: string;
  /** Exact browser origins allowed (default the live site). */
  allowedOrigins?: string[];
  /** Extra Host names accepted besides loopback and `*.ts.net` (`--public-host`). */
  publicHosts?: string[];
  /** What browsers and phones use, e.g. https://host.tailnet.ts.net:8443 (address in MQTT credentials and QR codes). */
  publicOrigin?: string;
  mqtt?: { enabled: boolean; tcp?: { host: string; port: number }; tls?: { listen: Array<{ host: string; port: number }>; certFile: string; keyFile: string } };
  workerFactory: WorkerFactory;
  /** Where person workers reach the relay of this process, asked at each worker open (loopback listener); else the person file's `relayUrl`. */
  relayUrl?: () => string | null;
  idleMs?: number;
  /** `server.json` `maxOpenPersons` (default 4): person workers open at once. */
  maxOpenPersons?: number;
  log: Logger;
  rateLimit?: { capacity: number; perMinute: number };
  /** `server.json` `limits`: AI requests per minute and per day, per person. */
  ai?: { requestsPerMinute?: number; requestsPerDay?: number };
  now?: () => number;
}

export interface HomeServer {
  persons: PersonRegistry;
  devices: DeviceStore;
  pool: WorkerPool;
  ingest: IngestState;
  broker: Broker | null;
  /** The single point where a request becomes a person (§14.2). Throws 401/403 as HttpError. */
  resolvePerson(req: IncomingMessage, kinds?: Array<'device' | 'agent'>): Promise<PersonContext>;
  originCheck(req: IncomingMessage): 'none' | 'allowed' | 'forbidden';
  hostAllowed(req: IncomingMessage): boolean;
  /** Answers `/v1/pair/*`, `/v1/sync/key`, `/v1/devices*`, `/v1/mqtt/*`; false when the path is not one of them. */
  handle(req: IncomingMessage, res: ServerResponse, path: string, query: string): Promise<boolean>;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, path: string): boolean;
  health(): Promise<{ persons: number; mqtt: 'on' | 'off'; memoryMb: number }>;
  close(): Promise<void>;
}

export async function startHome(o: HomeOptions): Promise<HomeServer> {
  const log = o.log;
  const persons = createPersonRegistry(o.dataDir);
  const devices = createDeviceStore({ dataDir: o.dataDir, persons, ...(o.now ? { now: o.now } : {}) });
  const pool = createWorkerPool({
    persons, factory: o.workerFactory, log, memoryFile: join(o.dataDir, 'memory.json'),
    ...(o.relayUrl ? { relayUrl: o.relayUrl } : {}),
    ...(o.idleMs ? { idleMs: o.idleMs } : {}), ...(o.maxOpenPersons ? { maxOpenPersons: o.maxOpenPersons } : {}),
  });
  const ingest = createIngestState({ persons, ...(o.now ? { now: o.now } : {}) });
  const origins = new Set([...(o.allowedOrigins?.length ? o.allowedOrigins : [PUBLIC_APP_ORIGIN]), ...APP_SHELL_ORIGINS].map(normalizeOrigin));
  const hosts = new Set((o.publicHosts ?? []).map((h) => h.toLowerCase()));
  const limiter = createRateLimiter(o.rateLimit ?? { capacity: 30, perMinute: 120 });
  const ipLimiter = createRateLimiter({ capacity: 60, perMinute: 240 });
  const mqttAddress = o.publicOrigin ? `${o.publicOrigin.replace(/^http/, 'ws').replace(/\/+$/, '')}/mqtt` : null;
  const broker = o.mqtt?.enabled ? await createBroker({ ingest, pool, log, ...(o.mqtt.tcp ? { tcp: o.mqtt.tcp } : {}), ...(o.mqtt.tls ? { tls: o.mqtt.tls } : {}), ...(o.now ? { now: o.now } : {}) }) : null;
  // acknowledged but not imported before the last stop: import before the broker takes connections (§14.5)
  if (broker) {
    const n = await broker.replay((await persons.list()).map((p) => p.id));
    if (n) log(`imported ${n} broker messages left from the last run`);
  }
  const flushTimer = setInterval(() => void devices.flush().catch(() => undefined), 60_000);
  flushTimer.unref();

  const ipOf = (req: IncomingMessage) => {
    const f = req.headers['x-forwarded-for'];
    return pairingClientAddress(req.socket.remoteAddress, typeof f === 'string' ? f : undefined);
  };
  const limit = (key: string, l = limiter) => {
    const r = l.take(key);
    if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(r.retryAfterSec) });
  };
  const method = (req: IncomingMessage, m: string) => {
    if (req.method !== m) throw new HttpError(405, 'method', `Use ${m}`, { Allow: m });
  };
  const toContext = (p: Principal): PersonContext => ({
    personId: p.personId,
    deviceId: p.deviceId,
    kind: p.kind,
    scope: p.scope,
    worker: { call: (r) => pool.call(p.personId, r) },
    log: (l) => log(`person ${p.personId} device ${p.deviceId}: ${l}`),
  });

  const home: HomeServer = {
    persons,
    devices,
    pool,
    ingest,
    broker,
    async resolvePerson(req, kinds) {
      if (QUERY_TOKEN.test(req.url ?? '')) throw new HttpError(401, 'unauthorized', 'Send the token in the Authorization header', { 'WWW-Authenticate': 'Bearer' });
      const r = await devices.resolve(bearerOf(req));
      if (!r.ok) throw new HttpError(401, r.error, r.error === 'revoked' ? 'This device was removed' : 'Pair this device with the server first', { 'WWW-Authenticate': 'Bearer' });
      if (kinds && !kinds.includes(r.principal.kind)) throw new HttpError(403, 'wrong_kind', 'This token cannot use this route');
      limit(`d:${r.principal.deviceId}`);
      devices.touch(r.principal);
      return toContext(r.principal);
    },
    originCheck(req) {
      const origin = req.headers.origin;
      if (origin === undefined) return 'none';
      return origins.has(normalizeOrigin(origin)) ? 'allowed' : 'forbidden';
    },
    hostAllowed(req) {
      const h = typeof req.headers.host === 'string' ? hostName(req.headers.host) : '';
      return Boolean(h) && (LOOPBACK_HOST.test(h) || TS_NET.test(h) || hosts.has(h));
    },
    async handle(req, res, path) {
      if (!path.startsWith('/v1/pair/') && path !== '/v1/sync/key' && path !== '/v1/devices' && !path.startsWith('/v1/devices/') && !path.startsWith('/v1/mqtt/')) return false;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': HOME_ALLOW_HEADERS,
          'Access-Control-Max-Age': '7200',
          'Access-Control-Allow-Private-Network': 'true',
        });
        res.end();
        return true;
      }
      try {
        await route(req, res, path);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        sendError(res, e);
      }
      return true;
    },
    upgrade(req, socket, head, path) {
      if (path !== '/mqtt' || !broker) return false;
      broker.handleUpgrade(req, socket, head);
      return true;
    },
    // memoryMb: the server process's resident memory (person workers are threads inside it)
    health: async () => ({ persons: (await persons.list()).length, mqtt: broker ? 'on' : 'off', memoryMb: Math.round(process.memoryUsage.rss() / 1048576) }),
    async close() {
      clearInterval(flushTimer);
      await broker?.close();
      await pool.closeAll();
      await devices.flush().catch(() => undefined);
    },
  };

  const personOut = async (id: string) => ({ id, label: (await persons.get(id))?.label ?? '' });
  const serverOut = () => ({ version: o.version, role: 'home' as const });

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const mqttCred = /^\/v1\/mqtt\/credentials\/([A-Za-z0-9-]{1,64})(\/allow-new-phone)?$/.exec(path);
    const device = /^\/v1\/devices\/([A-Za-z0-9-]{1,64})$/.exec(path);
    switch (true) {
      case path === '/v1/pair/code': {
        method(req, 'POST');
        const body = await readJson(req, 4096);
        const token = bearerOf(req);
        let personId: string;
        if (!req.headers.origin && (await devices.isAdmin(token))) {
          if (typeof body.person !== 'string' || !(await persons.get(body.person))) throw new HttpError(400, 'bad_request', 'Name the person');
          personId = body.person;
        } else {
          const ctx = await home.resolvePerson(req);
          if (ctx.kind !== 'device') throw new HttpError(403, 'wrong_kind', 'Only a paired device can add another device');
          personId = ctx.personId;
        }
        const label = typeof body.label === 'string' ? body.label.slice(0, 40) : undefined;
        const c = await devices.issueCode(personId, label);
        return sendJson(res, 200, { ...c, qr: pairingQr(o.publicOrigin ?? '', c.code, label) });
      }
      case path === '/v1/pair/device' || path === '/v1/pair/local': {
        // `/v1/pair/local` is the Companion's route, kept for one release on the same code path
        method(req, 'POST');
        limit(`ip:${ipOf(req)}`, ipLimiter);
        const body = await readJson(req, 4096);
        if (typeof body.code !== 'string' || (body.label !== undefined && typeof body.label !== 'string')) throw new HttpError(400, 'bad_request', 'Send the code');
        const r = await devices.pair(body.code, { ...(typeof body.label === 'string' ? { label: body.label } : {}), ...(req.headers.origin ? { origin: normalizeOrigin(req.headers.origin) } : {}) });
        if (!r.ok) {
          const status = { invalid_code: 401, expired: 410, locked: 423 }[r.error];
          return sendJson(res, status, { error: r.error, ...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}) });
        }
        log(`person ${r.personId}: paired device ${r.deviceId}`);
        return sendJson(res, 200, { token: r.token, deviceId: r.deviceId, person: await personOut(r.personId), server: serverOut() });
      }
      case path === '/v1/pair/status': {
        method(req, 'GET');
        const ctx = await home.resolvePerson(req);
        const d = (await devices.list(ctx.personId)).find((x) => x.id === ctx.deviceId);
        return sendJson(res, 200, {
          deviceId: ctx.deviceId, label: d?.label ?? '', kind: ctx.kind, scope: ctx.scope, person: await personOut(ctx.personId),
          createdAt: d?.createdAt ?? null, lastSeenAt: d?.lastSeenAt ?? null, server: { ...serverOut(), mqtt: broker ? 'on' : 'off' },
        });
      }
      case path === '/v1/sync/key': {
        // Pairing turns sync on (plan decision 5): a freshly paired browser gets the person's sync key once, within the
        // code window, so it joins the group the server already holds. Home role only: a relay holds no key. The key is
        // only ever in this POST response body (never a URL or a log line); the buffer is zeroed after sending.
        method(req, 'POST');
        limit(`ip:${ipOf(req)}`, ipLimiter);
        let ctx: PersonContext;
        try {
          ctx = await home.resolvePerson(req, ['device']);
        } catch (e) {
          if (e instanceof HttpError && e.code === 'wrong_kind') log('sync key refused: wrong_kind');
          throw e;
        }
        await readJson(req, 4096);
        if (ctx.scope !== 'full') {
          ctx.log('sync key refused: wrong_kind');
          throw new HttpError(403, 'wrong_kind', 'This token cannot use this route');
        }
        const secret = await persons.readSecret(ctx.personId);
        try {
          const mark = await devices.markSyncKeyIssued(ctx.personId, ctx.deviceId);
          if (mark !== 'ok') {
            ctx.log(`sync key refused: ${mark}`);
            if (mark === 'already_issued') throw new HttpError(409, 'already_issued', 'This device already got the sync key');
            if (mark === 'window_closed') throw new HttpError(410, 'window_closed', 'Pair this device again to get the sync key');
            throw new HttpError(401, 'unauthorized', 'Pair this device with the server first', { 'WWW-Authenticate': 'Bearer' });
          }
          // a view over the bytes, not `Buffer.from(secret)`: that copy lands in Node's shared buffer pool and is never zeroed
          const key = Buffer.from(secret.buffer, secret.byteOffset, secret.byteLength).toString('base64url');
          sendJson(res, 200, { key, format: 'owner-secret-v1' }, { Pragma: 'no-cache' });
          ctx.log('sync key handed over');
          return;
        } finally {
          secret.fill(0);
        }
      }
      case path === '/v1/devices': {
        method(req, 'GET');
        const ctx = await home.resolvePerson(req, ['device']);
        const list = await devices.list(ctx.personId);
        return sendJson(res, 200, { devices: list.map((d) => ({ id: d.id, kind: d.kind, label: d.label, scope: d.scope, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, current: d.id === ctx.deviceId })) });
      }
      case device !== null: {
        method(req, 'DELETE');
        const ctx = await home.resolvePerson(req, ['device']);
        if (!(await devices.revoke(ctx.personId, device[1]!))) throw new HttpError(404, 'not_found', 'No such device');
        ctx.log(`removed device ${device[1]}`);
        res.writeHead(204).end();
        return;
      }
      case path === '/v1/mqtt/credentials': {
        method(req, 'POST');
        const ctx = await home.resolvePerson(req, ['device']);
        await readJson(req, 4096);
        if (!broker) throw new HttpError(409, 'mqtt_off', 'The broker is switched off on this server');
        try {
          const c = await ingest.addCredential(ctx.personId, mqttAddress ?? '');
          ctx.log(`created broker login ${c.username}`);
          return sendJson(res, 200, c);
        } catch (e) {
          if ((e as { code?: string }).code === 'limit') throw new HttpError(409, 'limit', (e as Error).message);
          throw e;
        }
      }
      case mqttCred !== null: {
        const ctx = await home.resolvePerson(req, ['device']);
        const username = mqttCred[1]!;
        if (mqttCred[2]) {
          method(req, 'POST');
          if (!(await ingest.clearPin(ctx.personId, username))) throw new HttpError(404, 'not_found', 'No such login');
          return sendJson(res, 200, { ok: true });
        }
        method(req, 'DELETE');
        if (!(await ingest.revokeCredential(ctx.personId, username))) throw new HttpError(404, 'not_found', 'No such login');
        broker?.disconnect(username);
        ctx.log(`revoked broker login ${username}`);
        res.writeHead(204).end();
        return;
      }
      case path === '/v1/mqtt/status': {
        method(req, 'GET');
        const ctx = await home.resolvePerson(req, ['device']);
        return sendJson(res, 200, await ingest.status(ctx.personId, { enabled: Boolean(broker), address: broker ? mqttAddress : null, connected: (u) => broker?.connected(u) ?? false }));
      }
    }
    throw new HttpError(404, 'not_found', 'Not found');
  }

  return home;
}

/** `vitals-server:1?u=<https base>&c=<code>[&n=<label>]`: what the QR shows; it never carries a token. */
export function pairingQr(baseUrl: string, code: string, label?: string): string {
  const q = new URLSearchParams({ u: baseUrl, c: code, ...(label ? { n: label } : {}) });
  return `vitals-server:1?${q.toString()}`;
}
