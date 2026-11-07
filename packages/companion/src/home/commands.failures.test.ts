// @vitest-environment node
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandHub, type CommandHub, type CommandHubOptions } from './commands.ts';
import type { CommandStore } from './commandStore.ts';
import type * as CommandStoreModule from './commandStore.ts';

const stores = vi.hoisted(() => new Map<string, CommandStore>());
vi.mock('./commandStore.ts', async (original) => ({
  ...await original<typeof CommandStoreModule>(),
  openCommandStore: (path: string) => stores.get(path)!,
}));
let hub: CommandHub | undefined;
afterEach(() => {
  hub?.close();
  hub = undefined;
  stores.clear();
  vi.useRealTimers();
});

function fixture() {
  vi.useFakeTimers();
  const store = {
    gaugeState: vi.fn(() => null), notePoll: vi.fn(), hasDeliverable: vi.fn(() => false),
    nextLeaseEnd: vi.fn((): number | null => Date.now() + 50), takeForPoll: vi.fn(() => []),
    sweep: vi.fn(() => 0), close: vi.fn(), cancel: vi.fn(() => 'ok'),
    get: vi.fn(() => ({ id: 'synthetic-command', state: 'cancelled' })),
  };
  const dir = tmpdir(); // paths only: openCommandStore is replaced; no database is created
  stores.set(`${dir}/commands.db`, store as unknown as CommandStore);
  const log = vi.fn();
  const options = {
    persons: { paths: () => ({ dir }) },
    devices: { list: async () => [{ id: 'phone', installationId: 'synthetic-phone' }] },
    resolveLumen: async () => ({ personId: 'synthetic-person', deviceId: 'phone', log }),
    resolveDevice: async () => ({ personId: 'synthetic-person', deviceId: 'desktop', log }),
    log,
  } as unknown as CommandHubOptions;
  hub = createCommandHub(options);
  const response = () => {
    const res = new EventEmitter() as EventEmitter & { destroyed: boolean; writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    res.destroyed = false;
    res.writeHead = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
  };
  const poll = (res: ReturnType<typeof response>, wait = 10) => hub!.handle({ method: 'GET' } as never, res as never, '/v1/lumen/commands', `?wait=${wait}`);
  return { store, response, poll, log };
}

describe('command hold and sweep failures', () => {
  it.each(['hasDeliverable', 'nextLeaseEnd'] as const)('rejects a held request when %s throws on a timer, removes listeners and accepts a retry', async (method) => {
    const t = fixture();
    const res = t.response();
    const held = t.poll(res);
    await vi.advanceTimersByTimeAsync(0);
    expect(res.listenerCount('close')).toBe(1);
    const error = Object.assign(new Error('database temporarily unavailable'), { code: 'SQLITE_BUSY' });
    t.store[method].mockImplementationOnce(() => { throw error; });
    const rejected = expect(held).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(res.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(1); // only the periodic sweep remains
    await vi.advanceTimersByTimeAsync(2000);
    const retry = t.response();
    await t.poll(retry, 0);
    expect(retry.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(retry.end).toHaveBeenCalled();
  });

  it('does not fail a successful cancelling request when a notified poll fails', async () => {
    const t = fixture();
    const res = t.response();
    const held = t.poll(res);
    await vi.advanceTimersByTimeAsync(0);
    const error = new Error('poll read failed');
    t.store.hasDeliverable.mockImplementationOnce(() => { throw error; });
    const rejected = expect(held).rejects.toBe(error);
    const cancelling = t.response();
    await hub!.handle({ method: 'DELETE' } as never, cancelling as never, '/v1/gauge/commands/synthetic-command', '');
    await rejected;
    expect(cancelling.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(res.listenerCount('close')).toBe(0);
  });

  it('cleans an initial lease lookup failure after the hold has installed its timers', async () => {
    const t = fixture();
    t.store.nextLeaseEnd.mockImplementationOnce(() => { throw new Error('lease failed'); });
    const res = t.response();
    await expect(t.poll(res)).rejects.toThrow('lease failed');
    expect(res.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps periodic sweep failures contained and retries on the next interval', async () => {
    const t = fixture();
    await t.poll(t.response(), 0);
    t.store.sweep.mockImplementationOnce(() => { throw new Error('database temporarily unavailable'); });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.log).toHaveBeenCalledWith('commands: expiry sweep failed; retrying next interval');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.store.sweep).toHaveBeenCalledTimes(2);
    expect(t.log).toHaveBeenCalledTimes(1);
  });
});
