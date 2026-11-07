import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Fresh output roots prevent report-only/retried audits from mixing yesterday's successful parts with today's run.
const parent = resolve('.vitest/planner-audit');
mkdirSync(parent, { recursive: true });
const run = mkdtempSync(join(parent, 'run-'));
const env = { ...process.env, VITALS_AUDIT_CACHE_DIR: join(run, 'parts'), LEVELS_OUT_DIR: join(run, 'levels') };
console.log(`Planner audit staging: ${run}`);
for (const filter of ['part.', 'report.audit']) {
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
    'exec', 'vitest', 'run', '--config', 'src/engine/planner/audit/vitest.audit.config.ts', filter,
  ], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Publish deterministic level digests only once every part and every report assertion passed.
cpSync(join(run, 'levels'), resolve('qa/results/levels'), { recursive: true });
