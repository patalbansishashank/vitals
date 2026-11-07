import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { sourceChanges, sourceFingerprint } from './source-fingerprint.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'vitals-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Validation fixture', '-c', 'user.email=fixture@example.invalid', ...args], { stdio: 'pipe' });
  const put = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  git('init', '--quiet', '--template=');
  put('.gitignore', 'node_modules/\n.vitest/\n**/.kotlin/\n');
  put('src/input.ts', 'export const value = 1;\n');
  git('add', '.');
  git('commit', '--quiet', '--no-gpg-sign', '-m', 'Fixture');
  return { root, git, put, snapshot: () => sourceFingerprint(root) };
}

test('clean and dirty working sources have deterministic identities without printing contents', (t) => {
  const r = repository(t);
  const clean = r.snapshot();
  assert.equal(clean.dirty, false);
  r.put('src/input.ts', 'private fixture content changed');
  const dirty = r.snapshot();
  assert.equal(dirty.dirty, true);
  assert.notEqual(clean.digest, dirty.digest);
  assert.deepEqual(sourceChanges(dirty, r.snapshot()), []);
  assert.ok(!JSON.stringify(dirty).includes('private fixture content'));
  assert.match(dirty.commit, /^[a-f0-9]{40,64}$/);
});

test('new source/tests, deletion, rename and same-size edits invalidate an earlier run', (t) => {
  const r = repository(t);
  let before = r.snapshot();
  r.put('tests/new.test.ts', 'test content');
  assert.ok(sourceChanges(before, r.snapshot()).length);
  before = r.snapshot();
  r.put('tests/new.test.ts', 'TEST content');
  assert.ok(sourceChanges(before, r.snapshot()).length);
  before = r.snapshot();
  renameSync(join(r.root, 'src/input.ts'), join(r.root, 'src/renamed.ts'));
  assert.ok(sourceChanges(before, r.snapshot()).length);
  before = r.snapshot();
  unlinkSync(join(r.root, 'src/renamed.ts'));
  assert.ok(sourceChanges(before, r.snapshot()).length);
});

test('editing and restoring the same bytes still invalidates an in-flight source receipt', (t) => {
  const r = repository(t);
  const before = r.snapshot();
  r.put('src/input.ts', 'temporary source used during a test');
  r.put('src/input.ts', 'export const value = 1;\n');
  const after = r.snapshot();
  assert.equal(before.digest, after.digest);
  assert.equal(before.statusDigest, after.statusDigest);
  assert.notEqual(before.mutationDigest, after.mutationDigest);
  assert.ok(sourceChanges(before, after).length);
});

test('commit and index changes are recorded even with identical working-file bytes', (t) => {
  const r = repository(t);
  r.put('src/input.ts', 'changed');
  const dirty = r.snapshot();
  r.git('add', '.');
  const staged = r.snapshot();
  assert.equal(dirty.digest, staged.digest);
  assert.ok(sourceChanges(dirty, staged).length);
  r.git('commit', '--quiet', '--no-gpg-sign', '-m', 'New source');
  assert.equal(staged.digest, r.snapshot().digest);
  assert.ok(sourceChanges(staged, r.snapshot()).length);
});

test('build/test/Kotlin caches are excluded, checked-in snapshots and desktop assets remain source', (t) => {
  const r = repository(t);
  const before = r.snapshot();
  for (const file of ['node_modules/pkg/index.js', '.vitest/release/summary.json', 'apps/android/android/.kotlin/cache', 'apps/android/android/gauge/build/output', 'qa/results/.timing/run.json']) r.put(file, 'generated');
  assert.deepEqual(sourceChanges(before, r.snapshot()), []);
  r.put('public/validation/fixture.json', '{"expected":1}');
  r.put('apps/desktop/build/icons/icon.png', 'packaged asset');
  r.git('add', 'public', 'apps/desktop');
  const source = r.snapshot();
  r.put('public/validation/fixture.json', '{"expected":2}');
  assert.ok(sourceChanges(source, r.snapshot()).length);
  const next = r.snapshot();
  r.put('apps/desktop/build/icons/icon.png', 'updated asset');
  assert.ok(sourceChanges(next, r.snapshot()).length);
});

test('symlinks are fingerprinted as links without reading external targets; parent links fail closed', (t) => {
  const r = repository(t);
  const external = mkdtempSync(join(tmpdir(), 'vitals-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(join(external, 'input.ts'), 'outside tree');
  symlinkSync(join(external, 'input.ts'), join(r.root, 'src/link.ts'));
  const before = r.snapshot();
  writeFileSync(join(external, 'input.ts'), 'outside tree changed');
  assert.deepEqual(sourceChanges(before, r.snapshot()), []);
  assert.equal(before.symlinks, 1);
  unlinkSync(join(r.root, 'src/link.ts'));
  symlinkSync(join(external, 'other.ts'), join(r.root, 'src/link.ts'));
  assert.ok(sourceChanges(before, r.snapshot()).length);
  renameSync(join(r.root, 'src'), join(r.root, 'original'));
  symlinkSync(external, join(r.root, 'src'), 'dir');
  assert.throws(() => r.snapshot(), /symlink parent/);
});

test('fingerprint limits reject incomplete accounting instead of silently dropping oversized source', (t) => {
  const r = repository(t);
  assert.throws(() => sourceFingerprint(r.root, { files: 1 }), /exceeds.*files/);
  assert.throws(() => sourceFingerprint(r.root, { fileBytes: 2 }), /size limit/);
  assert.throws(() => sourceFingerprint(r.root, { totalBytes: 2 }), /exceeds.*bytes/);
});

// Exercise the actual gate with a tiny fake Vitest process: both test partitions pass, but source changes between them.
for (const mutation of ['none', 'core', 'typecheck', 'failed-core']) test(`gate source mutation: ${mutation}`, (t) => {
  const mutate = mutation === 'core' || mutation === 'typecheck';
  const fails = mutation === 'failed-core';
  const check = mutation !== 'core';
  const r = repository(t);
  r.put('docs/validation/test-dispositions.json', '{"entries":[]}');
  r.put('src/input.ts', 'dirty development source');
  const bin = mkdtempSync(join(tmpdir(), 'vitals-gate-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const executable = join(bin, 'pnpm');
  writeFileSync(executable, `#!${process.execPath}\n${[
    "const fs = require('node:fs'); const path = require('node:path');",
    "if (process.argv[2] === 'run') {",
    mutation === 'typecheck' ? "if(process.argv.includes('typecheck')) fs.writeFileSync('src/input.ts','changed during typecheck');" : '',
    "} else if (process.argv.includes('list')) console.log(JSON.stringify(['src/input.ts', 'tests/serial.test.ts'].map(file => ({file:path.resolve(file)}))));",
    "else { const group=process.env.VITALS_TEST_GROUP;",
    "fs.writeFileSync(process.env.VITALS_TEST_REPORT, JSON.stringify({runId:process.env.VITALS_TEST_RUN_ID,reason:'passed',unhandledErrors:0,files:[group==='core'?'src/input.ts':'tests/serial.test.ts'],counts:{passed:1,failed:0,pending:0},exceptions:[]}));",
    mutation === 'core' ? "if(group==='core') fs.writeFileSync('src/input.ts','changed during tests');" : '',
    fails ? "if(group==='core') process.exit(7);" : '',
    "}",
  ].join('\n')}\n`);
  chmodSync(executable, 0o755);
  const gate = fileURLToPath(new URL('./release-gate.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [gate, ...(check ? ['--check'] : [])], { cwd: r.root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VITALS_GATE_DIR: resolve(r.root, '.vitest/release'), ENGINE_VALIDATION: 'complete', E26_LIVE: '0' }, encoding: 'utf8' });
  const summary = JSON.parse(readFileSync(join(r.root, '.vitest/release/summary.json'), 'utf8'));
  assert.equal(result.status, mutate || fails ? 1 : 0, result.stderr);
  assert.equal(summary.status, mutate || fails ? 'failed' : 'passed');
  assert.equal(summary.source.start.dirty, true);
  if (fails) { assert.equal(summary.failedStage, 'core'); assert.equal(summary.exitCode, 7); }
  else assert.equal(summary.counts.passed, 2);
  if (check) assert.deepEqual(summary.checks, ['typecheck', 'lint', 'test:tooling']);
  assert.ok(summary.source.end);
  assert.equal(summary.source.start.digest === summary.source.end.digest, !mutate);
  if (mutate) assert.match(summary.problems.join('\n'), /source.*changed/);
});
