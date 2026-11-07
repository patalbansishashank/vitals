// @vitest-environment node
/**
 * Full-engine response validity of the cardiometabolic module (D7-07/D7-08, review 2026-10-18), through the core's run
 * statuses (`cardiometabolicRunStatus` → `meta.outputStatus`):
 *   - a 72-h water fast in the standard projection (LEM term off) does not assert a numeric LDL rise; the LDL response is
 *     marked `scenario` (response uncertain) from the fast's first day — off is model containment, never zero biology —
 *     and ApoB keeps its exploratory proxy status;
 *   - the LEM adverse-response scenario, switched on explicitly, restores the legacy LDL rise and is labelled exploratory;
 *   - the habitual week (no ketogenic exposure) carries no lipid-response status, and ApoB's proxy response is exploratory.
 */
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayTemplate, PersonProfile, Schedule } from '../../types';

const P: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 45, heightCm: 176, weightKg: 83.6 },
  habits: { typicalSteps: 5000, sessionsPerWeek: 0, lifingCardioMix: 0, trainingHistory: 'none' },
  startDate: '2026-10-05',
};

function habitualWeek(days: number): Schedule {
  const rp = resolveProfile(P);
  const macros: DayTemplate['macros'] = {
    protein: { unit: 'g', value: rp.habitualProteinG },
    carbs: { unit: 'g', value: rp.habitualCarbG },
    fat: { unit: 'remainder' },
    fibre: { unit: 'g', value: rp.habitualFibreG },
  };
  const programs: DayTemplate[] = [0, 1, 2, 3, 4, 5, 6].map((wd) => ({
    id: `w${wd}`,
    label: `w${wd}`,
    energy: { kind: 'pctMaintenance', pct: 100 },
    macros,
    meals: { count: 3, window: { startH: 8, lengthH: 12 } },
    exercise: [],
  }));
  return { schemaVersion: 1, startDate: '2026-10-05', horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: d % 7 })) };
}

function run(s: Schedule, overrides?: Record<string, number>) {
  const rp = resolveProfile(P);
  let paramOverrides: Float64Array | undefined;
  if (overrides) {
    const mp = buildModelParams(MODULES);
    paramOverrides = mp.values.slice();
    for (const [id, v] of Object.entries(overrides)) {
      const i = mp.index.get(id);
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      paramOverrides[i] = v;
    }
  }
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily', ...(paramOverrides ? { paramOverrides } : {}) });
}

function fast72(): Schedule {
  const s = habitualWeek(35);
  s.events = [{ kind: 'fast', startDay: 7, startH: 20, durationH: 72 }];
  return s;
}

describe('72-h water fast: LDL response validity (D7-07)', () => {
  const base = run(habitualWeek(35));
  const rel = (r: ReturnType<typeof run>, d: number) => r.daily.ldl![d]! / base.daily.ldl![d]!;

  it('habitual week: no lipid-response status beyond the exploratory ApoB proxy', () => {
    expect(base.meta.outputStatus?.ldl).toBeUndefined();
    expect(base.meta.outputStatus?.apoB).toMatchObject({ status: 'exploratory', reasonCode: 'apoBProxyResponseUnvalidated' });
  });

  it('standard projection: no asserted LDL rise; LDL and ApoB are a scenario (response uncertain) from the fast', () => {
    const r = run(fast72());
    expect(rel(r, 10)).toBeLessThan(1.02);
    const ldl = r.meta.outputStatus?.ldl;
    expect(ldl).toMatchObject({ status: 'scenario', reasonCode: 'ketogenicLipidResponseUncertain', uncertaintyKind: 'scenario' });
    expect(ldl?.fromDay).toBeGreaterThanOrEqual(7);
    expect(ldl?.fromDay).toBeLessThanOrEqual(9);
    // ApoB keeps its stronger exploratory status from day 1 (worst status wins over the later scenario)
    expect(r.meta.outputStatus?.apoB).toMatchObject({ status: 'exploratory', fromDay: 1 });
    // the uncertain response never reads as a zero-response guarantee: the liver-fat keto response is flagged as well
    expect(r.meta.outputStatus?.liverFat).toMatchObject({ status: 'scenario', reasonCode: 'liverKetoResponseUnsupported' });
  });

  it('LEM adverse-response scenario (explicit opt-in): the legacy LDL rise returns and is labelled exploratory', () => {
    const r = run(fast72(), { 'cardiometabolic.lem.enabled': 1 });
    expect(rel(r, 10)).toBeGreaterThan(1.02);
    expect(r.meta.outputStatus?.ldl).toMatchObject({ status: 'exploratory', reasonCode: 'lemAdverseResponseScenario' });
  });
});
