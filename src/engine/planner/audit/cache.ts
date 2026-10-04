/**
 * Where the parts of the slow audit leave their results for `report.audit.ts` (Node only; under node_modules/.cache, so
 * nothing is committed).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const CACHE_DIR = `${REPO_ROOT}node_modules/.cache/planner-audit/`;

export function writePart(name: string, data: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(`${CACHE_DIR}${name}.json`, JSON.stringify(data));
}

export function readPart<T>(name: string): T | null {
  const f = `${CACHE_DIR}${name}.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

/** Number of parallel planner-run parts (files part.plan.0 … part.plan.N−1). */
export const PLAN_PARTS = 6;
/** Number of parallel level-matrix parts (files part.levels.0 … part.levels.N−1; request i runs in part i mod N). */
export const LEVEL_PARTS = 9;
