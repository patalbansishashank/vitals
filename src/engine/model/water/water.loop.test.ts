// @vitest-environment node
/**
 * Water inside the real loop (burn-in, recorder, checks) with small scripted stand-ins for the modules it reads
 * (intake, fasting, fuel, composition), so the test does not depend on other work packages.
 */
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { defineModule } from '../../core/moduleKit';
import { PROGRAM_A, repeatSchedule } from '../../core/__tests__/fixtures';
import type { AnyEngineModule } from '../../types/module';
import { waterModule } from './index';
import { MAN } from './testKit';

const profile = resolveProfile(MAN);
// sodium pinned to the habitual intake: since 2026-09-30 the default sodium follows the day's energy, and PROGRAM_A's 85 %
// would add a sodium-water decline the scripted checks below are not about
const compiled = compileSchedule(repeatSchedule(40, [0], [{ ...PROGRAM_A, hydration: { sodiumG: profile.habitualSodiumMg / 1000 } }]), profile);
const G_LIVER = profile.body.glycogen.liverG;
const G_MUSCLE = profile.body.glycogen.muscleG;

const intake = defineModule<object>({
  id: 'intake',
  specSection: 'test',
  dossiers: 'test',
  params: [],
  reads: [],
  writes: ['carbAbs24G', 'fibreEffG'],
  records: [],
  init: (_k, ctx, bus) => {
    bus.carbAbs24G = ctx.profile.habitualCarbG;
    bus.fibreEffG = ctx.profile.habitualFibreG;
    return {};
  },
  stepHour: (_s, _k, bus, _hour, _day, clock) => {
    // no carbohydrate during the scripted fast (days 20-23)
    bus.carbAbs24G = clock.day >= 20 && clock.day < 24 ? 0 : profileCarb();
  },
}) as unknown as AnyEngineModule;
const profileCarb = (): number => profile.habitualCarbG;

const fasting = defineModule<object>({
  id: 'fasting',
  specSection: 'test',
  dossiers: 'test',
  params: [],
  reads: [],
  writes: ['fastActive'],
  records: [],
  init: () => ({}),
  stepHour: (_s, _k, bus, _hour, _day, clock) => {
    bus.fastActive = clock.day >= 20 && clock.day < 24 ? 1 : 0;
  },
}) as unknown as AnyEngineModule;

const fuel = defineModule<object>({
  id: 'fuel',
  specSection: 'test',
  dossiers: 'test',
  params: [],
  reads: [],
  writes: ['liverGlycogenG', 'muscleGlycogenG'],
  records: [],
  init: (_k, ctx, bus) => {
    bus.liverGlycogenG = ctx.profile.body.glycogen.liverG;
    bus.muscleGlycogenG = ctx.profile.body.glycogen.muscleG;
    return {};
  },
  stepHour: (_s, _k, bus, _hour, _day, clock) => {
    // days 5-11: muscle glycogen down by 200 g over 48 h, restored over 48 h from day 12
    const t = clock.hourIndex;
    const down = Math.min(1, Math.max(0, (t - 5 * 24) / 48));
    const up = Math.min(1, Math.max(0, (t - 12 * 24) / 48));
    bus.muscleGlycogenG = G_MUSCLE - 200 * (down - up);
    bus.liverGlycogenG = G_LIVER;
  },
}) as unknown as AnyEngineModule;

const composition = defineModule<object>({
  id: 'composition',
  specSection: 'test',
  dossiers: 'test',
  params: [],
  reads: [],
  writes: ['fatMassKg', 'ffmActKg', 'tissueMassKg', 'leanTissueKg'],
  records: [],
  init: (_k, ctx, bus) => {
    bus.fatMassKg = ctx.profile.fm0Kg;
    bus.ffmActKg = ctx.profile.ffm0Kg;
    bus.leanTissueKg = ctx.profile.ffm0Kg;
    bus.tissueMassKg = ctx.profile.fm0Kg + ctx.profile.ffm0Kg;
    return {};
  },
}) as unknown as AnyEngineModule;

const MODULES_UNDER_TEST: readonly AnyEngineModule[] = [intake, fasting, fuel, composition, waterModule as unknown as AnyEngineModule];

describe('water in the loop (scripted neighbours)', () => {
  const run = (opts: Parameters<typeof runEngine>[2] = {}) => runEngine(profile, compiled, { burnInDays: 4, checks: true, ...opts }, MODULES_UNDER_TEST);

  it('keeps the mass identity (O-5) and reads the entered weight at the day-0 wake hour (morning anchor)', () => {
    const r = run();
    expect(r.meta.checks!.massMaxAbsKg).toBeLessThan(1e-9);
    // wake-hour series: the t = 0 value is day 0's wake-hour value (the entered morning weight)
    const w0 = r.initial.scaleWeight!;
    expect(w0).toBe(r.daily.scaleWeight![0]);
    expect(Math.abs(w0 - profile.weightKg)).toBeLessThan(1e-3);
    expect(Math.abs(r.meta.checks!.t0WeightErrKg!)).toBeLessThan(1e-3);
    for (const id of ['waterWeight', 'glycogenWater', 'gutContent', 'ecfShift'] as const) expect(Math.abs(r.initial[id]!)).toBeLessThan(1e-3);
  });

  it('is flat at maintenance and shows glycogen water (1 + h)·ΔG = −0.8 kg when muscle glycogen falls 200 g', () => {
    const r = run();
    const sw = r.daily.scaleWeight!;
    const w0 = r.initial.scaleWeight!;
    for (let d = 0; d < 4; d++) expect(Math.abs(sw[d]! - w0)).toBeLessThan(1e-4);
    expect(sw[8]! - w0).toBeCloseTo(-0.8, 3);
    expect(r.daily.glycogenWater![8]!).toBeCloseTo(-0.8, 3);
    expect(r.daily.waterWeight![8]!).toBeCloseTo(r.daily.glycogenWater![8]! + r.daily.ecfShift![8]! + r.daily.gutContent![8]!, 4);
    expect(Math.abs(sw[16]! - w0)).toBeLessThan(0.02); // restored after day 12 (+ 48 h)
  });

  it('a scripted 4-day fast empties gut and ECF (E_cna → −0.9 L, gut → 0) and refeeding restores them', () => {
    const r = run();
    const w0 = r.initial.scaleWeight!;
    expect(r.daily.gutContent![23]!).toBeLessThan(-0.4);
    expect(r.daily.ecfShift![23]!).toBeLessThan(-0.6);
    expect(r.daily.scaleWeight![23]!).toBeLessThan(w0 - 1.2);
    expect(Math.abs(r.daily.scaleWeight![35]! - w0)).toBeLessThan(0.1);
    expect(r.hourly.scaleWeight).toHaveLength(40 * 24);
    expect(r.hourly.scaleWeight!.every((v) => Number.isFinite(v))).toBe(true);
    // body fat % is 100·FM/scale (hourly; daily value at the wake hour)
    expect(r.daily.bodyFatPct![2]!).toBeCloseTo((100 * profile.fm0Kg) / (profile.fm0Kg + profile.ffm0Kg), 3);
    // ...and rises when the scale falls through labile mass at constant fat (day 8: −0.8 kg of glycogen water)
    expect(r.daily.bodyFatPct![8]!).toBeCloseTo((100 * profile.fm0Kg) / (profile.fm0Kg + profile.ffm0Kg - 0.8), 2);
  });

  it('is deterministic and independent of the record mode', () => {
    const a = run();
    const b = run();
    expect(Array.from(b.hourly.scaleWeight!)).toEqual(Array.from(a.hourly.scaleWeight!));
    const daily = run({ record: 'daily' });
    expect(Array.from(daily.daily.scaleWeight!)).toEqual(Array.from(a.daily.scaleWeight!));
  });

  it('works without burn-in (references set at init)', () => {
    const r = run({ burnInDays: 0 });
    expect(r.meta.checks!.massMaxAbsKg).toBeLessThan(1e-9);
    expect(Math.abs(r.initial.scaleWeight! - profile.weightKg)).toBeLessThan(0.05);
    expect(Math.abs(r.daily.scaleWeight![0]! - r.initial.scaleWeight!)).toBeLessThan(1e-4);
  });
});
