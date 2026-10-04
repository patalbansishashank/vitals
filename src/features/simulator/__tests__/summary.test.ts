import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/engine';
import { checkSchedule } from '../lib/dayFlags';
import { energyFill, energyStep, stepMix } from '../lib/energy';
import { dayFasts, fastSpans, formatFastHours } from '../lib/fasts';
import { derivePhases } from '../lib/phases';
import { calendarGrid } from '../lib/calendar';
import { fastingGaps, summarise } from '../lib/summary';
import { A, B, F, RP, compile, schedule } from './fixtures';

describe('summary strip', () => {
  it('averages energy, macros, fasting and training over a week', () => {
    // Mon–Sun: A B A B A B C(fast)
    const s = schedule(7, [0, 1, 0, 1, 0, 1, 2]);
    const c = compile(s);
    const sum = summarise(c, RP, [0, 1, 2, 3, 4, 5, 6]);
    const expectedPct = (3 * 85 + 3 * 75 + 0) / 7;
    expect(sum.energyPct).toBeCloseTo(expectedPct, 6);
    expect(sum.proteinG).toBeCloseTo((6 * 2 * RP.weightKg) / 7, 6);
    expect(sum.resistanceSessions).toBe(3);
    expect(sum.cardioSessions).toBe(0);
    expect(sum.waterOnlyDays).toBe(1);
    // B (12–20) → A (08–20): overnight gaps 12 h (20→08) and 16 h (20→12); the fast day: Sat 20:00 → horizon end
    expect(sum.longestFastH).toBeGreaterThanOrEqual(28);
    expect(sum.windowH).toBeCloseTo((3 * 12 + 3 * 8) / 6, 6);
  });

  it('counts fasting hours inside ≥ 12 h gaps, clipped to the period', () => {
    const s = schedule(14, [1]); // 12:00–20:00 every day → 16 h overnight fasts
    const c = compile(s);
    const gaps = fastingGaps(c);
    expect(gaps.every((g) => g.b - g.a >= 12)).toBe(true);
    const wk2 = summarise(c, RP, [7, 8, 9, 10, 11, 12, 13], gaps);
    // Sun→Mon's fast contributes its 12 h after midnight, six full 16 h fasts follow; the 4 h cut off by the
    // horizon end is not a fast (< 12 h)
    expect(wk2.fastingHours).toBeCloseTo(12 + 6 * 16, 6);
  });
});

describe('fasts as experienced', () => {
  it('a water-only day between days eating 08–20 is a 36 h fast', () => {
    const s = schedule(3, [0, 2, 0]);
    const c = compile(s);
    const spans = fastSpans(c);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.hours).toBeCloseTo(36, 9);
    expect(formatFastHours(36)).toBe('36 h');
    expect(formatFastHours(120)).toBe('5 d');
    const f = dayFasts(spans, 3);
    expect(f[0]!.from).toBe(20);
    expect(f[1]!.full).toBe(true);
    expect(f[1]!.isLabelDay).toBe(true);
    expect(f[2]!.to).toBe(8);
  });
});

describe('synchronous safety flags', () => {
  it('flags macros that exceed energy as a blocking error', () => {
    const s: Schedule = schedule(7, [0]);
    s.programs[0]!.macros = {
      protein: { unit: 'g', value: 300 },
      carbs: { unit: 'g', value: 300 },
      fat: { unit: 'g', value: 60 },
    };
    s.programs[0]!.energy = { kind: 'kcal', kcal: 1500 };
    const c = compile(s);
    const chk = checkSchedule(c, RP, fastSpans(c));
    expect(chk.errorDays).toHaveLength(7);
    expect(chk.flag[0]).toBe('error');
    expect(chk.byDay[0]![0]!.message).toMatch(/already use .* kcal — more than the 1\s?500 set/);
  });

  it('a 72 h+ fast is danger, and without a graded restart W-F08 is added', () => {
    const s = schedule(14, [0]);
    s.events = [{ kind: 'fast', startDay: 2, startH: 20, durationH: 84, refeed: 'none' }];
    const c = compile(s);
    const spans = fastSpans(c, s.events);
    const chk = checkSchedule(c, RP, spans, s.events);
    const ids = new Set(chk.byDay.flat().map((x) => x.id));
    expect(ids.has('W-F04')).toBe(true);
    expect(ids.has('W-F08')).toBe(true);
    expect(chk.flag[4]).toBe('danger');
    s.events = [{ ...s.events[0]!, refeed: 'auto' }];
    const c2 = compile(s);
    const chk2 = checkSchedule(c2, RP, fastSpans(c2, s.events), s.events);
    expect(chk2.byDay.flat().some((x) => x.id === 'W-F08')).toBe(false);
  });

  it('a steady 25 % deficit stays unflagged; a 40 % one is flagged', () => {
    const ok = compile(schedule(14, [0]));
    expect(checkSchedule(ok, RP, fastSpans(ok)).counts).toEqual({ error: 0, danger: 0, caution: 0 });
    const s = schedule(14, [0]);
    s.programs[0]!.energy = { kind: 'pctMaintenance', pct: 55 };
    const c = compile(s);
    const chk = checkSchedule(c, RP, fastSpans(c));
    expect(chk.byDay[13]!.some((x) => x.id === 'W-E04')).toBe(true);
  });
});

describe('energy encoding', () => {
  it('steps every 5 % and keeps 85 / 80 / 75 apart', () => {
    expect(energyStep(100)).toBe(0);
    expect(energyStep(85)).toBe(-3);
    expect(energyStep(80)).toBe(-4);
    expect(energyStep(75)).toBe(-5);
    expect(energyStep(10)).toBe(-12);
    expect(energyStep(160)).toBe(8);
    const mixes = [85, 80, 75].map((p) => stepMix(energyStep(p)));
    expect(new Set(mixes).size).toBe(3);
    expect(energyFill(0)).toBe('var(--lm-energy-neutral)');
    expect(energyFill(-3)).toContain('--sim-deficit-end');
  });
});

describe('phases', () => {
  it('auto-derives blocks from runs of identical weeks, explicit blocks win', () => {
    const s = schedule(28, [0, 1, 0, 1, 0, 1, 1]);
    for (let d = 14; d < 21; d++) s.days[d] = { program: 1 };
    const c = compile(s);
    const g = calendarGrid(s.startDate, 28);
    const ph = derivePhases(s, c, g, RP.tdee0Kcal);
    expect(ph.map((p) => [p.row0, p.row1])).toEqual([
      [0, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(ph[0]!.name).toBe('deficit');
    const named = derivePhases(
      { ...s, blocks: [{ name: 'diet break', startDay: 14, endDay: 21 }] },
      c,
      g,
      RP.tdee0Kcal,
    );
    expect(named).toHaveLength(1);
    expect(named[0]!.name).toBe('diet break');
  });
});

void A;
void B;
void F;

describe('insert-fast preview (QA: a "72 h" fast became 88 h without saying so)', () => {
  it('finds the first real meal after the planned end', async () => {
    const { nextMealAt } = await import('../lib/fasts');
    // A (08–20, meals 08/14/20) every day: a fast from day 2 20:00 planned for 72 h ends on day 5 at 20:00, where A
    // has its last meal → exactly 72 h
    const a = compile(schedule(10, [0]));
    expect(nextMealAt(a, 2 * 24 + 20 + 72)).toBe(5 * 24 + 20);
    // B (12–20, meals 12/20) every day: planned end day 5 20:00 still has B's 20:00 meal …
    const b = compile(schedule(10, [1]));
    expect(nextMealAt(b, 5 * 24 + 20)).toBe(5 * 24 + 20);
    // … but ending at 21:00 the next meal is day 6 at 12:00
    expect(nextMealAt(b, 5 * 24 + 21)).toBe(6 * 24 + 12);
    // past the last meal of the horizon there is none
    expect(nextMealAt(b, 9 * 24 + 21)).toBeNull();
  });
});
