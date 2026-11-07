// @vitest-environment node
/**
 * Invariant suite (MODEL_SPEC §9.1 O-4…O-9, O-11, O-12; WP-V). Runs the reusable checks of `harness/invariants.ts` against `runEngine`.
 *
 * Policy (see `harness/stubs.ts`): identities that do not depend on physiology (energy/mass conservation, determinism,
 * hourly-to-daily agreement) run for real ALWAYS. Checks that need calibrated physiology (steady state, O-12, zero intake, R-NOINS,
 * R-SEQ, meal-frequency null, t = 0 weight, performance) gate per module: they run for real as soon as the modules they need are
 * implemented, and are skipped (but still reported in the printed table) before that.
 */
import {
  MAINTENANCE_DRIFT_TOL,
  PERF_BUDGET_MS,
  checkCarbFatSwap,
  checkConservation,
  checkDeterminism,
  checkHourlyDailyAgreement,
  checkMaintenanceDrift,
  checkMealFrequencyNull,
  checkSequenceInvariance,
  checkSteadyState,
  checkZeroIntake,
  measureRunMs,
  checkConservationThroughModelLimit,
  checkIngestionAudit,
  checkNitrogenBoundary,
  checkOffsetLedger,
  checkRecordingMaskEquivalence,
  checkSnapshotContinuation,
  type InvariantReport,
} from './harness/invariants';
import { REQUIRES, missingModules, readinessSummary, scenarioReady } from './harness/stubs';
import { withBundledBench } from './harness/bundledBench';
import { measureWithLoadRetry } from './harness/loadRetry';
import type { BenchRow } from './bench/benchEntry';
import { LEAN_MAN, MAN, WOMAN, person } from './fixtures/personas';
import { buildSchedule, cardioSession, fastEvent, pctProgram, rtSession, neutralMacros, constantSchedule, pctMacros, waterOnlyProgram } from './fixtures/programs';
import { Rng } from '../planner/optim/rng';
import { SIGNAL_BY_NAME, SIGNAL_META, type SignalName } from '../types/signals';
import { MODULE_ORDER, checkSignalHooks } from '../core/moduleRegistry';
import type { PersonProfile, Schedule } from '../types';
import type { SeriesId } from '../types/metrics';
import { compileSchedule } from '../core/compileSchedule';
import { runEngine, simulateEnsemble } from '../core/loop';
import { resolveProfile } from '../core/resolveProfile';
import { MODULES } from '../core/moduleRegistry';
import { buildModelParams, sampleParams } from '../core/paramsRegistry';

import type { ModuleId } from '../types/signals';

// The first test of the file runs every scenario (several seconds); the default 5 s timeout is too short.
vi.setConfig({ testTimeout: 180_000 });

const MAN_EX = person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, bodyFatPct: 25, steps: 7000, sessionsPerWeek: 3, liftingCardioMix: 0.5 });
const WOMAN_EX = person({ sex: 'female', ageYears: 42, heightCm: 165, weightKg: 72, bodyFatPct: 36, steps: 7000, sessionsPerWeek: 4, liftingCardioMix: 1 });

const PEOPLE: readonly [string, PersonProfile][] = [
  ['MAN', MAN],
  ['WOMAN', WOMAN],
  ['LEAN_MAN', LEAN_MAN],
];
const EXERCISERS: readonly [string, PersonProfile][] = [
  ['MAN, 3 sessions/wk (RT + cardio)', MAN_EX],
  ['WOMAN, 4 cardio sessions/wk', WOMAN_EX],
  ['LEAN_MAN, 3 RT sessions/wk', LEAN_MAN],
];

/** Exercises many code paths: deficit with RT, maintenance with cardio, a low-energy day, a 36-h fast with refeed. */
function mixedSchedule(sex: 'male' | 'female'): Schedule {
  const macros = neutralMacros(sex);
  return buildSchedule({
    days: 21,
    programs: [
      pctProgram('deficitRt', 80, macros, { exercise: [rtSession(17, { volume: 'moderate' })], steps: 9000 }),
      pctProgram('maintCardio', 100, macros, { exercise: [cardioSession('run', 7, 40)] }),
      pctProgram('low', 55, macros),
    ],
    use: [0, 1, 0, 2, 0, 1, 1],
    events: [fastEvent(9, 36, 20, { refeed: 'auto' })],
  });
}

/** Test `it` wrapper: gate on the modules a check needs, print the report line either way. */
const reports: InvariantReport[] = [];
function expectPass(r: InvariantReport): void {
  reports.push(r);
  expect(r.failures, `${r.id} ${r.title}`).toEqual([]);
}

const CORE = REQUIRES.CORE;
const readyCore = scenarioReady(CORE);
const readyTraining = scenarioReady(REQUIRES.TRAINING);
const readyFasting = scenarioReady(REQUIRES.FASTING);
const readyFull = scenarioReady(REQUIRES.FULL);
const waiting = (mods: readonly ModuleId[]): string => (missingModules(mods).length ? ` [waiting for: ${missingModules(mods).join(', ')}]` : '');

describe('O-4 / O-5 conservation (structural; runs for real)', () => {
  it.each(PEOPLE)('%s: hourly S_h identity, daily identity and scale = FM + FFM_act + labile water hold on a mixed schedule', (_n, p) => {
    const r = checkConservation(p, mixedSchedule(p.body.sex));
    const structural = r.checks.filter((c) => !c.name.startsWith('t = 0'));
    expect(structural.filter((c) => !c.pass).map((c) => `${c.name}: ${c.value}`)).toEqual([]);
  });

  it.skipIf(!readyCore)(`day-0 wake-hour scale weight equals the entered (morning) weight ± 0.05 kg (O-5, morning anchor)${waiting(CORE)}`, () => {
    for (const [, p] of PEOPLE) {
      const r = checkConservation(p, constantSchedule(2, pctProgram('m', 100, neutralMacros(p.body.sex))));
      const t0 = r.checks.find((c) => c.name.startsWith('day-0 wake-hour'))!;
      expect(t0.pass, `${t0.name}: ${t0.value} ${t0.detail ?? ''}`).toBe(true);
    }
  });
});

describe('O-7 determinism (runs for real)', () => {
  it.each(PEOPLE)('%s: identical inputs give bit-identical results; draws and ensembles reproducible from the seed', (_n, p) => {
    expectPass(checkDeterminism(p, mixedSchedule(p.body.sex)));
  });

  // MODEL_SPEC §8.1 / §10.4: the Simulator's worker pool computes the ensemble as chunks of draws [start, start + count) of one
  // seeded Latin hypercube (src/workers/engine.worker.ts `simulateDraws`); the planner evaluates draws in any order on any
  // worker. Every draw must therefore be a pure function of (profile, schedule, parameter vector): chunking, order and
  // other runs in between must not change a single bit, so the bands do not depend on the number of workers.
  it('ensemble draws are identical whatever the worker count, chunking and order (1 × 8, 3 + 3 + 2 reversed, 8 × 1 interleaved)', () => {
    const rp = resolveProfile(MAN);
    const cs = compileSchedule(mixedSchedule('male'), rp);
    const other = compileSchedule(constantSchedule(28, pctProgram('other', 70, neutralMacros('male'))), rp);
    const vectors = sampleParams(buildModelParams(MODULES).defs, { count: 8, seed: 20261001 });
    const opts = { record: 'daily' as const, collectEvents: false, burnInDays: 14 };
    const draw = (k: number) => runEngine(rp, cs, { ...opts, paramOverrides: vectors[k]! }).daily;
    const oneWorker = vectors.map((_, k) => draw(k));
    const chunks: number[][] = [[5, 6, 7], [2, 3, 4], [0, 1]]; // three workers, finishing in reverse order
    const threeWorkers: ReturnType<typeof draw>[] = new Array(8);
    for (const c of chunks) for (const k of c) threeWorkers[k] = draw(k);
    const eightWorkers: ReturnType<typeof draw>[] = new Array(8);
    for (const k of [7, 0, 6, 1, 5, 2, 4, 3]) {
      runEngine(rp, other, { ...opts, paramOverrides: vectors[(k + 3) % 8]! }); // unrelated work on the same worker
      eightWorkers[k] = draw(k);
    }
    const diff = (a: typeof oneWorker, b: typeof oneWorker): string | null => {
      for (let k = 0; k < a.length; k++)
        for (const id of Object.keys(a[k]!) as SeriesId[]) {
          const x = a[k]![id]!;
          const y = b[k]![id]!;
          for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `draw ${k} ${id}[${i}]`;
        }
      return null;
    };
    expect(diff(oneWorker, threeWorkers)).toBeNull();
    expect(diff(oneWorker, eightWorkers)).toBeNull();
    // the same holds for the bands the core computes from them
    const e1 = simulateEnsemble(rp, cs, { draws: 8, seed: 20261001, ...opts });
    const e2 = simulateEnsemble(rp, cs, { draws: 8, seed: 20261001, ...opts });
    for (const id of Object.keys(e1.p90) as SeriesId[]) expect(Array.from(e2.p90[id]!), id).toEqual(Array.from(e1.p90[id]!));
  });
});

describe('hourly-to-daily flux agreement (runs for real)', () => {
  it.each(PEOPLE)('%s: every daily series equals the catalogue aggregation of its hourly series', (_n, p) => {
    expectPass(checkHourlyDailyAgreement(p, mixedSchedule(p.body.sex)));
  });
});

describe(`steady state at maintenance for 30 d${waiting(CORE)}`, () => {
  it.skipIf(!readyCore).each(PEOPLE)('%s stays steady', (_n, p) => {
    expectPass(checkSteadyState(p));
  });
});

describe(`O-12 no drift at maintenance for a weight-stable person, habitual exerciser included${waiting(REQUIRES.TRAINING)}`, () => {
  it.skipIf(!readyTraining).each(EXERCISERS)(`%s: |ΔFM| < ${MAINTENANCE_DRIFT_TOL.fatKg} kg, |Δscale| < ${MAINTENANCE_DRIFT_TOL.scaleKg} kg over ${MAINTENANCE_DRIFT_TOL.days} d`, (_n, p) => {
    expectPass(checkMaintenanceDrift(p));
  });
  it.skipIf(!readyTraining).each(PEOPLE)('%s at maintenance (no habitual sessions unless the persona has them)', (_n, p) => {
    expectPass(checkMaintenanceDrift(p));
  });
});

describe(`O-6 zero intake${waiting(REQUIRES.FASTING)}`, () => {
  it.skipIf(!readyFasting).each([21, 28])('water-only for %i d: finite series, no negative pools, monotone fat mass, finite BHB', (days) => {
    for (const [, p] of PEOPLE) expectPass(checkZeroIntake(p, days));
  });
});

describe(`O-8 R-NOINS and the meal-frequency null${waiting(CORE)}`, () => {
  it.skipIf(!readyCore).each([10, 20, 30])('isocaloric isoprotein carbohydrate → fat swap of %i %E over 14 d', (swap) => {
    expectPass(checkCarbFatSwap(MAN, swap));
  });
  it.skipIf(!readyCore).each(PEOPLE)('%s: 1 vs 3 meals/d has no expenditure or fat-balance effect (signed deposition cost)', (_n, p) => {
    expectPass(checkMealFrequencyNull(p));
  });
});

describe(`O-9 R-SEQ sequencing${waiting(CORE)}`, () => {
  it.skipIf(!readyCore).each(PEOPLE)('%s: permutations of the same weekly blocks move 12-week fat by < 0.2 kg', (_n, p) => {
    expectPass(checkSequenceInvariance(p));
  });
});

describe(`O-11 performance${waiting(REQUIRES.FULL)}`, () => {
  it('reports the 180-day run time under the Vitest transform (non-gating: imported bindings become getter calls here)', () => {
    const r = measureRunMs(MAN, 180, 7);
    console.log(`O-11 (Vitest transform): 180-d run, record 'daily', all modules: best ${r.bestMs.toFixed(2)} ms, median ${r.medianMs.toFixed(2)} ms of ${r.runs}`);
    expect(r.bestMs).toBeGreaterThan(0);
  });
  // O-11 proper: the production bundle (Vite build of bench/benchEntry.ts) in this Node process — MAN, 180 d training-week
  // deficit, 14-d burn-in — in the four ways the app runs the engine: planner mode as the planner calls it (record 'daily',
  // goal series only; the gating O-11 number), and simulate mode with record 'none' / 'daily' / 'full' (warnings, events and,
  // for 'full', the hourly arrays of the Simulator). Bounds (MODEL_SPEC §9.1 O-11): planner ≤ 10 ms desktop; simulate modes
  // ≤ 15 ms ("Simulator full ≤ 15 ms"). Build/import once so the optional retry keeps the same production module's
  // JIT state. A high ONE-MINUTE load average can include recent build work; it is not proof of current CPU use.
  // An over-budget first result under high rolling load waits at most 120 s before the existing 25-run retry.
  // Every final result must meet the unchanged budget, including when load remains high: never skip a release budget.
  it.skipIf(!readyFull)(`bundled engine: 180-day run best-of-15 — planner ≤ ${PERF_BUDGET_MS.desktop} ms, simulate none/daily/full ≤ ${PERF_BUDGET_MS.simulate} ms (desktop)`, async () => {
    const deadlineMs = performance.now() + 240_000;
    const within = (rows: BenchRow[]): boolean =>
      rows.every((r) => r.bestMs <= (r.mode === 'planner' ? PERF_BUDGET_MS.desktop : PERF_BUDGET_MS.simulate));
    await withBundledBench(async (bench) => {
      const result = await measureWithLoadRetry(bench, within, {
        deadlineMs,
        onAttempt: ({ runs, rows, load }) => {
          const values = rows.map((r) => `${r.mode} ${r.bestMs.toFixed(2)}/${r.medianMs.toFixed(2)}`).join(' · ');
          console.log(`O-11 (bundled, ms per 180 d, best/median of ${runs}): ${values} · 1-min load/core ${load.toFixed(2)}`);
        },
        onWait: (wait) => console.log(`O-11 load settle: waited ${wait.waitedMs.toFixed(0)} ms; 1-min load/core ${wait.initialLoad.toFixed(2)} → ${wait.finalLoad.toFixed(2)}; below 0.5: ${wait.belowThreshold}`),
      });
      // Preserve full precision for both attempts and the actual wait/load observations in failure/pass receipts.
      console.log(`O-11 measurement receipt: ${JSON.stringify(result)}`);
      for (const r of result.rows)
        expect(r.bestMs, `${r.mode} best ms; 1-min load/core ${(result.retry ?? result.first).load.toFixed(2)}; waited ${result.wait?.waitedMs ?? 0} ms`).toBeLessThanOrEqual(r.mode === 'planner' ? PERF_BUDGET_MS.desktop : PERF_BUDGET_MS.simulate);
    });
  }, 240_000);
});

describe('review release invariants (C2/C3/C7; runs for real)', () => {
  const VERY_LEAN = person({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 62, bodyFatPct: 6, steps: 4000 });

  it('D1-08: a 120-day water fast of a very lean man ends at a model limit; the identities hold up to it and nothing after it is recorded as a forecast', () => {
    const r = checkConservationThroughModelLimit(VERY_LEAN, constantSchedule(120, waterOnlyProgram()));
    expect(r.limitReached).toBe(true);
    expectPass(r);
  });

  it('D1-08: an ordinary mixed schedule reaches no model limit and conserves energy and mass', () => {
    const r = checkConservationThroughModelLimit(MAN, mixedSchedule('male'));
    expect(r.limitReached).toBe(false);
    expectPass(r);
  });

  it.skipIf(!readyFasting)(`D2-05: on a 4-day water fast the body-N change equals the urinary-N prior; urinary N, lean tissue and scale stay distinct${waiting(REQUIRES.FASTING)}`, () => {
    expectPass(checkNitrogenBoundary(MAN, 4));
  });

  it.skipIf(!readyCore)(`D5-03: a zero correction is the legacy run; corrections keep the logged intake, skip zero-energy days and conserve energy${waiting(CORE)}`, () => {
    const macros = neutralMacros('male');
    const sched = buildSchedule({ days: 21, programs: [pctProgram('m', 90, macros), waterOnlyProgram()], use: (d) => (d % 7 === 3 ? 1 : 0) });
    expectPass(checkOffsetLedger(MAN, sched, [{ fromDay: 0, kcal: 0 }, { fromDay: 5, kcal: 100 }, { fromDay: 12, kcal: -150 }]));
  });

  it('D6-02 / D6-08: every submitted kcal is registered and appears or stays in the gut; no generic ME correction on a high-fibre, nut-free schedule with a fast', () => {
    const hiFibre = pctMacros(18, 45, { fibre: { unit: 'gPer1000Kcal', value: 20 } });
    const sched = buildSchedule({ days: 10, programs: [pctProgram('hf', 95, hiFibre), pctProgram('m', 100, neutralMacros('female'))], use: (d) => d % 2, events: [fastEvent(4, 36, 20, { refeed: 'auto' })] });
    expectPass(checkIngestionAudit(WOMAN, sched));
  });

  it.skipIf(!readyTraining)('D6-08: with the generic fibre correction off, a weight-stable person on a high-fibre maintenance diet does not drift (O-12 limits)', () => {
    const hiFibre = { ...neutralMacros('male'), fibre: { unit: 'gPer1000Kcal' as const, value: 20 } };
    const r = checkConservation(MAN, constantSchedule(30, pctProgram('hf', 100, hiFibre)));
    expect(r.failures.filter((f) => !f.startsWith('day-0'))).toEqual([]);
    const rp = resolveProfile(MAN);
    const res = runEngine(rp, compileSchedule(constantSchedule(30, pctProgram('hf', 100, hiFibre)), rp), { record: 'daily', burnInDays: 14, series: ['fatMass'] });
    const fm = res.daily.fatMass!;
    expect(Math.abs(fm[29]! - res.initial.fatMass!), 'ΔFM over 30 d').toBeLessThan(MAINTENANCE_DRIFT_TOL.fatKg);
  });

  it('D8-01: bone alone equals bone + micronutrient score for a postmenopausal woman in a 180-day deficit; singleton, pair and random masks change no shared output, safety trace or final value', () => {
    const post = person({ sex: 'female', ageYears: 62, heightCm: 162, weightKg: 76, bodyFatPct: 40, steps: 6000, menopause: 'post' });
    const sched = constantSchedule(180, pctProgram('deficit', 75, neutralMacros('female')));
    const pool: SeriesId[] = ['hipBmdChange', 'micronutrientScore', 'fatMass', 'leanTissue', 'scaleWeight', 'visceralFat', 'ldl', 'hunger', 'strength', 'energyAvailability', 'bhb', 'tdee'];
    const masks: SeriesId[][] = [['hipBmdChange'], ['hipBmdChange', 'micronutrientScore'], ['micronutrientScore'], ...pool.map((x) => [x])];
    for (let i = 0; i + 1 < pool.length; i += 2) masks.push([pool[i]!, pool[i + 1]!]);
    const rng = new Rng('d801-masks');
    for (let k = 0; k < 4; k++) masks.push(pool.filter(() => rng.float() < 0.4).concat(['fatMass']));
    expectPass(checkRecordingMaskEquivalence(post, sched, masks));
  });

  it('D8-01 / C7: capture and continue under one recording mask equals the uninterrupted run; another mask is rejected', () => {
    expectPass(checkSnapshotContinuation(WOMAN, mixedSchedule('female'), ['fatMass', 'hipBmdChange', 'micronutrientScore'], 9, ['fatMass']));
  });
});

describe('D8-07: signal contract metadata matches the module hooks that actually run', () => {
  it('the registry has no hook-declaration violations', () => {
    expect(checkSignalHooks()).toEqual([]);
  });

  // Modules that do not declare hook-aware accesses yet (their SIGNAL_META entries are checked against the module order
  // only). Activity (endOfDay write of exSessionNetKcalD) and muscle (endOfDay read of strengthEaMult, lag 1) declare
  // theirs since the wave-3 integration, so every SIGNAL_META write hook and reader is now checked exactly.
  const UNDECLARED_HOOK_MODULES: readonly string[] = [];

  it('every SIGNAL_META write hook and reader (hook and lag) is declared by the writing and reading modules, and each lag follows the module order', () => {
    const mods = new Map(MODULES.map((m) => [m.id, m]));
    const bad: string[] = [];
    const undeclared = new Set<string>();
    for (const [name, meta] of Object.entries(SIGNAL_META) as [SignalName, NonNullable<(typeof SIGNAL_META)[SignalName]>][]) {
      const def = SIGNAL_BY_NAME.get(name)!;
      if (meta.writeHook) {
        const w = mods.get(def.writer)?.signalHooks;
        if (!w?.length) undeclared.add(def.writer);
        else if (!w.some((h) => h.access === 'write' && h.signal === name && h.hook === meta.writeHook)) bad.push(`${name}: ${def.writer} does not declare a write in ${meta.writeHook}`);
      }
      for (const r of meta.reads ?? []) {
        const hs = mods.get(r.module)?.signalHooks;
        if (!hs?.length) undeclared.add(r.module);
        else if (!hs.some((h) => h.access === 'read' && h.signal === name && h.hook === r.hook && h.lag === r.lag)) bad.push(`${name}: ${r.module} does not declare a ${r.hook} read with lag ${r.lag}`);
        // same hook: a reader after the writer sees today's value (lag 0); a reader before it sees yesterday's (lag 1)
        if (meta.writeHook === r.hook) {
          const after = MODULE_ORDER.indexOf(r.module) > MODULE_ORDER.indexOf(def.writer);
          if ((r.lag === 0) !== after) bad.push(`${name}: ${r.module} reads with lag ${r.lag} but runs ${after ? 'after' : 'before'} ${def.writer} in ${r.hook}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect([...undeclared].sort(), 'modules whose hook declarations are still missing (update UNDECLARED_HOOK_MODULES)').toEqual([...UNDECLARED_HOOK_MODULES].sort());
    // the two documented cases: daily session EEE reaches wellbeing the same endOfDay; strengthEaMult reaches muscle the next day
    expect(SIGNAL_META.exSessionNetKcalD?.reads).toEqual([{ module: 'wellbeing', hook: 'endOfDay', lag: 0 }]);
    expect(SIGNAL_META.strengthEaMult?.reads).toEqual([{ module: 'muscle', hook: 'endOfDay', lag: 1 }]);
  });
});

describe('invariant report', () => {
  it('prints the status of every invariant on the current engine (non-gating)', () => {
    const rows: InvariantReport[] = [];
    const run = (f: () => InvariantReport): void => {
      try {
        rows.push(f());
      } catch (e) {
        rows.push({ id: 'ERR', title: e instanceof Error ? e.message : String(e), pass: false, checks: [], failures: ['exception'], advisories: [] });
      }
    };
    for (const [n, p] of PEOPLE) {
      run(() => ({ ...checkConservation(p, mixedSchedule(p.body.sex)), title: `conservation, ${n}` }));
      run(() => ({ ...checkSteadyState(p), title: `steady state 30 d, ${n}` }));
      run(() => ({ ...checkZeroIntake(p, 21), title: `zero intake 21 d, ${n}` }));
      run(() => ({ ...checkZeroIntake(p, 28), title: `zero intake 28 d, ${n}` }));
      run(() => ({ ...checkSequenceInvariance(p), title: `R-SEQ, ${n}` }));
      run(() => ({ ...checkMealFrequencyNull(p), title: `meal-frequency null, ${n}` }));
    }
    for (const [n, p] of EXERCISERS) run(() => ({ ...checkMaintenanceDrift(p), title: `O-12 ${n}` }));
    for (const s of [10, 20, 30]) run(() => checkCarbFatSwap(MAN, s));
    const lines = ['', '-'.repeat(110), `Invariants: ${readinessSummary()}`, '-'.repeat(110)];
    for (const r of rows) {
      lines.push(`${r.pass ? 'pass' : 'FAIL'}  ${r.id.padEnd(8)} ${r.title}`);
      for (const f of r.failures) lines.push(`        ${f}`);
      for (const f of r.advisories) lines.push(`        (advisory) ${f}`);
    }
    lines.push('-'.repeat(110));
    console.log(lines.join('\n'));
    expect(rows.length).toBeGreaterThan(0);
  });
});
