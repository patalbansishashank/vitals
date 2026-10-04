// @vitest-environment node
/**
 * Module-level unit and property tests: clocks, caps, conservation, fasting behaviour, exercise, walks, ketones,
 * steady state, bounds, monotonicity, determinism, registry/wiring, hourly-vs-Euler accuracy of the AA signal.
 */
import { intakeModule, MF, MEAL_FIELDS, MEAL_SLOTS } from '../index';
import { validateParamDefs, buildModelParams } from '../../../core/paramsRegistry';
import { checkWiring, MODULES } from '../../../core/moduleRegistry';
import { compileSchedule, habitualDay } from '../../../core/compileSchedule';
import { resolveProfile } from '../../../core/resolveProfile';
import { CARDIO_MODALITY_CODE } from '../../../types/inputs';
import type { AnyEngineModule } from '../../../types/module';
import type { Schedule } from '../../../types/schedule';
import { makeHarness, MAN_80, type Harness } from './harness';

const MIXED = { proteinG: 30, carbG: 90, fructoseG: 20, fatG: 25, fibreG: 8, glycaemicIndex: 55, timeToPeakH: 1 };

function finiteBus(H: Harness): void {
  const b = H.bus as unknown as Record<string, number>;
  for (const key of intakeModule.writes) {
    const v = b[key]!;
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  }
}

describe('registry and wiring', () => {
  it('ParamDefs validate (unique, prefixed, low ≤ value ≤ high, sourced)', () => {
    expect(validateParamDefs([intakeModule as unknown as AnyEngineModule])).toEqual([]);
    for (const p of intakeModule.params) {
      expect(p.source.length).toBeGreaterThan(5);
      expect(p.dossier).toMatch(/^\d\d /);
    }
  });
  it('checkWiring reports no intake issues; reads match the spec exactly', () => {
    const issues = checkWiring(MODULES).issues.filter((i) => i.module === 'intake' || i.signal.startsWith('ra'));
    expect(issues).toEqual([]);
    expect([...intakeModule.reads].sort()).toEqual(['carbTolerance', 'exIntensityFrac', 'liverGlycogenG', 'sHep', 'sMus', 'tissueMassKg']);
  });
});

describe('fasting clocks (07 §4.2, 08 §4.10, 17 §2.1)', () => {
  it('hFast resets on protein ≥ 10 g or net carbohydrate ≥ 15 g, not on pure fat, coffee or small snacks', () => {
    const H = makeHarness();
    H.idle(3);
    const h0 = H.s.hoursSinceMeal;
    H.eat({ fatG: 30 }); // pure fat
    H.step();
    expect(H.s.hoursSinceMeal).toBe(h0 + 1);
    H.eat({ proteinG: 9, carbG: 14 }); // below both thresholds
    H.step();
    expect(H.s.hoursSinceMeal).toBe(h0 + 2);
    H.eat({ caffeineMg: 100 });
    H.step();
    expect(H.s.hoursSinceMeal).toBe(h0 + 3);
    H.eat({ proteinG: 10 });
    H.step();
    expect(H.bus.hoursSinceMealH).toBe(0);
    H.idle(2);
    expect(H.bus.hoursSinceMealH).toBe(2);
    H.eat({ carbG: 15 });
    H.step();
    expect(H.bus.hoursSinceMealH).toBe(0);
  });

  it('fast_h resets on intake > 50 kcal only; tPA stays 0 while FED and counts after', () => {
    const H = makeHarness();
    H.idle(2);
    const f0 = H.s.hoursSinceIntake;
    H.eat({ carbG: 12 }); // 48 kcal
    H.step();
    expect(H.bus.hoursSinceIntakeH).toBe(f0 + 1);
    H.eat({ carbG: 13 }); // 52 kcal
    H.step();
    expect(H.bus.hoursSinceIntakeH).toBe(0);
    const G = makeHarness();
    G.eat(MIXED);
    const fed: number[] = [];
    const tpa: number[] = [];
    for (let h = 0; h < 10; h++) {
      G.step();
      fed.push(G.bus.fedState);
      tpa.push(G.bus.hoursPostAbsorptiveH);
    }
    const lastFed = fed.lastIndexOf(1);
    expect(fed.slice(0, lastFed + 1).every((v) => v === 1)).toBe(true);
    for (let h = 0; h <= lastFed; h++) expect(tpa[h]).toBe(0);
    for (let h = lastFed + 1; h < 10; h++) expect(tpa[h]).toBe(h - lastFed);
  });
});

describe('conservation and caps', () => {
  it('every ingested gram and kcal appears exactly once (glucose, fructose, protein, fat, MCT, fibre, alcohol, ketones)', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    let eIn = 0;
    let pIn = 0;
    let cIn = 0;
    let fIn = 0;
    let mctIn = 0;
    const meals = [
      { proteinG: 35, carbG: 80, fructoseG: 25, galactoseG: 5, fatG: 30, mctG: 6, fibreG: 10, alcoholG: 14, timeToPeakH: 1 },
      { proteinG: 60, carbG: 200, fructoseG: 40, fatG: 45, fibreG: 12, timeToPeakH: 1.5, proteinSpeed: 0.8 },
      { proteinG: 25, carbG: 60, glucoseEqG: 60, timeToPeakH: 0.5, proteinSpeed: 1.6, proteinQMeal: 1.15 },
    ];
    let e = 0;
    let p = 0;
    let c = 0;
    let f = 0;
    let mct = 0;
    let ket = 0;
    for (let d = 0; d < 5; d++) {
      for (let h = 0; h < 24; h++) {
        const i = h === 8 ? 0 : h === 13 ? 1 : h === 19 ? 2 : -1;
        if (i >= 0) {
          const m = meals[i]!;
          H.eat(m);
          pIn += m.proteinG;
          cIn += m.carbG;
          fIn += m.fatG ?? 0;
          mctIn += m.mctG ?? 0;
          eIn += 4 * m.proteinG + 4 * m.carbG + 9 * ((m.fatG ?? 0) - (m.mctG ?? 0)) + 8.3 * (m.mctG ?? 0) + 2 * (m.fibreG ?? 0) + 7 * (m.alcoholG ?? 0);
        }
        if (d === 1 && h === 3) {
          H.hour.exoKetoneG = 12;
          eIn += 4.45 * 12;
        }
        H.step();
        e += H.bus.eAbsKcalH;
        p += H.bus.raProtGH;
        c += H.bus.raGlcGH + H.bus.raFruGalGH;
        f += H.bus.raFatGH;
        mct += H.bus.raMctGH;
        ket += H.bus.exoKetoneMmolH;
      }
    }
    for (let h = 0; h < 72; h++) {
      H.step();
      e += H.bus.eAbsKcalH;
      p += H.bus.raProtGH;
      c += H.bus.raGlcGH + H.bus.raFruGalGH;
      f += H.bus.raFatGH;
      mct += H.bus.raMctGH;
    }
    expect(p).toBeCloseTo(pIn, 6);
    expect(c).toBeCloseTo(cIn, 6);
    expect(f).toBeCloseTo(fIn, 6);
    expect(mct).toBeCloseTo(mctIn, 6);
    expect(ket).toBeCloseTo((12 / 104.1) * 1000, 6); // fasted dose, no fed factor
    expect(e).toBeCloseTo(eIn, 4); // day energy 0 on the blank day → no ME correction
    expect(H.s.nActive).toBe(0); // every slot retired and flushed
  });

  it('intestinal caps: Ra_glc ≤ 60 g/h, Ra_glc + Ra_fru ≤ 90 g/h, excess queued and delivered', () => {
    const H = makeHarness();
    H.eat({ carbG: 250, fructoseG: 100, timeToPeakH: 0.5, glycaemicIndex: 90 });
    let g = 0;
    let fr = 0;
    for (let h = 0; h < 24; h++) {
      H.step();
      expect(H.bus.raGlcGH).toBeLessThanOrEqual(60 + 1e-9);
      expect(H.bus.raGlcGH + H.bus.raFruGalGH).toBeLessThanOrEqual(90 + 1e-9);
      g += H.bus.raGlcGH;
      fr += H.bus.raFruGalGH;
    }
    expect(g).toBeCloseTo(150, 6);
    expect(fr).toBeCloseTo(100, 6);
    expect(H.s.glcQueueG + H.s.fruQueueG).toBe(0);
  });

  it('trajectory cache: identical meals reuse one entry and give bit-identical kinetics; entries are released', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    const seq = (): number[] => {
      const out: number[] = [];
      H.eat({ proteinG: 37.5, carbG: 80, fatG: 20, proteinSpeed: 0.8 });
      for (let h = 0; h < 24; h++) {
        H.step();
        out.push(H.bus.raProtGH, H.bus.raFatGH, H.bus.absFluxKcalH);
      }
      return out;
    };
    const a = seq();
    const b = seq();
    expect(b).toEqual(a);
    expect(Array.from(H.s.pLen).filter((n) => n > 0)).toHaveLength(1);
    expect(Array.from(H.s.gLen).filter((n) => n > 0)).toHaveLength(1);
    H.idle(24);
    expect(Array.from(H.s.pRef).every((r) => r === 0)).toBe(true);
    expect(Array.from(H.s.gRef).every((r) => r === 0)).toBe(true);
  });

  it('ring overflow flushes the oldest meal into the current hour (no mass lost)', () => {
    const H = makeHarness();
    let pIn = 0;
    let p = 0;
    for (let i = 0; i < MEAL_SLOTS + 4; i++) {
      H.eat({ proteinG: 100, proteinSpeed: 0.8 });
      pIn += 100;
      H.step();
      p += H.bus.raProtGH;
    }
    for (let h = 0; h < 80; h++) {
      H.step();
      p += H.bus.raProtGH;
    }
    expect(p).toBeCloseTo(pIn, 6);
  });

  it('carbohydrate during exercise (R-EXCARB, review M8) is absorbed as glucose and counted as intake', () => {
    const H = makeHarness();
    H.hour.exMin = 60;
    H.hour.exIntensityFrac = 0.65;
    H.hour.exModality = CARDIO_MODALITY_CODE.cycle;
    H.hour.exCarbDuringGPerMin = 1;
    H.hour.exCarbG = 60;
    H.step();
    let g = H.bus.raGlcGH;
    expect(H.bus.hoursSinceMealH).toBe(0);
    expect(H.bus.carbAbs24G).toBeCloseTo(60, 9);
    expect(H.bus.kcalEaten24).toBeCloseTo(240, 9);
    for (let h = 0; h < 10; h++) {
      H.step();
      g += H.bus.raGlcGH;
    }
    expect(g).toBeCloseTo(60, 6);
    expect(H.s.meals[MF.LAG]).toBe(0);
    expect(H.s.meals[MF.TP]).toBe(0.5);
  });
});

describe('insulin and glucose behaviour', () => {
  it('basal insulin falls with liver glycogen to the 0.45 floor (R-INS); insulinRel = 1 at the latched baseline', () => {
    const H = makeHarness();
    // isolate the liver factor: keep the post-absorptive clock short of 07's 12-h decline onset
    H.s.hoursPostAbsorptive = 0;
    H.step();
    expect(H.bus.insulinRel).toBeCloseTo(1, 12);
    H.bus.liverGlycogenG = 0;
    H.s.hoursPostAbsorptive = 0;
    H.step();
    expect(H.bus.insulinRel).toBeCloseTo(0.45, 12);
    const gRef = H.k.insGRef;
    H.bus.liverGlycogenG = gRef / 4;
    H.s.hoursPostAbsorptive = 0;
    H.step();
    expect(H.bus.insulinRel).toBeCloseTo(0.45 + 0.55 * 0.5, 12);
  });

  it('basal insulin also follows 07 §4.4.3 InsulinRel(τ) = 0.45 + 0.55·e^(−p(τ − 12)/10) when that is lower (A2)', () => {
    const H = makeHarness();
    H.s.hoursPostAbsorptive = 0;
    H.step();
    const i0 = H.bus.insulinUuMl;
    // full liver: the time course alone; τ = tPA + 4.5 h (07 §4.2 absorptive reference)
    for (const tpa of [10, 20, 40]) {
      H.bus.liverGlycogenG = 1000;
      H.s.hoursPostAbsorptive = tpa - 1; // the step advances the clock by one hour
      H.step();
      const tau = tpa + 4.5;
      expect(H.bus.insulinUuMl / i0).toBeCloseTo(0.45 + 0.55 * Math.exp(-Math.max(0, tau - 12) / 10), 10);
    }
  });

  it('exercise lowers insulin × (1 − 0.3·x)', () => {
    const H = makeHarness();
    H.s.hoursPostAbsorptive = 0;
    H.step();
    const i0 = H.bus.insulinUuMl;
    H.bus.exIntensityFrac = 0.5;
    H.s.hoursPostAbsorptive = 0;
    H.step();
    expect(H.bus.insulinUuMl).toBeCloseTo(i0 * 0.85, 10);
  });

  it('S_hep, S_mus and T_C act as specified (fasting and postprandial)', () => {
    const peak = (sHep: number, sMus: number, tc: number) => {
      const H = makeHarness();
      H.bus.sHep = sHep;
      H.bus.sMus = sMus;
      H.bus.carbTolerance = tc;
      H.step(); // startDay reads them at the first step
      const gF = H.bus.glucoseMmolL;
      const iF = H.bus.insulinUuMl;
      H.eat({ carbG: 75, timeToPeakH: 0.5, glycaemicIndex: 100 });
      let g = 0;
      let i = 0;
      for (let h = 0; h < 6; h++) {
        H.step();
        g = Math.max(g, H.bus.glucoseMmolL);
        i = Math.max(i, H.bus.insulinUuMl);
      }
      return { gF, iF, g, i };
    };
    const ref = peak(1, 1, 1);
    const hep = peak(0.5, 1, 1);
    expect(hep.iF / ref.iF).toBeCloseTo(Math.pow(0.5, -0.9), 6);
    expect(hep.gF / ref.gF).toBeCloseTo(Math.pow(0.5, -0.1), 6);
    const mus = peak(1, 0.5, 1);
    expect(mus.g).toBeGreaterThan(ref.g);
    expect(mus.i).toBeGreaterThan(ref.i);
    const lowTc = peak(1, 1, 0);
    expect(lowTc.g - lowTc.gF).toBeCloseTo((ref.g - ref.gF) * 1.6, 1);
    expect(lowTc.i).toBeLessThan(ref.i);
  });

  it('monotone: more carbohydrate → higher glucose and insulin peaks; added protein lowers glucose, raises insulin', () => {
    const run = (m: Record<string, number>) => {
      const H = makeHarness();
      H.eat(m);
      let g = 0;
      let i = 0;
      for (let h = 0; h < 8; h++) {
        H.step();
        g = Math.max(g, H.bus.glucoseMmolL);
        i = Math.max(i, H.bus.insulinUuMl);
      }
      return { g, i };
    };
    let prev = { g: 0, i: 0 };
    for (const c of [10, 25, 50, 100, 150]) {
      const r = run({ carbG: c, timeToPeakH: 1 });
      expect(r.g).toBeGreaterThan(prev.g);
      expect(r.i).toBeGreaterThan(prev.i);
      prev = r;
    }
    const a = run({ carbG: 60, timeToPeakH: 1 });
    const b = run({ carbG: 60, proteinG: 40, timeToPeakH: 1 });
    expect(b.g).toBeLessThan(a.g);
    expect(b.i).toBeGreaterThan(a.i);
  });

  it('a later meal gives a larger excursion (mClock, R-CIRC); a post-meal walk lowers it ×0.88 (×0.78 after the last meal)', () => {
    const exc = (startHourOfDay: number, walk: boolean) => {
      const H = makeHarness(undefined, { startHourOfDay });
      H.eat({ carbG: 60, timeToPeakH: 1 });
      H.step();
      if (walk) {
        H.hour.exMin = 15;
        H.hour.exModality = CARDIO_MODALITY_CODE.walk;
        H.hour.exIntensityFrac = 0.4;
      }
      H.step();
      return H.s.meals[MF.GAMP]!;
    };
    expect(exc(20, false) / exc(8, false)).toBeCloseTo(1.17, 2);
    // the harness day has no scheduled meals, so every hand-fed meal is the day's last meal → ×0.78
    expect(exc(13, true) / exc(13, false)).toBeCloseTo(0.78, 10);
    const H = makeHarness(undefined, { startHourOfDay: 12 });
    const d = habitualDay(H.profile); // meals at 08, 14, 20 → a 12:00 meal is not the last
    H.day = d;
    H.eat({ carbG: 60, timeToPeakH: 1 });
    H.step();
    const before = H.s.meals[MF.GAMP]!;
    H.hour.exMin = 10;
    H.hour.exModality = CARDIO_MODALITY_CODE.walk;
    H.step();
    expect(H.s.meals[MF.GAMP]! / before).toBeCloseTo(0.88, 10);
  });

  it('zero intake: glucose follows the 07 reference toward its nadir (3.3-3.5 mmol/L ± 0.4 by day 3-4)', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    H.eat(MIXED);
    const g: number[] = [];
    for (let h = 0; h < 24 * 5; h++) {
      H.step();
      g.push(H.bus.glucoseMmolL);
    }
    const day4 = g[24 * 4]!;
    expect(day4).toBeGreaterThanOrEqual(3.3 - 0.4);
    expect(day4).toBeLessThanOrEqual(3.5 + 0.4);
    // monotone decline once post-absorptive
    for (let h = 12; h < g.length; h++) expect(g[h]!).toBeLessThanOrEqual(g[h - 1]! + 1e-12);
  });
});

describe('substances', () => {
  it('exogenous ketones: 25 g ester fasted → 240 mmol over ~4 h; fed ×0.75 and later peak', () => {
    const H = makeHarness();
    H.eat({ exoKetoneG: 25 });
    const k: number[] = [];
    for (let h = 0; h < 20; h++) {
      H.step();
      k.push(H.bus.exoKetoneMmolH);
    }
    const tot = k.reduce((a, b) => a + b, 0);
    expect(tot).toBeCloseTo((25 / 104.1) * 1000, 6);
    expect(k[0]!).toBeGreaterThan(k[1]!);
    expect(k.slice(0, 4).reduce((a, b) => a + b, 0) / tot).toBeGreaterThan(0.99);
    const F = makeHarness();
    F.eat({ exoKetoneG: 25, carbG: 50 });
    let tf = 0;
    for (let h = 0; h < 20; h++) {
      F.step();
      tf += F.bus.exoKetoneMmolH;
    }
    expect(tf).toBeCloseTo(0.75 * tot, 6);
  });

  it('caffeine: exact one-compartment decay, doses add', () => {
    const H = makeHarness();
    H.eat({ caffeineMg: 100 });
    H.step();
    H.eat({ caffeineMg: 50 });
    H.step();
    const d = Math.pow(2, -1 / 5.4);
    expect(H.bus.caffeineLoadMg).toBeCloseTo((100 * d + 50) * d, 10);
  });

  it('caffeine tolerance builds with τ 14 d at ≥ 200 mg/d and decays below', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    H.day.caffeineMg = 300;
    H.idle(24 * 14);
    expect(H.s.caffeineTol).toBeCloseTo(1 - Math.exp(-1), 9);
    H.day.caffeineMg = 100;
    H.idle(24 * 14);
    expect(H.s.caffeineTol).toBeCloseTo((1 - Math.exp(-1)) * Math.exp(-1), 9);
  });
});

describe('O-10: hourly closed forms vs 5-min Euler references', () => {
  it('A_lag (03 §4.7A, 40 g whey): hourly state within 2 % of peak of a 5-min Euler reference, < 0.5 % of a converged one', () => {
    const P0 = 40;
    const H = makeHarness();
    H.eat({ proteinG: P0, proteinSpeed: 1.6, proteinQMeal: 1.15 });
    const hourly: number[] = [];
    for (let h = 0; h < 12; h++) {
      H.step();
      hourly.push(H.bus.raAaQGH);
    }
    // Euler reference: G' = −V·G/(K+G); A' = (Q·F_sys·V·G/(K+G) − A)/τ
    const reference = (dt: number) => {
      const V = 11 * 1.6;
      const K = 20;
      const q = 1.15 * 0.66;
      let G = P0;
      let A = 0;
      const out: number[] = [];
      const n = Math.round(1 / dt);
      for (let h = 0; h < 12; h++) {
        for (let i = 0; i < n; i++) {
          const rate = (V * G) / (K + G);
          G -= rate * dt;
          A += ((q * rate - A) / 0.5) * dt;
        }
        out.push(A);
      }
      return out;
    };
    const e5 = reference(1 / 12);
    const fine = reference(1 / 3600);
    const peak = Math.max(...fine);
    for (let h = 0; h < 12; h++) {
      expect(Math.abs(hourly[h]! - fine[h]!) / peak).toBeLessThan(0.005); // < 0.1 g residue flushed in one hour
      // the 5-min Euler reference carries its own error (dt/τ = 1/6: 3.0 % of peak in hour 0)
      expect(Math.abs(hourly[h]! - e5[h]!) / peak).toBeLessThan(h === 0 ? 0.035 : 0.02);
    }
  });

  it('carbohydrate appearance (04 §4.10 gamma kernel) — cumulative within 2 % of a 5-min Euler integral', () => {
    const H = makeHarness();
    H.eat({ carbG: 100, timeToPeakH: 1 });
    let cum = 0;
    let t = 0;
    let ref = 0;
    for (let h = 0; h < 8; h++) {
      H.step();
      cum += H.bus.raGlcGH + H.bus.raFruGalGH;
      for (let i = 0; i < 12; i++) {
        const tm = t + 1 / 24; // midpoint rule on 5-min steps
        ref += 100 * tm * Math.exp(-tm) * (1 / 12);
        t += 1 / 12;
      }
      expect(Math.abs(cum - ref) / 100).toBeLessThan(0.02);
    }
  });
});

describe('properties over long runs', () => {
  const profile = resolveProfile(MAN_80);
  const sched: Schedule = {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: 2,
    programs: [
      {
        id: 'm',
        label: 'maintenance',
        energy: { kind: 'pctMaintenance', pct: 100 },
        macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
        substances: { caffeine: [{ clockH: 8, mg: 150 }], alcohol: [{ clockH: 19, drinks: 1 }], creatineG: 5 },
      },
    ],
    days: [{ program: 0 }, { program: 0 }],
  };
  const day = compileSchedule(sched, profile).days[0]!;

  it('maintenance day repeated 30 days is periodic (steady state stays steady) and bounded', () => {
    const H = makeHarness(MAN_80, { startHourOfDay: 0 });
    const dayE: number[] = [];
    const dayG: number[] = [];
    for (let d = 0; d < 30; d++) {
      let e = 0;
      let g = 0;
      H.runDay(day, () => {
        e += H.bus.eAbsKcalH;
        g += H.bus.glucoseMmolL / 24;
        finiteBus(H);
        expect(H.bus.glucoseMmolL).toBeGreaterThan(3);
        expect(H.bus.glucoseMmolL).toBeLessThan(12);
      });
      dayE.push(e);
      dayG.push(g);
    }
    for (let d = 10; d < 30; d++) {
      expect(Math.abs(dayE[d]! - dayE[9]!)).toBeLessThan(1e-6 * dayE[9]!);
      expect(Math.abs(dayG[d]! - dayG[9]!)).toBeLessThan(1e-9);
    }
    // eAbs per day = the day's energy (+4.45 kcal/g of nothing, + the fibre ME correction at the F_eff steady state)
    expect(dayE[29]! / day.energyKcal).toBeCloseTo(1 + H.s.dmeRatio, 6);
    expect(H.s.fibreEffG).toBeCloseTo(day.fibreG, 6);
    expect(H.bus.creatineSatFrac).toBeCloseTo(1 - Math.exp(-30 / 6), 1);
  });

  it('21 days of zero intake stay finite with every pool ≥ 0 (O-6 intake part)', () => {
    const H = makeHarness(MAN_80, { startHourOfDay: 0 });
    H.runDay(day);
    H.bus.liverGlycogenG = 5;
    H.idle(24 * 21);
    finiteBus(H);
    expect(H.bus.eAbsKcalH).toBe(0);
    expect(H.bus.insulinRel).toBeGreaterThan(0.4);
    expect(H.bus.insulinRel).toBeLessThan(0.7);
    expect(H.bus.hoursSinceIntakeH).toBeGreaterThan(24 * 21 - 30);
    expect(H.s.nActive).toBe(0);
    for (let i = 0; i < MEAL_SLOTS * MEAL_FIELDS; i++) expect(Number.isNaN(H.s.meals[i]!)).toBe(false);
  });

  it('is deterministic (bit-identical signals for identical inputs)', () => {
    const trace = () => {
      const H = makeHarness(MAN_80, { startHourOfDay: 0 });
      const out: number[] = [];
      for (let d = 0; d < 3; d++) H.runDay(day, () => out.push(H.bus.eAbsKcalH, H.bus.insulinUuMl, H.bus.glucoseMmolL, H.bus.raAaQGH));
      return out;
    };
    expect(trace()).toEqual(trace());
  });

  it('registry values reach the constants (overrides change behaviour)', () => {
    const H = makeHarness(MAN_80, { overrides: { 'intake.gutKgeKcalH': 130 } });
    expect(H.k.gutKge).toBe(130);
    expect(buildModelParams(MODULES).index.has('intake.gutKgeKcalH')).toBe(true);
  });
});
