/**
 * MODULE moderators — sleep, stress, menstrual cycle, menopause, age → modifier signals.
 * Spec: docs/MODEL_SPEC.md §1.1 · Dossiers: 16 §4.0-4.13 (owner), 15 §4.11 (caffeine dose/time), 02 §4.3 (luteal RMR).
 * Owned files: src/engine/model/moderators/** only.
 *
 * Daily module: everything is computed in `startDay` (multipliers, cycle, age) and `endOfDay` (sleep-quality index);
 * the only hourly work is capturing the caffeine load at the planned bed hour. No allocation after `prepare/init`.
 *
 * Decisions on points the spec leaves open (all documented in the WP report):
 *  - Sleep of "last night" is the previous day's `sleepHours` (the night that started the previous evening), stored at
 *    `endOfDay`; the state starts at the habitual sleep (steady state), so a burn-in on the habitual day leaves it there.
 *  - dS is capped at 5 (testosterone cap); Si / MPS / partition use min(dS, 4) as written in §1.1 step 3.
 *  - Age and cycle day are functions of `clock.day` (0 = first simulated day, negative in burn-in), so day 0 is exactly the
 *    profile age / cycle day whatever the burn-in length.
 *  - Sleep quality = 100 − caffeine TST loss / 3 − 100 · alcohol next-night penalty (MODEL_SPEC §1.1 step 6).
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { relax2 } from '../../core/math';
import { DEFAULTS } from '../../core/defaults';
import { MI } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import { MODERATORS_PARAMS } from './params';
import {
  alcoholRecoveryPenalty,
  caffeineHalfLifeH,
  caffeineResidualMg,
  cycleDayOn,
  isoDayNumber,
  lutealWeightAt,
  mpsSleepMult,
  nightlyDeficitH,
  partitionSleepShift,
  siSleepMult,
  sleepQualityIndex,
  testoSleepMult,
  tstLossMin,
} from './equations';

export interface ModeratorsState {
  /** Fast sleep-debt state dF, h (16 §4.1.1; τ 1 d rise / 2 d fall, cap 4). */
  sleepDebtFastH: number;
  /** Slow sleep-debt state dS, h (τ 3 d rise / 5 d fall; state cap 5 = testosterone cap, Si/MPS use min(dS, 4)). */
  sleepDebtSlowH: number;
  /** Sleep that ended this morning, h (the previous day's `sleepHours`). */
  lastNightSleepH: number;
  /** Caffeine body load at the planned bedtime, mg (15 §4.11 → 16 §4.2.1 TST loss); captured in stepHour. */
  caffeineAtBedMg: number;
  /** Menstrual cycle day, 1-based (−1 when not tracked). */
  cycleDay: number;
  /** Age in years, advanced daily (profile age + clock.day/365.25). */
  ageYears: number;
  /** Sleep-quality output index 0-100 (16 §4.2, 19 §4.10); NaN never (initialised from the habitual day). */
  sleepQualityIdx: number;

  /** 1 when last night was flagged poor quality (day input `sleepQuality === 0`), else 0. */
  lastNightPoor: number;
  /** 1 when last night belonged to a shift-work day, else 0. */
  lastNightShift: number;
  /** Hour of day (0-23) at which caffeineLoadMg is sampled: the planned bed hour of today's night. */
  bedHourToday: number;
  /** exp(−ln2·frac/t½): decay from the start of the bed hour to the fractional bedtime. */
  bedFracFactor: number;
  /** Ethanol dose of today (g/kg) driving tonight's next-night recovery penalty. */
  alcoholGKgToday: number;
  /** Luteal weight s(d) written to the bus today. */
  lutealWeight: number;
  /** Menopause-transition drift rates, kg/yr (peri women only; not on the bus: see CONTRACT REQUEST). */
  menopauseFatDriftKgYr: number;
  menopauseLeanDriftKgYr: number;
}

/** Constants copied from the registry in `prepare` (never read in the step loop). */
export interface ModeratorsK {
  hRef: number;
  poorH: number;
  shiftH: number;
  fDfUp: number;
  fDfDown: number;
  fDsUp: number;
  fDsDown: number;
  debtCap: number;
  debtCapT: number;
  siPerH: number;
  mpsPerH: number;
  testoPerH: number;
  partPerH: number;
  partCap: number;
  partDefRef: number;
  tHalf: number;
  rStar: number;
  tstPerMg: number;
  tstCap: number;
  tstPts: number;
  alcLo: number;
  alcHi: number;
  penLo: number;
  penMid: number;
  penHi: number;
  sleepBase: number;
  rampDays: number;
  fatDrift: number;
  leanDrift: number;
  /** Profile-derived (static). */
  isMale: boolean;
  weightKg: number;
  age0: number;
  menoPeri: boolean;
  cycleTracked: boolean;
  cycleLen: number;
  lastPeriodDay: number;
  startDay: number;
  habSleepH: number;
  habPoor: number;
  habCaffeineMg: number;
  habBedH: number;
  habAlcoholGKg: number;
  habStress: number;
}

const LN2 = Math.LN2;

function habitualSleepHours(bedH: number, wakeH: number): number {
  const h = (((wakeH - bedH) % 24) + 24) % 24;
  return h === 0 ? 24 : h;
}

const isHormonalContraception = (c: string | undefined): boolean => c !== undefined && c !== 'none';

export const moderatorsModule = defineModule<ModeratorsState, ModeratorsK>({
  id: 'moderators',
  specSection: '§1.1',
  dossiers: '16 §4.0-4.13; 15 §4.11; 02 §4.3',
  params: MODERATORS_PARAMS,
  reads: ['caffeineLoadMg', 'energyBalanceFrac'],
  writes: [
    'sleepDebtFastH',
    'sleepDebtSlowH',
    'siSleepMult',
    'mpsSleepMult',
    'testoSleepMult',
    'partitionSleepShift',
    'lutealWeight',
    'cycleDay',
    'stressLevel',
    'ageYears',
  ],
  records: ['sleepQuality'],

  prepare: (ctx: ModuleContext): ModeratorsK => {
    const p = ctx.params;
    const pr = ctx.profile;
    const g = (n: string): number => param(p, `moderators.${n}`);
    const habits = pr.habits;
    const cycleLen = Math.max(15, Math.round(pr.cycle.cycleLengthD ?? g('cycleLengthDefaultD')));
    const lastPeriodDay = isoDayNumber(pr.cycle.lastPeriodStart);
    const startDay = isoDayNumber(ctx.schedule.startDate);
    const female = pr.sex === 'female' && !pr.input.sexUnspecified;
    const cycleTracked =
      female && pr.cycle.tracking && !isHormonalContraception(pr.cycle.contraception) && pr.menopause !== 'post' && Number.isFinite(lastPeriodDay) && Number.isFinite(startDay);
    const weightKg = pr.weightKg > 0 ? pr.weightKg : 70;
    const alcPerDayG = (habits.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
    return {
      hRef: g('hRef'),
      poorH: g('qualityPoorH'),
      shiftH: g('shiftWorkH'),
      // exact one-day relaxation factors exp(−Δt/τ), Δt = 1 d (16 §4.1.1: a = 1 − exp(−1/τ))
      fDfUp: Math.exp(-1 / g('tauDfUp')),
      fDfDown: Math.exp(-1 / g('tauDfDown')),
      fDsUp: Math.exp(-1 / g('tauDsUp')),
      fDsDown: Math.exp(-1 / g('tauDsDown')),
      debtCap: g('debtCap'),
      debtCapT: g('debtCapTesto'),
      siPerH: g('siPerH'),
      mpsPerH: g('mpsPerH'),
      testoPerH: g('testoPerH'),
      partPerH: g('partitionPerH'),
      partCap: g('partitionCap'),
      partDefRef: g('partitionDeficitRef'),
      // 16 §4.2.1 half-life modifiers: combined oral contraceptive ×1.47, smoker ×0.56 (HabitProfile.smoker, 2026-09-30)
      tHalf: caffeineHalfLifeH(
        g('caffeineTHalfH'),
        female && pr.cycle.contraception === 'combinedOral',
        habits.smoker === true,
        g('caffeineOcMult'),
        g('caffeineSmokerMult'),
      ),
      rStar: g('caffeineRStarMg'),
      tstPerMg: g('tstLossPerMg'),
      tstCap: g('tstLossCapMin'),
      tstPts: g('tstLossPtsPerMin'),
      alcLo: g('alcoholDoseLowGKg'),
      alcHi: g('alcoholDoseHighGKg'),
      penLo: g('alcoholPenaltyLow'),
      penMid: g('alcoholPenaltyMid'),
      penHi: g('alcoholPenaltyHigh'),
      sleepBase: g('sleepIndexBase'),
      rampDays: g('lutealRampDays'),
      fatDrift: g('menopauseFatDriftKgYr'),
      leanDrift: g('menopauseLeanDriftKgYr'),
      isMale: pr.sex === 'male' && !pr.input.sexUnspecified,
      weightKg,
      age0: pr.ageYears,
      menoPeri: female && pr.menopause === 'peri',
      cycleTracked,
      cycleLen,
      lastPeriodDay,
      startDay,
      habSleepH: habitualSleepHours(habits.bedTimeH, habits.wakeTimeH),
      habPoor: habits.sleepQuality === 'poor' ? 1 : 0,
      habCaffeineMg: habits.habitualCaffeineMg,
      habBedH: habits.bedTimeH,
      habAlcoholGKg: alcPerDayG / weightKg,
      habStress: habits.stress === 'high' ? 2 : habits.stress === 'moderate' ? 1 : 0,
    };
  },

  init: (k: ModeratorsK, _ctx: ModuleContext, bus: SignalBus): ModeratorsState => {
    // steady state of the habitual sleep (a burn-in on the habitual day leaves it there): dF, dS = d_hab (capped)
    const dHab = nightlyDeficitH(k.hRef, k.habSleepH, k.habPoor, 0, k.poorH, k.shiftH);
    const dF = dHab < k.debtCap ? dHab : k.debtCap;
    const dS = dHab < k.debtCapT ? dHab : k.debtCapT;
    // habitual caffeine (one dose at 12:00 by default) at habitual bedtime
    let hoursToBed = k.habBedH - DEFAULTS.caffeineClockH;
    if (hoursToBed < 0) hoursToBed += 24;
    const habResidual = caffeineResidualMg(k.habCaffeineMg, hoursToBed, k.tHalf);
    const tst = tstLossMin(habResidual, k.rStar, k.tstPerMg, k.tstCap);
    const pen = alcoholRecoveryPenalty(k.habAlcoholGKg, k.alcLo, k.alcHi, k.penLo, k.penMid, k.penHi);
    const s: ModeratorsState = {
      sleepDebtFastH: dF,
      sleepDebtSlowH: dS,
      lastNightSleepH: k.habSleepH,
      caffeineAtBedMg: habResidual,
      cycleDay: -1,
      ageYears: k.age0,
      sleepQualityIdx: sleepQualityIndex(k.sleepBase, tst, k.tstPts, pen),
      lastNightPoor: k.habPoor,
      lastNightShift: 0,
      bedHourToday: Math.floor(k.habBedH) % 24,
      bedFracFactor: 1,
      alcoholGKgToday: 0,
      lutealWeight: 0,
      menopauseFatDriftKgYr: k.menoPeri ? k.fatDrift : 0,
      menopauseLeanDriftKgYr: k.menoPeri ? k.leanDrift : 0,
    };
    if (k.cycleTracked) {
      s.cycleDay = cycleDayOn(k.lastPeriodDay, k.startDay, 0, k.cycleLen);
      s.lutealWeight = lutealWeightAt(s.cycleDay, k.cycleLen, k.rampDays);
    }
    bus.sleepDebtFastH = s.sleepDebtFastH;
    bus.sleepDebtSlowH = s.sleepDebtSlowH;
    bus.siSleepMult = siSleepMult(dS, k.siPerH, k.debtCap);
    bus.mpsSleepMult = mpsSleepMult(dS, k.mpsPerH, k.debtCap);
    bus.testoSleepMult = testoSleepMult(dS, k.testoPerH, k.debtCapT, k.isMale);
    bus.partitionSleepShift = 0;
    bus.lutealWeight = s.lutealWeight;
    bus.cycleDay = s.cycleDay;
    bus.stressLevel = k.habStress;
    bus.ageYears = k.age0;
    return s;
  },

  startDay: (s, k, bus, day, clock) => {
    // 1-2. nightly deficit of last night → dF, dS relax (asymmetric exact exponentials), clamp to caps
    const d = nightlyDeficitH(k.hRef, s.lastNightSleepH, s.lastNightPoor, s.lastNightShift, k.poorH, k.shiftH);
    const tF = d < k.debtCap ? d : k.debtCap;
    const tS = d < k.debtCapT ? d : k.debtCapT;
    let dF = relax2(s.sleepDebtFastH, tF, k.fDfUp, k.fDfDown);
    let dS = relax2(s.sleepDebtSlowH, tS, k.fDsUp, k.fDsDown);
    dF = dF < 0 ? 0 : dF > k.debtCap ? k.debtCap : dF;
    dS = dS < 0 ? 0 : dS > k.debtCapT ? k.debtCapT : dS;
    s.sleepDebtFastH = dF;
    s.sleepDebtSlowH = dS;
    // 3. multipliers (16 §4.0.1)
    bus.sleepDebtFastH = dF;
    bus.sleepDebtSlowH = dS;
    bus.siSleepMult = siSleepMult(dS, k.siPerH, k.debtCap);
    bus.mpsSleepMult = mpsSleepMult(dS, k.mpsPerH, k.debtCap);
    bus.testoSleepMult = testoSleepMult(dS, k.testoPerH, k.debtCapT, k.isMale);
    bus.partitionSleepShift = partitionSleepShift(dS, bus.energyBalanceFrac, k.partPerH, k.partCap, k.partDefRef);
    // 4. cycle (function of the simulation day: exact whatever the burn-in length)
    if (k.cycleTracked) {
      s.cycleDay = cycleDayOn(k.lastPeriodDay, k.startDay, clock.day, k.cycleLen);
      s.lutealWeight = lutealWeightAt(s.cycleDay, k.cycleLen, k.rampDays);
    } else {
      s.cycleDay = -1;
      s.lutealWeight = 0;
    }
    bus.cycleDay = s.cycleDay;
    bus.lutealWeight = s.lutealWeight;
    // 5. stress and age
    bus.stressLevel = day.stress;
    s.ageYears = k.age0 + clock.day / 365.25;
    bus.ageYears = s.ageYears;
    // 6. set up tonight's caffeine sample (planned bed hour) and alcohol dose
    const bedH = day.sleepBedH;
    const bedFloor = Math.floor(bedH);
    s.bedHourToday = ((bedFloor % 24) + 24) % 24;
    const frac = bedH - bedFloor;
    s.bedFracFactor = frac > 0 ? Math.exp((-LN2 * frac) / k.tHalf) : 1;
    s.caffeineAtBedMg = 0;
    s.alcoholGKgToday = day.alcoholG / k.weightKg;
  },

  stepHour: (s, _k, bus, _hour, _day, clock) => {
    // caffeineLoadMg (h−1) = load at the start of this hour; sampled at the planned bed hour
    if (clock.hourOfDay === s.bedHourToday) s.caffeineAtBedMg = bus.caffeineLoadMg * s.bedFracFactor;
  },

  endOfDay: (s, k, _bus, day) => {
    // sleep-quality index for the night that starts tonight (diet → sleep feedback into sleep hours is OFF, 16 §4.2)
    const tst = tstLossMin(s.caffeineAtBedMg, k.rStar, k.tstPerMg, k.tstCap);
    const pen = alcoholRecoveryPenalty(s.alcoholGKgToday, k.alcLo, k.alcHi, k.penLo, k.penMid, k.penHi);
    s.sleepQualityIdx = sleepQualityIndex(k.sleepBase, tst, k.tstPts, pen);
    // the night that starts tonight is "last night" for tomorrow's deficit
    s.lastNightSleepH = day.sleepHours;
    s.lastNightPoor = day.sleepQuality === 0 ? 1 : 0;
    s.lastNightShift = day.shiftWork ? 1 : 0;
  },

  recordDay: (s, _k, _bus, out) => {
    out[MI.sleepQuality] = s.sleepQualityIdx;
  },
});

export {
  alcoholRecoveryPenalty,
  caffeineHalfLifeH,
  caffeineResidualMg,
  cycleDayOn,
  daysFromCivil,
  isoDayNumber,
  lutealMeanWeight,
  lutealStartDay,
  lutealWeightAt,
  mpsSleepMult,
  nightlyDeficitH,
  partitionSleepShift,
  siSleepMult,
  sleepQualityIndex,
  testoSleepMult,
  tstLossMin,
} from './equations';
export { MODERATORS_PARAMS } from './params';
