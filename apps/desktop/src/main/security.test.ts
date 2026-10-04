import { describe, expect, it, vi } from 'vitest';
import { applySecurity, isAppSender, isAppUrl, navigationAction, permissionAllowed, WEB_PREFERENCES, type SecurityElectron, type WebContentsSlice } from './security';

describe('WEB_PREFERENCES', () => {
  it('isolates and sandboxes the page and keeps it running in the background', () => {
    expect(WEB_PREFERENCES).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, backgroundThrottling: false });
  });
});

describe('navigationAction', () => {
  it('allows our page only', () => {
    expect(navigationAction('app://vitals/')).toBe('allow');
    expect(navigationAction('app://vitals/settings?x=1#y')).toBe('allow');
    expect(navigationAction('app://vitals')).toBe('allow');
    expect(navigationAction('app://vitals.evil/')).toBe('deny');
    expect(navigationAction('app://other/')).toBe('deny');
  });

  it('sends web links to the system browser and drops anything else', () => {
    expect(navigationAction('https://example.org/x')).toBe('external');
    expect(navigationAction('http://127.0.0.1:8787/')).toBe('external');
    expect(navigationAction('file:///etc/passwd')).toBe('deny');
    expect(navigationAction('javascript:alert(1)')).toBe('deny');
    expect(navigationAction('mailto:x@y')).toBe('deny');
    expect(navigationAction('not a url')).toBe('deny');
  });
});

describe('isAppSender', () => {
  it('needs a frame on app://vitals', () => {
    expect(isAppSender({ senderFrame: { url: 'app://vitals/' } })).toBe(true);
    expect(isAppSender({ senderFrame: { url: 'app://vitals/settings/agents' } })).toBe(true);
    expect(isAppSender({ senderFrame: { url: 'https://example.org/' } })).toBe(false);
    expect(isAppSender({ senderFrame: { url: 'app://vitalsx/' } })).toBe(false);
    expect(isAppSender({ senderFrame: null })).toBe(false);
    expect(isAppSender({})).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
  });
});

describe('permissionAllowed', () => {
  const from = { requestingUrl: 'app://vitals/', isMainFrame: true };

  it('grants the few the app uses, from our page only', () => {
    for (const p of ['notifications', 'clipboard-sanitized-write', 'fullscreen']) {
      expect(permissionAllowed(p, from), p).toBe(true);
      expect(permissionAllowed(p, { ...from, requestingUrl: 'https://example.org/' }), p).toBe(false);
      expect(permissionAllowed(p, { ...from, isMainFrame: false }), p).toBe(false);
    }
  });

  it('allows the camera for the pairing code, never the microphone', () => {
    expect(permissionAllowed('media', { ...from, mediaTypes: ['video'] })).toBe(true);
    expect(permissionAllowed('media', { ...from, mediaTypes: ['audio'] })).toBe(false);
    expect(permissionAllowed('media', { ...from, mediaTypes: ['video', 'audio'] })).toBe(false);
    expect(permissionAllowed('media', from)).toBe(false);
  });

  it('refuses the rest', () => {
    for (const p of ['geolocation', 'midi', 'midiSysex', 'pointerLock', 'openExternal', 'display-capture', 'hid', 'serial', 'usb', 'clipboard-read', 'fileSystem', 'unknown']) {
      expect(permissionAllowed(p, from), p).toBe(false);
    }
  });
});

/** A fake of the Electron slices `applySecurity` wires, recording what it hooks. */
function fakeElectron() {
  const handlers: {
    created?: (event: unknown, contents: WebContentsSlice) => void;
    request?: (wc: unknown, permission: string, callback: (granted: boolean) => void, details: object) => void;
    check?: (wc: unknown, permission: string, origin: string, details: object) => boolean;
    pairing?: (details: { pairingKind: string; deviceId: string }, callback: (r: { confirmed: boolean }) => void) => void;
  } = {};
  const openExternal = vi.fn(async () => undefined);
  const e: SecurityElectron = {
    app: { on: (_ev, l) => void (handlers.created = l) },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (h) => void (handlers.request = h),
        setPermissionCheckHandler: (h) => void (handlers.check = h),
        setBluetoothPairingHandler: (h) => void (handlers.pairing = h),
      },
    },
    shell: { openExternal },
  };
  return { e, handlers, openExternal };
}

function fakeContents() {
  const listeners: Record<string, (...a: never[]) => void> = {};
  let openHandler: ((d: { url: string }) => { action: 'deny' }) | undefined;
  const contents: WebContentsSlice = {
    on: ((ev: string, l: (...a: never[]) => void) => void (listeners[ev] = l)) as WebContentsSlice['on'],
    setWindowOpenHandler: (h) => void (openHandler = h),
  };
  return { contents, listeners, open: (url: string) => openHandler!({ url }) };
}

describe('applySecurity', () => {
  it('keeps navigation inside the page and opens web links outside', () => {
    const { e, handlers, openExternal } = fakeElectron();
    applySecurity(e);
    const { contents, listeners } = fakeContents();
    handlers.created!(undefined, contents);
    const nav = listeners['will-navigate'] as unknown as (ev: { preventDefault(): void }, url: string) => void;
    const stay = { preventDefault: vi.fn() };
    nav(stay, 'app://vitals/settings');
    expect(stay.preventDefault).not.toHaveBeenCalled();
    const leave = { preventDefault: vi.fn() };
    nav(leave, 'https://example.org/docs');
    expect(leave.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://example.org/docs');
    const bad = { preventDefault: vi.fn() };
    nav(bad, 'file:///etc/passwd');
    expect(bad.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(listeners['will-redirect']).toBeDefined();
  });

  it('denies window.open, opening web links in the browser, and denies webviews', () => {
    const { e, handlers, openExternal } = fakeElectron();
    applySecurity(e);
    const { contents, listeners, open } = fakeContents();
    handlers.created!(undefined, contents);
    expect(open('https://example.org/')).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.org/');
    expect(open('app://vitals/other')).toEqual({ action: 'deny' });
    expect(open('file:///x')).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    const attach = { preventDefault: vi.fn() };
    (listeners['will-attach-webview'] as unknown as (ev: { preventDefault(): void }) => void)(attach);
    expect(attach.preventDefault).toHaveBeenCalled();
  });

  it('answers permission requests and checks with the same rule', () => {
    const { e, handlers } = fakeElectron();
    applySecurity(e);
    const granted = vi.fn();
    handlers.request!(undefined, 'notifications', granted, { requestingUrl: 'app://vitals/', isMainFrame: true });
    expect(granted).toHaveBeenCalledWith(true);
    handlers.request!(undefined, 'geolocation', granted, { requestingUrl: 'app://vitals/', isMainFrame: true });
    expect(granted).toHaveBeenLastCalledWith(false);
    expect(handlers.check!(undefined, 'notifications', 'app://vitals', {})).toBe(true);
    expect(handlers.check!(undefined, 'notifications', 'https://example.org', {})).toBe(false);
  });

  it('confirms a Just Works pairing and declines a PIN it cannot show', () => {
    const { e, handlers } = fakeElectron();
    applySecurity(e);
    const cb = vi.fn();
    handlers.pairing!({ pairingKind: 'confirm', deviceId: 'd' }, cb);
    expect(cb).toHaveBeenCalledWith({ confirmed: true });
    handlers.pairing!({ pairingKind: 'providePin', deviceId: 'd' }, cb);
    expect(cb).toHaveBeenLastCalledWith({ confirmed: false });
  });
});
