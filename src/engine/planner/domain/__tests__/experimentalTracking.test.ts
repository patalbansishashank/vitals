// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Schedule } from '../../../types/schedule';
import { compileRequest } from '../context';
import { startSubjectSimulation } from '../evaluatorHost';
import { revalidatePlanSafety } from '../safetyAudit';
import { MAN_95, request } from './personas';
import type { PlannerRequest } from '../types';

const schedule: Schedule = {
  schemaVersion: 1, startDate: '2026-10-05', horizonDays: 28,
  programs: [{ id: 'steady', label: 'Steady', energy: { kind: 'kcal', kcal: 1500 }, macros: { protein: { unit: 'g', value: 125 }, fat: { unit: 'g', value: 40 }, carbs: { unit: 'remainder' } }, steps: 10000 }],
  days: Array.from({ length: 28 }, () => ({ program: 0 })),
};
function input(extra: Partial<PlannerRequest> = {}): PlannerRequest {
  return request(MAN_95, [], { horizonDays: 28, startDate: schedule.startDate, constraints: { enforceDefaultDeficitCap: false, experimentalTracking: true }, ...extra });
}
const defaultLock = { id: 'deficit-cap', value: 25, unit: '%', source: 'screening' as const, mandatory: true, reasons: [{ rule: 'HC-E3' }] };

describe('explicit experimental scenario tracking', () => {
  it('retains the ordinary audit failure and policy warnings; tracking never issues a Verified certificate', () => {
    const req = input();
    const sim = startSubjectSimulation(req, schedule);
    const checked = revalidatePlanSafety(req, schedule, { boundary: 'scenarioStart', sim });
    expect(checked.startable).toBe(false);
    expect(checked.certificateValid).toBe(false);
    expect(checked.status).not.toBe('verified');
    expect(checked.experimentalTracking).toMatchObject({ scope: 'experimentalTracking', startable: true, blockers: [] });
    expect(checked.experimentalTracking!.warnings.join(' ')).toMatch(/not been clinically validated/);
    expect(checked.experimentalTracking!.warnings.join(' ')).toMatch(/HC-E3/);
    const ordinary = revalidatePlanSafety({ ...req, constraints: {} }, schedule, { boundary: 'scenarioStart', sim });
    expect(ordinary.startable).toBe(false);
    expect(ordinary.experimentalTracking).toBeUndefined();
  });

  it('removes only the generated duplicate of the default cap; clinician and imported caps remain', () => {
    expect(compileRequest(input({ safety: { plannerLocks: [defaultLock] } })).caps.deficitCapPct).toBe(100);
    expect(compileRequest(input({ safety: { plannerLocks: [{ ...defaultLock, source: 'clinician' }] } })).caps.deficitCapPct).toBe(25);
    expect(compileRequest(input({ safety: { plannerLocks: [{ ...defaultLock, source: 'import' }] } })).caps.deficitCapPct).toBe(25);
    expect(compileRequest(input({ safety: { plannerLocks: [{ ...defaultLock, value: 15, reasons: [{ rule: 'HC-P7' }] }] } })).caps.deficitCapPct).toBe(15);
  });

  it('cannot waive a clinician deficit restriction or missing simulation', () => {
    const req = input({ safety: { plannerLocks: [{ ...defaultLock, value: 15, source: 'clinician' }] } });
    const r = revalidatePlanSafety(req, schedule, { boundary: 'scenarioStart', sim: startSubjectSimulation(req, schedule) });
    expect(r.experimentalTracking?.startable).toBe(false);
    expect(r.experimentalTracking?.blockers.join(' ')).toMatch(/deficit-cap/);
    const absent = revalidatePlanSafety(input(), schedule, { boundary: 'scenarioStart' });
    expect(absent.experimentalTracking?.startable).toBe(false);
    expect(absent.experimentalTracking?.blockers.join(' ')).toMatch(/complete current simulation/);
  });

  it('keeps generated body-size deficit presets advisory after a weight update, while clinician limits remain mandatory', () => {
    const req = input({ profile: { ...MAN_95, body: { ...MAN_95.body, weightKg: 80 } }, safety: { plannerLocks: [{ ...defaultLock, value: 20 }] } });
    const tracked = revalidatePlanSafety(req, schedule, { boundary: 'scenarioStart', sim: startSubjectSimulation(req, schedule) });
    expect(tracked.experimentalTracking?.startable).toBe(true);
    expect(tracked.experimentalTracking?.warnings.join(' ')).toMatch(/HC-E3/);
    const clinical = { ...req, safety: { plannerLocks: [{ ...defaultLock, value: 20, source: 'clinician' as const }] } };
    const restricted = revalidatePlanSafety(clinical, schedule, { boundary: 'scenarioStart', sim: startSubjectSimulation(clinical, schedule) });
    expect(restricted.experimentalTracking?.startable).toBe(false);
    expect(restricted.experimentalTracking?.blockers.join(' ')).toMatch(/deficit-cap/);
  });

  it('keeps symptom-related exercise restrictions enforced', () => {
    const req = input({ profile: { ...MAN_95, safety: { mode: 'M0', flags: { faintingOrChestPain: true } } } });
    const r = revalidatePlanSafety(req, schedule, { boundary: 'scenarioStart', sim: startSubjectSimulation(req, schedule) });
    expect(r.evaluation.exercise.ok).toBe(false);
    expect(r.experimentalTracking?.startable).toBe(false);
  });
});
