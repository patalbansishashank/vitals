/**
 * Oracle comparisons of MODEL_SPEC §9.1 that run through the engine:
 *  O-1  Hall 2011 BWP port vs engine on macronutrient-neutral, no-RT scenarios (sedentary man/woman × −25 %, −500 kcal,
 *       +20 %, 1 y): ±1.5 kg at 6 mo, ±3 kg "at plateau" (1 y here; the BWP plateau is ≈ 3 y away)
 *  O-2  Negative control (dossier 01 §7.12): the BWP is blind to protein (identical energy ⇒ identical trajectory) while the
 *       engine must put more lean tissue on the high-protein arm of Longland 2016.
 * The oracle (`oracle/bwp.ts`) shares no code with the engine; `oracle/bwpAdapter.ts` feeds it the same person and the
 * intake the engine actually ate. The oracle's own correctness is established in `oracle/bwp.test.ts` (which runs for real).
 */
import { person, tdee0Of, type PersonaSpec } from '../fixtures/personas';
import { constantSchedule, kcalProgram, neutralMacros, pctMacros, pctProgram } from '../fixtures/programs';
import { above, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { Scenario } from '../harness/types';
import { dailyFuelBalance } from '../oracle/dailyFuel';
import { bwDiffVsBwp, bwpForArm, fatDiffVsBwp } from '../oracle/bwpAdapter';
import type { ArmView } from '../harness/view';
import { LONGLAND_ARMS } from './longland';

const SEDENTARY = { steps: 4000, sessionsPerWeek: 0 } as const;

const MAN_SPEC: PersonaSpec = { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, bodyFatPct: 25 };
const WOMAN_SPEC: PersonaSpec = { sex: 'female', ageYears: 42, heightCm: 165, weightKg: 72, bodyFatPct: 36 };

type Kind = 'minus25' | 'minus500' | 'plus20';
const KINDS: Record<Kind, { label: string; key: string }> = {
  minus25: { label: '−25 % of maintenance', key: 'm25' },
  minus500: { label: '−500 kcal/d', key: 'm500' },
  plus20: { label: '+20 % of maintenance', key: 'p20' },
};

function o1(who: 'man' | 'woman', kind: Kind): Scenario {
  const spec = who === 'man' ? MAN_SPEC : WOMAN_SPEC;
  const profile = person({ ...spec, ...SEDENTARY });
  const macros = neutralMacros(spec.sex);
  const program =
    kind === 'minus25'
      ? pctProgram('minus25', 75, macros)
      : kind === 'plus20'
        ? pctProgram('plus20', 120, macros)
        : kcalProgram('minus500', Math.round(tdee0Of(profile) - 500), macros);
  const k = KINDS[kind];
  return {
    id: `O-1-bwp-${who}-${k.key}`,
    dossier: 'O-1',
    target: `${who} ${k.key}`,
    title: `BWP oracle, sedentary ${who}, ${k.label}, 1 y`,
    level: 'O',
    gate: 'M',
    requires: REQUIRES.CORE,
    citation: 'Hall et al. 2011 Lancet 378:826 (PMID 21872751) web appendix = NIDDK Body Weight Planner; dossier 01 §4.2, §4.11 item 3, §4.12; MODEL_SPEC §9.1 O-1',
    notes:
      `Sedentary ${who} (${spec.ageYears} y, ${spec.heightCm} cm, ${spec.weightKg} kg, ${spec.bodyFatPct} % BF; 4 000 steps, no sessions), macronutrient-neutral (habitual split), no RT, ${k.label} for 365 d. ` +
      'The oracle starts from the engine\'s own baseline (EI0 = TDEE0, initial fat mass) and is fed the intake the engine ate, so the rows test dynamics only. Tolerances ±1.5 kg at 6 mo, ±3 kg at 1 y (spec: "at plateau"; the true plateau is ≈ 3 y). ' +
      'BW compares the morning scale weight with the oracle BW (F + L + glycogen·3.7 + ECF); FM compares the fat compartments (dossier 01 §4.11 item 3 asks for F as well as BW).',
    arms: { main: { profile, schedule: constantSchedule(365, program) } },
    expectations: [
      { id: 'bw182', label: 'body weight, engine − BWP at 6 mo', unit: 'kg', measure: (c) => bwDiffVsBwp(c.main, 182), check: val(0, 1.5), source: 'MODEL_SPEC §9.1 O-1 (±1.5 kg at 6 mo)' },
      { id: 'bw365', label: 'body weight, engine − BWP at 1 y', unit: 'kg', measure: (c) => bwDiffVsBwp(c.main, 365), check: val(0, 3), source: 'MODEL_SPEC §9.1 O-1 (±3 kg at plateau)' },
      { id: 'fm182', label: 'fat mass, engine − BWP at 6 mo', unit: 'kg', measure: (c) => fatDiffVsBwp(c.main, 182), check: val(0, 1.5), source: 'dossier 01 §4.11 item 3 (±1.5 kg at 6 mo)' },
      { id: 'fm365', label: 'fat mass, engine − BWP at 1 y', unit: 'kg', measure: (c) => fatDiffVsBwp(c.main, 365), check: val(0, 3), source: 'MODEL_SPEC §9.1 O-1 (±3 kg at plateau)' },
    ],
  };
}

export const O1_SCENARIOS: Scenario[] = (['man', 'woman'] as const).flatMap((who) => (['minus25', 'minus500', 'plus20'] as const).map((k) => o1(who, k)));

export const O2_NEGATIVE_CONTROL: Scenario = {
  id: 'O-2-negative-control-longland',
  dossier: 'O-2',
  target: 'Longland',
  title: 'Negative control: BWP is protein-blind, engine puts more lean on PRO than CON',
  level: 'O',
  gate: 'M',
  requires: REQUIRES.TRAINING,
  citation: 'Longland et al. 2016 Am J Clin Nutr 103:738; dossier 01 §7.12 (negative control); MODEL_SPEC §9.1 O-2',
  notes:
    'Arms are the Longland 2016 arms of `longland.ts` (1.2 vs 2.4 g/kg protein at identical energy and training). The BWP takes energy only, so its two trajectories must coincide ' +
    '(this row shows the oracle cannot see protein). The engine, with the RT/protein modules, must give PRO > CON in lean tissue (direction only).',
  arms: LONGLAND_ARMS,
  expectations: [
    { id: 'bwpBlind', label: 'BWP body weight, PRO − CON at 4 wk (no difference)', unit: 'kg', measure: (c) => bwpForArm(c.arm('pro')).bwKg[28]! - bwpForArm(c.arm('con')).bwKg[28]!, check: val(0, 1e-6), source: 'dossier 01 §7.12' },
    { id: 'bwpBlindFat', label: 'BWP fat mass, PRO − CON at 4 wk (no difference)', unit: 'kg', measure: (c) => bwpForArm(c.arm('pro')).fatKg[28]! - bwpForArm(c.arm('con')).fatKg[28]!, check: val(0, 1e-6), source: 'dossier 01 §7.12' },
    { id: 'engineDirection', label: 'engine lean tissue, PRO − CON at 4 wk (> 0)', unit: 'kg', measure: (c) => c.arm('pro').delta('leanTissue', 28) - c.arm('con').delta('leanTissue', 28), check: above(0), source: 'MODEL_SPEC §9.1 O-2 (direction)' },
  ],
};

// ------------------------------------------------------------------ O-3: ±5 % rule against the 04 §4.11 daily form

/**
 * Oracle values for an O-3 scenario. The 04 §4.11 law is anchored at the ENGINE's habitual steady state: G_ref = total glycogen
 * after 21 d on the habitual diet (arm `habitual`), k_G = CI_hab/G_ref². The oracle then starts the 7-day switch from G_ref, which
 * is what "7-d steady state at x %E" means physically; any difference between the engine's t = 0 glycogen and its habitual steady
 * state shows up as an error in the ΔG row (an initialisation defect, like O-12).
 */
function o3Oracle(main: ArmView, habitual: ArmView) {
  const gRef = habitual.after('glycogenTotal', habitual.nDays - 1);
  // like-for-like conventions (fixture fix, finisher 2026-09-30, A2's report): the engine books oxidised protein at
  // 4.0 kcal/g (MODEL_SPEC §0.2, §1.6 step 4) and its fat oxidation is the residual of its own expenditure, so the oracle
  // takes the engine's mean TEE of the 7 days (not TDEE0) and 4.0 kcal/g protein; the carbohydrate law itself is unchanged
  let tee = 0;
  for (let d = 0; d < 7; d++) tee += main.day('tdee', d) / 7;
  return {
    gRef,
    ...dailyFuelBalance({
      gRefG: gRef,
      ciHabG: main.profile.habitualCarbG,
      ciG: main.day('inCarbs', 0),
      teeKcal: tee,
      proteinOxG: main.day('inProtein', 0),
      proteinKcalPerG: 4.0,
      days: 7,
    }),
  };
}

function o3(carbPct: number): Scenario {
  const profile = person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, bodyFatPct: 25, steps: 7000 });
  return {
    id: `O-3-carb-${carbPct}pct`,
    dossier: 'O-3',
    target: `${carbPct} %E`,
    title: `±5 % rule vs 04 §4.11 daily form, ${carbPct} %E carbohydrate, 7 d`,
    level: 'O',
    gate: 'M',
    requires: REQUIRES.CORE,
    citation: 'Dossier 04 §4.11 (Hall-type quadratic law; Schrauwen 1997, Acheson 1988, Jebb 1996); MODEL_SPEC §9.1 O-3, risk 4; review m4',
    notes:
      `MAN (§9.3), isocaloric at 100 % of maintenance, protein 15.6 %E, carbohydrate ${carbPct} %E, fat = remainder, 7 days after the 14-d habitual burn-in. ` +
      'The oracle (`oracle/dailyFuel.ts`) integrates dG/dt = CI + GNG_gly − C_ox with C_ox = min(k_G G², (TEE−EE_ex)/4.1), k_G = CI_hab/G_ref², FAT_ox = TEE − 4.1 C_ox − 4.7 P_ox ' +
      '(protein at the engine\'s 4.0 kcal/g and TEE = the engine\'s own mean TEE of the 7 days — like-for-like conventions, fixture fix 2026-09-30; 04 §4.11 as written uses 4.7 kcal/g; fat at 9.44 kcal/g). G_ref is the engine\'s own glycogen after 21 d on the habitual diet (arm `habitual`), so the oracle starts from habitual steady state. ' +
      'Rows: engine day-7 CHO oxidation and fat oxidation within ±5 % of the oracle; glycogen at day 7 relative to G_ref within ±5 % of G_ref of the oracle (a relative tolerance on a near-zero ΔG at 50 %E would be meaningless). ' +
      'The spec\'s "±5 %" is applied as written; the 9.44 kcal/g conversion of fat oxidation is our assumption (9.0 would shift the fat row by 4.9 %).',
    arms: {
      main: { profile, schedule: constantSchedule(7, pctProgram(`carb${carbPct}`, 100, pctMacros(15.6, carbPct))) },
      habitual: { profile, schedule: constantSchedule(21, pctProgram('habitual', 100, pctMacros(15.6, 45.4))) },
    },
    expectations: [
      { id: 'choOx', label: 'CHO oxidation day 7, engine vs oracle', unit: '% diff', measure: (c) => 100 * (c.main.day('choOxidation', 6) / o3Oracle(c.main, c.arm('habitual')).choOxG[6]! - 1), check: val(0, 5), source: 'MODEL_SPEC §9.1 O-3 (±5 %)' },
      { id: 'fatOx', label: 'fat oxidation day 7, engine vs oracle', unit: '% diff', measure: (c) => 100 * (c.main.day('fatOxidation', 6) / o3Oracle(c.main, c.arm('habitual')).fatOxG[6]! - 1), check: val(0, 5), source: 'MODEL_SPEC §9.1 O-3 (±5 %)' },
      {
        id: 'dG',
        label: 'glycogen 7 d after the switch vs habitual steady state, engine − oracle (% of G_ref)',
        unit: '% of G_ref',
        measure: (c) => {
          const o = o3Oracle(c.main, c.arm('habitual'));
          return (100 * (c.main.after('glycogenTotal', 7) - o.gG[7]!)) / o.gRef;
        },
        check: val(0, 5),
        source: 'MODEL_SPEC §9.1 O-3 (±5 %)',
      },
    ],
  };
}

export const O3_SCENARIOS: Scenario[] = [30, 50, 70].map(o3);

export const SCENARIOS_ORACLE: Scenario[] = [...O1_SCENARIOS, O2_NEGATIVE_CONTROL, ...O3_SCENARIOS];
