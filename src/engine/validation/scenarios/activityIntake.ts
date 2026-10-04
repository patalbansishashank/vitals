/**
 * Activity intake (plan/01-after-launch item 1; research R1 §7 V1-V13; MODEL_SPEC §5.5): questionnaire answers → baseline
 * maintenance, against the published lifestyle-PAL table, the DLW-derived TEE equations (NASEM 2023, IAEA), the
 * occupation and step studies R1 cites, and the engine invariants the intake must not break (R-MAINT, O-12).
 *
 * Most rows test `resolveProfile`'s closed form (TDEE0, PAL0 = TDEE0/RMR0, the band); their arms still run the full engine
 * so every intake profile also passes conservation and the day-0 weigh-in (O-4, O-5). V11 and the desk-vs-manual steady
 * state are end-to-end. The reference people are R1 §3.3's (M 35 y 180 cm 90 kg, F 35 y 165 cm 65 kg, Mifflin RMR, no
 * sessions); "synthetic adults" are a fixed grid (both sexes × 25/40/55 y × BMI 20/26/32, plus two), never fitted.
 * R1's own arithmetic assumed a TEF fraction α0 = 0.10; the engine's α0 from the NHANES habitual split is ≈ 0.087, which
 * lowers every PAL0 by ≈ 1.4 % — the registered misses say so.
 */
import { resolveProfile } from '../../core/resolveProfile';
import { ACTIVITY_INTAKE_K } from '../../intake/activity';
import type { ActivityIntake, PersonProfile, ResolvedProfile } from '../../types';
import { START_DATE } from '../fixtures/personas';
import { constantSchedule, habitualWeekSchedule, maintenanceProgram } from '../fixtures/programs';
import { above, range, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Expectation, Scenario } from '../harness/types';
import type { ArmView } from '../harness/view';
import { iaeaTee, NASEM_SE_KCAL, nasemTee, type NasemCategory } from '../oracle/teeEquations';

const CORE = REQUIRES.CORE;
const R1_CITE = 'plan/01-after-launch/research/R1-activity-intake.md §7';

// ------------------------------------------------------------------ people and answers

interface Body {
  sex: 'male' | 'female';
  ageYears: number;
  heightCm: number;
  weightKg: number;
}
const M_REF: Body = { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 };
const F_REF: Body = { sex: 'female', ageYears: 35, heightCm: 165, weightKg: 65 };

function profileOf(b: Body, activity?: ActivityIntake, habits: PersonProfile['habits'] = {}): PersonProfile {
  return { schemaVersion: 1, body: { ...b }, habits: { ...(activity ? { activity } : {}), ...habits }, startDate: START_DATE };
}
const resolved = (b: Body, a?: ActivityIntake, habits?: PersonProfile['habits']): ResolvedProfile => resolveProfile(profileOf(b, a, habits));
const act = (v: ArmView) => v.profile.activity!;

/** 20 synthetic adults: both sexes × 25/40/55 y × BMI 20/26/32 (M 178 cm, F 164 cm) + a tall man and a short woman. */
const SYNTHETIC: readonly Body[] = (() => {
  const out: Body[] = [];
  for (const sex of ['male', 'female'] as const)
    for (const ageYears of [25, 40, 55])
      for (const bmi of [20, 26, 32]) {
        const heightCm = sex === 'male' ? 178 : 164;
        out.push({ sex, ageYears, heightCm, weightKg: Math.round(bmi * (heightCm / 100) ** 2 * 10) / 10 });
      }
  out.push({ sex: 'male', ageYears: 30, heightCm: 190, weightKg: 83 }, { sex: 'female', ageYears: 45, heightCm: 158, weightKg: 72.4 });
  return out;
})();

/** R1 §3.3 archetypes and their FAO/WHO lifestyle target (V1; on-feet may sit 0.1 below its band). */
const ARCHETYPES = {
  deskLittle: { label: 'desk, little moving', intake: { work: 'desk', steps: { source: 'wrist', workday: 5000, offDay: 5000 }, onFeetAtHome: 'little' }, band: [1.4, 1.5] },
  deskOrdinary: { label: 'desk, ordinary', intake: { work: 'desk', steps: { source: 'wrist', workday: 7000, offDay: 6000 }, onFeetAtHome: 'some' }, band: [1.4, 1.5] },
  mixed: { label: 'mixed job', intake: { work: 'mixed', steps: { source: 'wrist', workday: 8000, offDay: 7000 } }, band: [1.6, 1.7] },
  onFeet: { label: 'on feet (retail)', intake: { work: 'onFeet', steps: { source: 'wrist', workday: 11000, offDay: 7000 } }, band: [1.7, 1.9] },
  delivery: { label: 'walking delivery', intake: { work: 'onFeet', steps: { source: 'wrist', workday: 16000, offDay: 8000 } }, band: [1.7, 1.9] },
  trades: { label: 'trades', intake: { work: 'manualModerate', steps: { source: 'wrist', workday: 12000, offDay: 8000 } }, band: [1.8, 2.0] },
  heavy: { label: 'heavy manual', intake: { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 } }, band: [2.0, 2.4] },
  notWorking: { label: 'not working, busy home', intake: { work: 'notWorking', steps: { source: 'wrist', weeklyMean: 6000 }, onFeetAtHome: 'aLot' }, band: [1.4, 1.7] },
} as const satisfies Record<string, { label: string; intake: ActivityIntake; band: readonly [number, number] }>;
type ArchetypeId = keyof typeof ARCHETYPES;
const SKIP_ALL: ActivityIntake = {};

/** A cheap arm (7 days at maintenance) so closed-form rows also exercise the engine with the intake profile. */
const arm = (p: PersonProfile, label?: string): ArmSpec => ({ ...(label ? { label } : {}), profile: p, schedule: constantSchedule(7, maintenanceProgram(p.body.sex)) });

// ------------------------------------------------------------------ V1 FAO/WHO lifestyle PAL bands

const V1_ARMS: Record<string, ArmSpec> = {};
const V1_ROWS: Expectation[] = [];
for (const [who, body] of [['m', M_REF], ['f', F_REF]] as const) {
  for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
    const a = ARCHETYPES[id];
    const armId = `${who}-${id}`;
    V1_ARMS[armId] = arm(profileOf(body, a.intake), `${who === 'm' ? 'M' : 'F'} ${a.label}`);
    V1_ROWS.push({
      id: armId,
      label: `${who === 'm' ? 'man' : 'woman'}, ${a.label}: PAL0 = TDEE0/RMR0 (FAO ${a.band[0]}-${a.band[1]})`,
      unit: 'PAL',
      measure: (c) => act(c.arm(armId)).pal0,
      check: range(a.band[0], a.band[1]),
      source: 'FAO/WHO/UNU 2004; Black 1996 via Endotext NBK279077 (R1 V1, grade B)',
    });
  }
}

export const R1_V1_FAO: Scenario = {
  id: 'R1-V1-fao-lifestyle-pal',
  dossier: 'R1',
  target: 'V1',
  title: 'Activity intake archetypes vs the FAO/WHO lifestyle PAL table',
  level: 'O',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V1; FAO/WHO/UNU 2004 lifestyle table (Black 1996) via Endotext NBK279077`,
  notes:
    'R1 §3.3 archetypes for its two reference people. Targets: seated 1.4-1.5, mixed 1.6-1.7, standing/on-feet 1.8-1.9 (R1 allows −0.1: 1.7-1.9), moderate manual 1.8-2.0, heavy 2.0-2.4, not working 1.4-1.7. ' +
    'R1 computed its table with α0 = 0.10 (desk little 1.41, mixed 1.58, on feet 1.71); the engine solves α0 from the habitual macro split (≈ 0.087), 1.4 % lower PALs.',
  arms: V1_ARMS,
  expectations: V1_ROWS,
};

// ------------------------------------------------------------------ V2 NASEM 2023 categories

const VERY_ACTIVE_REC: ActivityIntake['recreation'] = [
  { label: 'cycling 45 min/d', intensity: 'moderate', minPerWeek: 7 * 45 },
  { label: 'jogging 25 min/d', intensity: 'vigorous', minPerWeek: 7 * 25 },
  { label: 'tennis 60 min/d', intensity: 'moderate', minPerWeek: 7 * 60 },
];
const V2_CASES: readonly { id: string; label: string; intake: ActivityIntake; cat: NasemCategory }[] = [
  { id: 'adl', label: '"ADL only" = desk, 5 000 steps', intake: { work: 'desk', steps: { source: 'wrist', weeklyMean: 5000 } }, cat: 'inactive' },
  { id: 'walk', label: '"ADL + 60-80 min walking 3-4 mph" = desk, 5 000 + 7 700 steps', intake: { work: 'desk', steps: { source: 'wrist', weeklyMean: 12700 } }, cat: 'lowActive' },
  { id: 'very', label: '"very active" = desk, 5 000 steps + 45 min cycling + 25 min jogging + 60 min tennis a day', intake: { work: 'desk', steps: { source: 'wrist', weeklyMean: 5000 }, recreation: VERY_ACTIVE_REC }, cat: 'veryActive' },
  { id: 'skip', label: 'everything skipped', intake: SKIP_ALL, cat: 'lowActive' },
];
const V2_ARMS: Record<string, ArmSpec> = {};
const V2_ROWS: Expectation[] = [];
for (const [who, body] of [['m', M_REF], ['f', F_REF]] as const) {
  for (const k of V2_CASES) {
    const armId = `${who}-${k.id}`;
    V2_ARMS[armId] = arm(profileOf(body, k.intake));
    const se = NASEM_SE_KCAL[body.sex];
    V2_ROWS.push({
      id: armId,
      label: `${who === 'm' ? 'man' : 'woman'}, ${k.label}: TDEE0 − NASEM ${k.cat} (± 1 SE ${se})`,
      unit: 'kcal/d',
      measure: (c) => c.arm(armId).profile.tdee0Kcal - nasemTee(body.sex, body.ageYears, body.heightCm, body.weightKg, k.cat),
      check: val(0, se),
      source: 'NASEM 2023 DRI for Energy ch. 7, Table 7-1 and the DLW equations via 02 §4.12 (R1 V2, grade A)',
    });
  }
}

export const R1_V2_NASEM: Scenario = {
  id: 'R1-V2-nasem-categories',
  dossier: 'R1',
  target: 'V2',
  title: 'Activity intake vs the NASEM 2023 PAL-category TEE equations',
  level: 'O',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V2; NASEM 2023 Dietary Reference Intakes for Energy (equations in dossier 02 §4.12)`,
  notes:
    'NASEM\'s category descriptions mapped onto answers as R1 V2 states; the walking example (7 700 extra steps ≈ 70 min at 110 steps/min) is matched to the low-active equation (its PAL falls in 1.53-1.68), the skipped intake to low active (R1: "skip-all within the low-active SE"). ' +
    'Tolerance = the SE of an individual prediction (men 342, women ≈ 250 kcal/d).',
  arms: V2_ARMS,
  expectations: V2_ROWS,
};

// ------------------------------------------------------------------ V3 skip-all population PAL

const skipPals = (): number[] => SYNTHETIC.map((b) => resolved(b, SKIP_ALL).activity!.pal0);

export const R1_V3_SKIP_ALL: Scenario = {
  id: 'R1-V3-skip-all-population',
  dossier: 'R1',
  target: 'V3',
  title: 'Everything skipped: PAL0 of 20 synthetic adults sits in NASEM "low active" (1.50-1.65)',
  level: 'O',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V3; NASEM 2023 (PAL categories ≈ quartiles of DLW PAL)`,
  notes: 'Skipped intake = the population mixture (job-class prior shares, 7 000 steps, "some" time on feet at home). Synthetic adults: both sexes × 25/40/55 y × BMI 20/26/32 (M 178 cm, F 164 cm), plus M 30 y 190 cm 83 kg and F 45 y 158 cm 72.4 kg.',
  arms: { main: arm(profileOf(M_REF, SKIP_ALL)) },
  expectations: [
    { id: 'min', label: 'lowest PAL0 of the 20 (≥ 1.50)', unit: 'PAL', measure: () => Math.min(...skipPals()), check: range(1.5, 1.65), source: 'R1 V3 (grade B)' },
    { id: 'max', label: 'highest PAL0 of the 20 (≤ 1.65)', unit: 'PAL', measure: () => Math.max(...skipPals()), check: range(1.5, 1.65), source: 'R1 V3 (grade B)' },
    { id: 'share153', label: 'share of the 20 not in NASEM "inactive" (PAL0 ≥ 1.53)', unit: '%', measure: () => (100 * skipPals().filter((x) => x >= 1.53).length) / SYNTHETIC.length, check: range(100, 100), gate: 'Q', source: 'R1 V3 "(not < 1.53)"' },
  ],
};

// ------------------------------------------------------------------ V4 IAEA DLW prediction interval

function iaeaMargins(): { worst: number; skipBiasMedianPct: number } {
  let worst = Number.POSITIVE_INFINITY;
  const bias: number[] = [];
  for (const b of SYNTHETIC) {
    const pi = iaeaTee(b.sex, b.ageYears, b.heightCm, b.weightKg);
    for (const a of [...Object.values(ARCHETYPES).map((x) => x.intake), SKIP_ALL]) {
      const t = resolved(b, a).tdee0Kcal;
      worst = Math.min(worst, t - pi.lo, pi.hi - t);
    }
    bias.push(100 * (resolved(b, SKIP_ALL).tdee0Kcal / pi.tee - 1));
  }
  bias.sort((x, y) => x - y);
  return { worst, skipBiasMedianPct: (bias[9]! + bias[10]!) / 2 };
}

export const R1_V4_IAEA: Scenario = {
  id: 'R1-V4-iaea-dlw-pi',
  dossier: 'R1',
  target: 'V4',
  title: 'Every archetype × 20 synthetic adults inside the IAEA DLW 95 % prediction interval',
  level: 'O',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V4; IAEA DLW equation (Bajunaid 2025) via dossier 02 §4.12`,
  notes: 'IAEA equation with the white-ethnicity dummy and elevation 158.5 m (the dossier\'s worked example convention). The skip-all bias is reported (R1 expects −5 to −12 %: DLW samples skew active).',
  arms: { main: arm(profileOf(F_REF, SKIP_ALL)) },
  expectations: [
    { id: 'insidePi', label: 'smallest distance of TDEE0 inside the 95 % PI over all 200 cases (> 0)', unit: 'kcal/d', measure: () => iaeaMargins().worst, check: above(0), source: 'R1 V4 (grade A)' },
    { id: 'skipBias', label: 'median skip-all bias vs the IAEA prediction (−12 … −5 %)', unit: '%', measure: () => iaeaMargins().skipBiasMedianPct, check: range(-12, -5), gate: 'Q', source: 'R1 V4 (reported)' },
  ],
};

// ------------------------------------------------------------------ V5-V10 closed-form anchors

export const R1_V5_V10: Scenario = {
  id: 'R1-V5-V10-intake-anchors',
  dossier: 'R1',
  target: 'V5-V10',
  title: 'Activity intake anchors: standing, step cost, Cambridge index spacing, occupational trend, postal workers, PAL cap',
  level: 'O',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V5-V10; Saeidifard 2018 PMID 29385357; Ohkawara 2011 (02 [48]); InterAct 2012 PMID 22089423; Church 2011 PMID 21647427; Tigbe 2011 (10 §4.14); FAO 2004; NASEM 2023`,
  notes:
    'V5: quiet-standing coefficient × 6 h × 65 kg. V6: wrist steps 8 973 → 29 588 for a 64.5-kg man (step driver). V7: Cambridge index occupation categories (desk / on feet / physical / heavy manual), population-default answers, PAEE = TDEE0 − RMR0 − TEF. ' +
    'V8: moderate-intensity job share 50 % → 20 % (Church 2011), light jobs at the prior\'s desk/mixed/on-feet proportions, moderate at its moderate/heavy proportions, 8 h × 5 d. V9: 70-kg man, walking postal (on feet, 16 035 workday steps) vs office (desk, 6 709), days off from the answers. ' +
    'V10: heavy manual 12 h × 6 d + 20 000 steps + 5 h vigorous sport a week; and a heavy labourer with 260 min vigorous sport a week (PAL0 between 2.4 and 2.5).',
  arms: { main: arm(profileOf({ sex: 'male', ageYears: 30, heightCm: 172, weightKg: 64.5 }, { steps: { source: 'wrist', weeklyMean: 29588 } })) },
  expectations: [
    { id: 'v5stand', label: 'V5 standing instead of sitting 6 h/d at 65 kg (+54 kcal/d)', unit: 'kcal/d', measure: () => ACTIVITY_INTAKE_K.quietStandKcalPerKgH * 6 * 65, check: range(40, 70), source: 'Saeidifard 2018 (R1 V5, grade A)' },
    {
      id: 'v6steps',
      label: 'V6 +20 615 wrist steps/d at 64.5 kg: step energy (+588 kcal/d ± 15 %)',
      unit: 'kcal/d',
      measure: (c) => {
        const lo = resolved({ sex: 'male', ageYears: 30, heightCm: 172, weightKg: 64.5 }, { steps: { source: 'wrist', weeklyMean: 8973 } }).activity!.stepsKcal;
        return act(c.main).stepsKcal - lo;
      },
      check: val(588, 0.15 * 588),
      source: 'Ohkawara 2011 calorimeter via 02 §4.6 / 10 §7 (R1 V6, grade B)',
    },
    ...(['male', 'female'] as const).map((sex): Expectation => ({
      id: `v7${sex}`,
      label: `V7 ${sex === 'male' ? 'men' : 'women'}: smallest PAEE step between adjacent Cambridge occupation categories (≥ ${sex === 'male' ? 110 : 87} kcal/d)`,
      unit: 'kcal/d',
      measure: () => {
        const body = sex === 'male' ? M_REF : F_REF;
        const paee = (['desk', 'onFeet', 'manualModerate', 'manualHeavy'] as const).map((work) => {
          const a = resolved(body, { work }).activity!;
          const tef = a.drivers.find((d) => d.id === 'digestion')!.kcal;
          return a.tdee0Kcal - a.base.rmr0Kcal - tef;
        });
        return Math.min(paee[1]! - paee[0]!, paee[2]! - paee[1]!, paee[3]! - paee[2]!);
      },
      check: above(sex === 'male' ? 110 : 87),
      source: 'InterAct 2012 / Wareham 2003 Cambridge index: 460 kJ (M) / 365 kJ (F) per category, attenuated (R1 V7, grade B)',
    })),
    {
      id: 'v8men',
      label: 'V8 men (90 kg): occupational energy fall when moderate jobs go 50 % → 20 % (142 kcal/d ± 40 %)',
      unit: 'kcal/d',
      measure: () => occupationalTrendKcal(90),
      check: val(142, 0.4 * 142),
      source: 'Church 2011 PMID 21647427, modelled (R1 V8, grade C)',
    },
    {
      id: 'v8all',
      label: 'V8 population (90-kg man and 65-kg woman): mean fall ≥ 100 kcal/d',
      unit: 'kcal/d',
      measure: () => (occupationalTrendKcal(90) + occupationalTrendKcal(65)) / 2,
      check: above(100),
      source: 'Church 2011 PMID 21647427 (R1 V8, grade C)',
    },
    {
      id: 'v9postal',
      label: 'V9 walking vs office postal workers, 70-kg man: TDEE0 difference (400-700 kcal/d)',
      unit: 'kcal/d',
      measure: () => {
        const b: Body = { sex: 'male', ageYears: 35, heightCm: 175, weightKg: 70 };
        return resolved(b, { work: 'onFeet', steps: { source: 'wrist', workday: 16035 } }).tdee0Kcal - resolved(b, { work: 'desk', steps: { source: 'wrist', workday: 6709 } }).tdee0Kcal;
      },
      check: range(400, 700),
      source: 'Tigbe 2011 (activPAL, n = 112) via 10 §4.14 (R1 V9, grade C)',
    },
    {
      id: 'v10cap',
      label: 'V10 heavy manual 12 h × 6 d + 20 000 steps + 5 h vigorous sport: PAL0 capped at 2.5',
      unit: 'PAL',
      measure: () => resolved(M_REF, { work: 'manualHeavy', workDaysPerWeek: 6, workHoursPerDay: 12, steps: { source: 'wrist', weeklyMean: 20000 }, recreation: [{ label: 'sport', intensity: 'vigorous', minPerWeek: 300 }] }).activity!.pal0,
      check: val(2.5, 1e-6),
      source: 'NASEM 2023 PAL range top 2.50 (R1 V10)',
    },
    {
      id: 'v10flag',
      label: 'V10 same answers: flagged "capped" (1 = yes)',
      unit: 'flag',
      measure: () => (resolved(M_REF, { work: 'manualHeavy', workDaysPerWeek: 6, workHoursPerDay: 12, steps: { source: 'wrist', weeklyMean: 20000 }, recreation: [{ label: 'sport', intensity: 'vigorous', minPerWeek: 300 }] }).activity!.palFlag === 'capped' ? 1 : 0),
      check: val(1, 0),
      source: 'R1 V10',
    },
    {
      id: 'v10warn',
      label: 'V10 heavy labourer + 260 min vigorous sport/wk: PAL0 in (2.4, 2.5] is flagged "high", not capped (1 = yes)',
      unit: 'flag',
      measure: () => {
        const a = resolved(M_REF, { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 }, recreation: [{ label: 'sport', intensity: 'vigorous', minPerWeek: 260 }] }).activity!;
        return a.palFlag === 'high' && a.pal0 > 2.4 && a.pal0 <= 2.5 ? 1 : 0;
      },
      check: val(1, 0),
      source: 'FAO 2004: PAL > 2.40 hard to sustain (R1 V10)',
    },
  ],
};

/** V8: occupational energy fall for a body weight when the moderate-intensity job share drops 50 % → 20 % (8 h × 5 d). */
function occupationalTrendKcal(bw: number): number {
  const o = ACTIVITY_INTAKE_K.occ;
  const lightShare = o.desk.share + o.mixed.share + o.onFeet.share;
  const eLight = (o.desk.share * o.desk.e + o.mixed.share * o.mixed.e + o.onFeet.share * o.onFeet.e) / lightShare;
  const modShare = o.manualModerate.share + o.manualHeavy.share;
  const eMod = (o.manualModerate.share * o.manualModerate.e + o.manualHeavy.share * o.manualHeavy.e) / modShare;
  return (0.5 - 0.2) * (eMod - eLight) * ((bw * 8 * 5) / 7);
}

// ------------------------------------------------------------------ V11 R-MAINT invariance (end to end)

const HEAVY_LIFTER = profileOf(
  { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 },
  { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 }, recreation: [{ label: 'football', intensity: 'vigorous', minPerWeek: 90 }] },
  { sessionsPerWeek: 3, lifingCardioMix: 0, trainingHistory: '1to3y' },
);
const SKIP_WOMAN = profileOf({ sex: 'female', ageYears: 42, heightCm: 165, weightKg: 72 }, SKIP_ALL);
/** Over the four complete habitual weeks (the fixture's trailing extra day repeats day 29 and breaks the last week's cycle). */
const maxAbsAdj = (v: ArmView): number => v.compiled.days.slice(0, 28).reduce((m, d) => Math.max(m, Math.abs(d.activityAdjKcal ?? 0)), 0);

export const R1_V11_INVARIANCE: Scenario = {
  id: 'R1-V11-rmaint-invariance',
  dossier: 'R1',
  target: 'V11',
  title: 'Any intake answers, habitual week replayed as the plan: zero R-MAINT adjustment and no drift (O-12)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V11; MODEL_SPEC §9.1 O-12, ruling R-MAINT`,
  notes: 'Heavy manual labourer with Sunday-league football and 3 RT sessions/wk; a woman who skipped every question. 30 days of the habitual week at 100 % of maintenance, default 14-d burn-in; O-12 tolerances.',
  arms: { heavy: { profile: HEAVY_LIFTER, schedule: habitualWeekSchedule(HEAVY_LIFTER, 30) }, skip: { profile: SKIP_WOMAN, schedule: habitualWeekSchedule(SKIP_WOMAN, 30) } },
  expectations: [
    ...(['heavy', 'skip'] as const).flatMap((id): Expectation[] => [
      { id: `${id}Adj`, label: `${id}: largest |R-MAINT activity adjustment| over four habitual weeks (0)`, unit: 'kcal/d', measure: (c) => maxAbsAdj(c.arm(id)), check: val(0, 1e-6), source: 'R-MAINT (R1 V11)' },
      { id: `${id}Fm`, label: `${id}: fat-mass drift at 30 d (|ΔFM| < 0.15 kg)`, unit: 'kg', measure: (c) => c.arm(id).after('fatMass', 30) - c.arm(id).initial('fatMass'), check: val(0, 0.15), source: 'O-12' },
      { id: `${id}Scale`, label: `${id}: day-30 weigh-in drift (|Δ| < 0.3 kg)`, unit: 'kg', measure: (c) => c.arm(id).after('scaleWeight', 30) - c.arm(id).initial('scaleWeight'), check: val(0, 0.3), source: 'O-12' },
    ]),
  ],
};

// ------------------------------------------------------------------ V12 band, V13 sleep neutrality

export const R1_V12_V13: Scenario = {
  id: 'R1-V12-V13-band-and-sleep',
  dossier: 'R1',
  target: 'V12-V13',
  title: 'Maintenance band floors and coverage; sleep timing does not move TDEE0',
  level: 'O',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V12-V13; NASEM 2023 (MAPE 8.7-9.4 % with the measured category); dossier 16 §4 (sleep and TEE)`,
  notes: 'V12 on R1\'s reference man: an answered intake (desk job), a skipped one, and the skipped one plus a 2-4-week wrist step average. V13: bed/wake 23:00-07:00 vs 01:00-06:00 with the same answers.',
  arms: { main: arm(profileOf(M_REF, { work: 'desk' })) },
  expectations: [
    { id: 'answered', label: 'V12 answered intake: relative σ ≥ 10 %', unit: 'frac', measure: (c) => act(c.main).uncertainty.relSigma, check: range(0.1 - 1e-12, 1), source: 'R1 V12 / §3.4' },
    { id: 'skipped', label: 'V12 skipped intake: relative σ ≥ 12 %', unit: 'frac', measure: () => resolved(M_REF, SKIP_ALL).activity!.uncertainty.relSigma, check: range(0.12 - 1e-12, 1), source: 'R1 V12 / §3.4' },
    {
      id: 'wristNarrows',
      label: 'V12 adding wrist steps to a skipped intake narrows σ (Δσ > 0)',
      unit: 'kcal/d',
      measure: () => resolved(M_REF, SKIP_ALL).activity!.uncertainty.sigmaKcal - resolved(M_REF, { steps: { source: 'wrist', weeklyMean: 7000 } }).activity!.uncertainty.sigmaKcal,
      check: above(0),
      source: 'R1 V12 / §6',
    },
    {
      id: 'sleep',
      label: 'V13 bed/wake 23-7 → 1-6: |ΔTDEE0| ≤ 1 kcal/d',
      unit: 'kcal/d',
      measure: () => resolved(M_REF, { work: 'onFeet' }, { bedTimeH: 1, wakeTimeH: 6 }).tdee0Kcal - resolved(M_REF, { work: 'onFeet' }, { bedTimeH: 23, wakeTimeH: 7 }).tdee0Kcal,
      check: val(0, 1),
      source: 'dossier 16 §4 (TEE unchanged by short sleep; R1 V13)',
    },
  ],
};

// ------------------------------------------------------------------ steady state: desk worker vs manual labourer, same body

const SS_BODY = { sex: 'male' as const, ageYears: 35, heightCm: 180, weightKg: 90 };
const ssProfile = (a: ActivityIntake): PersonProfile => ({ ...profileOf(SS_BODY, a), body: { ...SS_BODY, knownBodyFatPct: 25, knownBodyFatSource: 'dxa' } });
const SS = {
  desk: ssProfile(ARCHETYPES.deskOrdinary.intake),
  trades: ssProfile(ARCHETYPES.trades.intake),
  heavy: ssProfile(ARCHETYPES.heavy.intake),
};
const meanTee = (v: ArmView): number => v.mean('tdee', 7, 28);

export const R1_STEADY_STATE: Scenario = {
  id: 'R1-steady-desk-vs-manual',
  dossier: 'R1',
  target: 'V1 (engine)',
  title: 'Same body, desk vs manual job: engine maintenance differs by the FAO lifestyle range and stays weight-stable',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: `${R1_CITE} V1; FAO/WHO/UNU 2004 lifestyle PAL table via Endotext NBK279077`,
  notes:
    'MAN body (35 y, 180 cm, 90 kg, 25 % BF by DXA) with three R1 archetypes; 28 days of the habitual week at 100 % of maintenance after the 14-d burn-in; the engine\'s mean TEE over days 7-27. ' +
    'FAO bands: seated 1.4-1.5, moderate manual 1.8-2.0, heavy 2.0-2.4 → ΔPAL heavy − desk 0.5-1.0, trades − desk 0.3-0.6 (× RMR0).',
  arms: Object.fromEntries((Object.keys(SS) as (keyof typeof SS)[]).map((id) => [id, { profile: SS[id], schedule: habitualWeekSchedule(SS[id], 28) }])),
  expectations: [
    { id: 'heavyDesk', label: 'engine TEE, heavy manual − desk, in units of RMR0 (0.5-1.0)', unit: 'PAL', measure: (c) => (meanTee(c.arm('heavy')) - meanTee(c.arm('desk'))) / c.arm('desk').profile.rmr0Kcal, check: range(0.5, 1.0), source: 'FAO/WHO/UNU 2004 (R1 V1)' },
    { id: 'tradesDesk', label: 'engine TEE, trades − desk, in units of RMR0 (0.3-0.6)', unit: 'PAL', measure: (c) => (meanTee(c.arm('trades')) - meanTee(c.arm('desk'))) / c.arm('desk').profile.rmr0Kcal, check: range(0.3, 0.6), source: 'FAO/WHO/UNU 2004 (R1 V1)' },
    ...(['desk', 'trades', 'heavy'] as const).map((id): Expectation => ({
      id: `${id}Stable`,
      label: `${id}: day-28 weigh-in drift at maintenance (|Δ| < 0.3 kg)`,
      unit: 'kg',
      measure: (c) => c.arm(id).after('scaleWeight', 28) - c.arm(id).initial('scaleWeight'),
      check: val(0, 0.3),
      source: 'O-12 tolerance',
    })),
    ...(['desk', 'heavy'] as const).map((id): Expectation => ({
      id: `${id}Tee`,
      label: `${id}: engine mean TEE vs the intake's TDEE0 (± 2 %)`,
      unit: '%',
      measure: (c) => 100 * (meanTee(c.arm(id)) / c.arm(id).profile.tdee0Kcal - 1),
      check: val(0, 2),
      source: 'MODEL_SPEC §3.4 NEAT0 calibration',
    })),
  ],
};

export const SCENARIOS_ACTIVITY_INTAKE: Scenario[] = [R1_V1_FAO, R1_V2_NASEM, R1_V3_SKIP_ALL, R1_V4_IAEA, R1_V5_V10, R1_V11_INVARIANCE, R1_V12_V13, R1_STEADY_STATE];
