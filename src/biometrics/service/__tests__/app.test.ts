/**
 * The app wiring: the transport comes from `pickTransport()` (inside the Android and desktop apps `navigator.bluetooth`
 * does not exist, so Settings › Devices must not say rings are unavailable there), and the shell port speaks the
 * shell's notice shape and leaves keep-alive to the Android ring link on the phone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BleTransport } from '@/biometrics/ble/transports';

const h = vi.hoisted(() => {
  const mk = (kind: string, available: boolean) => {
    const t = {
      kind,
      requests: 0,
      isAvailable: async () => available,
      requestDevice: async (_q: unknown, o?: { chooser?: { update(l: Array<{ id: string; name?: string }>): void } }) => {
        t.requests++;
        o?.chooser?.update([{ id: `${kind}-ring-1`, name: 'Ring' }]);
        return new Promise<never>(() => undefined);
      },
    };
    return t;
  };
  return {
    picked: undefined as unknown,
    platform: 'web',
    web: mk('web', false),
    capacitor: mk('capacitor', true),
    electron: mk('electron', true),
    shell: { keepAlive: vi.fn(async () => undefined), notify: vi.fn(async () => undefined), onBluetoothState: vi.fn(() => () => undefined), onResume: vi.fn(() => () => undefined) },
  };
});

vi.mock('@/biometrics/ble/transports', () => ({
  webTransport: h.web,
  capacitorTransport: h.capacitor,
  electronTransport: h.electron,
  pickTransport: () => h.picked,
}));
vi.mock('@/platform', () => ({ platform: () => h.platform, shell: () => h.shell }));

const { appConnector, appShellPort } = await import('../app');

afterEach(() => {
  h.picked = undefined;
  h.platform = 'web';
  vi.clearAllMocks();
});

async function firstHit(t: { requests: number }): Promise<{ driverId: string } | undefined> {
  const ac = new AbortController();
  const it = appConnector().scan(ac.signal)[Symbol.asyncIterator]();
  const hit = await Promise.race([it.next().then((r) => r.value as { driverId: string } | undefined), new Promise<undefined>((r) => setTimeout(r, 500))]);
  ac.abort();
  expect(t.requests).toBeGreaterThan(0);
  return hit;
}

describe('appConnector picks the transport the way pickTransport does', () => {
  it('keeps an unidentified chooser pick on the ring connector through GATT discovery', async () => {
    let requests = 0;
    let disconnects = 0;
    const transport: BleTransport = {
      kind: 'electron', isAvailable: async () => true,
      requestDevice: async (_query, opts) => {
        requests++;
        opts?.chooser?.update([{ id: 'picked', name: 'Unlabelled ring' }]);
        expect(await opts?.chooser?.chosen).toBe('picked');
        return {
          deviceId: 'picked', deviceName: 'Unlabelled ring', services: async () => [],
          write: async () => {}, subscribe: async () => () => {}, onDisconnect: () => () => {},
          disconnect: async () => { disconnects++; },
        };
      },
    };
    h.picked = transport;
    const connector = appConnector();
    const scan = connector.scan(new AbortController().signal)[Symbol.asyncIterator]();
    const hit = (await scan.next()).value!;
    expect(hit.driverId).toBe('unidentified');
    await expect(connector.connect(hit, new AbortController().signal)).rejects.toMatchObject({ code: 'unsupported' });
    expect(requests).toBe(1);
    expect(disconnects).toBe(1);
    expect((await scan.next()).done).toBe(true);
  });

  it('the Android app: Capacitor is ready and its scan list reaches the service', async () => {
    h.picked = h.capacitor as unknown as BleTransport;
    h.platform = 'web'; // even when the platform name says web, the native bridge decides
    expect(await appConnector().available()).toBe('ready');
    h.capacitor.requests = 0;
    expect(await firstHit(h.capacitor)).toBeDefined();
  });

  it('the desktop app: the Electron bridge is ready', async () => {
    h.picked = h.electron as unknown as BleTransport;
    expect(await appConnector().available()).toBe('ready');
    h.electron.requests = 0;
    expect(await firstHit(h.electron)).toBeDefined();
  });

  it('a browser without Web Bluetooth: unsupported', async () => {
    h.picked = undefined;
    expect(await appConnector().available()).toBe('unsupported');
  });
});

describe('appShellPort', () => {
  it('passes the shell its notice shape', async () => {
    const port = appShellPort();
    await port.notify!({ kind: 'ring_disconnected', title: 'Ring connected elsewhere', text: 'Your J-Style 2301 is now connected to Laptop.' });
    expect(h.shell.notify).toHaveBeenCalledWith({ kind: 'ring_disconnected', title: 'Ring connected elsewhere', text: 'Your J-Style 2301 is now connected to Laptop.' });
    port.keepAlive!(true, 'Ring connected');
    expect(h.shell.keepAlive).toHaveBeenCalledWith(true, 'Ring connected');
  });

  it('on Android keep-alive is left to the ring link', () => {
    h.platform = 'android';
    expect(appShellPort().keepAlive).toBeUndefined();
  });
});
