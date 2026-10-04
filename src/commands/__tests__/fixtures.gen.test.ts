/**
 * Writes `src/commands/__fixtures__/<id>.json` for every registered command (when `GEN_FIXTURES=1`), keeping existing
 * files (they are reviewed artefacts). Without the variable it only checks that every command has one.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allCommands } from '..';
import { FIXTURE_INPUTS, sampleOf } from './fixtures';

const DIR = join(__dirname, '..', '__fixtures__');

describe('command fixtures', () => {
  it('exist for every command', () => {
    const gen = process.env.GEN_FIXTURES === '1';
    if (gen) mkdirSync(DIR, { recursive: true });
    const missing: string[] = [];
    for (const def of allCommands()) {
      const file = join(DIR, `${def.id}.json`);
      if (existsSync(file)) continue;
      if (gen) writeFileSync(file, `${JSON.stringify(FIXTURE_INPUTS[def.id] ?? sampleOf(def.input), null, 2)}\n`);
      else missing.push(def.id);
    }
    expect(missing).toEqual([]);
  });

  it('writes the reviewed ai-excluded allowlist when generating', () => {
    const file = join(__dirname, 'ai-excluded.json');
    if (process.env.GEN_FIXTURES === '1' && !existsSync(file)) {
      const ids = allCommands().filter((d) => !d.surfaces.includes('ai')).map((d) => d.id).sort();
      writeFileSync(file, `${JSON.stringify(ids, null, 2)}\n`);
    }
    expect(existsSync(file)).toBe(true);
  });
});
