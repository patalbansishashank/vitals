import { describe, expect, it } from 'vitest';
import { activePreset, clampWindow, initialZoom, isZoomed, presetLabel, zoomReducer } from '../lib/zoom';

const z0 = initialZoom(84);

describe('zoom reducer', () => {
  it('starts on the whole horizon', () => {
    expect(z0).toMatchObject({ x0: 0, x1: 84 });
    expect(activePreset(z0)).toBe('all');
    expect(isZoomed(z0)).toBe(false);
  });
  it('applies presets around a centre, aligned for weeks and days', () => {
    const wk = zoomReducer(z0, { type: 'preset', preset: 7, centre: 45.5 });
    expect(wk).toMatchObject({ x0: 42, x1: 49 });
    const day = zoomReducer(z0, { type: 'preset', preset: 1, centre: 45.5 });
    expect(day).toMatchObject({ x0: 45, x1: 46 });
    const four = zoomReducer(z0, { type: 'preset', preset: 28, centre: 80 });
    expect(four).toMatchObject({ x0: 56, x1: 84 });
    expect(activePreset(four)).toBe(28);
  });
  it('zooms around an anchor keeping it fixed on screen', () => {
    const s = zoomReducer(z0, { type: 'zoomAt', factor: 0.5, anchor: 21 });
    expect(s.x1 - s.x0).toBeCloseTo(42, 9);
    expect((21 - s.x0) / (s.x1 - s.x0)).toBeCloseTo(21 / 84, 9);
  });
  it('clamps zoom to the minimum span and the horizon', () => {
    let s = z0;
    for (let i = 0; i < 20; i++) s = zoomReducer(s, { type: 'zoomAt', factor: 0.5, anchor: 30 });
    expect(s.x1 - s.x0).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 20; i++) s = zoomReducer(s, { type: 'zoomAt', factor: 2, anchor: 30 });
    expect(s).toMatchObject({ x0: 0, x1: 84 });
  });
  it('pans by delta and by whole windows without leaving the horizon', () => {
    const wk = zoomReducer(z0, { type: 'preset', preset: 7, centre: 3 });
    expect(zoomReducer(wk, { type: 'panWindow', dir: 1 })).toMatchObject({ x0: 7, x1: 14 });
    expect(zoomReducer(wk, { type: 'panWindow', dir: -1 })).toBe(wk);
    expect(zoomReducer(wk, { type: 'pan', delta: 100 })).toMatchObject({ x0: 77, x1: 84 });
  });
  it('brushes a range (either direction) with a minimum span', () => {
    expect(zoomReducer(z0, { type: 'brush', a: 30, b: 10 })).toMatchObject({ x0: 10, x1: 30 });
    const tiny = zoomReducer(z0, { type: 'brush', a: 10, b: 10.1 });
    expect(tiny.x1 - tiny.x0).toBeCloseTo(0.5, 9);
  });
  it('steps through zoom levels and resets', () => {
    const in1 = zoomReducer(z0, { type: 'step', dir: 1, centre: 40 });
    expect(in1.x1 - in1.x0).toBe(28);
    const in2 = zoomReducer(in1, { type: 'step', dir: 1, centre: 40 });
    expect(in2.x1 - in2.x0).toBe(7);
    const out = zoomReducer(in2, { type: 'step', dir: -1, centre: 40 });
    expect(out.x1 - out.x0).toBe(28);
    expect(zoomReducer(in2, { type: 'reset' })).toMatchObject({ x0: 0, x1: 84 });
  });
  it('re-initialises when the horizon changes', () => {
    const wk = zoomReducer(z0, { type: 'preset', preset: 7 });
    expect(zoomReducer(wk, { type: 'days', days: 183 })).toMatchObject({ x0: 0, x1: 183, days: 183 });
  });
  it('clampWindow keeps span and bounds', () => {
    expect(clampWindow(-3, 4, 84, 0.5)).toEqual([0, 7]);
    expect(clampWindow(80, 90, 84, 0.5)).toEqual([74, 84]);
  });
  it('labels presets', () => {
    expect(presetLabel('all', 84)).toBe('12 wk');
    expect(presetLabel('all', 183)).toBe('26 wk');
    expect(presetLabel(1, 84)).toBe('day');
  });
});
