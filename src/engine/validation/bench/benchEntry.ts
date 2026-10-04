/**
 * O-11 benchmark entry (MODEL_SPEC §9.1): bundled by `harness/bundledBench.ts` with Vite (production build, no dev/test
 * transform) and run in the test process, so the reported ms per 180-day run are those of the shipped engine, not of the
 * Vitest module transform (which turns every imported binding into a getter call and costs ≈ 30 %).
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { RecordMode, RunOptions } from '../../types';
import { MAN } from '../fixtures/personas';
import { cardioSession, buildSchedule, neutralMacros, pctProgram, rtSession } from '../fixtures/programs';

export interface BenchRow {
  mode: 'none' | 'daily' | 'full' | 'planner';
  bestMs: number;
  medianMs: number;
}

/** 180 days of a training-week deficit (RT, rest, cardio days) for MAN, 14-d burn-in; best and median of `runs` warm runs. */
export function benchEngine(runs = 15): BenchRow[] {
  const rp = resolveProfile(MAN);
  const macros = neutralMacros('male');
  const cs = compileSchedule(
    buildSchedule({
      days: 180,
      extraDays: 0,
      programs: [pctProgram('rt', 80, macros, { exercise: [rtSession(17)] }), pctProgram('rest', 80, macros), pctProgram('cardio', 80, macros, { exercise: [cardioSession('run', 7, 40)] })],
      use: [0, 1, 2, 1, 0, 1, 1],
    }),
    rp,
  );
  const modes: [BenchRow['mode'], RunOptions][] = [
    ['none', { record: 'none' as RecordMode }],
    ['daily', { record: 'daily' as RecordMode }],
    ['full', { record: 'full' as RecordMode }],
    ['planner', { mode: 'planner', record: 'daily', series: ['fatMass', 'leanTissue', 'scaleWeight', 'bodyFatPct'], collectEvents: false }],
  ];
  const out: BenchRow[] = [];
  for (const [mode, opts] of modes) {
    for (let i = 0; i < 5; i++) runEngine(rp, cs, opts);
    const t: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      runEngine(rp, cs, opts);
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    out.push({ mode, bestMs: t[0]!, medianMs: t[Math.floor(t.length / 2)]! });
  }
  return out;
}
