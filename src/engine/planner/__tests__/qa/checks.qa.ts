// @vitest-environment node
/**
 * QA pass 2 planner checks (release gate v0.2) on the digests `run.qa.ts` wrote to qa/results/q2/planner: fasting
 * when it serves goal 1 and its absence explained otherwise (a, b), a ladder of genuinely different rungs (c, PLN-06),
 * the Ideal (d) and Simulator agreement of every startable rung (g, R-PLAN-SAFETY). Re-plan (e) is covered by
 * domain/__tests__/replan.test.ts and timing (f) by the benchmark's perf job (docs/QA_FINDINGS.md, QA pass 2).
 * Run after run.qa: pnpm vitest run --config src/engine/planner/__tests__/qa/vitest.qa.config.ts checks.qa
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTION_OF_RUNG } from '../../../../living/start';
import { LEVEL_TIERS, judgeLevels, monotoneViolations, type LevelDigest, type LevelTier } from '../../audit/levels';
import { LEVELS_DIR } from '../../audit/levelsRun';
import { V1_ID } from '../../domain/compat';
import { FUZZ_QA_KEYS, GOLDEN_QA_KEYS, OUT_DIR, QA_KEYS, qaRequest } from './requests';

interface Rung {
  title: string;
  D: number;
  outcomes: Array<{ change: number; p50: number; vsHard: number }>;
  fasting: { used: boolean; kind: string; longestFastH: number; text: string; rival: { reason: string; detail: string } | null };
  explanation: string[];
  simulatorWarnings: Array<{ id: string; severity: string; listable: boolean }>;
}
interface Digest {
  key: string;
  status: string;
  fastingGate: { offered: boolean; reason: string };
  ladder: { collapsed: Array<{ rung: string; reason: string; text: string }> };
  rungs: Partial<Record<'hard' | 'medium' | 'easy', Rung>>;
  v1OptionIds: string[];
  ideal: (Rung & { gapVsHard: Array<{ goal: number; delta: number }>; interactionRemainder: Array<{ goal: number; delta: number }>; limitCosts: Array<{ group: string; deltas: Array<{ goal: number; delta: number }>; text: string }> }) | null;
}

const load = (key: string): Digest | null => {
  const f = path.join(OUT_DIR, `${key}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as Digest) : null;
};
const rungsOf = (d: Digest) => (['hard', 'medium', 'easy'] as const).map((k) => d.rungs[k]).filter((r): r is Rung => !!r);
/** +1 when a larger value is better for goal k, −1 when smaller is. */
const senseOf = (key: string, k: number) => {
  const g = qaRequest(key).goals[k]!;
  return g.direction === 'minimise' || (g.direction === 'target' && (g.target ?? 0) < 0) ? -1 : 1;
};

describe('(a) autophagy first, T3 opted in, training', () => {
  it('at least one rung has a fast; every rung says why it has one or which fasting plan lost and why', () => {
    const d = load('af')!;
    expect(d.status).toBe('ok');
    expect(d.fastingGate.offered).toBe(true);
    const rs = rungsOf(d);
    expect(rs.some((r) => r.fasting.used)).toBe(true);
    for (const r of rs) {
      expect(r.fasting.text.length, r.title).toBeGreaterThan(20);
      if (!r.fasting.used) expect(r.fasting.rival?.detail, r.title).toBeTruthy();
    }
  });
});

describe('(b) fat loss first, T3 opted in', () => {
  it('no rung fasts; each says a fast was considered and why it lost', () => {
    const d = load('flf')!;
    expect(d.status).toBe('ok');
    expect(d.fastingGate.offered).toBe(true);
    for (const r of rungsOf(d)) {
      expect(r.fasting.used, r.title).toBe(false);
      expect(r.fasting.rival, r.title).not.toBeNull();
      expect(r.fasting.rival!.reason, r.title).toBeTruthy();
      expect(r.fasting.text, r.title).toMatch(/fast/i);
    }
  });
});

describe('(c) the ladder: Hard / Medium / Easy at distinct difficulty', () => {
  for (const key of GOLDEN_QA_KEYS)
    it(`golden ${key}: rungs strictly ordered in difficulty, every missing rung explained`, () => {
      const d = load(key)!;
      expect(d.status).toBe('ok');
      const rs = rungsOf(d);
      for (let i = 1; i < rs.length; i++) expect(rs[i]!.D, `${rs[i - 1]!.title} ${rs[i - 1]!.D} vs ${rs[i]!.title} ${rs[i]!.D}`).toBeLessThan(rs[i - 1]!.D);
      for (const k of ['medium', 'easy'] as const) if (!d.rungs[k]) expect(d.ladder.collapsed.find((c) => c.rung === k)?.text, `${k} missing without a reason`).toBeTruthy();
    });

  it('PLN-06: Medium is kept in at least half of the ten fuzzed requests that return a ladder', () => {
    const ds = FUZZ_QA_KEYS.map(load).filter((d): d is Digest => !!d && d.status === 'ok');
    const withEasy = ds.filter((d) => d.rungs.easy);
    const dropped = ds.filter((d) => !d.rungs.medium);
    expect(ds.length).toBeGreaterThanOrEqual(8);
    expect(dropped.length, `Medium dropped in ${dropped.map((d) => d.key).join(', ')} (Easy present in ${withEasy.length})`).toBeLessThanOrEqual(ds.length / 2);
  });
});

describe('(d) the Ideal', () => {
  it('is never startable: the start command maps only Hard, Medium and Easy, and the v1 view carries no Ideal', () => {
    expect(Object.keys(OPTION_OF_RUNG).sort()).toEqual(['easy', 'hard', 'medium']);
    expect(Object.keys(V1_ID).sort()).toEqual(['easy', 'hard', 'medium']);
    for (const key of [...GOLDEN_QA_KEYS, 'af', 'flf', ...FUZZ_QA_KEYS]) {
      const d = load(key);
      if (d) for (const id of d.v1OptionIds) expect(['A', 'B', 'C']).toContain(id);
    }
  });

  for (const key of GOLDEN_QA_KEYS)
    it(`golden ${key}: Ideal ≥ Hard on goal 1; limit costs add up to the gap with the interaction remainder and none hurts goal 1`, () => {
      const d = load(key)!;
      const I = d.ideal!;
      const H = d.rungs.hard!;
      expect(I).not.toBeNull();
      expect(I.title).toBe('Ideal');
      const s0 = senseOf(key, 0);
      const quantum = Math.max(0.05 * Math.abs(H.outcomes[0]!.change), 0.1);
      expect(s0 * (I.outcomes[0]!.p50 - H.outcomes[0]!.p50), 'Ideal below Hard on goal 1').toBeGreaterThanOrEqual(-quantum);
      for (const g of I.gapVsHard) {
        const sum = I.limitCosts.reduce((s, c) => s + (c.deltas.find((x) => x.goal === g.goal)?.delta ?? 0), 0);
        expect(sum + I.interactionRemainder.find((r) => r.goal === g.goal)!.delta).toBeCloseTo(g.delta, 2);
      }
      for (const c of I.limitCosts) {
        const g1 = c.deltas.find((x) => x.goal === 0)!.delta;
        expect(s0 * g1, `${c.group}: relaxing it alone loses goal 1`).toBeGreaterThanOrEqual(-quantum);
        expect(c.text).toMatch(/^Allowing /);
      }
    });
});

describe('(g) R-PLAN-SAFETY: a plan started from the ladder raises no caution or danger the plan may not carry', () => {
  for (const key of [...GOLDEN_QA_KEYS, 'af', 'flf', ...FUZZ_QA_KEYS])
    it(`${key}: every rung's Simulator run has only listable cautions`, () => {
      const d = load(key);
      if (!d || d.status !== 'ok') return;
      for (const r of rungsOf(d)) expect(r.simulatorWarnings.filter((w) => !w.listable), r.title).toEqual([]);
    });
});

describe('(h) every ladder level at tiers S, M and X (PLANNER_V2_SPEC §12.6; run levels.qa or pnpm audit:planner first)', () => {
  const chainOf = (key: string): Partial<Record<LevelTier, LevelDigest>> | null => {
    const f = path.join(LEVELS_DIR, `${key}.json`);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<Record<LevelTier, LevelDigest>>) : null;
  };
  for (const key of QA_KEYS)
    for (const tier of LEVEL_TIERS)
      it(`${key} at ${tier}: Hard, Medium, Easy and Ideal are each a valid card or absent with a verified reason`, () => {
        const d = chainOf(key)?.[tier];
        expect(d, `no digest for ${key} ${tier}`).toBeDefined();
        const vs = judgeLevels(d!);
        expect(vs.map((v) => v.level)).toEqual(['hard', 'easy', 'medium', 'ideal']);
        for (const v of vs) expect(v.state, `${v.level}: ${v.why}`).not.toBe('fail');
      });
  for (const key of QA_KEYS)
    it(`${key}: a longer search never shows fewer rungs unless an earlier rung failed a stated check`, () => {
      const c = chainOf(key);
      expect(c).not.toBeNull();
      expect(monotoneViolations(c!)).toEqual([]);
    });
});
