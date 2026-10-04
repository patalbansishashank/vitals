import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTests } from '../detect';
import { shell, webShell } from '../shell';

afterEach(() => {
  setPlatformForTests(undefined);
  delete (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop;
});

describe('shell()', () => {
  it('is the Android bridge in the Android app and the web bridge elsewhere (§15.8)', () => {
    setPlatformForTests('android');
    expect(shell()).not.toBe(webShell);
    expect(typeof shell().keepAlive).toBe('function');
    for (const p of ['web', 'pwa'] as const) {
      setPlatformForTests(p);
      expect(shell()).toBe(webShell);
    }
  });

  it('is the desktop bridge in the desktop app: keepAlive reaches the preload (tray line, no app suspension)', async () => {
    const keepAlive = vi.fn();
    (window as unknown as { vitalsDesktop: unknown }).vitalsDesktop = { keepAlive };
    setPlatformForTests('electron');
    expect(shell()).not.toBe(webShell);
    await shell().keepAlive(true, 'Ring connected');
    expect(keepAlive).toHaveBeenCalledWith(true, 'Ring connected');
  });
});
