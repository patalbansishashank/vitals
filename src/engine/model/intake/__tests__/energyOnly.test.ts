// @vitest-environment node
/**
 * D6-02 energy-only intake and the ingestion-to-appearance audit (C3/C7): reported energy not explained by known grams
 * appears as energy only (never a named glucose/amino-acid/fat stream), is conserved through midnight and horizon tails,
 * and the audit (registered = appeared + stored + declared losses) holds from ingestion, every hour.
 */
import { describe, expect, it } from 'vitest';
import { CARDIO_MODALITY_CODE, type HourInput } from '../../../types/inputs';
import { carbFatScenario, intakeEnergyAudit, qOfMix, INTAKE_ENERGY_BASIS } from '../energyBasis';
import { MF, intakeModule, type IntakeState } from '../index';
import { readMealIntake } from '@/lib/nutrientExposure';
import type { LogEntry, NutrientEstimate } from '@/living/types';
import { MAN_80, makeCtx, makeHarness, type Harness } from './harness';
import { compileSchedule } from '../../../core/compileSchedule';
import { runEngine } from '../../../core/loop';
import { resolveProfile } from '../../../core/resolveProfile';
import type { EngineSnapshot } from '../../../types/result';
import type { DayTemplate, Schedule } from '../../../types/schedule';

/** Put an hour of intake (with its energy-only part) into the next step; the energy-only field is cleared after it. */
function eatStep(H: Harness, m: Partial<HourInput>): void {
  H.eat(m);
  H.step();
  H.hour.unallocatedKcal = 0;
}

interface Sums {
  eAbs: number;
  glc: number;
  fru: number;
  prot: number;
  fat: number;
  absFlux: number;
  minEAbs: number;
}

function run(H: Harness, hours: number, sums: Sums = { eAbs: 0, glc: 0, fru: 0, prot: 0, fat: 0, absFlux: 0, minEAbs: Infinity }, check?: () => void): Sums {
  for (let h = 0; h < hours; h++) {
    H.step();
    H.hour.unallocatedKcal = 0;
    sums.eAbs += H.bus.eAbsKcalH;
    sums.glc += H.bus.raGlcGH;
    sums.fru += H.bus.raFruGalGH;
    sums.prot += H.bus.raProtGH;
    sums.fat += H.bus.raFatGH;
    sums.absFlux += H.bus.absFluxKcalH;
    sums.minEAbs = Math.min(sums.minEAbs, H.bus.eAbsKcalH);
    check?.();
  }
  return sums;
}

function firstHour(H: Harness): Sums {
  return { eAbs: H.bus.eAbsKcalH, glc: H.bus.raGlcGH, fru: H.bus.raFruGalGH, prot: H.bus.raProtGH, fat: H.bus.raFatGH, absFlux: H.bus.absFluxKcalH, minEAbs: H.bus.eAbsKcalH };
}

const balanced = (H: Harness): void => {
  const a = intakeEnergyAudit(H.s, H.k);
  expect(Math.abs(a.imbalanceKcal)).toBeLessThan(1e-6);
};

describe('energy-only intake (D6-02)', () => {
  it('a kcal-only 600 kcal meal appears in full as energy only: no glucose, amino-acid or fat stream, no excursion', () => {
    const H = makeHarness();
    eatStep(H, { kcal: 600, unallocatedKcal: 600 });
    expect(H.s.hoursSinceIntake).toBe(0); // the caloric meal ends the zero-calorie clock
    expect(H.s.hoursSinceMeal).toBe(0); // and the meal clock: unknown composition never extends fasted-state outputs
    expect(H.s.meals[MF.GAMP]).toBe(0); // no glucose excursion from unknown composition
    expect(H.s.meals[MF.IAMP]).toBe(0); // no insulin excursion
    const s = run(H, 47, firstHour(H));
    expect(s.eAbs).toBeCloseTo(600, 6);
    expect(s.glc + s.fru + s.prot + s.fat).toBe(0);
    expect(s.absFlux).toBeCloseTo(600, 6); // empties with the gut energy pool (07 §4.1)
    balanced(H);
  });

  it('600 kcal with 30 g protein: protein appears as protein, the other 480 kcal as energy only; total 600', () => {
    const H = makeHarness();
    eatStep(H, { proteinG: 30, kcal: 600, unallocatedKcal: 480 });
    const s = run(H, 71, firstHour(H));
    expect(s.prot).toBeCloseTo(30, 6);
    expect(s.glc + s.fru + s.fat).toBe(0);
    expect(s.eAbs).toBeCloseTo(600, 6);
    const a = intakeEnergyAudit(H.s, H.k);
    expect(a.registeredKcal).toBeCloseTo(600, 9);
    expect(a.submittedKcal).toBeCloseTo(600, 9);
    expect(a.storedKcal).toBeCloseTo(0, 6);
    balanced(H);
  });

  it('declared q = 1 and q = 0 scenarios keep 600 kcal and 30 g protein and change only the substrate split', () => {
    const spec = { clockH: 8, energyKcal: 600, macros: { proteinG: 30 } };
    for (const q of [1, 0]) {
      const r = carbFatScenario(spec, { kind: 'carbFatFamily', q }, { fibreKnownZero: true, alcoholKnownZero: true });
      if (r.status !== 'allocated') throw new Error(r.status);
      expect(4 * r.imputed.carbG + 9 * r.imputed.fatG).toBeCloseTo(480, 9); // scenario grams carry exactly R
      const H = makeHarness();
      const m = r.meal.macros!;
      eatStep(H, { proteinG: m.proteinG, carbG: m.carbG, fatG: m.fatG, kcal: 600 });
      const s = run(H, 71, firstHour(H));
      expect(s.eAbs).toBeCloseTo(600, 6);
      expect(s.prot).toBeCloseTo(30, 6);
      if (q === 1) expect(s.glc + s.fru).toBeCloseTo(120, 6);
      else expect(s.fat).toBeCloseTo(480 / 9, 6);
      balanced(H);
    }
    // the habitual mix is an explicit, versioned prior; it gives its own q
    expect(qOfMix(250, 70)).toBeCloseTo(1000 / 1630, 9);
    const hab = carbFatScenario(spec, { kind: 'habitualMix', carbG: 250, fatG: 70, version: 'habit-v1' }, { fibreKnownZero: true, alcoholKnownZero: true });
    expect(hab.status === 'allocated' && hab.q).toBeCloseTo(1000 / 1630, 9);
  });

  it('a negative reconciliation (known grams above the reported energy) conserves the reported total, never a negative hour', () => {
    const H = makeHarness();
    // grams worth 25·4 + 50·4 + 20·9 = 480 kcal, reported 450: −30 kcal energy-only correction
    eatStep(H, { proteinG: 25, carbG: 50, fatG: 20, kcal: 450, unallocatedKcal: -30 });
    const s = run(H, 71, firstHour(H), () => balanced(H));
    expect(s.eAbs).toBeCloseTo(450, 6);
    expect(s.minEAbs).toBeGreaterThanOrEqual(0);
    expect(H.s.reconDebtKcal).toBe(0);
    // the named streams keep the known grams exactly
    expect(s.prot).toBeCloseTo(25, 6);
    expect(s.glc + s.fru).toBeCloseTo(50, 6);
    expect(s.fat).toBeCloseTo(20, 6);
  });

  it('a negative correction alone (no grams this hour) is ignored: no negative energy appears from nothing', () => {
    const H = makeHarness();
    eatStep(H, { kcal: 0, unallocatedKcal: -100 });
    const s = run(H, 10, firstHour(H));
    expect(s.eAbs).toBe(0);
    expect(intakeEnergyAudit(H.s, H.k).registeredKcal).toBe(0);
  });

  it('hFast: energy-only intake resets the meal clock from min(4·10, 4·15) = 40 kcal; fast_h keeps its 50 kcal rule', () => {
    const H = makeHarness();
    H.idle(3);
    const h0 = H.s.hoursSinceMeal;
    const f0 = H.s.hoursSinceIntake;
    eatStep(H, { kcal: 30, unallocatedKcal: 30 });
    expect(H.s.hoursSinceMeal).toBe(h0 + 1);
    eatStep(H, { kcal: 45, unallocatedKcal: 45 });
    expect(H.s.hoursSinceMeal).toBe(0);
    expect(H.s.hoursSinceIntake).toBe(f0 + 2); // 45 kcal ≤ 50 kcal: the zero-intake clock is unchanged
  });

  it('an absent or zero energy-only field leaves every signal bit-identical', () => {
    const trace = (u: number | undefined): number[] => {
      const H = makeHarness();
      const out: number[] = [];
      H.eat({ proteinG: 30, carbG: 80, fatG: 20, fibreG: 6 });
      if (u !== undefined) H.hour.unallocatedKcal = u;
      for (let h = 0; h < 30; h++) {
        H.step();
        out.push(H.bus.eAbsKcalH, H.bus.raGlcGH, H.bus.raFatGH, H.bus.glucoseMmolL, H.bus.insulinUuMl, H.bus.hoursSinceMealH);
      }
      return out;
    };
    expect(trace(0)).toEqual(trace(undefined));
  });
});

describe('provider → engine: a logged entry reaches hourly ingestion with its energy (D6-02)', () => {
  /**
   * The stored entry as `log.meal` writes it for the person's typed numbers (one portion carrying them; fields not given
   * are listed unknown with a 0 placeholder — the command side is tested in src/commands/food/__tests__/logMeal.test.ts).
   */
  const entryOf = (label: { energyKcal: number; proteinG?: number }): Extract<LogEntry, { kind: 'meal' }> => {
    const z = { value: 0, sd: 0 };
    const unknown: NonNullable<NutrientEstimate['unknown']> = label.proteinG === undefined ? ['proteinG', 'carbG', 'fatG', 'fibreG'] : ['carbG', 'fatG', 'fibreG'];
    const n: NutrientEstimate = { energyKcal: { value: label.energyKcal, sd: 0 }, proteinG: label.proteinG === undefined ? z : { value: label.proteinG, sd: 0 }, carbG: z, fatG: z, fibreG: z, unknown };
    return { id: 'm1', date: '2026-10-05', tz: 'UTC', source: { by: 'user', method: 'typed' }, kind: 'meal', clockH: 12, components: [{ name: 'typed', grams: { value: 100, sd: 0 }, nutrients: n, nutrientSource: 'user' }], totals: n } as Extract<LogEntry, { kind: 'meal' }>;
  };
  for (const [label, protein] of [[{ energyKcal: 600, proteinG: 30 }, 30], [{ energyKcal: 600 }, 0]] as const) {
    it(`${JSON.stringify(label)} stays ${label.energyKcal} kcal through ingestion and appearance`, () => {
      const intake = readMealIntake(entryOf(label));
      expect(intake.energyKcal).toBe(600);
      const H = makeHarness();
      eatStep(H, { kcal: intake.energyKcal, proteinG: intake.macros.proteinG ?? 0, carbG: intake.macros.carbG ?? 0, fatG: intake.macros.fatG ?? 0, unallocatedKcal: intake.unexplainedKcal });
      const s = run(H, 71, firstHour(H), () => balanced(H));
      expect(s.eAbs).toBeCloseTo(600, 6);
      expect(s.prot).toBeCloseTo(protein, 6);
      expect(s.glc + s.fru + s.fat).toBe(0);
      expect(intakeEnergyAudit(H.s, H.k).submittedKcal).toBeCloseTo(600, 9);
    });
  }
});

describe('ingestion-to-appearance audit (C7)', () => {
  it('registered = appeared + stored + losses every hour: mixed meals, MCT, alcohol, ketones, exercise carbohydrate, energy-only, across midnight', () => {
    const H = makeHarness(undefined, { startHourOfDay: 20 });
    const check = (): void => balanced(H);
    eatStep(H, { proteinG: 35, carbG: 90, fructoseG: 25, fatG: 30, mctG: 10, fibreG: 9, kcal: 4 * 35 + 4 * 90 + 9 * 20 + 8.3 * 10 + 2 * 9, glycaemicIndex: 60, timeToPeakH: 1 });
    check();
    eatStep(H, { alcoholG: 28, kcal: 7 * 28 });
    check();
    eatStep(H, { kcal: 350, unallocatedKcal: 350 }); // 22:00 energy-only snack, emptying past midnight
    check();
    eatStep(H, { exoKetoneG: 12 }); // fed: the bioavailability factor is a declared loss
    check();
    H.hour.exMin = 60;
    H.hour.exIntensityFrac = 0.6;
    H.hour.exModality = CARDIO_MODALITY_CODE.cycle;
    H.hour.exCarbG = 40;
    H.hour.exCarbDuringGPerMin = 40 / 60;
    H.step();
    check();
    // stop while the gut still holds energy: the horizon tail is retained, not lost
    run(H, 1, undefined, check);
    const mid = intakeEnergyAudit(H.s, H.k);
    expect(mid.storedKcal).toBeGreaterThan(50);
    expect(mid.lossKcal).toBeCloseTo(12 * H.k.ketoneKcalPerG * (1 - H.k.ketoneFedFactor), 9);
    expect(mid.registeredKcal).toBeCloseTo(mid.appearedKcal + mid.storedKcal + mid.lossKcal, 6);
    // compiler-submitted kcal = registered minus the ketone doses (outside the intake kcal convention)
    expect(mid.submittedKcal).toBeCloseTo(mid.registeredKcal - 12 * H.k.ketoneKcalPerG, 6);
    run(H, 96, undefined, check);
    const end = intakeEnergyAudit(H.s, H.k);
    expect(end.storedKcal).toBeCloseTo(0, 6);
    expect(end.appearedKcal + end.lossKcal).toBeCloseTo(end.registeredKcal, 6);
  });

  it('ring overflow with energy-only meals loses nothing', () => {
    const H = makeHarness();
    let kcal = 0;
    for (let i = 0; i < 24; i++) {
      eatStep(H, { proteinG: 10, kcal: 340, unallocatedKcal: 300 });
      kcal += 340;
      balanced(H);
    }
    run(H, 96, undefined, () => balanced(H));
    const a = intakeEnergyAudit(H.s, H.k);
    expect(a.registeredKcal).toBeCloseTo(kcal, 6);
    expect(a.appearedKcal).toBeCloseTo(kcal, 6);
  });

  it('declares its energy boundary: reported ME, appearance is modeled appearing ME, TEF is expenditure', () => {
    expect(INTAKE_ENERGY_BASIS).toMatchObject({ boundary: 'reportedME', appearanceSignal: 'eAbsKcalH', tef: 'expenditure (not subtracted from intake)' });
  });
});

describe('lifecycle: an energy-only gut tail survives a day-stamped snapshot and resume (C2/C7, phase 0C)', () => {
  // a reported 600 kcal / 30 g protein breakfast and a 900 kcal energy-only late meal at 23:30 whose gut energy is still
  // emptying when the next day's snapshot is taken (the compiler carries it into the next day's hours)
  const DAY: DayTemplate = {
    id: 'E', label: 'energy only', energy: { kind: 'kcal', kcal: 1500 },
    macros: { protein: { unit: 'g', value: 30 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'remainder' } },
    meals: { meals: [{ clockH: 8, energyKcal: 600, macros: { proteinG: 30 } }, { clockH: 23.5, energyKcal: 900, macros: {} }] },
  };
  const profile = resolveProfile(MAN_80);
  const sched: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 6, programs: [DAY], days: Array.from({ length: 6 }, () => ({ program: 0 })) };
  const compiled = compileSchedule(sched, profile);
  const intakeOf = (snap: EngineSnapshot): IntakeState => snap.states[snap.moduleIds.indexOf('intake')] as IntakeState;

  it('the snapshot holds the unappeared energy-only gut energy; the continuation is bit-identical and keeps the audit', () => {
    const full = runEngine(profile, compiled, { record: 'full', captureSnapshotAt: [2, 4] });
    const at2 = intakeOf(full.snapshots![2]!);
    expect(Array.from(at2.mealUK).some((u) => u > 0)).toBe(true);
    const k = intakeModule.prepare(makeCtx(profile));
    const a2 = intakeEnergyAudit(at2, k);
    expect(a2.storedKcal).toBeGreaterThan(100);
    expect(Math.abs(a2.imbalanceKcal)).toBeLessThan(1e-6);
    const cont = runEngine(profile, compiled, { record: 'full', initialSnapshot: full.snapshots![2]!, captureSnapshotAt: [4] });
    for (const id of Object.keys(full.hourly) as (keyof typeof full.hourly)[]) {
      const x = full.hourly[id]!;
      const y = cont.hourly[id]!;
      for (let i = 48; i < x.length; i++) expect(Object.is(x[i], y[i]), `hourly ${id}[${i}]`).toBe(true);
    }
    const s4 = intakeOf(full.snapshots![4]!);
    const c4 = intakeOf(cont.snapshots![4]!);
    expect(intakeEnergyAudit(c4, k)).toEqual(intakeEnergyAudit(s4, k));
    expect(Array.from(c4.mealUK)).toEqual(Array.from(s4.mealUK));
    expect(c4.reconDebtKcal).toBe(s4.reconDebtKcal);
    // two days of 1500 kcal registered between the snapshots, every kcal appeared or still in the gut
    const a4 = intakeEnergyAudit(s4, k);
    expect(a4.registeredKcal - a2.registeredKcal).toBeCloseTo(3000, 6);
    expect(Math.abs(a4.imbalanceKcal)).toBeLessThan(1e-6);
  });
});
