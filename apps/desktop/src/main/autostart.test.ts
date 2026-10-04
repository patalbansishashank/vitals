import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutostart, execQuote } from './autostart';

const base = path.resolve(process.cwd(), '.e6-tmp');
let home: string;
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  home = await mkdtemp(path.join(base, 'autostart-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const app = () => ({ getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })), setLoginItemSettings: vi.fn() });
const exists = (p: string) => stat(p).then(() => true, () => false);

describe('autostart on Linux', () => {
  const make = (env: NodeJS.ProcessEnv = {}, cmd = '/opt/Vitals/vitals') =>
    createAutostart({ platform: 'linux', home, env, command: { path: cmd, args: [] }, app: app() });
  const file = () => path.join(home, '.config', 'autostart', 'vitals.desktop');

  it('is off by default, writes and removes the entry', async () => {
    const a = make();
    expect(await a.get()).toBe(false);
    await a.set(true);
    expect(await a.get()).toBe(true);
    const text = await readFile(file(), 'utf8');
    expect(text).toContain('[Desktop Entry]');
    expect(text).toContain('Type=Application');
    expect(text).toContain('Name=Vitals');
    expect(text).toContain('Icon=vitals');
    expect(text).toContain('X-GNOME-Autostart-enabled=true');
    expect(text).toContain('Exec=/opt/Vitals/vitals --hidden\n');
    await a.set(false);
    expect(await a.get()).toBe(false);
    expect(await exists(file())).toBe(false);
  });

  it('quotes a path with spaces (AppImage) and keeps its args', async () => {
    const a = createAutostart({
      platform: 'linux', home, env: {}, app: app(),
      command: { path: '/home/a b/Apps/Vitals 0.4.AppImage', args: ['--x'] },
    });
    await a.set(true);
    expect(await readFile(file(), 'utf8')).toContain('Exec="/home/a b/Apps/Vitals 0.4.AppImage" --x --hidden\n');
  });

  it('honours XDG_CONFIG_HOME when absolute, ignores it when relative', async () => {
    const xdg = path.join(home, 'xdg');
    await make({ XDG_CONFIG_HOME: xdg }).set(true);
    expect(await exists(path.join(xdg, 'autostart', 'vitals.desktop'))).toBe(true);
    await make({ XDG_CONFIG_HOME: 'rel' }).set(true);
    expect(await exists(file())).toBe(true);
  });

  it('does not treat or delete a foreign file as ours', async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), '[Desktop Entry]\nName=Something else\n');
    const a = make();
    expect(await a.get()).toBe(false);
    await a.set(false);
    expect(await readFile(file(), 'utf8')).toContain('Something else');
  });

  it('turning off when nothing exists is fine', async () => {
    await expect(make().set(false)).resolves.toBeUndefined();
  });
});

describe('execQuote', () => {
  it('leaves plain words, quotes reserved characters, escapes per the spec', () => {
    expect(execQuote('/usr/bin/vitals')).toBe('/usr/bin/vitals');
    expect(execQuote('a b')).toBe('"a b"');
    expect(execQuote('a"b')).toBe('"a\\\\"b"');
    expect(execQuote('a$b')).toBe('"a\\\\$b"');
    expect(execQuote('50%')).toBe('50%%');
    expect(execQuote('')).toBe('""');
  });
});

describe('autostart on Windows and macOS', () => {
  it('Windows passes the path and --hidden', async () => {
    const ap = app();
    ap.getLoginItemSettings.mockReturnValue({ openAtLogin: true });
    const a = createAutostart({ platform: 'win32', home, env: {}, app: ap, command: { path: 'C:\\Apps\\Vitals.exe', args: [] } });
    expect(await a.get()).toBe(true);
    expect(ap.getLoginItemSettings).toHaveBeenCalledWith({ path: 'C:\\Apps\\Vitals.exe', args: ['--hidden'] });
    await a.set(true);
    expect(ap.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: 'C:\\Apps\\Vitals.exe', args: ['--hidden'] });
    await a.set(false);
    expect(ap.setLoginItemSettings).toHaveBeenLastCalledWith(expect.objectContaining({ openAtLogin: false }));
  });

  it('macOS sets the login item with --hidden', async () => {
    const ap = app();
    const a = createAutostart({ platform: 'darwin', home, env: {}, app: ap, command: { path: '/Applications/Vitals.app/Contents/MacOS/Vitals', args: [] } });
    expect(await a.get()).toBe(false);
    await a.set(true);
    expect(ap.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: ['--hidden'] });
  });
});
