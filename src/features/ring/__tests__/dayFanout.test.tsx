/**
 * r087 C3: the Ring's own fan-outs. Scores asked for 14 to 31 days of baselines at once (about 1.8 s each on the server)
 * and the training load for every activity day's timeline in one unbounded batch, both again with every import. They now
 * read the shared per-day stores: two requests at a time with the newest day first, a day asked once however many cards
 * want it, only today and yesterday asked again when new data is announced, and the score history filling in day by day.
 */
import './clock';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import { baselineDays, baselinesSignature, useVitalsIndexHistory, vitalsIndexHistory, type VitalsIndexHistory } from '../history';
import { useTimelines } from '../load';
import { calendarDate, shiftDate } from '../model';
import { useDayAnswers } from '../useDayAnswers';
import type { RingApi } from '../types';

const today = calendarDate(Date.now());
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => shiftDate(today, i - (n - 1)));

/** The fixture client, counting each day asked and how many reads run at once. */
function counting() {
  const base = makeGaugeFixture();
  const timelines: string[] = [];
  const baselines: string[] = [];
  let running = 0;
  let most = 0;
  const slow = async <T,>(v: Promise<T>): Promise<T> => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 1));
    running--;
    return v;
  };
  const api: RingApi = {
    ...base,
    timeline: (d) => {
      timelines.push(d);
      return slow(base.timeline!(d));
    },
    baselines: (d) => {
      baselines.push(d);
      return slow(base.baselines!(d));
    },
  };
  return { api, timelines, baselines, most: () => most };
}

afterEach(() => {
  cleanup();
  setGaugeApi(null);
});

describe('C3: the training load’s timelines', () => {
  it('20 activity days: each asked once, two at a time, the newest first; two cards share them', async () => {
    const c = counting();
    setGaugeApi(c.api);
    const dates = lastDays(20);
    const load = renderHook(() => useTimelines(dates, today));
    const workout = renderHook(() => useTimelines(dates.slice(-2), today));
    // null while any day is missing: a load from part of its minutes would be a wrong figure
    expect(load.result.current).toBeNull();
    await waitFor(() => expect(load.result.current).not.toBeNull());
    expect(workout.result.current).not.toBeNull();
    expect(c.timelines).toHaveLength(20);
    expect(c.most()).toBe(2);
    expect(c.timelines.slice(0, 2)).toEqual([today, shiftDate(today, -1)]);
    expect([...load.result.current!.keys()]).toEqual(dates);
    expect(workout.result.current!.get(today)).toBe(load.result.current!.get(today));
  });

  it('new data asks for today and yesterday only, and a card whose days did not change keeps its map', async () => {
    const c = counting();
    setGaugeApi(c.api);
    const dates = lastDays(20);
    const load = renderHook(() => useTimelines(dates, today));
    const old = renderHook(() => useTimelines(dates.slice(0, 5), today));
    await waitFor(() => expect(load.result.current).not.toBeNull());
    const before = old.result.current;
    c.timelines.length = 0;
    await act(async () => notifyGaugeDataChanged());
    await waitFor(() => expect(c.timelines).toHaveLength(2));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect([...c.timelines].sort()).toEqual([shiftDate(today, -1), today]);
    expect(old.result.current).toBe(before);
  });
});

describe('C3: the score history’s baselines', () => {
  it('a month of days: two requests at a time, the newest first, filling in as they arrive', async () => {
    const c = counting();
    setGaugeApi(c.api);
    const dates = lastDays(31);
    const sizes = new Set<number>();
    const h = renderHook(() => {
      const held = useDayAnswers(baselineDays, dates, today);
      sizes.add(held.size);
      return held;
    });
    await waitFor(() => expect(h.result.current.size).toBe(31));
    expect(c.baselines).toHaveLength(31);
    expect(c.most()).toBe(2);
    expect(c.baselines.slice(0, 2)).toEqual([today, shiftDate(today, -1)]);
    // the screen saw the days arrive, not one answer for the month
    expect(sizes.size).toBeGreaterThan(3);
    // a second chart of the same days asks nothing
    const again = renderHook(() => useDayAnswers(baselineDays, dates.slice(-14), today));
    expect(again.result.current.size).toBe(14);
    expect(c.baselines).toHaveLength(31);
  });

  // the review's finding: the Scores period showed the average of the two, four, six newest days under the whole
  // period's dates while the baselines arrived
  it('a period is answered once every day is in; the day view’s trend line fills in', async () => {
    const base = makeGaugeFixture();
    // slow enough for the nights and steps to be in long before the last baselines
    const api: RingApi = { ...base, baselines: async (d) => (await new Promise((r) => setTimeout(r, 15)), base.baselines!(d)) };
    setGaugeApi(api);
    const goals = { stepGoal: 10_000, sleepGoalMin: 480 };
    const seen = { trend: [] as VitalsIndexHistory[], period: [] as VitalsIndexHistory[] };
    const trend = renderHook(() => {
      const h = useVitalsIndexHistory(today, goals);
      if (h) seen.trend.push(h);
      return h;
    });
    const period = renderHook(() => {
      const h = useVitalsIndexHistory(today, goals, 10);
      if (h) seen.period.push(h);
      return h;
    });
    await waitFor(() => expect(trend.result.current && !trend.result.current.pending).toBe(true), { timeout: 5_000 });
    await waitFor(() => expect(period.result.current).not.toBeNull());
    // the line was drawn with days still waiting, and said how many
    expect(seen.trend.some((h) => (h.pending ?? 0) > 0)).toBe(true);
    // the period never answered with a day missing: its average is over all of its days or not shown
    expect(seen.period.length).toBeGreaterThan(0);
    expect(seen.period.every((h) => !h.pending && h.dates.length === 10)).toBe(true);
    // the same days give the same figures either way
    expect(period.result.current!.sleep).toEqual(trend.result.current!.sleep.slice(-10));
    // a caller that reads `pending` itself may ask for the days as they come
    const filling = renderHook(() => useVitalsIndexHistory(shiftDate(today, -20), goals, 10, { fill: true }));
    await waitFor(() => expect(filling.result.current).not.toBeNull());
    expect(filling.result.current!.pending).toBeGreaterThan(0);
  });

  it('an answer that differs only in when the phone last uploaded is the same answer (no re-read chain, no redraw)', async () => {
    const api = makeGaugeFixture();
    const b = (await api.baselines!(today))!;
    const later = { ...b, freshness: { ...b.freshness, minutesSinceLastUpload: 99, minutesSinceLastReading: 99 }, installations: [] };
    expect(baselinesSignature(later)).toBe(baselinesSignature(b));
    expect(baselinesSignature({ ...b, learning: { ...b.learning, nights: b.learning.nights + 1 }, inputsHash: undefined })).not.toBe(baselinesSignature({ ...b, inputsHash: undefined }));
    expect(baselinesSignature({ ...later, inputsHash: 'h1' })).toBe('h1');
  });

  it('a day whose baselines have not arrived is a gap; once they arrive it is the figure the whole window gave', async () => {
    const api = makeGaugeFixture();
    const dates = lastDays(4);
    const sl = (await api.sleep(dates[0]!, today))!;
    const bases = await Promise.all(dates.map((d) => api.baselines!(d)));
    const input = { dates, sleep: sl.sessions, steps: new Map(dates.map((d) => [d, 8000])), stepGoal: 10_000, sleepGoalMin: 480 };
    const whole = vitalsIndexHistory({ ...input, baselines: bases });
    const partial = vitalsIndexHistory({ ...input, baselines: [undefined, undefined, bases[2], bases[3]] });
    expect(partial.sleep.slice(0, 2).every((v) => Number.isNaN(v))).toBe(true);
    expect(partial.recovery.slice(0, 2).every((v) => Number.isNaN(v))).toBe(true);
    expect(partial.sleep.slice(2)).toEqual(whole.sleep.slice(2));
    expect(partial.recovery.slice(2)).toEqual(whole.recovery.slice(2));
    expect(partial.day.slice(2)).toEqual(whole.day.slice(2));
    // a day the server could not answer (null) is still worked out without baselines, as before
    const failed = vitalsIndexHistory({ ...input, baselines: dates.map(() => null) });
    expect(failed.sleep.some((v) => Number.isFinite(v))).toBe(true);
  });
});
