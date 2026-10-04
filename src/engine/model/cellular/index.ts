/**
 * MODULE cellular — Autophagy Signal Index (ASI), muscle mTORC1 index, muscle AMPK index.
 * Spec: docs/MODEL_SPEC.md §1.13 · Dossier: 08 §4.3-4.11 (owner). IGF-1 lives in the hormones module (08 §4.12).
 * Owned files: src/engine/model/cellular/** only.
 *
 * MANDATORY CAVEAT (08 §4.10, W-U05): the ASI is a PROPOSED, relative, conditions-based 0-100 index (evidence grade
 * C/D). It encodes WHEN the conditions linked to autophagy are present (no recent protein or sugar, low insulin,
 * depleted liver glycogen, rising ENDOGENOUS ketones, recent hard exercise), not how much autophagy occurs, in which
 * tissue, or whether it helps health. It is never traded against grade A/B goals (08 §4.15). No compound raises it:
 * only `bhbEndoMmolL` (endogenous BHB) enters the depth term, so exogenous ketones, ketone esters and MCT-derived
 * excess cannot move the index (ruling R-ASI). The mandatory statement is the `caveat` of the `autophagyIdx` series.
 *
 * Hourly algorithm (stepHour, after muscle and ketones; hour-end values, Δt = 1 h):
 *  1. hFast = `hoursSinceMealH` (intake owns the 08 reset rule: protein ≥ 10 g or net carbohydrate ≥ 15 g).
 *  2. S = 1 − (1 − wAa·S_aa)(1 − wIns·S_ins), S_aa from the leucine fold dL = raAaQGH/(k·FFM), S_ins from
 *     dI = max(0, insulinUuMl − insulinBasalUuMl) (intake's basal insulin: Ins_f × the 05 liver-glycogen factor, no meal
 *     excursions; 08 §4.4 "insulinFastingBasal").
 *  3. F = wC·F_clock + wG·F_glyc + wK·F_ket (clock, liver-glycogen depletion vs the 12-h reference, endogenous BHB).
 *  4. ASI = clamp(100(1 − S)(B0 + (1 − B0)F) + A_ex·min(1.5, xEx) + asi_CR, 0, 100); B0 makes ASI(12 h) = 25.
 *  5. mTORC1 index (08 §4.11) and AMPK index (08 §4.6) — display-only: skipped when neither series is recorded.
 * Daily (endOfDay): chronic-deficit EMA cDef → asi_CR (08 §4.9).
 * Baseline (MODEL_SPEC §3.4): the person's 12-h post-absorptive liver glycogen G_L,12h and endogenous BHB are sampled on
 * the last habitual burn-in week (at the hFast = 12 h crossing; when the habitual overnight fast ends before 12 h, the
 * last hour's trend is extrapolated to 12 h) and latched with B0 in `endBurnIn`.
 * No feedback into energy balance or body composition (08 §5).
 */
import { defineModule } from '../../core/moduleKit';
import { clamp, clamp01, decayFactor } from '../../core/math';
import { param } from '../../core/paramsRegistry';
import { MI, SERIES_INDEX } from '../../types/metrics';
import type { DayInput, HourInput } from '../../types/inputs';
import type { MetricFrame, ModuleContext, StepClock } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import { CELLULAR_PARAMS } from './params';

export { CELLULAR_PARAMS } from './params';
export { ASI_BANDS, ASI_DEEP_THRESHOLD, asiLabel } from './labels';

export interface CellularState {
  /** Amino-acid suppression S_aa (0..1, raw Hill, before the wAa weight) — this hour. */
  sAa: number;
  /** Insulin suppression S_ins (0..1, raw Hill, before the wIns weight) — this hour. */
  sIns: number;
  /** Exercise autophagy pulse sum xEx (dimensionless, 0..~2; τEx 3 h; hour-end value). */
  xEx: number;
  /** AMPK exercise pulse (0..1.3 × fI_ampk; τA 1 h; hour-end value). */
  ampkPulse: number;
  /** Chronic-deficit EMA cDef (fraction of maintenance, 0..1, τCR 7 d, evaluated daily). */
  cDef: number;
  /** Calibrated B0 (ASI = 25 at hFast = 12 h, 08 §4.10 step 4). */
  b0: number;
  /** Autophagy Signal Index, relative 0..100 (headline, grade C/D). */
  asi: number;
  /** Muscle-specific ASI view (A_ex_m weight), 0..100. */
  asiMuscle: number;
  /** Muscle mTORC1 activity index, 0..100. */
  mtor: number;
  /** Muscle AMPK (α2) activity index, 0..100. */
  ampk: number;
  /** Combined nutrient suppression S = 1 − (1 − wAa·S_aa)(1 − wIns·S_ins), 0..1. */
  sNut: number;
  /** Leucine fold above post-absorptive dL (≥ 0). */
  leucineFold: number;
  /** Fasting-depth terms this hour: F_clock, F_glyc, F_ket (each 0..1) and F = wC·F_clock + wG·F_glyc + wK·F_ket. */
  fClock: number;
  fGlyc: number;
  fKet: number;
  fDepth: number;
  /** Chronic-restriction contribution asi_CR, index points (updated daily). */
  asiCr: number;
  /** Basal (fasting) insulin of this hour as written by intake (`insulinBasalUuMl`), µU/mL; last finite value is kept. */
  insBasalUuMl: number;
  /** Person's 12-h post-absorptive references from the habitual burn-in week: liver glycogen (g), endogenous BHB (mmol/L). */
  liverRef12G: number;
  /** 1/liverRef12G (hot-path reciprocal, kept in step with liverRef12G). */
  invLiverRef12: number;
  bhbRef12MmolL: number;
  /** 1 once B0 and the 12-h references have been latched (`endBurnIn`, or the first real day without it). */
  calibrated: number;
  /** Burn-in 12-h samples of the last habitual week: Σ G_L (g), Σ BHB_endo (mmol/L), number of samples. */
  refSumG: number;
  refSumBhb: number;
  refN: number;
  /** The previous two burn-in hours: hFast (h), liver glycogen (g), endogenous BHB (mmol/L) — crossing / extrapolation. */
  prevH: number;
  prevG: number;
  prevBhb: number;
  prev2H: number;
  prev2G: number;
  prev2Bhb: number;
  /** Finished-bout pulse residue (decays with τEx), active cardio bout (minutes, Σ intensity·minutes, amplitude, contribution). */
  xOld: number;
  boutMin: number;
  boutIntSum: number;
  boutAmp: number;
  boutContrib: number;
  /** Active resistance bout: cumulative sets, amplitude, contribution. */
  rtSetsCum: number;
  rtAmpCur: number;
  rtContrib: number;
}

/** Constants copied from the registry in prepare(); decay factors precomputed (Δt = 1 h). */
export interface CellularK {
  ec50LPow: number;
  nL: number;
  nLIs15: boolean;
  wAa: number;
  aaRefKgFfmH: number;
  ec50IPow: number;
  nI: number;
  nIIs15: boolean;
  wIns: number;
  h50Pow: number;
  nh: number;
  nhIs2: boolean;
  wClock: number;
  wGlyc: number;
  wKet: number;
  kBhb2: number;
  asiRef12: number;
  bhbRef12Prior: number;
  liverRef12Frac: number;
  aEx: number;
  aExMuscle: number;
  fEx: number;
  tauEx: number;
  exFloor: number;
  exFull: number;
  durRefMin: number;
  durCap: number;
  xExCap: number;
  mT: number;
  rtAmp: number;
  rtSetsFull: number;
  mRt: number;
  aCR: number;
  fDayCR: number;
  cDefFull: number;
  ampkA0: number;
  ampkAEx: number;
  ampkThr: number;
  ampkFull: number;
  ampkCap: number;
  fA: number;
  tauA: number;
  gGly: number;
  fFast: number;
  ampkRtAmp: number;
  gNormDw: number;
  gDeplDw: number;
  /** G_norm/(G_norm − G_depl): dGly = (1 − muscleGlycogenRel)·dGlyScale (precomputed). */
  dGlyScale: number;
  mtorBase0: number;
  mtorFall: number;
  kRE: number;
  mtorInsPerm: number;
  /** Nominal B0 from the parameter prior (used until the burn-in references finalise it). */
  b0Nominal: number;
  /** Compute the display-only mTORC1 / AMPK indices (false when neither series is recorded, e.g. planner mode). */
  doSignalling: boolean;
}

/**
 * 12-h reference sampling (structural constants, MODEL_SPEC §3.4): the reference hour (08 §4.5 G_ref12, §4.10 step 4),
 * the burn-in days that count (the last habitual week), and the shortest overnight fast (h) whose last-hour trend is
 * extrapolated to 12 h when a habitual meal ends it before 12 h (3 meals 08:00-20:00 reach hFast = 11 h).
 */
const REF_HOURS = 12;
const REF_WEEK_DAYS = 7;
const REF_MIN_H = 6;
/** Floor of the liver-glycogen reference (g): keeps the reciprocal physical. */
const MIN_LIVER_REF = 1;
/** "No previous burn-in hour yet" marker for the crossing detector (h). */
const NO_PREV_H = 1e6;
/** Series indices resolved once at load (the catalogue index object is large: no per-hour lookups). */
const I_ASI = MI.autophagyIdx;
const I_MTOR = MI.mtorIdx;
const I_AMPK = MI.ampkIdx;
const SI_MTOR = SERIES_INDEX.mtorIdx;
const SI_AMPK = SERIES_INDEX.ampkIdx;
/** Upper bound of the `mpsStimWb` signal (0..1.6, §4). */
const MAX_MPS_STIM = 1.6;

const fin = (x: number, d: number): number => (Number.isFinite(x) ? x : d);

/** x^n/(k^n + x^n) for x ≥ 0 with the constant k^n precomputed; exponent 1.5 uses x·√x instead of Math.pow. */
function hillPre(x: number, n: number, is15: boolean, kn: number): number {
  if (x <= 0) return 0;
  const xn = is15 ? x * Math.sqrt(x) : Math.pow(x, n);
  return xn / (kn + xn);
}

/** F_clock = h^nh/(h^nh + h50^nh); nh = 2 fast path. */
function clockDrive(k: CellularK, hFast: number): number {
  if (hFast <= 0) return 0;
  const hn = k.nhIs2 ? hFast * hFast : Math.pow(hFast, k.nh);
  return hn / (hn + k.h50Pow);
}

/** B0 = (0.25 − F12)/(1 − F12) with F12 = wC·F_clock(12) + wG·0 + wK·F_ket(bhb at 12 h): ASI(12 h) = 25 by construction (08 §4.10). */
export function calibrateB0(k: CellularK, bhbRef12: number): number {
  const b = Math.max(0, bhbRef12);
  const f12 = k.wClock * clockDrive(k, REF_HOURS) + k.wKet * ((b * b) / (b * b + k.kBhb2));
  const target = k.asiRef12 / 100;
  return clamp((target - f12) / (1 - f12), 0, 0.95);
}

function prepare(ctx: ModuleContext): CellularK {
  const p = ctx.params;
  const g = (name: string): number => param(p, `cellular.${name}`);
  const nL = g('nL');
  const nI = g('nI');
  const nh = g('nh');
  const wSum = g('wClock') + g('wGlyc') + g('wKet');
  const habits = ctx.profile.habits;
  const trained = habits.trainingHistory !== 'none';
  const enduranceTrained =
    (habits.trainingHistory === '1to3y' || habits.trainingHistory === 'gt3y') && habits.sessionsPerWeek >= 4 && habits.lifingCardioMix >= 0.5;
  const mT = !trained ? g('mTUntrained') : enduranceTrained ? g('mTEndurance') : g('mTRecreational');
  const k: CellularK = {
    ec50LPow: Math.pow(g('ec50L'), nL),
    nL,
    nLIs15: nL === 1.5,
    wAa: g('wAa'),
    aaRefKgFfmH: g('aaRefKgFfmH'),
    ec50IPow: Math.pow(g('ec50I'), nI),
    nI,
    nIIs15: nI === 1.5,
    wIns: g('wIns'),
    h50Pow: Math.pow(g('h50'), nh),
    nh,
    nhIs2: nh === 2,
    wClock: g('wClock') / wSum,
    wGlyc: g('wGlyc') / wSum,
    wKet: g('wKet') / wSum,
    kBhb2: g('kBhb') * g('kBhb'),
    asiRef12: g('asiRef12'),
    bhbRef12Prior: g('bhbRef12'),
    liverRef12Frac: g('liverRef12Frac'),
    aEx: g('aEx'),
    aExMuscle: g('aExMuscle'),
    fEx: decayFactor(1, g('tauEx')),
    tauEx: g('tauEx'),
    exFloor: g('exFloor'),
    exFull: Math.max(g('exFull'), g('exFloor') + 0.05),
    durRefMin: g('durRefMin'),
    durCap: g('durCap'),
    xExCap: g('xExCap'),
    mT,
    rtAmp: g('rtAmp'),
    rtSetsFull: g('rtSetsFull'),
    mRt: trained ? g('rtTrainedMult') : 1,
    aCR: g('aCR'),
    fDayCR: decayFactor(1, g('tauCR')),
    cDefFull: g('cDefFull'),
    ampkA0: g('ampkA0'),
    ampkAEx: g('ampkAEx'),
    ampkThr: g('ampkThr'),
    ampkFull: Math.max(g('ampkFull'), g('ampkThr') + 0.05),
    ampkCap: g('ampkCap'),
    fA: decayFactor(1, g('tauA')),
    tauA: g('tauA'),
    gGly: g('gGly'),
    fFast: g('fFast'),
    ampkRtAmp: g('ampkRtAmp'),
    gNormDw: g('gNormDw'),
    gDeplDw: g('gDeplDw'),
    dGlyScale: g('gNormDw') / (g('gNormDw') - g('gDeplDw')),
    mtorBase0: g('mtorBase0'),
    mtorFall: g('mtorFall'),
    kRE: g('kRE'),
    mtorInsPerm: g('mtorInsPerm'),
    b0Nominal: 0,
    // test rigs pass an empty `seriesEnabled` (undefined entries) → treated as recorded
    doSignalling: ctx.seriesEnabled[SI_MTOR] !== 0 || ctx.seriesEnabled[SI_AMPK] !== 0,
  };
  // recomputed for every parameter draw (08 §4.10 "Re-calibrate B0 per draw")
  k.b0Nominal = calibrateB0(k, k.bhbRef12Prior);
  return k;
}

/**
 * Suppression, depth, ASI, mTORC1 and AMPK for the current values (no exercise-state update). Signals that only
 * matter in some hours (`ffmActKg` when amino acids appear, `mpsStimWb` when the acute mTORC1 term is > 0) are read
 * lazily: bus access is the dominant per-hour cost of a module.
 */
function computeIndices(s: CellularState, k: CellularK, bus: SignalBus, hFast: number, raAaQ: number, ins: number, gLiver: number, bhb: number): void {
  // --- suppression S (08 §4.3-4.4)
  let dL = 0;
  if (raAaQ > 0) {
    const ffm = fin(bus.ffmActKg, 60);
    dL = raAaQ / (k.aaRefKgFfmH * (ffm > 1 ? ffm : 1));
  }
  s.leucineFold = dL;
  s.sAa = hillPre(dL, k.nL, k.nLIs15, k.ec50LPow);
  s.sIns = hillPre(ins - s.insBasalUuMl, k.nI, k.nIIs15, k.ec50IPow); // dI = max(0, insulin − intake's basal)
  s.sNut = 1 - (1 - k.wAa * s.sAa) * (1 - k.wIns * s.sIns);

  // --- depth F (08 §4.5)
  const fClock = clockDrive(k, hFast);
  const gl = 1 - gLiver * s.invLiverRef12;
  s.fClock = fClock;
  s.fGlyc = gl < 0 ? 0 : gl > 1 ? 1 : gl;
  s.fKet = (bhb * bhb) / (bhb * bhb + k.kBhb2);
  s.fDepth = k.wClock * fClock + k.wGlyc * s.fGlyc + k.wKet * s.fKet;

  // --- ASI (08 §4.10 step 4)
  const core = 100 * (1 - s.sNut) * (s.b0 + (1 - s.b0) * s.fDepth);
  const pulse = s.xEx < k.xExCap ? s.xEx : k.xExCap;
  const asi = core + k.aEx * pulse + s.asiCr;
  const asiM = core + k.aExMuscle * pulse + s.asiCr;
  s.asi = asi < 0 ? 0 : asi > 100 ? 100 : asi;
  s.asiMuscle = asiM < 0 ? 0 : asiM > 100 ? 100 : asiM;

  if (!k.doSignalling) return;

  // --- mTORC1 index (08 §4.11); reSens = mpsStimWb only matters when the acute term is non-zero
  const mBase = k.mtorBase0 * (1 - k.mtorFall * fClock);
  const mAcute = s.sAa * (1 - k.mtorInsPerm + k.mtorInsPerm * s.sIns);
  let boost = 1;
  if (mAcute > 0) boost = 1 + k.kRE * clamp(fin(bus.mpsStimWb, 0), 0, MAX_MPS_STIM);
  const m = mBase + (1 - mBase) * mAcute * boost;
  s.mtor = 100 * (m < 0 ? 0 : m > 1 ? 1 : m);

  // --- AMPK index (08 §4.6): dGly from the relative muscle glycogen, G_musc = rel·G_norm
  const dg = (1 - fin(bus.muscleGlycogenRel, 1)) * k.dGlyScale;
  const dGly = dg < 0 ? 0 : dg > 1 ? 1 : dg;
  const a = k.ampkA0 * (1 + k.gGly * dGly) * (1 - k.fFast * fClock) + k.ampkAEx * s.ampkPulse;
  s.ampk = 100 * (a < 0 ? 0 : a > 1 ? 1 : a);
}

/**
 * Burn-in only (MODEL_SPEC §3.4): collect the person's 12-h post-absorptive liver glycogen and endogenous BHB on the
 * habitual days. A sample is taken where hFast crosses 12 h (linear interpolation inside the hour); when a habitual meal
 * resets the clock after ≥ REF_MIN_H but before 12 h, the last hour's trend is extrapolated to 12 h (liver glycogen can
 * only fall and BHB only rise over that span). Only the last habitual week's samples count (`inWeek`).
 */
function sampleReference(s: CellularState, hFast: number, g: number, b: number, inWeek: boolean): void {
  const ph = s.prevH;
  let sg = -1;
  let sb = 0;
  if (ph < REF_HOURS && hFast >= REF_HOURS && hFast - ph <= 1.5) {
    const w = (REF_HOURS - ph) / (hFast - ph);
    sg = s.prevG + w * (g - s.prevG);
    sb = s.prevBhb + w * (b - s.prevBhb);
  } else if (hFast < ph && ph < REF_HOURS && ph >= REF_MIN_H) {
    const dh = ph - s.prev2H;
    const x = REF_HOURS - ph;
    const slopeG = dh > 0 && dh <= 1.5 ? (s.prevG - s.prev2G) / dh : 0;
    const slopeB = dh > 0 && dh <= 1.5 ? (s.prevBhb - s.prev2Bhb) / dh : 0;
    sg = s.prevG + x * (slopeG < 0 ? slopeG : 0);
    sb = s.prevBhb + x * (slopeB > 0 ? slopeB : 0);
  }
  if (inWeek && sg >= 0) {
    s.refSumG += sg;
    s.refSumBhb += sb > 0 ? sb : 0;
    s.refN += 1;
  }
  s.prev2H = ph;
  s.prev2G = s.prevG;
  s.prev2Bhb = s.prevBhb;
  s.prevH = hFast;
  s.prevG = g;
  s.prevBhb = b;
}

/** Latch the 12-h references (mean of the habitual-week samples; priors when there were none) and calibrate B0 on them. */
function finaliseReferences(s: CellularState, k: CellularK): void {
  if (s.refN > 0) {
    s.liverRef12G = s.refSumG / s.refN;
    s.bhbRef12MmolL = s.refSumBhb / s.refN;
  }
  if (!(s.liverRef12G > MIN_LIVER_REF)) s.liverRef12G = MIN_LIVER_REF;
  s.invLiverRef12 = 1 / s.liverRef12G;
  s.b0 = calibrateB0(k, s.bhbRef12MmolL);
  s.calibrated = 1;
}

/**
 * Exercise pulses (08 §4.8, §4.6), hour-end values. A bout is a run of consecutive exercising hours: its amplitude is
 * held while it lasts (amplitude grows with the cumulative duration through fD) and decays once it ends.
 * Within an exercising hour the bout is assumed centred, so the value at hour end has decayed for (60 − m)/2 minutes.
 */
function updateExercise(s: CellularState, k: CellularK, bus: SignalBus, hour: HourInput): void {
  s.xOld *= k.fEx;
  s.ampkPulse *= k.fA;

  // resistance bout (sets started this hour)
  const rtSets = hour.rtSetsTotal;
  if (rtSets > 0) {
    s.rtSetsCum += rtSets;
    const share = Math.min(1, s.rtSetsCum / k.rtSetsFull);
    const a = k.rtAmp * share * k.mRt;
    if (a > s.rtAmpCur) s.rtAmpCur = a;
    s.rtContrib = s.rtAmpCur;
    const p = k.ampkRtAmp * share;
    if (p > s.ampkPulse) s.ampkPulse = p;
  } else if (s.rtSetsCum > 0) {
    s.xOld += s.rtContrib * k.fEx;
    s.rtSetsCum = 0;
    s.rtAmpCur = 0;
    s.rtContrib = 0;
  }

  // endurance / cardio bout (modality 0 = resistance or none, never an endurance pulse)
  // exMinutesH is derived by activity from this hour's exercise input: no bus read in the (common) hours without exercise
  const exMin = hour.exMin > 0 ? fin(bus.exMinutesH, 0) : 0;
  if (rtSets === 0 && exMin > 0 && hour.exModality !== 0) {
    const m = exMin > 60 ? 60 : exMin;
    const inten = fin(bus.exIntensityFrac, 0);
    s.boutMin += m;
    s.boutIntSum += inten * m;
    const ibar = s.boutIntSum / s.boutMin;
    const fI = clamp01((ibar - k.exFloor) / (k.exFull - k.exFloor));
    const fD = Math.min(k.durCap, Math.sqrt(s.boutMin / k.durRefMin));
    const a = fI * fD * k.mT;
    if (a > s.boutAmp) s.boutAmp = a;
    const gEx = m >= 60 ? 1 : Math.exp(-(60 - m) / (120 * k.tauEx));
    s.boutContrib = s.boutAmp * gEx;
    // AMPK: fI_ampk from this hour's intensity, pulse held during the bout, decays with τA after it
    const fIa = clamp((inten - k.ampkThr) / (k.ampkFull - k.ampkThr), 0, k.ampkCap);
    const gA = m >= 60 ? 1 : Math.exp(-(60 - m) / (120 * k.tauA));
    const pa = fIa * gA;
    if (pa > s.ampkPulse) s.ampkPulse = pa;
  } else if (s.boutMin > 0) {
    s.xOld += s.boutContrib * k.fEx;
    s.boutMin = 0;
    s.boutIntSum = 0;
    s.boutAmp = 0;
    s.boutContrib = 0;
  }
  s.xEx = s.xOld + s.boutContrib + s.rtContrib;
}

/** Evaluate the indices on the current bus values without advancing the exercise pulses (init, end of burn-in). */
function refresh(s: CellularState, k: CellularK, bus: SignalBus): void {
  const basal = bus.insulinBasalUuMl;
  if (basal > 0 && basal < Infinity) s.insBasalUuMl = basal;
  computeIndices(
    s, k, bus, Math.max(0, fin(bus.hoursSinceMealH, 12)), Math.max(0, fin(bus.raAaQGH, 0)), Math.max(0, fin(bus.insulinUuMl, s.insBasalUuMl)),
    Math.max(0, fin(bus.liverGlycogenG, s.liverRef12G)), Math.max(0, fin(bus.bhbEndoMmolL, 0.1)),
  );
  bus.asiIdx = s.asi;
}

export const cellularModule = defineModule<CellularState, CellularK>({
  id: 'cellular',
  specSection: '§1.13',
  dossiers: '08 §4.3-4.11',
  params: CELLULAR_PARAMS,
  // hFast carries the fed/fasted clock, so absFluxKcalH and fedState are not read (pending readers entries to prune).
  reads: [
    'raAaQGH', 'insulinUuMl', 'insulinBasalUuMl', 'hoursSinceMealH', 'liverGlycogenG', 'muscleGlycogenRel',
    'bhbEndoMmolL', 'exIntensityFrac', 'exMinutesH', 'mpsStimWb', 'maintenanceKcalD', 'energyBalanceFrac', 'ffmActKg',
  ],
  writes: ['asiIdx'],
  records: ['autophagyIdx', 'mtorIdx', 'ampkIdx'],
  prepare,
  init: (k, _ctx, bus) => {
    const ins = fin(bus.insulinUuMl, 7);
    const basal = fin(bus.insulinBasalUuMl, ins);
    const s: CellularState = {
      sAa: 0,
      sIns: 0,
      xEx: 0,
      ampkPulse: 0,
      cDef: 0,
      b0: k.b0Nominal,
      asi: 25,
      asiMuscle: 25,
      mtor: 20,
      ampk: 20,
      sNut: 0,
      leucineFold: 0,
      fClock: 0,
      fGlyc: 0,
      fKet: 0,
      fDepth: 0,
      asiCr: 0,
      insBasalUuMl: basal > 0 ? basal : 7,
      liverRef12G: k.liverRef12Frac * Math.max(1, fin(bus.liverGlycogenG, 80)),
      invLiverRef12: 0,
      bhbRef12MmolL: k.bhbRef12Prior,
      calibrated: 0,
      refSumG: 0,
      refSumBhb: 0,
      refN: 0,
      prevH: NO_PREV_H,
      prevG: 0,
      prevBhb: 0,
      prev2H: NO_PREV_H,
      prev2G: 0,
      prev2Bhb: 0,
      xOld: 0,
      boutMin: 0,
      boutIntSum: 0,
      boutAmp: 0,
      boutContrib: 0,
      rtSetsCum: 0,
      rtAmpCur: 0,
      rtContrib: 0,
    };
    s.invLiverRef12 = 1 / (s.liverRef12G > MIN_LIVER_REF ? s.liverRef12G : MIN_LIVER_REF);
    refresh(s, k, bus);
    return s;
  },
  endBurnIn: (s, k, bus) => {
    // latch the habitual-week 12-h references and B0 (MODEL_SPEC §3.4), then re-evaluate the t = 0 values with them
    finaliseReferences(s, k);
    refresh(s, k, bus);
  },
  startDay: (s, k, _bus, _day: DayInput, clock: StepClock) => {
    // normally latched by endBurnIn; a harness that never calls it latches on the first real day (parameter-draw
    // dependent through prepare())
    if (s.calibrated === 0 && clock.day >= 0) finaliseReferences(s, k);
  },
  stepHour: (s, k, bus, hour, _day: DayInput, clock: StepClock) => {
    const hFast = Math.max(0, fin(bus.hoursSinceMealH, 12));
    const gLiver = Math.max(0, fin(bus.liverGlycogenG, s.liverRef12G));
    const bhb = Math.max(0, fin(bus.bhbEndoMmolL, 0.1));
    const basal = bus.insulinBasalUuMl;
    if (basal > 0 && basal < Infinity) s.insBasalUuMl = basal; // NaN fails both tests: keep the last finite basal
    const ins = Math.max(0, fin(bus.insulinUuMl, s.insBasalUuMl));
    if (clock.day < 0) sampleReference(s, hFast, gLiver, bhb, clock.day >= -REF_WEEK_DAYS);
    updateExercise(s, k, bus, hour);
    computeIndices(s, k, bus, hFast, Math.max(0, fin(bus.raAaQGH, 0)), ins, gLiver, bhb);
    bus.asiIdx = s.asi;
  },
  endOfDay: (s, k, bus, day: DayInput) => {
    // 08 §4.9: cDef relaxes (τCR, exact daily exponential) toward the fraction of maintenance not eaten, 1 − intake/maintenance
    // (a fast day = 1). Intake is the day's resolved energy, maintenance is `maintenanceKcalD` (habitual activity); when either
    // is unavailable the composition module's balance fraction u = (EI − TEE)/TEE stands in.
    const intake = day.energyKcal;
    const maint = fin(bus.maintenanceKcalD, 0);
    const target = intake >= 0 && Number.isFinite(intake) && maint > 0 ? clamp01(1 - intake / maint) : clamp01(-fin(bus.energyBalanceFrac, 0));
    s.cDef = target + (s.cDef - target) * k.fDayCR;
    s.asiCr = k.aCR * clamp01(s.cDef / k.cDefFull);
  },
  recordHour: (s, _k, _bus, out: MetricFrame) => {
    out[I_ASI] = s.asi;
    out[I_MTOR] = s.mtor;
    out[I_AMPK] = s.ampk;
  },
});
