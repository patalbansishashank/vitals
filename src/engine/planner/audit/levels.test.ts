// @vitest-environment node
/** Level verdicts of the matrix (PLANNER_V2_SPEC §12.6) on hand-made digests: cards, verified absences, failures. */
import { describe, expect, it } from 'vitest';
import { judgeLevels, monotoneViolations, type LevelDigest, type RungDigest } from './levels';

const rung = (D: number, d1: number, extra: Partial<RungDigest> = {}): RungDigest => ({ D, d1, change1: -d1 * 4, safe: true, provenance: 'own', fromTier: null, structureId: 's', ...extra });
const digest = (over: Partial<LevelDigest> = {}): LevelDigest => ({
  key: 'k',
  tier: 'M',
  status: 'ok',
  sense1: -1,
  rungs: { hard: rung(0.8, 1), medium: rung(0.55, 0.8), easy: rung(0.3, 0.55) },
  collapsed: [],
  gower: { hm: 0.3, me: 0.3, he: 0.5 },
  thresholds: { gHard: 1, gMin: 0.1, easyShare: 0.5 },
  easyProof: null,
  mediumBand: null,
  ideal: { card: true, sameAsHard: false, nothingBinds: false, lifted: 3, change1: -4.5, quantum1: 0.2, D: 0.9 },
  previous: null,
  euUsed: 1,
  ...over,
});
const states = (d: LevelDigest) => Object.fromEntries(judgeLevels(d).map((v) => [v.level, `${v.state}:${v.reason}`]));

describe('judgeLevels', () => {
  it('all four valid cards', () => {
    expect(states(digest())).toEqual({ hard: 'card:card', medium: 'card:card', easy: 'card:card', ideal: 'card:card' });
  });
  it('an Easy that keeps less than half of Hard, or sits too close to it, fails', () => {
    expect(states(digest({ rungs: { hard: rung(0.8, 1), easy: rung(0.3, 0.4) }, collapsed: [{ rung: 'medium', reason: 'tooClose', text: '', detail: { dGap: 0.1, minDGap: 0.15 }, carried: false }] })).easy).toBe('fail:invalid');
    expect(states(digest({ rungs: { hard: rung(0.8, 1), easy: rung(0.7, 0.6) }, collapsed: [{ rung: 'medium', reason: 'tooClose', text: '', detail: { dGap: 0.1, minDGap: 0.15 }, carried: false }] })).easy).toBe('fail:invalid');
  });
  it('absences are verified by the numbers of their own check', () => {
    const hardOnly = (collapsed: LevelDigest['collapsed'], over: Partial<LevelDigest> = {}) => digest({ rungs: { hard: rung(0.8, 1) }, collapsed, ...over });
    expect(states(hardOnly([{ rung: 'easy', reason: 'tooClose', text: '', detail: { dGap: 0.08, minDGap: 0.15 }, carried: false }, { rung: 'medium', reason: 'tooClose', text: '', detail: { dGap: 0.08, minDGap: 0.15 }, carried: false }])))
      .toMatchObject({ easy: 'absent:tooClose', medium: 'absent:tooClose' });
    // a stated gap that does not fail the threshold is not a reason
    expect(states(hardOnly([{ rung: 'easy', reason: 'tooClose', text: '', detail: { dGap: 0.2, minDGap: 0.15 }, carried: false }])).easy).toBe('fail:tooClose?');
    const proof = { starts: 6, bestG1: 0.31, needed: 0.5, D: 0.4, evaluated: 300, rejected: [] };
    expect(states(hardOnly([{ rung: 'easy', reason: 'infeasible', text: '', detail: {}, carried: false }, { rung: 'medium', reason: 'infeasible', text: '', detail: {}, carried: false }], { easyProof: proof })))
      .toMatchObject({ easy: 'absent:easyProof', medium: 'absent:noEasy' });
    expect(states(hardOnly([{ rung: 'easy', reason: 'infeasible', text: '', detail: {}, carried: false }], { easyProof: { ...proof, bestG1: 0.6 } })).easy).toBe('fail:proof?');
    expect(states(hardOnly([{ rung: 'easy', reason: 'belowMinimal', text: '', detail: { gHard: 0.05, gMin: 0.1 }, carried: false }])).easy).toBe('absent:belowMinimal');
    expect(states(hardOnly([])).easy).toBe('fail:unexplained');
  });
  it("'stopped' is a verified absence only on a stopped run", () => {
    const stopped = [{ rung: 'easy', reason: 'stopped', text: '', detail: {}, carried: false }, { rung: 'medium', reason: 'stopped', text: '', detail: {}, carried: false }];
    expect(states(digest({ rungs: { hard: rung(0.8, 1) }, collapsed: stopped, complete: false }))).toMatchObject({ easy: 'absent:stopped', medium: 'absent:stopped' });
    expect(states(digest({ rungs: { hard: rung(0.8, 1) }, collapsed: stopped, complete: true })).easy).toBe('fail:stopped?');
  });
  it('a carried rung that failed is verified by its own numbers', () => {
    const d = digest({ rungs: { hard: rung(0.8, 1), easy: rung(0.3, 0.55) }, collapsed: [{ rung: 'medium', reason: 'infeasible', text: '', detail: { carried: 1, gShareCarried: 0.6, needed: 0.7 }, carried: true }] });
    expect(states(d).medium).toBe('absent:carried');
  });
  it('the Ideal: a card at least as good as Hard on goal 1, or the same plan as Hard', () => {
    expect(states(digest({ ideal: { card: false, sameAsHard: true, nothingBinds: true, lifted: 4, change1: -4, quantum1: 0.2, D: 0.8 } })).ideal).toBe('absent:sameAsHard');
    expect(states(digest({ ideal: { card: true, sameAsHard: false, nothingBinds: false, lifted: 4, change1: -3, quantum1: 0.2, D: 0.8 } })).ideal).toBe('fail:belowHard');
    expect(states(digest({ ideal: null })).ideal).toBe('fail:missing');
  });
  it('Medium between a standing Hard-Easy pair is judged by its own margins (§12.8)', () => {
    // gaps 0.10 / 0.10 and distances 0.12 / 0.13 with Hard-Easy 0.30 apart: a card (the pairwise rule would fail it)
    const mid = { rungs: { hard: rung(0.6, 1), medium: rung(0.5, 0.8), easy: rung(0.4, 0.6) } };
    expect(states(digest({ ...mid, gower: { hm: 0.12, me: 0.13, he: 0.3 } })).medium).toBe('card:card');
    // under the scaled distance (0.48 / 3 = 0.16) or a neighbour's duplicate: fails
    expect(states(digest({ ...mid, gower: { hm: 0.14, me: 0.2, he: 0.48 } })).medium).toBe('fail:invalid');
    expect(judgeLevels(digest({ ...mid, rungs: { hard: rung(0.6, 1), medium: rung(0.5, 0.8) }, gower: { hm: 0.04, me: null, he: null } })).find((v) => v.level === 'medium')!.why).toContain('duplicate');
    // Medium copying Easy's failed Hard-Easy check
    const via = digest({ rungs: { hard: rung(0.8, 1) }, collapsed: [{ rung: 'easy', reason: 'notDistinct', text: '', detail: { gower: 0.15, minGower: 0.2 }, carried: false }, { rung: 'medium', reason: 'notDistinct', text: '', detail: { gower: 0.15, minGower: 0.2, viaEasy: 1 }, carried: false }] });
    expect(states(via)).toMatchObject({ easy: 'absent:notDistinct', medium: 'absent:hardEasySame' });
  });
});

describe('monotoneViolations', () => {
  it('a rung shown at a shorter tier must be shown at the longer one or fail a stated carried check', () => {
    const s = digest({ tier: 'S' });
    const lost = digest({ tier: 'M', rungs: { hard: rung(0.8, 1), easy: rung(0.3, 0.55) }, collapsed: [{ rung: 'medium', reason: 'tooClose', text: '', detail: { dGap: 0.1, minDGap: 0.15 }, carried: false }] });
    expect(monotoneViolations({ S: s, M: lost })).toHaveLength(1);
    expect(monotoneViolations({ S: s, M: { ...lost, collapsed: [{ ...lost.collapsed[0]!, carried: true }] } })).toEqual([]);
  });
  it('a complete longer search that returns no plan where the shorter one had Hard fails; a stopped one does not', () => {
    const none = digest({ tier: 'X', status: 'noSafePlan', rungs: {}, collapsed: [] });
    expect(monotoneViolations({ M: digest(), X: none })).toEqual(['hard shown at M but not at X (noSafePlan)']);
    expect(monotoneViolations({ M: digest(), X: { ...none, complete: false } })).toEqual([]);
    expect(monotoneViolations({ M: { ...none, tier: 'M' }, X: digest({ tier: 'X' }) })).toEqual([]);
  });
});
