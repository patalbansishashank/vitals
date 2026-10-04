/* ==========================================================================
   jsdom shims for the chart module's component tests (import FIRST, before
   anything that imports uplot — uPlot reads matchMedia at module load).
   Canvas drawing is a no-op recorder; layout APIs return fixed sizes.
   ========================================================================== */
const w = window as unknown as Record<string, unknown>;

if (typeof window.matchMedia !== 'function') {
  w.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

if (typeof w.devicePixelRatio !== 'number') w.devicePixelRatio = 1;

/** A 2D context whose every method is a no-op; measureText returns a width. */
function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { canvas };
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (prop === 'createPattern') return () => ({ setTransform: () => {} });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'getLineDash') return () => [];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  };
  return new Proxy(state, handler) as unknown as CanvasRenderingContext2D;
}

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
  let c = contexts.get(this);
  if (!c) {
    c = fakeContext(this);
    contexts.set(this, c);
  }
  return c;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

if (typeof w.Path2D === 'undefined') {
  w.Path2D = class {
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
    arcTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    closePath() {}
    addPath() {}
  };
}

class RO {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    const entry = { target: el, contentRect: { width: 1200, height: 600, x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 600 } };
    queueMicrotask(() => this.cb([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
  }
  unobserve() {}
  disconnect() {}
}
w.ResizeObserver = RO;

class IO {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    queueMicrotask(() => this.cb([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
w.IntersectionObserver = IO;

if (typeof w.requestAnimationFrame !== 'function') {
  w.requestAnimationFrame = (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
  w.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
g.CSS ??= {};
g.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

export {};
