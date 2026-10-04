import { act, renderHook } from '@testing-library/react';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { bodyFatToSlider } from '@/engine/body';
import { buildPersonProfile, summarizeBody, TYPICAL_BASICS } from '@/features/body/model';
import { estimateMaintenance } from '@/features/body/maintenance';
import { displayMeasure, sameDisplayed } from '@/features/body/units';
import { lbToKg } from '@/lib/units';
import {
  BODY_KEY,
  BODY_SAVE_DEBOUNCE_MS,
  BODY_VERSION,
  DEFAULT_BODY,
  flushBodyPersistence,
  isBodyProfileState,
  migrateBody,
  pickBodyValues,
  selectBodyValues,
  useBodyContext,
  useBodyEstimate,
  usePersonProfile,
  useProfileStore,
  type BodyProfileValues,
} from './profileStore';
import { withSystemWrite } from '@/state/scope';

const store = () => useProfileStore.getState();
const stored = () => JSON.parse(localStorage.getItem(BODY_KEY) ?? 'null') as { state: BodyProfileValues; version: number } | null;

function seedBasics(over: Partial<BodyProfileValues> = {}) {
  act(() => {
    store().setSex('male');
    store().setAge(36);
    store().setHeight(178);
    store().setWeight(84.9);
  });
  if (Object.keys(over).length) act(() => withSystemWrite(() => useProfileStore.setState(over)));
}

beforeEach(() => {
  flushBodyPersistence();
  localStorage.clear();
  act(() => store().resetBody());
  flushBodyPersistence();
  localStorage.clear();
});

describe('profile store: persistence', () => {
  it('round-trips every input through localStorage (versioned)', async () => {
    seedBasics();
    act(() => {
      store().setShape({ bodyFatPct: 22.5, belly: 0.4, muscleUpper: 0.6 });
      store().setWaist({ use: true, cm: 92.5, neckCm: 39 });
      store().setKnownBodyFat({ use: true, pct: 21, source: 'bia' });
      store().setTraining({ years: 4, quality: 'serious' });
      store().setHabits({ sessionsPerWeek: 4, typicalSteps: 8400, habitualCarbPctEnergy: 30, habitualCaffeineMg: 200 });
      store().setLabs({ ldlMmolL: 3.1, measuredRmrKcal: 1850 });
      store().setEthnicity('southAsian');
      store().setSetup('done');
    });
    flushBodyPersistence();
    const file = stored();
    expect(file?.version).toBe(BODY_VERSION);
    const before = selectBodyValues(store());
    expect(file?.state).toEqual(before);

    act(() => withSystemWrite(() => useProfileStore.setState({ ...DEFAULT_BODY })));
    expect(store().weightKg).toBeNull();
    await act(() => useProfileStore.persist.rehydrate());
    expect(selectBodyValues(store())).toEqual(before);
  });

  it('debounces writes: a drag does not write storage every frame', () => {
    vi.useFakeTimers();
    try {
      seedBasics();
      flushBodyPersistence();
      for (let i = 0; i < 30; i++) act(() => store().setShape({ bodyFatPct: 20 + i / 10 }));
      expect(stored()?.state.shape.bodyFatPct).toBeUndefined();
      act(() => vi.advanceTimersByTime(BODY_SAVE_DEBOUNCE_MS + 10));
      expect(stored()?.state.shape.bodyFatPct).toBeCloseTo(22.9, 6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('migrates older and damaged state field by field (migration stub)', async () => {
    const v0 = { sex: 'robot', heightCm: 999, weightKg: '80', waistCm: 91, shape: { bodyFatPct: 80, chest: -3, junk: 1 }, extra: true };
    const m = migrateBody(v0, 0);
    expect(m.sex).toBeNull();
    expect(m.heightCm).toBe(210);
    expect(m.weightKg).toBeNull();
    expect(m.waist).toMatchObject({ use: true, cm: 91 });
    expect(m.shape).toEqual({ bodyFatPct: 60, chest: -1 });
    expect(m).not.toHaveProperty('extra');

    localStorage.setItem(BODY_KEY, JSON.stringify({ state: v0, version: 0 }));
    await act(() => useProfileStore.persist.rehydrate());
    expect(store().waist.cm).toBe(91);
    expect(store().heightCm).toBe(210);
  });

  it('validates imports', () => {
    expect(isBodyProfileState(DEFAULT_BODY)).toBe(true);
    expect(isBodyProfileState({ weightKg: 'heavy' })).toBe(false);
    expect(isBodyProfileState({ sex: 'robot' })).toBe(false);
    expect(isBodyProfileState(null)).toBe(false);
    expect(pickBodyValues({})).toEqual(DEFAULT_BODY);
  });
});

describe('profile store: SI storage and units', () => {
  it('stores kg/cm; switching units never changes a stored value', () => {
    seedBasics();
    const kg = store().weightKg;
    // an imperial user presses + on 187.2 lb → 187.4 lb
    const next = lbToKg(displayMeasure('mass', 'imperial', kg!) + 0.2);
    act(() => store().setWeight(next));
    expect(store().weightKg).toBeCloseTo(85.00, 1);
    expect(displayMeasure('mass', 'imperial', store().weightKg!)).toBe(187.4);
    expect(displayMeasure('mass', 'metric', store().weightKg!)).toBe(85);
  });

  it('re-committing the displayed imperial value is not a change (no drift)', () => {
    const kg = 84.9;
    const lb = displayMeasure('mass', 'imperial', kg); // 187.2
    expect(lb).toBe(187.2);
    expect(lbToKg(lb)).not.toBe(kg); // 84.912… — would drift if written
    expect(sameDisplayed('mass', 'imperial', kg, lbToKg(lb))).toBe(true);
    expect(sameDisplayed('mass', 'imperial', kg, lbToKg(lb + 0.2))).toBe(false);
  });

  it('clamps basics into the screen ranges', () => {
    act(() => {
      store().setAge(12.4);
      store().setHeight(250);
      store().setWeight(20);
    });
    expect(store().ageYears).toBe(18);
    expect(store().heightCm).toBe(210);
    expect(store().weightKg).toBe(35);
  });
});

describe('profile store: touched sliders', () => {
  it('stores only the sliders the user touched and passes only those to the engine', () => {
    seedBasics();
    expect(store().shape).toEqual({});
    expect(buildPersonProfile(selectBodyValues(store())).body.sliders).toBeUndefined();

    act(() => store().setShape({ bodyFatPct: 20 }));
    expect(store().shape).toEqual({ bodyFatPct: 20 });
    let sliders = buildPersonProfile(selectBodyValues(store())).body.sliders;
    expect(sliders).toEqual({ adiposity: bodyFatToSlider('male', 20) });

    act(() => store().setShape({ muscleUpper: 0.7, belly: 0.5 }));
    sliders = buildPersonProfile(selectBodyValues(store())).body.sliders;
    expect(sliders?.muscularity).toBe(0.7);
    expect(sliders?.bellyVsHips).toBeCloseTo(0.5);
    expect(sliders?.muscleTorso).toBeUndefined(); // regional split needs both muscle scales
    expect(sliders?.chest).toBeUndefined();

    act(() => store().setShape({ muscleLower: 0.3 }));
    sliders = buildPersonProfile(selectBodyValues(store())).body.sliders;
    expect(sliders?.muscularity).toBeCloseTo(0.5);
    expect(sliders?.muscleTorso).toBeCloseTo(0.4);
    expect(sliders?.muscleLegs).toBeCloseTo(-0.4);

    act(() => store().setShape({ belly: undefined }));
    expect(store().shape).not.toHaveProperty('belly');

    act(() => store().setShape({ chest: 5 }));
    expect(store().shape.chest).toBe(1);

    act(() => store().resetShape());
    expect(store().shape).toEqual({});
  });

  it('stamps every change (revision, updatedAt)', () => {
    const r0 = store().revision;
    act(() => store().setShape({ arms: 0.2 }));
    expect(store().revision).toBe(r0 + 1);
    expect(typeof store().updatedAt).toBe('string');
  });
});

describe('PersonProfile production (validated by the engine)', () => {
  const variants: Array<[string, (v: BodyProfileValues) => BodyProfileValues]> = [
    ['first run (nothing entered)', (v) => v],
    ['male basics', (v) => ({ ...v, sex: 'male', ageYears: 36, heightCm: 178, weightKg: 84.9 })],
    ['female, cycle, menopause, labs', (v) => ({ ...v, sex: 'female', ageYears: 47, heightCm: 164, weightKg: 70, menopause: 'peri', cycle: { tracking: true, cycleLengthD: 26, lastPeriodStart: '2026-09-12', contraception: 'none' }, labs: { hdlMmolL: 1.6, sbpMmHg: 118 } })],
    ['prefer not to say, neutral base', (v) => ({ ...v, sex: 'unspecified', ageYears: 29, heightCm: 170, weightKg: 68 })],
    ['every measurement', (v) => ({ ...v, sex: 'male', ageYears: 52, heightCm: 183, weightKg: 118, waist: { use: true, cm: 121, neckCm: 44, hipCm: null }, knownBodyFat: { use: true, pct: 34, source: 'dxa' }, training: { years: 8, quality: 'serious' }, shape: { bodyFatPct: 30, belly: 1, hips: -1, chest: 0.3, arms: -0.2, muscleUpper: 0.6, muscleLower: 0.5 }, habits: { sessionsPerWeek: 5, lifingCardioMix: 0.2, typicalSteps: 12000, habitualCarbPctEnergy: 10, habitualProteinGPerKg: 1.8, habitualSodiumG: 4, habitualCaffeineMg: 300, habitualAlcoholDrinksPerWeek: 3, dietAnimalLevel: 'pescatarian', upfShare: 0.3, foodQuality: 3, multivitamin: true, smoker: true, habitualLiquidKcal: 250, bedTimeH: 0.5, wakeTimeH: 7.5, sleepQuality: 'fair', stress: 'high' }, ethnicity: 'eastAsian' })],
    ['extremes', (v) => ({ ...v, sex: 'female', ageYears: 90, heightCm: 140, weightKg: 250, shape: { bodyFatPct: 4, muscleUpper: 1, muscleLower: 1 } })],
  ];

  it.each(variants)('%s → resolveProfile accepts it', (_name, make) => {
    const v = make({ ...DEFAULT_BODY });
    const p = buildPersonProfile(v);
    expect(p.schemaVersion).toBe(1);
    const r = resolveProfile(p);
    expect(Number.isFinite(r.tdee0Kcal)).toBe(true);
    expect(r.tdee0Kcal).toBeGreaterThan(900);
    expect(r.tdee0Kcal).toBeLessThan(6500);
    expect(Number.isFinite(r.body.bodyFatPct)).toBe(true);
    expect(r.ffm0Kg + r.fm0Kg).toBeCloseTo(p.body.weightKg, 6);
    // no undefined keys leak into the contract
    expect(JSON.stringify(p)).toBe(JSON.stringify(JSON.parse(JSON.stringify(p))));
    for (const s of Object.values(p.body.sliders ?? {})) expect(Number.isFinite(s)).toBe(true);
  });

  it('maps the screen to the contract fields', () => {
    const v: BodyProfileValues = {
      ...DEFAULT_BODY,
      sex: 'female',
      ageYears: 40,
      heightCm: 165,
      weightKg: 66,
      waist: { use: false, cm: 80, neckCm: null, hipCm: null },
      knownBodyFat: { use: false, pct: 25, source: 'dxa' },
      training: { years: 2, quality: null },
      habits: { habitualCarbPctEnergy: 20 },
    };
    const p = buildPersonProfile(v);
    expect(p.body.waistCm).toBeUndefined(); // switch off → not an observation
    expect(p.body.knownBodyFatPct).toBeUndefined();
    expect(p.body.trainingYears).toBe(2);
    expect(p.habits?.trainingHistory).toBe('1to3y');
    expect(p.sexUnspecified).toBeUndefined();
    // habitual carbohydrate becomes the glycogen input at the engine's own intake
    const r = resolveProfile(p);
    expect(p.body.habitualCarbGPerKg).toBeCloseTo(r.habitualCarbG / 66, 1);
    expect(buildPersonProfile({ ...v, sex: 'unspecified' }).sexUnspecified).toBe(true);
    expect(buildPersonProfile({ ...v, sex: null }).body.weightKg).toBe(66);
    expect(buildPersonProfile({ ...DEFAULT_BODY }).body.weightKg).toBe(TYPICAL_BASICS.weightKg.unspecified);
  });

  it('maintenance is the simulator baseline (resolveProfile TDEE0) with the 02 §4.12 band', () => {
    const v: BodyProfileValues = { ...DEFAULT_BODY, sex: 'male', ageYears: 36, heightCm: 178, weightKg: 84.9, habits: { typicalSteps: 8400, sessionsPerWeek: 4 } };
    const p = buildPersonProfile(v);
    const m = estimateMaintenance(p);
    expect(m.kcal).toBe(resolveProfile(p).tdee0Kcal);
    expect(m.cv).toBe(0.12);
    expect(m.band80[1] - m.kcal).toBeCloseTo(1.2816 * 0.12 * m.kcal, 0);
    expect(estimateMaintenance({ ...p, labs: { measuredRmrKcal: 1800 } }).cv).toBe(0.08);
    expect(summarizeBody(v).maintenance.kcal).toBe(m.kcal);
  });

  it('"prefer not to say" averages both equation sets with a wider range', () => {
    const base: BodyProfileValues = { ...DEFAULT_BODY, ageYears: 35, heightCm: 172, weightKg: 75 };
    const m = summarizeBody({ ...base, sex: 'male' });
    const f = summarizeBody({ ...base, sex: 'female' });
    const u = summarizeBody({ ...base, sex: 'unspecified' });
    expect(u.bodyFatPct).toBeCloseTo((m.bodyFatPct + f.bodyFatPct) / 2, 6);
    expect(u.bodyFatSdPct).toBeGreaterThan(Math.max(m.bodyFatSdPct, f.bodyFatSdPct));
  });
});

describe('selectors', () => {
  it('useBodyEstimate / usePersonProfile / useBodyContext follow the store', () => {
    const { result } = renderHook(() => ({ est: useBodyEstimate(), profile: usePersonProfile(), ctx: useBodyContext() }));
    expect(result.current.est.complete).toBe(false);
    expect(result.current.est.missing).toEqual(['sex', 'age', 'height', 'weight']);
    // typical placeholders are never handed to the safety layer
    expect(result.current.ctx).toMatchObject({ ageYears: undefined, bmi: undefined, bodyFatPct: undefined, sex: undefined });

    seedBasics();
    expect(result.current.est.complete).toBe(true);
    expect(result.current.ctx.ageYears).toBe(36);
    expect(result.current.ctx.bmi).toBeCloseTo(84.9 / 1.78 ** 2, 6);
    expect(result.current.ctx.sex).toBe('male');
    expect(result.current.ctx.bodyFatPct).toBeCloseTo(result.current.est.bodyFatPct, 6);
    expect(result.current.profile.body).toMatchObject({ sex: 'male', ageYears: 36, heightCm: 178, weightKg: 84.9 });

    const before = result.current.est.bodyFatPct;
    act(() => store().setShape({ bodyFatPct: 15 }));
    expect(result.current.est.bodyFatPct).toBeLessThan(before);
    expect(result.current.est.bodyFatBand80[0]).toBeLessThan(result.current.est.bodyFatPct);

    act(() => store().setHabits({ sessionsPerWeek: 12, lifingCardioMix: 0.8 }));
    expect(result.current.ctx.highTrainingLoad).toBe(true);
  });
});
