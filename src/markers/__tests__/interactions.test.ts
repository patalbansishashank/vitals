// @vitest-environment node
/**
 * The interaction table as a test fixture (SUITE_SPEC §13.5.2 invariants; PLAN 02 item 9 tests):
 *   - the committed table equals a fresh build from the four research files;
 *   - every rule of the research files is in the table with its kind, message and grade; every interaction row too;
 *   - the direction of every interaction row matches the write-up's "How each lever moves it" table;
 *   - every rule fires at its threshold and not on the other side of it;
 *   - no rule removes anything; caps of 0 only where the research plans a zero; every row has an opened source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKER_ID, buildTable, readInputs, serialise } from '../../../scripts/markers/build-interactions';
import { evaluateMarkers } from '../rules';
import raw from '../interactions.json';
import type { InteractionTable } from '../types';

const TABLE = raw as unknown as InteractionTable;
import type { Also, InteractionRule, MarkerId, MarkerReading, MarkersDoc, RuleContext } from '../types';
import { MARKER_IDS } from '../types';
import { isAcceptedUnit } from '../units';

const ROOT = join(__dirname, '..', '..', '..');
const INPUTS = readInputs(ROOT);
const TODAY = '2026-10-02';
const DATE = '2026-09-14';

describe('generated table', () => {
  it('equals a fresh build of the research files', () => {
    const fresh = serialise(buildTable(INPUTS));
    expect(readFileSync(join(ROOT, 'src/markers/interactions.json'), 'utf8')).toBe(fresh);
  });

  it('covers every Tier A marker exactly once', () => {
    expect(TABLE.markers.map((m) => m.markerId).sort()).toEqual([...MARKER_IDS].sort());
  });

  it('keeps every research rule with its kind, message, grade and sources', () => {
    let n = 0;
    for (const inp of INPUTS)
      for (const raw of inp.data.rules) {
        const r = TABLE.rules.find((x) => x.id === raw.id);
        expect(r, raw.id).toBeDefined();
        expect(r!.kind).toBe(raw.kind);
        expect(r!.markerId).toBe(MARKER_ID[raw.markerId]);
        expect(r!.message).toBe(raw.message);
        expect(r!.grade).toBe(raw.grade);
        expect(r!.sources.map((s) => s.id.split(':')[1])).toEqual(raw.sources);
        n++;
      }
    expect(n).toBe(TABLE.rules.filter((r) => r.target !== 'clinicianOnly').length);
  });

  it('keeps every research interaction row with its direction and grade', () => {
    const raws = INPUTS.flatMap((i) => i.data.interactions);
    expect(TABLE.interactions).toHaveLength(raws.length);
    raws.forEach((raw, k) => {
      const t = TABLE.interactions[k]!;
      expect([t.markerId, t.lever, t.direction, t.grade]).toEqual([MARKER_ID[raw.markerId], raw.lever, raw.direction, raw.grade]);
    });
  });
});

/* ------------------------------------------------------------------------------------------- invariants */

/** Rows whose only citation is the project's own research index (no external source in the research file). */
const INTERNAL_ONLY_RULES = ['W-L-HBA1C-C2', 'W-L-AST-3', 'W-L-NA-C2', 'W-L-K-C1', 'W-L-K-C2'];
const INTERNAL_ONLY_INTERACTIONS = 15;

describe('invariants', () => {
  const external = (s: { doi?: string; pmid?: string; url?: string; internal?: boolean }): boolean => !s.internal && !!(s.doi || s.pmid || s.url);

  it('every rule resolves its marker and has a W-L id, a grade and a message ≤ 200 characters', () => {
    const ids = new Set(TABLE.markers.map((m) => m.markerId));
    for (const r of TABLE.rules) {
      expect(ids.has(r.markerId), r.id).toBe(true);
      expect(r.id).toMatch(/^W-L-[A-Z0-9]+-C?\d+$/);
      expect(['A', 'B', 'C', 'D']).toContain(r.grade);
      expect(r.message.length, r.id).toBeLessThanOrEqual(200);
    }
    expect(new Set(TABLE.rules.map((r) => r.id)).size).toBe(TABLE.rules.length);
  });

  it('every interaction resolves its marker', () => {
    const ids = new Set(TABLE.markers.map((m) => m.markerId));
    for (const i of TABLE.interactions) expect(ids.has(i.markerId)).toBe(true);
  });

  it('every row cites a source with a DOI, PMID or URL (listed exceptions cite only the research index)', () => {
    const rulesWithout = TABLE.rules.filter((r) => !r.sources.some(external)).map((r) => r.id);
    expect(rulesWithout.sort()).toEqual([...INTERNAL_ONLY_RULES].sort());
    expect(TABLE.interactions.filter((i) => !i.sources.some(external))).toHaveLength(INTERNAL_ONLY_INTERACTIONS);
    for (const r of TABLE.rules) expect(r.sources.length, r.id).toBeGreaterThan(0);
  });

  it('no rule removes anything: kinds are cap/warn/reask/clinician/retest/prefer only', () => {
    for (const r of TABLE.rules) expect(['cap', 'warn', 'reask', 'clinician', 'retest', 'prefer']).toContain(r.kind);
    expect(JSON.stringify(TABLE.rules)).not.toMatch(/"kind":"(block|exclude|ban)"/);
  });

  it('a cap of 0 is only "not suggested" (creatine, potassium), a planned zero (alcohol) or maintenance (deficit)', () => {
    for (const r of TABLE.rules)
      for (const l of r.effect.locks ?? [])
        if (l.value === 0 && !l.relative) expect(['creatine-cap', 'potassium-supp-cap', 'alcohol-cap', 'deficit-cap'], r.id).toContain(l.lock);
  });

  it('every cap rule writes at least one planner lock', () => {
    for (const r of TABLE.rules.filter((x) => x.kind === 'cap')) expect(r.effect.locks?.length, r.id).toBeGreaterThan(0);
  });

  it('threshold units are units the marker accepts', () => {
    for (const r of TABLE.rules)
      if ('unit' in r.when && r.when.unit !== 'HOMA-IR') expect(isAcceptedUnit(r.markerId, r.when.unit), `${r.id} ${r.when.unit}`).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------- directions vs the write-ups */

const LEVER_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/^very-low-carb/i, 'vlc'],
  [/^moderate low-carb/i, 'lowcarb'],
  [/^high protein/i, 'highprotein'],
  [/^fasting 16:8/i, 'fast16_8'],
  [/^fasting 24/i, 'fast24'],
  [/^fasting 36/i, 'fast36_48'],
  [/^extended fast/i, 'fast48plus'],
  [/^saturated fat/i, 'satfat'],
  [/^dietary cholesterol/i, 'dietcholesterol'],
  [/^fibre/i, 'fibre'],
  [/^unsaturated fat/i, 'unsatfat'],
  [/^alcohol/i, 'alcohol'],
  [/^caffeine/i, 'caffeine'],
  [/^creatine/i, 'creatine'],
  [/^whey/i, 'wheyprotein'],
  [/^large deficit/i, 'deficit_large'],
  [/^moderate deficit/i, 'deficit_moderate'],
  [/^surplus/i, 'surplus'],
  [/^resistance training/i, 'resistance_load'],
  [/^aerobic training/i, 'aerobic_load'],
  [/^sleep debt/i, 'sleep_debt'],
  [/^weight loss/i, 'weight_loss'],
];

/** (lever → direction cells) per lever table of a write-up, in document order. */
function leverTables(md: string): Array<Map<string, string[]>> {
  const out: Array<Map<string, string[]>> = [];
  let cur: Map<string, string[]> | null = null;
  for (const line of md.split('\n')) {
    if (/^#{2,4} How each lever moves it/.test(line)) {
      cur = new Map();
      out.push(cur);
      continue;
    }
    if (/^#/.test(line)) cur = null;
    if (!cur || !line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    const name = cells[1] ?? '';
    const code = [...name.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).find((c) => /^(supp:)?[a-z0-9_]+$/.test(c));
    // one row may name several fasts ("Fasting 16:8, 24 h, 36–48 h")
    const fasts = /^fasting\b/i.test(name) && !code ? [/16:8/.test(name) && 'fast16_8', /\b24 h/.test(name) && 'fast24', /36/.test(name) && 'fast36_48'].filter((x): x is string => !!x) : [];
    const levers = fasts.length > 1 ? fasts : [code ?? LEVER_WORDS.find(([re]) => re.test(name))?.[1]].filter((x): x is string => !!x);
    for (const lever of levers) {
      if (!cur.has(lever)) cur.set(lever, []);
      // the direction cell, plus the rest of the row after a tab (shared prose tables say "unknown … Expected: small ↑")
      cur.get(lever)!.push(`${cells[2] ?? ''}\t${cells.slice(3).join(' ')}`);
    }
  }
  return out;
}

/** Write-up sections that hold more than one marker's lever table (creatinine and eGFR share one, in prose). */
const SHARED: Readonly<Record<string, readonly string[][]>> = {
  'R13-markers-liver-kidney-electrolytes.md': [['alt'], ['ast'], ['ggt'], ['creatinine', 'egfr'], ['uacr'], ['sodium'], ['potassium']],
};
const ARROW: Readonly<Record<string, RegExp>> = { up: /↑|\bup\b|rise/, down: /↓|\bdown\b|fall/, none: /\bnone\b|unknown|no (data|change)/i, mixed: /mixed|↕|↑.*↓|↓.*↑/ };

/** The direction a cell states: its word, else its arrows (↕ or both arrows = mixed), else none/unknown/– = none. */
function dirOf(cell: string): string | undefined {
  const word = /\b(up|down|none|mixed)\b/.exec(cell)?.[1];
  if (word) return word;
  if (/↕/.test(cell) || (/↑/.test(cell) && /↓/.test(cell))) return 'mixed';
  if (/↑/.test(cell)) return 'up';
  if (/↓/.test(cell)) return 'down';
  if (/^(–|-|—|unknown|no\b)/i.test(cell)) return 'none';
  return undefined;
}

/**
 * Cells written in prose that no keyword reads; checked by hand against the JSON direction:
 *   "as high protein" → the high-protein row (none) · "association only" → no planned effect (none) ·
 *   "protective (expected)" → no measured change (none) · "stable during; ↓ on refeeding" → mixed.
 */
const PROSE_DIRECTIONS = new Set(['egfr/wheyprotein', 'uacr/alcohol', 'sodium/highprotein', 'potassium/fast48plus']);

describe('directions match the write-ups', () => {
  for (const inp of INPUTS) {
    it(inp.md, () => {
      const tables = leverTables(inp.markdown);
      const sections = SHARED[inp.md] ?? inp.data.markers.map((m) => [m.id as string]);
      expect(tables.length).toBe(sections.length);
      let checked = 0;
      const mismatches: string[] = [];
      const unmatched: string[] = [];
      sections.forEach((ids, k) => {
        const t = tables[k]!;
        for (const row of inp.data.interactions.filter((i) => ids.includes(i.markerId))) {
          const cells = t.get(row.lever);
          if (!cells) {
            if (!String(row.lever).startsWith('supp:')) unmatched.push(`${row.markerId}/${row.lever}`);
            continue; // supplement rows named only in words
          }
          const msg = `${row.markerId}/${row.lever}: json ${row.direction}, write-up "${cells.map((c) => c.split('\t')[0]).join(' / ')}"`;
          const ok = ids.length === 1 ? cells.map((c) => dirOf(c.split('\t')[0]!)).includes(row.direction) : cells.some((c) => ARROW[row.direction]!.test(c));
          if (!ok && !PROSE_DIRECTIONS.has(`${row.markerId}/${row.lever}`)) mismatches.push(msg);
          checked++;
        }
      });
      expect(mismatches).toEqual([]);
      // every core lever row is checked; only some supplement rows are matched by name
      expect(unmatched).toEqual([]);
      expect(checked).toBeGreaterThan(0);
    });
  }
});

/* ------------------------------------------------------------------------------------------- thresholds */

const reading = (id: MarkerId, value: number, unit: string, extra: Partial<MarkerReading> = {}): MarkerReading => ({
  id,
  value,
  unit,
  valueCanonical: value,
  unitCanonical: unit,
  date: DATE,
  provenance: 'manual',
  confirmed: true,
  enteredAt: `${DATE}T08:00:00Z`,
  ...extra,
});

const OTHER_UNIT: Readonly<Partial<Record<MarkerId, string>>> = { hsCrp: 'mg/L', testosterone: 'ng/dL', tg: 'mg/dL', fpg: 'mg/dL' };

/** A context (and extra readings) that satisfies a rule's extra conditions. */
function satisfy(rule: InteractionRule): { ctx: RuleContext; others: MarkerReading[]; repeat: boolean } {
  const ctx: RuleContext = { sex: 'male', today: TODAY, bmi: 27, defaultDeficitCapPct: 25, fields: {}, flags: [] };
  const others: MarkerReading[] = [];
  let repeat = false;
  const fields = ctx.fields as Record<string, number | string | boolean | undefined>;
  for (const a of rule.also as Also[]) {
    if (a.kind === 'sex') ctx.sex = a.sex;
    if (a.kind === 'flag') ctx.flags = [...(ctx.flags ?? []), a.flag];
    if (a.kind === 'repeat') repeat = true;
    if (a.kind === 'marker') {
      const v = a.cmp === 'gt' ? a.value + 1 : a.cmp === 'lt' ? a.value - 1 : a.value;
      others.push(reading(a.markerId, v, a.unit || OTHER_UNIT[a.markerId]!));
    }
    if (a.kind === 'field') {
      if (a.field === 'bmi') ctx.bmi = a.cmp === 'lt' ? Number(a.value) - 1 : a.cmp === 'gt' ? Number(a.value) + 1 : Number(a.value);
      else if (a.field === 'reading.fasting') continue;
      else if (a.field.startsWith('context.')) continue;
      else if (a.cmp === 'in') fields[a.field] = (a.value as readonly string[])[0];
      else if (a.cmp === 'eq') fields[a.field] = a.value as string | boolean | number;
      else if (typeof a.value === 'number') fields[a.field] = a.cmp === 'gt' ? a.value + 1 : a.cmp === 'lt' ? a.value - 1 : a.value;
      else fields[a.field] = a.value as string;
    }
  }
  return { ctx, others, repeat };
}

function docWith(rule: InteractionRule, value: number, unit: string, others: MarkerReading[], repeat: boolean, extra: Partial<MarkerReading> = {}): MarkersDoc {
  const main = reading(rule.markerId, value, unit, extra);
  const fastingAlso = rule.also.find((a) => a.kind === 'field' && a.field === 'reading.fasting');
  if (fastingAlso && fastingAlso.kind === 'field') main.fasting = fastingAlso.value as boolean;
  const ctxAlso = rule.also.find((a) => a.kind === 'field' && a.field.startsWith('context.'));
  const context: MarkersDoc['context'] = {};
  if (ctxAlso && ctxAlso.kind === 'field') (context as Record<string, unknown>)[ctxAlso.field.slice(8)] = ctxAlso.value;
  const readings = [main, ...others];
  if (repeat) readings.push({ ...main, date: '2026-08-01', enteredAt: '2026-08-01T08:00:00Z' });
  return { _schema: 1, readings, displayOnly: [], context, chapter: 'manual' };
}

const fires = (rule: InteractionRule, doc: MarkersDoc, ctx: RuleContext): boolean => evaluateMarkers(doc, ctx, { rules: [rule] }).notes.some((n) => n.rule === rule.id);
const firesAny = (rule: InteractionRule, doc: MarkersDoc, ctx: RuleContext): boolean => {
  const ev = evaluateMarkers(doc, ctx, { rules: [rule] });
  return ev.notes.some((n) => n.rule === rule.id) || ev.retests.some((t) => t.rule === rule.id);
};

describe('every rule fires at its threshold and not on the other side', () => {
  for (const rule of TABLE.rules) {
    it(rule.id, () => {
      const { ctx, others, repeat } = satisfy(rule);
      const w = rule.when;
      const step = (t: number): number => Math.max(Math.abs(t) * 1e-3, 1e-3);
      switch (w.op) {
        case 'cmp': {
          let unit = w.unit;
          let t: number;
          let range: MarkerReading['labRange'];
          let mk = (v: number): MarkersDoc => docWith(rule, v, unit, others, repeat, range ? { labRange: range } : {});
          if (typeof w.value === 'number') t = w.value;
          else if (w.value === 'whoCutoff') t = ctx.sex === 'male' ? 13 : 12;
          else if (w.value === 'healthyULN') t = ctx.sex === 'male' ? 33 : 25;
          else {
            t = 40;
            range = w.value === 'labLow' ? { low: t, high: t * 3, unit } : { low: t / 3, high: t, unit };
          }
          if (unit === 'HOMA-IR') {
            // insulin at the HOMA-IR threshold with fasting glucose 5.0 mmol/L
            const g = reading('fpg', 5, 'mmol/L');
            unit = 'µU/mL';
            const ins = (h: number): number => (h * 22.5) / 5;
            mk = (h: number): MarkersDoc => docWith(rule, ins(h), unit, [...others, g], repeat);
          }
          const inclusive = w.cmp === 'gte' || w.cmp === 'lte';
          const outward = w.cmp === 'gte' || w.cmp === 'gt' ? 1 : -1;
          expect(fires(rule, mk(t), ctx), 'at threshold').toBe(inclusive);
          expect(fires(rule, mk(t + outward * step(t)), ctx), 'just past').toBe(true);
          expect(fires(rule, mk(t - outward * step(t)), ctx), 'just short').toBe(false);
          break;
        }
        case 'between': {
          const mk = (v: number): MarkersDoc => docWith(rule, v, w.unit, others, repeat);
          expect(fires(rule, mk(w.low), ctx)).toBe(true);
          expect(fires(rule, mk(w.high), ctx)).toBe(true);
          expect(fires(rule, mk(w.low - step(w.low)), ctx)).toBe(false);
          expect(fires(rule, mk(w.high + step(w.high)), ctx)).toBe(false);
          break;
        }
        case 'outside': {
          const [lo, hi] = w.range === 'lab' ? [1, 4] : w.range;
          const extra = w.range === 'lab' ? { labRange: { low: lo, high: hi, unit: w.unit } } : {};
          const mk = (v: number): MarkersDoc => docWith(rule, v, w.unit, others, repeat, extra);
          expect(fires(rule, mk(hi), ctx)).toBe(false);
          expect(fires(rule, mk(lo), ctx)).toBe(false);
          expect(fires(rule, mk(hi + step(hi)), ctx)).toBe(true);
          expect(fires(rule, mk(lo - step(lo)), ctx)).toBe(true);
          break;
        }
        case 'xUln': {
          const uln = 40;
          const mk = (v: number): MarkersDoc => docWith(rule, v, 'U/L', others, repeat, { labRange: { high: uln, unit: 'U/L' } });
          expect(fires(rule, mk(w.factor * uln), ctx)).toBe(false);
          expect(fires(rule, mk(w.factor * uln + 0.01), ctx)).toBe(true);
          break;
        }
        case 'any': {
          const unit = rule.markerId === 'lpa' ? 'mg/dL' : (TABLE.markers.find((m) => m.markerId === rule.markerId)!.conventionalUnit ?? '');
          const u = isAcceptedUnit(rule.markerId, unit) ? unit : 'mg/dL';
          expect(fires(rule, docWith(rule, 5, u, others, repeat), ctx)).toBe(true);
          // its extra conditions gate it
          if (rule.also.some((a) => a.kind === 'field' || a.kind === 'flag')) expect(fires(rule, docWith(rule, 5, u, others, repeat), { ...ctx, fields: {}, flags: [] })).toBe(false);
          break;
        }
        case 'missing': {
          const empty: MarkersDoc = { _schema: 1, readings: [], displayOnly: [], context: {}, chapter: 'manual' };
          expect(firesAny(rule, empty, ctx)).toBe(true);
          const fresh: MarkersDoc = { ...empty, readings: [reading(rule.markerId, 140, 'mmol/L', { date: '2026-09-30' })] };
          expect(firesAny(rule, fresh, ctx)).toBe(false);
          break;
        }
        case 'fallPct': {
          const mk = (cur: number): MarkersDoc => ({
            _schema: 1,
            readings: [reading('egfr', 100, 'mL/min/1.73 m²', { date: '2026-03-01', enteredAt: '2026-03-01T08:00:00Z' }), reading('egfr', cur, 'mL/min/1.73 m²')],
            displayOnly: [],
            context: {},
            chapter: 'manual',
          });
          expect(fires(rule, mk(100 - w.pct), ctx)).toBe(false);
          expect(fires(rule, mk(100 - w.pct - 0.5), ctx)).toBe(true);
          break;
        }
        case 'afterFast': {
          const doc = docWith(rule, 100, rule.markerId === 'fpg' ? 'mg/dL' : 'µU/mL', others, repeat);
          const at = { ...ctx, fields: { 'sample.fastHoursBefore': w.fastHours + 1, 'sample.daysAfterFast': w.days } };
          const late = { ...ctx, fields: { 'sample.fastHoursBefore': w.fastHours + 1, 'sample.daysAfterFast': w.days + 1 } };
          expect(fires(rule, doc, at)).toBe(true);
          expect(fires(rule, doc, late)).toBe(false);
          expect(fires(rule, doc, ctx)).toBe(false); // unknown context never fires
          break;
        }
      }
    });
  }
});
