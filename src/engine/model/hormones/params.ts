/**
 * Parameter registry of the hormones module (MODEL_SPEC §1.11; dossiers 12 §4.0-4.7, 08 §4.12, 19 §4.9, 16 §4.0.1).
 *
 * Every constant used by `hormones/index.ts` is one ParamDef here; `prepare()` copies them into the constants object.
 * Numbers are copied from the dossiers. Where the dossier gives an explicit range it becomes [low, high]; where it gives
 * none the parameter is `fixed` (low = high = value) — no range is invented. Grades are the dossier section's grade.
 * Rulings applied: R-T3 (T3 carbohydrate knee 50 g, 12's 130 g = high), R-LEPTIN (12 §4.1 form), R-IGF (08 §4.12 ODE only),
 * R-MENS (19 §4.9 P_LPD), R-SLEEP (16's debt state replaces 12's `7 − sleep_h` terms).
 */
import type { ParamDef } from '../../types/params';

type Status = NonNullable<ParamDef['status']>;
type Extra = Pick<ParamDef, 'draw' | 'note' | 'label'>;

const P = (
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: Status,
  extra: Extra = {},
): ParamDef => ({ id: `hormones.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

/** Constant without a dossier range (never drawn). */
const FIX = (
  name: string,
  value: number,
  unit: string,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: Status,
  note?: string,
): ParamDef => P(name, value, unit, value, value, grade, source, dossier, status, { draw: 'fixed', ...(note ? { note } : {}) });

const SRC_LEPTIN_FALL =
  'PROPOSED FIT to Weigle 1997 PMID 9024254; Dubuc 1998 PMID 9550541; Doucet 2004 PMID 15070937; Mars 2005 PMID 15755824; Keim 1998 PMID 9771856';
const SRC_T3 =
  'PROPOSED FIT to Spaulding 1976 PMID 1249190; Mathieson 1986 PMID 3702673; Bisschop 2001 PMID 11167929; Müller 2015 PMID 26399868; Redman 2018 PMID 29576535';
const SRC_CORT =
  'PROPOSED FIT to Bergendahl 1996 PMID 8636290; Johnstone 2004 PMID 14763916; Pasiakos 2011 PMID 21212768; Whittaker 2022 PMID 35254136; Nakamura 2016 PMID 26586092';
const SRC_TESTO =
  'PROPOSED FIT to Chan 2003 PMID 12727933; Pardue 2017 PMID 28770669; Rossow 2013 PMID 23412685; Henning 2014 PMID 24423293; Corona 2013 PMID 23482592';
const SRC_IGF =
  'PROPOSED FIT (grid) to Hollstein 2022 PMID 35678263; Chan 2008 PMID 18445667; Isley 1983 PMID 6681614; Clemmons 1981 PMID 7197688; Fontana 2008 PMID 18843793';

export const HORMONES_PARAMS: readonly ParamDef[] = [
  // ---------------------------------------------------------------- shared drivers (12 §4.0)
  P('uScaleLeptin', 0.2, '1', 0.1, 0.35, 'B', SRC_LEPTIN_FALL, '12 §4.0, §4.1', 'proposed-fit', {
    label: 'Deficit scale of φ_L(u) = 1 − exp(−max(0,−u)/scale)',
  }),
  FIX('uScaleEnergy', 0.3, '1', 'B', SRC_T3, '12 §4.0', 'proposed-fit', 'φ_E(u) scale used by T3; no range in 12. (GH display state cut, review m11.)'),
  P('carbKneeLeptinG', 150, 'g/d', 100, 200, 'B', 'PROPOSED FIT to Ebbeling 2012 PMID 22735432; Hall 2016 PMID 27385608; Wisse 1999 PMID 10479193', '12 §4.1(d)', 'proposed-fit', {
    label: 'Carbohydrate knee of the leptin carbohydrate factor DC_L',
  }),
  FIX('carbKneeCortG', 130, 'g/d', 'B', 'Whittaker 2022 PMID 35254136 (low-carbohydrate cortisol); 12 DC_T', '12 §4.0, §4.4', 'proposed-fit', 'Ruling R-T3: cortisol keeps 12\'s 130-g DC_T.'),
  FIX('t3CarbKneeG', 50, 'g/d', 'B', 'Spaulding 1976 PMID 1249190 (≥ 50 g carbohydrate at 800 kcal → no T3 change); 13 §4.11', '12 §4.3; 13 §4.11; MODEL_SPEC R-T3', 'verified',
    'Ruling R-T3: 50 g (Spaulding, 13 §4.11) replaces 12\'s 130 g, the rejected alternative (review M20: kept in note, not drawn).'),
  FIX('leptinL50MenNgMl', 1.0, 'ng/mL', 'C', 'PROPOSED FIT to Chan 2003 PMID 12727933; Welt 2004 PMID 15342807 (threshold physiology)', '12 §4.0, §10.5', 'proposed-fit', 'Leptin-sufficiency half point S_L, men; fitted to case reports (12 §10 item 5); no range given.'),
  FIX('leptinL50WomenNgMl', 2.5, 'ng/mL', 'C', 'PROPOSED FIT to Welt 2004 PMID 15342807 (hypothalamic amenorrhoea)', '12 §4.0', 'proposed-fit', 'Leptin-sufficiency half point S_L, women; no range given.'),
  FIX('leptinSuffHill', 3, '1', 'C', 'PROPOSED (12 §4.0 S_L(L) = L³/(L³ + L50³))', '12 §4.0', 'proposed-fit'),

  // ---------------------------------------------------------------- leptin (12 §4.1, ruling R-LEPTIN)
  P('leptinAMen', 0.21, 'ng/mL per kg^b', 0.147, 0.273, 'B', 'PROPOSED FIT (power law) to Kennedy 1997 PMID 9100610 regressions', '12 §4.1(a)', 'proposed-fit', {
    label: 'Baseline leptin coefficient a (men), L0 = a·FM0^b',
    note: 'Range = the dossier\'s ±30 % on L0.',
  }),
  FIX('leptinBMen', 1.14, '1', 'B', 'PROPOSED FIT to Kennedy 1997 PMID 9100610', '12 §4.1(a)', 'proposed-fit'),
  P('leptinAWomen', 0.22, 'ng/mL per kg^b', 0.154, 0.286, 'B', 'PROPOSED FIT to Kennedy 1997 PMID 9100610; ratio checks Ostlund 1996 PMID 8923837, Hellström 2000 PMID 10792559', '12 §4.1(a)', 'proposed-fit', {
    label: 'Baseline leptin coefficient a (women)',
    note: 'Range = the dossier\'s ±30 % on L0.',
  }),
  FIX('leptinBWomen', 1.36, '1', 'B', 'PROPOSED FIT to Kennedy 1997 PMID 9100610', '12 §4.1(a)', 'proposed-fit'),
  P('leptinPostMenoMult', 0.8, '1', 0.7, 0.9, 'B', 'Isidori 2000 PMID 10843181 (post-menopausal BMI-adjusted leptin −21 %)', '12 §4.1(a)', 'verified'),
  P('leptinBeta', 1.8, '1', 1.1, 2.4, 'B', 'PROPOSED FIT to Ebbeling 2012 PMID 22735432; Weigle 1997 PMID 9024254; Havel 1996 PMID 8954050', '12 §4.1(b)', 'proposed-fit', {
    label: 'Within-person fat-mass elasticity β of leptin',
  }),
  P('leptinAMaxMen', 0.28, '1', 0.2, 0.5, 'B', SRC_LEPTIN_FALL, '12 §4.1(c)', 'proposed-fit', {
    label: 'Maximum acute leptin fall a_max (men)',
    note: '12 §4.1(c) value 0.35; re-fitted inside its range (finisher 2026-09-30) to the 12 fit list with the full engine: men fell −48 % in Dubuc (target −36 ± 15, sex ratio 1.30 vs ≥ 1.4) and −59 % in the Kiel restriction; 0.28 gives −43 %, ratio 1.42, Kiel −53 % (with leptinKOv 0.75).',
  }),
  P('leptinAMaxWomen', 0.55, '1', 0.4, 0.7, 'B', SRC_LEPTIN_FALL, '12 §4.1(c)', 'proposed-fit', { label: 'Maximum acute leptin fall a_max (women)' }),
  P('leptinKOv', 0.75, '1', 0.5, 1.5, 'B', 'PROPOSED FIT to Dirlewanger 2000 PMID 11126336; Chin-Chance 2000 PMID 10946866', '12 §4.1(c)', 'proposed-fit', {
    label: 'Surplus leptin gain k_ov',
    note: '12 §4.1(c) value 1.0; 0.75 (finisher 2026-09-30): the Kiel overfeeding week raised leptin to 1.36 and inflated the restriction fall (12 #3 −59 vs −35 … −55 %); surplus days only.',
  }),
  FIX('leptinACap', 1.5, '1', 'B', '12 §4.1(c) min(1.5, …) cap', '12 §4.1(c)', 'proposed-fit'),
  FIX('leptinSurplusProtW', 0.5, '1', 'B', 'PROPOSED; carbohydrate (not fat) overfeeding raises leptin, Dirlewanger 2000 PMID 11126336', '12 §4.1(c)', 'proposed-fit', 'Weight of the protein energy share in the surplus leptin term.'),
  FIX('leptinSurplusFatW', 0.15, '1', 'B', 'PROPOSED; Dirlewanger 2000 PMID 11126336', '12 §4.1(c)', 'proposed-fit', 'Weight of the fat energy share in the surplus leptin term.'),
  P('leptinTauDownD', 1.5, 'd', 0.75, 2.25, 'B', 'Kolaczynski 1996 PMID 8866554; Weigle 1997 PMID 9024254', '12 §4.1', 'proposed-fit', {
    label: 'Leptin acute/carbohydrate factor time constant, falling', note: 'Range = the dossier\'s ±50 %.',
  }),
  P('leptinTauUpD', 0.5, 'd', 0.25, 0.75, 'B', 'Kolaczynski 1996 PMID 8866554; Weigle 1997 PMID 9024254', '12 §4.1', 'proposed-fit', {
    label: 'Leptin acute/carbohydrate factor time constant, rising', note: 'Range = the dossier\'s ±50 %.',
  }),
  P('leptinCarbCoef', 0.37, '1', 0.2, 0.4, 'B', 'PROPOSED FIT to Ebbeling 2012 PMID 22735432; Hall 2016 PMID 27385608', '12 §4.1(d)', 'proposed-fit', {
    label: 'Carbohydrate-availability leptin coefficient',
    note: '12 §4.1(d) value 0.30; 0.40 (range top, finisher 2026-09-30): the fit target itself (Ebbeling very-low-carbohydrate / low-fat leptin ≤ 0.8) gave 0.83 at 0.30 in the full engine; 0.40 gives 0.78 and keeps Weigle (−67 %) and Dubuc inside their bands.',
  }),
  FIX('leptinLagTauD', 21, 'd', 'B', 'PROPOSED; slow leptin/T3 recovery, Hulmi 2017 PMID 28119632; Rosenbaum 2005 PMID 16322796', '12 §4.1(e)', 'proposed-fit', 'Lag of L_FM used by T3 (both directions).'),

  // ---------------------------------------------------------------- thyroid (12 §4.3; ruling R-T3)
  FIX('t3EnergyCoef', 0.22, '1', 'B', SRC_T3, '12 §4.3', 'proposed-fit'),
  FIX('t3CarbCoef', 0.22, '1', 'B', SRC_T3, '12 §4.3', 'proposed-fit'),
  FIX('t3SurplusCoef', 0.1, '1', 'C', 'Danforth 1979 PMID 500814 (overfeeding raises T3)', '12 §4.3', 'proposed-fit'),
  FIX('t3SurplusScale', 0.3, '1', 'C', 'Danforth 1979 PMID 500814', '12 §4.3', 'proposed-fit'),
  FIX('t3TauDownD', 2, 'd', 'B', 'Spencer 1983 PMID 6403568; Vagenakis 1975 PMID 1150863', '12 §4.3', 'proposed-fit'),
  FIX('t3TauUpD', 3, 'd', 'B', 'Vagenakis 1975 PMID 1150863 (refeeding restores T3 within 5 d); Mathieson 1986 PMID 3702673', '12 §4.3', 'proposed-fit'),
  FIX('t3LeanExp', 0.3, '1', 'B', 'PROPOSED FIT to Ebbeling 2012 PMID 22735432; Redman 2018 PMID 29576535; Pardue 2017 PMID 28770669', '12 §4.3', 'proposed-fit', 'Exponent of the slow leanness component (L_FM_lag/L0)^0.30.'),
  FIX('rt3SevereAmp', 0.6, '1', 'B', 'Vagenakis 1975 PMID 1150863 (fast: rT3 +58 %)', '12 §4.3', 'proposed-fit'),
  FIX('rt3SevereThresh', 0.7, '1', 'B', 'PROPOSED', '12 §4.3', 'proposed-fit'),
  FIX('rt3SevereWidth', 0.3, '1', 'B', 'PROPOSED', '12 §4.3', 'proposed-fit'),
  FIX('rt3CarbCoef', 0.15, '1', 'B', 'Serog 1982 PMID 7064875; Bisschop 2001 PMID 11167929', '12 §4.3', 'proposed-fit', 'Uses DC_T3 (R-T3 knee) — Spaulding: ≥ 50 g carbohydrate → no rT3 change either.'),
  FIX('rt3TauUpD', 2, 'd', 'B', 'PROPOSED', '12 §4.3', 'proposed-fit'),
  FIX('rt3TauDownD', 3, 'd', 'B', 'PROPOSED', '12 §4.3', 'proposed-fit'),

  // ---------------------------------------------------------------- cortisol (12 §4.4)
  FIX('cortErAmp', 0.5, '1', 'C', SRC_CORT, '12 §4.4', 'proposed-fit'),
  FIX('cortErThresh', 0.6, '1', 'C', SRC_CORT, '12 §4.4', 'proposed-fit'),
  FIX('cortErWidth', 0.4, '1', 'C', SRC_CORT, '12 §4.4', 'proposed-fit'),
  FIX('cortErLin', 0.08, '1', 'C', 'Tomiyama 2010 PMID 20368473; Nakamura 2016 PMID 26586092', '12 §4.4', 'proposed-fit'),
  FIX('cortErLinScale', 0.25, '1', 'C', 'PROPOSED', '12 §4.4', 'proposed-fit'),
  FIX('cortDeficitThresh', 0.05, '1', 'C', 'PROPOSED (deficit day: u < −0.05)', '12 §4.4', 'proposed-fit'),
  FIX('cortNDefTauD', 28, 'd', 'C', 'Nakamura 2016 PMID 26586092 (effect declines after several weeks)', '12 §4.4', 'proposed-fit'),
  FIX('cortLcBase', 0.05, '1', 'C', 'Whittaker 2022 PMID 35254136', '12 §4.4', 'proposed-fit'),
  FIX('cortLcAmp', 0.15, '1', 'C', 'Whittaker 2022 PMID 35254136 (< 3 wk SMD +0.41)', '12 §4.4', 'proposed-fit'),
  FIX('cortNLcTauD', 21, 'd', 'C', 'Whittaker 2022 PMID 35254136 (≥ 3 wk no consistent effect)', '12 §4.4', 'proposed-fit'),
  FIX('cortSleepPerH', 0.04, '1/h', 'C', 'Leproult 1997 PMID 9415946 (evening cortisol after sleep loss)', '12 §4.4; MODEL_SPEC R-SLEEP', 'proposed-fit', 'Reads 16\'s fast sleep debt dF (R-SLEEP).'),
  FIX('cortLeanCoef', 0.2, '1', 'D', 'PROPOSED (leanness term)', '12 §4.4', 'proposed-fit'),
  FIX('cortTauD', 1, 'd', 'C', 'PROPOSED', '12 §4.4', 'proposed-fit'),
  FIX('counterResetDays', 3, 'd', 'C', 'PROPOSED (n_def / n_LC reset after ≥ 3 consecutive days out of the condition)', '12 §4.4', 'proposed-fit'),

  // ---------------------------------------------------------------- testosterone, SHBG, free T (12 §4.5, men)
  FIX('testoLeptinFloor', 0.25, '1', 'C', SRC_TESTO, '12 §4.5', 'proposed-fit', '(0.25 + 0.75·S_L(L)) leptin-threshold term.'),
  FIX('testoFastAmp', 0.4, '1', 'C', 'Chan 2003 PMID 12727933 (72-h fast ≈ −40 %)', '12 §4.5', 'proposed-fit'),
  FIX('testoFastThresh', 0.6, '1', 'C', 'PROPOSED', '12 §4.5', 'proposed-fit'),
  FIX('testoFastWidth', 0.4, '1', 'C', 'PROPOSED', '12 §4.5', 'proposed-fit'),
  FIX('testoObCoef', 0.025, '1/%BF', 'C', 'Corona 2013 PMID 23482592', '12 §4.5', 'proposed-fit'),
  FIX('testoObThreshPct', 18, '%', 'C', 'Corona 2013 PMID 23482592', '12 §4.5', 'proposed-fit'),
  FIX('testoFatAmp', 0.1, '1', 'C', 'Whittaker & Wu 2021 PMID 33741447 (low-fat SMD −0.38)', '12 §4.5', 'proposed-fit'),
  FIX('testoFatRefPct', 30, '%E', 'C', 'Whittaker & Wu 2021 PMID 33741447', '12 §4.5', 'proposed-fit'),
  FIX('testoFatWidthPct', 15, '%E', 'C', 'Whittaker & Wu 2021 PMID 33741447', '12 §4.5', 'proposed-fit'),
  FIX('testoProtAmp', 0.35, '1', 'C', 'Whittaker 2022 PMID 35254136; Whittaker 2023 PMID 36266956 (> 3.4 g/kg)', '12 §4.5', 'proposed-fit'),
  FIX('testoProtThreshGKg', 3.0, 'g/kg/d', 'C', 'Whittaker 2023 PMID 36266956', '12 §4.5', 'proposed-fit'),
  FIX('testoProtWidthGKg', 0.8, 'g/kg/d', 'C', 'Whittaker 2023 PMID 36266956', '12 §4.5', 'proposed-fit'),
  FIX('testoAlcPerG', 0.0017, '1/(g/d)', 'C', 'Sierksma 2004 PMID 15166654 (40 g/d × 3 wk → −6.8 %)', '12 §4.5; 15 §5.1', 'proposed-fit'),
  FIX('testoAlcCapG', 60, 'g/d', 'C', 'Sierksma 2004 PMID 15166654', '12 §4.5', 'proposed-fit'),
  FIX('testoTauDownD', 2, 'd', 'C', SRC_TESTO, '12 §4.5', 'proposed-fit'),
  FIX('testoTauUpD', 7, 'd', 'C', 'Friedl 2000 PMID 10797147; Henning 2014 PMID 24423293 (prompt recovery on refeeding)', '12 §4.5', 'proposed-fit'),
  FIX('testoCompTauD', 7, 'd', 'C', 'PROPOSED (composition factors F_fat, F_prot, F_alc)', '12 §4.5', 'proposed-fit'),
  FIX('shbgInsExp', 0.3, '1', 'C', 'PROPOSED FIT to Henning 2014 PMID 24423293 (SHBG +46 %); Friedl 2000 PMID 10797147', '12 §4.5', 'proposed-fit', 'SHBG* = Ins_rel^(−0.3).'),
  FIX('shbgTauD', 7, 'd', 'C', 'PROPOSED', '12 §4.5', 'proposed-fit'),
  FIX('tt0NmolL', 17, 'nmol/L', 'C', 'Cangemi 2010 PMID 20096034 (sedentary controls 17.6 ± 6.3; illustrative default)', '12 §4.5', 'proposed-fit', 'Used only when the user gives no lab value.'),
  FIX('shbg0NmolL', 35, 'nmol/L', 'C', 'Typical adult value (UNVERIFIED in 12)', '12 §4.5', 'unverified'),
  FIX('albuminMolL', 6.2e-4, 'mol/L', 'C', 'Vermeulen 1999 PMID 10523012 (albumin 43 g/L)', '12 §4.5', 'unverified'),
  FIX('kAlbLMol', 3.6e4, 'L/mol', 'C', 'Vermeulen 1999 PMID 10523012 (association constant, common usage)', '12 §4.5', 'unverified'),
  FIX('kShbgLMol', 1.0e9, 'L/mol', 'C', 'Vermeulen 1999 PMID 10523012 (association constant, common usage)', '12 §4.5', 'unverified'),

  // ---------------------------------------------------------------- menstrual-disturbance risk (19 §4.9, ruling R-MENS)
  P('lpdMidPct', 15, '% deficit', 12, 18, 'B', 'PROPOSED FIT to Williams 2015 PMID 25352438 (n = 34)', '19 §4.9, §4.20', 'proposed-fit', {
    label: 'P_LPD logistic midpoint (mean % deficit over 3 cycles)',
  }),
  FIX('lpdSlope', 0.2, '1/%', 'B', 'PROPOSED FIT to Williams 2015 PMID 25352438', '19 §4.9, §4.20', 'proposed-fit'),
  FIX('lpdClipLow', 0.1, '1', 'B', 'Williams 2015 PMID 25352438 (clip 0.10-0.90)', '19 §4.9', 'proposed-fit'),
  FIX('lpdClipHigh', 0.9, '1', 'B', 'Williams 2015 PMID 25352438 (clip 0.10-0.90)', '19 §4.9', 'proposed-fit'),
  FIX('lpdWindowD', 84, 'd', 'B', 'Williams 2015 PMID 25352438 (3 cycles); MODEL_SPEC R-MENS', '19 §4.9; MODEL_SPEC §1.11', 'verified', 'Structural (ring length); changing it requires a re-prepare.'),

  // ---------------------------------------------------------------- IGF-1 (08 §4.12 only, ruling R-IGF)
  P('igfLagH', 30, 'h', 24, 42, 'C', SRC_IGF, '08 §4.12', 'proposed-fit', { label: 'IGF-1 fasting lag (GH-resistance onset)' }),
  P('igfLwH', 3, 'h', 2, 6, 'C', SRC_IGF, '08 §4.12', 'proposed-fit'),
  P('igfAInf', 0.25, '1', 0.2, 0.3, 'B', 'Clemmons 1981 PMID 7197688 (10-d fast 0.25)', '08 §4.12', 'proposed-fit', { label: 'IGF-1 asymptote during a prolonged fast' }),
  P('igfTauDownH', 44, 'h', 30, 60, 'C', SRC_IGF, '08 §4.12', 'proposed-fit'),
  P('igfTauUpH', 173, 'h', 120, 240, 'C', 'Isley 1983 PMID 6681614 (5-d refeed 0.36 → 0.68)', '08 §4.12', 'proposed-fit'),
  P('igfProtSlope', 0.306, '1/(g/kg/d)', 0.2, 0.4, 'B', 'Fontana 2008 PMID 18843793 (1.67 → 0.95 g/kg ⇒ 0.78)', '08 §4.12', 'proposed-fit'),
  FIX('igfProtRefGKg', 1.67, 'g/kg/d', 'B', 'Fontana 2008 PMID 18843793', '08 §4.12', 'verified'),
  FIX('igfTpMin', 0.5, '1', 'B', '08 §4.12 TP clamp', '08 §4.12', 'proposed-fit'),
  FIX('igfTpMax', 1.0, '1', 'B', '08 §4.12 TP clamp', '08 §4.12', 'proposed-fit'),
  FIX('igfProtRatioMax', 1.0, '1', 'B', '08 §2 state table: igfProt 0.5-1.0 ("1.0 at habitual protein"), igf1Rel typical 0.2-1.05; no study in 08 §4.12 raises IGF-1 by protein above habitual', '08 §2, §4.12', 'proposed-fit',
    'Cap of the protein factor TP(P7)/TP(P_hab): with P_hab ≈ 1.0 g/kg the uncapped ratio reached 1.26 (+19-21 % IGF-1 at 1.6-2 g/kg), outside 08\'s own state range. alt uncapped (12 §4.7 elasticity (P/P_ref)^0.43, +22 % at 1.6×): rejected with 12\'s form (R-IGF).'),
  P('igfTauPH', 168, 'h', 72, 240, 'C', 'Compromise between Isley 1983 PMID 6681614 and FMD data (Wei 2017 PMID 28202779; Espinoza 2026 PMID 41372565)', '08 §4.12', 'proposed-fit'),
  FIX('igfEatingHFastH', 24, 'h', 'C', '08 §4.12 (protein factor updates only while hFast < 24 h)', '08 §4.12', 'proposed-fit'),
];
