import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAndroidShellForTests } from '../androidShell';
import { importSharedFile, installAndroidIntake } from '../androidIntake';
import { installAndroidShell } from '../androidBoot';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

const bus = vi.hoisted(() => ({
  dispatch: vi.fn(),
  wait: vi.fn(),
  result: vi.fn(),
  toast: vi.fn(),
  staged: new Map<string, unknown>(),
}));
vi.mock('@/commands', () => ({ dispatch: bus.dispatch, jobs: { wait: bus.wait, result: bus.result } }));
vi.mock('@/components/Toast', () => ({ toast: bus.toast }));

const nativeClick = HTMLAnchorElement.prototype.click;
let uninstall: () => void = () => {};
beforeEach(() => {
  resetAndroidShellForTests();
  for (const f of [bus.dispatch, bus.wait, bus.result, bus.toast]) f.mockReset();
});
afterEach(() => {
  uninstall();
  uninstall = () => {};
  removeFakeCapacitor();
  vi.restoreAllMocks();
});

describe('installAndroidIntake', () => {
  it('hands files waiting at start and later shares to the import, one at a time in order', async () => {
    const fake = installFakeCapacitor({
      pending: [{ name: 'health.zip', mime: 'application/zip', size: 2, path: '/cache/shared/health.zip' }],
      contents: { '/cache/shared/health.zip': new Blob(['PK']) },
    });
    const seen: string[] = [];
    let running = 0;
    const importFile = vi.fn(async (f: File) => {
      expect(running).toBe(0);
      running++;
      seen.push(`${f.name}|${f.type}`);
      await flush();
      running--;
    });
    uninstall = installAndroidIntake({ importFile });
    expect(installAndroidIntake({ importFile })).toBe(uninstall);
    await vi.waitFor(() => expect(seen).toEqual(['health.zip|application/zip']));

    fake.share({ name: 'a.csv', mime: 'text/csv', size: 1, path: '/cache/shared/a.csv' }, new Blob(['a']));
    fake.share({ name: 'b.json', mime: 'application/json', size: 2, path: '/cache/shared/b.json' }, new Blob(['{}']));
    fake.emit('sharedFiles', { count: 2 });
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.slice(1)).toEqual(['a.csv|text/csv', 'b.json|application/json']);

    uninstall();
    await flush();
    expect(fake.listenerCount('sharedFiles')).toBe(0);
  });

  it('keeps going after a failed import', async () => {
    installFakeCapacitor({
      pending: [
        { name: 'bad.bin', mime: '', size: 1, path: '/cache/shared/bad.bin' },
        { name: 'ok.csv', mime: 'text/csv', size: 1, path: '/cache/shared/ok.csv' },
      ],
      contents: { '/cache/shared/bad.bin': new Blob(['x']), '/cache/shared/ok.csv': new Blob(['y']) },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const importFile = vi.fn(async (f: File) => {
      if (f.name === 'bad.bin') throw new Error('unknown format');
    });
    uninstall = installAndroidIntake({ importFile });
    await vi.waitFor(() => expect(importFile).toHaveBeenCalledTimes(2));
  });

  it('does nothing on the web', () => {
    const importFile = vi.fn();
    uninstall = installAndroidIntake({ importFile });
    expect(importFile).not.toHaveBeenCalled();
  });
});

describe('importSharedFile', () => {
  it('stages the file for bio.import and reports the job in a toast', async () => {
    bus.dispatch.mockResolvedValue({ ok: true, job: { jobId: 'j1' } });
    bus.wait.mockResolvedValue({ jobId: 'j1', state: 'done', progress: 1 });
    bus.result.mockReturnValue({ records: 12, samples: 0, duplicates: 0, days: null });
    const { takeFile } = await import('@/biometrics/app/handoff');
    await importSharedFile(new File(['kind,date'], 'canonical.csv', { type: 'text/csv' }));
    expect(bus.dispatch).toHaveBeenCalledWith('bio.import', { fileRef: expect.any(String) });
    const staged = takeFile((bus.dispatch.mock.calls[0]![1] as { fileRef: string }).fileRef);
    expect(staged?.name).toBe('canonical.csv');
    expect(bus.toast).toHaveBeenCalledTimes(2);
    expect(bus.toast.mock.calls.every((c) => (c[1] as { id: string }).id === 'devices-job')).toBe(true);
  });

  it('shows the refusal when bio.import does not start', async () => {
    bus.dispatch.mockResolvedValue({ ok: false, error: { code: 'invalid_input', message: 'That file isn’t one Vitals can read.' } });
    await importSharedFile(new File(['?'], 'x.bin'));
    expect(bus.toast).toHaveBeenLastCalledWith('That file isn’t one Vitals can read.', { id: 'devices-job' });
    expect(bus.wait).not.toHaveBeenCalled();
  });
});

describe('importSharedFile errors', () => {
  it('shows a toast when the bus throws', async () => {
    bus.dispatch.mockRejectedValue(new Error('The bus broke.'));
    await expect(importSharedFile(new File(['?'], 'x.bin'))).resolves.toBeUndefined();
    expect(bus.toast).toHaveBeenLastCalledWith('The bus broke.', { id: 'devices-job' });
  });

  it('shows a toast when waiting for the job throws, and a plain one for a non-error', async () => {
    bus.dispatch.mockResolvedValue({ ok: true, job: { jobId: 'j2' } });
    bus.wait.mockRejectedValue('gone');
    await expect(importSharedFile(new File(['?'], 'x.bin'))).resolves.toBeUndefined();
    expect(bus.toast).toHaveBeenLastCalledWith('That didn’t work.', { id: 'devices-job' });
  });

  it('shows the job failure message', async () => {
    bus.dispatch.mockResolvedValue({ ok: true, job: { jobId: 'j3' } });
    bus.wait.mockResolvedValue({ jobId: 'j3', state: 'failed', progress: 0, error: { code: 'x', message: 'Unreadable zip.' } });
    await importSharedFile(new File(['?'], 'x.zip'));
    expect(bus.toast).toHaveBeenLastCalledWith('Unreadable zip.', { id: 'devices-job' });
  });
});

describe('unreadable shared files', () => {
  it('tells the person when a shared file cannot be read', async () => {
    installFakeCapacitor({ pending: [{ name: 'gone.csv', mime: 'text/csv', size: 1, path: '/cache/shared/gone.csv' }] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const importFile = vi.fn(async () => {});
    const unreadable = vi.fn();
    uninstall = installAndroidIntake({ importFile, unreadable });
    await vi.waitFor(() => expect(unreadable).toHaveBeenCalledWith(1));
    expect(importFile).not.toHaveBeenCalled();
  });

  it('toasts by default, and when the native side cannot hand the files over', async () => {
    const fake = installFakeCapacitor();
    fake.plugin.takeSharedFiles.mockRejectedValue(new Error('native'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    uninstall = installAndroidIntake({ importFile: vi.fn() });
    await vi.waitFor(() => expect(bus.toast).toHaveBeenCalledWith('That didn’t work.', { id: 'devices-job' }));
  });
});

describe('installAndroidShell', () => {
  it('does nothing on the web', () => {
    uninstall = installAndroidShell();
    expect(HTMLAnchorElement.prototype.click).toBe(nativeClick);
  });

  it('installs downloads and intake on Android, and uninstalls both', async () => {
    const fake = installFakeCapacitor();
    uninstall = installAndroidShell();
    expect(HTMLAnchorElement.prototype.click).not.toBe(nativeClick);
    await vi.waitFor(() => expect(fake.plugin.takeSharedFiles).toHaveBeenCalledTimes(1));
    uninstall();
    uninstall = () => {};
    expect(HTMLAnchorElement.prototype.click).toBe(nativeClick);
  });
});
