// @vitest-environment node
/** E32 open item: a person-worker `server_busy` that a route lets escape answers 503 with `Retry-After: 60` and the plain message. */
import { describe, expect, it } from 'vitest';
import { busyError, sendError } from '../security.ts';
import { personErrorStatus, SERVER_BUSY } from './workers.ts';

describe('server_busy on the website routes', () => {
  it('busyError maps the worker code to 503 with Retry-After 60 and keeps the plain message', () => {
    const message = SERVER_BUSY.ok ? '' : SERVER_BUSY.error.message;
    expect(message).toBe('The server is busy with other people right now. Try again in a minute.');
    const e = busyError(Object.assign(new Error(message), { code: 'server_busy' }));
    expect(e).toMatchObject({ status: personErrorStatus('server_busy'), code: 'server_busy', message, headers: { 'Retry-After': '60' } });
    expect(busyError(Object.assign(new Error('x'), { code: 'internal' }))).toBeNull();
    expect(busyError('nope')).toBeNull();
  });

  it('sendError writes the status, the header and the message', () => {
    const seen: { status?: number; headers?: Record<string, unknown>; body?: string } = {};
    const res = {
      writeHead(status: number, headers: Record<string, unknown>) {
        Object.assign(seen, { status, headers });
        return res;
      },
      end: (body: string) => Object.assign(seen, { body }),
    };
    sendError(res as never, busyError(Object.assign(new Error('The server is busy with other people right now. Try again in a minute.'), { code: 'server_busy' }))!);
    expect(seen.status).toBe(503);
    expect(JSON.stringify(seen.headers)).toContain('"Retry-After":"60"');
    expect(seen.body).toContain('busy with other people');
  });
});
