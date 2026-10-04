// @vitest-environment node
/** Adversarial checks of the `vitals:` IPC handlers: foreign senders, odd arguments, secrets keys. */
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../shared/bridge';
import { ADD_INPUT_MS, registerIpc, watchRealInput, type IpcDeps, type IpcMainSlice } from './ipc';

type Listener = (event: { senderFrame?: { url: string } | null; returnValue?: unknown }, ...args: unknown[]) => unknown;

function setup(o: { lastInput?: number | null; now?: number } = {}) {
  const handlers = new Map<string, Listener>();
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainSlice = {
    on: (c, l) => void listeners.set(c, l as Listener),
    removeListener: (c) => void listeners.delete(c),
    handle: (c, l) => void handlers.set(c, l as Listener),
    removeHandler: (c) => void handlers.delete(c),
  };
  const deps = {
    ipcMain,
    info: { version: '1.2.3', os: 'linux' as const, secretsPersistent: false },
    tray: vi.fn(() => ({ setStatus: vi.fn() })),
    autostart: { get: vi.fn(async () => true), set: vi.fn(async () => undefined) },
    updates: { check: vi.fn(async () => undefined), restart: vi.fn() },
    aiTools: { list: vi.fn(async () => []), add: vi.fn(async () => ({}) as never), remove: vi.fn(async () => ({}) as never) },
    relay: { handleResult: vi.fn(), setManifest: vi.fn() },
    setServer: vi.fn(),
    secrets: { set: vi.fn(async () => undefined) },
    keepAlive: vi.fn(),
    // a click a moment ago, unless the test says otherwise
    realInput: { take: vi.fn(() => (o.lastInput === undefined ? 1_000 : o.lastInput)) },
    now: () => o.now ?? 1_500,
  } satisfies IpcDeps;
  const off = registerIpc(deps);
  return { deps, handlers, listeners, off };
}

const APP = { senderFrame: { url: 'app://vitals/settings' } };
const FOREIGN = [
  { senderFrame: { url: 'https://evil.example/' } },
  { senderFrame: { url: 'app://vitals.evil/' } },
  { senderFrame: { url: 'app://vitals@evil/' } },
  { senderFrame: { url: 'file:///home/x/index.html' } },
  { senderFrame: { url: 'about:blank' } },
  { senderFrame: null },
  {},
];

describe('registerIpc (verify)', () => {
  it('every invoke channel rejects a foreign or missing sender frame and never reaches the module', async () => {
    const { deps, handlers } = setup();
    expect(handlers.size).toBeGreaterThan(0);
    for (const [channel, h] of handlers) {
      for (const ev of FOREIGN) {
        let threw = false;
        try {
          await h({ ...ev }, 'codex', 'x');
        } catch {
          threw = true;
        }
        expect(threw, `${channel} ${JSON.stringify(ev)}`).toBe(true);
      }
    }
    for (const fn of [deps.autostart.get, deps.autostart.set, deps.updates.check, deps.updates.restart, deps.aiTools.list, deps.aiTools.add, deps.aiTools.remove, deps.secrets.set]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('every send channel ignores a foreign sender; info answers it with null', () => {
    const { deps, listeners } = setup();
    for (const [channel, l] of listeners) {
      for (const ev of FOREIGN) {
        const e: { senderFrame?: { url: string } | null; returnValue?: unknown } = { ...ev };
        l(e, { callId: 'c', envelope: {} }, true, 'x');
        if (channel === CHANNELS.info) expect(e.returnValue).toBeNull();
      }
    }
    expect(deps.relay.handleResult).not.toHaveBeenCalled();
    expect(deps.relay.setManifest).not.toHaveBeenCalled();
    expect(deps.setServer).not.toHaveBeenCalled();
    expect(deps.keepAlive).not.toHaveBeenCalled();
    expect(deps.tray).not.toHaveBeenCalled();
  });

  it('secrets keys outside the agent tokens are refused (prototype names, padding, other prefixes)', async () => {
    const { deps, handlers } = setup();
    // Electron turns a handler's throw into the invoke's rejection
    const set = async (...a: unknown[]) => handlers.get(CHANNELS.secretsSet)!(APP, ...a.slice(1));
    for (const k of ['agentToken:__proto__', 'agentToken:constructor', 'agentToken:codex ', 'agentToken:codex\0', 'agentToken:', 'syncWords', '__proto__', ['agentToken:codex'], { toString: () => 'agentToken:codex' }]) {
      await expect(set(APP, k, 'v'), String(k)).rejects.toThrow();
    }
    await expect(set(APP, 'agentToken:codex', 42)).rejects.toThrow();
    await expect(set(APP, 'agentToken:codex', { v: 1 })).rejects.toThrow();
    expect(deps.secrets.set).not.toHaveBeenCalled();
    await set(APP, 'agentToken:codex', null);
    expect(deps.secrets.set).toHaveBeenCalledWith('agentToken:codex', null);
  });

  it('add and remove take only the known AI tool ids', async () => {
    const { deps, handlers } = setup();
    for (const id of ['../codex', 'codex\n', 'CODEX', '', null, ['codex'], 'constructor']) {
      await expect((async () => handlers.get(CHANNELS.mcpAdd)!(APP, id))(), String(id)).rejects.toThrow();
      await expect((async () => handlers.get(CHANNELS.mcpRemove)!(APP, id))(), String(id)).rejects.toThrow();
    }
    expect(deps.aiTools.add).not.toHaveBeenCalled();
    expect(deps.aiTools.remove).not.toHaveBeenCalled();
  });

  it('odd payloads from the page are cut to the contract (no extra fields, bounded text)', () => {
    const { deps, listeners } = setup();
    listeners.get(CHANNELS.mcpServer)!(APP, { mcpUrl: 'https://x.test/mcp', token: 'leak', extra: 1 });
    expect(deps.setServer).toHaveBeenLastCalledWith({ mcpUrl: 'https://x.test/mcp' });
    listeners.get(CHANNELS.mcpServer)!(APP, { mcpUrl: 42 });
    expect(deps.setServer).toHaveBeenLastCalledWith(null);
    listeners.get(CHANNELS.keepAlive)!(APP, 'yes', 'x'.repeat(10_000));
    expect(deps.keepAlive).toHaveBeenLastCalledWith(false, 'x'.repeat(200));
    listeners.get(CHANNELS.mcpResult)!(APP, { callId: 5 });
    listeners.get(CHANNELS.mcpResult)!(APP, null);
    expect(deps.relay.handleResult).not.toHaveBeenCalled();
  });

  it('autostart.set turns anything but true into false', async () => {
    const { deps, handlers } = setup();
    await handlers.get(CHANNELS.autostartSet)!(APP, 'true');
    await handlers.get(CHANNELS.autostartSet)!(APP, 1);
    expect(deps.autostart.set.mock.calls).toEqual([[false], [false]]);
  });

  it('unregistering removes every channel', () => {
    const { handlers, listeners, off } = setup();
    off();
    expect(handlers.size).toBe(0);
    expect(listeners.size).toBe(0);
  });

  // review DESK-06: the page can hand a key over but never read one back
  it('no channel reads a secret back; info says whether the keys survive a restart', () => {
    const { handlers, listeners } = setup();
    expect([...handlers.keys(), ...listeners.keys()].filter((c) => c.startsWith('vitals:secrets:'))).toEqual([CHANNELS.secretsSet]);
    expect(Object.keys(CHANNELS).filter((k) => /secret/i.test(k))).toEqual(['secretsSet']);
    const e: { senderFrame?: { url: string }; returnValue?: unknown } = { ...APP };
    listeners.get(CHANNELS.info)!(e);
    expect(e.returnValue).toEqual({ version: '1.2.3', os: 'linux', secretsPersistent: false });
  });

  // review DESK-06: main sends an agent key to the server address, so it takes only https, or http on this computer
  it('the server address is https, or http to this computer; anything else is no server', () => {
    const { deps, listeners } = setup();
    const server = listeners.get(CHANNELS.mcpServer)!;
    for (const ok of ['https://server.example:8443/mcp', 'http://127.0.0.1:8787/mcp', 'http://[::1]:8787/mcp', 'http://localhost:8787/mcp', 'http://LOCALHOST/mcp']) {
      server(APP, { mcpUrl: ok });
      expect(deps.setServer, ok).toHaveBeenLastCalledWith({ mcpUrl: ok });
    }
    for (const bad of [
      'http://server.example:8443/mcp',
      'http://localhost.example/mcp',
      'http://127.0.0.1.example/mcp',
      'ws://server.example/mcp',
      'file:///tmp/mcp',
      'javascript:alert(1)',
      Object.assign(new URL('https://server.example/mcp'), { username: 'a', password: 'b' }).href, // a user and password in the address
      'not a url',
      `https://server.example/${'x'.repeat(3000)}`,
    ]) {
      deps.setServer.mockClear();
      server(APP, { mcpUrl: bad });
      expect(deps.setServer, bad).toHaveBeenCalledWith(null);
    }
  });

  // review DESK-07: the page can be given activation without a click, so main wants a real input event too
  it('Add needs a real click or key press in the last few seconds; one input allows one Add', async () => {
    const add = (o: Parameters<typeof setup>[0]) => {
      const s = setup(o);
      return { ...s, run: async () => s.handlers.get(CHANNELS.mcpAdd)!(APP, 'codex') };
    };
    const none = add({ lastInput: null });
    await expect(none.run()).rejects.toThrow('Add needs a click');
    expect(none.deps.aiTools.add).not.toHaveBeenCalled();

    const stale = add({ lastInput: 1_000, now: 1_000 + ADD_INPUT_MS + 1 });
    await expect(stale.run()).rejects.toThrow('Add needs a click');
    expect(stale.deps.aiTools.add).not.toHaveBeenCalled();

    const fresh = add({ lastInput: 1_000, now: 1_000 + ADD_INPUT_MS });
    await fresh.run();
    expect(fresh.deps.aiTools.add).toHaveBeenCalledWith('codex');
    expect(fresh.deps.realInput.take).toHaveBeenCalledTimes(1);
  });

  it('watchRealInput counts clicks, keys and taps, not mouse moves or wheels, and each input once', () => {
    let t = 100;
    let fire: (input: { type: string }) => void = () => undefined;
    const input = watchRealInput({ on: (_event, l) => void (fire = (i) => l({}, i)) }, () => t);
    // nothing yet: what `executeJavaScript('0', true)` leaves behind
    expect(input.take()).toBeNull();
    for (const type of ['mouseMove', 'mouseEnter', 'mouseWheel', 'gestureScrollBegin', 'undefined']) fire({ type });
    expect(input.take()).toBeNull();
    for (const type of ['mouseUp', 'rawKeyDown', 'keyUp', 'char', 'gestureTap']) {
      t += 1;
      fire({ type });
      expect(input.take(), type).toBe(t);
      expect(input.take(), `${type} again`).toBeNull();
    }
  });
});
