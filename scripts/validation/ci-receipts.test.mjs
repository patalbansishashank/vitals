import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { aggregateReceipts, assignedFiles, decodeReceipt, encodeReceipt, PARTITIONS, receiptChunks } from './ci-receipts.mjs';
import { assertSupportedRuntime } from './runtime.mjs';

const inventory = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts', 'serial.test.ts'];
const source = { algorithm: 'sha256', version: 1, commit: 'a'.repeat(40), digest: 'b'.repeat(64), dirty: false, statusDigest: 'c'.repeat(64), mutationDigest: 'd'.repeat(64), files: 10, bytes: 1000 };
const limitation = { file: 'a.test.ts', name: 'retained original target', status: 'expectedFailure', reason: 'Reference disagreement', source: 'original research target', disposition: 'Not validated' };
const registry = { entries: [limitation] };
const jobResults = Object.fromEntries([...PARTITIONS, 'native'].map((part) => [part, 'success']));
const nativeReceipt = () => ({ partition: 'native', runId: 'native-run', status: 'passed', problems: [], source: { start: source, end: source, unchanged: true }, native: { runId: 'native-run', status: 'passed', problems: [], counts: { passed: 10, failed: 0, skipped: 3 } } });
function receipts() {
  return PARTITIONS.map((partition) => {
    const files = assignedFiles(partition, partition === 'serial' ? ['serial.test.ts'] : inventory.slice(0, -1));
    const exceptions = files.includes('a.test.ts') ? [limitation] : [];
    return {
      partition, runId: `run-${partition}`, status: 'passed', problems: [], inventory,
      source: { start: source, end: source, unchanged: true },
      ...(partition === 'core-1' ? { checks: ['typecheck', 'lint', 'test:tooling'] } : {}),
      report: { runId: `run-${partition}`, files, reason: 'passed', unhandledErrors: 0, exceptions, counts: { passed: files.length - exceptions.length, expectedFailure: exceptions.length, failed: 0, skipped: 0, todo: 0, pending: 0 } },
    };
  });
}

test('four deterministic core partitions are disjoint and complete without sharing serial work', () => {
  const core = inventory.slice(0, -1);
  const actual = PARTITIONS.slice(0, -1).flatMap((name) => assignedFiles(name, [...core].reverse()));
  assert.equal(actual.length, new Set(actual).size);
  assert.deepEqual(actual.sort(), core);
  assert.deepEqual(assignedFiles('serial', ['serial.test.ts']), ['serial.test.ts']);
  assert.throws(() => assignedFiles('unknown', core), /Unknown/);
});
test('aggregate preserves distinct ordinary passes and scientific failures with exact inventory accounting', () => {
  const result = aggregateReceipts(inventory, receipts(), registry, source, nativeReceipt(), jobResults);
  assert.deepEqual(result.problems, []);
  assert.equal(result.files, 6);
  assert.equal(result.counts.passed, 5);
  assert.equal(result.counts.expectedFailure, 1);
});
test('missing, duplicate, failed and stale-source partitions cannot become a green aggregate', () => {
  const changes = [
    (r) => r.pop(), (r) => { r[4] = r[0]; }, (r) => { r[1].status = 'failed'; },
    (r) => { r[1].source = { start: { ...source, digest: 'different' }, end: source, unchanged: true }; },
    (r) => { r[1].source = { start: source, end: { ...source, mutationDigest: 'rewritten' }, unchanged: true }; },
    (r) => { r[1].source = { start: { ...source, commit: 'old' }, end: { ...source, commit: 'old' }, unchanged: true }; },
    (r) => { r[1].source = { start: { ...source, dirty: true }, end: { ...source, dirty: true }, unchanged: true }; },
    (r) => { r[0].checks = ['typecheck']; },
    (r) => { r[1].source = { start: { ...source, mutationDigest: undefined }, end: { ...source, mutationDigest: undefined }, unchanged: true }; },
    (r) => { r[1].inventory = []; }, (r) => { delete r[1].report; }, (r) => { r[1].report.runId = 'old'; },
  ];
  for (const change of changes) { const r = receipts(); change(r); assert.ok(aggregateReceipts(inventory, r, registry, source, nativeReceipt(), jobResults).problems.length); }
});
test('aggregate rejects omitted/duplicated files, new skips, unhandled errors and stale dispositions', () => {
  const changes = [
    (r) => r[1].report.files.pop(),
    (r) => r[1].report.files.push('a.test.ts'),
    (r) => r[1].report.exceptions.push({ file: 'b.test.ts', name: 'silently skipped', status: 'skipped' }),
    (r) => { r[1].report.unhandledErrors = 1; },
    (r) => { r[0].report.exceptions = []; },
  ];
  for (const change of changes) { const r = receipts(); change(r); assert.ok(aggregateReceipts(inventory, r, registry, source, nativeReceipt(), jobResults).problems.length); }
});
test('bounded job-output receipt and structured log chunks round-trip exact identities without artifacts', () => {
  const receipt = receipts()[0];
  assert.deepEqual(decodeReceipt(encodeReceipt(receipt)), receipt);
  const chunks = receiptChunks(receipt);
  assert.ok(chunks.every((chunk) => chunk.data.length <= 8192));
  assert.deepEqual(decodeReceipt(chunks.sort((a, b) => a.index - b.index).map((chunk) => chunk.data).join('')), receipt);
  assert.throws(() => decodeReceipt(''), /Missing/);
  assert.throws(() => decodeReceipt('not base64'), /invalid/);
  assert.throws(() => decodeReceipt(gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1)).toString('base64')));
  assert.throws(() => encodeReceipt({ data: randomBytes(60_000).toString('base64') }), /job-output size/);
});
test('unsupported Node versions and absent platform APIs fail before the costly test matrix', () => {
  const ready = { asyncDisposableStack: true, webLocks: true };
  for (const version of ['22.20.0', '24.1.0', '26.9.9', 'invalid']) assert.throws(() => assertSupportedRuntime(version, ready), /Node 26/);
  for (const version of ['26.10.0', '26.12.1']) assert.doesNotThrow(() => assertSupportedRuntime(version, ready));
  assert.throws(() => assertSupportedRuntime('26.12.1', { ...ready, webLocks: false }), /Web Locks/);
  assert.throws(() => assertSupportedRuntime('26.12.1', { ...ready, asyncDisposableStack: false }), /AsyncDisposableStack/);
});

test('native validation cannot be replaced by absent artifacts, stale source or incomplete accounting', () => {
  for (const native of [undefined, { ...nativeReceipt(), status: 'failed' }, { ...nativeReceipt(), source: { start: { ...source, digest: 'other' }, end: source, unchanged: true } }, { ...nativeReceipt(), native: { ...nativeReceipt().native, runId: 'old' } }]) {
    assert.ok(aggregateReceipts(inventory, receipts(), registry, source, native, jobResults).problems.length);
  }
});

test('passing receipts cannot hide a failed, cancelled or skipped upstream job', () => {
  for (const part of [...PARTITIONS, 'native']) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const out = aggregateReceipts(inventory, receipts(), registry, source, nativeReceipt(), { ...jobResults, [part]: result });
      assert.ok(out.problems.some((problem) => problem.includes(`Upstream job did not succeed: ${part}`)));
    }
  }
});
