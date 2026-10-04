/**
 * Parameters of the ketones module (docs/MODEL_SPEC.md §1.7 parameter list; values, ranges, grades and sources copied
 * from dossier 05 §4.1-4.12, §4.17 `K`, §2 and §6; the ethanol factor from 15 §4.10). Every constant used by the
 * module lives here; `prepare()` copies them into the constants object.
 *
 * Retune knobs for the integration pass (ruling R-KET, MODEL_SPEC §11.1/§11.2): `ketones.kP`, `ketones.g50Frac`
 * first; `ketones.kProt` and `ketones.aHs` second line. They are ordinary ParamDefs, so the integration pass can
 * override them through `RunOptions.paramOverrides` without touching the code.
 */
import type { ParamDef } from '../../types/params';

const P05 = '05';

/** Short source strings (author year + PMID) used below. */
const SRC = {
  owen1973: 'Owen 1973 PMID 4729054',
  balasse1979: 'Balasse 1979 PMID 759825',
  balasseFery1989: 'Balasse & Féry 1989 PMID 2656155',
  miles1983: 'Miles 1983 PMID 6134753',
  keller1988: 'Keller 1988 PMID 3287950',
  hall2010: 'Hall 2010 PMID 19934407',
  deru2021: 'Deru 2021 PMID 33731648',
  deru2024: 'Deru 2024 PMID 38201992',
  haymond1982: 'Haymond 1982 PMID 7043160',
  harvey2018: 'Harvey 2018 PMID 29951312',
  owen1969: 'Owen 1969 PMID 5773093',
  owenReichard1971: 'Owen & Reichard 1971 PMID 5090067',
  rosenbaum2019: 'Rosenbaum 2019 PMID 31067015',
  klein1993: 'Klein 1993 PMID 8238506',
  balasseNeef1975: 'Balasse & Neef 1975 PMID 1152676',
  johnstone2008: 'Johnstone 2008 PMID 18175736',
  fery1983: 'Féry & Balasse 1983 PMID 6353933',
  fery1986: 'Féry & Balasse 1986 PMID 3518484',
  burke2021: 'Burke 2021 PMID 32697366',
  goedecke1999: 'Goedecke 1999 PMID 10599981',
  gray1989: 'Gray 1989 PMID 2645502',
  stPierre2019: 'St-Pierre 2019 PMID 31058159',
  vandenberghe2017: 'Vandenberghe 2017 PMID 29955698',
  stubbs2017: 'Stubbs 2017 PMID 29163194',
  courchesne2013: 'Courchesne-Loyer 2013 PMID 23274095',
  courchesne2017: 'Courchesne-Loyer 2017 (J Cereb Blood Flow Metab 37:2485)',
  hallberg2018: 'Hallberg 2018 PMID 29417495',
  umpierrez2024: 'Umpierrez 2024 PMID 39052901',
} as const;

export const KETONES_PARAMS: readonly ParamDef[] = [
  // ---------------------------------------------------------------- distribution & clearance (05 §4.1)
  { id: 'ketones.vdPerBW', value: 0.25, unit: 'L/kg BW', low: 0.18, high: 0.31, grade: 'A', source: SRC.owen1973, dossier: `${P05} §4.1`, status: 'verified', label: 'Ketone volume of distribution' },
  { id: 'ketones.clFFM', value: 0.0134, unit: 'L/min/kg FFM', low: 0.0134 * 0.7, high: 0.0134 * 1.3, grade: 'A', source: `${SRC.owen1973} (DERIVED: 2.9 %/min × 0.25 L/kg)`, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Low-concentration ketone clearance CL0 per kg FFM', note: '±30 % (dossier)' },
  { id: 'ketones.km', value: 6.0, unit: 'mmol/L', low: 4, high: 12, grade: 'B', source: `${SRC.owen1973}; ${SRC.balasse1979}`, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Michaelis constant of ketone uptake' },
  { id: 'ketones.aM', value: 0.38, unit: '1', low: 0.2, high: 0.5, grade: 'C', source: SRC.balasse1979, dossier: `${P05} §4.1, §4.11.2`, status: 'proposed-fit', label: 'Clearance reduction at full slow adaptation A_s', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.35; contested (saturation vs adaptation, Balasse & Féry 1989)' },
  { id: 'ketones.renal', value: 0.00025, unit: 'L/min/kg BW', low: 0.000125, high: 0.000375, grade: 'B', source: `${SRC.balasse1979}; ${SRC.balasseFery1989}`, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Renal ketone clearance above threshold', note: '±50 % (dossier)' },
  { id: 'ketones.tThr', value: 1.0, unit: 'mmol/L', low: 0.5, high: 1.5, grade: 'B', source: `${SRC.balasse1979}; ${SRC.balasseFery1989}`, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Renal ketone threshold (TKB)', note: '±50 % (dossier)' },
  { id: 'ketones.tkb0', value: 0.25, unit: 'mmol/L', low: 0.25, high: 0.25, grade: 'B', source: SRC.owenReichard1971, dossier: `${P05} §2, §4.17`, status: 'verified', label: 'Initial TKB (overnight-fasted, mixed diet)' },
  { id: 'ketones.tkbFloor', value: 0.01, unit: 'mmol/L', low: 0.01, high: 0.01, grade: 'B', source: '05 §4.17 reference implementation (TKB floor)', dossier: `${P05} §4.17`, status: 'proposed-fit', label: 'Numerical floor of the TKB pool', draw: 'fixed' },
  { id: 'ketones.exCL', value: 1.0, unit: '1 per unit x', low: 0.5, high: 1.5, grade: 'B', source: SRC.fery1986, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Exercise clearance gain M_ex', note: '±50 % (dossier)' },
  { id: 'ketones.exCLTkb', value: 3.0, unit: 'mmol/L', low: 3.0, high: 3.0, grade: 'B', source: SRC.fery1986, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'TKB at which the exercise clearance gain halves' },
  { id: 'ketones.exCLHill', value: 4, unit: '1', low: 4, high: 4, grade: 'B', source: SRC.fery1986, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Hill exponent of the exercise clearance gain' },
  { id: 'ketones.postCL', value: 0.6, unit: '1', low: 0.6, high: 0.6, grade: 'B', source: SRC.fery1983, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Post-exercise clearance multiplier' },
  { id: 'ketones.postDurH', value: 2, unit: 'h', low: 2, high: 2, grade: 'B', source: SRC.fery1983, dossier: `${P05} §4.1`, status: 'proposed-fit', label: 'Duration of the post-exercise clearance reduction' },

  // ---------------------------------------------------------------- hepatic ketogenesis (05 §4.2, §4.4)
  { id: 'ketones.kP', value: 0.010, unit: 'mmol/min/kg FFM/mM FFA', low: 0.0075, high: 0.0125, grade: 'B', source: `${SRC.miles1983}; ${SRC.keller1988}; ${SRC.balasse1979} (05 calibration)`, dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Ketogenic production constant kP', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; value = 05 §4.17 (the first-pass 0.0075 compensated for the absolute-insulin proxy); RETUNE after coupling to fuel (ruling R-KET); review/decisions preview with 04 liver (τ 24 h, floor 5 g) + 20 k_Mf: 0.008-0.009 reaches 48/72 h, 24 h ≈ 0.5 mM accepted' },
  { id: 'ketones.fHep', value: 0.2, unit: 'mmol/L FFA-equivalent', low: 0.05, high: 0.2, grade: 'C', source: SRC.deru2024, dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Non-plasma hepatic substrate F_hep', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.15 (registry high); ketones/integration/targets.ts); was 0.15 (registry high)' },
  { id: 'ketones.phiMin', value: 0.10, unit: '1', low: 0.05, high: 0.3, grade: 'C', source: `05 calibration (${SRC.deru2021}; ${SRC.haymond1982})`, dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Minimum hepatic ketogenic partition φ_min', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.12; ketones/integration/targets.ts); was 0.12 (registry low)' },
  { id: 'ketones.g50Frac', value: 0.55, unit: 'frac of G_L,max', low: 0.40, high: 0.65, grade: 'C', source: `05 calibration (${SRC.deru2021}; ${SRC.haymond1982}; Rothman 1991 PMID 1948033)`, dossier: `${P05} §4.2, §4.4 coupling note`, status: 'proposed-fit', label: 'Liver-glycogen half-point of the partition (G50 / G_L,max)', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; value = 05 §4.4 coupling note; RETUNE after coupling (R-KET); dossier range 40-65 g per 100 g fallback capacity' },
  { id: 'ketones.nG', value: 2, unit: '1', low: 2, high: 3, grade: 'C', source: '05 calibration (entry-timing fit)', dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Hill exponent of the glycogen partition', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 2.5 (registry low)' },
  { id: 'ketones.kIHep', value: 0.09, unit: 'per unit I', low: 0, high: 0.3, grade: 'C', source: SRC.keller1988, dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Direct hepatic insulin restraint', note: `Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05's own insulin proxy \`insulinRefRel\`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.15; contested: ${SRC.miles1983} found no direct effect` },
  { id: 'ketones.aH', value: 0.45, unit: '1', low: 0.2, high: 0.5, grade: 'C', source: SRC.harvey2018, dossier: `${P05} §4.2, §4.11.1`, status: 'proposed-fit', label: 'Partition gain of fast adaptation A_f', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.35; ketones/integration/targets.ts); was 0.35 (registry high)' },
  { id: 'ketones.aHs', value: 0.30, unit: '1', low: 0.3, high: 0.8, grade: 'C', source: `${SRC.owen1969}; ${SRC.owenReichard1971}`, dossier: `${P05} §4.2, §4.11.2`, status: 'proposed-fit', label: 'Partition gain of slow adaptation A_s', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.5 (registry low); second-line retune knob (MODEL_SPEC §11.2)' },
  { id: 'ketones.kProt', value: 0.06, unit: 'per 90 g/d protein', low: 0, high: 0.15, grade: 'C', source: `diet data 05 §4.8 (best joint fit 0-0.15); ${SRC.hall2010}`, dossier: `${P05} §4.2, §4.8`, status: 'proposed-fit', label: 'Protein brake on ketogenesis', note: 'Calibrated in the coupled engine (integrator A2, 2026-09-30, second pass after ketones switched to 05\'s own insulin proxy `insulinRefRel`): coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7 very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman); ketones/integration/targets.ts; was 0.15 (05 §4.8: best joint fit 0-0.15); rejected alternative (M20): Hall 2010 k_P = 0.69 (protein-modified fast halves ketonaemia); second-line retune knob (MODEL_SPEC §11.2)' },
  { id: 'ketones.pRef', value: 90, unit: 'g/d', low: 90, high: 90, grade: 'C', source: '05 §4.17 K.P_ref', dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Protein normalisation of the brake' },
  { id: 'ketones.tauProt', value: 8, unit: 'h', low: 6, high: 24, grade: 'C', source: '05 §4.2 (PROPOSED)', dossier: `${P05} §4.2`, status: 'proposed-fit', label: 'Protein memory time constant' },
  { id: 'ketones.etohProdCut', value: 0.5, unit: '1', low: 0.5, high: 0.5, grade: 'D', source: '15 §4.10 assumption (moderate-dose ketone data not retrieved)', dossier: '15 §4.10', status: 'unverified', label: 'Ketogenesis reduction while ethanol is present', note: 'K_prod × (1 − 0.5·[EtOH > 0])' },

  // ---------------------------------------------------------------- FFA supply (05 §4.3)
  { id: 'ketones.f0', value: 0.50, unit: 'mmol/L', low: 0.44, high: 0.6, grade: 'B', source: `${SRC.rosenbaum2019}; ${SRC.owenReichard1971}; McDougal 2018 PMID 29931424`, dossier: `${P05} §4.3`, status: 'verified', label: 'Overnight-fasted FFA on a mixed diet', note: 'value = 05 §4.3 (the first coupled pass used 0.52); range = cited data points 0.44-0.6 mM' },
  { id: 'ketones.lipoA', value: 0.25, unit: '1', low: 0.25, high: 0.25, grade: 'B', source: `05 fit to ${SRC.klein1993}; ${SRC.rosenbaum2019}`, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'Insulin-independent share of lipolysis (lipo(I) floor term)' },
  { id: 'ketones.lipoExp', value: 1.2, unit: '1', low: 1.2, high: 1.2, grade: 'B', source: `05 fit to ${SRC.klein1993}; ${SRC.rosenbaum2019}`, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'Insulin exponent of lipo(I)' },
  { id: 'ketones.tauFUp', value: 1.0, unit: 'h', low: 1.0, high: 1.0, grade: 'B', source: '05 §4.3 (PROPOSED)', dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'FFA time constant, rising' },
  { id: 'ketones.tauFDown', value: 1.5, unit: 'h', low: 1.5, high: 1.5, grade: 'B', source: SRC.gray1989, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'FFA time constant, falling' },
  { id: 'ketones.kFB', value: 15, unit: 'mmol/L TKB', low: 15, high: 15, grade: 'B', source: SRC.balasseNeef1975, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'Ketone antilipolytic feedback constant', note: 'under-predicts acute exogenous-ketone antilipolysis (Myette-Côté 2018)' },
  { id: 'ketones.eDef', value: 1.5, unit: '1', low: 1.5, high: 1.5, grade: 'C', source: `05 fit (${SRC.johnstone2008} vs Hall 2016 PMID 27385608)`, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'FFA gain per unit energy-deficit fraction' },
  { id: 'ketones.kMgF', value: 3.0, unit: '1', low: 3.0, high: 3.0, grade: 'D', source: `05 fit (${SRC.burke2021}; ${SRC.deru2021})`, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'FFA gain per unit muscle-glycogen deficit' },
  { id: 'ketones.exF', value: 0.4, unit: 'per unit x', low: 0.4, high: 0.4, grade: 'B', source: SRC.fery1983, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'Exercise lipolytic drive X_post' },
  { id: 'ketones.tauPostF', value: 3, unit: 'h', low: 3, high: 3, grade: 'B', source: SRC.fery1983, dossier: `${P05} §4.3`, status: 'proposed-fit', label: 'Post-exercise lipolytic drive decay' },

  // ---------------------------------------------------------------- adaptation (05 §4.11)
  { id: 'ketones.c50', value: 100, unit: 'g/d', low: 100, high: 100, grade: 'B', source: `05 calibration (${SRC.burke2021}; ${SRC.goedecke1999})`, dossier: `${P05} §4.11.1 (code form)`, status: 'proposed-fit', label: 'Carbohydrate half-point of A_f*' },
  { id: 'ketones.afHill', value: 3, unit: '1', low: 3, high: 3, grade: 'B', source: '05 §4.11.1', dossier: `${P05} §4.11.1`, status: 'proposed-fit', label: 'Hill exponent of A_f*' },
  { id: 'ketones.tauAfUp', value: 48, unit: 'h', low: 48, high: 48, grade: 'B', source: `${SRC.burke2021}; ${SRC.goedecke1999}`, dossier: `${P05} §4.11.1`, status: 'proposed-fit', label: 'Fast adaptation time constant, building' },
  { id: 'ketones.tauAfDn', value: 40, unit: 'h', low: 40, high: 40, grade: 'B', source: `${SRC.burke2021}; Carey 2001 PMID 11408421`, dossier: `${P05} §4.11.1`, status: 'proposed-fit', label: 'Fast adaptation time constant, decaying' },
  { id: 'ketones.afInitCarbG', value: 50, unit: 'g/d', low: 50, high: 50, grade: 'B', source: '05 §2 initial-value rule', dossier: `${P05} §2`, status: 'proposed-fit', label: 'Habitual carbohydrate below which A_f starts at 1' },
  { id: 'ketones.asLo', value: 0.5, unit: 'mmol/L', low: 0.5, high: 0.5, grade: 'C', source: `${SRC.owenReichard1971}; ${SRC.balasse1979}`, dossier: `${P05} §4.11.2`, status: 'proposed-fit', label: 'TKB where slow adaptation starts' },
  { id: 'ketones.asSpan', value: 2.0, unit: 'mmol/L', low: 2.0, high: 2.0, grade: 'C', source: `${SRC.owenReichard1971}; ${SRC.balasse1979}`, dossier: `${P05} §4.11.2`, status: 'proposed-fit', label: 'TKB span to full slow adaptation' },
  { id: 'ketones.tauAs', value: 120, unit: 'h', low: 120, high: 120, grade: 'C', source: `${SRC.owen1969}; ${SRC.owenReichard1971}`, dossier: `${P05} §4.11.2`, status: 'proposed-fit', label: 'Slow adaptation time constant' },

  // ---------------------------------------------------------------- MCT and exogenous ketones (05 §4.12)
  { id: 'ketones.yC8', value: 0.5, unit: 'mol TKB/mol FA', low: 0.5, high: 0.5, grade: 'B', source: `${SRC.stPierre2019}; ${SRC.vandenberghe2017}`, dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'Ketone yield of C8' },
  { id: 'ketones.yC10', value: 0.17, unit: 'mol TKB/mol FA', low: 0.17, high: 0.17, grade: 'B', source: SRC.stPierre2019, dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'Ketone yield of C10' },
  { id: 'ketones.mmolFaPerGC8', value: 6.37, unit: 'mmol FA/g TG', low: 6.37, high: 6.37, grade: 'A', source: 'DERIVED from tricaprylin MW 470.7', dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'Fatty acid per gram tricaprylin', draw: 'fixed' },
  { id: 'ketones.mmolFaPerGC10', value: 5.41, unit: 'mmol FA/g TG', low: 5.41, high: 5.41, grade: 'A', source: 'DERIVED from tricaprin MW 554.8', dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'Fatty acid per gram tricaprin', draw: 'fixed' },
  { id: 'ketones.mctMealFactor', value: 0.5, unit: '1', low: 0.5, high: 0.5, grade: 'B', source: SRC.stPierre2019, dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'MCT ketogenicity with a recent meal' },
  { id: 'ketones.mctMealGramThr', value: 50, unit: 'g macronutrients', low: 50, high: 50, grade: 'B', source: '05 §4.12 / §4.17 (fedRecent)', dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'Meal size that counts as "fed" for MCT and exogenous ketones' },
  { id: 'ketones.mctMealWindowH', value: 3, unit: 'h', low: 3, high: 3, grade: 'B', source: '05 §4.12 / §4.17 (fedRecent)', dossier: `${P05} §4.12`, status: 'proposed-fit', label: 'Window after such a meal' },
  { id: 'ketones.mctC8Share', value: 0.6, unit: 'frac', low: 0, high: 1, grade: 'D', source: 'ENGINEERING DEFAULT (schedule gives MCT grams only)', dossier: 'MODEL_SPEC §1.7', status: 'unverified', label: 'C8 share of MCT grams' },
  { id: 'ketones.exoTpkFasted', value: 0.5, unit: 'h', low: 0.5, high: 0.5, grade: 'B', source: `${SRC.stubbs2017}; Clarke 2012`, dossier: `${P05} §4.4, §4.12`, status: 'proposed-fit', label: 'Exogenous-ketone kernel peak, fasted (within-hour shape only)', note: 'shapes intake\'s hourly exoKetoneMmolH over the four 15-min pool sub-steps; the hourly amount is intake\'s' },
  { id: 'ketones.exoTpkFed', value: 0.75, unit: 'h', low: 0.75, high: 0.75, grade: 'B', source: SRC.stubbs2017, dossier: `${P05} §4.4, §4.12`, status: 'proposed-fit', label: 'Exogenous-ketone kernel peak, fed (within-hour shape only)' },

  // ---------------------------------------------------------------- outputs (05 §4.5, §4.11.3, §4.15.2, §6)
  { id: 'ketones.rBhb0', value: 1.5, unit: '1', low: 0.9, high: 2.1, grade: 'C', source: SRC.owenReichard1971, dossier: `${P05} §4.5`, status: 'proposed-fit', label: 'BHB:AcAc ratio intercept', note: '±40 % (dossier)' },
  { id: 'ketones.rBhbSlope', value: 0.3, unit: 'per mM TKB', low: 0.18, high: 0.42, grade: 'C', source: SRC.owenReichard1971, dossier: `${P05} §4.5`, status: 'proposed-fit', label: 'BHB:AcAc ratio slope', note: '±40 % (dossier)' },
  { id: 'ketones.eKetKcalPerMmol', value: 0.46, unit: 'kcal/mmol', low: 0.46, high: 0.46, grade: 'B', source: `${SRC.hall2010} (DERIVED: ρK 4.45 kcal/g × 0.104 g/mmol)`, dossier: `${P05} §4.15.2, §6`, status: 'proposed-fit', label: 'Energy of urinary ketones' },
  { id: 'ketones.brainMax', value: 0.70, unit: 'frac', low: 0.70, high: 0.70, grade: 'C', source: `${SRC.courchesne2013}; ${SRC.courchesne2017}; Blomqvist 2002 PMID 12067838`, dossier: `${P05} §4.11.3`, status: 'proposed-fit', label: 'Maximal brain energy share from ketones' },
  { id: 'ketones.brainK', value: 1.5, unit: 'mmol/L TKB', low: 1.5, high: 1.5, grade: 'C', source: `${SRC.courchesne2013}; ${SRC.courchesne2017}`, dossier: `${P05} §4.11.3`, status: 'proposed-fit', label: 'TKB at half-maximal brain ketone share' },

  // ---------------------------------------------------------------- ketosis state machine (05 §6, MODEL_SPEC §7.1)
  { id: 'ketones.thrLight', value: 0.2, unit: 'mmol/L BHB', low: 0.2, high: 0.2, grade: 'A', source: '05 §6 convention', dossier: `${P05} §6`, status: 'verified', label: 'Light ketosis threshold', draw: 'fixed' },
  { id: 'ketones.thrNutritional', value: 0.5, unit: 'mmol/L BHB', low: 0.5, high: 0.5, grade: 'A', source: `${SRC.hallberg2018}; Fernández-Verdejo 2023 PMID 37703994`, dossier: `${P05} §6`, status: 'verified', label: 'Nutritional ketosis threshold', draw: 'fixed' },
  { id: 'ketones.thrExit', value: 0.4, unit: 'mmol/L BHB', low: 0.4, high: 0.4, grade: 'B', source: 'MODEL_SPEC §7.1 event hysteresis', dossier: 'MODEL_SPEC §7.1', status: 'proposed-fit', label: 'Ketosis exit threshold (hysteresis)', draw: 'fixed' },
  { id: 'ketones.hystH', value: 2, unit: 'h', low: 2, high: 2, grade: 'B', source: 'MODEL_SPEC §1.7 step 7 (2-h hysteresis)', dossier: 'MODEL_SPEC §1.7', status: 'proposed-fit', label: 'Hours a crossing must persist before an event', draw: 'fixed' },
  { id: 'ketones.thrHigh', value: 3.0, unit: 'mmol/L BHB', low: 3.0, high: 3.0, grade: 'A', source: SRC.umpierrez2024, dossier: `${P05} §6, §9`, status: 'verified', label: 'Fasting-ketosis / warning threshold', draw: 'fixed' },
  { id: 'ketones.thrMax', value: 6.0, unit: 'mmol/L BHB', low: 6.0, high: 6.0, grade: 'A', source: '05 §6 convention', dossier: `${P05} §6`, status: 'verified', label: 'Warning threshold at any intake', draw: 'fixed' },
  { id: 'ketones.adaptedThr', value: 0.9, unit: '0..1', low: 0.9, high: 0.9, grade: 'B', source: 'MODEL_SPEC §7.1 (ketoAdapted event)', dossier: 'MODEL_SPEC §7.1', status: 'proposed-fit', label: 'A_f level reported as keto-adapted', draw: 'fixed' },
];
