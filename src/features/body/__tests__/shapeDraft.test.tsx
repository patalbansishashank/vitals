/** Shape sliders: nothing is written while a thumb is down; one write on release; key steps wait 150 ms; the final value wins. */
import { act, renderHook } from '@testing-library/react';
import { useBodyValues } from '@/state/profileStore';
import type * as Commands from '../commands';
import { deriveFigure } from '../figure';
import { summarizeBody } from '../model';
import {
  PREVIEW_MAX_INTERVAL_MS,
  STEP_COMMIT_MS,
  commitShape,
  dragShape,
  flushShapeCommits,
  resetShapeDraft,
  stats,
  useDraftView,
  useLiveShape,
} from '../shapeDraft';

const patch = vi.hoisted(() => vi.fn((_update: unknown) => Promise.resolve({ ok: true })));
vi.mock('../commands', async (importOriginal) => ({
  ...(await importOriginal<typeof Commands>()),
  patchProfileAsync: patch,
  patchProfile: (u: unknown) => void patch(u),
}));

// Everything here runs on one fake clock that starts at 0 for every test: the draft module keeps no time (or draft)
// from the test before (`resetShapeDraft`), and the profile store is only read, never written, so the file does not
// depend on the document store, on its neighbours, or on how loaded the machine is.
beforeEach(() => {
  vi.useFakeTimers({
    now: 0,
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  patch.mockClear();
  resetShapeDraft();
  stats.setCost(0); // a cheap figure update unless a test says otherwise
});
afterEach(() => {
  resetShapeDraft();
  vi.useRealTimers();
});

/** Let the write's `.finally` run. */
const settle = () => act(async () => void (await Promise.resolve()));

describe('shape slider drafts', () => {
  it('a drag writes nothing, and the moving slider follows every input at once', () => {
    const { result } = renderHook(() => useLiveShape('bodyFatPct'));
    expect(result.current).toBeUndefined();
    act(() => {
      for (let x = 20; x <= 30; x += 0.5) dragShape('bodyFatPct', x);
    });
    expect(result.current).toBe(30);
    act(() => void vi.advanceTimersByTime(500));
    expect(patch).not.toHaveBeenCalled();
  });

  it('feeds the figure at most once per frame, however many inputs arrive', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      const v = useBodyValues();
      return useDraftView(v, deriveFigure(v, summarizeBody(v)));
    });
    const before = renders;
    act(() => {
      for (let i = 0; i < 60; i++) dragShape('muscleUpper', 0.3 + i / 200);
    });
    expect(renders).toBe(before); // nothing yet: the figure waits for the frame
    act(() => void vi.advanceTimersByTime(20));
    expect(renders).toBeLessThanOrEqual(before + 2);
    expect(result.current.shown.muscleUpper).toBeCloseTo(0.3 + 59 / 200, 3); // the last input, not an old one
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([100, 400])(
    'keeps the first continuous drag progressing at a measured cost of %s ms',
    (measuredCost) => {
      stats.setCost(measuredCost);
      const { result } = renderHook(() => {
        const v = useBodyValues();
        return useDraftView(v, deriveFigure(v, summarizeBody(v)));
      });
      const before = stats.publishes;
      act(() => dragShape('bodyFatPct', 20));
      act(() => void vi.advanceTimersByTime(20));
      expect(stats.publishes).toBe(before + 1);
      expect(result.current.shown.bodyFatPct).toBe(20);
      for (let i = 1; i <= 40; i++) {
        act(() => {
          stats.setCost(measuredCost);
          dragShape('bodyFatPct', 20 + i / 4);
          vi.advanceTimersByTime(50);
        });
      }
      expect(stats.publishes - before).toBeGreaterThanOrEqual(24);
      expect(result.current.shown.bodyFatPct).toBeGreaterThan(29);
      act(() => void vi.advanceTimersByTime(PREVIEW_MAX_INTERVAL_MS + 20));
      expect(result.current.shown.bodyFatPct).toBe(30);
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it('a pointer release writes once, with the final value, and then drops the draft', async () => {
    const { result } = renderHook(() => useLiveShape('belly'));
    const done = vi.fn();
    act(() => {
      dragShape('belly', 0.1);
      dragShape('belly', 0.35);
      dragShape('belly', 0.4);
    });
    expect(patch).not.toHaveBeenCalled();
    act(() => commitShape('belly', 0.4, 'drag', done));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ shape: { belly: 0.4 } });
    expect(result.current).toBe(0.4); // held until the write has landed: nothing snaps back in between
    await settle();
    expect(result.current).toBeUndefined();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('key steps are written once, 150 ms after the last one, with the last value', async () => {
    const { result } = renderHook(() => useLiveShape('bodyFatPct'));
    const done = vi.fn();
    act(() => {
      commitShape('bodyFatPct', 21, 'step', done);
      vi.advanceTimersByTime(60);
      commitShape('bodyFatPct', 22, 'step', done);
      vi.advanceTimersByTime(60);
      commitShape('bodyFatPct', 23, 'step', done);
    });
    expect(result.current).toBe(23); // the thumb is already there
    act(() => void vi.advanceTimersByTime(STEP_COMMIT_MS - 1));
    expect(patch).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ shape: { bodyFatPct: 23 } });
    await settle();
    expect(result.current).toBeUndefined();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('writes a waiting key step at once when the card goes away', () => {
    act(() => commitShape('muscleLower', 0.6, 'step'));
    expect(patch).not.toHaveBeenCalled();
    act(() => flushShapeCommits());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ shape: { muscleLower: 0.6 } });
    act(() => void vi.advanceTimersByTime(500));
    expect(patch).toHaveBeenCalledTimes(1); // and the timer does not write it again
  });

  it('a new drag begun while a write is in flight keeps its own value', async () => {
    const { result } = renderHook(() => useLiveShape('hips'));
    act(() => commitShape('hips', 0.2, 'drag'));
    act(() => dragShape('hips', 0.5)); // the next gesture starts before the first write resolves
    await settle();
    expect(result.current).toBe(0.5);
  });

  it('Reset drops waiting steps and drafts without writing', () => {
    const { result } = renderHook(() => useLiveShape('arms'));
    act(() => commitShape('arms', 0.7, 'step'));
    act(() => resetShapeDraft());
    expect(result.current).toBeUndefined();
    act(() => void vi.advanceTimersByTime(500));
    expect(patch).not.toHaveBeenCalled();
  });
});
