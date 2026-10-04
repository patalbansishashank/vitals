/**
 * Parameter registry of the muscle module (docs/MODEL_SPEC.md §1.9; §0.4 registry rules).
 * Every number is copied from dossier 09 (owner) or 03 / 15 / 21 as cited; status follows the dossier's label
 * (PROPOSED / PROPOSED FIT → 'proposed-fit', UNVERIFIED → 'unverified'). Where a ruling rejected the dossier's value
 * the alternative is the registry low/high and is named in `note` (R-MEM kMem, R-STR nMaxSlope, R-CREATINE crAccretion).
 */
import type { EvidenceGrade, ParamDef, ParamStatus, DrawKind } from '../../types/params';

// ------------------------------------------------------------------ sources (author year + PMID/DOI as in the dossiers)
const PELLAND = 'Pelland 2026 PMID 41343037 doi:10.1007/s40279-025-02344-w';
const ROBINSON = 'Robinson 2024 PMID 38970765';
const LASEVICIUS = 'Lasevicius 2018 PMID 29564973';
const SINGER = 'Singer 2024 PMID 39205815';
const HENSELMANS = 'Henselmans 2022 PMID 35215506';
const PHILLIPS97 = 'Phillips 1997 PMID 9252485; Tang 2008 PMID 18032468';
const DAMAS = 'Damas 2016 PMID 27219125; Damas 2016 PMID 26280652';
const BENITO = 'Benito 2020 PMID 32079265; Morton 2018 PMID 28698222; Peterson 2011 PMID 20543750';
const KOURI = 'Kouri 1995 PMID 7496846';
const KOSEK = 'Kosek 2006 PMID 16614355; Peterson 2011 PMID 20543750';
const MURPHY = 'Murphy & Koehler 2022 PMID 34623696; Longland 2016 PMID 26817506; Garthe 2011 PMID 21558571';
const HELMS = 'Helms 2023 PMID 37914977; Garthe 2013 PMID 23679146';
const SARDELI = 'Ballor 1994 PMID 8130813; Sardeli 2018 PMID 29596307';
const BICKEL = 'Bickel 2011 PMID 21131862';
const DETRAIN = 'Ogasawara 2013 PMID 23053130; Psilander 2019 PMID 30991013; Hwang 2017 PMID 28328712';
const MEMORY = 'Seaborne 2018 PMID 29382913; Psilander 2019 PMID 30991013';
const MYONUCLEI = 'Cumming 2024 PMID 39159314; Seaborne 2018 PMID 29382913; Snijders 2020 PMID 32175681 (counter-evidence: Rahmati 2022 PMID 35961635)';
const FATIGUE = 'Morán-Navarro 2017 PMID 28965198';
const SCHUMANN = 'Schumann 2022 PMID 34757594';
const STRENGTH = 'Abe 2000 PMID 10638374; Seynnes 2007 PMID 17053104; Psilander 2019 PMID 30991013';
const LOPEZ = 'Lopez 2021 PMID 33433148';
const REGION = 'Abe 2000 PMID 10638374; Janssen 2000 PMID 10904038';
const HUBAL = 'Hubal 2005 PMID 15947721; Ahtiainen 2016 PMID 26767377';
const MORTON = 'Morton 2018 PMID 28698222';
const DIST = 'Mamerow 2014 PMID 24477298; Yasuda 2020 PMID 32321161; Hudson 2020 PMID 32429355; Moore 2015 PMID 25056502';
const MPS_FIT = 'Trommelen 2023 PMID 38118410; Witard 2014 PMID 24257722; Moore 2015 PMID 25056502';
const MPS_BASAL = 'Phillips 1999 PMID 9886957';
const MPS_RT = 'Phillips 1997 PMID 9252485; Burd 2011 PMID 21289204; Tang 2008 PMID 18032468';
const ARETA = 'Areta 2014 PMID 24595305; Hector 2018 PMID 28899879; Pasiakos 2010 PMID 20164371';
const HELMS14 = 'Helms 2014 PMID 24092765; Hector 2018 PMID 29182451';
const BREEN = 'Breen 2013 PMID 23589526';
const BEALS = 'Beals 2016 PMID 27604771; Beals 2018 (03 ref 90)';
const PARR = 'Parr 2014 PMID 24533082';
const CREATINE = 'Burke 2023 PMID 37432300; Chilibeck 2017 PMID 29138605';
const CWI = 'Grgic 2023 PMID 35068365; Roberts 2015 PMID 26174323';
const SPEC = 'MODEL_SPEC §1.9 (orchestrator ruling)';
const HABITS = 'design/screens/your-body.md Habits (training-history keys none / < 1 yr / 1-3 yrs / 3+ yrs; the app maps them to 0 / 0.5 / 2 / 5 years); MODEL_SPEC §1.9 TS₀ rule';

function p(
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  extra?: { draw?: DrawKind; note?: string; label?: string },
): ParamDef {
  return { id: `muscle.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra };
}
/** Fixed (not drawn) parameter: low = high = value. */
function f(
  name: string,
  value: number,
  unit: string,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  note?: string,
): ParamDef {
  return p(name, value, unit, value, value, grade, source, dossier, status, note ? { note } : undefined);
}

/** Region order = TRAINING_REGIONS (chest, upperBack, shoulders, arms, core, glutes, quads, hamstrings, calves). */
export const REGION_KEYS = ['Chest', 'UpperBack', 'Shoulders', 'Arms', 'Core', 'Glutes', 'Quads', 'Hamstrings', 'Calves'] as const;
/** 09 §4.15 default share w_r of trainable muscle (grade D, PROPOSED). */
const REGION_SHARE = [0.08, 0.17, 0.07, 0.1, 0.06, 0.12, 0.2, 0.14, 0.06] as const;
/** 09 §4.15 novice responsiveness ρ_reg,r (calves 0.8 UNVERIFIED). */
const REGION_RHO = [1.3, 1.2, 1.3, 1.3, 1.0, 1.0, 1.0, 1.0, 0.8] as const;

const regionParams: ParamDef[] = [];
REGION_KEYS.forEach((k, i) => {
  regionParams.push(f(`w${k}`, REGION_SHARE[i]!, '1', 'D', REGION, '09 §4.15', 'proposed-fit', 'share of trainable muscle; the 9 shares sum to 1'));
  regionParams.push(f(`rhoReg${k}`, REGION_RHO[i]!, '1', 'D', REGION, '09 §4.15', k === 'Calves' ? 'unverified' : 'proposed-fit'));
});

export const MUSCLE_PARAMS: readonly ParamDef[] = [
  // ---------------------------------------------------------------- 09 §4.1 effective-set collapse
  p('kRir', 0.059, '1/RIR', 0.02, 0.09, 'B', ROBINSON, '09 §4.1', 'verified', { label: 'RIR slope of f_RIR (60-80 %1RM)' }),
  f('kRirHeavy', 0.045, '1/RIR', 'C', ROBINSON, '09 §4.1', 'proposed-fit', 'k_RIR at loads ≥ loadHeavyPct (direction only in [9])'),
  f('kRirLight', 0.075, '1/RIR', 'C', ROBINSON, '09 §4.1', 'proposed-fit', 'k_RIR at loads < loadModeratePct'),
  f('loadHeavyPct', 80, '%1RM', 'C', `${ROBINSON}; ${LOPEZ}`, '09 §4.1, §4.14', 'proposed-fit', 'heavy-load threshold (k_RIR and f_loadS)'),
  f('loadModeratePct', 60, '%1RM', 'C', `${ROBINSON}; ${LOPEZ}`, '09 §4.1, §4.14', 'proposed-fit', 'light/moderate threshold (k_RIR and f_loadS)'),
  f('loadFullPct', 35, '%1RM', 'A', LASEVICIUS, '09 §4.1', 'verified', 'f_load = 1 at or above this load (sets near failure)'),
  f('loadVeryLightPct', 20, '%1RM', 'B', LASEVICIUS, '09 §4.1', 'verified'),
  p('fLoad20', 0.45, '1', 0.4, 0.6, 'B', LASEVICIUS, '09 §4.1', 'proposed-fit', { label: 'f_load at 20 %1RM' }),
  f('fLoadVeryLight', 0.35, '1', 'D', LASEVICIUS, '09 §4.1', 'unverified', 'f_load below 20 %1RM (extrapolation)'),
  p('fRest60', 0.88, '1', 0.8, 1.0, 'B', SINGER, '09 §4.1', 'proposed-fit', { label: 'f_rest for rest ≤ 60 s' }),
  f('fRest90', 0.95, '1', 'B', SINGER, '09 §4.1', 'proposed-fit', 'f_rest for 60-90 s rest'),
  f('restShortSec', 60, 's', 'B', SINGER, '09 §4.1', 'verified'),
  f('restFullSec', 90, 's', 'B', SINGER, '09 §4.1', 'verified', 'no further benefit beyond ~90 s'),
  f('wIndirect', 0.5, '1', 'A', PELLAND, '09 §4.1', 'verified', 'fractional counting of indirect sets; applied upstream by the exercise library (ResistanceSession.setsByRegion is already fractionated)'),
  f('fFastHV', 0.95, '1', 'C', HENSELMANS, '09 §4.1, §4.12', 'proposed-fit', 'multiplier on sets beyond fastHVSets per region in one session when glycogen-depleted'),
  f('fastHVSets', 10, 'sets', 'C', HENSELMANS, '09 §4.1', 'proposed-fit'),
  f('fastHVGlycogenRel', 0.5, 'rel', 'C', SPEC, 'MODEL_SPEC §1.9 step 1', 'proposed-fit', 'glycogen-depleted = muscleGlycogenRel below this'),
  f('fConc', 1.0, '1', 'A', SCHUMANN, '09 §4.12', 'verified', 'concurrent aerobic training: no hypertrophy interference (SMD −0.01)'),

  // ---------------------------------------------------------------- 09 §4.2-4.3 volume and frequency
  f('beta', 0.01768, '1', 'A', PELLAND, '09 §4.2', 'proposed-fit', 'G(V) = exp(β(√(V+1) − 1)) − 1, our fit of the published table'),
  f('vCap', 40, 'sets/wk', 'C', PELLAND, '09 §4.2', 'proposed-fit'),
  f('vRef', 12, 'sets/wk', 'A', PELLAND, '09 §4.2', 'verified', 'literature median fractional sets per week (f_V = 1)'),
  f('fF1', 0.9, '1', 'B', PELLAND, '09 §4.3', 'proposed-fit'),
  f('fF2', 1.0, '1', 'B', PELLAND, '09 §4.3', 'proposed-fit'),
  f('fF3', 1.05, '1', 'B', PELLAND, '09 §4.3', 'proposed-fit', 'F ≥ 3 sessions per region per week'),
  f('kFS', 0.2395, '1', 'B', PELLAND, '09 §4.3', 'proposed-fit', 'strength practice factor f_FS coefficient'),

  // ---------------------------------------------------------------- 09 §4.4 post-exercise MPS kernel
  f('kernelA0', 1.0, '1', 'B', PHILLIPS97, '09 §4.4', 'proposed-fit', 'A(H) = kernelA0 + kernelAH·H'),
  f('kernelAH', 0.6, '1', 'B', PHILLIPS97, '09 §4.4', 'proposed-fit'),
  f('kernelTau0', 30, 'h', 'B', PHILLIPS97, '09 §4.4', 'proposed-fit', 'τ(H) = kernelTau0 − kernelTauH·H'),
  f('kernelTauH', 20, 'h', 'B', PHILLIPS97, '09 §4.4', 'proposed-fit'),
  f('kernelRampH', 3, 'h', 'B', PHILLIPS97, '09 §4.4', 'proposed-fit'),
  f('kernelSets', 4, 'sets', 'D', PHILLIPS97, '09 §4.4', 'proposed-fit', 'a(s) = 1 − exp(−s/kernelSets)'),

  // ---------------------------------------------------------------- 09 §4.5 habituation and swelling
  f('tauHabUp', 14, 'd', 'C', DAMAS, '09 §4.5', 'proposed-fit'),
  f('tauHabDown', 60, 'd', 'C', DAMAS, '09 §4.5', 'unverified'),
  f('swellA', 0.05, '1', 'C', DAMAS, '09 §4.5', 'proposed-fit'),
  f('tauSwell', 7, 'd', 'C', DAMAS, '09 §4.5', 'proposed-fit'),
  f('swellVRef', 10, 'sets/wk', 'C', DAMAS, '09 §4.5', 'proposed-fit'),

  // ---------------------------------------------------------------- 09 §4.6 gain rate, potential, TS0
  f('kG', 0.001507, '1/d', 'C', BENITO, '09 §4.6', 'proposed-fit', '0.55 /yr'),
  p('dFfmiPotM', 6.0, 'kg/m2', 5, 7, 'D', KOURI, '09 §4.6', 'proposed-fit'),
  p('dFfmiPotF', 4.3, 'kg/m2', 3.3, 5.3, 'D', KOURI, '09 §4.6', 'proposed-fit'),
  f('ts0YearRate', 0.47, '1/y', 'C', BENITO, '09 §4.6', 'proposed-fit', 'TS₀ = 1 − exp(−0.47·Y_eff)'),
  f('ts0Cap', 0.95, '1', 'D', KOURI, '09 §4.6', 'proposed-fit', 'cap of the FFMI route and the responder rescaling'),
  f('tsCap', 0.98, '1', 'D', KOURI, '09 §4.9', 'proposed-fit'),
  f('histYearsLt1', 0.5, 'y', 'D', HABITS, 'MODEL_SPEC §1.9 (TS₀)', 'proposed-fit', "Y_eff of the habits bucket '< 1 y' when no training years are entered (the UI's representative value)"),
  f('histYears1to3', 2, 'y', 'D', HABITS, 'MODEL_SPEC §1.9 (TS₀)', 'proposed-fit', "Y_eff of the habits bucket '1-3 y' when no training years are entered"),
  f('histYearsGt3', 5, 'y', 'D', HABITS, 'MODEL_SPEC §1.9 (TS₀)', 'proposed-fit', "Y_eff of the habits bucket '> 3 y' when no training years are entered"),

  // ---------------------------------------------------------------- 09 §4.7 age
  f('ageHypStart', 40, 'y', 'C', KOSEK, '09 §4.7', 'proposed-fit'),
  f('ageHypSlope', 0.0086, '1/y', 'C', KOSEK, '09 §4.7', 'proposed-fit'),
  f('ageHypFloor', 0.6, '1', 'C', KOSEK, '09 §4.7', 'proposed-fit'),

  // ---------------------------------------------------------------- 09 §4.8 energy, protein, retention
  p('d0', 0.3, '1', 0.2, 0.45, 'B', MURPHY, '09 §4.8', 'proposed-fit', { label: 'deficit giving zero accretion (f_E = 0)' }),
  p('rhoMax', 0.5, '1', 0.5, 1.0, 'C', MURPHY, '09 §4.8; MODEL_SPEC R-PROT2', 'proposed-fit', {
    label: 'maximum protein rescue in deficit',
    note: "R-PROT2 fallback applied (WP-M8 2026-09-30): with 03's M_P in composition's partition and 09's ρ(P) both active, 09's 0.8 put the full-engine Murphy zero crossing at 810 kcal/d (500-700); 0.5 gives 660 (1.6 g/kg) / 604 kcal/d (1.3 g/kg, Murphy's fat-based deficit). 09's 0.8 is inside the range",
  }),
  f('rhoPLow', 1.2, 'g/kg/d', 'C', MURPHY, '09 §4.8', 'proposed-fit', 'protein (g/kg BW) where the rescue ρ(P) starts'),
  f('rhoPHigh', 2.2, 'g/kg/d', 'C', MURPHY, '09 §4.8', 'proposed-fit', 'protein (g/kg BW) of the full rescue'),
  f('bS', 0.15, '1', 'C', HELMS, '09 §4.8', 'proposed-fit', 'surplus bonus'),
  f('eSat', 0.1, '1', 'C', HELMS, '09 §4.8', 'proposed-fit', 'surplus fraction saturating the bonus'),
  p('rMax', 0.75, '1', 0.5, 0.95, 'B', SARDELI, '09 §4.8', 'proposed-fit', { label: 'maximum RT retention of non-RT lean loss' }),
  f('vRYoung', 6, 'sets/wk', 'C', SARDELI, '09 §4.8', 'proposed-fit', 'V_R at age ≤ vRAgeLo'),
  f('vROld', 10, 'sets/wk', 'C', SARDELI, '09 §4.8', 'proposed-fit', 'V_R at age ≥ vRAgeHi'),
  f('vRAgeLo', 50, 'y', 'C', SARDELI, '09 §4.8', 'proposed-fit'),
  f('vRAgeHi', 70, 'y', 'C', SARDELI, '09 §4.8', 'proposed-fit'),
  f('smFrac', 0.7, '1', 'C', BENITO, '09 §4.9', 'proposed-fit', 'skeletal-muscle share of training-attributable FFM (SMM 1.11 / FFM 1.56 kg)'),

  // ---------------------------------------------------------------- 09 §4.10 detraining and memory
  f('vMaintYoung', 3, 'sets/wk', 'C', BICKEL, '09 §4.10', 'unverified', 'age ≤ 50 (absolute sets our reading of the protocol)'),
  f('vMaint70', 9, 'sets/wk', 'C', BICKEL, '09 §4.10', 'proposed-fit', 'at age 70 (linear from 50)'),
  f('vMaintOld', 10, 'sets/wk', 'C', BICKEL, '09 §4.10', 'proposed-fit', 'above 75 (linear 70 → 75 between the stated anchors)'),
  f('vMaintAgeLo', 50, 'y', 'C', BICKEL, '09 §4.10', 'proposed-fit'),
  f('vMaintAgeMid', 70, 'y', 'C', BICKEL, '09 §4.10', 'proposed-fit'),
  f('vMaintAgeHi', 75, 'y', 'C', BICKEL, '09 §4.10', 'proposed-fit'),
  f('detrainOnsetD', 14, 'd', 'B', DETRAIN, '09 §4.10', 'proposed-fit', 'λ = clamp((T − onset)/ramp, 0, 1)'),
  f('detrainRampD', 14, 'd', 'B', DETRAIN, '09 §4.10', 'proposed-fit'),
  p('tauD', 70, 'd', 42, 140, 'C', DETRAIN, '09 §4.10', 'proposed-fit', { label: 'detraining time constant' }),
  p('kMem', 1.3, '1', 1.0, 1.3, 'C', MEMORY, '09 §4.10', 'proposed-fit', {
    note: "ruling R-REGAIN (2026-10-01): retraining after detraining at 09's pace with its ×1.3 memory boost (supersedes R-MEM's conservative 1.0, now the registry low; Psilander 2019 found no retraining advantage after 10 wk of training, hence grade C)",
  }),
  f('memThreshold', 0.95, '1', 'C', MEMORY, '09 §4.10', 'proposed-fit', 'boost while M_acc < memThreshold·M_peak'),
  p('detrainFloorFrac', 0.5, '1', 0.3, 0.7, 'C', MYONUCLEI, '09 §4.10; MODEL_SPEC §1.9 R-DETRAIN', 'proposed-fit', {
    label: 'retained share of long-term trained gains',
    note: 'ruling R-DETRAIN (release check 2026-10-01): detraining decays towards a floor, not to zero — a habitual lifter keeps this share of the trained gains held at t = 0 (myonuclear / epigenetic "muscle memory", 09 §4.10 [68, 70, 71]; [69] finds myonuclei not permanent in human atrophy, hence grade C). Gains accrued inside a run are not covered (Psilander 2019: 10-wk gains back to baseline after 20 wk)',
  }),
  f('detrainEventWindowD', 56, 'd', 'C', SPEC, 'MODEL_SPEC §1.9 / §7.1', 'proposed-fit', 'detrainingOnset only for regions trained in the last 8 weeks'),

  // ---------------------------------------------------------------- 09 §4.11 fatigue
  f('cFat', 0.02, '1/set', 'D', FATIGUE, '09 §4.11', 'proposed-fit'),
  f('fatFailBoost', 0.5, '1', 'D', FATIGUE, '09 §4.11', 'proposed-fit'),
  f('tauFatFail', 2, 'd', 'D', FATIGUE, '09 §4.11', 'proposed-fit'),
  f('tauFat', 1.5, 'd', 'D', FATIGUE, '09 §4.11', 'proposed-fit', 'without failure sets'),
  f('fatCap', 0.3, '1', 'D', FATIGUE, '09 §4.11', 'proposed-fit'),

  // ---------------------------------------------------------------- 09 §4.14 strength (R-STR)
  f('strAlpha', 1.0, '1', 'C', STRENGTH, '09 §4.14', 'unverified', 'force ∝ CSA'),
  f('nMaxBase', 0.05, '1', 'C', STRENGTH, '09 §4.14', 'proposed-fit'),
  p('nMaxSlope', 0.125, '1', 0.1, 0.2, 'C', STRENGTH, '09 §4.14', 'proposed-fit', {
    note: "ruling R-STR: 09's 0.20 (+31 % at 12 wk) refitted so the novice check gives +23 %; 0.20 = registry high",
  }),
  f('hSCoef', 0.14635, '1', 'B', PELLAND, '09 §4.2, §4.14', 'proposed-fit'),
  f('fLoadSMod', 0.85, '1', 'C', LOPEZ, '09 §4.14', 'proposed-fit', 'f_loadS at 60-80 %1RM'),
  f('fLoadSLight', 0.65, '1', 'C', LOPEZ, '09 §4.14', 'proposed-fit', 'f_loadS below 60 %1RM'),
  f('tauNUp', 21, 'd', 'C', STRENGTH, '09 §4.14', 'proposed-fit'),
  f('tauNOff', 280, 'd', 'C', STRENGTH, '09 §4.14', 'proposed-fit'),
  f('n0Frac', 0.8, '1', 'C', STRENGTH, '09 §2', 'proposed-fit', 'initial N = 0.8·N_max(TS₀) when currently training'),

  // ---------------------------------------------------------------- 09 §4.15-4.16 regions, individual response
  ...regionParams,
  p('uIndividual', 1, '1', 0.33, 3.0, 'B', HUBAL, '09 §4.16', 'proposed-fit', {
    draw: 'logTri',
    note: 'symmetric log-triangular with the SD of LogNormal σ 0.45 (MODEL_SPEC §8.1)',
  }),

  // ---------------------------------------------------------------- 09 §4.8 protein factor f_P inside A_r (ruling R-RT, revised)
  f('fP0', 0.44, '1', 'B', MORTON, '09 §4.8', 'proposed-fit',
    "f_P at ≤ pLow: f_P = fP0 + (1 − fP0)·clamp((P − pLow)/(pPlateau − pLow), 0, 1), P = 7-day mean quality-weighted protein, g/kg body mass/d (R-RT rev.: 09's per-kg-body-mass form restores 09 §7 #2/#3/#7 and 03 §7 #4). alt 03 f_Pgain per kg FFM (q0 0.49, λ 0.61 g/kg FFM) (03 §4.2): rejected — per-kg-FFM protein lifts older/obese people at 1.0-1.1 g/kg BW to q 1.5-1.7 g/kg FFM (f 0.80-0.87 vs 0.58-0.65) and misses Morton 1.27, Villareal and Sardeli"),
  f('pLow', 0.8, 'g/kg/d', 'B', MORTON, '09 §4.8', 'proposed-fit', 'protein below which f_P = fP0 (≈ RDA)'),
  f('pPlateau', 1.6, 'g/kg/d', 'A', MORTON, '09 §4.8', 'proposed-fit', 'Morton breakpoint 1.62 g/kg/d (95 % CI 1.03-2.20); f_P = 1 above'),

  // ---------------------------------------------------------------- 03 §4.8 distribution efficiency E_dist (daily formula)
  f('eDistMealPenalty', 0.06, '1', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistWindowPenalty', 0.05, '1', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistMealThresh', 0.28, 'g/kg FFM', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistAgeSlope', 0.8, '1', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistMinMealG', 15, 'g', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistSpacingH', 3, 'h', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistMealsRef', 3, 'meals', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistWindowRefH', 8, 'h', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistWindowSpanH', 4, 'h', 'C', DIST, '03 §4.8', 'proposed-fit'),
  f('eDistFloor', 0.83, '1', 'C', DIST, '03 §4.8', 'proposed-fit', 'stated range 0.83-1.0 (MODEL_SPEC §1.9); formula floor with ≥ 1 meal'),
  f('arAgeLo', 30, 'y', 'B', 'Moore 2015 PMID 25056502', '03 §4.7, §4.8, §4.14', 'proposed-fit', 'age ramp clamp((age − 30)/40, 0, 1)'),
  f('arAgeSpan', 40, 'y', 'B', 'Moore 2015 PMID 25056502', '03 §4.7, §4.8, §4.14', 'proposed-fit'),

  // ---------------------------------------------------------------- 03 §4.7 hourly MPS display layer
  f('s0', 0.045, '%/h', 'B', MPS_BASAL, '03 §4.7', 'verified', 'basal MPS'),
  f('kMps', 0.07, 'g/kg FFM/h', 'C', MPS_FIT, '03 §4.7', 'proposed-fit', 'half-saturation K of the feeding stimulus'),
  f('nMps', 4, '1', 'C', MPS_FIT, '03 §4.7', 'proposed-fit'),
  f('kAgeMps', 0.67, '1', 'B', 'Moore 2015 PMID 25056502', '03 §4.7, §4.14', 'proposed-fit', 'K_age = K·(1 + 0.67·ageRamp)'),
  f('aFed', 2.0, '× basal', 'B', MPS_FIT, '03 §4.7', 'proposed-fit', 'A: peak fed MPS ≈ 3× basal'),
  f('kR', 2.0, '1/h', 'C', MPS_FIT, '03 §4.7', 'proposed-fit'),
  f('mR', 4, '1', 'C', MPS_FIT, '03 §4.7', 'proposed-fit'),
  f('tauR', 4.5, 'h', 'C', MPS_FIT, '03 §4.7', 'proposed-fit'),
  f('aX', 1.1, '1', 'B', MPS_RT, '03 §4.7', 'proposed-fit'),
  f('bX', 1.5, '1', 'B', MPS_RT, '03 §4.7', 'proposed-fit'),
  f('tauXUntrained', 36, 'h', 'B', MPS_RT, '03 §4.7', 'proposed-fit'),
  f('tauXTrained', 12, 'h', 'B', MPS_RT, '03 §4.7', 'proposed-fit'),
  f('tauXOn', 1, 'h', 'C', MPS_RT, '03 §4.7', 'proposed-fit'),
  f('xNorm', 0.95, '1', 'C', MPS_RT, '03 §4.7', 'proposed-fit', 'X_RT normaliser'),
  // 03 §4.5 f_E,MPS (energy deficit on MPS) with x_P from 03 §4.4.2
  f('fEMpsSlope', 0.9, '1', 'B', ARETA, '03 §4.5', 'proposed-fit'),
  f('fEMpsProt', 0.5, '1', 'B', ARETA, '03 §4.5', 'proposed-fit'),
  f('fEMpsFloor', 0.5, '1', 'B', ARETA, '03 §4.5', 'proposed-fit'),
  f('tauEMps', 2, 'd', 'C', ARETA, '03 §4.5', 'unverified', 'onset and offset time constant'),
  f('xpKnee', 0.8, 'g/kg FFM/d', 'B', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('xpSatBase', 1.2, 'g/kg FFM/d', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('xpSatDeficit', 2.0, 'g/kg FFM/d', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('xpSatLean', 3.0, 'g/kg FFM/d', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('xpDeficitCap', 0.45, '1', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('xpMinSpan', 0.3, 'g/kg FFM/d', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('leanBfHigh', 0.3, '1', 'C', HELMS14, '03 §4.4.2', 'proposed-fit', 'leanness L = clamp((0.30 − bf)/0.20, 0, 1), women bf − 0.10'),
  f('leanBfSpan', 0.2, '1', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  f('leanFemaleOffset', 0.1, '1', 'C', HELMS14, '03 §4.4.2', 'proposed-fit'),
  // 03 §4.14 anabolic resistance (display layer only)
  f('arStepsFed', 0.74, '1', 'B', BREEN, '03 §4.14', 'proposed-fit'),
  f('arStepsThreshold', 1500, 'steps/d', 'B', BREEN, '03 §4.14', 'proposed-fit'),
  f('arStepsAgeMin', 65, 'y', 'C', BREEN, '03 §4.14, §9', 'proposed-fit', "'older users' (Breen: 72 y); 65 y = 03 §9 older-adult cut-off"),
  f('tauArOn', 5, 'd', 'C', BREEN, '03 §4.14', 'unverified'),
  f('tauArOff', 7, 'd', 'C', BREEN, '03 §4.14', 'unverified'),
  f('arObese', 0.63, '1', 'B', BEALS, '03 §4.14', 'proposed-fit'),
  f('bxObese', 0.6, '1', 'C', BEALS, '03 §4.14', 'proposed-fit', 'exercise synergy b_X × 0.6 at BMI ≥ 30'),
  f('bmiArLo', 25, 'kg/m2', 'B', BEALS, '03 §4.14', 'proposed-fit'),
  f('bmiArHi', 30, 'kg/m2', 'B', BEALS, '03 §4.14', 'proposed-fit'),

  // ---------------------------------------------------------------- 15 §4.10 alcohol, §4.12 creatine; 21 CWI
  f('alcProtSlope', 0.16, '1/(g/kg)', 'C', PARR, '15 §4.10', 'proposed-fit'),
  f('alcProtCap', 0.25, '1', 'C', PARR, '15 §4.10', 'proposed-fit', "dossier 'floor −0.25' = cap on the reduction (MODEL_SPEC R-minors)"),
  f('alcNoProtSlope', 0.25, '1/(g/kg)', 'C', PARR, '15 §4.10', 'proposed-fit'),
  f('alcNoProtCap', 0.37, '1', 'C', PARR, '15 §4.10', 'proposed-fit'),
  f('alcProtGkg', 0.3, 'g/kg', 'C', PARR, '15 §4.10', 'proposed-fit', 'protein within alcProtWindowH after the session'),
  f('alcProtWindowH', 2, 'h', 'C', PARR, '15 §4.10', 'proposed-fit'),
  f('alcWindowH', 8, 'h', 'C', PARR, '15 §4.10', 'proposed-fit', 'window from session end'),
  p('crAccretion', 0.05, '1', 0, 0.1, 'C', CREATINE, '15 §4.12', 'proposed-fit', {
    note: "ruling R-CREATINE: 21's 15 % accretion multiplier is outside; high 0.10",
  }),
  p('fCwi', 0.8, '1', 0.5, 1.0, 'B', CWI, '21 §4D-4, §7 #10', 'proposed-fit', {
    label: 'post-RT cold-water immersion multiplier',
    note: "multiplies the hypertrophy (A_r) and neural-strength stimulus of the sets of a resistance session followed by cold-water immersion (SessionResolved.coldWaterImmersion), set-weighted over the 7-day window; 21's value for limb immersion ≤ 15 °C (whole-body immersion 1.0 cannot be told apart by the boolean input)",
  }),
];
