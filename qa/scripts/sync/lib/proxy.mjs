// A switchable loopback relay in front of the real one: one per replica, so a test can take one device off the network.
// The replica's relay URL is `http://127.0.0.1:<port>` (loopback may use ws://, src/sync/pairing.ts normalizeRelayUrl);
// WebSocket upgrades are piped over TLS to the target, plain requests (`/blobs`, `/health`) are forwarded.
// `off()` destroys every open socket and refuses new ones (what a lost network looks like to the client), `on()` lets
// connections through again. Copied in spirit from qa/scripts/Q8/lib.mjs switchableRelay (plain http here, so the
// Node client needs no certificate override).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Transform } from 'node:stream';

export async function startProxy(target) {
  const t = new URL(target);
  const secure = t.protocol === 'https:' || t.protocol === 'wss:';
  const port = Number(t.port || (secure ? 443 : 80));
  let offline = false;
  const open = new Set();
  let upgrades = 0;
  let blobPause = null;
  let syncPause = null;
  const track = (s) => {
    open.add(s);
    s.on('close', () => open.delete(s));
  };
  const srv = http.createServer((req, res) => {
    if (offline) return void req.socket.destroy();
    const pause =
      blobPause?.armed && req.method === 'PUT' && req.url?.startsWith('/blobs/') ? blobPause : null;
    if (pause) pause.armed = false;
    const up = (secure ? https : http).request(
      {
        host: t.hostname,
        port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: t.host },
        servername: t.hostname,
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on('aborted', () => up.destroy());
    if (!pause) return void req.pipe(up);
    // Forward the first bytes, then hold the rest. The server has an incomplete PUT with its original Content-Length.
    // The test kills the client at this point, before the relay can acknowledge the upload.
    let held = null;
    let intercepted = false;
    req.on('data', (chunk) => {
      if (intercepted) {
        if (held) held.push(chunk);
        else up.write(chunk);
        return;
      }
      intercepted = true;
      const n = Math.max(1, Math.floor(chunk.length / 2));
      up.write(chunk.subarray(0, n));
      held = [chunk.subarray(n)];
      req.pause();
      pause.bytesForwarded = n;
      pause.hit();
    });
    req.on('end', () => {
      if (held) held.push(null);
      else up.end();
    });
    pause.release = () => {
      if (!held) return;
      for (const chunk of held)
        if (chunk === null) up.end();
        else up.write(chunk);
      held = null;
      req.resume();
    };
  });
  srv.on('connection', track);
  srv.on('upgrade', (req, sock, head) => {
    if (offline) return void sock.destroy();
    upgrades += 1;
    const onUp = () => {
      const headers = { ...req.headers, host: t.host };
      up.write(
        `${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')}\r\n\r\n`,
      );
      if (head?.length) up.write(head);
      // Hold a single client sync frame after forwarding its first byte. A WebSocket
      // frame needs at least two header bytes, so the server cannot process it yet.
      const clientFrames = new Transform({
        transform(chunk, _encoding, callback) {
          const pause = syncPause?.armed && req.url?.startsWith('/sync') ? syncPause : null;
          if (!pause) return callback(null, chunk);
          pause.armed = false;
          up.write(chunk.subarray(0, 1));
          pause.bytesForwarded = 1;
          pause.release = () => callback(null, chunk.subarray(1));
          pause.hit();
        },
      });
      sock.pipe(clientFrames).pipe(up);
      up.pipe(sock);
      clientFrames.on('error', () => {
        sock.destroy();
        up.destroy();
      });
    };
    const up = secure
      ? tls.connect({ host: t.hostname, port, servername: t.hostname }, onUp)
      : net.connect({ host: t.hostname, port }, onUp);
    track(sock);
    track(up);
    const done = () => {
      sock.destroy();
      up.destroy();
    };
    up.on('error', done);
    sock.on('error', done);
    up.on('close', done);
    sock.on('close', done);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return {
    url,
    get offline() {
      return offline;
    },
    /** WebSocket upgrades forwarded so far (a reconnect shows as +1). */
    get upgrades() {
      return upgrades;
    },
    pauseNextBlobUpload() {
      if (blobPause?.armed) throw new Error('blob upload pause already armed');
      let hit;
      const promise = new Promise((resolve) => {
        hit = resolve;
      });
      blobPause = { armed: true, bytesForwarded: 0, promise, hit, release: () => {} };
    },
    async waitForPausedBlobUpload(timeoutMs = 15000) {
      const pause = blobPause;
      if (!pause) throw new Error('blob upload pause not armed');
      let timer;
      const seen = await Promise.race([
        pause.promise.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      return { started: seen, bytesForwarded: pause.bytesForwarded };
    },
    releasePausedBlobUpload() {
      blobPause?.release();
      blobPause = null;
    },
    pauseNextSyncUpload() {
      if (syncPause?.armed) throw new Error('sync upload pause already armed');
      let hit;
      const promise = new Promise((resolve) => {
        hit = resolve;
      });
      syncPause = { armed: true, bytesForwarded: 0, promise, hit, release: () => {} };
    },
    async waitForPausedSyncUpload(timeoutMs = 15000) {
      const pause = syncPause;
      if (!pause) throw new Error('sync upload pause not armed');
      let timer;
      const seen = await Promise.race([
        pause.promise.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      return { started: seen, bytesForwarded: pause.bytesForwarded };
    },
    releasePausedSyncUpload() {
      syncPause?.release();
      syncPause = null;
    },
    off() {
      offline = true;
      blobPause?.release();
      blobPause = null;
      syncPause?.release();
      syncPause = null;
      for (const s of open) s.destroy();
      open.clear();
    },
    on() {
      offline = false;
    },
    close() {
      offline = true;
      blobPause?.release();
      blobPause = null;
      syncPause?.release();
      syncPause = null;
      for (const s of open) s.destroy();
      open.clear();
      return new Promise((r) => srv.close(() => r()));
    },
  };
}
