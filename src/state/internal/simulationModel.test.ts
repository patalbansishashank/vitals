// @vitest-environment node
import { simulateEnsemble, type PersonProfile, type Schedule } from '@/engine';
import { simulateDrawChunk } from '@/workers/simulationDraws';
import { computeBands, runHash } from './simulationModel';

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 88 }, startDate: '2026-10-05' };
const SCHED: Schedule = {
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: 6,
  programs: [{ id: 'A', label: 'a', energy: { kind: 'pctMaintenance', pct: 80 }, macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } } }],
  days: Array.from({ length: 6 }, () => ({ program: 0 })),
};

describe('streaming bands (D8-02)', () => {
  it('quantiles over the draws only: the nominal value is never a member', () => {
    const nominal = { fatMass: new Float32Array([10, 10]) };
    const b = computeBands(nominal, [8, 9, 11, 12].map((v) => ({ fatMass: new Float32Array([v, Number.NaN]) })), 4);
    expect(b.p50.fatMass![0]).toBeCloseTo(10, 6);
    expect(b.p10.fatMass![0]).toBeCloseTo(8.3, 6);
    expect(b.p90.fatMass![0]).toBeCloseTo(11.7, 6);
    // no finite member that day: never the nominal 10; storage stays finite and the day is unavailable (A1-049)
    expect(b.p50.fatMass![1]).toBe(0);
    expect(b.days!.fatMass!.available[1]).toBe(0);
    expect(b.days!.fatMass!.valid[1]).toBe(0);
    expect(b.bandMeta!.fatMass).toMatchObject({ method: 'draws', uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', draws: 4, nominalInQuantiles: false });
    expect(b.complete).toBe(true);
    expect(computeBands(nominal, [], 4).p10.fatMass).toBeUndefined();
  });

  it('streamed chunks give the same bands as the core ensemble for the same members', () => {
    const series = ['fatMass', 'ldl', 'scaleWeight'] as const;
    const e = simulateEnsemble(MAN, SCHED, { draws: 6, seed: 1, series: [...series] });
    const draws = [0, 3].flatMap((start) => simulateDrawChunk(MAN, SCHED, { seed: 1, total: 6, start, count: 3, options: { series: [...series] } }));
    const b = computeBands(e.nominal.daily, draws, 6, e.nominal.initial);
    for (const id of series) {
      expect(Array.from(b.p10[id]!)).toEqual(Array.from(e.p10[id]!));
      expect(Array.from(b.p50[id]!)).toEqual(Array.from(e.p50[id]!));
      expect(Array.from(b.p90[id]!)).toEqual(Array.from(e.p90[id]!));
      expect(b.bandMeta![id]).toEqual(e.bandMeta![id]);
    }
  });

  it('the run hash covers the engine semantics (C7) and stays stable for equal inputs', () => {
    expect(runHash(MAN, SCHED)).toBe(runHash({ ...MAN }, { ...SCHED }));
    expect(runHash(MAN, SCHED)).toMatch(/^[0-9a-f]{8}$/);
  });
});
