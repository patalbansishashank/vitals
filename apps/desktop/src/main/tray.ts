/**
 * The system tray (SUITE_SPEC §15.6): the ring mark, a status line, Open, Sync now, Start with my computer, the update
 * item and Quit. Electron is passed in by the shell and typed by the slices used here, so tests pass fakes.
 */
import type { UpdateState } from '../shared/bridge';
import type { Autostart } from './autostart';
import type { Updates } from './updates';

/** One menu entry, structurally a subset of Electron's `MenuItemConstructorOptions`. */
export interface TrayMenuItem {
  label?: string;
  type?: 'normal' | 'separator' | 'checkbox';
  enabled?: boolean;
  checked?: boolean;
  click?: (item: { checked: boolean }) => void;
}

interface TrayLike {
  setToolTip(text: string): void;
  setContextMenu(menu: unknown): void;
  on(event: 'click', cb: () => void): unknown;
  destroy(): void;
}

export interface TrayDeps {
  electron: {
    Tray: new (image: unknown) => TrayLike;
    Menu: { buildFromTemplate(template: TrayMenuItem[]): unknown };
    nativeImage: { createFromPath(path: string): unknown };
  };
  /** The ring mark (a PNG). */
  iconPath: string;
  showWindow(): void;
  syncNow(): void;
  quit(): void;
  autostart: Autostart;
  updates: Updates;
  /** Opens the download page for the "A new version is ready" item (the system browser). */
  openExternal?(url: string): void;
}

export interface TrayHandle {
  setStatus(s: { ring?: string; sync?: string }): void;
  /** Rebuild the menu (call after the update state changes). */
  refresh(): void;
  destroy(): void;
}

export interface TrayMenuState {
  ring?: string;
  sync?: string;
  autostart: boolean;
  update: UpdateState;
}

export interface TrayActions {
  open(): void;
  syncNow(): void;
  setAutostart(on: boolean): void;
  restart(): void;
  openUrl(url: string): void;
  quit(): void;
}

/** The menu as plain data, so it can be tested without Electron. */
export function trayMenuTemplate(state: TrayMenuState, act: TrayActions): TrayMenuItem[] {
  const items: TrayMenuItem[] = [
    { label: 'Open Vitals', click: () => act.open() },
    { type: 'separator' },
    { label: state.ring?.trim() || 'Ring not connected', enabled: false },
  ];
  if (state.sync?.trim()) items.push({ label: state.sync.trim(), enabled: false });
  items.push(
    { type: 'separator' },
    { label: 'Sync now', click: () => act.syncNow() },
    { label: 'Start with my computer', type: 'checkbox', checked: state.autostart, click: (i) => act.setAutostart(i.checked) },
  );
  const u = state.update;
  if (u.state === 'ready') {
    items.push({ type: 'separator' }, { label: u.version ? `Restart to update to ${u.version}` : 'Restart to update', click: () => act.restart() });
  } else if (u.state === 'manual') {
    const url = u.url;
    items.push({ type: 'separator' }, { label: 'A new version is ready', enabled: !!url, click: () => url && act.openUrl(url) });
  }
  items.push({ type: 'separator' }, { label: 'Quit', click: () => act.quit() });
  return items;
}

/** Creates the tray; null where the desktop has no tray (the shell then quits when the window closes). */
export function createTray(deps: TrayDeps): TrayHandle | null {
  let tray: TrayLike;
  try {
    tray = new deps.electron.Tray(deps.electron.nativeImage.createFromPath(deps.iconPath));
    tray.setToolTip('Vitals');
  } catch {
    return null;
  }
  let status: { ring?: string; sync?: string } = {};
  let autostartOn = false;
  let gone = false;

  const actions: TrayActions = {
    open: () => deps.showWindow(),
    syncNow: () => deps.syncNow(),
    setAutostart: (on) => {
      autostartOn = on;
      void deps.autostart
        .set(on)
        .catch(() => undefined)
        .then(() => refresh());
    },
    restart: () => deps.updates.restart(),
    openUrl: (url) => deps.openExternal?.(url),
    quit: () => deps.quit(),
  };

  const build = (): void => {
    if (gone) return;
    try {
      const menu = deps.electron.Menu.buildFromTemplate(trayMenuTemplate({ ...status, autostart: autostartOn, update: deps.updates.state() }, actions));
      tray.setContextMenu(menu);
    } catch {
      /* a failed rebuild keeps the old menu */
    }
  };

  /** Reads the real autostart value, then rebuilds. */
  function refresh(): void {
    if (gone) return;
    build();
    deps.autostart
      .get()
      .then((on) => {
        if (on !== autostartOn) {
          autostartOn = on;
          build();
        }
      })
      .catch(() => undefined);
  }

  try {
    tray.on('click', () => deps.showWindow());
  } catch {
    /* some desktops have no click events; the Open item covers it */
  }
  refresh();

  return {
    setStatus(s) {
      status = { ...status, ...s };
      build();
    },
    refresh,
    destroy() {
      if (gone) return;
      gone = true;
      try {
        tray.destroy();
      } catch {
        /* already gone */
      }
    },
  };
}
