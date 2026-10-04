import { afterEach, expect, it, vi } from 'vitest';
import { watchEnvironment } from '../index';

afterEach(() => {
  delete (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop;
});

it('the desktop tray\'s "Sync now" runs a manual round while sync runs, and stops with it', () => {
  let tray: (() => void) | null = null;
  const off = vi.fn(() => void (tray = null));
  (window as unknown as { vitalsDesktop: unknown }).vitalsDesktop = {
    onSyncNow: (cb: () => void) => {
      tray = cb;
      return off;
    },
  };
  const scheduler = { setVisible: vi.fn(), trigger: vi.fn(async () => undefined) };
  const stop = watchEnvironment(scheduler);
  expect(tray).not.toBeNull();
  tray!();
  expect(scheduler.trigger).toHaveBeenCalledWith('manual');
  stop();
  expect(off).toHaveBeenCalledOnce();
});

it('outside the desktop app it only watches visibility and the network', () => {
  const scheduler = { setVisible: vi.fn(), trigger: vi.fn(async () => undefined) };
  const stop = watchEnvironment(scheduler);
  window.dispatchEvent(new Event('online'));
  expect(scheduler.trigger).toHaveBeenCalledWith('online');
  stop();
});
