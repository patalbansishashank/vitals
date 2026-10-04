// @vitest-environment node
/** Property tests (bounds, monotonicity, steady state, zero intake, determinism, ensembles) and the two events. */
import { sampleParams } from '../../core/paramsRegistry';
import { MMOL_NA_PER_G } from '../../core/defaults';
import { MI, N_SERIES } from '../../types/metrics';
import { waterModule } from './index';
import { WATER_PARAMS } from './params';
import { makeRig, WOMAN, type Rig } from './testKit';

const MMOL_PER_MG = MMOL_NA_PER_G / 1000;
const settled = (o: Parameters<typeof makeRig>[0] = {}): Rig => {
  const r = makeRig({ burnInDays: 2, ...o });
  r.days(2);
  return r;
};
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

describe('steady state at maintenance', () => {
  it('stays exactly at the t = 0 reference for 30 simulated days (man and woman)', () => {
    for (const profile of [undefined, WOMAN]) {
      const r = makeRig({ ...(profile ? { profile } : {}), burnInDays: 3 });
      r.days(3);
      const w0 = r.bus.scaleWeightKg;
      let maxDev = 0;
      const scale0 = r.bus.tissueMassKg;
      for (let h = 0; h < 30 * 24; h++) {
        r.step(1);
        maxDev = Math.max(maxDev, Math.abs(r.bus.labileWaterKg), Math.abs(r.bus.scaleWeightKg - w0));
      }
      expect(maxDev).toBeLessThan(1e-9);
      expect(r.bus.tissueMassKg).toBe(scale0);
      expect(r.s.eCnaL).toBeCloseTo(0, 12);
    }
  });

  it('a habitually low-carbohydrate user (E_cna < 0 at t = 0) is also steady: the offset is in the reference', () => {
    const r = makeRig({ profile: { ...WOMAN, habits: { habitualCarbPctEnergy: 4 } }, burnInDays: 3 });
    r.days(3);
    expect(r.s.eCnaL).toBeLessThan(-0.2);
    r.days(20);
    expect(Math.abs(r.bus.labileWaterKg)).toBeLessThan(1e-9);
  });
});

describe('zero intake for 21 and 28 days (O-6)', () => {
  for (const nd of [21, 28]) {
    it(`${nd}-d water fast: finite, gut ≥ 0, no negative pools, scale = tissue + labile`, () => {
      const r = settled();
      const gL0 = r.bus.liverGlycogenG;
      const gM0 = r.bus.muscleGlycogenG;
      const tissue0 = r.bus.tissueMassKg;
      let t = 0;
      let minGut = Infinity;
      let minScaleStep = 0;
      let prevScale = r.bus.scaleWeightKg;
      const drive = (_h: number, rig: Rig): void => {
        t++;
        rig.bus.fastActive = 1;
        rig.bus.carbAbs24G = 0;
        rig.bus.liverGlycogenG = 5 + (gL0 - 5) * Math.exp(-t / 24);
        rig.bus.muscleGlycogenG = 0.35 * gM0 + 0.65 * gM0 * Math.exp(-0.008 * t);
        rig.bus.tissueMassKg = tissue0 - (0.55 * t) / 24; // ~0.55 kg/d of fat + protein, monotone
        rig.bus.fatMassKg = rig.profile.fm0Kg - (0.25 * t) / 24;
      };
      for (let h = 0; h < nd * 24; h++) {
        r.step(1, drive);
        expect(Number.isFinite(r.bus.scaleWeightKg)).toBe(true);
        expect(Number.isFinite(r.bus.labileWaterKg)).toBe(true);
        minGut = Math.min(minGut, r.s.mGutKg);
        expect(r.s.hDefKg).toBeGreaterThanOrEqual(0);
        expect(r.s.pExL).toBeGreaterThanOrEqual(0);
        minScaleStep = Math.min(minScaleStep, r.bus.scaleWeightKg - prevScale);
        prevScale = r.bus.scaleWeightKg;
        expect(Math.abs(r.bus.scaleWeightKg - r.bus.tissueMassKg - r.bus.labileWaterKg)).toBeLessThan(1e-12);
      }
      expect(minGut).toBeGreaterThanOrEqual(0);
      expect(r.s.eCnaL).toBeGreaterThanOrEqual(r.k.eFastTargetL - 1e-9); // 20 §4.5.2 E_fast* = −1.3 L·(0.2·BW0/17 L)
      expect(r.s.eCnaL).toBeLessThan(0);
      expect(r.bus.scaleWeightKg).toBeLessThan(r.profile.weightKg - 5); // a real fast loses weight
    });
  }
});

describe('bounds under hostile inputs and across the whole parameter registry', () => {
  function hostile(r: Rig, days: number, seed: number): void {
    const rnd = lcg(seed);
    for (let h = 0; h < days * 24; h++) {
      r.step(1, (_h, rig) => {
        rig.bus.liverGlycogenG = 5 + 120 * rnd();
        rig.bus.muscleGlycogenG = 100 + 700 * rnd();
        rig.bus.carbAbs24G = 500 * rnd();
        rig.bus.fastActive = rnd() < 0.3 ? 1 : 0;
        rig.bus.fibreEffG = 80 * rnd();
        rig.bus.exHardSession = rnd() < 0.2 ? 1 : 0;
        rig.bus.creatineSatFrac = rnd();
        rig.bus.fastOedemaL = rnd() < 0.1 ? 2 * rnd() : 0;
        rig.bus.cycleDay = rnd() < 0.5 ? -1 : 1 + Math.floor(rnd() * 35);
        rig.day.sodiumMg = 6000 * rnd();
        rig.day.fluidL = rnd() < 0.5 ? Number.NaN : 4 * rnd();
        rig.hour.exMin = rnd() < 0.1 ? 60 * rnd() : 0;
        rig.day.sweatLPerH = 2 * rnd();
      });
      const s = r.s;
      const k = r.k;
      expect(s.eCnaL).toBeGreaterThanOrEqual(Math.min(-k.eMax, k.eFastTargetL) - 1e-12);
      expect(s.eCnaL).toBeLessThanOrEqual(1e-12);
      expect(s.sNaMmol).toBeGreaterThanOrEqual(-300);
      expect(s.sNaMmol).toBeLessThanOrEqual(500);
      expect(s.mGutKg).toBeGreaterThanOrEqual(0);
      expect(s.mGutKg).toBeLessThan(3);
      expect(s.pExL).toBeGreaterThanOrEqual(0);
      expect(s.pExL).toBeLessThanOrEqual(k.pvCapL + 1e-12);
      expect(s.hDefKg).toBeGreaterThanOrEqual(0);
      expect(s.hDefKg).toBeLessThanOrEqual(k.hCap + 1e-12);
      expect(Number.isFinite(r.bus.scaleWeightKg)).toBe(true);
    }
  }

  it('every state stays inside its physical bounds for 90 days of random inputs', () => {
    hostile(settled(), 90, 7);
  });

  it('50 ensemble draws of the whole registry run clean (finite, bounded)', () => {
    const vectors = sampleParams(WATER_PARAMS, { count: 50, seed: 2026 });
    for (const v of vectors) {
      const overrides: Record<string, number> = {};
      WATER_PARAMS.forEach((d, i) => (overrides[d.id] = v[i]!));
      hostile(settled({ overrides }), 10, 3);
    }
  });
});

describe('monotonicity', () => {
  it('more glycogen → more labile water (strictly), h larger → steeper', () => {
    const at = (gExtra: number, extraH?: number): number => {
      const r = settled(extraH === undefined ? {} : { extraParams: [{ id: 'fuel.hWater', value: extraH, unit: 'g/g', low: 2, high: 4, grade: 'B', source: 'test', dossier: '04 §4.1' }] });
      r.step(1, (_h, rig) => {
        rig.bus.muscleGlycogenG += gExtra;
      });
      return r.bus.labileWaterKg;
    };
    const vals = [-300, -100, 0, 100, 300].map((g) => at(g));
    for (let i = 1; i < vals.length; i++) expect(vals[i]!).toBeGreaterThan(vals[i - 1]!);
    expect(at(200, 4)).toBeGreaterThan(at(200, 2));
    expect(at(-200, 4)).toBeLessThan(at(-200, 2));
  });

  it('more sodium → more S_na at every hour; less carbohydrate → lower E_cna; fasting lowers it further; more fibre → more gut', () => {
    const run = (mgNa: number): number[] => {
      const r = settled();
      r.day.sodiumMg = mgNa;
      const out: number[] = [];
      for (let h = 0; h < 96; h++) {
        r.step(1);
        out.push(r.s.sNaMmol);
      }
      return out;
    };
    const lo = run(2000);
    const mid = run(3000);
    const hi = run(5000);
    for (let h = 0; h < 96; h++) {
      expect(hi[h]!).toBeGreaterThanOrEqual(mid[h]!);
      expect(mid[h]!).toBeGreaterThanOrEqual(lo[h]!);
    }
    const eAt = (carb: number, fast: number): number => {
      const r = settled();
      r.days(8, (_h, rig) => {
        rig.bus.carbAbs24G = carb;
        rig.bus.fastActive = fast;
      });
      return r.s.eCnaL;
    };
    expect(eAt(0, 0)).toBeLessThan(eAt(50, 0));
    expect(eAt(50, 0)).toBeLessThan(eAt(100, 0) + 1e-12);
    expect(eAt(100, 0)).toBeGreaterThanOrEqual(eAt(300, 0) - 1e-12);
    expect(eAt(50, 1)).toBeLessThan(eAt(50, 0));
    const gutAt = (nsp: number): number => {
      const r = settled();
      r.bus.fibreEffG = nsp;
      r.days(15);
      return r.s.mGutKg;
    };
    expect(gutAt(10)).toBeLessThan(gutAt(25));
    expect(gutAt(25)).toBeLessThan(gutAt(45));
  });
});

describe('determinism and recording', () => {
  it('identical inputs give bit-identical states over 60 days', () => {
    const go = (): number[] => {
      const r = settled();
      const rnd = lcg(99);
      const out: number[] = [];
      for (let h = 0; h < 60 * 24; h++) {
        r.step(1, (_h, rig) => {
          rig.bus.muscleGlycogenG = 300 + 200 * rnd();
          rig.bus.carbAbs24G = 300 * rnd();
          rig.bus.exHardSession = rnd() < 0.05 ? 1 : 0;
        });
        out.push(r.bus.scaleWeightKg, r.bus.labileWaterKg, r.s.sNaMmol, r.s.eCnaL, r.s.mGutKg, r.s.pExL);
      }
      return out;
    };
    expect(go()).toEqual(go());
  });

  it('records the decomposition: glycogenWater + ecfShift + gutContent = waterWeight, leanMass = scale − FM, bodyFatPct = 100·FM/scale', () => {
    const r = settled();
    r.bus.creatineSatFrac = 0.8;
    r.bus.exHardSession = 1;
    r.step(1, (_h, rig) => {
      rig.bus.muscleGlycogenG += 120;
      rig.bus.fibreEffG = 40;
      rig.bus.fastOedemaL = 0.2;
    });
    r.step(30, (_h, rig) => {
      rig.bus.muscleGlycogenG += 0;
      rig.bus.exHardSession = 0;
    });
    const out = new Float64Array(N_SERIES);
    waterModule.recordHour(r.s, r.k, r.bus, out);
    waterModule.recordDay(r.s, r.k, r.bus, out);
    expect(out[MI.waterWeight]).toBeCloseTo(out[MI.glycogenWater]! + out[MI.ecfShift]! + out[MI.gutContent]!, 12);
    expect(out[MI.waterWeight]).toBe(r.bus.labileWaterKg);
    expect(out[MI.scaleWeight]).toBe(r.bus.scaleWeightKg);
    expect(out[MI.leanMass]).toBeCloseTo(r.bus.scaleWeightKg - r.bus.fatMassKg, 12);
    expect(out[MI.bodyFatPct]).toBeCloseTo((100 * r.bus.fatMassKg) / r.bus.scaleWeightKg, 12);
    expect(out[MI.glycogenWater]).toBeCloseTo(0.48, 9); // (1 + 3)·120 g
  });
});

describe('events (MODEL_SPEC §7.1)', () => {
  /** Run `days` post-burn-in days with a per-day glycogen offset (g) and fat-loss rate; tissue mass constant. */
  function scenario(days: number, glycogenOffset: (d: number) => number, fatLossKgD: number, tissueSlopeKgD = 0): Rig {
    const r = settled();
    const fm0 = r.bus.fatMassKg;
    const t0 = r.bus.tissueMassKg;
    const m0 = r.bus.muscleGlycogenG;
    let hAbs = 0;
    r.days(days, (_h, rig) => {
      const d = Math.floor(hAbs / 24);
      rig.bus.muscleGlycogenG = m0 + glycogenOffset(d);
      rig.bus.fatMassKg = fm0 - (fatLossKgD * hAbs) / 24;
      rig.bus.energyBalance7KcalD = -fatLossKgD * 9441; // composition's EB7 for this rate of fat loss
      rig.bus.tissueMassKg = t0 - (tissueSlopeKgD * hAbs) / 24;
      hAbs++;
    });
    return r;
  }

  it('waterRebound fires once on the first day the daily-mean scale weight is ≥ 0.5 kg above the 3-day minimum while fat falls', () => {
    const r = scenario(30, (d) => (d >= 10 && d < 20 ? 175 : d >= 25 ? 175 : 0), 0.05);
    const ev = r.events.filter((e) => e.type === 'waterRebound');
    expect(ev).toHaveLength(2);
    expect(Math.floor(ev[0]!.hourIndex / 24)).toBe(10);
    expect(ev[0]!.value).toBeGreaterThanOrEqual(0.5);
    expect(ev[0]!.value).toBeCloseTo(0.7, 1);
    expect(Math.floor(ev[1]!.hourIndex / 24)).toBe(25);
    expect(ev[0]!.hourIndex % 24).toBe(23);
  });

  it('waterRebound does not fire when fat mass is not falling, when the rise is below 0.5 kg, or during burn-in', () => {
    expect(scenario(20, (d) => (d >= 10 ? 175 : 0), 0).events.filter((e) => e.type === 'waterRebound')).toHaveLength(0);
    expect(scenario(20, (d) => (d >= 10 ? 100 : 0), 0.05).events.filter((e) => e.type === 'waterRebound')).toHaveLength(0);
    const burn = makeRig({ burnInDays: 6 });
    burn.days(6, (h, rig) => {
      rig.bus.muscleGlycogenG = 300 + (Math.floor(h / 24) % 2) * 300;
      rig.bus.fatMassKg = 20 - h * 0.01;
    });
    expect(burn.events).toHaveLength(0);
  });

  it('weightPlateau fires once after ≥ 21 days when scale weight is flat while EB7 < −200 kcal/d', () => {
    const r = scenario(40, () => 0, 0.03); // 0.03 kg/d of fat ≈ 283 kcal/d; tissue mass (hence scale) held flat by design
    const ev = r.events.filter((e) => e.type === 'weightPlateau');
    expect(ev).toHaveLength(1);
    expect(Math.floor(ev[0]!.hourIndex / 24)).toBe(20); // first day with 14 + 7 days of history
    expect(Math.abs(ev[0]!.value)).toBeLessThan(0.1);
  });

  it('weightPlateau stays silent when the deficit is small (EB7 > −200 kcal/d) or scale weight is still falling', () => {
    expect(scenario(40, () => 0, 0.01).events.filter((e) => e.type === 'weightPlateau')).toHaveLength(0);
    expect(scenario(40, () => 0, 0.03, 0.06).events.filter((e) => e.type === 'weightPlateau')).toHaveLength(0);
  });

  it('uses the literal spec threshold EB7 < −200 kcal/d (energyBalance7KcalD, MODEL_SPEC §1.10)', () => {
    const r = makeRig();
    expect(r.k.plateauEb7KcalD).toBe(-200);
  });

  it('sodium intake in mg is converted with 22.99 mg/mmol (sanity of the unit chain)', () => {
    expect(2300 * MMOL_PER_MG).toBeCloseTo(100.04, 2);
  });
});
