import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onAndroid, onSharedFiles, resetAndroidShellForTests, saveFile } from '../androidShell';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

beforeEach(() => resetAndroidShellForTests());
afterEach(() => {
  removeFakeCapacitor();
  vi.restoreAllMocks();
});

describe('androidShell without the plugin (web, tests)', () => {
  it('resolves every call and returns no-op listeners', async () => {
    expect(onAndroid()).toBe(false);
    await expect(saveFile({ name: 'a.txt', mime: 'text/plain', dataBase64: 'YQ==' })).resolves.toBeUndefined();
    const off = onSharedFiles(() => {});
    expect(() => off()).not.toThrow();
  });

  it('ignores a Capacitor bridge that is not Android', async () => {
    const fake = installFakeCapacitor({ platform: 'web' });
    await saveFile({ name: 'a.txt', mime: 'text/plain', dataBase64: 'YQ==' });
    expect(onAndroid()).toBe(false);
    expect(fake.plugin.saveFile).not.toHaveBeenCalled();
  });
});

describe('androidShell with the plugin', () => {
  it('forwards calls with the contract arguments and registers the plugin once', async () => {
    const fake = installFakeCapacitor();
    expect(onAndroid()).toBe(true);
    await saveFile({ name: 'x.csv', mime: 'text/csv', dataBase64: 'eA==' });
    await saveFile({ name: 'y.csv', mime: 'text/csv', dataBase64: 'eQ==' });
    expect(fake.plugin.saveFile).toHaveBeenCalledWith({ name: 'x.csv', mime: 'text/csv', dataBase64: 'eA==' });
    expect(fake.cap.registerPlugin).toHaveBeenCalledTimes(1);
    expect(fake.cap.registerPlugin).toHaveBeenCalledWith('VitalsShell');
  });

  it('removes a listener whose handle arrives after the unsubscribe', async () => {
    const fake = installFakeCapacitor();
    const cb = vi.fn();
    const off = onSharedFiles(cb);
    off(); // before addListener's promise settles
    await flush();
    expect(fake.removes).toHaveLength(1);
    expect(fake.removes[0]).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount('sharedFiles')).toBe(0);
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
