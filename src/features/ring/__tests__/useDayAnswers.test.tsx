/**
 * r087 seam: a mounted card whose day was being read when new data was announced. The read's answer may predate the
 * announcement, so the store calls for the day again when it lands and the card asks once more, with no navigation,
 * hide/show or second announcement.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDayStore } from '@/features/living/progress/data/dayStore';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import { calendarDate } from '../model';
import { useDayAnswers } from '../useDayAnswers';

afterEach(() => cleanup());

describe('useDayAnswers: new data announced while a day is being read', () => {
  it('the card asks once more when that read lands, and shows the newer answer', async () => {
    const today = calendarDate(Date.now());
    const asked: string[] = [];
    const store = createDayStore<{ v: number }>({ read: async () => null, signature: (d) => String(d.v) });
    store.setSource(async (date) => {
      asked.push(date);
      const v = asked.length;
      await new Promise((r) => setTimeout(r, 5));
      return { v };
    });
    const dates = [today];
    const card = renderHook(() => useDayAnswers(store, dates, today));
    await waitFor(() => expect(asked).toHaveLength(1));
    // the upload reaches the server while the first read is with it
    await act(async () => notifyGaugeDataChanged());
    await waitFor(() => expect(card.result.current.get(today)).toEqual({ v: 2 }));
    // one extra read for the announcement, no more
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    expect(asked).toEqual([today, today]);
  });
});
