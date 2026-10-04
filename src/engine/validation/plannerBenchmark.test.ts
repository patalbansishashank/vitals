// @vitest-environment node
/**
 * The published planner benchmark (docs/planner-benchmark.json and its copy for the Evidence › Validation page) has
 * the published shape, the two copies agree, and no string in it or in docs/PLANNER_BENCHMARK.md carries an internal
 * reference.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { leak } from '../../content/evidence/__tests__/leakScan';
import { isPlannerBenchmarkSummary } from './plannerBenchmark';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => strings(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((v) => strings(v, out));
  return out;
}

describe('published planner benchmark', () => {
  const docs = JSON.parse(read('docs/planner-benchmark.json')) as unknown;
  const pub = JSON.parse(read('public/validation/planner-benchmark.json')) as unknown;

  it('both copies have the published shape and agree', () => {
    expect(isPlannerBenchmarkSummary(docs)).toBe(true);
    expect(isPlannerBenchmarkSummary(pub)).toBe(true);
    expect(pub).toEqual(docs);
  });

  it('no internal references in the summary or the report', () => {
    const hits = [...strings(docs), read('docs/PLANNER_BENCHMARK.md')].map(leak).filter((l): l is string => l !== null);
    expect(hits).toEqual([]);
  });

  it('the shape check rejects broken summaries', () => {
    expect(isPlannerBenchmarkSummary(null)).toBe(false);
    expect(isPlannerBenchmarkSummary({ ...(docs as object), version: 2 })).toBe(false);
    expect(isPlannerBenchmarkSummary({ ...(docs as object), headline: [{ suite: 'T1' }] })).toBe(false);
    expect(isPlannerBenchmarkSummary({ ...(docs as object), perf: [{ request: 'a' }] })).toBe(false);
  });
});
