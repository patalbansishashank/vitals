// @vitest-environment node
/**
 * Ideal equals Hard (PLANNER_V2_SPEC §12.3) and the collapse sentences of batch 02 (§12.1 carried rungs, §12.2 Easy's
 * proof of absence): detection rules, the lifted-limits list, and plain sentences with no internal references.
 */
import { describe, expect, it } from 'vitest';
import { collapseText, idealSameAsHard, liftedWithoutEffect } from '../ladderPlanner';
import { FAT_LOSS_FIRST_T3 } from '../../__tests__/qa/requests';
import { GOLDEN } from './golden.requests';

const hard = { genome: { structureId: 'mc', x: [0.2, 0.4, 0.6] }, D: 0.35 };
const q = () => 0.1;

describe('idealSameAsHard', () => {
  it('nothing binds → same', () => {
    expect(idealSameAsHard({ nothingBinds: true, genome: { structureId: 'other', x: [1] }, D: 0.9, outcomes: [{ goal: 0, vsHard: 3 }] }, hard, q)).toBe(true);
  });
  it('the same genome → same', () => {
    expect(idealSameAsHard({ nothingBinds: false, genome: { structureId: 'mc', x: [0.2, 0.4 + 5e-7, 0.6] }, D: 0.5, outcomes: [{ goal: 0, vsHard: 1 }] }, hard, q)).toBe(true);
  });
  it('within every goal quantum and |ΔD| < 0.01 → same; beyond either → different', () => {
    const near = { nothingBinds: false, genome: { structureId: 'x', x: [0] }, D: 0.355, outcomes: [{ goal: 0, vsHard: 0.08 }, { goal: 1, vsHard: -0.05 }] };
    expect(idealSameAsHard(near, hard, q)).toBe(true);
    expect(idealSameAsHard({ ...near, D: 0.37 }, hard, q)).toBe(false);
    expect(idealSameAsHard({ ...near, outcomes: [{ goal: 0, vsHard: 0.3 }] }, hard, q)).toBe(false);
  });
});

describe('the limits lifted without effect', () => {
  it('one row per limit group the Ideal relaxes, with plain from/to texts', () => {
    for (const req of [GOLDEN.a, GOLDEN.c, FAT_LOSS_FIRST_T3]) {
      const rows = liftedWithoutEffect(req);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.group)).size).toBe(rows.length);
      for (const r of rows) {
        expect(r.label.length).toBeGreaterThan(2);
        expect(r.from).not.toBe('');
        expect(r.to).not.toBe('');
        expect(`${r.label} ${r.from} ${r.to}`).not.toMatch(/§|R\d|MODEL_SPEC|dossier/i);
      }
    }
  });
});

describe('collapse sentences (batch 02)', () => {
  it('a carried rung that fails says which search it came from and the failing check, with numbers', () => {
    expect(collapseText('easy', 'infeasible', { carried: 1, gShareCarried: 0.41, needed: 0.5 }, 'fat mass', 'S')).toBe(
      "The quick search's Easy now reaches only 41 % of the new Hard's fat mass (it needs 50 %).",
    );
    expect(collapseText('medium', 'notDistinct', { gower: 0.15, minGower: 0.2, viaEasy: 1 }, 'fat mass')).toBe(
      'Hard and the nearest easier plan are almost the same plan, so there is no room for a plan in between.',
    );
    expect(collapseText('medium', 'tooClose', { carried: 1, dGap: 0.1, minDGap: 0.15 }, 'fat mass', 'M')).toBe('The earlier search\'s Medium is now almost as much effort as the new Hard.');
    expect(collapseText('easy', 'infeasible', { carried: 1, carriedChance: 0 }, 'fat mass', 'M')).toMatch(/no longer passes the safety checks/);
  });
  it('a rung a stopped search never checked says the search stopped (no unproven "no plan")', () => {
    expect(collapseText('medium', 'stopped', {}, 'fat mass')).toBe('The search was stopped before Medium was found or checked.');
    expect(collapseText('easy', 'stopped', {}, 'fat mass')).toBe('The search was stopped before Easy was found or checked.');
  });
  it("Easy's proof of absence says how close the nearest easier plan came", () => {
    expect(collapseText('easy', 'infeasible', { bestG1: 0.38, needed: 0.5, closestD: 0.21 }, 'fat mass')).toBe(
      "No plan with less effort than Hard reaches half of Hard's fat mass: the closest reached 38 % at effort 21.",
    );
  });
});
