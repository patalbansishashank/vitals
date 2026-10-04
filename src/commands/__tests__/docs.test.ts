/**
 * docs/COMMANDS.md carries the command table generated from the registry (between the `commands:start` / `commands:end`
 * markers). `GEN_DOCS=1 pnpm vitest run src/commands/__tests__/docs.test.ts` rewrites it; otherwise the test fails when
 * the table is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allCommands, type CommandDef } from '..';
import { toolName } from '../manifest';

const FILE = join(__dirname, '..', '..', '..', 'docs', 'COMMANDS.md');
const START = '<!-- commands:start -->';
const END = '<!-- commands:end -->';

const PERM = (d: CommandDef) => (d.perm === 'read' ? 'R' : d.perm === 'destructive' ? 'D' : d.impact === 'consequential' ? 'W·c' : 'W');
const UNDO = (d: CommandDef) => ({ none: '—', inversePatch: 'IP', retract: 'RT', tombstone: 'TS', compensating: `CP (${'command' in d.undo ? d.undo.command : ''})` })[d.undo.kind];
const IDEM = (d: CommandDef) => ({ natural: 'N', key: 'K', none: '—' })[d.idempotency];
const SURF = (d: CommandDef) => (d.surfaces.length === 4 ? 'all' : d.surfaces.join(' '));
const STATUS = (d: CommandDef) => (d.notImplemented ? `stub · ${d.notImplemented.owner}` : 'implemented');
const esc = (s: string) => s.replace(/\|/g, '\\|');

export function commandTable(): string {
  const rows = allCommands().map(
    (d) => `| \`${d.id}\` | \`${toolName(d.id)}\` | ${PERM(d)} | ${SURF(d)} | ${UNDO(d)} | ${IDEM(d)} | ${d.longRunning ? 'job' : ''} | ${esc(STATUS(d))} | ${esc(d.title)} |`,
  );
  const byDomain = new Map<string, number>();
  for (const d of allCommands()) byDomain.set(d.id.split('.')[0]!, (byDomain.get(d.id.split('.')[0]!) ?? 0) + 1);
  const stubs = allCommands().filter((d) => d.notImplemented).length;
  return [
    `${allCommands().length} commands (${allCommands().length - stubs} implemented, ${stubs} stubs) in ${byDomain.size} domains: ${[...byDomain].map(([k, n]) => `${k} ${n}`).join(' · ')}.`,
    '',
    '| Command | Tool name | Perm | Surfaces | Undo | Idem | Run | Status | Title |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

describe('docs/COMMANDS.md', () => {
  it('carries the current command table', () => {
    const doc = readFileSync(FILE, 'utf8');
    const i = doc.indexOf(START);
    const j = doc.indexOf(END);
    expect(i).toBeGreaterThan(-1);
    const table = commandTable();
    const next = `${doc.slice(0, i + START.length)}\n${table}\n${doc.slice(j)}`;
    if (process.env.GEN_DOCS === '1') writeFileSync(FILE, next);
    else expect(doc.slice(i + START.length, j).trim()).toBe(table.trim());
  });
});
