// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SimulationResult } from '../../../types/result';
import { compileRequest } from '../context';
import { simulate } from '../../../simulate';
import {
  MARGIN_IDS,
  MUSCLE_RETENTION_MARGIN_INDEX,
  EnginePlanModel,
  stateMargins,
  missingStateMargins,
} from '../model';
import type { Schedule } from '../../../types/schedule';
import { idealRequest } from '../limits';
import {
  freezeMuscleRetention,
  muscleRetentionProblems,
  reviewMuscleRetention,
  type MuscleRetentionBudget,
} from '../muscleRetention';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from './personas';

const budget: MuscleRetentionBudget = {
  maxLossPct: 5,
  baseline: { kg: 30, date: '2026-11-06', basis: 'modelSkeletalMuscle' },
};
function trajectory(
  values: number[],
  status?: 'unknown' | 'scenario',
  fromDay = 0,
): Pick<SimulationResult, 'daily' | 'meta'> {
  return {
    daily: { skeletalMuscle: Float32Array.from(values) },
    meta: { outputStatus: status ? { skeletalMuscle: { status, fromDay, reasonCode: 'test' } } : {} },
  } as Pick<SimulationResult, 'daily' | 'meta'>;
}

describe('whole-plan modeled muscle retention', () => {
  it('rejects an interim breach even when muscle subsequently regains', () => {
    expect(reviewMuscleRetention(budget, trajectory([30, 28.4, 29.5])).status).toBe('overBudget');
    expect(reviewMuscleRetention(budget, trajectory([30, 29, 28.5])).status).toBe('withinBudget');
  });

  it('evaluates the selected percentage: the same 3% loss passes 5% and fails 2%', () => {
    const samePath = trajectory([30, 29.1, 29.4]);
    expect(reviewMuscleRetention({ ...budget, maxLossPct: 5 }, samePath).status).toBe('withinBudget');
    expect(reviewMuscleRetention({ ...budget, maxLossPct: 2 }, samePath).status).toBe('overBudget');
  });

  it('never treats missing, partial or unsupported predictions as staying within the budget', () => {
    for (const values of [[], [30, NaN], [30, 0]])
      expect(reviewMuscleRetention(budget, trajectory(values)).status).toBe('unavailable');
    expect(reviewMuscleRetention(budget, trajectory([30, 29], 'unknown')).status).toBe('unavailable');
    expect(reviewMuscleRetention(budget, trajectory([30, 29], 'scenario')).status).toBe('withinBudget');
    expect(reviewMuscleRetention(budget, trajectory([30, 29], 'unknown', 10)).status).toBe('withinBudget');
  });

  it('freezes the model baseline once and does not renew the budget as weight falls', () => {
    const original = request(MAN_95, FAT_LOSS_KEEP_LEAN, {
      constraints: { muscleRetention: { maxLossPct: 5 } },
    });
    const frozen = freezeMuscleRetention(original);
    const next = freezeMuscleRetention({
      ...frozen,
      profile: { ...frozen.profile, body: { ...frozen.profile.body, weightKg: 75 } },
      startDate: '2027-01-01',
    });
    expect(next.constraints?.muscleRetention).toEqual(frozen.constraints?.muscleRetention);
    expect(original.constraints?.muscleRetention).not.toHaveProperty('baseline');
    expect(compileRequest(next).request.constraints?.muscleRetention).toEqual(
      frozen.constraints?.muscleRetention,
    );
  });

  it('does not let the Ideal silently relax a muscle-loss budget', () => {
    const req = freezeMuscleRetention(
      request(MAN_95, FAT_LOSS_KEEP_LEAN, { constraints: { muscleRetention: { maxLossPct: 5 } } }),
    );
    expect(idealRequest(req).request.constraints?.muscleRetention).toEqual(req.constraints?.muscleRetention);
  });

  it('rejects invalid budgets instead of clamping them into an apparently satisfied limit', () => {
    for (const maxLossPct of [-1, 100, NaN, Infinity])
      expect(muscleRetentionProblems({ ...budget, maxLossPct })).not.toHaveLength(0);
    expect(muscleRetentionProblems({ ...budget, baseline: { ...budget.baseline!, kg: 0 } })).not.toHaveLength(
      0,
    );
    expect(muscleRetentionProblems(null)).toEqual([]);
  });

  it('enforces the budget on an actual coupled engine run and records its required output', () => {
    const req = request(MAN_95, [{ metric: 'fatMass', direction: 'minimise' }], {
      horizonDays: 28,
      constraints: { muscleRetention: { maxLossPct: 0 } },
    });
    const ctx = compileRequest(req);
    const schedule: Schedule = {
      schemaVersion: 1,
      startDate: '2026-11-06',
      horizonDays: 28,
      programs: [
        {
          id: 'cut',
          label: 'cut',
          energy: { kind: 'kcal', kcal: 1500 },
          macros: {
            protein: { unit: 'g', value: 125 },
            carbs: { unit: 'pctEnergy', value: 45 },
            fat: { unit: 'remainder' },
          },
          steps: 7000,
        },
      ],
      days: Array.from({ length: 28 }, () => ({ program: 0 })),
    };
    const sim = simulate(ctx.rp, schedule, { record: 'daily', checks: true });
    expect(stateMargins(ctx, sim, schedule)[MUSCLE_RETENTION_MARGIN_INDEX]).toBeLessThan(0);
    const stripped = { ...sim, daily: { ...sim.daily, skeletalMuscle: new Float32Array() } };
    expect(missingStateMargins(stripped, ctx)).toContain(MUSCLE_RETENTION_MARGIN_INDEX);
    expect(stateMargins(ctx, stripped, schedule)[MUSCLE_RETENTION_MARGIN_INDEX]).toBeLessThan(0);
    expect(MARGIN_IDS[MUSCLE_RETENTION_MARGIN_INDEX]).toBe('userMuscleRetention');
    const model = new EnginePlanModel(ctx, {
      bindings: [{ metric: 'fatMass', functional: 'end', useTissueMass: false }],
    });
    const output = model.simulate(schedule, -1);
    expect(output.daily.skeletalMuscle?.length).toBe(28);
  });
});
