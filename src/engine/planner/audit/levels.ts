/**
 * The four ladder levels at three tiers (PLANNER_V2_SPEC §12.6; owner rule "test every level"). For each of the 17 QA
 * requests the app path runs tier S, then M with S's ladder as `previous`, then X (fixed `X_AUDIT_EU`) with M's, exactly
 * as "Find plans" and "Find the best possible plan" chain them. Each run is digested (no timings: they go to the
 * uncommitted qa/results/.timing/) and every level H, M, E, I is judged: a card that is valid, or absent with a reason
 * whose numbers prove it. `pnpm audit:planner` runs the matrix (part.levels.*) and fails on an unverified level;
 * `checks.qa.ts` asserts on the same digests.
 */
import type { PlannerResult as OptimResult } from '../optim/pipeline';
import { MEDIUM_MARGIN, mediumMargins } from '../optim/ladder';
import { violation } from '../optim/types';
import type { PlannerRequestV2, PlannerResultV2, PlannerTier, RungId } from '../domain/types';

export const LEVEL_TIERS = ['S', 'M', 'X'] as const satisfies readonly PlannerTier[];
export type LevelTier = (typeof LEVEL_TIERS)[number];
export type Level = RungId | 'ideal';
export const LEVELS: readonly Level[] = ['hard', 'medium', 'easy', 'ideal'];
/** Tier X total in audit runs (§12.6): fixed so the matrix finishes in an audit's time; the app's X spends 300 000. */
export const X_AUDIT_EU = Number(process.env['X_AUDIT_EU'] ?? 60000);

/** Ladder constants the verdicts check against (optim/ladder.ts LADDER_DEFAULTS). */
const GAP = 0.15;
const GOWER = 0.2;
const EPS = 1e-6;

export interface RungDigest {
  D: number;
  /** Goal-1 desirability d̃₁ of the selected (nominal) plan. */
  d1: number;
  /** Goal-1 holdout P50 change (metric units) and the plan's safety (v_S = 0). */
  change1: number;
  safe: boolean;
  provenance: string;
  fromTier: string | null;
  structureId: string;
}

export interface LevelDigest {
  key: string;
  tier: LevelTier;
  status: string;
  /** False when the run was stopped early (optional: older digests lack it). */
  complete?: boolean;
  /** Goal 1: +1 when larger is better. */
  sense1: number;
  rungs: Partial<Record<RungId, RungDigest>>;
  collapsed: Array<{ rung: string; reason: string; text: string; detail: Record<string, number>; carried: boolean }>;
  gower: { hm: number | null; me: number | null; he: number | null };
  thresholds: { gHard: number | null; gMin: number | null; easyShare: number };
  easyProof: PlannerResultV2['ladder']['easyProof'] | null;
  mediumBand: { accepted: boolean; passing: number; tried: number } | null;
  ideal: null | {
    card: boolean;
    sameAsHard: boolean;
    nothingBinds: boolean;
    lifted: number;
    change1: number;
    /** Goal-1 quantum (metric units) the Ideal ≥ Hard check allows. */
    quantum1: number;
    D: number;
  };
  /** Previous ladder handed to this run (tier and rung ids). */
  previous: { tier: string; rungs: string[] } | null;
  euUsed: number;
}

const r4 = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
const n4 = (v: number): number => r4(v) ?? NaN;

/** Digest one run (optimiser view for the numbers the verdicts need, app view for what the screen shows). */
export function digestRun(key: string, tier: LevelTier, req: PlannerRequestV2, v2: PlannerResultV2, optim: OptimResult<unknown> | null): LevelDigest {
  const g0 = req.goals[0]!;
  const sense1 = g0.direction === 'minimise' || (g0.direction === 'target' && (g0.target ?? 0) < 0) ? -1 : 1;
  const rungs: LevelDigest['rungs'] = {};
  for (const id of ['hard', 'medium', 'easy'] as const) {
    const r = v2.rungs[id];
    if (!r) continue;
    const o = optim?.options.find((q) => q.rung === id) ?? null;
    rungs[id] = {
      D: n4(r.summary.difficulty.D),
      d1: o ? n4(o.desirability[0]!) : NaN,
      change1: n4(r.summary.outcomes[0]?.change ?? NaN),
      safe: o ? violation(o.output.margins) === 0 : true,
      provenance: (r as { provenance?: string }).provenance ?? 'own',
      fromTier: (r as { fromTier?: string }).fromTier ?? null,
      structureId: r.genome.structureId,
    };
  }
  const lad = optim?.ladder as (NonNullable<OptimResult<unknown>['ladder']> & { gHard?: number; gMin?: number }) | null | undefined;
  const optCollapsed = lad?.collapsed ?? [];
  const collapsed = v2.ladder.collapsed.map((c) => {
    const cc = c as typeof c & { detail?: Record<string, number>; carried?: boolean };
    const detail = cc.detail ?? optCollapsed.find((q) => q.rung === c.rung)?.detail ?? {};
    return { rung: c.rung, reason: c.reason, text: c.text, detail: Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, n4(v)])), carried: !!cc.carried };
  });
  const I = v2.ideal;
  const H = v2.rungs.hard;
  const iq = I as (typeof I & { sameAsHard?: { liftedWithoutEffect: unknown[] } | null }) | null;
  const quantum1 = H ? Math.max(0.05 * Math.abs(H.summary.outcomes[0]?.change ?? 0), 0.1) : 0.1;
  const prev = (req as { previous?: { tier: string; rungs: Record<string, unknown> } }).previous;
  return {
    key,
    tier,
    status: v2.status,
    complete: v2.complete,
    sense1,
    rungs,
    collapsed,
    gower: { hm: r4(lad?.gower.hm), me: r4(lad?.gower.me), he: r4(lad?.gower.he) },
    thresholds: { gHard: r4(lad?.gHard ?? (rungs.hard ? rungs.hard.d1 : null)), gMin: r4(lad?.gMin ?? null), easyShare: req.ladder?.easyShare ?? 0.5 },
    easyProof: v2.ladder.easyProof ?? null,
    mediumBand: lad?.mediumBand ? { accepted: lad.mediumBand.accepted, passing: lad.mediumBand.passing, tried: lad.mediumBand.tried } : null,
    ideal: I
      ? {
          card: !iq?.sameAsHard,
          sameAsHard: !!iq?.sameAsHard,
          nothingBinds: I.nothingBinds,
          lifted: iq?.sameAsHard?.liftedWithoutEffect.length ?? I.relaxed.length,
          change1: n4(I.summary.outcomes[0]?.change ?? NaN),
          quantum1: n4(quantum1),
          D: n4(I.summary.difficulty.D),
        }
      : null,
    previous: prev ? { tier: prev.tier, rungs: Object.keys(prev.rungs).sort() } : null,
    euUsed: v2.provenance.euUsed,
  };
}

export interface LevelVerdict {
  level: Level;
  /** 'card': shown and valid; 'absent': not shown with a verified reason; 'fail': neither. */
  state: 'card' | 'absent' | 'fail';
  /** Machine-readable reason code (absent) or the failing check (fail). */
  reason: string;
  /** Plain text of the check, for the coverage table and test messages. */
  why: string;
}

const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Judge every level of one digest (§12.6). Pure; the tests and the audit report call it. */
export function judgeLevels(d: LevelDigest): LevelVerdict[] {
  const out: LevelVerdict[] = [];
  const H = d.rungs.hard;
  const fail = (level: Level, reason: string, why: string): LevelVerdict => ({ level, state: 'fail', reason, why });
  const card = (level: Level, why = 'valid'): LevelVerdict => ({ level, state: 'card', reason: 'card', why });
  const absent = (level: Level, reason: string, why: string): LevelVerdict => ({ level, state: 'absent', reason, why });
  // Hard
  if (H) out.push(H.safe ? card('hard') : fail('hard', 'unsafe', 'Hard breaks a safety limit'));
  else if (d.status === 'noSafePlan' || d.status === 'blocked' || d.status === 'invalid') out.push(absent('hard', d.status, `no plan: ${d.status}`));
  else out.push(fail('hard', 'missing', 'no Hard on an ok result'));
  const gH = d.thresholds.gHard ?? H?.d1 ?? NaN;
  const gMin = d.thresholds.gMin ?? 0;
  const needE = Math.max(d.thresholds.easyShare * gH, gMin);
  const col = (r: RungId) => d.collapsed.find((c) => c.rung === r) ?? null;
  // a collapse verified by the numbers of its own check
  const verifyCollapse = (r: 'medium' | 'easy'): LevelVerdict => {
    const c = col(r);
    if (!H) return absent(r, 'noHard', 'no Hard, so no ladder');
    if (!c) return fail(r, 'unexplained', `${r} missing without a reason`);
    const x = c.detail;
    switch (c.reason) {
      case 'belowMinimal':
        return fin(x['gHard']) && fin(x['gMin']) && x['gHard'] < x['gMin'] + EPS ? absent(r, 'belowMinimal', `Hard's goal-1 progress ${x['gHard']} is below the minimal change ${x['gMin']}`) : fail(r, 'belowMinimal?', 'belowMinimal without gHard < gMin');
      case 'tooClose':
        return fin(x['dGap']) && fin(x['minDGap']) && x['dGap'] < x['minDGap'] - 1e-9 ? absent(r, 'tooClose', `effort gap ${x['dGap']} < ${x['minDGap']}`) : fail(r, 'tooClose?', 'tooClose without a failing gap');
      case 'notDistinct': {
        if (fin(x['gower']) && fin(x['minGower']) && x['gower'] < x['minGower'] - 1e-9) return absent(r, 'notDistinct', `plan distance ${x['gower']} < ${x['minGower']}`);
        // order broken between any two present rungs (goal 1 or effort); Medium may carry Easy's order failure
        const gt = (a: string, b: string) => fin(x[a]) && fin(x[b]) && x[a] > x[b] + 1e-9;
        const ordH = gt('d1Easy', 'd1Hard') || gt('dEasy', 'dHard') || (r === 'medium' && (gt('d1Medium', 'd1Hard') || gt('d1Easy', 'd1Medium') || gt('dMedium', 'dHard') || gt('dEasy', 'dMedium')));
        return ordH ? absent(r, 'notDistinct', 'out of order with Hard (goal 1 or effort)') : fail(r, 'notDistinct?', 'notDistinct without a failing distance or order');
      }
      case 'infeasible': {
        // a carried rung that failed against the new Hard: its goal share, or a safety check, with the numbers
        if (x['carried'] === 1) {
          if (fin(x['gShareCarried']) && fin(x['needed']) && x['gShareCarried'] < x['needed'] - 1e-9) return absent(r, 'carried', `the earlier ${r} reaches ${Math.round(100 * x['gShareCarried'])} % of the new Hard, needs ${Math.round(100 * x['needed'])} %`);
          if (x['carriedSafe'] === 0 || x['carriedValid'] === 0 || x['carriedChance'] === 0) return absent(r, 'carried', `the earlier ${r} fails a safety check now`);
        }
        if (r === 'medium') {
          // any Medium would also meet Easy's constraint, so no Easy proves no Medium; else the band search must have run
          if (!d.rungs.easy) return absent(r, 'noEasy', 'no easier plan exists, so none in between');
          if (d.mediumBand && !d.mediumBand.accepted) return absent(r, 'bandEmpty', `the in-between search tried ${d.mediumBand.tried} and found none (${d.mediumBand.passing} passing)`);
          return fail(r, 'infeasible?', 'Medium infeasible without a band search');
        }
        const p = d.easyProof;
        if (!p) return fail(r, 'noProof', 'Easy infeasible without the search proof');
        if (p.bestG1 < p.needed - 1e-9) return absent(r, 'easyProof', `best easier plan reaches ${Math.round(100 * p.bestG1)} % of Hard's goal-1 progress, needs ${Math.round(100 * p.needed)} %`);
        if (p.rejected.length) return absent(r, 'easyRejected', `${p.rejected.length} easier plans met the goals but failed ${[...new Set(p.rejected.map((q) => q.why))].join(', ')}`);
        return fail(r, 'proof?', 'proof does not show absence');
      }
      case 'stopped':
        return d.complete === false ? absent(r, 'stopped', 'the search was stopped before this rung was checked') : fail(r, 'stopped?', 'stopped on a complete run');
      default:
        return fail(r, 'unknown', `unknown reason ${c.reason}`);
    }
  };
  // Medium that repeats Easy's failed Hard-Easy check (§12.8): no Medium can exist between them by definition
  const verifyMedium = (): LevelVerdict => {
    const v = verifyCollapse('medium');
    return v.state === 'absent' && col('medium')?.detail['viaEasy'] === 1 && (v.reason === 'tooClose' || v.reason === 'notDistinct') ? absent('medium', 'hardEasySame', v.why) : v;
  };
  const E = d.rungs.easy;
  const M = d.rungs.medium;
  // Easy
  if (E && H) {
    const errs: string[] = [];
    if (!E.safe) errs.push('unsafe');
    if (fin(E.d1) && fin(needE) && E.d1 < needE - 1e-6) errs.push(`goal-1 ${E.d1} < half of Hard ${needE}`);
    if (H.D - E.D < GAP - 1e-3) errs.push(`effort gap ${H.D - E.D}`);
    if (fin(E.d1) && fin(H.d1) && E.d1 > H.d1 + 1e-6) errs.push('better than Hard on goal 1');
    if (fin(d.gower.he) && d.gower.he < GOWER - 1e-6) errs.push(`plan distance ${d.gower.he}`);
    out.push(errs.length ? fail('easy', 'invalid', errs.join('; ')) : card('easy'));
  } else out.push(verifyCollapse('easy'));
  // Medium
  if (M && H) {
    const errs: string[] = [];
    if (!M.safe) errs.push('unsafe');
    // §12.8: Medium's own margins between a standing Hard-Easy pair; the pairwise rule without Easy (digests carry 4
    // decimals, so the distance threshold derived from Hard-Easy gets a rounding tolerance)
    const mg = mediumMargins(E ? d.gower.he : null, { minDGap: GAP, minGower: GOWER });
    if (H.D - M.D < mg.minDGap - 1e-3) errs.push(`effort gap to Hard ${H.D - M.D}`);
    if (E && M.D - E.D < mg.minDGap - 1e-3) errs.push(`effort gap to Easy ${M.D - E.D}`);
    if (fin(M.d1) && fin(H.d1) && M.d1 > H.d1 + 1e-6) errs.push('better than Hard on goal 1');
    if (E && fin(M.d1) && fin(E.d1) && E.d1 > M.d1 + 1e-6) errs.push('below Easy on goal 1');
    if (fin(d.gower.hm) && d.gower.hm < mg.minGower - 2e-4) errs.push(`plan distance to Hard ${d.gower.hm}`);
    if (E && fin(d.gower.me) && d.gower.me < mg.minGower - 2e-4) errs.push(`plan distance to Easy ${d.gower.me}`);
    if ([d.gower.hm, E ? d.gower.me : null].some((g) => fin(g) && g < MEDIUM_MARGIN.duplicate)) errs.push('duplicate of a neighbour');
    out.push(errs.length ? fail('medium', 'invalid', errs.join('; ')) : card('medium'));
  } else out.push(verifyMedium());
  // Ideal
  const I = d.ideal;
  if (!H) out.push(I && I.card ? card('ideal', 'no Hard; the Ideal shows which limit blocks') : absent('ideal', 'noHard', 'no safe plan'));
  else if (!I) out.push(fail('ideal', 'missing', 'no Ideal on a result with Hard'));
  else if (I.sameAsHard) out.push(I.nothingBinds ? absent('ideal', 'sameAsHard', `the Ideal equals Hard; ${I.lifted} limits lifted without effect`) : fail('ideal', 'sameAsHard?', 'same-as-Hard without the no-binding check'));
  else if (d.sense1 * (I.change1 - H.change1) < -I.quantum1) out.push(fail('ideal', 'belowHard', `Ideal ${I.change1} below Hard ${H.change1} on goal 1`));
  else out.push(card('ideal'));
  return out;
}

/** Monotone tiers (§12.6): a level shown at a shorter tier (Hard, Medium, Easy) is shown at the longer one, or a carried-rung failure says why. */
export function monotoneViolations(byTier: Partial<Record<LevelTier, LevelDigest>>): string[] {
  const bad: string[] = [];
  for (const [lo, hi] of [['S', 'M'], ['M', 'X']] as const) {
    const a = byTier[lo];
    const b = byTier[hi];
    if (!a || !b || a.status !== 'ok') continue;
    // Hard is a card too: a complete longer search that loses every plan the shorter one showed breaks the invariant
    if (b.status !== 'ok') {
      if (b.complete !== false) bad.push(`hard shown at ${lo} but not at ${hi} (${b.status})`);
      continue;
    }
    for (const r of ['medium', 'easy'] as const) {
      if (!a.rungs[r] || b.rungs[r]) continue;
      const c = b.collapsed.find((q) => q.rung === r);
      if (!c?.carried) bad.push(`${r} shown at ${lo} but not at ${hi} without a stated carried-rung failure`);
    }
  }
  return bad;
}

/** The previous ladder a longer tier receives (§12.1): the shown Medium and Easy genomes. */
export function previousOf(v2: PlannerResultV2, tier: PlannerTier): NonNullable<PlannerRequestV2['previous']> | undefined {
  const rungs: NonNullable<PlannerRequestV2['previous']>['rungs'] = {};
  for (const r of ['medium', 'easy'] as const) {
    const g = v2.rungs[r]?.genome;
    if (g) rungs[r] = { structureId: g.structureId, x: [...g.x] };
  }
  return v2.status === 'ok' ? { tier, rungs } : undefined;
}
