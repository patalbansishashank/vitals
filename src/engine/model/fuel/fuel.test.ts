// @vitest-environment node
/**
 * Unit tests of the fuel module's equations (MODEL_SPEC §1.6; dossier 04), driven directly with hand-built bus values.
 * Worked numbers come from 04 §4.1-4.8, §4.13, §4.22 and 20 §4.3.1.
 */
import { validateParamDefs } from '../../core/paramsRegistry';
import { SIGNAL_DEFS } from '../../types/signals';
import { SERIES } from '../../types/metrics';
import { fuelModule, muscleGlycogenG, startFuelDay, stepFuelHour, G_LEGS, G_ARMS, G_TRUNK, G_PER_MMOL, type FuelState } from './index';
import { FUEL_PARAMS } from './params';
import { makeRig, runDays, threeMeals, type Rig } from './testHarness';
import type { SignalBus } from '../../types/signals';

/** Registry muscle-glycogen capacity c_M,max (mmol/kg ww; 180 since the final round, 04's value 200). */
const C_M_MAX = FUEL_PARAMS.find((p) => p.id === 'fuel.cMMax')!.value;

const RHO_G = 4.207;
/** exp(−1 h/τ_L) at the registry value of τ_L (20 h since the integrator A2 calibration; 04 §4.2 value 24 h). */
const TAU_L = FUEL_PARAMS.find((p) => p.id === 'fuel.tauL')!.value;
const LN24 = Math.exp(-1 / TAU_L);

/** Put the bus into a neutral post-absorptive state, then apply `patch` and step one hour. */
function step(rig: Rig, patch: Partial<SignalBus> = {}, sets?: number[]): void {
  const b = rig.bus;
  b.raGlcGH = 0;
  b.raFruGalGH = 0;
  b.raProtGH = 0;
  b.alcOxGH = 0;
  b.insulinUuMl = 7;
  b.teePreKcalH = 100;
  b.exIntensityFrac = 0;
  b.exMinutesH = 0;
  b.exActiveMuscleKg = 0;
  b.ketoAdaptFast = 0;
  b.brainKetoneShare = 0;
  b.leanRateKgD = 0;
  b.fastActive = 0;
  b.fastProtOxGH = 0;
  Object.assign(b, patch);
  rig.hour.rtSetsByRegion.fill(0);
  rig.hour.rtSetsTotal = 0;
  if (sets) {
    sets.forEach((v, i) => (rig.hour.rtSetsByRegion[i] = v));
    rig.hour.rtSetsTotal = sets.reduce((a, x) => a + x, 0);
  }
  stepFuelHour(rig.s, rig.k, b, rig.hour, rig.t, { emit: (type, hour, value) => void rig.events.push({ type, hour, value }) });
  rig.t++;
}

const setC = (s: FuelState, c: number) => s.cM.fill(c);
const cSmm = (s: FuelState) => s.smmKg.reduce((a, x) => a + x, 0);

describe('fuel: registry and contract', () => {
  it('declares valid, prefixed, sourced parameters', () => {
    expect(validateParamDefs([fuelModule as never])).toEqual([]);
    for (const p of FUEL_PARAMS) {
      expect(p.id.startsWith('fuel.')).toBe(true);
      expect(p.status).toBeDefined();
      expect(p.source).toMatch(/\d{4}/);
    }
  });

  it('writes exactly the signals the contract assigns to fuel and records only its own series', () => {
    const owned = SIGNAL_DEFS.filter((d) => d.writer === 'fuel').map((d) => d.name).sort();
    expect([...fuelModule.writes].sort()).toEqual(owned);
    for (const id of fuelModule.records) expect(SERIES.find((x) => x.id === id)!.owner).toBe('fuel');
    for (const r of fuelModule.reads) expect(SIGNAL_DEFS.find((d) => d.name === r)!.readers).toContain('fuel');
  });
});

describe('fuel: initialisation (04 §2, §4.1)', () => {
  it('liver from the body module, capacity c_L,max·V_liv·0.162, muscle from the Areta regression', () => {
    const rig = makeRig({ vo2max: 45 });
    const s = rig.s;
    expect(s.gLMaxG).toBeCloseTo(500 * 1.45 * 0.162, 10); // 117.45 g
    expect(s.liverG).toBeCloseTo(Math.min(117.45, rig.profile.body.glycogen.liverG), 10);
    const cRef = (462 + 6.7 * (45 - 53)) / 4.3; // 94.98 mmol/kg ww
    expect(s.cMRef).toBeCloseTo(cRef, 10);
    for (const c of s.cM) expect(c).toBeCloseTo(cRef, 10); // habitual CHO < 6 g/kg/d
    expect(s.gCapG).toBeCloseTo(s.gLMaxG + 0.162 * C_M_MAX * cSmm(s), 8);
    expect(s.gRefG).toBeCloseTo(s.liverG + 0.162 * cRef * cSmm(s), 8);
    // capacity ≈ 15 g/kg body mass (Acheson 1988 cross-check, 04 §4.1)
    expect(s.gCapG / rig.profile.weightKg).toBeGreaterThan(12);
    expect(s.gCapG / rig.profile.weightKg).toBeLessThan(18);
  });

  it('habitual CHO ≥ 6 g/kg/d adds +102 mmol/kg dw to the initial (not the reference) concentration', () => {
    const rig = makeRig({ vo2max: 53, profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 25, heightCm: 180, weightKg: 70 }, habits: { habitualCarbPctEnergy: 75 } } });
    const perKg = rig.profile.habitualCarbG / rig.profile.weightKg;
    const expected = perKg >= 6 ? (462 + 102) / 4.3 : 462 / 4.3;
    expect(rig.s.cM[0]).toBeCloseTo(expected, 8);
    expect(rig.s.cMRef).toBeCloseTo(462 / 4.3, 8);
  });
});

describe('fuel: liver (04 §4.2-4.3, §4.8)', () => {
  it('fasting glycogenolysis is the exact 1-h form (G − floor)·(1 − e^{−1/τ_L})', () => {
    const rig = makeRig();
    rig.s.liverG = 80;
    step(rig);
    expect(rig.s.liverG).toBeCloseTo(80 - 75 * (1 - LN24), 10);
    for (let h = 1; h < 24; h++) step(rig);
    expect(rig.s.liverG).toBeCloseTo(5 + 75 * Math.exp(-24 / TAU_L), 8); // ≈ 60-70 % gone at 24 h (04 §4.2)
  });

  it('glucose appearance suppresses glycogenolysis: σ_fed = min(1, A/R_half)', () => {
    const rig = makeRig({ overrides: { 'fuel.alphaGlc': 0 } });
    rig.s.liverG = 80;
    step(rig, { raGlcGH: 5 }); // σ = 0.5, no liver synthesis (α = 0)
    expect(rig.s.liverG).toBeCloseTo(80 - 75 * (1 - LN24) * 0.5, 10);
  });

  it('exercise liver glycogenolysis 30·(I − 0.20)·(G_L/80)^0.5 g/h: 9 / 13.5 / 19.5 g/h at 50 / 65 / 85 % VO2max', () => {
    for (const [I, jEx] of [
      [0.5, 9],
      [0.65, 13.5],
      [0.85, 19.5],
    ] as const) {
      const rig = makeRig();
      rig.s.liverG = 80;
      // an exercise hour's expenditure (all of the released glucose is oxidised, none returned to the liver: M21)
      step(rig, { exIntensityFrac: I, exMinutesH: 60, teePreKcalH: 600 });
      expect(80 - rig.s.liverG).toBeCloseTo(75 * (1 - LN24) + jEx, 8);
    }
  });

  it('carbohydrate appearing during exercise at ≥ 1.2 g/min spares the liver completely (review M8: read via raGlcGH)', () => {
    const rig = makeRig({ overrides: { 'fuel.alphaGlc': 0 } });
    rig.s.liverG = 80;
    step(rig, { exIntensityFrac: 0.6, exMinutesH: 60, raGlcGH: 72 });
    expect(rig.s.liverG).toBeCloseTo(80, 10);
  });

  it('synthesis S_L = min(V_L,syn, α_glc·A·(1 − G_L/G_L,max)^0.5) booked by energy (4.0 → 4.207 kcal/g)', () => {
    const rig = makeRig();
    startFuelDay(rig.s, rig.k, 0, 0, 1); // S_mus = 0: no muscle uptake
    rig.s.liverG = 40;
    step(rig, { raGlcGH: 20 }); // σ = 1
    const expected = (0.2 * 20 * Math.sqrt(1 - 40 / 117.45) * 4) / RHO_G;
    expect(rig.s.liverG - 40).toBeCloseTo(expected, 10);
    const rig2 = makeRig();
    startFuelDay(rig2.s, rig2.k, 0, 0, 1);
    rig2.s.liverG = 40;
    step(rig2, { raGlcGH: 60 });
    expect(rig2.s.liverG - 40).toBeCloseTo(8, 10); // V_L,syn cap
  });

  it('fructose/galactose first pass: 0.15 → glycogen, 0.40 → glucose next hour, 0.45 oxidised', () => {
    const rig = makeRig();
    rig.s.liverG = 50;
    step(rig, { raFruGalGH: 10, teePreKcalH: 100 });
    const jL = 45 * (1 - LN24); // σ = 0 (no glucose yet)
    expect(rig.s.liverG).toBeCloseTo(50 + (0.15 * 10 * 4) / RHO_G - jL, 10);
    expect(rig.s.fruDelayedG).toBeCloseTo(4, 12);
    expect(rig.bus.choOxGH * 4.1).toBeGreaterThanOrEqual(0.45 * 10 * 4 - 1e-9);
  });
});

describe('fuel: muscle (04 §4.4-4.7; 20 §4.3.1)', () => {
  it('endurance use u_ex = 0.9·((I − 0.25)/0.5)^1.5·(c/110)^0.5·(1 − 0.75·A_keto) mmol/kg/min', () => {
    for (const [I, keto, u] of [
      [0.75, 0, 0.9],
      [0.5, 0, 0.9 * Math.pow(0.5, 1.5)], // 0.32 (dossier fit check)
      [0.85, 0, 0.9 * Math.pow(1.2, 1.5)], // 1.18
      [0.75, 1, 0.9 * 0.25],
    ] as const) {
      const rig = makeRig();
      startFuelDay(rig.s, rig.k, 0, 0, 1);
      setC(rig.s, 110);
      const legs = rig.s.smmKg[G_LEGS]!;
      // σ = 1 (glucose appearing) removes resting lactate; S_mus = 0 removes uptake
      step(rig, { exIntensityFrac: I, exMinutesH: 60, exActiveMuscleKg: legs, raGlcGH: 60, ketoAdaptFast: keto });
      expect(110 - rig.s.cM[G_LEGS]!).toBeCloseTo(u * 60, 8);
      expect(rig.s.cM[G_ARMS]).toBeCloseTo(110, 10);
    }
  });

  it('resistance depletion c ← c·(1 − D_RT·(c/110)^0.3), D_RT = 0.40·(1 − e^{−sets/3}); a session split over hours is exact', () => {
    const quads3 = [0, 0, 0, 0, 0, 0, 3, 0, 0];
    const rig = makeRig();
    startFuelDay(rig.s, rig.k, 0, 0, 1);
    setC(rig.s, 110);
    step(rig, { raGlcGH: 60 }, quads3);
    const d3 = 0.4 * (1 - Math.exp(-1));
    expect(rig.s.cM[G_LEGS]).toBeCloseTo(110 * (1 - d3), 8); // −25 % (obs. 24 % for 3 sets)
    expect(rig.s.cM[G_TRUNK]).toBeCloseTo(110, 10);
    const split = makeRig();
    startFuelDay(split.s, split.k, 0, 0, 1);
    setC(split.s, 110);
    step(split, { raGlcGH: 60 }, [0, 0, 0, 0, 0, 0, 2, 0, 0]);
    step(split, { raGlcGH: 60 }, [0, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(split.s.cM[G_LEGS]).toBeCloseTo(110 * (1 - d3), 8);
    // 1 set → 11 %, 6 sets → 35 % (04 §4.5 fit column)
    expect(0.4 * (1 - Math.exp(-1 / 3))).toBeCloseTo(0.113, 3);
    expect(0.4 * (1 - Math.exp(-2))).toBeCloseTo(0.346, 3);
  });

  it('resting post-absorptive glycogenolysis k_Mr·(c − 25) goes to lactate, not to oxidation of muscle glycogen', () => {
    const rig = makeRig({ overrides: { 'fuel.fCpaRef': 0.35 } });
    setC(rig.s, 110);
    rig.s.liverG = 100;
    // tiny expenditure: demand is below liver + lactate supply, so no demand-driven muscle glycogenolysis
    step(rig, { teePreKcalH: 20 });
    expect(rig.s.cM[0]).toBeCloseTo(110 - 0.0035 * 85, 10);
  });

  it('fasting muscle rule −k_Mf·(G_M − 0.35·G_M0): −29 % at 3 d and −48 % at 7 d (20 §4.3.1)', () => {
    const rig = makeRig();
    setC(rig.s, 110);
    const res = runDays(rig, 7, { meals: [], teeKcalD: 2300, fast: () => true, fastProtOxGH: 3, brainKetoneShare: 0.3 });
    const c3 = res[2]!.muscleEndG / (0.162 * cSmm(rig.s));
    const c7 = res[6]!.muscleEndG / (0.162 * cSmm(rig.s));
    expect(c3 / 110).toBeCloseTo(0.35 + 0.65 * Math.exp(-0.008 * 72), 8); // exact solution of 20's ODE (integrator A2)
    expect(1 - c3 / 110).toBeGreaterThan(0.27);
    expect(1 - c3 / 110).toBeLessThan(0.31);
    expect(1 - c7 / 110).toBeGreaterThan(0.46);
    expect(1 - c7 / 110).toBeLessThan(0.5);
  });

  it('synthesis S_M = S_max·Φ(R)·(1 − (c/c_cap)^4)·(1 + E_ex)·S_mus^0.5·T_C^0.5 caps muscle uptake', () => {
    const rig = makeRig({ overrides: { 'fuel.alphaGlc': 0 } });
    setC(rig.s, 100);
    const bw = rig.profile.weightKg;
    // demand = 0 (no expenditure): all glucose goes to muscle up to S_M, the rest is carried
    step(rig, { raGlcGH: 50, teePreKcalH: 0 });
    const r = 50 / bw;
    const sM = 7.5 * (r / (r + 0.3)) * (1 - Math.pow(100 / C_M_MAX, 4));
    expect(rig.s.cM[0]).toBeCloseTo(100 + sM, 8);
    const storedKcal = sM * 0.162 * cSmm(rig.s) * RHO_G;
    expect(rig.s.carryGlcG).toBeCloseTo((50 * 4 - storedKcal) / 4, 8);
  });

  it('a depleting bout sets E_ex = 1.0 + 0.3, which decays with τ 1.5 h / 36 h', () => {
    const rig = makeRig();
    const legs = rig.s.smmKg[G_LEGS]!;
    step(rig, { exIntensityFrac: 0.7, exMinutesH: 60, exActiveMuscleKg: legs });
    expect(rig.s.eRapid[G_LEGS]).toBe(1);
    expect(rig.s.eSlow[G_LEGS]).toBe(0.3);
    expect(rig.s.eRapid[G_ARMS]).toBe(0);
    step(rig);
    expect(rig.s.eRapid[G_LEGS]).toBeCloseTo(Math.exp(-1 / 1.5), 12);
    expect(rig.s.eSlow[G_LEGS]).toBeCloseTo(0.3 * Math.exp(-1 / 36), 12);
  });

  it('SMM changes from composition keep glycogen grams (c rescaled)', () => {
    const rig = makeRig();
    const g0 = muscleGlycogenG(rig.s);
    startFuelDay(rig.s, rig.k, cSmm(rig.s) * 1.1, 1, 1);
    expect(muscleGlycogenG(rig.s)).toBeCloseTo(g0, 9);
    expect(rig.s.gCapG).toBeCloseTo(rig.s.gLMaxG + 0.162 * C_M_MAX * cSmm(rig.s), 8);
  });
});

describe('fuel: oxidation, GNG, DNL (04 §4.10-4.13, §4.22; review M21)', () => {
  it('CHO demand f_C·EE_np with f_C = f_C,pa + (0.95 − f_C,pa)·Ins²/(Ins² + 54²), f_C,pa = 0.45·(G/G_ref)²', () => {
    const rig = makeRig();
    const s = rig.s;
    setC(s, s.cMRef + 30); // glycogen above the fed reference: the post-absorptive gap is fully covered
    const gTot = s.liverG + muscleGlycogenG(s);
    const r = gTot / s.gRefG;
    const fCpa = Math.min(0.85, Math.max(0.05, 0.45 * r * r));
    const ins = 40;
    const fC = fCpa + ((0.95 - fCpa) * ins * ins) / (ins * ins + 54 * 54);
    step(rig, { insulinUuMl: ins, teePreKcalH: 110, raProtGH: 5 });
    const eeNp = 110 - 4 * 5;
    expect(rig.bus.choOxGH * 4.1).toBeCloseTo(fC * eeNp, 8); // post-absorptive gap filled by GNG (M21)
    expect(rig.bus.fatOxGH).toBeCloseTo((eeNp - fC * eeNp) / 9.44, 8);
    expect(rig.bus.protOxGH).toBeCloseTo(5, 12);
  });

  it('GNG fills the gap after J_L,out and lactate up to 0.57·protOx + 0.10·fatOx (M21 / R-HGO); CHO oxidation is net', () => {
    const rig = makeRig();
    rig.s.liverG = 60;
    const gL = rig.s.liverG;
    const c0 = rig.s.cM[0]!; // at the fed reference: no demand-driven muscle glycogenolysis
    const s = rig.s;
    const r = (gL + muscleGlycogenG(s)) / s.gRefG;
    const fCpa = 0.45 * r * r;
    const fC = fCpa + (0.95 - fCpa) * (49 / (49 + 54 * 54));
    step(rig, { teePreKcalH: 110, raProtGH: 4 });
    const eeNp = 110 - 16;
    const jL = (gL - 5) * (1 - LN24);
    const lac = 0.0035 * (c0 - 25) * 0.162 * cSmm(rig.s);
    const gapKcal = fC * eeNp - (jL + lac) * RHO_G; // HGO − J_L,out − lactate (net demand)
    expect(gapKcal).toBeGreaterThan(0);
    const gly = s.gngGlyKcalH;
    expect(gly).toBeCloseTo(0.4 * rig.bus.fatOxGH, 8); // glycerol at capacity 0.10·fatOx (g) × 4 kcal/g
    const prot = Math.min((gapKcal - gly) / 4.1, 0.57 * 4);
    expect(rig.bus.gngGH).toBeCloseTo(gly / 4 + prot, 8);
    expect(rig.bus.gngGH).toBeLessThanOrEqual(0.57 * 4 + 0.1 * rig.bus.fatOxGH + 1e-9);
    expect(rig.bus.choOxGH * 4.1).toBeCloseTo((jL + lac) * RHO_G + gly, 8); // amino-acid glucose booked as protein
    expect(rig.s.liverG).toBeCloseTo(gL - jL, 10); // liver stays on 04's τ_L curve
  });

  it('surplus liver + lactate supply is oxidised (M21): CHOox ≥ J_L,out + lactate while fasting with low demand', () => {
    const rig = makeRig();
    rig.s.liverG = 90;
    const c0 = rig.s.cM[0]!;
    step(rig, { fastActive: 1, ketoAdaptFast: 1, brainKetoneShare: 0.6, teePreKcalH: 80, fastProtOxGH: 3 });
    const jL = 85 * (1 - LN24);
    const lac = (1 - Math.exp(-0.008)) * (c0 - 0.35 * c0) * 0.162 * cSmm(rig.s); // exact 1-h solution of 20's k_Mf ODE
    expect(rig.bus.choOxGH * 4.1).toBeCloseTo((jL + lac) * RHO_G, 8);
    expect(rig.s.liverG).toBeCloseTo(90 - jL, 10);
    expect(rig.bus.protOxGH).toBeCloseTo(3, 12); // fasting: the fasting module's rate
  });

  it('while fasting with empty liver, CHO oxidation is supply-limited and fat covers the rest (step 6)', () => {
    const rig = makeRig();
    rig.s.liverG = 5;
    setC(rig.s, 30);
    step(rig, { fastActive: 1, teePreKcalH: 90, fastProtOxGH: 3, insulinUuMl: 4 });
    const eeNp = 90 - 12;
    const demand = 0.05 * eeNp; // f_C,pa at its floor … or the brain floor, whichever is larger
    const need = Math.max(demand, ((120 + 10) / 24 - 0.57 * 3) * 4.1);
    expect(rig.bus.choOxGH * 4.1).toBeLessThan(need);
    expect(rig.bus.fatOxGH * 9.44 + rig.bus.choOxGH * 4.1).toBeCloseTo(eeNp, 8);
  });

  it('brain floor 120·(1 − 1.2·K) + 10 g/d net of amino-acid glucose sets the minimum demand (04 §4.22)', () => {
    const rig = makeRig();
    const K = 0.3;
    const s = rig.s;
    s.liverG = 20;
    setC(s, s.cMRef + 5); // just above the reference: muscle can supply the floor, f_C,pa stays small
    const r = (s.liverG + muscleGlycogenG(s)) / s.gRefG;
    step(rig, { ketoAdaptFast: 1, brainKetoneShare: K, teePreKcalH: 100, raProtGH: 2, insulinUuMl: 5 });
    const floorG = (120 * (1 - 1.2 * K) + 10) / 24 - 0.57 * 2;
    const fC = Math.max(0.05, 0.45 * r * r * 0.25);
    expect(fC * 92).toBeLessThan(floorG * 4.1); // the floor binds
    expect(rig.bus.choOxGH).toBeCloseTo(floorG, 6);
  });

  it('muscle at or below the fed reference is not mobilised on demand: CHO oxidation is supply-limited, fat covers it', () => {
    const rig = makeRig();
    const s = rig.s;
    setC(s, s.cMRef - 10);
    s.liverG = 40;
    const c0 = s.cM[0]!;
    step(rig, { teePreKcalH: 110, raProtGH: 4 });
    const jL = 35 * (1 - LN24);
    const lac = 0.0035 * (c0 - 25) * 0.162 * cSmm(rig.s);
    expect(s.cM[0]).toBeCloseTo(c0 - 0.0035 * (c0 - 25), 10); // only the k_Mr lactate route
    // CHOox = liver + lactate + glycerol GNG only
    expect(rig.bus.choOxGH * 4.1).toBeCloseTo((jL + lac) * RHO_G + s.gngGlyKcalH, 8);
    expect(s.gngGlyKcalH).toBeGreaterThan(0);
  });

  it('depleted muscle (below the fed reference) is refilled before exogenous glucose is oxidised; above it, oxidation first', () => {
    const low = makeRig({ overrides: { 'fuel.alphaGlc': 0 } });
    setC(low.s, low.s.cMRef - 40);
    const c0 = low.s.cM[0]!;
    step(low, { raGlcGH: 15, insulinUuMl: 120, teePreKcalH: 110 });
    const up = (low.s.cM[0]! - c0) * 0.162 * cSmm(low.s); // grams added (σ = 1: no resting loss)
    expect(up).toBeGreaterThan(10); // most of the 15 g went to muscle
    const high = makeRig({ overrides: { 'fuel.alphaGlc': 0 } });
    setC(high.s, high.s.cMRef + 20);
    const h0 = high.s.cM[0]!;
    step(high, { raGlcGH: 15, insulinUuMl: 120, teePreKcalH: 110 });
    expect(high.s.cM[0]!).toBeLessThanOrEqual(h0 + 1e-12); // all 15 g oxidised (demand ≈ 22 g/h), none stored
  });

  it('DNL only above 0.95·G_cap: 0.3125 g fat per g glucose, heat 4·DNL_glc − 9.441·DNL_fat (26.2 %)', () => {
    const rig = makeRig();
    rig.s.liverG = rig.s.gLMaxG;
    setC(rig.s, 199.9);
    step(rig, { raGlcGH: 60, insulinUuMl: 150, teePreKcalH: 60 });
    expect(rig.bus.dnlFatGH).toBeGreaterThan(0);
    const dnlGlc = rig.bus.dnlFatGH / 0.3125;
    expect(rig.bus.dnlHeatKcalH).toBeCloseTo(4 * dnlGlc - 9.441 * rig.bus.dnlFatGH, 10);
    expect(rig.bus.dnlHeatKcalH / (4 * dnlGlc)).toBeCloseTo(0.2624, 3);
    expect(rig.bus.rqHour).toBeGreaterThan(1);
    const low = makeRig();
    step(low, { raGlcGH: 60, insulinUuMl: 150, teePreKcalH: 60 });
    expect(low.bus.dnlFatGH).toBe(0);
    expect(low.s.carryGlcG).toBeGreaterThan(0);
  });

  it('protein oxidation = absorbed − deposited; the deposit debt keeps the multi-day ledger exact', () => {
    const rig = makeRig();
    const lean = 0.05; // kg/d
    const res = runDays(rig, 3, { meals: threeMeals(3, { glcG: 250, protG: 120 }), teeKcalD: 2500, leanRateKgD: lean });
    const absorbed = res.reduce((a, d) => a + d.protInG, 0);
    const oxidised = res.reduce((a, d) => a + d.protOxG, 0);
    const deposited = lean * 1000 * 0.385 * 3;
    expect(oxidised - rig.s.protDebtG).toBeCloseTo(absorbed - deposited, 6);
  });

  it('respiratory quotient from 04 §4.12 per-gram factors (alcohol excluded)', () => {
    const rig = makeRig();
    step(rig, { teePreKcalH: 100, raProtGH: 3 });
    const C = rig.bus.choOxGH;
    const F = rig.bus.fatOxGH;
    const P = rig.bus.protOxGH;
    expect(rig.bus.rqHour).toBeCloseTo((0.829 * C + 1.427 * F + 0.781 * P) / (0.829 * C + 2.019 * F + 0.966 * P), 12);
    expect(rig.bus.rqHour).toBeGreaterThan(0.7);
    expect(rig.bus.rqHour).toBeLessThan(1.0);
  });
});

describe('fuel: conservation', () => {
  it('carbohydrate ledger closes every hour: 4·Ra + GNG_gly = 4.1·CHOox + 4.207·ΔG + 4·DNL_glc + 4·Δqueues', () => {
    const rig = makeRig();
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    let worst = 0;
    let worstEnergy = 0;
    for (let h = 0; h < 24 * 10; h++) {
      const s = rig.s;
      const g0 = s.liverG + muscleGlycogenG(s);
      const q0 = s.carryGlcG + s.fruDelayedG;
      const day = Math.floor(h / 24);
      const fast = day === 6 || day === 7;
      const meal = !fast && [8, 9, 13, 14, 19, 20].includes(h % 24);
      const glc = meal ? 5 + 70 * rnd() : 0;
      const fru = meal ? 15 * rnd() : 0;
      const ex = h % 24 === 17 && day % 2 === 0;
      const rt = h % 24 === 18 && day % 3 === 1 ? [3, 3, 2, 2, 2, 3, 4, 3, 2] : undefined;
      const alc = h % 24 === 21 && day === 2 ? 10 : 0;
      step(
        rig,
        {
          raGlcGH: glc,
          raFruGalGH: fru,
          raProtGH: meal ? 20 * rnd() : 0,
          alcOxGH: alc,
          insulinUuMl: meal ? 20 + 80 * rnd() : 5 + 3 * rnd(),
          teePreKcalH: 70 + 50 * rnd() + (ex ? 500 : 0),
          exIntensityFrac: ex ? 0.4 + 0.5 * rnd() : 0,
          exMinutesH: ex ? 45 : 0,
          exActiveMuscleKg: ex ? 12 : 0,
          fastActive: fast ? 1 : 0,
          fastProtOxGH: fast ? 3 : 0,
          ketoAdaptFast: day >= 7 ? 0.5 : 0,
          brainKetoneShare: day >= 7 ? 0.2 : 0,
          leanRateKgD: 0.02,
        },
        rt,
      );
      const b = rig.bus;
      const g1 = s.liverG + muscleGlycogenG(s);
      const q1 = s.carryGlcG + s.fruDelayedG;
      const dnlGlc = b.dnlFatGH / 0.3125;
      const lhs = 4 * (glc + fru) + s.gngGlyKcalH;
      const rhs = 4.1 * b.choOxGH + RHO_G * (g1 - g0) + 4 * dnlGlc + 4 * (q1 - q0);
      worst = Math.max(worst, Math.abs(lhs - rhs));
      expect(b.glycogenChangeKcalH).toBeCloseTo(RHO_G * (g1 - g0), 9);
      if (b.fatOxGH > 0) {
        const eeSplit = 4.1 * b.choOxGH + 9.44 * b.fatOxGH + 4 * b.protOxGH + 7 * alc;
        worstEnergy = Math.max(worstEnergy, Math.abs(eeSplit - b.teePreKcalH));
      }
    }
    expect(worst).toBeLessThan(1e-9);
    expect(worstEnergy).toBeLessThan(1e-9);
  });
});

describe('fuel: events (MODEL_SPEC §7.1)', () => {
  it('fasting emits liverGlycogenLow (< 20 g) and metabolicSwitch (G_L crosses 30 g); refeeding flips the switch back', () => {
    const rig = makeRig();
    runDays(rig, 3, { meals: threeMeals(3, { glcG: 250, protG: 90 }, { startDay: 2 }), teeKcalD: 2400, fast: (t) => t < 48, fastProtOxGH: 3 });
    const types = rig.events.map((e) => e.type);
    expect(types).toContain('liverGlycogenLow');
    const sw = rig.events.filter((e) => e.type === 'metabolicSwitch');
    expect(sw.length).toBeGreaterThanOrEqual(2);
    expect(sw[0]!.value).toBeLessThan(30);
    expect(sw[1]!.value).toBeGreaterThanOrEqual(30);
    const low = rig.events.find((e) => e.type === 'liverGlycogenLow')!;
    expect(low.hour).toBeGreaterThan(20); // not before ~1 day of fasting
    expect(low.hour).toBeLessThan(48);
  });

  it('carbohydrate loading emits supercompensation (> 1.3 × fed reference) and glycogenFull (≥ 95 % of capacity)', () => {
    const rig = makeRig();
    runDays(rig, 4, { meals: threeMeals(4, { glcG: 800, protG: 80 }), teeKcalD: 2600, capGlc: true });
    const types = rig.events.map((e) => e.type);
    expect(types).toContain('supercompensation');
    expect(types).toContain('glycogenFull');
  });

  it('no events when the sink is withheld (burn-in: the module passes null while clock.day < 0)', () => {
    const rig = makeRig();
    rig.s.liverG = 10;
    stepFuelHour(rig.s, rig.k, rig.bus, rig.hour, -5, null);
    expect(rig.events).toHaveLength(0);
    expect(rig.s.evLiverLow).toBe(1); // latch kept consistent, so day 0 does not re-emit a stale transition
  });
});

describe('fuel: module hooks', () => {
  it('init writes the glycogen signals; recordHour/recordDay write only fuel series', () => {
    const rig = makeRig();
    expect(rig.bus.liverGlycogenG).toBeCloseTo(rig.s.liverG, 12);
    expect(rig.bus.muscleGlycogenG).toBeCloseTo(muscleGlycogenG(rig.s), 12);
    expect(G_PER_MMOL).toBe(0.162);
  });
});
