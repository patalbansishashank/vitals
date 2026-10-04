import { describe, expect, it } from 'vitest';
import { qaRequest, QA_KEYS } from '../../__tests__/qa/requests';
import {
  checkAgainstRule,
  coerceSuggestion,
  fatAboveBandKg,
  healthyBodyFatBand,
  labNotes,
  reconcile,
  suggestGoals,
  type GoalSuggestion,
  type GoalSuggestionInput,
} from '../suggestGoals';
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

const UNANSWERED: GoalSuggestionInput = {
  profile: { complete: false, sex: null, ageYears: null, heightCm: null, weightKg: null },
  body: { bfPct: null, bfBand: null, leanKg: null, trainingAgeY: null },
  intake: {},
  markers: [],
  devices: {},
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
    expect(s.version).toBe('rule@1');
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
    if (bf > band[1]) {
      // fat loss first above the healthy band; recomposition when also training
      expect(s.goals[0]).toMatchObject({ metric: 'fatMass', mode: 'lose' });
      expect(s.goals[1]!.metric).toBe(trained ? 'skeletalMuscle' : 'leanTissue');
      const fat = input.reach.find((r) => r.metric === 'fatMass');
      expect(s.goals[0]!.target!).toBeLessThanOrEqual(Math.max(0.5, fatAboveBandKg(input.profile.weightKg!, bf, band[1])) + 1e-9);
      if (fat?.supported) expect(s.goals[0]!.target!).toBeLessThanOrEqual(Math.max(0.5, Math.abs(fat.changeAtHorizon)) + 1e-9);
    } else {
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
      return `${name}: ${s.goals.map((g) => `${g.rank}.${g.metric} ${g.mode}${g.target !== undefined ? ` ${g.target}` : ''}`).join(' · ')}`;
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
    expect(fields).toEqual(expect.arrayContaining(['body', 'trainingHistory', 'activity', 'trainingTime', 'food', 'markers', 'sleep']));
    for (const m of s.missing) expect(m.why).not.toMatch(INTERNAL);
  });

  it('a body without intake answers still suggests body goals, and lists the intake questions', () => {
    const input = { ...inputFor(PERSONAS.MAN_95!, { reach: false }) };
    const s = suggestGoals(input);
    expect(s.goals[0]!.metric).toBe('fatMass');
    expect(s.goals[0]!.targetFrom).toBe('band');
    expect(s.missing.map((m) => m.field)).toEqual(expect.arrayContaining(['activity', 'trainingTime', 'food', 'sleep']));
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

  it('device sleep debt over an hour a night frees the sleep limit and says so', () => {
    const base = inputFor(PERSONAS.WOMAN_62!, { reach: false });
    const s = suggestGoals({ ...base, devices: { sleepDebtH: 1.4, sleepNights: 14 } });
    expect(s.constraints.sleepFixed).toBe(false);
    expect(s.notes.find((n) => n.topic === 'sleep')!.text).toContain('1.4 h');
    expect(suggestGoals({ ...base, devices: { sleepDebtH: 0.6, sleepNights: 14 } }).constraints.sleepFixed).toBeUndefined();
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
    const raw = asRaw(rule) as GoalSuggestion;
    const swapped = coerceSuggestion({ ...raw, goals: [{ metric: 'vo2max', mode: 'raise', why: 'Fitness first.' }, ...raw.goals] }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(rule, swapped)).toContain('different first goals');
    const far = coerceSuggestion({ ...raw, goals: raw.goals.map((g) => (g.target ? { ...g, target: g.target * 1.5 } : g)) }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(rule, far).some((i) => i.startsWith('target'))).toBe(true);
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
    const ai = coerceSuggestion({ goals: [{ metric: 'fatMass', mode: 'lose', target: 5, why: 'Most people want this.' }], missing: r.missing }, 'ai:test@1', isMetric)!;
    expect(checkAgainstRule(r, ai)).toContain('goals without enough answers');
  });

  it('unusable replies are rejected', () => {
    expect(coerceSuggestion('nope', 'v', isMetric)).toBeNull();
    expect(coerceSuggestion({ goals: [{ metric: 'madeUp', mode: 'raise', why: 'x' }] }, 'v', isMetric)!.goals).toEqual([]);
  });
});
