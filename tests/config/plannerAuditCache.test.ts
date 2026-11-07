// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'vitals-audit-cache-')); dirs.push(dir); return dir; };

it('a new audit cannot read a successful part from the previous audit', async () => {
  vi.stubEnv('VITALS_AUDIT_CACHE_DIR', fresh());
  const first = await import('../../src/engine/planner/audit/cache');
  first.writePart('static', { mechanisms: ['old'] });
  expect(first.readPart('static')).toEqual({ mechanisms: ['old'] });

  vi.stubEnv('VITALS_AUDIT_CACHE_DIR', fresh());
  vi.resetModules();
  const second = await import('../../src/engine/planner/audit/cache');
  expect(second.readPart('static')).toBeNull();
  second.writePart('static', { mechanisms: ['new'] });
  expect(second.readPart('static')).toEqual({ mechanisms: ['new'] });
  expect(first.readPart('static')).toEqual({ mechanisms: ['old'] });
});

it('a corrupt audit part fails explicitly instead of becoming an empty successful report', async () => {
  const dir = fresh();
  vi.stubEnv('VITALS_AUDIT_CACHE_DIR', dir);
  const cache = await import('../../src/engine/planner/audit/cache');
  writeFileSync(join(dir, 'static.json'), '{broken');
  expect(() => cache.readPart('static')).toThrow();
});
