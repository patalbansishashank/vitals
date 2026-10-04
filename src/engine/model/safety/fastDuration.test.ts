// @vitest-environment node
/**
 * Release check 2026-10-01 (blocker round, engine item): inserting a "72 h" fast warned about "a 71 h fast". The fast tier
 * rules (W-F01…W-F05), their peak value and the per-fast rules (W-F08, W-F10, W-F11) use the planned span's meal-to-meal
 * duration (`FastEvent.durationH`, ruling 18:10; `CompiledSchedule.fastSpans[i].mealToMealH`), not the zero-intake
 * counter (whole hours strictly between the two meals: one less). Real engine.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { FastEvent, PersonProfile, Schedule, SimWarning } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const rp = resolveProfile({ schemaVersion: 1, body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 }, habits: { sessionsPerWeek: 0 }, startDate: '2026-10-05' } as PersonProfile);
/** Meals at 08:00, 13:30 and 19:00; one fast from the day-2 dinner. */
function warnings(durationH: number, refeed: FastEvent['refeed'] = 'none', startH = 19): { w: SimWarning[]; m2m: number } {
  const s: Schedule = {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: 14,
    programs: [{ id: 'a', label: 'a', energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } }, meals: { count: 3, window: { startH: 8, lengthH: 11 } } }],
    days: Array.from({ length: 14 }, () => ({ program: 0 })),
    events: [{ kind: 'fast', startDay: 2, startH, durationH, refeed }],
  };
  const cs = compileSchedule(s, rp);
  const r = runEngine(rp, cs, { record: 'daily', collectWarnings: true });
  return { w: r.warnings.filter((x) => x.id.startsWith('W-F')), m2m: cs.fastSpans[0]!.mealToMealH ?? Number.NaN };
}
const peak = (w: SimWarning[], id: string): number | undefined => w.find((x) => x.id === id)?.peakValue;

describe('fast warnings report the meal-to-meal duration', () => {
  it('"72 h" fast after dinner: W-F03 says 72 h (was 71), W-F11 72; without a refeed plan W-F08 fires (it was missed at 71)', () => {
    const { w, m2m } = warnings(72);
    expect(m2m).toBe(72);
    expect(peak(w, 'W-F03')).toBe(72);
    expect(peak(w, 'W-F11')).toBe(72);
    expect(peak(w, 'W-F08')).toBe(72);
    expect(peak(w, 'W-F04')).toBeUndefined();
  });
  it('with the refeed ramp: no W-F08', () => {
    const { w } = warnings(72, 'auto');
    expect(peak(w, 'W-F03')).toBe(72);
    expect(peak(w, 'W-F08')).toBeUndefined();
  });
  it('24 h → W-F01 "24 h"; 96 h → W-F04 96 h (4.0 days)', () => {
    expect(peak(warnings(24).w, 'W-F01')).toBe(24);
    expect(peak(warnings(96).w, 'W-F04')).toBe(96);
  });
  it('the tier follows the meal-to-meal time: a fast that drops the next dinner lasts until breakfast (85 h → T4)', () => {
    const { w, m2m } = warnings(72, 'none', 19.5); // the 19:00 meal on the resume day falls inside the window and is dropped
    expect(m2m).toBe(85);
    expect(peak(w, 'W-F04')).toBe(85);
    expect(peak(w, 'W-F03')).toBeUndefined();
  });
});
