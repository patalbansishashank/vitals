/**
 * The "because your X was Y on date" line (SUITE_SPEC §13.5.3, COMPONENTS §14.6). Built by code from the stored
 * reading, never by a model: the value and unit are the reading's **entered** ones, the date is in the person's style.
 */
import type { Because, MarkerNote } from './types';
import { MARKER_UNITS, displayValue } from './units';

export type DateStyle = 'day-month' | 'month-day';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Sep 2026" / "Sep 14, 2026"; `year: false` drops the year ("14 Sep"). */
export function formatMarkerDate(iso: string, style: DateStyle = 'day-month', year = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = Number(m[3]);
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  if (style === 'month-day') return year ? `${mon} ${d}, ${m[1]}` : `${mon} ${d}`;
  return year ? `${d} ${mon} ${m[1]}` : `${d} ${mon}`;
}

/** Whole months between two ISO dates (floor). */
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`);
  let n = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) n -= 1;
  return n;
}

export interface BecauseOptions {
  style?: DateStyle;
  /** "because LDL 192 · 14 Sep" (chip under 280 px). */
  short?: boolean;
  /** Adds "· old result" when the reading is more than 12 months before `today`. */
  today?: string;
}

/** "because your LDL cholesterol was 192 mg/dL on 14 Sep 2026". */
export function becauseText(b: Because | MarkerNote, opts: BecauseOptions = {}): string {
  const x: Because = 'because' in b ? b.because : b;
  const label = MARKER_UNITS[x.markerId]?.label ?? x.label;
  const v = displayValue(x.markerId, x.value, x.unit);
  const old = opts.today && monthsBetween(x.date, opts.today) >= 12 ? ' · old result' : '';
  if (opts.short) return `because ${shortLabel(label)} ${v} · ${formatMarkerDate(x.date, opts.style, false)}${old}`;
  return `because your ${label} ${/s$/.test(label) ? 'were' : 'was'} ${readingText(x.markerId, x.value, x.unit)} on ${formatMarkerDate(x.date, opts.style)}${old}`;
}

/** A reading's value with its unit as entered: "5.3 mEq/L", "5.9%". The banner note and the chip both use this. */
export function readingText(markerId: Because['markerId'], value: number, unit: string): string {
  return `${displayValue(markerId, value, unit)}${unit === '%' ? '%' : ` ${unit}`}`;
}

const DATE_RE = '(?:\\d{1,2} [A-Z][a-z]{2} \\d{4}|[A-Z][a-z]{2} \\d{1,2}, \\d{4})';
/** "because your LDL was 172 mg/dL on 14 Sep 2026": a named reading with a number (not "were both low"). */
const CLAUSE_RE = `ecause your [^,:;]+? (?:was|were) [<>≤≥]?\\d[^;]*? on ${DATE_RE}(?: · old result)?`;

/**
 * A note's sentence with its "because your X was Y on date" clause taken out, for when a `<BecauseChip>` follows it
 * and says just that (COMPONENTS §14.6, Q6-14). A clause inside the sentence goes with its comma; a sentence that
 * opens with it reads "Because of this result" (or, before a colon, starts at what follows).
 */
export function withoutBecause(text: string): string {
  const inner = text.replace(new RegExp(`,? b${CLAUSE_RE}`, 'g'), '');
  return inner
    .replace(new RegExp(`^B${CLAUSE_RE}: (.)`), (_all, c: string) => c.toUpperCase())
    .replace(new RegExp(`^B${CLAUSE_RE}`), 'Because of this result');
}

const shortLabel = (label: string): string => label.replace(/ cholesterol$/, '').replace(/ \(.*\)$/, '');

/** Fills the research message placeholders ({value} {v} {date} {cap} {uln} {old} {d1} {d2}). */
export function fillMessage(message: string, vars: Readonly<Record<string, string | number | undefined>>): string {
  return message.replace(/\{(\w+)\}/g, (all, k: string) => {
    const key = k === 'v' ? 'value' : k;
    const val = vars[key];
    return val === undefined ? all : String(val);
  });
}
