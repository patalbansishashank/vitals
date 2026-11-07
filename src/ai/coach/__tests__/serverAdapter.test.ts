/**
 * The Coach adapter while paired (server-coach contract): replies stream live from the server's SSE, tool progress is
 * one line while it runs, proposals land as pending edit cards decided through `coach.applyPending` /
 * `coach.discardPending`, the session lives in memory (its id in tab storage, nothing in the synced collections), a
 * 404 starts a new session and sends the message again, and 401 / 429 / an unavailable server say so.
 */
import { createServerCoachClient } from '@/net/coach';
import { coachClientOn, fakeCoachServer, memoryStorage } from '@/net/__tests__/fakeCoachServer';
import type { CommandResult } from '@/commands/types';
import { createServerCoachAdapter, SERVER_COACH_TEXT, SERVER_SESSION_KEY, toolProgress, type ServerCoachBus } from '../serverAdapter';
import type { StreamEventView, TurnView } from '../types';

const ok = (output: unknown): CommandResult => ({ ok: true, output }) as unknown as CommandResult;

function fakeBus(pending: unknown[] = []) {
  const calls: Array<{ id: string; input: unknown; opts: unknown }> = [];
  const bus: ServerCoachBus = {
    dispatch: async (id, input, opts) => {
      calls.push({ id, input, opts });
      if (id === 'coach.pending') return ok(pending);
      if (id === 'coach.applyPending') return ok({ applied: true });
      if (id === 'coach.discardPending') return ok({ discarded: true });
      throw new Error(`unexpected command ${id}`);
    },
    getCommand: (id) => (id === 'plan.shift' ? { title: 'Shift the plan' } : undefined),
  };
  return { bus, calls };
}

function setup(opts: { server?: Parameters<typeof fakeCoachServer>[0]; pending?: unknown[]; storage?: Storage; online?: boolean } = {}) {
  const server = fakeCoachServer(opts.server);
  const { client: pairing } = coachClientOn(server);
  const { bus, calls } = fakeBus(opts.pending);
  const tab = opts.storage ?? memoryStorage();
  const available: boolean[] = [];
  const adapter = createServerCoachAdapter({
    client: createServerCoachClient({ server: pairing }),
    bus,
    storage: tab,
    setAvailable: (on) => available.push(on),
    now: () => new Date('2026-10-23T10:00:00.000Z'),
    isOnline: () => opts.online ?? true,
    recheckMs: 0,
    thumbnail: () => 'blob:thumb',
  });
  return { server, pairing, adapter, bus: calls, tab, available };
}

async function send(adapter: ReturnType<typeof setup>['adapter'], text: string, context?: { screen?: string; date?: string; slot?: string }): Promise<StreamEventView[]> {
  const events: StreamEventView[] = [];
  await adapter.send({ conversationId: 'x', text, ...(context ? { context } : {}) }, (e) => events.push(e), new AbortController().signal);
  return events;
}

const last = (turns: TurnView[]) => turns.at(-1)!;

describe('server coach adapter', () => {
  it('is ready once the server says the Coach is available; unavailable shows its reason and blocks sending', async () => {
    const a = setup();
    await a.adapter.refreshStatus();
    expect(a.adapter.status()).toMatchObject({ kind: 'ready', provider: 'your server', model: 'gpt-5.5', keyOwner: 'local' });
    expect(a.available.at(-1)).toBe(true);

    const b = setup({ server: { status: { available: false, backend: 'codex', retentionHours: 24, reason: 'The server’s AI is not signed in' } } });
    await b.adapter.refreshStatus();
    expect(b.adapter.status()).toMatchObject({ kind: 'serverUnavailable', problem: 'The server’s AI is not signed in' });
    expect(b.available.at(-1)).toBe(false);

    const c = setup({ server: { status: null } });
    await c.adapter.refreshStatus();
    expect(c.adapter.status()).toMatchObject({ kind: 'serverUnavailable', problem: SERVER_COACH_TEXT.notSupported });
  });

  it('creates a vitals session with the screen and date, then streams the reply live', async () => {
    const a = setup({
      server: {
        script: () => [
          { type: 'delta', text: 'Hello' },
          { type: 'delta', text: ' there' },
          { type: 'done', messageId: 'm1' },
        ],
      },
    });
    const seen: string[] = [];
    a.adapter.subscribe(() => {
      const t = a.adapter.history('x').at(-1);
      if (t?.role === 'coach') seen.push(t.text);
    });
    const events = await send(a.adapter, 'hi', { screen: 'food', date: '2026-10-23' });
    expect(a.server.state.calls.find((c) => c.method === 'POST' && c.path === '/v1/coach/sessions')?.body).toEqual({ app: 'vitals', context: { screen: 'food', date: '2026-10-23' } });
    // the screen and date also go with the message itself, as the local Coach sends them
    expect(a.server.state.calls.find((c) => c.path.endsWith('/messages'))?.body).toEqual({ text: 'hi\n[context: from food, date 2026-10-23]' });
    expect(seen).toContain('Hello');
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual(['Hello', ' there']);
    expect(events.at(-1)).toEqual({ type: 'done' });
    const turns = a.adapter.history('x');
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ['you', 'hi'],
      ['coach', 'Hello there'],
    ]);
    expect(last(turns).streaming).toBe(false);
    expect(a.tab.getItem(SERVER_SESSION_KEY)).toBe('sess-1');
    expect(a.adapter.conversations()).toEqual([{ id: 'sess-1', title: 'Coach', kind: 'coach', updatedAt: expect.any(String) }]);
  });

  it('shows the running tool as one progress line, gone when the reply is done', async () => {
    let lines: Array<string | undefined> = [];
    const a = setup({
      server: {
        script: () => [
          { type: 'tool', name: 'gauge_sleep', status: 'start' },
          { type: 'tool', name: 'gauge_sleep', status: 'done' },
          { type: 'tool', name: 'log_meal', status: 'start' },
          { type: 'delta', text: 'Logged.' },
          { type: 'tool', name: 'log_meal', status: 'done' },
          { type: 'done' },
        ],
      },
    });
    a.adapter.subscribe(() => {
      const t = a.adapter.history('x').at(-1);
      if (t?.role === 'coach') lines.push(t.progress);
    });
    await send(a.adapter, 'log my lunch');
    lines = lines.filter((l, i) => i > 0 && l !== lines[i - 1]);
    expect(lines).toEqual(['Looking at sleep…', undefined, 'Logging meal…', undefined]);
    expect(last(a.adapter.history('x')).progress).toBeUndefined();
    expect(toolProgress('vitals_briefing_get')).toBe('Looking at briefing…');
  });

  it('the server\'s "thinking" tool event reads as "Thinking…"', () => {
    expect(toolProgress('thinking')).toBe('Thinking…');
  });

  it('a proposal becomes a pending edit card; Apply runs coach.applyPending as the person, Discard coach.discardPending', async () => {
    const pending = [{ pendingId: 'pend-1', commandId: 'plan.shift', input: { days: 1 }, actor: { kind: 'mcp', id: 'server-coach' }, createdAt: '2026-10-23T10:00:00.000Z', expiresAt: '2026-10-24T10:00:00.000Z', preview: null, status: 'pending' }];
    const a = setup({
      pending,
      server: {
        script: () => [
          { type: 'delta', text: 'I can move it.' },
          { type: 'proposal', id: 'pend-1', summary: 'Move the plan by a day' },
          { type: 'proposal', id: 'pend-2', summary: 'Lower Friday’s target' },
          { type: 'done' },
        ],
      },
    });
    const events = await send(a.adapter, 'move my plan');
    const cards = last(a.adapter.history('x')).cards;
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ class: 'edit', state: 'pending', title: 'Proposal · shift the plan', until: '2026-10-24T10:00:00.000Z' });
    // not on this device yet: the summary is the title until it arrives
    expect(cards[1]).toMatchObject({ class: 'edit', state: 'pending', title: 'Proposal · lower Friday’s target' });
    expect(events.filter((e) => e.type === 'card')).toHaveLength(2);

    expect(await a.adapter.act(cards[0]!.id, 'apply')).toEqual({ ok: true });
    const apply = a.bus.find((c) => c.id === 'coach.applyPending');
    expect(apply?.input).toEqual({ pendingId: 'pend-1' });
    expect(apply?.opts).toEqual({ actor: { kind: 'user', id: 'local-user', onBehalfOf: { kind: 'mcp', id: 'server-coach' } } });
    expect(last(a.adapter.history('x')).cards[0]!.state).toBe('applied');

    expect(await a.adapter.act(cards[1]!.id, 'discard')).toEqual({ ok: true });
    expect(a.bus.find((c) => c.id === 'coach.discardPending')?.input).toEqual({ pendingId: 'pend-2' });
    expect(last(a.adapter.history('x')).cards[1]!.state).toBe('discarded');
    // only the proposal commands: no conversation or message is written anywhere
    expect([...new Set(a.bus.map((c) => c.id))].sort()).toEqual(['coach.applyPending', 'coach.discardPending', 'coach.pending']);
  });

  it('a session the server deleted (404) is replaced: a new session, the message sent again', async () => {
    const a = setup();
    await send(a.adapter, 'first');
    expect(a.tab.getItem(SERVER_SESSION_KEY)).toBe('sess-1');
    a.server.state.sessions.delete('sess-1'); // 24 h passed
    const events = await send(a.adapter, 'second');
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(a.server.state.created).toBe(2);
    expect(a.tab.getItem(SERVER_SESSION_KEY)).toBe('sess-2');
    expect(a.server.state.sessions.get('sess-2')!.messages.map((m) => m.text)).toEqual(['second', 'You said: second']);
    // the expired chat's turns are gone (its history is gone on the server too)
    expect(a.adapter.history('x').map((t) => t.text)).toEqual(['second', 'You said: second']);
  });

  it('a reload reattaches to the session kept in tab storage; one that expired is forgotten', async () => {
    const server = fakeCoachServer();
    server.state.sessions.set('sess-9', { app: 'vitals', createdAt: '2026-10-23T09:00:00.000Z', expiresAt: '2026-10-24T09:30:00.000Z', messages: [{ role: 'user', text: 'earlier', at: '2026-10-23T09:00:00.000Z' }, { role: 'assistant', text: 'noted', at: '2026-10-23T09:00:01.000Z' }] });
    const tab = memoryStorage();
    tab.setItem(SERVER_SESSION_KEY, 'sess-9');
    const { client: pairing } = coachClientOn(server);
    const adapter = createServerCoachAdapter({ client: createServerCoachClient({ server: pairing }), bus: fakeBus().bus, storage: tab, recheckMs: 0 });
    await adapter.ready();
    expect(adapter.history('x').map((t) => [t.role, t.text])).toEqual([
      ['you', 'earlier'],
      ['coach', 'noted'],
    ]);
    expect(adapter.server.current()).toEqual({ id: 'sess-9', expiresAt: '2026-10-24T09:30:00.000Z' });

    const gone = memoryStorage();
    gone.setItem(SERVER_SESSION_KEY, 'sess-old');
    const b = createServerCoachAdapter({ client: createServerCoachClient({ server: pairing }), bus: fakeBus().bus, storage: gone, recheckMs: 0 });
    await b.ready();
    expect(b.history('x')).toEqual([]);
    expect(gone.getItem(SERVER_SESSION_KEY)).toBeNull();
  });

  it('401: the pairing ends and the turn says to connect again', async () => {
    const a = setup();
    a.server.state.fail = { status: 401, code: 'unauthorized' };
    const events = await send(a.adapter, 'hi');
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'unauthorized', message: SERVER_COACH_TEXT.unauthorized });
    expect(a.pairing.isPaired()).toBe(false);
  });

  it('429: busy, with the wait from Retry-After; the next message works', async () => {
    const a = setup();
    a.server.state.fail = { status: 429, retryAfter: '30' };
    const events = await send(a.adapter, 'hi');
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'rateLimited', message: SERVER_COACH_TEXT.busy(30) });
    expect(last(a.adapter.history('x')).error?.message).toBe('Your server is busy. Try again in 30 s.');
    expect((await send(a.adapter, 'again')).at(-1)).toEqual({ type: 'done' });
  });

  it('a stream error event ends the turn with its message', async () => {
    const a = setup({ server: { script: () => [{ type: 'delta', text: 'Let me' }, { type: 'error', code: 'cli_failed', message: 'The server’s AI stopped answering.' }] } });
    const events = await send(a.adapter, 'hi');
    expect(events.at(-1)).toEqual({ type: 'error', kind: 'error', message: 'The server’s AI stopped answering.' });
    expect(last(a.adapter.history('x'))).toMatchObject({ text: 'Let me', streaming: false, error: { message: 'The server’s AI stopped answering.' } });
  });

  it('offline: nothing is sent', async () => {
    const a = setup({ online: false });
    const events = await send(a.adapter, 'hi');
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'offline' });
    expect(a.server.state.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a photo goes as a base64 image attachment', async () => {
    const a = setup();
    const photo = new File([new Uint8Array([1, 2, 3])], 'meal.jpg', { type: 'image/jpeg' });
    await a.adapter.send({ conversationId: 'x', text: 'lunch', photo }, () => undefined, new AbortController().signal);
    expect(a.server.state.calls.find((c) => c.path.endsWith('/messages'))?.body).toEqual({ text: 'lunch', attachments: [{ kind: 'image', mime: 'image/jpeg', data: 'AQID' }] });
    expect(a.adapter.history('x')[0]!.photo).toEqual({ url: 'blob:thumb', alt: 'Your photo' });
  });

  it('lists, keeps and deletes the chats on the server; a new chat starts with the next message', async () => {
    const a = setup();
    await send(a.adapter, 'hi');
    expect(await a.adapter.server.list()).toEqual([{ id: 'sess-1', createdAt: expect.any(String), expiresAt: '2026-10-24T10:00:00.000Z' }]);
    expect(await a.adapter.server.keep()).toEqual({ ok: true, expiresAt: '2026-10-25T10:00:00.000Z' });
    expect(a.adapter.server.current()?.expiresAt).toBe('2026-10-25T10:00:00.000Z');
    a.adapter.server.fresh();
    expect(a.adapter.history('x')).toEqual([]);
    expect(a.tab.getItem(SERVER_SESSION_KEY)).toBeNull();
    await send(a.adapter, 'next');
    expect(a.adapter.server.current()?.id).toBe('sess-2');
    expect(await a.adapter.server.open('sess-1')).toEqual({ ok: true });
    expect(a.adapter.history('x').map((t) => t.text)).toEqual(['hi', 'You said: hi']);
    expect(await a.adapter.server.remove()).toEqual({ ok: true });
    expect(a.server.state.sessions.has('sess-1')).toBe(false);
    expect(a.adapter.history('x')).toEqual([]);
    expect(a.adapter.server.current()).toBeNull();
  });
});
