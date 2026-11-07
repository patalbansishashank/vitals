// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ClinicalNutritionEnvelope, ConstraintDef } from '@/lib/bodyContracts';
import { renalSafetyFlags, resolveRenalScope } from '@/lib/renalScope';
import type { SafetyFlags } from '../../../types/profile';
import type { Schedule } from '../../../types/schedule';
import { compileRequest } from '../context';
import { baselineSchedule, decodePlan } from '../decode';
import { finalSubjectCertificate } from '../evaluatorHost';
import { idealRequest } from '../limits';
import { repairSchedule } from '../repair';
import { replan, replanSafetySubject } from '../replan';
import { makePlan, confirmedState, logsAsPlanned, replanRequest } from './replan.fixtures';
import { enumerateStructures } from '../skeleton';
import { evaluatePlanSafety, optionSafetyOf, revalidatePlanSafety } from '../safetyAudit';
import type { PlannerRequestV2 } from '../types';
import { MAN_95, request } from './personas';

const TODAY = '2026-10-05';
const bound = (o: Partial<ConstraintDef> = {}): ConstraintDef => ({ id: 'protein-order', quantity: 'proteinPerKg', unit: 'g/kg/d', comparator: 'cap', value: 1, basis: 'actual', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'clinician', ref: 'source-document' }, policyVersion: 1, ...o });
const envelope = (bounds: ConstraintDef[] = [bound()], o: Partial<ClinicalNutritionEnvelope> = {}): ClinicalNutritionEnvelope => ({ id: 'clinical', condition: 'ckd', dialysis: 'none', stability: 'stable', weightBasis: 'actual', bounds, assessedAt: '2026-09-01', source: 'document', ...o });
const req = (flags: SafetyFlags = {}, habitual?: number) => request({ ...MAN_95, habits: { ...MAN_95.habits, sessionsPerWeek: 0, ...(habitual !== undefined ? { habitualProteinGPerKg: habitual / 95 } : {}) }, safety: { mode: 'M0', flags } }, [{ metric: 'fatMass', direction: 'minimise' }], { horizonDays: 28 });
const schedule = (_r: ReturnType<typeof req>, protein: number, pct = 100): Schedule => ({ schemaVersion: 1, startDate: TODAY, horizonDays: 28, programs: [{ id: 'fixed', label: 'Fixed', energy: { kind: 'pctMaintenance', pct, reference: 'baseline' }, macros: { protein: { unit: 'g', value: protein }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: 70 }, fibre: { unit: 'g', value: 30 } }, meals: { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' }, steps: 6000 }], days: Array.from({ length: 28 }, () => ({ program: 0 })), defaults: { energyReference: 'baseline' } });
const evaluate = (r: ReturnType<typeof req>, protein: number, pct = 100) => evaluatePlanSafety(compileRequest(r), schedule(r, protein, pct));
const entered = (env: ClinicalNutritionEnvelope) => ({ kidneyDisease: true, nutritionEnvelopes: [env] });

function finalProvider(r: ReturnType<typeof req>, s: Schedule) {
  const result = finalSubjectCertificate({ request: r, schedule: s, episodeId: 'w23-renal', createdAt: TODAY });
  expect(result.certificate).not.toBeNull();
  return { certificate: result.certificate!, lifecycle: revalidatePlanSafety(r, s, { boundary: 'start', certificate: result.certificate }) };
}

describe('A2-003 final protein conjunction and scope-specific conflicts', () => {
  it('retains the 95 g actual cap and 106.92 g deficit floor through final provider and lifecycle', () => {
    const r = req(entered(envelope()));
    const e = evaluate(r, 95, 85);
    const conflict = e.conflicts.find((c) => c.floor.id === 'HC-M1.deficit');
    expect(conflict?.cap.value).toBe(95);
    expect(conflict?.floor.value).toBeCloseTo(106.92, 8);
    expect(conflict?.cap.source.ref).toBe('source-document');
    expect(e.evaluations.some((v) => v.constraintId === 'HC-M1.deficit' && v.status === 'violation')).toBe(true);
    const s = schedule(r, 95, 85);
    const { certificate, lifecycle } = finalProvider(r, s);
    expect(certificate.audit.M).toBe(16);
    expect(certificate.audit.status).toBe('pass');
    expect(certificate.status).not.toBe('verified');
    expect(lifecycle.startable).toBe(false);
    expect(optionSafetyOf(e, { audit: certificate.audit, certificate }).status).not.toBe('verified');
  }, 120_000);

  it('maintenance excludes only the deficit floor and retains the entered cap and general floor', () => {
    const r = req(entered(envelope()));
    const e = evaluate(r, 90);
    expect(e.conflicts).toEqual([]);
    expect(e.evaluations.some((v) => v.constraintId === 'HC-M1' && v.status === 'pass')).toBe(true);
    expect(e.evaluations.some((v) => v.constraintId === 'protein-order' && v.status === 'pass')).toBe(true);
    expect(e.status).toBe('verified');
    expect(evaluate(r, 100).status).toBe('violation');
  });

  it('a high clinical cap and no renal context both preserve usable maintenance', () => {
    expect(evaluate(req(entered(envelope([bound({ value: 2 })]))), 120).status).toBe('verified');
    expect(evaluate(req(), 120).status).toBe('verified');
  });

  it('clinical floor/cap contradiction preserves both sources and the known violation', () => {
    const r = req(entered(envelope([bound(), bound({ id: 'other-floor', comparator: 'floor', value: 110, quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', source: { kind: 'clinician', ref: 'second-source' } })])));
    const e = evaluate(r, 100);
    expect(e.conflicts.some((c) => c.cap.source.ref === 'source-document' && c.floor.source.ref === 'second-source')).toBe(true);
    expect(e.evaluations.some((v) => v.constraintId === 'protein-order' && v.status === 'violation')).toBe(true);
    expect(e.status).toBe('violation');
  });
});

describe('A2-004 per-domain authority and documented routine', () => {
  it('keeps the population prior finite and conditional, never an exact renal routine or verified authority', () => {
    const r = req({ kidneyDisease: true });
    const ctx = compileRequest(r);
    expect(Number.isFinite(ctx.rp.habitualProteinG)).toBe(true);
    expect(ctx.caps.renal.habitualProteinG).toBeNull();
    expect(ctx.caps.renal.heldProteinGPerKgRw).toBeNull();
    const s = repairSchedule(ctx, baselineSchedule(ctx)).schedule;
    const e = evaluatePlanSafety(ctx, s);
    expect(e.review.some((v) => v.reason === 'habitualProteinUndocumented')).toBe(true);
    const { certificate, lifecycle } = finalProvider(r, s);
    expect(certificate.audit.M).toBe(16);
    expect(certificate.audit.status).toBe('pass');
    expect(certificate.status).not.toBe('verified');
    expect(lifecycle.startable).toBe(false);
    expect(ctx.caps.exercise.allowed).toBe(true);
  }, 120_000);

  it('empty bounds preserve the raw 57 g estimate rather than the general 71.28 g floor', () => {
    const r = req(entered(envelope([])), 57);
    const ctx = compileRequest(r);
    const repaired = repairSchedule(ctx, schedule(r, 57)).schedule;
    expect(repaired.programs[0]!.macros.protein).toEqual({ unit: 'g', value: 57 });
    expect(ctx.caps.renal.habitualProteinG).toBeCloseTo(57, 10);
    const e = evaluatePlanSafety(ctx, repaired);
    expect(e.evaluations.some((v) => v.constraintId === 'HC-M1' && v.status === 'violation')).toBe(true);
  });

  it('protein-only guidance withholds sodium/fluid/electrolytes across decoder, Ideal and repair', () => {
    const r = req(entered(envelope([bound({ value: 2 })])), 120);
    r.profile.habits = { ...r.profile.habits, habitualSodiumG: 1 };
    for (const candidate of [r, idealRequest(r).request]) {
      const ctx = compileRequest(candidate);
      expect(ctx.caps.renal.withheld).toEqual(['sodium', 'potassium', 'fluid']);
      for (const st of enumerateStructures(ctx, 30)) {
        const decoded = decodePlan(ctx, st, new Float64Array(st.dim).fill(0.5));
        const fixed = repairSchedule(ctx, decoded.schedule, decoded).schedule;
        for (const t of [...fixed.programs, ...fixed.days.map((d) => d.override).filter(Boolean)]) {
          expect(t?.hydration?.sodiumG).toBeUndefined();
          expect(t?.hydration?.fluidL).toBeUndefined();
          expect(t?.hydration?.electrolytes).toBeUndefined();
        }
      }
      const injected = schedule(r, 120);
      injected.programs[0]!.hydration = { sodiumG: 2.5, fluidL: 2.5, electrolytes: true };
      expect(evaluatePlanSafety(ctx, injected).review.some((v) => v.id === 'renal.hydration.authority')).toBe(true);
      expect(repairSchedule(ctx, injected).schedule.programs[0]!.hydration).toBeUndefined();
    }
  });

  it('sodium-only and notApplicable protein bounds never authorize protein', () => {
    const env = envelope([bound({ quantity: 'sodiumPerDay', unit: 'mg/d', basis: 'notApplicable', value: 2000 }), bound({ applicability: 'notApplicable', value: 0.5 })]);
    const ctx = compileRequest(req(entered(env)));
    expect(ctx.caps.renal.withheld).toContain('protein');
    expect(ctx.caps.renal.proteinGPerDay).toBeNull();
    expect(ctx.caps.proteinCapRw).toBe(Infinity);
  });

  it('a documented sufficient routine remains usable while other domains stay withheld', () => {
    const r = req({ kidneyDisease: true }, 120);
    expect(evaluate(r, 120).status).toBe('verified');
    expect(evaluate(r, 125).review.some((v) => v.reason === 'changedWithoutAuthority')).toBe(true);
  });
});

describe('A2-005 current dated applicability at compile and lifecycle boundaries', () => {
  const flagsFor = (date: string, assessedAt = '2026-09-01') => renalSafetyFlags(resolveRenalScope({ flags: ['kidney-disease'], envelopes: [envelope([bound({ value: 2 })], { assessedAt })], today: TODAY, medicationChanges: [{ id: 'antihypertensive', medicationClass: 'antihypertensive', date }] }));
  it('a relevant post-assessment change withholds new protein despite a fresh real model audit', () => {
    const r = req(flagsFor('2026-09-15'), 108.3758);
    expect(compileRequest(r).caps.renal.withheld).toContain('protein');
    expect(evaluate(r, 123.5).review.some((v) => v.reason?.includes('medicationChanged'))).toBe(true);
    const { certificate, lifecycle } = finalProvider(r, schedule(r, 123.5));
    expect(certificate.status).not.toBe('verified');
    expect(lifecycle.startable).toBe(false);
    expect(evaluate(r, 108.3758).status).toBe('verified');
  }, 120_000);
  it('the actual weekly replan retains scoped review after current medication evidence changes', async () => {
    const original = req(entered(envelope([bound({ value: 2 })])), 108.3758);
    const fx = makePlan({ request: original as PlannerRequestV2, pick: (st) => /^B1(\[|$)/.test(st.id) });
    const state = confirmedState(fx.plan, 7);
    const current = { mode: 'M0' as const, flags: flagsFor('2026-09-15') };
    const result = await replan(replanRequest(fx.plan, state, 10, 'weekly', { logs: logsAsPlanned(fx.plan, 7, 10), currentSafety: { profileSafety: current } }), { totalEU: 60 });
    expect(result.safety).toBeDefined();
    expect(result.safety!.status).not.toBe('verified');
    const consumer = { ...result.plan, request: { ...result.plan.request, profile: { ...result.plan.request.profile, safety: current } } };
    const subject = replanSafetySubject(consumer, '2026-10-15');
    const checked = revalidatePlanSafety(subject.request, subject.schedule, { boundary: 'adopt', certificate: result.safety!.certificate });
    expect(checked.startable).toBe(false);
    for (const t of result.plan.schedule.programs) {
      expect(t.hydration?.sodiumG).toBeUndefined();
      expect(t.hydration?.fluidL).toBeUndefined();
    }
  }, 120_000);
  it('pre-assessment and future changes preserve authority and later reassessment restores it', () => {
    for (const [changed, assessed] of [['2026-08-01', '2026-09-01'], ['2026-11-01', '2026-09-01'], ['2026-09-15', '2026-09-20']]) expect(evaluate(req(flagsFor(changed!, assessed!)), 123.5).status).toBe('verified');
  });
  it('preserves obsolete guidance history while a later applicable reassessment restores covered authority', () => {
    const prior = envelope([bound({ value: 1.5 })]);
    const later = envelope([bound({ id: 'reviewed-order', value: 2 })], { id: 'reviewed', assessedAt: '2026-09-20' });
    const scope = resolveRenalScope({ flags: ['kidney-disease'], envelopes: [prior, later], today: TODAY, medicationChanges: [{ id: 'antihypertensive', medicationClass: 'antihypertensive', date: '2026-09-15' }] });
    const r = req(renalSafetyFlags(scope));
    expect(compileRequest(r).caps.renal.clinical.envelopes).toHaveLength(2);
    expect(evaluate(r, 123.5).status).toBe('verified');
  });
  it.each(['illness', 'finding'] as const)('new %s scopes review without suspending independent activity or routine', (kind) => {
    const scope = resolveRenalScope({ flags: ['kidney-disease'], envelopes: [envelope([bound({ value: 2 })])], today: TODAY, ...(kind === 'illness' ? { recentIllnessAt: '2026-09-15' } : { findings: [{ kind: 'clinicianLevel' as const, source: 'potassium', ref: 'new', date: '2026-09-15' }] }) });
    const r = req(renalSafetyFlags(scope), 120);
    expect(evaluate(r, 123.5).status).not.toBe('verified');
    expect(evaluate(r, 120).status).toBe('verified');
    expect(compileRequest(r).caps.exercise.allowed).toBe(true);
  });
});

describe('A2-006 canonical envelope validation before per-kg arithmetic', () => {
  it.each([
    { unit: 'mg/d' }, { value: Number.NaN }, { value: -1 }, { value: undefined }, { basis: 'dry' }, { window: { kind: 'weekly' } }, { window: { kind: 'rolling', days: 0 } },
  ])('retains invalid original mandatory requirement %j', (bad) => {
    const raw = bound(bad as Partial<ConstraintDef>);
    const r = req(entered(envelope([raw])));
    const ctx = compileRequest(r);
    expect(ctx.caps.constraints.rejected.some((v) => v.def === raw)).toBe(true);
    const e = evaluate(r, 120);
    expect(e.rejected.some((v) => v.constraintId === raw.id && v.unit === raw.unit)).toBe(true);
    expect(e.status).not.toBe('verified');
    expect(revalidatePlanSafety(r, schedule(r, 120), { boundary: 'replan' }).startable).toBe(false);
  });
  it('an invalid sibling cannot erase a known valid clinical cap violation', () => {
    const r = req(entered(envelope([bound({ quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', value: 100 }), bound({ id: 'invalid-fluid', quantity: 'fluidPerDay', unit: 'mg/d', basis: 'notApplicable', value: 2000 })])));
    const e = evaluate(r, 108.3758);
    expect(e.evaluations.find((v) => v.constraintId === 'protein-order')?.status).toBe('violation');
    expect(e.rejected.some((v) => v.constraintId === 'invalid-fluid')).toBe(true);
    expect(e.status).toBe('violation');
  });
  it('optional unrelated malformed guidance never blocks independent supported use', () => {
    const r = req({ nutritionEnvelopes: [envelope([bound({ id: 'optional-unknown', quantity: 'unknown' as ConstraintDef['quantity'], mandatory: false })], { condition: 'other' })] });
    expect(evaluate(r, 120).rejected).toHaveLength(1);
    expect(evaluate(r, 120).status).toBe('verified');
  });
  it('the actual final provider refuses malformed mandatory protein across ordinary and Ideal requests', () => {
    const original = req(entered(envelope([bound({ unit: 'mg/d' })])));
    for (const r of [original, idealRequest(original).request]) {
      const { certificate, lifecycle } = finalProvider(r, schedule(r, 120));
      expect(certificate.status).not.toBe('verified');
      expect(lifecycle.startable).toBe(false);
    }
  }, 120_000);
  it('retains unresolved applicability and does not enforce notApplicable 0.5 actual cap', () => {
    const r = req(entered(envelope([bound({ applicability: 'notApplicable', value: 0.5 })])));
    expect(compileRequest(r).caps.renal.proteinGPerDay).toBeNull();
    expect(compileRequest(r).caps.proteinCapRw).toBe(Infinity);
    const unresolved = req(entered(envelope([bound({ applicability: 'unresolved' })])));
    expect(evaluate(unresolved, 120).status).not.toBe('verified');
  });
  it.each(['actual', 'clinicianEntered'] as const)('converts exact clinician-entered %s kg without RW substitution', (basis) => {
    const env = envelope([bound({ value: 1.1, basis })], { weightBasis: basis, basisWeightKg: 72.3, basisWeightOn: '2026-08-29', basisWeightKind: 'dry' });
    const ctx = compileRequest(req(entered(env)));
    const clinical = ctx.caps.renal.clinical.bounds[0]!;
    expect(clinical.perDay).toMatchObject({ value: 1.1 * 72.3, basisKg: 72.3, basisOn: '2026-08-29' });
    expect(clinical.def).toEqual(env.bounds[0]);
    expect(clinical.normalized?.value).toBe(1.1 * 72.3);
  });
  it('an unsupported protein scope/window neither changes the schedule nor supplies domain authority', () => {
    for (const extra of [{ scope: 'plannedAddition' as const }, { window: { kind: 'event' as const } }]) {
      const r = req(entered(envelope([bound({ value: 0.5, ...extra })])));
      const ctx = compileRequest(r);
      expect(ctx.caps.renal.withheld).toContain('protein');
      expect(ctx.caps.renal.proteinGPerDay).toBeNull();
      expect(evaluate(r, 120).status).not.toBe('verified');
    }
  });
  it('day cap catches a high day while a seven-day mean keeps its declared window', () => {
    const order = bound({ quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', value: 120 });
    const rDay = req(entered(envelope([order])));
    const rRolling = req(entered(envelope([{ ...order, window: { kind: 'rolling', days: 7 } }])));
    const s = schedule(rDay, 110);
    s.days[3]!.override = { macros: { ...s.programs[0]!.macros, protein: { unit: 'g', value: 140 } } };
    expect(evaluatePlanSafety(compileRequest(rDay), s).evaluations.find((v) => v.constraintId === order.id)?.status).toBe('violation');
    expect(evaluatePlanSafety(compileRequest(rRolling), s).evaluations.find((v) => v.constraintId === order.id)?.status).toBe('pass');
  });
});

describe('A2-007 generic clinical guidance intersects without declaring CKD', () => {
  it('other-condition 100 g/day cap checks original 108.3758 g and a repaired alternative', () => {
    const r = req({ nutritionEnvelopes: [envelope([bound({ quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', value: 100 })], { condition: 'other', dialysis: undefined })] });
    const ctx = compileRequest(r);
    expect(ctx.caps.renal.context).toBe('none');
    expect(evaluate(r, 108.3758).evaluations.find((v) => v.constraintId === 'protein-order')?.status).toBe('violation');
    const fixed = repairSchedule(ctx, schedule(r, 108.3758)).schedule;
    expect(evaluatePlanSafety(ctx, fixed).evaluations.find((v) => v.constraintId === 'protein-order')?.status).toBe('pass');
  });
  it('other-condition unsupported fluid remains mandatory unchecked alongside a known protein violation', () => {
    const env = envelope([bound({ quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', value: 100 }), bound({ id: 'fluid', quantity: 'fluidPerDay', unit: 'mL/d', basis: 'notApplicable', value: 2000 })], { condition: 'other', dialysis: undefined });
    const r = req({ nutritionEnvelopes: [env] });
    const e = evaluate(r, 108.3758);
    expect(e.evaluations.find((v) => v.constraintId === 'fluid')).toMatchObject({ status: 'unchecked', mandatory: true, capability: 'unsupported' });
    expect(e.status).toBe('violation');
  });
  it('mixed CKD/other conflicts are order independent and withdrawal preserves source history', () => {
    const ckd = envelope([bound({ quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', value: 100 })]);
    const other = envelope([bound({ id: 'other-floor', quantity: 'proteinPerDay', unit: 'g/d', basis: 'notApplicable', comparator: 'floor', value: 110, source: { kind: 'clinician', ref: 'other-order' } })], { id: 'other', condition: 'other' });
    for (const envs of [[ckd, other], [other, ckd]]) expect(evaluate(req({ kidneyDisease: true, nutritionEnvelopes: envs }), 105).conflicts.some((c) => c.floor.id === 'other-floor')).toBe(true);
    const r = req({ kidneyDisease: true, nutritionEnvelopes: [ckd, { ...other, revokedAt: '2026-10-01' }] });
    const ctx = compileRequest(r);
    expect(ctx.caps.renal.clinical.envelopes).toHaveLength(2);
    expect(evaluate(r, 95).conflicts).toEqual([]);
  });
});
