/** The command client: enqueue, held watches until a terminal state, the problems it names, and no offline queue. */
import { describe, expect, it, vi } from 'vitest';
import { ServerError } from '../server';
import { createGaugeCommandsApi, newCommandId, type GaugeCommand } from '../gaugeCommands';

const BASE = 'https://home.example:8443';
type Reply = { status: number; body?: unknown } | 'down';

function fakeServer(replies: Reply[], paired = true) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = replies.shift() ?? { status: 500 };
    if (r === 'down') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const server = {
    isPaired: () => paired,
    chatModelOptions: () => {
      if (!paired) throw new ServerError('not_paired');
      return { serverUrl: `${BASE}/`, deps: { fetch: fetchImpl } };
    },
  };
  return { server, calls };
}

const cmd = (patch: Partial<GaugeCommand> = {}): GaugeCommand => ({
  id: 'c0ffee00-0000-4000-8000-000000000001', type: 'hr.measure', payload: {}, state: 'queued', code: null, detail: null, result: null,
  issuedAt: '2026-10-27T04:00:00.000Z', expiresAt: '2026-10-27T04:01:00.000Z', occurredAt: null, deliveredAt: null, attempt: 0,
  installationId: '0123456789abcdef0123456789abcdef', updatedAt: '2026-10-27T04:00:00.000Z', ...patch,
});

describe('gaugeCommandsApi', () => {
  it('posts the command with its client id and reads the stored one back', async () => {
    const { server, calls } = fakeServer([{ status: 201, body: { command: cmd(), online: true } }]);
    const api = createGaugeCommandsApi({ server });
    const r = await api.send({ id: cmd().id, type: 'hr.measure', payload: {} });
    expect(r).toEqual({ ok: true, command: cmd(), online: true });
    expect(calls[0]).toMatchObject({ url: `${BASE}/v1/gauge/commands`, method: 'POST', body: { id: cmd().id, type: 'hr.measure', payload: {} } });
    expect(typeof (calls[0]!.body as { occurredAt: string }).occurredAt).toBe('string');
  });

  it('names the server’s refusals and fails at once when the server cannot be reached', async () => {
    const { server } = fakeServer([
      { status: 409, body: { error: 'id_reused', message: 'That id was used for a different command' } },
      { status: 404, body: { error: 'no_gauge' } },
      { status: 403, body: { error: 'wrong_kind' } },
      { status: 500, body: { error: 'boom' } },
      'down',
    ]);
    const api = createGaugeCommandsApi({ server });
    const send = () => api.send({ id: newCommandId(), type: 'update.check', payload: {} });
    expect(await send()).toEqual({ ok: false, problem: 'id_reused', message: 'That id was used for a different command' });
    expect(await send()).toMatchObject({ ok: false, problem: 'no_gauge' });
    expect(await send()).toMatchObject({ ok: false, problem: 'unauthorized' });
    expect(await send()).toMatchObject({ ok: false, problem: 'server_error' });
    expect(await send()).toEqual({ ok: false, problem: 'server_unreachable' });
    expect(await createGaugeCommandsApi({ server: fakeServer([], false).server }).send({ id: newCommandId(), type: 'hr.measure', payload: {} })).toEqual({ ok: false, problem: 'not_paired' });
  });

  it('watches with held reads until a terminal state, reporting each change', async () => {
    const id = cmd().id;
    const { server, calls } = fakeServer([
      { status: 200, body: { command: cmd({ state: 'delivered' }), online: true } },
      { status: 200, body: { command: cmd({ state: 'running' }), online: true } },
      { status: 200, body: { command: cmd({ state: 'done', result: { bpm: 62, observedAt: '2026-10-27T04:00:40Z' } }), online: true } },
    ]);
    const api = createGaugeCommandsApi({ server });
    const seen: string[] = [];
    const r = await api.watch(id, { since: 'queued', onUpdate: (c) => seen.push(c.state) });
    expect(r).toMatchObject({ ok: true, command: { state: 'done', result: { bpm: 62 } } });
    expect(seen).toEqual(['delivered', 'running', 'done']);
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/v1/gauge/commands/${id}?wait=25&since=queued`,
      `${BASE}/v1/gauge/commands/${id}?wait=25&since=delivered`,
      `${BASE}/v1/gauge/commands/${id}?wait=25&since=running`,
    ]);
  });

  it('caps a held read to the remaining deadline and does not poll again after it', async () => {
    let nowMs = 1_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const calls: string[] = [];
    const server = {
      isPaired: () => true,
      chatModelOptions: () => ({ serverUrl: BASE, deps: { fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        nowMs = 5_000;
        return new Response(JSON.stringify({ command: cmd(), online: true }), { status: 200 });
      }) as typeof fetch } }),
    };
    try {
      const r = await createGaugeCommandsApi({ server }).watch(cmd().id, { since: 'queued', deadlineMs: 3_500 });
      expect(r).toMatchObject({ ok: true, command: { state: 'queued' } });
      expect(calls).toEqual([`${BASE}/v1/gauge/commands/${cmd().id}?wait=3&since=queued`]);
    } finally {
      now.mockRestore();
    }
  });

  it('reads once without a hold when a watch deadline already passed', async () => {
    const { server, calls } = fakeServer([{ status: 200, body: { command: cmd(), online: true } }]);
    const r = await createGaugeCommandsApi({ server }).watch(cmd().id, { since: 'queued', deadlineMs: 0 });
    expect(r).toMatchObject({ ok: true, command: { state: 'queued' } });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/gauge/commands/${cmd().id}`]);
  });

  it('reads the link state, the recent list, and cancels', async () => {
    const state = { paired: true, installationId: 'x', online: false, lastPollAt: null, appVersion: '2.8.0', capabilities: ['hr.measure'], reels: null, recording: null, serverNow: '2026-10-27T04:00:00Z' };
    const { server, calls } = fakeServer([
      { status: 200, body: state },
      { status: 200, body: { commands: [cmd()] } },
      { status: 200, body: { command: cmd({ state: 'cancelled' }) } },
    ]);
    const api = createGaugeCommandsApi({ server });
    expect(await api.state()).toEqual({ ok: true, state });
    expect(await api.list({ limit: 5, type: 'hr.measure' })).toEqual({ ok: true, commands: [cmd()] });
    expect(await api.cancel(cmd().id)).toMatchObject({ ok: true, command: { state: 'cancelled' } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BASE}/v1/gauge/commands/state`,
      `GET ${BASE}/v1/gauge/commands?limit=5&type=hr.measure`,
      `DELETE ${BASE}/v1/gauge/commands/${cmd().id}`,
    ]);
  });

  it('makes ids the server accepts', () => {
    const ids = new Set(Array.from({ length: 50 }, newCommandId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16,40}$/);
  });
});
