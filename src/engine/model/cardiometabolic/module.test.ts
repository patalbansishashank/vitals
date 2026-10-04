// @vitest-environment node
/**
 * Contract, property and integration tests of the cardiometabolic module: registry/wiring, steady state at maintenance,
 * zero-intake behaviour, bounds under extreme inputs, monotonicity, determinism, ensemble finiteness, bus writes, the
 * post-absorptive glucose offset and the optional DayInput fields. Full-engine runs live in fullLoop.test.ts (this file
 * imports only the module, so a transient error in another module cannot break it).
 */
import { buildModelParams, sampleParams, validateParamDefs, variableParamCount } from '../../core/paramsRegistry';
import { MI, N_SERIES, SERIES } from '../../types/metrics';
import { SIGNAL_DEFS } from '../../types/signals';
import { cardiometabolicModule } from './index';
import { CARDIOMETABOLIC_PARAMS } from './params';
import { dietDay, makeRig, MAN_PROFILE, RIG_FAT_SHARE, run, snapshot, stepDay, WOMAN_PROFILE, type Scenario } from './testkit';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const ZERO_DAY = { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, sugarsG: 0, fructoseG: 0, satFatG: 0, mufaG: 0, pufaG: 0, viscousFibreG: 0, omega3G: 0, alcoholG: 0 };

describe('registry and wiring', () => {
  it('ParamDefs validate (unique, prefixed, low ≤ value ≤ high, source and § present) and cover the 10 latent quantiles', () => {
    expect(validateParamDefs([cardiometabolicModule as never])).toEqual([]);
    const ids = CARDIOMETABOLIC_PARAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ['ldl', 'hdl', 'lnTg', 'sbp', 'fpg', 'lnIns', 'a1c', 'lnCrp', 'lnAlt', 'ua']) {
      const p = CARDIOMETABOLIC_PARAMS.find((x) => x.id === `cardiometabolic.u.${m}`)!;
      expect(p.value).toBe(0.5);
      expect(p.draw).toBe('uniform');
    }
    for (const p of CARDIOMETABOLIC_PARAMS) {
      expect(p.dossier.length).toBeGreaterThan(0);
      expect(p.source.length).toBeGreaterThan(0);
      expect(p.status).toBeDefined();
    }
  });
  it('M20: convention alternatives are not sampled (fixed), and every fixed parameter has low = high = value', () => {
    for (const p of CARDIOMETABOLIC_PARAMS) if (p.draw === 'fixed') expect([p.low, p.high]).toEqual([p.value, p.value]);
    const bev = CARDIOMETABOLIC_PARAMS.find((p) => p.id === 'cardiometabolic.ua.beverageMult')!;
    expect(bev.draw).toBe('fixed');
    expect(bev.note).toContain('M20');
  });
  it('wiring (core/moduleRegistry checkWiring semantics): owns every write, is a listed reader of every read; records its series', () => {
    const m = cardiometabolicModule;
    for (const w of m.writes) expect(SIGNAL_DEFS.find((d) => d.name === w)?.writer, w).toBe('cardiometabolic');
    for (const r of m.reads) {
      const d = SIGNAL_DEFS.find((x) => x.name === r);
      expect(d, r).toBeDefined();
      expect(d!.readers as readonly string[], r).toContain('cardiometabolic');
    }
    expect([...cardiometabolicModule.writes].sort()).toEqual(['carbTolerance', 'insulinResistanceIdx', 'liverFatPct', 'sHep', 'sMus']);
    expect([...cardiometabolicModule.records].sort()).toEqual(['apoB', 'crp', 'fastingGlucose', 'hdl', 'insulinSensitivity', 'ldl', 'liverFat', 'sbp', 'triglycerides', 'uricAcid']);
    for (const id of cardiometabolicModule.records) expect(SERIES.find((s) => s.id === id)!.owner).toBe('cardiometabolic');
  });
  it('the registry has enough variable parameters and the nominal vector is inside every range', () => {
    const mp = buildModelParams([cardiometabolicModule as never]);
    expect(variableParamCount(mp.defs)).toBeGreaterThan(80);
    mp.defs.forEach((d, i) => {
      expect(mp.values[i]!).toBeGreaterThanOrEqual(d.low);
      expect(mp.values[i]!).toBeLessThanOrEqual(d.high);
    });
  });
});

describe('steady state at maintenance stays steady (30 simulated days)', () => {
  const drift = (rig: ReturnType<typeof makeRig>, n = 30) => {
    const a = snapshot(rig);
    const r = run(rig, n, () => ({}));
    const b = r[n - 1]!;
    return (Object.keys(a) as (keyof typeof a)[]).map((k) => Math.abs(b[k] - a[k]) / Math.max(1e-9, Math.abs(a[k])));
  };
  it('man, woman, with labs, after a 14-day burn-in through the module: every output within 1e-9 relative', () => {
    for (const opts of [
      { profile: MAN_PROFILE },
      { profile: WOMAN_PROFILE },
      { profile: MAN_PROFILE, labs: { ldlMmolL: 4.2, hdlMmolL: 1.0, tgMmolL: 2.1, sbpMmHg: 142, fastingGlucoseMmolL: 5.9, fastingInsulinUuMl: 14, hba1cPct: 5.8, crpMgL: 3.4, liverFatPct: 9, urateMgDl: 7.1 } },
    ]) {
      const rig = makeRig({ ...opts, burnIn: 14 });
      for (const x of drift(rig)) expect(x).toBeLessThan(1e-9);
    }
  });
  it('the burn-in itself does not move the state away from the initial equilibrium', () => {
    const cold = makeRig({ burnIn: 0 });
    const warm = makeRig({ burnIn: 14 });
    const a = snapshot(cold);
    const b = snapshot(warm);
    for (const k of Object.keys(a) as (keyof typeof a)[]) near(a[k], b[k], 1e-9 * Math.max(1, Math.abs(a[k])));
  });
  it('a habitual exerciser (4 cardio sessions/wk, the burn-in week has them) who keeps the routine: weekly means flat on every marker', () => {
    const profile = { ...MAN_PROFILE, habits: { sessionsPerWeek: 4, lifingCardioMix: 1 } };
    const bout = [{ atH: 18, minutes: 60, met: 5 }];
    const week = (d: number): Scenario => ({ bouts: ((d % 7) + 7) % 7 < 4 ? bout : [] });
    const rig = makeRig({ profile, burnIn: 14, burnScenario: week });
    const a = snapshot(rig);
    // t = 0: every marker exactly at its baseline; the habitual weekly doses are the ones the burn-in week delivered
    near(a.ldl, rig.k.ldl0, 1e-9);
    near(a.hdl, rig.k.hdl0, 1e-9);
    near(a.sbp, rig.k.sbp0, 1e-9);
    near(a.liver, rig.k.l0, 1e-9);
    near(a.crpRel, 1, 1e-12);
    near(rig.s.metRefHWk, 4 * 5, 1e-9);
    const r = run(rig, 91, week);
    const wk = (k: keyof typeof a, w: number) => r.slice(7 * w, 7 * w + 7).reduce((s, x) => s + x[k], 0) / 7;
    for (const k of ['ldl', 'hdl', 'tg', 'sbp', 'liver', 'fpg', 'crpRel', 'uaRel', 'apoB'] as const) expect(Math.abs(wk(k, 12) / wk(k, 0) - 1), k).toBeLessThan(1e-6);
    // S_I is absolute (no latch): what remains is the burn-in transient of S_mus (τ 3 d over 14 d, from the E_is0 prior)
    expect(Math.abs(wk('si', 12) / wk('si', 0) - 1)).toBeLessThan(1e-3);
  });

  it('a VO2max change after t = 0 does not flip the habitual sessions in or out of the aerobic dose (classification VO2max latched)', () => {
    const profile = { ...MAN_PROFILE, habits: { sessionsPerWeek: 4, lifingCardioMix: 1 } };
    const bout = [{ atH: 18, minutes: 60, met: 5 }];
    const wk = (d: number): Scenario => ({ bouts: ((d % 7) + 7) % 7 < 4 ? bout : [] });
    // 5 MET is below 40 % of VO2max 48 (5.5 MET) during burn-in: the habitual sessions are not aerobic minutes
    const rig = makeRig({ profile, burnIn: 14, burnScenario: (d) => ({ ...wk(d), vo2: 48 }) });
    expect(rig.s.aerRefMinWk).toBe(0);
    const a = snapshot(rig);
    // VO2max falls to 40 (5 MET = 44 %): the same sessions must not start counting as a new aerobic dose
    const r = run(rig, 60, (d) => ({ ...wk(d), vo2: 40 }));
    near(r[59]!.hdl, a.hdl, 1e-9);
    near(r[59]!.crpRel, 1, 1e-12);
    near(r[59]!.sbp, a.sbp, 1e-9);
  });

  it('a zero-intake day gets no F_EBh credit (20 §4.7: a fast transiently lowers insulin sensitivity); a hypocaloric day does', () => {
    const fast = makeRig({ burnIn: 3 });
    const s0 = fast.s.sHep;
    run(fast, 2, () => ({ u: -1, bhb: 0.4, carb24: 0, day: ZERO_DAY }));
    // only the liver-fat factor may move S_hep (the fast lowers liver fat): far below the +25 % deficit credit
    expect(fast.s.sHep / s0 - 1).toBeLessThan(0.03);
    const cr = makeRig({ burnIn: 3 });
    run(cr, 2, () => ({ u: -0.4, day: dietDay(cr, { kcal: cr.k.hab.energyKcal * 0.6 }) }));
    expect(cr.s.sHep / s0 - 1).toBeGreaterThan(0.05); // ≈ +8.7 % after 2 days (τ_hep 2 d, 3-day mean still holds a burn-in day)
  });

  it('weekly fat-mass swings of a training pattern (session vs rest days) do not ratchet the overfeeding liver state', () => {
    const rig = makeRig({ burnIn: 14 });
    // ±60 g day-to-day fat-mass oscillation around the t = 0 value, weight on average unchanged
    const osc = [0.06, -0.02, 0.05, -0.04, 0.03, -0.06, 0.02];
    const dState: number[] = [];
    for (let d = 0; d < 120; d++) {
      stepDay(rig, d, { fmKg: rig.fm0 + osc[d % 7]! });
      dState.push(rig.s.liverD);
    }
    // only the first week adds a little (its window reaches back to the t = 0 level, so a surplus starting at t = 0 is not
    // delayed); afterwards the state only decays
    expect(Math.max(...dState)).toBeLessThan(0.03);
    for (let d = 14; d < 120; d++) expect(dState[d]!).toBeLessThanOrEqual(dState[d - 1]!);
    expect(Math.abs(snapshot(rig).liver / rig.k.l0 - 1)).toBeLessThan(0.02);
    // the former day-to-day rectified form accumulated ≈ +0.06 ln per week here (steady state ×2.7)
  });
});

describe('zero intake for 21 days stays finite and inside physical bounds', () => {
  it('water-only fast with the 20 §4.3.4 ketone trajectory: no NaN, bounded outputs, T_fast → 0, liver fat falls, urate rises, LDL rises', () => {
    const rig = makeRig({ burnIn: 3 });
    const bhb = (d: number) => Math.min(6.1, 0.3 + 1.4 * d);
    const r = run(rig, 21, (d) => ({ u: -1, bhb: bhb(d), carb24: 0, fmKg: rig.fm0 - 0.13 * (d + 1), day: ZERO_DAY }));
    for (const x of r) for (const v of Object.values(x)) expect(Number.isFinite(v)).toBe(true);
    expect(rig.s.tcFast).toBeLessThan(0.01);
    expect(r[20]!.tc).toBeLessThan(0.25); // the slow component (τ 28 d) is still at e^(−21/28) of its start
    expect(r[20]!.liver).toBeLessThan(rig.k.l0);
    expect(r[20]!.ua).toBeGreaterThan(rig.k.ua0 + 1);
    expect(r[20]!.ldl).toBeGreaterThan(rig.k.ldl0);
    expect(r[20]!.tg).toBeGreaterThan(15);
    expect(r[20]!.liver).toBeGreaterThan(0.5);
  });
  it('composition-driven targets hold on zero-intake days (the held snapshot is the last fed day)', () => {
    const rig = makeRig({ burnIn: 1 });
    const h = rig.k.hab;
    const fedDay = dietDay(rig, { sfaPct: h.sfaTotPct + 8 });
    run(rig, 3, () => ({ day: fedDay }));
    const before = rig.s.diet.sfaTotPct;
    run(rig, 2, () => ({ u: -1, day: ZERO_DAY }));
    expect(rig.s.diet.sfaTotPct).toBeCloseTo(before, 9);
  });
  it('refeeding after the fast brings ketone-driven markers back (urate within a week, T_C within weeks)', () => {
    const rig = makeRig({ burnIn: 1 });
    run(rig, 10, (d) => ({ u: -1, bhb: Math.min(5, 0.3 + 1.4 * d), carb24: 0, day: ZERO_DAY }));
    const after = run(rig, 21, () => ({ bhb: 0.2 }));
    expect(after[6]!.ua - rig.k.ua0).toBeLessThan(1.0);
    expect(after[20]!.tc).toBeGreaterThan(0.9);
  });
});

describe('bounds and finiteness under extreme inputs', () => {
  it('90 days of absurd diet, alcohol, sodium, exercise, weight change: every output finite and inside its clamp', () => {
    const rig = makeRig({ burnIn: 1 });
    const r = run(rig, 90, (d) => ({
      u: d % 2 ? 1 : -1,
      eb7: d % 2 ? 5000 : -5000,
      bhb: (d % 5) * 3,
      fmKg: rig.fm0 + (d < 45 ? 1 : -1) * 0.5 * d,
      sleepMult: 0.5,
      vo2: 10 + (d % 7) * 20,
      day: dietDay(rig, { kcal: 9000, carbPct: 90, sfaPct: 60, alcoholG: 300, sodiumG: 15, omega3G: 12, sugarsG: 900, fructoseG: 450, steps: 50000, nutsG: 500, viscousG: 80, potassiumMg: 12000 }),
      bouts: [{ atH: 6, minutes: 600, intensity: 1.2 }, { atH: 20, minutes: 60, rtSets: 500 }],
    }));
    for (const x of r) {
      for (const v of Object.values(x)) expect(Number.isFinite(v)).toBe(true);
      expect(x.ldl).toBeGreaterThanOrEqual(20);
      expect(x.ldl).toBeLessThanOrEqual(600);
      expect(x.hdl).toBeGreaterThanOrEqual(12);
      expect(x.tg).toBeGreaterThanOrEqual(15);
      expect(x.tg).toBeLessThanOrEqual(3000);
      expect(x.sbp).toBeGreaterThanOrEqual(60);
      expect(x.sbp).toBeLessThanOrEqual(260);
      expect(x.liver).toBeGreaterThanOrEqual(0.5);
      expect(x.liver).toBeLessThanOrEqual(50);
      expect(x.sHep).toBeGreaterThanOrEqual(0.05);
      expect(x.sHep).toBeLessThanOrEqual(3);
      expect(x.tc).toBeGreaterThanOrEqual(0);
      expect(x.tc).toBeLessThanOrEqual(1);
    }
  });
  it('bus writes stay inside their declared ranges (sHep, sMus, carbTolerance 0..1, insulinResistanceIdx 0..1, liverFatPct %)', () => {
    const rig = makeRig({ burnIn: 1 });
    run(rig, 60, (d) => ({ u: d < 30 ? -0.5 : 0.4, fmKg: rig.fm0 - (d < 30 ? 0.1 * d : 0.1 * (60 - d)), carb24: d < 20 ? 10 : 400 }));
    expect(rig.bus.carbTolerance).toBeGreaterThanOrEqual(0);
    expect(rig.bus.carbTolerance).toBeLessThanOrEqual(1);
    expect(rig.bus.insulinResistanceIdx).toBeGreaterThanOrEqual(0);
    expect(rig.bus.insulinResistanceIdx).toBeLessThanOrEqual(1);
    expect(rig.bus.liverFatPct).toBeGreaterThan(0.4);
    expect(rig.bus.sHep).toBeGreaterThan(0);
    expect(rig.bus.sMus).toBeGreaterThan(0);
  });
  it('insulinResistanceIdx is the absolute IR of the person (1 − S_I), not zero at t = 0 for a high-fat-mass user (review m13)', () => {
    const heavy = makeRig({ profile: { ...MAN_PROFILE, body: { sex: 'male', ageYears: 45, heightCm: 175, weightKg: 130 } } });
    const lean = makeRig({ profile: { ...MAN_PROFILE, body: { sex: 'male', ageYears: 25, heightCm: 178, weightKg: 70 }, habits: { typicalSteps: 12000 } } });
    expect(heavy.bus.insulinResistanceIdx).toBeGreaterThan(lean.bus.insulinResistanceIdx + 0.1);
  });
});

describe('monotonicity in the inputs (steady state)', () => {
  const at = (mk: (i: number) => Parameters<typeof dietDay>[1], n = 5, extra: Parameters<typeof run>[2] = () => ({})) =>
    Array.from({ length: n }, (_, i) => {
      const rig = makeRig({ labs: { sbpMmHg: 140, tgMmolL: 2.0, crpMgL: 4 } });
      const r = run(rig, 150, (d) => ({ ...extra(d), day: dietDay(rig, mk(i)) }))[149]!;
      return { r, rig };
    });
  it('LDL is non-decreasing in SFA %E and non-increasing in PUFA %E; HDL non-decreasing in SFA', () => {
    const h = makeRig().k.hab;
    const sfa = at((i) => ({ sfaPct: h.sfaTotPct + 4 * i }));
    for (let i = 1; i < sfa.length; i++) {
      expect(sfa[i]!.r.ldl).toBeGreaterThan(sfa[i - 1]!.r.ldl);
      expect(sfa[i]!.r.hdl).toBeGreaterThan(sfa[i - 1]!.r.hdl);
    }
    const pufa = at((i) => ({ pufaPct: h.pufaPct + 3 * i }));
    for (let i = 1; i < pufa.length; i++) expect(pufa[i]!.r.ldl).toBeLessThan(pufa[i - 1]!.r.ldl);
  });
  it('TG is non-increasing in EPA+DHA; SBP is non-decreasing in sodium and non-increasing in potassium', () => {
    const n3 = at((i) => ({ omega3G: 0.1 + 0.9 * i }));
    for (let i = 1; i < n3.length; i++) expect(n3[i]!.r.tg).toBeLessThan(n3[i - 1]!.r.tg + 1e-9);
    const na = at((i) => ({ sodiumG: 1.5 + 1.2 * i }));
    for (let i = 1; i < na.length; i++) expect(na[i]!.r.sbp).toBeGreaterThan(na[i - 1]!.r.sbp);
    const k = at((i) => ({ potassiumMg: 2800 + 500 * i })); // stays below the +80 mmol/d U-turn of the potassium term
    for (let i = 1; i < k.length; i++) expect(k[i]!.r.sbp).toBeLessThan(k[i - 1]!.r.sbp + 1e-9);
  });
  it('TG and HDL rise with alcohol (to 60 g/d); SBP rises above 24 g/d; urate rises with alcohol', () => {
    const alc = at((i) => ({ alcoholG: 15 * i }));
    for (let i = 1; i < alc.length; i++) {
      expect(alc[i]!.r.tg).toBeGreaterThan(alc[i - 1]!.r.tg);
      expect(alc[i]!.r.hdl).toBeGreaterThan(alc[i - 1]!.r.hdl);
      expect(alc[i]!.r.ua).toBeGreaterThan(alc[i - 1]!.r.ua);
    }
    expect(alc[4]!.r.sbp).toBeGreaterThan(alc[1]!.r.sbp);
  });
  it('more weight lost ⇒ lower SBP, TG, liver fat, urate, CRP, FPG; higher insulin sensitivity', () => {
    const lost = Array.from({ length: 4 }, (_, i) => {
      const rig = makeRig({ labs: { sbpMmHg: 140, tgMmolL: 2.0, crpMgL: 4, fastingGlucoseMmolL: 5.6 } });
      const kg = 4 * i;
      const r = run(rig, 200, (d) => ({ u: d < 40 ? -0.1 : 0, fmKg: rig.fm0 - RIG_FAT_SHARE * kg * (d < 40 ? (d + 1) / 40 : 1) }))[199]!;
      return r;
    });
    for (let i = 1; i < lost.length; i++) {
      expect(lost[i]!.sbp).toBeLessThan(lost[i - 1]!.sbp);
      expect(lost[i]!.tg).toBeLessThan(lost[i - 1]!.tg);
      expect(lost[i]!.liver).toBeLessThan(lost[i - 1]!.liver);
      expect(lost[i]!.ua).toBeLessThan(lost[i - 1]!.ua);
      expect(lost[i]!.crpRel).toBeLessThan(lost[i - 1]!.crpRel + 1e-12);
      expect(lost[i]!.fpg).toBeLessThan(lost[i - 1]!.fpg);
      expect(lost[i]!.si).toBeGreaterThan(lost[i - 1]!.si);
    }
  });
  it('exercise (aerobic minutes per week) lowers SBP, TG, liver fat and CRP and raises HDL, monotonically up to saturation', () => {
    const doses = [0, 1, 2, 4].map((n) => {
      const rig = makeRig({ labs: { sbpMmHg: 140, crpMgL: 4 }, burnIn: 1 });
      const r = run(rig, 200, (d) => ({ bouts: d % 7 < n ? [{ atH: 17, minutes: 45, intensity: 0.65 }] : [] }));
      return r.slice(186).reduce((s, x) => ({ sbp: s.sbp + x.sbp / 14, tg: s.tg + x.tg / 14, liver: s.liver + x.liver / 14, hdl: s.hdl + x.hdl / 14, crp: s.crp + x.crpRel / 14 }), { sbp: 0, tg: 0, liver: 0, hdl: 0, crp: 0 });
    });
    for (let i = 1; i < doses.length; i++) {
      expect(doses[i]!.sbp).toBeLessThan(doses[i - 1]!.sbp + 1e-9);
      expect(doses[i]!.tg).toBeLessThan(doses[i - 1]!.tg + 1e-9);
      expect(doses[i]!.liver).toBeLessThan(doses[i - 1]!.liver + 1e-9);
      expect(doses[i]!.hdl).toBeGreaterThan(doses[i - 1]!.hdl - 1e-9);
      expect(doses[i]!.crp).toBeLessThan(doses[i - 1]!.crp + 1e-9);
    }
    expect(doses[3]!.sbp).toBeLessThan(doses[0]!.sbp - 1);
  });
});

describe('determinism and ensemble', () => {
  it('same inputs give bit-identical outputs; nominal individual draws (u = 0.5) leave baselines at the population mean', () => {
    const a = makeRig();
    const b = makeRig();
    const sc = (d: number) => ({ u: -0.2, bhb: 0.4 + 0.02 * d, fmKg: a.fm0 - 0.05 * d });
    const ra = run(a, 40, sc);
    const rb = run(b, 40, (d) => ({ u: -0.2, bhb: 0.4 + 0.02 * d, fmKg: b.fm0 - 0.05 * d }));
    expect(ra).toEqual(rb);
    // NHANES generator, man 35 y, 82 kg / 178 cm (BMI 25.9): LDL ≈ 115.9 + 5.3·(−1) + 1.1·(−1.1)
    near(a.k.ldl0, 115.876 + 5.327 * ((35 - 45) / 10) + 1.104 * (25.88 - 27), 0.1);
  });
  it('32 parameter draws all run finite; the draws spread the baselines and responses (LDL0 and SBP0 vary, the mean person is preserved)', () => {
    const base = buildModelParams([cardiometabolicModule as never]);
    const draws = sampleParams(base.defs, { count: 32, seed: 3 });
    const ldl0: number[] = [];
    const sbp0: number[] = [];
    for (const v of draws) {
      const params: Record<string, number> = {};
      base.defs.forEach((d, i) => (params[d.id.replace('cardiometabolic.', '')] = v[i]!));
      const rig = makeRig({ params });
      const r = run(rig, 30, (d) => ({ u: -0.2, bhb: 1.2, fmKg: rig.fm0 - 0.06 * d, day: dietDay(rig, { alcoholG: 20, omega3G: 2 }) }));
      for (const x of r) for (const val of Object.values(x)) expect(Number.isFinite(val)).toBe(true);
      ldl0.push(rig.k.ldl0);
      sbp0.push(rig.k.sbp0);
    }
    const sd = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + (x - a.reduce((p, y) => p + y, 0) / a.length) ** 2, 0) / a.length);
    expect(sd(ldl0)).toBeGreaterThan(8);
    expect(sd(sbp0)).toBeGreaterThan(3);
    near(ldl0.reduce((s, x) => s + x, 0) / ldl0.length, makeRig().k.ldl0, 12);
  });
});

describe('post-absorptive glucose offset from the intake curves (04 §4.16, 20 §4.7)', () => {
  it('a fasting-state glucose fall on the bus (3.6 mmol/L on day 6 of a water fast) is carried into the fasting-glucose marker', () => {
    const rig = makeRig({ burnIn: 2 });
    const r = run(rig, 8, (d) => ({ u: -1, bhb: 3, carb24: 0, glucose: 5.05 - Math.min(1.45, 0.3 * d), day: ZERO_DAY }));
    near(r[7]!.fpg - rig.k.fpg0, -1.45 * 18.02, 4);
  });
  it('the part of the intake curve that is only the hepatic-sensitivity term Glc_f = 5·S_hep^(−0.1) is not counted twice', () => {
    const rig = makeRig({ burnIn: 2 });
    const base = snapshot(rig).fpg;
    const sHep0 = rig.s.sHep;
    const r = run(rig, 40, () => ({ u: -0.4, tPa: 10, day: dietDay(rig, { kcal: rig.k.hab.energyKcal - 1000 }) })); // S_hep rises, bus glucose follows 5·S_hep^-0.1
    expect(rig.s.sHep).toBeGreaterThan(sHep0);
    expect(Math.abs(rig.s.fpgFast)).toBeLessThan(1.0);
    expect(Number.isFinite(r[39]!.fpg + base)).toBe(true);
  });
  it('days without post-absorptive samples (habitual 08:00-20:00 eating: tPA < 8 h all day) carry no fasting-state term', () => {
    const rig = makeRig({ burnIn: 1 });
    const r = run(rig, 5, () => ({ tPa: 2, glucose: 4.2 }));
    for (const x of r) {
      expect(Number.isFinite(x.fpg)).toBe(true);
      near(x.fpg, rig.k.fpg0, 1e-9);
    }
    expect(rig.s.fpgFast).toBe(0);
  });
});

describe('optional DayInput fields: dietary cholesterol, DASH fraction, sauna sessions (undefined / NaN semantics)', () => {
  it('dashFraction overrides the food-quality DASH credit: full DASH lowers SBP by the DASH term and urate by the DASH effect', () => {
    const rig = makeRig({ labs: { sbpMmHg: 140, urateMgDl: 7 }, burnIn: 1 });
    const r = run(rig, 60, () => ({ day: { dashFraction: 1 } }));
    const dDash = 1 - rig.k.hab.dash;
    near(r[59]!.sbp - 140, -rig.k.dashSbp * dDash * (1 - Math.exp(-60 / 4)) + rig.s.sbpSlow, 0.05);
    expect(r[59]!.sbp).toBeLessThan(140 - 1);
    expect(r[59]!.uaRel).toBeLessThan(1);
    // out-of-range values are clamped to 0..1
    const hi = makeRig({ labs: { sbpMmHg: 140 }, burnIn: 1 });
    near(run(hi, 60, () => ({ day: { dashFraction: 3 } }))[59]!.sbp, r[59]!.sbp, 1e-9);
  });
  it('dashFraction undefined or NaN = derived from foodQuality (no change at the habitual food quality)', () => {
    for (const df of [undefined, Number.NaN]) {
      const rig = makeRig({ labs: { sbpMmHg: 140 }, burnIn: 1 });
      const r = run(rig, 30, () => ({ day: { dashFraction: df } }));
      near(r[29]!.sbp, 140, 1e-9);
      near(r[29]!.uaRel, 1, 1e-12);
    }
    // foodQuality 3 without a fraction → the registry's q3 credit
    const q3 = makeRig({ labs: { sbpMmHg: 140 }, burnIn: 1 });
    const r3 = run(q3, 30, () => ({ day: { foodQuality: 3 } }));
    if (q3.k.hab.dash < q3.k.dashQ3) expect(r3[29]!.sbp).toBeLessThan(140);
  });
  it('cholesterolMg NaN behaves as not given (no LDL change); saunaSessionsPerWeek undefined or NaN = 0', () => {
    const rig = makeRig();
    near(run(rig, 30, () => ({ day: dietDay(rig, { cholesterolMg: Number.NaN }) }))[29]!.ldl, rig.k.ldl0, 1e-9);
    for (const sn of [undefined, Number.NaN, 0, -2]) {
      const r = makeRig({ labs: { sbpMmHg: 130 }, burnIn: 1 });
      near(run(r, 30, () => ({ day: { saunaSessionsPerWeek: sn } }))[29]!.sbp, 130, 1e-9);
    }
  });
  it('habits.smoker is not read (dossier 06 has no smoking term for a modelled marker): identical outputs', () => {
    const a = makeRig({ profile: { ...MAN_PROFILE, habits: { smoker: true } }, burnIn: 3 });
    const b = makeRig({ profile: { ...MAN_PROFILE, habits: { smoker: false } }, burnIn: 3 });
    const ra = run(a, 10, () => ({ u: -0.2 }));
    const rb = run(b, 10, () => ({ u: -0.2 }));
    expect(ra[9]).toEqual(rb[9]);
  });
});

describe('optional schedule extensions (CONTRACT REQUESTS): dietary cholesterol and sauna sessions', () => {
  it('sauna 3 sessions/wk lowers SBP by ≈ 4 mmHg with τ 14 d; omega-3 2 g/d lowers it by ≈ 2.6 mmHg (capped together at 8)', () => {
    const rig = makeRig({ labs: { sbpMmHg: 130 }, burnIn: 1 });
    const r = run(rig, 120, () => ({ day: { ...dietDay(rig, { omega3G: 2.1 }), saunaSessionsPerWeek: 3 } }));
    near(r[119]!.sbp - 130, -4 - 2.6 * (2 - rig.k.hab.omega3G) / 2, 0.3);
    const rig2 = makeRig({ labs: { sbpMmHg: 130 }, burnIn: 1 });
    const half = run(rig2, 14, () => ({ day: { saunaSessionsPerWeek: 3 } }));
    near(half[13]!.sbp - 130, -4 * (1 - Math.exp(-14 / 14)), 0.3);
  });
  it('without a cholesterol field the habitual density is kept (no LDL change); with one the Keys law applies', () => {
    const rig = makeRig();
    const flat = run(rig, 30, () => ({ day: dietDay(rig, {}) }))[29]!;
    near(flat.ldl, rig.k.ldl0, 1e-9);
    const rig2 = makeRig();
    const up = run(rig2, 40, () => ({ day: dietDay(rig2, { cholesterolMg: 900 }) }))[39]!;
    expect(up.ldl).toBeGreaterThan(rig2.k.ldl0 + 5);
  });
});

describe('planner mode (display-only markers not recorded)', () => {
  it('skips lipids, BP, glycaemia, CRP and urate but keeps S_hep, S_mus, T_C, the IR index and liver fat identical', () => {
    const planner = new Uint8Array(N_SERIES);
    planner[MI.fatMass] = 1;
    const full = makeRig({ burnIn: 3 });
    const plan = makeRig({ burnIn: 3, seriesEnabled: planner });
    expect([plan.k.doLipids, plan.k.doBp, plan.k.doGlyc, plan.k.doCrp, plan.k.doUa]).toEqual([false, false, false, false, false]);
    const sc = (d: number) => ({ u: -0.25, bhb: 0.3 + 0.01 * d, fmKg: full.fm0 - 0.05 * d, day: dietDay(full, { kcal: full.k.hab.energyKcal * 0.75 }) });
    run(full, 30, sc);
    run(plan, 30, sc);
    for (const id of ['sHep', 'sMus', 'carbTolerance', 'insulinResistanceIdx', 'liverFatPct'] as const) expect(plan.bus[id]).toBe(full.bus[id]);
    expect(plan.s.outLdlMmol).toBe(plan.k.ldl0 / 38.67);
    expect(full.s.outLdlMmol).not.toBe(plan.s.outLdlMmol);
  });
});

describe('interface details', () => {
  it('stepDay with an unspecified-sex profile averages the equation sets and stays finite', () => {
    const rig = makeRig({ profile: { ...MAN_PROFILE, sexUnspecified: true } });
    expect(rig.k.sexCode).toBe(0.5);
    const r = run(rig, 20, () => ({}));
    for (const v of Object.values(r[19]!)) expect(Number.isFinite(v)).toBe(true);
    near(stepDay(makeRig(), 0, {}).energyKcal, makeRig().hab.energyKcal, 1e-9);
  });
});
