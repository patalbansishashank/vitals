import { act, render, screen } from '@testing-library/react';
import { hadStartScreen, LaunchScreen, launchTiming } from '../LaunchScreen';

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

describe('LaunchScreen', () => {
  it('shares its timing with the CSS: dot done at 640 ms, gone by 1 s', () => {
    expect(launchTiming.drawnMs).toBe(640);
    expect(launchTiming.drawnMs + launchTiming.fadeMs).toBeLessThanOrEqual(1000);
    expect(launchTiming.hardLimitMs).toBe(1000);
    expect(launchTiming.continueUntilMs).toBeLessThan(launchTiming.drawnMs);
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

  it('early: draws the same 88 px mark with the animation shifted back by the elapsed time', () => {
    now = 230;
    withStartScreen();
    render(<LaunchScreen />);
    const el = overlay() as HTMLElement;
    expect(el).toHaveAttribute('data-phase', 'draw');
    expect(el.style.getPropertyValue('--lm-ringmark-t0')).toBe('-230ms');
    const svg = el.querySelector('svg.lm-ringmark')!;
    expect(svg).toHaveAttribute('width', String(launchTiming.markPx));
    expect(svg).toHaveAttribute('data-cut', 'standard');
    expect(svg).toHaveAttribute('data-animate', 'true');
  });

  it('fades once the dot has popped, then unmounts', () => {
    now = 100;
    withStartScreen();
    render(<LaunchScreen />);
    act(() => {
      now = launchTiming.drawnMs - 1;
      vi.advanceTimersByTime(launchTiming.drawnMs - 101);
    });
    expect(overlay()).toHaveAttribute('data-phase', 'draw');
    act(() => {
      now = launchTiming.drawnMs;
      vi.advanceTimersByTime(1);
    });
    expect(overlay()).toHaveAttribute('data-phase', 'fade');
    act(() => {
      now = launchTiming.drawnMs + launchTiming.fadeMs + 50;
      vi.advanceTimersByTime(launchTiming.fadeMs + 50);
    });
    expect(overlay()).toBeNull();
  });

  it('is gone by the hard limit whatever happens', () => {
    now = 500;
    withStartScreen();
    render(<LaunchScreen />);
    expect(overlay()).not.toBeNull();
    act(() => {
      now = launchTiming.hardLimitMs;
      vi.advanceTimersByTime(launchTiming.hardLimitMs - 500);
    });
    expect(overlay()).toBeNull();
  });
});
