// @vitest-environment node
/** Unit tests of the O-3 daily carbohydrate-balance oracle (dossier 04 §4.11). Runs for real; no engine involved. */
import { dailyFuelBalance, glycogenTauDays, steadyGlycogenG } from './dailyFuel';

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
