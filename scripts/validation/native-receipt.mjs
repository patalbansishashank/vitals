import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceChanges, sourceFingerprint } from './source-fingerprint.mjs';

const output = resolve('.vitest/release');
mkdirSync(output, { recursive: true });
const startFile = resolve(output, 'native-source-start.json');
if (process.argv[2] === 'start') {
  if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required to identify this native validation run');
  const record = { runId: randomUUID(), runtime: { node: process.versions.node, platform: process.platform, arch: process.arch }, startedAt: new Date().toISOString(), source: sourceFingerprint() };
  writeFileSync(startFile, JSON.stringify(record, null, 2) + '\n');
  appendFileSync(process.env.GITHUB_ENV, `VITALS_NATIVE_RUN_ID=${record.runId}\n`);
  console.log(`VALIDATION_NATIVE_START ${JSON.stringify(record)}`);
} else if (process.argv[2] === 'finish') {
  const receipt = { partition: 'native', status: 'failed', problems: [] };
  try {
    const start = JSON.parse(readFileSync(startFile, 'utf8'));
    receipt.runId = start.runId;
    receipt.runtime = start.runtime;
    receipt.startedAt = start.startedAt;
    receipt.source = { start: start.source, end: sourceFingerprint() };
    const changes = sourceChanges(receipt.source.start, receipt.source.end);
    receipt.source.unchanged = changes.length === 0;
    receipt.problems.push(...changes);
    receipt.testOutcome = process.env.VITALS_NATIVE_TEST_OUTCOME ?? 'missing';
    if (receipt.testOutcome !== 'success') receipt.problems.push(`Native Gradle step did not succeed: ${receipt.testOutcome}`);
    receipt.native = JSON.parse(readFileSync(resolve(output, 'native.json'), 'utf8'));
    receipt.counts = receipt.native.counts;
    if (receipt.native.runId !== start.runId) receipt.problems.push('Native results belong to a different run');
    if (receipt.native.status !== 'passed' || receipt.native.problems.length) receipt.problems.push('Native tests or skip accounting did not pass');
    receipt.status = receipt.problems.length ? 'failed' : 'passed';
  } catch (error) { receipt.problems.push(error.message); }
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`VALIDATION_NATIVE_SUMMARY ${JSON.stringify(receipt)}`);
  if (receipt.problems.length) process.exitCode = 1;
} else throw new Error('Use native-receipt.mjs start or finish');
