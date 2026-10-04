/**
 * Evolu relay protocol hosted on our own HTTP server.
 *
 * Adapted from `@evolu/nodejs` src/local-first/Relay.ts (`createRelay`, MIT, Copyright (c) Daniel Steigerwald and
 * Evolu contributors). Upstream creates its own HTTP server listening on all interfaces; here the caller owns the
 * (loopback) server and hands us upgrades that already passed the path and Origin checks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createConsole, createRelation, createRun, createSqlite, getOrThrow, Name, sql, type CreateSqliteDriver, Uint8Array as EvoluUint8Array, type OwnerId } from '@evolu/common';
import {
  applyProtocolMessageAsRelay,
  createBaseSqliteStorageTables,
  createRelaySqliteStorage,
  createRelayStorageTables,
  defaultProtocolMessageMaxSize,
  type ApplyProtocolMessageAsRelayOptions,
} from '@evolu/common/local-first';
import { createBetterSqliteDriver, createRelayDeps } from '@evolu/nodejs';
import { WebSocket, WebSocketServer } from 'ws';

export interface RelayHostOptions {
  dataDir: string;
  quotaBytesPerOwner: number;
  pingIntervalMs?: number;
  /** Evolu console level; the relay is chatty below 'warn'. */
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}

export interface RelayHost {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  ownerCount(): number;
  close(): Promise<void>;
}

/** Bytes of broadcasts one connection may have queued before it is terminated (upstream's bound). */
const maxUnsentBroadcastBytes = 16 * defaultProtocolMessageMaxSize;

export async function createRelayHost({ dataDir, quotaBytesPerOwner, pingIntervalMs = 30_000, logLevel = 'warn' }: RelayHostOptions): Promise<RelayHost> {
  const dbBase = join(dataDir, 'relay');
  const dbFileExists = existsSync(`${dbBase}.db`);
  const relayDeps = createRelayDeps();
  const run = createRun({
    ...relayDeps,
    // better-sqlite3 opens `${name}.db` relative to cwd; pin the file into dataDir.
    createSqliteDriver: ((_name, options) => createBetterSqliteDriver(dbBase as Name, options)) satisfies CreateSqliteDriver,
    console: createConsole({ level: logLevel }),
  });
  const console = run.deps.console.child('relay');

  const sqlite = getOrThrow(await run(createSqlite(Name.orThrow('vitals-relay'))));
  const deps = { ...run.deps, sqlite };
  if (!dbFileExists) {
    createBaseSqliteStorageTables(deps);
    createRelayStorageTables(deps);
  }
  const storage = createRelaySqliteStorage(deps)({ isOwnerWithinQuota: (_ownerId, requiredBytes) => requiredBytes <= quotaBytesPerOwner });
  const relayRun = run.create({ storage });

  const wss = new WebSocketServer({ noServer: true, maxPayload: defaultProtocolMessageMaxSize });
  const ownerSockets = createRelation<OwnerId, WebSocket>();
  const activeSockets = new WeakSet<WebSocket>();
  const unsentBroadcastBytes = new WeakMap<WebSocket, number>();
  let disposing = false;

  // A connection that sent nothing since the previous ping is dead; one with data still queued is left to TCP.
  const pingTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 0) continue;
      if (!activeSockets.has(client)) {
        client.terminate();
        continue;
      }
      activeSockets.delete(client);
      client.ping();
    }
  }, pingIntervalMs);
  pingTimer.unref();

  wss.on('connection', (ws, request: IncomingMessage) => {
    activeSockets.add(ws);
    request.socket.on('data', () => activeSockets.add(ws));

    const options: ApplyProtocolMessageAsRelayOptions = {
      subscribe: (ownerId) => ownerSockets.add(ownerId, ws),
      unsubscribe: (ownerId) => ownerSockets.remove(ownerId, ws),
      broadcast: (ownerId, message) => {
        for (const socket of ownerSockets.iterateB(ownerId)) {
          if (socket === ws || socket.readyState !== WebSocket.OPEN) continue;
          const unsent = (unsentBroadcastBytes.get(socket) ?? 0) + message.byteLength;
          if (unsent > maxUnsentBroadcastBytes) {
            socket.terminate();
            continue;
          }
          unsentBroadcastBytes.set(socket, unsent);
          socket.send(message, { binary: true }, () => {
            unsentBroadcastBytes.set(socket, (unsentBroadcastBytes.get(socket) ?? 0) - message.byteLength);
          });
        }
      },
    };

    ws.on('message', (message) => {
      if (disposing || !EvoluUint8Array.is(message)) return;
      void (async () => {
        const response = await relayRun.abortable(applyProtocolMessageAsRelay(message, options));
        if (!response.ok) {
          if (response.error.type !== 'AbortError') console.error(response);
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(response.value.message, { binary: true });
      })();
    });
    ws.on('close', () => ownerSockets.removeByB(ws));
    // ws closes the connection itself after a frame it rejects; without a listener the error would crash the process.
    ws.on('error', (e) => console.debug(e));
  });

  return {
    handleUpgrade(request, socket, head) {
      if (disposing) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    },
    ownerCount() {
      const { rows } = sqlite.exec<{ c: number }>(sql`select count(*) as c from evolu_writeKey;`);
      return Number(rows[0]?.c ?? 0);
    },
    async close() {
      if (disposing) return;
      disposing = true;
      clearInterval(pingTimer);
      for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.close(1001, 'Vitals Companion shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      for (const client of wss.clients) client.terminate();
      await relayRun[Symbol.asyncDispose]();
      await sqlite[Symbol.asyncDispose]();
      await run[Symbol.asyncDispose]();
    },
  };
}
