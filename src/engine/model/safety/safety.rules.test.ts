// @vitest-environment node
/**
 * Rule-by-rule logic: every warning rule fires on its canonical trajectory and does NOT fire on its neighbour (the same
 * regime one step inside the envelope). Also the message-length CI check, the verbatim-copy check against
 * research/17-safety-guardrails.md, the W-F04 correction, the fasting tiers, and the registry/wiring checks.
 */
import dossier17 from '../../../../research/17-safety-guardrails.md?raw';
import { validateParamDefs } from '../../core/paramsRegistry';
import { checkWiring } from '../../core/moduleRegistry';
import type { AnyEngineModule } from '../../types/module';
import type { BodyInputs } from '../../body/types';
import type { SafetyFlags } from '../../types/profile';
import type { DayTemplate, FastEvent } from '../../types/schedule';
import type { RunOptions } from '../../types/result';
import type { HabitProfile } from '../../types/profile';
import { MAX_MESSAGE_CHARS, N_RULES, RULES, RULE_INDEX, W_F04_TEXT } from './rules';
import { SAFETY_PARAMS, defaultSafetyConstants } from './params';
import { safetyModule } from './index';
import { fastTier, fastTierId } from './derived';
import { fillTemplate } from './messages';
import type { ScenarioArgs } from './testkit';
import { linear, person, prog, runScenario, sched } from './testkit';
import type { ProgOpts } from './testkit';

const K = defaultSafetyConstants();

// ------------------------------------------------------------------------------------------------ harness
interface Run {
  days?: number;
  kcal?: number;
  prog?: ProgOpts;
  programs?: DayTemplate[];
  dayProgram?: (d: number) => number;
  events?: FastEvent[];
  person?: Partial<BodyInputs>;
  safety?: { mode?: 'M0' | 'R1' | 'R2'; flags?: SafetyFlags };
  habits?: HabitProfile;
  plant?: Partial<ScenarioArgs['plant']>;
  patch?: ScenarioArgs['patchDays'];
  options?: RunOptions;
}

const BASE = { sex: 'male' as const, ageYears: 35, heightCm: 178, weightKg: 82 };

/** A quiet 35-y man at maintenance (TDEE 2 600, 130 g protein, 15 g fibre/1000 kcal, 2 g sodium): fires only the U-info rules. */
function run(o: Run = {}) {
  const body = { ...BASE, ...(o.person ?? {}) };
  const kcal = o.kcal ?? 2600;
  const p = o.prog ?? {};
  const program = prog('A', kcal, {
    proteinG: p.proteinG ?? (kcal * 0.2) / 4,
    carbsG: p.carbsG ?? (kcal * 0.45) / 4,
    fibrePer1000: p.fibrePer1000 ?? 15,
    ...p,
    hydration: { sodiumG: 2.0, ...(p.hydration ?? {}) },
  });
  const days = o.days ?? 30;
  return runScenario({
    person: person(body, o.safety, o.habits),
    schedule: sched(days, o.programs ?? [program], o.dayProgram ?? (() => 0), o.events),
    plant: { tdee: 2600, scaleKg: () => body.weightKg, bfPct: () => 22, ...(o.plant ?? {}) },
    ...(o.patch ? { patchDays: o.patch } : {}),
    ...(o.options ? { options: o.options } : {}),
  });
}

/** FFM 64 kg and 300 kcal/d of session exercise: EA = (EI − 300)/64. */
const EA_PLANT = { ffmKg: () => 64, exNet: (_d: number, h: number) => (h === 17 ? 300 : 0) };
/** The same person with a higher expenditure (TDEE 3 300 kcal/d): EA 35-45 intakes are then real deficits. */
const EA_PLANT_HI = { ...EA_PLANT, tdee: 3300 };
const drinks = (n: number, clockH = 19) => ({ alcohol: [{ clockH, drinks: n }] });

// ------------------------------------------------------------------------------------------------ table
type Row = [id: string, fire: Run, quiet: Run];
const ROWS: Row[] = [
  ['W-E01', { kcal: 1300 }, { kcal: 1600 }],
  ['W-E02', { kcal: 700, days: 6 }, { kcal: 850, days: 6 }],
  ['W-E03', { kcal: 1800, days: 10 }, { kcal: 2300, days: 10 }],
  ['W-E04', { kcal: 1300, days: 10 }, { kcal: 1700, days: 10 }],
  [
    'W-E05',
    { plant: { scaleKg: linear(82, -0.1) }, days: 20 },
    { plant: { scaleKg: linear(82, -0.06) }, days: 20 },
  ],
  [
    'W-E06',
    { plant: { scaleKg: linear(82, -0.25) }, days: 20 },
    { plant: { scaleKg: linear(82, -0.16) }, days: 20 },
  ],
  [
    'W-E07',
    { kcal: 2412, plant: { ...EA_PLANT }, days: 20 },
    { kcal: 2668, plant: { ...EA_PLANT }, days: 20 },
  ],
  ['W-E08', { kcal: 1964, plant: { ...EA_PLANT }, days: 5 }, { kcal: 2348, plant: { ...EA_PLANT }, days: 5 }],
  ['W-E09', { kcal: 2860, plant: { ...EA_PLANT_HI }, days: 5 }, { kcal: 3308, plant: { ...EA_PLANT_HI }, days: 5 }],
  ['W-E10', { kcal: 2000, days: 90 }, { kcal: 2250, days: 90 }],
  [
    'W-E11',
    { plant: { scaleKg: linear(82, -17 / 40) }, days: 40 },
    { plant: { scaleKg: linear(82, -13 / 40) }, days: 40 },
  ],
  [
    'W-E12',
    { plant: { scaleKg: linear(82, -24 / 40) }, days: 40 },
    { plant: { scaleKg: linear(82, -19.5 / 40) }, days: 40 },
  ],
  // "This plan takes your BMI to …": a plan-induced loss into [18.5, 20) fires; starting there and maintaining does not
  ['W-E13', { person: { weightKg: 62 }, plant: { scaleKg: linear(62, -0.08) }, days: 20 }, { person: { weightKg: 60 }, days: 5 }],
  ['W-E14', { person: { weightKg: 54 }, days: 5 }, { person: { weightKg: 60 }, days: 5 }],
  ['W-E15', { plant: { bfPct: () => 11 }, days: 5 }, { plant: { bfPct: () => 13 }, days: 5 }],
  ['W-E16', { plant: { bfPct: () => 7 }, days: 5 }, { plant: { bfPct: () => 9 }, days: 5 }],
  [
    'W-E17',
    { plant: { scaleKg: linear(82, (-0.008 * 82) / 7) }, days: 75 },
    { plant: { scaleKg: linear(82, (-0.005 * 82) / 7) }, days: 75 },
  ],
  [
    'W-E18',
    {
      person: { sex: 'female', weightKg: 62, heightCm: 165 },
      plant: { bfPct: () => 19, tdee: 2000 },
      kcal: 2000,
      days: 5,
    },
    {
      person: { sex: 'female', weightKg: 62, heightCm: 165 },
      plant: { bfPct: () => 26, tdee: 2000, exNet: (_d, h) => (h === 17 ? 300 : 0) },
      kcal: 2500,
      days: 5,
    },
  ],
  [
    'W-E19',
    { kcal: 2860, plant: { ...EA_PLANT_HI }, days: 90 },
    { kcal: 3308, plant: { ...EA_PLANT_HI }, days: 90 },
  ],
  [
    'W-E20',
    { kcal: 1964, plant: { ...EA_PLANT }, days: 20 },
    { kcal: 2348, plant: { ...EA_PLANT }, days: 20 },
  ],

  ['W-M01', { prog: { proteinG: 40 } }, { prog: { proteinG: 80 } }],
  ['W-M02', { kcal: 2000, prog: { proteinG: 80 } }, { kcal: 2000, prog: { proteinG: 120 } }],
  ['W-M03', { kcal: 2000, prog: { proteinG: 190 } }, { kcal: 2000, prog: { proteinG: 150 } }],
  ['W-M04', { prog: { proteinG: 210 } }, { prog: { proteinG: 170 } }],
  [
    'W-M05',
    { safety: { flags: { kidneyDisease: true } } },
    { safety: { flags: { kidneyDisease: true } }, prog: { proteinG: 90 } },
  ],
  ['W-M06', { days: 5, prog: { proteinG: 130, carbsG: 500 } }, { days: 5 }],
  [
    'W-M07',
    { days: 9, prog: { proteinG: 130, carbsG: 500 } },
    { days: 9, prog: { proteinG: 130, carbsG: 400 } },
  ],
  ['W-M08', { prog: { carbsG: 30 } }, { prog: { carbsG: 100 } }],
  ['W-M09', { days: 30, prog: { carbsG: 30 } }, { days: 20, prog: { carbsG: 30 } }],
  [
    'W-M10',
    { prog: { carbsG: 30 }, safety: { flags: { pregnantOrBreastfeeding: true } } },
    { prog: { carbsG: 30 } },
  ],
  // "Low fibre with low intake": low fibre in a deficit fires; the population default density at maintenance does not
  ['W-M11', { days: 35, kcal: 2200, prog: { fibrePer1000: 8 } }, { days: 35, prog: { fibrePer1000: 8 } }],
  [
    'W-M12',
    { prog: { carbsG: 30, hydration: { sodiumG: 1.0 } } },
    { prog: { carbsG: 30, hydration: { sodiumG: 2.5 } } },
  ],
  [
    'W-M13',
    // above 2.3 g and above the (default 3.0 g) habitual level fires; the default habitual level itself does not
    { days: 35, prog: { hydration: { sodiumG: 3.5 } } },
    { days: 35, prog: { hydration: { sodiumG: 3.0 } } },
  ],
  ['W-M14', { prog: { hydration: { fluidL: 1.0 } } }, { prog: { hydration: { fluidL: 2.0 } } }],
  ['W-M15', { prog: { hydration: { fluidL: 4.5 } } }, { prog: { hydration: { fluidL: 4.0 } } }],
  ['W-M16', { prog: { hydration: { potassiumG: 4.0 } } }, { prog: { hydration: { potassiumG: 3.5 } } }],
  ['W-M17', { prog: { hydration: { magnesiumMg: 700 } } }, { prog: { hydration: { magnesiumMg: 600 } } }],
  ['W-M18', { days: 14, prog: { substances: drinks(1.2) } }, { days: 14, prog: { substances: drinks(1.0) } }],
  [
    'W-M19',
    { kcal: 700, days: 4, prog: { substances: drinks(1) } },
    { days: 4, prog: { substances: drinks(1) } },
  ],
  ['W-M20', { days: 4, prog: { substances: drinks(3) } }, { days: 4, prog: { substances: drinks(2) } }],
  [
    'W-M21',
    { prog: { substances: { caffeine: [{ clockH: 8, mg: 250 }] } } },
    { prog: { substances: { caffeine: [{ clockH: 8, mg: 150 }] } } },
  ],
  [
    'W-M21',
    {
      prog: {
        substances: {
          caffeine: [
            { clockH: 8, mg: 150 },
            { clockH: 12, mg: 150 },
            { clockH: 15, mg: 150 },
          ],
        },
      },
    },
    {
      prog: {
        substances: {
          caffeine: [
            { clockH: 8, mg: 130 },
            { clockH: 12, mg: 130 },
            { clockH: 15, mg: 130 },
          ],
        },
      },
    },
  ],
  [
    'W-M22',
    { prog: { substances: { caffeine: [{ clockH: 20, mg: 100 }] } } },
    { prog: { substances: { caffeine: [{ clockH: 12, mg: 100 }] } } },
  ],
  ['W-M23', { prog: { substances: { creatineG: 8 } } }, { prog: { substances: { creatineG: 5 } } }],
  [
    'W-M23',
    { days: 10, prog: { substances: { creatineG: 20, creatineLoading: true } } },
    { days: 7, prog: { substances: { creatineG: 20, creatineLoading: true } } },
  ],
  ['W-M24', { prog: { carbsG: 30 }, safety: { flags: { kidneyStones: true } } }, { prog: { carbsG: 30 } }],

  ['W-F14', { prog: { meals: { count: 2, window: { startH: 12, lengthH: 2 } } } }, {}],
  [
    'W-F14',
    { prog: { meals: { count: 1, window: { startH: 12, lengthH: 1 } } } },
    { prog: { meals: { count: 3, window: { startH: 8, lengthH: 12 } } } },
  ],

  [
    'W-S01',
    { plant: { scaleKg: linear(82, (0.006 * 82) / 7) }, days: 20 },
    { plant: { scaleKg: linear(82, (0.004 * 82) / 7) }, days: 20 },
  ],
  ['W-S02', { kcal: 3200, days: 90 }, { kcal: 2990, days: 90 }],
  ['W-S03', { kcal: 2900, person: { waistCm: 110 } }, { person: { waistCm: 110 } }],

  [
    'W-P01',
    { kcal: 2000, safety: { flags: { pregnantOrBreastfeeding: true } } },
    { safety: { flags: { pregnantOrBreastfeeding: true } } },
  ],
  ['W-P02', { kcal: 2000, safety: { mode: 'R1' } }, { safety: { mode: 'R1' } }],
  ['W-P03', { kcal: 2000, person: { ageYears: 66 } }, { kcal: 2400, person: { ageYears: 66 } }],
  [
    'W-P04',
    { kcal: 2000, safety: { flags: { diabetesMedication: 'insulin' } } },
    { safety: { flags: { diabetesMedication: 'insulin' } } },
  ],
  [
    'W-P05',
    { kcal: 2000, safety: { flags: { cardiovascularOrBp: true } } },
    { kcal: 2400, safety: { flags: { cardiovascularOrBp: true } } },
  ],
  [
    'W-P06',
    { prog: { carbsG: 30 }, safety: { flags: { gout: true } } },
    { safety: { flags: { gout: true } } },
  ],
  [
    'W-P07',
    { prog: { carbsG: 30 }, safety: { flags: { medicationInteraction: true } } },
    { safety: { flags: { medicationInteraction: true } } },
  ],

  [
    'W-U02',
    { person: { weightKg: 140, heightCm: 170 }, days: 5 },
    { person: { weightKg: 110, heightCm: 170 }, days: 5 },
  ],
  ['W-U02', { person: { ageYears: 71 } }, { person: { ageYears: 69 } }],
  [
    'W-U02',
    { kcal: 400, days: 10, prog: { proteinG: 30, carbsG: 30 } },
    { kcal: 400, days: 6, prog: { proteinG: 30, carbsG: 30 } },
  ],
  ['W-U03', { person: { sliders: { adiposity: 0.4 } } }, {}],
];

describe('every warning rule fires on its canonical trajectory and not on its neighbour', () => {
  it.each(ROWS)('%s', (id, fire, quiet) => {
    const f = run(fire);
    expect(f.has(id), `${id} should fire`).toBe(true);
    const q = run(quiet);
    expect(q.has(id), `${id} should stay quiet on the neighbour`).toBe(false);
  });

  it('the quiet base regime (maintenance, healthy man, 30 d) fires only the always-on information rules', () => {
    const s = run();
    const noisy = s.res.warnings.filter((w) => w.severity !== 'info').map((w) => w.id);
    expect(noisy).toEqual([]);
    expect(new Set(s.res.warnings.map((w) => w.id))).toEqual(new Set(['W-U01', 'W-U04', 'W-U05']));
    // always-on notes are day-0 header notes, not horizon-long runs (integration 2026-09-30)
    for (const w of s.res.warnings) expect([w.startDay, w.endDay]).toEqual([0, 0]);
  });

  it('W-M11 needs low fibre in a deficit (or an entered low habitual fibre); W-M13 an entered or raised sodium', () => {
    expect(run({ days: 35, kcal: 2200, prog: { fibrePer1000: 15 } }).has('W-M11')).toBe(false);
    expect(run({ days: 35, prog: { fibrePer1000: 8 }, habits: { habitualFibreGPer1000Kcal: 8 } }).has('W-M11')).toBe(true);
    expect(run({ days: 35, prog: { hydration: { sodiumG: 3.0 } }, habits: { habitualSodiumG: 3.0 } }).has('W-M13')).toBe(true);
    expect(run({ days: 35, prog: { hydration: { sodiumG: 2.2 } }, habits: { habitualSodiumG: 3.0 } }).has('W-M13')).toBe(false);
  });

  it('W-U02 uses the entered age: a 70-year-old is inside the range for the whole run, a 71-year-old is not', () => {
    expect(run({ person: { ageYears: 70 }, days: 30 }).has('W-U02')).toBe(false);
    expect(run({ person: { ageYears: 71 }, days: 5 }).has('W-U02')).toBe(true);
  });

  it('the EA warnings apply to regimes with exercise (HC-E4); the literal reading (eaNeedsExercise = 0) also flags sedentary intake', () => {
    const sedentary = { kcal: 1964, plant: { ffmKg: () => 64 }, days: 5 };
    expect(run(sedentary).has('W-E08')).toBe(false); // EA = 30.7 without exercise: EI/FFM only; nothing to be "available" after
    const lowSed = { kcal: 1800, plant: { ffmKg: () => 64 }, days: 5 }; // EA 28.1
    expect(run(lowSed).has('W-E08')).toBe(false);
    const overrides = Float64Array.from(
      SAFETY_PARAMS.map((p) => (p.id === 'safety.eaNeedsExercise' ? 0 : p.value)),
    );
    expect(run({ ...lowSed, options: { paramOverrides: overrides } }).has('W-E08')).toBe(true);
    // at energy balance (2 500 vs TDEE 2 600) EA 39 is the habitual level: the deficit gate keeps W-E09 quiet …
    expect(run({ ...sedentary, kcal: 2500, options: { paramOverrides: overrides } }).has('W-E09')).toBe(false);
    // … and the fully literal reading (no exercise and no deficit gate) flags it
    const literal = Float64Array.from(
      SAFETY_PARAMS.map((p) => (p.id === 'safety.eaNeedsExercise' || p.id === 'safety.eaNeedsDeficit' ? 0 : p.value)),
    );
    expect(run({ ...sedentary, kcal: 2500, options: { paramOverrides: literal } }).has('W-E09')).toBe(true);
  });

  it('the EA warnings need a deficit: an exerciser at energy balance with EA 37 gets nothing, the same EA in a deficit does', () => {
    const atBalance = { kcal: 2668, plant: { ...EA_PLANT, tdee: 2668 }, days: 20 }; // EA 37 at maintenance
    for (const id of ['W-E07', 'W-E08', 'W-E09', 'W-E19', 'W-E20']) expect(run(atBalance).has(id)).toBe(false);
    expect(run({ ...atBalance, plant: { ...EA_PLANT, tdee: 3100 } }).has('W-E09')).toBe(true);
  });

  it('W-U04 / W-U05 follow the requested series (marker and autophagy outputs)', () => {
    const s = run({ options: { series: ['scaleWeight'] } });
    expect(s.has('W-U04')).toBe(false);
    expect(s.has('W-U05')).toBe(false);
    expect(s.has('W-U01')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ fasting
describe('fasting tiers (17 §4.3): one warning per fast, at the tier of its final length', () => {
  const fast = (durationH: number, o: { electrolytes?: boolean; days?: number } = {}) =>
    run({
      days: o.days ?? Math.ceil(durationH / 24) + 8,
      kcal: 2600,
      prog: { proteinG: 130, carbsG: 292 },
      programs: [prog('A', 0, { pctMaintenance: 100, hydration: { sodiumG: 2.0 } })],
      events: [
        {
          kind: 'fast',
          startDay: 2,
          startH: 21,
          durationH,
          electrolytes: o.electrolytes ?? true,
          refeed: 'auto',
        },
      ],
    });
  const cases: Array<[number, string, 'info' | 'caution' | 'danger']> = [
    [22, 'W-F01', 'info'],
    [30, 'W-F02', 'caution'],
    [60, 'W-F03', 'caution'],
    [100, 'W-F04', 'danger'],
    [200, 'W-F05', 'danger'],
  ];
  it.each(cases)('a %s-h fast → %s (%s) and no other tier warning', (hours, id, severity) => {
    const s = fast(hours);
    const tierIds = ['W-F01', 'W-F02', 'W-F03', 'W-F04', 'W-F05'];
    expect(tierIds.filter((t) => s.has(t))).toEqual([id]);
    expect(s.warn(id)).toHaveLength(1);
    expect(s.warn(id)[0]!.severity).toBe(severity);
    // the run covers every day of the fast that is beyond T0
    const w = s.warn(id)[0]!;
    const fh = s.res.safety.fastHMax;
    for (let d = 0; d < fh.length; d++)
      if (fh[d]! > K.tierT0MaxH) expect(d >= w.startDay && d <= w.endDay).toBe(true);
  });
  it('a 18-h daily overnight fast (T0) fires no fasting tier at all', () => {
    const s = run({ days: 10, prog: { meals: { count: 2, window: { startH: 13, lengthH: 5 } } } });
    for (const id of ['W-F01', 'W-F02', 'W-F03', 'W-F04', 'W-F05']) expect(s.has(id)).toBe(false);
  });
  it('W-F06 (no salt/fluid plan) needs a fast ≥ 48 h without electrolytes', () => {
    expect(fast(60, { electrolytes: false }).has('W-F06')).toBe(true);
    expect(fast(60, { electrolytes: true }).has('W-F06')).toBe(false);
    expect(fast(40, { electrolytes: false }).has('W-F06')).toBe(false);
  });
  it('W-F09: a hard session while the fast is ≥ 24 h old; the same session on a normal day does not fire', () => {
    const hiit = {
      kind: 'cardio' as const,
      modality: 'hiit' as const,
      startH: 10,
      durationMin: 30,
      pctVo2max: 0.9,
    };
    const withHiit = (day: number) =>
      [prog('A', 0, { pctMaintenance: 100 }), prog('H', 0, { pctMaintenance: 100, exercise: [hiit] })].map(
        (p) => p,
      ) && day;
    void withHiit;
    const programs = [
      prog('A', 0, { pctMaintenance: 100 }),
      prog('H', 0, { pctMaintenance: 100, exercise: [hiit] }),
    ];
    const events: FastEvent[] = [
      { kind: 'fast', startDay: 2, startH: 21, durationH: 60, electrolytes: true, refeed: 'auto' },
    ];
    const onFast = run({ days: 10, programs, dayProgram: (d) => (d === 4 ? 1 : 0), events });
    expect(onFast.has('W-F09')).toBe(true);
    const offFast = run({ days: 10, programs, dayProgram: (d) => (d === 8 ? 1 : 0), events });
    expect(offFast.has('W-F09')).toBe(false);
  });
  it('W-F13: three fasts of 24 h+ inside 14 days fire it without fastH_7 exceeding 108 h; two do not', () => {
    const ev = (n: number): FastEvent[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: 'fast' as const,
        startDay: 2 + 5 * i,
        startH: 21,
        durationH: 30,
        electrolytes: true,
        refeed: 'none' as const,
      }));
    const three = run({ days: 20, programs: [prog('A', 0, { pctMaintenance: 100 })], events: ev(3) });
    expect(three.has('W-F13')).toBe(true);
    expect(Math.max(...Array.from(three.res.safety.fastH7).filter((v) => !Number.isNaN(v)))).toBeLessThan(
      108,
    );
    const two = run({ days: 20, programs: [prog('A', 0, { pctMaintenance: 100 })], events: ev(2) });
    expect(two.has('W-F13')).toBe(false);
  });
  it('W-F07 (HC-F2 spacing): a single 36-h fast is fine; a T3 fast 4 days after a T2 fast violates the 7-day gap', () => {
    const one = run({
      days: 14,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      events: [{ kind: 'fast', startDay: 2, startH: 21, durationH: 36, refeed: 'none' }],
    });
    expect(one.has('W-F07')).toBe(false);
    const close = run({
      days: 20,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      events: [
        { kind: 'fast', startDay: 2, startH: 21, durationH: 30, refeed: 'none' },
        { kind: 'fast', startDay: 6, startH: 21, durationH: 60, refeed: 'none' },
      ],
    });
    expect(close.has('W-F07')).toBe(true);
    const spaced = run({
      days: 30,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      events: [
        { kind: 'fast', startDay: 2, startH: 21, durationH: 30, refeed: 'none' },
        { kind: 'fast', startDay: 12, startH: 21, durationH: 60, refeed: 'none' },
      ],
    });
    expect(spaced.has('W-F07')).toBe(false);
  });
  it('tier ids and boundaries match the UI-side screening module (FastingTier / tierForHours)', async () => {
    // cross-check only: the engine never imports the UI layer at run time
    const ui = await import('../../../features/onboarding/safetyRules');
    for (const h of [0, 12, 20, 20.5, 24, 24.5, 47.9, 48, 48.1, 72, 72.5, 100, 168, 168.1, 500]) {
      expect(fastTierId(fastTier(K, h))).toBe(ui.tierForHours(h));
    }
    expect(ui.TIER_ORDER).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
    expect(K.tierT0MaxH).toBe(ui.TIER_MAX_HOURS.T0);
    expect(K.tierT1MaxH).toBe(ui.TIER_MAX_HOURS.T1);
    expect(K.tierT2MaxH).toBe(ui.TIER_MAX_HOURS.T2);
    expect(K.tierT3MaxH).toBe(ui.TIER_MAX_HOURS.T3);
    expect(K.tierT4MaxH).toBe(ui.TIER_MAX_HOURS.T4);
    expect(ui.BF_FLOOR_PCT.male).toBe(K.bfFloorMale);
    expect(ui.BF_FLOOR_PCT.female).toBe(K.bfFloorFemale);
    // the UI arms these simulator ids from the profile flags; the engine emits the same ids from the trajectory
    const ids = new Set(RULES.map((r) => r.id as string));
    for (const id of [
      'W-P01',
      'W-P02',
      'W-P03',
      'W-P04',
      'W-P05',
      'W-P06',
      'W-P07',
      'W-M05',
      'W-M10',
      'W-M24',
      'W-X05',
    ])
      expect(ids.has(id)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ exercise
describe('fasts vs the 7-day energy floor and deficit cap (orchestrator ruling 2026-09-30 18:10)', () => {
  // healthy 35-y man at maintenance; one planned water fast (meal to meal) with the tier's graded refeed
  const withFast = (durationH: number, o: { refeed?: 'auto' | 'none'; days?: number; kcal?: number; sub?: ProgOpts['substances'] } = {}) =>
    run({
      days: o.days ?? 35,
      programs: [prog('A', o.kcal ?? 2600, { proteinG: 130, carbsG: 292, fibrePer1000: 15, hydration: { sodiumG: 2.0 }, ...(o.sub ? { substances: o.sub } : {}) })],
      events: [{ kind: 'fast', startDay: 7, startH: 20, durationH, refeed: o.refeed ?? 'auto' }],
    });
  it('a 72-h fast at maintenance shows its tier warning and no 7-day floor / deficit-cap / rate warning', () => {
    const s = withFast(72);
    expect(s.has('W-F03')).toBe(true);
    for (const id of ['W-E01', 'W-E02', 'W-E03', 'W-E04', 'W-E05', 'W-E06', 'W-13-ALPERT']) expect(s.has(id), id).toBe(false);
  });
  it('the trace follows the ruling: NaN deficit on fast days, the floor intake = min(non-fast 7-d mean, 28-d mean) near a fast', () => {
    const s = withFast(72);
    const t = s.res.safety;
    for (const d of [8, 9]) expect(Number.isNaN(t.deficitPct7[d]!)).toBe(true);
    // day 20: the 7-day window is plain eating; the 28-day mean (incl. 3 fast days and 2 refeed days) is the binding floor intake
    expect(t.ei7[20]!).toBeLessThan(2600);
    expect(t.ei7[20]!).toBeGreaterThan(1500);
    expect(t.deficitPct7[20]!).toBeCloseTo(0, 1);
    // far from the fast (> 28 d) the plain 7-day mean returns
    const long = withFast(72, { days: 40 });
    expect(long.res.safety.ei7[39]!).toBeCloseTo(2600, 0);
  });
  it('the 28-day mean-intake floor still binds: repeated long fasts on top of a low intake fire W-E01', () => {
    const s = run({
      days: 35,
      programs: [prog('A', 1700, { proteinG: 130, carbsG: 150, fibrePer1000: 15, hydration: { sodiumG: 2.0 } })],
      events: [
        { kind: 'fast', startDay: 3, startH: 20, durationH: 60, refeed: 'auto' },
        { kind: 'fast', startDay: 13, startH: 20, durationH: 60, refeed: 'auto' },
        { kind: 'fast', startDay: 23, startH: 20, durationH: 60, refeed: 'auto' },
      ],
    });
    expect(s.has('W-E01')).toBe(true);
    expect(s.has('W-E04')).toBe(false);
  });
  it('W-F08: a ≥ 72-h fast without a refeed ramp fires unless the refeed is planned', () => {
    expect(withFast(80, { refeed: 'none' }).has('W-F08')).toBe(true);
    expect(withFast(80, { refeed: 'auto' }).has('W-F08')).toBe(false);
  });
  it('W-M19 pre-fast leg: alcohol in the 24 h before a planned T3+ fast fires; a 24-h fast (T1) does not', () => {
    // one drink with dinner at 19:00 every day; the fast starts after the 20:00 meal of day 7
    expect(withFast(60, { sub: drinks(1) }).has('W-M19')).toBe(true);
    expect(withFast(24, { sub: drinks(1) }).has('W-M19')).toBe(false);
  });
});

describe('exercise rules', () => {
  const runSess = (mins: number): DayTemplate['exercise'] => [
    { kind: 'cardio', modality: 'run', startH: 7, durationMin: mins },
  ];
  it('W-X01: novice weekly running load up more than 30 % week on week; an experienced runner is not flagged', () => {
    const programs = [
      prog('A', 0, { pctMaintenance: 100 }),
      prog('R30', 0, { pctMaintenance: 100, exercise: runSess(30) }),
    ];
    const dayProgram = (d: number): number =>
      d < 14 ? (d % 7 === 1 || d % 7 === 4 ? 1 : 0) : d % 7 === 1 || d % 7 === 3 || d % 7 === 5 ? 1 : 0;
    const s = run({ days: 21, programs, dayProgram });
    expect(s.has('W-X01')).toBe(true);
    expect(s.warn('W-X01')[0]!.startDay).toBeGreaterThanOrEqual(14);
    expect(run({ days: 21, programs, dayProgram, habits: { trainingHistory: 'gt3y' } }).has('W-X01')).toBe(
      false,
    );
    expect(
      run({ days: 21, programs, dayProgram: (d) => (d % 7 === 1 || d % 7 === 4 ? 1 : 0) }).has('W-X01'),
    ).toBe(false);
  });
  const rt = (sets: number): DayTemplate['exercise'] => [
    { kind: 'resistance', startH: 17, setsByRegion: { chest: sets } },
  ];
  it('W-X02: novice > 10 sets/muscle in week 1, or > +2 sets/wk later; 8 sets and flat volume are fine', () => {
    const p = (sets: number) => prog('R', 0, { pctMaintenance: 100, exercise: rt(sets) });
    const big = run({
      days: 8,
      programs: [prog('A', 0, { pctMaintenance: 100 }), p(12)],
      dayProgram: (d) => (d === 1 ? 1 : 0),
    });
    expect(big.has('W-X02')).toBe(true);
    const small = run({
      days: 8,
      programs: [prog('A', 0, { pctMaintenance: 100 }), p(8)],
      dayProgram: (d) => (d === 1 ? 1 : 0),
    });
    expect(small.has('W-X02')).toBe(false);
    const ramp = run({
      days: 21,
      programs: [prog('A', 0, { pctMaintenance: 100 }), p(5), p(9)],
      dayProgram: (d) => (d % 7 === 1 ? (d < 14 ? 1 : 2) : 0),
    });
    expect(ramp.has('W-X02')).toBe(true);
    const flat = run({
      days: 21,
      programs: [prog('A', 0, { pctMaintenance: 100 }), p(5)],
      dayProgram: (d) => (d % 7 === 1 ? 1 : 0),
    });
    expect(flat.has('W-X02')).toBe(false);
  });
  it('W-X03: 14 days without a rest day; a weekly rest day is fine', () => {
    const programs = [
      prog('A', 0, { pctMaintenance: 100 }),
      prog('R', 0, { pctMaintenance: 100, exercise: runSess(20) }),
    ];
    expect(run({ days: 16, programs, dayProgram: () => 1 }).has('W-X03')).toBe(true);
    expect(run({ days: 16, programs, dayProgram: (d) => (d % 7 === 6 ? 0 : 1) }).has('W-X03')).toBe(false);
  });
  it('W-X04 / W-X05: vigorous exercise with a hot-climate day / with a PAR-Q-style flag', () => {
    const hiit: DayTemplate['exercise'] = [
      { kind: 'cardio', modality: 'hiit', startH: 7, durationMin: 20, pctVo2max: 0.9 },
    ];
    const programs = [
      prog('A', 0, { pctMaintenance: 100, exercise: hiit, modifiers: { hotClimate: true } }),
      prog('B', 0, { pctMaintenance: 100, exercise: hiit }),
    ];
    expect(run({ days: 4, programs, dayProgram: () => 0 }).has('W-X04')).toBe(true);
    expect(run({ days: 4, programs, dayProgram: () => 1 }).has('W-X04')).toBe(false);
    expect(
      run({ days: 4, programs, dayProgram: () => 1, safety: { flags: { exerciseRestriction: true } } }).has(
        'W-X05',
      ),
    ).toBe(true);
    expect(run({ days: 4, programs, dayProgram: () => 1 }).has('W-X05')).toBe(false);
    const easy: DayTemplate['exercise'] = [{ kind: 'cardio', modality: 'walk', startH: 7, durationMin: 40 }];
    expect(
      run({
        days: 4,
        programs: [prog('W', 0, { pctMaintenance: 100, exercise: easy })],
        safety: { flags: { exerciseRestriction: true } },
      }).has('W-X05'),
    ).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ engine-specific rules
describe('engine-specific rules (spec §7.2 last rows, review M9)', () => {
  it('W-13-ALPERT: a deficit above 0.75 × 69 kcal per kg fat mass fires; below it does not', () => {
    const lean = { plant: { scaleKg: () => 82, bfPct: () => 12.2 } }; // FM ≈ 10 kg → cap ≈ 518 kcal/d
    expect(run({ kcal: 1900, days: 10, ...lean }).has('W-13-ALPERT')).toBe(true);
    expect(run({ kcal: 2250, days: 10, ...lean }).has('W-13-ALPERT')).toBe(false);
    const w = run({ kcal: 1900, days: 10, ...lean }).warn('W-13-ALPERT')[0]!;
    expect(w.message).toMatch(/about 5\d\d kcal\/day/);
  });
  it('W-05-KETO-FED: BHB > 3.0 mmol/L while eating (danger) for people with diabetes or breastfeeding, > 6.0 in their 72-h refeed phase; fasting hours never count', () => {
    // ruling R-FAST-GATE (2026-10-01): limited to people with diabetes (the rule's own text; 05 §9 "known diabetes") and
    // lactation (05 §9); nutritional or post-fast ketosis in anyone else is not the ketoacidosis sign
    const diabetes = { safety: { flags: { diabetesMedication: 'metforminOnly' as const } } };
    const eating = run({ days: 6, plant: { bhb: () => 3.5 }, ...diabetes });
    expect(eating.has('W-05-KETO-FED')).toBe(true);
    expect(eating.warn('W-05-KETO-FED')[0]!.severity).toBe('danger');
    expect(run({ days: 6, plant: { bhb: () => 3.5 }, safety: { flags: { type1Diabetes: true } } }).has('W-05-KETO-FED')).toBe(true);
    expect(run({ days: 6, plant: { bhb: () => 3.5 }, safety: { flags: { pregnantOrBreastfeeding: true } } }).has('W-05-KETO-FED')).toBe(true);
    // without diabetes the rule does not apply (the model's keto + weekly-fast runs reach 6-7 mM while eating: QA item 2)
    expect(run({ days: 6, plant: { bhb: () => 3.5 } }).has('W-05-KETO-FED')).toBe(false);
    expect(run({ days: 6, plant: { bhb: () => 6.5 } }).has('W-05-KETO-FED')).toBe(false);
    // ketoFedNeedsDiabetes = 0 applies it to everyone
    const everyone = Float64Array.from(SAFETY_PARAMS.map((p) => (p.id === 'safety.ketoFedNeedsDiabetes' ? 0 : p.value)));
    expect(run({ days: 6, plant: { bhb: () => 3.5 }, options: { paramOverrides: everyone } }).has('W-05-KETO-FED')).toBe(true);
    const fasting = run({
      days: 8,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      // meal to meal: day 1's 20:00 dinner → day 5's 08:00 breakfast, i.e. days 2-4 without intake
      events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 84, refeed: 'auto' }],
      plant: { bhb: (d) => (d >= 2 && d <= 4 ? 3.5 : 0.3) },
      ...diabetes,
    });
    expect(fasting.has('W-05-KETO-FED')).toBe(false);
    // final round 2026-09-30: fasting hours are not "eating" even above 6 mM (was: any hour > 6.0, which flagged a 72-h
    // fast with a training session "while eating"); in the refeed phase only > 6.0 counts
    const extremeFasting = run({
      days: 8,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 84, refeed: 'auto' }],
      plant: { bhb: (d) => (d >= 2 && d <= 4 ? 6.5 : 0.3) },
      ...diabetes,
    });
    expect(extremeFasting.has('W-05-KETO-FED')).toBe(false);
    const refeedHigh = run({
      days: 8,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 84, refeed: 'auto' }],
      plant: { bhb: (d) => (d === 5 ? 6.5 : d >= 2 && d <= 4 ? 3.5 : 0.3) },
      ...diabetes,
    });
    expect(refeedHigh.has('W-05-KETO-FED')).toBe(true);
    // the whole refeed phase (72 h from the first intake on day 5 at 08:00, through day 8 08:00) is exempt from the 3.0 leg
    // (it used to be the first 24 h only: a 72-h fast followed by very-low-carbohydrate eating was rejected on days 6-7)
    const refeedPhase = (last: number) =>
      run({
        days: 12,
        programs: [prog('A', 0, { pctMaintenance: 100 })],
        events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 84, refeed: 'auto' }],
        plant: { bhb: (d) => (d >= 2 && d <= last ? 3.5 : 0.3) },
        ...diabetes,
      });
    expect(refeedPhase(7).has('W-05-KETO-FED')).toBe(false);
    const late = refeedPhase(9);
    expect(late.has('W-05-KETO-FED')).toBe(true);
    expect(late.warn('W-05-KETO-FED')[0]!.startDay).toBeGreaterThanOrEqual(8);
  });
  it('W-20-FAST-LEAN: a fast beyond T2 in a lean user (BF < floor + 6) fires; a fast at higher BF or a shorter fast does not', () => {
    const ev = (h: number): FastEvent[] => [
      { kind: 'fast', startDay: 2, startH: 21, durationH: h, refeed: 'auto' },
    ];
    const programs = [prog('A', 0, { pctMaintenance: 100 })];
    expect(
      run({ days: 10, programs, events: ev(60), plant: { bfPct: () => 12 } }).has('W-20-FAST-LEAN'),
    ).toBe(true);
    expect(
      run({ days: 10, programs, events: ev(60), plant: { bfPct: () => 22 } }).has('W-20-FAST-LEAN'),
    ).toBe(false);
    expect(
      run({ days: 10, programs, events: ev(36), plant: { bfPct: () => 12 } }).has('W-20-FAST-LEAN'),
    ).toBe(false);
  });
  it('W-01-FATFLOOR (review M9, R-FATFLOOR): fires on days with fatFloorActive > 0 (danger); not above the ramp, not at balance', () => {
    // the plant emulates composition's signal: FM_min = 0.02 × BW0 = 1.64 kg (82 kg), ramp 1 kg, engaged only while the
    // fat share of a negative balance is drawn down
    const near = (fm: number, o: Record<string, unknown> = {}) =>
      run({
        days: 6,
        kcal: 800,
        prog: { proteinG: 60, carbsG: 60 },
        plant: { ffmKg: () => 80, scaleKg: () => 80 + fm, ...o },
      });
    const s = near(2.2);
    expect(s.has('W-01-FATFLOOR')).toBe(true);
    expect(s.warn('W-01-FATFLOOR')[0]!.severity).toBe('danger');
    expect(s.warn('W-01-FATFLOOR')[0]!.message).toContain('2.2 kg');
    expect(near(3.5).has('W-01-FATFLOOR')).toBe(false);
    expect(near(2.2, { tissueEnergy: () => 5 }).has('W-01-FATFLOOR')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ messages and registry
describe('messages', () => {
  it('message-length check (17 §7 CI): every template ≤ 200 characters including placeholders', () => {
    for (const r of RULES) expect(r.template.length, r.id).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(RULES.length).toBe(N_RULES);
  });
  it('rendered messages with worst-case placeholder values stay ≤ 200 characters and contain no unresolved braces', () => {
    const wide = {
      EI: '99999',
      floor: '1500',
      d: '100',
      cap: '25',
      r: '99.99',
      EA: '-99.9',
      x: '100.0',
      bmi: '99.9',
      bf: '99.9',
      n: '999',
      p: '9.99',
      f: '999',
      g: '9.99',
      fm: '99.9',
      '102/88': '102',
    };
    for (const r of RULES) {
      const msg = fillTemplate(r.template, wide);
      expect(msg.length, r.id).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
      expect(msg, r.id).not.toMatch(/[{}]/);
    }
  });
  // W-F04 carries the 20-corrected wording (spec §1.16); W-E03/W-E04 add "(training included)" after "of maintenance"
  // since R-MAINT (final round 2026-09-30: the deficit is measured against the energy needs at the planned activity)
  // and (QA 2026-09-30) say that they are 7-day averages — the adapted wording is pinned here
  const ADAPTED: Readonly<Record<string, (dossierText: string) => string>> = {
    'W-E03': () =>
      'Averaged over the last 7 days, your deficit is {d}% of maintenance (training included). Above about {cap}% the model shows more muscle loss and stronger hunger and hormone effects. Results vary.',
    'W-E04': () =>
      'Averaged over the last 7 days, your deficit is over 40% of maintenance (training included): beyond what is usually studied outside clinical or research supervision. Individual risk is higher.',
  };
  it('the 78 dossier-17 messages are copied verbatim (W-F04 excepted; W-E03/W-E04 R-MAINT-adapted) with the dossier severities', () => {
    const md: string = dossier17;
    let n = 0;
    for (const ln of md.split('\n')) {
      if (!/^\|\s*W-/.test(ln)) continue;
      const c = ln
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((x) => x.trim());
      const rule = RULES.find((r) => r.id === c[0])!;
      expect(rule, c[0]).toBeDefined();
      expect(rule.severity, c[0]).toBe(c[2]);
      const adapt = ADAPTED[c[0]!];
      if (c[0] !== 'W-F04') expect(rule.template, c[0]).toBe(adapt ? adapt(c[3]!) : c[3]);
      n++;
    }
    expect(n).toBe(78);
    expect(RULES.map((r) => r.id).filter((id) => /^W-\d\d-/.test(id))).toEqual([
      'W-13-ALPERT',
      'W-05-KETO-FED',
      'W-20-FAST-LEAN',
      'W-01-FATFLOOR',
    ]);
  });
  it('W-F04 carries the 20 correction: grade ≥ 3 adverse events, serious events rare (2 of 768); the old wording is gone', () => {
    expect(W_F04_TEXT).toBe(
      'Water fasts of 3–7 days are studied under medical supervision: about 20% of stays had a grade ≥3 adverse event by day 5; serious events were rare (2 of 768). Not to be attempted alone.',
    );
    const rule = RULES[RULE_INDEX['W-F04']]!;
    expect(rule.template).toBe(W_F04_TEXT);
    expect(rule.severity).toBe('danger');
    expect(rule.template).not.toContain('serious events ~20%');
    expect(rule.template).toContain('grade ≥3');
    expect(rule.template).toContain('2 of 768');
    // and it is what the simulation emits for a 4-day fast
    const s = run({
      days: 12,
      programs: [prog('A', 0, { pctMaintenance: 100 })],
      events: [{ kind: 'fast', startDay: 2, startH: 21, durationH: 100, refeed: 'auto' }],
    });
    expect(s.warn('W-F04')[0]!.message).toBe(W_F04_TEXT);
  });
  it('emitted messages fill their placeholders with the run values', () => {
    const s = run({ kcal: 1300, days: 10 });
    expect(s.warn('W-E01')[0]!.message).toContain('1300 kcal/day');
    expect(s.warn('W-E01')[0]!.message).toContain('1500 kcal/day');
    const e4 = run({ kcal: 1800, days: 10 });
    expect(e4.warn('W-E03')[0]!.message).toMatch(/deficit is 31% of maintenance/);
    expect(e4.warn('W-E03')[0]!.message).toContain('about 25%');
    for (const w of s.res.warnings) {
      expect(w.message.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
      expect(w.message).not.toMatch(/[{}]|NaN|undefined|\?/);
    }
  });
});

describe('registry and wiring', () => {
  it('every ParamDef validates (unique, prefixed, low ≤ value ≤ high, source and § present) and is a fixed threshold', () => {
    expect(validateParamDefs([safetyModule as unknown as AnyEngineModule])).toEqual([]);
    for (const p of SAFETY_PARAMS) {
      expect(p.draw, p.id).toBe('fixed');
      expect(p.source.length, p.id).toBeGreaterThan(3);
    }
    expect(SAFETY_PARAMS.length).toBeGreaterThan(140);
  });
  it('checkWiring reports nothing for the safety module (declared reads = SIGNAL_DEFS readers; it writes only safetyAbort)', () => {
    const issues = checkWiring().issues.filter((i) => i.module === 'safety' || i.signal === 'safetyAbort');
    expect(issues).toEqual([]);
    expect(safetyModule.writes).toEqual(['safetyAbort']);
    expect(safetyModule.records).toEqual([]);
  });
});
