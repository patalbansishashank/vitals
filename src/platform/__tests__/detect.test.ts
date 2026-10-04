import { detectOs } from '../os';
import { detectPlatform, setPlatformForTests } from '../detect';
import { platformCaps } from '../caps';

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 16; ONEPLUS A6013) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 15662.76.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
};

describe('detectOs', () => {
  it('reads each system from its user agent', () => {
    expect(detectOs({ userAgent: UA.android })).toBe('android');
    expect(detectOs({ userAgent: UA.iphone })).toBe('ios');
    expect(detectOs({ userAgent: UA.windows })).toBe('windows');
    expect(detectOs({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe('macos');
    expect(detectOs({ userAgent: UA.linux })).toBe('linux');
    expect(detectOs({ userAgent: UA.chromeos })).toBe('chromeos');
    expect(detectOs({ userAgent: 'curl/8' })).toBe('other');
  });
  it('tells an iPad that asks for the desktop site from a Mac', () => {
    expect(detectOs({ userAgent: UA.ipad, maxTouchPoints: 5 })).toBe('ios');
  });
  it('trusts userAgentData where the user agent is reduced', () => {
    expect(detectOs({ userAgent: 'Mozilla/5.0', userAgentData: { platform: 'Windows' } })).toBe('windows');
  });
});

describe('detectPlatform', () => {
  const w = window as unknown as Record<string, unknown>;
  const mm = window.matchMedia;
  afterEach(() => {
    delete w.vitalsDesktop;
    delete w.Capacitor;
    window.matchMedia = mm;
    setPlatformForTests(undefined);
  });
  const standalone = (on: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: on && q.includes('standalone') })) as typeof window.matchMedia;
  };

  it('is web in an ordinary tab', () => {
    standalone(false);
    expect(detectPlatform()).toBe('web');
  });
  it('is pwa in an installed web app', () => {
    standalone(true);
    expect(detectPlatform()).toBe('pwa');
  });
  it('is electron when the desktop bridge is there', () => {
    w.vitalsDesktop = {};
    expect(detectPlatform()).toBe('electron');
  });
  it('is android in the Capacitor shell, but not in a Capacitor web page', () => {
    standalone(false);
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    expect(detectPlatform()).toBe('android');
    setPlatformForTests(undefined);
    w.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
    expect(detectPlatform()).toBe('web');
  });
  it('is decided once', () => {
    standalone(false);
    expect(detectPlatform()).toBe('web');
    w.vitalsDesktop = {};
    expect(detectPlatform()).toBe('web');
  });
  it('gives the caps of each platform', () => {
    setPlatformForTests('electron');
    expect(platformCaps()).toMatchObject({ installedApp: true, mcpHost: true, keepAlive: true, ble: 'electron' });
    setPlatformForTests('android');
    expect(platformCaps()).toMatchObject({ installedApp: true, mcpHost: false, keepAlive: true, ble: 'capacitor', os: 'android' });
    setPlatformForTests('pwa');
    expect(platformCaps()).toMatchObject({ installedApp: false, mcpHost: false, keepAlive: false });
    setPlatformForTests('web');
    expect(platformCaps().installedApp).toBe(false);
  });
});
