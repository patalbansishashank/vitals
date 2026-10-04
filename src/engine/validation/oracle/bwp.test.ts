// @vitest-environment node
/**
 * Unit tests of the Hall 2011 / NIDDK Body Weight Planner oracle port (dossier 01 §4.2, §4.12, §7.11).
 * These run for real: they do not touch the engine. Reference numbers marked PY come from running the dossier's own
 * Python listing (§4.12; Euler, dt = 0.05 d) — the port must reproduce them, and the dossier's printed worked-example
 * numbers, before it is allowed to act as an oracle for the engine.
 */
import {
  BWP,
  BWP_WORKED_EXAMPLE,
  bwpDerivatives,
  bwpLinearised,
  bwpSteadyStateDeltaBw,
  bwpWeight,
  initBwp,
  jacksonFatKg,
  mifflinMj,
  simulateBwp,
  simulateBwpKcal,
  workedExampleIntake,
  type BwpInput,
} from './bwp';

const W = BWP_WORKED_EXAMPLE;
const man100: BwpInput = W.input;

describe('BWP port: initial conditions (dossier 01 §4.2.3-4.2.4)', () => {
  it('Jackson fat mass and Mifflin RMR for the worked example man', () => {
    expect(jacksonFatKg('male', 100, 1.8, 23)).toBeCloseTo(27.2383, 3); // PY t0 F
    expect(mifflinMj('male', 100, 1.8, 23)).toBeCloseTo(8.431, 3);
    const init = initBwp(man100);
    expect(init.ei0Mj).toBeCloseTo(12.65, 2); // dossier: baseline 12.65 MJ/d
    expect(init.delta).toBeCloseTo(0.0295, 3); // sedentary delta ≈ 30 kJ/kg/d
    expect(init.f0 + init.l0 + init.g0 * (1 + BWP.hG) + init.ecf0).toBeCloseTo(100, 12);
  });

  it('female Jackson equation uses its own coefficients', () => {
    expect(jacksonFatKg('female', 80, 1.65, 40)).toBeCloseTo(30.9391, 3); // PY
  });

  it('a supplied EI0 sets PAL = EI0/RMR and K still gives EE(0) = EI0', () => {
    const init = initBwp({ ...man100, baselineEiMj: 11 });
    expect(init.pal).toBeCloseTo(11 / init.rmrMj, 12);
    const out = new Float64Array(5);
    const ee = bwpDerivatives(init, [init.f0, init.l0, init.g0, init.ecf0, 0], 11, out);
    expect(ee).toBeCloseTo(11, 12);
  });
});

describe('BWP port: identities of the closed form (Eq. 3, 5, 9)', () => {
  it('EI − EE = ρF·dF + ρL·dL + ρG·dG and EE contains η_F·dF + η_L·dL at every visited state', () => {
    const init = initBwp(man100);
    const tr = simulateBwp(init, workedExampleIntake(400), { days: 400 });
    const out = new Float64Array(5);
    for (let d = 0; d < 400; d += 7) {
      const x = [tr.fatKg[d]!, tr.leanKg[d]!, tr.glycogenKg[d]!, tr.ecfKg[d]!, tr.atMj[d]!];
      const ei = tr.eiMj[d]!;
      const ee = bwpDerivatives(init, x, ei, out);
      const [dF, dL, dG] = [out[0]!, out[1]!, out[2]!];
      expect(ei - ee).toBeCloseTo(BWP.rhoF * dF + BWP.rhoL * dL + BWP.rhoG * dG, 10);
      const dEi = ei - init.ei0Mj;
      const eq5 =
        init.k + BWP.gammaF * x[0]! + BWP.gammaL * x[1]! + init.delta * bwpWeight(x) + BWP.betaTEF * dEi + x[4]! + BWP.etaL * dL + BWP.etaF * dF;
      expect(ee).toBeCloseTo(eq5, 10);
    }
  });

  it('weight-stable intake keeps every compartment constant (steady state)', () => {
    for (const sex of ['male', 'female'] as const) {
      const init = initBwp({ sex, weightKg: 85, heightM: 1.72, ageYears: 40 });
      const tr = simulateBwp(init, new Float64Array(365).fill(init.ei0Mj));
      expect(tr.bwKg[365]!).toBeCloseTo(85, 10);
      expect(tr.fatKg[365]!).toBeCloseTo(init.f0, 10);
      expect(tr.glycogenKg[365]!).toBeCloseTo(0.5, 10);
      expect(tr.eeMj[365]!).toBeCloseTo(init.ei0Mj, 10);
    }
  });
});

describe('BWP port: paper worked example and dossier reimplementation check (§4.2.6)', () => {
  const init = initBwp(man100);
  const rk4 = simulateBwp(init, workedExampleIntake(730));
  const euler = simulateBwp(init, workedExampleIntake(730), { method: 'euler', dtDays: 0.05 });

  it('reproduces the dossier Python listing with its own scheme (Euler dt 0.05): PY 79.9579 / 80.7288 / 80.6845 kg', () => {
    expect(euler.bwKg[180]!).toBeCloseTo(79.9579, 3);
    expect(euler.bwKg[365]!).toBeCloseTo(80.7288, 3);
    expect(euler.bwKg[730]!).toBeCloseTo(80.6845, 3);
    expect(euler.fatKg[180]!).toBeCloseTo(14.611, 3);
    expect(euler.leanKg[180]!).toBeCloseTo(44.4347, 3);
  });

  it('−5 MJ/d for 180 d → ≈80 kg, then 10.9 MJ/d holds it at 80-81 kg (paper worked example)', () => {
    expect(rk4.bwKg[W.deficitDays]!).toBeGreaterThan(79.7);
    expect(rk4.bwKg[W.deficitDays]!).toBeLessThan(80.3);
    expect(Math.abs(rk4.bwKg[180]! - W.bwAt180Kg)).toBeLessThan(0.05);
    for (const d of [365, 500, 730]) {
      expect(rk4.bwKg[d]!).toBeGreaterThan(80.2);
      expect(rk4.bwKg[d]!).toBeLessThan(81.2);
    }
    expect(Math.abs(rk4.bwKg[365]! - W.bwAt365Kg)).toBeLessThan(0.1);
    // the "hold" intake really is (near) maintenance of the reduced body: EE ≈ 10.9 MJ/d
    expect(Math.abs(rk4.eeMj[730]! - W.holdMj)).toBeLessThan(0.05);
  });

  it('the RK4 scheme agrees with the Python Euler scheme within 0.02 kg and is converged (dt 1/8 vs 1/32)', () => {
    for (const d of [7, 30, 90, 180, 365, 730]) expect(Math.abs(rk4.bwKg[d]! - euler.bwKg[d]!)).toBeLessThan(0.02);
    const fine = simulateBwp(init, workedExampleIntake(730), { dtDays: 1 / 32 });
    for (const d of [7, 180, 365, 730]) expect(Math.abs(rk4.bwKg[d]! - fine.bwKg[d]!)).toBeLessThan(5e-4);
  });

  it('first week: 1.83 kg = 0.11 kg glycogen + 0.30 kg glycogen water + 0.53 kg ECF (+ tissue)', () => {
    const fw = W.firstWeek;
    expect(100 - rk4.bwKg[7]!).toBeCloseTo(fw.lossKg, 1);
    const dG = init.g0 - rk4.glycogenKg[7]!;
    expect(dG).toBeCloseTo(fw.glycogenKg, 2);
    expect(dG * BWP.hG).toBeCloseTo(fw.glycogenWaterKg, 2);
    expect(init.ecf0 - rk4.ecfKg[7]!).toBeCloseTo(fw.ecfKg, 2);
  });

  it('permanent −2 MJ/d: 87.1 kg at 1 y, 79.3 kg at 3 y, ≈78 kg plateau; 94-95 % of the final change by 3 y (§7.11)', () => {
    const tr = simulateBwp(init, new Float64Array(3650).fill(W.baselineMj - 2));
    const m = W.minus2Mj;
    expect(tr.bwKg[365]!).toBeCloseTo(m.bw1y, 0);
    expect(Math.abs(tr.bwKg[365]! - 87.05)).toBeLessThan(0.05); // PY 87.0531
    expect(Math.abs(tr.bwKg[1095]! - 79.33)).toBeLessThan(0.05); // PY 79.3327
    expect(Math.abs(tr.bwKg[3650]! - 78.14)).toBeLessThan(0.05); // PY 78.1407
    const frac = (100 - tr.bwKg[1095]!) / (100 - tr.bwKg[3650]!);
    expect(frac).toBeGreaterThan(0.94);
    expect(frac).toBeLessThan(0.955);
    // paper plateau "about 75 kg": the dossier documents a ≈3 kg unexplained gap (78.1 vs 75); 75-78 kg range of §7.11
    expect(tr.bwKg[3650]!).toBeGreaterThan(m.paperPlateauKg);
    expect(tr.bwKg[3650]! - m.paperPlateauKg).toBeLessThan(m.plateauTolKg + 0.5);
  });

  it('long-run steady state satisfies Eq. 18 with the realised Φ = dF/dBW', () => {
    const tr = simulateBwp(init, new Float64Array(3650).fill(W.baselineMj - 2));
    const dBw = tr.bwKg[3650]! - 100;
    const phi = (tr.fatKg[3650]! - init.f0) / dBw;
    const predicted = bwpSteadyStateDeltaBw(-2, init.delta, phi);
    expect(Math.abs(predicted - dBw)).toBeLessThan(0.6); // small ECF/glycogen contribution to δ·BW not in Eq. 18
    expect(phi).toBeGreaterThan(0.55); // fat is ≈ 64 % of the plateau weight change (Forbes C/F with F0 = 27 kg)
    expect(phi).toBeLessThan(0.8);
  });
});

describe('BWP port: other regression trajectories vs the Python listing (PY)', () => {
  const near = (a: number, b: number, tol = 0.02): void => expect(Math.abs(a - b)).toBeLessThan(tol);

  it('woman 80 kg, 1.65 m, 40 y, −25 % of maintenance', () => {
    const init = initBwp({ sex: 'female', weightKg: 80, heightM: 1.65, ageYears: 40 });
    const tr = simulateBwp(init, new Float64Array(365).fill(0.75 * init.ei0Mj));
    near(tr.bwKg[7]!, 79.0256);
    near(tr.bwKg[182]!, 70.8931);
    near(tr.bwKg[365]!, 64.8068);
    near(tr.fatKg[365]!, 20.5714);
  });

  it('man 90 kg, 1.80 m, 35 y, +20 % of maintenance for 1 y', () => {
    const init = initBwp({ sex: 'male', weightKg: 90, heightM: 1.8, ageYears: 35 });
    const tr = simulateBwp(init, new Float64Array(365).fill(1.2 * init.ei0Mj));
    near(tr.bwKg[7]!, 90.8778);
    near(tr.bwKg[90]!, 95.2167);
    near(tr.bwKg[182]!, 99.0377);
    near(tr.bwKg[365]!, 104.6984);
    near(tr.fatKg[365]!, 32.814);
  });

  it('man 90 kg, −500 kcal/d for 1 y (kcal wrapper)', () => {
    const init = initBwp({ sex: 'male', weightKg: 90, heightM: 1.8, ageYears: 35 });
    const kcal = new Float64Array(365).fill(init.ei0Mj * BWP.kcalPerMj - 500);
    const tr = simulateBwpKcal(init, kcal);
    near(tr.bwKg[90]!, 85.1832);
    near(tr.bwKg[182]!, 81.5464);
    near(tr.bwKg[365]!, 76.237);
  });

  it('woman 72 kg, 1.65 m, 42 y, −25 % (spec §9.3 WOMAN reference body without measured fat)', () => {
    const init = initBwp({ sex: 'female', weightKg: 72, heightM: 1.65, ageYears: 42 });
    const tr = simulateBwp(init, new Float64Array(365).fill(0.75 * init.ei0Mj));
    near(tr.bwKg[90]!, 66.9559);
    near(tr.bwKg[182]!, 63.2053);
    near(tr.bwKg[365]!, 57.5818);
  });
});

describe('BWP port: fast compartments (web appendix Eqs. 1-2)', () => {
  it('glycogen approaches G0·√(CI/CIb) with τ_G = ρG·G0/(2·CIb) ≈ 0.70 d', () => {
    const init = initBwp({ sex: 'male', weightKg: 100, heightM: 1.8, ageYears: 23, baselineEiMj: 12.6 });
    expect(BWP.rhoG * init.g0 / (2 * init.ciBaseMj)).toBeCloseTo(0.7, 2);
    const tr = simulateBwp(init, new Float64Array(30).fill(1.5 * init.ei0Mj));
    expect(tr.glycogenKg[30]!).toBeCloseTo(0.5 * Math.sqrt(1.5), 4);
    // linear regime (deviation < 1 % of its start): e-folding with the τ_G linearised at the NEW steady state,
    // τ = ρG·G0²/(2·CIb·G_ss) (the quadratic sink is stiffer at higher glycogen)
    const gss = 0.5 * Math.sqrt(1.5);
    const tauSs = (BWP.rhoG * init.g0 * init.g0) / (2 * init.ciBaseMj * gss);
    const r = (gss - tr.glycogenKg[8]!) / (gss - tr.glycogenKg[7]!);
    expect(r).toBeGreaterThan(Math.exp(-1 / tauSs) * 0.97);
    expect(r).toBeLessThan(Math.exp(-1 / tauSs) * 1.03);
  });

  it('a 40 % carbohydrate cut removes ≈0.11 kg glycogen + 0.31 kg water + ≈0.5 L ECF within days', () => {
    const init = initBwp({ sex: 'male', weightKg: 100, heightM: 1.8, ageYears: 23, baselineEiMj: 12.65 });
    const tr = simulateBwp(init, new Float64Array(10).fill(0.6 * init.ei0Mj));
    const dG = init.g0 - tr.glycogenKg[10]!;
    expect(dG).toBeGreaterThan(0.1);
    expect(dG).toBeLessThan(0.12);
    expect(dG * BWP.hG).toBeCloseTo(0.3, 1);
  });
});

describe('BWP port: linearised dynamics (Eqs. 10-18) vs the dossier table (sedentary δ = 0.030 MJ/kg/d)', () => {
  // F0 (kg) → tissue energy density MJ/kg, tau d, eps kJ/kg/d
  const rows: [number, number, number, number][] = [
    [5, 18.0, 196, 127],
    [10, 23.2, 289, 110],
    [20, 28.6, 420, 92],
    [30, 31.3, 507, 83],
    [40, 32.9, 568, 78],
    [60, 34.8, 651, 72],
  ];
  it.each(rows)('F0 = %d kg', (f0, dens, tau, epsKj) => {
    const lin = bwpLinearised(f0, 0.03);
    expect(lin.tissueDensityMj).toBeCloseTo(dens, 1);
    expect(Math.abs(lin.tau - tau)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(lin.eps * 1000 - epsKj)).toBeLessThanOrEqual(1);
    expect(lin.rho / lin.eps).toBeCloseTo(lin.tau, 6);
  });

  it('rule of thumb: 100 kJ/d sustained → ≈ 1 kg eventual weight change (population slope 100 kJ/kg/d)', () => {
    const init = initBwp({ sex: 'male', weightKg: 90, heightM: 1.8, ageYears: 35 });
    const dEiMj = 0.1;
    const tr = simulateBwp(init, new Float64Array(3650).fill(init.ei0Mj + dEiMj));
    const d = tr.bwKg[3650]! - 90;
    expect(d).toBeGreaterThan(0.7);
    expect(d).toBeLessThan(1.6);
  });
});

describe('BWP port: input validation', () => {
  it('rejects a step that does not divide one day', () => {
    expect(() => simulateBwp(man100, [12.65, 12.65], { dtDays: 0.3 })).toThrow();
  });
  it('function-form intake works and equals the array form for a step function aligned on the grid', () => {
    const a = simulateBwp(man100, workedExampleIntake(300), { days: 300 });
    const b = simulateBwp(man100, (t) => (t < 180 ? 7.65 : 10.9), { days: 300 });
    expect(Math.abs(a.bwKg[300]! - b.bwKg[300]!)).toBeLessThan(1e-9);
  });
});
