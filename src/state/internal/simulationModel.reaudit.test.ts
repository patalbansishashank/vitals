// @vitest-environment node
/**
 * Re-audit 2026-10-19 (stage 1, F02-core): the Simulator state keeps the producer's per-series method and per-day band
 * accounting (A1-049/A1-051) in the form the screen reads.
 */
import { BAND_DAY_METHOD } from '@/lib/bodyContracts';
import type { EnsembleMemberEnvelope } from '@/engine/types/result';
import { simulateEnsemble, type PersonProfile, type Schedule } from '@/engine';
import { simulateDrawChunk } from '@/workers/simulationDraws';
import { computeBands, simBandDays } from './simulationModel';

const env = (v: number[], extra: Partial<EnsembleMemberEnvelope> = {}): EnsembleMemberEnvelope => ({ daily: { fatMass: new Float32Array(v) }, nDays: v.length, ...extra });

describe('A1-049/A1-051: per-series method and per-day accounting in the Simulator state', () => {
  it('an explicit complete member set without the series is method none: no arrays, no usable day', () => {
    const b = computeBands({ fatMass: new Float32Array([27, 27, 27]) }, [{}], 1);
    expect(b.methodBySeries!.fatMass).toBe('none');
    expect(b.bandMeta!.fatMass!.method).toBe('none');
    expect(b.p10.fatMass).toBeUndefined();
    expect(Array.from(b.days!.fatMass!.available)).toEqual([0, 0, 0]);
    expect(b.days!.fatMass!.reasons).toEqual([{ code: 'nonFinite', fromDay: 0, members: 1 }]);
  });

  it('a valid prefix stays usable, an all-stopped suffix has no range; quantile storage stays finite', () => {
    const b = computeBands({ fatMass: new Float32Array([10, 10, 10]) }, [8, 9, 11, 12].map((x) => env([x, x, Number.NaN], { aborted: { day: 1, bound: 'b', magnitude: 1 } })), 4);
    const d = b.days!.fatMass!;
    expect(Array.from(d.available)).toEqual([1, 1, 0]);
    expect(Array.from(d.valid)).toEqual([4, 4, 0]);
    expect(Array.from(d.excluded)).toEqual([0, 0, 4]);
    expect(Array.from(d.attempted)).toEqual([4, 4, 4]);
    expect(d.reasons).toEqual([{ code: 'aborted', fromDay: 2, members: 4 }]);
    for (const a of [b.p10.fatMass!, b.p90.fatMass!]) expect(Array.from(a).every(Number.isFinite)).toBe(true);
  });

  it('one stopped member: the valid members’ range is offered, named valid-only; the members’ scenario status is the qualifier', () => {
    const av = computeBands(
      { fatMass: new Float32Array([10, 10, 10]) },
      [env([8, 8, 8], { aborted: { day: 0, bound: 'b', magnitude: 1 } }), env([9, 9, 9], { status: { fatMass: { status: 'scenario', reasonCode: 'r', fromDay: 1 } } }), env([11, 11, 11])],
      3,
    );
    expect(av.bandDays!.fatMass!.method[1]).toBe(BAND_DAY_METHOD.conditionalValid);
    expect(av.days!.fatMass!.validOnly).toBe(true);
    expect(av.days!.fatMass!.qualifier).toEqual({ status: 'scenario', fromDay: 1 });
    expect(simBandDays(av.bandDays!.fatMass!).available[1]).toBe(1);
  });

  it('streamed chunks reproduce the direct ensemble’s per-day accounting through the state reducer', () => {
    const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 88 }, startDate: '2026-10-05' };
    const SCHED: Schedule = {
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: 5,
      programs: [{ id: 'A', label: 'a', energy: { kind: 'pctMaintenance', pct: 80 }, macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } } }],
      days: Array.from({ length: 5 }, () => ({ program: 0 })),
    };
    const e = simulateEnsemble(MAN, SCHED, { draws: 4, seed: 1, series: ['fatMass', 'ldl'] });
    const draws = simulateDrawChunk(MAN, SCHED, { seed: 1, total: 4, start: 0, count: 4, options: { series: ['fatMass', 'ldl'] } });
    const b = computeBands(e.nominal.daily, draws, 4, e.nominal.initial);
    expect(b.bandDays!.fatMass).toEqual(e.bandDays!.fatMass);
    expect(b.methodBySeries).toEqual(e.method);
  });
});
