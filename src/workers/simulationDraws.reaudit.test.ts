// @vitest-environment node
/**
 * Re-audit 2026-10-19 (stage 1, F02-core): the streamed ensemble crosses the worker as member envelopes (A1-049) built from
 * the same member vectors as the direct ensemble (A1-065), so quantiles and per-day metadata are identical.
 */
import { simulateEnsemble, type PersonProfile, type Schedule } from '@/engine';
import { ensembleBands, isMemberEnvelope } from '@/engine/core/bands';
import { buildModelParams, drawKindOf } from '@/engine/core/paramsRegistry';
import { MODULES } from '@/engine/core/moduleRegistry';
import { drawBuffers, simulateDrawChunk } from './simulationDraws';

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }, startDate: '2026-10-05' };
const sched = (protein: number): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: 6,
  programs: [{ id: 'A', label: 'a', energy: { kind: 'kcal', kcal: 2500 }, macros: { protein: { unit: 'gPerKgBw', value: protein }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } } }],
  days: Array.from({ length: 6 }, () => ({ program: 0 })),
});
const series = ['fatMass', 'leanTissue', 'ldl'] as const;

describe('A1-049: core/stream parity of quantiles and per-day metadata', () => {
  it('streamed envelopes (any chunk size) give the direct ensemble’s quantiles, band metadata and per-day accounting', () => {
    const s = sched(0.35);
    const e = simulateEnsemble(MAN, s, { draws: 6, seed: 1, series: [...series] });
    for (const size of [1, 4]) {
      const draws = [];
      for (let start = 0; start < 6; start += size) draws.push(...simulateDrawChunk(MAN, s, { seed: 1, total: 6, start, count: size, options: { series: [...series] } }));
      expect(draws.every(isMemberEnvelope)).toBe(true);
      const b = ensembleBands(e.nominal.daily, e.nominal.initial, draws);
      for (const id of series) {
        expect(Array.from(b.p10[id]!)).toEqual(Array.from(e.p10[id]!));
        expect(Array.from(b.p50[id]!)).toEqual(Array.from(e.p50[id]!));
        expect(Array.from(b.p90[id]!)).toEqual(Array.from(e.p90[id]!));
        expect(b.bandMeta[id]).toEqual(e.bandMeta![id]);
        expect(b.bandDays[id]).toEqual(e.bandDays![id]);
      }
    }
  });

  it('the worker transfers every member’s daily buffers and copies its status metadata', () => {
    const draws = simulateDrawChunk(MAN, sched(1.6), { seed: 1, total: 2, start: 0, count: 2, options: { series: [...series] } });
    expect(drawBuffers(draws)).toHaveLength(2 * series.length);
    expect(draws.every((d) => isMemberEnvelope(d) && d.nDays === 6)).toBe(true);
  });
});

describe('A1-065: caller-fixed structural values hold in every streamed member exactly as in the direct ensemble', () => {
  it('an override of muscle.growthScenarioUnknown = 1 gives identical direct and chunked bands (members never revert to production)', () => {
    const params = buildModelParams(MODULES);
    const i = params.index.get('muscle.growthScenarioUnknown')!;
    expect(drawKindOf(params.defs[i]!)).toBe('fixed');
    const over = Float64Array.from(params.values);
    over[i] = 1;
    const s = sched(1.8);
    const e = simulateEnsemble(MAN, s, { draws: 4, seed: 7, series: ['leanTissue'], paramOverrides: over });
    const draws = [0, 2].flatMap((start) => simulateDrawChunk(MAN, s, { seed: 7, total: 4, start, count: 2, options: { series: ['leanTissue'], paramOverrides: over } }));
    const b = ensembleBands(e.nominal.daily, e.nominal.initial, draws);
    expect(Array.from(b.p50.leanTissue!)).toEqual(Array.from(e.p50.leanTissue!));
    const modes = simulateEnsemble(MAN, s, { draws: 4, seed: 7, series: ['leanTissue'], structuralModes: { 'muscle.growthScenarioUnknown': 1 } });
    const streamed = simulateDrawChunk(MAN, s, { seed: 7, total: 4, start: 0, count: 4, options: { series: ['leanTissue'], structuralModes: { 'muscle.growthScenarioUnknown': 1 } } });
    expect(Array.from(ensembleBands(modes.nominal.daily, modes.nominal.initial, streamed).p90.leanTissue!)).toEqual(Array.from(modes.p90.leanTissue!));
  });
});
