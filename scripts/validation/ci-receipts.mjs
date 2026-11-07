import { gzipSync, gunzipSync } from 'node:zlib';
import { checkAccounting } from './accounting.mjs';
import { sourceChanges } from './source-fingerprint.mjs';

export const PARTITIONS = ['core-1', 'core-2', 'core-3', 'core-4', 'serial'];
// GitHub job outputs and individual environment values are bounded. Fail rather than truncate a receipt.
const MAX_ENCODED = 60_000;
const MAX_DECODED = 2 * 1024 * 1024;
export function assignedFiles(partition, files) {
  if (!PARTITIONS.includes(partition)) throw new Error(`Unknown test partition: ${partition}`);
  const sorted = [...files].sort();
  return partition === 'serial' ? sorted : sorted.filter((_, index) => index % 4 === Number(partition.slice(-1)) - 1);
}
export function encodeReceipt(receipt) {
  const payload = Buffer.from(JSON.stringify(receipt));
  if (payload.length > MAX_DECODED) throw new Error('Validation receipt exceeds decoded size limit');
  const encoded = gzipSync(payload).toString('base64');
  if (encoded.length > MAX_ENCODED) throw new Error('Validation receipt exceeds job-output size limit');
  return encoded;
}
export function decodeReceipt(encoded) {
  if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_ENCODED || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Missing or invalid validation receipt');
  return JSON.parse(gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_DECODED }).toString());
}
const validSource = (s) => s && s.algorithm === 'sha256' && s.version === 1 &&
  /^[a-f0-9]{40,64}$/.test(s.commit ?? '') && [s.digest, s.statusDigest, s.mutationDigest].every((value) => /^[a-f0-9]{64}$/.test(value ?? '')) &&
  typeof s.dirty === 'boolean' && Number.isInteger(s.files) && Number.isInteger(s.bytes);
export function aggregateReceipts(inventory, receipts, registry, source, nativeReceipt, jobResults) {
  const problems = [];
  for (const partition of [...PARTITIONS, 'native']) {
    if (jobResults?.[partition] !== 'success') problems.push(`Upstream job did not succeed: ${partition} (${jobResults?.[partition] ?? 'missing result'})`);
  }
  const names = receipts.map((r) => r.partition).sort();
  if (JSON.stringify(names) !== JSON.stringify([...PARTITIONS].sort())) problems.push('Expected exactly core-1, core-2, core-3, core-4 and serial receipts');
  for (const receipt of receipts) {
    if (receipt.status !== 'passed' || receipt.problems?.length) problems.push(`Partition did not pass: ${receipt.partition}`);
    const start = receipt.source?.start;
    const end = receipt.source?.end;
    if (!validSource(start) || !validSource(end) || sourceChanges(start, end).length || receipt.source.unchanged !== true) problems.push(`Partition source changed or receipt is incomplete: ${receipt.partition}`);
    if (start?.digest !== source.digest || start?.commit !== source.commit || start?.dirty || end?.dirty) problems.push(`Partition checked different or dirty source: ${receipt.partition}`);
    if (JSON.stringify(receipt.inventory) !== JSON.stringify([...inventory].sort())) problems.push(`Partition inventory differs: ${receipt.partition}`);
    if (!receipt.report) problems.push(`Missing test results: ${receipt.partition}`);
    if (typeof receipt.runId !== 'string' || receipt.report?.runId !== receipt.runId) problems.push(`Stale test results from another run: ${receipt.partition}`);
  }
  const first = receipts.find((r) => r.partition === 'core-1');
  if (JSON.stringify(first?.checks) !== JSON.stringify(['typecheck', 'lint', 'test:tooling'])) problems.push('The core-1 receipt lacks the required preflight checks');
  const reports = receipts.flatMap((r) => r.report ? [r.report] : []);
  problems.push(...checkAccounting(inventory, reports, registry));
  const keys = ['passed', 'expectedFailure', 'failed', 'skipped', 'todo', 'pending'];
  const counts = Object.fromEntries(keys.map((key) => [key, reports.reduce((sum, report) => sum + (report.counts[key] ?? 0), 0)]));
  const nativeStart = nativeReceipt?.source?.start;
  const nativeEnd = nativeReceipt?.source?.end;
  if (nativeReceipt?.partition !== 'native' || nativeReceipt.status !== 'passed' || nativeReceipt.problems?.length) problems.push('Native validation receipt is missing or failed');
  if (!validSource(nativeStart) || !validSource(nativeEnd) || sourceChanges(nativeStart, nativeEnd).length || nativeReceipt.source.unchanged !== true) problems.push('Native source changed or receipt is incomplete');
  if (nativeStart?.commit !== source.commit || nativeStart?.digest !== source.digest || nativeStart?.dirty || nativeEnd?.dirty) problems.push('Native validation checked different or dirty source');
  if (!nativeReceipt?.runId || nativeReceipt.native?.runId !== nativeReceipt.runId || nativeReceipt.native?.status !== 'passed' || nativeReceipt.native?.problems?.length || !(nativeReceipt.native?.counts?.passed > 0) || nativeReceipt.native.counts.failed) problems.push('Native test accounting is incomplete, stale or failed');
  return { files: inventory.length, counts, upstreamResults: jobResults ?? null, nativeCounts: nativeReceipt?.native?.counts ?? null, problems };
}

/** Small structured log lines preserve exact evidence even when artifact storage is unavailable. */
export function receiptChunks(receipt) {
  const encoded = encodeReceipt(receipt);
  const chunks = encoded.match(/.{1,8192}/g) ?? [];
  return chunks.map((data, index) => ({ partition: receipt.partition, index, total: chunks.length, data }));
}
