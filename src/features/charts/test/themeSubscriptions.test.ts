import { getThemeSnapshot, subscribeTheme, type ChartTheme } from '../core/theme';

it('publishes one shared theme snapshot to every chart on a motion preference change', async () => {
  vi.useFakeTimers();
  const seen: ChartTheme[] = [];
  const stops = Array.from({ length: 12 }, () => subscribeTheme(() => seen.push(getThemeSnapshot())));
  getThemeSnapshot();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(50);
  seen.length = 0;
  const read = vi.spyOn(window, 'getComputedStyle');
  try {
    document.documentElement.dataset.motion = 'reduce';
    document.documentElement.style.setProperty('--lm-dur-slow', '0ms');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]!.reducedMotion).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    stops.forEach((stop) => stop());
    delete document.documentElement.dataset.motion;
    document.documentElement.style.removeProperty('--lm-dur-slow');
    read.mockRestore();
    vi.useRealTimers();
  }
});
