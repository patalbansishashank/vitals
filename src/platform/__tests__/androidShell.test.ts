import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  androidShell,
  clearNotice,
  getShellState,
  onAndroid,
  onBootCompleted,
  onSharedFiles,
  requestNotificationPermission,
  resetAndroidShellForTests,
  saveFile,
  setRingPrefs,
} from '../androidShell';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

beforeEach(() => resetAndroidShellForTests());
afterEach(() => {
  removeFakeCapacitor();
  vi.restoreAllMocks();
});

describe('androidShell without the plugin (web, tests)', () => {
  it('resolves every call and returns no-op listeners', async () => {
    const shell = androidShell();
    expect(onAndroid()).toBe(false);
    await expect(shell.keepAlive(true, 'Ring connected')).resolves.toBeUndefined();
    await expect(shell.notify({ kind: 'battery_low', title: 'Ring battery low', text: '12 %' })).resolves.toBeUndefined();
    await expect(setRingPrefs({ keepConnected: true, ringKnown: true })).resolves.toBeUndefined();
    await expect(clearNotice('ring_disconnected')).resolves.toBeUndefined();
    await expect(saveFile({ name: 'a.txt', mime: 'text/plain', dataBase64: 'YQ==' })).resolves.toBeUndefined();
    await expect(requestNotificationPermission()).resolves.toBe(false);
    await expect(getShellState()).resolves.toBeNull();
    const offs = [shell.onBluetoothState(() => {}), shell.onResume(() => {}), onBootCompleted(() => {}), onSharedFiles(() => {})];
    for (const off of offs) expect(() => off()).not.toThrow();
  });

  it('ignores a Capacitor bridge that is not Android', async () => {
    const fake = installFakeCapacitor({ platform: 'web' });
    await androidShell().keepAlive(true, 'Ring connected');
    expect(onAndroid()).toBe(false);
    expect(fake.plugin.keepAlive).not.toHaveBeenCalled();
  });
});

describe('androidShell with the plugin', () => {
  it('forwards calls with the contract arguments and registers the plugin once', async () => {
    const fake = installFakeCapacitor();
    const shell = androidShell();
    expect(onAndroid()).toBe(true);
    await shell.keepAlive(true, 'Reading your ring…');
    await shell.keepAlive(false, '');
    await shell.notify({ kind: 'ring_disconnected', title: 'Ring disconnected', text: 'Open Vitals to reconnect.' });
    await clearNotice('battery_low');
    await setRingPrefs({ keepConnected: true, ringKnown: false });
    await saveFile({ name: 'x.csv', mime: 'text/csv', dataBase64: 'eA==' });
    expect(await requestNotificationPermission()).toBe(true);
    expect(await getShellState()).toEqual({ bluetoothOn: true, notificationsAllowed: false, keepAliveOn: false, launchReason: 'share' });

    expect(fake.plugin.keepAlive.mock.calls).toEqual([[{ on: true, text: 'Reading your ring…' }], [{ on: false }]]);
    expect(fake.plugin.notify).toHaveBeenCalledWith({ kind: 'ring_disconnected', title: 'Ring disconnected', text: 'Open Vitals to reconnect.' });
    expect(fake.plugin.clearNotice).toHaveBeenCalledWith({ kind: 'battery_low' });
    expect(fake.plugin.setPrefs).toHaveBeenCalledWith({ keepConnected: true, ringKnown: false });
    expect(fake.plugin.saveFile).toHaveBeenCalledWith({ name: 'x.csv', mime: 'text/csv', dataBase64: 'eA==' });
    expect(fake.cap.registerPlugin).toHaveBeenCalledTimes(1);
    expect(fake.cap.registerPlugin).toHaveBeenCalledWith('VitalsShell');
  });

  it('swallows a keepAlive permission refusal with one warning that carries no ring data', async () => {
    const fake = installFakeCapacitor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.plugin.keepAlive.mockRejectedValue(Object.assign(new Error('BLUETOOTH_CONNECT not granted'), { code: 'permission' }));
    await expect(androidShell().keepAlive(true, 'Ring at 41 %')).resolves.toBeUndefined();
    await expect(androidShell().keepAlive(true, 'Ring at 40 %')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/%|Ring at/);
  });

  it('passes other keepAlive errors on', async () => {
    const fake = installFakeCapacitor();
    fake.plugin.keepAlive.mockRejectedValue(Object.assign(new Error('boom'), { code: 'UNAVAILABLE' }));
    await expect(androidShell().keepAlive(true, 'Ring connected')).rejects.toThrow('boom');
  });

  it('swallows a keepAlive refusal from the background (not_allowed) too', async () => {
    const fake = installFakeCapacitor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.plugin.keepAlive.mockRejectedValue(Object.assign(new Error('background'), { code: 'not_allowed' }));
    await expect(androidShell().keepAlive(true, 'Ring connected')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('delivers events and removes the listener', async () => {
    const fake = installFakeCapacitor();
    const bt = vi.fn();
    const resume = vi.fn();
    const boot = vi.fn();
    const offBt = androidShell().onBluetoothState(bt);
    const offResume = androidShell().onResume(resume);
    const offBoot = onBootCompleted(boot);
    await flush();
    fake.emit('bluetoothState', { on: false });
    fake.emit('bluetoothState', { on: true });
    fake.emit('resume');
    fake.emit('bootCompleted');
    expect(bt.mock.calls).toEqual([[false], [true]]);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(boot).toHaveBeenCalledTimes(1);

    offBt();
    offResume();
    offBoot();
    offBt(); // twice is harmless
    await flush();
    expect(fake.removes.every((r) => r.mock.calls.length === 1)).toBe(true);
    expect(fake.listenerCount('bluetoothState')).toBe(0);
    fake.emit('bluetoothState', { on: false });
    expect(bt).toHaveBeenCalledTimes(2);
  });

  it('removes a listener whose handle arrives after the unsubscribe', async () => {
    const fake = installFakeCapacitor();
    const cb = vi.fn();
    const off = androidShell().onResume(cb);
    off(); // before addListener's promise settles
    await flush();
    expect(fake.removes).toHaveLength(1);
    expect(fake.removes[0]).toHaveBeenCalledTimes(1);
    fake.emit('resume');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('onSharedFiles', () => {
  it('drains at subscribe and on each sharedFiles event, building Files with name and type', async () => {
    const fake = installFakeCapacitor({
      pending: [{ name: 'export.xml', mime: 'text/xml', size: 7, path: '/cache/shared/export.xml' }],
      contents: { '/cache/shared/export.xml': new Blob(['<Health']) },
    });
    const got: File[][] = [];
    const off = onSharedFiles((files) => got.push(files));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]!.map((f) => [f.name, f.type, f.size])).toEqual([['export.xml', 'text/xml', 7]]);
    expect(await got[0]![0]!.text()).toBe('<Health');
    expect(fake.fetchMock.mock.calls[0]![0]).toBe(`${location.origin}/_capacitor_file_/cache/shared/export.xml`);

    fake.share({ name: 'a.csv', mime: 'text/csv', size: 3, path: '/cache/shared/a.csv' }, new Blob(['a,b']));
    fake.share({ name: 'b.json', mime: '', size: 2, path: '/cache/shared/b.json' }, new Blob(['{}'], { type: 'application/json' }));
    fake.emit('sharedFiles', { count: 2 });
    await vi.waitFor(() => expect(got).toHaveLength(2));
    expect(got[1]!.map((f) => [f.name, f.type])).toEqual([
      ['a.csv', 'text/csv'],
      ['b.json', 'application/json'],
    ]);

    off();
    fake.share({ name: 'c.csv', mime: 'text/csv', size: 1, path: '/cache/shared/c.csv' }, new Blob(['c']));
    fake.emit('sharedFiles', { count: 1 });
    await flush();
    await flush();
    expect(got).toHaveLength(2);
  });

  it('does not call back when nothing is waiting, and skips a file it cannot read', async () => {
    const fake = installFakeCapacitor({ pending: [{ name: 'gone.csv', mime: 'text/csv', size: 1, path: '/cache/shared/gone.csv' }] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();
    onSharedFiles(cb);
    await vi.waitFor(() => expect(fake.plugin.takeSharedFiles).toHaveBeenCalledTimes(1));
    await flush();
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('batteryOptimisation', () => {
  it('is absent without the plugin', () => {
    expect(androidShell().batteryOptimisation).toBeUndefined();
  });

  it('is absent when Capacitor is not Android', () => {
    installFakeCapacitor({ platform: 'web' });
    expect(androidShell().batteryOptimisation).toBeUndefined();
  });

  it('reports restricted and opens the settings screen', async () => {
    const fake = installFakeCapacitor();
    const r = await androidShell().batteryOptimisation!();
    expect(r.restricted).toBe(true);
    expect(fake.plugin.openBatterySettings).not.toHaveBeenCalled();
    r.openSettings();
    expect(fake.plugin.openBatterySettings).toHaveBeenCalledTimes(1);
  });

  it('reports not restricted when the app is on the allow list', async () => {
    const fake = installFakeCapacitor();
    fake.plugin.batteryOptimisation.mockResolvedValue({ restricted: false });
    expect((await androidShell().batteryOptimisation!()).restricted).toBe(false);
  });

  it('keeps the other members on the bridge that has it', async () => {
    const fake = installFakeCapacitor();
    const shell = androidShell();
    await shell.keepAlive(true, 'Ring connected');
    expect(fake.plugin.keepAlive).toHaveBeenCalledWith({ on: true, text: 'Ring connected' });
  });

  it('warns, without rejecting, when the settings screen cannot be opened', async () => {
    const fake = installFakeCapacitor();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await androidShell().batteryOptimisation!();
    fake.plugin.openBatterySettings.mockRejectedValueOnce(new Error('no activity'));
    r.openSettings();
    fake.plugin.openBatterySettings.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    r.openSettings();
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('rejects when the native side lacks the method, for the caller to decide', async () => {
    const fake = installFakeCapacitor();
    fake.plugin.batteryOptimisation.mockRejectedValue(Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }));
    await expect(androidShell().batteryOptimisation!()).rejects.toThrow('not implemented');
  });
});
