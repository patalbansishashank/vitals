import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopShell, onDesktopSyncNow } from '../desktopShell';

type Win = Window & { vitalsDesktop?: unknown };

afterEach(() => {
  delete (window as Win).vitalsDesktop;
  vi.unstubAllGlobals();
});

describe('desktop shell bridge', () => {
  it('does nothing outside the desktop app', async () => {
    await expect(desktopShell().keepAlive(true, 'Ring connected')).resolves.toBeUndefined();
    const off = onDesktopSyncNow(() => undefined);
    expect(() => off()).not.toThrow();
  });

  it('keepAlive sets the tray status through the preload', async () => {
    const keepAlive = vi.fn();
    (window as Win).vitalsDesktop = { keepAlive };
    await desktopShell().keepAlive(true, 'Ring connected · 82 %');
    await desktopShell().keepAlive(false, '');
    expect(keepAlive.mock.calls).toEqual([
      [true, 'Ring connected · 82 %'],
      [false, ''],
    ]);
  });

  it('resume fires when the window is shown again, and stops after off()', () => {
    let shown: (() => void) | null = null;
    const offShow = vi.fn();
    (window as Win).vitalsDesktop = {
      onShow: (cb: () => void) => {
        shown = cb;
        return offShow;
      },
    };
    const cb = vi.fn();
    const off = desktopShell().onResume(cb);
    shown!();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(offShow).toHaveBeenCalled();
  });

  it('tray "Sync now" reaches the subscriber', () => {
    let fire: (() => void) | null = null;
    (window as Win).vitalsDesktop = {
      onSyncNow: (cb: () => void) => {
        fire = cb;
        return () => undefined;
      },
    };
    const cb = vi.fn();
    onDesktopSyncNow(cb);
    fire!();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('a notice uses the system notification with one tag per kind', async () => {
    const made: Array<{ title: string; o: NotificationOptions }> = [];
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = vi.fn();
      constructor(title: string, o: NotificationOptions) {
        made.push({ title, o });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    await desktopShell().notify({ kind: 'ring_disconnected', title: 'Ring disconnected', text: 'Vitals will reconnect when it is near.' });
    expect(made).toEqual([{ title: 'Ring disconnected', o: { body: 'Vitals will reconnect when it is near.', tag: 'vitals-ring_disconnected', silent: false } }]);
  });
});
