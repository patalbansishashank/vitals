import './setupDom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewStrip } from '../components/PreviewStrip';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PreviewStrip in a container narrower than its margins', () => {
  it('never draws a ketosis bar with a negative width', () => {
    class NarrowObserver {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width: 57 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NarrowObserver);
    const fat = Array.from({ length: 20 }, (_, i) => 20 - i * 0.1);
    const { container } = render(<PreviewStrip fat={fat} ketosis={Array.from({ length: 20 }, () => 2)} />);
    expect(screen.getByRole('img', { name: /^Preview: fat mass/ })).toBeInTheDocument();
    const rects = [...container.querySelectorAll('rect')];
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) expect(Number(r.getAttribute('width'))).toBeGreaterThan(0);
  });
});
