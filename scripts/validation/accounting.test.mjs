import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAccounting } from './accounting.mjs';
import StatusReporter from './status-reporter.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const limitation = { file: 'science.test.ts', name: 'held-out people', status: 'todo', reason: 'No independent dataset', source: 'research/14', disposition: 'Not empirically validated' };
const report = () => ({ reason: 'passed', unhandledErrors: 0, files: ['science.test.ts'], counts: { failed: 0, pending: 0 }, exceptions: [limitation] });
const registry = { entries: [limitation] };
test('accounts for an explicit limitation without claiming an empirical pass', () => {
  assert.deepEqual(checkAccounting(['science.test.ts'], [report()], registry), []);
});
test('rejects an omitted file, duplicate partition, unexplained skip and stale disposition', () => {
  assert.match(checkAccounting(['science.test.ts', 'science.test.ts'], [report()], registry).join('\n'), /inventory contains duplicate/);
  assert.match(checkAccounting(['science.test.ts', 'safety.test.ts'], [report()], registry).join('\n'), /not run: safety/);
  assert.match(checkAccounting(['science.test.ts'], [report(), report()], registry).join('\n'), /more than one partition/);
  const skipped = report();
  skipped.exceptions.push({ file: 'science.test.ts', name: 'performance budget', status: 'skipped' });
  assert.match(checkAccounting(['science.test.ts'], [skipped], registry).join('\n'), /Unaccounted test status/);
  assert.match(checkAccounting(['science.test.ts'], [{ ...report(), exceptions: [] }], registry).join('\n'), /Stale test disposition/);
});
test('rejects interrupted, failed, pending, unhandled-error runs and missing rationale', () => {
  for (const change of [{ reason: 'interrupted' }, { reason: 'failed' }, { unhandledErrors: 1 }, { counts: { pending: 1 } }, { counts: { failed: 1 } }]) {
    assert.ok(checkAccounting(['science.test.ts'], [{ ...report(), ...change }], registry).length);
  }
  assert.match(checkAccounting(['science.test.ts'], [report()], { entries: [{ ...limitation, reason: '' }] }).join('\n'), /Missing rationale/);
});
test('reporter distinguishes expected failures, ordinary passes, todos and runtime skips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vitals-accounting-'));
  const previous = process.env.VITALS_TEST_REPORT;
  process.env.VITALS_TEST_REPORT = join(dir, 'status.json');
  const cases = [
    ['ordinary', {}, 'passed'], ['known miss', { fails: true }, 'passed'],
    ['unexpected pass', { fails: true }, 'failed'], ['held out', { mode: 'todo' }, 'skipped'],
    ['busy timing', {}, 'skipped'],
  ].map(([fullName, options, state]) => ({ fullName, options, result: () => ({ state }) }));
  try {
    new StatusReporter().onTestRunEnd([{ moduleId: join(process.cwd(), 'science.test.ts'), children: { allTests: () => cases } }], [], 'failed');
    const output = JSON.parse(readFileSync(process.env.VITALS_TEST_REPORT, 'utf8'));
    assert.deepEqual(output.counts, { passed: 1, expectedFailure: 1, failed: 1, skipped: 1, todo: 1, pending: 0 });
    assert.equal(output.exceptions.length, 4);
    assert.ok(!output.exceptions.some((r) => r.name === 'ordinary'));
  } finally {
    if (previous === undefined) delete process.env.VITALS_TEST_REPORT;
    else process.env.VITALS_TEST_REPORT = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
