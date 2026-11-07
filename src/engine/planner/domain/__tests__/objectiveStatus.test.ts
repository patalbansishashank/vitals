// @vitest-environment node
/**
 * Objective values and statuses of engine runs in the planner (C6; W1): a protein-deficient surplus earns no lean benefit
 * and makes fat/scale/body fat conditional (D1-05); a ketogenic block withholds LDL credit (D7-07); a model-limit
 * termination is infeasible (D1-08); an EA rule day without an EA value leaves the floor unchecked (D8-04); missing hunger
 * days are missing, not zero hunger (D2-06); the legacy plan-survival index is never reported (D2-06).
 */
import { describe, expect, it } from 'vitest';
import type { SimulationResult } from '../../../types/result';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import { eaUnevaluatedDays } from '../../../model/safety/constraints';
import { compileRequest } from '../context';
import { baselineSchedule } from '../decode';
import { hungerAssessment } from '../explain';
import { goalValue } from '../goalSpecs';
import { EnginePlanModel, MARGIN_IDS, ketogenicFromDay, missingStateMargins, objectiveGoalValues, plannerConditions, stateMargins } from '../model';
import { goalOutcomes } from '../sensitivities';
import { MAN_95, request } from './personas';

const HORIZON = 28;

function withPrograms(s: Schedule, f: (t: DayTemplate) => DayTemplate, blocks?: Schedule['blocks']): Schedule {
  return { ...s, programs: s.programs.map(f), ...(blocks ? { blocks } : {}) };
}

/** 115 % of maintenance with protein at `gPerKg` g/kg body mass/day (fat fixed, carbohydrate the remainder). */
const surplus = (gPerKg: number) => (t: DayTemplate): DayTemplate => ({
  ...t,
  energy: { kind: 'pctMaintenance', pct: 115 },
  macros: { ...t.macros, protein: { unit: 'gPerKgBw', value: gPerKg }, carbs: { unit: 'remainder' }, fat: { unit: 'gPerKgBw', value: 1 } },
});

describe('lean partition in a surplus (D1-05)', () => {
  const ctx = compileRequest(request(MAN_95, [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }], { horizonDays: HORIZON }));
  const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
  const model = new EnginePlanModel(ctx, { bindings });
  const base = baselineSchedule(ctx);

  it('a protein-deficient surplus (0.5 g/kg) earns no positive lean change and makes fat mass conditional', () => {
    const s = withPrograms(base, surplus(0.5));
    const sim = model.simulate(s, -1);
    const cond = plannerConditions(ctx, s, sim);
    const engineMarked = !!sim.meta.outputStatus?.leanTissue;
    // the planner's routing flag fires unless the composition provider already marked the partition itself
    if (!engineMarked) expect(cond.map((c) => [c.series, c.status, c.reasonCode])).toContainEqual(['leanTissue', 'limited', 'lowProteinSurplusPartition']);
    const st = model.statuses(sim);
    expect(st.leanTissue?.status).not.toBe('estimated');
    expect(st.fatMass?.status).toBe('scenario');
    const g = model.goals(sim);
    const start = sim.initial.leanTissue!;
    expect(g[0]!).toBeLessThanOrEqual(start + 1e-6);
    // the raw functional is untouched (the number stays for display with its status)
    expect(goalValue(sim, bindings[0]!, ctx)).toBeGreaterThanOrEqual(g[0]! - 1e-9);
    // a fat goal keeps its number (an energy-budget comparison), now labelled conditional
    expect(g[1]!).toBeCloseTo(goalValue(sim, bindings[1]!, ctx), 9);
  });

  it('living forecast rows (goalOutcomes) carry the same status: a withheld lean gain shows no range and no goal date', () => {
    const s = withPrograms(base, surplus(0.5));
    const sim = model.simulate(s, -1);
    const rows = goalOutcomes(ctx, { nominal: sim, low: sim, high: sim, schedule: s }, 0, '2026-01-05', 0.5);
    const lean = rows.find((r) => r.metric === 'leanTissue')!;
    expect(lean.status).toBe('limited');
    expect(lean.reasonCode).toMatch(/protein|partition/i);
    expect(lean.p10).toBeUndefined();
    expect(lean.p90).toBeUndefined();
    expect(lean.date).toBeNull();
    // the fat row keeps its conditional range (an energy-budget comparison)
    const fat = rows.find((r) => r.metric === 'fatMass')!;
    expect(fat.status).toBe('scenario');
    expect(fat.p10).toBeDefined();
  });

  it('an adequate-protein surplus (1.8 g/kg) is unchanged: no condition, objective = raw functional', () => {
    const s = withPrograms(base, surplus(1.8));
    const sim = model.simulate(s, -1);
    expect(plannerConditions(ctx, s, sim).filter((c) => c.series === 'leanTissue')).toEqual([]);
    const g = model.goals(sim);
    expect(Array.from(g)).toEqual(bindings.map((b) => goalValue(sim, b, ctx)));
    expect(objectiveGoalValues(ctx, bindings, sim, s)).toEqual(g);
  });
});

describe('ketogenic lipid response (D7-07)', () => {
  const ctx = compileRequest(request(MAN_95, [{ metric: 'ldl', direction: 'minimise' }], { horizonDays: HORIZON }));
  const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
  const model = new EnginePlanModel(ctx, { bindings });
  const base = baselineSchedule(ctx);

  it('a very-low-carbohydrate block withholds any LDL reduction credit and limits the LDL status', () => {
    const keto = withPrograms(base, (t) => t, [{ name: 'Very low carbohydrate', startDay: 0, endDay: HORIZON, buildingBlockId: 'B2' }]);
    const sim = model.simulate(keto, -1);
    const cond = plannerConditions(ctx, keto, sim);
    if (!sim.meta.outputStatus?.ldl) expect(cond).toContainEqual({ series: 'ldl', status: 'limited', reasonCode: 'uncertainKetogenicResponse', fromDay: 0 });
    const start = sim.initial.ldl!;
    expect(model.goals(sim)[0]!).toBeGreaterThanOrEqual(Math.min(start, goalValue(sim, bindings[0]!, ctx)) - 1e-9);
    expect(model.goals(sim)[0]!).toBeGreaterThanOrEqual(start - 1e-9);
    expect(model.statuses(sim).apoB?.status ?? 'scenario').toBe('scenario');
  });

  it('without a ketogenic block the LDL objective is the raw functional', () => {
    const sim = model.simulate(base, -1);
    expect(plannerConditions(ctx, base, sim)).toEqual([]);
    expect(ketogenicFromDay(ctx, base)).toBeNull();
    expect(model.goals(sim)[0]!).toBe(goalValue(sim, bindings[0]!, ctx));
  });

  it('a very-low-carbohydrate pattern without block ids (habitual, Simulator or living schedule) is the same condition', () => {
    // 30 g carbohydrate a day (inside the B2 block's own 20-50 g range), no block metadata
    const lowCarb = withPrograms(base, (t) => ({ ...t, macros: { ...t.macros, carbs: { unit: 'g', value: 30 }, fat: { unit: 'remainder' } } }));
    expect(ketogenicFromDay(ctx, lowCarb)).toBe(0);
    const sim = model.simulate(lowCarb, -1);
    if (!sim.meta.outputStatus?.ldl) expect(plannerConditions(ctx, lowCarb, sim)).toContainEqual({ series: 'ldl', status: 'limited', reasonCode: 'uncertainKetogenicResponse', fromDay: 0 });
    expect(model.goals(sim)[0]!).toBeGreaterThanOrEqual(sim.initial.ldl! - 1e-9);
    // a fast alone is not a ketogenic diet: zero days are not eating days
    const fastOnly = { ...base, programs: [...base.programs, { ...base.programs[0]!, id: 'Z', energy: { kind: 'zero' as const } }], days: base.days.map((d, i) => (i % 7 === 3 ? { program: base.programs.length } : d)) };
    expect(ketogenicFromDay(ctx, fastOnly)).toBeNull();
  });
});

describe('margins: model limit, EA coverage, missing hunger (D1-08, D8-04, D2-06)', () => {
  const ctx = compileRequest(request(MAN_95, [{ metric: 'fatMass', direction: 'minimise' }], { horizonDays: HORIZON }));
  const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
  const model = new EnginePlanModel(ctx, { bindings });
  const base = baselineSchedule(ctx);
  const sim = model.simulate(base, -1);
  const ABORT = MARGIN_IDS.indexOf('abort');

  it('a model-limit termination is infeasible like an abort; a valid run is not', () => {
    expect(stateMargins(ctx, sim, base)[ABORT]).toBeGreaterThan(0);
    const limited = { ...sim, meta: { ...sim.meta, validity: { status: 'modelLimit' as const, reasonCode: 'tissueFloor', validThroughHour: 200, version: 1 } } } as SimulationResult;
    expect(stateMargins(ctx, limited, base)[ABORT]).toBeLessThanOrEqual(-1);
  });

  it('an EA rule day (exercise, deficit, not a fast day) without an EA value leaves HC-E4 unchecked, never not-applicable', () => {
    const n = sim.safety.ea7.length;
    const ea7 = new Float32Array(n).fill(40);
    for (let d = 5; d < 10; d++) ea7[d] = Number.NaN;
    const safety = {
      ...sim.safety,
      ea7,
      eee7: new Float32Array(n).fill(300),
      deficitPct7: new Float32Array(n).fill(20),
      fastDay: new Float32Array(n),
    };
    const unknownEa = { ...sim, safety } as SimulationResult;
    expect(eaUnevaluatedDays(safety)).toEqual([5, 6, 7, 8, 9]);
    expect(missingStateMargins(unknownEa)).toContain(MARGIN_IDS.indexOf('HC-E4'));
    // no exercise: the EA rules do not apply, so nothing is missing for that reason
    const rest = { ...sim, safety: { ...safety, eee7: new Float32Array(n) } } as SimulationResult;
    expect(eaUnevaluatedDays(rest.safety)).toEqual([]);
    expect(missingStateMargins(rest)).not.toContain(MARGIN_IDS.indexOf('HC-E4'));
  });

  it('a missing hunger day is missing, not zero hunger: it does not loosen the hunger cap', () => {
    const n = sim.daily.hunger!.length;
    const high = new Float32Array(n).fill(90);
    const gaps = high.slice();
    for (let d = 3; d < n; d += 4) gaps[d] = Number.NaN;
    const a = stateMargins(ctx, { ...sim, daily: { ...sim.daily, hunger: high } } as SimulationResult, base);
    const b = stateMargins(ctx, { ...sim, daily: { ...sim.daily, hunger: gaps } } as SimulationResult, base);
    const cap = MARGIN_IDS.indexOf('hungerCap');
    expect(b[cap]).toBeCloseTo(a[cap]!, 9);
    const h = hungerAssessment(ctx, { daily: { hunger: gaps }, final: { adherence: 100 } } as unknown as SimulationResult);
    expect(h.meanIdx).toBe(90);
    expect(h.rating).toBe('high');
    // the legacy plan-survival index is no probability of sticking with the plan: never reported (D2-06)
    expect(Number.isFinite(h.adherencePct)).toBe(false);
    expect(Number.isFinite(hungerAssessment(ctx, sim).adherencePct)).toBe(false);
  });
});
