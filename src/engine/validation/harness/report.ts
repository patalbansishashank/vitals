/**
 * Report rendering (WP-V): a monospace table for the test log (`--reporter=verbose` prints it) and a Markdown form for
 * `KNOWN_MISSES.md`. Pure string functions; no file access here.
 */
import type { Outcome, Status } from './types';

const fmt = (x: number): string => {
  if (!Number.isFinite(x)) return 'n/a';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2);
  return String(Number(x.toPrecision(4)));
};

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

const STATUS_LABEL: Record<Status, string> = {
  pass: 'PASS',
  miss: 'MISS (gating)',
  'known-miss': 'known miss',
  'now-passing': 'NOW PASSING (promote to M)',
  'q-pass': 'q ok',
  'q-miss': 'q miss',
  'no-data': 'NO DATA',
  error: 'ERROR',
  skipped: 'skipped',
};

export const statusLabel = (s: Status): string => STATUS_LABEL[s];

/** Counts by status. */
export function tally(outcomes: readonly Outcome[]): Record<Status, number> {
  const t: Record<Status, number> = { pass: 0, miss: 0, 'known-miss': 0, 'now-passing': 0, 'q-pass': 0, 'q-miss': 0, 'no-data': 0, error: 0, skipped: 0 };
  for (const o of outcomes) t[o.status]++;
  return t;
}

export interface ReportHeader {
  title: string;
  readiness: string;
  /** True when the engine still has stub modules: numbers are placeholder physics. */
  placeholder: boolean;
}

/** Monospace table. Rows keep scenario order. */
export function formatTable(outcomes: readonly Outcome[], header: ReportHeader): string {
  const rows = outcomes.map((o) => ({
    id: `${o.dossier} ${o.target}`,
    scn: o.title,
    what: o.label,
    exp: `${o.expected} ${o.unit}`.trim(),
    got: fmt(o.measured),
    err: o.status === 'error' ? 'exception' : Number.isFinite(o.error) ? (o.error > 0 ? '+' : '') + fmt(o.error) : 'n/a',
    gate: o.gate,
    st: statusLabel(o.status),
  }));
  const w = { id: 9, scn: 34, what: 60, exp: 22, got: 9, err: 10, gate: 4, st: 26 };
  const line = '-'.repeat(w.id + w.scn + w.what + w.exp + w.got + w.err + w.gate + w.st + 14);
  const out: string[] = [];
  out.push('');
  out.push(line);
  out.push(`${header.title}`);
  out.push(header.readiness + (header.placeholder ? '  -- engine values below are PLACEHOLDER physics, statuses are informational only' : ''));
  const t = tally(outcomes);
  out.push(
    `rows ${outcomes.length}: pass ${t.pass}, MISS ${t.miss}, known-miss ${t['known-miss']}, now-passing ${t['now-passing']}, q ${t['q-pass']}/${t['q-pass'] + t['q-miss']}, no-data ${t['no-data']}, error ${t.error}`,
  );
  out.push(line);
  out.push(`${pad('dossier', w.id)} ${pad('scenario', w.scn)} ${pad('expectation', w.what)} ${pad('expected', w.exp)} ${padL('engine', w.got)} ${padL('error', w.err)} ${pad('gate', w.gate)} ${pad('status', w.st)}`);
  out.push(line);
  for (const r of rows) {
    out.push(`${pad(r.id, w.id)} ${pad(r.scn, w.scn)} ${pad(r.what, w.what)} ${pad(r.exp, w.exp)} ${padL(r.got, w.got)} ${padL(r.err, w.err)} ${pad(r.gate, w.gate)} ${pad(r.st, w.st)}`);
  }
  out.push(line);
  return out.join('\n');
}

/** Markdown table of the given outcomes (for KNOWN_MISSES.md). */
export function formatMarkdown(outcomes: readonly Outcome[], header: ReportHeader): string {
  const esc = (s: string): string => s.replace(/\|/g, '\\|');
  const out: string[] = [];
  out.push(`### ${header.title}`);
  out.push('');
  out.push(`_${header.readiness}${header.placeholder ? ' - values are placeholder physics until every module is implemented' : ''}_`);
  out.push('');
  out.push('| dossier | scenario: expectation | expected | engine | error | gate | status |');
  out.push('|---|---|---|---|---|---|---|');
  for (const o of outcomes) {
    out.push(
      `| ${o.dossier} ${o.target} | ${esc(`${o.title}: ${o.label}`)} | ${esc(`${o.expected} ${o.unit}`.trim())} | ${fmt(o.measured)} | ${Number.isFinite(o.error) ? (o.error > 0 ? '+' : '') + fmt(o.error) : 'n/a'} | ${o.gate} | ${statusLabel(o.status)} |`,
    );
  }
  return out.join('\n');
}

/** One line per failing gating row, for assertion messages. */
export function describeOutcome(o: Outcome): string {
  const head = `[${o.dossier} ${o.target}] ${o.title}: ${o.label}`;
  if (o.status === 'error') return `${head} -> engine error: ${o.errorMessage ?? '?'}`;
  return `${head} -> engine ${fmt(o.measured)} ${o.unit}, expected ${o.expected} ${o.unit}, error ${Number.isFinite(o.error) ? fmt(o.error) : 'n/a'} (${statusLabel(o.status)})`;
}
