/** Fail closed: a new skip/expected failure, omitted file or duplicate partition is never silently green. */
export function checkAccounting(inventory, reports, registry) {
  const problems = [];
  if (new Set(inventory).size !== inventory.length) problems.push('Discovered test inventory contains duplicate files');
  const files = reports.flatMap((r) => r.files);
  const seen = new Set(files);
  if (seen.size !== files.length) problems.push('A test file ran in more than one partition');
  for (const file of inventory) if (!seen.has(file)) problems.push(`Test file was not run: ${file}`);
  for (const file of seen) if (!inventory.includes(file)) problems.push(`Unexpected test file: ${file}`);
  for (const report of reports) {
    if (report.reason !== 'passed' || report.unhandledErrors) problems.push('A partition failed, was interrupted, or had unhandled errors');
    if (report.counts.failed || report.counts.pending) problems.push('A partition has failed or unfinished tests');
  }
  const key = (row) => `${row.file}\n${row.name}\n${row.status}`;
  const actual = new Set(reports.flatMap((r) => r.exceptions).map(key));
  const approved = new Set(registry.entries.map(key));
  for (const row of actual) if (!approved.has(row)) problems.push(`Unaccounted test status: ${row}`);
  for (const row of approved) if (!actual.has(row)) problems.push(`Stale test disposition (review before removing): ${row}`);
  for (const row of registry.entries) {
    if (!row.reason || !row.source || !row.disposition) problems.push(`Missing rationale/source/disposition: ${key(row)}`);
  }
  return problems;
}
