/**
 * Parameter registry of the cellular module (MODEL_SPEC §1.13, dossier 08 §4.3-4.11).
 * Every constant of the autophagy signal index (ASI), the muscle mTORC1 index and the muscle AMPK index is one
 * ParamDef here; `prepare()` copies them into the constants object. Grades follow the dossier: the ASI is a grade C/D
 * construct (weights D), the AMPK exercise dependence is B, the mTORC1 direction is B/C.
 */
import type { ParamDef } from '../../types/params';

const P = (
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: NonNullable<ParamDef['status']>,
  extra: Pick<ParamDef, 'draw' | 'note' | 'label'> = {},
): ParamDef => ({ id: `cellular.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

/** A structural / definitional constant: never varied in draws. */
const FIX = (
  name: string,
  value: number,
  unit: string,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: NonNullable<ParamDef['status']>,
  note?: string,
): ParamDef => P(name, value, unit, value, value, grade, source, dossier, status, { draw: 'fixed', ...(note ? { note } : {}) });

export const CELLULAR_PARAMS: readonly ParamDef[] = [
  // ---- suppression: amino acids (08 §4.3)
  P('ec50L', 0.5, 'fold above post-absorptive', 0.25, 1.0, 'D', 'PROPOSED; half-effect at +50 % leucine, post-meal peaks +100-150 % (Atherton 2010 PMID 20844073)', '08 §4.3', 'proposed-fit', {
    label: 'EC50 of leucine suppression',
  }),
  P('nL', 1.5, '1', 1, 2, 'D', 'PROPOSED Hill exponent', '08 §4.3', 'proposed-fit'),
  P('wAa', 0.6, '1', 0.3, 0.8, 'D', 'PROPOSED; muscle data support (Glynn 2010 PMID 20519362), PBMC flux null (Singh 2025 PMID 40663500)', '08 §4.3', 'proposed-fit', {
    label: 'Weight of amino-acid suppression',
  }),
  P('aaRefKgFfmH', 0.1, 'g/kg FFM/h', 0.05, 0.2, 'D', 'PROPOSED FIT to the 08 §4.3 fallback dL curve (dL 0.98 at 25 g whey) and Atherton 2010 PMID 20844073 (+130 % EAA after 48 g whey)', '08 §4.3; MODEL_SPEC §1.13', 'proposed-fit', {
    label: 'Post-absorptive AA appearance reference (raAaQ_pa)',
    note:
      'MODEL_SPEC writes dL = raAaQGH/raAaQ_pa − 1 with raAaQ_pa "the post-absorptive value at 12 h". intake\'s raAaQGH is meal-derived, so its post-absorptive value is ≈ 0 and the formula would divide by ~0. ' +
      'Here plasma leucine fold = 1 + raAaQGH/(k·FFM) with k the endogenous post-absorptive appearance scale, i.e. dL = raAaQGH/(k·FFM). k is the A_lag that doubles plasma leucine (25 g whey peak A_lag ≈ 5.8 g/h at 60 kg FFM ⇒ dL ≈ 1).',
  }),

  // ---- suppression: insulin (08 §4.4)
  P('ec50I', 5, 'µU/mL above fasting basal', 3, 15, 'C', 'PROPOSED FIT (Greenhaff 2008 PMID 18577697; Wilkes 2009 PMID 19740975)', '08 §4.4', 'proposed-fit', {
    label: 'EC50 of insulin suppression',
    note: 'Ruling R-EC50: kept at 5 [3, 15]; 08\'s "94 % at +10 µU/mL" data point implies ≈ 1.6 (outside its own range), recorded as a known inconsistency.',
  }),
  P('nI', 1.5, '1', 1, 2, 'D', 'PROPOSED Hill exponent', '08 §4.4', 'proposed-fit'),
  P('wIns', 0.75, '1', 0.6, 0.9, 'C', 'Insulin lowers LC3-II/I by ~80 % in human muscle (Fritzen 2016 PMID 26614120); spec midpoint of 0.6-0.9', '08 §4.4; MODEL_SPEC §1.13', 'proposed-fit', {
    label: 'Weight of insulin suppression',
    note: '08 lists 0.8 [0.6, 0.9]; MODEL_SPEC §1.13 ruling uses the midpoint 0.75.',
  }),

  // ---- fasting depth (08 §4.5)
  P('h50', 60, 'h', 24, 96, 'D', 'PROPOSED, bracketed by 36 h modest / 72 h clear human muscle markers (Dethlefsen 2018 PMID 30161009; Vendelbo 2014 PMID 25020061)', '08 §4.5, §4.10 step 5', 'proposed-fit', {
    draw: 'logTri',
    label: 'Fasting hours at half-maximal clock drive',
    note:
      'Dossier nominal 48 h is the clock-only calibration. With the full depth F = 0.6 F_clock + 0.2 F_glyc + 0.2 F_ket the glycogen and ketone terms add on top, and 48 h overshoots the 08 §4.10 anchors by 5.4-5.7 points at 48 h and 72 h on the reference trajectory (04 §4.2 glycogen, 20 §4.3.4 BHB_ref). ' +
      '08 §4.10 step 5 allows adjusting h50 within 36-60 h to meet the anchors: 56 h kept every anchor within ±3 points with the first integrated fuel/ketones; after their final calibration (faster early BHB rise, 24 h 0.50 mM) 56 h overshoots the 36-h anchor by 5.5 points, and 60 h (the top of the allowed range, finisher 2026-09-30) keeps all nine spec hours within ±4.4 (cellular/fullLoop.test.ts).',
  }),
  P('nh', 2, '1', 1.5, 3, 'D', 'PROPOSED smooth sigmoid; no data', '08 §4.5', 'proposed-fit'),
  P('wClock', 0.6, '1', 0.3, 0.9, 'D', 'PROPOSED; clock is the only proxy with human anchors', '08 §4.5', 'proposed-fit', {
    note: 'Weights are renormalised to sum 1 in prepare() (each ±50 %, 08 §4.5).',
  }),
  P('wGlyc', 0.2, '1', 0.1, 0.3, 'D', 'PROPOSED', '08 §4.5', 'proposed-fit'),
  P('wKet', 0.2, '1', 0.1, 0.3, 'D', 'PROPOSED; endogenous BHB only', '08 §4.5', 'proposed-fit'),
  P('kBhb', 1.5, 'mmol/L', 1.0, 2.5, 'D', 'PROPOSED; half weight at 1.5 mM (≈ day 2 of a water fast)', '08 §4.5', 'proposed-fit'),
  FIX('asiRef12', 25, 'index', 'D', 'Definition: ASI = 25 at 12 h post-absorptive (every human study baseline)', '08 §4.10 step 4', 'verified', 'B0 is calibrated to this anchor, never chosen.'),
  P('bhbRef12', 0.1, 'mmol/L', 0.05, 0.5, 'B', 'McDougal 2018 PMID 29931424 (BHB 0.1 ± 0.0 at 12 h)', '05 §7 V1; 08 §4.10', 'verified', {
    note: 'Prior for the endogenous BHB at 12 h post-absorptive; replaced by the burn-in sample of the person\'s own habitual day (§3.4).',
  }),
  P('liverRef12Frac', 0.75, '1', 0.55, 0.9, 'C', 'Taylor 1996 PMID 8550823 / 04 §2: C_L0 210 mmol/L overnight vs 280 mmol/L 4 h after a mixed meal', '04 §2; 08 §4.5 (G_ref12)', 'proposed-fit', {
    note: 'Prior for G_L at 12 h post-absorptive as a fraction of the initial liver glycogen; replaced by the burn-in sample of the habitual day.',
  }),

  // ---- exercise pulse (08 §4.8)
  P('aEx', 15, 'index points', 5, 25, 'D', 'PROPOSED; PBMC LC3-II x1.74 in untrained men (Specht 2026 PMID 42615877)', '08 §4.8', 'proposed-fit', { label: 'Exercise pulse weight (headline ASI)' }),
  P('aExMuscle', 25, 'index points', 10, 40, 'D', 'PROPOSED (Schwalm 2015 PMID 25957282; Brandt 2018 PMID 29626392; Jamart 2012 PMID 22345427; Specht 2026 PMID 42615877)', '08 §4.8', 'proposed-fit'),
  P('tauEx', 3, 'h', 2, 6, 'C', 'AMPK reversed by 3 h (Wojtaszewski 2000 PMID 11018120); LC3/p62 changes at 1-3 h', '08 §4.8', 'proposed-fit'),
  P('exFloor', 0.4, 'fraction VO2max', 0.3, 0.5, 'D', 'PROPOSED; some signal at 50 % (Møller 2015 PMID 25678702)', '08 §4.8', 'proposed-fit'),
  P('exFull', 0.8, 'fraction VO2max', 0.7, 0.9, 'D', 'PROPOSED; strongest at high intensity (Schwalm 2015 PMID 25957282)', '08 §4.8', 'proposed-fit'),
  FIX('durRefMin', 60, 'min', 'D', 'PROPOSED duration factor fD = min(1.5, sqrt(min/60))', '08 §4.8', 'proposed-fit'),
  FIX('durCap', 1.5, '1', 'D', 'PROPOSED cap of fD (≥ 135 min)', '08 §4.8', 'proposed-fit'),
  FIX('xExCap', 1.5, '1', 'D', 'PROPOSED cap of the pulse sum min(1.5, xEx)', '08 §4.8, §4.10', 'proposed-fit'),
  FIX('mTUntrained', 1.0, '1', 'D', 'PROPOSED training damping: untrained', '08 §4.8', 'proposed-fit'),
  P('mTRecreational', 0.75, '1', 0.6, 0.9, 'D', 'PROPOSED training damping: recreational', '08 §4.8', 'proposed-fit'),
  P('mTEndurance', 0.5, '1', 0.3, 0.7, 'D', 'PROPOSED training damping: endurance-trained (Specht 2026 PMID 42615877: no change)', '08 §4.8', 'proposed-fit'),
  P('rtAmp', 0.5, '1', 0.25, 0.75, 'D', 'PROPOSED; resistance exercise direction inconsistent (Fry 2013 PMID 23089333; Hentilä 2018 PMID 29608242)', '08 §4.8', 'proposed-fit'),
  FIX('rtSetsFull', 15, 'sets', 'D', 'PROPOSED; full RT pulse at ≥ 15 sets', '08 §4.8', 'proposed-fit'),
  P('rtTrainedMult', 0.7, '1', 0.5, 0.9, 'D', 'PROPOSED; trained lifters', '08 §4.8', 'proposed-fit'),

  // ---- chronic restriction (08 §4.9)
  P('aCR', 3, 'index points', 0, 8, 'D', 'PROPOSED; null CR flux (Bensalem 2025 PMID 40345145) vs positive muscle data (Yang 2016 PMID 26774472; Das 2023 PMID 37823711)', '08 §4.9', 'proposed-fit', {
    label: 'Chronic-restriction weight',
  }),
  P('tauCR', 7, 'd', 3, 14, 'D', 'PROPOSED', '08 §4.9', 'proposed-fit', { draw: 'tri' }),
  FIX('cDefFull', 0.25, '1', 'D', 'PROPOSED; asi_CR saturates at a 25 % deficit', '08 §4.9', 'proposed-fit'),

  // ---- AMPK index (08 §4.6)
  FIX('ampkA0', 0.2, '1', 'B', 'Normalisation: rest = 20', '08 §4.6', 'proposed-fit'),
  P('ampkAEx', 0.5, '1', 0.4, 0.6, 'B', 'PROPOSED FIT: 75 % VO2max gives 3.5x rest (Wojtaszewski 2000 PMID 11018120)', '08 §4.6', 'proposed-fit'),
  P('ampkThr', 0.55, 'fraction VO2max', 0.45, 0.6, 'B', 'No activation at ~50 %, 3-4x at ~75 % (Wojtaszewski 2000 PMID 11018120)', '08 §4.6', 'proposed-fit'),
  P('ampkFull', 0.75, 'fraction VO2max', 0.7, 0.8, 'B', 'As above', '08 §4.6', 'proposed-fit'),
  FIX('ampkCap', 1.3, '1', 'B', 'PROPOSED cap of fI_ampk', '08 §4.6', 'proposed-fit'),
  P('tauA', 1, 'h', 0.5, 1.5, 'C', 'Totally reversed 3 h after exercise (Wojtaszewski 2000 PMID 11018120)', '08 §4.6', 'proposed-fit'),
  P('gGly', 0.5, '1', 0.3, 0.7, 'C', 'Depleted muscle: α1 +60 %, α2 +45 % at rest (Wojtaszewski 2003 PMID 12488245)', '08 §4.6', 'proposed-fit'),
  P('fFast', 0.3, '1', 0, 0.4, 'C', 'AMPK falls with a 48 h fast in lean men (Wijngaarden 2013 PMID 23512807)', '08 §4.6', 'proposed-fit', {
    note: '08 §4.6 value 0.2; re-fitted inside its range (finisher 2026-09-30) to the target it was fitted to (08 V1/V3/V4: AMPK at 48 h ≤ its 12-h value, Wijngaarden): with the full engine\'s fasting muscle-glycogen fall the glycogen term (g_gly 0.5) outweighed 0.2 (+0.6 index points); 0.3 restores the fall and keeps 08 V2 Wojtaszewski (hard ≥ 3×, easy ≤ 1.3×, recovery ≤ 1.2×).',
  }),
  P('ampkRtAmp', 0.6, '1', 0.3, 0.9, 'D', 'UNVERIFIED; RT session fI_ampk = 0.6·min(1, sets/15)', '08 §4.6', 'unverified'),
  P('gNormDw', 462, 'mmol/kg dw', 330, 594, 'B', 'Areta & Hopkins 2018 PMID 29923148 (462 ± 132 mmol/kg dw normal-CHO vastus lateralis)', '04 §2; 08 §4.6', 'verified', {
    note: 'G_norm = the person\'s normal fed muscle glycogen; G_musc = muscleGlycogenRel·G_norm.',
  }),
  FIX('gDeplDw', 150, 'mmol/kg dw', 'C', 'Glycogen-depleted muscle ≈ 160 mmol/kg dw (Wojtaszewski 2003 PMID 12488245)', '08 §4.6', 'proposed-fit'),

  // ---- mTORC1 index (08 §4.11)
  FIX('mtorBase0', 0.2, '1', 'B', 'Normalisation: 12 h post-absorptive = 20', '08 §4.11', 'proposed-fit'),
  P('mtorFall', 0.65, '1', 0.4, 0.8, 'C', 'mTOR Ser2448 −40-50 % at 72 h (Vendelbo 2014 PMID 25020061)', '08 §4.11', 'proposed-fit'),
  P('kRE', 0.3, '1', 0.1, 0.5, 'D', 'UNVERIFIED; resistance-exercise sensitisation of the acute term (reSens = mpsStimWb)', '08 §4.11', 'unverified'),
  FIX('mtorInsPerm', 0.23, '1', 'C', 'Insulin permissive additive share of the acute term (0.77 + 0.23·S_ins)', '08 §4.11', 'proposed-fit'),
];
