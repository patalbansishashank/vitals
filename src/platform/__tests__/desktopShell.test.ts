import { afterEach, describe, expect, it, vi } from 'vitest';
import { onDesktopSyncNow } from '../desktopShell';

type Win = Window & { vitalsDesktop?: unknown };

afterEach(() => {
  delete (window as Win).vitalsDesktop;
});

describe('desktop shell bridge', () => {
  it('does nothing outside the desktop app', () => {
    const off = onDesktopSyncNow(() => undefined);
    expect(() => off()).not.toThrow();
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
});
