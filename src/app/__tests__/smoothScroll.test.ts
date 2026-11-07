import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { autoRaf?: boolean };
    isScrolling: string | false;
    raf: ReturnType<typeof vi.fn>;
    scrollTo: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    listener?: () => void;
  }>,
}));
vi.mock('lenis', () => ({
  default: class {
    isScrolling: string | false = false;
    raf = vi.fn();
    scrollTo = vi.fn((_y: number, options?: { immediate?: boolean }) => {
      this.isScrolling = options?.immediate ? false : 'smooth';
    });
    destroy = vi.fn();
    stop = vi.fn(() => {
      this.isScrolling = false;
    });
    start = vi.fn();
    listener?: () => void;
    constructor(public options: { autoRaf?: boolean }) {
      mock.instances.push(this);
    }
    on(_name: string, callback: () => void) {
      this.listener = callback;
    }
  },
}));
vi.mock('gsap', () => ({ gsap: {} }));
vi.mock('@/platform/detect', () => ({ detectPlatform: () => 'web' }));

const ua = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
beforeEach(() => {
  vi.resetModules();
  mock.instances.length = 0;
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Chrome' });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: fine'),
    addEventListener() {},
  }));
});
afterEach(() => {
  if (ua) Object.defineProperty(navigator, 'userAgent', ua);
  else delete (navigator as { userAgent?: string }).userAgent;
  delete document.documentElement.dataset.motion;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('sleeps while reading, wakes for wheel and programmatic glides, then stops requesting frames', async () => {
  const { initMotion, scrollPageTo, getLenis } = await import('../motion');
  initMotion();
  await vi.advanceTimersByTimeAsync(250);
  const scroller = mock.instances[0]!;
  expect(scroller.options.autoRaf).toBe(false);
  expect(scroller.raf).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(scroller.raf).not.toHaveBeenCalled();

  // Lenis emits virtual-scroll before assigning the wheel target.
  scroller.listener!();
  expect(scroller.raf).toHaveBeenCalledTimes(1); // reset its clock after the idle period
  scroller.isScrolling = 'smooth';
  await vi.advanceTimersByTimeAsync(40);
  expect(scroller.raf.mock.calls.length).toBeGreaterThan(1);
  scroller.isScrolling = false;
  await vi.advanceTimersByTimeAsync(20);
  const settled = scroller.raf.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(scroller.raf).toHaveBeenCalledTimes(settled);

  scrollPageTo(200);
  expect(scroller.scrollTo).toHaveBeenLastCalledWith(200, { immediate: false, force: true });
  await vi.advanceTimersByTimeAsync(20);
  expect(scroller.raf.mock.calls.length).toBeGreaterThan(settled + 1);
  window.dispatchEvent(new CustomEvent('vitals:scroll-lock', { detail: true }));
  await vi.advanceTimersByTimeAsync(20);
  const locked = scroller.raf.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(scroller.raf).toHaveBeenCalledTimes(locked);

  window.dispatchEvent(new CustomEvent('vitals:scroll-lock', { detail: false }));
  scrollPageTo(350);
  document.documentElement.dataset.motion = 'reduce';
  await vi.advanceTimersByTimeAsync(20);
  expect(scroller.destroy).toHaveBeenCalledOnce();
  expect(getLenis()).toBeNull();
  const reduced = scroller.raf.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(scroller.raf).toHaveBeenCalledTimes(reduced);
});
