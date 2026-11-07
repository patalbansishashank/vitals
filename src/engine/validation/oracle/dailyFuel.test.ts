// @vitest-environment node
/** Unit tests of the O-3 daily carbohydrate-balance oracle (dossier 04 §4.11). Runs for real; no engine involved. */
import { dailyFuelBalance, glycogenTauDays, steadyGlycogenG } from './dailyFuel';
import { G_PER_MMOL } from '../../model/fuel';

const base = { gRefG: 500, ciHabG: 330, teeKcal: 2700, proteinOxG: 100 };

describe('daily fuel oracle (04 §4.11)', () => {
  it('worked example: G_ref 500 g, CI 330 → 150 g/d gives G_ss 337 g and τ ≈ 1.1 d', () => {
    expect(steadyGlycogenG(500, 330, 150)).toBeCloseTo(337, 0);
    expect(glycogenTauDays(500, 330, 150)).toBeGreaterThan(1.0);
    expect(glycogenTauDays(500, 330, 150)).toBeLessThan(1.2);
  });

  it('70 %E carbohydrate: glycogen +22 % at steady state (Tarry, Areta)', () => {
    // 70 %E of 2 700 kcal ≈ 470 g vs 330 g habitual ⇒ √(470/330) = 1.19; the dossier quotes +22 % for ≈525 g/d
    expect(steadyGlycogenG(500, 330, 525) / 500 - 1).toBeGreaterThan(0.2);
    expect(steadyGlycogenG(500, 330, 525) / 500 - 1).toBeLessThan(0.3);
  });

  it('habitual intake is a fixed point: glycogen, CHO and fat oxidation stay constant', () => {
    // the glycerol-derived glucose (10 % of fat oxidised) adds to the input, so the fixed point sits slightly above G_ref:
    // check the balance closes (ΔG ≈ 0 within the small GNG_gly term) rather than exact constancy
    const r = dailyFuelBalance({ ...base, ciG: 330, days: 7 });
    expect(Math.abs(r.gG[7]! - 500) / 500).toBeLessThan(0.15);
    for (let d = 1; d < 7; d++) expect(r.choOxG[d]!).toBeGreaterThan(300);
  });

  it('converges to the closed-form steady state (± GNG_gly) with the linearised τ and mass balance', () => {
    const ci = 150;
    const r = dailyFuelBalance({ ...base, ciG: ci, days: 30 });
    const gss = steadyGlycogenG(500, 330, ci);
    expect(Math.abs(r.gG[30]! - gss) / gss).toBeLessThan(0.2); // GNG_gly adds ≈ 27 g/d of input, lifting the fixed point
    // mass balance per day: ΔG = CI + 0.1·fat_ox − C_ox
    for (let d = 0; d < 30; d++) {
      const dG = r.gG[d + 1]! - r.gG[d]!;
      expect(dG).toBeCloseTo(ci + 0.1 * r.fatOxG[d]! - r.choOxG[d]!, 6);
    }
    // carbohydrate oxidation converges to intake (+ glycerol) and fat oxidation absorbs the rest
    expect(r.choOxG[29]!).toBeCloseTo(ci + 0.1 * r.fatOxG[29]!, 0);
  });

  it('energy identity: 4.1·C_ox + 9.44·FAT_ox + 4.7·P_ox = TEE every day', () => {
    const r = dailyFuelBalance({ ...base, ciG: 220, days: 7 });
    for (let d = 0; d < 7; d++) expect(4.1 * r.choOxG[d]! + 9.44 * r.fatOxG[d]! + 4.7 * base.proteinOxG).toBeCloseTo(base.teeKcal, 6);
  });

  it('carbohydrate oxidation is capped by the energy available', () => {
    const r = dailyFuelBalance({ ...base, ciG: 900, days: 10 });
    for (let d = 0; d < 10; d++) expect(r.choOxG[d]!).toBeLessThanOrEqual(base.teeKcal / 4.1 + 1e-6);
  });

  it('keto adaptation lowers carbohydrate oxidation at a given glycogen (×(1 − 0.75 A))', () => {
    const a = dailyFuelBalance({ ...base, ciG: 20, days: 5, ketoAdapt: 0 });
    const b = dailyFuelBalance({ ...base, ciG: 20, days: 5, ketoAdapt: 1 });
    expect(b.gG[5]!).toBeGreaterThan(a.gG[5]!);
  });
});

/**
 * D2-04 diagnostics (production solver replacement deferred): the carbohydrate currencies the engine and this oracle use are
 * declared, distinct and not interchangeable. Free glucose C6H12O6 is 0.180 g/mmol; a glycogen glucosyl unit C6H10O5 is
 * 0.162 g/mmol (one water of hydrolysis less); 4/4.207 = 0.9508 is an ENERGY conversion between nutritional carbohydrate
 * conventions, not carbon stoichiometry. A residual carbon flux nobody measured is unsupported, not a fitted zero.
 */
describe('carbohydrate currency (D2-04 diagnostics)', () => {
  const GLUCOSE_G_PER_MMOL = 180.156 / 1000;
  const GLUCOSYL_G_PER_MMOL = 162.141 / 1000;

  it('the engine stores glycogen in anhydro-glucosyl units (0.162 g/mmol), not free glucose (0.180 g/mmol)', () => {
    expect(G_PER_MMOL).toBeCloseTo(GLUCOSYL_G_PER_MMOL, 3);
    expect(Math.abs(G_PER_MMOL - GLUCOSE_G_PER_MMOL)).toBeGreaterThan(0.015);
    // one mmol of glycogen glucosyl hydrolyses to one mmol of glucose: 1.111 g of glucose per g of glycogen
    expect(GLUCOSE_G_PER_MMOL / GLUCOSYL_G_PER_MMOL).toBeCloseTo(1.111, 3);
  });

  it('the 4/4.207 energy conversion is not the glucose/glucosyl mass ratio (energy and carbon ledgers stay separate)', () => {
    const energyRatio = 4 / 4.207;
    const massRatio = GLUCOSYL_G_PER_MMOL / GLUCOSE_G_PER_MMOL;
    expect(energyRatio).toBeCloseTo(0.9508, 4);
    expect(massRatio).toBeCloseTo(0.9, 3);
    expect(Math.abs(energyRatio - massRatio)).toBeGreaterThan(0.04);
  });

  it('the oracle closes its own energy ledger in kcal (a conditional dynamics reference, not a carbon balance)', () => {
    const r = dailyFuelBalance({ ...base, ciG: 150, days: 5 });
    for (let d = 0; d < 5; d++) expect(4.1 * r.choOxG[d]! + 9.44 * r.fatOxG[d]! + 4.7 * base.proteinOxG).toBeCloseTo(base.teeKcal, 6);
  });
});
