/** Shared helpers for the Companion's tests (raw node:http, fake upstreams). Not used at runtime. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
  json: () => Record<string, unknown>;
}

/** Raw HTTP so paths reach the server unnormalised and any header (Origin, Host) can be set. */
export function rawCall(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: Buffer | string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        const b = Buffer.concat(parts);
        resolve({ status: res.statusCode!, headers: res.headers, body: b, text: b.toString(), json: () => JSON.parse(b.toString()) as Record<string, unknown> });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface FakeServer {
  url: string;
  port: number;
  requests: RecordedRequest[];
  handler: (req: RecordedRequest, res: ServerResponse) => void | Promise<void>;
  close(): Promise<void>;
}

/** A node:http server on 127.0.0.1:0 that records every request and answers through a replaceable handler. */
export async function startFakeServer(handler: FakeServer['handler'] = (_r, res) => void res.writeHead(200).end()): Promise<FakeServer> {
  const fake = { requests: [] as RecordedRequest[], handler } as FakeServer;
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const rec = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(parts).toString() };
      fake.requests.push(rec);
      void Promise.resolve(fake.handler(rec, res)).catch(() => res.destroy());
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  fake.port = (server.address() as { port: number }).port;
  fake.url = `http://127.0.0.1:${fake.port}`;
  fake.close = () =>
    new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
  return fake;
}

export function tempDir(prefix = 'vitals-companion-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
