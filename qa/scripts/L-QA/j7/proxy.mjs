// Loopback relay for the QA browsers: the app talks to http://127.0.0.1:<port>; HTTP and WebSocket frames are passed to the
// real server with the one origin the server allows, and CORS headers are added on the way back. Nothing is logged.
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { repo } from './lib.mjs';
const WSPKG = createRequire(path.join(repo, '.e6-tmp', 'cand', 'node_modules', '.pnpm', 'ws@8.22.0', 'node_modules', 'ws', 'package.json'))('./index.js');
const ORIGIN = 'https://localhost';
export function startProxy(serverUrl, port, pageOrigin) {
  const target = new URL(serverUrl);
  const cors = { 'access-control-allow-origin': pageOrigin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*', 'access-control-max-age': '600' };
  const srv = http.createServer(async (req, res) => {
    if (process.env.J7_DEBUG) console.log('PROXY', req.method, req.url.replace(/[0-9a-f]{16,}/g, '<id>').slice(0, 60));
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const chunks = []; for await (const c of req) chunks.push(c);
    try {
      const h = { ...req.headers, origin: ORIGIN, host: target.host }; delete h.connection; delete h['content-length'];
      const r = await fetch(new URL(req.url, target), { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
      res.writeHead(r.status, { ...out, ...cors }); res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502, cors); res.end(); }
  });
  const wss = new WSPKG.WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, sock, head) => wss.handleUpgrade(req, sock, head, (c) => {
    const q = []; const up = new WSPKG('wss://' + target.host + req.url, { origin: ORIGIN });
    up.on('open', () => { for (const [m, b] of q.splice(0)) up.send(m, { binary: b }); });
    up.on('message', (d, b) => c.send(d, { binary: b }));
    up.on('close', () => c.close()); up.on('error', () => c.close());
    c.on('message', (m, b) => (up.readyState === 1 ? up.send(m, { binary: b }) : q.push([m, b])));
    c.on('close', () => { try { up.close(); } catch {} });
  }));
  return new Promise((res) => srv.listen(port, '127.0.0.1', () => res(srv)));
}
