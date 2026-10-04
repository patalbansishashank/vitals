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
  type InvariantReport,
} from './harness/invariants';
import { REQUIRES, missingModules, readinessSummary, scenarioReady } from './harness/stubs';
import { runBundledBench } from './harness/bundledBench';
import { LEAN_MAN, MAN, WOMAN, person } from './fixtures/personas';
import { buildSchedule, cardioSession, fastEvent, pctProgram, rtSession, neutralMacros, constantSchedule } from './fixtures/programs';
import type { PersonProfile, Schedule } from '../types';
import type { SeriesId } from '../types/metrics';
import { compileSchedule } from '../core/compileSchedule';
import { runEngine, simulateEnsemble } from '../core/loop';
import { resolveProfile } from '../core/resolveProfile';
import { MODULES } from '../core/moduleRegistry';
import { buildModelParams, sampleParams } from '../core/paramsRegistry';

/** 1-min load average per logical core (0 when unknown, e.g. outside Node). */
function machineLoad(): number {
  const g = globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } };
  const os = g.process?.getBuiltinModule?.('node:os') as { loadavg(): number[]; availableParallelism?(): number; cpus(): unknown[] } | undefined;
  if (!os) return 0;
  const n = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return (os.loadavg()[0] ?? 0) / Math.max(1, n);
}
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
  // ≤ 15 ms ("Simulator full ≤ 15 ms"). Timing is only meaningful on a machine that is not saturated: when the 1-min load
  // average exceeds half the logical cores (e.g. the whole repository's suite running in parallel) the measurement is
  // repeated once and, if still over budget, the test is marked skipped with the numbers — never passed on a noisy clock.
  it.skipIf(!readyFull)(`bundled engine: 180-day run best-of-15 — planner ≤ ${PERF_BUDGET_MS.desktop} ms, simulate none/daily/full ≤ ${PERF_BUDGET_MS.simulate} ms (desktop)`, async (ctx) => {
    const within = (rows: Awaited<ReturnType<typeof runBundledBench>>): boolean =>
      rows.every((r) => r.bestMs <= (r.mode === 'planner' ? PERF_BUDGET_MS.desktop : PERF_BUDGET_MS.simulate));
    let rows = await runBundledBench(15);
    const fmt = (): string => rows.map((r) => `${r.mode} ${r.bestMs.toFixed(2)}/${r.medianMs.toFixed(2)}`).join(' · ');
    console.log(`O-11 (bundled, ms per 180 d, best/median of 15): ${fmt()} · load ${machineLoad().toFixed(2)}`);
    if (!within(rows) && machineLoad() > 0.5) {
      rows = await runBundledBench(25);
      console.log(`O-11 retry (machine busy): ${fmt()} · load ${machineLoad().toFixed(2)}`);
      if (!within(rows) && machineLoad() > 0.5) ctx.skip(`machine saturated (load ${machineLoad().toFixed(2)} per core); not a timing measurement: ${fmt()}`);
    }
    for (const r of rows) expect(r.bestMs, `${r.mode} best ms`).toBeLessThanOrEqual(r.mode === 'planner' ? PERF_BUDGET_MS.desktop : PERF_BUDGET_MS.simulate);
  }, 240_000);
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
