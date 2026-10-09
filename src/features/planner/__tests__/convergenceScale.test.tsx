/**
 * The run screen's convergence chart draws in real pixels (owner, 6 Oct: "huge font while finding plan"): the SVG's
 * viewBox is the measured container width, so one user unit is one CSS pixel at any width and the labels (sized in
 * CSS px) and strokes never scale with the card.
 */
import '@/features/charts/test/setupDom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ConvergencePoint } from '@/engine/planner/domain/types';
import { LadderConvergence } from '../components/LadderConvergence';

const points = [
  { eu: 1, G: 0.1, hvLadder: 0 },
  { eu: 500, G: 0.4, hvLadder: 0.2 },
  { eu: 1000, G: 0.42, hvLadder: 0.3 },
] as unknown as ConvergencePoint[];

function atWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  const { container, unmount } = render(<LadderConvergence points={points} />);
  const svg = container.querySelector('svg')!;
  const out = {
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
    vb: svg.getAttribute('viewBox')!.split(' ').map(Number),
    texts: [...svg.querySelectorAll('text')].map((t) => t.getAttribute('font-size') ?? t.getAttribute('style')),
  };
  unmount();
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('LadderConvergence', () => {
  it('maps one drawing unit to one pixel at every container width, so text never scales', () => {
    for (const w of [320, 768, 1440, 2400]) {
      const c = atWidth(w);
      expect(c.width).toBe(w);
      expect(c.vb[2]).toBe(w);
      expect(c.vb[3]).toBe(c.height);
      expect(c.height).toBeLessThanOrEqual(260);
      expect(c.texts.every((t) => t === null)).toBe(true); // sized by the stylesheet in px, not by the viewBox
    }
  });
});
