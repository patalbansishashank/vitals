// @vitest-environment node
/**
 * Difficulty axis D (PLANNER_V2_SPEC §1.1, §9.7 "Difficulty"): D(baseline) = 0; D does not fall when one burden rises;
 * per-component values on three personas (pinned with tolerances); the φ_life ranges are fixed per request (the same
 * whatever else was evaluated); `descriptors()` is [D, b₁, b₃, b₄]; the rows read in plain words.
 */
import { describe, expect, it } from 'vitest';
import { leak } from '../../../../content/evidence/__tests__/leakScan';
import type { SimulationResult } from '../../../types/result';
import type { Schedule } from '../../../types/schedule';
import { Rng } from '../../optim/rng';
import { compileRequest, type PlanningContext } from '../context';
import { INACTIVE_TEXT, difficulty, difficultyD, difficultyFrame, lifeRanges } from '../difficulty';
import { EnginePlanModel } from '../model';
import { enumerateStructures, makeStructure, type PlanSkeleton, type SkeletonStructure } from '../skeleton';
import { DIFFICULTY_COMPONENTS, type RankedGoal } from '../types';
import { FAT_LOSS_KEEP_LEAN, LEAN_MAN, MAN_95, WOMAN_62, request } from './personas';

const MUSCLE_FIRST: RankedGoal[] = [
  { metric: 'leanTissue', direction: 'maximise' },
  { metric: 'fatMass', direction: 'minimise' },
];

function persona(name: 'man95' | 'woman62' | 'lean'): PlanningContext {
  if (name === 'man95') return compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 84 }));
  if (name === 'woman62') return compileRequest(request(WOMAN_62, FAT_LOSS_KEEP_LEAN, { horizonDays: 84 }));
  return compileRequest(request(LEAN_MAN, MUSCLE_FIRST, { horizonDays: 84 }));
}

function modelOf(ctx: PlanningContext): EnginePlanModel {
  return new EnginePlanModel(ctx, { bindings: ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass })) });
}

/** A fixed plan per persona that does not depend on the enumeration order: one phase, no overlay, at the gene defaults. */
function fixedPlan(ctx: PlanningContext, block: 'B1' | 'B23'): SkeletonStructure {
  const sk: PlanSkeleton = { baseline: false, segments: [{ kind: 'phase', block }], overlay: null, event: null, creatine: false, omega3: false, viscousFibre: false, sleepExtension: false };
  return makeStructure(ctx, sk);
}

function evalPlan(model: EnginePlanModel, st: SkeletonStructure, x: Float64Array): { schedule: Schedule; sim: SimulationResult } {
  const r = model.repair(st, model.decode(st, x));
  return { schedule: r.schedule, sim: model.simulate(r.schedule, -1) };
}

function withSeries(sim: SimulationResult, id: 'hunger' | 'inEnergyPctMaint', f: (v: number) => number): SimulationResult {
  const a = sim.daily[id]!;
  return { ...sim, daily: { ...sim.daily, [id]: Float32Array.from(a, f) } };
}

function editPrograms(s: Schedule, f: (t: Schedule['programs'][number]) => void): Schedule {
  const c = structuredClone(s);
  c.programs.forEach(f);
  return c;
}

describe('difficulty axis D', () => {
  it('D(baseline) = 0 exactly, with every component at zero; the planner-mode run records the R-MAINT intake %', () => {
    for (const name of ['man95', 'woman62', 'lean'] as const) {
      const ctx = persona(name);
      const model = modelOf(ctx);
      const st = enumerateStructures(ctx)[0]!;
      expect(st.skeleton.baseline).toBe(true);
      const { schedule, sim } = evalPlan(model, st, new Float64Array(0));
      expect(sim.daily.inEnergyPctMaint?.length, name).toBe(ctx.horizonDays);
      expect(difficultyD(ctx, schedule, sim), name).toBe(0);
      const b = difficulty(ctx, schedule, sim);
      expect(b.D, name).toBe(0);
      expect(b.Dmax).toBe(0);
      expect(b.hardest).toBeNull();
      expect(b.components.map((c) => c.id)).toEqual([...DIFFICULTY_COMPONENTS]);
      for (const c of b.components) expect(c.value, `${name} ${c.id}`).toBe(0);
      expect(model.descriptors(schedule, sim)[0]).toBe(0);
    }
  }, 120_000);

  it('descriptors() = [D, b₁, b₃, b₄]; the Gower features keep b₁..b₄', () => {
    const ctx = persona('man95');
    const model = modelOf(ctx);
    const sts = enumerateStructures(ctx);
    const rng = new Rng(17);
    for (const st of sts.slice(1, 6)) {
      const { schedule, sim } = evalPlan(model, st, Float64Array.from({ length: st.dim }, () => rng.float()));
      const d = model.descriptors(schedule, sim);
      const f = model.features(schedule);
      expect(d.length).toBe(4);
      expect(d[0]).toBeCloseTo(difficultyD(ctx, schedule, sim), 12);
      expect(d[0]).toBeGreaterThan(0);
      expect(d[0]).toBeLessThanOrEqual(1);
      expect([d[1], d[2], d[3]]).toEqual([f[0], f[2], f[3]]);
      expect(difficulty(ctx, schedule, sim).D).toBeCloseTo(d[0]!, 12);
    }
  }, 120_000);

  it('monotone: raising one burden never lowers D (deficit, hunger, training time, fasting and window, decisions, purchases)', () => {
    const ctx = persona('man95');
    const model = modelOf(ctx);
    const st = fixedPlan(ctx, 'B1');
    const { schedule, sim } = evalPlan(model, st, Float64Array.from(st.x0));
    const base = difficulty(ctx, schedule, sim);
    const D0 = base.D;
    const comp = (b: ReturnType<typeof difficulty>, id: string) => b.components.find((c) => c.id === id)!.value;
    const check = (label: string, s: Schedule, m: SimulationResult, id: string, strict = true, purchases = 0) => {
      const b = difficulty(ctx, s, m, { purchases });
      expect(b.D, label).toBeGreaterThanOrEqual(D0 - 1e-12);
      expect(comp(b, id), label).toBeGreaterThanOrEqual(comp(base, id) - 1e-12);
      if (strict) expect(comp(b, id), label).toBeGreaterThan(comp(base, id));
      expect(difficultyD(ctx, s, m, purchases), label).toBeCloseTo(b.D, 12);
      return b;
    };
    // deficit: less eaten on every day (the run's R-MAINT intake %); hunger: a higher index
    check('deficit', schedule, withSeries(sim, 'inEnergyPctMaint', (v) => v * 0.95), 'deficit');
    check('hunger', schedule, withSeries(sim, 'hunger', (v) => v * 1.5 + 5), 'hunger');
    // training time: 1,000 more steps a day (away from the habit, so the routine distance rises too)
    const steps = editPrograms(schedule, (t) => (t.steps = (t.steps ?? ctx.rp.habits.typicalSteps) + 1000));
    check('steps', steps, sim, 'trainingTime');
    // fasting load and window tightness: a window 1 h shorter on every eating day
    const shorter = editPrograms(schedule, (t) => {
      if (t.meals?.window) t.meals = { ...t.meals, window: { ...t.meals.window, lengthH: t.meals.window.lengthH - 1 } };
    });
    const bw = check('window', shorter, sim, 'windowTightness');
    expect(comp(bw, 'fastingLoad')).toBeGreaterThan(comp(base, 'fastingLoad'));
    // daily decisions: one more supplement a day
    const supp = editPrograms(schedule, (t) => (t.substances = { ...(t.substances ?? {}), creatineG: 3 }));
    check('supplement', supp, sim, 'decisions');
    // purchases: each required item adds 0.05 to the routine distance
    const p2 = check('purchases', schedule, sim, 'habitDistance', true, 2);
    expect(p2.D - D0).toBeCloseTo((2 * 0.05) / 7, 9);
    // the equipment helper's burden (already 0.05 per item) gives the same D
    expect(difficulty(ctx, schedule, sim, { purchaseBurden: 0.1 }).D).toBeCloseTo(p2.D, 12);
    expect(difficultyD(ctx, schedule, sim, 0, 0.1)).toBeCloseTo(p2.D, 12);
  }, 120_000);

  it('per-component values on three personas (one-phase plan at the gene defaults), pinned with tolerances', () => {
    // values measured 2026-10-01 (A8); tolerance 0.03 per component, 0.02 on D (engine drift)
    const PINS: Record<string, { block: 'B1' | 'B23'; c: number[] }> = {
      man95: { block: 'B1', c: PIN_MAN95 },
      woman62: { block: 'B1', c: PIN_WOMAN62 },
      lean: { block: 'B23', c: PIN_LEAN },
    };
    for (const [name, pin] of Object.entries(PINS)) {
      const ctx = persona(name as 'man95' | 'woman62' | 'lean');
      const model = modelOf(ctx);
      const st = fixedPlan(ctx, pin.block);
      const { schedule, sim } = evalPlan(model, st, Float64Array.from(st.x0));
      const b = difficulty(ctx, schedule, sim);
      const got = b.components.map((c) => +c.value.toFixed(3));
      got.forEach((v, i) => expect(Math.abs(v - pin.c[i]!), `${name} ${DIFFICULTY_COMPONENTS[i]}: ${JSON.stringify(got)}`).toBeLessThanOrEqual(0.03));
      const mean = pin.c.reduce((s, v) => s + v, 0) / 7;
      expect(Math.abs(b.D - mean), name).toBeLessThanOrEqual(0.02);
      expect(b.Dmax).toBeCloseTo(Math.max(...b.components.map((c) => c.value)), 12);
      expect(b.hardest).not.toBeNull();
      for (const c of b.components) {
        expect(c.value).toBeGreaterThanOrEqual(0);
        expect(c.value).toBeLessThanOrEqual(1);
        expect(c.active, `${name} ${c.id}`).toBe(true);
        expect(leak(c.text), c.text).toBeNull();
        expect(leak(c.label)).toBeNull();
        expect(c.text).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  }, 120_000);

  it('φ_life ranges are fixed per request: identical after evaluating other plans and in a fresh context; D of a plan is too', () => {
    const ctxA = persona('woman62');
    const r0 = Array.from(lifeRanges(ctxA));
    expect(r0.some((v) => v > 0)).toBe(true);
    const model = modelOf(ctxA);
    const sts = enumerateStructures(ctxA);
    const rng = new Rng(29);
    const target = fixedPlan(ctxA, 'B1');
    const first = evalPlan(model, target, Float64Array.from(target.x0));
    const dFirst = difficultyD(ctxA, first.schedule, first.sim);
    for (const st of sts.slice(1, 12)) {
      const { schedule, sim } = evalPlan(model, st, Float64Array.from({ length: st.dim }, () => rng.float()));
      difficultyD(ctxA, schedule, sim);
    }
    expect(Array.from(lifeRanges(ctxA))).toEqual(r0);
    const ctxB = persona('woman62');
    expect(Array.from(lifeRanges(ctxB))).toEqual(r0);
    const again = evalPlan(modelOf(ctxB), fixedPlan(ctxB, 'B1'), Float64Array.from(target.x0));
    expect(difficultyD(ctxB, again.schedule, again.sim)).toBe(dFirst);
    expect(difficultyD(ctxA, first.schedule, first.sim)).toBe(dFirst);
  }, 120_000);

  it('a limit that leaves no room makes its component inactive with a plain sentence; texts never leak internal references', () => {
    const ctx = compileRequest(request(MAN_95, [{ metric: 'leanTissue', direction: 'maximise' }], { horizonDays: 56, safety: { plannerLocks: [{ id: 'no-deficit' }] } }));
    expect(ctx.caps.deficitCapPct).toBe(0);
    const fr = difficultyFrame(ctx);
    expect(fr.active[0]).toBe(false);
    const model = modelOf(ctx);
    const sts = enumerateStructures(ctx);
    const rng = new Rng(3);
    for (const st of sts.slice(1, 5)) {
      const { schedule, sim } = evalPlan(model, st, Float64Array.from({ length: st.dim }, () => rng.float()));
      const b = difficulty(ctx, schedule, sim, { purchases: 1 });
      const def = b.components[0]!;
      expect(def.active).toBe(false);
      expect(def.value).toBe(0);
      expect(def.text).toBe(INACTIVE_TEXT);
      for (const c of b.components) expect(leak(`${c.label}: ${c.text}`)).toBeNull();
    }
  }, 120_000);
});

// pinned component values [deficit, hunger, trainingTime, fastingLoad, windowTightness, decisions, habitDistance]
const PIN_MAN95 = [0.8, 0.198, 0.33, 0.13, 0.167, 0.005, 0.249];
const PIN_WOMAN62 = [0.812, 0.121, 0.286, 0.13, 0.167, 0, 0.186];
const PIN_LEAN = [0, 0, 0.19, 0.167, 0.167, 0, 0.168];
