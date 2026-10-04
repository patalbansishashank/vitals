/**
 * Planner labels are the planner's own (release check 2026-10-01): verdicts come from the engine's scorecard fields
 * (`met`, feasibility status), percentages are the engine's numbers printed with one formatter (the engine's rounding,
 * not clamped), phase % labels come from the engine's phase text, and energy readouts follow the kcal/kJ setting.
 */
import { describe, expect, it } from 'vitest';
import type { GoalFeasibility, GoalScore, PhaseExplanation } from '@/engine/planner/domain/types';
import { goalVerdict, isKeepGoal, nearBest, phaseTip, scoreView } from '../components/PlanParts';
import { fmtKcal, fmtMetric, fmtPct } from '../format';
import { chartPhases, enginePhasePct, phaseBalance, phaseFacts, type PhaseFact } from '../planFacts';
import { buildPrescription, prescriptionCsv, prescriptionText } from '../prescription';
import { PROFILE, fixtureResult, fixtureSchedule, fixtureSimulation } from './fixtures';

const keepGoal = { target: 0, targetKind: 'change' as const };
const score = (over: Partial<GoalScore>): GoalScore => ({
  goal: 1,
  metric: 'leanTissue',
  label: 'Lean tissue (protein-based)',
  unit: 'kg',
  direction: 'target',
  start: 62,
  value: 62,
  change: 0,
  target: 62,
  percentOfAchievable: 100,
  percentOfTarget: 100,
  met: true,
  costVsA: 0,
  band: null,
  grade: 'B',
  ...over,
});
const unattainable: GoalFeasibility = { goal: 1, metric: 'leanTissue', label: 'Lean tissue', status: 'unattainable', baseline: 62, bestAchievable: 61.9, target: 62, nearestAttainableTarget: null, requiredWeeks: null, requiredHorizonDays: null, text: '' };

describe('verdicts are the engine’s', () => {
  it('a keep goal the scorecard marks met at ±0.0 kg reads "kept", never "not reachable"', () => {
    const sc = score({ value: 61.996, change: -0.004, met: true });
    expect(isKeepGoal(keepGoal)).toBe(true);
    // even when a (stale) feasibility row says unattainable, the scorecard's own `met` decides
    const v = scoreView(sc, unattainable, 'metric', 12, false, keepGoal);
    expect(v).toMatchObject({ status: 'reached', word: 'kept' });
    expect(v.value).toBe(fmtMetric('leanTissue', -0.004, 'metric', { signed: true }));
    expect(v.value).toMatch(/^±0\.0/);
    // the same verdict for must-strength goals
    expect(scoreView(sc, unattainable, 'metric', 12, true, keepGoal).word).toBe('kept');
  });

  it('the planner’s `verdict` decides the word; a kept goal never shows a "0 % chance"', () => {
    // verdict 'kept' wins even over a stale `met`, and for goals without the keep target shape
    expect(goalVerdict(score({ met: false, verdict: 'kept' }), unattainable, true, false)).toEqual({ status: 'reached', word: 'kept' });
    expect(goalVerdict(score({ met: true, verdict: 'reached' }), undefined, false, true).word).toBe('reached');
    expect(goalVerdict(score({ met: true, verdict: 'notReached' }), unattainable, false, true).word).toBe('not kept');
    // the ensemble's P(exactly ±0) is 0 % for a held goal: the row reads the planner's % of achievable instead
    const kept = score({ value: 61.8, change: -0.2, verdict: 'kept', band: { p10: 61.8, p50: 61.8, p90: 61.9, pTargetMet: 0 } });
    const v = scoreView(kept, undefined, 'metric', 16, false, keepGoal);
    expect(v.word).toBe('kept');
    expect(v.detail).toMatch(/100 % of what’s possible$/);
    expect(v.detail).not.toMatch(/chance/);
    // other goals keep their chance
    const reached = score({ target: 58, verdict: 'reached', band: { p10: 57, p50: 57.5, p90: 58, pTargetMet: 0.78 } });
    expect(scoreView(reached, undefined, 'metric', 16, false, { target: -4, targetKind: 'change' }).detail).toMatch(/78 % chance/);
  });

  it('a keep goal the scorecard marks unmet reads "not kept"; a target goal keeps its own words', () => {
    const miss = score({ value: 61.5, change: -0.5, met: false });
    expect(goalVerdict(miss, unattainable, false, true)).toEqual({ status: 'missed', word: 'not kept' });
    expect(goalVerdict(miss, undefined, false, true).word).toBe('not kept');
    expect(goalVerdict(miss, unattainable, false, false).word).toBe('not reachable');
    expect(goalVerdict(score({ met: true }), undefined, false, false).word).toBe('reached');
  });

  it('prints the engine % with the engine rounding, and decides "near its best" on the printed number', () => {
    const dir = (p: number) => score({ target: null, met: null, percentOfAchievable: p, percentOfTarget: null });
    // 89.5 prints "90 %" (as the engine's explanation does, Math.round) → near its best, never "partial · 90 %"
    expect(scoreView(dir(89.5), undefined, 'metric', 12, false, undefined)).toMatchObject({ word: 'near its best', value: '90 % of what’s possible' });
    expect(nearBest(dir(89.4))).toBe(false);
    expect(scoreView(dir(89.4), undefined, 'metric', 12, false, undefined)).toMatchObject({ word: 'partial', value: '89 % of what’s possible' });
    // not clamped: the same number the engine's own sentence prints
    expect(scoreView(dir(101.2), undefined, 'metric', 12, false, undefined).value).toBe('101 % of what’s possible');
    expect(fmtPct(-0.4)).toBe('0 %');
    expect(fmtPct(62)).toBe(`${Math.round(62)} %`);
  });
});

describe('phase % labels come from the engine’s phase text', () => {
  const ph = (name: string, summary: string): PhaseExplanation => ({ name, blockId: 'B1', startDay: 0, endDay: 28, weeks: 4, summary, why: '' });

  it('reads the planner’s % from its summary (or name) and never labels a phase with another %', () => {
    expect(enginePhasePct(ph('Deficit 22 % · protein 2.0 g/kg', 'energy 78 % of your maintenance with this plan’s training and steps'))).toEqual({ pct: 78, otherDays: false });
    expect(enginePhasePct(ph('Two 600-kcal days a week, other days 80 %', 'two non-consecutive days at 600 kcal, other days 80 % of your maintenance'))).toEqual({ pct: 80, otherDays: true });
    expect(enginePhasePct(ph('Surplus 6 % · protein 1.8 g/kg', 'resistance training 3×/week'))).toEqual({ pct: 106, otherDays: false });
    expect(enginePhasePct(ph('72-hour water-only fast × 1', 'Starts after the last meal (19:00).'))).toBeNull();
  });

  it('the option title, phase name, tooltip, table and chart label print the same %', () => {
    const base = fixtureResult().options[0]!;
    const option = {
      ...base,
      name: 'Steady deficit (−22 %)',
      phases: [
        ph('Deficit 22 % · protein 2.0 g/kg', 'energy 78 % of your maintenance with this plan’s training and steps (re-set every 4 weeks); protein 2.0 g/kg.'),
      ],
    };
    const rx = buildPrescription(option.schedule, PROFILE, option.simulation);
    const [f] = phaseFacts(option, rx) as [PhaseFact];
    expect(f.enginePct).toBe(78);
    // the name already states the balance: no second label, so no second %
    expect(phaseBalance(f)).toBeNull();
    expect(chartPhases([f])[0]!.balance).toBeUndefined();
    const tip = phaseTip(f, 'kcal');
    const pcts = (t: string) => [...t.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => m[1]);
    expect(pcts(tip)).toEqual(['22']);
    expect(pcts(option.name)).toEqual(['22']);
    expect(100 - f.enginePct!).toBe(22);
    // a phase whose name does not state the balance gets the engine's own words for the engine's own %
    const g: PhaseFact = { ...f, name: 'Recomposition block', enginePct: 97.6, enginePctOtherDays: false };
    expect(phaseBalance(g)).toBe('maintenance');
    expect(phaseBalance({ ...g, enginePct: 77.5 })).toBe('deficit 22 %');
    // "other days" %: the name carries it, no whole-phase label is invented
    expect(phaseBalance({ ...g, enginePct: 80, enginePctOtherDays: true })).toBeNull();
  });
});

describe('energy readouts follow the kcal/kJ setting', () => {
  const rx = buildPrescription(fixtureSchedule(), PROFILE, fixtureSimulation(20));

  it('formats planner energy in kJ when chosen', () => {
    expect(fmtKcal(2300, 'kcal')).toBe('2\u00a0300\u2009kcal');
    expect(fmtKcal(2300, 'kJ')).toBe('9\u00a0620\u2009kJ');
    expect(fmtMetric('tdee', 2500, 'metric', { energy: 'kJ' })).toBe('10\u00a0460\u2009kJ/d');
    expect(fmtMetric('tdee', 2500, 'metric')).toBe('2\u00a0500\u2009kcal/d');
  });

  it('exports the day-by-day prescription in the chosen unit', () => {
    const csv = prescriptionCsv(rx, 'Hard plan', 'kJ').split('\n');
    expect(csv[0]).toMatch(/,energy kJ,/);
    const monKj = Number(csv[1]!.split(',')[5]);
    expect(monKj).toBeCloseTo(rx.days[0]!.energyKcal * 4.184, 0);
    const text = prescriptionText(rx, { planTitle: 'Hard plan', planName: 'x', scorecard: [], phases: [], safety: [], disclaimer: 'd', energy: 'kJ' });
    expect(text).toMatch(/9 620 kJ · P 180 g/);
    expect(text).not.toMatch(/kcal/);
    const f = phaseFacts(fixtureResult().options[0]!, rx)[0]!;
    if (Number.isFinite(f.balanceKcal)) expect(phaseTip(f, 'kJ')).toMatch(/kJ a day/);
    if (Number.isFinite(f.maintKcal)) expect(phaseTip(f, 'kJ')).not.toMatch(/kcal/);
  });
});
