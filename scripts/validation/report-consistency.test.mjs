import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ledger = JSON.parse(readFileSync('docs/validation/review-release-ledger.json', 'utf8'));
for (const file of ['docs/VALIDATION_REPORT.md', 'docs/VALIDATION_REPORT_INTERNAL.md']) {
  test(`${file} preserves the checked ledger's headline results`, () => {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes(`${ledger.scenarios} scenarios, ${ledger.expectations} expectations`));
    assert.ok(text.includes(`${ledger.gates.M.pass} of ${ledger.gates.M.rows} met`));
    assert.match(text, new RegExp(`${ledger.gates.M.registered} (?:registered )?known misses`));
    assert.ok(text.includes(`${ledger.register.byCls.K} accepted, ${ledger.register.byCls.open} open calibration items`));
    assert.ok(text.includes(`${ledger.gates.Q.inDirection} of ${ledger.gates.Q.rows}`));
    assert.ok(text.includes(`${ledger.unknownProvenance.length} unresolved rows`));
    assert.equal(ledger.unregisteredMisses.length, 0);
    assert.equal(ledger.noData.length, 0);
    assert.equal(ledger.errors.length, 0);
    assert.equal(ledger.independentStudies.externalEvaluation, 0);
    assert.match(text, /no independent empirical validation|none in this version/);
  });
}

test('software accounting uses the same unresolved-provenance count as the scientific ledger', () => {
  const text = readFileSync('docs/VALIDATION_ACCOUNTING.md', 'utf8');
  assert.ok(text.includes(`${ledger.unknownProvenance.length} outcome rows with unresolved provenance`));
});
