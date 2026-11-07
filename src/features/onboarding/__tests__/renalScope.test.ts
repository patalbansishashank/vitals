/**
 * Renal nutrition scope (D4-07). A kidney answer is renal context incomplete — no automatic protein bound (neither the
 * old 1.3 g/kg reference-weight cap nor KDIGO's 0.8 g/kg), renal-targeted numbers withheld, the supplement / ketogenic /
 * fasting precautions kept and activity untouched. An applicable clinician envelope keeps its own weight basis and value;
 * a conflict with a general floor is reported with both values and never clipped; review dates, later medication changes,
 * acute illness and newer clinician-level results make an envelope need review without deleting it. A kidney lab result
 * alone is a neutral review, never a stage.
 */
import type { ConstraintDef, SymptomReport } from '@/lib/bodyContracts';
import { evaluateScreening, RULES_VERSION, type PlannerLockId, type SafetyContext, type ScreeningAnswers, type ScreeningOutcome } from '../safetyRules';
import { legacyRenalContext, renalSafetyFlags, resolveRenalScope, withRenalFindings, RENAL_DOMAINS, type RenalFinding, type RenalNutritionEnvelope } from '../renalScope';
import { STANDARD_ANSWERS as STD } from '../testing';

const TODAY = '2026-10-10';
const KIDNEY: Partial<ScreeningAnswers> = { conditions: 'yes', conditionItems: ['kidney'] };
const ev = (patch: Partial<ScreeningAnswers> = {}, ctx: SafetyContext = {}) => evaluateScreening({ ...STD, ...patch }, ctx);
const lock = (o: ScreeningOutcome, id: PlannerLockId) => o.plannerLocks.find((l) => l.id === id);

const bound = (over: Partial<ConstraintDef> = {}): ConstraintDef => ({
  id: 'protein-max',
  quantity: 'proteinPerKg',
  unit: 'g/kg/d',
  comparator: 'cap',
  value: 0.8,
  basis: 'actual',
  scope: 'total',
  window: { kind: 'day' },
  applicability: 'applicable',
  mandatory: true,
  source: { kind: 'clinician', ref: 'env-1' },
  policyVersion: 1,
  ...over,
});
const envelope = (over: Partial<RenalNutritionEnvelope> = {}): RenalNutritionEnvelope => ({
  id: 'env-1',
  condition: 'ckd',
  stage: 'G3a',
  dialysis: 'none',
  stability: 'stable',
  weightBasis: 'actual',
  bounds: [bound()],
  assessedAt: '2026-10-01',
  source: 'selfEnteredClinician',
  ...over,
});
const proteinNumbers = (o: ScreeningOutcome): number[] => [
  ...o.plannerLocks.filter((l) => l.id === 'protein-cap').map((l) => l.value ?? NaN),
  ...o.renal.bounds.filter((b) => b.status === 'enforceable' && (b.def.quantity === 'proteinPerKg' || b.def.quantity === 'proteinPerDay')).map((b) => b.def.value),
];

describe('kidney answer without an envelope (D4-07)', () => {
  it('is Incomplete: renal numbers withheld, no automatic protein bound, precautions kept, activity and weight management untouched', () => {
    const o = ev(KIDNEY);
    expect(o.rulesVersion).toBe(RULES_VERSION);
    expect(RULES_VERSION).toBe(3);
    expect(lock(o, 'protein-cap')).toBeUndefined();
    expect(proteinNumbers(o)).toEqual([]);
    expect(o.renal).toMatchObject({ status: 'incomplete', context: 'contextIncomplete', label: 'Incomplete', withheld: [...RENAL_DOMAINS], entered: [], missing: ['envelope'], stage: null });
    for (const id of ['no-potassium-supplement', 'no-creatine', 'no-ketogenic'] as const) expect(lock(o, id)).toBeDefined();
    expect(lock(o, 'max-fast')?.value).toBe(24);
    // a kidney boolean alone bans neither activity nor weight management
    for (const id of ['no-exercise-prescription', 'exercise-light-moderate', 'exercise-low-impact', 'no-deficit', 'no-weight-loss-goal'] as const) expect(lock(o, id)).toBeUndefined();
    expect(lock(o, 'deficit-cap')?.value).toBe(15);
    expect(o.plannerAccess).toBe('restricted');
    expect(o.flags).toContain('kidney-disease');
    expect(renalSafetyFlags(o.renal)).toEqual({ renalContext: 'contextIncomplete', nutritionEnvelopes: o.renal.envelopes, renalScope: o.renal });
  });

  it('a healthy adult has no renal scope and no profile fields (request hashes unchanged)', () => {
    const o = ev();
    expect(o.renal).toMatchObject({ status: 'none', context: 'none', label: null, withheld: [], applicable: [] });
    expect(renalSafetyFlags(o.renal)).toEqual({});
  });

  it('dialysis, frailty or unknown context never gets an automatic 0.8 g/kg (or any) protein target', () => {
    const variants: Array<[Partial<ScreeningAnswers>, SafetyContext]> = [
      [KIDNEY, { today: TODAY, nutritionEnvelopes: [envelope({ dialysis: 'hemodialysis', bounds: [bound({ id: 'fluid', quantity: 'fluidPerDay', unit: 'mL/d', value: 1000, basis: 'notApplicable' })] })] }],
      [KIDNEY, { today: TODAY, nutritionEnvelopes: [envelope({ stage: undefined, frailty: 'yes', bounds: [bound({ id: 'na', quantity: 'sodiumPerDay', unit: 'mg/d', value: 2000, basis: 'notApplicable' })] })] }],
      [KIDNEY, { today: TODAY, nutritionEnvelopes: [envelope({ stability: 'unknown' })] }],
      [KIDNEY, { today: TODAY, nutritionEnvelopes: [envelope({ dialysis: 'unknown' })] }],
      [{ ...KIDNEY, ageBand: '75-plus' }, {}],
      [{ ...KIDNEY, ageBand: '65-74', sarcf: { lift: 2, walk: 2, chair: 0, stairs: 0, falls: 0 } }, { weightKg: 70, heightCm: 168 }],
    ];
    for (const [answers, ctx] of variants) {
      const o = ev(answers, ctx);
      expect(lock(o, 'protein-cap')).toBeUndefined();
      expect(proteinNumbers(o).filter((v) => v === 0.8 || v === 1.3)).toEqual([]);
      expect(o.renal.withheld).toContain('protein');
      expect(o.renal.entered).not.toContain('protein');
    }
  });
});

describe('entered envelope: the clinician basis and value are kept (D4-07)', () => {
  it('an actual-weight order stays on actual weight: 120 kg → 96 g/day, not the reference weight min(BW, 27.5·H²)', () => {
    const o = ev(KIDNEY, { today: TODAY, nutritionEnvelopes: [envelope()], weightKg: 120, weightOn: TODAY, heightCm: 170 });
    expect(o.renal).toMatchObject({ status: 'entered', context: 'envelopeEntered', label: 'Entered', entered: ['protein'], withheld: ['sodium', 'potassium', 'fluid'], stage: 'G3a' });
    const b = o.renal.bounds[0]!;
    expect(b.def).toEqual(bound()); // exactly as entered
    expect(b.perDay).toEqual({ value: 0.8 * 120, unit: 'g/d', basis: 'actual', basisKg: 120, basisOn: TODAY });
    const rw = Math.min(120, 27.5 * 1.7 * 1.7);
    expect(Math.abs(b.perDay!.value - 0.8 * rw)).toBeGreaterThan(30);
    expect(lock(o, 'protein-cap')).toBeUndefined(); // never relabelled as a reference-weight screening lock
    expect(renalSafetyFlags(o.renal)).toEqual({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope()], renalScope: o.renal });
  });

  it('a dry-weight order keeps the clinician kg and its date; a reference basis without the clinician kg needs review', () => {
    const dry = envelope({ dialysis: 'hemodialysis', weightBasis: 'clinicianEntered', basisWeightKg: 68, basisWeightOn: '2026-09-30', basisWeightKind: 'dry', bounds: [bound({ comparator: 'floor', value: 1.2, basis: 'clinicianEntered' })] });
    const o = ev(KIDNEY, { today: TODAY, nutritionEnvelopes: [dry], weightKg: 81, heightCm: 172 });
    expect(o.renal.status).toBe('entered');
    expect(o.renal.bounds[0]!.perDay).toEqual({ value: 1.2 * 68, unit: 'g/d', basis: 'clinicianEntered', basisKg: 68, basisOn: '2026-09-30' });

    const ref = envelope({ weightBasis: 'reference', bounds: [bound({ basis: 'reference' })] });
    const r = ev(KIDNEY, { today: TODAY, nutritionEnvelopes: [ref], weightKg: 120, heightCm: 170 });
    expect(r.renal).toMatchObject({ status: 'review', context: 'contextIncomplete', label: 'Review', applicable: [] });
    expect(r.renal.bounds.every((b) => b.status !== 'enforceable')).toBe(true);
    expect(r.renal.needsReview).toEqual([{ envelope: ref, reasons: ['basisWeightMissing'] }]);
    expect(r.renal.withheld).toContain('protein');
    // a per-kg bound whose basis differs from the envelope's names no kg: review, not a guess
    const mixed = envelope({ weightBasis: 'clinicianEntered', basisWeightKg: 70, bounds: [bound({ basis: 'actual' })] });
    expect(ev(KIDNEY, { today: TODAY, nutritionEnvelopes: [mixed] }).renal.needsReview[0]!.reasons).toEqual(['basisMismatch']);
  });

  it('an envelope for another condition stays enforced without creating renal context', () => {
    const other = envelope({ id: 'hf', condition: 'other', dialysis: undefined, stage: undefined, bounds: [bound({ id: 'fluid', quantity: 'fluidPerDay', unit: 'mL/d', value: 1500, basis: 'notApplicable' })], weightBasis: 'notApplicable' });
    const o = ev({}, { today: TODAY, nutritionEnvelopes: [other] });
    expect(o.renal).toMatchObject({ status: 'entered', context: 'none', withheld: [], entered: ['fluid'], applicable: [other] });
    expect(renalSafetyFlags(o.renal)).toEqual({ renalContext: 'none', nutritionEnvelopes: [other], renalScope: o.renal });
  });

  it('is order-independent across several envelopes (newest kidney envelope reported)', () => {
    const older = envelope({ id: 'a', assessedAt: '2026-09-01', bounds: [bound({ id: 'k', quantity: 'potassiumPerDay', unit: 'mg/d', value: 2500, basis: 'notApplicable' })] });
    const newer = envelope({ id: 'b', assessedAt: '2026-10-02' });
    const x = resolveRenalScope({ flags: ['kidney-disease'], envelopes: [older, newer], today: TODAY, body: { weightKg: 80 } });
    const y = resolveRenalScope({ flags: ['kidney-disease'], envelopes: [newer, older], today: TODAY, body: { weightKg: 80 } });
    expect(x).toEqual(y);
    expect(x.envelope?.id).toBe('b');
    expect(x.entered).toEqual(['protein', 'potassium']);
    expect(x.withheld).toEqual(['sodium', 'fluid']);
  });
});

describe('conflicts are explicit, never clipped (D4-07, C5)', () => {
  it('a clinician cap below the age protein floor is a proven conflict in g/day; the floor and the cap keep their values', () => {
    const cap = envelope({ bounds: [bound({ value: 0.6 })] });
    const o = ev({ ...KIDNEY, ageBand: '65-74' }, { today: TODAY, nutritionEnvelopes: [cap], weightKg: 80, heightCm: 175 });
    expect(lock(o, 'protein-floor')?.value).toBe(1.2);
    expect(o.renal.bounds[0]!.def.value).toBe(0.6);
    expect(o.renal).toMatchObject({ status: 'conflict', context: 'envelopeEntered', label: 'Review' });
    expect(o.renal.conflicts).toEqual([
      {
        kind: 'proven',
        domain: 'protein',
        cap: { id: 'protein-max', value: 0.6, unit: 'g/kg/d', source: 'envelope', ref: 'env-1' },
        floor: { id: 'protein-floor', value: 1.2, unit: 'g/kg reference weight', source: 'screening', ref: 'protein-floor' },
        compared: { cap: 0.6 * 80, floor: 1.2 * 80, unit: 'g/d' },
      },
    ]);
    expect(o.renal.withheld).toContain('protein');
    // the same pair without body measures cannot be compared: unresolved (review), not a pass
    const u = ev({ ...KIDNEY, ageBand: '65-74' }, { today: TODAY, nutritionEnvelopes: [cap] });
    expect(u.renal.conflicts.map((c) => c.kind)).toEqual(['unresolved']);
    expect(u.renal.missing).toContain('bodyMeasures');
    expect(u.renal.label).toBe('Review');
    // a cap at or above the floor in g/day is no conflict
    expect(ev({ ...KIDNEY, ageBand: '65-74' }, { today: TODAY, nutritionEnvelopes: [envelope({ bounds: [bound({ value: 1.3 })] })], weightKg: 80, heightCm: 175 }).renal.status).toBe('entered');
  });

  it('floor above cap inside entered bounds (any basis), energy below no-deficit and carbohydrate below the carb floor conflict', () => {
    const own = envelope({ weightBasis: 'clinicianEntered', basisWeightKg: 70, bounds: [bound({ comparator: 'floor', value: 1.2, basis: 'clinicianEntered' }), bound({ id: 'p-day', quantity: 'proteinPerDay', unit: 'g/d', value: 60, basis: 'notApplicable' })] });
    const a = resolveRenalScope({ flags: ['kidney-disease'], envelopes: [own], today: TODAY });
    expect(a.conflicts).toEqual([expect.objectContaining({ kind: 'proven', domain: 'protein', compared: { cap: 60, floor: 1.2 * 70, unit: 'g/d' } })]);
    const energy = envelope({ bounds: [bound({ id: 'e', quantity: 'energyPctOfMaintenance', unit: '% of maintenance', value: 90, basis: 'notApplicable' }), bound({ id: 'c', quantity: 'carbPerDay', unit: 'g/d', value: 80, basis: 'notApplicable' })] });
    const o = ev({ ...KIDNEY, eatingDisorder: 'yes' }, { today: TODAY, nutritionEnvelopes: [energy] });
    expect(lock(o, 'no-deficit')).toBeDefined();
    expect(lock(o, 'carb-floor')?.value).toBe(100);
    expect(o.renal.conflicts.map((c) => [c.domain, c.cap.id, c.floor.id, c.compared])).toEqual([
      ['energy', 'e', 'no-deficit', { cap: 90, floor: 100, unit: '% of maintenance' }],
      ['carbohydrate', 'c', 'carb-floor', { cap: 80, floor: 100, unit: 'g/d' }],
    ]);
  });
});

describe('review triggers keep the envelope and withdraw its authority (D4-07)', () => {
  const base: SafetyContext = { today: TODAY, nutritionEnvelopes: [envelope()], weightKg: 80 };
  const cases: Array<[string, SafetyContext, string]> = [
    ['its own review date passed', { ...base, nutritionEnvelopes: [envelope({ reviewBy: '2026-10-05' })] }, 'reviewDatePassed'],
    ['a medication change after the assessment', { ...base, medicationChanges: [{ id: 'm1', date: '2026-10-03' }] }, 'medicationChanged'],
    ['an acute illness', { ...base, optIns: { recentIllness: true } }, 'acuteIllness'],
    ['a newer clinician-level result', { ...base, renalFindings: [{ kind: 'clinicianLevel', source: 'egfr', ref: 'egfr:2026-10-06', date: '2026-10-06', rule: 'W-L-EGFR-5' }] }, 'newClinicalFinding'],
    ['an unstable context', { ...base, nutritionEnvelopes: [envelope({ stability: 'unstable' })] }, 'unstable'],
    ['a withdrawal', { ...base, nutritionEnvelopes: [envelope({ revokedAt: '2026-10-08' })] }, 'revoked'],
    ['no known day', { nutritionEnvelopes: [envelope()] }, 'noDate'],
  ];
  for (const [what, ctx, reason] of cases)
    it(`${what}: Review, renal numbers withheld, the envelope kept`, () => {
      const o = ev(KIDNEY, ctx);
      expect(o.renal).toMatchObject({ status: 'review', context: 'contextIncomplete', label: 'Review', applicable: [] });
      expect(o.renal.bounds.every((b) => b.status !== 'enforceable')).toBe(true);
      expect(o.renal.envelopes).toEqual(ctx.nutritionEnvelopes);
      expect(o.renal.needsReview).toHaveLength(1);
      expect(o.renal.needsReview[0]!.envelope).toBe(ctx.nutritionEnvelopes![0]);
      expect(o.renal.needsReview[0]!.reasons).toContain(reason);
      expect(o.renal.withheld).toEqual([...RENAL_DOMAINS]);
      expect(renalSafetyFlags(o.renal)).toEqual({ renalContext: 'contextIncomplete', nutritionEnvelopes: o.renal.envelopes, renalScope: o.renal });
    });

  it('changes before the assessment, or a non-clinician-level result after it, do not; a re-assessment applies again', () => {
    expect(ev(KIDNEY, { ...base, medicationChanges: [{ id: 'm0', date: '2026-09-20' }] }).renal.status).toBe('entered');
    const fresh: RenalFinding = { kind: 'currentAbnormal', source: 'egfr', ref: 'egfr:2026-10-06', date: '2026-10-06', rule: 'W-L-EGFR-1' };
    expect(ev(KIDNEY, { ...base, renalFindings: [fresh] }).renal.status).toBe('entered');
    const reassessed = ev(KIDNEY, { ...base, nutritionEnvelopes: [envelope({ assessedAt: '2026-10-04' })], medicationChanges: [{ id: 'm1', date: '2026-10-03' }] });
    expect(reassessed.renal.status).toBe('entered');
  });

  it('unknown stability or dialysis status is incomplete context, not an entered envelope', () => {
    const o = ev(KIDNEY, { today: TODAY, weightKg: 80, nutritionEnvelopes: [envelope({ stability: 'unknown', dialysis: undefined })] });
    expect(o.renal).toMatchObject({ status: 'incomplete', label: 'Incomplete', applicable: [] });
    expect(o.renal.missing).toEqual(['dialysisStatus', 'stability']);
  });
});

describe('lab findings, stages and activity (D4-07)', () => {
  it('a kidney lab result alone is a neutral review with no stage; a confirmed condition is incomplete with the clinician stage only', () => {
    const lab = resolveRenalScope({ flags: [], findings: [{ kind: 'currentAbnormal', source: 'egfr', ref: 'egfr:2026-09-12', date: '2026-09-12', rule: 'W-L-EGFR-1' }] });
    expect(lab).toMatchObject({ status: 'review', context: 'priorAbnormalityReview', label: 'Review', stage: null, withheld: [...RENAL_DOMAINS], missing: ['envelope'] });
    const prior = resolveRenalScope({ flags: [], findings: [{ kind: 'priorAbnormality', source: 'egfr', ref: 'egfr:2025-01-12', date: '2025-01-12', rule: 'W-L-REVIEW-EGFR' }] });
    expect(prior.context).toBe('priorAbnormalityReview');
    const confirmed = resolveRenalScope({ flags: [], findings: [{ kind: 'clinicianConfirmed', source: 'ckd', ref: 'c1', date: '2026-01-05', stage: 'G3b' }] });
    expect(confirmed).toMatchObject({ status: 'incomplete', context: 'contextIncomplete', stage: 'G3b' });
  });

  it('stable kidney context keeps activity; an independent new chest symptom still stops exercise prescription', () => {
    const stable = ev(KIDNEY, { today: TODAY, nutritionEnvelopes: [envelope()] });
    expect(stable.plannerLocks.filter((l) => l.id.startsWith('exercise') || l.id === 'no-exercise-prescription')).toEqual([]);
    const chest: SymptomReport = { id: 's1', category: 'exertionalChestDiscomfort', status: 'new', occurredOn: '2026-10-08', reportedAt: '2026-10-08T09:00:00Z', context: 'exertional', source: 'user' };
    const o = ev(KIDNEY, { today: TODAY, weightKg: 80, nutritionEnvelopes: [envelope()], symptoms: [chest] });
    expect(lock(o, 'no-exercise-prescription')).toBeDefined();
    expect(o.renal.status).toBe('entered'); // the symptom is the exercise gate's, not a renal change
  });
});

describe('migration (D4-07, C7)', () => {
  it('a legacy kidneyDisease=true profile reads as context incomplete, never a stage or an order', () => {
    expect(legacyRenalContext({ kidneyDisease: true })).toBe('contextIncomplete');
    expect(legacyRenalContext({})).toBe('none');
    expect(legacyRenalContext(undefined)).toBe('none');
    expect(legacyRenalContext({ kidneyDisease: true, renalContext: 'envelopeEntered' })).toBe('envelopeEntered');
  });

  it('evaluation is idempotent and stores nothing: the same answers and context give the same scope', () => {
    const ctx: SafetyContext = { today: TODAY, nutritionEnvelopes: [envelope()], weightKg: 90 };
    const a = ev(KIDNEY, ctx);
    const b = ev(KIDNEY, ctx);
    expect(b).toEqual(a);
    expect(ctx.nutritionEnvelopes![0]).toEqual(envelope()); // the recorded envelope is never rewritten
  });

  it('withRenalFindings retains a kidney envelope while a newer clinician-level result withdraws its authority', () => {
    const lab: RenalFinding = { kind: 'currentAbnormal', source: 'egfr', ref: 'egfr:2026-09-12', date: '2026-09-12', rule: 'W-L-EGFR-1' };
    expect(withRenalFindings({}, [lab], TODAY)).toMatchObject({ renalContext: 'priorAbnormalityReview', nutritionEnvelopes: [], renalScope: { status: 'review', findings: [lab] } });
    expect(withRenalFindings({ kidneyDisease: true }, [lab], TODAY)).toMatchObject({ renalContext: 'contextIncomplete' });
    expect(withRenalFindings({ renalContext: 'contextIncomplete' }, [lab], TODAY)).toMatchObject({ renalContext: 'contextIncomplete' });
    const confirmed: RenalFinding = { kind: 'clinicianConfirmed', source: 'ckd', ref: 'c1' };
    expect(withRenalFindings({ renalContext: 'priorAbnormalityReview' }, [confirmed], TODAY)).toMatchObject({ renalContext: 'contextIncomplete' });
    const env = envelope({ assessedAt: '2026-09-01' });
    const other = envelope({ id: 'hf', condition: 'other' });
    const entered = { renalContext: 'envelopeEntered' as const, nutritionEnvelopes: [env, other] };
    expect(withRenalFindings(entered, [lab], TODAY, { weightKg: 80 })).toMatchObject({ renalContext: 'envelopeEntered', nutritionEnvelopes: [other, env], renalScope: { status: 'entered', applicable: [other, env] } });
    const level: RenalFinding = { kind: 'clinicianLevel', source: 'egfr', ref: 'egfr:2026-09-12', date: '2026-09-12', rule: 'W-L-EGFR-6' };
    const reviewed = withRenalFindings(entered, [level], TODAY, { weightKg: 80 });
    expect(reviewed).toMatchObject({ renalContext: 'contextIncomplete', nutritionEnvelopes: [other, env], renalScope: { needsReview: [{ envelope: env, reasons: ['newClinicalFinding'] }] } });
    expect(withRenalFindings({ renalContext: 'envelopeEntered', nutritionEnvelopes: [envelope({ assessedAt: '2026-09-20' })] }, [level], TODAY, { weightKg: 80 }).renalContext).toBe('envelopeEntered');
  });
});
