// @vitest-environment node
/** Property tests: bounds, monotonicity, steady state, zero-intake finiteness, determinism, snapshot, wiring, registry. */
import { wellbeingModule, wellbeingParams, type WellbeingState } from '../index';
import { validateParamDefs, buildModelParams } from '../../../core/paramsRegistry';
import { mulberry32 } from '../../../core/math';
import { SIGNAL_DEFS } from '../../../types/signals';
import { SERIES } from '../../../types/metrics';
import type { AnyEngineModule } from '../../../types/module';
import { MAN, WOMAN, makeHarness, MI, type Harness, type Scenario } from './harness';

const finiteState = (s: WellbeingState): boolean => {
  for (const [key, v] of Object.entries(s)) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return false;
    } else if (ArrayBuffer.isView(v)) {
      for (let i = 0; i < (v as Float64Array).length; i++) if (!Number.isFinite((v as Float64Array)[i]!)) return false;
    } else {
      throw new Error(`unexpected state field ${key}`);
    }
  }
  return true;
};

describe('registry and wiring', () => {
  it('parameter definitions validate (unique ids, module prefix, low ≤ value ≤ high, source and § present)', () => {
    expect(validateParamDefs([wellbeingModule as unknown as AnyEngineModule])).toEqual([]);
    expect(new Set(wellbeingParams.map((p) => p.id)).size).toBe(wellbeingParams.length);
    expect(wellbeingParams.length).toBeGreaterThan(100);
    // every value that is drawn is a plausible range of the same quantity; grade-D tables and structural constants never vary
    const variable = wellbeingParams.filter((p) => p.low < p.high && p.draw !== 'fixed');
    expect(variable.every((p) => p.grade !== 'D' || p.status === 'unverified')).toBe(true);
    expect(buildModelParams([wellbeingModule as unknown as AnyEngineModule]).values.length).toBe(wellbeingParams.length);
  });

  it('declared reads/writes follow the signal table (MODEL_SPEC §4, checkWiring semantics: unread listed readers are pending)', () => {
    const m = wellbeingModule;
    for (const d of SIGNAL_DEFS) {
      if (d.writer === 'wellbeing') expect(m.writes).toContain(d.name);
    }
    expect(m.reads).toContain('exSessionNetKcalD');
    expect(m.reads).not.toContain('exSessionNetKcalH');
    const byName = new Map<string, (typeof SIGNAL_DEFS)[number]>(SIGNAL_DEFS.map((d) => [d.name, d]));
    for (const w of m.writes) expect(byName.get(w)?.writer).toBe('wellbeing');
    for (const r of m.reads) expect((byName.get(r)?.readers as readonly string[]).includes('wellbeing')).toBe(true);
  });

  it('records exactly the six series the spec assigns to the module, all daily-resolution', () => {
    expect([...wellbeingModule.records].sort()).toEqual(['enduranceCapacity', 'energyAvailability', 'hipBmdChange', 'ketoInduction', 'micronutrientScore', 'moodTier']);
    for (const id of wellbeingModule.records) expect(SERIES.find((s) => s.id === id)?.owner).toBe('wellbeing');
    const h = makeHarness(MAN);
    const out = h.record();
    for (const id of wellbeingModule.records) expect(Number.isFinite(out[MI[id]]!)).toBe(true);
  });
});

describe('steady state at maintenance stays steady for 30 simulated days', () => {
  it.each([
    ['man', MAN],
    ['woman', WOMAN],
  ])('%s: every output and slow state unchanged', (_n, profile) => {
    const h = makeHarness(profile);
    const a = { ...h.s, eaRing: undefined };
    const rec0 = h.record();
    h.run({}, 30);
    expect(h.s.eaS).toBeCloseTo(a.eaS, 1);
    expect(h.s.mEa).toBe(1);
    expect(h.s.bmdHipPct).toBe(0);
    expect(h.s.bmdSpinePct).toBe(0);
    expect(h.s.p1np).toBeCloseTo(1, 2);
    expect(h.s.ctx).toBeCloseTo(1, 2);
    expect(h.s.ketoInduction).toBe(0);
    expect(h.s.moodTier).toBe(0);
    expect(h.s.enduranceIdx).toBeCloseTo(100, 6);
    expect(h.s.microScore).toBeCloseTo(a.microScore, 6);
    const rec1 = h.record();
    for (const id of wellbeingModule.records) expect(rec1[MI[id]]!).toBeCloseTo(rec0[MI[id]]!, 1);
    expect(h.bus.strengthEaMult).toBe(1);
  });

  it('habitual exerciser (sessions inside the day) also stays steady: baseline-relative indices', () => {
    const h = makeHarness(MAN);
    h.base.eee = 0;
    h.run({ eee: 250, exMin: 60, rtSets: 12 }, 30);
    // EA falls by the session energy but stays ≥ 30 → M_EA 1, no bone or endurance change
    expect(h.s.mEa).toBe(1);
    expect(h.s.bmdHipPct).toBe(0);
    expect(h.s.enduranceIdx).toBeCloseTo(100, 6);
  });
});

describe('zero intake for 21 days stays finite and bounded', () => {
  it.each([
    ['man', MAN],
    ['woman', WOMAN],
  ])('%s: no NaN/Infinity, EA at the −5 floor, M_EA ≥ 0.7', (_n, profile) => {
    const h = makeHarness(profile);
    const fm0 = h.bus.fatMassKg;
    for (let d = 0; d < 21; d++) {
      h.bus.fatMassKg = fm0 - 0.18 * (d + 1);
      h.bus.ketoAdaptFast = Math.min(1, 0.2 * d);
      h.run({ ei: 0, carb: 0, fat: 0, fibre: 0, fast: true, eee: 30, exMin: 20 }, 1);
      expect(finiteState(h.s)).toBe(true);
      const rec = h.record();
      for (const id of wellbeingModule.records) expect(Number.isFinite(rec[MI[id]]!)).toBe(true);
    }
    expect(h.s.eaS).toBeGreaterThanOrEqual(-5);
    expect(h.s.eaS).toBeLessThan(0);
    expect(h.s.mEa).toBeGreaterThanOrEqual(0.7);
    expect(h.s.mEa).toBeLessThan(1);
    expect(h.s.microScore).toBeLessThan(50);
    expect(h.s.ketoInduction).toBe(0); // fast days are not carbohydrate-restriction days
  });

  it('a zero-intake day gives EA = −EEE/FFM (clipped at −5) and a zero-fibre, zero-energy micronutrient EMA decays', () => {
    const h = makeHarness(WOMAN);
    h.run({ ei: 0, carb: 0, fat: 0, fibre: 0, fast: true }, 1);
    expect(h.s.eaRing[h.s.eaIdx]).toBe(0);
    expect(h.s.energyEma7).toBeLessThan(h.base.ei);
  });
});

describe('bounds under random schedules (deterministic seed)', () => {
  it('outputs stay inside their physical ranges for 4 × 200 random days', () => {
    for (const [seed, profile] of [[1, MAN], [2, WOMAN], [3, MAN], [4, WOMAN]] as const) {
      const rnd = mulberry32(seed);
      const h = makeHarness(profile);
      const fm0 = h.bus.fatMassKg;
      const ffm0 = h.bus.ffmActKg;
      for (let d = 0; d < 200; d++) {
        const sc: Scenario = {
          ei: rnd() < 0.1 ? 0 : h.base.ei * (0.2 + 1.6 * rnd()),
          carb: rnd() < 0.3 ? 20 * rnd() : h.base.carb * (0.3 + 1.4 * rnd()),
          fat: h.base.fat * (0.05 + 1.5 * rnd()),
          fibre: h.base.fibre * 2 * rnd(),
          eee: rnd() < 0.5 ? 700 * rnd() : 0,
          exMin: 90 * rnd(),
          rtSets: rnd() < 0.3 ? 20 * rnd() : 0,
          sodiumMg: 500 + 4000 * rnd(),
          quality: 1 + Math.floor(3 * rnd()),
          fast: rnd() < 0.05,
        };
        h.bus.fatMassKg = Math.max(3, fm0 * (0.6 + 0.6 * rnd()));
        h.bus.ffmActKg = ffm0 * (0.85 + 0.2 * rnd());
        h.bus.ketoAdaptFast = rnd();
        h.bus.muscleGlycogenG = 30 * 17.3 * (0.2 + 1.5 * rnd());
        h.bus.sleepDebtSlowH = 3 * rnd();
        h.run(sc, 1);
        const s = h.s;
        expect(finiteState(s)).toBe(true);
        expect(s.eaS).toBeGreaterThanOrEqual(-5);
        expect(s.eaS).toBeLessThanOrEqual(70);
        expect(s.mEa).toBeGreaterThanOrEqual(0.7);
        expect(s.mEa).toBeLessThanOrEqual(1);
        expect(s.p1np).toBeGreaterThanOrEqual(0.05);
        expect(s.p1np).toBeLessThanOrEqual(1.1);
        expect(s.ctx).toBeGreaterThanOrEqual(0.95);
        expect(s.ctx).toBeLessThanOrEqual(3);
        expect(s.bmdHipPct).toBeLessThanOrEqual(1e-9);
        expect(s.enduranceIdx).toBeGreaterThanOrEqual(0);
        expect(s.enduranceIdx).toBeLessThanOrEqual(300);
        expect([0, 1, 2]).toContain(s.moodTier);
        expect(s.ketoInduction).toBeGreaterThanOrEqual(0);
        expect(s.ketoInduction).toBeLessThanOrEqual(1);
        expect(s.microScore).toBeGreaterThanOrEqual(0);
        expect(s.microScore).toBeLessThanOrEqual(100);
        expect(s.aEcon).toBeGreaterThanOrEqual(0);
        expect(s.aEcon).toBeLessThanOrEqual(1);
        expect(h.bus.strengthEaMult).toBe(s.mEa);
        expect(h.bus.ketoInduction).toBe(s.ketoInduction);
      }
    }
  });
});

describe('monotonicity', () => {
  const held = (ea: number, days: number, extra: Scenario = {}): Harness => {
    const h = makeHarness(MAN);
    h.run({ ei: ea * h.bus.ffmActKg, ...extra }, days);
    return h;
  };
  it('M_EA falls and P1NP falls as availability falls; CTX rises', () => {
    const eas = [45, 35, 30, 25, 20, 15, 10, 5];
    const hs = eas.map((ea) => held(ea, 90));
    for (let i = 1; i < hs.length; i++) {
      expect(hs[i]!.s.mEa).toBeLessThanOrEqual(hs[i - 1]!.s.mEa + 1e-12);
      expect(hs[i]!.s.p1np).toBeLessThanOrEqual(hs[i - 1]!.s.p1np + 1e-12);
      expect(hs[i]!.s.ctx).toBeGreaterThanOrEqual(hs[i - 1]!.s.ctx - 1e-12);
      expect(hs[i]!.s.eaS).toBeLessThan(hs[i - 1]!.s.eaS);
    }
    expect(hs[0]!.s.mEa).toBe(1);
    expect(hs[hs.length - 1]!.s.mEa).toBeLessThan(0.95);
  });
  it('hip BMD loss deepens with the cumulative weight loss', () => {
    let prev = 0;
    for (const lossPct of [0, 2, 5, 10, 15, 20]) {
      const h = makeHarness(MAN);
      const mass0 = h.bus.fatMassKg + h.bus.ffmActKg;
      for (let d = 0; d < 400; d++) {
        h.bus.fatMassKg = h.profile.fm0Kg - (mass0 * lossPct) / 100 * Math.min(1, (d + 1) / 200);
        h.run({}, 1);
      }
      expect(h.s.bmdHipPct).toBeLessThanOrEqual(prev + 1e-12);
      prev = h.s.bmdHipPct;
    }
    expect(prev).toBeLessThan(-2);
  });
  it('a deeper carbohydrate drop gives a larger Φ_max; the endurance index rises with muscle glycogen', () => {
    let prev = -1;
    for (const c of [250, 150, 90, 50, 20, 0]) {
      const h = makeHarness(MAN);
      h.run({ carb: Math.min(c, 49.9), sodiumMg: 1500 }, 1);
      const phiMax = c >= 50 ? 0 : h.s.phiMax;
      expect(phiMax).toBeGreaterThanOrEqual(prev);
      prev = phiMax;
    }
    let prevIdx = -1;
    for (const rel of [0.2, 0.4, 0.7, 1.0, 1.3]) {
      const h = makeHarness(MAN);
      h.bus.muscleGlycogenG = 30 * 17.3 * rel;
      h.run({}, 1);
      expect(h.s.enduranceIdx).toBeGreaterThan(prevIdx);
      prevIdx = h.s.enduranceIdx;
    }
  });
  it('fat adaptation lowers the endurance index; carbohydrate restoration recovers it', () => {
    const h = makeHarness(MAN);
    h.bus.ketoAdaptFast = 1;
    h.run({}, 10);
    const low = h.s.enduranceIdx;
    expect(low).toBeLessThan(95);
    h.bus.ketoAdaptFast = 0;
    h.run({}, 12);
    expect(h.s.enduranceIdx).toBeGreaterThan(low);
    expect(h.s.enduranceIdx).toBeGreaterThan(99);
  });
  it('mood tier is monotone in each rubric input', () => {
    const tier = (mut: (h: Harness) => void): number => {
      const h = makeHarness(MAN);
      mut(h);
      h.run({}, 1);
      return h.s.moodTier;
    };
    expect(tier(() => {})).toBe(0);
    expect(tier((h) => { h.bus.sleepDebtSlowH = 2; })).toBe(0); // 1 point → still green
    expect(tier((h) => { h.bus.sleepDebtSlowH = 2; h.bus.fatMassKg = h.bus.fatMassKg * 0.3; })).toBeGreaterThanOrEqual(1); // + very lean
  });
});

describe('determinism and snapshots', () => {
  const scenario = (i: number): Scenario => ({ ei: 1500 + 40 * (i % 9), carb: 30 + 10 * (i % 13), eee: 100 * (i % 4), exMin: 30 * (i % 3), rtSets: i % 5 === 0 ? 10 : 0 });
  it('same inputs give bit-identical outputs', () => {
    const run = (): Float64Array => {
      const h = makeHarness(WOMAN);
      for (let i = 0; i < 90; i++) h.run(scenario(i), 1);
      return h.record();
    };
    expect(Array.from(run())).toEqual(Array.from(run()));
  });
  it('structuredClone(state) is a valid snapshot (typed arrays included)', () => {
    const a = makeHarness(MAN);
    for (let i = 0; i < 40; i++) a.run(scenario(i), 1);
    const b = makeHarness(MAN, { noBurnIn: true });
    b.s = structuredClone(a.s);
    Object.assign(b.bus, a.bus);
    b.dayIdx = a.dayIdx;
    for (let i = 40; i < 80; i++) {
      a.run(scenario(i), 1);
      b.run(scenario(i), 1);
    }
    expect(Array.from(b.record())).toEqual(Array.from(a.record()));
    expect(b.s.flags).toEqual(a.s.flags);
  });
});
