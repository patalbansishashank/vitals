// @vitest-environment node
/** Adversarial checks of the app:// handler: ways out of the web dir, and the CSP on every answer. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppHandler, resolveAppPath } from './protocol';
import { isAppSender, isAppUrl, navigationAction, permissionAllowed } from './security';

const webDir = path.resolve('/srv/vitals/web');
const inside = (f: string) => f === path.join(webDir, 'index.html') || f.startsWith(webDir + path.sep);
const isFile = () => true; // every path "exists": only the resolver's own rules stop a way out

describe('resolveAppPath (verify)', () => {
  it('never names a file outside the web dir, whatever the encoding', () => {
    const attacks = [
      'app://vitals/%2e%2e/%2e%2e/etc/passwd',
      'app://vitals/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd',
      'app://vitals/assets/%2e%2e%5c%2e%2e%5cetc%5cpasswd',
      'app://vitals/assets/..%5c..%5c..%5cWindows%5cwin.ini',
      'app://vitals/assets/...%2f...%2fsecret',
      'app://vitals/assets/..%20/..%20/secret',
      'app://vitals/assets/.%20.%2f/secret',
      'app://vitals/a%00/../b',
      'app://vitals/a.js%00.png',
      'app://vitals//etc/passwd',
      'app://vitals/%2fetc%2fpasswd',
      'app://vitals/%5c%5cserver%5cshare%5cx',
    ];
    for (const url of attacks) {
      const r = resolveAppPath(url, { webDir, isFile });
      if (r) expect(inside(r.file), `${url} -> ${r.file}`).toBe(true);
    }
  });

  it('refuses dot-and-space-only segments (Windows trims them to `..`)', () => {
    for (const url of ['app://vitals/...%2fx', 'app://vitals/..%20%2fx', 'app://vitals/.%20%2fx', 'app://vitals/%20..%2fx'.replace('%20..', '.. ')]) {
      expect(resolveAppPath(url, { webDir, isFile }), url).toBeNull();
    }
  });

  it('answers only its own host', () => {
    for (const url of ['app://vitals:443/', 'app://evil/', 'app://vitals.evil/', 'file:///srv/vitals/web/index.html', 'http://vitals/']) {
      expect(resolveAppPath(url, { webDir, isFile }), url).toBeNull();
    }
  });
});

describe('app handler (verify)', () => {
  const csp = "default-src 'self'";
  const handler = createAppHandler({ webDir, csp, isFile: (f) => f.endsWith('index.html'), body: async () => 'x' });
  it('carries the CSP on every status and method', async () => {
    for (const [url, method] of [
      ['app://vitals/', 'GET'],
      ['app://vitals/', 'HEAD'],
      ['app://vitals/', 'POST'],
      ['app://vitals/route', 'GET'],
      ['app://vitals/%2e%2e%2fx', 'GET'],
      ['app://evil/', 'GET'],
      ['not a url', 'GET'],
    ] as const) {
      const r = await handler({ url, method });
      expect(r.headers.get('content-security-policy'), `${method} ${url}`).toBe(csp);
    }
  });
});

describe('page boundary (verify)', () => {
  it('lookalike origins are not the app', () => {
    for (const url of ['app://vitals.evil/', 'app://vitals@evil/', 'app://vitalsx/', 'app://evil/vitals/', 'APP://VITALS.x/', 'file:///app://vitals/', 'https://vitals/', '']) {
      expect(isAppUrl(url), url).toBe(false);
      expect(isAppSender({ senderFrame: { url } }), url).toBe(false);
    }
    expect(isAppSender({ senderFrame: null })).toBe(false);
    expect(isAppSender({})).toBe(false);
  });

  it('navigation to lookalikes, file:, javascript:, data: and custom schemes is dropped, not opened', () => {
    for (const url of ['app://vitals.evil/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'vscode://x', 'smb://host/share', 'ms-settings:']) {
      expect(navigationAction(url), url).toBe('deny');
    }
  });

  it('permissions from a lookalike origin or a subframe are refused; the camera never with the microphone', () => {
    expect(permissionAllowed('notifications', { requestingUrl: 'app://vitals.evil/' })).toBe(false);
    expect(permissionAllowed('notifications', { requestingUrl: 'app://vitals/', isMainFrame: false })).toBe(false);
    expect(permissionAllowed('media', { requestingUrl: 'app://vitals/', mediaTypes: ['video', 'audio'] })).toBe(false);
    expect(permissionAllowed('media', { requestingUrl: 'app://vitals/', mediaTypes: [] })).toBe(false);
  });
});
