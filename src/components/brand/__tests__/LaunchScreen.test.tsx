import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { hadStartScreen, LaunchScreen, launchTiming, startScreenPainted } from '../LaunchScreen';

let now = 0;
let startScreen: HTMLElement | null = null;

/** Puts index.html's static start screen into the document, as it is before React's first commit. */
function withStartScreen() {
  startScreen = document.createElement('div');
  startScreen.className = 'vitals-launch';
  document.body.append(startScreen);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  startScreen?.remove();
  startScreen = null;
  document.documentElement.removeAttribute('data-motion');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const overlay = () => document.querySelector('.lm-launch');
// a path, not `new URL(…, import.meta.url)`: under jsdom that URL is not a file: URL and readFileSync refuses it
const brandCss = readFileSync(resolve(__dirname, '../brand.css'), 'utf8');

/** React listens for the prefixed name where the DOM has no AnimationEvent (jsdom). */
function animationEnd(el: Element, animationName: string) {
  const type = 'AnimationEvent' in window ? 'animationend' : 'webkitAnimationEnd';
  fireEvent(el, Object.assign(new Event(type, { bubbles: true }), { animationName }));
}

describe('LaunchScreen', () => {
  it('fades in at most 200 ms, ends by 1 s, and only continues a young start screen', () => {
    expect(launchTiming.fadeMs).toBeLessThanOrEqual(200);
    expect(launchTiming.hardLimitMs).toBe(1000);
    expect(launchTiming.continueUntilMs + launchTiming.fadeMs + 50).toBeLessThanOrEqual(launchTiming.hardLimitMs);
  });

  it('never takes input and fades with the same duration as launchTiming.fadeMs (brand.css)', () => {
    const rule = /\.lm-launch \{([^}]*)\}/.exec(brandCss)?.[1] ?? '';
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(brandCss).toMatch(new RegExp(`animation: lm-launch-fade ${launchTiming.fadeMs}ms`));
  });

  it('always renders its children, immediately, with or without the overlay', () => {
    now = 300;
    withStartScreen();
    render(
      <LaunchScreen>
        <button type="button">app</button>
      </LaunchScreen>,
    );
    expect(screen.getByRole('button', { name: 'app' })).toBeInTheDocument();
    expect(overlay()).not.toBeNull();
    expect(overlay()).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders nothing when the page had no start screen (a warm render)', () => {
    now = 100;
    expect(hadStartScreen()).toBe(false);
    render(<LaunchScreen />);
    expect(overlay()).toBeNull();
  });

  it('renders nothing when the start screen has already finished (elapsed ≥ the threshold)', () => {
    now = launchTiming.continueUntilMs;
    withStartScreen();
    render(<LaunchScreen />);
    expect(overlay()).toBeNull();
  });

  it('renders nothing under reduced motion', () => {
    now = 200;
    withStartScreen();
    document.documentElement.setAttribute('data-motion', 'reduce');
    render(<LaunchScreen />);
    expect(overlay()).toBeNull();
  });

  it('renders nothing in a background tab (throttled timers could outlive the 1 s limit)', () => {
    now = 200;
    withStartScreen();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<LaunchScreen />);
    expect(overlay()).toBeNull();
  });

  it('carries the same 88 px mark on with the animation shifted back by the elapsed time', () => {
    now = 230;
    withStartScreen();
    render(<LaunchScreen />);
    const el = overlay() as HTMLElement;
    expect(el.style.getPropertyValue('--lm-ringmark-t0')).toBe('-230ms');
    const svg = el.querySelector('svg.lm-ringmark')!;
    expect(svg).toHaveAttribute('width', String(launchTiming.markPx));
    expect(svg).toHaveAttribute('data-cut', 'standard');
    expect(svg).toHaveAttribute('data-animate', 'true');
  });

  it('app ready at 100 ms: the overlay starts leaving at once and is gone by about 300 ms', () => {
    now = 100;
    withStartScreen();
    render(
      <LaunchScreen>
        <p>app</p>
      </LaunchScreen>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(document.querySelectorAll('.lm-launch')).toHaveLength(1);
    expect(overlay()).toHaveAttribute('data-phase', 'fade');
    act(() => {
      now = 100 + launchTiming.fadeMs + 49;
      vi.advanceTimersByTime(launchTiming.fadeMs + 49);
    });
    expect(overlay()).not.toBeNull();
    act(() => {
      now = 300;
      vi.advanceTimersByTime(1);
    });
    expect(overlay()).toBeNull();
  });

  it('unmounts as soon as the fade animation ends', () => {
    now = 120;
    withStartScreen();
    render(<LaunchScreen />);
    animationEnd(overlay()!, 'lm-ringmark-draw');
    expect(overlay()).not.toBeNull();
    animationEnd(overlay()!, 'lm-launch-fade');
    expect(overlay()).toBeNull();
  });

  it('app ready late (just inside the window): still gone well before the 1 s cap', () => {
    now = launchTiming.continueUntilMs - 1;
    withStartScreen();
    render(<LaunchScreen />);
    expect(overlay()).toHaveAttribute('data-phase', 'fade');
    act(() => {
      now = launchTiming.continueUntilMs - 1 + launchTiming.fadeMs + 50;
      vi.advanceTimersByTime(launchTiming.fadeMs + 50);
    });
    expect(overlay()).toBeNull();
    expect(now).toBeLessThanOrEqual(launchTiming.hardLimitMs);
  });

  it('is gone by the hard limit whatever happens (a late first effect)', () => {
    now = 500;
    withStartScreen();
    const { rerender } = render(<LaunchScreen />);
    expect(overlay()).not.toBeNull();
    // the timers start from when the effect ran; with the clock already at 950 ms only 50 ms remain
    now = 950;
    rerender(<LaunchScreen key="again" />);
    act(() => {
      now = launchTiming.hardLimitMs;
      vi.advanceTimersByTime(launchTiming.hardLimitMs - 950);
    });
    expect(overlay()).toBeNull();
  });

  it('renders nothing when the app is ready before the start screen was ever painted', () => {
    now = 40;
    withStartScreen();
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ring.setAttribute('class', 'vitals-launch__ring');
    startScreen!.append(ring);
    const draw = { pending: true } as Animation;
    Object.defineProperty(ring, 'getAnimations', { value: () => [draw] });
    expect(startScreenPainted()).toBe(false);
    render(<LaunchScreen />);
    expect(overlay()).toBeNull();
    // once a frame has rendered it, the start screen counts as seen
    (draw as { pending: boolean }).pending = false;
    expect(startScreenPainted()).toBe(true);
  });

  it('counts the start screen as painted where it cannot tell (no Web Animations API, or a still mark)', () => {
    withStartScreen();
    expect(startScreenPainted()).toBe(true);
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ring.setAttribute('class', 'vitals-launch__ring');
    startScreen!.append(ring);
    Object.defineProperty(ring, 'getAnimations', { value: () => [] });
    expect(startScreenPainted()).toBe(true);
  });
});
