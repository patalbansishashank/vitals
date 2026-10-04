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

export async function startProxy(target) {
  const t = new URL(target);
  const secure = t.protocol === 'https:' || t.protocol === 'wss:';
  const port = Number(t.port || (secure ? 443 : 80));
  let offline = false;
  const open = new Set();
  let upgrades = 0;
  const track = (s) => {
    open.add(s);
    s.on('close', () => open.delete(s));
  };
  const srv = http.createServer((req, res) => {
    if (offline) return void req.socket.destroy();
    const up = (secure ? https : http).request(
      { host: t.hostname, port, path: req.url, method: req.method, headers: { ...req.headers, host: t.host }, servername: t.hostname },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  srv.on('connection', track);
  srv.on('upgrade', (req, sock, head) => {
    if (offline) return void sock.destroy();
    upgrades += 1;
    const onUp = () => {
      const headers = { ...req.headers, host: t.host };
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    };
    const up = secure ? tls.connect({ host: t.hostname, port, servername: t.hostname }, onUp) : net.connect({ host: t.hostname, port }, onUp);
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
    off() {
      offline = true;
      for (const s of open) s.destroy();
      open.clear();
    },
    on() {
      offline = false;
    },
    close() {
      offline = true;
      for (const s of open) s.destroy();
      open.clear();
      return new Promise((r) => srv.close(() => r()));
    },
  };
}
