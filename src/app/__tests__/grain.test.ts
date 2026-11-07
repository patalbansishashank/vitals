import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRAIN_TILE_PX, initGrainScale } from '../grain';

describe('grain scale', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--lm-grain-size');
    vi.unstubAllGlobals();
  });

  it('draws the tile at one image pixel per device pixel at a fractional scale', () => {
    vi.stubGlobal('devicePixelRatio', 1.25);
    const listeners: (() => void)[] = [];
    vi.stubGlobal('matchMedia', () => ({ addEventListener: (_: string, fn: () => void) => listeners.push(fn) }));
    initGrainScale();
    expect(document.documentElement.style.getPropertyValue('--lm-grain-size')).toBe(`${GRAIN_TILE_PX / 1.25}px`);
    // the window moves to a 2x screen: the size follows
    vi.stubGlobal('devicePixelRatio', 2);
    listeners[0]?.();
    expect(document.documentElement.style.getPropertyValue('--lm-grain-size')).toBe(`${GRAIN_TILE_PX / 2}px`);
  });
});
