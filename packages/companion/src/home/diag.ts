/**
 * Loopback-only diagnostics for the server process (docs/SERVER.md "Operations"), off unless `VITALS_DIAG_PORT` is set:
 *   GET  http://127.0.0.1:<port>/diag                  the main thread's memory and handles, and every open person worker's report
 *   POST http://127.0.0.1:<port>/snapshot?person=<id>  a heap snapshot of one worker (or `main`) under <dataDir>/snapshots (0600)
 *   POST http://127.0.0.1:<port>/profile?person=<id>&ms=5000  a CPU profile of one worker's thread, same folder
 * It answers no person data: sizes, counts and timings only. It binds 127.0.0.1 and nothing else.
 */
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { getHeapSpaceStatistics, getHeapStatistics, writeHeapSnapshot } from 'node:v8';
import type { WorkerPool } from './workers.ts';

const count = (xs: string[]) => xs.reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {});

export function mainThreadDiag() {
  const m = process.memoryUsage();
  const h = getHeapStatistics();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
    arrayBuffers: m.arrayBuffers,
    malloced: h.malloced_memory,
    spaces: Object.fromEntries(getHeapSpaceStatistics().map((x) => [x.space_name, x.space_used_size])),
    resources: count(process.getActiveResourcesInfo()),
    cpu: process.cpuUsage(),
  };
}

export function startDiag(o: { port: number; pool: WorkerPool; dataDir: string; extra?: () => Record<string, unknown> }): Promise<Server> {
  const dir = join(o.dataDir, 'snapshots');
  const srv = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/diag') {
        const body = { at: new Date().toISOString(), main: mainThreadDiag(), ...(o.extra?.() ?? {}), persons: await o.pool.diag() };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/snapshot') {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const who = url.searchParams.get('person') ?? 'main';
        const file = join(dir, `${who}-${Date.now()}.heapsnapshot`);
        const out = who === 'main' ? writeHeapSnapshot(file) : await o.pool.snapshot(who, file);
        res.writeHead(out ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify({ file: out }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/profile') {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const who = url.searchParams.get('person') ?? '';
        const ms = Math.min(60_000, Number(url.searchParams.get('ms') ?? 5000));
        const out = await o.pool.profile(who, join(dir, `${who}-${Date.now()}.cpuprofile`), ms);
        res.writeHead(out ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify({ file: out }));
        return;
      }
      res.writeHead(404).end();
    })().catch((e: unknown) => res.writeHead(500).end(String(e)));
  });
  return new Promise((r) => srv.listen(o.port, '127.0.0.1', () => r(srv)));
}
