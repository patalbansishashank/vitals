import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PARTITIONS, decodeReceipt } from './ci-receipts.mjs';

const script = (name) => fileURLToPath(new URL(name, import.meta.url));
test('real partition/receipt/aggregate commands account for every fixture once without artifact storage', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vitals-ci-gate-'));
  const bin = mkdtempSync(join(tmpdir(), 'vitals-ci-tools-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); });
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  const core = ['src/a.test.ts', 'src/b.test.ts', 'src/c.test.ts', 'src/d.test.ts', 'src/e.test.ts'];
  const serial = ['src/bench.test.ts'];
  for (const file of [...core, ...serial]) put(file, '// synthetic test fixture');
  put('.gitignore', '.vitest/\n');
  put('docs/validation/test-dispositions.json', '{"entries":[]}');
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', ...args], { stdio: 'pipe' });
  git('init', '--quiet', '--template='); git('add', '.'); git('commit', '--quiet', '--no-gpg-sign', '-m', 'Fixture source');
  const executable = join(bin, 'pnpm');
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const core=${JSON.stringify(core)},serial=${JSON.stringify(serial)};
if(process.argv[2]==='run') process.exit(0);
if(process.argv.includes('list')) {
 const group=process.env.VITALS_TEST_GROUP;
 console.log(JSON.stringify((group==='core'?core:group==='serial'?serial:[...core,...serial]).map(file=>({file:path.resolve(file)}))));
} else {
 const files=JSON.parse(fs.readFileSync(process.env.VITALS_TEST_FILES,'utf8'));
 fs.writeFileSync(process.env.VITALS_TEST_REPORT,JSON.stringify({runId:process.env.VITALS_TEST_RUN_ID,files,reason:'passed',unhandledErrors:0,exceptions:[],counts:{passed:files.length,expectedFailure:0,failed:0,skipped:0,todo:0,pending:0}}));
}
`);
  chmodSync(executable, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ENGINE_VALIDATION: 'complete', E26_LIVE: '0' };
  const run = (name, args = [], more = {}) => spawnSync(process.execPath, [script(name), ...args], { cwd: root, env: { ...env, ...more }, encoding: 'utf8' });
  const received = {};
  for (const partition of PARTITIONS) {
    const output = join(root, '.vitest', partition);
    const result = run('release-gate.mjs', ['--partition', partition, ...(partition === 'core-1' ? ['--check'] : [])], { VITALS_GATE_DIR: output });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /VALIDATION_SUMMARY/);
    const exported = join(output, 'job-output');
    const emit = run('emit-receipt.mjs', [], { VITALS_GATE_DIR: output, GITHUB_OUTPUT: exported });
    assert.equal(emit.status, 0, emit.stderr);
    assert.match(emit.stdout, /VALIDATION_RECEIPT_CHUNK/);
    const encoded = readFileSync(exported, 'utf8').trim().slice('receipt='.length);
    assert.ok(encoded.length <= 60_000);
    const receipt = decodeReceipt(encoded);
    assert.equal(receipt.partition, partition);
    assert.equal(receipt.source.start.dirty, false);
    received[`${partition.replace('-', '_').toUpperCase()}_RECEIPT`] = encoded;
  }
  // Native validation creates its own source receipt after its build; test fixtures stand in for Gradle XML here.
  const nativeEnv = join(root, '.vitest/native-env');
  const nativeStart = run('native-receipt.mjs', ['start'], { GITHUB_ENV: nativeEnv });
  assert.equal(nativeStart.status, 0, nativeStart.stderr);
  const runId = readFileSync(nativeEnv, 'utf8').trim().split('=')[1];
  put('.vitest/release/native.json', JSON.stringify({ runId, status: 'passed', counts: { passed: 10, failed: 0, skipped: 3 }, problems: [] }));
  const nativeFinish = run('native-receipt.mjs', ['finish'], { VITALS_NATIVE_TEST_OUTCOME: 'success' });
  assert.equal(nativeFinish.status, 0, nativeFinish.stderr + nativeFinish.stdout);
  const nativeOutput = join(root, '.vitest/native-output');
  assert.equal(run('emit-receipt.mjs', [], { VITALS_GATE_DIR: join(root, '.vitest/release'), GITHUB_OUTPUT: nativeOutput }).status, 0);
  received.NATIVE_RECEIPT = readFileSync(nativeOutput, 'utf8').trim().slice('receipt='.length);
  for (const part of [...PARTITIONS, 'native']) received[`${part.replace('-', '_').toUpperCase()}_RESULT`] = 'success';
  const result = run('aggregate-ci.mjs', [], received);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const summary = JSON.parse(readFileSync(join(root, '.vitest/release/summary.json'), 'utf8'));
  assert.equal(summary.status, 'passed');
  assert.equal(summary.files, 6);
  assert.equal(summary.counts.passed, 6);
  assert.equal(summary.source.unchanged, true);
  // A non-assertion Gradle/job failure stays red even when its XML and receipt counts were all passing.
  assert.equal(run('aggregate-ci.mjs', [], { ...received, NATIVE_RESULT: 'failure' }).status, 1);
  const gradleFailed = run('native-receipt.mjs', ['finish'], { VITALS_NATIVE_TEST_OUTCOME: 'failure' });
  assert.equal(gradleFailed.status, 1);
  assert.match(gradleFailed.stdout, /Native Gradle step did not succeed/);
  // Dropping one output, as can happen after a cancelled job, must fail the real aggregate command.
  const missing = run('aggregate-ci.mjs', [], { ...received, CORE_3_RECEIPT: '' });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(readFileSync(join(root, '.vitest/release/summary.json'), 'utf8')).status, 'failed');
});
