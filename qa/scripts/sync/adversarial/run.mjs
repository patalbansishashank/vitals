process.env.SYNC_LABEL_PREFIX = 'C-SYNCX-';
process.env.SYNC_RESULT_GROUP = 'C-SYNCX';
const { withGroup } = await import('./context.mjs');
const choices = new Set(['longOffline', 'conflicts', 'ring', 'mcp', 'killUpload', 'lateHistory']);
const names = process.argv.slice(2);
if (!names.length || names.some((name) => !choices.has(name)))
  throw new Error(`Choose scenarios: ${[...choices].join(', ')}`);
let failed = false;
for (const name of names) {
  const scenario = (await import(`./${name}.mjs`)).default;
  const result = await withGroup(name, scenario);
  failed ||= result.failed > 0;
}
process.exit(failed ? 1 : 0);
