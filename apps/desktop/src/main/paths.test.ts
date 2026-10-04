import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageKind, resourcePaths, secretsFile, selfCommand, windowStateFile } from './paths';

describe('selfCommand', () => {
  it('is the AppImage file when running from one', () => {
    expect(selfCommand({ appImage: '/home/me/Apps/Vitals.AppImage', packaged: true, execPath: '/tmp/.mount_x/vitals', appPath: '/tmp/.mount_x/resources/app.asar' })).toEqual({
      path: '/home/me/Apps/Vitals.AppImage',
      args: [],
    });
  });

  it('is the app binary when packaged', () => {
    expect(selfCommand({ packaged: true, execPath: '/opt/Vitals/vitals', appPath: '/opt/Vitals/resources/app.asar' })).toEqual({ path: '/opt/Vitals/vitals', args: [] });
    expect(selfCommand({ appImage: '', packaged: true, execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Vitals\\Vitals.exe', appPath: 'x' }).path).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Vitals\\Vitals.exe');
  });

  it('is electron plus the app folder in development', () => {
    expect(selfCommand({ packaged: false, execPath: '/repo/apps/desktop/node_modules/electron/dist/electron', appPath: '/repo/apps/desktop' })).toEqual({
      path: '/repo/apps/desktop/node_modules/electron/dist/electron',
      args: ['/repo/apps/desktop'],
    });
  });
});

describe('packageKind', () => {
  it('tells the kinds apart', () => {
    expect(packageKind({ env: {}, platform: 'linux', packaged: false })).toBe('dev');
    expect(packageKind({ env: { APPIMAGE: '/x/Vitals.AppImage' }, platform: 'linux', packaged: true })).toBe('appimage');
    expect(packageKind({ env: {}, platform: 'linux', packaged: true })).toBe('deb');
    expect(packageKind({ env: {}, platform: 'win32', packaged: true })).toBe('nsis');
    expect(packageKind({ env: {}, platform: 'darwin', packaged: true })).toBe('dmg');
    expect(packageKind({ env: { APPIMAGE: '/x' }, platform: 'linux', packaged: false })).toBe('dev');
  });
});

describe('resourcePaths', () => {
  const app = '/opt/Vitals/resources/app.asar';

  it('puts everything under dist, with the tray image for the platform', () => {
    const p = resourcePaths(app, 'linux');
    expect(p.webDir).toBe(path.join(app, 'dist', 'web'));
    expect(p.preload).toBe(path.join(app, 'dist', 'preload.cjs'));
    expect(p.mcpScript).toBe(path.join(app, 'dist', 'mcp.cjs'));
    expect(p.appIcon).toBe(path.join(app, 'dist', 'icons', 'icon.png'));
    expect(p.trayIcon).toBe(path.join(app, 'dist', 'icons', 'tray-16.png'));
    expect(resourcePaths(app, 'win32').trayIcon).toBe(path.join(app, 'dist', 'icons', 'tray-32.png'));
    expect(resourcePaths(app, 'darwin').trayIcon).toBe(path.join(app, 'dist', 'icons', 'trayTemplate.png'));
  });

  it('names the files in userData', () => {
    expect(windowStateFile('/home/me/.config/Vitals')).toBe(path.join('/home/me/.config/Vitals', 'window-state.json'));
    expect(secretsFile('/home/me/.config/Vitals')).toBe(path.join('/home/me/.config/Vitals', 'secrets.json'));
  });
});
