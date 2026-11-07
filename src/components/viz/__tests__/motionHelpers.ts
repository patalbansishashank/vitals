/**
 * Test helper: pretend this is a real browser that is allowed to animate, so a picture goes through its
 * `data-reveal="pending"` state and out of it. jsdom never animates (`motionAllowed()` in src/app/motion.ts is false for
 * its user agent), which makes every picture render its final frame; the "final markup is identical with `animate` on and
 * off" tests need the other path too.
 *
 *   const restore = await fakeMotion();      // in a test or beforeEach
 *   ...render, `await act(async () => {})` lets the fake IntersectionObserver report "in view"...
 *   restore();                               // afterEach
 *
 * `fakeMotion({ inView: false })` keeps every picture pending (it is never reported in view).
 */
export async function fakeMotion({ inView = true }: { inView?: boolean } = {}): Promise<() => void> {
  // a browser-like environment for motionAllowed(): a user agent that is not jsdom's, matchMedia with no reduced-motion preference
  const realUA = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0 Safari/537.36', configurable: true });
  const realMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  const original = globalThis.IntersectionObserver;
  class FakeObserver {
    private readonly cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      if (inView) queueMicrotask(() => this.cb([{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  return () => {
    // jsdom defines userAgent on Navigator.prototype, so the override is an own property to delete (not one to restore)
    if (realUA) Object.defineProperty(window.navigator, 'userAgent', realUA);
    else delete (window.navigator as { userAgent?: string }).userAgent;
    window.matchMedia = realMatchMedia;
    if (original) globalThis.IntersectionObserver = original;
    else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  };
}

/**
 * A markup string with each element's attributes in alphabetical order. "The final markup equals the static markup" is
 * about what is there, not the order React happened to add attributes in (an attribute set after the first view lands
 * after the ones set at the first render).
 */
export function canonicalHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    const attrs = Array.from(el.attributes).sort((a, b) => a.name.localeCompare(b.name));
    for (const a of attrs) el.removeAttribute(a.name);
    for (const a of attrs) el.setAttribute(a.name, a.value);
  }
  return doc.body.innerHTML;
}
