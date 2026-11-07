/**
 * D6-02 (energy contribution) and the module's C2/D2-01 declaration: reported energy with unknown macros keeps all of its
 * kcal in the energy ledger, TEF charges each appearing kcal once with a named habitual-mix prior and a conditional
 * envelope, and unknown protein is never treated as a measured zero by the protein-turnover term.
 */
import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayInput, DayExposureSummary } from '../../types/inputs';
import {
  ENERGY_CAUSAL_RESOLUTION,
  ENERGY_INTAKE_ASSUMPTIONS,
  HX,
  energyModule,
  nonAlcoholEnergy,
  nonAlcoholTef,
  proteinIsLowerBound,
  unallocatedTefFraction,
} from './index';
import { EnergyRig, MAN02_INPUT, MEAL_HOURS } from './testRig';

interface IntakeDay {
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG?: number;
  /** Reported ME of the day, kcal (includes `unallocatedKcal`). */
  energyKcal: number;
  unallocatedKcal?: number;
  exposure?: Record<string, DayExposureSummary>;
}

function dayInput(rig: EnergyRig, p: IntakeDay): DayInput {
  return {
    day: rig.day,
    energyKcal: p.energyKcal,
    proteinG: p.proteinG,
    carbG: p.carbG,
    fatG: p.fatG,
    mctG: 0,
    fibreG: p.fibreG ?? 0,
    alcoholG: 0,
    caffeineMg: rig.profile.habits.habitualCaffeineMg,
    sleepHours: 8,
    sleepBedH: 23,
    sleepWakeH: 7,
    zeroIntake: false,
    maintenanceKcal: Number.NaN,
    ...(p.unallocatedKcal !== undefined ? { unallocatedKcal: p.unallocatedKcal } : {}),
    ...(p.exposure ? { exposure: p.exposure } : {}),
  } as unknown as DayInput;
}

/** One day with the reported energy appearing in three equal meal hours (ME boundary: all of it appears). */
function runIntakeDay(rig: EnergyRig, p: IntakeDay): { tef: number; ei: number; tee: number } {
  return runIntakeDayWith(rig, p, {});
}

/** `runIntakeDay` with extra compiled-day fields (energy ledger status, realised channel coverage). */
function runIntakeDayWith(rig: EnergyRig, p: IntakeDay, extra: Partial<Pick<DayInput, 'energyStatus' | 'coverage'>>): { tef: number; ei: number; tee: number } {
  const day = { ...dayInput(rig, p), ...extra } as DayInput;
  const bus = rig.bus;
  rig.clock.day = rig.day;
  energyModule.startDay(rig.s, rig.k, bus, day, rig.clock);
  let tef = 0;
  let ei = 0;
  let tee = 0;
  for (let h = 0; h < 24; h++) {
    rig.clock.hourOfDay = h;
    rig.clock.hourIndex = rig.clock.day * 24 + h;
    rig.hour.hourOfDay = h;
    rig.hour.day = rig.day;
    rig.hour.hourIndex = rig.clock.hourIndex;
    rig.hour.asleep = h < 7 || h >= 23 ? 1 : 0;
    bus.eAbsKcalH = (MEAL_HOURS as readonly number[]).includes(h) ? p.energyKcal / MEAL_HOURS.length : 0;
    bus.alcOxGH = 0;
    energyModule.stepHour(rig.s, rig.k, bus, rig.hour, day, rig.clock);
    tef += rig.s.hx[HX.tefH]!;
    ei += bus.eAbsKcalH;
    tee += bus.teePreKcalH;
  }
  energyModule.endOfDay(rig.s, rig.k, bus, day, rig.clock);
  rig.day++;
  return { tef, ei, tee };
}

const complete = (knownSum: number): DayExposureSummary => ({ knownSum, unit: 'g', coverage: 'complete' });

function newRig(): EnergyRig {
  const rig = new EnergyRig(resolveProfile(MAN02_INPUT));
  rig.burnIn(7);
  return rig;
}

describe('energy D6-02 — energy-only intake keeps its kcal and gets TEF once', () => {
  it('600 kcal with 30 g protein: all 600 kcal appear; the 480 kcal remainder takes the habitual C/F TEF prior', () => {
    const rig = newRig();
    const r = runIntakeDay(rig, { proteinG: 30, carbG: 0, fatG: 0, energyKcal: 600, unallocatedKcal: 480, exposure: { protein: complete(30) } });
    const k = rig.k;
    const mIR = rig.s.mIR;
    expect(r.ei).toBeCloseTo(600, 9);
    expect(rig.s.hx[HX.dayEiKcal]).toBeCloseTo(600, 9); // no second ME discount: the ledger books all of it
    expect(rig.s.unallocKcal).toBe(480);
    expect(rig.s.proteinLowerBound).toBe(0);
    expect(rig.s.alphaUnalloc).toBe(k.tefHabMixNoProtein);
    expect(r.tef).toBeCloseTo(mIR * (k.tefP * 4 * 30 + k.tefHabMixNoProtein * 480), 9);
    // conditional algebraic endpoints (all-carbohydrate / all-fat remainder), not probability bounds
    const env = unallocatedTefFraction(k, true);
    expect(env.low).toBe(Math.min(k.tefC, k.tefF));
    expect(env.high).toBe(Math.max(k.tefC, k.tefF));
    expect(r.tef).toBeGreaterThanOrEqual(mIR * (k.tefP * 120 + env.low * 480) - 1e-9);
    expect(r.tef).toBeLessThanOrEqual(mIR * (k.tefP * 120 + env.high * 480) + 1e-9);
  });

  it('a kcal-only day uses the habitual P/C/F prior, not the previous day’s macro mix', () => {
    const rig = newRig();
    runIntakeDay(rig, { proteinG: 300, carbG: 100, fatG: 40, energyKcal: 4 * 300 + 4 * 100 + 9 * 40 });
    const highProteinAlpha = rig.s.alphaNa;
    const r = runIntakeDay(rig, { proteinG: 0, carbG: 0, fatG: 0, energyKcal: 2000, unallocatedKcal: 2000 });
    expect(rig.s.proteinLowerBound).toBe(1);
    expect(rig.s.alphaNa).toBe(rig.k.tefHabMix);
    expect(rig.s.alphaNa).not.toBeCloseTo(highProteinAlpha, 3);
    expect(r.tef).toBeCloseTo(rig.s.mIR * rig.k.tefHabMix * 2000, 9);
    const env = unallocatedTefFraction(rig.k, false);
    expect(env.low).toBe(Math.min(rig.k.tefP, rig.k.tefC, rig.k.tefF));
    expect(env.high).toBe(Math.max(rig.k.tefP, rig.k.tefC, rig.k.tefF));
    expect(env.fraction).toBeGreaterThanOrEqual(env.low);
    expect(env.fraction).toBeLessThanOrEqual(env.high);
  });

  it('a fully known day is unchanged: no unallocated energy, the macro mix as before', () => {
    const rig = newRig();
    const p = { proteinG: 120, carbG: 250, fatG: 70, fibreG: 25 };
    const eKnown = nonAlcoholEnergy(p.proteinG, p.carbG, p.fatG, 0, p.fibreG);
    runIntakeDay(rig, { ...p, energyKcal: eKnown });
    expect(rig.s.unallocKcal).toBe(0);
    expect(rig.s.alphaUnalloc).toBe(0);
    expect(rig.s.alphaNa).toBe(nonAlcoholTef(rig.k, p.proteinG, p.carbG, p.fatG, 0, p.fibreG) / eKnown);
  });

  it('MCT stays a subset of fat and alcohol stays out of the non-alcohol mix (each counted once)', () => {
    const rig = newRig();
    const k = rig.k;
    expect(nonAlcoholEnergy(0, 0, 20, 35, 0)).toBe(nonAlcoholEnergy(0, 0, 20, 20, 0));
    expect(nonAlcoholEnergy(0, 0, 20, 5, 0)).toBeCloseTo(9 * 15 + 8.3 * 5, 9);
    expect(nonAlcoholTef(k, 0, 0, 20, 5, 0)).toBeCloseTo(k.tefF * 9 * 15 + k.tefMct * 8.3 * 5, 9);
    // 14 g alcohol oxidised in one hour: its energy is in eAbs, its TEF at tefAlc only, never in the mix
    const day = dayInput(rig, { proteinG: 100, carbG: 200, fatG: 60, energyKcal: 4 * 100 + 4 * 200 + 9 * 60 });
    rig.clock.day = rig.day;
    energyModule.startDay(rig.s, rig.k, rig.bus, day, rig.clock);
    rig.bus.alcOxGH = 14;
    rig.bus.eAbsKcalH = 7 * 14 + 300;
    rig.hour.hourOfDay = 20;
    energyModule.stepHour(rig.s, rig.k, rig.bus, rig.hour, day, rig.clock);
    expect(rig.s.hx[HX.tefH]).toBeCloseTo(rig.s.mIR * (rig.s.alphaNa * 300 + k.tefAlc * 7 * 14), 9);
  });

  it('TEF is expenditure booked once: hourly TEF sums to the day ledger and sits inside TEE', () => {
    const rig = newRig();
    const r = runIntakeDay(rig, { proteinG: 30, carbG: 0, fatG: 0, energyKcal: 600, unallocatedKcal: 480 });
    expect(rig.s.hx[HX.dayTefKcal]).toBeCloseTo(r.tef, 9);
    expect(r.tef).toBeCloseTo(rig.s.mIR * rig.s.alphaNa * 600, 9);
    expect(r.tee).toBeGreaterThan(r.tef);
  });
});

describe('energy D6-02 — unknown protein is not zero protein', () => {
  it('detects a lower-bound protein total from exposure coverage, else from unallocated energy; legacy days are exact', () => {
    expect(proteinIsLowerBound({})).toBe(false);
    expect(proteinIsLowerBound({ unallocatedKcal: 0 })).toBe(false);
    expect(proteinIsLowerBound({ unallocatedKcal: 480 })).toBe(true);
    expect(proteinIsLowerBound({ unallocatedKcal: 480, exposure: { protein: complete(30) } })).toBe(false);
    // the compiler's day status: a gram-rounding residual of fully known meals is not unknown protein
    expect(proteinIsLowerBound({ unallocatedKcal: 3, energyStatus: 'consistent' })).toBe(false);
    expect(proteinIsLowerBound({ unallocatedKcal: 480, energyStatus: 'energyOnly' })).toBe(true);
    expect(proteinIsLowerBound({ unallocatedKcal: 0, energyStatus: 'conflict' })).toBe(false);
    expect(proteinIsLowerBound({ exposure: { protein: { knownSum: 30, unit: 'g', coverage: 'partial' } } })).toBe(true);
    expect(proteinIsLowerBound({ exposure: { protein: { knownSum: 0, unit: 'g', coverage: 'unknown' } } })).toBe(true);
    expect(proteinIsLowerBound({ exposure: { protein: { knownSum: 0, unit: 'g', coverage: 'confirmedZero' } } })).toBe(false);
    // a prescribed day's construction-scope 'complete' exposure does not hide an energy-only meal's unknown protein
    expect(proteinIsLowerBound({ unallocatedKcal: 480, energyStatus: 'energyOnly', exposure: { protein: complete(30) } })).toBe(true);
  });

  it('an observed day’s realised protein coverage (C1 channel coverage, set on every replayed day) and the ledger decide', () => {
    // 600 kcal / 30 g protein with protein logged on every meal: the energy-only part is carbohydrate/fat only
    expect(proteinIsLowerBound({ unallocatedKcal: 480, energyStatus: 'energyOnly', coverage: { energy: 'complete', protein: 'complete', carbohydrate: 'partial', fat: 'partial' } })).toBe(false);
    expect(proteinIsLowerBound({ unallocatedKcal: 480, energyStatus: 'energyOnly', coverage: { protein: 'partial' } })).toBe(true);
    // a partly logged day whose meals close their energy: known grams plus the imputed remainder (scenario values)
    expect(proteinIsLowerBound({ unallocatedKcal: 0, energyStatus: 'consistent', coverage: { protein: 'partial' } })).toBe(false);
    expect(proteinIsLowerBound({ coverage: { protein: 'partial' } })).toBe(true);
    expect(proteinIsLowerBound({ energyStatus: 'consistent', coverage: { protein: 'asPlannedEstimate' } })).toBe(false);
    expect(proteinIsLowerBound({ coverage: { protein: 'confirmedZero' } })).toBe(false);
    // unknown coverage: the ledger decides (an imputed remainder's grams are its scenario values; energy-only = lower bound)
    expect(proteinIsLowerBound({ energyStatus: 'consistent', coverage: { protein: 'unknown' } })).toBe(false);
    expect(proteinIsLowerBound({ unallocatedKcal: 300, energyStatus: 'energyOnly', coverage: { protein: 'unknown' } })).toBe(true);
    expect(proteinIsLowerBound({ coverage: { protein: 'unknown' } })).toBe(true);
    // the realised channel wins over an exposure summary of the same day
    expect(proteinIsLowerBound({ coverage: { protein: 'complete' }, exposure: { protein: { knownSum: 30, unit: 'g', coverage: 'partial' } } })).toBe(false);
    expect(proteinIsLowerBound({ coverage: { protein: 'partial' }, exposure: { protein: complete(30) } })).toBe(true);
  });

  it('an energy-only day with realised complete protein relaxes P_eff toward it and uses the C/F prior', () => {
    const rig = newRig();
    const before = rig.s.pEffG;
    const day = { proteinG: 30, carbG: 0, fatG: 0, energyKcal: 600, unallocatedKcal: 480 };
    const r = runIntakeDayWith(rig, day, { energyStatus: 'energyOnly', coverage: { energy: 'complete', protein: 'complete', carbohydrate: 'partial', fat: 'partial' } });
    expect(rig.s.proteinLowerBound).toBe(0);
    expect(rig.s.pEffG).toBeCloseTo(30 + (before - 30) * rig.k.fP, 9);
    expect(rig.s.alphaUnalloc).toBe(rig.k.tefHabMixNoProtein);
    expect(r.tef).toBeCloseTo(rig.s.mIR * (rig.k.tefP * 4 * 30 + rig.k.tefHabMixNoProtein * 480), 9);
    const lb = newRig();
    runIntakeDayWith(lb, day, { energyStatus: 'energyOnly', coverage: { energy: 'partial', protein: 'partial' } });
    expect(lb.s.proteinLowerBound).toBe(1);
    expect(lb.s.pEffG).toBe(before);
    expect(lb.s.alphaUnalloc).toBe(lb.k.tefHabMix);
  });

  it('a kcal-only day holds P_eff (legacy code relaxed it toward 0 g)', () => {
    const rig = newRig();
    const before = rig.s.pEffG;
    runIntakeDay(rig, { proteinG: 0, carbG: 0, fatG: 0, energyKcal: 2000, unallocatedKcal: 2000 });
    expect(rig.s.pEffG).toBe(before);
  });

  it('a known protein part below P_eff holds it; above P_eff it relaxes upward exactly as a known day', () => {
    const rig = newRig();
    const before = rig.s.pEffG;
    runIntakeDay(rig, { proteinG: 30, carbG: 0, fatG: 0, energyKcal: 600, unallocatedKcal: 480 });
    expect(rig.s.pEffG).toBe(before);
    const hi = before + 150;
    runIntakeDay(rig, { proteinG: hi, carbG: 0, fatG: 0, energyKcal: 4 * hi + 400, unallocatedKcal: 400 });
    expect(rig.s.pEffG).toBeCloseTo(hi + (before - hi) * rig.k.fP, 9);
  });

  it('fully known protein still pulls P_eff down (no change for exact days)', () => {
    const rig = newRig();
    const before = rig.s.pEffG;
    runIntakeDay(rig, { proteinG: 30, carbG: 0, fatG: 0, energyKcal: 600, unallocatedKcal: 480, exposure: { protein: complete(30) } });
    expect(rig.s.pEffG).toBeCloseTo(30 + (before - 30) * rig.k.fP, 9);
  });
});

describe('energy D6-02 — additive read adapter and state continuity (C7)', () => {
  const week: IntakeDay[] = [
    { proteinG: 140, carbG: 220, fatG: 80, energyKcal: 4 * 140 + 4 * 220 + 9 * 80 },
    { proteinG: 60, carbG: 300, fatG: 50, energyKcal: 4 * 60 + 4 * 300 + 9 * 50 },
    { proteinG: 200, carbG: 120, fatG: 90, energyKcal: 4 * 200 + 4 * 120 + 9 * 90 },
  ];

  it('legacy days (no new fields) read exactly as zero unallocated energy with complete protein coverage', () => {
    const legacy = newRig();
    const tagged = newRig();
    for (const d of week) {
      const a = runIntakeDay(legacy, d);
      const b = runIntakeDay(tagged, { ...d, unallocatedKcal: 0, exposure: { protein: complete(d.proteinG) } });
      expect(b).toEqual(a);
    }
    expect(Array.from(tagged.s.hx)).toEqual(Array.from(legacy.s.hx));
    expect(tagged.s.pEffG).toBe(legacy.s.pEffG);
    expect(tagged.s.alphaNa).toBe(legacy.s.alphaNa);
  });

  it('a state cloned mid-run continues exactly like the uninterrupted run, energy-only days included', () => {
    const days: IntakeDay[] = [
      ...week,
      { proteinG: 0, carbG: 0, fatG: 0, energyKcal: 1800, unallocatedKcal: 1800 },
      { proteinG: 30, carbG: 0, fatG: 0, energyKcal: 600, unallocatedKcal: 480, exposure: { protein: complete(30) } },
      { proteinG: 0, carbG: 0, fatG: 0, energyKcal: 2200, unallocatedKcal: 2200 },
    ];
    const full = newRig();
    const fullOut = days.map((d) => runIntakeDay(full, d));
    const head = newRig();
    for (const d of days.slice(0, 4)) runIntakeDay(head, d);
    const cont = newRig();
    Object.assign(cont.s, structuredClone(head.s));
    Object.assign(cont.bus, { ...head.bus });
    cont.day = head.day;
    const contOut = days.slice(4).map((d) => runIntakeDay(cont, d));
    expect(contOut).toEqual(fullOut.slice(4));
    expect(cont.s.pEffG).toBe(full.s.pEffG);
  });
});

describe('energy — declarations (C2/D2-01, C6/D6-02)', () => {
  it('the causal-resolution declaration matches the module wiring', () => {
    const d = ENERGY_CAUSAL_RESOLUTION;
    expect(d.module).toBe(energyModule.id);
    expect(d.nativeResolution).toBe('daily');
    for (const id of d.series) expect(energyModule.records).toContain(id);
    for (const sig of d.signals) expect(energyModule.writes).toContain(sig);
    for (const sig of d.dayStartSignals) expect(energyModule.reads).toContain(sig);
    expect(d.planMetadataReads).toEqual(['zeroIntake']);
  });

  it('named intake assumptions point at recorded series', () => {
    for (const a of Object.values(ENERGY_INTAKE_ASSUMPTIONS)) {
      expect(a.uncertaintyKind).toBe('scenario');
      for (const id of a.series) expect(energyModule.records).toContain(id);
    }
  });
});
