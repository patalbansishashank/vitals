import { partitionSubcutaneousShell, type ShellPartition } from '../subcutaneousShell';

const outer = new Float32Array([
  10,
  100,
  5, // abdominal wall
  25,
  100,
  5, // arm at the same height
  10,
  150,
  5, // chest/head height
  10,
  100,
  25, // outside the waist ellipse
  10,
  80,
  5, // upper thigh
]);
const lean = new Float32Array([8, 100, 4, 23, 100, 4, 8, 150, 4, 8, 100, 24, 8, 80, 4]);

function shell(visceralKg: number, trunkSatKg: number) {
  const inner = lean.slice();
  const args: ShellPartition = {
    outer,
    inner,
    heightCm: 180,
    waistHalfWidthCm: 15,
    waistHalfDepthCm: 10,
    waistCentreZCm: 0,
    visceralKg,
    trunkSatKg,
    trunkShares: { abdominal: 0.45, backFlank: 0.35 },
  };
  partitionSubcutaneousShell(args);
  return inner;
}

describe('illustrative subcutaneous shell partition', () => {
  it('moves only the inner abdominal boundary when visceral fat rises', () => {
    const before = outer.slice();
    const low = shell(2, 10);
    const high = shell(8, 10);
    expect(high[0]).toBeGreaterThan(low[0]!);
    expect(high[2]).toBeGreaterThan(low[2]!);
    expect(outer).toEqual(before);
    for (let i = 3; i < lean.length; i++) expect(high[i]).toBe(lean[i]);
  });

  it('widens the under-skin band as regional subcutaneous fat rises', () => {
    const lowSat = shell(5, 4);
    const highSat = shell(5, 16);
    expect(highSat[0]).toBeLessThan(lowSat[0]!);
    expect(outer[0]! - highSat[0]!).toBeGreaterThan(outer[0]! - lowSat[0]!);
  });

  it('leaves the lean boundary intact with no visceral fat', () => {
    expect(shell(0, 10)).toEqual(lean);
  });
});
