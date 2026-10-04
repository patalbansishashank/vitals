/** Tier P (SUITE_SPEC §0.2): the catalogue code is pure: no UI layers, state, DOM, clock, randomness or IO. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/catalogues', 'src/content/catalogues'];
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/from\s+['"](react|react-dom|react-router|zustand)(\/[^'"]*)?['"]/, 'framework import'],
  [/from\s+['"]@\/(app|components|features|state|workers)\//, 'UI-layer import'],
  [/\bMath\.random\b/, 'Math.random'],
  [/\bDate\.now\b|new Date\(\s*\)|performance\.now/, 'clock'],
  [/\b(window|document|localStorage|navigator)\./, 'DOM global'],
  [/\bfetch\(|XMLHttpRequest|WebSocket/, 'network'],
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') out.push(...files(p));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('catalogue purity', () => {
  it('no source file imports UI layers or uses the clock, randomness, DOM or network', () => {
    const hits: string[] = [];
    const all = ROOTS.flatMap(files);
    expect(all.length).toBeGreaterThanOrEqual(15);
    for (const root of ROOTS) {
      for (const f of files(root)) {
        const text = readFileSync(f, 'utf8');
        for (const [re, what] of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${what}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
