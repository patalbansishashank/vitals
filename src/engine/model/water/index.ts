/**
 * MODULE water — glycogen-bound water, carbohydrate/insulin natriuresis (E_cna), dietary-sodium water (S_na, partial
 * habituation), gut contents, exercise plasma volume, menstrual water, creatine water, refeeding oedema, hydration
 * deficit → labile water and scale weight.
 * Spec: docs/MODEL_SPEC.md §1.10 · Dossiers: 13 §4.1-4.6 (owner of S_na/E_cna/M_gut); 15 §4.7-4.8, §4.12 (partial
 * habituation h, H_def, W_Cr); 04 §4.1 (h = 3.0 g/g); 20 §4.5 (fasting natriuresis magnitude, oedema); 16 §4.5 (cycle).
 * Owned files: src/engine/model/water/** only.
 *
 * Bookkeeping (MODEL_SPEC §1.10, review B1/M15/M16):
 *   labileWaterKg  = (1 + h)·(G_L + G_M − G_ref)/1000                    glycogen mass and its bound water
 *                  + [E_cna + S_na/140 + E_oed + P_ex + W_mc + W_Cr − H_def − ECF_ref]   sodium/fluid shift
 *                  + (M_gut − M_gut,ref)                                 gut contents
 *   scaleWeightKg  = tissueMassKg + labileWaterKg                        (O-5: = FM + FFM_act + labile water)
 *   leanMass       = scaleWeightKg − fatMassKg                           (DXA-equivalent lean)
 * All references (G_ref, ECF_ref, M_gut,ref) follow the state during burn-in (clock.day < 0) and are set at t = 0 by the
 * MORNING ANCHOR (orchestrator ruling 2026-09-30, MODEL_SPEC §3.4): the entered weight is a wake-hour (post-void, fasted)
 * weight, so each reference is the value the quantity will have at the habitual wake hour of day 0 — the t = 0 (midnight)
 * state plus its midnight → wake-hour change on the most recent burn-in day of day 0's weekday (the same habitual evening
 * precedes both nights). Every labile deviation is therefore ≈ 0 at day 0's wake hour, and positive at t = 0 by exactly the
 * habitual overnight fall; composition anchors the tissue masses the same way, so the day-0 wake-hour scale weight equals
 * the entered weight (O-5). With burnInDays = 0 there is no burn-in night and the anchor falls back to t = 0.
 *
 * Time base: hourly steps with exact first-order relaxations (`x ← x* + (x − x*)·f`, f = exp(−Δt/τ) precomputed in
 * `prepare`); the hot path allocates nothing.
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { relax, relax2, wakeRecordHour } from '../../core/math';
import { MMOL_NA_PER_G } from '../../core/defaults';
import { MI } from '../../types/metrics';
import type { EventSink } from '../../types/module';
import { WATER_PARAMS } from './params';

/**
 * Glycogen-water ratio h, g/g. Owned and registered by fuel (`fuel.hWater`, MODEL_SPEC §1.6, ruling R-GLYW) — water reads
 * it in `prepare`. This literal is used only when fuel's entry is absent from the registry (water module tested alone);
 * it is the spec's value (04 §4.1, 3.0 g/g [2, 4]), not a second parameter.
 */
const H_GLY_WATER_FALLBACK = 3.0;
const FUEL_H_WATER_ID = 'fuel.hWater';

/** Ring length (days) of the daily-history buffers used by the events; a power of two. */
const HIST = 32;
const HIST_MASK = HIST - 1;
const INV24 = 1 / 24;

export interface WaterState {
  /** Carbohydrate-sensitive ECF deviation E_cna, L (13 §4.3); ≤ 0 in low-carbohydrate states and fasts. */
  eCnaL: number;
  /** Retained sodium S_na, mmol (13 §4.4); water = S_na/140 L. */
  sNaMmol: number;
  /** Habitual sodium set-point Na_hab, mmol/d (13 §4.4 with 15's partial habituation). */
  naHabMmol: number;
  /** Gut contents M_gut, kg, and its reference at t = 0 (13 §4.5). */
  mGutKg: number;
  mGutRefKg: number;
  /** Exercise plasma-volume expansion P_ex, L (13 §4.6, τ 2 d). */
  pExL: number;
  /** Menstrual water W_mc, kg (13 §4.6), 0 unless the cycle is tracked. */
  wMcKg: number;
  /** Hydration deficit H_def, kg (15 §4.8). */
  hDefKg: number;
  /** Creatine water W_Cr, kg (15 §4.12). */
  wCrKg: number;
  /** Reference glycogen G_L + G_M at t = 0, g (follows the state during burn-in). */
  glycogenRefG: number;
  /** Reference of the sodium/fluid-shift sum at t = 0, kg (follows the state during burn-in). */
  ecfRefKg: number;

  // ---- morning anchor (burn-in only): raw glycogen (g), sodium/fluid sum (kg) and gut contents (kg)
  /** Values at the end of the previous hour (the midnight values when read at hour 0). */
  prevGlyG: number;
  prevEcfKg: number;
  prevGutKg: number;
  /** Values at the start of the current burn-in day (midnight). */
  midGlyG: number;
  midEcfKg: number;
  midGutKg: number;
  /** Midnight → wake-hour change on the most recent burn-in day of day 0's weekday (else the latest burn-in day). */
  nightGlyG: number;
  nightEcfKg: number;
  nightGutKg: number;
  /** 1 once a burn-in day of day 0's weekday has been latched. */
  nightMatched: number;
  /** Morning weigh-in hour of the current day (`core/math.wakeRecordHour`, the recorder's wake hour). */
  wakeHour: number;

  // ---- day inputs resolved in startDay
  /** Dietary sodium intake of the day as scheduled, mmol/d. */
  naInMmolD: number;
  /** Kidney set-point the day pulls Na_hab toward: Na0 + (1 − hNa)(Na_in − Na0), mmol/d. */
  naHabTargetMmolD: number;
  /** 24/(waking hours): spreads the day's sodium over waking hours. */
  wakeScale: number;
  /** Hydration shortfall of the day spread over 24 h, kg/h (0 when fluid is thirst-driven). */
  hDefFluxKgH: number;
  /** Daily-cadence signals cached at startDay (intake and moderators write them once a day): cycle day (−1 = not tracked)… */
  cycleDay: number;
  /** …and the fed gut-content target (S0 + slope·NSP)·T_tr/1000 for the day's fibre exposure, kg. */
  gutFedKg: number;
  /** Last hour's outputs, kg (copies of the bus values so recording needs no bus reads). */
  scaleKg: number;
  labileKg: number;
  /** Last value written to `hydrationDeficitKg` (the bus write is skipped while H_def is unchanged, usually 0). */
  hDefOut: number;

  // ---- outputs of the last step (for recording), kg
  /** (1 + h)·ΔG/1000: glycogen mass and its bound water relative to t = 0. */
  glycogenWaterKg: number;
  /** Sodium/fluid shift relative to t = 0 (E_cna, S_na, oedema, PV, cycle, creatine, −H_def). */
  ecfShiftKg: number;
  /** M_gut − M_gut,ref. */
  gutDevKg: number;

  // ---- exercise edge detector and event history
  /** 1 when the previous hour was a hard session (a bout counts once, at its first hour). */
  prevHard: number;
  /** Sum of this day's hourly scale weights and hours summed (daily mean for the events). */
  scaleSum: number;
  scaleHours: number;
  /** Days recorded into the rings so far; rings of the daily-mean scale weight and the end-of-day fat mass, kg. */
  histN: number;
  histScale: Float64Array;
  histFat: Float64Array;
  /** Edge detectors: the event condition held on the previous day (1) or not (0). */
  reboundOn: number;
  plateauOn: number;
}

/** Constants (parameters copied in `prepare`, decay factors precomputed). */
export interface WaterConstants {
  /** 1 + h (glycogen mass + bound water per g glycogen). */
  onePlusH: number;
  // E_cna
  eMax: number;
  invCRef: number;
  /** Fasting target of E_cna, L (≤ 0): −1.3 L·(ECF0/17 L), ECF0 = 0.2 L/kg·BW0 (20 §4.5.2). */
  eFastTargetL: number;
  fEUp: number;
  fEDown: number;
  // S_na
  na0MmolD: number;
  mmolNaPerMg: number;
  hNa: number;
  fNa: number;
  /** Hourly gain of the exact update S ← S·f + u·gain, with u in mmol/h: τ_h·(1 − f). */
  gNa: number;
  fHab: number;
  /** mmol Na per (L/h of sweat rate · minute): sweatNa/60. */
  sweatNaPerMin: number;
  invNaPerL: number;
  // M_gut
  gutS0: number;
  gutSlope: number;
  /** Transit time in kg-scale units: T_tr/1000 (g/d · d → kg). */
  gutTtrKg: number;
  fGutFill: number;
  fGutEmpty: number;
  // plasma volume
  pvLPerKg: number;
  pvCapL: number;
  fPv: number;
  // cycle
  cycleAmp: number;
  cycleLen: number;
  cTrough: number;
  cOvEnd: number;
  cOvLevel: number;
  cycleMean: number;
  // creatine
  wCr: number;
  // hydration
  fH: number;
  gH: number;
  hCap: number;
  hFKidney: number;
  hRefill: number;
  needFrac: number;
  needOffset: number;
  needMin: number;
  /** Part of the water-turnover regression that does not depend on body mass, mL/d. */
  wtConst: number;
  wtBw: number;
  // events
  events: EventSink;
  reboundKg: number;
  reboundDays: number;
  plateauKg: number;
  plateauDays: number;
  /** EB7 threshold of weightPlateau, kcal/d (−200: the 7-day energy balance must be below it). */
  plateauEb7KcalD: number;
  checks: boolean;
  /** Series indices (MI.*), resolved once. */
  iScale: number;
  iLean: number;
  iWater: number;
  iGly: number;
  iEcf: number;
  iGut: number;
  iBf: number;
  /** Weekday (0 = Monday) of day 0: the burn-in night whose overnight change anchors the references. */
  startWeekday: number;
}

/** Piecewise-linear menstrual retention shape s(p) ∈ [0, 1] (peak 1 on day 1 of flow, p = 0), p = fraction of the cycle. */
function cycleShape(p: number, k: WaterConstants): number {
  if (p < k.cTrough) return 1 - p / k.cTrough;
  if (p < k.cOvEnd) return (k.cOvLevel * (p - k.cTrough)) / (k.cOvEnd - k.cTrough);
  return k.cOvLevel + ((1 - k.cOvLevel) * (p - k.cOvEnd)) / (1 - k.cOvEnd);
}

/** need_fluid_L = max(1.2, 0.81·WT/1000 − 0.3) with the total-water-turnover regression WT (15 §4.8), BW in kg. */
function needFluidL(k: WaterConstants, bwKg: number): number {
  const need = (k.needFrac * (k.wtConst + k.wtBw * bwKg)) / 1000 - k.needOffset;
  return need > k.needMin ? need : k.needMin;
}

/** Daily-mean scale-weight history events (allocation-free). */
function dailyEvents(s: WaterState, k: WaterConstants, bus: { fatMassKg: number; energyBalance7KcalD: number }, hourIndex: number): void {
  const n0 = s.histN;
  const mean = s.scaleSum / (s.scaleHours > 0 ? s.scaleHours : 1);
  s.scaleSum = 0;
  s.scaleHours = 0;
  s.histScale[n0 & HIST_MASK] = mean;
  s.histFat[n0 & HIST_MASK] = bus.fatMassKg;
  const n = n0 + 1;
  s.histN = n;

  // waterRebound: scale weight up ≥ 0.5 kg relative to the lowest of the previous 3 days while fat mass falls
  let reboundNow = 0;
  let rise = 0;
  if (n > k.reboundDays) {
    let mn = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= k.reboundDays; j++) {
      const v = s.histScale[(n - 1 - j) & HIST_MASK]!;
      if (v < mn) mn = v;
    }
    rise = mean - mn;
    if (rise >= k.reboundKg && bus.fatMassKg < s.histFat[(n - 1 - k.reboundDays) & HIST_MASK]!) reboundNow = 1;
  }
  if (reboundNow === 1 && s.reboundOn === 0) k.events.emit('waterRebound', hourIndex, rise);
  s.reboundOn = reboundNow;

  // weightPlateau (13 §4.7, MODEL_SPEC §1.10): 7-d mean moved < 0.1 kg over 14 d while EB7 < −200 kcal/d
  let plateauNow = 0;
  let change = 0;
  const span = 7 + k.plateauDays;
  if (n >= span) {
    let a = 0;
    let b = 0;
    for (let j = 0; j < 7; j++) {
      a += s.histScale[(n - 1 - j) & HIST_MASK]!;
      b += s.histScale[(n - 1 - k.plateauDays - j) & HIST_MASK]!;
    }
    change = (a - b) / 7;
    if (Math.abs(change) < k.plateauKg && bus.energyBalance7KcalD < k.plateauEb7KcalD) plateauNow = 1;
  }
  if (plateauNow === 1 && s.plateauOn === 0) k.events.emit('weightPlateau', hourIndex, change);
  s.plateauOn = plateauNow;
}

export const waterModule = defineModule<WaterState, WaterConstants>({
  id: 'water',
  specSection: '§1.10',
  dossiers: '13 §4.1-4.6; 15 §4.7-4.8, §4.12; 04 §4.1; 20 §4.5; 16 §4.5',
  params: WATER_PARAMS,
  reads: [
    'liverGlycogenG', 'muscleGlycogenG', 'carbAbs24G', 'fastActive', 'fastOedemaL', 'exHardSession', 'creatineSatFrac',
    'fibreEffG', 'tissueMassKg', 'fatMassKg', 'leanTissueKg', 'lutealWeight', 'cycleDay', 'energyBalance7KcalD',
  ],
  writes: ['labileWaterKg', 'scaleWeightKg', 'hydrationDeficitKg'],
  records: ['scaleWeight', 'bodyFatPct', 'leanMass', 'waterWeight', 'glycogenWater', 'ecfShift', 'gutContent'],

  prepare: (ctx) => {
    const P = (id: string): number => param(ctx.params, `water.${id}`);
    const p = ctx.profile;
    const male = p.sex === 'male';
    const hGly = ctx.params.index.has(FUEL_H_WATER_ID) ? param(ctx.params, FUEL_H_WATER_ID) : H_GLY_WATER_FALLBACK;
    const tTr = male ? P('gutTtrMale') : P('gutTtrFemale');
    const tauNaH = 24 * P('tauNa');
    const fNa = Math.exp(-1 / tauNaH);
    const tauHH = 24 * P('hDefTau');
    const fH = Math.exp(-1 / tauHH);
    const cTrough = P('cycleTroughPos');
    const cOvEnd = P('cycleOvEndPos');
    const cOvLevel = P('cycleOvLevel');
    // mean of the piecewise-linear shape over one cycle (area of three trapezoids)
    const cycleMean = 0.5 * cTrough + 0.5 * (cOvEnd - cTrough) * cOvLevel + 0.5 * (1 - cOvEnd) * (cOvLevel + 1);
    const cl = p.cycle.cycleLengthD ?? 28;
    const pal = Math.min(2.5, Math.max(1.2, p.tdee0Kcal / p.rmr0Kcal));
    const age = p.ageYears;
    const tC = P('envTempC');
    const wtConst =
      P('wtPal') * pal +
      P('wtSex') * (male ? 1 : 0) +
      P('wtHumidity') * P('envHumidityPct') +
      P('wtAthlete') * P('envAthlete') +
      P('wtHdi') * P('envHdi') +
      P('wtAltitude') * P('envAltitudeM') +
      P('wtAge2') * age * age +
      P('wtAge') * age +
      P('wtTemp2') * tC * tC +
      P('wtTemp') * tC +
      P('wtIntercept');
    return {
      onePlusH: 1 + hGly,
      eMax: P('eMax'),
      invCRef: 1 / P('cRefCna'),
      eFastTargetL: -P('eFastL') * ((P('ecfPerKgBw') * p.weightKg) / P('ecfRefL')),
      fEUp: Math.exp(-1 / (24 * P('tauUp'))),
      fEDown: Math.exp(-1 / (24 * P('tauDown'))),
      na0MmolD: p.habitualSodiumMg * (MMOL_NA_PER_G / 1000),
      mmolNaPerMg: MMOL_NA_PER_G / 1000,
      hNa: P('hNa'),
      fNa,
      gNa: tauNaH * (1 - fNa),
      fHab: Math.exp(-1 / (24 * P('tauHab'))),
      sweatNaPerMin: P('sweatNaMmolL') / 60,
      invNaPerL: 1 / P('naPerLEcf'),
      gutS0: male ? P('gutS0Male') : P('gutS0Female'),
      gutSlope: P('gutSlope'),
      gutTtrKg: tTr / 1000,
      fGutFill: Math.exp(-1 / (12 * tTr)), // τ = T_tr/2 days = 12·T_tr hours
      fGutEmpty: Math.exp(-1 / (24 * P('gutTauEmpty'))),
      pvLPerKg: P('pvMlPerKg') / 1000,
      pvCapL: P('pvCapL'),
      fPv: Math.exp(-1 / (24 * P('pvTau'))),
      cycleAmp: P('cycleAmpKg'),
      cycleLen: Math.min(40, Math.max(21, cl)),
      cTrough,
      cOvEnd,
      cOvLevel,
      cycleMean,
      wCr: P('creatineWaterKg'),
      fH,
      gH: tauHH * (1 - fH),
      hCap: P('hDefCapKg'),
      hFKidney: P('hDefFKidney'),
      hRefill: P('hDefRefill'),
      needFrac: P('needBeverageFrac'),
      needOffset: P('needOffsetL'),
      needMin: P('needMinL'),
      wtConst,
      wtBw: P('wtBw'),
      events: ctx.events,
      reboundKg: P('reboundKg'),
      reboundDays: Math.min(10, Math.max(1, Math.round(P('reboundDays')))),
      plateauKg: P('plateauKg'),
      plateauDays: Math.min(HIST - 8, Math.max(1, Math.round(P('plateauDays')))),
      plateauEb7KcalD: P('plateauEb7KcalD'),
      checks: ctx.checks,
      iScale: MI.scaleWeight,
      iLean: MI.leanMass,
      iWater: MI.waterWeight,
      iGly: MI.glycogenWater,
      iEcf: MI.ecfShift,
      iGut: MI.gutContent,
      iBf: MI.bodyFatPct,
      startWeekday: p.startWeekday,
    };
  },

  init: (k, ctx, bus) => {
    const p = ctx.profile;
    // Gut: steady state on the habitual fibre (fibreEffG at init); E_cna: 13 §2 rule −E_max·(1 − C/C_ref) below C_ref.
    const gut0 = (k.gutS0 + k.gutSlope * Math.max(0, bus.fibreEffG)) * k.gutTtrKg;
    let frac = 1 - p.habitualCarbG * k.invCRef;
    if (frac < 0) frac = 0;
    const eCna0 = -k.eMax * frac;
    const wCr0 = k.wCr * Math.min(1, Math.max(0, bus.creatineSatFrac));
    const ecf0 = eCna0 + bus.fastOedemaL + wCr0;
    bus.labileWaterKg = 0;
    bus.scaleWeightKg = bus.tissueMassKg;
    bus.hydrationDeficitKg = 0;
    return {
      eCnaL: eCna0,
      sNaMmol: 0,
      naHabMmol: k.na0MmolD,
      mGutKg: gut0,
      mGutRefKg: gut0,
      pExL: 0,
      wMcKg: 0,
      hDefKg: 0,
      wCrKg: wCr0,
      glycogenRefG: bus.liverGlycogenG + bus.muscleGlycogenG,
      ecfRefKg: ecf0,
      prevGlyG: bus.liverGlycogenG + bus.muscleGlycogenG,
      prevEcfKg: ecf0,
      prevGutKg: gut0,
      midGlyG: bus.liverGlycogenG + bus.muscleGlycogenG,
      midEcfKg: ecf0,
      midGutKg: gut0,
      nightGlyG: 0,
      nightEcfKg: 0,
      nightGutKg: 0,
      nightMatched: 0,
      wakeHour: wakeRecordHour(p.habits.wakeTimeH),
      naInMmolD: k.na0MmolD,
      naHabTargetMmolD: k.na0MmolD,
      wakeScale: 1.5,
      hDefFluxKgH: 0,
      cycleDay: bus.cycleDay,
      gutFedKg: gut0,
      scaleKg: bus.tissueMassKg,
      labileKg: 0,
      hDefOut: 0,
      glycogenWaterKg: 0,
      ecfShiftKg: 0,
      gutDevKg: 0,
      prevHard: 0,
      scaleSum: 0,
      scaleHours: 0,
      histN: 0,
      histScale: new Float64Array(HIST),
      histFat: new Float64Array(HIST),
      reboundOn: 0,
      plateauOn: 0,
    };
  },

  startDay: (s, k, bus, day) => {
    // Dietary sodium (day input, mg → mmol), used as scheduled — also on fast days: the fasting natriuresis (which in the
    // fasting data already includes a near-zero sodium intake) is E_cna's fasting target, so zeroing S_na's intake here as well
    // would count it twice (MODEL_SPEC R-WATER "one implementation per term"; 7-d fast then −6.7 instead of −5.7 kg).
    const na = day.sodiumMg * k.mmolNaPerMg;
    s.naInMmolD = na;
    s.naHabTargetMmolD = k.na0MmolD + (1 - k.hNa) * (na - k.na0MmolD);
    let wake = 24 - day.sleepHours;
    if (wake < 4) wake = 4;
    else if (wake > 24) wake = 24;
    s.wakeScale = 24 / wake;
    s.wakeHour = wakeRecordHour(day.sleepWakeH);
    // Hydration shortfall (15 §4.8): only when the user enters a beverage volume; thirst-driven (NaN) means need = fluid.
    let flux = 0;
    if (Number.isFinite(day.fluidL)) {
      let exMin = 0;
      for (let i = 0; i < day.nSessions; i++) exMin += day.sessions[i]!.durationMin;
      const sweatL = day.sweatLPerH * exMin * (1 / 60);
      const deficit = needFluidL(k, bus.tissueMassKg) + sweatL * (1 - k.hRefill) - day.fluidL;
      if (deficit > 0) flux = (deficit * k.hFKidney) * INV24;
    }
    s.hDefFluxKgH = flux;
    // Daily-cadence signals from earlier modules (MODEL_SPEC §4): creatine saturation, fibre exposure, cycle day.
    const x = bus.creatineSatFrac;
    s.wCrKg = k.wCr * (x < 0 ? 0 : x > 1 ? 1 : x);
    const nsp = bus.fibreEffG;
    s.gutFedKg = (k.gutS0 + k.gutSlope * (nsp > 0 ? nsp : 0)) * k.gutTtrKg;
    s.cycleDay = bus.cycleDay;
  },

  stepHour: (s, k, bus, hour, day, clock) => {
    // Bus reads (a dictionary-mode object, see report): each signal once.
    const fasting = bus.fastActive > 0.5;
    const tissue = bus.tissueMassKg;

    // 1. E_cna: carbohydrate/insulin-sensitive natriuresis (13 §4.3). While a fast is active the target is 20 §4.5.2's
    //    body-size-scaled E_fast* (starts with the fast: the 24-h rolling carbohydrate would delay it by 12-24 h); otherwise
    //    13's −E_max·(1 − C/C_ref) below C_ref. Same state and time constants either way (one implementation, R-WATER).
    let target: number;
    if (fasting) target = k.eFastTargetL;
    else {
      let frac = 1 - bus.carbAbs24G * k.invCRef;
      if (frac < 0) frac = 0;
      target = -k.eMax * frac;
    }
    const eCna = relax2(s.eCnaL, target, k.fEUp, k.fEDown);
    s.eCnaL = eCna;

    // 2. S_na: (Na_in − Na_hab) spread over waking hours, sweat sodium as an extra loss (15 §4.7 L_sweat)
    const naHab = s.naHabMmol;
    let u = (s.naInMmolD - naHab) * (1 - hour.asleep) * s.wakeScale * INV24; // mmol/h
    if (hour.exMin > 0) u -= day.sweatLPerH * hour.exMin * k.sweatNaPerMin;
    let sNa = s.sNaMmol * k.fNa + u * k.gNa;
    if (sNa < -300) sNa = -300;
    else if (sNa > 500) sNa = 500;
    s.sNaMmol = sNa;
    s.naHabMmol = relax(naHab, s.naHabTargetMmolD, k.fHab);

    // 3. M_gut: fed formula (S0 + 5·NSP)·T_tr/1000 (day target), colon empties toward 0 while fasting (13 §4.5, review M16)
    const mGut = fasting ? relax(s.mGutKg, 0, k.fGutEmpty) : relax(s.mGutKg, s.gutFedKg, k.fGutFill);
    s.mGutKg = mGut;

    // 4. P_ex: +4.5 mL/kg at the first hour of each hard bout, saturating, τ 2 d (13 §4.6)
    let pEx = s.pExL;
    if (pEx !== 0) pEx *= k.fPv;
    if (bus.exHardSession > 0.5) {
      if (s.prevHard === 0) {
        pEx += k.pvLPerKg * tissue;
        if (pEx > k.pvCapL) pEx = k.pvCapL;
      }
      s.prevHard = 1;
    } else s.prevHard = 0;
    s.pExL = pEx;

    // 5. cycle water (only when the cycle is tracked), hydration deficit (creatine water is set at startDay)
    let wMc = 0;
    if (s.cycleDay >= 1 && k.cycleAmp > 0) {
      let pos = (s.cycleDay - 1 + hour.hourOfDay * INV24) / k.cycleLen;
      pos -= Math.floor(pos);
      wMc = k.cycleAmp * (cycleShape(pos, k) - k.cycleMean);
    }
    s.wMcKg = wMc;
    let hDef = s.hDefKg;
    if (hDef !== 0 || s.hDefFluxKgH !== 0) {
      hDef = hDef * k.fH + s.hDefFluxKgH * k.gH;
      if (hDef > k.hCap) hDef = k.hCap;
      s.hDefKg = hDef;
    }

    // 6. labile deviations from the t = 0 references
    const gTot = bus.liverGlycogenG + bus.muscleGlycogenG;
    const ecf = eCna + sNa * k.invNaPerL + bus.fastOedemaL + pEx + wMc + s.wCrKg - hDef;
    let gly = 0;
    let ecfDev = 0;
    let gutDev = 0;
    if (clock.day < 0) {
      // burn-in: references follow the state (deviations 0); the morning anchor records each night's midnight → wake change
      s.glycogenRefG = gTot;
      s.ecfRefKg = ecf;
      s.mGutRefKg = mGut;
      if (clock.hourOfDay === 0) {
        s.midGlyG = s.prevGlyG;
        s.midEcfKg = s.prevEcfKg;
        s.midGutKg = s.prevGutKg;
      }
      if (clock.hourOfDay === s.wakeHour) {
        const same = clock.weekday === k.startWeekday;
        if (same || s.nightMatched === 0) {
          s.nightGlyG = gTot - s.midGlyG;
          s.nightEcfKg = ecf - s.midEcfKg;
          s.nightGutKg = mGut - s.midGutKg;
          if (same) s.nightMatched = 1;
        }
      }
      s.prevGlyG = gTot;
      s.prevEcfKg = ecf;
      s.prevGutKg = mGut;
    } else {
      gly = k.onePlusH * (gTot - s.glycogenRefG) * 0.001;
      ecfDev = ecf - s.ecfRefKg;
      gutDev = mGut - s.mGutRefKg;
      s.scaleSum += tissue + gly + ecfDev + gutDev;
      s.scaleHours += 1;
    }
    s.glycogenWaterKg = gly;
    s.ecfShiftKg = ecfDev;
    s.gutDevKg = gutDev;
    const labile = gly + ecfDev + gutDev;
    const scale = tissue + labile;
    s.labileKg = labile;
    s.scaleKg = scale;
    bus.labileWaterKg = labile;
    bus.scaleWeightKg = scale;
    if (hDef !== s.hDefOut) {
      s.hDefOut = hDef;
      bus.hydrationDeficitKg = hDef;
    }
    if (k.checks && !(Number.isFinite(scale) && Number.isFinite(labile) && Number.isFinite(hDef))) {
      throw new Error(`water: non-finite output at hour ${clock.hourIndex}`);
    }
  },

  endOfDay: (s, k, bus, _day, clock) => {
    if (clock.day >= 0) dailyEvents(s, k, bus, clock.hourIndex);
  },

  endBurnIn: (s, k, bus, ctx) => {
    // MODEL_SPEC §1.10 / §3.4 (R-BURNIN + morning anchor, orchestrator ruling 2026-09-30): every labile reference = its
    // t = 0 state plus the habitual overnight change up to the wake hour (burn-in night of day 0's weekday), so the
    // deviations are 0 at the day-0 wake hour; composition has anchored the tissue masses to FM0 + FFM0 at that hour. No
    // tissue offset: the t = 0 (midnight) scale is the entered weight plus the habitual overnight fall.
    const night = (ctx.burnInDays ?? 0) > 0 ? 1 : 0;
    const g = bus.liverGlycogenG + bus.muscleGlycogenG;
    const ecf = s.eCnaL + s.sNaMmol * k.invNaPerL + bus.fastOedemaL + s.pExL + s.wMcKg + s.wCrKg - s.hDefKg;
    s.glycogenRefG = g + night * s.nightGlyG;
    s.ecfRefKg = ecf + night * s.nightEcfKg;
    s.mGutRefKg = s.mGutKg + night * s.nightGutKg;
    const gly = k.onePlusH * (g - s.glycogenRefG) * 0.001;
    const ecfDev = ecf - s.ecfRefKg;
    const gutDev = s.mGutKg - s.mGutRefKg;
    const labile = gly + ecfDev + gutDev;
    s.glycogenWaterKg = gly;
    s.ecfShiftKg = ecfDev;
    s.gutDevKg = gutDev;
    s.labileKg = labile;
    s.scaleKg = bus.tissueMassKg + labile;
    s.scaleSum = 0;
    s.scaleHours = 0;
    bus.labileWaterKg = labile;
    bus.scaleWeightKg = s.scaleKg;
  },

  // scale-derived series are hourly; their daily value is the wake-hour value (catalogue agg 'wake', morning anchor)
  recordHour: (s, k, bus, out) => {
    const fm = bus.fatMassKg;
    out[k.iScale] = s.scaleKg;
    out[k.iLean] = s.scaleKg - fm;
    out[k.iBf] = (100 * fm) / s.scaleKg;
    out[k.iWater] = s.labileKg;
    out[k.iGly] = s.glycogenWaterKg;
    out[k.iEcf] = s.ecfShiftKg;
    out[k.iGut] = s.gutDevKg;
  },
});
