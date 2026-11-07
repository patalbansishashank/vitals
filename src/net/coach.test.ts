/** The server-coach client: status, sessions, one SSE turn, and the contract's 401 / 404 / 429 handling. */
import { TOKEN } from '@/features/settings/server/__tests__/fakeServer';
import { CoachError, createServerCoachClient, parseCoachEvent, retryAfterSeconds, type CoachServerEvent } from './coach';
import { coachClientOn, fakeCoachServer } from './__tests__/fakeCoachServer';

async function collect(gen: AsyncGenerator<CoachServerEvent>): Promise<CoachServerEvent[]> {
  const out: CoachServerEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function setup(overrides: Parameters<typeof fakeCoachServer>[0] = {}) {
  const server = fakeCoachServer(overrides);
  const { client: pairing } = coachClientOn(server);
  return { server, pairing, coach: createServerCoachClient({ server: pairing }) };
}

describe('server coach client', () => {
  it('reads the status with the device token, only from the paired server', async () => {
    const { server, coach } = setup({ status: { available: false, backend: 'claude', retentionHours: 12, reason: 'The server’s AI is not signed in' } });
    expect(await coach.status()).toEqual({ available: false, backend: 'claude', retentionHours: 12, reason: 'The server’s AI is not signed in' });
    expect(server.state.calls[0]).toMatchObject({ method: 'GET', path: '/v1/coach/status', auth: `Bearer ${TOKEN}` });
  });

  it('an older server without the Coach (404 on status) is "not supported", not an expiry', async () => {
    const { coach } = setup({ status: null });
    await expect(coach.status()).rejects.toMatchObject({ code: 'not_supported' });
  });

  it('creates a session for app vitals with the screen and date', async () => {
    const { server, coach } = setup({ greeting: 'Hi Sam' });
    const s = await coach.createSession({ context: { screen: 'food', date: '2026-10-23' } });
    expect(s).toEqual({ sessionId: 'sess-1', expiresAt: '2026-10-24T10:00:00.000Z', greeting: 'Hi Sam' });
    expect(server.state.calls.at(-1)).toMatchObject({ method: 'POST', path: '/v1/coach/sessions', body: { app: 'vitals', context: { screen: 'food', date: '2026-10-23' } } });
  });

  it('streams a turn: deltas, tool progress, a proposal and done, through chunks split anywhere and keep-alive comments', async () => {
    const { coach } = setup({
      script: () => [
        ': keep-alive\n\n',
        { type: 'tool', name: 'gauge_sleep', status: 'start' },
        { type: 'delta', text: 'You slept ' },
        { type: 'tool', name: 'gauge_sleep', status: 'done' },
        { type: 'delta', text: '7 h — ünïcode ok.' },
        { type: 'proposal', id: 'pend-1', summary: 'Move the fast to Friday' },
        { type: 'done', messageId: 'msg-9' },
      ],
    });
    const { sessionId } = await coach.createSession({});
    const events = await collect(coach.send(sessionId, { text: 'how did I sleep?' }));
    expect(events).toEqual([
      { type: 'tool', name: 'gauge_sleep', status: 'start' },
      { type: 'delta', text: 'You slept ' },
      { type: 'tool', name: 'gauge_sleep', status: 'done' },
      { type: 'delta', text: '7 h — ünïcode ok.' },
      { type: 'proposal', id: 'pend-1', summary: 'Move the fast to Friday' },
      { type: 'done', messageId: 'msg-9' },
    ]);
  });

  it('404 on a session means it expired', async () => {
    const { coach } = setup();
    await expect(collect(coach.send('gone', { text: 'hi' }))).rejects.toMatchObject({ code: 'expired', status: 404 });
    await expect(coach.session('gone')).rejects.toMatchObject({ code: 'expired' });
    // deleting one that is already gone is what was asked for
    await expect(coach.remove('gone')).resolves.toBeUndefined();
  });

  it('429 / 503 are "busy" with Retry-After in seconds', async () => {
    const { server, coach } = setup();
    server.state.fail = { status: 429, code: 'busy', retryAfter: '17' };
    await expect(coach.createSession({})).rejects.toMatchObject({ code: 'busy', retryAfterS: 17 });
    server.state.fail = { status: 503 };
    await expect(coach.status()).rejects.toMatchObject({ code: 'busy' });
    expect(retryAfterSeconds('Fri, 23 Oct 2026 10:00:30 GMT', Date.parse('2026-10-23T10:00:00Z'))).toBe(30);
    expect(retryAfterSeconds(null)).toBeUndefined();
  });

  it('401 ends the pairing (connect again) and says so', async () => {
    const { server, pairing, coach } = setup();
    server.state.fail = { status: 401, code: 'revoked' };
    await expect(coach.status()).rejects.toBeInstanceOf(CoachError);
    expect(pairing.isPaired()).toBe(false);
    expect(pairing.ended()?.reason).toBe('revoked');
    await expect(coach.status()).rejects.toMatchObject({ code: 'not_paired' });
  });

  it('lists, reads, keeps and deletes sessions', async () => {
    const { server, coach } = setup();
    const { sessionId } = await coach.createSession({ title: 'Lunch' });
    await collect(coach.send(sessionId, { text: 'hello' }));
    expect(await coach.sessions()).toEqual([{ sessionId, app: 'vitals', createdAt: expect.any(String), expiresAt: '2026-10-24T10:00:00.000Z' }]);
    const detail = await coach.session(sessionId);
    expect(detail.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'hello'],
      ['assistant', 'You said: hello'],
    ]);
    expect(await coach.keep(sessionId)).toEqual({ expiresAt: '2026-10-25T10:00:00.000Z' });
    await coach.remove(sessionId);
    expect(server.state.sessions.size).toBe(0);
    expect(server.state.calls.map((c) => `${c.method} ${c.path}`)).toContain(`DELETE /v1/coach/sessions/${sessionId}`);
  });

  it('ignores events it does not know', () => {
    expect(parseCoachEvent('{"type":"usage","n":3}')).toBeNull();
    expect(parseCoachEvent('not json')).toBeNull();
    expect(parseCoachEvent('{"type":"error","code":"overloaded","message":"Busy"}')).toEqual({ type: 'error', code: 'overloaded', message: 'Busy' });
  });

  it('without a pairing nothing is sent', async () => {
    const server = fakeCoachServer();
    const { client } = coachClientOn(server, { paired: false });
    const coach = createServerCoachClient({ server: client });
    await expect(coach.status()).rejects.toMatchObject({ code: 'not_paired' });
    expect(server.state.calls).toHaveLength(0);
  });
});
