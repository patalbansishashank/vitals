import { describe, expect, it } from 'vitest';
import { LOAD_ID, overreachingDefs } from '../overreaching';
import { STATUS_ID, STRAIN_ID } from '../hrv';
import { NS_ID } from '../illness';
import { addDays } from '../util';
import { mkInput, mkPrior } from '../__fixtures__/physio';

const def = overreachingDefs[0]!;
const D = '2026-09-20';
const days7 = (id: string, states: string[]) => states.map((s, k) => mkPrior(id, addDays(D, -k), 0, {}, { state: s, scope: { kind: 'day', localDate: addDays(D, -k) } }));
const load = (a7: number, a28: number) => [mkPrior(LOAD_ID, D, a7, { a7, a28 }, { scope: { kind: 'day', localDate: D } })];

describe('overreaching.flag', () => {
  const strain5 = days7(STRAIN_ID, ['strain_accumulating', 'strain_accumulating', 'none', 'strain_accumulating', 'strain_accumulating', 'none', 'strain_accumulating']);

  it('strain on 5 of 7 days with A7/A28 > 1 flags', () => {
    const r = def.compute(mkInput(D, { prior: { [STRAIN_ID]: strain5, [LOAD_ID]: load(120, 100) } }));
    expect(r.state).toBe('possible_overreaching');
    expect(r.detail).toMatchObject({ strain_days: 5, acwr: 1.2, branch_strain_load: true });
  });

  it('no flag when load ratio ≤ 1, load missing, or illness red', () => {
    expect(def.compute(mkInput(D, { prior: { [STRAIN_ID]: strain5, [LOAD_ID]: load(90, 100) } })).value).toBe(0);
    expect(def.compute(mkInput(D, { prior: { [STRAIN_ID]: strain5 } })).detail?.load_available).toBe(false);
    const red = [mkPrior(NS_ID, D, 2, {}, { state: 'red' })];
    expect(def.compute(mkInput(D, { prior: { [STRAIN_ID]: strain5, [LOAD_ID]: load(120, 100), [NS_ID]: red } })).value).toBe(0);
  });

  it('HRV below for 7 consecutive days flags; 6 does not', () => {
    expect(def.compute(mkInput(D, { prior: { [STATUS_ID]: days7(STATUS_ID, Array(7).fill('below')) } })).state).toBe('possible_overreaching');
    expect(def.compute(mkInput(D, { prior: { [STATUS_ID]: days7(STATUS_ID, [...Array(6).fill('below'), 'within']) } })).state).toBe('none');
  });

  it('withheld without enough HRV results', () => {
    expect(def.compute(mkInput(D)).status).toBe('withheld');
  });
});
