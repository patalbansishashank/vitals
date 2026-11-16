/**
 * (r070) The engine store: reads the plugin's state and its events, hands it the paired server (again when the pairing
 * changes), re-reads when the app comes to the front, and wraps every action (busy, the returned state, errors in words).
 * The engine feeds "Gauge sent hh:mm" once it is active.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeEngine, baseState } from '@/features/ring/engine/__tests__/fakeEngine';
import { lastSentOf, useGaugeLive, waitingOf } from '@/features/ring/localFill';
import type { EngineState } from '@/platform/gaugeEngine';
import { clearGaugeEngineServer, engine, engineActive, engineLocalSnapshot, engineSnapshot, pairedCredentials, resetGaugeEngineStoreForTests, startGaugeEngine, type EngineDeps, type EngineReadings } from '../gaugeEngine';
import { SERVER_KEY } from '@/net/server';

const tick = () => new Promise((r) => setTimeout(r, 0));
const CREDS = { serverUrl: 'https://home.example', deviceToken: 'tok-1' };

function start(over: Partial<EngineDeps> = {}) {
  const f = fakeEngine();
  let pairing = () => undefined as void;
  const deps: Partial<EngineDeps> = { plugin: () => f.plugin, credentials: () => CREDS, onPairing: (fn) => ((pairing = fn), () => undefined), visible: () => true, now: () => Date.parse('2026-10-30T10:00:00Z'), ...over };
  const stop = startGaugeEngine(deps);
  return { f, stop, pairing: () => pairing() };
}

afterEach(() => {
  resetGaugeEngineStoreForTests();
  localStorage.clear();
});

describe('engine store', () => {
  it('stays unavailable without the plugin (web, desktop)', async () => {
    startGaugeEngine({ plugin: () => null, onPairing: () => () => undefined });
    await tick();
    expect(engineSnapshot()).toMatchObject({ available: false, state: null });
    expect(engineActive()).toBe(false);
    // actions do nothing, and never throw
    await expect(engine.syncNow()).resolves.toBeUndefined();
  });

  it('reads the state, follows its events and stops listening when stopped', async () => {
    const { f, stop } = start();
    await tick();
    expect(engineSnapshot().available).toBe(true);
    expect(engineSnapshot().state?.ring.name).toBe('Ring 7C41');
    expect(engineSnapshot().at).toBe(Date.parse('2026-10-30T10:00:00Z'));
    f.set(baseState({ ring: { state: 'disconnected', name: 'Ring 7C41' } }));
    expect(engineSnapshot().state?.ring.state).toBe('disconnected');
    expect(f.listenerCount()).toBe(1);
    stop();
    await tick();
    expect(f.listenerCount()).toBe(0);
  });

  it('configures once per pairing and explicitly clears native identity when the pairing is forgotten', async () => {
    let creds: typeof CREDS | null = CREDS;
    const { f, pairing } = start({ credentials: () => creds });
    await tick();
    expect(f.plugin.configure).toHaveBeenCalledTimes(1);
    expect(f.plugin.configure).toHaveBeenCalledWith(CREDS);
    expect(engineSnapshot().configured).toBe(true);
    pairing(); // nothing changed: not sent again
    expect(f.plugin.configure).toHaveBeenCalledTimes(1);
    creds = { serverUrl: 'https://home.example', deviceToken: 'tok-2' };
    pairing();
    await tick();
    expect(f.plugin.configure).toHaveBeenLastCalledWith({ serverUrl: 'https://home.example', deviceToken: 'tok-2' });
    creds = null; // forgotten
    pairing();
    expect(engineSnapshot().configured).toBe(false);
    await tick();
    expect(f.plugin.configure).toHaveBeenCalledTimes(3);
    expect(f.plugin.configure).toHaveBeenLastCalledWith({ serverUrl: '', deviceToken: '' });
  });

  it('clears a retained native pairing on an initially unpaired web boot, without repeating on every foreground', async () => {
    const { f } = start({ credentials: () => null });
    await tick();
    expect(f.plugin.configure).toHaveBeenCalledExactlyOnceWith({ serverUrl: '', deviceToken: '' });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(f.plugin.configure).toHaveBeenCalledTimes(1);
    expect(engineSnapshot().configured).toBe(false);
  });

  it('waits for an old pair response, skips superseded targets and leaves native identity cleared after Forget', async () => {
    let credentials: typeof CREDS | null = CREDS;
    let release!: () => void;
    let nativeIdentity: typeof CREDS | null = null;
    const f = fakeEngine();
    f.plugin.configure.mockImplementation(async (next) => {
      if (next.deviceToken === CREDS.deviceToken) await new Promise<void>((resolve) => { release = resolve; });
      nativeIdentity = next;
    });
    const { pairing } = start({ plugin: () => f.plugin, credentials: () => credentials });
    await tick();
    credentials = { ...CREDS, deviceToken: 'superseded' };
    pairing();
    credentials = null;
    pairing();
    const cleared = clearGaugeEngineServer();
    expect(engineSnapshot().configured).toBe(false);
    expect(f.plugin.configure).toHaveBeenCalledTimes(1);
    release();
    await cleared;
    expect(nativeIdentity).toEqual({ serverUrl: '', deviceToken: '' });
    expect(f.plugin.configure.mock.calls.map(([c]) => c.deviceToken)).toEqual([CREDS.deviceToken, '']);
    expect(engineSnapshot().configured).toBe(false);
    // An erased pairing can still exist in web storage until erase commits. Foreground must not re-send it.
    credentials = CREDS;
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(f.plugin.configure).toHaveBeenCalledTimes(2);
    // An explicit later pair is allowed to configure the new identity.
    credentials = { ...CREDS, deviceToken: 'new-pair' };
    pairing();
    await tick();
    expect(nativeIdentity).toEqual(credentials);
    expect(engineSnapshot().configured).toBe(true);
  });

  it('clears again after a failed pair that may have partially changed a previously cleared native identity', async () => {
    let credentials: typeof CREDS | null = null;
    let rejectPair!: (error: Error) => void;
    let nativeIdentity: typeof CREDS | null = null;
    const f = fakeEngine();
    f.plugin.configure.mockImplementation(async (next) => {
      nativeIdentity = next;
      if (next.deviceToken) await new Promise<void>((_, reject) => { rejectPair = reject; });
    });
    const { pairing } = start({ plugin: () => f.plugin, credentials: () => credentials });
    await tick();
    credentials = CREDS;
    pairing();
    await tick();
    credentials = null;
    pairing();
    const cleared = clearGaugeEngineServer();
    rejectPair(new Error('Failed after saving identity'));
    await cleared;
    expect(nativeIdentity).toEqual({ serverUrl: '', deviceToken: '' });
    expect(f.plugin.configure.mock.calls.map(([c]) => c.deviceToken)).toEqual(['', CREDS.deviceToken, '']);
    expect(engineSnapshot().configured).toBe(false);
  });

  it('propagates a failed explicit detach and retries clear, rather than restoring the old pairing, on foreground', async () => {
    const { f } = start();
    await tick();
    f.plugin.configure.mockRejectedValueOnce(new Error('Native storage unavailable'));
    await expect(clearGaugeEngineServer()).rejects.toThrow('Native storage unavailable');
    expect(engineSnapshot().configured).toBe(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(f.plugin.configure).toHaveBeenLastCalledWith({ serverUrl: '', deviceToken: '' });
    expect(f.plugin.configure).toHaveBeenCalledTimes(3);
  });

  it('asks again when configure failed, the next time the app comes to the front', async () => {
    const g = fakeEngine();
    g.plugin.configure.mockRejectedValueOnce(new Error('boom'));
    startGaugeEngine({ plugin: () => g.plugin, credentials: () => CREDS, onPairing: () => () => undefined, visible: () => true });
    await tick();
    expect(engineSnapshot().configured).toBe(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(g.plugin.configure).toHaveBeenCalledTimes(2);
    expect(engineSnapshot().configured).toBe(true);
    expect(g.plugin.getState.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reads the paired credentials from the device-local pairing, and nothing without one', () => {
    expect(pairedCredentials()).toBeNull();
    localStorage.setItem(SERVER_KEY, JSON.stringify({ baseUrl: 'https://home.example', token: 'abc', deviceId: 'd', person: { id: 'p', label: 'x' }, pairedAt: '' }));
    expect(pairedCredentials()).toEqual({ serverUrl: 'https://home.example', deviceToken: 'abc' });
    localStorage.setItem(SERVER_KEY, '{nope');
    expect(pairedCredentials()).toBeNull();
  });

  it('an action shows busy meanwhile, takes the state it returns, and turns a rejection into words', async () => {
    const { f } = start();
    await tick();
    let release!: () => void;
    f.plugin.syncNow.mockImplementationOnce(() => new Promise((r) => (release = () => r(baseState({ ring: { state: 'connected', name: 'Ring 7C41', lastSyncAt: '2026-10-30T10:05:00.000Z' } })))));
    const p = engine.syncNow();
    expect(engineSnapshot().busy).toEqual(['sync']);
    release();
    await p;
    expect(engineSnapshot().busy).toEqual([]);
    expect(engineSnapshot().state?.ring.lastSyncAt).toBe('2026-10-30T10:05:00.000Z');
    f.plugin.forgetRing.mockRejectedValueOnce(new Error('Bluetooth is off'));
    await engine.forget();
    expect(engineSnapshot().error).toEqual({ action: 'forget', message: 'Bluetooth is off' });
    // the next action clears it
    await engine.syncNow();
    expect(engineSnapshot().error).toBeNull();
  });

  it('one tap per permission: a runtime one asks, Usage access and battery open the system screen', async () => {
    const { f } = start();
    await tick();
    await engine.fix('healthConnect');
    expect(f.plugin.requestPermissions).toHaveBeenCalledWith({ which: ['healthConnect'] });
    await engine.fix('usageAccess');
    expect(f.plugin.openUsageAccessSettings).toHaveBeenCalledTimes(1);
    expect(f.plugin.openAccessibilitySettings).not.toHaveBeenCalled();
    expect(f.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    await engine.fix('batteryUnrestricted');
    expect(f.plugin.openBatterySettings).toHaveBeenCalledTimes(1);
    await engine.setLimit(null);
    expect(f.plugin.setShortVideoLimit).toHaveBeenCalledWith({ dailyLimit: null });
    await engine.measure('spo2');
    expect(f.plugin.measure).toHaveBeenCalledWith({ kind: 'spo2' });
  });

  it('a refused Usage access screen becomes words, under its own key', async () => {
    const { f } = start();
    await tick();
    f.plugin.openUsageAccessSettings.mockRejectedValueOnce(new Error('Could not open the settings screen.'));
    await engine.fix('usageAccess');
    expect(engineSnapshot().error).toEqual({ action: 'permission:usageAccess', message: 'Could not open the settings screen.' });
  });

  it('does nothing where there is no engine', async () => {
    startGaugeEngine({ plugin: () => null, onPairing: () => () => undefined });
    await tick();
    await expect(engine.fix('usageAccess')).resolves.toBeUndefined();
    expect(engineSnapshot().busy).toEqual([]);
  });

  it('uninstalling Gauge asks the plugin, then reads the state again', async () => {
    const { f } = start();
    await tick();
    const reads = f.plugin.getState.mock.calls.length;
    await engine.uninstallGauge();
    expect(f.plugin.uninstallGauge).toHaveBeenCalledTimes(1);
    expect(f.plugin.getState.mock.calls.length).toBe(reads + 1);
  });

  it('once active it is the local snapshot: "sent" and "waiting" come from the engine', async () => {
    const { f } = start();
    await tick();
    const snap = engineLocalSnapshot();
    expect(snap?.upload).toMatchObject({ paired: true, pending: 3, lastSentAt: '2026-10-30T09:31:00.000Z' });
    // the older native app sends no readings: the server's steps and heart rate stand
    expect(snap?.today).toBeNull();
    expect(snap?.latestHr).toBeNull();
    const { result } = renderHook(() => useGaugeLive());
    expect(lastSentOf('2026-10-30T09:00:00.000Z', result.current)).toBe('2026-10-30T09:31:00.000Z');
    expect(waitingOf(result.current, Date.now() + 3_600_000)).toBe(3);
    act(() => f.set(baseState({ upload: { paired: true, pending: 0, lastSentAt: '2026-10-30T10:10:00.000Z' } })));
    expect(lastSentOf(null, result.current)).toBe('2026-10-30T10:10:00.000Z');
    expect(waitingOf(result.current, Date.now())).toBe(0);
    // while Gauge is still installed the engine is passive: Gauge's own provider answers
    act(() => f.set(baseState({ mode: 'passive' })));
    expect(engineLocalSnapshot()).toBeNull();
    expect(result.current.local).toBeNull();
  });

  it('today\'s ring steps and the newest heart rate arrive with the state event and are the local snapshot at once', async () => {
    const { f } = start();
    await tick();
    const { result } = renderHook(() => useGaugeLive());
    expect(result.current.local).toMatchObject({ today: null, latestHr: null });
    const readings: EngineReadings = {
      today: { date: '2026-10-30', ringSteps: 4321, ringStepsAt: '2026-10-30T09:58:00Z' },
      latestHr: { bpm: 73, at: '2026-10-30T09:57:00Z' },
    };
    act(() => f.set({ ...baseState(), ...readings }));
    expect(result.current.local?.today).toEqual({ date: '2026-10-30', ringSteps: 4321, ringStepsAt: '2026-10-30T09:58:00Z' });
    expect(result.current.local?.latestHr).toEqual({ bpm: 73, at: '2026-10-30T09:57:00Z' });
    // the next event replaces them, and a count without a time still counts
    act(() => f.set({ ...baseState(), today: { date: '2026-10-30', ringSteps: 4400 } } as EngineState));
    expect(result.current.local).toMatchObject({ today: { date: '2026-10-30', ringSteps: 4400, ringStepsAt: null }, latestHr: null });
    // a passive engine holds no ring: nothing of its own to show
    act(() => f.set({ ...baseState({ mode: 'passive' }), ...readings }));
    expect(result.current.local).toBeNull();
  });

  it('a reading that is not one is left out, never shown', async () => {
    const { f } = start();
    await tick();
    const odd = (over: Record<string, unknown>) => {
      f.set({ ...baseState(), ...over } as EngineState);
      const s = engineLocalSnapshot();
      return { today: s?.today, latestHr: s?.latestHr };
    };
    expect(odd({ today: { date: 'today', ringSteps: 10 } }).today).toBeNull();
    expect(odd({ today: { date: '2026-10-30', ringSteps: -4 } }).today).toBeNull();
    expect(odd({ today: { date: '2026-10-30', ringSteps: 10.5 } }).today).toBeNull();
    expect(odd({ today: { date: '2026-10-30' } }).today).toBeNull();
    expect(odd({ today: null, latestHr: null })).toEqual({ today: null, latestHr: null });
    expect(odd({ today: { date: '2026-10-30', ringSteps: 10, ringStepsAt: 'noon' } }).today).toEqual({ date: '2026-10-30', ringSteps: 10, ringStepsAt: null });
    expect(odd({ latestHr: { bpm: 0, at: '2026-10-30T09:57:00Z' } }).latestHr).toBeNull();
    expect(odd({ latestHr: { bpm: '73', at: '2026-10-30T09:57:00Z' } }).latestHr).toBeNull();
    expect(odd({ latestHr: { bpm: 73, at: 'just now' } }).latestHr).toBeNull();
    expect(odd({ latestHr: { bpm: 73 } }).latestHr).toBeNull();
  });

  it('starting twice is the same loop', () => {
    const a = start();
    expect(startGaugeEngine()).toBe(a.stop);
  });
});
