import { describe, expect, it } from 'vitest';
import { computeNightSignal, illnessDefs, nightSignalStep, nsAlert, nsSymbol, type NsState } from '../illness';
import { RHR_ID } from '../rhr';
import { addDays, median } from '../util';
import { dates, mkInput, mkPrior, rng } from '../__fixtures__/physio';

describe('NightSignal DFA (nightsignal.py / NightSignal_DFA.png)', () => {
  const table: Array<[NsState, 'a' | 'b' | 'c', NsState]> = [
    ['S0', 'a', 'S0'], ['S0', 'b', 'S1'], ['S0', 'c', 'S2'],
    ['S1', 'a', 'S0'], ['S1', 'b', 'S3'], ['S1', 'c', 'S4'],
    ['S2', 'a', 'S0'], ['S2', 'b', 'S3'], ['S2', 'c', 'S5'],
    ['S3', 'a', 'S0'], ['S3', 'b', 'S3'], ['S3', 'c', 'S4'],
    ['S4', 'a', 'S0'], ['S4', 'b', 'S3'], ['S4', 'c', 'S5'],
    ['S5', 'a', 'S0'], ['S5', 'b', 'S3'], ['S5', 'c', 'S5'],
  ];
  it.each(table)('%s --%s--> %s', (from, sym, to) => expect(nightSignalStep(from, sym)).toBe(to));

  it('state colours and symbols', () => {
    expect(['S0', 'S1', 'S2'].map((s) => nsAlert(s as NsState))).toEqual(['green', 'green', 'green']);
    expect(nsAlert('S3')).toBe('yellow');
    expect(nsAlert('S4')).toBe('yellow');
    expect(nsAlert('S5')).toBe('red');
    expect([nsSymbol(62, 60), nsSymbol(63, 60), nsSymbol(64, 60), nsSymbol(70, 60)]).toEqual(['a', 'b', 'c', 'c']);
  });
});

describe('computeNightSignal', () => {
  const run = (vals: number[], start = '2026-08-01') => computeNightSignal(vals.map((a, i) => ({ date: addDays(start, i), a })));

  it('red after two consecutive nights ≥ M+4; one night stays green', () => {
    const r = run([60, 60, 60, 60, 60, 60, 60, 64, 64, 63, 50]);
    expect(r.map((x) => x.state).slice(7)).toEqual(['S2', 'S5', 'S3', 'S0']);
    expect(r.map((x) => x.alert).slice(7)).toEqual(['green', 'red', 'yellow', 'green']);
    expect(r[8]!.m).toBe(60);
  });

  it('yellow after two consecutive nights at M+3', () => {
    const r = run([60, 60, 60, 60, 60, 60, 60, 63, 63]);
    expect(r.slice(7).map((x) => x.state)).toEqual(['S1', 'S3']);
  });

  it('median includes the current night and is truncated', () => {
    const r = run([60, 61]);
    expect(r[1]!.m).toBe(60); // int(60.5)
  });

  it('imputes a single missing night as floor of the neighbours (Fitbit branch)', () => {
    const r = computeNightSignal([
      { date: '2026-08-01', a: 60 },
      { date: '2026-08-02', a: 61 },
      { date: '2026-08-04', a: 64 },
    ]);
    expect(r.map((x) => [x.date, x.a, x.imputed])).toEqual([
      ['2026-08-01', 60, false],
      ['2026-08-02', 61, false],
      ['2026-08-03', 62, true],
      ['2026-08-04', 64, false],
    ]);
  });

  it('a gap of ≥2 nights restarts at S0', () => {
    const r = computeNightSignal([
      ...dates('2026-08-01', 7).map((date) => ({ date, a: 60 })),
      { date: '2026-08-08', a: 65 },
      { date: '2026-08-11', a: 65 },
    ]);
    expect(r.map((x) => x.state).slice(-2)).toEqual(['S2', 'S2']);
  });

  it('matches the published pairwise code on random sequences', () => {
    const rand = rng(7);
    for (let rep = 0; rep < 50; rep++) {
      const vals = Array.from({ length: 40 }, () => 55 + Math.floor(rand() * 12));
      const r = run(vals);
      // Python logic: potential red A ≥ M+4, potential yellow A ≥ M+3, alert on the 2nd of consecutive potentials.
      const meds = vals.map((_, i) => Math.trunc(median(vals.slice(0, i + 1))));
      const pr = vals.map((a, i) => a >= meds[i]! + 4);
      const py = vals.map((a, i) => a >= meds[i]! + 3);
      const expected = vals.map((_, i) => (i > 0 && pr[i] && pr[i - 1] ? 'red' : i > 0 && py[i] && py[i - 1] ? 'yellow' : 'green'));
      expect(r.map((x) => x.alert)).toEqual(expected);
    }
  });
});

describe('illness.nightsignal score', () => {
  const def = illnessDefs[0]!;
  const D = '2026-09-20';
  const prior = (vals: number[]) =>
    vals.map((a, i) => mkPrior(RHR_ID, addDays(D, i - vals.length + 1), a + 0.4, { ns_avg_bpm: a, sourceKey: 'ring' }));

  it('insufficient baseline below 7 nights; withheld with no overnight HR', () => {
    expect(def.compute(mkInput(D, { prior: { [RHR_ID]: prior([60, 60, 60, 60, 60, 60]) } })).status).toBe('insufficient_baseline');
    expect(def.compute(mkInput(D)).status).toBe('withheld');
  });

  it('red state with detail; corroborators exposed but do not change the state', () => {
    const r = def.compute(
      mkInput(D, {
        prior: {
          [RHR_ID]: prior([60, 60, 60, 60, 60, 60, 60, 64, 64]),
          'temp.deviation': [mkPrior('temp.deviation', D, 0.5)],
        },
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.state).toBe('red');
    expect(r.value).toBe(2);
    expect(r.detail).toMatchObject({ fsm: 'S5', a_bpm: 64, median_bpm: 60, corr_temp_up: true, corr_hrv_down: null, proposed_composite: 'red' });
  });

  it('yellow + temp_up is proposed red but NightSignal state stays yellow', () => {
    const r = def.compute(mkInput(D, { prior: { [RHR_ID]: prior([60, 60, 60, 60, 60, 60, 60, 63, 63]), 'temp.deviation': [mkPrior('temp.deviation', D, 0.6)] } }));
    expect(r.state).toBe('yellow');
    expect(r.detail?.proposed_composite).toBe('red');
  });

  it('is deterministic', () => {
    const i = () => mkInput(D, { prior: { [RHR_ID]: prior([58, 60, 61, 60, 59, 60, 62, 60]) } });
    expect(def.compute(i())).toEqual(def.compute(i()));
  });
});
