// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CURRENT_TISSUE_FAT_ENDPOINT } from '@/lib/bodyContracts';
import { compileSchedule } from '../../../core/compileSchedule';
import { runEngine } from '../../../core/loop';
import { resolveProfile } from '../../../core/resolveProfile';
import { GOAL_CAPABILITY, isProductionGoalEligible, type MetricId } from '../../../types/metrics';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import { compileRequest } from '../context';
import { resolveGoalCapability, resolveObjectiveShape, TARGET_BAND_REQUIRED } from '../capabilities';
import { goalTrajectory, goalTrajectoryBands, goalValueStatus, type GoalBinding } from '../goalSpecs';
import { EnginePlanModel } from '../model';
import { bandsOfSchedule } from '../evaluatorHost';
import { dailyBands } from '../planner';
import { safetyLimitProof, targetReach } from '../reach';
import type { RankedGoal } from '../types';
import { MAN_95, WOMAN_62, request } from './personas';

const binding: GoalBinding = { metric: 'bodyFatPct', functional: 'end', useTissueMass: false };
const tissueGoal: RankedGoal = {
  metric: 'bodyFatPct',
  direction: 'target',
  target: 24,
  endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT,
};
const ctx = compileRequest(request(MAN_95, [tissueGoal]));
const day: DayTemplate = {
  id: 'food',
  label: 'food',
  energy: { kind: 'kcal', kcal: 2300 },
  macros: {
    protein: { unit: 'g', value: 160 },
    carbs: { unit: 'g', value: 170 },
    fat: { unit: 'remainder' },
  },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  steps: 8000,
  sleep: { bedH: 23, wakeH: 7 },
};
const schedule: Schedule = {
  schemaVersion: 1,
  startDate: MAN_95.startDate!,
  horizonDays: 35,
  programs: [day],
  days: Array.from({ length: 35 }, () => ({ program: 0 })),
};
const rp = resolveProfile(MAN_95);
const compiled = compileSchedule(schedule, rp);
const options = {
  record: 'daily' as const,
  series: ['fatMass', 'leanTissue', 'bodyFatPct', 'scaleWeight'] as const,
  constraints: true,
};
const full = runEngine(rp, compiled, { ...options, captureSnapshotAt: [0, 14, 21] });

describe('A2-002 capability shapes share one resolver', () => {
  for (const metric of Object.keys(GOAL_CAPABILITY) as MetricId[]) {
    if (!isProductionGoalEligible(metric)) continue;
    const cap = GOAL_CAPABILITY[metric];
    for (const direction of ['minimise', 'maximise', 'target'] as const) {
      it(`${metric}/${direction} follows advertised objective and bounded satiation`, () => {
        const goal: RankedGoal = {
          metric,
          direction,
          ...(direction === 'target' || cap.satiation === 'required' ? { target: 1 } : {}),
          ...(metric === 'bodyFatPct' ? { endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT } : {}),
        };
        const resolved = resolveObjectiveShape(goal);
        expect(resolved.supported).toBe(cap.objectives.includes(resolved.direction));
        const compiled = compileRequest(request(MAN_95, [goal]));
        expect(compiled.goals.length).toBe(resolved.supported ? 1 : 0);
        if (!resolved.supported) expect(compiled.goalReviews?.[0]?.status).toBe('review');
      });
    }
    if (cap.satiation === 'required')
      it(`${metric} never accepts unbounded benefit`, () => {
        expect(TARGET_BAND_REQUIRED.has(metric)).toBe(true);
        expect(resolveObjectiveShape({ metric, direction: 'maximise' })).toMatchObject({
          supported: false,
          reasonCode: 'needsTargetBand',
        });
      });
  }
  it('BHB and total glycogen without targets cannot open fasting; supported goals and preference remain usable', () => {
    for (const metric of ['bhb', 'glycogenTotal'] as const) {
      const rejected = compileRequest(request(MAN_95, [{ metric, direction: 'maximise' }]));
      expect(rejected.goals).toHaveLength(0);
      expect(rejected.fastingRelevant).toBe(false);
      expect(
        compileRequest(request(MAN_95, [{ metric, direction: 'target', target: metric === 'bhb' ? 1 : 400 }]))
          .goals,
      ).toHaveLength(1);
    }
    const supported = compileRequest(
      request(MAN_95, [{ metric: 'strength', direction: 'maximise' }], {
        constraints: { prefersFasting: true },
      }),
    );
    expect(supported.goals).toHaveLength(1);
    expect(supported.fastingRelevant).toBe(true);
  });
  it('bounded mass gain/keep normalize once without rewriting the original request', () => {
    const goal: RankedGoal = {
      metric: 'scaleWeight',
      direction: 'maximise',
      target: 2,
      targetKind: 'change',
    };
    const compiled = compileRequest(request(MAN_95, [goal]));
    expect(compiled.goals[0]?.direction).toBe('target');
    expect(compiled.request.goals[0]).toBe(goal);
  });
});

describe('A2-024 endpoint intent survives review', () => {
  it('unstamped direct or saved BF stays Review even if the capability version is refreshed', () => {
    for (const goal of [
      { metric: 'bodyFatPct', direction: 'target', target: 20 },
      { ...tissueGoal, endpointSemantics: undefined },
    ]) {
      const compiled = compileRequest(
        request(MAN_95, [goal as RankedGoal, { metric: 'strength', direction: 'maximise' }]),
      );
      expect(compiled.goals.map((g) => g.metric)).toEqual(['strength']);
      expect(compiled.goalReviews?.[0]).toMatchObject({
        reasonCode: 'legacyEndpointBasis',
        status: 'review',
      });
      expect(compiled.request.goals[0]).toEqual(goal);
    }
    expect(resolveGoalCapability(tissueGoal).resolution).toBe('plan');
  });
});

describe('A2-008 run-bound absolute tissue trajectories', () => {
  it.each([14, 21])('snapshot day%d selects absolute today21, never a future sample', (snapDay) => {
    const cont = runEngine(rp, compiled, { ...options, initialSnapshot: full.snapshots![snapDay] });
    const a = goalTrajectory(full, binding, ctx);
    const b = goalTrajectory(cont, binding, ctx);
    expect(b.startDay).toBe(snapDay);
    expect(b.sample(21)).toBeCloseTo(a.sample(21)!, 5);
    expect(b.sample(snapDay - 1)).toBeNull();
    expect(b.sample(36)).toBeNull();
    expect(b.initial).toBeCloseTo(a.sample(snapDay)!, 5);
    if (snapDay === 14) expect(b.functionalAt(21)).toBeCloseTo(a.functionalAt(21)!, 5);
  });
  it('same-day tissue denominator and initial binding survive trend-profile and raw wake mutations', () => {
    const tr = goalTrajectory(full, binding, ctx);
    for (let d = 1; d <= 35; d++)
      expect(tr.sample(d)).toBeCloseTo(
        (100 * full.daily.fatMass![d - 1]!) / full.safety.tissueMassKg[d - 1]!,
        10,
      );
    const changed = {
      ...full,
      daily: { ...full.daily, bodyFatPct: Float32Array.from(full.daily.bodyFatPct!, (v) => v + 5) },
    };
    const changedCtx = compileRequest(
      request({ ...MAN_95, body: { ...MAN_95.body, weightKg: 93 } }, [tissueGoal]),
    );
    const other = goalTrajectory(changed, binding, changedCtx);
    expect(Array.from(other.values!)).toEqual(Array.from(tr.values!));
    expect(other.crossing(27.8, -1)).toBe(tr.crossing(27.8, -1));
    expect(other.functionalAt(35)).toBe(tr.functionalAt(35));
    expect(changed.daily.bodyFatPct![20]).not.toBe(full.daily.bodyFatPct![20]);
    expect(goalValueStatus(changed, binding, changedCtx).value).toBe(
      goalValueStatus(full, binding, ctx).value,
    );
  });
  it('bands reduce coherent tissue paths and use a separate goal key', () => {
    const changedWake = {
      ...full,
      daily: { ...full.daily, bodyFatPct: Float32Array.from(full.daily.bodyFatPct!, (v) => v + 5) },
    };
    const band = goalTrajectoryBands([full, changedWake], binding, ctx)!;
    const line = goalTrajectory(full, binding, ctx);
    expect(band.key).toBe(line.bandKey);
    expect(band.key).not.toBe('bodyFatPct');
    expect(Array.from(band.low)).toEqual(Array.from(line.values!));
    expect(Array.from(band.high)).toEqual(Array.from(line.values!));
  });
  it('real model band buffers transport coherent tissue paths without overwriting wake BF', () => {
    const model = new EnginePlanModel(ctx, {
      bindings: [binding],
      ensemble: { size: 2, seed: 42 },
      recordAll: true,
    });
    const actual = model.simulate(schedule, -1);
    const tr = goalTrajectory(actual, binding);
    const record = model.bandRecord(actual);
    const goal = record.get(tr.bandKey as `goal:${string}`)!;
    expect(goal).toBeDefined();
    expect(goal[21]).toBeCloseTo(tr.sample(21)!, 5);
    expect(record.get('bodyFatPct')![21]).toBe(actual.daily.bodyFatPct![20]);
    const raw = actual.daily.bodyFatPct!.slice();
    const buffers = bandsOfSchedule(model, schedule, 36, 2, [tr.bandKey]);
    const bands = dailyBands({ ...ctx, horizonDays: 35 }, actual, [tr.bandKey], buffers);
    expect(bands.series[tr.bandKey as `goal:${string}`]?.p10[21]).toBeGreaterThan(0);
    expect(actual.daily.bodyFatPct).toEqual(raw);
  });
  it('explicit time-to-target bindings use sampled crossing rather than the default END7 endpoint', () => {
    const tr = goalTrajectory(full, { ...binding, functional: 'ttt' }, ctx);
    expect(tr.functionalAt(21)).toBe(tr.sample(21));
  });
  it('missing actual binding abstains rather than borrowing a different context profile', () => {
    const missing = {
      ...full,
      safety: { ...full.safety, tissueMassKg: new Float32Array() },
      snapshots: undefined,
    };
    expect(goalTrajectory(missing, binding, ctx).available).toBe(false);
  });
});

describe('A2-009 exact policy implications', () => {
  it('FM10 / FFM67 / total77 is not refuted by fixed-initial-lean arithmetic', () => {
    const c = compileRequest(request(MAN_95, [{ metric: 'fatMass', direction: 'target', target: 10 }]));
    expect(safetyLimitProof(c, 0, 10)).toBeNull();
    expect(safetyLimitProof(c, 0, 0.1)).toBeNull();
  });
  it('every emitted BF proof implies the floor for every admitted FM/FFM state', () => {
    for (const fm of [0.1, 1, 10, 25])
      for (const ffm of [15, 40, 67, 100]) {
        const theta = (100 * fm) / (fm + ffm);
        const proof = safetyLimitProof(ctx, 0, theta);
        if (proof) {
          expect(theta).toBeLessThan(ctx.caps.bfFloorPct);
          expect(proof.unit).toBe('%');
        }
      }
    expect(safetyLimitProof(ctx, 0, ctx.caps.bfFloorPct - 1)?.id).toBe('HC-P5.bfFloor');
  });
  it('tissue weight proves only its exact BMI floor, never scale cumulative loss', () => {
    const c = compileRequest(request(MAN_95, [{ metric: 'scaleWeight', direction: 'target', target: 40 }]));
    const bound = 19 * c.rp.heightM ** 2;
    expect(safetyLimitProof(c, 0, bound - 1)?.id).toBe('HC-P4.bmi');
    expect(safetyLimitProof(c, 0, bound - 1)?.bound).toBeCloseTo(bound, 12);
    expect(safetyLimitProof(c, 0, bound + 1)).toBeNull();
  });
});

describe('A2-013 aspiration-independent route coverage', () => {
  it('bounded and targetless loss use the same route; stopped prefixes are explicit', () => {
    const base = request(WOMAN_62, [{ metric: 'fatMass', direction: 'minimise' }]);
    const directional = targetReach(base, 0)!;
    const aspirational = targetReach(
      { ...base, goals: [{ metric: 'fatMass', direction: 'minimise', target: -5, targetKind: 'change' }] },
      0,
    )!;
    expect(directional.requestedHorizonDays).toBe(112);
    expect(directional.coveredDays).toBe(aspirational.coveredDays);
    expect(directional.changeAtHorizon).toBeCloseTo(aspirational.changeAtHorizon, 8);
    expect(directional.completeHorizon).toBe(directional.coveredDays! >= 112);
  });
});

describe('A2-014 no drifting or nonfinite clinical intent', () => {
  it('fresh clinical preview binds its actual initial baseline without activating old relative intent', () => {
    for (const metric of ['sbp', 'fastingGlucose', 'glucose'] as const) {
      const baseline = metric === 'sbp' ? 140 : 5.6;
      const delta = metric === 'sbp' ? -5 : -0.3;
      const original: RankedGoal = { metric, direction: 'target', target: delta, targetKind: 'change', targetOrigin: { kind: 'change', delta, baseline } };
      const compiled = compileRequest(request(MAN_95, [original]));
      expect(compiled.goals[0]?.spec).toMatchObject({ target: baseline + delta, targetKind: 'absolute' });
      expect(compiled.request.goals[0]).toBe(original);
      expect(original.targetKind).toBe('change');
      const mismatch = compileRequest(request(MAN_95, [{ ...original, targetOrigin: { kind: 'change', delta: delta - 1, baseline } }]));
      expect(mismatch.goals).toHaveLength(0);
    }
  });
  it('unresolved clinical changes remain review while absolute clinical and unrelated goals compile', () => {
    const relative: RankedGoal = { metric: 'sbp', direction: 'target', target: -5, targetKind: 'change' };
    const c = compileRequest(
      request({ ...MAN_95, labs: { sbpMmHg: 140 } }, [
        relative,
        { metric: 'strength', direction: 'maximise' },
      ]),
    );
    expect(c.goals.map((g) => g.metric)).toEqual(['strength']);
    expect(c.goalReviews?.[0]?.reasonCode).toBe('needsAbsoluteTarget');
    expect(c.request.goals[0]).toBe(relative);
    expect(
      compileRequest(
        request(MAN_95, [{ metric: 'sbp', direction: 'target', target: 135, targetKind: 'absolute' }]),
      ).goals,
    ).toHaveLength(1);
  });
});
