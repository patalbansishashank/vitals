// @vitest-environment node
/**
 * Activity intake (R1 §3, MODEL_SPEC §5.5): mapping unit tests against R1's worked numbers, the pre-intake equivalence,
 * determinism, uncertainty monotonicity and the steady-state desk-vs-manual difference.
 */
import { validateParamDefs } from '../../../core/paramsRegistry';
import { ACTIVITY_SELECTOR, resolveProfile, selectorIndexFor, tefFraction } from '../../../core/resolveProfile';
import { ATWATER, DEFAULTS } from '../../../core/defaults';
import { ACTIVITY_PARAMS } from '../../../model/activity/params';
import type { AnyEngineModule } from '../../../types/module';
import type { ActivityBase, ActivityIntake, PersonProfile, ResolvedActivity } from '../../../types/profile';
import { ACTIVITY_INTAKE_K, ACTIVITY_INTAKE_PARAMS, activityTerms, occupationPrior, resolveActivity, Z80 } from '../index';

// R1 §3.3 reference people: Mifflin RMR, α0 = 0.10, no sessions
const MIFFLIN = (male: boolean, w: number, h: number, a: number): number => 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);
const R1_M: ActivityBase = { weightKg: 90, rmr0Kcal: MIFFLIN(true, 90, 180, 35), eat0Kcal: 0, tefFraction: 0.1, rmrRoute: 'equation' };
const R1_F: ActivityBase = { weightKg: 65, rmr0Kcal: MIFFLIN(false, 65, 165, 35), eat0Kcal: 0, tefFraction: 0.1, rmrRoute: 'equation' };

/**
 * R1 §3.3 archetypes: answers, TDEE M / F, PAL (M), component σ %. The mixed-job and skip-everything rows are R1's table
 * recomputed with occMixed 0.40 (R1: 0.25, giving 2928 / 2121 / 1.58 / 8.6 % and 2915 / 2112 / 1.57 / 12.2 %); see params.ts.
 */
const ARCHETYPES: readonly { name: string; intake: ActivityIntake; m: number; f: number; pal: number; sigmaPct: number }[] = [
  { name: 'desk, little moving', intake: { work: 'desk', steps: { source: 'wrist', workday: 5000, offDay: 5000 }, onFeetAtHome: 'little' }, m: 2615, f: 1896, pal: 1.41, sigmaPct: 9.2 },
  { name: 'desk, ordinary', intake: { work: 'desk', steps: { source: 'wrist', workday: 7000, offDay: 6000 }, onFeetAtHome: 'some' }, m: 2741, f: 1986, pal: 1.48, sigmaPct: 8.9 },
  { name: 'mixed job', intake: { work: 'mixed', steps: { source: 'wrist', workday: 8000, offDay: 7000 } }, m: 3013, f: 2183, pal: 1.62, sigmaPct: 8.3 },
  { name: 'on feet (retail)', intake: { work: 'onFeet', steps: { source: 'wrist', workday: 11000, offDay: 7000 } }, m: 3165, f: 2293, pal: 1.71, sigmaPct: 8.3 },
  { name: 'walking delivery', intake: { work: 'onFeet', steps: { source: 'wrist', workday: 16000, offDay: 8000 } }, m: 3334, f: 2415, pal: 1.8, sigmaPct: 8.1 },
  { name: 'trades', intake: { work: 'manualModerate', steps: { source: 'wrist', workday: 12000, offDay: 8000 } }, m: 3494, f: 2531, pal: 1.88, sigmaPct: 8.3 },
  { name: 'heavy manual', intake: { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 } }, m: 4173, f: 3021, pal: 2.25, sigmaPct: 8.8 },
  { name: 'not working, busy home', intake: { work: 'notWorking', steps: { source: 'wrist', weeklyMean: 6000 }, onFeetAtHome: 'aLot' }, m: 2784, f: 2018, pal: 1.5, sigmaPct: 9.2 },
  { name: 'skip everything', intake: {}, m: 2936, f: 2128, pal: 1.58, sigmaPct: 12.2 },
];

const componentRel = (a: ResolvedActivity): number => Math.sqrt(a.drivers.reduce((s, d) => s + d.sigmaKcal * d.sigmaKcal, 0)) / a.tdee0Kcal;
const sumDrivers = (a: ResolvedActivity): number => a.drivers.reduce((s, d) => s + d.kcal, 0);
const person = (sex: 'male' | 'female', age: number, h: number, w: number, habits: PersonProfile['habits'] = {}, extra: Partial<PersonProfile> = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex, ageYears: age, heightCm: h, weightKg: w },
  habits,
  startDate: '2026-10-05',
  ...extra,
});

describe('parameters (R1 §3.2, §3.4)', () => {
  it('every constant is a valid ParamDef with grade, source, research § and status', () => {
    const pseudo = { id: 'activityIntake', params: ACTIVITY_INTAKE_PARAMS } as unknown as AnyEngineModule;
    expect(validateParamDefs([pseudo])).toEqual([]);
    for (const p of ACTIVITY_INTAKE_PARAMS) {
      expect(['A', 'B', 'C', 'D'], p.id).toContain(p.grade);
      expect(p.status, p.id).toBeDefined();
      expect(p.dossier, p.id).toMatch(/§/);
    }
  });

  it('step cost equals the activity module`s (one value for habitual and booked steps)', () => {
    const stepsNet = ACTIVITY_PARAMS.find((p) => p.id === 'activity.stepsNet')!;
    expect(ACTIVITY_INTAKE_K.stepK * 1000).toBeCloseTo(stepsNet.value, 12);
  });

  it('skipped work class: prior shares sum to 1 and give e_occ mean 0.32, SD 0.40 (R1 §3.2: 0.28 with occMixed 0.25)', () => {
    const k = ACTIVITY_INTAKE_K;
    const s = k.occ.desk.share + k.occ.mixed.share + k.occ.onFeet.share + k.occ.manualModerate.share + k.occ.manualHeavy.share;
    expect(s).toBeCloseTo(1, 12);
    const pr = occupationPrior();
    expect(pr.e).toBeCloseTo(0.32, 2);
    expect(pr.sd).toBeCloseTo(0.4, 1);
    expect(Math.abs(pr.sd - 0.4)).toBeLessThan(0.01);
  });
});

describe('mapping: R1 §3.3 archetypes reproduce (Mifflin, α0 0.10, no sessions)', () => {
  for (const a of ARCHETYPES) {
    it(`${a.name}: TDEE M ${a.m} / F ${a.f} ± 3 kcal, PAL ${a.pal}, component σ ${a.sigmaPct} %`, () => {
      const m = resolveActivity(a.intake, R1_M);
      const f = resolveActivity(a.intake, R1_F);
      expect(Math.abs(m.tdee0Kcal - a.m)).toBeLessThanOrEqual(3);
      expect(Math.abs(f.tdee0Kcal - a.f)).toBeLessThanOrEqual(3);
      expect(m.pal0).toBeCloseTo(a.pal, 2);
      expect(Math.abs(100 * componentRel(m) - a.sigmaPct)).toBeLessThanOrEqual(0.1);
    });
  }

  it('worked terms: trades M = 2133 + 430 (10 857 steps) + 514 (E_occ) + 68 (home) over 0.9', () => {
    const r = resolveActivity({ work: 'manualModerate', steps: { source: 'wrist', workday: 12000, offDay: 8000 } }, R1_M);
    expect(r.steps).toBe(10857);
    expect(r.occupationalKcal).toBeCloseTo((90 * 8 * 1.0 * 5) / 7, 9);
    expect(r.homeKcal).toBeCloseTo(90 * 1.5 * 0.5, 9);
    expect(r.stepsKcal).toBeCloseTo((0.44 / 1000) * 90 * 10857, 9);
    expect(r.neatKcal).toBeCloseTo(0.15 * R1_M.rmr0Kcal + r.stepsKcal + r.nonStepKcal, 9);
    expect(r.metHoursPerDay).toBeCloseTo((r.stepsKcal + r.nonStepKcal) / 90, 12);
  });

  it('weekly mean steps S_hab = (d_w·S_w + (7 − d_w)·S_o)/7; one number wins; a missing day value is derived', () => {
    const k = ACTIVITY_INTAKE_K;
    expect(resolveActivity({ work: 'desk', workDaysPerWeek: 4, steps: { source: 'wrist', workday: 9000, offDay: 2000 } }, R1_M).steps).toBe(Math.round((4 * 9000 + 3 * 2000) / 7));
    expect(resolveActivity({ work: 'desk', steps: { source: 'phone', weeklyMean: 8123, workday: 1, offDay: 1 } }, R1_M).steps).toBe(8123);
    const wdOnly = resolveActivity({ work: 'desk', offDay: 'outAndAbout', steps: { source: 'wrist', workday: 9000 } }, R1_M);
    expect(wdOnly.stepsOffDay).toBe(k.stepsOff.outAndAbout);
    expect(wdOnly.steps).toBe(Math.round((5 * 9000 + 2 * k.stepsOff.outAndAbout) / 7));
  });

  it('no step number: derived from the work class, a walking commute (c_walk 105/min) and the day off', () => {
    const k = ACTIVITY_INTAKE_K;
    const r = resolveActivity({ work: 'onFeet', commute: { mode: 'walk', activeMinPerWorkday: 30 }, offDay: 'mostlyHome' }, R1_M);
    const sw = k.occ.onFeet.stepsWork + 105 * 30;
    expect(r.stepsWorkday).toBe(sw);
    expect(r.steps).toBe(Math.round((5 * sw + 2 * 4500) / 7));
    expect(r.stepsSource).toBe('unknown');
    // the walking commute shows as commute energy, not as steps, when the steps were derived
    const walk = (k.stepK * 90 * 105 * 30 * 5) / 7;
    expect(r.drivers.find((d) => d.id === 'commute')!.kcal).toBeCloseTo(walk, 6);
    // a device count already contains the walk: no extra steps, commute energy 0
    const dev = resolveActivity({ work: 'onFeet', commute: { mode: 'walk', activeMinPerWorkday: 30 }, steps: { source: 'wrist', weeklyMean: 9000 } }, R1_M);
    expect(dev.steps).toBe(9000);
    expect(dev.commuteKcal).toBe(0);
  });

  it('cycling commute E_cyc = BW·(6.8 − 1)·min/60·d_w/7; working from home has none', () => {
    const r = resolveActivity({ work: 'desk', commute: { mode: 'cycle', activeMinPerWorkday: 40 } }, R1_M);
    expect(r.commuteKcal).toBeCloseTo((90 * 5.8 * (40 / 60) * 5) / 7, 9);
    expect(resolveActivity({ work: 'desk', commute: { mode: 'none', activeMinPerWorkday: 40 } }, R1_M).commuteKcal).toBe(0);
  });

  it('recreation E_rec = BW·Σ(MET − 1)·min/60/7; invalid minutes are ignored, large ones clamped', () => {
    const r = resolveActivity({ work: 'desk', recreation: [{ label: 'football', intensity: 'vigorous', minPerWeek: 90 }, { label: 'walks', intensity: 'light', minPerWeek: 120 }, { label: 'bad', intensity: 'moderate', minPerWeek: Number.NaN }, { label: 'neg', intensity: 'moderate', minPerWeek: -30 }] }, R1_M);
    expect(r.recreationKcal).toBeCloseTo((90 * (7 * 90 + 2.5 * 120)) / 60 / 7, 9);
    // (before the PAL cap, which this much sport would trigger)
    const big = activityTerms({ recreation: [{ label: 'x', intensity: 'moderate', minPerWeek: 1e9 }] }, R1_M);
    expect(big.recreationKcal).toBeCloseTo((90 * 4 * DEFAULTS.activity.recreationMinPerWeekRange[1]) / 60 / 7, 6);
  });

  it('not working: no work days, no occupational term, no commute; day-off steps every day', () => {
    const r = resolveActivity({ work: 'notWorking', workDaysPerWeek: 5, commute: { mode: 'cycle', activeMinPerWorkday: 60 }, offDay: 'outAndAbout' }, R1_M);
    expect(r.workDaysPerWeek).toBe(0);
    expect(r.occupationalKcal).toBe(0);
    expect(r.commuteKcal).toBe(0);
    expect(r.steps).toBe(ACTIVITY_INTAKE_K.stepsOff.outAndAbout);
  });

  it('answers are clamped to the schema ranges (days 0-7, hours 2-14)', () => {
    const r = resolveActivity({ work: 'onFeet', workDaysPerWeek: 12, workHoursPerDay: 30, steps: { source: 'wrist', weeklyMean: 8000 } }, R1_M);
    expect(r.workDaysPerWeek).toBe(7);
    expect(r.workHoursPerDay).toBe(14);
    expect(r.occupationalKcal).toBeCloseTo(90 * 14 * 0.5, 9);
  });

  it('the old steps tick counts as a rough steps answer when the intake has no step number', () => {
    const r = resolveActivity({ work: 'desk' }, { ...R1_M, typicalSteps: 9500 });
    expect(r.steps).toBe(9500);
    expect(r.stepsSource).toBe('estimate');
  });

  it('drivers come in R1 §6 order and add up to TDEE0; NEAT0 = TDEE0 − RMR0 − TEF − EAT0', () => {
    const r = resolveActivity({ work: 'mixed', commute: { mode: 'cycle', activeMinPerWorkday: 20 }, recreation: [{ label: 'tennis', intensity: 'moderate', minPerWeek: 120 }] }, { ...R1_M, eat0Kcal: 150 });
    expect(r.drivers.map((d) => d.id)).toEqual(['rmr', 'dailyLiving', 'steps', 'work', 'home', 'commute', 'recreation', 'training', 'digestion']);
    expect(Math.abs(sumDrivers(r) - r.tdee0Kcal)).toBeLessThan(1e-9);
    const tef = r.drivers.find((d) => d.id === 'digestion')!.kcal;
    expect(tef).toBeCloseTo(0.1 * r.tdee0Kcal, 9);
    expect(r.neatKcal).toBeCloseTo(r.tdee0Kcal - R1_M.rmr0Kcal - tef - 150, 9);
  });

  it('PAL above 2.4 warns; non-step answers beyond PAL 2.5 are scaled down so PAL0 = 2.5 (R1 V10)', () => {
    const extreme = resolveActivity({ work: 'manualHeavy', workDaysPerWeek: 6, workHoursPerDay: 12, steps: { source: 'wrist', weeklyMean: 20000 }, recreation: [{ label: 'sport', intensity: 'vigorous', minPerWeek: 300 }] }, R1_M);
    expect(extreme.palFlag).toBe('capped');
    expect(extreme.pal0).toBeCloseTo(2.5, 12);
    expect(Math.abs(sumDrivers(extreme) - extreme.tdee0Kcal)).toBeLessThan(1e-9);
    expect(extreme.drivers.find((d) => d.id === 'digestion')!.kcal).toBeCloseTo(0.1 * extreme.tdee0Kcal, 6);
    const high = resolveActivity({ work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 }, recreation: [{ label: 'sport', intensity: 'vigorous', minPerWeek: 200 }] }, R1_M);
    expect(high.pal0).toBeGreaterThan(2.4);
    expect(high.pal0).toBeLessThan(2.5);
    expect(high.palFlag).toBe('high');
  });

  it('the cap acts on the non-step answers only: sessions and steps above PAL 2.5 stay, the answers drop to 0', () => {
    const athlete = resolveActivity({ work: 'manualHeavy', steps: { source: 'wrist', weeklyMean: 15000 } }, { ...R1_M, eat0Kcal: 2500 });
    expect(athlete.palFlag).toBe('capped');
    expect(athlete.occupationalKcal).toBeCloseTo(0, 6);
    expect(athlete.nonStepKcal).toBeCloseTo(0, 6);
    expect(athlete.pal0).toBeGreaterThan(2.5);
    expect(athlete.tdee0Kcal).toBeCloseTo((1.15 * R1_M.rmr0Kcal + athlete.stepsKcal + 2500) / 0.9, 9);
    expect(athlete.drivers.find((d) => d.id === 'digestion')!.kcal).toBeCloseTo(0.1 * athlete.tdee0Kcal, 6);
    // the pre-intake form is never capped
    const legacy = resolveActivity(undefined, { ...R1_M, eat0Kcal: 2500, typicalSteps: 15000 });
    expect(legacy.palFlag).toBe('high');
    expect(legacy.tdee0Kcal).toBeCloseTo((1.15 * R1_M.rmr0Kcal + legacy.stepsKcal + 2500) / 0.9, 9);
  });

  it('NASEM category of PAL0 (02 §4.6 bounds 1.53 / 1.68 / 1.85)', () => {
    expect(resolveActivity(ARCHETYPES[0]!.intake, R1_M).neatLevel).toBe('inactive');
    expect(resolveActivity(ARCHETYPES[8]!.intake, R1_M).neatLevel).toBe('lowActive');
    expect(resolveActivity(ARCHETYPES[4]!.intake, R1_M).neatLevel).toBe('active');
    expect(resolveActivity(ARCHETYPES[6]!.intake, R1_M).neatLevel).toBe('veryActive');
  });
});

describe('resolveProfile wiring', () => {
  /** The pre-intake TDEE0 algorithm, verbatim (core/resolveProfile before 2026-10-01). */
  function legacyTdee0(p: PersonProfile): number {
    const rp = resolveProfile(p);
    const h = rp.habits;
    const w = p.body.weightKg;
    const metMix = 4.0 * (1 - h.lifingCardioMix) + 5.0 * h.lifingCardioMix;
    const eat0 = (h.sessionsPerWeek * (metMix - 1) * w * 1) / 7;
    const alcG = (h.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
    const kStep = 0.44 / 1000;
    const numer = rp.rmr0Kcal + 0.15 * rp.rmr0Kcal + kStep * w * h.typicalSteps + eat0;
    let tdee0 = numer / 0.9;
    for (let it = 0; it < 4; it++) {
      const proteinG = Number.isFinite(h.habitualProteinGPerKg) ? h.habitualProteinGPerKg * w : ((DEFAULTS.habitualProteinPctEnergy / 100) * tdee0) / ATWATER.protein;
      const fibreG = (h.habitualFibreGPer1000Kcal * tdee0) / 1000;
      const carbG = ((h.habitualCarbPctEnergy / 100) * tdee0) / ATWATER.carb;
      const rest = tdee0 - ATWATER.protein * proteinG - ATWATER.carb * carbG - ATWATER.fibre * fibreG - ATWATER.alcohol * alcG;
      const fatG = Math.max(0, rest / ATWATER.fat);
      tdee0 = numer / (1 - tefFraction(proteinG, carbG, fatG, fibreG, alcG));
    }
    return tdee0;
  }

  it('without an intake TDEE0 is the pre-intake value bit for bit (steps tick or 7 000, no non-step terms)', () => {
    const people = [
      person('male', 35, 180, 90),
      person('female', 42, 165, 72, { typicalSteps: 9000, sessionsPerWeek: 3, lifingCardioMix: 0.5, habitualAlcoholDrinksPerWeek: 5 }),
      person('male', 28, 178, 75, { habitualProteinGPerKg: 2 }, { labs: { measuredRmrKcal: 1800 } }),
    ];
    for (const p of people) {
      const rp = resolveProfile(p);
      expect(rp.tdee0Kcal).toBe(legacyTdee0(p));
      expect(rp.activity!.source).toBe('default');
      expect(rp.activity!.nonStepKcal).toBe(0);
      expect(rp.habits.typicalSteps).toBe(p.habits?.typicalSteps ?? DEFAULTS.steps);
      expect(rp.habits.activity).toBeUndefined();
      expect(Math.abs(sumDrivers(rp.activity!) - rp.tdee0Kcal)).toBeLessThan(1e-6);
    }
  });

  it('without an intake the band is 02 §4.12 cv0 by RMR route (0.12 / 0.10 / 0.08), as the UI showed before', () => {
    expect(resolveProfile(person('male', 35, 180, 90)).activity!.uncertainty.relSigma).toBeCloseTo(0.12, 12);
    expect(resolveProfile(person('male', 35, 180, 90, {}, { body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, knownBodyFatPct: 25, knownBodyFatSource: 'dxa' } })).activity!.uncertainty.relSigma).toBeCloseTo(0.1, 12);
    expect(resolveProfile(person('male', 35, 180, 90, {}, { labs: { measuredRmrKcal: 1900 } })).activity!.uncertainty.relSigma).toBeCloseTo(0.08, 12);
  });

  it('with an intake: typicalSteps = S_hab, TDEE0 = the closed form at the profile`s own α0, drivers add up', () => {
    const intake: ActivityIntake = { work: 'manualModerate', steps: { source: 'wrist', workday: 12000, offDay: 8000 }, recreation: [{ label: 'football', intensity: 'vigorous', minPerWeek: 90 }] };
    const rp = resolveProfile(person('male', 35, 180, 90, { activity: intake, sessionsPerWeek: 2 }));
    const a = rp.activity!;
    expect(a.source).toBe('intake');
    expect(rp.habits.typicalSteps).toBe(10857);
    expect(rp.habits.activity).toBe(intake);
    expect(a.tdee0Kcal).toBe(rp.tdee0Kcal);
    expect(rp.eat0Kcal).toBeGreaterThan(0);
    expect(Math.abs(sumDrivers(a) - rp.tdee0Kcal)).toBeLessThan(1e-6);
    // live what-if from the echoed base reproduces the profile's TDEE0 (α0 held)
    expect(Math.abs(resolveActivity(intake, a.base).tdee0Kcal - rp.tdee0Kcal)).toBeLessThan(0.01 * rp.tdee0Kcal);
    expect(resolveActivity(intake, a.base).drivers.find((d) => d.id === 'training')!.kcal).toBeCloseTo(rp.eat0Kcal, 9);
  });

  it('VO2max prior row: nearest PAL row with an intake, nearest steps row without (R1 §3.4)', () => {
    const desk = resolveProfile(person('male', 35, 180, 90, { activity: { work: 'desk', steps: { source: 'wrist', weeklyMean: 6714 } } }));
    expect(desk.activity!.pal0).toBeLessThan(1.5);
    expect(ACTIVITY_SELECTOR[selectorIndexFor(desk)]!.pal).toBe(1.45);
    const legacy = resolveProfile(person('male', 35, 180, 90, { typicalSteps: 6714 }));
    expect(ACTIVITY_SELECTOR[selectorIndexFor(legacy)]!.steps).toBe(6500);
    const heavy = resolveProfile(person('male', 35, 180, 90, { activity: { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 } } }));
    expect(ACTIVITY_SELECTOR[selectorIndexFor(heavy)]!.pal).toBe(2.2);
  });

  it('sleep timing is not a TDEE input (R1 V13): bed/wake 23-7 vs 1-6 leaves TDEE0 unchanged', () => {
    const intake: ActivityIntake = { work: 'onFeet' };
    const a = resolveProfile(person('female', 40, 168, 70, { activity: intake, bedTimeH: 23, wakeTimeH: 7 }));
    const b = resolveProfile(person('female', 40, 168, 70, { activity: intake, bedTimeH: 1, wakeTimeH: 6 }));
    expect(Math.abs(a.tdee0Kcal - b.tdee0Kcal)).toBeLessThanOrEqual(1);
  });
});

describe('determinism', () => {
  it('same answers → identical result; the intake object is not mutated; recreation order does not matter', () => {
    const intake: ActivityIntake = Object.freeze({
      work: 'mixed',
      commute: Object.freeze({ mode: 'cycle' as const, activeMinPerWorkday: 25 }),
      steps: Object.freeze({ source: 'phone' as const, workday: 9000, offDay: 5000, phoneCarried: false }),
      recreation: Object.freeze([Object.freeze({ label: 'a', intensity: 'light' as const, minPerWeek: 60 }), Object.freeze({ label: 'b', intensity: 'vigorous' as const, minPerWeek: 45 })]),
    });
    const r1 = resolveActivity(intake, R1_F);
    const r2 = resolveActivity(intake, R1_F);
    expect(r2).toEqual(r1);
    const swapped = resolveActivity({ ...intake, recreation: [...intake.recreation!].reverse() }, R1_F);
    expect(Math.abs(swapped.tdee0Kcal - r1.tdee0Kcal)).toBeLessThan(1e-9);
    const p = person('female', 35, 165, 65, { activity: intake });
    expect(resolveProfile(p)).toEqual(resolveProfile(p));
  });
});

describe('uncertainty (R1 §3.4)', () => {
  const ON_FEET = (steps: ActivityIntake['steps']): ActivityIntake => ({ work: 'onFeet', ...(steps ? { steps } : {}) });

  it('the band is symmetric, p10/p90 = TDEE0 ∓ 1.2816σ, and never below its floor', () => {
    for (const a of ARCHETYPES) {
      for (const base of [R1_M, R1_F, { ...R1_M, rmrRoute: 'measured' as const }, { ...R1_F, rmrRoute: 'ffm' as const }]) {
        const r = resolveActivity(a.intake, base);
        expect(r.uncertainty.p90 - r.tdee0Kcal).toBeCloseTo(r.tdee0Kcal - r.uncertainty.p10, 9);
        expect(r.uncertainty.p90 - r.tdee0Kcal).toBeCloseTo(Z80 * r.uncertainty.sigmaKcal, 9);
        expect(r.uncertainty.relSigma).toBeGreaterThanOrEqual(r.uncertainty.floor - 1e-12);
      }
    }
  });

  it('floors: 0.12 skip-all, 0.10 answered, 0.08 with a measured RMR (R1 V12)', () => {
    expect(resolveActivity({}, R1_M).uncertainty.floor).toBe(0.12);
    expect(resolveActivity({}, R1_M).uncertainty.relSigma).toBeGreaterThanOrEqual(0.12);
    expect(resolveActivity({ work: 'desk' }, R1_M).uncertainty.floor).toBe(0.1);
    expect(resolveActivity({ steps: { source: 'wrist', weeklyMean: 8000 } }, R1_M).uncertainty.floor).toBe(0.1);
    expect(resolveActivity({ work: 'desk' }, { ...R1_M, rmrRoute: 'measured' }).uncertainty.floor).toBe(0.08);
  });

  it('a better step source never widens the steps component: wrist < phone < phone not carried < rough = unknown', () => {
    const sig = (s: ActivityIntake['steps']): number => resolveActivity(ON_FEET(s), R1_M).drivers.find((d) => d.id === 'steps')!.sigmaKcal;
    const n = 9857;
    const wrist = sig({ source: 'wrist', weeklyMean: n });
    const phone = sig({ source: 'phone', weeklyMean: n });
    const notCarried = sig({ source: 'phone', weeklyMean: n, phoneCarried: false });
    const rough = sig({ source: 'estimate', weeklyMean: n });
    const unknown = sig(undefined);
    expect(wrist).toBeLessThan(phone);
    expect(phone).toBeLessThan(notCarried);
    expect(notCarried).toBeLessThan(rough);
    expect(unknown).toBeCloseTo(rough, 9);
  });

  it('adding a wrist step history to a skipped intake narrows the band (Δσ > 0, R1 V12)', () => {
    const skip = resolveActivity({}, R1_M);
    const wrist = resolveActivity({ steps: { source: 'wrist', weeklyMean: 7000 } }, R1_M);
    expect(skip.uncertainty.sigmaKcal - wrist.uncertainty.sigmaKcal).toBeGreaterThan(0);
  });

  it('σ is non-decreasing in over-report-prone answers (more recreation, more time on feet at home)', () => {
    let prev = 0;
    for (const min of [0, 60, 180, 420, 900]) {
      const s = resolveActivity({ work: 'onFeet', recreation: [{ label: 'x', intensity: 'vigorous', minPerWeek: min }] }, R1_M).uncertainty.sigmaKcal;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    const little = resolveActivity({ work: 'onFeet', onFeetAtHome: 'little' }, R1_M).drivers.find((d) => d.id === 'home')!.sigmaKcal;
    const lot = resolveActivity({ work: 'onFeet', onFeetAtHome: 'aLot' }, R1_M).drivers.find((d) => d.id === 'home')!.sigmaKcal;
    expect(lot).toBeGreaterThan(little);
  });

  it('p10 and p90 rise with steps (the band moves with the estimate)', () => {
    let p10 = -Infinity;
    let p90 = -Infinity;
    for (const s of [2000, 5000, 8000, 12000, 16000, 20000]) {
      const r = resolveActivity({ work: 'desk', steps: { source: 'estimate', weeklyMean: s } }, R1_M);
      expect(r.uncertainty.p10).toBeGreaterThan(p10);
      expect(r.uncertainty.p90).toBeGreaterThan(p90);
      p10 = r.uncertainty.p10;
      p90 = r.uncertainty.p90;
    }
  });

  it('the largest variance component names the biggest unknown (heavy manual: the work class)', () => {
    expect(resolveActivity(ARCHETYPES[6]!.intake, R1_M).uncertainty.largest).toBe('work');
    expect(resolveActivity(ARCHETYPES[0]!.intake, R1_M).uncertainty.largest).toBe('rmr');
  });
});

describe('steady state: a desk worker and a manual labourer with the same body', () => {
  const DESK: ActivityIntake = { work: 'desk', steps: { source: 'wrist', workday: 7000, offDay: 6000 } };
  const HEAVY: ActivityIntake = { work: 'manualHeavy', steps: { source: 'wrist', workday: 15000, offDay: 9000 } };
  const TRADES: ActivityIntake = { work: 'manualModerate', steps: { source: 'wrist', workday: 12000, offDay: 8000 } };
  // FAO/WHO/UNU lifestyle PAL bands (R1 V1): seated 1.4-1.5, standing/moderate 1.8-2.0, heavy 2.0-2.4
  const bodies: [string, PersonProfile][] = [];
  for (const sex of ['male', 'female'] as const)
    for (const age of [25, 40, 55])
      for (const bmi of [20, 26, 32]) {
        const h = sex === 'male' ? 178 : 164;
        bodies.push([`${sex} ${age} y BMI ${bmi}`, person(sex, age, h, Math.round(bmi * (h / 100) ** 2))]);
      }

  it('heavy manual − desk maintenance = 0.5-1.0 × RMR0 (FAO 2.0-2.4 vs 1.4-1.5) for every body', () => {
    for (const [name, p] of bodies) {
      const d = resolveProfile({ ...p, habits: { activity: DESK } });
      const m = resolveProfile({ ...p, habits: { activity: HEAVY } });
      const dPal = (m.tdee0Kcal - d.tdee0Kcal) / d.rmr0Kcal;
      expect(dPal, name).toBeGreaterThanOrEqual(0.5);
      expect(dPal, name).toBeLessThanOrEqual(1.0);
    }
  });

  it('trades − desk maintenance = 0.3-0.6 × RMR0 (FAO 1.8-2.0 vs 1.4-1.5) for every body', () => {
    for (const [name, p] of bodies) {
      const d = resolveProfile({ ...p, habits: { activity: DESK } });
      const t = resolveProfile({ ...p, habits: { activity: TRADES } });
      const dPal = (t.tdee0Kcal - d.tdee0Kcal) / d.rmr0Kcal;
      expect(dPal, name).toBeGreaterThanOrEqual(0.3);
      expect(dPal, name).toBeLessThanOrEqual(0.6);
    }
  });
});
