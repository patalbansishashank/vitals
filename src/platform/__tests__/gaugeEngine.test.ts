/** (r070) The plugin's registration and the helpers: no plugin outside the Android app, a stub that says "not available". */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeCapacitor, removeFakeCapacitor } from './androidFake';
import { EngineUnavailableError, UNAVAILABLE_STATE, engineAvailable, engineErrorText, engineStub, gaugeEngine, gaugeEngineOrStub, permissionOk, permissionsMissing, resetGaugeEngineForTests, ringAuthenticationPending, ringCredentialIssue, ringDataReady, socialActive } from '../gaugeEngine';
import { baseState, socialState } from '@/features/ring/engine/__tests__/fakeEngine';

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

  it('counts what is missing; Usage access only while social time is on', () => {
    expect(permissionsMissing(baseState())).toEqual([]);
    const s = baseState({ permissions: { ...baseState().permissions, notifications: 'denied' } });
    expect(permissionsMissing(s)).toEqual(['notifications']);
    expect(permissionOk(s, 'bluetooth')).toBe(true);
    expect(permissionOk(baseState({ permissions: { ...baseState().permissions, healthConnect: 'partial' } }), 'healthConnect')).toBe(false);
  });

  it('includes Usage access when social time is on and it is not granted', () => {
    const s = baseState({ permissions: { ...baseState().permissions, notifications: 'denied' }, social: socialState(false) });
    expect(socialActive(s)).toBe(true);
    expect(permissionOk(s, 'usageAccess')).toBe(false);
    expect(permissionsMissing(s)).toEqual(['notifications', 'usageAccess']);
  });

  it('excludes Usage access once it is granted', () => {
    const s = baseState({ social: socialState(true) });
    expect(permissionOk(s, 'usageAccess')).toBe(true);
    expect(permissionsMissing(s)).toEqual([]);
  });

  it('excludes Usage access while no app is counted (social time off)', () => {
    const s = baseState({ social: socialState(false, []) });
    expect(socialActive(s)).toBe(false);
    expect(permissionsMissing(s)).toEqual([]);
  });

  it('never asks for Usage access on an older native build that sends no social state', () => {
    const old = baseState();
    expect(old.social).toBeUndefined();
    expect(socialActive(old)).toBe(false);
    expect(permissionOk(old, 'usageAccess')).toBe(false);
    expect(permissionsMissing(old)).toEqual([]);
    // a legacy accessibility field from an old build is ignored
    const legacy = baseState({ permissions: { ...baseState().permissions, shortVideoAccessibility: false } });
    expect(permissionsMissing(legacy)).toEqual([]);
    expect(permissionsMissing({ ...old, social: null })).toEqual([]);
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
