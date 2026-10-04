import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainWindow, DEFAULT_STATE, loadWindowState, MIN_SIZE, parseWindowState, restoreWindowState, saveWindowState, type Rect, type WindowLike } from './window';

const one: Rect[] = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const two: Rect[] = [...one, { x: 1920, y: 0, width: 2560, height: 1400 }];

describe('parseWindowState', () => {
  it('reads a saved state and ignores junk', () => {
    expect(parseWindowState('{"x":10,"y":20,"width":800,"height":600,"maximized":true}')).toEqual({ x: 10, y: 20, width: 800, height: 600, maximized: true });
    expect(parseWindowState('{"width":800.6,"height":600.2}')).toEqual({ width: 801, height: 600 });
    expect(parseWindowState('{"x":"a","y":1,"width":800,"height":600}')).toEqual({ width: 800, height: 600 });
    expect(parseWindowState('{"width":"800"}')).toEqual(DEFAULT_STATE);
    expect(parseWindowState('{"width":1e999,"height":600}')).toEqual(DEFAULT_STATE);
    expect(parseWindowState('not json')).toEqual(DEFAULT_STATE);
    expect(parseWindowState('')).toEqual(DEFAULT_STATE);
    expect(parseWindowState(null)).toEqual(DEFAULT_STATE);
  });
});

describe('restoreWindowState', () => {
  it('keeps a position that is still on a display', () => {
    expect(restoreWindowState({ x: 100, y: 50, width: 1000, height: 700 }, one)).toEqual({ x: 100, y: 50, width: 1000, height: 700 });
    expect(restoreWindowState({ x: 2000, y: 100, width: 1000, height: 700, maximized: true }, two)).toEqual({ x: 2000, y: 100, width: 1000, height: 700, maximized: true });
  });

  it('centres a window whose display is gone', () => {
    const s = restoreWindowState({ x: 2000, y: 100, width: 1000, height: 700 }, one);
    expect(s).toEqual({ x: 460, y: 170, width: 1000, height: 700 });
    expect(restoreWindowState({ x: -5000, y: 50, width: 1000, height: 700 }, one).x).toBe(460);
    expect(restoreWindowState({ x: 100, y: 1030, width: 1000, height: 700 }, one).y).toBe(170); // title strip below the work area
    expect(restoreWindowState({ x: 1850, y: 50, width: 1000, height: 700 }, one).x).toBe(460); // less than 100 px left on screen
  });

  it('keeps the maximised flag when the position had to be reset', () => {
    expect(restoreWindowState({ x: 9000, y: 9000, width: 1000, height: 700, maximized: true }, one).maximized).toBe(true);
  });

  it('clamps the size to the display and the minimum', () => {
    expect(restoreWindowState({ x: 0, y: 0, width: 5000, height: 4000 }, one)).toMatchObject({ width: 1920, height: 1040 });
    expect(restoreWindowState({ x: 0, y: 0, width: 10, height: 10 }, one)).toMatchObject(MIN_SIZE);
    expect(restoreWindowState({ width: 5000, height: 10 }, one)).toMatchObject({ width: 1920, height: MIN_SIZE.height });
  });

  it('uses the default size centred when nothing was saved', () => {
    expect(restoreWindowState(DEFAULT_STATE, one)).toEqual({ x: 360, y: 110, width: 1200, height: 820 });
    expect(restoreWindowState({ width: 0, height: 0 }, one)).toMatchObject({ width: 1200, height: 820 });
  });

  it('copes with no display at all', () => {
    expect(restoreWindowState({ x: 10, y: 10, width: 800, height: 600 }, [])).toEqual({ width: 800, height: 600 });
  });
});

describe('state file', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'vitals-win-'));
    dirs.push(d);
    return d;
  };

  it('round-trips and survives a missing or broken file', () => {
    const file = path.join(tmp(), 'nested', 'window-state.json');
    expect(loadWindowState(file)).toEqual(DEFAULT_STATE);
    saveWindowState(file, { x: 1, y: 2, width: 900, height: 700, maximized: true });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ x: 1, y: 2, width: 900, height: 700, maximized: true });
    expect(loadWindowState(file)).toEqual({ x: 1, y: 2, width: 900, height: 700, maximized: true });
    writeFileSync(file, '{broken');
    expect(loadWindowState(file)).toEqual(DEFAULT_STATE);
  });
});

/** A BrowserWindow stand-in that records events and calls. */
function fakeWindow(bounds: Rect) {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const calls: string[] = [];
  let maximized = false;
  let destroyed = false;
  const win: WindowLike & { fire(ev: string, ...a: unknown[]): void; calls: string[]; destroy(): void } = {
    getNormalBounds: () => bounds,
    isMaximized: () => maximized,
    isMinimized: () => false,
    isDestroyed: () => destroyed,
    on: ((ev: string, l: (...a: unknown[]) => void) => void (listeners[ev] ??= []).push(l)) as WindowLike['on'],
    once: ((ev: string, l: (...a: unknown[]) => void) => void (listeners[ev] ??= []).push(l)) as WindowLike['once'],
    hide: () => void calls.push('hide'),
    show: () => void calls.push('show'),
    focus: () => void calls.push('focus'),
    restore: () => void calls.push('restore'),
    maximize: () => {
      maximized = true;
      calls.push('maximize');
    },
    fire: (ev, ...a) => (listeners[ev] ?? []).forEach((l) => l(...a)),
    calls,
    destroy: () => void (destroyed = true),
  };
  return win;
}

describe('createMainWindow', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const stateFile = (): string => {
    const d = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'vitals-win-'));
    dirs.push(d);
    return path.join(d, 'window-state.json');
  };

  it('opens with the restored geometry and shows when ready (maximised when it was)', () => {
    const file = stateFile();
    saveWindowState(file, { x: 50, y: 60, width: 1000, height: 700, maximized: true });
    let made: { x?: number; y?: number; width: number; height: number; show: boolean } | undefined;
    const win = fakeWindow({ x: 50, y: 60, width: 1000, height: 700 });
    createMainWindow({ stateFile: file, workAreas: one, startHidden: false, hasTray: () => true, quit: vi.fn(), make: (o) => ((made = o), win) });
    expect(made).toEqual({ x: 50, y: 60, width: 1000, height: 700, show: false });
    win.fire('ready-to-show');
    expect(win.calls).toEqual(['maximize', 'show']);
  });

  it('stays hidden with --hidden, and show() brings it up and tells the page', () => {
    const win = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
    const onShown = vi.fn();
    const m = createMainWindow({ stateFile: stateFile(), workAreas: one, startHidden: true, hasTray: () => true, quit: vi.fn(), make: () => win, onShown });
    win.fire('ready-to-show');
    expect(win.calls).toEqual([]);
    m.show();
    expect(win.calls).toEqual(['show', 'focus']);
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('hides on close while there is a tray, saving the geometry; quits otherwise', () => {
    const file = stateFile();
    const win = fakeWindow({ x: 5, y: 6, width: 900, height: 650 });
    let tray = true;
    createMainWindow({ stateFile: file, workAreas: one, startHidden: false, hasTray: () => tray, quit: vi.fn(), make: () => win });
    const e1 = { preventDefault: vi.fn() };
    win.fire('close', e1);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(win.calls).toEqual(['hide']);
    expect(loadWindowState(file)).toEqual({ x: 5, y: 6, width: 900, height: 650 });
    tray = false;
    const e2 = { preventDefault: vi.fn() };
    win.fire('close', e2);
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });

  it('closes for real after allowClose() even with a tray', () => {
    const win = fakeWindow({ x: 0, y: 0, width: 800, height: 600 });
    const m = createMainWindow({ stateFile: stateFile(), workAreas: one, startHidden: false, hasTray: () => true, quit: vi.fn(), make: () => win });
    m.allowClose();
    const e = { preventDefault: vi.fn() };
    win.fire('close', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.calls).toEqual([]);
  });

  it('saves moves and resizes a moment after they settle', () => {
    vi.useFakeTimers();
    const file = stateFile();
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    const win = fakeWindow(bounds);
    createMainWindow({ stateFile: file, workAreas: one, startHidden: false, hasTray: () => true, quit: vi.fn(), make: () => win });
    bounds.x = 40;
    win.fire('move');
    bounds.width = 1000;
    win.fire('resize');
    expect(loadWindowState(file)).toEqual(DEFAULT_STATE);
    vi.advanceTimersByTime(500);
    expect(loadWindowState(file)).toEqual({ x: 40, y: 0, width: 1000, height: 600 });
  });
});
