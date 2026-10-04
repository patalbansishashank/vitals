/**
 * Report table layout → marker rows (docs/SUITE_SPEC.md §13.5.6 step 1). Pure.
 *
 * Input: positioned text items `{str, x, y, w, h, page}` (y = baseline from the top of the page, as pdf.ts produces).
 *   1. buildLines: items → lines by y (tolerance ~⅓ of the glyph height) → segments by x (a gap of more than ~0.6 em
 *      starts a new segment).
 *   2. Patient-block lines (redact.ts) are dropped, and so is everything above a page's table header.
 *   3. detectHeader: a line with "TEST" + "RESULT"/"VALUE" (+ "UNIT(S)", "BIO. REF. INTERVAL"/"REFERENCE RANGE",
 *      "METHOD"/"TECHNOLOGY", "FLAG") gives the columns; each later segment goes to the column it overlaps most. A page
 *      without a header continues with the last page's columns; with no header at all, lines are read left to right.
 *   4. Lines with only a range cell continue the previous row's range (category tables: "Desirable : < 200",
 *      "Borderline High : 200-239", …), "Method : …" lines under a name become that row's method, other name-only lines
 *      are section headings (or the wrapped tail of the previous name, when close below it).
 *   5. buildExtraction: names → markers (synonyms.ts), values, units (typo fixes), bounds, calculated rows, confidence.
 *
 * Confidence (0–1): 1.0 = exact synonym + accepted unit + inside soft bounds. Multiplied down by: pattern (not exact)
 * name 0.85; unit typo fixed 0.55; no unit printed 0.6; unit not recognised 0.4; soft-bound outlier 0.6; plausibility
 * block 0.3; printed with "<" / ">" 0.7; value not a number 0.2; a kept calculated LDL is capped at 0.8. The review table
 * reads ≥ 0.9 as high, ≥ 0.7 as medium, else low (`CONFIDENCE` in ../types.ts).
 */
import { ulid } from '@/store/ids';
import type { LocalDate } from '@/store';
import type { DisplayOnlyRow, ExtractionRow, MarkerExtraction, MarkerId } from '../types';
import { MARKER_IDS } from '../types';
import { checkBounds, isAcceptedUnit, normaliseUnit } from '../units';
import { findSampleDate, isPatientLine, type Box } from './redact';
import { isCalculated, LDL_CALCULATED_ISSUE, matchName } from './synonyms';

/* ------------------------------------------------------------------------------------------- lines */

/** One positioned text run. `y` is the baseline measured from the top of the page; `h` the glyph height. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

export interface Segment {
  text: string;
  x: number;
  x2: number;
  y: number;
  h: number;
}

export interface Line {
  page: number;
  /** Baseline (top-down). */
  y: number;
  h: number;
  segments: Segment[];
  /** The line's items, left to right (columns are assigned per item, so a tight layout does not glue cells together). */
  items: TextItem[];
  text: string;
  /** Top-left box around the line. */
  box: Box;
}

export interface LineOptions {
  /** Rows closer than this fraction of the glyph height share a line (default 0.35). */
  rowTolerance?: number;
  /** A gap wider than this many glyph heights starts a new segment (default 0.6). */
  segmentGap?: number;
}

/** Group items into lines (by y) and each line into segments (by x). Lines come out page by page, top to bottom. */
export function buildLines(items: readonly TextItem[], opts: LineOptions = {}): Line[] {
  const tolF = opts.rowTolerance ?? 0.35;
  const gapF = opts.segmentGap ?? 0.6;
  const usable = items.filter((i) => i.str.trim() !== '' && i.h > 0);
  const byPage = new Map<number, TextItem[]>();
  for (const it of usable) byPage.set(it.page, [...(byPage.get(it.page) ?? []), it]);
  const out: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(page)!.sort((a, b) => a.y - b.y || a.x - b.x);
    const groups: TextItem[][] = [];
    for (const it of list) {
      const g = groups[groups.length - 1];
      if (g) {
        const y0 = g[0]!.y;
        const h = Math.min(it.h, ...g.map((x) => x.h));
        if (Math.abs(it.y - y0) <= Math.max(1.5, tolF * h)) {
          g.push(it);
          continue;
        }
      }
      groups.push([it]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      const segs: Segment[] = [];
      for (const it of g) {
        const s = segs[segs.length - 1];
        const gap = s ? it.x - s.x2 : Infinity;
        if (s && gap <= gapF * Math.max(s.h, it.h)) {
          s.text +=
            (gap > 0.12 * it.h && !s.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          s.x2 = Math.max(s.x2, it.x + it.w);
          s.h = Math.max(s.h, it.h);
        } else {
          segs.push({ text: it.str, x: it.x, x2: it.x + it.w, y: it.y, h: it.h });
        }
      }
      for (const s of segs) s.text = s.text.replace(/\s+/g, ' ').trim();
      const h = Math.max(...g.map((i) => i.h));
      const y = g[0]!.y;
      const x0 = Math.min(...segs.map((s) => s.x));
      const x1 = Math.max(...segs.map((s) => s.x2));
      out.push({
        page,
        y,
        h,
        segments: segs,
        items: g,
        text: segs.map((s) => s.text).join(' '),
        box: { page, x: x0, y: y - h, w: x1 - x0, h: h * 1.25 },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- header and columns */

export type ColumnRole = 'name' | 'value' | 'unit' | 'range' | 'method' | 'flag';

export interface Column {
  role: ColumnRole;
  x: number;
  x2: number;
}

const ROLE_WORDS: ReadonlyArray<[ColumnRole, RegExp]> = [
  [
    'name',
    /^(tests?( name| description| parameters?| details)?|investigations?|parameters?|description|examination|analytes?|test\(s\)|name of (the )?test)$/,
  ],
  [
    'value',
    /^(results?|values?|observed values?|result values?|your (result|value)s?|observations?|test results?)$/,
  ],
  ['unit', /^units?$/],
  [
    'range',
    /^((bio(logical)?|ref(erence)?|normal)( ref(erence)?)?( range| interval| values?)s?|ref(erence)?|range|biological reference (interval|range))$/,
  ],
  ['method', /^(method(ology)?|technology|technique|principle)$/],
  ['flag', /^(flags?|h ?\/ ?l|status|remarks?)$/],
];

const roleOf = (text: string): ColumnRole | null => {
  const t = text
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[^a-z/() ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [role, re] of ROLE_WORDS) if (re.test(t)) return role;
  return null;
};

/** The table's columns when `line` is a header row ("TEST NAME · TECHNOLOGY · VALUE · UNITS · REFERENCE RANGE"), else null. */
export function detectHeader(line: Line): Column[] | null {
  const cols: Column[] = [];
  for (const s of line.segments) {
    const role = roleOf(s.text);
    if (!role) {
      // "TEST RESULT" printed as one run: split two known words
      const parts = s.text.split(/\s{1,}/);
      if (parts.length === 2 && roleOf(parts[0]!) === 'name' && roleOf(parts[1]!) === 'value') {
        const mid = s.x + (s.x2 - s.x) / 2;
        cols.push({ role: 'name', x: s.x, x2: mid }, { role: 'value', x: mid, x2: s.x2 });
      }
      continue;
    }
    if (cols.some((c) => c.role === role)) return null;
    cols.push({ role, x: s.x, x2: s.x2 });
  }
  const roles = new Set(cols.map((c) => c.role));
  if (!roles.has('name') || !roles.has('value') || cols.length < 3) return null;
  return cols.sort((a, b) => a.x - b.x);
}

interface Cells {
  name: string;
  value: string;
  unit: string;
  range: string;
  method: string;
  flag: string;
  /** A segment ran across three or more columns: prose (interpretation text), not a row. */
  prose: boolean;
}

const SLACK = 6;

function assign(line: Line, cols: readonly Column[]): Cells {
  const cells: Cells = { name: '', value: '', unit: '', range: '', method: '', flag: '', prose: false };
  const spans = cols.map(
    (c, i) =>
      [i === 0 ? -Infinity : c.x - SLACK, i === cols.length - 1 ? Infinity : cols[i + 1]!.x - SLACK] as const,
  );
  const last: Partial<Record<ColumnRole, number>> = {};
  const crossing = (x: number, x2: number): number =>
    spans.filter(([a, b]) => Math.min(b, x2) - Math.max(a, x) > 2).length;
  // pdf.js joins runs that sit close on a line ("IMMUNOTURBIDIMETRY 138"): an item that crosses a column boundary is cut
  // into words, each placed in proportion to its characters
  const pieces: TextItem[] = [];
  for (const it of line.items) {
    const n = crossing(it.x, it.x + it.w);
    const words = it.str.split(/(\s+)/);
    if (n >= 3 && words.filter((w) => w.trim()).length >= 8) cells.prose = true;
    if (n < 2 || words.length < 3) {
      pieces.push(it);
      continue;
    }
    const per = it.w / Math.max(1, it.str.length);
    let at = 0;
    for (const w of words) {
      if (w.trim()) pieces.push({ ...it, str: w, x: it.x + at * per, w: w.length * per });
      at += w.length;
    }
  }
  for (const it of pieces) {
    const x2 = it.x + it.w;
    let best = -1;
    let bestOv = -Infinity;
    spans.forEach(([a, b], i) => {
      const ov = Math.min(b, x2) - Math.max(a, it.x);
      // a zero-width item still belongs where it starts
      const score = ov > 0 ? ov : it.x >= a && it.x < b ? 0.001 : -Infinity;
      if (score > bestOv) {
        bestOv = score;
        best = i;
      }
    });
    if (best < 0) continue;
    const role = cols[best]!.role;
    const prevEnd = last[role];
    const glue =
      prevEnd === undefined
        ? ''
        : it.x - prevEnd > 0.12 * it.h && !cells[role].endsWith(' ') && !it.str.startsWith(' ')
          ? ' '
          : '';
    cells[role] = cells[role] + glue + it.str;
    last[role] = x2;
  }
  for (const k of ['name', 'value', 'unit', 'range', 'method', 'flag'] as const)
    cells[k] = cells[k].replace(/\s+/g, ' ').trim();
  return cells;
}

/* ------------------------------------------------------------------------------------------- values and units */

export interface ParsedValue {
  value: number | null;
  comparator?: '<' | '>' | '≤' | '≥';
  flag?: 'H' | 'L';
  /** Text left after the number and flag (a unit printed in the value cell). */
  rest: string;
}

const NUM = /^[-−]?(\d{1,3}(,\d{2,3})+(\.\d+)?|\d+(\.\d+)?|\.\d+)/;

/** "192", "192 H", "H 192", "< 0.5", "1,234", "7,240", "*6.4", "6.4 (H)", "12.4L", "<111" → number, comparator and flag. */
export function parseValue(raw: string): ParsedValue {
  let s = raw.replace(/[*†#]/g, ' ').replace(/[↑]/g, ' H ').replace(/[↓]/g, ' L ').trim();
  let flag: 'H' | 'L' | undefined;
  const flagRe = /(^|\s|\()(HH|LL|H|L|HIGH|LOW)(\)|\s|$)/i;
  const fm = flagRe.exec(s);
  if (fm) {
    flag = fm[2]!.toUpperCase().startsWith('H') ? 'H' : 'L';
    s = (s.slice(0, fm.index) + ' ' + s.slice(fm.index + fm[0].length)).trim();
  }
  let comparator: ParsedValue['comparator'];
  const cm = /^(<=|>=|<|>|≤|≥)\s*/.exec(s);
  if (cm) {
    comparator = cm[1] === '<=' ? '≤' : cm[1] === '>=' ? '≥' : (cm[1] as ParsedValue['comparator']);
    s = s.slice(cm[0].length);
  }
  const nm = NUM.exec(s);
  if (!nm) return { value: null, comparator, flag, rest: s };
  let rest = s.slice(nm[0].length).trim();
  // a flag glued to the number: "12.4L"
  const glued = /^(H|L)\b/.exec(rest);
  if (!flag && glued) {
    flag = glued[1] as 'H' | 'L';
    rest = rest.slice(1).trim();
  }
  const value = Number(nm[0].replace(/,/g, '').replace('−', '-'));
  return { value: Number.isFinite(value) ? value : null, comparator, flag, rest };
}

export interface ParsedUnit {
  unit: string | null;
  /** Issue text when a reading slip was corrected ("pq" read as pg). */
  fixed?: string;
}

const UNIT_TYPOS: ReadonlyArray<[RegExp, string, string]> = [
  [/pq/gi, 'pg', '"pq" read as pg; check this value'],
  [/mq/gi, 'mg', '"mq" read as mg; check this value'],
  [/(?<=\/\s*)d[I1i|]\b/g, 'dl', '"dI" read as dL; check this value'],
  [/(?<=\/\s*)m[I1|]\b/g, 'ml', '"mI" read as mL; check this value'],
  [/^rn/gi, 'm', '"rn" read as m; check this value'],
  [/(?<=\/\s*)1(?=$)/g, 'l', '"1" read as L; check this value'],
];

/** Normalise a printed unit; on failure try the common reading slips ("pq/mL" → "pg/mL"). */
export function parseUnit(raw: string): ParsedUnit {
  const s = raw.trim();
  if (!s) return { unit: null };
  const u = normaliseUnit(s);
  if (u) return { unit: u };
  for (const [re, to, issue] of UNIT_TYPOS) {
    const t = s.replace(re, to);
    if (t !== s) {
      const f = normaliseUnit(t);
      if (f) return { unit: f, fixed: issue };
    }
  }
  return { unit: null };
}

/* ------------------------------------------------------------------------------------------- rows */

/** A table row as read, before names are matched. */
export interface ParsedRow {
  name: string;
  valueText: string;
  unitText: string;
  rangeText: string;
  method: string;
  flag: string;
  page: number;
  y: number;
}

/** Next line of a range cell: a wrapped tail ("200-" + "239") is glued, a new category line is set off with "; ". */
const joinRange = (a: string, b: string): string =>
  !a ? b : /[-–]$/.test(a) ? a + b : /[:,/]$/.test(a) ? `${a} ${b}` : `${a}; ${b}`;

/** A name that visibly goes on ("… C-", "… (HS-", "LIPOPROTEIN (A") */
const unfinished = (name: string): boolean =>
  /[-(,/&]$/.test(name.trim()) || (name.match(/\(/g)?.length ?? 0) > (name.match(/\)/g)?.length ?? 0);

const METHOD_LINE = /^\(?\s*(method(ology)?|technology|principle)\s*[:-]?\s*/i;

const looksLikeName = (s: string): boolean =>
  /[A-Za-z]{2,}/.test(s) &&
  !/^(page|end of report|note|interpretation|comment|remarks?|disclaimer)\b/i.test(s.trim());

/** Read rows from lines: patient lines and anything above a page's first header are skipped. */
export function parseRows(lines: readonly Line[]): { rows: ParsedRow[]; headerFound: boolean } {
  const rows: ParsedRow[] = [];
  let cols: Column[] | null = null;
  let headerFound = false;
  let page = -1;
  let last: (ParsedRow & { h: number; lastY: number }) | null = null;
  const pagesWithHeader = new Set<number>();
  for (const l of lines) if (detectHeader(l)) pagesWithHeader.add(l.page);
  let inTable = false;
  let carry: boolean;

  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      // a page with its own header starts reading at that header; a page without continues the last table
      inTable = !pagesWithHeader.has(page) && cols !== null;
      // a name cut by the page break continues on the first line of a page without its own header
      carry = inTable && last !== null;
      if (!carry) last = null;
    } else carry = false;
    const header = detectHeader(line);
    if (header) {
      cols = header;
      headerFound = true;
      inTable = true;
      last = null;
      continue;
    }
    if (isPatientLine(line.text)) continue;
    if (cols && inTable) {
      const c = assign(line, cols);
      if (c.prose) continue;
      const hasValue = c.value !== '' && parseValue(c.value).value !== null;
      if (c.name && hasValue) {
        last = {
          name: c.name,
          valueText: c.value,
          unitText: c.unit,
          rangeText: c.range,
          method: c.method,
          flag: c.flag,
          page: line.page,
          y: line.y,
          h: line.h,
          lastY: line.y,
        };
        rows.push(last);
        continue;
      }
      if (c.name && c.value) {
        // a result that is not a number ("Negative", "Reactive"): kept as a row; the extraction decides what it is
        last = {
          name: c.name,
          valueText: c.value,
          unitText: c.unit,
          rangeText: c.range,
          method: c.method,
          flag: c.flag,
          page: line.page,
          y: line.y,
          h: line.h,
          lastY: line.y,
        };
        rows.push(last);
        continue;
      }
      const onlyRange = !c.name && !c.value && (c.range !== '' || c.method !== '' || c.unit !== '');
      if (last && onlyRange && line.y - last.lastY < last.h * 2.2) {
        if (c.unit) last.unitText = last.unitText ? `${last.unitText} ${c.unit}` : c.unit;
        if (c.range) last.rangeText = joinRange(last.rangeText, c.range);
        if (c.method) last.method = last.method ? `${last.method} ${c.method}` : c.method;
        last.lastY = line.y;
        continue;
      }
      if (c.name && !c.value && !c.unit) {
        if (last && METHOD_LINE.test(c.name)) {
          last.method = c.name.replace(METHOD_LINE, '').trim();
          last.lastY = line.y;
          if (c.range) last.rangeText = joinRange(last.rangeText, c.range);
          continue;
        }
        if (
          last &&
          ((carry && unfinished(last.name)) || (!carry && line.y - last.lastY < last.h * 1.35)) &&
          line.h >= last.h * 0.9 &&
          !c.range
        ) {
          last.name = /\w-$/.test(last.name) ? last.name + c.name : `${last.name} ${c.name}`; // "(APO-" + "B)"
          last.lastY = line.y;
          continue;
        }
        if (last && c.range && line.y - last.lastY < last.h * 2.2) {
          last.rangeText = joinRange(last.rangeText, c.range);
          last.lastY = line.y;
          continue;
        }
        last = null; // a section heading
      }
      continue;
    }
    if (pagesWithHeader.size === 0) {
      // No header anywhere: left to right, "name … number [flag] [unit] [range]".
      const r = freeRow(line);
      if (r) rows.push(r);
    }
  }
  return { rows, headerFound };
}

function freeRow(line: Line): ParsedRow | null {
  const segs = line.segments.map((s) => s.text);
  if (segs.length < 2 || !looksLikeName(segs[0]!) || parseValue(segs[0]!).value !== null) return null;
  const vi = segs.findIndex(
    (s, i) => i > 0 && parseValue(s).value !== null && /^[<>≤≥*\s]*[-−]?[\d.]/.test(s),
  );
  if (vi < 0) return null;
  const name = segs.slice(0, vi).join(' ');
  let rest = segs.slice(vi + 1);
  let flag = '';
  if (rest[0] && /^(H|L|HIGH|LOW)$/i.test(rest[0])) {
    flag = rest[0];
    rest = rest.slice(1);
  }
  let unit = '';
  if (rest[0] && (parseUnit(rest[0]).unit || /[/%]|^(fl|pg|ratio)$/i.test(rest[0]))) {
    unit = rest[0];
    rest = rest.slice(1);
  }
  return {
    name,
    valueText: segs[vi]!,
    unitText: unit,
    rangeText: rest.join(' '),
    method: '',
    flag,
    page: line.page,
    y: line.y,
  };
}

/* ------------------------------------------------------------------------------------------- extraction */

export interface ScoredRow {
  markerId: MarkerId;
  value: number | null;
  unit: string | null;
  confidence: number;
  issues: string[];
}

/**
 * Value, unit and confidence of one Tier A reading (shared by the text and the vision route).
 * `nameKind` 'exact' starts at 1, 'rule' at 0.85, 'vision' at 0.85.
 */
export function scoreReading(
  markerId: MarkerId,
  valueText: string,
  unitText: string,
  nameKind: 'exact' | 'rule' | 'vision',
): ScoredRow {
  const issues: string[] = [];
  let conf = nameKind === 'exact' ? 1 : 0.85;
  const pv = parseValue(valueText);
  let unitRaw = unitText.trim();
  if (!unitRaw && pv.rest && parseUnit(pv.rest).unit) unitRaw = pv.rest;
  const pu = parseUnit(unitRaw);
  let unit = pu.unit;
  if (pu.fixed) {
    issues.push(pu.fixed);
    conf *= 0.55;
  }
  if (unit && !isAcceptedUnit(markerId, unit))
    unit = SAME_UNIT[unit]?.find((u) => isAcceptedUnit(markerId, u)) ?? unit;
  if (!unitRaw) {
    issues.push('no unit printed; check the unit');
    conf *= 0.6;
  } else if (!unit || !isAcceptedUnit(markerId, unit)) {
    issues.push('unit not recognised');
    unit = null;
    conf *= 0.4;
  }
  if (pv.value === null) {
    issues.push('value not read as a number');
    conf *= 0.2;
  } else {
    if (pv.comparator) {
      issues.push(`printed as ${pv.comparator} ${pv.value}; the limit is used as the value`);
      conf *= 0.7;
    }
    if (unit) {
      const b = checkBounds(markerId, pv.value, unit);
      if (!b.ok) {
        issues.push(b.message);
        conf *= b.level === 'block' ? 0.3 : 0.6;
      }
    }
  }
  return { markerId, value: pv.value, unit, confidence: Math.round(conf * 100) / 100, issues };
}

/** Spellings of one unit (1 µIU/mL = 1 µU/mL = 1 mIU/L): a marker that lists one of them accepts the others. */
const SAME_UNIT: Readonly<Record<string, readonly string[]>> = {
  'µIU/mL': ['µU/mL', 'mIU/L'],
  'µU/mL': ['µIU/mL', 'mIU/L'],
  'mIU/L': ['µIU/mL', 'µU/mL'],
};

export interface BuildOptions {
  route: 'textLayer' | 'vision';
  sampleDate?: LocalDate;
  /** Pages that could not be read. */
  unreadPages?: number[];
  /** Id generator (tests). */
  newId?: () => string;
}

const num = (s: string): number | null => parseValue(s).value;

/** Recompute the lab's calculated lipid figures from the measured ones on the same report, in the same unit. */
function recompute(name: string, rows: readonly ParsedRow[], unit: string): number | null {
  const n = name.toLowerCase();
  const find = (pred: (m: ReturnType<typeof matchName>, r: ParsedRow) => boolean): number | null => {
    for (const r of rows) {
      const m = matchName(r.name);
      if (pred(m, r) && (parseUnit(r.unitText).unit ?? '') === unit) return num(r.valueText);
    }
    return null;
  };
  const isTotal = (r: ParsedRow) =>
    /^(s\s+)?(total cholesterol|cholesterol,? total|cholesterol|tc|serum cholesterol)$/i.test(r.name.trim());
  const total = find((_m, r) => isTotal(r));
  const hdl = find((m, r) => m.markerId === 'hdl' && !isCalculated(r.name, r.method));
  const tg = find((m) => m.markerId === 'tg');
  if (/non ?-?hdl/.test(n) && total !== null && hdl !== null) return total - hdl;
  if (/\bvldl\b/.test(n) && tg !== null) return unit === 'mmol/L' ? tg / 2.2 : tg / 5;
  return null;
}

const fmtNum = (x: number): string => String(Math.round(x * 10) / 10);

/** Rows → `MarkerExtraction`. Decisions on calculated rows: see synonyms.ts. */
export function buildExtraction(rows: readonly ParsedRow[], opts: BuildOptions): MarkerExtraction {
  const date = opts.sampleDate ?? ('' as LocalDate);
  const out: ExtractionRow[] = [];
  const displayOnly: DisplayOnlyRow[] = [];
  const seen = new Set<MarkerId>();
  const calcLdl: Array<{ row: ExtractionRow; parsed: ParsedRow }> = [];
  let hasDirectLdl = false;

  const show = (r: ParsedRow, value?: string) => {
    const unit = r.unitText.trim();
    displayOnly.push({
      name: r.name,
      value: value ?? r.valueText.trim(),
      ...(unit ? { unit } : {}),
      ...(r.rangeText ? { range: r.rangeText } : {}),
      date,
    });
  };

  for (const r of rows) {
    const m = matchName(r.name);
    if (!m.markerId) {
      if (looksLikeName(r.name)) show(r);
      continue;
    }
    const id = m.markerId;
    const calc = isCalculated(r.name, r.method, id);
    seen.add(id);
    if (calc && id !== 'ldl') {
      // recomputed and shown, not used
      const unit = parseUnit(r.unitText).unit ?? '';
      const re = recompute(r.name, rows, unit);
      const printed = num(r.valueText);
      const value =
        re !== null && printed !== null && Math.abs(re - printed) > Math.max(0.05 * Math.abs(printed), 0.1)
          ? `${r.valueText.trim()} (recomputed: ${fmtNum(re)})`
          : undefined;
      show(r, value);
      continue;
    }
    const s = scoreReading(id, r.valueText, r.unitText, m.kind === 'exact' ? 'exact' : 'rule');
    const row: ExtractionRow = {
      row: 0,
      markerId: id,
      nameOnReport: r.name,
      value: s.value,
      unit: s.unit,
      ...(r.rangeText ? { labRange: r.rangeText } : {}),
      ...(r.method ? { method: r.method } : {}),
      calculated: false,
      confidence: s.confidence,
      issues: s.issues,
    };
    if (id === 'ldl') {
      if (calc) {
        row.calculated = true;
        row.method = 'calculated';
        row.issues = [LDL_CALCULATED_ISSUE, ...row.issues];
        row.confidence = Math.min(row.confidence, 0.8);
        calcLdl.push({ row, parsed: r });
        continue;
      }
      hasDirectLdl = true;
      if (!r.method || /direct/i.test(r.name)) row.method = 'direct';
    }
    out.push(row);
  }
  for (const { row, parsed } of calcLdl) {
    if (hasDirectLdl) show(parsed);
    else out.push(row);
  }
  out.forEach((r, i) => (r.row = i + 1));
  const unread = opts.unreadPages?.length ? { unreadPages: [...opts.unreadPages] } : {};
  return {
    extractionId: (opts.newId ?? ulid)(),
    route: opts.route,
    ...(opts.sampleDate ? { sampleDate: opts.sampleDate } : {}),
    rows: out,
    displayOnly,
    notInReport: MARKER_IDS.filter((id) => !seen.has(id)),
    ...unread,
  };
}

export interface TextExtraction {
  extraction: MarkerExtraction;
  lines: Line[];
  headerFound: boolean;
}

/** Positioned text → extraction (the whole text-layer route after pdf.js). */
export function extractFromTextItems(
  items: readonly TextItem[],
  opts: Omit<BuildOptions, 'route' | 'sampleDate'> & { sampleDate?: LocalDate } = {},
): TextExtraction {
  const lines = buildLines(items);
  const sampleDate = opts.sampleDate ?? findSampleDate(lines.map((l) => l.text));
  const { rows, headerFound } = parseRows(lines);
  return {
    extraction: buildExtraction(rows, { ...opts, route: 'textLayer', sampleDate }),
    lines,
    headerFound,
  };
}
