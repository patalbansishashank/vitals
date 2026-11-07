import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { checkAccounting } from './accounting.mjs';
import { sourceChanges, sourceFingerprint } from './source-fingerprint.mjs';
import { assignedFiles, PARTITIONS } from './ci-receipts.mjs';
import { assertSupportedRuntime } from './runtime.mjs';

const output = resolve(process.env.VITALS_GATE_DIR || '.vitest/release');
mkdirSync(output, { recursive: true });
const summary = { runId: randomUUID(), runtime: { node: process.versions.node, platform: process.platform, arch: process.arch }, status: 'running', startedAt: new Date().toISOString(), problems: [] };
const save = () => writeFileSync(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
save();
const env = { ...process.env, ENGINE_VALIDATION: 'complete', E26_LIVE: '0', VITALS_TEST_RUN_ID: summary.runId };
let stage = 'source-start';
const completeCheck = process.argv.includes('--check');
const partitionArg = process.argv.indexOf('--partition');
const partition = partitionArg < 0 ? null : process.argv[partitionArg + 1];
if (partitionArg >= 0 && !PARTITIONS.includes(partition)) throw new Error('Use --partition core-1, core-2, core-3, core-4 or serial');
function vitest(args, overrides = {}, capture = false) {
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'vitest', ...args], {
    env: { ...env, VITALS_TEST_GROUP: '', VITALS_TEST_FILES: '', ...overrides }, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    summary.exitCode = result.status;
    throw new Error(`Vitest ${stage} did not complete successfully`);
  }
  return result.stdout;
}
function readReport(group) {
  const report = JSON.parse(readFileSync(resolve(output, `${group}.json`), 'utf8'));
  if (report.runId !== summary.runId) throw new Error(`Stale ${group} test report from a different run`);
  return report;
}
try {
  if (partition) summary.partition = partition;
  summary.source = { start: sourceFingerprint() };
  save();
  stage = 'runtime';
  assertSupportedRuntime();
  // Never silently omit scientific assertions or contact external agent services.
  if (process.env.ENGINE_VALIDATION && process.env.ENGINE_VALIDATION !== 'complete') throw new Error('Release gate requires ENGINE_VALIDATION=complete (or unset)');
  if (process.env.E26_LIVE === '1') throw new Error('Live agent checks must be run separately from the offline release gate');
  if (completeCheck) {
    summary.checks = [];
    for (const script of ['typecheck', 'lint', 'test:tooling']) {
      stage = script;
      const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', script], { env, stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) { summary.exitCode = result.status; throw new Error(`${script} did not complete successfully`); }
      summary.checks.push(script);
    }
  }
  stage = 'inventory';
  const inventory = JSON.parse(vitest(['list', '--filesOnly', '--json'], {}, true))
    .map((item) => relative(process.cwd(), item.file).replaceAll('\\', '/')).sort();
  summary.files = inventory.length;
  writeFileSync(resolve(output, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  if (partition) {
    summary.partition = partition;
    summary.inventory = inventory;
  }
  const groups = partition ? [partition === 'serial' ? 'serial' : 'core'] : ['core', 'serial'];
  for (const group of groups) {
    stage = group;
    const overrides = { VITALS_TEST_GROUP: group, VITALS_TEST_REPORT: resolve(output, `${group}.json`) };
    if (partition) {
      const candidates = JSON.parse(vitest(['list', '--filesOnly', '--json'], { VITALS_TEST_GROUP: group }, true))
        .map((item) => relative(process.cwd(), item.file).replaceAll('\\', '/')).sort();
      summary.assigned = assignedFiles(partition, candidates);
      overrides.VITALS_TEST_FILES = resolve(output, 'assigned.json');
      writeFileSync(overrides.VITALS_TEST_FILES, JSON.stringify(summary.assigned));
    }
    vitest(['run'], overrides);
  }
  stage = 'accounting';
  const reports = groups.map(readReport);
  const registry = JSON.parse(readFileSync('docs/validation/test-dispositions.json', 'utf8'));
  if (partition) summary.report = reports[0];
  const checkedInventory = partition ? summary.assigned : inventory;
  const checkedRegistry = partition ? { entries: registry.entries.filter((row) => checkedInventory.includes(row.file)) } : registry;
  summary.problems.push(...checkAccounting(checkedInventory, reports, checkedRegistry));
  summary.files = checkedInventory.length;
  summary.counts = Object.fromEntries(Object.keys(reports[0].counts).map((key) => [key, reports.reduce((sum, report) => sum + report.counts[key], 0)]));
  console.log(`${partition ? `Partition ${partition}` : 'Release test'} accounting: ${summary.files} files; ${JSON.stringify(summary.counts)}`);
} catch (error) {
  summary.failedStage = stage;
  summary.problems.push(error.message);
} finally {
  if (summary.source) {
    try {
      summary.source.end = sourceFingerprint();
      const changes = sourceChanges(summary.source.start, summary.source.end);
      summary.source.unchanged = changes.length === 0;
      summary.problems.push(...changes);
    } catch (error) {
      summary.source.unchanged = false;
      summary.problems.push(`Final source fingerprint failed: ${error.message}`);
    }
  }
  if (partition && !summary.report) {
    try { summary.report = readReport(partition === 'serial' ? 'serial' : 'core'); summary.counts ??= summary.report.counts; } catch { /* failure before collection remains explicit */ }
  }
  summary.finishedAt = new Date().toISOString();
  summary.status = summary.problems.length ? 'failed' : 'passed';
  save();
  const { report: _report, inventory: _inventory, assigned: _assigned, ...receipt } = summary;
  console.log(`VALIDATION_SUMMARY ${JSON.stringify(receipt)}`);
}
if (summary.problems.length) { console.error(summary.problems.join('\n')); process.exitCode = 1; }
