// R18 probe: a tiny HTTP server on 127.0.0.1 that answers with CORS for the live site, a 5 MiB body and an SSE stream
// (one event every 500 ms, 6 events). Put `tailscale serve` in front of it to see what the proxy passes through.
// Usage: node qa/scripts/R18/stream-server.mjs [port=4893]
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 4893);
const ORIGIN = 'https://vitals.creative.desi';
createServer((req, res) => {
  const cors = req.headers.origin === ORIGIN ? { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Expose-Headers': 'X-Probe', Vary: 'Origin' } : {};
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', 'Access-Control-Allow-Private-Network': 'true' });
    return res.end();
  }
  if (req.url === '/big') {
    const body = Buffer.alloc(5 * 1024 * 1024, 0x61);
    res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, 'X-Probe': 'big' });
    return res.end(body);
  }
  if (req.url === '/sse') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Probe': 'sse' });
    let n = 0;
    const t = setInterval(() => {
      res.write(`data: ${JSON.stringify({ n, at: Date.now() })}\n\n`);
      if (++n === 6) { clearInterval(t); res.end(); }
    }, 500);
    req.on('close', () => clearInterval(t));
    return;
  }
  res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'X-Probe': 'echo' });
  res.end(JSON.stringify({ host: req.headers.host, xff: req.headers['x-forwarded-for'] ?? null, xfh: req.headers['x-forwarded-host'] ?? null, auth: req.headers.authorization ? 'present' : 'absent' }));
}).listen(port, '127.0.0.1', () => console.log(`stream-server on 127.0.0.1:${port}`));
