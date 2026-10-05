// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { McpCallRequest } from '../shared/bridge';
import { createPageRelay, NO_WINDOW_MESSAGE } from './pageRelay';

const make = (timeoutMs = 50) => {
  const sent: McpCallRequest[] = [];
  const relay = createPageRelay({ send: (r) => void sent.push(r), timeoutMs });
  return { sent, relay };
};

describe('pageRelay', () => {
  it('sends the request to the page and resolves with the page answer', async () => {
    const { sent, relay } = make();
    const p = relay.call({ client: 'claude-code', tool: 'today_get', args: { a: 1 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ client: 'claude-code', tool: 'today_get', args: { a: 1 } });
    expect(sent[0]!.callId).toMatch(/^[0-9a-f-]{36}$/);
    relay.handleResult({ callId: sent[0]!.callId, envelope: { ok: true, status: 'applied', summary: 'ok', data: { x: 1 } } });
    await expect(p).resolves.toEqual({ ok: true, status: 'applied', summary: 'ok', data: { x: 1 } });
  });

  it('two calls get distinct ids and are matched by id; unknown or repeated ids are ignored', async () => {
    const { sent, relay } = make();
    const a = relay.call({ client: 'c', tool: 'a', args: {} });
    const b = relay.call({ client: 'c', tool: 'b', args: {} });
    expect(sent[0]!.callId).not.toBe(sent[1]!.callId);
    relay.handleResult({ callId: 'nope', envelope: { ok: true, status: 'applied', summary: '' } });
    relay.handleResult({ callId: sent[1]!.callId, envelope: { ok: true, status: 'applied', summary: 'b' } });
    relay.handleResult({ callId: sent[1]!.callId, envelope: { ok: true, status: 'applied', summary: 'again' } });
    await expect(b).resolves.toMatchObject({ summary: 'b' });
    relay.handleResult({ callId: sent[0]!.callId, envelope: { ok: true, status: 'applied', summary: 'a' } });
    await expect(a).resolves.toMatchObject({ summary: 'a' });
  });

  it('passes a needs_choice answer through whole: nothing saved, the candidates (J3-02)', async () => {
    const { sent, relay } = make();
    const asked = {
      ok: true,
      status: 'needs_choice',
      saved: false,
      summary: 'Nothing logged yet. Pick one of these foods (or ask the person) and call log_meal again with its foodId.',
      candidates: [{ component: 'poha', foodId: 'poha_thin', name: 'Poha, thin' }],
    } as const;
    const p = relay.call({ client: 'claude-code', tool: 'log_meal', args: {} });
    relay.handleResult({ callId: sent[0]!.callId, envelope: asked });
    await expect(p).resolves.toEqual(asked);
  });

  it('a malformed envelope becomes a rejected result', async () => {
    const { sent, relay } = make();
    const p = relay.call({ client: 'c', tool: 'a', args: {} });
    relay.handleResult({ callId: sent[0]!.callId, envelope: { nope: true } });
    await expect(p).resolves.toMatchObject({ ok: false, status: 'rejected', error: { code: 'bad_result' } });
  });

  it('times out with the running/timeout envelope', async () => {
    const { sent, relay } = make(20);
    const p = relay.call({ client: 'c', tool: 'slow', args: {} });
    const r = await p;
    expect(r).toMatchObject({ ok: false, status: 'running', error: { code: 'timeout' } });
    expect(r.summary).toContain('did not answer in time');
    // a late answer is ignored
    relay.handleResult({ callId: sent[0]!.callId, envelope: { ok: true, status: 'applied', summary: 'late' } });
  });

  it('detach fails pending calls and drops the manifest; a failing send fails at once', async () => {
    const { relay } = make(1000);
    relay.setManifest({ format: 'vitals.tools/1', hash: 'h1', tools: [] });
    const changed = vi.fn();
    relay.onManifestChange(changed);
    const p = relay.call({ client: 'c', tool: 'a', args: {} });
    relay.detach();
    await expect(p).resolves.toMatchObject({ ok: false, status: 'rejected', summary: NO_WINDOW_MESSAGE, error: { code: 'unavailable' } });
    expect(relay.manifest()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);

    const broken = createPageRelay({
      send: () => {
        throw new Error('Object has been destroyed');
      },
      timeoutMs: 1000,
    });
    await expect(broken.call({ client: 'c', tool: 'a', args: {} })).resolves.toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('manifest changes notify listeners once per real change; unsubscribe works', () => {
    const { relay } = make();
    const changed = vi.fn();
    const off = relay.onManifestChange(changed);
    expect(relay.manifest()).toBeNull();
    relay.setManifest(null);
    expect(changed).not.toHaveBeenCalled();
    relay.setManifest({ format: 'vitals.tools/1', hash: 'h1', tools: [] });
    relay.setManifest({ format: 'vitals.tools/1', hash: 'h1', tools: [] }); // same hash: republished, not changed
    expect(changed).toHaveBeenCalledTimes(1);
    relay.setManifest({ format: 'vitals.tools/1', hash: 'h2', tools: [] });
    expect(changed).toHaveBeenCalledTimes(2);
    relay.setManifest(null);
    expect(changed).toHaveBeenCalledTimes(3);
    off();
    relay.setManifest({ format: 'vitals.tools/1', hash: 'h3', tools: [] });
    expect(changed).toHaveBeenCalledTimes(3);
    expect(relay.manifest()).toMatchObject({ hash: 'h3' });
  });
});
