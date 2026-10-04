/**
 * Truth table for the onboarding gate — research/17-safety-guardrails.md §4.1 (items → modes), §4.2
 * (population rules), §4.3 (fasting tiers + exclusion codes), §4.4 (medication gate) and the
 * profile-level parts of the §7 golden tests (GT-03, 04, 07, 08, 10, 11, 13). Per-day constraints of the
 * golden tests (EI, EA, weekly rates) belong to the Planner/Simulator engines, not the gate.
 */
import {
  TIER_MAX_HOURS,
  evaluateScreening,
  isAcknowledged,
  isClearanceExpired,
  isDangerAcknowledged,
  liftedRestrictions,
  missingQuestions,
  pendingAcknowledgements,
  resolveOptIns,
  sanitizeAnswers,
  scoffPositive,
  tierForHours,
  validFastingTier,
  visibleQuestions,
  type FastingOptIn,
  type PlannerLockId,
  type SafetyContext,
  type ScreeningAnswers,
  type ScreeningOutcome,
} from '../safetyRules';
import { STANDARD_ANSWERS as STD } from '../testing';

const ev = (patch: Partial<ScreeningAnswers> = {}, ctx: SafetyContext = {}) => evaluateScreening({ ...STD, ...patch }, ctx);
const lock = (o: ScreeningOutcome, id: PlannerLockId) => o.plannerLocks.find((l) => l.id === id);
const lockValue = (o: ScreeningOutcome, id: PlannerLockId) => lock(o, id)?.value;
const has = (o: ScreeningOutcome, id: PlannerLockId) => lock(o, id) !== undefined;
const VERSIONS = { disclaimer: 1, 'clinician-first': 1 } as const;

describe('questions: visibility, completeness, minimisation', () => {
  it('ends the questionnaire at "under 18"', () => {
    expect(visibleQuestions({ ageBand: 'under-18' })).toEqual(['ageBand']);
    expect(missingQuestions({ ageBand: 'under-18' })).toEqual([]);
  });

  it('shows SCOFF only after "no" to the eating-disorder question, and SARC-F only for 65–74', () => {
    expect(visibleQuestions({ ageBand: '18-64', eatingDisorder: 'no' })).toContain('scoff');
    expect(visibleQuestions({ ageBand: '18-64', eatingDisorder: 'yes' })).not.toContain('scoff');
    expect(visibleQuestions({ ageBand: '18-64', eatingDisorder: 'prefer-not' })).not.toContain('scoff');
    expect(visibleQuestions({ ageBand: '65-74' })).toContain('sarcf');
    expect(visibleQuestions({ ageBand: '75-plus' })).not.toContain('sarcf');
  });

  it('counts "prefer not to say" as an answer and needs at least one item after "yes"', () => {
    expect(missingQuestions({ ...STD, diabetes: 'prefer-not' })).toEqual([]);
    expect(missingQuestions({ ...STD, diabetes: 'yes' })).toEqual(['diabetes']);
    expect(missingQuestions({ ...STD, diabetes: 'yes', diabetesItems: ['metformin'] })).toEqual([]);
    expect(missingQuestions({ ageBand: '18-64' })).toEqual(['pregnancy', 'eatingDisorder', 'diabetes', 'conditions', 'metabolic', 'medications', 'symptoms', 'supervisedExercise', 'musculoskeletal', 'alcohol']);
  });

  it('accepts the stored SCOFF flag, but the form requires the five items again', () => {
    expect(missingQuestions({ ...STD, scoffRisk: false })).toEqual([]);
    expect(missingQuestions({ ...STD, scoffRisk: false }, { requireScoffItems: true })).toEqual(['scoff']);
    const items = { sick: 'no', control: 'no', weightLoss: 'no', believeFat: 'no', foodDominates: 'no' } as const;
    expect(missingQuestions({ ...STD, scoffRisk: undefined, scoff: items }, { requireScoffItems: true })).toEqual([]);
  });

  it('never keeps SCOFF item answers, hidden answers or follow-ups of "no" (DS-10)', () => {
    const s = sanitizeAnswers({
      ...STD,
      scoffRisk: undefined,
      scoff: { sick: 'yes', control: 'yes', weightLoss: 'no', believeFat: 'no', foodDominates: 'no' },
      diabetes: 'no',
      diabetesItems: ['insulin'],
      sarcf: { lift: 2 },
    });
    expect(s).not.toHaveProperty('scoff');
    expect(s.scoffRisk).toBe(true);
    expect(s).not.toHaveProperty('diabetesItems');
    expect(s).not.toHaveProperty('sarcf');
    expect(sanitizeAnswers({ ...STD, ageBand: 'under-18' })).toEqual({ ageBand: 'under-18' });
    expect(sanitizeAnswers({ ...STD, eatingDisorder: 'yes', scoffRisk: true })).not.toHaveProperty('scoffRisk');
  });
});

describe('Q1 age (HC-P1, HC-P8, HC-P9, EX-A)', () => {
  it('under 18 blocks the whole app, whatever else was answered', () => {
    const o = ev({ ageBand: 'under-18', pregnancy: 'pregnant-or-breastfeeding' });
    expect(o.hardStop).toBe('BLOCK_APP');
    expect(o.mode).toBe('H');
    expect(o.modeName).toBe('adults-only');
    expect(o.simulatorAccess).toBe('blocked');
    expect(o.plannerAccess).toBe('blocked');
    expect(o.plannerLocks).toEqual([]);
    expect(o.messages.map((m) => m.id)).toEqual(['adults-only']);
    expect(o.fasting.maxEligibleTier).toBeNull();
  });

  it('an exact age under 18 from Your body also blocks', () => {
    expect(ev({}, { ageYears: 17 }).hardStop).toBe('BLOCK_APP');
  });

  it('65–74: deficit ≤ 15 %, rate ≤ 0.5 %/wk, protein ≥ 1.2 g/kg, fasting ≤ T1, no opt-in tiers', () => {
    const o = ev({ ageBand: '65-74', sarcf: { lift: 0, walk: 0, chair: 0, stairs: 0, falls: 0 } });
    expect(o.mode).toBe('M0');
    expect(o.plannerAccess).toBe('restricted');
    expect(lockValue(o, 'deficit-cap')).toBe(15);
    expect(lockValue(o, 'rate-cap')).toBe(0.5);
    expect(lockValue(o, 'protein-floor')).toBe(1.2);
    expect(lockValue(o, 'max-fast')).toBe(24);
    expect(o.fasting.optInTiers).toEqual([]);
    expect(o.simulatorRules).toContain('W-P03');
  });

  it('SARC-F ≥ 4 means no deficit (HC-P9); 3 does not', () => {
    expect(has(ev({ ageBand: '65-74', sarcf: { lift: 2, walk: 1, chair: 1, stairs: 0, falls: 0 } }), 'no-deficit')).toBe(true);
    expect(has(ev({ ageBand: '65-74', sarcf: { lift: 1, walk: 1, chair: 1, stairs: 0, falls: 0 } }), 'no-deficit')).toBe(false);
  });

  it('75+: no deficit, protein ≥ 1.0 g/kg, daily fasts only (T1 is for 18–74)', () => {
    const o = ev({ ageBand: '75-plus' });
    expect(has(o, 'no-deficit')).toBe(true);
    expect(lockValue(o, 'protein-floor')).toBe(1.0);
    expect(lockValue(o, 'max-fast')).toBe(TIER_MAX_HOURS.T0);
    expect(o.fasting.maxEligibleTier).toBe('T0');
  });
});

describe('Q2 pregnancy (HC-P2, EX-B, §4.2)', () => {
  it('pregnant or breastfeeding: Planner off, Simulator with danger rules', () => {
    const o = ev({ pregnancy: 'pregnant-or-breastfeeding' });
    expect(o.hardStop).toBe('BLOCK_PLANNER');
    expect(o.modeName).toBe('simulator-only');
    expect(o.plannerAccess).toBe('blocked');
    expect(o.plannerLocks).toEqual([]);
    expect(o.simulatorAccess).toBe('with-warnings');
    expect(o.simulatorRules).toEqual(expect.arrayContaining(['W-P01', 'W-M10']));
  });

  it('planning a pregnancy: clinician-first, no deficit, no fasting over 12 h', () => {
    const o = ev({ pregnancy: 'planning' });
    expect(o.restrictions).toEqual(['R2']);
    expect(has(o, 'no-deficit')).toBe(true);
    expect(lockValue(o, 'max-fast')).toBe(12);
    expect(lockValue(o, 'min-eating-window')).toBe(12);
    expect(o.requiredAcknowledgements.map((a) => a.id)).toEqual(['disclaimer', 'clinician-first']);
  });

  it('prefer not to say is treated as "no" with a notice (dossier §4.1 Q2)', () => {
    const o = ev({ pregnancy: 'prefer-not' });
    expect(o.mode).toBe('M0');
    expect(o.plannerAccess).toBe('full');
    expect(o.messages.map((m) => m.id)).toEqual(['pregnancy-undisclosed']);
  });
});

describe('Q3–Q8 eating (HC-P3, EX-C, SCOFF ≥ 2)', () => {
  const gentleLocks = (o: ScreeningOutcome) => {
    expect(o.mode).toBe('R1');
    expect(o.modeName).toBe('gentle');
    expect(has(o, 'no-deficit')).toBe(true);
    expect(has(o, 'no-weight-loss-goal')).toBe(true);
    expect(has(o, 'no-ketogenic')).toBe(true);
    expect(lockValue(o, 'carb-floor')).toBe(100);
    expect(lockValue(o, 'max-fast')).toBe(12);
    expect(lockValue(o, 'min-eating-window')).toBe(12);
    expect(o.fasting.optInTiers).toEqual([]);
    expect(o.fasting.shortWindowAvailable).toBe(false);
    expect(o.simulatorRules).toEqual(expect.arrayContaining(['W-P02', 'W-M10']));
  };

  it('"yes" and "prefer not to say" both mean gentle mode', () => {
    gentleLocks(ev({ eatingDisorder: 'yes' }));
    gentleLocks(ev({ eatingDisorder: 'prefer-not' }));
    expect(ev({ eatingDisorder: 'prefer-not' }).messages[0]?.id).toBe('gentle-mode-undisclosed');
  });

  it('SCOFF: two or more "yes" → gentle mode; one → standard', () => {
    const scoff = (n: number) => {
      const keys = ['sick', 'control', 'weightLoss', 'believeFat', 'foodDominates'] as const;
      return Object.fromEntries(keys.map((k, i) => [k, i < n ? 'yes' : 'no'])) as ScreeningAnswers['scoff'];
    };
    gentleLocks(ev({ scoffRisk: undefined, scoff: scoff(2) }));
    expect(ev({ scoffRisk: undefined, scoff: scoff(2) }).messages[0]?.id).toBe('gentle-mode-scoff');
    expect(ev({ scoffRisk: undefined, scoff: scoff(1) }).mode).toBe('M0');
    expect(scoffPositive({ scoffRisk: true })).toBe(true);
    gentleLocks(ev({ scoffRisk: true }));
  });
});

describe('Q9 diabetes and glucose-lowering medicines (HC-P6, EX-E, §4.4)', () => {
  it.each(['type-1', 'insulin', 'sulfonylurea-meglitinide', 'sglt2'] as const)('%s blocks the Planner', (item) => {
    const o = ev({ diabetes: 'yes', diabetesItems: [item] });
    expect(o.hardStop).toBe('BLOCK_PLANNER');
    expect(o.plannerAccess).toBe('blocked');
    expect(o.simulatorRules).toContain('W-P04');
    expect(o.messages[0]?.id).toBe('diabetes-planner-off');
  });

  it('GT-11: an SGLT2-inhibitor user gets the Planner block and the ketogenic danger rule', () => {
    const o = ev({ diabetes: 'yes', diabetesItems: ['sglt2'] });
    expect(o.simulatorRules).toEqual(expect.arrayContaining(['W-M10', 'W-P04']));
  });

  it('metformin / GLP-1 / other: clinician-first, fasts ≤ 12 h (EX-E), no ketogenic range (HC-M4)', () => {
    for (const item of ['metformin', 'glp1-injection', 'other-glucose-lowering'] as const) {
      const o = ev({ diabetes: 'yes', diabetesItems: [item] });
      expect(o.mode).toBe('R2');
      expect(lockValue(o, 'max-fast')).toBe(12);
      expect(has(o, 'no-ketogenic')).toBe(true);
      expect(o.simulatorRules).toContain('W-P04');
    }
  });

  it('diabetes without medicine: clinician-first, fasts ≤ 24 h', () => {
    const o = ev({ diabetes: 'yes', diabetesItems: ['diet-only'] });
    expect(o.mode).toBe('R2');
    expect(lockValue(o, 'max-fast')).toBe(24);
    expect(o.simulatorRules).not.toContain('W-P04');
  });

  it('prefer not to say: clinician-first and the EX-E fasting limit', () => {
    const o = ev({ diabetes: 'prefer-not' });
    expect(o.mode).toBe('R2');
    expect(lockValue(o, 'max-fast')).toBe(12);
  });
});

describe('Q10/Q12 conditions (HC-P7, §4.2, EX-F, EX-G, EX-H)', () => {
  it('kidney disease: protein ≤ 1.3 g/kg, no potassium supplements or creatine, no keto, fasts ≤ 24 h', () => {
    const o = ev({ conditions: 'yes', conditionItems: ['kidney'] });
    expect(o.mode).toBe('R2');
    expect(o.modeName).toBe('clinician-first');
    expect(lockValue(o, 'protein-cap')).toBe(1.3);
    expect(has(o, 'no-potassium-supplement')).toBe(true);
    expect(has(o, 'no-creatine')).toBe(true);
    expect(has(o, 'no-ketogenic')).toBe(true);
    expect(lockValue(o, 'max-fast')).toBe(24);
    expect(lockValue(o, 'deficit-cap')).toBe(15);
    expect(o.simulatorRules).toEqual(expect.arrayContaining(['W-P05', 'W-M05']));
  });

  it('heart, blood pressure or stroke: exercise light to moderate', () => {
    expect(has(ev({ conditions: 'yes', conditionItems: ['heart'] }), 'exercise-light-moderate')).toBe(true);
    expect(has(ev({ conditions: 'yes', conditionItems: ['liver'] }), 'no-ketogenic')).toBe(true);
  });

  it('gout: rate ≤ 0.5 %/wk, no keto, fasts ≤ 24 h; gallstones: fat ≥ 30 g, no VLED', () => {
    const gout = ev({ metabolic: 'yes', metabolicItems: ['gout'] });
    expect(lockValue(gout, 'rate-cap')).toBe(0.5);
    expect(has(gout, 'no-ketogenic')).toBe(true);
    expect(gout.simulatorRules).toContain('W-P06');
    const gall = ev({ metabolic: 'yes', metabolicItems: ['gallstones'] });
    expect(lockValue(gall, 'fat-floor')).toBe(30);
    expect(lockValue(gall, 'rate-cap')).toBe(0.5);
    expect(lock(gall, 'no-vled')?.reasons.map((r) => r.rule)).toContain('population rules');
  });

  it('pancreatitis and rare metabolic conditions lock the ketogenic range (W-M10); rare conditions also daily fasts only', () => {
    expect(ev({ metabolic: 'yes', metabolicItems: ['pancreatitis'] }).simulatorRules).toContain('W-M10');
    const rare = ev({ metabolic: 'yes', metabolicItems: ['rare-metabolic'] });
    expect(has(rare, 'no-ketogenic')).toBe(true);
    expect(lockValue(rare, 'max-fast')).toBe(20);
    expect(ev({ metabolic: 'yes', metabolicItems: ['kidney-stones'] }).simulatorRules).toEqual(expect.arrayContaining(['W-M24', 'W-P06']));
  });
});

describe('Q11 medication gate (§4.4, EX-I)', () => {
  it('diuretics and ACEi/ARB: no potassium supplements, fasts ≤ 24 h, W-P07', () => {
    for (const item of ['diuretic', 'acei-arb-mra'] as const) {
      const o = ev({ medications: 'yes', medicationItems: [item] });
      expect(o.mode).toBe('R2');
      expect(has(o, 'no-potassium-supplement')).toBe(true);
      expect(lockValue(o, 'max-fast')).toBe(24);
      expect(o.simulatorRules).toContain('W-P07');
    }
  });

  it('lithium and topiramate lock the ketogenic range; QT drugs lock VLED', () => {
    expect(has(ev({ medications: 'yes', medicationItems: ['lithium'] }), 'no-ketogenic')).toBe(true);
    expect(has(ev({ medications: 'yes', medicationItems: ['topiramate-zonisamide'] }), 'no-ketogenic')).toBe(true);
    const qt = ev({ medications: 'yes', medicationItems: ['heart-rhythm'] });
    expect(lock(qt, 'no-vled')?.reasons.map((r) => r.rule)).toContain('medication check');
  });

  it('any long-term prescription medicine means clinician-first', () => {
    expect(ev({ medications: 'yes', medicationItems: ['anticoagulant'] }).mode).toBe('R2');
    expect(ev({ medications: 'prefer-not' }).mode).toBe('R2');
  });
});

describe('Q13–Q16 exercise and alcohol (HC-X4, Q14, Q15, Q16, EX-J)', () => {
  it('symptoms: clinician-first, exercise light to moderate, W-X05', () => {
    const o = ev({ symptoms: 'yes' });
    expect(o.mode).toBe('R2');
    expect(has(o, 'exercise-light-moderate')).toBe(true);
    expect(o.simulatorRules).toContain('W-X05');
  });

  it('supervised exercise only: no exercise prescriptions', () => {
    const o = ev({ supervisedExercise: 'yes' });
    expect(has(o, 'no-exercise-prescription')).toBe(true);
    expect(o.mode).toBe('R2');
  });

  it('bone/joint problem: exercise builds slowly, mode stays standard but the Planner is restricted', () => {
    const o = ev({ musculoskeletal: 'yes' });
    expect(o.mode).toBe('M0');
    expect(has(o, 'exercise-low-impact')).toBe(true);
    expect(o.plannerAccess).toBe('restricted');
  });

  it('heavy alcohol: daily fasts only (stricter T1-row reading) and no VLED', () => {
    const o = ev({ alcohol: 'yes' });
    expect(lockValue(o, 'max-fast')).toBe(20);
    expect(o.fasting.optInTiers).toEqual([]);
  });

  it('alcohol plus a refeeding-risk medicine sets the NICE refeeding flag', () => {
    expect(ev({ alcohol: 'yes', medications: 'yes', medicationItems: ['diuretic'] }).flags).toContain('refeeding-risk');
    expect(ev({ alcohol: 'yes' }).flags).not.toContain('refeeding-risk');
  });
});

describe('priority and co-occurrence (BLOCK_APP > BLOCK_PLANNER > R1 > R2 > M0)', () => {
  it('R1 and R2 co-occur as an intersection of restrictions', () => {
    const o = ev({ eatingDisorder: 'yes', conditions: 'yes', conditionItems: ['kidney'] });
    expect(o.mode).toBe('R1');
    expect(o.restrictions).toEqual(['R1', 'R2']);
    expect(has(o, 'no-deficit')).toBe(true);
    expect(lockValue(o, 'protein-cap')).toBe(1.3);
    expect(lockValue(o, 'max-fast')).toBe(12);
  });

  it('BLOCK_PLANNER outranks R1 but keeps its Simulator rules', () => {
    const o = ev({ pregnancy: 'pregnant-or-breastfeeding', eatingDisorder: 'yes' });
    expect(o.mode).toBe('H');
    expect(o.restrictions).toContain('R1');
    expect(o.simulatorRules).toEqual(expect.arrayContaining(['W-P01', 'W-P02']));
  });

  it('standard mode: full Planner, the default limits, disclaimer only', () => {
    const o = ev();
    expect(o.mode).toBe('M0');
    expect(o.plannerAccess).toBe('full');
    expect(o.simulatorAccess).toBe('full');
    expect(lockValue(o, 'deficit-cap')).toBe(25);
    expect(lockValue(o, 'rate-cap')).toBe(0.75);
    expect(lockValue(o, 'max-fast')).toBe(24);
    expect(lockValue(o, 'min-eating-window')).toBe(6);
    expect(has(o, 'no-vled')).toBe(true);
    expect(o.requiredAcknowledgements).toEqual([{ id: 'disclaimer', scope: 'app' }]);
    expect(o.fasting.optInTiers).toEqual(['T2', 'T3', 'T4']);
    expect(o.bodyRulesApplied).toBe(false);
  });
});

describe('body context (HC-P4, HC-P5, HC-E3, HC-E5, EX-D) and golden tests', () => {
  it('BMI < 18.5: no deficit, fasting or keto; underweight notice; W-M10', () => {
    const o = ev({}, { bmi: 17.5 });
    expect(has(o, 'no-deficit')).toBe(true);
    expect(has(o, 'no-ketogenic')).toBe(true);
    expect(lockValue(o, 'max-fast')).toBe(12);
    expect(o.messages.map((m) => m.id)).toContain('body-underweight');
    expect(o.simulatorRules).toContain('W-M10');
  });

  it('BMI < 20: no deficit start (HC-P4), daily fasts only (EX-D T1 20)', () => {
    const o = ev({}, { bmi: 19.4 });
    expect(has(o, 'no-deficit')).toBe(true);
    expect(lockValue(o, 'max-fast')).toBe(20);
  });

  it('BMI thresholds for opt-in tiers: T2 ≥ 20, T3 ≥ 22, T4 ≥ 25', () => {
    expect(ev({}, { bmi: 21 }).fasting.optInTiers).toEqual(['T2']);
    expect(ev({}, { bmi: 23 }).fasting.optInTiers).toEqual(['T2', 'T3']);
    expect(ev({}, { bmi: 26 }).fasting.optInTiers).toEqual(['T2', 'T3', 'T4']);
  });

  it('GT-08: deficit cap 30 % at BMI 30.6, 20 % at BMI 24', () => {
    expect(lockValue(ev({}, { bmi: 30.6 }), 'deficit-cap')).toBe(30);
    expect(lockValue(ev({}, { bmi: 24 }), 'deficit-cap')).toBe(20);
    expect(lockValue(ev({}, { bmi: 31 }), 'rate-cap')).toBe(1.0);
  });

  it('GT-03: male athlete at 18 % body fat keeps the 0.75 %/wk cap; at 15 % the cap is 0.5 %/wk', () => {
    expect(lockValue(ev({}, { bmi: 24, sex: 'male', bodyFatPct: 18 }), 'rate-cap')).toBe(0.75);
    expect(lockValue(ev({}, { bmi: 24, sex: 'male', bodyFatPct: 15 }), 'rate-cap')).toBe(0.5);
  });

  it('GT-04: male body-fat floor 10 % (no deficit below it; deficit ≤ 10 % within 4 points)', () => {
    expect(has(ev({}, { bmi: 22, sex: 'male', bodyFatPct: 9 }), 'no-deficit')).toBe(true);
    expect(lockValue(ev({}, { bmi: 22, sex: 'male', bodyFatPct: 13 }), 'deficit-cap')).toBe(10);
  });

  it('GT-13: woman at BMI 22, 24 % body fat → 0.5 %/wk cap (within 6 points of the 18 % floor)', () => {
    const o = ev({}, { bmi: 22, sex: 'female', bodyFatPct: 24 });
    expect(lockValue(o, 'rate-cap')).toBe(0.5);
    expect(has(o, 'no-deficit')).toBe(false);
  });

  it('GT-10: BMI 17.5 with alcohol misuse → refeeding risk, no fasting beyond 12 h', () => {
    const o = ev({ alcohol: 'yes' }, { bmi: 17.5 });
    expect(o.flags).toContain('refeeding-risk');
    expect(lockValue(o, 'max-fast')).toBe(12);
    expect(o.fasting.optInTiers).toEqual([]);
  });

  it('GT-07: a 10-day fast is T5 — never in the Planner, whatever the opt-in', () => {
    expect(tierForHours(240)).toBe('T5');
    const o = ev({}, { bmi: 28, sex: 'female', bodyFatPct: 36, optIns: { fastingTier: 'T4' } });
    expect(o.fasting.maxFastHours).toBe(TIER_MAX_HOURS.T4);
    expect(o.fasting.effectiveTier).toBe('T4');
    expect(o.fasting.optInTiers).not.toContain('T5' as never);
  });

  it('high training load keeps fasts at T2 or below (EX-L)', () => {
    expect(ev({}, { bmi: 24, highTrainingLoad: true, optIns: { fastingTier: 'T3' } }).fasting.maxFastHours).toBe(48);
  });
});

describe('fasting opt-ins (HC-F1, HC-F5, §4.3.2)', () => {
  it('T2 opt-in raises the limit to 48 h for eligible profiles only', () => {
    const on = ev({}, { optIns: { fastingTier: 'T2' } });
    expect(lockValue(on, 'max-fast')).toBe(48);
    expect(lock(on, 'max-fast')?.reasons).toEqual([{ rule: 'HC-F1', source: 'opt-in' }]);
    expect(lockValue(ev({ conditions: 'yes', conditionItems: ['heart'] }, { optIns: { fastingTier: 'T2' } }), 'max-fast')).toBe(24);
  });

  it('T3 needs the body thresholds: without body context plans stay at 48 h', () => {
    expect(lockValue(ev({}, { optIns: { fastingTier: 'T3' } }), 'max-fast')).toBe(48);
    expect(lockValue(ev({}, { bmi: 23, sex: 'female', bodyFatPct: 27, optIns: { fastingTier: 'T3' } }), 'max-fast')).toBe(72);
    expect(lockValue(ev({}, { bmi: 23, sex: 'female', bodyFatPct: 24, optIns: { fastingTier: 'T3' } }), 'max-fast')).toBe(48);
  });

  it('T4 (expert) reaches 7 days at BMI ≥ 25; VLED only from BMI 30', () => {
    const o = ev({}, { bmi: 26, sex: 'male', bodyFatPct: 24, optIns: { fastingTier: 'T4' } });
    expect(lockValue(o, 'max-fast')).toBe(168);
    expect(has(o, 'no-vled')).toBe(true);
    expect(has(ev({}, { bmi: 31, sex: 'male', bodyFatPct: 30, optIns: { fastingTier: 'T4' } }), 'no-vled')).toBe(false);
  });

  it('recent illness pauses everything above daily fasts (Q19, EX-K)', () => {
    const o = ev({}, { bmi: 24, optIns: { fastingTier: 'T3', recentIllness: true } });
    expect(lockValue(o, 'max-fast')).toBe(20);
    expect(o.plannerAccess).toBe('restricted');
  });

  it('4–6 h eating windows only with the opt-in, never with the 12 h rules', () => {
    expect(lockValue(ev({}, { optIns: { shortEatingWindow: true } }), 'min-eating-window')).toBe(4);
    expect(lockValue(ev({ eatingDisorder: 'yes' }, { optIns: { shortEatingWindow: true } }), 'min-eating-window')).toBe(12);
  });

  it('an opt-in counts only with every acknowledgement for its tier, at the current version', () => {
    const base: FastingOptIn = { tier: 'T3', acknowledged: ['A', 'B', 'C'], ackVersion: 1, priorFastTolerated: true, at: '2026-09-30T10:00:00Z' };
    expect(validFastingTier(base, 1, false)).toBe('T3');
    expect(validFastingTier({ ...base, acknowledged: ['A', 'B'] }, 1, false)).toBe('T2');
    expect(validFastingTier({ ...base, acknowledged: ['A'] }, 1, false)).toBeNull();
    expect(validFastingTier(base, 2, false)).toBeNull();
    expect(validFastingTier({ ...base, priorFastTolerated: false }, 1, false)).toBeNull();
    const expert: FastingOptIn = { ...base, tier: 'T4', acknowledged: ['A', 'B', 'C', 'D'], refeedingPlanAccepted: true };
    expect(validFastingTier(expert, 1, true)).toBe('T4');
    expect(validFastingTier(expert, 1, false)).toBe('T3');
    expect(validFastingTier({ ...expert, refeedingPlanAccepted: false }, 1, true)).toBe('T3');
  });

  it('resolveOptIns pauses fasting for 28 days after illness and versions the short-window opt-in', () => {
    const optIn: FastingOptIn = { tier: 'T2', acknowledged: ['A', 'B'], ackVersion: 1, priorFastTolerated: true, at: '2026-09-01T10:00:00Z' };
    const s = { fastingOptIn: optIn, shortWindow: { version: 1, at: '2026-09-01T10:00:00Z' }, recentIllnessAt: '2026-09-10T10:00:00Z' };
    const v = { fasting: 1, shortWindow: 1 };
    expect(resolveOptIns(s, '2026-09-30T10:00:00Z', v, false)).toEqual({ fastingTier: null, shortEatingWindow: true, recentIllness: true });
    expect(resolveOptIns(s, '2026-10-09T10:00:00Z', v, false)).toEqual({ fastingTier: 'T2', shortEatingWindow: true, recentIllness: false });
    expect(resolveOptIns(s, '2026-10-09T10:00:00Z', { fasting: 1, shortWindow: 2 }, false).shortEatingWindow).toBe(false);
  });
});

describe('acknowledgements, expiry, lifted restrictions, danger acknowledgements', () => {
  it('pending acknowledgements are versioned: a copy change re-prompts', () => {
    const o = ev();
    expect(pendingAcknowledgements(o, {}, VERSIONS)).toEqual(['disclaimer']);
    expect(pendingAcknowledgements(o, { disclaimer: { version: 1, at: 'x' } }, VERSIONS)).toEqual([]);
    expect(pendingAcknowledgements(o, { disclaimer: { version: 1, at: 'x' } }, { ...VERSIONS, disclaimer: 2 })).toEqual(['disclaimer']);
    expect(isAcknowledged({ disclaimer: { version: 1, at: 'x' } }, 'disclaimer', 2)).toBe(false);
    const r2 = ev({ symptoms: 'yes' });
    expect(pendingAcknowledgements(r2, { disclaimer: { version: 1, at: 'x' } }, VERSIONS, 'planner')).toEqual(['clinician-first']);
    expect(pendingAcknowledgements(r2, { disclaimer: { version: 1, at: 'x' } }, VERSIONS, 'app')).toEqual([]);
  });

  it('clearance lapses after 12 months (PAR-Q+ style)', () => {
    expect(isClearanceExpired('2025-10-01T00:00:00Z', '2026-09-30T00:00:00Z')).toBe(false);
    expect(isClearanceExpired('2025-09-30T00:00:00Z', '2026-09-30T00:00:00Z')).toBe(true);
    expect(isClearanceExpired(null, '2026-09-30T00:00:00Z')).toBe(true);
    expect(isClearanceExpired('garbage', '2026-09-30T00:00:00Z')).toBe(true);
  });

  it('reports which restrictions a new set of answers would lift', () => {
    expect(liftedRestrictions(ev({ eatingDisorder: 'yes' }), ev())).toEqual(['R1']);
    expect(liftedRestrictions(ev(), ev({ eatingDisorder: 'yes' }))).toEqual([]);
    expect(liftedRestrictions(ev({ pregnancy: 'pregnant-or-breastfeeding', symptoms: 'yes' }), ev())).toEqual(['BLOCK_PLANNER', 'R2']);
  });

  it('a danger acknowledgement holds per scenario, per rule, until the schedule changes', () => {
    const ack = { scheduleHash: 'h1', rules: ['W-F04'], version: 1, at: 'x' };
    expect(isDangerAcknowledged(ack, 'h1', ['W-F04'], 1)).toBe(true);
    expect(isDangerAcknowledged(ack, 'h2', ['W-F04'], 1)).toBe(false);
    expect(isDangerAcknowledged(ack, 'h1', ['W-F04', 'W-E02'], 1)).toBe(false);
    expect(isDangerAcknowledged(ack, 'h1', ['W-F04'], 2)).toBe(false);
    expect(isDangerAcknowledged(undefined, 'h1', ['W-F04'], 1)).toBe(false);
  });
});
