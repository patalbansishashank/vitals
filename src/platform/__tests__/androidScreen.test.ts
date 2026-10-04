import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAndroidShellForTests } from '../androidShell';
import { installAndroidScreen } from '../androidScreen';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

beforeEach(() => resetAndroidShellForTests());
afterEach(() => {
  removeFakeCapacitor();
  vi.restoreAllMocks();
});

describe('androidScreen', () => {
  it('makes the page hidden when the native window goes off screen, with a visibilitychange event', async () => {
    const fake = installFakeCapacitor();
    const off = installAndroidScreen();
    await flush();
    const seen: string[] = [];
    const on = () => seen.push(document.visibilityState);
    document.addEventListener('visibilitychange', on);
    try {
      expect(document.visibilityState).toBe('visible');
      fake.emit('screen', { on: false });
      expect(document.visibilityState).toBe('hidden');
      expect(document.hidden).toBe(true);
      fake.emit('screen', { on: false });
      fake.emit('screen', { on: true });
      expect(document.visibilityState).toBe('visible');
      expect(seen).toEqual(['hidden', 'visible']);
    } finally {
      document.removeEventListener('visibilitychange', on);
      off();
    }
    expect(Object.getOwnPropertyDescriptor(document, 'visibilityState')).toBeUndefined();
  });

  it('starts hidden when the app loads with the screen off', async () => {
    const fake = installFakeCapacitor();
    fake.plugin.getState.mockResolvedValueOnce({ bluetoothOn: true, notificationsAllowed: true, keepAliveOn: true, launchReason: 'launcher', onScreen: false } as never);
    const off = installAndroidScreen();
    await flush();
    await flush();
    expect(document.visibilityState).toBe('hidden');
    off();
  });

  it('stays hidden when Chromium itself says hidden (service off), whatever the native event says', async () => {
    const fake = installFakeCapacitor();
    const proto = Object.getPrototypeOf(document) as object;
    const spy = vi.spyOn(proto as Document, 'visibilityState', 'get').mockReturnValue('hidden');
    const off = installAndroidScreen();
    fake.emit('screen', { on: true });
    expect(document.visibilityState).toBe('hidden');
    off();
    spy.mockRestore();
  });
});
