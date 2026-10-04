/**
 * Scenario runner and evaluator (WP-V). Runs the REAL engine (`runEngine` over `resolveProfile` + `compileSchedule`),
 * measures every expectation and classifies it per the §9 gate semantics. Never throws: an engine exception becomes an
 * `error` outcome for every expectation of the scenario so the report always renders.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import type { AnyEngineModule } from '../../types/module';
import type { RunOptions } from '../../types';
import type { ArmRun, ArmSpec, Check, Expectation, Gate, MeasureCtx, Outcome, Scenario, Status } from './types';
import { ArmView } from './view';

// ------------------------------------------------------------------ check builders (used by scenario files)

/** |measured − target| ≤ tol. */
export const val = (target: number, tol: number): Check => ({ kind: 'value', target, tol });
/** |measured − target| ≤ frac·|target|. */
export const rel = (target: number, frac: number): Check => ({ kind: 'value', target, tol: Math.abs(target) * frac });
export const range = (lo: number, hi: number): Check => ({ kind: 'range', lo, hi });
export const above = (min: number): Check => ({ kind: 'above', min });
export const below = (max: number): Check => ({ kind: 'below', max });

export function describeCheck(c: Check): string {
  const f = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(4))));
  switch (c.kind) {
    case 'value':
      return `${f(c.target)} ± ${f(c.tol)}`;
    case 'range':
      return `[${f(c.lo)}, ${f(c.hi)}]`;
    case 'above':
      return `> ${f(c.min)}`;
    case 'below':
      return `< ${f(c.max)}`;
  }
}

/** Signed distance of x from the acceptance region of a check (0 inside; value checks report x − target). */
export function checkError(c: Check, x: number): number {
  switch (c.kind) {
    case 'value':
      return x - c.target;
    case 'range':
      return x < c.lo ? x - c.lo : x > c.hi ? x - c.hi : 0;
    case 'above':
      return x > c.min ? 0 : x - c.min;
    case 'below':
      return x < c.max ? 0 : x - c.max;
  }
}

export function checkPasses(c: Check, x: number): boolean {
  if (!Number.isFinite(x)) return false;
  switch (c.kind) {
    case 'value':
      return Math.abs(x - c.target) <= c.tol;
    case 'range':
      return x >= c.lo && x <= c.hi;
    case 'above':
      return x > c.min;
    case 'below':
      return x < c.max;
  }
}

// ------------------------------------------------------------------ running

/** Default options of scenario arms: daily recording, 14-d burn-in, conservation checks and events on. */
export const DEFAULT_ARM_OPTIONS: RunOptions = { mode: 'simulate', record: 'daily', burnInDays: 14, checks: true, collectEvents: true, collectWarnings: true };

/** Run one arm through the real engine. */
export function runArm(id: string, spec: ArmSpec, modules: readonly AnyEngineModule[] = MODULES): ArmRun {
  const profile = resolveProfile(spec.profile);
  const compiled = compileSchedule(spec.schedule, profile);
  const result = runEngine(profile, compiled, { ...DEFAULT_ARM_OPTIONS, ...spec.options }, modules);
  return { id, profile, compiled, result };
}

export interface ScenarioRun {
  scenario: Scenario;
  views: Record<string, ArmView> | null;
  error?: string;
  /** Wall time of all arms, ms. */
  ms: number;
}

export function runScenario(sc: Scenario, modules: readonly AnyEngineModule[] = MODULES): ScenarioRun {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const views: Record<string, ArmView> = {};
  try {
    for (const [id, spec] of Object.entries(sc.arms)) {
      const r = runArm(id, spec, modules);
      views[id] = new ArmView(id, r.profile, r.compiled, r.result);
    }
    return { scenario: sc, views, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
  } catch (e) {
    return { scenario: sc, views: null, error: e instanceof Error ? e.message : String(e), ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
  }
}

function makeCtx(views: Record<string, ArmView>, sc: Scenario): MeasureCtx {
  const ids = Object.keys(views);
  const first = views[ids[0] ?? 'main'] as ArmView;
  return {
    arm(id?: string): ArmView {
      const v = views[id ?? (views['main'] ? 'main' : (ids[0] as string))];
      if (!v) throw new Error(`scenario ${sc.id}: no arm '${id}'`);
      return v;
    },
    main: views['main'] ?? first,
    arms: views,
  };
}

// ------------------------------------------------------------------ evaluation

function classify(gate: Gate, passed: boolean, measured: number): Status {
  if (!Number.isFinite(measured)) return 'no-data';
  if (gate === 'M') return passed ? 'pass' : 'miss';
  if (gate === 'K') return passed ? 'now-passing' : 'known-miss';
  return passed ? 'q-pass' : 'q-miss';
}

export function evaluateExpectation(sc: Scenario, ex: Expectation, run: ScenarioRun): Outcome {
  const gate = ex.gate ?? sc.gate;
  const base = {
    scenarioId: sc.id,
    dossier: sc.dossier,
    target: sc.target,
    title: sc.title,
    expectationId: ex.id,
    label: ex.label,
    unit: ex.unit,
    gate,
    expected: describeCheck(ex.check),
    ...(ex.note ? { note: ex.note } : {}),
  };
  if (!run.views) {
    return { ...base, measured: Number.NaN, error: Number.NaN, status: 'error', errorMessage: run.error ?? 'engine error' };
  }
  let measured: number;
  try {
    measured = ex.measure(makeCtx(run.views, sc));
  } catch (e) {
    return { ...base, measured: Number.NaN, error: Number.NaN, status: 'error', errorMessage: e instanceof Error ? e.message : String(e) };
  }
  const passed = checkPasses(ex.check, measured);
  return { ...base, measured, error: Number.isFinite(measured) ? checkError(ex.check, measured) : Number.NaN, status: classify(gate, passed, measured) };
}

export function evaluateScenario(run: ScenarioRun): Outcome[] {
  return run.scenario.expectations.map((ex) => evaluateExpectation(run.scenario, ex, run));
}
