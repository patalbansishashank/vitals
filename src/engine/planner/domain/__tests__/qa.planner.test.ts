// @vitest-environment node
/**
 * QA findings PLN-03, PLN-04 and LIV-13 (planner part), fast checks on the domain layer:
 * - PLN-04: a diet break (B8, "Maintenance break") is at maintenance energy on every decoded and repaired plan, ordinary
 *   and Ideal (no multi-day fast or its recovery days inside it).
 * - PLN-03: the Ideal's warm start reproduces Hard's plan (its relaxed-only genes set to Hard's own sleep, clock and
 *   modality), and the Ideal falls back to Hard when its best is lexicographically worse.
 * - LIV-13: creatine is prescribed only with the person's supplement opt-in, in the ordinary plans and in the Ideal.
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '../../../core/compileSchedule';
import { Rng } from '../../optim/rng';
import { compileRequest, type PlanningContext } from '../context';
import { decodePlan } from '../decode';
import { alignRelaxedGenes, lexicographicallyWorse } from '../ladderPlanner';
import { idealRequest, relaxGroup } from '../limits';
import { repairSchedule } from '../repair';
import { enumerateStructures, makeStructure, transferGenome, type SkeletonStructure } from '../skeleton';
import type { PlannerRequest } from '../types';
import { GOLDEN } from './golden.requests';

function run(ctx: PlanningContext, st: SkeletonStructure, x: ArrayLike<number>) {
  const plan = decodePlan(ctx, st, x);
  const { schedule } = repairSchedule(ctx, plan.schedule, plan);
  return { plan, schedule };
}

const hasB8 = (st: SkeletonStructure) => st.skeleton.segments.some((s) => s.kind === 'cycle' && s.off === 'B8');

describe('PLN-04: a diet break is at maintenance', () => {
  // golden d: 24-72-h fasts opted in, so multi-day fasts compete with the diet breaks for days
  const cases: Array<[string, PlannerRequest]> = [
    ['d', GOLDEN.d],
    ['d Ideal', idealRequest(GOLDEN.d).request],
    ['a Ideal', idealRequest(GOLDEN.a).request],
  ];
  for (const [name, req] of cases)
    it(`${name}: every B8 stretch plans intake = maintenance (no fast inside it)`, () => {
      const ctx = compileRequest(req);
      const rng = new Rng(4042);
      const sts = enumerateStructures(ctx).filter(hasB8);
      let checked = 0;
      for (const st of sts) {
        const xs = [Float64Array.from(st.x0), ...Array.from({ length: 3 }, () => Float64Array.from({ length: st.dim }, () => rng.float()))];
        for (const x of xs) {
          const { plan, schedule } = run(ctx, st, x);
          const days = compileSchedule(schedule, ctx.rp).days;
          for (const ph of plan.phases) {
            if (ph.blockId !== 'B8') continue;
            let bal = 0;
            let maint = 0;
            for (let d = ph.startDay; d < ph.endDay; d++) {
              bal += days[d]!.plannedBalanceKcal ?? 0;
              maint += days[d]!.maintenanceKcal;
              expect(days[d]!.zeroIntake, `${st.id} day ${d}`).toBeFalsy();
            }
            // ≈ maintenance: within 2 % of the stretch's maintenance (rounding of meals and macros)
            expect(Math.abs(bal), `${st.id} B8 days ${ph.startDay}-${ph.endDay}`).toBeLessThanOrEqual(0.02 * maint);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(20);
    }, 300_000);
});

describe('PLN-03: the Ideal is never below Hard', () => {
  it('lexicographicallyWorse: the first goal beyond its quantum decides', () => {
    expect(lexicographicallyWorse([-0.3, 5], [0.1, 0.1])).toBe(true);
    expect(lexicographicallyWorse([0.3, -5], [0.1, 0.1])).toBe(false);
    expect(lexicographicallyWorse([-0.05, -2], [0.1, 0.1])).toBe(true);
    expect(lexicographicallyWorse([-0.05, 0.05], [0.1, 0.1])).toBe(false);
    expect(lexicographicallyWorse([0, 0, 0], [0, 0, 0])).toBe(false);
  });

  // golden c sets a training clock and a modality the Ideal turns into genes; a 6-h sleeper gets the sleep genes' floor
  const reqs: Array<[string, PlannerRequest]> = [
    ['c', GOLDEN.c],
    ['a', GOLDEN.a],
    ['a, 7.5-h sleeper', { ...GOLDEN.a, profile: { ...GOLDEN.a.profile, habits: { ...GOLDEN.a.profile.habits, bedTimeH: 23.5, wakeTimeH: 7 } } }],
  ];
  for (const [name, req] of reqs)
    it(`${name}: Hard's genome mapped into the Ideal's gene space decodes to Hard's sleep, clock and modality`, () => {
      const ctx = compileRequest(req);
      const variants: Array<[string, PlannerRequest]> = [
        ['ideal', idealRequest(req).request],
        ['sleep', relaxGroup(req, 'sleep')],
        ['sessionTime', relaxGroup(req, 'sessionTime')],
        ['cardio', relaxGroup(req, 'cardio')],
      ];
      const rng = new Rng(77);
      const sts = enumerateStructures(ctx).filter((s) => !s.skeleton.baseline && !s.skeleton.sleepExtension).slice(0, 30);
      for (const [vName, vReq] of variants) {
        const ctxI = compileRequest(vReq);
        for (const st of sts) {
          const stI = makeStructure(ctxI, st.skeleton);
          const x = Float64Array.from({ length: st.dim }, () => rng.float());
          const hard = run(ctx, st, x).plan.lifestyle;
          const y = alignRelaxedGenes(ctx, st, x, ctxI, stI, transferGenome(st, stI, x));
          const ideal = run(ctxI, stI, y).plan.lifestyle;
          const sleepH = ((hard.wakeH - hard.bedH + 24) % 24) || 24;
          const tag = `${vName} ${st.id}`;
          if (sleepH >= 7 && sleepH <= 8.5) {
            expect(ideal.bedH, tag).toBeCloseTo(hard.bedH, 6);
            expect(ideal.wakeH, tag).toBeCloseTo(hard.wakeH, 6);
          }
          expect(ideal.cardioModality, tag).toBe(hard.cardioModality);
          // the same eating window unless Hard's first meal is < 30 min after waking (the Ideal's meal-timing rule, §2.2)
          if (hard.windowStartH >= hard.wakeH + 0.5) expect(ideal.windowStartH, tag).toBeCloseTo(hard.windowStartH, 6);
          if (hard.rtSessions + hard.cardioSessions > 0 && ideal.wakeH === hard.wakeH && ideal.windowStartH === hard.windowStartH) expect(ideal.trainingStartH, tag).toBeCloseTo(hard.trainingStartH, 6);
          expect(ideal.steps, tag).toBeCloseTo(hard.steps, 3);
        }
      }
    }, 300_000);
});

describe('LIV-13: creatine only with the supplement opt-in', () => {
  const creatineDays = (ctx: PlanningContext, st: SkeletonStructure, x: ArrayLike<number>) =>
    run(ctx, st, x).schedule.programs.filter((p) => (p.substances?.creatineG ?? 0) > 0).length;

  // golden a and e rank a muscle goal with resistance training: creatine is a candidate when consented
  for (const key of ['a', 'e'] as const) {
    it(`${key}: no creatine structure or dose without the opt-in, in the plans and in the Ideal`, () => {
      for (const req of [GOLDEN[key], idealRequest(GOLDEN[key]).request]) {
        const ctx = compileRequest(req);
        const sts = enumerateStructures(ctx);
        expect(sts.some((s) => s.skeleton.creatine)).toBe(false);
      }
      const consent: PlannerRequest = { ...GOLDEN[key], safety: { ...(GOLDEN[key].safety ?? {}), optIns: { ...(GOLDEN[key].safety?.optIns ?? {}), levers: ['creatine'] } } };
      for (const req of [consent, idealRequest(consent).request]) {
        const ctx = compileRequest(req);
        const st = enumerateStructures(ctx).find((s) => s.skeleton.creatine);
        expect(st, 'creatine offered with the opt-in').toBeDefined();
        expect(creatineDays(ctx, st!, st!.x0)).toBeGreaterThan(0);
        // the same plan without the opt-in: repair removes the dose
        const ctxNo = compileRequest(key === 'a' ? GOLDEN.a : GOLDEN.e);
        expect(creatineDays(ctxNo, st!, st!.x0)).toBe(0);
      }
    }, 120_000);
  }

  it('the Ideal keeps a refused supplement refused (consent), and clears refused fasting options', () => {
    const req: PlannerRequest = { ...GOLDEN.a, constraints: { ...GOLDEN.a.constraints, excludedLevers: ['creatine', 'refeedDay', 'L8'] } };
    const ex = idealRequest(req).request.constraints?.excludedLevers ?? [];
    expect([...ex].sort()).toEqual(['L8', 'creatine']);
    expect(relaxGroup(req, 'fasting').constraints?.excludedLevers).toEqual(['creatine', 'L8']);
  });
});
