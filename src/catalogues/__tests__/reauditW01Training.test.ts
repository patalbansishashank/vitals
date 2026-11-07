// @vitest-environment node
/**
 * Re-audit (waves 0-1) regression fixtures of package F06-training:
 *  - A1-020: per-bout nonlinear muscle terms (f_fastHV raw count, kernel saturation and pulse) follow the true physical bout
 *    (stable identity + compiled interval), never clock-hour adjacency — same-hour distinct bouts, a gapped single bout,
 *    adjacent-hour distinct bouts, a midnight continuation, splitting/permutation and snapshot resume, nominal and drawn.
 *  - A1-021: an engine cardio part is the ordered concatenation of every dose's segments; catalogue vector, compiled
 *    sessions, day estimators and the hourly engine agree (MEM, hard minutes, guideline minutes, energy).
 *  - A1-022: an unknown hard-set count never becomes observed completion, parity or a sentinel 0; known energy/mobility stay.
 *  - A1-040: the habitual step reference has its own overlap status, disclosed even when every current day is known.
 *  - A1-062: Borg CR10, the generic relative-effort scale, RIR-RPE and unscaled ratings are distinct constructs.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateStimulus,
  resolveDose,
  stimulusEquivalence,
  toEngineDose,
  vectorOf,
  weeklyDose,
  type ExerciseRecord,
  type PerformedExercise,
  type StimulusVector,
} from '@/catalogues';
import { unknownDosePart } from '@/catalogues/equivalence';
import { STIMULUS_DOSE_VERSION, type StimulusVectorDetail } from '@/catalogues/stimulus';
import { SEED_CATALOGUE as C } from '@/content/catalogues';
import { compileSchedule, DayHourTable, expandDayToHours, habitualWeek, loadHour, newHourInput } from '@/engine/core/compileSchedule';
import { createSignalBus } from '@/engine/types/signals';
import { activityReference } from '@/engine/core/activityReference';
import { buildModelParams } from '@/engine/core/paramsRegistry';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { MODULES } from '@/engine/core/moduleRegistry';
import { N_REGIONS, type DayInput, type SessionResolved } from '@/engine/types/inputs';
import type { AnyEngineModule } from '@/engine/types/module';
import type { CardioSession, DayTemplate, ExerciseSession, IntervalPhase, ResistanceSession, ResistanceSetGroup, Schedule } from '@/engine/types/schedule';
import {
  activityConstants,
  activityModule,
  dayAerobicDose,
  dayHealthMinutes,
  dayLedgerSteps,
  HABITUAL_STEPS_OVERLAP_UNKNOWN,
  habitualStepsOverlapStatus,
  sessionGrossKcalPerMin,
  sessionsBookedKcal,
  stepsOverlapAssumptions,
  STEPS_OVERLAP_UNKNOWN,
} from '@/engine/model/activity';
import { healthClassFromRating, healthClassFromRelativeEffort, rpeEnergyMapApplies, rpeToX } from '@/engine/model/activity/equations';
import {
  MUSCLE_UNKNOWN_DOSE_ASSUMPTION,
  muscleOutputStatus,
  muscleRunAssumptions,
  muscleUnknownDoseFromDay,
  type MuscleState,
} from '@/engine/model/muscle';
import { MuscleSim, compileWeek, person as musclePerson } from '@/engine/model/muscle/__tests__/harness';
import { makeCtx as moduleCtx, person as actPerson } from '@/engine/model/moderators/testkit';

const ex = (id: string): ExerciseRecord => {
  const e = C.exercise(id);
  if (!e) throw new Error(id);
  return e;
};

// ============================================================================ A1-020 physical bout identity (muscle)

const CHEST = 0;
const REPORTED = { sets: 'reported', regions: 'reported', load: 'reported', rir: 'reported', rest: 'reported' } as const;
/** A homogeneous chest group: 75 %1RM, RIR 0, rest 120 s (f_RIR·f_load·f_rest = 1 at nominal), timed inside its bout. */
const grp = (sets: number, startOffsetMin: number, durationMin: number, loadPct1RM = 75): ResistanceSetGroup => ({
  sets,
  regionWeights: { chest: 1 },
  contraction: 'dynamic',
  loadPct1RM,
  rir: 0,
  restSec: 120,
  startOffsetMin,
  durationMin,
  provenance: { ...REPORTED },
});
const rt = (startH: number, groups: ResistanceSetGroup[], sessionId?: string, durationMin?: number): ResistanceSession => ({
  kind: 'resistance',
  startH,
  groups,
  ...(sessionId !== undefined ? { sessionId } : {}),
  ...(durationMin !== undefined ? { durationMin } : {}),
});
function tpl(id: string, exercise: ExerciseSession[]): DayTemplate {
  return {
    id,
    label: id,
    energy: { kind: 'pctMaintenance', pct: 100 },
    macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
    meals: { count: 3, window: { startH: 8, lengthH: 11 } },
    exercise,
    steps: 7000,
  } as DayTemplate;
}
const REST = (): DayTemplate => tpl('rest', []);
const PERSON = musclePerson({ trainingHistory: '1to3y', sessionsPerWeek: 0 });
const LOW_GLY = (_h: number, _hour: unknown, bus: { muscleGlycogenRel: number }): void => void (bus.muscleGlycogenRel = 0);
const DRAWN: Record<string, number> = { 'muscle.fastHVSets': 8, 'muscle.fFastHV': 0.9, 'muscle.kRir': 0.085, 'muscle.fRest60': 0.82, 'muscle.kernelSets': 5 };

/** Run the programs (one per day) in a fresh muscle simulator under low glycogen; chest effective sets per day and hourly stim. */
function runBouts(days: DayTemplate[], overrides?: Record<string, number>): { chest: number[]; stim: number[]; sim: MuscleSim } {
  const sim = new MuscleSim(PERSON, overrides ? { overrides } : {});
  const week = compileWeek(sim.profile, days, days.map((_, i) => i));
  const chest: number[] = [];
  const stim: number[] = [];
  for (const d of week) {
    sim.runDay(d, LOW_GLY);
    chest.push(sim.s.setsHist[CHEST * 7 + ((sim.s.histIdx + 6) % 7)]!);
    stim.push(...sim.stimHours);
  }
  return { chest, stim, sim };
}
const total = (a: number[]): number => a.reduce((x, y) => x + y, 0);

describe('A1-020 per-bout nonlinear muscle terms follow the physical bout', () => {
  for (const [label, ov] of [['nominal', undefined], ['drawn', DRAWN]] as const) {
    describe(label, () => {
      const K = new MuscleSim(PERSON, ov ? { overrides: ov } : {}).k;
      // one lone 6-set bout: below the fastHV threshold, its effective sets are the per-bout unit
      const e6 = total(runBouts([tpl('one', [rt(17, [grp(6, 0, 20)], 'a')]), REST()], ov).chest);
      const over = (sets: number): number => Math.max(0, sets - K.fastHVSets);
      const oneBout = (sets: number): number => (e6 / 6) * (sets - over(sets) * (1 - K.fFastHV));

      it('two distinct bouts in one clock hour keep their own counts and pulses (not one 12-set bout)', () => {
        const two = runBouts([tpl('two', [rt(17, [grp(6, 0, 20)], 'a'), rt(17.5, [grp(6, 0, 20)], 'b')]), REST()], ov);
        const single = runBouts([tpl('single', [rt(17, [grp(12, 0, 40)], 'a')]), REST()], ov);
        expect(total(two.chest)).toBeCloseTo(2 * e6, 12);
        expect(total(single.chest)).toBeCloseTo(oneBout(12), 12);
        expect(total(single.chest)).toBeLessThan(total(two.chest));
        // one saturating pulse per bout: the two bouts' stimulus is exactly twice one 6-set bout, above one 12-set bout
        const lone = runBouts([tpl('one', [rt(17, [grp(6, 0, 20)], 'a')]), REST()], ov);
        for (let h = 0; h < 48; h++) expect(two.stim[h]!).toBeCloseTo(2 * lone.stim[h]!, 12);
        expect(Math.max(...two.stim)).toBeGreaterThan(Math.max(...single.stim));
      });

      it('identity-less sessions (legacy fallback: origin day + session index) are distinct bouts too', () => {
        const two = runBouts([tpl('two', [rt(17, [grp(6, 0, 20)]), rt(17.5, [grp(6, 0, 20)])]), REST()], ov);
        expect(total(two.chest)).toBeCloseTo(2 * e6, 12);
      });

      it('a single bout with an empty clock hour inside its interval stays one bout', () => {
        const gap = runBouts([tpl('gap', [rt(17, [grp(6, 0, 20), grp(6, 120, 20)], 'g', 180)]), REST()], ov);
        const contiguous = runBouts([tpl('contig', [rt(17, [grp(6, 0, 20), grp(6, 30, 20)], 'g', 60)]), REST()], ov);
        expect(total(gap.chest)).toBeCloseTo(oneBout(12), 12);
        expect(total(contiguous.chest)).toBeCloseTo(oneBout(12), 12);
        // splitting a bout never creates more pulses: one continuing pulse, smaller than two bouts' two pulses
        const twoBouts = runBouts([tpl('twoB', [rt(17, [grp(6, 0, 20)], 'a'), rt(19, [grp(6, 0, 20)], 'b')]), REST()], ov);
        expect(total(gap.stim)).toBeLessThan(total(twoBouts.stim));
      });

      it('distinct bouts in adjacent clock hours are not merged', () => {
        const adj = runBouts([tpl('adj', [rt(17, [grp(6, 0, 20)], 'a'), rt(18, [grp(6, 0, 20)], 'b')]), REST()], ov);
        expect(total(adj.chest)).toBeCloseTo(2 * e6, 12);
      });

      it('a bout continued past midnight keeps its identity; a new bout after midnight is another bout', () => {
        const cont = runBouts([tpl('late', [rt(23.5, [grp(6, 0, 20), grp(6, 30, 20)], 'late', 60)]), REST()], ov);
        expect(cont.chest[1]!).toBeGreaterThan(0); // the sets after midnight were stepped on day 1
        expect(total(cont.chest)).toBeCloseTo(oneBout(12), 12);
        const split = runBouts([tpl('d0', [rt(23, [grp(6, 0, 20)], 'x')]), tpl('d1', [rt(0, [grp(6, 0, 20)], 'y')])], ov);
        expect(total(split.chest)).toBeCloseTo(2 * e6, 12);
      });

      it('splitting a group or permuting groups inside one bout changes nothing', () => {
        const whole = runBouts([tpl('w', [rt(17, [grp(12, 0, 40)], 's')]), REST()], ov);
        const halves = runBouts([tpl('h', [rt(17, [grp(6, 0, 20), grp(6, 20, 20)], 's')]), REST()], ov);
        const quarters = runBouts([tpl('q', [rt(17, [grp(3, 0, 10), grp(3, 10, 10), grp(3, 20, 10), grp(3, 30, 10)], 's')]), REST()], ov);
        for (const r of [halves, quarters]) {
          expect(total(r.chest)).toBeCloseTo(total(whole.chest), 12);
          for (let h = 0; h < 48; h++) expect(r.stim[h]!).toBeCloseTo(whole.stim[h]!, 12);
        }
        const ab = runBouts([tpl('ab', [rt(17, [grp(6, 0, 20, 75), grp(6, 20, 20, 60)], 's')]), REST()], ov);
        const ba = runBouts([tpl('ba', [rt(17, [grp(6, 0, 20, 60), grp(6, 20, 20, 75)], 's')]), REST()], ov);
        expect(total(ab.chest)).toBeCloseTo(total(ba.chest), 12);
      });

      it('a snapshot at midnight inside a bout resumes bit-identically', () => {
        const days = [tpl('late', [rt(23.5, [grp(8, 0, 20), grp(6, 30, 20)], 'late', 60)]), REST(), REST()];
        const full = runBouts(days, ov);
        // continue from a structured clone of the state after day 0 in a fresh simulator
        const first = new MuscleSim(PERSON, ov ? { overrides: ov } : {});
        const week = compileWeek(first.profile, days, [0, 1, 2]);
        first.runDay(week[0]!, LOW_GLY);
        const snap = structuredClone(first.s) as unknown as Record<string, unknown>;
        const resumed = new MuscleSim(PERSON, ov ? { overrides: ov } : {});
        const dst = resumed.s as unknown as Record<string, unknown>;
        for (const key of Object.keys(snap)) dst[key] = structuredClone(snap[key]);
        resumed.day = 1;
        const chest: number[] = [first.s.setsHist[CHEST * 7]!];
        const stim: number[] = [...first.stimHours];
        for (const d of [week[1]!, week[2]!]) {
          resumed.runDay(d, LOW_GLY);
          chest.push(resumed.s.setsHist[CHEST * 7 + ((resumed.s.histIdx + 6) % 7)]!);
          stim.push(...resumed.stimHours);
        }
        for (let d = 0; d < 3; d++) expect(Object.is(chest[d], full.chest[d])).toBe(true);
        for (let h = 0; h < 72; h++) expect(Object.is(stim[h], full.stim[h])).toBe(true);
      });
    });
  }

  it('neural practice counts physical sets and energy books one bout, independent of the bout split', () => {
    const two = runBouts([tpl('two', [rt(17, [grp(6, 0, 20)], 'a'), rt(17.5, [grp(6, 0, 20)], 'b')]), REST()]);
    const single = runBouts([tpl('single', [rt(17, [grp(12, 0, 40)], 'a')]), REST()]);
    expect(two.sim.s.setsTotHist[0]).toBeCloseTo(12, 9);
    expect(single.sim.s.setsTotHist[0]).toBeCloseTo(12, 9);
  });
});

// ============================================================================ A1-062 effort-scale identity

const BRISK = (o: Partial<PerformedExercise>): StimulusVector => vectorOf([{ exerciseId: 'brisk_walk', ...o }], C, { bodyMassKg: 75, vo2max: 42 });
const HK = { relModerateMin: 5, relVigorousMin: 7, absModerateMet: 3, absVigorousMet: 6, vigorousWeight: 2 };

describe('A1-062 CR10, generic relative effort, RIR-RPE and unscaled ratings are distinct', () => {
  it('150 min at Borg CR10 3 without a class: unknown guideline minutes and a range, never a known zero', () => {
    const v = BRISK({ minutes: 150, rpe: 3, rpeScale: 'cr10' });
    expect(v.healthModerateMin).toBeNull();
    expect(v.healthVigorousMin).toBeNull();
    expect((v as StimulusVectorDetail).healthUnknownMin).toBeCloseTo(150, 9);
    const w = weeklyDose([v]);
    expect(w.healthEquivalentMin).toBeNull();
    expect(w.healthEquivalentRange).toEqual([0, 300]);
    expect(w.aerobicReference).toBe('unknown');
  });

  it('150 min explicit moderate or talkNotSing: 150 equivalent, reference met', () => {
    for (const o of [{ healthIntensityClass: 'moderate' as const }, { talkTest: 'talkNotSing' as const }]) {
      const w = weeklyDose([BRISK({ minutes: 150, ...o })]);
      expect(w.healthEquivalentMin).toBeCloseTo(150, 9);
      expect(w.aerobicReference).toBe('met');
    }
  });

  it('generic relative 5 → moderate, 7 → vigorous; CR10 5 is not an alias; invalid generic values are unknown', () => {
    expect(healthClassFromRelativeEffort(5, HK)).toBe('moderate');
    expect(healthClassFromRelativeEffort(7, HK)).toBe('vigorous');
    expect(healthClassFromRelativeEffort(4.9, HK)).toBe('light');
    for (const bad of [-1, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(healthClassFromRelativeEffort(bad, HK)).toBe('unknown');
    expect(healthClassFromRating(5, 'relativeEffort0To10', HK)).toBe('moderate');
    for (const scale of ['cr10', 'rirRpe', 'unknown', undefined] as const) expect(healthClassFromRating(5, scale, HK)).toBe('unknown');
    expect(BRISK({ minutes: 30, rpe: 5, rpeScale: 'relativeEffort0To10' }).healthModerateMin).toBeCloseTo(30, 9);
    expect(BRISK({ minutes: 30, rpe: 7, rpeScale: 'relativeEffort0To10' }).healthVigorousMin).toBeCloseTo(30, 9);
    expect(BRISK({ minutes: 30, rpe: 5, rpeScale: 'cr10' }).healthModerateMin).toBeNull();
    expect(BRISK({ minutes: 30, rpe: 5 }).healthModerateMin).toBeNull();
  });

  it('unspecified and unknown phase scales never produce known vigorous minutes; explicit generic phases work per phase', () => {
    for (const rpeScale of [undefined, 'unknown' as const]) {
      const d = resolveDose(ex('bike_hiit'), { exerciseId: 'bike_hiit', intervals: [{ kind: 'work', durationMin: 75, rpe: 7, ...(rpeScale ? { rpeScale } : {}) }] }, { bodyMassKg: 75, vo2max: 42 });
      expect(d.cardio!.health.vigorousMin).toBeNull();
      expect(d.cardio!.health.knownVigorousMin).toBe(0);
      expect(d.cardio!.health.unknownMin).toBeCloseTo(75, 9);
    }
    const phases: IntervalPhase[] = [
      { kind: 'work', durationMin: 10, rpe: 8, rpeScale: 'relativeEffort0To10' },
      { kind: 'recovery', durationMin: 10, rpe: 3, rpeScale: 'relativeEffort0To10' },
    ];
    const d = resolveDose(ex('bike_hiit'), { exerciseId: 'bike_hiit', intervals: phases }, { bodyMassKg: 75, vo2max: 42 });
    expect(d.cardio!.health).toMatchObject({ vigorousMin: 10, moderateMin: 0, lightMin: 10, unknownMin: 0 });
    // a phase inherits only an explicitly declared bout scale
    const inherit = resolveDose(ex('bike_hiit'), { exerciseId: 'bike_hiit', rpeScale: 'relativeEffort0To10', intervals: [{ kind: 'work', durationMin: 10, rpe: 8 }] }, { bodyMassKg: 75, vo2max: 42 });
    expect(inherit.cardio!.health.vigorousMin).toBeCloseTo(10, 9);
  });

  it('a generic-scale or RIR-RPE rating never enters the CR-10 energy map; CR10 and unscaled keep the labelled scenario', () => {
    expect(rpeEnergyMapApplies('cr10')).toBe(true);
    expect(rpeEnergyMapApplies(undefined)).toBe(true);
    expect(rpeEnergyMapApplies('unknown')).toBe(true);
    expect(rpeEnergyMapApplies('relativeEffort0To10')).toBe(false);
    expect(rpeEnergyMapApplies('rirRpe')).toBe(false);
    const cat = (rpeScale?: PerformedExercise['rpeScale']) => resolveDose(ex('spin_class'), { exerciseId: 'spin_class', minutes: 30, rpe: 6, ...(rpeScale ? { rpeScale } : {}) }, { bodyMassKg: 75, vo2max: 42 });
    expect(cat('cr10').energy.intensitySource).toBe('rpeScenario');
    expect(cat('relativeEffort0To10').energy.intensitySource).toBe('catalogue');
    const pr = resolveProfile(actPerson({ body: { weightKg: 75, heightCm: 175 }, labs: { vo2maxMlKgMin: 42 } }));
    const k = activityConstants(buildModelParams(MODULES), pr);
    const base = { kind: 'cardio', startH: 8, durationMin: 30, modality: 7, intensityFrac: Number.NaN, met: Number.NaN, speedKmh: Number.NaN, powerW: Number.NaN, rpe: 6, setsByRegion: new Float64Array(N_REGIONS), rir: 0, loadPct1RM: 0, restSec: 0, toFailure: false, carbDuringGPerH: 0, coldWaterImmersion: false } as SessionResolved;
    const kcal = (scale?: SessionResolved['rpeScale']) => sessionGrossKcalPerMin(k, { ...base, ...(scale ? { rpeScale: scale } : {}) }, 42, 75, 1.75, 1750 / 1440, 24.5);
    expect(kcal('cr10')).toBeCloseTo((rpeToX(6, k) * 42 * 75 * k.kcalPerL) / 1000, 9);
    expect(kcal('relativeEffort0To10')).toBeCloseTo((k.defaultX[7]! * 42 * 75 * k.kcalPerL) / 1000, 9);
  });

  it('both scale identities round-trip catalogue → engine session → compiler → dayHealthMinutes', () => {
    const ctx = { bodyMassKg: 75, vo2max: 42 };
    const generic = toEngineDose([resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, rpe: 5, rpeScale: 'relativeEffort0To10' }, ctx)], 8).cardio;
    const cr10 = toEngineDose([resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, rpe: 5, rpeScale: 'cr10' }, ctx)], 8).cardio;
    expect(cr10[0]!).toMatchObject({ rpe: 5, rpeScale: 'cr10' });
    expect(cr10[0]!.healthIntensityClass).toBeUndefined();
    const interval = toEngineDose(
      [resolveDose(ex('bike_hiit'), { exerciseId: 'bike_hiit', intervals: [{ kind: 'work', durationMin: 10, rpe: 8, rpeScale: 'relativeEffort0To10' }, { kind: 'recovery', durationMin: 10, rpe: 4, rpeScale: 'cr10' }] }, ctx)],
      18,
    ).cardio;
    const { day, k } = compiledDay([...generic, ...interval]);
    const out = new Float64Array(4);
    dayHealthMinutes(k, day, out);
    expect(out[0]).toBeCloseTo(30, 9); // generic 5: moderate
    expect(out[1]).toBeCloseTo(10, 9); // generic 8 work phase: vigorous
    expect(out[2]).toBeCloseTo(10, 9); // CR10 recovery phase: unknown, not light
    const { day: dayCr, k: k2 } = compiledDay(cr10);
    dayHealthMinutes(k2, dayCr, out);
    expect(Array.from(out)).toEqual([0, 0, 30, 0]);
  });

  it('no 10-minute bout minimum; 75 vigorous = 150 equivalent', () => {
    const three = weeklyDose([0, 1, 2].map(() => BRISK({ minutes: 5, healthIntensityClass: 'moderate' })));
    expect(three.healthModerateMin).toBeCloseTo(15, 9);
    const vig = weeklyDose([vectorOf([{ exerciseId: 'jog_outdoor', minutes: 75, healthIntensityClass: 'vigorous' }], C, { bodyMassKg: 75, vo2max: 42 })]);
    expect(vig.healthEquivalentMin).toBe(150);
    expect(vig.aerobicReference).toBe('met');
    expect(STIMULUS_DOSE_VERSION).toMatch(/a1-062/);
  });
});

// ============================================================================ A1-021 interval timelines

const ACT_PERSON = actPerson({ body: { weightKg: 75, heightCm: 175 }, labs: { measuredRmrKcal: 1750, vo2maxMlKgMin: 42 } });
const ACT_MODS = [activityModule] as unknown as readonly AnyEngineModule[];
const CTX42 = { bodyMassKg: 75, vo2max: 42, rmrKcalPerDay: 1750 };

/** Compile one day carrying `sessions` and return it with the activity constants of the 75 kg / VO2max 42 person. */
function compiledDay(sessions: ExerciseSession[], days = 1): { day: DayInput; days: DayInput[]; k: ReturnType<typeof activityConstants>; profile: ReturnType<typeof resolveProfile> } {
  const profile = resolveProfile(ACT_PERSON);
  const sched: Schedule = {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: days,
    programs: [tpl('x', sessions), tpl('r', [])],
    days: Array.from({ length: days }, (_, d) => ({ program: d === 0 ? 0 : 1 })),
  };
  const c = compileSchedule(sched, profile);
  return { day: c.days[0]!, days: c.days, k: activityConstants(buildModelParams(MODULES), profile), profile };
}

/**
 * The hourly activity engine's MEM and hard minutes over `days` (their 7-day ring entries), stepped as the core loop does:
 * each day's hour table includes the previous day's minutes after its midnight.
 */
function hourlyDose(days: DayInput[]): { mem: number; hi: number } {
  const ctx = moduleCtx(ACT_MODS, ACT_PERSON);
  const bus = createSignalBus();
  const k = activityModule.prepare(ctx);
  const s = activityModule.init(k, ctx, bus) as unknown as { memRing: Float64Array; hiRing: Float64Array };
  const st = s as unknown as Parameters<typeof activityModule.stepHour>[0];
  const table = new DayHourTable();
  const hour = newHourInput();
  const clock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  days.forEach((day, d) => {
    clock.day = d;
    expandDayToHours(day, 23, 8, null, 0, table, d > 0 ? days[d - 1]! : null);
    activityModule.startDay(st, k, bus, day, clock);
    for (let h = 0; h < 24; h++) {
      clock.hourOfDay = h;
      clock.hourIndex = d * 24 + h;
      hour.day = d;
      hour.hourIndex = clock.hourIndex;
      loadHour(table, h, hour);
      activityModule.stepHour(st, k, bus, hour, day, clock);
    }
    activityModule.endOfDay(st, k, bus, day, clock);
  });
  let mem = 0;
  let hi = 0;
  for (let d = 0; d < days.length; d++) {
    mem += s.memRing[d]!;
    hi += s.hiRing[d]!;
  }
  return { mem, hi };
}

const INTERVAL_JOG: PerformedExercise = {
  exerciseId: 'jog_outdoor',
  intervals: [
    { kind: 'work', durationMin: 10, pctVo2max: 0.9, rpe: 8, rpeScale: 'relativeEffort0To10' },
    { kind: 'recovery', durationMin: 10, pctVo2max: 0.3, rpe: 3, rpeScale: 'relativeEffort0To10' },
  ],
};

describe('A1-021 the engine cardio part is the ordered concatenation of every dose', () => {
  it('two interval records of one modality: catalogue, compiled session, day estimator and hourly engine agree (hard 20, MEM 30)', () => {
    const doses = [resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42), resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42)];
    const v = aggregateStimulus(doses);
    expect(v.hiMinutes).toBeCloseTo(20, 9);
    expect(v.mem).toBeCloseTo(30, 9);
    const eng = toEngineDose(doses, 7).cardio;
    expect(eng).toHaveLength(1);
    expect(eng[0]!.phases!.map((p) => p.kind)).toEqual(['work', 'recovery', 'work', 'recovery']);
    expect(eng[0]!.healthIntensityClass).toBeUndefined(); // vigorous work + light recovery is not wholly vigorous
    const { day, days, k } = compiledDay(eng);
    const out = new Float64Array(2);
    dayAerobicDose(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
    expect(out[0]).toBeCloseTo(30, 9);
    expect(out[1]).toBeCloseTo(20, 9);
    const hourly = hourlyDose(days);
    expect(hourly.mem).toBeCloseTo(30, 9);
    expect(hourly.hi).toBeCloseTo(20, 9);
    const h = new Float64Array(4);
    dayHealthMinutes(k, day, h);
    expect(Array.from(h)).toEqual([0, 20, 0, 20]); // 20 vigorous + 20 light (guideline 40 equivalent, not 80)
    expect(v.healthVigorousMin).toBeCloseTo(20, 9);
  });

  it('the concatenated record equals the same phases supplied directly; recovery energy is integrated once from them', () => {
    const doses = [resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42), resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42)];
    const merged = toEngineDose(doses, 7).cardio[0]!;
    const direct: CardioSession = { ...merged, phases: merged.phases!.map((p) => ({ kind: p.kind, durationMin: p.durationMin, met: p.met! })) };
    const mean: CardioSession = { ...merged, phases: undefined };
    const a = compiledDay([merged]);
    const b = compiledDay([direct]);
    const c = compiledDay([mean]);
    const bmi = 75 / 1.75 ** 2;
    const kcal = (x: typeof a) => sessionsBookedKcal(x.k, x.day, 42, 75, bmi, 1750 / 24);
    expect(kcal(a)).toBeCloseTo(kcal(b), 9);
    // the time-averaged MET books the same gross energy but a different (nonlinear) recovery budget
    expect(Math.abs(kcal(a) - kcal(c))).toBeGreaterThan(1);
    const gross = doses.reduce((s, d) => s + d.energy.grossKcal, 0);
    const perMet = (3.5 * 75 * 5) / 1000;
    expect(merged.phases!.reduce((s, p) => s + p.durationMin * p.met!, 0) * perMet).toBeCloseTo(gross, 6);
  });

  it('an interval record plus a steady record of the same modality keep both intensities (MEM parity, no mean MET)', () => {
    const doses = [resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42), resolveDose(ex('jog_outdoor'), { exerciseId: 'jog_outdoor', minutes: 20, healthIntensityClass: 'moderate' }, CTX42)];
    const v = aggregateStimulus(doses);
    const eng = toEngineDose(doses, 7).cardio[0]!;
    expect(eng.phases!.map((p) => p.kind)).toEqual(['work', 'recovery', 'steady']);
    expect(eng.phases![2]).toMatchObject({ healthIntensityClass: 'moderate', healthClassSource: 'stated' });
    const { day, days, k } = compiledDay([eng]);
    const out = new Float64Array(2);
    dayAerobicDose(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
    expect(out[0]).toBeCloseTo(v.mem, 9);
    expect(out[1]).toBeCloseTo(v.hiMinutes, 9);
    expect(hourlyDose(days).mem).toBeCloseTo(v.mem, 9);
    const h = new Float64Array(4);
    dayHealthMinutes(k, day, h);
    expect(Array.from(h)).toEqual([20, 10, 0, 10]);
  });

  it('mixed known and unknown classes keep the known lower sums beside the unknown minutes', () => {
    const doses = [
      resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 20, healthIntensityClass: 'moderate' }, CTX42),
      resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 20 }, CTX42),
    ];
    const v = aggregateStimulus(doses) as StimulusVectorDetail;
    expect(v.healthModerateMin).toBeNull();
    expect(v.healthKnownModerateMin).toBeCloseTo(20, 9);
    expect(v.healthUnknownMin).toBeCloseTo(20, 9);
    const w = weeklyDose([v]);
    expect(w.healthEquivalentRange[0]).toBeCloseTo(20, 9);
    expect(w.healthEquivalentRange[1]).toBeCloseTo(60, 9);
    const eng = toEngineDose(doses, 8).cardio[0]!;
    expect(eng.healthIntensityClass).toBeUndefined();
    const { day, k } = compiledDay([eng]);
    const h = new Float64Array(4);
    dayHealthMinutes(k, day, h);
    expect(Array.from(h)).toEqual([20, 0, 20, 0]);
    // reload parity: the stored vector after a JSON round trip gives the same weekly accounting
    expect(weeklyDose([JSON.parse(JSON.stringify(v)) as StimulusVector])).toEqual(w);
  });

  it('booked minutes beyond the phases are an unknown-class remainder at the catalogue MET; the time line sums to the booking', () => {
    const d = resolveDose(ex('jog_outdoor'), { ...INTERVAL_JOG, minutes: 30 }, CTX42);
    expect(d.cardio!.phaseDuration).toBe('remainder');
    expect(d.cardio!.health.unknownMin).toBeCloseTo(10, 9);
    expect(d.cardio!.health.knownVigorousMin).toBeCloseTo(10, 9);
    const eng = toEngineDose([d], 7).cardio[0]!;
    expect(eng.phases!.map((p) => p.kind)).toEqual(['work', 'recovery', 'remainder']);
    expect(eng.phases!.reduce((s, p) => s + p.durationMin, 0)).toBeCloseTo(30, 9);
    expect(eng.phases![2]!.healthIntensityClass).toBeUndefined();
    const perMet = (3.5 * 75 * 5) / 1000;
    expect(eng.phases!.reduce((s, p) => s + p.durationMin * p.met!, 0) * perMet).toBeCloseTo(d.energy.grossKcal, 6);
    const { day, k } = compiledDay([eng]);
    const out = new Float64Array(2);
    dayAerobicDose(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
    expect(out[0]).toBeCloseTo(d.cardio!.mem, 9);
    // phases longer than the booked total are shortened proportionally (never booked past the total)
    const short = resolveDose(ex('jog_outdoor'), { ...INTERVAL_JOG, minutes: 10 }, CTX42);
    expect(short.cardio!.phaseDuration).toBe('scaled');
    expect(toEngineDose([short], 7).cardio[0]!.phases!.reduce((s, p) => s + p.durationMin, 0)).toBeCloseTo(10, 9);
  });

  it('mixed modality and a bout across midnight: per-day estimators add up to the catalogue', () => {
    // (the walk is stated at 5.5 MET: away from a MEM band edge, so the engine's day-by-day VO2max cannot flip its weight)
    const doses = [resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42), resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, met: 5.5 }, CTX42), resolveDose(ex('jog_outdoor'), INTERVAL_JOG, CTX42)];
    const v = aggregateStimulus(doses);
    // 23:45 start: the second work phase of the run part falls after midnight (carried with its own time line)
    const eng = toEngineDose(doses, 23.75).cardio;
    expect(eng.map((s) => s.modality).sort()).toEqual(['run', 'walk']);
    const { days, k } = compiledDay(eng, 2);
    let mem = 0;
    let hi = 0;
    const out = new Float64Array(2);
    for (const day of days) {
      dayAerobicDose(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
      mem += out[0]!;
      hi += out[1]!;
    }
    expect(mem).toBeCloseTo(v.mem, 9);
    expect(hi).toBeCloseTo(v.hiMinutes, 9);
    const hourly = hourlyDose(days);
    expect(hourly.mem).toBeCloseTo(v.mem, 9);
    expect(hourly.hi).toBeCloseTo(v.hiMinutes, 9);
  });

  it('two hybrid items (resistance + cardio share): one cardio part keeps each item\'s intensity; MEM parity', () => {
    const doses = [
      resolveDose(ex('kb_swing'), { exerciseId: 'kb_swing', setCount: 5, reps: 15, restSec: 60 }, CTX42),
      resolveDose(ex('baithak'), { exerciseId: 'baithak', minutes: 12 }, CTX42),
    ];
    const v = aggregateStimulus(doses);
    const eng = toEngineDose(doses, 7);
    expect(eng.resistance?.groups?.length).toBeGreaterThan(0);
    expect(eng.cardio).toHaveLength(1);
    const part = eng.cardio[0]!;
    expect(part.phases!.map((p) => p.kind)).toEqual(['steady', 'steady']);
    expect(part.phases!.map((p) => p.exerciseId)).toEqual(['kb_swing', 'baithak']);
    expect(part.phases!.reduce((a, p) => a + p.durationMin, 0)).toBeCloseTo(part.durationMin, 9);
    const { day, days, k } = compiledDay([part]);
    const out = new Float64Array(2);
    dayAerobicDose(k, day, 42, 75, 75 / 1.75 ** 2, 1750 / 24, out);
    expect(out[0]).toBeCloseTo(v.mem, 9);
    expect(hourlyDose(days).mem).toBeCloseTo(v.mem, 9);
  });

  it('a single steady dose stays one session without phases (unchanged)', () => {
    const eng = toEngineDose([resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, healthIntensityClass: 'moderate' }, CTX42)], 8).cardio[0]!;
    expect(eng.phases).toBeUndefined();
    expect(eng.healthIntensityClass).toBe('moderate');
  });
});

// ============================================================================ A1-022 unknown hard-set dose

const HYP = { hyp: 1, str: 0, card: 0, kcal: 0, mob: 0 };
const SURYA_30: PerformedExercise = { exerciseId: 'surya_namaskar', minutes: 30 };
const SURYA_5: PerformedExercise = { exerciseId: 'surya_namaskar', minutes: 30, hardBouts: 5, rir: 2, pct1RM: 50, restSec: 0 };
const vec = (items: PerformedExercise[]): StimulusVector => vectorOf(items, C, { bodyMassKg: 75, vo2max: 42, rmrKcalPerDay: 1750 });

describe('A1-022 an unknown hard-set count is never observed completion', () => {
  it('30 min Surya (unknown count) against 5 reported hard bouts: no parity, no credit, no sentinel 0; the scenario is labelled', () => {
    const pre = vec([SURYA_5]);
    const log = vec([SURYA_30]);
    expect(log.doseStatus).toBe('unknown');
    expect(log.unknownDoseScenario).toBe('legacyMinuteConversion');
    expect(log.outcomeDoseStatus).toMatchObject({ hypertrophy: 'unknown', strength: 'unknown', energy: 'inferred' });
    const r = stimulusEquivalence(pre, log, HYP);
    expect(r.parity).toBe(false);
    expect(r.completion).toMatchObject({ status: 'unknown', unknownTerms: ['hyp'], knownTermsScore: null, scenario: 'legacyMinuteConversion' });
    expect(r.perTerm[0]).toMatchObject({ term: 'hyp', status: 'unknown', knownRatio: 0 });
    expect(r.observed.score).toBeNull();
    expect(r.observed.credit).toBeNull();
    expect(r.observed.parity).toBeNull(); // the range spans the threshold: neither satisfied nor violated
    expect(r.observed.range).toEqual([0, 1]);
    expect(r.scenarioScore).toMatchObject({ id: 'legacyMinuteConversion', parity: true });
    // reported hard bouts restore a quantitative, known completion
    const known = stimulusEquivalence(pre, vec([SURYA_5]), HYP);
    expect(known.completion.status).toBe('known');
    expect(known.parity).toBe(true);
    expect(known.observed).toMatchObject({ credit: 1, parity: true });
  });

  it('independently known energy and mobility stay usable beside the withheld muscle completion', () => {
    const pre = vec([SURYA_5]);
    const log = vec([SURYA_30]);
    const r = stimulusEquivalence(pre, log, { hyp: 0.5, str: 0, card: 0, kcal: 0.3, mob: 0.2 });
    expect(r.completion.status).toBe('partial');
    expect(r.completion.unknownTerms).toEqual(['hyp']);
    const kcal = r.perTerm.find((t) => t.term === 'kcal')!;
    const mob = r.perTerm.find((t) => t.term === 'mob')!;
    expect(kcal.status).toBe('known');
    expect(r.completion.knownTermsScore).toBeCloseTo((0.3 * kcal.ratio + 0.2 * mob.ratio) / 0.5, 12);
    expect(r.observed.range[0]).toBeCloseTo(0.3 * kcal.ratio + 0.2 * mob.ratio, 12);
    expect(r.observed.range[1]).toBeCloseTo(0.5 + 0.3 * kcal.ratio + 0.2 * mob.ratio, 12);
  });

  it('mixed known + unknown work: known work alone can complete; otherwise its lower bound is kept', () => {
    const pre5 = vec([SURYA_5]);
    const both = vec([SURYA_5, SURYA_30]);
    const done = stimulusEquivalence(pre5, both, HYP);
    expect(done.completion.status).toBe('known');
    expect(done.parity).toBe(true);
    const pre10 = vec([{ ...SURYA_5, hardBouts: 10 }]);
    const half = stimulusEquivalence(pre10, both, HYP);
    expect(half.completion.status).toBe('unknown');
    expect(half.perTerm[0]!.knownRatio).toBeCloseTo(0.5, 9);
    expect(half.observed.range[0]).toBeCloseTo(0.5, 9);
    expect(half.observed.parity).toBeNull();
    // an unknown prescribed count leaves the denominator unknown
    const unkPre = stimulusEquivalence(vec([SURYA_30]), vec([SURYA_5]), HYP);
    expect(unkPre.completion.status).toBe('unknown');
    expect(unkPre.perTerm[0]!.knownRatio).toBeNull();
  });

  it('saved, imported and recomputed vectors agree; a legacy stored vector without groups stays unknown', () => {
    const pre = vec([SURYA_5]);
    const log = vec([SURYA_30]);
    const fresh = stimulusEquivalence(pre, log, HYP);
    const reloaded = stimulusEquivalence(JSON.parse(JSON.stringify(pre)) as StimulusVector, JSON.parse(JSON.stringify(log)) as StimulusVector, HYP);
    expect(reloaded).toEqual(fresh);
    const legacy: StimulusVector = { ...log, setGroups: undefined };
    expect(unknownDosePart(legacy).all).toBe(true);
    expect(stimulusEquivalence(pre, legacy, HYP).completion.status).toBe('unknown');
    // an ordinary inferred region/load mapping is not an unknown count
    const bench = vec([{ exerciseId: 'db_bench_press', setCount: 3 }]);
    expect(unknownDosePart(bench).any).toBe(false);
    expect(stimulusEquivalence(bench, bench).completion.status).toBe('known');
  });

  it('the engine session names the scenario; known and unknown counts stay apart on the groups', () => {
    const unk = toEngineDose([resolveDose(ex('surya_namaskar'), SURYA_30, CTX42)], 7, { sessionId: 'log-1' }).resistance!;
    expect(unk).toMatchObject({ doseStatus: 'unknown', unknownDoseScenario: 'legacyMinuteConversion' });
    expect(unk.groups!.every((g) => g.provenance?.sets === 'unknown')).toBe(true);
    const mixed = toEngineDose([resolveDose(ex('surya_namaskar'), SURYA_30, CTX42), resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3 }, CTX42)], 7).resistance!;
    expect(mixed.doseStatus).not.toBe('unknown');
    expect(mixed.unknownDoseScenario).toBe('legacyMinuteConversion');
    expect(mixed.groups!.some((g) => g.provenance?.sets === 'unknown')).toBe(true);
    expect(mixed.groups!.some((g) => g.provenance?.sets !== 'unknown')).toBe(true);
  });

  it('muscle outputs from the first unknown-count day are conditional on the named scenario; a known count is not', () => {
    const run = (unknown: boolean): MuscleState => {
      const sim = new MuscleSim(PERSON);
      const week = compileWeek(sim.profile, [REST(), tpl('rt', [rt(17, [grp(6, 0, 20)], 'a')])], [0, 1]);
      const day1 = week[1]!;
      if (unknown) for (const g of day1.rtGroups!) g.setsUnknown = 1;
      sim.runDay(week[0]!);
      sim.runDay(day1);
      return sim.s;
    };
    const unk = run(true);
    expect(muscleUnknownDoseFromDay(unk)).toBe(1);
    expect(muscleRunAssumptions(unk)).toContain(MUSCLE_UNKNOWN_DOSE_ASSUMPTION);
    const st = muscleOutputStatus(unk);
    expect(st.trainingStatus).toMatchObject({ status: 'scenario', reasonCode: 'unknownHardSetCount', fromDay: 1 });
    expect(st.rtMuscleGain).toMatchObject({ status: 'scenario', reasonCode: 'unknownHardSetCount' });
    // the dose itself is still simulated as the labelled scenario (never a biological zero)
    expect(unk.setsHist[CHEST * 7 + 1]).toBeGreaterThan(0);
    const known = run(false);
    expect(muscleUnknownDoseFromDay(known)).toBeNull();
    expect(muscleRunAssumptions(known)).not.toContain(MUSCLE_UNKNOWN_DOSE_ASSUMPTION);
    expect(muscleOutputStatus(known).trainingStatus).toBeUndefined();
    // a session-level unknown dose status (legacy merged path) marks the day as well
    const sim = new MuscleSim(PERSON);
    const week = compileWeek(sim.profile, [tpl('legacy', [{ kind: 'resistance', startH: 9, setsByRegion: { chest: 4 } }])], [0]);
    (week[0]!.sessions[0] as SessionResolved).doseStatus = 'unknown';
    sim.runDay(week[0]!);
    expect(muscleUnknownDoseFromDay(sim.s)).toBe(0);
  });
});

// ============================================================================ A1-040 habitual step overlap

const habitPerson = (overlap?: { status: 'known' | 'unknown'; includedStepsPerDay?: number }, scope: 'totalDay' | 'excludesTraining' = 'totalDay') =>
  resolveProfile(
    actPerson({
      body: { weightKg: 75, heightCm: 175 },
      habits: { trainingHistory: 'none', sessionsPerWeek: 7, lifingCardioMix: 1, typicalSteps: 10000, stepsScope: scope, ...(overlap ? { habitualStepsOverlap: overlap } : {}) },
    }),
  );
/** A current day: 10 000 steps of `scope` with 3 000 session steps inside, and a walk session when `walk`. */
function currentDay(pr: ReturnType<typeof resolveProfile>, scope: 'totalDay' | 'excludesTraining' | 'unknown', walk = true, included: number | undefined = 3000): DayInput[] {
  const t = { ...tpl('cur', walk ? [{ kind: 'cardio', modality: 'walk', startH: 8, durationMin: 30, met: 3.5 } as CardioSession] : []), steps: 10000, stepsScope: scope, ...(included !== undefined ? { sessionIncludedSteps: included } : {}) } as DayTemplate;
  return compileSchedule({ schemaVersion: 1, startDate: '2026-10-05', horizonDays: 1, programs: [t], days: [{ program: 0 }] }, pr).days;
}

describe('A1-040 the habitual reference has its own overlap status', () => {
  it('a fully known current week with an unknown habitual overlap discloses the reference scenario (never copies current steps)', () => {
    const pr = habitPerson();
    expect(habitualStepsOverlapStatus(pr)).toBe('unknown');
    const days = currentDay(pr, 'totalDay');
    const d = stepsOverlapAssumptions(days, pr);
    expect(d).toEqual({ assumptions: [HABITUAL_STEPS_OVERLAP_UNKNOWN], current: 'known', reference: 'unknown' });
    const k = activityConstants(buildModelParams(MODULES), pr);
    expect(k.habStepsLedger).toBe(10000); // the current 3 000 are never borrowed into the reference
    expect(dayLedgerSteps(days[0]!)).toBe(7000);
  });

  it('known included steps on both sides and an unchanged routine: the step-only reference difference is exactly 0', () => {
    const pr = habitPerson({ status: 'known', includedStepsPerDay: 3000 });
    expect(habitualStepsOverlapStatus(pr)).toBe('known');
    const days = currentDay(pr, 'totalDay', false);
    expect(stepsOverlapAssumptions(days, pr).assumptions).toEqual([]);
    const ref = activityReference(pr, days, [], 0, () => habitualWeek(pr));
    expect(ref.constants.act.habStepsLedger).toBe(7000);
    expect(ref.dayKcal[0]).toBeCloseTo(0, 12);
    // unknown habitual overlap: the no-subtraction reference scenario (disclosed above), not a proved bias
    const unk = habitPerson();
    const refU = activityReference(unk, currentDay(unk, 'totalDay', false), [], 0, () => habitualWeek(unk));
    expect(refU.dayKcal[0]).toBeLessThan(0);
  });

  it('excludesTraining subtracts neither side', () => {
    const pr = habitPerson(undefined, 'excludesTraining');
    expect(habitualStepsOverlapStatus(pr)).toBe('none');
    const days = currentDay(pr, 'excludesTraining');
    expect(stepsOverlapAssumptions(days, pr).assumptions).toEqual([]);
    expect(activityConstants(buildModelParams(MODULES), pr).habStepsLedger).toBe(10000);
    expect(dayLedgerSteps(days[0]!)).toBe(10000);
  });

  it('current-unknown / habit-known and current-known / habit-unknown each expose their own scenario', () => {
    const known = habitPerson({ status: 'known', includedStepsPerDay: 2000 });
    expect(stepsOverlapAssumptions(currentDay(known, 'unknown'), known)).toEqual({ assumptions: [STEPS_OVERLAP_UNKNOWN], current: 'unknown', reference: 'known' });
    const unk = habitPerson({ status: 'unknown' });
    expect(stepsOverlapAssumptions(currentDay(unk, 'totalDay'), unk).assumptions).toEqual([HABITUAL_STEPS_OVERLAP_UNKNOWN]);
    expect(stepsOverlapAssumptions(currentDay(unk, 'unknown'), unk).assumptions).toEqual([STEPS_OVERLAP_UNKNOWN, HABITUAL_STEPS_OVERLAP_UNKNOWN]);
  });
});
