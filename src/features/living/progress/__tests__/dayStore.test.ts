/**
 * r087 C3: the per-day answers every screen shares. The probe was one screen asking `/v1/gauge/timeline` about 55 times in
 * a row (8 weeks of Heart Points, six at a time), again on every data notification, every 5 minutes and when the
 * 30-minute keep times ran out. Now: two requests at a time with the newest day first, each day once however many
 * readers want it, only today and yesterday asked again when new data is announced, an older day kept for hours and then
 * asked again a couple at a time, and a day without an answer not asked again every minute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGaugeApi } from '@/features/ring/api';
import type { RingApi } from '@/features/ring/types';
import { addDays } from '@/living/dates';
import type { GaugeTimeline } from '@/net/gauge';
import { createGaugeApi } from '@/net/gauge';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import { DAY_LAZY_GAP_MS, DAY_PAST_TTL_MS, DAY_READS_IN_FLIGHT, DAY_RECENT_TTL_MS, DAY_RETRY_MAX_MS, createDayStore } from '../data/dayStore';
import { onTimelinesChanged, timelineDays, timelinesFor } from '../data/timelines';

const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
/** Noon of TODAY on this device (the store dates "new data" by the device's calendar). */
const T0 = new Date(2026, 9, 21, 12).getTime();
const WEEKS8 = Array.from({ length: 56 }, (_, i) => addDays(TODAY, i - 55));

interface Day {
  date: string;
  v: number;
}

/** A store over a source that counts what is asked and how many reads run at once. */
function harness(answer: (date: string, nth: number) => Day | null = (date) => ({ date, v: 1 })) {
  const asked: string[] = [];
  const seen = new Map<string, number>();
  let running = 0;
  let most = 0;
  const store = createDayStore<Day>({ read: async () => null, signature: (d) => String(d.v) });
  store.setSource(async (date) => {
    asked.push(date);
    const nth = (seen.get(date) ?? 0) + 1;
    seen.set(date, nth);
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 0));
    running--;
    return answer(date, nth);
  });
  return { store, asked, most: () => most };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  setGaugeApi(null);
});

describe('C3: a window of days is never a burst of requests', () => {
  it('8 weeks: two requests at a time, the newest day first, each day once', async () => {
    const h = harness();
    const days = await h.store.load(WEEKS8, TODAY, T0);
    expect(days.size).toBe(56);
    expect([...days.values()].every((d) => d !== null)).toBe(true);
    expect(h.asked).toHaveLength(56);
    expect(h.most()).toBe(DAY_READS_IN_FLIGHT);
    // what is on screen first is asked first
    expect(h.asked.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(TODAY, -i)));
  });

  it('readers of the same day share one request and one answer', async () => {
    const h = harness();
    const [card, progress, widget] = await Promise.all([h.store.load([Y, TODAY], TODAY, T0), h.store.load(WEEKS8, TODAY, T0), h.store.load([TODAY], TODAY, T0)]);
    expect(h.asked).toHaveLength(56);
    expect(card.get(TODAY)).toBe(progress.get(TODAY));
    expect(widget.get(TODAY)).toBe(progress.get(TODAY));
    // a week asked later than the long window still goes ahead of the window's older days
    const order = harness();
    const long = order.store.load(WEEKS8, TODAY, T0);
    await order.store.load([TODAY, Y], TODAY, T0);
    expect(order.asked.length).toBeLessThan(6);
    await long;
  });

  it('this week goes first; behind it the readers take turns, so one older day does not wait for another reader\'s long window', async () => {
    const h = harness();
    const old = addDays(TODAY, -70);
    const long = h.store.load(WEEKS8, TODAY, T0, 'progress');
    await h.store.load([old], TODAY, T0, 'workout');
    // the week on screen first, whoever asked; then the reader that has had no turn yet
    expect(h.asked.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(TODAY, -i)));
    expect(h.asked[7]).toBe(old);
    await long;
    expect(h.asked).toHaveLength(57);
    expect(h.most()).toBe(DAY_READS_IN_FLIGHT);
    // a reader that joins a day already waiting takes its turn with it
    const joined = harness();
    const window = joined.store.load(WEEKS8, TODAY, T0, 'progress');
    await joined.store.load([addDays(TODAY, -40)], TODAY, T0, 'workout');
    expect(joined.asked[7]).toBe(addDays(TODAY, -40));
    expect(joined.asked.length).toBeLessThan(12);
    await window;
    expect(joined.asked).toHaveLength(56);
  });

  it('a date after the reader\'s today is unknown to it, also when a reader with a later today had it read', async () => {
    const h = harness();
    const next = addDays(TODAY, 1);
    // the Ring reads by the calendar date, a day ahead of the app's day between midnight and the rollover
    expect((await h.store.load([next], next, T0)).get(next)).toEqual({ date: next, v: 1 });
    const days = await h.store.load([TODAY, next], TODAY, T0);
    expect(days.get(TODAY)).toEqual({ date: TODAY, v: 1 });
    expect(days.get(next)).toBeNull();
    expect(h.asked).toEqual([next, TODAY]);
  });

  it('new data asks only today and yesterday again; a second announcement while fresh asks nothing more', async () => {
    const h = harness();
    await h.store.load(WEEKS8, TODAY, T0);
    h.asked.length = 0;
    notifyGaugeDataChanged();
    await h.store.load(WEEKS8, TODAY, T0 + 1_000);
    expect([...h.asked].sort()).toEqual([Y, TODAY]);
    await h.store.load(WEEKS8, TODAY, T0 + 2_000);
    expect(h.asked).toHaveLength(2);
  });

  it('an answer that was on its way when new data was announced is asked again', async () => {
    const h = harness();
    const first = h.store.load([TODAY], TODAY, T0);
    notifyGaugeDataChanged();
    await first;
    await h.store.load([TODAY], TODAY, T0 + 1_000);
    expect(h.asked).toEqual([TODAY, TODAY]);
  });

  it('today is asked again after a few minutes, the older days are kept', async () => {
    const h = harness();
    await h.store.load(WEEKS8, TODAY, T0);
    h.asked.length = 0;
    // the 30-minute keep time of before: the whole window was asked again here
    await h.store.load(WEEKS8, TODAY, T0 + 31 * 60_000);
    expect([...h.asked].sort()).toEqual([Y, TODAY]);
  });

  it('an older day past its keep time answers at once and is asked again two at a time, never the window at once', async () => {
    const h = harness();
    await h.store.load(WEEKS8, TODAY, T0);
    h.asked.length = 0;
    const later = T0 + DAY_PAST_TTL_MS + 1;
    const days = await h.store.load(WEEKS8, TODAY, later);
    expect([...days.values()].every((d) => d !== null)).toBe(true);
    // today and yesterday (awaited), and the two newest of the 54 older days behind them
    await vi.waitFor(() => expect(h.asked).toHaveLength(4));
    expect([...h.asked].sort()).toEqual([addDays(TODAY, -3), addDays(TODAY, -2), Y, TODAY]);
    // the same minute: no more; the next minute: the next two
    await h.store.load(WEEKS8, TODAY, later + 30_000);
    expect(h.asked).toHaveLength(4);
    await h.store.load(WEEKS8, TODAY, later + DAY_LAZY_GAP_MS);
    await vi.waitFor(() => expect(h.asked).toHaveLength(6));
    expect(h.asked.slice(4).sort()).toEqual([addDays(TODAY, -5), addDays(TODAY, -4)]);
    expect(h.most()).toBe(DAY_READS_IN_FLIGHT);
  });

  it('visits hours apart go through the window: the days asked again last time are not the first ones again', async () => {
    const h = harness();
    await h.store.load(WEEKS8, TODAY, T0);
    const first = T0 + DAY_PAST_TTL_MS + 1;
    await h.store.load(WEEKS8, TODAY, first);
    await vi.waitFor(() => expect(h.asked).toHaveLength(60));
    h.asked.length = 0;
    // every older day is past its keep time again, the two asked at the last visit among them
    await h.store.load(WEEKS8, TODAY, first + DAY_PAST_TTL_MS + 1);
    await vi.waitFor(() => expect(h.asked).toHaveLength(4));
    expect([...h.asked].sort()).toEqual([addDays(TODAY, -5), addDays(TODAY, -4), Y, TODAY]);
  });

  it('an older day that changed tells its readers, and the next older days follow while they keep changing', async () => {
    // the second read of every day differs from the first (the server worked the days out again)
    const h = harness((date, nth) => ({ date, v: nth }));
    await h.store.load(WEEKS8, TODAY, T0);
    h.asked.length = 0;
    const later = T0 + DAY_PAST_TTL_MS + 1;
    let changes = 0;
    // a reader that reads its window again when told, as Progress does
    h.store.onChange(() => {
      changes++;
      void h.store.load(WEEKS8, TODAY, later);
    });
    await h.store.load(WEEKS8, TODAY, later);
    await vi.waitFor(() => expect(h.asked).toHaveLength(56));
    expect(changes).toBe(56);
    expect(h.most()).toBe(DAY_READS_IN_FLIGHT);
    expect(h.store.peek(addDays(TODAY, -40))).toEqual({ date: addDays(TODAY, -40), v: 2 });
  });

  it('an unchanged re-read keeps the object held and tells nobody', async () => {
    const h = harness();
    const before = (await h.store.load([TODAY], TODAY, T0)).get(TODAY);
    let changes = 0;
    h.store.onChange(() => changes++);
    const after = (await h.store.load([TODAY], TODAY, T0 + DAY_RECENT_TTL_MS)).get(TODAY);
    expect(h.asked).toHaveLength(2);
    expect(after).toBe(before);
    expect(changes).toBe(0);
  });

  it('a day the server cannot answer waits longer after each failure, never a minute at a time', async () => {
    const h = harness(() => null);
    const old = addDays(TODAY, -10);
    const at = async (t: number) => {
      await h.store.load([old], TODAY, t);
      return h.asked.length;
    };
    expect(await at(T0)).toBe(1);
    expect(await at(T0 + 30_000)).toBe(1);
    // the first retry after a minute, then 4, then 16 minutes
    let t = T0 + 60_000;
    expect(await at(t)).toBe(2);
    expect(await at(t + 3 * 60_000)).toBe(2);
    t += 4 * 60_000;
    expect(await at(t)).toBe(3);
    expect(await at(t + 15 * 60_000)).toBe(3);
    t += 16 * 60_000;
    expect(await at(t)).toBe(4);
    // and never longer than the cap
    t += DAY_RETRY_MAX_MS;
    expect(await at(t)).toBe(5);
    expect(await at(t + DAY_RETRY_MAX_MS - 1)).toBe(5);
    expect(await at(t + DAY_RETRY_MAX_MS)).toBe(6);
    expect((await h.store.load([old], TODAY, t)).get(old)).toBeNull();
  });

  it('days dropped while they wait in the queue are not requested', async () => {
    const h = harness();
    const load = h.store.load(WEEKS8, TODAY, T0);
    // the first two are on their way
    await Promise.resolve();
    await Promise.resolve();
    h.store.clear();
    await load;
    expect(h.asked).toHaveLength(DAY_READS_IN_FLIGHT);
    expect(h.store.peek(TODAY)).toBeUndefined();
  });
});

describe('C3: the client is read at background priority, and a saved day shows at once', () => {
  const tl = (date: string, minutes: number) => ({ date, minutes, steps: { selected: [] }, hr: { supportedS: [] } }) as unknown as GaugeTimeline;

  it('asks through withOptions({ priority: "background" }); the saved day answers first, the server replaces it', async () => {
    const options: unknown[] = [];
    let answer!: (t: GaugeTimeline) => void;
    const server = new Promise<GaugeTimeline>((r) => (answer = r));
    const base = { status: () => ({ lastOkAt: null, problem: null }), subscribe: () => () => undefined, clearCache: () => undefined };
    const api = {
      ...base,
      timeline: () => Promise.reject(new Error('read without options')),
      withOptions: (o: unknown) => {
        options.push(o);
        return { ...base, timeline: () => server };
      },
      snapshot: async (load: (a: unknown) => Promise<unknown>) => ({ data: await load({ ...base, timeline: async (d: string) => tl(d, 600) }), savedAt: T0 - 3_600_000 }),
    } as unknown as RingApi;
    setGaugeApi(api);
    let changes = 0;
    const off = onTimelinesChanged(() => changes++);
    // the saved day (600 minutes in) is on screen before the server has answered
    expect((await timelinesFor([TODAY], TODAY, T0)).get(TODAY)!.minutes).toBe(600);
    expect(options).toEqual([{ priority: 'background' }]);
    expect(changes).toBe(0);
    answer(tl(TODAY, 720));
    await vi.waitFor(() => expect(timelineDays.peek(TODAY)!.minutes).toBe(720));
    expect(changes).toBe(1);
    off();
  });

  it('a client without withOptions or snapshot (an older client, a test fake) is read as it is', async () => {
    const api = { status: () => ({ lastOkAt: null, problem: null }), subscribe: () => () => undefined, clearCache: () => undefined, timeline: async (d: string) => tl(d, 1440) } as unknown as RingApi;
    setGaugeApi(api);
    expect((await timelinesFor([Y], TODAY, T0)).get(Y)!.minutes).toBe(1440);
  });

  it("a refused read is told apart by the read's own status, whatever the client's last request said", async () => {
    let up = true;
    const base = { subscribe: () => () => undefined, clearCache: () => undefined };
    const api = {
      ...base,
      // another screen's request has answered since: the client's own status is clean
      status: () => ({ lastOkAt: null, problem: null }),
      withOptions: () => ({ ...base, status: () => ({ lastOkAt: null, problem: up ? null : 'unauthorized' }), timeline: async (d: string) => (up ? tl(d, 1440) : null) }),
    } as unknown as RingApi;
    setGaugeApi(api);
    await timelinesFor([Y, TODAY], TODAY, T0);
    up = false;
    expect((await timelinesFor([TODAY], TODAY, T0 + DAY_RECENT_TTL_MS)).get(TODAY)).toBeNull();
    // (FX1, sR15) nothing kept from before the refusal stands
    expect(timelineDays.peek(Y)).toBeUndefined();
  });

  it('through the real client: 8 weeks leave two at a time, the newest day first, and new data costs two requests', async () => {
    const urls: string[] = [];
    let running = 0;
    let most = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(`${url.pathname}?date=${url.searchParams.get('date')}`);
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 0));
      running--;
      return new Response(JSON.stringify(tl(url.searchParams.get('date')!, 1440 + urls.length)), { status: 200 });
    };
    const server = {
      isPaired: () => true,
      pairing: () => ({ baseUrl: 'https://home.example', person: { id: 'p', label: '' }, deviceId: 'd', pairedAt: 'd' }),
      subscribe: () => () => undefined,
      chatModelOptions: () => ({ serverUrl: 'https://home.example/', deps: { fetch: fetchImpl } }),
    };
    setGaugeApi(createGaugeApi({ server: server as never, now: () => T0, tz: () => 'UTC' }));
    const days = await timelinesFor(WEEKS8, TODAY, T0);
    expect([...days.values()].every((d) => d !== null)).toBe(true);
    expect(urls).toHaveLength(56);
    expect(most).toBe(DAY_READS_IN_FLIGHT);
    // the first pair is today and yesterday (the two leave together), then the days before them
    expect(urls.slice(0, 2).sort()).toEqual([`/v1/gauge/timeline?date=${Y}`, `/v1/gauge/timeline?date=${TODAY}`]);
    expect(urls.slice(2, 4).sort()).toEqual([`/v1/gauge/timeline?date=${addDays(TODAY, -3)}`, `/v1/gauge/timeline?date=${addDays(TODAY, -2)}`]);
    urls.length = 0;
    notifyGaugeDataChanged();
    await timelinesFor(WEEKS8, TODAY, T0 + 1_000);
    expect([...urls].sort()).toEqual([`/v1/gauge/timeline?date=${Y}`, `/v1/gauge/timeline?date=${TODAY}`]);
  });
});
