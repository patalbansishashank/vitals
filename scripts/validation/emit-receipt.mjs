import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeReceipt, receiptChunks } from './ci-receipts.mjs';

const receipt = JSON.parse(readFileSync(resolve(process.env.VITALS_GATE_DIR || '.vitest/release', 'summary.json'), 'utf8'));
if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required for a CI partition receipt');
appendFileSync(process.env.GITHUB_OUTPUT, `receipt=${encodeReceipt(receipt)}\n`);
for (const chunk of receiptChunks(receipt)) console.log(`VALIDATION_RECEIPT_CHUNK ${JSON.stringify(chunk)}`);
console.log(`Validation receipt exported for ${receipt.partition}: status=${receipt.status}, source=${receipt.source?.start?.digest}, counts=${JSON.stringify(receipt.counts ?? receipt.report?.counts ?? {})}`);
