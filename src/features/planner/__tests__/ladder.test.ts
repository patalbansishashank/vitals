/**
 * The plan ladder as the screens read it (design/screens/plan-ladder.md): fixed order Hard · Medium · Easy ‖ Ideal,
 * Medium selected first (else Hard), collapsed rungs become chips with the engine's sentence, an Ideal equal to Hard
 * is no card of its own, the ladder graph's two modes, carried rungs, the seven burdens in fixed order,
 * the comparison table's row order, "Adopt some of these limits" patches, the goal screen's longest-fast default and
 * its "Allow 72 h fasts" action, and no plan letters or internal references in any generated text.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { DIFFICULTY_COMPONENTS, type ConvergencePoint, type PlannerProgressV2 } from '@/engine/planner/domain/types';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { withSystemWrite } from '@/state/scope';
import { editGoals } from '../commands';
import { hintOps } from '../GoalsView';
import {
  BURDEN_INACTIVE,
  BURDEN_LABEL,
  adoptKnob,
  adoptPatch,
  burdenRows,
  carriedNote,
  collapsedChips,
  collapsedSlot,
  comparisonRows,
  defaultKind,
  effortHeader,
  fastingLine,
  idealCosts,
  idealSameAsHard,
  kindFromParams,
  ladderGraphData,
  ladderScale,
  liftedText,
  mergePatches,
  outcomeView,
  planLabel,
  presentKinds,
  snapLongestFast,
} from '../ladder';
import { defaultConstraints, defaultLongestFast, effectiveConstraints } from '../request';
import { plateauOf, recordLadderProgress, useLadderRun } from '../run';
import { PROFILE, fixtureConvergence, fixtureDifficulty, fixtureLadder, fixtureLadderCase, fixtureRequest, LIMIT_COSTS } from './fixtures';

const LETTERS = /\b(?:[Pp]lans?|[Oo]ptions?) [ABC]\b|\b[ABC]\/[ABC]\b/;
const goals = fixtureRequest().goals;

describe('rung order and default selection', () => {
  it('keeps Hard · Medium · Easy ‖ Ideal and selects Medium first, else Hard', () => {
    const full = fixtureLadder();
    expect(presentKinds(full)).toEqual(['hard', 'medium', 'easy', 'ideal']);
    expect(defaultKind(full)).toBe('medium');
    const noMedium = fixtureLadder({}, { rungs: ['hard', 'easy'] });
    expect(presentKinds(noMedium)).toEqual(['hard', 'easy', 'ideal']);
    expect(defaultKind(noMedium)).toBe('hard');
    const onlyHard = fixtureLadder({}, { rungs: ['hard'], ideal: false });
    expect(presentKinds(onlyHard)).toEqual(['hard']);
    expect(defaultKind(onlyHard)).toBe('hard');
  });

  it('reads ?rung= (older ?plan= links land on their rung; unknown or missing rungs fall back to the default)', () => {
    const v2 = fixtureLadder();
    expect(kindFromParams(new URLSearchParams('rung=ideal'), v2)).toBe('ideal');
    expect(kindFromParams(new URLSearchParams('rung=easy&tab=days'), v2)).toBe('easy');
    expect(kindFromParams(new URLSearchParams('plan=a'), v2)).toBe('hard');
    expect(kindFromParams(new URLSearchParams('rung=nonsense'), v2)).toBe('medium');
    expect(kindFromParams(new URLSearchParams('rung=medium'), fixtureLadder({}, { rungs: ['hard', 'easy'] }))).toBe('hard');
  });
});

describe('collapsed rungs become chips', () => {
  it('shows the engine’s sentence with the engraved rung name, and nothing for a present rung', () => {
    const v2 = fixtureLadder({}, { rungs: ['hard', 'easy'] });
    expect(collapsedSlot(v2, 'medium')).toEqual({ title: 'medium', text: 'not distinct · Easy already reaches 95 % of Hard’s fat loss; a harder plan buys little.' });
    expect(collapsedSlot(v2, 'hard')).toBeNull();
    // a rung the search did not reach before it was stopped
    const stopped = fixtureLadder({ complete: false, ladder: { ...v2.ladder, collapsed: [] } }, { rungs: ['hard'] });
    expect(collapsedSlot(stopped, 'easy')!.text).toBe('Not found before the search stopped.');
  });
});

describe('the seven burdens', () => {
  it('are always seven rows in fixed order with the engine’s sentence; inactive ones draw no bar', () => {
    const d = fixtureDifficulty(0.5, { inactive: ['fastingLoad'] });
    const rows = burdenRows({ ...d, components: [...d.components].reverse() });
    expect(rows.map((r) => r.id)).toEqual([...DIFFICULTY_COMPONENTS]);
    expect(rows.map((r) => r.label)).toEqual(['deficit', 'hunger', 'training time', 'fasting load', 'eating window', 'daily decisions', 'change from now']);
    expect(rows.find((r) => r.id === 'trainingTime')!.text).toBe('4 h a week, 2 h more than now');
    const fasting = rows.find((r) => r.id === 'fastingLoad')!;
    expect(fasting).toMatchObject({ active: false, value: 0, text: BURDEN_INACTIVE });
    expect(effortHeader(d)).toBe('effort 50 / 100 · hardest part: hunger');
    expect(Object.keys(BURDEN_LABEL)).toEqual([...DIFFICULTY_COMPONENTS]);
  });

  it('lets the Ideal run past your limit (hatched), and gentle mode turns the deficit and fasting burdens off', () => {
    const ideal = burdenRows(fixtureDifficulty(0.8, { over: 1.2 }), { ideal: true });
    expect(ideal.find((r) => r.id === 'deficit')!.over).toBeCloseTo(0.2, 5);
    expect(burdenRows(fixtureDifficulty(0.8, { over: 1.2 })).every((r) => r.over === 0)).toBe(true);
    const gentle = burdenRows(fixtureDifficulty(0.5), { gentle: true });
    expect(gentle.filter((r) => !r.active).map((r) => r.id)).toEqual(['deficit', 'fastingLoad']);
  });
});

describe('goal rows', () => {
  it('reads the holdout P50 and band as a change, the verdict with time to target, and the difference to Hard', () => {
    const v2 = fixtureLadder();
    const hard = outcomeView(v2.rungs.hard!.summary.outcomes[0]!, goals[0], 'hard', 'metric');
    expect(hard.value).toBe('−5.2\u2009kg');
    expect(hard.range).toBe('likely 4.6–5.8\u2009kg');
    expect(hard.verdict).toBe('reached in about 3 weeks · 82 % chance');
    // quick searches round the chance to 10 %
    expect(outcomeView(v2.rungs.hard!.summary.outcomes[0]!, goals[0], 'hard', 'metric', { roundChance: true }).verdict).toBe('reached in about 3 weeks · 80 % chance');
    expect(hard.vsHard).toBeNull();
    const medium = outcomeView(v2.rungs.medium!.summary.outcomes[0]!, goals[0], 'medium', 'metric');
    expect(medium.verdict).toBe('about 6 weeks at this plan’s effort');
    expect(medium.vsHard).toBe('1.1\u2009kg less lost than Hard');
    expect(outcomeView(v2.rungs.medium!.summary.outcomes[1]!, goals[1], 'medium', 'metric').verdict).toBe('kept');
    const dir = outcomeView(v2.rungs.hard!.summary.outcomes[2]!, goals[2], 'hard', 'metric');
    expect(dir.value).toBe('↑ 62 % of what’s possible');
    expect(dir.verdict).toBe('partial · grade D');
  });

  it('says "less lost" when both plans lose a gain goal, and "the same as Hard" when the shown values tie (Q3-J4-07)', () => {
    const v2 = fixtureLadder();
    const base = v2.rungs.medium!.summary.outcomes[1]!;
    const gain = { ...goals[1]!, direction: 'target' as const, target: 1, targetKind: 'change' as const };
    // Easy −0.3 kg against Hard −0.8 kg: half a kilo less lost, never "more gained"
    expect(outcomeView({ ...base, change: -0.3, p50: 61.7, vsHard: 0.5 }, gain, 'easy', 'metric').vsHard).toBe('0.5\u2009kg less lost than Hard');
    expect(outcomeView({ ...base, change: -0.8, p50: 61.2, vsHard: -0.5 }, gain, 'easy', 'metric').vsHard).toBe('0.5\u2009kg more lost than Hard');
    // −0.12 against −0.06 (vsHard rounds to 0.1) both show as −0.1 kg
    expect(outcomeView({ ...base, change: -0.06, p50: 61.94, vsHard: 0.06 }, gain, 'easy', 'metric').vsHard).toBe('the same as Hard');
    // both gain: still "gained"
    expect(outcomeView({ ...base, change: 0.9, p50: 62.9, vsHard: 0.4 }, gain, 'easy', 'metric').vsHard).toBe('0.4\u2009kg more gained than Hard');
  });
});

describe('fasting line', () => {
  it('names what the plan does, never calls a short window a fast, and points to the rejected rival', () => {
    const v2 = fixtureLadder();
    expect(fastingLine(v2.rungs.medium!.summary.fasting, v2.fasting).text).toBe('24-hour fasts');
    expect(fastingLine(v2.rungs.hard!.summary.fasting, v2.fasting)).toEqual({ text: 'no fast · a plan with 24-hour fasts was considered', rival: true });
    const tre = fastingLine({ used: false, kind: 'eatingWindow', longestFastH: 16, text: '' }, { offered: false, reason: '' });
    expect(tre.text).toBe('time-restricted eating · no fast');
    expect(tre.text).not.toMatch(/\d+-hour fast/);
    expect(fastingLine({ used: false, kind: 'none', longestFastH: 0, text: '' }, { offered: false, reason: 'Fasting wasn’t considered: muscle gain ranks above your autophagy goal.' }).text).toBe(
      'no fast · fasting wasn’t considered: muscle gain ranks above your autophagy goal',
    );
  });
});

describe('comparison table', () => {
  it('keeps the contract’s effort-first row order, the Ideal column alone adds what your limits cost', () => {
    const v2 = fixtureLadder();
    const rows = comparisonRows(v2, goals, 'metric');
    expect(rows.map((r) => r.id)).toEqual([
      'effort',
      ...DIFFICULTY_COMPONENTS.map((id) => `burden-${id}`),
      'goal-0',
      'goal-1',
      'goal-2',
      'time',
      'hunger',
      'training',
      'window',
      'fasting',
      'buy',
      'limits',
      'safety',
      'cost',
    ]);
    expect(rows[0]!.cells).toEqual({ hard: '64 / 100', medium: '41 / 100', easy: '18 / 100', ideal: '82 / 100' });
    const cost = rows.find((r) => r.id === 'cost')!;
    expect(Object.keys(cost.cells)).toEqual(['ideal']);
    expect(cost.cells.ideal).toMatch(/^allowing 5 training days instead of 3 training days · \+0\.6\u2009kg fat mass loss · effort \+9/);
    expect(cost.cells.ideal).toMatch(/together, through interactions: \+0\.3\u2009kg fat mass loss$/);
    expect(rows.find((r) => r.id === 'training')!.cells.hard).toBe('4 h a week');
    // without the Ideal: no cost row
    expect(comparisonRows(fixtureLadder({}, { ideal: false }), goals, 'metric').some((r) => r.id === 'cost')).toBe(false);
  });

  it('prints no plan letters and no internal references', () => {
    const v2 = fixtureLadder();
    const texts = comparisonRows(v2, goals, 'metric').flatMap((r) => [r.label, ...Object.values(r.cells)]);
    texts.push(...idealCosts(v2.ideal!, goals, 'metric').rows.flatMap((r) => [r.lead, ...r.deltas]));
    texts.push(ladderScale(v2, goals[0], 'metric').summary, planLabel('hard', 'Deficit 22 %'));
    for (const t of texts) {
      expect(t).not.toMatch(LETTERS);
      expect(leak(t ?? '')).toBeNull();
    }
  });
});

describe('the ladder strip', () => {
  it('places the rungs at (effort, goal 1 change) on the frontier and the Ideal as a ceiling', () => {
    const s = ladderScale(fixtureLadder(), goals[0], 'metric');
    expect(s.points.map((p) => [p.kind, p.x, Number(p.y.toFixed(1))])).toEqual([
      ['hard', 64, -5.2],
      ['medium', 41, -4.1],
      ['easy', 18, -2.5],
    ]);
    expect(s.points[0]!.label).toBe('Hard −5.2');
    expect(s.ceiling!.label).toBe('ceiling (Ideal) −5.8\u2009kg');
    // the frontier passes through Hard
    const atHard = s.frontier.find((p) => p.x === 64)!;
    expect(atHard.y).toBeCloseTo(-5.2, 5);
    expect(s.summary).toBe('Hard reaches −5.2 kg at effort 64; Medium reaches −4.1 kg at effort 41; Easy reaches −2.5 kg at effort 18; without your limits −5.8 kg.');
  });
});

describe('Adopt some of these limits', () => {
  const current = { ...defaultConstraints(PROFILE.habits), trainingDays: [2, 3] as [number, number], earliestH: 10, latestH: 18 };

  it('turns a limit cost into the goal screen’s limit patch (only what changes)', () => {
    expect(adoptPatch(LIMIT_COSTS[0]!.adopt, current)).toEqual({ trainingDays: [2, 5] });
    expect(adoptPatch(LIMIT_COSTS[1]!.adopt, current)).toEqual({ earliestH: 8, latestH: 20 });
    // equipment is not a goal-screen limit
    expect(adoptPatch(LIMIT_COSTS[2]!.adopt, current)).toEqual({});
    // the longest fast snaps to the offered values; fasting allowed lifts a refusal to 24 h; floors come off
    expect(adoptPatch({ maxFastHours: 60 }, { ...current, longestFastH: 24 })).toEqual({ longestFastH: 48 });
    expect(adoptPatch({ fasting: 'allowed' }, { ...current, longestFastH: 16 })).toEqual({ longestFastH: 24 });
    expect(adoptPatch({ proteinFloorGPerKg: undefined, carbFloorGPerDay: undefined }, { ...current, proteinFloor: 2, carbFloorG: 100 })).toEqual({ proteinFloor: null, carbFloorG: 0 });
    expect(adoptPatch({ excludedLevers: ['creatine', 'fastDay24', 'L5'] }, current)).toEqual({ excluded: ['creatine'] });
    expect(snapLongestFast(20, 24)).toBe(24);
    expect(mergePatches([{ trainingDays: [2, 5] }, { earliestH: 8, latestH: 20 }])).toEqual({ trainingDays: [2, 5], earliestH: 8, latestH: 20 });
  });

  it('offers an intermediate value bounded by the Ideal’s value', () => {
    const days = adoptKnob(LIMIT_COSTS[0]!, current)!;
    expect(days).toMatchObject({ label: 'training days', min: 3, max: 5, step: 1 });
    expect(days.patch(4)).toEqual({ trainingDays: [2, 4] });
    const window = adoptKnob(LIMIT_COSTS[1]!, current)!;
    expect(window).toMatchObject({ label: 'eating window', min: 8, max: 12, unit: 'h' });
    expect(window.patch(10)).toEqual({ earliestH: 9, latestH: 19 });
    expect(adoptKnob(LIMIT_COSTS[2]!, current)).toBeNull();
  });
});

describe('the longest fast on the goals screen', () => {
  beforeEach(() => {
    localStorage.clear();
    withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({}), goals: [], run: EMPTY_RUN }));
  });

  it('follows the opted-in fasting tier until the user sets it', () => {
    expect(defaultLongestFast(null)).toBe(24);
    expect(defaultLongestFast('T2')).toBe(48);
    expect(defaultLongestFast('T3')).toBe(72);
    // never above what the safety answers allow
    expect(defaultLongestFast('T3', 48)).toBe(48);
    expect(defaultLongestFast('T2', 20)).toBe(48);
    expect(effectiveConstraints({}, PROFILE.habits, { optedTier: 'T3', maxFastHours: 72 }).longestFastH).toBe(72);
    expect(effectiveConstraints({}, PROFILE.habits, { optedTier: 'T2', maxFastHours: 48 }).longestFastH).toBe(48);
    expect(effectiveConstraints({}, PROFILE.habits, { optedTier: null, maxFastHours: 24 }).longestFastH).toBe(24);
    // the user's own value wins
    expect(effectiveConstraints({ longestFastH: 24 }, PROFILE.habits, { optedTier: 'T3', maxFastHours: 72 }).longestFastH).toBe(24);
    // callers without the tier keep the old default
    expect(effectiveConstraints({}, PROFILE.habits).longestFastH).toBe(24);
  });

  it('"Allow 72 h fasts" sets the longest fast through the goals edit', () => {
    const ops = hintOps({ kind: 'set-longest-fast', hours: 72, label: 'Allow 72 h fasts' })!;
    expect(ops).toEqual([{ op: 'setLimits', patch: { longestFastH: 72 } }]);
    editGoals(ops);
    expect(usePlannerStore.getState().constraints.longestFastH).toBe(72);
    expect(hintOps({ kind: 'set-longest-fast', hours: 48, label: 'Allow 48 h fasts' })).toEqual([{ op: 'setLimits', patch: { longestFastH: 48 } }]);
    expect(hintOps({ kind: 'edit-limits', label: 'Edit limits' })).toBeNull();
  });
});

describe('run extras', () => {
  const pt = (eu: number, stage: string, G: number): ConvergencePoint => ({ eu, wallMs: eu, stage, keyHard: [], G, hvLadder: G / 2 });

  it('keeps the provisional rungs by kind and the convergence curve', () => {
    useLadderRun.setState({ provisional: {}, convergence: [] });
    const p = (over: Partial<PlannerProgressV2>): PlannerProgressV2 => ({ stage: 'race', fraction: 0.2, euUsed: 1, euBudget: 10, score: null, provisional: {}, changed: true, ...over });
    const schedule = fixtureLadder().rungs.hard!.schedule;
    recordLadderProgress(p({ provisional: { hard: { structureId: 's', title: 'Hard', D: 0.6, percentOfAchievable: [90], schedule } }, convergence: pt(10, 'race', 0.5) }));
    recordLadderProgress(p({ provisional: { easy: { structureId: 's', title: 'Easy', D: 0.2, percentOfAchievable: [50], schedule } }, convergence: pt(20, 'race', 0.6) }));
    recordLadderProgress(p({ convergence: pt(20, 'race', 0.6) })); // same point again: not repeated
    const s = useLadderRun.getState();
    expect(Object.keys(s.provisional)).toEqual(['hard', 'easy']);
    expect(s.convergence.map((c) => c.eu)).toEqual([10, 20]);
  });

  it('detects two rounds without a better plan (Continue / Stop here)', () => {
    expect(plateauOf([pt(1, 'r1', 0.5), pt(2, 'r2', 0.7), pt(3, 'r3', 0.8)]).plateau).toBe(false);
    expect(plateauOf([pt(1, 'r1', 0.5), pt(2, 'r2', 0.8), pt(3, 'r3', 0.8), pt(4, 'r4', 0.79)])).toEqual({ rounds: 4, plateau: true });
    expect(plateauOf([pt(1, 'r1', 0.5), pt(2, 'r1', 0.6)]).plateau).toBe(false);
  });
});

describe('Ideal equals Hard', () => {
  it('reads the lifted limits from sameAsHard, else from an older result’s nothingBinds and relaxed list', () => {
    const same = fixtureLadderCase('sameAsHard');
    expect(idealSameAsHard(same)!.map(liftedText)).toEqual(['training days: 3 → up to 6', 'eating window: 8 h → wake + 30 min to 3 h before bed', 'longest fast: 24 h → 72 h']);
    const { sameAsHard: _s, ...old } = same.ideal!;
    expect(idealSameAsHard({ ...same, ideal: old })!.map(liftedText)).toEqual(['training days: 3 → up to 6', 'eating window: 8 h → wake + 30 min to 3 h before bed']);
    // an explicit null from the engine wins over nothingBinds; a distinct Ideal, no Ideal or no Hard is never "the same"
    expect(idealSameAsHard({ ...same, ideal: { ...same.ideal!, sameAsHard: null } })).toBeNull();
    expect(idealSameAsHard(fixtureLadder())).toBeNull();
    expect(idealSameAsHard(fixtureLadderCase('hardOnly'))).toBeNull();
    expect(idealSameAsHard({ ...same, rungs: {} })).toBeNull();
  });

  it('drops the Ideal from the cards, the table, the selection and the comparison rows', () => {
    const same = fixtureLadderCase('sameAsHard');
    expect(presentKinds(same)).toEqual(['hard']);
    expect(kindFromParams(new URLSearchParams('rung=ideal'), same)).toBe('hard');
    expect(comparisonRows(same, goals, 'metric').map((r) => r.id)).not.toContain('cost');
    expect(ladderScale(same, goals[0], 'metric').ceiling!.label).toBe('ceiling = Hard −5.2\u2009kg');
    expect(presentKinds(fixtureLadder())).toEqual(['hard', 'medium', 'easy', 'ideal']);
  });
});

describe('chips and carried rungs', () => {
  it('lists every rung that is not a card, in ladder order, with the engine’s sentence', () => {
    expect(collapsedChips(fixtureLadderCase('hardOnly')).map((c) => [c.kind, c.title, c.text])).toEqual([
      ['medium', 'medium', 'It would repeat Hard or Easy with small changes.'],
      ['easy', 'easy', 'No plan with less effort than Hard reaches half of Hard’s fat loss: the closest reached 41 % at effort 22.'],
    ]);
    expect(collapsedChips(fixtureLadder())).toEqual([]);
  });

  it('says where a carried rung came from, in plain words', () => {
    expect(carriedNote({ provenance: 'carried', fromTier: 'S' })).toBe('from the quick search');
    expect(carriedNote({ provenance: 'carried', fromTier: 'M' })).toBe('from the earlier search');
    expect(carriedNote({ provenance: 'carried' })).toBe('from the earlier search');
    expect(carriedNote({ provenance: 'own' })).toBeNull();
    expect(carriedNote({ provenance: 'easySearch' })).toBeNull();
    expect(carriedNote({})).toBeNull();
  });
});

describe('the ladder graph', () => {
  it('plots rungs on the worded effort axis with two or more markers', () => {
    const g = ladderGraphData(fixtureLadder(), goals[0], 'metric');
    expect(g.mode).toBe('ladder');
    expect(g.xLabel).toBe('Effort (0 = how you live now, 100 = your limits)');
    expect(g.yLabel).toBe('goal 1 · fat mass');
    expect(g.search).toBeNull();
    expect(g.summary).toBe(g.scale.summary);
  });

  it('plots the search’s convergence (best so far, in goal 1 units through Hard) with fewer than two markers', () => {
    const g = ladderGraphData(fixtureLadderCase('hardOnly'), goals[0], 'metric');
    expect(g.mode).toBe('search');
    const s = g.search!;
    expect(s.points).toHaveLength(12);
    // never gets worse, ends at Hard's value
    for (let i = 1; i < s.points.length; i++) expect(s.points[i]!.y).toBeLessThanOrEqual(s.points[i - 1]!.y + 1e-9);
    expect(s.points.at(-1)!.y).toBeCloseTo(-5.2, 5);
    expect(s.final).toMatchObject({ eu: 240000, label: 'Hard −5.2' });
    expect(s.settledAt).toBe(160000);
    expect(g.summary).toMatch(/^The search tried 240\s000 plans; the best result stopped improving after about 160\s000 at −5\.2 kg\.$/);
    // without a convergence trace a lone Hard stays on the effort axis with the frontier
    const bare = ladderGraphData({ ...fixtureLadderCase('hardOnly'), convergence: [] }, goals[0], 'metric');
    expect(bare.mode).toBe('ladder');
    expect(bare.scale.frontier.length).toBeGreaterThan(1);
  });

  it('after an exhaustive search the convergence curve shows even with two or more markers; "ladder" switches back', () => {
    const v2 = { ...fixtureLadder(), provenance: { ...fixtureLadder().provenance, tier: 'X' as const }, convergence: fixtureConvergence() };
    const g = ladderGraphData(v2, goals[0], 'metric');
    expect(g.mode).toBe('search');
    expect(g.switchable).toBe(true);
    expect(g.search!.points).toHaveLength(12);
    const l = ladderGraphData(v2, goals[0], 'metric', 'kcal', 'ladder');
    expect(l.mode).toBe('ladder');
    expect(l.switchable).toBe(true);
    // a quick search keeps the ladder and has no switch
    const s = ladderGraphData({ ...fixtureLadder(), convergence: fixtureConvergence() }, goals[0], 'metric');
    expect([s.mode, s.switchable]).toEqual(['ladder', false]);
    // a stopped exhaustive search that kept the quick ladder (Q7) opens on its curve too
    const kept = { ...fixtureLadder(), convergence: fixtureConvergence(), keptAfterStop: { tier: 'X' as const, stoppedAt: 'S3', why: 'nothingNew' as const } };
    expect(ladderGraphData(kept as typeof v2, goals[0], 'metric').mode).toBe('search');
  });

  it('prints no plan letters and no internal references in the new copy', () => {
    for (const c of ['four', 'three', 'sameAsHard', 'hardOnly'] as const) {
      const v2 = fixtureLadderCase(c);
      const text = JSON.stringify([ladderGraphData(v2, goals[0], 'metric').summary, collapsedChips(v2), idealSameAsHard(v2)?.map(liftedText)]);
      expect(text).not.toMatch(LETTERS);
      expect(leak(text)).toBeNull();
    }
  });
});
