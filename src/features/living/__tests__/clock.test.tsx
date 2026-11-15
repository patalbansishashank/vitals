import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { clockToday, fixedClock, LivingClockContext, systemClock, useLivingClock, useToday, type LivingClock } from '../clock';
import { useSettingsStore } from '@/state/settingsStore';

/** A clock the test moves by hand; the hooks only notice when something makes them look again. */
function movableClock(localWall: string): LivingClock & { set(localWall: string): void } {
  let at = new Date(localWall).getTime();
  return {
    now: () => new Date(at),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    rolloverH: 4,
    set(w: string) {
      at = new Date(w).getTime();
    },
  };
}

const withClock = (clock: LivingClock) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <LivingClockContext.Provider value={clock}>{children}</LivingClockContext.Provider>;
  };

function setRollover(h: number | undefined): void {
  // the setting is read the way the command bus reads it (`rolloverOf` over the settings values)
  useSettingsStore.setState({ dayRolloverH: h } as never);
}

afterEach(() => {
  cleanup(); // unmount before resetting the setting, which would otherwise re-render a mounted reader
  setRollover(undefined);
  vi.useRealTimers();
});

describe('useToday', () => {
  it('keeps working with an injected fixed clock', () => {
    const { result } = renderHook(() => useToday(), { wrapper: withClock(fixedClock('2026-10-01T13:00:00')) });
    expect(result.current).toBe('2026-10-01');
  });

  it('is still yesterday before the rollover hour', () => {
    const { result } = renderHook(() => useToday(), { wrapper: withClock(fixedClock('2026-10-02T03:30:00')) });
    expect(result.current).toBe('2026-10-01');
  });

  it('moves to the new day on the minute tick, with no remount', () => {
    vi.useFakeTimers();
    const clock = movableClock('2026-10-02T03:59:30');
    const { result } = renderHook(() => useToday(), { wrapper: withClock(clock) });
    expect(result.current).toBe('2026-10-01');
    clock.set('2026-10-02T04:00:10');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-02');
  });

  it('re-renders only when the date changes', () => {
    vi.useFakeTimers();
    const clock = movableClock('2026-10-01T22:00:00');
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders++;
        return useToday();
      },
      { wrapper: withClock(clock) },
    );
    const first = renders;
    for (let m = 1; m <= 30; m++) {
      clock.set(`2026-10-01T22:${String(m).padStart(2, '0')}:00`);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    }
    expect(renders).toBe(first);
    clock.set('2026-10-02T05:00:00');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-02');
    expect(renders).toBe(first + 1);
  });

  it.each([
    ['the page is shown again', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['the Android app resumes', () => document.dispatchEvent(new Event('resume'))],
    ['the window gets focus', () => window.dispatchEvent(new Event('focus'))],
  ])('re-checks the day at once when %s', (_label, fire) => {
    vi.useFakeTimers();
    const clock = movableClock('2026-10-01T23:00:00');
    const { result } = renderHook(() => useToday(), { wrapper: withClock(clock) });
    // the phone slept through the night: the minute timer never ran
    clock.set('2026-10-02T07:15:00');
    act(() => {
      fire();
    });
    expect(result.current).toBe('2026-10-02');
  });

  it('stops ticking once nothing reads the day', () => {
    vi.useFakeTimers();
    const a = renderHook(() => useToday(), { wrapper: withClock(fixedClock('2026-10-01T13:00:00')) });
    const b = renderHook(() => useToday(), { wrapper: withClock(fixedClock('2026-10-01T13:00:00')) });
    expect(vi.getTimerCount()).toBe(1);
    a.unmount();
    expect(vi.getTimerCount()).toBe(1);
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useLivingClock', () => {
  it('re-renders its caller when the day changes, so what it derives at render catches up', () => {
    vi.useFakeTimers();
    const clock = movableClock('2026-10-02T03:59:00');
    const { result } = renderHook(() => clockToday(useLivingClock()), { wrapper: withClock(clock) });
    expect(result.current).toBe('2026-10-01');
    clock.set('2026-10-02T04:01:00');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-02');
  });
});

describe('the device clock', () => {
  it("uses the person's day rollover setting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T05:00:00'));
    expect(clockToday(systemClock)).toBe('2026-10-02');
    setRollover(6);
    expect(systemClock.rolloverH).toBe(6);
    expect(clockToday(systemClock)).toBe('2026-10-01');
  });

  it('falls back to 04:00 when the setting is missing or out of range', () => {
    setRollover(undefined);
    expect(systemClock.rolloverH).toBe(4);
    setRollover(30);
    expect(systemClock.rolloverH).toBe(4);
  });

  it('moves today when the rollover setting changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T05:00:00'));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-02');
    act(() => {
      setRollover(6);
    });
    expect(result.current).toBe('2026-10-01');
  });

  it('resolves the zone once a minute, not on every read, and again when the page comes back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00'));
    const Real = Intl.DateTimeFormat;
    let zone = 'Asia/Kolkata';
    let lookups = 0;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      if (args.length > 0) return new Real(...args);
      lookups++;
      return { resolvedOptions: () => ({ timeZone: zone }) } as Intl.DateTimeFormat;
    } as typeof Intl.DateTimeFormat);
    const dropCachedZone = () => {
      const r = renderHook(() => useToday());
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      r.unmount();
    };
    try {
      dropCachedZone(); // whatever an earlier test cached
      const { unmount } = renderHook(() => useToday());
      const before = lookups;
      for (let i = 0; i < 20; i++) expect(systemClock.tz).toBe('Asia/Kolkata');
      expect(lookups - before).toBe(0);
      zone = 'Europe/Berlin';
      act(() => {
        document.dispatchEvent(new Event('resume'));
      });
      expect(systemClock.tz).toBe('Europe/Berlin');
      unmount();
      // with nothing mounted the cache still expires after a minute
      zone = 'America/New_York';
      vi.setSystemTime(new Date('2026-10-02T12:01:30'));
      expect(systemClock.tz).toBe('America/New_York');
    } finally {
      spy.mockRestore();
      dropCachedZone(); // later tests read the real zone
    }
  });

  it('moves today on the minute tick past midnight and the rollover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T03:59:30'));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-01');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-02');
  });
});
