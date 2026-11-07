// @vitest-environment node
import { simulateEnsemble, type PersonProfile, type Schedule } from '@/engine';
import { ensembleBands, isMemberEnvelope, type BandMember } from '@/engine/core/bands';
import { simulateDrawChunk } from './simulationDraws';

/** The fat-mass band input of a streamed member (an envelope since A1-049). */
const fat = (m: BandMember): number[] => Array.from((isMemberEnvelope(m) ? m.daily : m).fatMass!);

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 88 }, startDate: '2026-10-05' };
const SCHED: Schedule = {
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: 8,
  programs: [{ id: 'A', label: 'a', energy: { kind: 'pctMaintenance', pct: 80 }, macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } } }],
  days: Array.from({ length: 8 }, () => ({ program: 0 })),
};
const series = ['fatMass', 'ldl'] as const;

describe('simulator draw chunks (D8-02)', () => {
  it('chunks are slices of one seeded hypercube, whatever the chunk size', () => {
    const all = simulateDrawChunk(MAN, SCHED, { seed: 4, total: 6, start: 0, count: 6, options: { series: [...series] } });
    const parts = [0, 2, 4].flatMap((start) => simulateDrawChunk(MAN, SCHED, { seed: 4, total: 6, start, count: 2, options: { series: [...series] } }));
    expect(parts.map(fat)).toEqual(all.map(fat));
    expect(simulateDrawChunk(MAN, SCHED, { seed: 4, total: 6, start: 6, count: 4 })).toEqual([]);
  });

  it('change series stream as each member’s change from its own t = 0; streamed bands equal simulateEnsemble', () => {
    const members = simulateDrawChunk(MAN, SCHED, { seed: 4, total: 5, start: 0, count: 5, options: { series: [...series] } });
    const e = simulateEnsemble(MAN, SCHED, { draws: 5, seed: 4, series: [...series] });
    const b = ensembleBands(e.nominal.daily, e.nominal.initial, members);
    for (const id of series) {
      expect(Array.from(b.p10[id]!)).toEqual(Array.from(e.p10[id]!));
      expect(Array.from(b.p90[id]!)).toEqual(Array.from(e.p90[id]!));
    }
    // the nominal is not a member: its own trajectory never enters the band inputs
    expect(members).toHaveLength(5);
    expect(b.bandMeta.ldl).toMatchObject({ endpoint: 'deltaRebasedOnNominal', nominalInQuantiles: false, coverage: 'unvalidated' });
  });
});
