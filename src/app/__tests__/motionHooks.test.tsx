/**
 * The pictures' motion hooks (r071 package 0A, AUDIT §4.5): useInView, useCountUp, useSweep, useDrawIn, useGrow,
 * usePulse, useFlip and fadeCue. Every hook has a still, final frame that is the real content, and where motion cannot
 * run (jsdom, the OS or Settings asking for less) it returns that frame on the FIRST render, so a test, a screenshot
 * and a person who asked for less all see the content. This file checks that first (the default in jsdom), then runs the
 * animated path with a browser-like environment: a user agent that is not jsdom, matchMedia, a fake frame clock, the Web
 * Animations API and IntersectionObserver as spies.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useRef, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MOTION, fadeCue, motionAllowed, useCountUp, useDrawIn, useFlip, useGrow, useInView, usePulse, useSweep } from '@/app/motion';

const proto = HTMLElement.prototype as unknown as { animate?: unknown };
const realUA = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
const saved = { matchMedia: window.matchMedia, animate: proto.animate, io: (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver };

/** A browser-like environment: not jsdom, no preference for reduced motion, a Web Animations spy, a fake frame clock. */
function browser({ reduce = false }: { reduce?: boolean } = {}) {
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0 Safari/537.36', configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: reduce && /prefers-reduced-motion: reduce/.test(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
}

const animations: Array<{ el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }> = [];
function spyOnAnimate() {
  animations.length = 0;
  proto.animate = function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const cancel = vi.fn();
    animations.push({ el: this, frames, options, cancel });
    return { cancel } as unknown as Animation;
  };
}

afterEach(() => {
  vi.useRealTimers();
  // jsdom defines userAgent on Navigator.prototype, so the override is an own property to delete (not one to restore)
  if (realUA) Object.defineProperty(window.navigator, 'userAgent', realUA);
  else delete (window.navigator as { userAgent?: string }).userAgent;
  window.matchMedia = saved.matchMedia;
  proto.animate = saved.animate;
  (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = saved.io;
  delete document.documentElement.dataset.motion;
  animations.length = 0;
});

const frames = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function Count({ value, start, from }: { value: number | null; start?: boolean; from?: number }) {
  const n = useCountUp(value, { start, from });
  return <span data-testid="n">{n === null ? 'none' : Math.round(n)}</span>;
}
function Sweep({ count, start }: { count: number; start?: boolean }) {
  return <span data-testid="lit">{useSweep(count, { start })}</span>;
}

describe('motionAllowed: where the hooks run at all', () => {
  it('is false in jsdom (so tests see final states), true in a browser, false under either reduced-motion switch', () => {
    expect(motionAllowed()).toBe(false);
    browser();
    expect(motionAllowed()).toBe(true);
    document.documentElement.dataset.motion = 'reduce';
    expect(motionAllowed()).toBe(false);
    document.documentElement.dataset.motion = 'full';
    expect(motionAllowed()).toBe(true);
    delete document.documentElement.dataset.motion;
    vi.useRealTimers();
    browser({ reduce: true });
    expect(motionAllowed()).toBe(false);
  });
});

describe('with motion off (jsdom, reduced motion) every hook is its final state on the first render', () => {
  it('useCountUp returns the value, useSweep the full count, useInView true, usePulse false', () => {
    render(
      <>
        <Count value={1096} />
        <Sweep count={72} />
      </>,
    );
    expect(screen.getByTestId('n')).toHaveTextContent('1096');
    expect(screen.getByTestId('lit')).toHaveTextContent('72');
    // even when it would wait for a scroll (`start={false}`): a picture that cannot animate never waits
    render(<Count value={7605} start={false} />);
    expect(screen.getAllByTestId('n')[1]).toHaveTextContent('7605');
  });

  it('a null value stays null (nothing to count)', () => {
    render(<Count value={null} />);
    expect(screen.getByTestId('n')).toHaveTextContent('none');
  });

  it('useInView is true, useDrawIn / useGrow / useFlip never touch the Web Animations API, usePulse never pulses', () => {
    spyOnAnimate();
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const seen = useInView(ref);
      useDrawIn(ref);
      useGrow(ref);
      useFlip(ref, 1);
      const pulsing = usePulse();
      return (
        <div ref={ref} data-testid="probe" data-seen={String(seen)} data-pulsing={String(pulsing)}>
          <i data-flip="a" />
          <i data-flip="b" />
        </div>
      );
    }
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-seen', 'true');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-pulsing', 'false');
    expect(animations).toHaveLength(0);
  });

  it('under reduced motion in a real browser the same holds, and fadeCue gives the 100 ms cross-fade instead of a move', () => {
    browser({ reduce: true });
    spyOnAnimate();
    render(<Count value={1096} />);
    expect(screen.getByTestId('n')).toHaveTextContent('1096');
    const card = document.createElement('div');
    fadeCue(card);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(animations[0]!.options.duration).toBe(MOTION.reducedFade);
    expect(MOTION.reducedFade).toBe(100);
  });

  it('fadeCue does nothing when motion is allowed (the picture\'s own animation is the cue) or in jsdom', () => {
    spyOnAnimate();
    fadeCue(document.createElement('div'));
    expect(animations).toHaveLength(0);
    browser();
    fadeCue(document.createElement('div'));
    expect(animations).toHaveLength(0);
  });
});

describe('useCountUp (animated)', () => {
  it('counts 0 → value in 1100 ms, expo-out, and ends on the exact value', async () => {
    browser();
    render(<Count value={1096} />);
    expect(screen.getByTestId('n')).toHaveTextContent('0');
    await frames(110);
    const early = Number(screen.getByTestId('n').textContent);
    expect(early).toBeGreaterThan(300); // expo-out: 1 − 2^(−1) = 50 % at a tenth of the time
    expect(early).toBeLessThan(900);
    await frames(300);
    const later = Number(screen.getByTestId('n').textContent);
    expect(later).toBeGreaterThan(early);
    expect(later).toBeLessThan(1096);
    await frames(1000);
    expect(screen.getByTestId('n')).toHaveTextContent('1096');
  });

  it('holds at `from` until `start` (in view), then counts', async () => {
    browser();
    const { rerender } = render(<Count value={80} start={false} />);
    await frames(500);
    expect(screen.getByTestId('n')).toHaveTextContent('0');
    rerender(<Count value={80} start />);
    await frames(1200);
    expect(screen.getByTestId('n')).toHaveTextContent('80');
  });

  it('a new value counts from the old one in 400 ms, never from zero', async () => {
    browser();
    const { rerender } = render(<Count value={1000} />);
    await frames(1300);
    expect(screen.getByTestId('n')).toHaveTextContent('1000');
    rerender(<Count value={1200} />);
    await frames(20);
    expect(Number(screen.getByTestId('n').textContent)).toBeGreaterThanOrEqual(1000);
    await frames(480);
    expect(screen.getByTestId('n')).toHaveTextContent('1200');
  });

  it('a value that goes away shows nothing, and an unmounted count stops asking for frames', async () => {
    browser();
    const { rerender, unmount } = render(<Count value={50} />);
    await frames(50);
    rerender(<Count value={null} />);
    expect(screen.getByTestId('n')).toHaveTextContent('none');
    unmount();
    await frames(2000); // nothing left to tick: no state update after unmount, no warning
  });
});

describe('useSweep (animated)', () => {
  it('lights ticks one after another, 14 ms each, up to the count', async () => {
    browser();
    render(<Sweep count={72} />);
    expect(screen.getByTestId('lit')).toHaveTextContent('0');
    await frames(140);
    const lit = Number(screen.getByTestId('lit').textContent);
    expect(lit).toBeGreaterThanOrEqual(8);
    expect(lit).toBeLessThanOrEqual(12); // about 10 ticks in 140 ms
    await frames(1000);
    expect(screen.getByTestId('lit')).toHaveTextContent('72');
  });

  it('an update re-sweeps only the difference: 60 → 72 takes about 12 × 14 ms, not a whole lap', async () => {
    browser();
    const { rerender } = render(<Sweep count={60} />);
    await frames(1000);
    expect(screen.getByTestId('lit')).toHaveTextContent('60');
    rerender(<Sweep count={72} />);
    await frames(250);
    expect(screen.getByTestId('lit')).toHaveTextContent('72');
  });
});

describe('useInView', () => {
  type Entry = { isIntersecting: boolean };
  let observers: Array<{ cb: (e: Entry[]) => void; disconnect: ReturnType<typeof vi.fn>; options?: IntersectionObserverInit; el?: Element }> = [];
  beforeEach(() => {
    observers = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      cb: (e: Entry[]) => void;
      disconnect = vi.fn();
      options?: IntersectionObserverInit;
      constructor(cb: (e: Entry[]) => void, options?: IntersectionObserverInit) {
        this.cb = cb;
        this.options = options;
        observers.push(this as never);
      }
      observe(el: Element) {
        (this as unknown as { el: Element }).el = el;
      }
    };
  });
  function Probe({ once }: { once?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const seen = useInView(ref, { once });
    return <div ref={ref} data-testid="v" data-seen={String(seen)} />;
  }

  it('is false until 20 % of the element shows, then true for good and stops watching (once)', () => {
    browser();
    render(<Probe />);
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'false');
    expect(observers).toHaveLength(1);
    expect(observers[0]!.options).toEqual({ threshold: 0.2 });
    act(() => observers[0]!.cb([{ isIntersecting: false }]));
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'false');
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'true');
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    act(() => observers[0]!.cb([{ isIntersecting: false }]));
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'true'); // once per mount
  });

  it('with `once: false` it follows the element in and out', () => {
    browser();
    render(<Probe once={false} />);
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'true');
    act(() => observers[0]!.cb([{ isIntersecting: false }]));
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'false');
  });

  it('is true at once where IntersectionObserver is missing (an old WebView): a picture never waits for a scroll it cannot hear', () => {
    browser();
    (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    render(<Probe />);
    expect(screen.getByTestId('v')).toHaveAttribute('data-seen', 'true');
  });

  it('disconnects on unmount', () => {
    browser();
    const { unmount } = render(<Probe />);
    unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });
});

describe('useDrawIn and useGrow (animated, Web Animations)', () => {
  function Line({ start = true, mode }: { start?: boolean; mode?: 'clip' | 'dash' }) {
    const ref = useRef<HTMLDivElement>(null);
    useDrawIn(ref, { start, mode });
    return <div ref={ref} data-testid="line" />;
  }
  function Bars({ start = true }: { start?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useGrow(ref, { start });
    return (
      <div ref={ref}>
        <i data-testid="b0" />
        <i data-testid="b1" />
        <i data-testid="b2" />
      </div>
    );
  }

  it('the line reveals left to right over 1200 ms, expo-out, hidden before and exactly itself after (fill: backwards)', () => {
    browser();
    spyOnAnimate();
    const { unmount } = render(<Line />);
    expect(animations).toHaveLength(1);
    const a = animations[0]!;
    expect(a.el).toBe(screen.getByTestId('line'));
    expect(a.frames).toEqual([{ clipPath: 'inset(-8px 100% -8px 0)' }, { clipPath: 'inset(-8px -8px -8px 0)' }]);
    expect(a.options).toMatchObject({ duration: MOTION.draw, delay: 120, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
    unmount();
    expect(a.cancel).toHaveBeenCalled(); // tears down with the picture
  });

  it('waits for `start` (in view) before it draws', () => {
    browser();
    spyOnAnimate();
    const { rerender } = render(<Line start={false} />);
    expect(animations).toHaveLength(0);
    rerender(<Line start />);
    expect(animations).toHaveLength(1);
  });

  it('bars grow from their baseline, 700 ms each, one after another 60 ms apart (transform only)', () => {
    browser();
    spyOnAnimate();
    render(<Bars />);
    expect(animations).toHaveLength(3);
    expect(animations.map((a) => a.options.delay)).toEqual([0, MOTION.staggerBar, 2 * MOTION.staggerBar]);
    for (const a of animations) {
      expect(a.options).toMatchObject({ duration: MOTION.bars, fill: 'backwards' });
      expect(a.frames).toEqual([
        { transformOrigin: 'bottom center', transform: 'scaleY(0)' },
        { transformOrigin: 'bottom center', transform: 'none' },
      ]);
      expect(Object.keys(a.frames[0]!)).not.toContain('height'); // never a layout property
    }
  });
});

describe('usePulse', () => {
  function Live({ times }: { times?: number }) {
    const pulsing = usePulse(times);
    return <span className="lm-live" data-testid="live" data-pulse={pulsing || undefined} />;
  }

  it('pulses twice (4.8 s, under WCAG 2.2.2) and stops for good', async () => {
    browser();
    render(<Live />);
    expect(screen.getByTestId('live')).toHaveAttribute('data-pulse', 'true');
    await frames(MOTION.pulse * 2 - 100);
    expect(screen.getByTestId('live')).toHaveAttribute('data-pulse', 'true');
    await frames(200);
    expect(screen.getByTestId('live')).not.toHaveAttribute('data-pulse');
    expect(MOTION.pulse * MOTION.pulseCycles).toBeLessThan(5000);
    await frames(10_000);
    expect(screen.getByTestId('live')).not.toHaveAttribute('data-pulse'); // never again on its own
  });

  it('a mark that must pulse again remounts with a new key', async () => {
    browser();
    const { rerender } = render(<Live key="a" />);
    await frames(MOTION.pulse * 2 + 100);
    expect(screen.getByTestId('live')).not.toHaveAttribute('data-pulse');
    rerender(<Live key="b" />);
    expect(screen.getByTestId('live')).toHaveAttribute('data-pulse', 'true');
  });

  it('never pulses with zero cycles', () => {
    browser();
    render(<Live times={0} />);
    expect(screen.getByTestId('live')).not.toHaveAttribute('data-pulse');
  });
});

describe('useFlip (animated)', () => {
  const rects = new Map<string, DOMRect>();
  const rect = (left: number, top: number, w = 100, h = 80) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  function Grid({ k, ids }: { k: number; ids: string[] }): ReactNode {
    const ref = useRef<HTMLDivElement>(null);
    useFlip(ref, k);
    return (
      <div ref={ref}>
        {ids.map((id) => (
          <div key={id} data-flip={id} data-testid={id} ref={(el) => { if (el) el.getBoundingClientRect = () => rects.get(id) ?? rect(0, 0); }} />
        ))}
      </div>
    );
  }

  it('slides what moved from where it was to where it is (translate → none, 280 ms, one overshoot); what stayed or is new does not slide', () => {
    browser();
    spyOnAnimate();
    rects.clear();
    rects.set('a', rect(0, 0));
    rects.set('b', rect(116, 0));
    const { rerender } = render(<Grid k={0} ids={['a', 'b']} />);
    expect(animations).toHaveLength(0); // the first layout has nothing to come from
    // b moves down to the next row, a stays, c is new
    rects.set('b', rect(0, 96));
    rects.set('c', rect(116, 96));
    rerender(<Grid k={1} ids={['a', 'b', 'c']} />);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.el).toBe(screen.getByTestId('b'));
    expect(animations[0]!.frames).toEqual([{ transform: 'translate(116px, -96px)' }, { transform: 'none' }]);
    expect(animations[0]!.options).toMatchObject({ duration: MOTION.flip, easing: 'cubic-bezier(0.34, 1.36, 0.64, 1)' });
  });

  /** A grid whose own box can be moved too (the page scrolled): the children are measured against it. */
  function Scrolled({ k, ids, root }: { k: number; ids: string[]; root: DOMRect }): ReactNode {
    const ref = useRef<HTMLDivElement>(null);
    useFlip(ref, k);
    return (
      <div ref={(el) => { ref.current = el; if (el) el.getBoundingClientRect = () => root; }}>
        {ids.map((id) => (
          <div key={id} data-flip={id} data-testid={id} ref={(el) => { if (el) el.getBoundingClientRect = () => rects.get(id) ?? rect(0, 0); }} />
        ))}
      </div>
    );
  }

  it('is not fooled by a scroll: the page moving between two changes is not a move of every card', () => {
    browser();
    spyOnAnimate();
    rects.clear();
    rects.set('a', rect(0, 0));
    rects.set('b', rect(116, 0));
    const { rerender } = render(<Scrolled k={0} ids={['a', 'b']} root={rect(0, 0, 232, 80)} />);
    // the page scrolled 300 px (the grid and every card are 300 px higher) and b moved to the next row
    rects.set('a', rect(0, -300));
    rects.set('b', rect(0, -204));
    rerender(<Scrolled k={1} ids={['a', 'b']} root={rect(0, -300, 232, 176)} />);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.el).toBe(screen.getByTestId('b'));
    expect(animations[0]!.frames).toEqual([{ transform: 'translate(116px, -96px)' }, { transform: 'none' }]);
  });

  it('a card still sliding when the next change comes starts its new slide from where it was last seen', () => {
    browser();
    spyOnAnimate();
    const realMatrix = (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly;
    const realStyle = window.getComputedStyle;
    // once `sliding`, b is carrying a 20 px slide down (the one still running); the stub reads it back as a matrix
    let sliding = false;
    (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class {
      m41 = 0;
      m42 = 20;
    };
    window.getComputedStyle = ((el: Element) => ({ transform: sliding && (el as HTMLElement).dataset.testid === 'b' ? 'matrix(1, 0, 0, 1, 0, 20)' : 'none' })) as unknown as typeof window.getComputedStyle;
    try {
      rects.clear();
      rects.set('a', rect(0, 0));
      rects.set('b', rect(116, 0));
      const { rerender } = render(<Grid k={0} ids={['a', 'b']} />);
      sliding = true;
      rects.set('b', rect(0, 96 + 20)); // the layout place is 96, the rect also carries the 20 px slide
      rerender(<Grid k={1} ids={['a', 'b']} />);
      expect(animations).toHaveLength(1);
      expect(animations[0]!.frames).toEqual([{ transform: 'translate(116px, -76px)' }, { transform: 'none' }]);
    } finally {
      (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = realMatrix;
      window.getComputedStyle = realStyle;
    }
  });

  it('does nothing when `key` does not change', () => {
    browser();
    spyOnAnimate();
    rects.clear();
    rects.set('a', rect(0, 0));
    const { rerender } = render(<Grid k={0} ids={['a']} />);
    rects.set('a', rect(50, 50));
    rerender(<Grid k={0} ids={['a']} />);
    expect(animations).toHaveLength(0);
  });
});

describe('the constants are the tokens (tokens.css §16)', () => {
  const tokens = readFileSync(resolve(__dirname, '../../styles/tokens.css'), 'utf8');
  const ms = (name: string) => Number(tokens.match(new RegExp(`--${name}:\\s*(\\d+)ms;`))![1]);
  it('MOTION mirrors --lm-dur-count … --lm-stagger-bar', () => {
    expect(MOTION.count).toBe(ms('lm-dur-count'));
    expect(MOTION.draw).toBe(ms('lm-dur-draw'));
    expect(MOTION.glow).toBe(ms('lm-dur-glow'));
    expect(MOTION.bars).toBe(ms('lm-dur-bars'));
    expect(MOTION.fill).toBe(ms('lm-dur-fill'));
    expect(MOTION.staggerTick).toBe(ms('lm-stagger-tick'));
    expect(MOTION.staggerBar).toBe(ms('lm-stagger-bar'));
    expect(MOTION.pulseCycles).toBe(Number(tokens.match(/--lm-pulse-cycles:\s*(\d+);/)![1]));
  });
});
