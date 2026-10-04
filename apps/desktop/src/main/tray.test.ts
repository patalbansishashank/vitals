import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/bridge';
import type { Autostart } from './autostart';
import { createTray, trayMenuTemplate, type TrayActions, type TrayMenuItem } from './tray';
import type { Updates } from './updates';

const acts = (): TrayActions => ({ open: vi.fn(), syncNow: vi.fn(), setAutostart: vi.fn(), restart: vi.fn(), openUrl: vi.fn(), quit: vi.fn() });
const labels = (t: TrayMenuItem[]) => t.filter((i) => i.type !== 'separator').map((i) => i.label);

describe('trayMenuTemplate', () => {
  it('base menu with a not-connected line', () => {
    const t = trayMenuTemplate({ autostart: false, update: { state: 'idle' } }, acts());
    expect(labels(t)).toEqual(['Open Vitals', 'Ring not connected', 'Sync now', 'Start with my computer', 'Quit']);
    expect(t.find((i) => i.label === 'Ring not connected')?.enabled).toBe(false);
    expect(t.find((i) => i.label === 'Start with my computer')).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('shows the ring and sync text from the page', () => {
    const t = trayMenuTemplate({ ring: 'Ring connected · 82 %', sync: 'Synced just now', autostart: true, update: { state: 'checking' } }, acts());
    expect(labels(t)).toEqual(['Open Vitals', 'Ring connected · 82 %', 'Synced just now', 'Sync now', 'Start with my computer', 'Quit']);
    expect(t.find((i) => i.label === 'Synced just now')?.enabled).toBe(false);
    expect(t.find((i) => i.label === 'Start with my computer')?.checked).toBe(true);
  });

  it('ready update offers a restart; manual opens the link', () => {
    const a = acts();
    const ready = trayMenuTemplate({ autostart: false, update: { state: 'ready', version: '0.5.0' } }, a);
    ready.find((i) => i.label === 'Restart to update to 0.5.0')!.click!({ checked: false });
    expect(a.restart).toHaveBeenCalled();
    const manual = trayMenuTemplate({ autostart: false, update: { state: 'manual', version: '0.5.0', url: 'https://example.invalid/d' } }, a);
    manual.find((i) => i.label === 'A new version is ready')!.click!({ checked: false });
    expect(a.openUrl).toHaveBeenCalledWith('https://example.invalid/d');
  });

  it('click handlers call the actions', () => {
    const a = acts();
    const t = trayMenuTemplate({ autostart: false, update: { state: 'idle' } }, a);
    for (const l of ['Open Vitals', 'Sync now', 'Quit']) t.find((i) => i.label === l)!.click!({ checked: false });
    t.find((i) => i.label === 'Start with my computer')!.click!({ checked: true });
    expect(a.open).toHaveBeenCalled();
    expect(a.syncNow).toHaveBeenCalled();
    expect(a.quit).toHaveBeenCalled();
    expect(a.setAutostart).toHaveBeenCalledWith(true);
  });
});

function fakes(opts: { throwOnCreate?: boolean; autostart?: boolean; update?: UpdateState } = {}) {
  const menus: TrayMenuItem[][] = [];
  const handlers: Record<string, () => void> = {};
  const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn((e: string, cb: () => void) => void (handlers[e] = cb)), destroy: vi.fn() };
  const Tray = vi.fn(function () {
    if (opts.throwOnCreate) throw new Error('no tray');
    return tray;
  });
  let auto = opts.autostart ?? false;
  const autostart: Autostart = { get: vi.fn(async () => auto), set: vi.fn(async (on) => void (auto = on)) };
  const updates = { state: vi.fn(() => opts.update ?? ({ state: 'idle' } as UpdateState)), restart: vi.fn() } as unknown as Updates;
  const deps = {
    electron: {
      Tray: Tray as unknown as new (i: unknown) => typeof tray,
      Menu: { buildFromTemplate: (t: TrayMenuItem[]) => (menus.push(t), { menu: menus.length }) },
      nativeImage: { createFromPath: vi.fn((p: string) => ({ p })) },
    },
    iconPath: '/icons/ring.png',
    showWindow: vi.fn(),
    syncNow: vi.fn(),
    quit: vi.fn(),
    autostart,
    updates,
    openExternal: vi.fn(),
  };
  return { deps, menus, tray, handlers, Tray };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createTray', () => {
  it('sets the icon, the tooltip and a menu; left click shows the window', async () => {
    const f = fakes();
    const h = createTray(f.deps);
    expect(h).not.toBeNull();
    expect(f.deps.electron.nativeImage.createFromPath).toHaveBeenCalledWith('/icons/ring.png');
    expect(f.tray.setToolTip).toHaveBeenCalledWith('Vitals');
    expect(f.tray.setContextMenu).toHaveBeenCalled();
    f.handlers.click!();
    expect(f.deps.showWindow).toHaveBeenCalled();
    await flush();
  });

  it('returns null when the desktop has no tray', () => {
    expect(createTray(fakes({ throwOnCreate: true }).deps)).toBeNull();
  });

  it('setStatus rebuilds the menu with the new text', async () => {
    const f = fakes();
    const h = createTray(f.deps)!;
    h.setStatus({ ring: 'Ring connected · 82 %' });
    h.setStatus({ sync: 'Synced' });
    const last = f.menus.at(-1)!;
    expect(labels(last)).toContain('Ring connected · 82 %');
    expect(labels(last)).toContain('Synced');
    await flush();
  });

  it('reads the real autostart value into the check box', async () => {
    const f = fakes({ autostart: true });
    createTray(f.deps);
    await flush();
    expect(f.menus.at(-1)!.find((i) => i.label === 'Start with my computer')?.checked).toBe(true);
  });

  it('toggling Start with my computer writes it and refreshes', async () => {
    const f = fakes();
    createTray(f.deps);
    await flush();
    f.menus.at(-1)!.find((i) => i.label === 'Start with my computer')!.click!({ checked: true });
    await flush();
    expect(f.deps.autostart.set).toHaveBeenCalledWith(true);
    expect(f.menus.at(-1)!.find((i) => i.label === 'Start with my computer')?.checked).toBe(true);
  });

  it('refresh picks up a new update state; destroy stops further work', async () => {
    const f = fakes();
    const h = createTray(f.deps)!;
    await flush();
    (f.deps.updates.state as ReturnType<typeof vi.fn>).mockReturnValue({ state: 'ready', version: '0.5.0' });
    h.refresh();
    expect(labels(f.menus.at(-1)!)).toContain('Restart to update to 0.5.0');
    h.destroy();
    const n = f.menus.length;
    h.setStatus({ ring: 'x' });
    h.refresh();
    expect(f.menus.length).toBe(n);
    expect(f.tray.destroy).toHaveBeenCalledTimes(1);
  });
});
