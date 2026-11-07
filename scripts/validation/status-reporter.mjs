import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/** Records executed test identities, including expected failures (which Vitest correctly counts separately). */
export default class StatusReporter {
  onTestRunEnd(modules, errors, reason) {
    const destination = process.env.VITALS_TEST_REPORT;
    if (!destination) return;
    const counts = { passed: 0, expectedFailure: 0, failed: 0, skipped: 0, todo: 0, pending: 0 };
    const exceptions = [];
    for (const module of modules) {
      for (const test of module.children.allTests()) {
        const result = test.result();
        const status = result.state === 'passed' && test.options.fails ? 'expectedFailure'
          : result.state === 'skipped' && test.options.mode === 'todo' ? 'todo' : result.state;
        counts[status]++;
        if (status !== 'passed') exceptions.push({
          file: relative(process.cwd(), module.moduleId).replaceAll('\\', '/'),
          name: test.fullName,
          status,
          ...(result.note ? { note: result.note } : {}),
        });
      }
    }
    exceptions.sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify({ schemaVersion: 1, runId: process.env.VITALS_TEST_RUN_ID ?? null, reason, unhandledErrors: errors.length,
      files: modules.map((m) => relative(process.cwd(), m.moduleId).replaceAll('\\', '/')).sort(), counts, exceptions }, null, 2)}\n`);
  }
}
