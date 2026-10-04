import { describe, expect, it } from 'vitest';
import { ChartController } from '../core/controller';

describe('ChartController', () => {
  it('snaps the cursor to the current resolution', () => {
    const c = new ChartController(84);
    c.setCursor(45.2, 'pointer');
    expect(c.cursor.get()).toMatchObject({ t: 45.5, pinned: false, source: 'pointer' });
    c.dispatch({ type: 'preset', preset: 1, centre: 45.5 }, { animate: false });
    expect(c.view.get()).toMatchObject({ x0: 45, x1: 46, res: 'hourly' });
    c.setCursor(45.52, 'pointer');
    expect(c.cursor.get().t).toBeCloseTo(45 + 12.5 / 24, 9);
  });
  it('keeps a pinned crosshair until forced', () => {
    const c = new ChartController(84);
    c.setCursor(10, 'pointer', { pin: true });
    c.setCursor(20, 'pointer');
    expect(c.cursor.get()).toMatchObject({ t: 10.5, pinned: true });
    c.setCursor(20, 'pointer', { force: true, pin: false });
    expect(c.cursor.get()).toMatchObject({ t: 20.5, pinned: false });
  });
  it('pans the window when the keyboard cursor leaves it', () => {
    const c = new ChartController(84);
    c.dispatch({ type: 'preset', preset: 7, centre: 3 }, { animate: false });
    c.setCursor(6.5, 'keyboard');
    c.stepCursor(1);
    expect(c.cursor.get().t).toBeCloseTo(6 + 13.5 / 24, 9);
    c.stepCursor(24);
    const v = c.view.get();
    expect(c.cursor.get().t!).toBeGreaterThanOrEqual(v.x0);
    expect(c.cursor.get().t!).toBeLessThanOrEqual(v.x1);
  });
  it('honours a forced resolution', () => {
    const c = new ChartController(84, { resolution: 'hourly' });
    expect(c.view.get().res).toBe('hourly');
    c.setResolutionMode('auto');
    expect(c.view.get().res).toBe('daily');
  });
  it('resets on a new horizon', () => {
    const c = new ChartController(84);
    c.dispatch({ type: 'preset', preset: 7 }, { animate: false });
    c.setDays(183);
    expect(c.view.get()).toMatchObject({ x0: 0, x1: 183, res: 'daily' });
  });
});
