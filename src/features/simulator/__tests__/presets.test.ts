import { describe, expect, it } from 'vitest';
import { compileSchedule, resolveProfile } from '@/engine';
import type { Schedule } from '@/engine';
import { PRESETS, STARTERS, programFromPreset, starterSchedule } from '../presets';
import { HEAVY, MAN, WOMAN } from './fixtures';

const BRANDS =
  /\b(keto|paleo|atkins|carnivore|whole30|vegan diet|mediterranean|dash|zone|south beach|psmf)\b/i;

describe('program presets', () => {
  const people = [MAN, WOMAN, HEAVY].map((p) => resolveProfile(p));

  it('are named by composition, never by diet brand (brands only as search aliases)', () => {
    for (const p of PRESETS) {
      expect(p.name).not.toMatch(BRANDS);
      expect(p.template.label).not.toMatch(BRANDS);
    }
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    '%s compiles without notes and sums to its stated energy',
    (_, preset) => {
      for (const rp of people) {
        const s: Schedule = {
          schemaVersion: 1,
          startDate: '2026-10-05',
          horizonDays: 3,
          programs: [programFromPreset(preset.id, 'A')],
          days: [{ program: 0 }, { program: 0 }, { program: 0 }],
        };
        const c = compileSchedule(s, rp);
        expect(c.notes).toEqual([]);
        const d = c.days[1]!;
        // stated % of the day's maintenance reference at the planned activity (R-MAINT)
        const stated = (preset.statedPct / 100) * (Number.isFinite(d.maintenanceKcal) ? d.maintenanceKcal : rp.tdee0Kcal);
        expect(d.energyKcal).toBeCloseTo(stated, 6);
        const sum = 4 * d.proteinG + 4 * d.carbG + 9 * d.fatG + 2 * d.fibreG + 7 * d.alcoholG;
        expect(sum).toBeCloseTo(d.energyKcal, 6);
        for (const g of [d.proteinG, d.carbG, d.fatG, d.fibreG]) expect(g).toBeGreaterThanOrEqual(0);
        if (preset.statedPct === 0) {
          expect(d.zeroIntake).toBe(true);
          expect(d.proteinG).toBe(0);
        }
      }
    },
  );

  it('match their stated compositions', () => {
    const rp = people[0]!;
    const day = (id: (typeof PRESETS)[number]['id']) =>
      compileSchedule(
        {
          schemaVersion: 1,
          startDate: '2026-10-05',
          horizonDays: 1,
          programs: [programFromPreset(id, 'A')],
          days: [{ program: 0 }],
        },
        rp,
      ).days[0]!;
    expect(day('veryLowCarb').carbG).toBe(25);
    expect(day('proteinSparing').proteinG / rp.ffm0Kg).toBeCloseTo(2.5, 9);
    expect((day('highCarbLowFat').fatG * 9) / day('highCarbLowFat').energyKcal).toBeCloseTo(0.2, 9);
    expect((9 * day('trainingMaintenance').fatG) / day('trainingMaintenance').energyKcal).toBeCloseTo(
      0.25,
      9,
    );
    expect(day('trainingMaintenance').carbG / rp.weightKg).toBeGreaterThan(3);
    expect(day('trainingMaintenance').nSessions).toBe(1);
  });

  it('every starter compiles and weekday-aligns its pattern', () => {
    const rp = people[0]!;
    for (const st of STARTERS) {
      const s = starterSchedule(st.id, '2026-10-05', 0);
      expect(s.days).toHaveLength(st.weeks * 7);
      const c = compileSchedule(s, rp);
      expect(c.notes.filter((n) => n.code !== 'mealMovedOutOfFast')).toEqual([]);
      expect(s.days.slice(0, 7).map((d) => d.program)).toEqual([...st.week]);
    }
  });
});
