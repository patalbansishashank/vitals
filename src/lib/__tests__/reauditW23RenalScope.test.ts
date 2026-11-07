import '@/features/charts/test/setupDom';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { buildPlannerRequest, defaultConstraints } from '@/features/planner/request';
import { engineSafety } from '@/features/simulator/profile';
import { SafetySettingsPanel } from '@/features/onboarding/SafetySettingsPanel';
import { STANDARD_ANSWERS } from '@/features/onboarding/testing';
// Boundary regression intentionally exercises the shared headless safety composition.
// eslint-disable-next-line no-restricted-imports
import { safetyAccessNow } from '@/state/internal/safety';
import { useSafetyStore, pickSafetyValues, isSafetyState } from '@/state/safetyStore';
import { withSystemWrite } from '@/state/scope';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { compileRequest } from '@/engine/planner/domain/context';
import { OBESE_MAN, request } from '@/engine/planner/domain/__tests__/personas';
import { resolveClinicalNutritionScope, resolveRenalScope, renalSafetyFlags, type RenalNutritionEnvelope } from '@/lib/renalScope';
import type { ConstraintDef } from '@/lib/bodyContracts';

const TODAY = '2026-10-19';
const AT = `${TODAY}T12:00:00.000Z`;
const bound = (over: Partial<ConstraintDef> = {}): ConstraintDef => ({ id: 'protein-cap', quantity: 'proteinPerDay', unit: 'g/d', comparator: 'cap', value: 95, basis: 'notApplicable', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'clinician', ref: 'doc:renal', enteredAt: AT }, policyVersion: 1, ...over });
const envelope = (over: Partial<RenalNutritionEnvelope> = {}): RenalNutritionEnvelope => ({ id: 'renal:1', condition: 'ckd', dialysis: 'none', stability: 'stable', weightBasis: 'actual', assessedAt: '2026-09-01', bounds: [bound()], source: 'document', sourceDocument: 'clinic-letter:12', provenance: 'Entered from clinician letter', ...over });
const scopeOf = (envelopes: RenalNutritionEnvelope[], extra: Partial<Parameters<typeof resolveRenalScope>[0]> = {}) => resolveRenalScope({ flags: ['kidney-disease'], today: TODAY, body: { weightKg: 90, weightOn: TODAY }, envelopes, ...extra });

afterEach(cleanup);

describe('shared bound-specific clinical authority', () => {
  it('empty and notApplicable bounds confer no domain authority', () => {
    expect(scopeOf([envelope({ bounds: [] })]).withheld).toEqual(['protein', 'sodium', 'potassium', 'fluid']);
    const scope = scopeOf([envelope({ bounds: [bound({ applicability: 'notApplicable' })] })]);
    expect(scope.entered).toEqual([]);
    expect(scope.bounds[0]).toMatchObject({ status: 'notApplicable', def: { value: 95 } });
  });
  it('protein-only, sodium-only and fluid-only authority remain independent', () => {
    expect(scopeOf([envelope()]).entered).toEqual(['protein']);
    expect(scopeOf([envelope()]).withheld).toEqual(['sodium', 'potassium', 'fluid']);
    const sodium = envelope({ bounds: [bound({ quantity: 'sodiumPerDay', unit: 'mg/d', value: 1000 })] });
    expect(scopeOf([sodium]).entered).toEqual(['sodium']);
    expect(scopeOf([sodium]).withheld).toContain('protein');
    expect(scopeOf([envelope({ bounds: [bound({ quantity: 'fluidPerDay', unit: 'mL/d', value: 1600 })] })]).entered).toEqual(['fluid']);
  });
  it.each([
    { unit: 'mg/d' }, { value: Number.NaN }, { value: Number.POSITIVE_INFINITY }, { value: -1 }, { value: undefined },
    { basis: 'invented' }, { window: { kind: 'rolling', days: 0 } }, { window: { kind: 'invented' } },
  ])('retains malformed per-kg mandatory original for review: %j', (bad) => {
    const original = bound({ quantity: 'proteinPerKg', unit: 'g/kg/d', basis: 'actual', value: 0.5, ...bad } as Partial<ConstraintDef>);
    const scope = scopeOf([envelope({ bounds: [original] })]);
    expect(scope.bounds[0]?.def).toEqual(original);
    expect(scope.bounds[0]?.status).toBe('invalid');
    expect(scope.bounds[0]?.normalized).toBeUndefined();
    expect(scope.entered).not.toContain('protein');
    expect(renalSafetyFlags(scope).nutritionEnvelopes?.[0]?.bounds[0]).toEqual(original);
  });
  it('preserves named actual and clinician-entered dry/adjusted kg with date and window', () => {
    for (const basis of ['actual', 'clinicianEntered'] as const) for (const kind of ['dry', 'adjusted'] as const) {
      const original = bound({ quantity: 'proteinPerKg', unit: 'g/kg/d', basis, value: 0.9, window: { kind: 'rolling', days: 7 } });
      const scope = scopeOf([envelope({ weightBasis: basis, basisWeightKg: 67.25, basisWeightOn: '2026-08-30', basisWeightKind: kind, bounds: [original] })]);
      expect(scope.bounds[0]?.perDay).toEqual({ value: 0.9 * 67.25, unit: 'g/d', basis, basisKg: 67.25, basisOn: '2026-08-30' });
      expect(scope.bounds[0]?.normalized).toMatchObject({ quantity: 'proteinPerDay', value: 0.9 * 67.25, window: { kind: 'rolling', days: 7 } });
      expect(scope.bounds[0]?.def).toEqual(original);
    }
  });
  it('unresolved applicability does not normalize or authorize, and valid siblings retain known constraints', () => {
    const unresolved = bound({ id: 'unresolved', applicability: 'unresolved' });
    const invalid = bound({ id: 'bad-fluid', quantity: 'fluidPerDay', unit: 'g/d' as never });
    const scope = scopeOf([envelope({ bounds: [bound(), unresolved, invalid] })]);
    expect(scope.bounds.find((b) => b.def.id === 'unresolved')?.status).toBe('review');
    expect(scope.bounds.find((b) => b.def.id === 'protein-cap')?.status).toBe('enforceable');
    expect(scope.bounds.find((b) => b.def.id === 'bad-fluid')?.status).toBe('invalid');
  });
  it('other-condition bounds retain mandatory authority without declaring CKD or requiring dialysis', () => {
    const env = envelope({ condition: 'other', dialysis: undefined, stability: 'unknown', bounds: [bound({ value: 100 }), bound({ id: 'fluid', quantity: 'fluidPerDay', unit: 'mL/d', value: 1600 })] });
    const scope = resolveRenalScope({ flags: [], envelopes: [env], today: TODAY });
    expect(scope.context).toBe('none');
    expect(scope.bounds.map((b) => b.def.mandatory)).toEqual([true, true]);
    expect(scope.bounds.map((b) => b.status)).toEqual(['enforceable', 'enforceable']);
    expect(scope.entered).toEqual(['protein', 'fluid']);
  });
  it('intersects mixed envelopes order-independently and retains explicit cap-floor conflict', () => {
    const a = envelope(); const b = envelope({ id: 'other:1', condition: 'other', bounds: [bound({ id: 'other-floor', comparator: 'floor', value: 110 })] });
    const x = scopeOf([a, b]); const y = scopeOf([b, a]);
    expect(x.bounds).toEqual(y.bounds); expect(x.conflicts).toEqual(y.conflicts);
    expect(x.conflicts[0]?.compared).toMatchObject({ cap: 95, floor: 110, unit: 'g/d' });
  });
});

describe('dated applicability at every boundary', () => {
  it.each(['2026-08-30', '2026-12-01'])('ignores pre-assessment or future medication changes: %s', (date) => {
    expect(scopeOf([envelope()], { medicationChanges: [{ id: 'm', date, medicationClass: 'antihypertensive' }] }).entered).toEqual(['protein']);
  });
  it('reviews post-assessment relevant changes, preserves unrelated changes, and later reassessment restores authority', () => {
    const medicationChanges = [{ id: 'm', date: '2026-10-01', medicationClass: 'antihypertensive' as const }];
    const scope = scopeOf([envelope()], { medicationChanges });
    expect(scope.needsReview[0]?.reasons).toContain('medicationChanged');
    expect(scope.withheld).toContain('protein');
    expect(scopeOf([envelope()], { medicationChanges: [{ ...medicationChanges[0]!, medicationClass: 'statin' }] }).entered).toEqual(['protein']);
    expect(scopeOf([envelope({ assessedAt: '2026-10-02' })], { medicationChanges }).entered).toEqual(['protein']);
    const flags = renalSafetyFlags(scope);
    expect(resolveClinicalNutritionScope(flags, TODAY, 90).needsReview[0]?.reasons).toContain('medicationChanged');
  });
  it('dated illness, new clinician findings, review dates and withdrawal remain explicit', () => {
    const illness = scopeOf([envelope()], { recentIllnessAt: '2026-10-10' });
    expect(illness.needsReview[0]?.reasons).toContain('acuteIllness');
    expect(scopeOf([envelope({ assessedAt: '2026-10-12' })], { recentIllnessAt: '2026-10-10' }).entered).toEqual(['protein']);
    const finding = scopeOf([envelope()], { findings: [{ kind: 'clinicianLevel', source: 'potassium', ref: 'k:1', date: '2026-10-10' }] });
    expect(finding.needsReview[0]?.reasons).toContain('newClinicalFinding');
    expect(scopeOf([envelope({ reviewBy: '2026-10-18' })]).needsReview[0]?.reasons).toContain('reviewDatePassed');
    const revoked = scopeOf([envelope({ revokedAt: TODAY })]);
    expect(revoked.needsReview[0]?.reasons).toContain('revoked');
    expect(renalSafetyFlags(revoked).nutritionEnvelopes?.[0]?.revokedAt).toBe(TODAY);
  });
  it('lossless transport binds original rejected, reviewed, revoked and future sources', () => {
    const envs = [envelope(), envelope({ id: 'revoked', revokedAt: TODAY }), envelope({ id: 'future', assessedAt: '2026-12-01' }), envelope({ id: 'invalid', bounds: [bound({ value: -1 })] })];
    const scope = scopeOf(envs);
    const transported = renalSafetyFlags(scope);
    expect(transported.nutritionEnvelopes).toHaveLength(4);
    expect(transported.renalScope?.evaluations).toHaveLength(4);
    expect(transported.renalScope?.version).toBe(2);
    expect(resolveClinicalNutritionScope(transported, TODAY, 90).envelopes).toEqual(scope.envelopes);
  });
  it('healthy no-source profile stays unchanged while explicitly empty current source remains authoritative', () => {
    expect(renalSafetyFlags(resolveRenalScope({ flags: [], today: TODAY }))).toEqual({});
    expect(renalSafetyFlags(resolveRenalScope({ flags: [], today: TODAY, sourceKnown: true, envelopes: [] }))).toMatchObject({ nutritionEnvelopes: [], renalScope: { sourceContext: { sourceKnown: true } } });
  });
});

describe('manual persisted source, current composition and mounted activation', () => {
  beforeEach(() => { freshState(); useSafetyStore.getState().commitAnswers({ ...STANDARD_ANSWERS, conditions: 'yes', conditionItems: ['kidney'] }, AT); });
  it('command → store → headless encoder → compile retains exact cap and clinician kg/date', async () => {
    const env = envelope({ weightBasis: 'clinicianEntered', basisWeightKg: 67.25, basisWeightOn: '2026-08-30', basisWeightKind: 'dry' });
    const added = await dispatch('safety.addNutritionGuidance', { envelope: env as unknown as Record<string, unknown>, at: AT });
    expect(added.ok).toBe(true);
    const values = pickSafetyValues(useSafetyStore.getState());
    expect(values.nutritionGuidance?.[0]).toMatchObject(env);
    expect(pickSafetyValues(JSON.parse(JSON.stringify(values)))).toEqual(values);
    const access = safetyAccessNow(AT);
    const safety = engineSafety({ outcome: access.outcome, fasting: { optedTier: access.optedTier } } as Parameters<typeof engineSafety>[0]);
    expect(safety.flags.nutritionEnvelopes?.[0]).toMatchObject(env);
    const planner = buildPlannerRequest({ goals: [], horizonDays: 30, startDate: TODAY, constraints: defaultConstraints(OBESE_MAN.habits), strictness: 'balanced', profile: OBESE_MAN, safety: { outcome: access.outcome, plannerAccess: access.plannerAccess, optedTier: access.optedTier, shortWindowOn: access.shortWindowOn } });
    expect(planner.profile.safety?.flags.renalScope).toEqual(safety.flags.renalScope);
    expect(planner.profile.safety?.flags.nutritionEnvelopes).toEqual(safety.flags.nutritionEnvelopes);
    expect(compileRequest(planner).caps.renal.clinical.bounds[0]?.def.value).toBe(95);
    const ctx = compileRequest(request({ ...OBESE_MAN, startDate: TODAY, safety }, []));
    expect(ctx.caps.renal.clinical?.bounds[0]?.def.value).toBe(95);
  });
  it('update retains superseded history; withdrawal remains withdrawn after reloading source state', async () => {
    const env = envelope();
    expect((await dispatch('safety.addNutritionGuidance', { envelope: env as unknown as Record<string, unknown>, at: AT })).ok).toBe(true);
    const revised = envelope({ id: 'renal:2', assessedAt: TODAY, bounds: [bound({ value: 100 })] });
    expect((await dispatch('safety.updateNutritionGuidance', { id: env.id, envelope: revised as unknown as Record<string, unknown>, at: AT })).ok).toBe(true);
    expect(useSafetyStore.getState().nutritionGuidance).toHaveLength(2);
    expect(useSafetyStore.getState().nutritionGuidance?.[0]?.revokedAt).toBe(TODAY);
    expect((await dispatch('safety.revokeNutritionGuidance', { id: revised.id, at: AT })).ok).toBe(true);
    const reloaded = pickSafetyValues(JSON.parse(JSON.stringify(useSafetyStore.getState())));
    withSystemWrite(() => useSafetyStore.setState(reloaded));
    expect(safetyAccessNow(AT).outcome.renal.entered).toEqual([]);
    expect(safetyAccessNow(AT).outcome.renal.envelopes).toHaveLength(2);
  });
  it('invalid mandatory imports remain present for review and malformed source arrays reject import', () => {
    const env = envelope({ bounds: [bound({ value: -1 })] });
    expect(isSafetyState({ nutritionGuidance: [env] })).toBe(true);
    expect(pickSafetyValues({ nutritionGuidance: [env] }).nutritionGuidance?.[0]?.bounds[0]?.value).toBe(-1);
    expect(isSafetyState({ nutritionGuidance: [{}] })).toBe(false);
    expect(pickSafetyValues({}).nutritionGuidance).toBeNull();
  });
  it('mounted Safety settings activates stored guidance and keeps the form absent for healthy people', () => {
    withSystemWrite(() => useSafetyStore.setState({ nutritionGuidance: [envelope()] }));
    const view = render(createElement(MemoryRouter, null, createElement(SafetySettingsPanel)));
    expect(screen.getByRole('region', { name: 'Clinician nutrition guidance' })).toBeTruthy();
    expect(screen.getByText('Protein ≤ 95 g/d')).toBeTruthy();
    view.unmount();
    withSystemWrite(() => useSafetyStore.setState({ answers: STANDARD_ANSWERS, nutritionGuidance: null }));
    render(createElement(MemoryRouter, null, createElement(SafetySettingsPanel)));
    expect(screen.queryByRole('region', { name: 'Clinician nutrition guidance' })).toBeNull();
  });
  it('keeps the finite simulation prior separate from unknown recorded habitual intake', () => {
    const profile = { ...OBESE_MAN, habits: { ...OBESE_MAN.habits, habitualProteinGPerKg: undefined }, safety: { mode: 'M0' as const, flags: { kidneyDisease: true } } };
    const resolved = resolveProfile(profile);
    expect(Number.isFinite(resolved.habitualProteinG)).toBe(true);
    expect(resolved.input.habits?.habitualProteinGPerKg).toBeUndefined();
    const ctx = compileRequest(request(profile, []));
    expect(ctx.caps.renal.heldProteinGPerKgRw).toBeNull();
  });
});
