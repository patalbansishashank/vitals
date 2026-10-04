/**
 * The one window: its saved geometry (`<userData>/window-state.json`), restored only when it still lands on a visible
 * display, and the close rule (hide to the tray when there is one, else quit). The geometry logic is pure and tested;
 * `createMainWindow` wires it to Electron.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { WEB_PREFERENCES } from './security';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_STATE: WindowState = { width: 1200, height: 820 };
export const MIN_SIZE = { width: 360, height: 480 };

/** Parses a saved state file's text; anything odd gives the default. */
export function parseWindowState(text: string | null | undefined, fallback: WindowState = DEFAULT_STATE): WindowState {
  if (!text) return { ...fallback };
  try {
    const v = JSON.parse(text) as Partial<WindowState>;
    const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (!num(v.width) || !num(v.height)) return { ...fallback };
    const s: WindowState = { width: Math.round(v.width), height: Math.round(v.height) };
    if (num(v.x) && num(v.y)) {
      s.x = Math.round(v.x);
      s.y = Math.round(v.y);
    }
    if (v.maximized === true) s.maximized = true;
    return s;
  } catch {
    return { ...fallback };
  }
}

/**
 * The state to open with: the saved one when its top strip is on a display's work area, else the saved size centred
 * on the first display. Sizes are clamped to the minimum and to the display.
 */
export function restoreWindowState(saved: WindowState, workAreas: readonly Rect[], fallback: WindowState = DEFAULT_STATE): WindowState {
  const first = workAreas[0];
  const fit = (s: WindowState, area: Rect | undefined): WindowState => ({
    ...s,
    width: Math.max(MIN_SIZE.width, Math.min(s.width, area?.width ?? s.width)),
    height: Math.max(MIN_SIZE.height, Math.min(s.height, area?.height ?? s.height)),
  });
  const visible = (s: WindowState): boolean =>
    s.x !== undefined &&
    s.y !== undefined &&
    workAreas.some((a) => {
      // at least 100 px of the title strip must be on the display, so the window can be grabbed
      const left = Math.max(s.x!, a.x);
      const right = Math.min(s.x! + s.width, a.x + a.width);
      return right - left >= 100 && s.y! >= a.y && s.y! < a.y + a.height - 40;
    });
  if (visible(saved)) return fit(saved, workAreas.find((a) => saved.x! >= a.x && saved.x! < a.x + a.width) ?? first);
  const size = fit({ width: saved.width || fallback.width, height: saved.height || fallback.height }, first);
  const out: WindowState = { ...size, ...(saved.maximized ? { maximized: true } : {}) };
  if (first) {
    out.x = Math.round(first.x + (first.width - size.width) / 2);
    out.y = Math.round(first.y + (first.height - size.height) / 2);
  }
  return out;
}

/** Reads the state file; a missing or broken file gives the default. */
export function loadWindowState(file: string): WindowState {
  try {
    return parseWindowState(readFileSync(file, 'utf8'));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch {
    /* a read-only profile keeps the default size */
  }
}

/** The slice of a BrowserWindow the state logic touches. */
export interface WindowLike {
  getNormalBounds(): Rect;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  on(event: 'close', listener: (e: { preventDefault(): void }) => void): unknown;
  on(event: 'resize' | 'move' | 'maximize' | 'unmaximize' | 'closed' | 'show', listener: () => void): unknown;
  once(event: 'ready-to-show', listener: () => void): unknown;
  hide(): void;
  show(): void;
  focus(): void;
  restore(): void;
  maximize(): void;
}

export interface WindowDeps<W extends WindowLike> {
  stateFile: string;
  workAreas: readonly Rect[];
  /** `startHidden`: `--hidden` (autostart), the window stays in the tray until asked for. */
  startHidden: boolean;
  /** True while a tray exists: closing hides instead of quitting. */
  hasTray(): boolean;
  quit(): void;
  /** Creates the BrowserWindow with these options (geometry filled in). */
  make(opts: { x?: number; y?: number; width: number; height: number; show: boolean }): W;
  /** Called when the window becomes visible after being hidden (tray, second instance). */
  onShown?(): void;
}

export interface MainWindow<W extends WindowLike> {
  win: W;
  /** Show and focus (from the tray or a second launch). */
  show(): void;
  /** Hide for good: the next close quits. */
  allowClose(): void;
}

/** Creates the window, restores and tracks its geometry, and applies the close rule. */
export function createMainWindow<W extends WindowLike>(d: WindowDeps<W>): MainWindow<W> {
  const state = restoreWindowState(loadWindowState(d.stateFile), d.workAreas);
  const win = d.make({ x: state.x, y: state.y, width: state.width, height: state.height, show: false });
  let quitting = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): WindowState => {
    const b = win.getNormalBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height, ...(win.isMaximized() ? { maximized: true } : {}) };
  };
  const saveSoon = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!win.isDestroyed() && !win.isMinimized()) saveWindowState(d.stateFile, snapshot());
    }, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev, saveSoon);

  win.on('close', (e) => {
    if (saveTimer) clearTimeout(saveTimer);
    if (!win.isDestroyed()) saveWindowState(d.stateFile, snapshot());
    if (quitting || !d.hasTray()) {
      quitting = true;
      return;
    }
    e.preventDefault();
    win.hide();
  });

  if (!d.startHidden) {
    win.once('ready-to-show', () => {
      if (state.maximized) win.maximize();
      win.show();
    });
  }

  return {
    win,
    show() {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      d.onShown?.();
    },
    allowClose() {
      quitting = true;
    },
  };
}

export { WEB_PREFERENCES };
