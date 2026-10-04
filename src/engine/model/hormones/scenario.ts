/**
 * Scenario helpers for the hormones/appetite validation tests (not used by the engine): a crude, explicit body model
 * that turns a prescribed diet into the bus signals the two modules read. Every assumption is visible in the test that
 * uses it (dossier reference subjects rarely state all inputs).
 */
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import { DayDriver, makeProfile } from './testHarness';

export interface DietDay {
  /** Intake as a fraction of the reference expenditure (TEE0 unless `teeKcal` is given). */
  eiFrac?: number;
  /** Absolute intake, kcal/d (overrides eiFrac). */
  eiKcal?: number;
  /** Expenditure used for u, kcal/d (default: the profile's TDEE0). */
  teeKcal?: number;
  proteinG?: number;
  /** Carbohydrate grams, or share of energy (0..1) when `carbG` is absent (default 0.5 of energy after protein). */
  carbG?: number;
  carbShareE?: number;
  alcoholG?: number;
  fibreG?: number;
  bhb?: number;
  sleepDebtH?: number;
  testoSleepMult?: number;
  /** Share of the energy deficit drawn from fat (default 0.8); surplus stored as fat at 0.75. */
  fatShare?: number;
  nMeals?: number;
  /** true: no meal resets the hours-since-meal clock this day. */
  fasting?: boolean;
  insulinRel?: number;
  exerciseKcalD?: number;
  /** Prescribed body for this day (overrides the crude energy-balance body model), kg. */
  fmKg?: number;
  ffmKg?: number;
  /** Expenditure proportional to tissue mass: TEE = TEE0·W/W0 (weight-loss studies lasting months). */
  teeScalesWithWeight?: boolean;
}

export class Scenario {
  readonly dr: DayDriver;
  /** Hour index of the last meal (hours-since-meal clock, 08 §4.10 reset rule). */
  lastMealH = -5;
  hourIndex = 0;
  fm: number;
  ffm: number;
  current: DietDay = {};

  constructor(readonly profile: ResolvedProfile) {
    this.dr = new DayDriver(profile, { startDay: -14 });
    this.fm = profile.fm0Kg;
    this.ffm = profile.ffm0Kg;
    this.dr.onHour = (h, bus) => {
      const d = this.current;
      if (!d.fasting && (h === 8 || h === 13 || h === 19)) this.lastMealH = this.hourIndex;
      bus.hoursSinceMealH = this.hourIndex - this.lastMealH;
      bus.insulinRel = d.insulinRel ?? 1;
      bus.exEEKcalH = (d.exerciseKcalD ?? 0) / 24;
      this.hourIndex++;
    };
    // 14-day burn-in on the habitual day (MODEL_SPEC §3.4), clock.day < 0
    for (let i = 0; i < 14; i++) this.day({ eiFrac: 1 });
    this.fm = profile.fm0Kg;
    this.ffm = profile.ffm0Kg;
    this.dr.bus.fatMassKg = this.fm;
    this.dr.bus.ffmActKg = this.ffm;
    this.dr.endBurnIn();
  }

  static of(person: PersonProfile, overrides: Partial<ResolvedProfile> = {}): Scenario {
    return new Scenario(makeProfile(person, overrides));
  }

  get w(): number {
    return this.fm + this.ffm;
  }

  /** One day: set inputs and bus, run both modules, then move the body by the day's energy balance. */
  day(d: DietDay): void {
    this.current = d;
    const p = this.profile;
    if (d.fmKg !== undefined) this.fm = d.fmKg;
    if (d.ffmKg !== undefined) this.ffm = d.ffmKg;
    const tee = d.teeKcal ?? (d.teeScalesWithWeight ? (p.tdee0Kcal * this.w) / (p.fm0Kg + p.ffm0Kg) : p.tdee0Kcal);
    const ei = d.eiKcal ?? (d.eiFrac ?? 1) * tee;
    const fibre = d.fibreG ?? (ei > 0 ? p.habitualFibreG * (ei / p.tdee0Kcal) : 0);
    const protein = d.proteinG ?? (ei > 0 ? p.habitualProteinG * (ei / p.tdee0Kcal) : 0);
    const alcohol = d.alcoholG ?? 0;
    const rest = Math.max(0, ei - 4 * protein - 2 * fibre - 7 * alcohol);
    const carb = d.carbG ?? ((d.carbShareE ?? 0.5) * ei) / 4;
    const carbC = Math.min(carb, rest / 4);
    const fat = Math.max(0, (rest - 4 * carbC) / 9);
    const dr = this.dr;
    dr.setIntake({ proteinG: protein, carbG: carbC, fatG: fat, fibreG: fibre, energyKcal: ei, alcoholG: alcohol, nMeals: d.fasting ? 0 : (d.nMeals ?? 3) });
    const bus = dr.bus;
    bus.energyBalanceFrac = Math.max(-1, Math.min(1, (ei - tee) / tee));
    bus.tdeeEstKcalD = tee;
    bus.fatMassKg = this.fm;
    bus.ffmActKg = this.ffm;
    bus.tissueMassKg = this.w;
    bus.scaleWeightKg = this.w;
    bus.bhbMmolL = d.bhb ?? 0.1;
    bus.sleepDebtFastH = d.sleepDebtH ?? 0;
    bus.testoSleepMult = d.testoSleepMult ?? 1;
    bus.fibreEffG = fibre;
    dr.runDay();
    const bal = ei - tee;
    if (d.fmKg !== undefined || d.ffmKg !== undefined) return;
    if (bal < 0) {
      const share = d.fatShare ?? 0.8;
      this.fm = Math.max(0.5, this.fm + (share * bal) / 9441);
      this.ffm += ((1 - share) * bal) / 1816;
    } else this.fm += (0.75 * bal) / 9441;
  }

  days(n: number, d: DietDay): void {
    for (let i = 0; i < n; i++) this.day(d);
  }
}
