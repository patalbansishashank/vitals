/** Today's activity models (energy SPEC §V4.1–§V4.3, A.3.5, D18, D21): pure functions the screens render. */
import { describe, expect, it } from 'vitest';
import { energyDay, type EnergyHour } from '@/living/sensors/energyDay';
import {
  activityName, bookedKcalText, dayGroups, dayPartOf, dayStripSegments, elapsedText, energyColumns, energySplit, pendingHeartPoints, kcalRangeText, lastMovingMinute, lineageText, planMatchText,
  rowFacts, scrubModel, searchTypes, sleepAction, sourcesText, stepsHours, wakingDateOf,
} from '../model';

const H = 3_600_000;

describe('day groups (D18)', () => {
  it('puts 05:00–12:00 in the morning, 12:00–17:00 in the afternoon and the rest in the evening', () => {
    expect([4.99, 5, 11.99, 12, 16.99, 17, 23, 24.5].map(dayPartOf)).toEqual(['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'evening']);
  });
  it('counts what is done and marks the part that holds now', () => {
    const rows = [{ at: 7, d: true }, { at: 7.5, d: false }, { at: 12.5, d: true }, { at: 19.5, d: false }];
    const g = dayGroups(rows, (r) => r.d, 13.3);
    expect(g.map((x) => [x.part, x.countText, x.now])).toEqual([
      ['morning', '1 of 2 done', false],
      ['afternoon', '1 of 1 done', true],
      ['evening', '0 of 1 done', false],
    ]);
    expect(dayGroups(rows, (r) => r.d, null).some((x) => x.now)).toBe(false);
  });
  it('draws the plan day as sleep, the eating window, the fast and training, without gaps or overlaps', () => {
    const m = new Date('2026-10-27T00:00:00').getTime();
    const segs = dayStripSegments({ dayStart: m, sleep: { bedH: 23, wakeH: 6.5 }, window: { startH: 12, endH: 20 }, sessions: [{ startH: 7.5, durationMin: 35 }] });
    expect(segs[0]).toEqual({ from: m, to: m + 6.5 * H, state: 3 });
    expect(segs.find((s) => s.state === 2)).toEqual({ from: m + 7.5 * H, to: m + 7.5 * H + 35 * 60_000, state: 2 });
    expect(segs.find((s) => s.state === 0)).toEqual({ from: m + 12 * H, to: m + 20 * H, state: 0 });
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.from).toBe(segs[i - 1]!.to);
    expect(segs.at(-1)!.to).toBe(m + 24 * H);
  });
});

describe('the one-tap sleep keys (D21)', () => {
  it('offers "I’m up" in the morning until the person is up, "Going to sleep" in the evening until lights out', () => {
    expect(sleepAction(7, { bedH: 23, lightsOutTonight: false, upToday: false })).toBe('imUp');
    expect(sleepAction(7, { bedH: 23, lightsOutTonight: false, upToday: true })).toBeNull();
    expect(sleepAction(14, { bedH: 23, lightsOutTonight: false, upToday: true })).toBeNull();
    expect(sleepAction(21.7, { bedH: 23, lightsOutTonight: false, upToday: true })).toBe('goingToSleep');
    // the clock gives 0–24 hours: 00:30 is 0.5, and it still offers "Going to sleep"
    expect(sleepAction(0.5, { bedH: 23, lightsOutTonight: false, upToday: true })).toBe('goingToSleep');
    expect(sleepAction(22.5, { bedH: 23, lightsOutTonight: true, upToday: true })).toBeNull();
  });
  it('files lights out under the night that ends next, from the calendar date and hour of now (Claude P1-3)', () => {
    expect(wakingDateOf('2026-10-27', 21.7)).toBe('2026-10-28');
    // 01:10 on the 27th (still app day the 26th): the night ending on the 27th, not the one that ended on the 26th
    expect(wakingDateOf('2026-10-27', 1 + 10 / 60)).toBe('2026-10-27');
  });
});

describe('words', () => {
  it('names activities from the catalogue and finds them by what is typed, the suggested one first', () => {
    expect(activityName('walk_brisk')).toBe('Brisk walk');
    expect(searchTypes('bike', ['stationary_bike'])[0]!.id).toBe('stationary_bike');
    expect(searchTypes('stair').every((t) => /stair/i.test(t.name) || t.id.includes('stair'))).toBe(true);
  });
  it('says the kcal as an estimate with its range; quiet mode is words only (no minutes, kcal or points)', () => {
    expect(kcalRangeText(310.4, { lo: 220, hi: 401 })).toBe('about 310 kcal, 220–401');
    const r = { minutes: 45, kcal: { value: 210, range: { lo: 160, hi: 260 }, method: 'acsm', label: 'estimated' as const }, heartPoints: 18 };
    expect(rowFacts(r, false)).toBe('45 min · about 210 kcal, 160–260 · 18 Heart Points');
    expect(rowFacts(r, true)).toBe('Heart Points earned');
    expect(rowFacts({ ...r, status: 'pending' }, true)).toBe('Heart Points once counted');
    // (0.6.3) the machine's number reads as it is, 0 included; never "about", never a range
    const zero = { minutes: 30, kcal: { value: 0, range: { lo: 0, hi: 0 }, method: 'reported', label: 'estimated' as const }, heartPoints: null };
    expect(rowFacts(zero, false)).toBe('30 min · 0 kcal (from the machine)');
    expect(rowFacts(zero, true)).toBe('');
    expect(bookedKcalText(240, { lo: 240, hi: 240 }, 'reported')).toBe('240 kcal (from the machine)');
    expect(bookedKcalText(240, { lo: 200, hi: 280 }, 'met')).toBe('about 240 kcal, 200–280');
    expect(sourcesText([{ source: 'gaugeSession' }, { source: 'ringTelemetry' }])).toBe('Phone recording and ring');
    expect(sourcesText([])).toBe('Logged by hand');
    expect(planMatchText({ planMatch: { itemId: 'cardioSession:1:0', slotKey: '1:0', startH: 7.5, deltaH: -0.4, sameFamily: true } }, 'walk')).toBe('Looks like your planned walk at 07:30');
    expect(lineageText(['ring', 'phone'])).toBe('Ring and phone');
    expect(lineageText([])).toBeNull();
  });
  it('reads a recording as a stopwatch from its start', () => {
    const t0 = '2026-10-27T07:05:00.000Z';
    expect(elapsedText(t0, Date.parse(t0) + 23 * 60_000 + 4_000)).toBe('0:23:04');
    expect(elapsedText(t0, Date.parse(t0) + 3_725_000)).toBe('1:02:05');
    expect(elapsedText(t0, Date.parse(t0) - 5_000)).toBe('0:00:00');
  });
});

describe('the scrubber and a late stop', () => {
  it('finds where movement stopped well before the recorded end', () => {
    const first = 0;
    const steps = Array.from({ length: 60 }, (_, k) => (k < 39 ? 110 : 3));
    expect(lastMovingMinute({ start: 0, end: 45 * 60_000 }, { first, steps })).toBe(39 * 60_000);
    expect(lastMovingMinute({ start: 0, end: 41 * 60_000 }, { first, steps })).toBeNull();
    const m = scrubModel({ start: 20 * 60_000, end: 40 * 60_000 }, { first, steps });
    expect(m.kind).toBe('steps');
    expect(m.bars).toHaveLength(50);
    expect(m.bars[0]!.v).toBe(110);
  });
});

describe('energy through the day', () => {
  it('stacks the states before now, draws the plan after, and the split adds up to the day', () => {
    const start = Date.parse('2026-10-27T04:00:00');
    const hours: EnergyHour[] = Array.from({ length: 24 }, (_, j) => ({ start: start + j * H, rmr: 74, tef: j === 9 ? 20 : 0, neat: 30, stepsEnergy: 20, exerciseEnergy: 0, tdee: 74 + (j === 9 ? 20 : 0) + 30 }));
    const day = energyDay({ hours, minutes: [], bouts: [] });
    const now = start + 9.5 * H;
    const cols = energyColumns(day, now);
    expect(cols).toHaveLength(96);
    expect(cols.filter((c) => !c.future)).toHaveLength(38);
    expect(cols.find((c) => c.future)!.parts).toEqual([]);
    const s = energySplit(cols);
    const states = Object.values(s.byState).reduce((a, b) => a + b.kcal, 0);
    expect(states + s.planned.kcal + day.tef).toBeCloseTo(day.total, 6);
    // no minutes: every state before now is unknown, never zero activity
    expect(s.byState.unknown.minutes).toBeCloseTo(38 * 15, 6);
  });
});

describe('steps by source and Heart Points', () => {
  it('flags an hour where ring and phone disagree by more than a fifth', () => {
    const n = 120;
    const ring = Array<number | null>(n).fill(null);
    const phone = Array<number | null>(n).fill(null);
    for (let k = 0; k < 120; k++) {
      ring[k] = 50;
      phone[k] = k < 60 ? 48 : 30;
    }
    const h = stepsHours({ date: '2026-10-27', start: '2026-10-27T00:00:00.000Z', minutes: n, steps: { selected: ring, source: ring.map(() => 'ring'), ring, phone, support: ring.map(() => 'minute' as const) } });
    expect(h.map((x) => x.disagree)).toEqual([false, true]);
    expect(h[0]!.selected).toBe(3000);
  });
  it('names pending points apart (counted points come from the shared day calculation)', () => {
    expect(pendingHeartPoints([{ date: '2026-10-27', heartPoints: 18 }, { date: '2026-10-27', heartPoints: null }, { date: '2026-10-26', heartPoints: 9 }], '2026-10-27')).toBe(18);
  });
});
