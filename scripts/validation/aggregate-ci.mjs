import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { aggregateReceipts, decodeReceipt, PARTITIONS } from './ci-receipts.mjs';
import { sourceChanges, sourceFingerprint } from './source-fingerprint.mjs';

const output = resolve('.vitest/release');
mkdirSync(output, { recursive: true });
const summary = { runtime: { node: process.versions.node, platform: process.platform, arch: process.arch }, status: 'running', startedAt: new Date().toISOString(), problems: [] };
try {
  summary.source = { start: sourceFingerprint() };
  const env = { ...process.env, VITALS_TEST_GROUP: '', VITALS_TEST_FILES: '' };
  const inventory = JSON.parse(execFileSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', '--json'], { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))
    .map((r) => relative(process.cwd(), r.file).replaceAll('\\', '/')).sort();
  const receipts = ['CORE_1_RECEIPT', 'CORE_2_RECEIPT', 'CORE_3_RECEIPT', 'CORE_4_RECEIPT', 'SERIAL_RECEIPT'].map((name) => decodeReceipt(process.env[name]));
  const registry = JSON.parse(readFileSync('docs/validation/test-dispositions.json', 'utf8'));
  const jobResults = Object.fromEntries([...PARTITIONS, 'native'].map((part) => [part, process.env[`${part.replace('-', '_').toUpperCase()}_RESULT`]]));
  Object.assign(summary, aggregateReceipts(inventory, receipts, registry, summary.source.start, decodeReceipt(process.env.NATIVE_RECEIPT), jobResults));
  writeFileSync(resolve(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  for (const receipt of receipts) writeFileSync(resolve(output, `${receipt.partition}.json`), JSON.stringify(receipt, null, 2) + '\n');
} catch (error) { summary.problems.push(error.message); }
finally {
  if (summary.source) {
    try {
      summary.source.end = sourceFingerprint();
      const changes = sourceChanges(summary.source.start, summary.source.end);
      summary.source.unchanged = changes.length === 0;
      summary.problems.push(...changes);
    } catch (error) { summary.problems.push(error.message); }
  }
  summary.status = summary.problems.length ? 'failed' : 'passed';
  summary.finishedAt = new Date().toISOString();
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`VALIDATION_SUMMARY ${JSON.stringify(summary)}`);
}
if (summary.problems.length) process.exitCode = 1;
