/**
 * MODULE safety — dossier-17 derived quantities (SafetyTrace), Simulator warning rules (W-*), engine events that are
 * safety flags, and the per-day margins of the Planner's hard constraints (HC-*, see `constraints.ts`).
 * Spec: docs/MODEL_SPEC.md §7 and §1.16 · Dossiers: 17 §2-§4 (owner); every dossier's §9 for engine-specific rules;
 * 20 §9 (fasting tiers), 13 §9 (Alpert cap, gallbladder), 05 §9 (BHB bands).
 * Owned files: src/engine/model/safety/** only.
 *
 * Data flow. `stepHour` only accumulates the day's intake/exercise/fast facts (a handful of adds and compares per hour).
 * `endOfDay` (last module in the order, so every daily signal of this day is final) pushes the day into 14-day rings,
 * derives the 17 §2.1 quantities into `ctx.safetyTrace`, and — in simulate mode — evaluates the ~80 warning rules into a
 * rule × day hit matrix. `finalize` completes the fast-tier rules from the episode log, merges runs into `SimWarning`s
 * (≤ 200-character messages, W-F04 with the 20-corrected wording) and emits one `safetyFlag` event per caution/danger run.
 * In planner mode only the SafetyTrace is filled (and early-abort bounds on it are honoured, see `abortOn` below).
 *
 * Planner hard-constraint margins are NOT computed here (spec §1.16, §10): `computeConstraintMargins(trace, person)` in
 * `constraints.ts` turns `result.safety` into the HC-* margins the planner's constraints hook consumes.
 */
import { defineModule } from '../../core/moduleKit';
import { wakeRecordHour } from '../../core/math';
import type { SignalBus } from '../../types/signals';
import type { DayInput, HourInput } from '../../types/inputs';
import type { FinalizeSink, ModuleContext, StepClock } from '../../types/module';
import { CARDIO_MODALITY_CODE } from '../../types/inputs';
import { SERIES, SERIES_INDEX } from '../../types/metrics';
import type { SeriesDef } from '../../types/metrics';
import { SAFETY_PARAMS, readSafetyConstants } from './params';
import { RULE_INDEX } from './rules';
import { N_REG as N_REG_IMPORT, RING as RING_IMPORT, RING28 as RING28_IMPORT, newSafetyState, setHit, setHitWorst } from './state';
import type { SafetyK, SafetyState } from './state';
import {
  bfFloorPct,
  deficitCapPct,
  fastTier,
  ketoFedStrict,
  olsSlope,
  rateCapPct,
  referenceWeightKg,
  ringMean,
  ringSum,
} from './derived';
import { closeEpisode, plannedMealToMealH } from './episodes';
import { evaluateDay, exclusiveBands, recordOwnDay } from './evaluate';
import { buildWarnings } from './messages';

export type { SafetyState } from './state';
export { SAFETY_PARAMS } from './params';
export { RULES, RULE_INDEX, MAX_MESSAGE_CHARS, W_F04_TEXT } from './rules';
export { computeConstraintMargins, computeWarningMargins, worstMargin } from './constraints';
export type { ConstraintPerson, ConstraintOptions } from './constraints';
export { FAST_TIER_IDS, fastTier, fastTierId, ketoFedStrict } from './derived';
export type { FastTier, FastTierId, KetoFedFlags } from './derived';

// local aliases of imported constants/functions (see evaluate.ts): keeps the per-day code off module-object property reads
const X = RULE_INDEX;
const RING = RING_IMPORT;
const RING28 = RING28_IMPORT;
const N_REG = N_REG_IMPORT;
const RUN_MODALITY = CARDIO_MODALITY_CODE.run;
/** Indices of the blood-marker series (deltaFromBaseline presentation with the marker caveat): W-U04 fires when one is requested. */
const MARKER_SERIES: readonly number[] = SERIES.map((d, i) =>
  (d as SeriesDef).presentation === 'deltaFromBaseline' &&
  (d as SeriesDef).caveat?.startsWith('Blood-marker') === true
    ? i
    : -1,
).filter((i) => i >= 0);
const F_TIER_RULES = [X['W-F01'], X['W-F02'], X['W-F03'], X['W-F04'], X['W-F05']] as const;

/** SafetyTrace quantities an early-abort bound may name (planner `abortOn`, spec §1.16), with their codes. */
const ABORT_CODES: Readonly<Record<string, number>> = {
  ei7: 1,
  tdee7: 2,
  deficitPct7: 3,
  ea7: 4,
  tissueMassKg: 5,
  rate14KgPerWk: 6,
  rate14PctPerWk: 7,
  cumLossPct: 8,
  bmi: 9,
  bodyFatPct: 10,
  fastHMax: 11,
  fastH7: 12,
  proteinGPerKgRw: 13,
  fatPctEnergy: 14,
  hungerIdx: 15,
};

interface AbortBoundLike {
  series: string;
  op: '<' | '>';
  value: number;
}

function resetDay(s: SafetyState): void {
  s.dayIntakeKcal = 0;
  s.dayTeeKcal = 0;
  s.dayEeeKcal = 0;
  s.dayProtG = 0;
  s.dayFatG = 0;
  s.dayCarbG = 0;
  s.dayFibreG = 0;
  s.dayAlcG = 0;
  s.dayCaffMg = 0;
  s.dayCaffDoseMaxMg = 0;
  s.dayCaffBedMg = 0;
  s.dayFastMaxH = 0;
  s.dayWakeScaleKg = Number.NaN;
  s.dayVigorousFrac = 0;
  s.dayHardInFastH = 0;
  s.dayKetoFedBhb = 0;
  s.dayNoElecFastH = 0;
  s.dayEpEndLenH = 0;
  s.dayAlcAfterLong = 0;
  s.dayFatFloorFmKg = 1e9;
}

/** Value of the SafetyTrace quantity `code` for the day just written (abort bounds). */
function traceValue(k: SafetyK, code: number, d: number): number {
  const t = k.trace;
  switch (code) {
    case 1:
      return t.ei7[d]!;
    case 2:
      return t.tdee7[d]!;
    case 3:
      return t.deficitPct7[d]!;
    case 4:
      return t.ea7[d]!;
    case 5:
      return t.tissueMassKg[d]!;
    case 6:
      return t.rate14KgPerWk[d]!;
    case 7:
      return t.rate14PctPerWk[d]!;
    case 8:
      return t.cumLossPct[d]!;
    case 9:
      return t.bmi[d]!;
    case 10:
      return t.bodyFatPct[d]!;
    case 11:
      return t.fastHMax[d]!;
    case 12:
      return t.fastH7[d]!;
    case 13:
      return t.proteinGPerKgRw[d]!;
    case 14:
      return t.fatPctEnergy[d]!;
    case 15:
      return t.hungerIdx[d]!;
    default:
      return Number.NaN;
  }
}

/** Mean of the last `n` samples of a 14-day ring over the days whose `fast` flag is 0; NaN when there are none. */
function meanNonFast(ring: Float64Array, fast: Float64Array, head: number, n: number): number {
  let sum = 0;
  let c = 0;
  for (let j = 1; j <= n; j++) {
    const i = (head - j + 2 * RING) % RING;
    if (fast[i]! > 0) continue;
    sum += ring[i]!;
    c++;
  }
  return c > 0 ? sum / c : Number.NaN;
}

/** Fill `state.q` and the SafetyTrace for day `d` (>= 0) from the rings and today's bus values. */
function computeDay(s: SafetyState, k: SafetyK, bus: SignalBus, d: number): void {
  const q = s.q;
  const tr = k.trace;
  const head = s.ringIdx;
  const n7 = s.daysSeen < 7 ? s.daysSeen : 7;
  // BW = the day's wake-hour scale weight (the displayed daily weight, morning anchor); end of day before the first wake hour
  const bwWake = s.dayWakeScaleKg;
  const bw = bwWake === bwWake ? bwWake : bus.scaleWeightKg;
  q.bw = bw;
  q.tm = bus.tissueMassKg;
  q.ffm = bus.ffmActKg;
  q.fm = bus.fatMassKg;
  q.ei = s.dayIntakeKcal;
  q.tdee = s.dayTeeKcal;
  // ---- ruling 2026-09-30 18:10 (fasts vs the 7-day floor / deficit cap): planned fast-event days are governed by the
  // fasting-tier rules. The 7-day intake, TDEE and deficit use the NON-fast days of the trailing 7; with a fast-event day in
  // the trailing 28 d the HC-E1 floor also applies to the 28-day mean intake and the loss rate is the 28-day tissue-mass
  // trend. On a fast-event day itself the 7-day floor/cap quantities are NaN (not evaluated). Without fasts nothing changes.
  const fastToday = d < k.fastDay.length && k.fastDay[d] === 1;
  q.fastDay = fastToday;
  const w28 = k.fastRuleWindowD < RING28 ? k.fastRuleWindowD : RING28;
  const n28 = s.seen28 < w28 ? s.seen28 : w28;
  let eiNF = 0;
  let tdNF = 0;
  let cNF = 0;
  let ei28 = 0;
  let anyFast = false;
  // ruling R-FAST-GATE (2026-10-01): with a planned fast-event day in the trailing 7 d, EA_7 is the mean over the last
  // seven NON-fast days (searched back through the 28-day window), so a fast does not drag the eating days' energy
  // availability below the floor and the week's training/rest mix is kept; without one EA_7 is the bus value unchanged
  let fastIn7 = false;
  let eaNF = 0;
  let cEa = 0;
  for (let j = 1; j <= n28; j++) {
    const i = (s.idx28 - j + 2 * RING28) % RING28;
    const e = s.ei28Ring[i]!;
    const f = s.fast28Ring[i]!;
    ei28 += e;
    if (f > 0) {
      anyFast = true;
      if (j <= n7) fastIn7 = true;
    } else {
      if (j <= n7) {
        eiNF += e;
        tdNF += s.tdee28Ring[i]!;
        cNF++;
      }
      if (cEa < 7) {
        eaNF += s.ea28Ring[i]!;
        cEa++;
      }
    }
  }
  q.fastIn28 = anyFast;
  q.ei28 = n28 > 0 ? ei28 / n28 : Number.NaN;
  const ei7 = cNF > 0 && !fastToday ? Math.fround(eiNF / cNF) : Number.NaN;
  const tdee7 = cNF > 0 && !fastToday ? Math.fround(tdNF / cNF) : Number.NaN;
  q.ei7 = ei7;
  q.tdee7 = tdee7;
  q.def7 = tdee7 > 0 ? Math.fround(100 * (1 - ei7 / tdee7)) : Number.NaN;
  q.eiFloor = anyFast ? (fastToday ? q.ei28 : ei7 < q.ei28 ? ei7 : q.ei28) : ei7;
  // on a fast-event day itself EA_7 is not evaluated (NaN), like the 7-day intake quantities (ruling 18:10)
  const ea7 = fastToday ? Number.NaN : !fastIn7 ? bus.ea7KcalKgFfm : cEa > 0 ? eaNF / cEa : Number.NaN;
  q.eaFinite = Number.isFinite(ea7);
  q.ea7 = q.eaFinite ? Math.fround(ea7) : Number.NaN;
  q.eee7 = ringSum(s.eeeRing, head, RING, n7, 0);
  // EA rules need exercise (HC-E4) and, since the integration pass, an energy deficit (`eaNeedsDeficit`, see params)
  q.eaApplies = (k.eaNeedsExercise === 0 || q.eee7 > 0) && (k.eaNeedsDeficit === 0 || q.def7 > k.deficitAnyPct);

  let slope: number;
  let tmMean: number;
  if (anyFast) {
    slope = olsSlope(s.tm28Ring, s.idx28, RING28, n28);
    tmMean = ringMean(s.tm28Ring, s.idx28, RING28, n28);
  } else {
    const nTm = s.daysSeen < RING ? s.daysSeen : RING;
    slope = olsSlope(s.tmRing, head, RING, nTm);
    tmMean = ringMean(s.tmRing, head, RING, nTm);
  }
  q.rate14Kg = Math.fround(-7 * slope) + 0; // + 0 turns −0 into 0
  q.rate14Pct = tmMean > 0 ? Math.fround((100 * q.rate14Kg) / tmMean) + 0 : 0;
  q.cum = s.startWeightKg > 0 ? Math.fround((100 * (s.startWeightKg - bw)) / s.startWeightKg) : 0;
  // projected BMI / body fat from tissue mass (17 "projected BMI"; no glycogen or water swings)
  const tm = q.tm > 0 ? q.tm : bw;
  q.bmiTm = Math.fround(tm / (k.heightM * k.heightM));
  q.cumTm = s.startWeightKg > 0 ? (100 * (s.startWeightKg - tm)) / s.startWeightKg : 0;
  q.bmi = q.bmiTm;
  q.bf = tm > 0 ? Math.fround((100 * q.fm) / tm) : 0;
  q.age = k.age0Years + d / 365.25;

  q.fastHMax = s.dayFastMaxH;
  let f7 = 0;
  let f7t4 = 0;
  for (let j = d < 6 ? 0 : d - 6; j <= d; j++) {
    f7 += s.fastedH[j]!;
    f7t4 += s.fastedT4H[j]!;
  }
  q.fastH7 = f7;
  q.fastH7Cap = f7 - f7t4;
  // 28-day balance over all days (surplus rules near a fast) and today's own planned balance (the 7-day deficit rules
  // attach only to days that are themselves in deficit: a day at 100 % after deficit days carries no deficit warning)
  let td28 = 0;
  for (let j = 1; j <= n28; j++) td28 += s.tdee28Ring[(s.idx28 - j + 2 * RING28) % RING28]!;
  q.def28 = td28 > 0 ? 100 * (1 - ei28 / td28) : Number.NaN;
  q.dayDeficit = q.ei < q.tdee * (1 - k.deficitAnyPct / 100);
  q.tier = fastTier(k, q.fastHMax);

  const floorBf = bfFloorPct(k, k.isFemale);
  q.capDef = deficitCapPct(k, q.bmi, q.age, q.bf, floorBf);
  q.capPct = rateCapPct(k, q.bmi, q.age, q.bf, floorBf, k.isFemale);

  // 7-day macro means over non-fast days too (a planned zero-intake day is not a low-protein / low-fat / low-fibre day)
  q.prot7 = fastToday ? Number.NaN : meanNonFast(s.protRing, s.fastRing, head, n7);
  q.fat7 = fastToday ? Number.NaN : meanNonFast(s.fatRing, s.fastRing, head, n7);
  q.fibre7 = fastToday ? Number.NaN : meanNonFast(s.fibreRing, s.fastRing, head, n7);
  const rw = referenceWeightKg(k, bw, k.heightM);
  q.protRw7 = rw > 0 ? Math.fround(q.prot7 / rw) : 0;
  q.protPctE7 = ei7 > 0 ? Math.fround((400 * q.prot7) / ei7) : Number.isNaN(ei7) ? Number.NaN : 0;
  q.protFfm7 = q.ffm > 0 ? Math.fround(q.prot7 / q.ffm) : 0;
  q.fat7 = Math.fround(q.fat7);
  q.fatPct7 = ei7 > 0 ? Math.fround((900 * q.fat7) / ei7) : Number.isNaN(ei7) ? Number.NaN : 0;
  q.fibreDens = ei7 > 0 ? Math.fround(q.fibre7 / (ei7 / 1000)) : 1e9;
  q.carb = s.dayCarbG;
  q.fat = s.dayFatG;
  q.alc7G = ringSum(s.alcRing, head, RING, n7, 0);
  q.rtDays7 = ringSum(s.rtRing, head, RING, n7, 0);

  // trace semantics (MODEL_SPEC §1.16, ruling 18:10): ei7 = the intake the HC-E1 floor applies to; tdee7/deficitPct7 over
  // non-fast days (NaN on fast-event days)
  tr.ei7[d] = q.eiFloor;
  tr.tdee7[d] = tdee7;
  tr.deficitPct7[d] = q.def7;
  tr.ea7[d] = q.ea7;
  tr.tissueMassKg[d] = q.tm;
  tr.rate14KgPerWk[d] = q.rate14Kg;
  tr.rate14PctPerWk[d] = q.rate14Pct;
  tr.cumLossPct[d] = q.cum;
  tr.bmi[d] = q.bmi;
  tr.bodyFatPct[d] = q.bf;
  tr.fastHMax[d] = q.fastHMax;
  tr.fastH7[d] = q.fastH7;
  tr.proteinGPerKgRw[d] = q.protRw7;
  tr.fatPctEnergy[d] = q.fatPct7;
  tr.hungerIdx[d] = bus.hungerIdx;
  // optional trace fields (always allocated by the core; hand-built traces in module test kits may omit them)
  if (tr.eee7) tr.eee7[d] = q.eee7;
  if (tr.fastDay) tr.fastDay[d] = fastToday ? 1 : 0;
  if (tr.ei28) tr.ei28[d] = q.ei28;
  if (tr.fastH7Cap) tr.fastH7Cap[d] = q.fastH7Cap;
  if (tr.deficitPct28) tr.deficitPct28[d] = q.def28;
}

export const safetyModule = defineModule<SafetyState, SafetyK>({
  id: 'safety',
  specSection: '§7, §1.16',
  dossiers: '17 §2-§4; 20 §9; 13 §9; 05 §9; all §9',
  params: SAFETY_PARAMS,
  reads: [
    'exEEKcalH',
    'exSessionNetKcalH',
    'exHardSession',
    'tissueMassKg',
    'scaleWeightKg',
    'fatMassKg',
    'ffmActKg',
    'labileWaterKg',
    'hoursSinceIntakeH',
    'fastActive',
    'fastHoursH',
    'bhbMmolL',
    'etohPoolG',
    'hungerIdx',
    'ketoInduction',
    'eaKcalKgFfm',
    'ea7KcalKgFfm',
    'maintenanceKcalD',
    'tdeeEstKcalD',
    'atKcalD',
    'tissueEnergyKcalH',
    'fedState',
    'hydrationDeficitKg',
    'fatFloorActive',
  ],
  writes: ['safetyAbort'],
  records: [],
  prepare: (ctx: ModuleContext): SafetyK => {
    const c = readSafetyConstants(ctx.params);
    const prof = ctx.profile;
    const f = prof.safety.flags;
    const habits = prof.habits;
    const isFemale = prof.sex === 'female';
    const edRisk = prof.safety.mode === 'R1' || f.eatingDisorderRisk === true;
    const drug = f.diabetesMedication;
    const diabetesDrug =
      drug === 'insulin' || drug === 'sulfonylurea' || drug === 'sglt2' || f.type1Diabetes === true;
    const pregnant = f.pregnantOrBreastfeeding === true;
    let markerShown = false;
    for (let i = 0; i < MARKER_SERIES.length; i++)
      if (ctx.seriesEnabled[MARKER_SERIES[i]!] === 1) markerShown = true;
    // ruling 18:10: fast-event days (≥ fastDayMinHours of the day in a planned span longer than T0, plus graded-refeed
    // days), days on which a span with a planned refeed ends (W-F08), and T3+ start hours (W-M19 pre-fast leg)
    const nDays = ctx.nDays;
    const fastDay = new Uint8Array(nDays);
    const plannedRefeedDay = new Uint8Array(nDays);
    const plannedNoRampDay = new Uint8Array(nDays);
    const cover = new Float64Array(nDays);
    const longStarts: number[] = [];
    const spanEnds: number[] = [];
    const spanM2m: number[] = [];
    const spanM2mDay = new Float64Array(nDays);
    const spans = ctx.schedule.fastSpans ?? [];
    const sDays = ctx.schedule.days ?? [];
    for (const sp of spans) {
      const m2m = sp.mealToMealH ?? sp.endHour - sp.startHour + 1;
      if (!(m2m > c.tierT0MaxH)) continue;
      spanEnds.push(sp.endHour);
      spanM2m.push(m2m);
      for (let h = sp.startHour; h < sp.endHour; h++) {
        const d = Math.floor(h / 24);
        if (d >= 0 && d < nDays) {
          cover[d] = cover[d]! + 1;
          if (m2m > spanM2mDay[d]!) spanM2mDay[d] = m2m;
        }
      }
      const endDay = Math.floor(sp.endHour / 24);
      if (sp.refeed === 'auto' && endDay >= 0 && endDay < nDays) plannedRefeedDay[endDay] = 1;
      else if (m2m >= c.refeedMinFastH && endDay >= 0 && endDay < nDays) {
        const next = sDays[endDay + 1];
        if (next === undefined || next.energyKcal > c.refeedFirstDayMaxFrac * prof.tdee0Kcal) plannedNoRampDay[endDay] = 1;
      }
      if (m2m > c.tierT2MaxH) longStarts.push(sp.startHour);
    }
    for (let d = 0; d < nDays; d++) {
      const day = sDays[d];
      if (cover[d]! >= c.fastDayMinHours || (day !== undefined && (day.refeedFactor ?? 1) < 1)) fastDay[d] = 1;
    }
    longStarts.sort((a, b) => a - b);
    const hIn = prof.input.habits ?? {};
    // planner early-abort bounds on SafetyTrace quantities (the core may hand them over as `ctx.abortOn`)
    const raw: readonly AbortBoundLike[] | undefined = ctx.abortOn;
    const bounds = (raw ?? []).filter((b) => ABORT_CODES[b.series] !== undefined);
    const abortCode = new Int8Array(bounds.length);
    const abortOp = new Int8Array(bounds.length);
    const abortValue = new Float64Array(bounds.length);
    bounds.forEach((b, i) => {
      abortCode[i] = ABORT_CODES[b.series]!;
      abortOp[i] = b.op === '<' ? 1 : 2;
      abortValue[i] = b.value;
    });
    return {
      ...c,
      isFemale,
      heightM: prof.heightM,
      age0Years: prof.ageYears,
      eventSink: ctx.events,
      trace: ctx.safetyTrace,
      warn: ctx.mode !== 'planner',
      pregnant,
      edRisk,
      diabetesDrug,
      ketoFedStrict: ketoFedStrict(f, c.ketoFedNeedsDiabetes),
      organFlag: f.cardiovascularOrBp === true || f.kidneyDisease === true || f.liverDisease === true,
      kidneyFlag: f.kidneyDisease === true,
      stoneGoutFlag: f.gout === true || f.kidneyStones === true || f.gallstones === true,
      medFlag: f.medicationInteraction === true,
      contraindKeto:
        pregnant ||
        diabetesDrug ||
        f.pancreatitis === true ||
        f.fatOxidationDisorderOrPorphyria === true ||
        edRisk,
      exerciseFlag: f.exerciseRestriction === true || f.faintingOrChestPain === true,
      hotFlag: f.hotClimate === true,
      kidneyStones: f.kidneyStones === true,
      novice: habits.trainingHistory === 'none' || habits.trainingHistory === 'lt1y',
      waistCm0: prof.body.circumferences.waistCm,
      whtr0: prof.body.whtr,
      bfFromSliders: prof.input.body.knownBodyFatPct === undefined && prof.input.body.sliders !== undefined,
      ageEnteredYears: prof.ageYears,
      markerShown,
      asiShown: ctx.seriesEnabled[SERIES_INDEX.autophagyIdx] === 1,
      fastDay,
      plannedRefeedDay,
      plannedNoRampDay,
      longFastStartH: Float64Array.from(longStarts),
      spanEndHour: Float64Array.from(spanEnds),
      spanM2mH: Float64Array.from(spanM2m),
      spanM2mDay,
      habSodiumMg: prof.habitualSodiumMg,
      habSodiumEntered: hIn.habitualSodiumG !== undefined,
      habFibreEntered: hIn.habitualFibreGPer1000Kcal !== undefined,
      bmiTm0: prof.weightKg / (prof.heightM * prof.heightM),
      abortCode,
      abortOp,
      abortValue,
    };
  },
  init: (k: SafetyK, ctx: ModuleContext): SafetyState =>
    newSafetyState(ctx.nDays, k.warn, ctx.profile.weightKg),

  stepHour: (
    s: SafetyState,
    k: SafetyK,
    bus: SignalBus,
    hour: HourInput,
    day: DayInput,
    clock: StepClock,
  ): void => {
    s.dayIntakeKcal += hour.kcal;
    s.dayProtG += hour.proteinG;
    s.dayFatG += hour.fatG;
    s.dayCarbG += hour.carbG;
    s.dayFibreG += hour.fibreG;
    s.dayAlcG += hour.alcoholG;
    s.dayEeeKcal += bus.exSessionNetKcalH;
    const fh = bus.hoursSinceIntakeH;
    if (fh > s.dayFastMaxH) s.dayFastMaxH = fh;
    if (hour.hourOfDay === wakeRecordHour(day.sleepWakeH)) s.dayWakeScaleKg = bus.scaleWeightKg;

    // fast episodes (counter beyond T0) and the fasted-hours ledger behind fastH_7
    const d = clock.day;
    if (d >= 0) {
      if (fh > k.tierT0MaxH) {
        if (s.fastRunH <= k.tierT0MaxH) {
          // the run just crossed T0: credit its earlier hours (counters 1 … fh−1) to the days they fall on
          const retro = fh - 1;
          const today = retro < hour.hourOfDay ? retro : hour.hourOfDay;
          s.fastedH[d] = s.fastedH[d]! + today;
          if (retro > today && d >= 1) s.fastedH[d - 1] = s.fastedH[d - 1]! + (retro - today);
          s.epActive = 1;
          // the fast's own days start with its first zero-intake hour (blocker round 2026-10-01: was the day the
          // counter crossed T0 — a fast from a 19:00 dinner on day 7 was reported from day 8)
          const first = Math.floor((clock.hourIndex - fh + 1) / 24);
          s.epStartDay = first > 0 ? first : 0;
          s.epMaxH = fh;
          s.epNoElecCur = 0;
        }
        s.fastedH[d] = s.fastedH[d]! + 1;
        s.epLastDay = d;
        if (fh > s.epMaxH) s.epMaxH = fh;
        // R-T4CAP: once the episode passes T3 it is an expert-tier fast governed by its own tier rule; its hours (all of
        // them, retroactively) leave the 108-h cumulative cap
        if (fh > k.tierT3MaxH) {
          if (s.epT4 === 0) {
            s.epT4 = 1;
            const lo = s.epStartDay < 0 ? 0 : s.epStartDay;
            for (let j = lo; j < d; j++) s.fastedT4H[j] = s.fastedH[j]!;
            s.fastedT4H[d] = s.fastedH[d]!;
          } else s.fastedT4H[d] = s.fastedT4H[d]! + 1;
        }
      } else if (s.epActive === 1 && fh < s.fastRunH) {
        closeEpisode(s, k, s.fastRunH, clock.hourIndex, true, plannedMealToMealH(k, clock.hourIndex, s.fastRunH));
        s.epT4 = 0;
      }
    }
    s.fastRunH = fh;

    // intake-side flags
    if (hour.caffeineMg > 0) {
      s.dayCaffMg += hour.caffeineMg;
      if (hour.caffeineMg > s.dayCaffDoseMaxMg) s.dayCaffDoseMaxMg = hour.caffeineMg;
      let toBed = day.sleepBedH - hour.hourOfDay;
      if (toBed <= 0) toBed += 24;
      if (toBed <= k.caffeineBedWindowH) s.dayCaffBedMg += hour.caffeineMg;
    }
    // W-M19 "within 24 h of a T3+ fast": after one (post-fast leg) or before a planned one (pre-fast leg)
    if (hour.alcoholG > 0) {
      if (s.hoursSinceLongEnd <= 24) s.dayAlcAfterLong = 1;
      const starts = k.longFastStartH;
      while (s.nextLongIdx < starts.length && starts[s.nextLongIdx]! < clock.hourIndex) s.nextLongIdx++;
      if (s.nextLongIdx < starts.length && starts[s.nextLongIdx]! - clock.hourIndex <= 24) s.dayAlcAfterLong = 1;
    }
    s.hoursSinceLongEnd += 1;
    s.hoursSinceFastEnd += 1;
    if (
      hour.plannedFast === 1 &&
      hour.electrolytes === 0 &&
      fh >= k.electrolyteFastH &&
      fh > s.dayNoElecFastH
    )
      s.dayNoElecFastH = fh;
    if (hour.plannedFast === 1 && hour.electrolytes === 0 && s.epActive === 1) s.epNoElecCur = 1;

    // exercise flags
    if (bus.exHardSession === 1) {
      if (fh >= k.hardFastH && fh > s.dayHardInFastH) s.dayHardInFastH = fh;
      if (k.hardIntensityFrac > s.dayVigorousFrac) s.dayVigorousFrac = k.hardIntensityFrac;
    }
    if (
      hour.exMin > 0 &&
      hour.exIntensityFrac >= k.vigorousIntensityFrac &&
      hour.exIntensityFrac > s.dayVigorousFrac
    ) {
      s.dayVigorousFrac = hour.exIntensityFrac;
    }

    // composition's smooth fat floor engaged (review M9, R-FATFLOOR): `fatFloorActive` > 0 in any hour of the day
    if (bus.fatFloorActive > 0) {
      const fm = bus.fatMassKg;
      if (fm < s.dayFatFloorFmKg) s.dayFatFloorFmKg = fm;
    }

    // ketones WHILE EATING (05 §9, MODEL_SPEC §7.2 W-05-KETO-FED): only absorptive hours outside the fasting regime count
    // (fasting and zero-intake hours are never "eating", final round 2026-09-30: a 72-h fast with a training session was
    // flagged "while eating" by the former any-time > 6 mM leg). Ruling R-FAST-GATE (2026-10-01): the rule is the DKA
    // warning sign its text names, so it applies to people with diabetes (any treatment, 05 §9 "known diabetes") and in
    // pregnancy/breastfeeding (lactation ketoacidosis) — `ketoFedStrict`; nutritional and post-fast ketosis in everyone
    // else is not that sign (05 §8 item 8). For them the whole refeed phase after a fast longer than T0
    // (`ketoFedRefeedWindowH` from the first intake, and every planned graded-refeed day) is starvation ketosis (05 §9
    // "intake < 500 kcal/day history"): only BHB > 6.0 counts there.
    const bhb = bus.bhbMmolL;
    if (k.ketoFedStrict && bus.fedState === 1 && bus.fastActive < 0.5) {
      const refeed = s.hoursSinceFastEnd <= k.ketoFedRefeedWindowH || (d >= 0 && d < k.fastDay.length && k.fastDay[d] === 1);
      const thr = refeed ? k.ketoAnyBhb : k.ketoFedBhb;
      if (bhb > thr && bhb > s.dayKetoFedBhb) s.dayKetoFedBhb = bhb;
    }
  },

  endOfDay: (s: SafetyState, k: SafetyK, bus: SignalBus, day: DayInput, clock: StepClock): void => {
    const d = clock.day;
    const i0 = s.ringIdx;
    s.dayTeeKcal = bus.tdeeEstKcalD;
    s.eiRing[i0] = s.dayIntakeKcal;
    s.tdeeRing[i0] = s.dayTeeKcal;
    s.tmRing[i0] = bus.tissueMassKg;
    s.eeeRing[i0] = s.dayEeeKcal;
    s.protRing[i0] = s.dayProtG;
    s.fatRing[i0] = s.dayFatG;
    s.fibreRing[i0] = s.dayFibreG;
    s.alcRing[i0] = s.dayAlcG;
    s.fastRing[i0] = d >= 0 && d < k.fastDay.length ? k.fastDay[d]! : 0;
    let rt = 0;
    let run = 0;
    const base = i0 * N_REG;
    for (let r = 0; r < N_REG; r++) s.setsRing[base + r] = 0;
    for (let i = 0; i < day.nSessions; i++) {
      const se = day.sessions[i]!;
      if (se.kind === 'resistance') {
        rt = 1;
        for (let r = 0; r < N_REG; r++) s.setsRing[base + r] = s.setsRing[base + r]! + se.setsByRegion[r]!;
      } else if (se.modality === RUN_MODALITY) {
        run += se.durationMin;
      }
    }
    s.rtRing[i0] = rt;
    s.runRing[i0] = run;
    s.ringIdx = (i0 + 1) % RING;
    const j0 = s.idx28;
    s.ei28Ring[j0] = s.dayIntakeKcal;
    s.tdee28Ring[j0] = s.dayTeeKcal;
    s.tm28Ring[j0] = bus.tissueMassKg;
    s.fast28Ring[j0] = d >= 0 && d < k.fastDay.length ? k.fastDay[d]! : 0;
    // daily EA sample (17 §2.1 EA = (EI − EEE)/FFM; clipped like wellbeing's EA_7 samples, 19 §5) for EA_7 over non-fast days
    const ffmD = bus.ffmActKg;
    const eaD = (s.dayIntakeKcal - s.dayEeeKcal) / (ffmD > 1 ? ffmD : 1);
    s.ea28Ring[j0] = eaD < k.eaSampleMin ? k.eaSampleMin : eaD > k.eaSampleMax ? k.eaSampleMax : eaD;
    s.idx28 = (j0 + 1) % RING28;
    if (s.seen28 < 1e9) s.seen28++;
    if (s.daysSeen < 1e9) s.daysSeen++;
    if (d < 0) {
      // burn-in: prime the rings only (no outputs, no counters)
      resetDay(s);
      return;
    }
    computeDay(s, k, bus, d);
    s.lastDay = d;
    if (s.warn) {
      recordOwnDay(s, k, d, referenceWeightKg(k, s.q.bw, k.heightM));
      evaluateDay(s, k, day, d);
    }
    // planner early abort on SafetyTrace quantities
    const nb = k.abortCode.length;
    for (let b = 0; b < nb; b++) {
      const v = traceValue(k, k.abortCode[b]!, d);
      if (k.abortOp[b] === 1 ? v < k.abortValue[b]! : v > k.abortValue[b]!) bus.safetyAbort = 1;
    }
    resetDay(s);
  },

  /**
   * End of burn-in (MODEL_SPEC §3.4): energy calibrated NEAT0 so the habitual week's mean TEE equals the habitual intake,
   * and composition reset tissue mass to the entered weight — the burn-in entries of the trailing rings were written before
   * both, so shift the TDEE entries by the calibration offset (keeping the weekday pattern) and re-level the tissue-mass
   * rings. Otherwise day 0-6 read a spurious 5-7 % surplus or deficit and a rate from the reset step.
   */
  endBurnIn: (s: SafetyState, _k: SafetyK, bus: SignalBus): void => {
    const n = s.seen28 < 7 ? s.seen28 : 7;
    if (n > 0) {
      let ei = 0;
      let td = 0;
      for (let j = 1; j <= n; j++) {
        const i = (s.idx28 - j + 2 * RING28) % RING28;
        ei += s.ei28Ring[i]!;
        td += s.tdee28Ring[i]!;
      }
      const delta = (ei - td) / n;
      for (let i = 0; i < RING28; i++) s.tdee28Ring[i] = s.tdee28Ring[i]! + delta;
      for (let i = 0; i < RING; i++) s.tdeeRing[i] = s.tdeeRing[i]! + delta;
    }
    const tm = bus.tissueMassKg;
    if (tm > 0) {
      s.tmRing.fill(tm);
      s.tm28Ring.fill(tm);
      s.tm0 = tm;
    }
  },

  finalize: (s: SafetyState, k: SafetyK, sink: FinalizeSink): void => {
    if (!s.warn || s.lastDay < 0) return;
    if (s.epActive === 1) closeEpisode(s, k, s.fastRunH, (s.lastDay + 1) * 24, false, plannedMealToMealH(k, (s.lastDay + 1) * 24, s.fastRunH));
    for (let d = 0; d <= s.lastDay; d++) {
      const t = s.fastTierDay[d]!;
      // the tier rules report the meal-to-meal duration of a planned fast (the unit the user entered), else the counter
      const m2m = k.spanM2mDay[d]!;
      const cnt = k.trace.fastHMax[d]!;
      if (t >= 1) setHit(s, F_TIER_RULES[t - 1]!, d, m2m > cnt ? m2m : cnt);
    }
    // per-fast rules over the fast's own days (blocker round 2026-10-01: they were stamped only from the hour the counter
    // passed 48 h): W-F11 / W-F10 / W-20-FAST-LEAN for fasts ≥ T3, W-F06 for fasts ≥ 48 h with unplanned electrolytes
    for (let e = 0; e < s.nEp; e++) {
      const lenH = s.epLog[3 * e + 2]!;
      const d0 = Math.max(0, Math.floor((s.epLog[3 * e]! + 1) / 24));
      const d1 = Math.min(s.lastDay, Math.floor((s.epLog[3 * e + 1]! - 1) / 24));
      const longFast = fastTier(k, lenH) >= 3;
      const noElec = s.epNoElec[e] === 1 && lenH >= k.electrolyteFastH;
      if (!longFast && !noElec) continue;
      const bfLim = (k.isFemale ? k.bfFloorFemale : k.bfFloorMale) + k.leanFastMarginPts;
      for (let d = d0; d <= d1; d++) {
        if (noElec) setHitWorst(s, X['W-F06'], d, lenH);
        if (!longFast) continue;
        setHitWorst(s, X['W-F11'], d, lenH);
        if (k.trace.bmi[d]! < k.t3BmiMax) setHitWorst(s, X['W-F10'], d, lenH);
        const bf = k.trace.bodyFatPct[d]!;
        if (bf < bfLim) setHitWorst(s, X['W-20-FAST-LEAN'], d, bf);
      }
    }
    exclusiveBands(s);
    const warnings = buildWarnings(s, k);
    // one `safetyFlag` per first day of caution/danger runs (value = the worst severity starting that day: 2 danger,
    // 1 caution); safety is the only emitter (R-FATFLOOR, §7.1)
    let lastDay = -1;
    let lastSev = 0;
    for (let i = 0; i < warnings.length; i++) {
      const w = warnings[i]!;
      sink.warnings.push(w);
      if (w.severity === 'info') continue;
      const sev = w.severity === 'danger' ? 2 : 1;
      if (w.startDay !== lastDay) {
        if (lastDay >= 0) k.eventSink.emit('safetyFlag', lastDay * 24, lastSev);
        lastDay = w.startDay;
        lastSev = sev;
      } else if (sev > lastSev) lastSev = sev;
    }
    if (lastDay >= 0) k.eventSink.emit('safetyFlag', lastDay * 24, lastSev);
  },
});
