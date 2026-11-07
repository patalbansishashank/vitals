import { describe, expect, it } from 'vitest';
import { qaRequest, QA_KEYS } from '../../__tests__/qa/requests';
import {
  checkAgainstRule,
  coerceSuggestion,
  fatAboveBandKg,
  healthyBodyFatBand,
  labNotes,
  reconcile,
  referenceOverlap,
  signedReachKg,
  suggestGoals,
  SUGGEST_RULE_VERSION,
  type GoalSuggestion,
  type GoalSuggestionInput,
} from '../suggestGoals';
import { isProductionGoalEligible } from '../../../types/metrics';
import { PERSONAS } from './personas';
import { inputFor } from './suggest.fixtures';

const INTERNAL = /§|\bR-?\d|dossier|MODEL_SPEC|SUITE_SPEC|W-L\d|\brule@/;

/** The 17 planner QA requests and the face-validity personas, with the request's fasting opt-in. */
const CASES: Array<[string, GoalSuggestionInput]> = [
  ...QA_KEYS.map((k): [string, GoalSuggestionInput] => {
    const r = qaRequest(k);
    const tier = (r.safety?.optIns as { fastingTier?: 'T2' | 'T3' | 'T4' } | undefined)?.fastingTier ?? null;
    return [`request ${k}`, inputFor(r.profile, { optedTier: tier })];
  }),
  ...Object.entries(PERSONAS).map(([k, p]): [string, GoalSuggestionInput] => [`persona ${k}`, inputFor(p)]),
];

/** A 95-kg man clearly above the reference (interval 25–31 %) with a fat-loss route of −7.2 kg in 16 weeks. */
const SYNTH: GoalSuggestionInput = {
  profile: { complete: true, sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95, habits: { trainingHistory: 'lt1y' } },
  body: { bfPct: 28, bfBand: [25, 31], leanKg: 68.4, trainingAgeY: 0.5, measuredBodyFat: true },
  intake: { training: { prefs: { daysPerWeek: 3, minPerSession: 60, bestTime: 'evening' } } },
  markers: [],
  safety: { noWeightLossGoal: false, optedTier: null },
  reach: [
    { goal: 0, metric: 'fatMass', supported: true, kind: 'loss', start: 26.6, target: 21.6, valueAtHorizon: 19.4, changeAtHorizon: -7.2, reachableInHorizon: true, weeks: 11, beyondTwoYears: false, beyondSafetyLimits: false, ratePerWeek: 0.45, text: '', requestedHorizonDays: 112, coveredDays: 112, completeHorizon: true },
  ],
};

const UNANSWERED: GoalSuggestionInput = {
  profile: { complete: false, sex: null, ageYears: null, heightCm: null, weightKg: null },
  body: { bfPct: null, bfBand: null, leanKg: null, trainingAgeY: null },
  intake: {},
  markers: [],
  safety: { noWeightLossGoal: false, optedTier: null },
  reach: [],
};

describe('healthy body-fat band (Gallagher 2000 at BMI 18.5 and 25)', () => {
  it('matches the published 20–39-year ranges (men about 8–20 %, women about 21–33 %)', () => {
    const m = healthyBodyFatBand('male', 30);
    const f = healthyBodyFatBand('female', 30);
    expect(m[0]).toBeCloseTo(8, 0);
    expect(m[1]).toBeCloseTo(20, 0);
    expect(f[0]).toBeCloseTo(21, 0);
    expect(f[1]).toBeCloseTo(33, 0);
    // rises with age
    expect(healthyBodyFatBand('male', 65)[1]).toBeGreaterThan(m[1]);
  });
  it('fat above the band top', () => {
    // 100 kg at 30 %: lean 70 kg; at 20 % fat would be 17.5 kg → 12.5 kg above
    expect(fatAboveBandKg(100, 30, 20)).toBeCloseTo(12.5, 6);
    expect(fatAboveBandKg(80, 15, 20)).toBe(0);
  });
});

describe('suggestGoals on the golden requests and personas', () => {
  it.each(CASES)('%s: valid, deterministic and plain', (_name, input) => {
    const s = suggestGoals(input);
    expect(suggestGoals(input)).toEqual(s);
    expect(s.source).toBe('rule');
    expect(s.version).toBe('rule@2');
    expect(SUGGEST_RULE_VERSION).toBe('rule@2');
    expect(typeof s.structureHash).toBe('string');
    expect(s.goals.length).toBeGreaterThan(0);
    expect(s.goals.length).toBeLessThanOrEqual(6);
    expect(s.goals.map((g) => g.rank)).toEqual(s.goals.map((_, i) => i + 1));
    expect(new Set(s.goals.map((g) => g.metric)).size).toBe(s.goals.length);
    for (const g of s.goals) {
      expect(g.why.length).toBeGreaterThan(20);
      expect(g.why).not.toMatch(INTERNAL);
      if (g.mode === 'lose' || g.mode === 'gain') expect(g.target).toBeGreaterThan(0);
    }
    const band = healthyBodyFatBand(input.profile.sex, input.profile.ageYears);
    const bf = input.body.bfPct!;
    const trained = (input.body.trainingAgeY ?? 0) >= 0.5;
    const overlap = referenceOverlap(input.body, band);
    const lossReach = signedReachKg(input, 'fatMass', 'loss');
    const loss = s.goals.find((g) => g.metric === 'fatMass' && g.mode === 'lose');
    if (loss) {
      // D4-06: a numeric loss needs a clearly-above interval and a correctly signed supported reach; it never exceeds
      // either bound and is a multiple of the 0.5-kg display grid
      expect(overlap).toBe('clearlyAbove');
      expect(lossReach).not.toBeNull();
      expect(loss.target!).toBeGreaterThan(0);
      expect(loss.target!).toBeLessThanOrEqual(Math.min(lossReach!, fatAboveBandKg(input.profile.weightKg!, bf, band[1])) + 1e-9);
      expect(Math.abs(loss.target! / 0.5 - Math.round(loss.target! / 0.5))).toBeLessThan(1e-9);
      expect(s.goals[0]!.metric).toBe('fatMass');
      expect(s.goals[1]!.metric).toBe(trained ? 'skeletalMuscle' : 'leanTissue');
    } else if (bf > band[1] && overlap !== 'clearlyAbove') {
      // an overlapping or absent interval ranks no fat loss: neutral options first, fat loss an optional candidate
      expect(s.candidates?.some((c) => c.metric === 'fatMass')).toBe(true);
      expect(s.purposeAsk).toBeDefined();
    }
    if (bf <= band[1]) {
      expect(s.goals.some((g) => g.metric === 'fatMass' && g.mode === 'lose')).toBe(false);
      if (trained) expect(s.goals[0]!.metric).toBe('skeletalMuscle');
    }
    // fasting limits only when the person already opted in
    expect(s.constraints.longestFastH !== undefined).toBe(input.safety.optedTier !== null);
    expect(checkAgainstRule(s, s)).toEqual([]);
  });

  it('summary of every case (golden record)', () => {
    const rows = CASES.map(([name, input]) => {
      const s = suggestGoals(input);
      const cands = s.candidates?.length ? ` | optional: ${s.candidates.map((c) => `${c.metric} ${c.mode}`).join(', ')}` : '';
      return `${name}: ${s.goals.map((g) => `${g.rank}.${g.metric} ${g.mode}${g.target !== undefined ? ` ${g.target}` : ''}`).join(' · ')}${cands}`;
    });
    expect(rows).toMatchSnapshot();
  });
});

describe('thin and special profiles', () => {
  it('an unanswered profile lists what is missing and suggests nothing', () => {
    const s = suggestGoals(UNANSWERED);
    expect(s.goals).toEqual([]);
    expect(s.constraints).toEqual({});
    const fields = s.missing.map((m) => m.field);
    expect(fields).toEqual(expect.arrayContaining(['body', 'trainingHistory', 'activity', 'trainingTime', 'food', 'markers']));
    for (const m of s.missing) expect(m.why).not.toMatch(INTERNAL);
  });

  it('a body without intake answers still suggests body goals, and lists the intake questions', () => {
    const input = { ...inputFor(PERSONAS.MAN_95!, { reach: false }) };
    const s = suggestGoals(input);
    // D4-06: without a supported route estimate there is no numeric loss; fat loss stays an option to choose
    expect(s.goals.length).toBeGreaterThan(0);
    expect(s.goals.some((g) => g.mode === 'lose')).toBe(false);
    expect(s.candidates?.map((c) => c.metric)).toContain('fatMass');
    expect(s.missing.map((m) => m.field)).toEqual(expect.arrayContaining(['activity', 'trainingTime', 'food']));
  });

  it('unknown training history: no muscle-vs-fat call in the band, and it is listed as missing', () => {
    const base = inputFor(PERSONAS.LEAN_MAN!, { reach: false });
    const s = suggestGoals({ ...base, body: { ...base.body, trainingAgeY: null } });
    expect(s.goals.some((g) => g.metric === 'skeletalMuscle')).toBe(false);
    expect(s.missing.map((m) => m.field)).toContain('trainingHistory');
  });

  it('a weight-loss lock from the safety answers removes the fat-loss goal and says why', () => {
    const base = inputFor(PERSONAS.OBESE_MAN!, { reach: false });
    const s = suggestGoals({ ...base, safety: { ...base.safety, noWeightLossGoal: true } });
    expect(s.goals.some((g) => g.mode === 'lose')).toBe(false);
    expect(s.notes.some((n) => n.topic === 'safety')).toBe(true);
  });

  it('constraints come from the intake; fasting only when opted in and within the safety cap', () => {
    const base = inputFor(PERSONAS.WOMAN_62!, {
      reach: false,
      optedTier: 'T3',
      intake: { training: { prefs: { daysPerWeek: 4, minPerSession: 45, bestTime: 'morning' }, access: ['home'], owned: ['dumbbells'] }, diet: { rulesComplete: true, animalFoods: { meat: 'none', eggs: 'yes', dairy: 'yes' } } },
    });
    const s = suggestGoals({ ...base, safety: { ...base.safety, maxFastHours: 48 } });
    expect(s.constraints).toMatchObject({ trainingDays: [2, 4], maxSessionMin: 45, trainingTimeH: 7, longestFastH: 48 });
    expect(s.notes.map((n) => n.topic)).toEqual(expect.arrayContaining(['equipment', 'food']));
    expect(s.notes.find((n) => n.topic === 'food')!.text).toContain('vegetarian with eggs');
  });

  it('the training note names the places from the intake rows, never "[object Object]" (Q3-J4-01)', () => {
    const access = [{ place: 'home', equipment: ['dumbbell'], weekdays: [0, 1, 2] }, { place: 'gym', equipment: ['barbell'], weekdays: [1, 3] }];
    const s = suggestGoals(inputFor(PERSONAS.WOMAN_62!, { reach: false, intake: { training: { access, owned: ['dumbbell', 'gada'] } } }));
    const text = s.notes.find((n) => n.topic === 'equipment')!.text;
    expect(text).toBe('Training: home and gym with 2 pieces of equipment, as you answered.');
    expect(text).not.toMatch(/object/);
  });

  it('high marker readings add marker goals with the reading behind them; urate is a note only', () => {
    const base = inputFor(PERSONAS.MAN_95!, { reach: false });
    const markers = labNotes({ ldlMmolL: 5.0, tgMmolL: 2.0, urateMgDl: 7.2, hba1cPct: 5.4 });
    expect(markers.map((m) => [m.markerId, m.severity])).toEqual([
      ['ldl', 'danger'],
      ['tg', 'caution'],
      ['urate', 'caution'],
    ]);
    const s = suggestGoals({ ...base, markers, markersAnswered: true });
    const ldl = s.goals.find((g) => g.metric === 'ldl');
    expect(ldl).toMatchObject({ mode: 'lower', because: { label: 'LDL', value: 5 } });
    expect(s.goals.find((g) => g.metric === 'triglycerides')?.mode).toBe('lower');
    expect(s.goals.findIndex((g) => g.metric === 'ldl')).toBeLessThan(s.goals.findIndex((g) => g.metric === 'triglycerides'));
    expect(s.notes.some((n) => n.topic === 'marker' && n.text.includes('uric acid'))).toBe(true);
    expect(s.missing.map((m) => m.field)).not.toContain('markers');
  });
});

describe('the AI variant: coercion and the rule oracle', () => {
  const rule = suggestGoals(inputFor(PERSONAS.MAN_95!, { reach: false }));
  const isMetric = (id: string) => ['fatMass', 'leanTissue', 'skeletalMuscle', 'strength', 'ldl', 'hunger', 'vo2max'].includes(id);
  const asRaw = (s: GoalSuggestion) => JSON.parse(JSON.stringify(s)) as unknown;

  it('a reply that agrees with the rules is accepted', () => {
    const raw = asRaw(rule) as Record<string, unknown>;
    const ai = coerceSuggestion({ ...raw, clarify: ['Do you lift at home or in a gym?', 'Any injuries?', 'third'] }, 'ai:test@1', isMetric)!;
    expect(ai.source).toBe('ai');
    expect(ai.clarify).toHaveLength(2);
    expect(checkAgainstRule(rule, ai)).toEqual([]);
    expect(reconcile(rule, ai, 'x').source).toBe('ai');
  });

  it('a reply with other first goals, a far target or a new limit falls back to the rules', () => {
    const withTarget = suggestGoals(SYNTH);
    expect(withTarget.goals[0]!.target).toBeDefined();
    const rawT = asRaw(withTarget) as GoalSuggestion;
    const far = coerceSuggestion({ ...rawT, goals: rawT.goals.map((g) => (g.target ? { ...g, target: g.target * 1.5 } : g)) }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(withTarget, far).some((i) => i.startsWith('target'))).toBe(true);
    const raw = asRaw(rule) as GoalSuggestion;
    const swapped = coerceSuggestion({ ...raw, goals: [{ metric: 'vo2max', mode: 'raise', targetFrom: 'direction', why: 'Fitness first.' }, ...raw.goals] }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(rule, swapped)).toContain('different first goals');
    const limit = coerceSuggestion({ ...raw, constraints: { longestFastH: 72 } }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(rule, limit)).toContain('limit longestFastH not from the answers');
    const dropped = coerceSuggestion({ ...raw, missing: [] }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(rule, dropped).some((i) => i.startsWith('missing'))).toBe(true);
    const out = reconcile(rule, swapped, 'The Coach couldn’t answer, so this comes from the built-in rules.');
    expect(out.source).toBe('rule');
    expect(out.fallback).toBeTruthy();
  });

  it('with nothing answered the AI may not invent goals', () => {
    const r = suggestGoals(UNANSWERED);
    const ai = coerceSuggestion({ goals: [{ metric: 'fatMass', mode: 'lose', target: 5, unit: 'kg', targetFrom: 'fastestSafeReach', why: 'Most people want this.' }], missing: r.missing }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(r, ai)).toContain('goals without enough answers');
  });

  it('unusable replies are rejected', () => {
    expect(coerceSuggestion('nope', 'v', isMetric)).toBeNull();
    expect(coerceSuggestion({ goals: [{ metric: 'madeUp', mode: 'raise', why: 'x' }] }, 'v', isMetric)!.goals).toEqual([]);
  });

  it('C6/D8-09: a suggestion never proposes a metric without an optimizable capability, whatever the caller allows', () => {
    const anyMetric = () => true;
    const raw = {
      goals: [
        { metric: 'enduranceCapacity', mode: 'raise', why: 'Endurance.' },
        { metric: 'adherence', mode: 'raise', why: 'Stick with it.' },
        { metric: 'ketoAdaptation', mode: 'raise', why: 'Adapt.' },
        { metric: 'micronutrientScore', mode: 'raise', why: 'Nutrients.' },
        { metric: 'hipBmdChange', mode: 'raise', why: 'Bones.' },
        { metric: 'vo2max', mode: 'raise', targetFrom: 'direction', why: 'Fitness.' },
      ],
    };
    expect(coerceSuggestion(raw, 'ai:test@1', anyMetric)!.goals.map((g) => g.metric)).toEqual(['vo2max']);
  });

  it('the rule suggester only proposes optimizable goals', () => {
    for (const [name, input] of CASES) for (const g of suggestGoals(input).goals) expect(isProductionGoalEligible(g.metric), `${name}: ${g.metric}`).toBe(true);
  });
});

describe('D4-06: signed reach, grid rounding, reference overlap and frozen structure', () => {
  const reachOf = (change: number, supported = true): GoalSuggestionInput['reach'] => [
    { goal: 0, metric: 'fatMass', supported, kind: change < 0 ? 'loss' : 'gain', start: 20, target: null, valueAtHorizon: 20 + change, changeAtHorizon: change, reachableInHorizon: null, weeks: null, beyondTwoYears: false, beyondSafetyLimits: false, ratePerWeek: 0, text: '', requestedHorizonDays: 112, coveredDays: 112, completeHorizon: true },
  ];
  const band35 = healthyBodyFatBand('male', 35);
  const man80 = (bf: number, bfBand: [number, number] | null, reach: GoalSuggestionInput['reach'], extra: Partial<GoalSuggestionInput> = {}): GoalSuggestionInput => ({
    profile: { complete: true, sex: 'male', ageYears: 35, heightCm: 178, weightKg: 80, habits: { trainingHistory: 'none' } },
    body: { bfPct: bf, bfBand, leanKg: 80 * (1 - bf / 100), trainingAgeY: 0 },
    intake: {},
    markers: [],
    safety: { noWeightLossGoal: false, optedTier: null },
    reach,
    ...extra,
  });

  it('floorToGrid rounds toward zero and never forces a number up to the grid', async () => {
    const { floorToGrid } = await import('../suggestGoals');
    expect(floorToGrid(0.2, 0.5)).toBeNull();
    expect(floorToGrid(0.49, 0.5)).toBeNull();
    expect(floorToGrid(0.01, 0.5)).toBeNull();
    expect(floorToGrid(0.5, 0.5)).toBe(0.5);
    expect(floorToGrid(1.24, 0.5)).toBe(1);
    expect(floorToGrid(0.3, 0.1)).toBe(0.3);
    expect(floorToGrid(-1, 0.5)).toBeNull();
    for (const raw of [0.2, 0.49, 0.5, 0.51, 0.99, 1.24, 3.333, 7.2]) {
      const q = floorToGrid(raw, 0.5);
      if (q !== null) expect(q).toBeLessThanOrEqual(raw);
    }
  });

  it('male 35 y / 80 kg, body fat 0.1 point above the reference with a broad interval and a −0.1 kg route: no numeric loss above 0.1 kg', () => {
    const bf = band35[1] + 0.1;
    const s = suggestGoals(man80(bf, [bf - 6, bf + 6], reachOf(-0.1)));
    const loss = s.goals.find((g) => g.metric === 'fatMass' && g.mode === 'lose');
    expect(loss === undefined || loss.target! <= 0.1).toBe(true);
    expect(loss).toBeUndefined();
    // neutral options first, fat loss only as a candidate, and the purpose question
    expect(s.goals[0]!.metric).not.toBe('fatMass');
    expect(s.candidates?.map((c) => c.metric)).toContain('fatMass');
    expect(s.purposeAsk).toEqual(expect.arrayContaining(['fatLoss', 'maintenance', 'strength']));
    expect(s.reference?.overlap).toBe('overlaps');
  });

  it('a tiny supported loss (0.01 kg) never becomes a 0.5-kg target, even clearly above the reference', () => {
    const s = suggestGoals(man80(30, [28, 32], reachOf(-0.01)));
    expect(s.goals.some((g) => g.mode === 'lose')).toBe(false);
    expect(s.candidates?.map((c) => c.metric)).toContain('fatMass');
  });

  it('property: 0 < target ≤ min(correctly signed supported reach, excess) whenever both exist', () => {
    let n = 0;
    for (let bf = band35[1] + 2; bf <= 40; bf += 1.7) {
      for (const change of [-0.3, -0.6, -1.24, -3.1, -9]) {
        const s = suggestGoals(man80(bf, [bf - 1.5, bf + 1.5], reachOf(change)));
        const loss = s.goals.find((g) => g.metric === 'fatMass' && g.mode === 'lose');
        const excess = fatAboveBandKg(80, bf, band35[1]);
        if (loss) {
          n++;
          expect(loss.target!).toBeGreaterThan(0);
          expect(loss.target!).toBeLessThanOrEqual(Math.min(-change, excess) + 1e-9);
        } else expect(Math.min(-change, excess)).toBeLessThan(0.5);
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('a missing, unsupported or wrong-sign reach claims no route target', () => {
    for (const reach of [[], reachOf(-4, false), reachOf(+2)]) {
      const s = suggestGoals(man80(32, [30, 34], reach));
      expect(s.goals.some((g) => g.targetFrom === 'fastestSafeReach')).toBe(false);
      expect(s.goals.some((g) => g.mode === 'lose')).toBe(false);
    }
    expect(signedReachKg({ reach: reachOf(+2) }, 'fatMass', 'loss')).toBeNull();
    expect(signedReachKg({ reach: reachOf(-2) }, 'fatMass', 'loss')).toBe(2);
    // Target attainment is separate from a supported full-horizon route. An incomplete prefix supplies no horizon target.
    const nf = reachOf(-2);
    nf[0] = { ...nf[0]!, outcome: 'notFoundWithinBudget' };
    expect(signedReachKg({ reach: nf }, 'fatMass', 'loss')).toBe(2);
    nf[0] = { ...nf[0]!, coveredDays: 49, completeHorizon: false };
    expect(signedReachKg({ reach: nf }, 'fatMass', 'loss')).toBeNull();
  });

  it('an absent interval stays uncertain (no automatic loss); an explicit fat-loss purpose may rank it', () => {
    const s = suggestGoals(man80(30, null, reachOf(-3)));
    expect(s.goals.some((g) => g.mode === 'lose')).toBe(false);
    expect(s.reference?.overlap).toBe('unknown');
    const chosen = suggestGoals(man80(30, null, reachOf(-3), { purpose: 'fatLoss' }));
    expect(chosen.goals[0]).toMatchObject({ metric: 'fatMass', mode: 'lose' });
    expect(chosen.purposeAsk).toBeUndefined();
  });

  it('a non-weight purpose is honoured even clearly above the reference', () => {
    const s = suggestGoals(man80(32, [30, 34], reachOf(-3), { purpose: 'strength' }));
    expect(s.goals.some((g) => g.mode === 'lose')).toBe(false);
    expect(s.goals[0]!.metric).toBe('strength');
    expect(s.candidates?.map((c) => c.metric)).toContain('fatMass');
  });

  it('glucose and HbA1c readings are notes, never an open-ended lower goal (a target band is required)', () => {
    const base = man80(22, [20, 24], []);
    const markers = labNotes({ hba1cPct: 6.0, fastingGlucoseMmolL: 6.1 });
    const s = suggestGoals({ ...base, markers, markersAnswered: true });
    expect(s.goals.some((g) => g.metric === 'fastingGlucose')).toBe(false);
    expect(s.notes.some((n) => n.topic === 'marker' && /target range/.test(n.text))).toBe(true);
  });

  describe('AI rewrites prose only', () => {
    const isMetric = () => true;
    const markerInput: GoalSuggestionInput = { ...SYNTH, markers: labNotes({ ldlMmolL: 5.0 }), markersAnswered: true, safety: { noWeightLossGoal: false, optedTier: 'T2' } };
    const rule = suggestGoals(markerInput);
    const raw = () => JSON.parse(JSON.stringify(rule)) as GoalSuggestion;
    const coerce = (r: unknown) => coerceSuggestion(r, 'ai:test@1', isMetric)!;

    it('the fixture has a numeric target, a marker reading, a limit and a required note', () => {
      expect(rule.goals[0]).toMatchObject({ metric: 'fatMass', target: 7, unit: 'kg', targetFrom: 'fastestSafeReach' });
      expect(rule.goals.some((g) => g.because)).toBe(true);
      expect(rule.constraints.longestFastH).toBeDefined();
      expect(rule.notes.some((n) => n.topic === 'marker')).toBe(true);
    });

    it('a prose-only rewrite passes and keeps every structured field and the structure hash', () => {
      const r = raw();
      const ai = coerce({ ...r, goals: r.goals.map((g) => ({ ...g, why: `${g.why} Reworded.` })), clarify: ['Morning or evening training?'] });
      expect(checkAgainstRule(rule, ai)).toEqual([]);
      const out = reconcile(rule, ai, 'fallback');
      expect(out.source).toBe('ai');
      expect(out.structureHash).toBe(rule.structureHash);
      expect(out.goals.map(({ why: _w, ...g }) => g)).toEqual(rule.goals.map(({ why: _w, ...g }) => g));
      expect(out.goals[0]!.why).toMatch(/Reworded/);
      expect(out.constraints).toEqual(rule.constraints);
      expect(out.notes.filter((n) => n.topic === 'marker' || n.topic === 'safety')).toEqual(rule.notes.filter((n) => n.topic === 'marker' || n.topic === 'safety'));
    });

    const mutations: Array<[string, (r: GoalSuggestion) => unknown]> = [
      ['target deleted', (r) => ({ ...r, goals: r.goals.map((g, i) => (i === 0 ? { ...g, target: undefined } : g)) })],
      ['target changed by 2 %', (r) => ({ ...r, goals: r.goals.map((g, i) => (i === 0 ? { ...g, target: g.target! * 1.02 } : g)) })],
      ['unit removed', (r) => ({ ...r, goals: r.goals.map((g, i) => (i === 0 ? { ...g, unit: undefined } : g)) })],
      ['unit changed', (r) => ({ ...r, goals: r.goals.map((g, i) => (i === 0 ? { ...g, unit: 'lb' } : g)) })],
      ['direction changed', (r) => ({ ...r, goals: r.goals.map((g, i) => (i === 0 ? { ...g, mode: 'gain' } : g)) })],
      ['target provenance changed', (r) => ({ ...r, goals: r.goals.map((g, i) => (i === 0 ? { ...g, targetFrom: 'band' } : g)) })],
      ['marker reading removed', (r) => ({ ...r, goals: r.goals.map((g) => (g.because ? { ...g, because: undefined } : g)) })],
      ['limit removed', (r) => ({ ...r, constraints: { ...r.constraints, longestFastH: undefined } })],
      ['marker note removed', (r) => ({ ...r, notes: r.notes.filter((n) => n.topic !== 'marker') })],
      ['rule goal dropped', (r) => ({ ...r, goals: r.goals.slice(0, -1) })],
      ['extra weight goal', (r) => ({ ...r, goals: [...r.goals.slice(0, 5), { metric: 'scaleWeight', mode: 'lower', targetFrom: 'direction', why: 'Weigh less.' }] })],
    ];
    it.each(mutations)('%s fails the check and falls back to the rules', (_name, mutate) => {
      const ai = coerce(mutate(raw()));
      expect(checkAgainstRule(rule, ai).length).toBeGreaterThan(0);
      const out = reconcile(rule, ai, 'fallback');
      expect(out.source).toBe('rule');
      expect(out.structureHash).toBe(rule.structureHash);
    });
  });
});
