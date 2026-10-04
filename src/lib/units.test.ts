import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from './units';

describe('units', () => {
  it('round-trips mass', () => {
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 10);
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
  });
  it('converts height', () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, in: 11 });
    expect(ftInToCm(6, 0)).toBeCloseTo(182.88, 2);
  });
});
