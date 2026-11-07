// @vitest-environment node
/**
 * D4-07: clinician-directed renal nutrition envelopes in the planner's safety compile. A kidney answer (the legacy boolean
 * included) is renal context incomplete: no automatic renal protein bound (neither the former 1.3 g/kg reference-weight
 * cap nor KDIGO's 0.8 g/kg), protein held at the habitual intake, no autonomous fasting/sodium/potassium/fluid numbers.
 * An applicable envelope's bounds apply with the clinician's own weight basis (never replaced by the reference weight);
 * conflicts are explicit; activity stays governed by its own rules.
 */
import { describe, expect, it } from 'vitest';
import type { ClinicalNutritionEnvelope, ConstraintDef } from '@/lib/bodyContracts';
import { resolveProfile } from '../../../core/resolveProfile';
import type { PersonProfile, SafetyFlags } from '../../../types/profile';
import { compileRequest } from '../context';
import { baselineSchedule } from '../decode';
import { compileSafetyCaps, renalEnvelopeApplies, RENAL_DOMAINS } from '../safety';
import { validatePlan } from '../validate';
import { OBESE_MAN, request } from './personas';

const START = '2026-10-05';
const withFlags = (flags: SafetyFlags, p: PersonProfile = OBESE_MAN): PersonProfile => ({ ...p, startDate: START, safety: { mode: 'M0', flags } });
const capsOf = (flags: SafetyFlags, input?: Parameters<typeof compileSafetyCaps>[1], p?: PersonProfile) => {
  const rp = resolveProfile(withFlags(flags, p));
  return { rp, caps: compileSafetyCaps(rp, input) };
};
const proteinBound = (comparator: 'cap' | 'floor', value: number, basis: ConstraintDef['basis'] = 'actual'): ConstraintDef => ({
  id: `renal-protein-${comparator}`,
  quantity: 'proteinPerKg',
  unit: 'g/kg/d',
  comparator,
  value,
  basis,
  scope: 'total',
  window: { kind: 'day' },
  applicability: 'applicable',
  mandatory: true,
  source: { kind: 'clinician', ref: 'env' },
  policyVersion: 1,
});
const envelope = (o: Partial<ClinicalNutritionEnvelope & { basisWeightKg: number; revokedAt: string }> = {}): ClinicalNutritionEnvelope & { basisWeightKg?: number } => ({
  id: 'env-1',
  condition: 'ckd',
  stage: 'G3a',
  dialysis: 'none',
  stability: 'stable',
  weightBasis: 'actual',
  bounds: [proteinBound('cap', 0.8)],
  assessedAt: '2026-09-01',
  source: 'selfEnteredClinician',
  ...o,
});

describe('D4-07 renal context without an applicable envelope', () => {
  it('a legacy kidneyDisease = true is context incomplete: a population prior supplies no prescribed routine', () => {
    const { caps } = capsOf({ kidneyDisease: true });
    expect(caps.renal).toMatchObject({ status: 'incomplete', context: 'contextIncomplete', reasonCode: 'contextIncomplete', proteinGPerDay: null });
    expect(caps.renal.withheld).toEqual(RENAL_DOMAINS);
    expect(caps.renal.heldProteinGPerKgRw).toBeNull();
    expect(caps.renal.habitualProteinG).toBeNull();
    expect(caps.proteinFloorRw).toBe(0.8);
    expect(caps.proteinFloorDeficitRw).toBe(1.2);
    expect(caps.proteinCapRw).not.toBeCloseTo(1.3, 3);
    expect(caps.proteinCapRw).not.toBeCloseTo(0.8, 3);
    expect(caps.constraints.merged.some((m) => m.id === 'HC-M2.ckd')).toBe(false);
  });

  it('no autonomous fasting or supplement numbers; activity, deficits and other goals stay available', () => {
    const { caps } = capsOf({ kidneyDisease: true });
    expect(caps.fastTierAllowed.T1).toBe(false);
    expect(caps.maxFastH).toBeLessThanOrEqual(20);
    expect(caps.creatineAllowed).toBe(false);
    expect(caps.exercise).toMatchObject({ allowed: true, rtAllowed: true, cardioAllowed: true, gate: 'none' });
    expect(caps.deficitCapPct).toBeGreaterThan(0);
    const ctx = compileRequest(request(withFlags({ kidneyDisease: true }), [{ metric: 'fatMass', direction: 'minimise' }, { metric: 'strength', direction: 'maximise' }]));
    expect(ctx.problems).toEqual([]);
    expect(ctx.caps.blocked).toBeNull();
  });

  it('the general protein floor yields to the held intake with an explicit conflict, never silently', () => {
    const lowProtein: PersonProfile = { ...OBESE_MAN, habits: { ...(OBESE_MAN.habits ?? {}), habitualProteinGPerKg: 0.6 } };
    const { caps } = capsOf({ kidneyDisease: true }, undefined, lowProtein);
    // the habitual intake is below the 0.8/1.2 g/kg reference-weight floors: reported with both values
    expect(caps.renal.heldProteinGPerKgRw!).toBeLessThan(1.2);
    expect(caps.renal.conflicts.some((c) => (c.id === 'HC-M1' || c.id === 'HC-M1.deficit') && c.governs.id === 'renal.held')).toBe(true);
    expect(caps.renal.conflicts.every((c) => Number.isFinite(c.yielded.value) && Number.isFinite(c.governs.value) && c.unit === 'g/kg/d')).toBe(true);
  });

  it('a prior abnormal kidney result under review is a neutral review, never a stage', () => {
    const { caps } = capsOf({ renalContext: 'priorAbnormalityReview' });
    expect(caps.renal).toMatchObject({ status: 'review', reasonCode: 'priorAbnormality' });
    expect('stage' in caps.renal).toBe(false);
  });

  it('a new concerning exertional symptom still suspends exercise; renal scope is independent of it', () => {
    const { caps } = capsOf({ kidneyDisease: true, symptoms: [{ id: 's1', category: 'exertionalChestDiscomfort', status: 'new', reportedAt: '2026-10-01T08:00:00Z', source: 'user' }] });
    expect(caps.exercise.gate).toBe('suspended');
    expect(caps.renal.status).toBe('incomplete');
  });
});

describe('D4-07 applicable clinician envelope', () => {
  it('an actual-weight order stays actual weight: g/day = value × actual kg, never the reference weight min(BW, 27.5·H²)', () => {
    const { rp, caps } = capsOf({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope()] });
    expect(caps.renal).toMatchObject({ status: 'incomplete', withheld: ['sodium', 'potassium', 'fluid'], envelopeIds: ['env-1'] });
    expect(caps.renal.proteinGPerDay!.cap).toBeCloseTo(0.8 * rp.weightKg, 9);
    expect(caps.renal.proteinGPerDay!.basis).toBe('actual');
    expect(caps.rwKg).toBeLessThan(rp.weightKg); // obese: RW < BW, so the per-RW cap is above 0.8
    expect(caps.proteinCapRw).toBeCloseTo((0.8 * rp.weightKg) / caps.rwKg, 9);
  });

  it('a clinician-entered (dry-weight) basis uses the clinician’s own kg', () => {
    const { caps } = capsOf({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope({ weightBasis: 'clinicianEntered', basisWeightKg: 72, bounds: [proteinBound('cap', 0.8, 'clinicianEntered')] })] as never });
    expect(caps.renal.proteinGPerDay!.cap).toBeCloseTo(0.8 * 72, 9);
  });

  it('dialysis unknown, unstable context, a passed review date, a revoked envelope or a missing basis kg do not apply (Review)', () => {
    const today = START;
    expect(renalEnvelopeApplies(envelope({ basisWeightKg: 118 }), today)).toBe(true);
    expect(renalEnvelopeApplies(envelope({ dialysis: 'unknown' }), today)).toBe(false);
    expect(renalEnvelopeApplies(envelope({ stability: 'unstable' }), today)).toBe(false);
    expect(renalEnvelopeApplies(envelope({ reviewBy: '2026-09-30' }), today)).toBe(false);
    expect(renalEnvelopeApplies(envelope({ revokedAt: '2026-10-01' }), today)).toBe(false);
    expect(renalEnvelopeApplies(envelope({ assessedAt: '2026-11-01' }), today)).toBe(false);
    expect(renalEnvelopeApplies(envelope({ weightBasis: 'clinicianEntered', bounds: [proteinBound('cap', 0.8, 'clinicianEntered')] }), today)).toBe(false);
    const { caps } = capsOf({ kidneyDisease: true, nutritionEnvelopes: [envelope({ dialysis: 'unknown' })] });
    expect(caps.renal).toMatchObject({ status: 'incomplete', reasonCode: 'contextIncomplete' });
    expect(caps.renal.withheld).toEqual(RENAL_DOMAINS);
  });

  it('a general floor above the clinician cap is reported as a conflict; a clinical floor is never lowered silently', () => {
    const { caps } = capsOf({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope({ bounds: [proteinBound('cap', 0.6)] })] });
    expect(caps.renal.conflicts.some((c) => c.governs.id === 'renal.cap')).toBe(true);
    expect(caps.proteinFloorDeficitRw).toBeGreaterThan(caps.proteinCapRw);
    const withFloor = capsOf({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope({ bounds: [proteinBound('floor', 1.0)] })] }, { plannerLocks: [{ id: 'protein-cap', value: 0.9, source: 'marker', mandatory: true }] });
    expect(withFloor.caps.proteinFloorRw).toBeGreaterThan(withFloor.caps.proteinCapRw);
  });

  it('sodium, potassium and fluid bounds of an envelope join the typed constraints as mandatory clinician bounds', () => {
    const sodium: ConstraintDef = { ...proteinBound('cap', 2000), id: 'renal-sodium', quantity: 'sodiumPerDay', unit: 'mg/d', basis: 'notApplicable' };
    const { caps } = capsOf({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope({ bounds: [proteinBound('cap', 0.8), sodium] })] });
    expect(caps.constraints.merged.find((m) => m.quantity === 'sodiumPerDay')).toMatchObject({ value: 2000, mandatory: true, source: { kind: 'clinician', ref: 'env' } });
  });

  it('the independent validator checks every day’s protein against the entered g/day bounds', () => {
    const ctx = compileRequest(request(withFlags({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope({ bounds: [proteinBound('cap', 0.3)] })] }), [{ metric: 'fatMass', direction: 'minimise' }]));
    const v = validatePlan(ctx, baselineSchedule(ctx));
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r) => /renal-protein-cap|protein.*cap/i.test(r))).toBe(true);
  });
});
