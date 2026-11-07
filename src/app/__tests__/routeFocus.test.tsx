import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { useRouteFocus } from '../shell/useRouteFocus';

function Page({ path, title, tick = 0 }: { path: string; title: string | null; tick?: number }) {
  const main = useRef<HTMLElement>(null);
  useRouteFocus(main, null, path);
  return (
    <main ref={main} tabIndex={-1}>
      {title && <h1>{title}</h1>}
      <button>Edit</button>
      <span>{tick}</span>
    </main>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const frame = () => act(() => vi.advanceTimersByTime(20));

describe('route title focus', () => {
  it('preserves focus on initial entry and focuses a committed new title in one frame', () => {
    const { rerender } = render(<Page path="/today" title="Today" />);
    expect(document.activeElement).toBe(document.body);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    rerender(<Page path="/settings" title="Settings" />);
    frame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Settings' }));
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('waits without frame polling for a lazy title, then focuses it when it arrives', async () => {
    const { rerender } = render(<Page path="/today" title="Today" />);
    rerender(<Page path="/body" title="Today" />);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    frame();
    act(() => vi.advanceTimersByTime(400));
    expect(document.activeElement).toBe(document.body);
    expect(raf).not.toHaveBeenCalled();
    rerender(<Page path="/body" title="Today" tick={1} />);
    await act(async () => {});
    frame();
    expect(raf).not.toHaveBeenCalled(); // Unrelated count-up/chart text is not a title arrival.
    rerender(<Page path="/body" title="Your body" />);
    await act(async () => {}); // MutationObserver delivers the new title.
    frame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your body' }));
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('tracks a lazy replacement of the initial heading before the next navigation', async () => {
    const { rerender } = render(<Page path="/today" title="Loading" />);
    rerender(<Page path="/today" title="Today" />);
    await act(async () => {});
    rerender(<Page path="/body" title="Today" />);
    frame();
    expect(document.activeElement).toBe(document.body);
    rerender(<Page path="/body" title="Your body" />);
    await act(async () => {});
    frame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your body' }));
  });

  it('keeps newer page or overlay focus while the lazy title is pending', async () => {
    const { rerender } = render(<Page path="/today" title="Today" />);
    rerender(<Page path="/body" title="Today" />);
    screen.getByRole('button').focus();
    frame();
    rerender(<Page path="/body" title="Your body" />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1500));
    expect(document.activeElement).toBe(screen.getByRole('button'));
  });

  it('falls back after one second for a route with no title, and cancels a pending route on navigation', () => {
    const { rerender } = render(<Page path="/today" title="Today" />);
    rerender(<Page path="/missing-title" title={null} />);
    frame();
    act(() => vi.advanceTimersByTime(1000));
    expect(document.activeElement).toBe(screen.getByRole('main'));
    rerender(<Page path="/pending" title={null} />);
    rerender(<Page path="/settings" title="Settings" />);
    frame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Settings' }));
    act(() => vi.advanceTimersByTime(1500));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Settings' }));
  });
});
