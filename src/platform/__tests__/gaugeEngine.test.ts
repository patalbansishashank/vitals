/** (r070) The plugin's registration and the helpers: no plugin outside the Android app, a stub that says "not available". */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeCapacitor, removeFakeCapacitor } from './androidFake';
import { EngineUnavailableError, UNAVAILABLE_STATE, engineAvailable, engineErrorText, engineStub, gaugeEngine, gaugeEngineOrStub, permissionOk, permissionsMissing, resetGaugeEngineForTests, ringAuthenticationPending, ringCredentialIssue, ringDataReady, showAllowGuide } from '../gaugeEngine';
import { baseState } from '@/features/ring/engine/__tests__/fakeEngine';

afterEach(() => {
  removeFakeCapacitor();
  resetGaugeEngineForTests();
});

describe('GaugeEngine plugin', () => {
  it('there is none on the web or the desktop; the stub says it is not available', async () => {
    expect(gaugeEngine()).toBeNull();
    expect(engineAvailable()).toBe(false);
    expect(gaugeEngineOrStub()).toBe(engineStub);
    expect(await engineStub.getState()).toBe(UNAVAILABLE_STATE);
    expect(UNAVAILABLE_STATE.permissions.bluetooth).toBe('unavailable');
    await expect(engineStub.syncNow()).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(engineStub.openAppInfo()).rejects.toBeInstanceOf(EngineUnavailableError);
    const h = await engineStub.addListener('state', () => undefined);
    await expect(h.remove()).resolves.toBeUndefined();
  });

  it('registers once on Android when the shell has it, and not on a shell without it', () => {
    const fake = installFakeCapacitor({ platform: 'android' });
    expect(gaugeEngine()).toBe(fake.plugin);
    expect(gaugeEngine()).toBe(fake.plugin);
    expect(fake.cap.registerPlugin).toHaveBeenCalledTimes(1);
    expect(fake.cap.registerPlugin).toHaveBeenCalledWith('GaugeEngine');
    removeFakeCapacitor();
    resetGaugeEngineForTests();
    const web = installFakeCapacitor({ platform: 'web' });
    expect(gaugeEngine()).toBeNull();
    expect(web.cap.registerPlugin).not.toHaveBeenCalled();
    removeFakeCapacitor();
    const old = installFakeCapacitor({ platform: 'android' });
    (old.cap as { isPluginAvailable?: (n: string) => boolean }).isPluginAvailable = vi.fn(() => false);
    expect(gaugeEngine()).toBeNull();
  });

  it('counts what is missing; the accessibility one only when the short-video limit is on', () => {
    expect(permissionsMissing(baseState())).toEqual([]);
    const s = baseState({ permissions: { ...baseState().permissions, notifications: 'denied', shortVideoAccessibility: false } });
    expect(permissionsMissing(s)).toEqual(['notifications', 'shortVideoAccessibility']);
    expect(permissionsMissing({ ...s, shortVideo: { ...s.shortVideo, enabled: false } })).toEqual(['notifications']);
    expect(permissionOk(s, 'bluetooth')).toBe(true);
    expect(permissionOk(baseState({ permissions: { ...baseState().permissions, healthConnect: 'partial' } }), 'healthConnect')).toBe(false);
  });

  it('shows the allow-it-first guide only while the counter is off and wanted, and Android holds it back or the person already tried', () => {
    const off = (restricted?: boolean) =>
      baseState({ permissions: { ...baseState().permissions, shortVideoAccessibility: false, ...(restricted === undefined ? {} : { shortVideoRestricted: restricted }) } });
    // the limit is on. Known or likely held back: shown at once; the phone does not say: only after the person went to Accessibility and it is still off
    expect(showAllowGuide(off(true), false)).toBe(true);
    expect(showAllowGuide(off(), false)).toBe(false);
    expect(showAllowGuide(off(), true)).toBe(true);
    // the phone says it is not held back: never
    expect(showAllowGuide(off(false), true)).toBe(false);
    // the counter is on: never, whatever Android once said
    const on = baseState();
    expect(showAllowGuide({ ...on, permissions: { ...on.permissions, shortVideoRestricted: true } }, true)).toBe(false);
    // the limit is off, so the counter is optional: not unless the person has just gone to turn it on
    const noLimit = (restricted?: boolean) => ({ ...off(restricted), shortVideo: { enabled: false, dailyLimit: null, today: { instagram: 0, youtube: 0 } } });
    expect(showAllowGuide(noLimit(true), false)).toBe(false);
    expect(showAllowGuide(noLimit(), false)).toBe(false);
    expect(showAllowGuide(noLimit(true), true)).toBe(true);
    expect(showAllowGuide(noLimit(false), true)).toBe(false);
  });

  it('turns any rejection into a short plain line', () => {
    expect(engineErrorText(new Error('Bluetooth is off'))).toBe('Bluetooth is off');
    expect(engineErrorText({ message: 'denied' })).toBe('denied');
    expect(engineErrorText(null)).toBe('The ring engine could not do that.');
    expect(engineErrorText(new Error('x'.repeat(500))).length).toBe(200);
  });

  it('treats missing and rejected ring auth as separate from the Bluetooth connection', () => {
    const ring = baseState().ring;
    expect(ringCredentialIssue(baseState({ ring: { ...ring, credentialRequired: true, credentialConfigured: false } }))).toBe('missing');
    expect(ringCredentialIssue(baseState({ ring: { ...ring, credentialRequired: true, credentialConfigured: true, credentialRejected: true } }))).toBe('rejected');
    expect(ringCredentialIssue(baseState({ ring: { ...ring, credentialRequired: true, credentialConfigured: true } }))).toBeNull();
    expect(ringCredentialIssue(baseState({ mode: 'passive', ring: { ...ring, credentialRequired: true } }))).toBeNull();
    const pending = baseState({ ring: { ...ring, credentialRequired: true, credentialConfigured: true, credentialAuthenticated: false } });
    expect(ringAuthenticationPending(pending)).toBe(true);
    expect(ringDataReady(pending)).toBe(false);
    expect(ringDataReady(baseState({ ring: { ...pending.ring, credentialAuthenticated: true } }))).toBe(true);
    // An older native build does not send this field; preserve its connected behavior.
    expect(ringDataReady(baseState({ ring: { ...ring, credentialRequired: true, credentialConfigured: true } }))).toBe(true);
  });
});
