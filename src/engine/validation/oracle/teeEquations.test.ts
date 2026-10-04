// @vitest-environment node
/** The TEE oracles reproduce dossier 02 §4.12's worked numbers (independent of the engine). */
import { iaeaTee, nasemTee } from './teeEquations';

describe('TEE equation oracles (02 §4.12)', () => {
  it('IAEA: 90 kg, 180 cm, 35-y white man → 13.63 MJ = 3 258 kcal/d, 95 % PI 2 064-5 025 kcal/d', () => {
    const r = iaeaTee('male', 35, 180, 90);
    expect(Math.abs(r.tee - 3258)).toBeLessThan(3);
    expect(Math.abs(r.lo - 2064)).toBeLessThan(3);
    expect(Math.abs(r.hi - 5025)).toBeLessThan(3);
  });

  it('NASEM: R1 §1 table (M 35 y 180 cm 90 kg: 2 813 / 3 041 / 3 231; F 35 y 165 cm 65 kg: 2 044 / 2 209 / 2 346)', () => {
    expect(nasemTee('male', 35, 180, 90, 'inactive')).toBeCloseTo(2813, -1);
    expect(nasemTee('male', 35, 180, 90, 'lowActive')).toBeCloseTo(3041, -1);
    expect(nasemTee('male', 35, 180, 90, 'active')).toBeCloseTo(3231, -1);
    expect(Math.abs(nasemTee('female', 35, 165, 65, 'inactive') - 2044)).toBeLessThan(1);
    expect(Math.abs(nasemTee('female', 35, 165, 65, 'lowActive') - 2209)).toBeLessThan(1);
    expect(Math.abs(nasemTee('female', 35, 165, 65, 'active') - 2346)).toBeLessThan(1);
  });
});
