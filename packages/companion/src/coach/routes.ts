/**
 * `/v1/coach/*`: the server coach's HTTP API (vitals-research/server-coach/CONTRACT.md, docs/SERVER.md "Coach").
 *
 *   GET    /v1/coach/status                 { available, backend, model?, retentionHours, reason? }
 *   POST   /v1/coach/sessions               { app, title?, context?: { screen?, date? } } → { sessionId, expiresAt, greeting }
 *   GET    /v1/coach/sessions               { sessions: [{ sessionId, id, app, title?, createdAt, expiresAt }] }
 *   GET    /v1/coach/sessions/{id}          { sessionId, app, createdAt, expiresAt, messages: [{ role, text, at }] }
 *   POST   /v1/coach/sessions/{id}/messages { text, attachments? } → text/event-stream of contract events
 *   POST   /v1/coach/sessions/{id}/keep     → { sessionId, expiresAt }
 *   DELETE /v1/coach/sessions/{id}          → 204
 *
 * Vitals device tokens and Gauge `lumen` tokens may call these; agent tokens may not (a coach cannot start coaches).
 * A session belongs to the token that opened it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readBody, sendJson } from '../security.ts';
import type { CoachEvent, TurnImage } from './backends.ts';
import { COACH_APPS, type CoachApp } from './personas.ts';
import { CoachError, type Coach, type CoachCaller } from './sessions.ts';

export const COACH_PREFIX = '/v1/coach/';
export const MAX_TEXT_BYTES = 16 * 1024;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGE_BODY = 20 * 1024 * 1024;
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const PING_MS = 15_000;

const SESSION = /^\/v1\/coach\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/messages|\/keep)?$/;

const bad = (message = 'That request could not be read. Try again.') => new CoachError(400, 'bad_request', message);

/** A short plain label from the client (title, screen): no control characters, at most `max` characters. */
const label = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || undefined;
};

async function json(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  let body: Buffer;
  try {
    body = await readBody(req, limit);
  } catch (e) {
    if (e instanceof HttpError && e.status === 413) throw new CoachError(413, 'too_large', 'That message is too large to send. Try a shorter one or a smaller picture.');
    throw e;
  }
  if (body.length === 0) return {};
  let v: unknown;
  try {
    v = JSON.parse(body.toString('utf8'));
  } catch {
    throw bad();
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad();
  return v as Record<string, unknown>;
}

function parseMessage(b: Record<string, unknown>): { text: string; images: TurnImage[] } {
  if (typeof b.text !== 'string' || !b.text.trim()) throw bad('Write a message first.');
  if (Buffer.byteLength(b.text, 'utf8') > MAX_TEXT_BYTES) throw new CoachError(413, 'too_large', 'That message is too long. Try a shorter one.');
  const images: TurnImage[] = [];
  if (b.attachments !== undefined) {
    if (!Array.isArray(b.attachments)) throw bad();
    if (b.attachments.length > MAX_IMAGES) throw new CoachError(413, 'too_large', `Send at most ${MAX_IMAGES} pictures at once.`);
    for (const a of b.attachments as unknown[]) {
      const x = a as { kind?: unknown; mime?: unknown; data?: unknown };
      if (!x || x.kind !== 'image' || typeof x.mime !== 'string' || !IMAGE_MIMES.includes(x.mime.toLowerCase()) || typeof x.data !== 'string') throw bad('Only pictures (PNG, JPEG, GIF, WebP) can be attached.');
      const data = Buffer.from(x.data, 'base64');
      if (!data.length) throw bad('A picture could not be read.');
      if (data.length > MAX_IMAGE_BYTES) throw new CoachError(413, 'too_large', 'That picture is too large. Try a smaller one.');
      images.push({ mime: x.mime.toLowerCase(), data });
    }
  }
  return { text: b.text, images };
}

function sendCoachError(res: ServerResponse, e: CoachError): void {
  sendJson(res, e.status, { error: { code: e.code, message: e.message } }, e.status === 401 ? { 'WWW-Authenticate': 'Bearer', ...e.headers } : e.headers);
}

export function createCoachRoutes(o: { coach: Coach; resolve: (req: IncomingMessage) => Promise<CoachCaller>; log: (line: string) => void }) {
  const { coach, resolve } = o;

  const stream = async (req: IncomingMessage, res: ServerResponse, caller: CoachCaller, id: string) => {
    const msg = parseMessage(await json(req, MAX_MESSAGE_BODY));
    const turn = await coach.begin(caller, id, msg);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    // every event goes out at once (no Nagle delay); the ping keeps idle phone networks and proxies from closing it
    res.socket?.setNoDelay(true);
    let open = true;
    const send = (e: CoachEvent) => {
      if (open && !res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const ping = setInterval(() => {
      if (open) res.write(': ping\n\n');
    }, PING_MS);
    // the person closed the app or lost the network: stop the CLI (the user message stays; no answer is kept)
    res.on('close', () => {
      if (open) turn.abort();
      open = false;
    });
    try {
      await turn.run(send);
    } finally {
      clearInterval(ping);
      if (open) {
        open = false;
        res.end();
      }
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const method = req.method ?? 'GET';
    const caller = await resolve(req);
    if (path === '/v1/coach/status') {
      if (method !== 'GET') throw new CoachError(405, 'method', 'Use GET', { Allow: 'GET' });
      return sendJson(res, 200, await coach.status());
    }
    if (path === '/v1/coach/sessions') {
      if (method === 'GET') return sendJson(res, 200, { sessions: await coach.list(caller) });
      if (method !== 'POST') throw new CoachError(405, 'method', 'Use GET or POST', { Allow: 'GET, POST' });
      const b = await json(req, 4096);
      if (b.app !== undefined && !COACH_APPS.includes(b.app as CoachApp)) throw bad('Say which app this is for: vitals or gauge.');
      const app: CoachApp = (b.app as CoachApp | undefined) ?? (caller.kind === 'lumen' ? 'gauge' : 'vitals');
      const ctx = (b.context && typeof b.context === 'object' ? b.context : {}) as { screen?: unknown; date?: unknown };
      const date = typeof ctx.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ctx.date) ? ctx.date : undefined;
      const title = label(b.title, 80);
      const screen = label(ctx.screen, 40);
      return sendJson(res, 200, await coach.create(caller, { app, ...(title ? { title } : {}), ...(screen ? { screen } : {}), ...(date ? { date } : {}) }));
    }
    const m = SESSION.exec(path);
    if (!m) throw new CoachError(404, 'not_found', "That isn't available on your server.");
    const id = m[1]!;
    if (m[2] === '/messages') {
      if (method !== 'POST') throw new CoachError(405, 'method', 'Use POST', { Allow: 'POST' });
      return stream(req, res, caller, id);
    }
    if (m[2] === '/keep') {
      if (method !== 'POST') throw new CoachError(405, 'method', 'Use POST', { Allow: 'POST' });
      return sendJson(res, 200, await coach.keep(caller, id));
    }
    if (method === 'GET') return sendJson(res, 200, await coach.get(caller, id));
    if (method === 'DELETE') {
      await coach.remove(caller, id);
      res.writeHead(204).end();
      return;
    }
    throw new CoachError(405, 'method', 'Use GET or DELETE', { Allow: 'GET, DELETE' });
  };

  return {
    owns: (path: string) => path.startsWith(COACH_PREFIX),
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
      try {
        await handle(req, res, path);
      } catch (e) {
        if (e instanceof CoachError) return sendCoachError(res, e);
        if (e instanceof HttpError) return sendCoachError(res, new CoachError(e.status, e.code, e.message, e.headers));
        o.log(`coach: request failed (${e instanceof Error ? e.name : 'error'})`);
        if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal', message: 'Something went wrong on your server. Try again.' } });
        else res.end();
      }
    },
  };
}
