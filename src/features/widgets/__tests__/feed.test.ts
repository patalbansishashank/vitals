/** What the cards give the widgets: the figures as the app writes them, the course in a word, and the pictures when asked for. */
import { describe, expect, it } from 'vitest';
import { sanitizeSnapshot, type WidgetSnapshot } from '@/platform/widgets';
import { activityWidgetPart, heartRateDay, planState, ringWidgetPart, sleepWidgetPart, weightWidgetPart, WIDGET_WORDS } from '../feed';

const H = 3_600_000;
const day0 = Date.UTC(2026, 9, 28, 0, 0, 0);
const bins = Array.from({ length: 96 }, (_, i) => ({ start: day0 + i * 15 * 60_000, kcal: 27 }));

describe('planState', () => {
  it('says where the likely day stands against the plan with the app’s own margin (5 %, at least 50 kcal)', () => {
    expect(planState(2600, 2540)).toBe(WIDGET_WORDS.onPlan);
    expect(planState(2660, 2540)).toBe(WIDGET_WORDS.onPlan);
    expect(planState(2700, 2540)).toBe(WIDGET_WORDS.overPlan);
    expect(planState(2100, 2540)).toBe(WIDGET_WORDS.underPlan);
    // a small plan: the margin is 50 kcal, not 5 %
    expect(planState(1040, 1000)).toBe(WIDGET_WORDS.onPlan);
    expect(planState(1060, 1000)).toBe(WIDGET_WORDS.overPlan);
    expect(planState(2000, null)).toBeNull();
    expect(planState(null, 2000)).toBeNull();
  });
});

describe('activityWidgetPart', () => {
  const base = {
    date: '2026-10-28',
    unit: 'kcal' as const,
    nowMs: day0 + 12 * H,
    energy: { soFar: 1096, envelope: { lo: 2300, hi: 2900 }, total: 2595, byBedtime: 2595, plan: 2540, bins },
    steps: { soFar: 7605, goal: 9000, likely: 12878, hours: [0, 500, null, 1000, ...Array.from({ length: 20 }, () => null)], nowHour: 3 },
    heartPoints: { week: 84, daysIn: 3 },
  };

  it('gives the rings their ratios and the course in words, and no picture unless asked for', () => {
    const p = activityWidgetPart(base);
    expect(p.energy).toMatchObject({ unit: 'kcal', ratio: 1096 / 2595, state: 'On plan' });
    expect(p.energy?.value).toMatch(/^1.096$/);
    expect(p.energy?.likely).toMatch(/^2.595$/);
    expect(p.energy?.range).toMatch(/^970–1.220$|^9\d\d–1.2\d\d$/);
    expect(p.energy?.series).toBeUndefined();
    expect(p.steps).toMatchObject({ ratio: 7605 / 9000, state: 'On course', word: 'over half of the goal' });
    expect(p.steps?.likely).toMatch(/^12.878$/);
    expect(p.steps?.series).toBeUndefined();
  });

  it('builds the energy line and the steps bars when pictures are on', () => {
    const p = activityWidgetPart({ ...base, pictures: true });
    expect(p.energy?.series?.y.length).toBe(48);
    expect(p.energy?.series?.ahead?.at(-1)).toBe(1);
    expect(p.steps?.series).toMatchObject({ now: 3 });
    expect(p.steps?.series?.y.slice(0, 4)).toEqual([0, 0.5, null, 1]);
  });

  it('says "likely under" when the day will not reach the goal, nothing about the course before a step is counted', () => {
    expect(activityWidgetPart({ ...base, steps: { soFar: 2000, goal: 9000, likely: 6000 } }).steps?.state).toBe(WIDGET_WORDS.likelyUnder);
    const none = activityWidgetPart({ ...base, steps: { soFar: null, goal: 9000, likely: null } });
    expect(none.steps).toMatchObject({ value: null, ratio: null, word: 'no value yet' });
    expect(none.steps?.state).toBeUndefined();
  });

  it('follows the energy unit and leaves the energy out when unknown (quiet mode, no run yet)', () => {
    const kj = activityWidgetPart({ ...base, unit: 'kJ' });
    expect(kj.energy?.unit).toBe('kJ');
    expect(kj.energy?.value).toMatch(/4.5\d\d/);
    expect(activityWidgetPart({ ...base, energy: null }).energy).toBeNull();
    // no likely day: no ratio and no course, but the figure stays
    const e = activityWidgetPart({ ...base, energy: { soFar: 1096, plan: 2540 } }).energy!;
    expect(e.ratio).toBeUndefined();
    expect(e.state).toBeUndefined();
  });
});

describe('sleepWidgetPart', () => {
  const t0 = Date.UTC(2026, 9, 27, 23, 14);
  const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
  const night = {
    tstText: '7 h 56',
    tstLower: 476,
    onset: t0,
    wake: t0 + 500 * 60_000,
    windowStart: t0 - 10 * 60_000,
    windowEnd: t0 + 520 * 60_000,
    session: { blocks: [{ start: at(-10), end: at(200), stage: 'light' }, { start: at(200), end: at(300), stage: 'deep' }, { start: at(300), end: at(520), stage: 'rem' }] },
  };

  it('gives the goal, the ratio and when it began and ended; the stages only when pictures are on', () => {
    const s = sleepWidgetPart('2026-10-28', night, 450).sleep!;
    expect(s).toMatchObject({ value: '7 h 56', word: 'Goal met', goal: '7 h 30', onset: t0 });
    expect(s.ratio).toBeCloseTo(476 / 450, 5);
    expect(s.stages).toBeUndefined();
    const withPictures = sleepWidgetPart('2026-10-28', night, 450, { pictures: true }).sleep!;
    expect(withPictures.stages?.map((x) => x[2])).toEqual([2, 3, 1]);
  });

  it('without a goal there is no ratio or word', () => {
    const s = sleepWidgetPart('2026-10-28', night, null).sleep!;
    expect(s.word).toBeNull();
    expect(s.ratio).toBeUndefined();
    expect(s.goal).toBeUndefined();
  });
});

describe('ringWidgetPart and the heart-rate day', () => {
  it('carries the reading in words, the day’s range and its line', () => {
    const series = { y: [0.1, 0.9], now: 1 };
    const r = ringWidgetPart({ state: 'ready', hr: { text: '79', at: '2026-10-28T07:46:00Z', state: 'Normal', range: '50–90', series }, battery: null, lastUploadAt: null });
    expect(r.hr).toEqual({ value: '79', unit: 'bpm', at: Date.parse('2026-10-28T07:46:00Z'), state: 'Normal', range: '50–90', series });
    expect(ringWidgetPart({ state: 'ready', hr: { text: '79', at: 'not a time' }, battery: null, lastUploadAt: null }).hr).toBeNull();
  });

  it('heartRateDay: the range of the day so far and a line of it, readings only up to now', () => {
    const bpm = Array.from({ length: 1440 }, (_, i) => (i % 5 === 0 ? 60 + (i % 30) : null));
    const d = heartRateDay(bpm, 600, true);
    expect(d.range).toBe('60–85');
    expect(d.series?.y.length).toBeLessThanOrEqual(48);
    expect(heartRateDay(bpm, 600, false).series).toBeNull();
    expect(heartRateDay([null, null], 1, true)).toEqual({ series: null, range: null });
  });
});

describe('weightWidgetPart', () => {
  it('is the trend as the card writes it, where it stands, and the last weeks as a line', () => {
    const trend = [86.1, 86, null, 85.8, 85.5, 85.2];
    const p = weightWidgetPart({ kg: 85.2, state: 'onTrack', trend, pictures: true })!;
    expect(p.weight).toMatchObject({ value: '85.2', unit: 'kg', state: 'onTrack' });
    expect(p.weight?.series?.y[0]).toBeCloseTo(0.9, 3);
    expect(p.weight?.series?.y[2]).toBeNull();
    expect(weightWidgetPart({ kg: 85.2, state: null, trend })!.weight?.series).toBeUndefined();
    expect(weightWidgetPart({ kg: null, state: 'ahead', trend })).toBeNull();
  });
});

describe('every builder, made quiet, shows no digit', () => {
  it('words, ratios, stages and instants only', () => {
    const t0 = Date.UTC(2026, 9, 27, 23, 14);
    const act = activityWidgetPart({ date: 'd', unit: 'kcal', nowMs: day0 + 12 * H, pictures: true, energy: { soFar: 1096, byBedtime: 2595, plan: 2540, bins }, steps: { soFar: 7605, goal: 9000, likely: 12878, hours: [1, 2, 3], nowHour: 1 }, heartPoints: { week: 84, daysIn: 3 } });
    const sl = sleepWidgetPart('d', { tstText: '7 h 56', tstLower: 476, onset: t0, wake: t0 + 3, windowStart: t0, windowEnd: t0 + 8 * H, session: { blocks: [{ start: new Date(t0).toISOString(), end: new Date(t0 + 8 * H).toISOString(), stage: 'light' }] } }, 450, { pictures: true });
    const ring = ringWidgetPart({ state: 'ready', hr: { text: '79', at: '2026-10-28T07:46:00Z', state: 'Normal', range: '50–90', series: { y: [0.5], now: 0 } }, battery: { percent: 64, at: null }, lastUploadAt: null });
    const body = weightWidgetPart({ kg: 85.2, state: 'ahead', trend: [86, 85.2], pictures: true });
    const q: WidgetSnapshot = sanitizeSnapshot({ v: 1, at: 1, quiet: true, today: { ...act, ...sl }, ring, body }, { weight: true });
    const text: string[] = [];
    const walk = (v: unknown, k: string) => {
      if (['series', 'stages', 'at', 'lastSyncAt', 'ratio', 'v', 'onset', 'wake'].includes(k)) return;
      if (typeof v === 'string' && k !== 'date') text.push(v);
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
    };
    walk(q, '');
    expect(text.length).toBeGreaterThan(5);
    for (const t of text) expect(t, t).not.toMatch(/\d/);
    expect(q.today?.energy).toBeNull();
    expect(q.today?.sleep?.stages).toBeDefined();
    expect(q.body?.weight).toEqual({ unit: 'kg', state: 'ahead' });
  });
});
