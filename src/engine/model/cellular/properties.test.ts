// @vitest-environment node
/**
 * Property tests of the cellular module (WP brief): bounds and finiteness, monotonicity, write ownership,
 * steady state at maintenance for 30 simulated days, zero intake for 21 days stays finite, determinism, snapshots,
 * burn-in reference sampling and parameter registry validity.
 */
import { mulberry32 } from '../../core/math';
import { sampleParams, validateParamDefs } from '../../core/paramsRegistry';
import { N_SERIES, MI } from '../../types/metrics';
import { SIGNAL_DEFS } from '../../types/signals';
import { calibrateB0, cellularModule, CELLULAR_PARAMS } from './index';
import { CELLULAR_REGISTRY, endBurnIn, makeRig, mean, mealsForHour, referenceRig, REFERENCE_DAY, runDays, stepOnce, type Rig } from './testkit';

const inRange = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 100;

function fastingRig(hFast: number): Rig {
  const rig = makeRig();
  rig.bus.insulinBasalUuMl = 7;
  rig.s.liverRef12G = 60;
  rig.s.invLiverRef12 = 1 / 60;
  rig.bus.hoursSinceMealH = hFast;
  rig.bus.liverGlycogenG = 60;
  rig.bus.bhbEndoMmolL = 0.1;
  rig.bus.insulinUuMl = 7;
  rig.bus.raAaQGH = 0;
  return rig;
}

describe('bounds and finiteness', () => {
  it('keeps all three indices in [0, 100] and finite over a randomised grid of inputs (including extreme values)', () => {
    const rnd = mulberry32(2024);
    const rig = makeRig();
    for (let i = 0; i < 5000; i++) {
      rig.bus.hoursSinceMealH = rnd() < 0.1 ? 1e6 : rnd() * 400;
      rig.bus.raAaQGH = rnd() < 0.1 ? 1e6 : rnd() * 30;
      rig.bus.insulinUuMl = rnd() < 0.1 ? 1e6 : rnd() * 300;
      rig.bus.liverGlycogenG = rnd() * 130;
      rig.bus.bhbEndoMmolL = rnd() * 9;
      rig.bus.muscleGlycogenRel = rnd() * 1.6;
      rig.bus.mpsStimWb = rnd() * 1.6;
      rig.bus.ffmActKg = 30 + rnd() * 60;
      rig.bus.exMinutesH = rnd() < 0.2 ? rnd() * 60 : 0;
      rig.bus.exIntensityFrac = rnd() * 1.2;
      rig.hour.exMin = rig.bus.exMinutesH;
      rig.hour.exModality = rnd() < 0.5 ? 2 : 0;
      rig.hour.rtSetsTotal = rnd() < 0.1 ? rnd() * 30 : 0;
      rig.bus.energyBalanceFrac = rnd() * 2 - 1;
      stepOnce(rig, i);
      expect(inRange(rig.s.asi) && inRange(rig.s.asiMuscle) && inRange(rig.s.mtor) && inRange(rig.s.ampk)).toBe(true);
      expect(Number.isFinite(rig.s.cDef) && Number.isFinite(rig.s.xEx) && Number.isFinite(rig.s.ampkPulse)).toBe(true);
      expect(rig.s.cDef >= 0 && rig.s.cDef <= 1).toBe(true);
    }
  });

  it('never produces NaN/Infinity even when an upstream module hands over NaN, Infinity or negative values', () => {
    const rig = makeRig();
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5];
    let t = 0;
    for (const v of bad) {
      for (const name of ['hoursSinceMealH', 'raAaQGH', 'insulinUuMl', 'liverGlycogenG', 'bhbEndoMmolL', 'muscleGlycogenRel', 'mpsStimWb', 'ffmActKg', 'exMinutesH', 'exIntensityFrac', 'energyBalanceFrac'] as const) {
        rig.bus[name] = v;
        rig.hour.exMin = 30;
        rig.hour.exModality = 2;
        stepOnce(rig, t++);
        expect(inRange(rig.s.asi) && inRange(rig.s.mtor) && inRange(rig.s.ampk), `${name}=${v}`).toBe(true);
        expect(Number.isFinite(rig.s.xEx) && Number.isFinite(rig.s.cDef)).toBe(true);
        rig.bus[name] = 12; // restore to something plausible before the next signal
      }
    }
    stepOnce(rig, t + 23 - (t % 24)); // an endOfDay with a bad energyBalanceFrac
    expect(Number.isFinite(rig.s.cDef)).toBe(true);
  });

  it('every parameter draw yields in-range indices over a 9-day fast + refeed', () => {
    for (const paramVector of sampleParams(CELLULAR_REGISTRY.defs, { count: 16, seed: 5 })) {
      const { rig, body } = referenceRig(3, { paramVector });
      const tr = runDays(rig, body, 0, 9, (t) => (t >= 24 * 8 ? mealsForHour(REFERENCE_DAY, t) : []));
      for (let i = 0; i < tr.asi.length; i++) expect(inRange(tr.asi[i]!) && inRange(tr.mtor[i]!) && inRange(tr.ampk[i]!) && inRange(tr.asiMuscle[i]!)).toBe(true);
    }
  });
});

describe('monotonicity (each other input held at the reference fasting state)', () => {
  const sweep = (setter: (rig: Rig, x: number) => void, xs: number[], read: (rig: Rig) => number, base = 20): number[] =>
    xs.map((x) => {
      const rig = fastingRig(base);
      setter(rig, x);
      stepOnce(rig, 0);
      return read(rig);
    });
  const nondecreasing = (a: number[]): boolean => a.every((v, i) => i === 0 || v >= a[i - 1]! - 1e-12);
  const nonincreasing = (a: number[]): boolean => a.every((v, i) => i === 0 || v <= a[i - 1]! + 1e-12);
  const grid = (n: number, lo: number, hi: number): number[] => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

  it('ASI rises with hours since the last meal', () => {
    const a = sweep((r, x) => (r.bus.hoursSinceMealH = x), grid(80, 0, 400), (r) => r.s.asi);
    expect(nondecreasing(a)).toBe(true);
  });

  it('ASI falls with insulin above basal and with amino-acid appearance (S only ever suppresses)', () => {
    expect(nonincreasing(sweep((r, x) => (r.bus.insulinUuMl = x), grid(60, 0, 200), (r) => r.s.asi))).toBe(true);
    expect(nonincreasing(sweep((r, x) => (r.bus.raAaQGH = x), grid(60, 0, 20), (r) => r.s.asi))).toBe(true);
  });

  it('ASI rises with endogenous BHB and with liver-glycogen depletion; exercise pulse and CR term only add', () => {
    expect(nondecreasing(sweep((r, x) => (r.bus.bhbEndoMmolL = x), grid(60, 0, 8), (r) => r.s.asi))).toBe(true);
    expect(nonincreasing(sweep((r, x) => (r.bus.liverGlycogenG = x), grid(60, 0, 120), (r) => r.s.asi))).toBe(true);
    expect(
      nondecreasing(
        sweep(
          (r, x) => {
            r.bus.exMinutesH = 60;
            r.bus.exIntensityFrac = x;
            r.hour.exMin = 60;
            r.hour.exModality = 2;
          },
          grid(40, 0.1, 1.1),
          (r) => r.s.asi,
        ),
      ),
    ).toBe(true);
    expect(nondecreasing(sweep((r, x) => (r.s.asiCr = x), grid(10, 0, 3), (r) => r.s.asi))).toBe(true);
  });

  it('mTORC1 rises with amino acids, insulin and post-exercise sensitisation, and falls with the fasting clock', () => {
    expect(nondecreasing(sweep((r, x) => (r.bus.raAaQGH = x), grid(60, 0, 20), (r) => r.s.mtor, 2))).toBe(true);
    expect(nondecreasing(sweep((r, x) => { r.bus.raAaQGH = 3; r.bus.insulinUuMl = 7 + x; }, grid(60, 0, 100), (r) => r.s.mtor, 2))).toBe(true);
    expect(nondecreasing(sweep((r, x) => { r.bus.raAaQGH = 3; r.bus.mpsStimWb = x; }, grid(30, 0, 1.6), (r) => r.s.mtor, 2))).toBe(true);
    expect(nonincreasing(sweep((r, x) => (r.bus.hoursSinceMealH = x), grid(60, 0, 300), (r) => r.s.mtor))).toBe(true);
  });

  it('AMPK rises with exercise intensity and with muscle-glycogen depletion; does not rise with the fasting clock', () => {
    expect(
      nondecreasing(
        sweep(
          (r, x) => {
            r.bus.exMinutesH = 60;
            r.bus.exIntensityFrac = x;
            r.hour.exMin = 60;
            r.hour.exModality = 2;
          },
          grid(40, 0.3, 1.1),
          (r) => r.s.ampk,
          12,
        ),
      ),
    ).toBe(true);
    expect(nonincreasing(sweep((r, x) => (r.bus.muscleGlycogenRel = x), grid(40, 0, 1.4), (r) => r.s.ampk, 12))).toBe(true);
    expect(nonincreasing(sweep((r, x) => (r.bus.hoursSinceMealH = x), grid(60, 0, 300), (r) => r.s.ampk))).toBe(true);
  });
});

describe('write ownership and records', () => {
  it('only writes asiIdx to the bus and mirrors the state; records the three series', () => {
    const rig = makeRig();
    const rnd = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      rig.bus.hoursSinceMealH = rnd() * 60;
      rig.bus.insulinUuMl = 5 + rnd() * 60;
      rig.bus.raAaQGH = rnd() * 8;
      rig.bus.liverGlycogenG = rnd() * 100;
      rig.bus.bhbEndoMmolL = rnd() * 4;
      const before = { ...rig.bus };
      stepOnce(rig, i);
      for (const d of SIGNAL_DEFS) {
        if (d.name === 'asiIdx') continue;
        expect((rig.bus as Record<string, number>)[d.name], d.name).toBe((before as Record<string, number>)[d.name]);
      }
      expect(rig.bus.asiIdx).toBe(rig.s.asi);
    }
    const out = new Float64Array(N_SERIES);
    cellularModule.recordHour(rig.s, rig.k, rig.bus, out);
    expect(out[MI.autophagyIdx]).toBe(rig.s.asi);
    expect(out[MI.mtorIdx]).toBe(rig.s.mtor);
    expect(out[MI.ampkIdx]).toBe(rig.s.ampk);
    expect(cellularModule.records).toEqual(['autophagyIdx', 'mtorIdx', 'ampkIdx']);
  });

  it('init writes a sensible t = 0 value (≈ 25 at hFast 12 h on the safe bus defaults) and 12 h/rest values for mTOR and AMPK ≈ 20', () => {
    const rig = makeRig();
    expect(rig.s.asi).toBeCloseTo(25, 6);
    expect(rig.bus.asiIdx).toBe(rig.s.asi);
    expect(rig.s.mtor).toBeGreaterThan(18);
    expect(rig.s.mtor).toBeLessThan(21);
    expect(rig.s.ampk).toBeGreaterThan(18);
    expect(rig.s.ampk).toBeLessThan(21);
  });
});

describe('planner mode (series not recorded)', () => {
  it('skips the display-only mTORC1 / AMPK indices when neither series is recorded; the ASI (asiIdx) is identical', () => {
    const planner = new Uint8Array(N_SERIES);
    planner[MI.autophagyIdx] = 1;
    const full = referenceRig(3);
    const plan = referenceRig(3, { seriesEnabled: planner });
    expect(plan.rig.k.doSignalling).toBe(false);
    expect(full.rig.k.doSignalling).toBe(true);
    const a = runDays(full.rig, full.body, 0, 3, (t) => mealsForHour(REFERENCE_DAY, t));
    const b = runDays(plan.rig, plan.body, 0, 3, (t) => mealsForHour(REFERENCE_DAY, t));
    expect(Array.from(b.asi)).toEqual(Array.from(a.asi));
    expect(plan.rig.bus.asiIdx).toBe(full.rig.bus.asiIdx);
    // mTORC1 / AMPK keep their init values in planner mode
    expect(new Set(Array.from(b.mtor)).size).toBe(1);
  });
});

describe('long runs', () => {
  it('steady state at maintenance stays steady for 30 simulated days (periodic day, no drift, no chronic term)', () => {
    const { rig, body } = referenceRig(7);
    const tr = runDays(rig, body, 0, 30, (t) => mealsForHour(REFERENCE_DAY, t), (_t, r) => {
      r.bus.energyBalanceFrac = 0;
    });
    const d = (k: number) => tr.asi.slice(24 * k, 24 * (k + 1));
    for (let h = 0; h < 24; h++) expect(Math.abs(d(29)[h]! - d(20)[h]!)).toBeLessThan(1e-6);
    expect(rig.s.cDef).toBeLessThan(1e-9);
    expect(rig.s.asiCr).toBeLessThan(1e-6);
    expect(mean(d(29))).toBeGreaterThan(8);
    expect(mean(d(29))).toBeLessThan(16);
    expect(Math.max(...d(29))).toBeLessThan(30);
    for (let i = 0; i < tr.mtor.length; i++) expect(inRange(tr.mtor[i]!) && inRange(tr.ampk[i]!)).toBe(true);
  });

  it('zero intake for 21 days stays finite, in range, and plateaus below 100 without decline (08 §4.5)', () => {
    const { rig, body } = referenceRig(7);
    const tr = runDays(rig, body, 0, 21, () => [], (_t, r) => {
      r.bus.energyBalanceFrac = -1;
    });
    for (let i = 0; i < tr.asi.length; i++) expect(inRange(tr.asi[i]!) && inRange(tr.asiMuscle[i]!) && inRange(tr.mtor[i]!) && inRange(tr.ampk[i]!)).toBe(true);
    const n = tr.asi.length;
    for (let i = 24 * 8; i < n; i++) expect(tr.asi[i]!).toBeGreaterThanOrEqual(tr.asi[i - 1]! - 0.5); // plateau, no decline beyond the CR ramp jitter
    expect(tr.asi[n - 1]!).toBeGreaterThan(93);
    expect(tr.asi[n - 1]!).toBeLessThanOrEqual(100);
    expect(rig.s.asiCr).toBeGreaterThan(2.9); // chronic term saturated at A_CR = 3
    // mTORC1 stays at its fasting floor: 100·0.2·(1 − 0.65·F_clock) ≥ 100·0.2·0.35
    expect(tr.mtor[n - 1]!).toBeGreaterThan(6);
    expect(tr.mtor[n - 1]!).toBeLessThan(12);
  });

  it('is deterministic (bit-identical) and a structuredClone snapshot of the state resumes identically', () => {
    const run = () => {
      const { rig, body } = referenceRig(4);
      return { tr: runDays(rig, body, 0, 6, (t) => mealsForHour(REFERENCE_DAY, t)), rig };
    };
    const a = run();
    const b = run();
    expect(Array.from(b.tr.asi)).toEqual(Array.from(a.tr.asi));
    expect(Array.from(b.tr.mtor)).toEqual(Array.from(a.tr.mtor));
    expect(Array.from(b.tr.ampk)).toEqual(Array.from(a.tr.ampk));
    // snapshot mid-run (with a live exercise pulse and chronic term), then continue both copies with identical inputs
    const rigA = a.rig;
    rigA.bus.energyBalanceFrac = -0.4;
    rigA.hour.exMin = 45;
    rigA.hour.exModality = 2;
    rigA.bus.exMinutesH = 45;
    rigA.bus.exIntensityFrac = 0.8;
    stepOnce(rigA, 6 * 24);
    const rigB: Rig = { ...rigA, s: structuredClone(rigA.s), bus: { ...rigA.bus }, clock: { ...rigA.clock }, hour: { ...rigA.hour } };
    expect(rigB.s).toEqual(rigA.s);
    rigA.hour.exMin = rigB.hour.exMin = 0;
    rigA.bus.exMinutesH = rigB.bus.exMinutesH = 0;
    const rnd = mulberry32(3);
    for (let i = 1; i <= 60; i++) {
      const hf = rnd() * 40;
      const ins = 5 + rnd() * 40;
      for (const r of [rigA, rigB]) {
        r.bus.hoursSinceMealH = hf;
        r.bus.insulinUuMl = ins;
      }
      stepOnce(rigA, 6 * 24 + i);
      stepOnce(rigB, 6 * 24 + i);
      expect(rigB.s.asi).toBe(rigA.s.asi);
      expect(rigB.s.mtor).toBe(rigA.s.mtor);
      expect(rigB.s.ampk).toBe(rigA.s.ampk);
    }
  });
});

describe('burn-in reference sampling (MODEL_SPEC §3.4)', () => {
  /** One burn-in / real day with a single daily meal clock: hFast = hours since `mealH`; G_L and BHB as functions of hFast. */
  const feedDay = (rig: Rig, day: number, mealHours: readonly number[], g: (h: number) => number, b: (h: number) => number, basal = 4.5) => {
    for (let hod = 0; hod < 24; hod++) {
      let hf = 99;
      for (const m of mealHours) {
        const d = (hod - m + 24) % 24;
        if (d < hf) hf = d;
      }
      rig.bus.hoursSinceMealH = hf;
      rig.bus.liverGlycogenG = g(hf);
      rig.bus.bhbEndoMmolL = b(hf);
      rig.bus.insulinBasalUuMl = basal;
      rig.bus.insulinUuMl = basal;
      rig.bus.raAaQGH = 0;
      stepOnce(rig, day * 24 + hod);
    }
  };

  it('samples G_L and endogenous BHB at the hFast = 12 h crossing of the last habitual week, latches them in endBurnIn, then freezes them', () => {
    const rig = makeRig();
    // days −14…−8: a different habitual state (must not count); days −7…−1: keto-habituated (G_L 33 g, BHB 0.8 at 12 h)
    for (let d = -14; d < -7; d++) feedDay(rig, d, [19], (h) => 80 - h, () => 0.1);
    for (let d = -7; d < 0; d++) feedDay(rig, d, [19], (h) => 45 - h, (h) => 0.2 + 0.05 * h);
    expect(rig.s.refN).toBe(7);
    expect(rig.s.calibrated).toBe(0);
    endBurnIn(rig);
    expect(rig.s.calibrated).toBe(1);
    expect(rig.s.liverRef12G).toBeCloseTo(33, 9);
    expect(rig.s.bhbRef12MmolL).toBeCloseTo(0.8, 9);
    // ASI is 25 at their own 12 h state (B0 calibrated on the sampled BHB)
    rig.bus.hoursSinceMealH = 12;
    rig.bus.liverGlycogenG = 33;
    rig.bus.bhbEndoMmolL = 0.8;
    stepOnce(rig, 7);
    expect(rig.s.asi).toBeCloseTo(25, 6);
    // frozen after burn-in: real days with a different 12 h state do not move the references
    feedDay(rig, 1, [19], (h) => 72 - h, () => 0.1);
    expect(rig.s.liverRef12G).toBeCloseTo(33, 9);
    expect(rig.s.bhbRef12MmolL).toBeCloseTo(0.8, 9);
    expect(rig.s.refN).toBe(7);
  });

  it('extrapolates the last hour\'s trend to 12 h when the habitual overnight fast ends earlier (3 meals 08:00-20:00: hFast ≤ 11 h)', () => {
    const rig = makeRig();
    for (let d = -14; d < 0; d++) feedDay(rig, d, [8, 14, 20], (h) => 100 - 2 * h, (h) => 0.05 + 0.01 * h);
    endBurnIn(rig);
    expect(rig.s.refN).toBe(7);
    // G_L(11) = 78 g falling 2 g/h → 76 g; BHB(11) = 0.16 rising 0.01/h → 0.17 mM
    expect(rig.s.liverRef12G).toBeCloseTo(76, 9);
    expect(rig.s.bhbRef12MmolL).toBeCloseTo(0.17, 9);
    expect(rig.s.b0).toBeCloseTo(calibrateB0(rig.k, 0.17), 12);
  });

  it('a burn-in without a usable overnight fast keeps the priors (no NaN, B0 nominal)', () => {
    const rig = makeRig();
    for (let h = -48; h < 0; h++) {
      rig.bus.hoursSinceMealH = (h + 48) % 6;
      stepOnce(rig, h);
    }
    endBurnIn(rig);
    expect(rig.s.refN).toBe(0);
    expect(rig.s.liverRef12G).toBeCloseTo(0.75 * 80, 9);
    expect(rig.s.bhbRef12MmolL).toBeCloseTo(0.1, 12);
    expect(rig.s.b0).toBeCloseTo(rig.k.b0Nominal, 12);
    expect(Number.isFinite(rig.s.asi)).toBe(true);
  });
});

describe('parameter registry', () => {
  it('every ParamDef is valid (unique, prefixed, low ≤ value ≤ high, source and § present)', () => {
    expect(validateParamDefs([cellularModule as never])).toEqual([]);
    for (const p of CELLULAR_PARAMS) {
      expect(p.id.startsWith('cellular.')).toBe(true);
      expect(p.unit.length).toBeGreaterThan(0);
      expect(p.status).toBeDefined();
    }
  });

  it('carries the dossier/spec nominal values (h50 calibrated 60 h, EC50_I 5, w_ins 0.75, A_ex 15, A_CR 3, τEx 3 h, τCR 7 d)', () => {
    const v = (n: string) => CELLULAR_PARAMS.find((p) => p.id === `cellular.${n}`)!;
    expect(v('h50').value).toBe(60);
    expect([v('h50').low, v('h50').high]).toEqual([24, 96]);
    expect(v('h50').draw).toBe('logTri');
    expect(v('ec50I').value).toBe(5);
    expect([v('ec50I').low, v('ec50I').high]).toEqual([3, 15]);
    expect(v('wIns').value).toBe(0.75);
    expect(v('wAa').value).toBe(0.6);
    expect(v('ec50L').value).toBe(0.5);
    expect(v('nh').value).toBe(2);
    expect(v('kBhb').value).toBe(1.5);
    expect(v('aEx').value).toBe(15);
    expect(v('aExMuscle').value).toBe(25);
    expect(v('tauEx').value).toBe(3);
    expect(v('aCR').value).toBe(3);
    expect(v('tauCR').value).toBe(7);
    expect(v('asiRef12').value).toBe(25);
  });
});
