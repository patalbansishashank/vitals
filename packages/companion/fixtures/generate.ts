// Regenerates tool-manifest.json: node packages/companion/fixtures/generate.ts
import { writeFileSync } from 'node:fs';
import { buildToolManifest, type CommandDefLike } from '../src/toolManifest.ts';
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const all = ['ui', 'ai', 'webmcp', 'mcp'] as const;
const defs: CommandDefLike[] = [
  { id: 'today.get', title: 'Read today', description: 'Returns today\'s plan targets, logged intake and the adherence score so far. No side effects.', input: obj({}), output: obj({ date: { type: 'string', format: 'date' }, score: { type: ['number', 'null'] } }, ['date', 'score']), perm: 'read', surfaces: all, idempotency: 'none' },
  { id: 'log.get', title: 'Read the log', description: 'Returns logged meals, sessions and measurements between two ISO dates (inclusive).', input: obj({ from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, ['from', 'to']), perm: 'read', surfaces: all, idempotency: 'none' },
  { id: 'log.measurement', title: 'Log a measurement', description: 'Logs a body measurement. Weight in kg, waist in cm. Example: {"kind":"weight","value":82.4}.', input: obj({ kind: { type: 'string', enum: ['weight', 'waist'] }, value: { type: 'number' }, at: { type: 'string', format: 'date-time' }, idempotencyKey: { type: 'string', maxLength: 64 } }, ['kind', 'value', 'idempotencyKey']), perm: 'write', impact: 'low', surfaces: all, idempotency: 'key' },
  { id: 'plan.shift', title: 'Shift the plan', description: 'Moves the remaining plan days by a number of days (positive = later). Changes goal dates.', input: obj({ days: { type: 'integer', minimum: -14, maximum: 14 } }, ['days']), perm: 'write', impact: 'consequential', surfaces: all, idempotency: 'key' },
  { id: 'plan.end', title: 'End the plan', description: 'Ends the active plan now. Cannot be undone after 30 days.', input: obj({ reason: { type: 'string' } }), perm: 'destructive', surfaces: ['ui', 'ai', 'webmcp', 'mcp'], idempotency: 'key' },
  { id: 'settings.update', title: 'Change settings', description: 'Changes app settings.', input: obj({ patch: { type: 'object' } }, ['patch']), perm: 'write', impact: 'low', surfaces: ['ui'], idempotency: 'natural' },
  { id: 'nav.open', title: 'Open a screen', description: 'Opens a screen in the app tab (today, plan, log, coach, settings).', input: obj({ route: { type: 'string', enum: ['today', 'plan', 'log', 'coach', 'settings'] } }, ['route']), perm: 'read', surfaces: ['ui', 'ai', 'webmcp'], idempotency: 'none' },
];
const m = await buildToolManifest(defs, 'fixture');
writeFileSync(new URL('./tool-manifest.json', import.meta.url), JSON.stringify(m, null, 2) + '\n');
console.log(m.hash, m.tools.map(t=>t.name).join(','));
