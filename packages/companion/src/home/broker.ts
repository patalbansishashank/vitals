/**
 * The MQTT broker for Lumen Health (SUITE_SPEC §14.5, R16 §5): aedes 1.2 on the HTTP server at `/mqtt` (WebSocket
 * subprotocol `mqtt`), optionally a loopback TCP listener and optionally TLS listeners on the tailnet addresses (the phone
 * cannot resolve MagicDNS names, so it connects to a public name that points at the tailnet address, as `ssl://`).
 *
 * The binding rule: everything happens in `authorizePublish`, serialised per person. A message is appended to the
 * person's WAL and fsynced before `cb(null)` lets aedes send the PUBACK; a failed append calls `cb(err)`, which closes the
 * connection without a PUBACK so Lumen resends from its outbox. Bad messages go to dead letters and are acknowledged.
 * The import from the WAL runs after the PUBACK, one person at a time.
 */
import type { IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { connect as tcpConnect, createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';
import type { Duplex } from 'node:stream';
import { Aedes, type Client } from 'aedes';
import { WebSocketServer } from 'ws';
import { BASE_TOPIC, MAX_MESSAGE_BYTES, type DeadReason, type IngestState, type WalEntry } from './ingest.ts';
import type { IngestLumenResult } from './personRpc.ts';
import type { WorkerPool } from './workers.ts';

export const MAX_CONNECTIONS_PER_CREDENTIAL = 2;
export const MAX_MESSAGES_PER_SECOND = 100;
/** WAL entries imported in one call at most (a burst of history arrives faster than one import takes). */
const MAX_IMPORT_BATCH = 500;
export const MAX_KEEPALIVE_S = 900;

export interface Broker {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  connected(username: string): boolean;
  /** Drops every connection of a username (revoked credential). */
  disconnect(username: string): void;
  /** Resolves when all imports queued so far have finished (tests, shutdown). */
  idle(): Promise<void>;
  /** Imports WAL entries that were acknowledged but not imported (run before accepting connections). */
  replay(personIds: string[]): Promise<number>;
  tcpPort: number | null;
  /** Ports the TLS listeners are bound to (empty without `tls`). */
  tlsPorts: number[];
  close(): Promise<void>;
}

type Meta = { personId: string; username: string; bucket: { tokens: number; at: number } };
const metaOf = new WeakMap<Client, Meta>();
const authError = (code: number, msg: string) => Object.assign(new Error(msg), { returnCode: code });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createBroker(o: {
  ingest: IngestState;
  pool: WorkerPool;
  log: (l: string) => void;
  tcp?: { host: string; port: number };
  /** MQTT over TLS (`ssl://`): one listener per host, one certificate (a Let's Encrypt name that resolves to the tailnet). */
  tls?: { listen: Array<{ host: string; port: number }>; certFile: string; keyFile: string };
  now?: () => number;
}): Promise<Broker> {
  const { ingest, pool, log, now = Date.now } = o;
  const conns = new Map<string, Set<Client>>();
  const importChains = new Map<string, Promise<void>>();
  const publishChains = new Map<string, Promise<unknown>>();

  const dead = (personId: string, reason: DeadReason, payload: Buffer | string, extra: { envelopeId?: string; type?: string } = {}) =>
    ingest.deadLetter(personId, { reason, bytes: Buffer.byteLength(payload), sample: payload.toString('utf8').slice(0, 2048), ...extra });

  /** Imports WAL entries as one batch (one chunk write per stream and day, not one per message); a rejected event is a
   * dead letter of its own entry; every entry is done afterwards. */
  const importEntries = async (personId: string, es: WalEntry[]) => {
    try {
      const installations = await ingest.installations(personId);
      const req = { op: 'ingestLumen' as const, events: es.map((e) => JSON.parse(e.payload) as unknown), installations };
      let r = await pool.call(personId, req);
      // a full server or a person worker that is restarting is not this message's fault: wait and try again (bounded)
      for (let i = 0; !r.ok && i < 24 && (r.error.code === 'server_busy' || (r.error.detail?.reason === 'person_restarting' && i < 2)); i++) {
        await sleep(5000);
        r = await pool.call(personId, req);
      }
      if (!r.ok) throw new Error(r.error.message);
      const v = r.value as IngestLumenResult;
      for (const x of v.rejected ?? []) {
        const e = es[x.index] ?? es[0]!;
        await dead(personId, x.reason, e.payload, { envelopeId: e.envelopeId, ...(x.type ? { type: x.type } : {}) });
      }
      await ingest.recordImport(personId, v);
    } catch (err) {
      log(`person ${personId}: import of ${es.length === 1 ? 'a broker message' : `${es.length} broker messages`} failed: ${err instanceof Error ? err.message : String(err)}`);
      for (const e of es) await dead(personId, 'import_error', e.payload, { envelopeId: e.envelopeId });
    }
    // never retried silently: a failed import is a dead letter, and the entry is done
    for (const e of es) await ingest.walDone(personId, e.envelopeId);
  };
  const importEntry = (personId: string, e: WalEntry) => importEntries(personId, [e]);
  /** Entries waiting for the person's import chain; whatever has piled up while an import ran goes in the next batch. */
  const waiting = new Map<string, WalEntry[]>();
  const queueImport = (personId: string, e: WalEntry) => {
    const list = waiting.get(personId);
    if (list) {
      list.push(e);
      return;
    }
    waiting.set(personId, [e]);
    const take = () => {
      const all = waiting.get(personId) ?? [];
      const batch = all.splice(0, MAX_IMPORT_BATCH);
      if (all.length === 0) waiting.delete(personId);
      return batch;
    };
    const drain = async (): Promise<void> => {
      for (let batch = take(); batch.length; batch = waiting.has(personId) ? take() : []) await importEntries(personId, batch);
    };
    const p = (importChains.get(personId) ?? Promise.resolve()).then(drain);
    const tail: Promise<void> = p.catch(() => undefined).then((): Promise<void> | undefined => (importChains.get(personId) === tail ? ingest.walCompact(personId) : undefined)).catch(() => undefined);
    importChains.set(personId, tail);
  };

  /** Steps 1 and 2 of §14.5 for one PUBLISH; resolves to null (PUBACK) or an error (close, no PUBACK). */
  const accept = async (m: Meta, topic: string, payload: Buffer): Promise<Error | null> => {
    const { personId } = m;
    if (payload.length > MAX_MESSAGE_BYTES) return void (await dead(personId, 'too_large', payload.subarray(0, 2048))), null;
    const parts = topic.split('/');
    const installationId = parts.slice(0, 2).join('/') === BASE_TOPIC ? parts[2] : undefined;
    let ce: unknown;
    try {
      ce = JSON.parse(payload.toString('utf8'));
    } catch {
      return void (await dead(personId, 'not_json', payload)), null;
    }
    const env = ce as { specversion?: unknown; id?: unknown; type?: unknown };
    if (typeof ce !== 'object' || ce === null || env.specversion !== '1.0' || typeof env.id !== 'string' || !env.id || typeof env.type !== 'string') {
      return void (await dead(personId, 'not_cloudevent', payload)), null;
    }
    if (!installationId || !(await ingest.pin(personId, m.username, installationId))) {
      return void (await dead(personId, 'wrong_installation', payload, { envelopeId: env.id, type: env.type })), null;
    }
    const entry: WalEntry = { envelopeId: env.id, topic, receivedAt: new Date(now()).toISOString(), payload: payload.toString('utf8') };
    try {
      if ((await ingest.walWrite(personId, entry)) === 'written') queueImport(personId, entry);
    } catch (err) {
      log(`person ${personId}: WAL append failed; closing the connection without an acknowledgement`);
      return err instanceof Error ? err : new Error(String(err));
    }
    return null;
  };

  /** Above 100 messages/s the acknowledgement waits (Lumen keeps at most 10 in flight, so it slows down; nothing is dropped). */
  const throttle = async (m: Meta) => {
    const t = now();
    m.bucket.tokens = Math.min(MAX_MESSAGES_PER_SECOND, m.bucket.tokens + ((t - m.bucket.at) / 1000) * MAX_MESSAGES_PER_SECOND);
    m.bucket.at = t;
    m.bucket.tokens -= 1;
    if (m.bucket.tokens < 0) await sleep((-m.bucket.tokens / MAX_MESSAGES_PER_SECOND) * 1000);
  };

  const aedes = await Aedes.createBroker({
    keepaliveLimit: MAX_KEEPALIVE_S,
    authenticate(client, username, password, done) {
      void (async () => {
        const personId = username && password ? await ingest.authenticate(username, password.toString('utf8')) : null;
        if (!personId || !username) return done(authError(4, 'Bad user name or password') as never, false);
        const set = conns.get(username) ?? new Set();
        if (set.size >= MAX_CONNECTIONS_PER_CREDENTIAL) return done(authError(3, 'Too many connections for this login') as never, false);
        set.add(client);
        conns.set(username, set);
        metaOf.set(client, { personId, username, bucket: { tokens: MAX_MESSAGES_PER_SECOND, at: now() } });
        await ingest.noteConnect(personId, username).catch(() => undefined);
        log(`person ${personId}: broker login ${username} connected`);
        done(null, true);
      })().catch(() => done(authError(3, 'Server unavailable') as never, false));
    },
    authorizePublish(client, packet, cb) {
      const m = client ? metaOf.get(client) : undefined;
      if (!m) return cb(new Error('not authenticated'));
      packet.retain = false;
      const payload = Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload);
      // aedes runs the packets of one socket read concurrently: one chain per person keeps WAL order and PUBACK order
      const p = (publishChains.get(m.personId) ?? Promise.resolve()).then(async () => {
        await throttle(m);
        return accept(m, packet.topic, payload);
      });
      publishChains.set(m.personId, p.catch(() => undefined));
      p.then((err) => cb(err), (err: unknown) => cb(err instanceof Error ? err : new Error(String(err))));
    },
    authorizeSubscribe(_client, _sub, cb) {
      cb(null, null); // SUBACK 0x80: subscribing is not offered
    },
  });
  aedes.on('clientDisconnect', (client) => {
    const m = metaOf.get(client);
    if (m) conns.get(m.username)?.delete(client);
  });
  aedes.on('clientError', (client) => {
    const m = metaOf.get(client);
    if (m) conns.get(m.username)?.delete(client);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * MAX_MESSAGE_BYTES, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : p.has('mqttv3.1') ? 'mqttv3.1' : false) });
  // aedes 1.2 stalls on a stream that delivers a packet in several WebSocket frames (mqtt.js and Paho both split CONNECT),
  // so each WebSocket is bridged to a loopback TCP socket of an internal listener, the transport aedes reads reliably.
  const inner = createTcpServer((s) => aedes.handle(s));
  await new Promise<void>((r, j) => inner.once('error', j).listen(0, '127.0.0.1', () => r()));
  const innerPort = (inner.address() as { port: number }).port;
  let tcp: TcpServer | null = null;
  if (o.tcp) {
    if (!/^(127(?:\.\d{1,3}){3}|::1|localhost)$/.test(o.tcp.host)) throw new Error('The MQTT TCP listener binds loopback only; put TLS in front of it.');
    tcp = createTcpServer((s) => aedes.handle(s));
    await new Promise<void>((r, j) => tcp!.once('error', j).listen(o.tcp!.port, o.tcp!.host, () => r()));
  }

  const tlsServers: TlsServer[] = [];
  if (o.tls) {
    const cert = readFileSync(o.tls.certFile);
    const key = readFileSync(o.tls.keyFile);
    for (const l of o.tls.listen) {
      const srv = createTlsServer({ cert, key, minVersion: 'TLSv1.2' }, (s) => aedes.handle(s));
      // a failed handshake (a scanner, a wrong protocol) is the client's problem, never the server's
      srv.on('tlsClientError', () => undefined);
      await new Promise<void>((r, j) => srv.once('error', j).listen(l.port, l.host, () => r()));
      tlsServers.push(srv);
      log(`MQTT over TLS on ${l.host}:${(srv.address() as { port: number }).port}`);
    }
  }

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const sock = tcpConnect(innerPort, '127.0.0.1');
        sock.on('data', (d) => ws.send(d));
        sock.on('close', () => ws.terminate());
        sock.on('error', () => ws.terminate());
        ws.on('message', (m: Buffer | ArrayBuffer | Buffer[]) => sock.write(Array.isArray(m) ? Buffer.concat(m) : Buffer.from(m as Buffer)));
        ws.on('close', () => sock.destroy());
        ws.on('error', () => sock.destroy());
      });
    },
    connected: (u) => (conns.get(u)?.size ?? 0) > 0,
    disconnect(u) {
      for (const c of conns.get(u) ?? []) c.close();
      conns.delete(u);
    },
    idle: async () => {
      for (;;) {
        const all = [...publishChains.values(), ...importChains.values()];
        await Promise.all(all);
        if ([...publishChains.values(), ...importChains.values()].every((p, i) => p === all[i])) return;
      }
    },
    async replay(personIds) {
      let n = 0;
      for (const id of personIds) {
        await ingest.pruneDeadLetters(id);
        for (const e of await ingest.walPending(id)) {
          await importEntry(id, e);
          n++;
        }
        await ingest.walCompact(id);
      }
      return n;
    },
    get tcpPort() {
      const a = tcp?.address();
      return a && typeof a === 'object' ? a.port : null;
    },
    get tlsPorts() {
      return tlsServers.map((t) => (t.address() as { port: number }).port);
    },
    async close() {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => aedes.close(() => r()));
      for (const srv of [tcp, inner, ...tlsServers]) if (srv) await new Promise<void>((r) => srv.close(() => r()));
      await Promise.all(importChains.values());
    },
  };
}
