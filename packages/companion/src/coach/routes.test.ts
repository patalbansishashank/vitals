// @vitest-environment node
/**
 * The coach's message stream always ends with `done` or `error` while someone is listening: once the event-stream
 * headers are out a failure can no longer be a 500, so it has to travel as the stream's last event.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachEvent } from './backends.ts';
import { createCoachRoutes } from './routes.ts';
import { COACH_MESSAGES, type Coach, type CoachCaller } from './sessions.ts';

const SESSION = '0f3a2b1c-1234-4abc-8def-0123456789ab';
const CALLER: CoachCaller = { personId: 'p1', deviceId: 'd1', kind: 'device', timeZone: 'Asia/Kolkata' };

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

/** The routes over a coach whose one turn is `run`. */
async function serve(run: (emit: (e: CoachEvent) => void) => Promise<void>) {
  const logs: string[] = [];
  const coach = { begin: async () => ({ abort: () => undefined, run }) } as unknown as Coach;
  const routes = createCoachRoutes({ coach, resolve: async () => CALLER, log: (l) => logs.push(l) });
  const server = createServer((req, res) => void routes.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const r = await fetch(`http://127.0.0.1:${port}/v1/coach/sessions/${SESSION}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) });
  const raw = await r.text();
  const events = raw.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)) as CoachEvent);
  return { status: r.status, events, logs };
}

describe('coach message stream', () => {
  it('a turn that throws after the stream opened ends with an error event', async () => {
    const r = await serve(async (emit) => {
      emit({ type: 'delta', text: 'Half an ans' });
      throw new TypeError('boom');
    });
    expect(r.status).toBe(200);
    expect(r.events).toEqual([
      { type: 'delta', text: 'Half an ans' },
      { type: 'error', code: 'backend_error', message: COACH_MESSAGES.backend_error },
    ]);
    expect(r.logs.join('\n')).toContain('TypeError');
    expect(r.logs.join('\n')).not.toContain('boom');
  });

  it('a turn stopped on purpose (its session deleted mid-answer) ends saying the conversation ended, not as a failure', async () => {
    const r = await serve(async (emit) => emit({ type: 'delta', text: 'Hello' }));
    expect(r.events.at(-1)).toEqual({ type: 'error', code: 'session_expired', message: COACH_MESSAGES.session_expired });
    expect(r.logs).toEqual([]);
  });

  it('adds nothing after a turn that finished or failed on its own', async () => {
    const done = await serve(async (emit) => emit({ type: 'done', messageId: 'm1' }));
    expect(done.events).toEqual([{ type: 'done', messageId: 'm1' }]);
    const failed = await serve(async (emit) => emit({ type: 'error', code: 'timeout', message: COACH_MESSAGES.timeout }));
    expect(failed.events).toEqual([{ type: 'error', code: 'timeout', message: COACH_MESSAGES.timeout }]);
  });
});
