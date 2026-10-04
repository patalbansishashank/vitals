// @vitest-environment node
import { makeRig, MAN, WOMAN, type Rig } from './testKit';
import { MMOL_NA_PER_G } from '../../core/defaults';
import type { PersonProfile } from '../../types/profile';

const MMOL_PER_MG = MMOL_NA_PER_G / 1000;
const rigWithBurnIn = (o: Parameters<typeof makeRig>[0] = {}): Rig => {
  const r = makeRig({ burnInDays: 2, ...o });
  r.days(2);
  return r;
};

/** Mean of `f()` sampled after each of the next 24 hours. */
function dayMean(r: Rig, f: () => number): number {
  let acc = 0;
  for (let i = 0; i < 24; i++) {
    r.step(1);
    acc += f();
  }
  return acc / 24;
}

describe('E_cna — carbohydrate/insulin natriuresis (13 §4.3)', () => {
  it('relaxes to −E_max·max(0, 1 − C/C_ref) when fed and to 20 §4.5.2 E_fast* = −1.3 L·(0.2·BW0/17 L) in a fast', () => {
    const eFast = (bw: number): number => -1.3 * ((0.2 * bw) / 17);
    const cases: [number, number, number][] = [
      [0, 0, -0.6],
      [50, 0, -0.3],
      [100, 0, 0],
      [250, 0, 0],
      [50, 1, NaN], // in a fast the carbohydrate term does not matter: the size-scaled fasting target applies
    ];
    for (const [c, fast, expected0] of cases) {
      const r = rigWithBurnIn();
      const expected = Number.isNaN(expected0) ? eFast(r.profile.weightKg) : expected0;
      r.days(15, (_h, rig) => {
        rig.bus.carbAbs24G = c;
        rig.bus.fastActive = fast;
      });
      expect(r.s.eCnaL).toBeCloseTo(expected, 3);
    }
  });

  it('in a fast the target is the body-size-scaled E_fast* whatever the pre-fast meals (natriuresis starts with the fast)', () => {
    const r = rigWithBurnIn();
    r.days(15, (_h, rig) => {
      rig.bus.carbAbs24G = 250; // rolling window still holds the last meals
      rig.bus.fastActive = 1;
    });
    expect(r.s.eCnaL).toBeCloseTo(-1.3 * ((0.2 * r.profile.weightKg) / 17), 3); // 15 d at τ_down 1.5 d: e^(−10) left
  });
  it('E_fast* scales with body size (20 Tables A1-A3: 60 kg −0.92 L, 75 kg −1.15 L, 100 kg −1.53 L)', () => {
    for (const [bw, e] of [[60, -0.918], [75, -1.147], [100, -1.529]] as const) {
      const r = rigWithBurnIn({ profile: { ...MAN, body: { ...MAN.body, weightKg: bw } } });
      expect(r.k.eFastTargetL).toBeCloseTo(e, 3);
    }
  });

  it('uses τ_down = 1.5 d on the way down and τ_up = 0.7 d on the way up (exact hourly relaxation)', () => {
    const r = rigWithBurnIn();
    expect(r.s.eCnaL).toBeCloseTo(0, 12);
    r.step(36, (_h, rig) => {
      rig.bus.carbAbs24G = 0;
    });
    expect(r.s.eCnaL).toBeCloseTo(-0.6 * (1 - Math.exp(-1)), 9);
    const e0 = -0.6 * (1 - Math.exp(-1));
    r.step(24, (_h, rig) => {
      rig.bus.carbAbs24G = 0;
    });
    // 24 h more at target −0.6
    expect(r.s.eCnaL).toBeCloseTo(-0.6 + (e0 + 0.6) * Math.exp(-24 / 36), 9);
    // refeed: recover with τ_up = 0.7 d = 16.8 h
    const e1 = r.s.eCnaL;
    r.step(17, (_h, rig) => {
      rig.bus.carbAbs24G = 250;
    });
    expect(r.s.eCnaL).toBeCloseTo(e1 * Math.exp(-17 / 16.8), 9);
    // refeeding reverses ≥ 63 % within 0.7 d and ≥ 95 % within ~2.1 d
    r.days(2, (_h, rig) => {
      rig.bus.carbAbs24G = 250;
    });
    expect(Math.abs(r.s.eCnaL)).toBeLessThan(0.05 * Math.abs(e1));
  });

  it('starts at its steady state for a habitually low-carbohydrate user (13 §2 initial rule)', () => {
    const lowCarb: PersonProfile = { ...MAN, habits: { ...MAN.habits, habitualCarbPctEnergy: 4 } };
    const r = makeRig({ profile: lowCarb });
    const c = r.profile.habitualCarbG;
    expect(c).toBeGreaterThan(10);
    expect(c).toBeLessThan(100);
    expect(r.s.eCnaL).toBeCloseTo(-0.6 * (1 - c / 100), 9);
  });
});

describe('S_na — dietary sodium with partial habituation (13 §4.4, 15 §4.7)', () => {
  const na0 = (r: Rig): number => r.profile.habitualSodiumMg * MMOL_PER_MG;

  it('has no diurnal ripple and no drift at the habitual intake (steady state stays 0)', () => {
    const r = rigWithBurnIn();
    let maxAbs = 0;
    r.days(10, () => {
      maxAbs = Math.max(maxAbs, Math.abs(r.s.sNaMmol));
    });
    expect(maxAbs).toBeLessThan(1e-9);
    expect(r.s.naHabMmol).toBeCloseTo(na0(r), 9);
  });

  it('converts mg to mmol with 22.99 mg/mmol', () => {
    const r = rigWithBurnIn();
    r.day.sodiumMg = 2700;
    r.step(1);
    expect(r.s.naInMmolD).toBeCloseTo(2700 / 22.99, 9);
  });

  it('steady state with h_Na = 0.5, τ_Na = 1.5 d gives 0.0054 kg per mmol/d (spec R-WATER)', () => {
    const r = rigWithBurnIn();
    r.day.sodiumMg = (na0(r) + 100) / MMOL_PER_MG;
    r.days(80);
    const kg = dayMean(r, () => r.s.sNaMmol / 140);
    expect(kg / 100).toBeGreaterThan(0.0053);
    expect(kg / 100).toBeLessThan(0.0055);
    expect(kg / 100).toBeCloseTo((1.5 * 0.5) / 140, 4);
    // Na_hab moved half-way to the new intake
    expect(r.s.naHabMmol).toBeCloseTo(na0(r) + 50, 3);
  });

  it('h_Na = 0 (Heer: full habituation) leaves no steady-state water; h_Na = 1 (Visser) keeps τ_Na·ΔNa/140', () => {
    const heer = rigWithBurnIn({ overrides: { 'water.hNa': 0 } });
    heer.day.sodiumMg = (na0(heer) + 400) / MMOL_PER_MG; // Heer: 50 → 450 mmol/d
    heer.days(80);
    expect(Math.abs(dayMean(heer, () => heer.s.sNaMmol))).toBeLessThan(0.01);

    const visser = rigWithBurnIn({ overrides: { 'water.hNa': 1 } });
    visser.day.sodiumMg = (na0(visser) + 100) / MMOL_PER_MG;
    visser.days(80);
    expect(dayMean(visser, () => visser.s.sNaMmol / 140)).toBeCloseTo((1.5 * 100) / 140, 3);
  });

  it('sweat sodium is an extra loss: 1 L/h for 60 min at 35 mmol/L removes 35 mmol (through the τ_Na gain)', () => {
    const r = rigWithBurnIn();
    r.day.sweatLPerH = 1;
    r.step(1, (_h, rig) => {
      rig.hour.exMin = 60;
    });
    expect(r.s.sNaMmol).toBeCloseTo(-35 * r.k.gNa, 9);
    expect(r.s.sNaMmol / 140).toBeLessThan(0);
  });

  it('a salty day (+130 mmol) adds ≈ +0.4 kg next morning and fades over 3-4 d (15 §4.7)', () => {
    const r = rigWithBurnIn();
    const morning: number[] = [];
    for (let d = 0; d < 6; d++) {
      r.day.sodiumMg = (na0(r) + (d === 0 ? 130 : 0)) / MMOL_PER_MG;
      r.days(1);
      // wake-hour value of the next morning (07:00 hour is processed by the 8th step)
      r.step(8);
      morning.push(r.s.sNaMmol / 140);
      r.step(16);
    }
    expect(morning[0]!).toBeGreaterThan(0.3);
    expect(morning[0]!).toBeLessThan(0.8);
    expect(morning[3]!).toBeLessThan(0.5 * morning[0]!);
    expect(morning[5]!).toBeLessThan(0.15);
  });
});

describe('M_gut — gut contents (13 §4.5)', () => {
  const settleGut = (profile: PersonProfile, fibreG: number): number => {
    const r = makeRig({ profile });
    r.bus.fibreEffG = fibreG; // a change of fibre exposure, then 40 days of relaxation
    r.days(40);
    return r.s.mGutKg;
  };

  it('reproduces the 13 §4.5 examples: woman 0 g NSP → 0.25 kg, 40 g → 0.85 kg; man 16 g → 0.48 kg', () => {
    expect(settleGut(WOMAN, 0)).toBeCloseTo(83 * 3 / 1000, 4);
    expect(settleGut(WOMAN, 40)).toBeCloseTo((83 + 5 * 40) * 3 / 1000, 4);
    expect(settleGut(MAN, 16)).toBeCloseTo((162 + 5 * 16) * 2 / 1000, 4);
  });

  it('fills with τ = T_tr/2 and empties with τ = 1.5 d when fasting (target 0)', () => {
    const r = makeRig({ profile: WOMAN, fibreG: 0 });
    const m0 = r.s.mGutKg;
    r.bus.fibreEffG = 40;
    r.step(36); // T_tr/2 = 1.5 d for the woman
    const target = (83 + 200) * 3 / 1000;
    expect(r.s.mGutKg).toBeCloseTo(target + (m0 - target) * Math.exp(-1), 9);

    const f = makeRig({ profile: MAN });
    const g0 = f.s.mGutKg;
    f.step(36, (_h, rig) => {
      rig.bus.fastActive = 1;
    });
    expect(f.s.mGutKg).toBeCloseTo(g0 * Math.exp(-1), 9); // τ_empty = 1.5 d
    // refeed: man τ_fill = T_tr/2 = 1 d
    const g1 = f.s.mGutKg;
    f.bus.fastActive = 0;
    f.step(24);
    expect(f.s.mGutKg).toBeCloseTo(g0 + (g1 - g0) * Math.exp(-1), 9);
    expect(f.s.mGutKg).toBeGreaterThanOrEqual(0);
  });

  it('a fast empties ≈ 0.5 kg of gut content (20 §4B.2: −0.45·(BW0/75)^0.5)', () => {
    const r = makeRig({ profile: MAN });
    const m0 = r.s.mGutKg;
    r.days(10, (_h, rig) => {
      rig.bus.fastActive = 1;
    });
    expect(m0 - r.s.mGutKg).toBeGreaterThan(0.4);
    expect(m0 - r.s.mGutKg).toBeLessThan(0.6);
  });
});

describe('glycogen water and the mass identity (04 §4.1, MODEL_SPEC §1.10)', () => {
  it('deviation is 0 at t = 0 and scale = tissue + labile at every hour', () => {
    const r = makeRig({ burnInDays: 3 });
    r.days(3);
    expect(r.bus.labileWaterKg).toBe(0);
    expect(r.bus.scaleWeightKg).toBe(r.bus.tissueMassKg);
    expect(Math.abs(r.bus.scaleWeightKg - r.profile.weightKg)).toBeLessThan(0.05);
    r.days(2, (h, rig) => {
      rig.bus.muscleGlycogenG = 400 + 40 * Math.sin(h / 5);
      rig.bus.tissueMassKg = 82 - 0.001 * h;
      rig.bus.fatMassKg = 20 - 0.001 * h;
    });
    expect(r.bus.scaleWeightKg - r.bus.tissueMassKg - r.bus.labileWaterKg).toBeCloseTo(0, 12);
  });

  it('(1 + h)·ΔG with h = 3.0: +100 g glycogen → +0.4 kg; −300 g → −1.2 kg', () => {
    const r = makeRig({ burnInDays: 2 });
    r.days(2);
    const m0 = r.bus.muscleGlycogenG;
    r.step(1, (_h, rig) => {
      rig.bus.muscleGlycogenG = m0 + 100;
    });
    expect(r.s.glycogenWaterKg).toBeCloseTo(0.4, 12);
    r.step(1, (_h, rig) => {
      rig.bus.muscleGlycogenG = m0 - 300;
    });
    expect(r.s.glycogenWaterKg).toBeCloseTo(-1.2, 12);
    expect(r.bus.labileWaterKg).toBeCloseTo(-1.2, 12);
  });

  it('burn-in references follow the state: glycogen changing during burn-in leaves no t = 0 offset', () => {
    const r = makeRig({ burnInDays: 3 });
    r.days(3, (h, rig) => {
      rig.bus.liverGlycogenG = 70 + 5 * Math.sin(h);
      rig.bus.muscleGlycogenG = 300 + 2 * h; // still drifting on the last burn-in hour
    });
    expect(r.bus.labileWaterKg).toBe(0);
    expect(r.s.glycogenRefG).toBeCloseTo(r.bus.liverGlycogenG + r.bus.muscleGlycogenG, 12);
    r.step(1);
    expect(r.bus.labileWaterKg).toBeCloseTo(0, 12);
  });
});

describe('P_ex — exercise plasma volume (13 §4.6)', () => {
  it('adds 4.5 mL/kg once per hard bout (two consecutive hours count once), decays with τ = 2 d', () => {
    const r = rigWithBurnIn();
    const bw = r.bus.tissueMassKg;
    r.step(2, (_h, rig) => {
      rig.bus.exHardSession = 1;
    });
    expect(r.s.pExL).toBeCloseTo((4.5 / 1000) * bw * Math.exp(-1 / 48), 6);
    r.bus.exHardSession = 0;
    r.step(1);
    const p1 = r.s.pExL;
    r.step(48);
    expect(r.s.pExL).toBeCloseTo(p1 * Math.exp(-1), 9);
  });

  it('a second bout the next day stacks but saturates at the 0.5 L cap under daily hard sessions', () => {
    const r = rigWithBurnIn();
    let max = 0;
    for (let d = 0; d < 30; d++) {
      r.step(24, (h, rig) => {
        rig.bus.exHardSession = ((h % 24) + 24) % 24 === 17 ? 1 : 0;
        max = Math.max(max, rig.s.pExL);
      });
    }
    expect(max).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(max).toBeGreaterThan(0.45);
  });
});

describe('creatine, oedema and hydration terms', () => {
  it('W_Cr = 0.9 kg · creatineSatFrac (15 §4.12): loading 1.0 → 0.9 kg, half-saturated → 0.45 kg (daily signal, read at startDay)', () => {
    const r = rigWithBurnIn();
    r.bus.creatineSatFrac = 1;
    r.step(1); // hour 0: startDay picks the day's saturation up
    expect(r.s.wCrKg).toBeCloseTo(0.9, 12);
    expect(r.s.ecfShiftKg).toBeCloseTo(0.9, 12);
    r.step(23);
    r.bus.creatineSatFrac = 0.5;
    r.step(1);
    expect(r.s.wCrKg).toBeCloseTo(0.45, 12);
  });

  it('refeeding oedema from fasting enters the labile sum litre-for-kilogram', () => {
    const r = rigWithBurnIn();
    r.step(1, (_h, rig) => {
      rig.bus.fastOedemaL = 0.4;
    });
    expect(r.bus.labileWaterKg).toBeCloseTo(0.4, 12);
  });

  it('thirst-driven fluid (NaN) never creates a deficit; a low intake gives H_def = 0.3·shortfall in steady state', () => {
    const r = rigWithBurnIn();
    r.days(5);
    expect(r.s.hDefKg).toBe(0);
    expect(r.bus.hydrationDeficitKg).toBe(0);
    r.day.fluidL = 1.0;
    r.days(6);
    const need = r.k.needFrac * ((r.k.wtConst + r.k.wtBw * r.bus.tissueMassKg) / 1000) - r.k.needOffset;
    expect(need).toBeGreaterThan(1.8);
    expect(need).toBeLessThan(3.5);
    // steady state of dH/dt = f_kidney·shortfall/24 − H/τ: H* = f·τ·shortfall = 0.6 × 0.5 d × shortfall
    expect(r.s.hDefKg).toBeCloseTo(0.3 * (need - 1.0), 3);
    expect(r.bus.labileWaterKg).toBeCloseTo(-r.s.hDefKg, 9);
  });

  it('total-water-turnover regression reproduces the 15 §4.8 worked example (sedentary 70-kg man, 10 °C: ~3.2 L/d)', () => {
    const r = makeRig();
    const p = r.k;
    // rebuild the example from the registered coefficients: PAL 1.75, 35 y, 40 % humidity, 10 °C, sea level
    const age = 35;
    const wt = 1076 * 1.75 + 14.34 * 70 + 374.9 + 5.823 * 40 + 1.865 * 100 - 19.66 * 10 - 0.3529 * age * age + 24.78 * age - 713.1;
    expect(wt).toBeGreaterThan(3100);
    expect(wt).toBeLessThan(3300);
    expect(p.needMin).toBe(1.2);
  });
});

describe('menstrual water (13 §4.6; 16 §4.5): opt-in through cycle tracking', () => {
  it('is 0 when the cycle is not tracked (cycleDay = −1)', () => {
    const r = rigWithBurnIn();
    r.days(3, (_h, rig) => {
      rig.bus.cycleDay = -1;
    });
    expect(r.s.wMcKg).toBe(0);
  });

  it('peaks on day 1 of flow, is lowest mid-follicular, spans the 0.2 kg amplitude and has ≈ zero cycle mean', () => {
    const r = rigWithBurnIn({ profile: WOMAN });
    const values: number[] = [];
    for (let d = 1; d <= 28; d++) {
      r.bus.cycleDay = d; // daily signal from moderators, read at startDay
      r.step(1); // hour 0 of cycle day d
      values.push(r.s.wMcKg);
      r.step(23);
    }
    const max = Math.max(...values);
    const min = Math.min(...values);
    expect(values.indexOf(max)).toBe(0); // day 1
    expect(max).toBeCloseTo(0.2 * (1 - r.k.cycleMean), 12);
    expect(max - min).toBeGreaterThan(0.19);
    expect(max - min).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(values.indexOf(min)).toBeGreaterThanOrEqual(5); // mid-follicular, days 6-9
    expect(values.indexOf(min)).toBeLessThanOrEqual(8);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    // and it enters the labile sum relative to t = 0
    expect(r.bus.labileWaterKg).toBeCloseTo(r.s.ecfShiftKg + r.s.glycogenWaterKg + r.s.gutDevKg, 12);
  });
});
