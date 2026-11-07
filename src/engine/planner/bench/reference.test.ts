// @vitest-environment node
/**
 * Versioned benchmark references (D4-09, C7): the production-policy reference set is selected explicitly, historical
 * reference files are never written, and a reference frozen for one engine/parameter/domain key is never overwritten by a
 * run of another key. Uses a temporary root, never the repository's reference directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLANNER_POLICY_FINGERPRINT } from '../optim/policy';
import { DEFAULT_REFERENCE, checkReferenceSelector, loadReferences, optionsFromEnv, referenceDir, writeReferences } from './runner';
import type { ReferenceSummary } from './types';

const ref = (g: number): ReferenceSummary => ({ goals: [], dStar: [g], gStar: g, exact: true, source: 'test' });
const roots: string[] = [];
const tmpRoot = (): string => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ref-'));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe('benchmark reference selection (D4-09)', () => {
  it('defaults to the production-policy reference and the shipped route against the frozen v1 comparator; writing is off', () => {
    const o = optionsFromEnv('/x', {}, () => {});
    expect(o.reference).toBe(DEFAULT_REFERENCE);
    expect(o.algos).toEqual(['v1', 'hybrid']);
    expect(o.writeReference).toBe(false);
  });

  it('refuses historical and smoke reference names as a benchmark reference set', () => {
    for (const bad of ['r1-1.0.0-contract-3b70e02c-474fbed6', 'r2-x', 'smoke-baseline', 'review-policy-v1-smoke', 'latest']) expect(() => checkReferenceSelector(bad)).toThrow();
    expect(checkReferenceSelector('review-policy-v2')).toBe('review-policy-v2');
  });

  it('writes only the selected versioned file, records the policy, extends it for the same key and never overwrites another key', () => {
    const root = tmpRoot();
    const f = writeReferences(root, 'review-policy-v1', 'k1', { a: ref(1) }, {});
    expect(path.basename(f)).toBe('review-policy-v1.json');
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    expect(saved.policy.fingerprint).toBe(PLANNER_POLICY_FINGERPRINT);
    writeReferences(root, 'review-policy-v1', 'k1', { b: ref(2) }, {});
    expect(Object.keys(loadReferences(root, 'review-policy-v1', 'k1').r1).sort()).toEqual(['a', 'b']);
    expect(() => writeReferences(root, 'review-policy-v1', 'k2', { c: ref(3) }, {})).toThrow(/frozen/);
    expect(fs.readdirSync(referenceDir(root))).toEqual(['review-policy-v1.json']);
  });

  it('reuses a reference only for the same key; otherwise starts empty (recomputed in memory) and reads historical files read-only', () => {
    const root = tmpRoot();
    writeReferences(root, 'review-policy-v1', 'k1', { a: ref(1) }, {});
    expect(loadReferences(root, 'review-policy-v1', 'k1').reused).toBe(true);
    const other = loadReferences(root, 'review-policy-v1', 'k2');
    expect([other.reused, other.frozenKey, Object.keys(other.r1).length]).toEqual([false, 'k1', 0]);
    fs.writeFileSync(path.join(referenceDir(root), 'r1-k3.json'), JSON.stringify({ h: ref(4) }));
    const hist = loadReferences(root, 'review-policy-v1', 'k3');
    expect(Object.keys(hist.r1)).toEqual(['h']);
  });
});
