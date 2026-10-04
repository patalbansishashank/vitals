// @vitest-environment node
/**
 * Forward model of the living plan (docs/PLANNER_V2_SPEC.md §7.6, §8.6): item sensitivities (sum 1, floor 0.02, α per
 * session), benefit retained (1 for the prescribed item, 0 for its omission), the realistic projection between omission
 * and as prescribed, determinism, cost per call.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { StimulusVector } from '@/catalogues';
import type { DayTemplate } from '../../../types/schedule';
import type { BlockAdherence, ConfirmedState } from '../replanTypes';
import { PLAN_ITEM_TYPES } from '../replanTypes';
import {
  ITEM_WEIGHT_FLOOR,
  benefitRetained,
  computePlanSensitivities,
  dateAt,
  dayTemplate,
  expectedCredit,
  floorWeights,
  projectRealistic,
} from '../sensitivities';
import { FULL_ADHERENCE, confirmedState, makePlan, type Fixture } from './replan.fixtures';

const now = () => performance.now();

describe('living-plan forward model', () => {
  let f: Fixture;
  let state: ConfirmedState;
  beforeAll(() => {
    f = makePlan({ pick: (s) => /^B1(\[|$)/.test(s.id) });
    state = confirmedState(f.plan, 7, { deltaSd: 60 });
  }, 60_000);

  it('sensitivities: nine weights ≥ 0.02 summing to 1; energy and training carry the deficit plan; α per session sums to 1', () => {
    let cost = { runs: 0, ms: 0 };
    const s = computePlanSensitivities(f.plan, state, { now, onCost: (c) => (cost = c) });
    expect(Object.keys(s.itemWeights).sort()).toEqual([...PLAN_ITEM_TYPES].sort());
    const w = Object.values(s.itemWeights);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    for (const x of w) expect(x).toBeGreaterThanOrEqual(ITEM_WEIGHT_FLOOR - 1e-12);
    expect(s.itemWeights.energy).toBeGreaterThan(ITEM_WEIGHT_FLOOR);
    expect(s.planVersion).toBe('p-test@1');
    const sessions = f.plan.schedule.days.flatMap((_, d) => (dayTemplate(f.plan.schedule, d).exercise ?? []).map((x, k) => `${x.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${d}:${k}`));
    expect(sessions.length).toBeGreaterThan(0);
    expect(Object.keys(s.intentByItem).sort()).toEqual([...sessions].sort());
    for (const a of Object.values(s.intentByItem)) {
      expect(a.hyp + a.str + a.card + a.kcal + a.mob).toBeCloseTo(1, 9);
      for (const v of Object.values(a)) expect(v).toBeGreaterThanOrEqual(0);
    }
    const rt = Object.entries(s.intentByItem).find(([k]) => k.startsWith('rtSession'))?.[1];
    if (rt) expect(rt.card).toBe(0);
    // deterministic, and cheap enough for one call per plan version (13-ish runs of 28 days)
    expect(JSON.stringify(computePlanSensitivities(f.plan, state))).toBe(JSON.stringify(s));
    expect(cost.runs).toBeLessThanOrEqual(20);
    console.info(`computePlanSensitivities: ${cost.runs} runs, ${Math.round(cost.ms)} ms`);
  }, 60_000);

  it('floorWeights water-fills the floor', () => {
    const one = floorWeights({ energy: 1, protein: 0, window: 0, fast: 0, rtSession: 0, cardioSession: 0, steps: 0, sleep: 0, supplement: 0 });
    expect(one.energy).toBeCloseTo(1 - 8 * ITEM_WEIGHT_FLOOR, 12);
    expect(one.protein).toBe(ITEM_WEIGHT_FLOOR);
    const even = floorWeights({ energy: 1, protein: 1, window: 1, fast: 1, rtSession: 1, cardioSession: 1, steps: 1, sleep: 1, supplement: 1 });
    for (const v of Object.values(even)) expect(v).toBeCloseTo(1 / 9, 12);
  });

  it('benefitRetained: 1 for the prescribed item, 0 for its omission, in between for half of it', () => {
    const d = 9;
    const date = dateAt(f.plan.startDate, d);
    const t = dayTemplate(f.plan.schedule, d);
    expect(t.energy.kind).toBe('pctMaintenance');
    const p = (t.energy as { pct: number }).pct;
    expect(p).toBeLessThan(100);
    const t0 = now();
    expect(benefitRetained(f.plan, date, 'energy', t, state)).toBeCloseTo(1, 9);
    const ms = now() - t0;
    const omitted: DayTemplate = { ...t, energy: { kind: 'pctMaintenance', pct: 100 } };
    expect(benefitRetained(f.plan, date, 'energy', omitted, state)).toBeCloseTo(0, 9);
    const half = benefitRetained(f.plan, date, 'energy', { ...t, energy: { kind: 'pctMaintenance', pct: (p + 100) / 2 } }, state);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);
    console.info(`benefitRetained: ${Math.round(ms)} ms per call`);
    // a session item: the prescribed session keeps all of it, none keeps nothing (stimulus vectors resolve to sessions)
    const rtDay = f.plan.schedule.days.findIndex((_, k) => k >= 7 && (dayTemplate(f.plan.schedule, k).exercise ?? []).some((x) => x.kind === 'resistance'));
    expect(rtDay).toBeGreaterThanOrEqual(7);
    const rd = dateAt(f.plan.startDate, rtDay);
    const rt = dayTemplate(f.plan.schedule, rtDay);
    const k = (rt.exercise ?? []).findIndex((x) => x.kind === 'resistance');
    expect(benefitRetained(f.plan, rd, `rtSession:${rtDay}:${k}`, rt, state)).toBeCloseTo(1, 9);
    expect(benefitRetained(f.plan, rd, `rtSession:${rtDay}:${k}`, { ...rt, exercise: [] }, state)).toBeCloseTo(0, 9);
    const nothing: StimulusVector = { effectiveSetsByRegion: {}, pattern: 'squat', loadClass: 'moderate', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} };
    expect(benefitRetained(f.plan, rd, `rtSession:${rtDay}:${k}`, nothing, state)).toBeCloseTo(0, 9);
  }, 60_000);

  it('projectRealistic: the realistic curve lies between omission and as prescribed', () => {
    const half: BlockAdherence[] = FULL_ADHERENCE.map((b) => (b.type === 'energy' ? { ...b, a: 1, b: 1 } : b));
    const none: BlockAdherence[] = FULL_ADHERENCE.map((b) => ({ ...b, a: 0, b: 1 }));
    expect(expectedCredit(half, 'energy')).toBeCloseTo(0.5, 12);
    expect(expectedCredit([], 'energy')).toBeCloseTo(0.75, 12);
    const full = projectRealistic(f.plan, state, FULL_ADHERENCE, { now });
    const mid = projectRealistic(f.plan, state, half);
    const omit = projectRealistic(f.plan, state, none);
    const fat = (x: typeof full, which: 'asPrescribed' | 'realistic') => x[which].find((g) => g.metric === 'fatMass')!.endP50;
    expect(fat(full, 'realistic')).toBeCloseTo(fat(full, 'asPrescribed'), 9);
    expect(fat(mid, 'asPrescribed')).toBeCloseTo(fat(full, 'asPrescribed'), 9);
    expect(fat(mid, 'realistic')).toBeGreaterThan(fat(mid, 'asPrescribed') + 0.01);
    expect(fat(mid, 'realistic')).toBeLessThan(fat(omit, 'realistic') - 0.01);
    const band = mid.bands.realistic.fatMass!;
    expect(band.p50.length).toBe(f.plan.schedule.horizonDays - mid.fromDay);
    for (let i = 0; i < band.p50.length; i++) expect(band.p10[i]!).toBeLessThanOrEqual(band.p90[i]! + 1e-6);
    expect(mid.credits.energy).toBeCloseTo(0.5, 12);
    console.info(`projectRealistic: ${full.euUsed} runs, ${Math.round(full.ms)} ms`);
  }, 60_000);
});
