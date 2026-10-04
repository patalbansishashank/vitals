/**
 * Runs one request's tier chain S → M → X for the level matrix (levels.ts) and writes the digests (no timings) to
 * qa/results/levels/<key>.json and the timings to the uncommitted qa/results/.timing/levels-<key>.json. Node only.
 * LEVELS_OUT_DIR overrides the digest directory (e.g. a before/after comparison).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runLadderPlanner } from '../domain/ladderPlanner';
import type { PlannerRequestV2 } from '../domain/types';
import type { PlannerResult as OptimResult } from '../optim/pipeline';
import { qaRequest } from '../__tests__/qa/requests';
import { REPO_ROOT } from './cache';
import { LEVEL_TIERS, X_AUDIT_EU, digestRun, previousOf, type LevelDigest, type LevelTier } from './levels';

export const LEVELS_DIR = process.env['LEVELS_OUT_DIR'] ? path.resolve(process.env['LEVELS_OUT_DIR']) : path.join(REPO_ROOT, 'qa', 'results', 'levels');
export const TIMING_DIR = path.join(REPO_ROOT, 'qa', 'results', '.timing');

export async function runLevelChain(key: string, tiers: readonly LevelTier[] = LEVEL_TIERS): Promise<Partial<Record<LevelTier, LevelDigest>>> {
  const out: Partial<Record<LevelTier, LevelDigest>> = {};
  const timing: Record<string, number> = {};
  let previous: PlannerRequestV2['previous'];
  for (const tier of tiers) {
    const base = qaRequest(key);
    const req: PlannerRequestV2 = { ...base, budget: { ...base.budget, tier }, ...(previous ? { previous } : {}) };
    const hold: { optim: OptimResult<unknown> | null } = { optim: null };
    const t0 = performance.now();
    const v2 = await runLadderPlanner(req, { tier, ...(tier === 'X' ? { totalEU: X_AUDIT_EU } : {}), onOptimResult: (r) => (hold.optim = r) });
    timing[tier] = Math.round(performance.now() - t0);
    out[tier] = digestRun(key, tier, req, v2, hold.optim);
    previous = previousOf(v2, tier);
  }
  mkdirSync(LEVELS_DIR, { recursive: true });
  writeFileSync(path.join(LEVELS_DIR, `${key}.json`), `${JSON.stringify(out, null, 1)}\n`);
  mkdirSync(TIMING_DIR, { recursive: true });
  writeFileSync(path.join(TIMING_DIR, `levels-${key}.json`), `${JSON.stringify({ key, xAuditEU: X_AUDIT_EU, wallMs: timing }, null, 1)}\n`);
  return out;
}
