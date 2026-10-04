// @vitest-environment node
/** Adversarial checks of the `vitals:` IPC handlers: foreign senders, odd arguments, secrets keys. */
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../shared/bridge';
import { registerIpc, type IpcDeps, type IpcMainSlice } from './ipc';

type Listener = (event: { senderFrame?: { url: string } | null; returnValue?: unknown }, ...args: unknown[]) => unknown;

function setup() {
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
    info: { version: '1.2.3', os: 'linux' as const },
    tray: vi.fn(() => ({ setStatus: vi.fn() })),
    autostart: { get: vi.fn(async () => true), set: vi.fn(async () => undefined) },
    updates: { check: vi.fn(async () => undefined), restart: vi.fn() },
    aiTools: { list: vi.fn(async () => []), add: vi.fn(async () => ({}) as never), remove: vi.fn(async () => ({}) as never) },
    relay: { handleResult: vi.fn(), setManifest: vi.fn() },
    setServer: vi.fn(),
    secrets: { get: vi.fn(async () => 'tok'), set: vi.fn(async () => undefined) },
    keepAlive: vi.fn(),
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
    for (const fn of [deps.autostart.get, deps.autostart.set, deps.updates.check, deps.updates.restart, deps.aiTools.list, deps.aiTools.add, deps.aiTools.remove, deps.secrets.get, deps.secrets.set]) {
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
    const get = async (...a: unknown[]) => handlers.get(CHANNELS.secretsGet)!(APP, ...a.slice(1));
    const set = async (...a: unknown[]) => handlers.get(CHANNELS.secretsSet)!(APP, ...a.slice(1));
    for (const k of ['agentToken:__proto__', 'agentToken:constructor', 'agentToken:codex ', 'agentToken:codex\0', 'agentToken:', 'syncWords', '__proto__', ['agentToken:codex'], { toString: () => 'agentToken:codex' }]) {
      await expect(get(APP, k), String(k)).rejects.toThrow();
      await expect(set(APP, k, 'v'), String(k)).rejects.toThrow();
    }
    await expect(set(APP, 'agentToken:codex', 42)).rejects.toThrow();
    await expect(set(APP, 'agentToken:codex', { v: 1 })).rejects.toThrow();
    expect(deps.secrets.get).not.toHaveBeenCalled();
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
});
