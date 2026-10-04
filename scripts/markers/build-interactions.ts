/**
 * Builds `src/markers/interactions.json` (the blood-marker interaction table, SUITE_SPEC §13.5.2) from the four
 * research files `research/R13-*.json` and the source lists of their markdown write-ups.
 *
 *   node scripts/markers/build-interactions.ts          write the table
 *   node scripts/markers/build-interactions.ts --check  exit 1 if the committed table differs from a fresh build
 *
 * The research files use several shapes (inline `when` with `op` strings, symbolic thresholds, units with prose,
 * targets that are levers, markers or questions, values that are numbers, strings or objects). Every row is mapped
 * onto the normalised types of `src/markers/types.ts` by the tables below; a row the mapping does not cover stops the
 * build with its id, so the table can never silently drop or guess a rule. Self-contained (no app imports) so it runs
 * under plain node; `src/markers/__tests__/interactions.test.ts` imports `buildTable` and compares.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------------------------------- inputs */

export const RESEARCH_FILES = [
  { json: 'R13-lipids.json', md: 'R13-markers-lipids.md' },
  { json: 'R13-glycaemic-urate.json', md: 'R13-markers-glycaemic-urate.md' },
  { json: 'R13-liver-kidney-electrolytes.json', md: 'R13-markers-liver-kidney-electrolytes.md' },
  { json: 'R13-haem-thyroid-inflammation-hormones.json', md: 'R13-markers-haem-thyroid-inflammation-hormones.md' },
] as const;

export interface ResearchInput {
  json: string;
  md: string;
  data: RawFile;
  markdown: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;
interface RawFile {
  markers: Json[];
  interactions: Json[];
  rules: Json[];
  sources?: Record<string, string>;
  sourceIds?: Record<string, string>;
}

/* ------------------------------------------------------------------------------------------- vocabularies */

/** Research id → app MarkerId. */
export const MARKER_ID: Readonly<Record<string, string>> = {
  ldl: 'ldl',
  hdl: 'hdl',
  nonhdl: 'nonHdl',
  tg: 'tg',
  apob: 'apoB',
  lpa: 'lpa',
  fasting_glucose: 'fpg',
  hba1c: 'hba1c',
  fasting_insulin: 'insulin',
  uric_acid: 'urate',
  alt: 'alt',
  ast: 'ast',
  ggt: 'ggt',
  creatinine: 'creatinine',
  egfr: 'egfr',
  uacr: 'uacr',
  sodium: 'sodium',
  potassium: 'potassium',
  hb: 'hb',
  ferritin: 'ferritin',
  b12: 'b12',
  vitd: 'vitD',
  crp: 'hsCrp',
  tsh: 'tsh',
  ft3: 'ft3',
  testosterone: 'testosterone',
  cortisol: 'cortisol',
};

const LEVERS = new Set([
  'vlc',
  'lowcarb',
  'highprotein',
  'fast16_8',
  'fast24',
  'fast36_48',
  'fast48plus',
  'satfat',
  'dietcholesterol',
  'fibre',
  'unsatfat',
  'alcohol',
  'caffeine',
  'creatine',
  'wheyprotein',
  'deficit_large',
  'deficit_moderate',
  'surplus',
  'resistance_load',
  'aerobic_load',
  'sleep_debt',
  'weight_loss',
]);
const isLever = (t: string): boolean => LEVERS.has(t) || /^supp:[a-z0-9_]+$/.test(t);

/** Units each marker's thresholds may be written in (the app's spelling). */
const THRESHOLD_UNITS: Readonly<Record<string, readonly string[]>> = {
  ldl: ['mg/dL', 'mmol/L'],
  hdl: ['mg/dL', 'mmol/L'],
  nonHdl: ['mg/dL', 'mmol/L'],
  tg: ['mg/dL', 'mmol/L'],
  apoB: ['mg/dL', 'g/L'],
  lpa: ['mg/dL', 'nmol/L'],
  fpg: ['mg/dL', 'mmol/L'],
  hba1c: ['%', 'mmol/mol'],
  insulin: ['µU/mL', 'pmol/L', 'HOMA-IR'],
  urate: ['mg/dL', 'µmol/L'],
  alt: ['U/L'],
  ast: ['U/L'],
  ggt: ['U/L'],
  creatinine: ['mg/dL', 'µmol/L'],
  egfr: ['mL/min/1.73 m²'],
  uacr: ['mg/g', 'mg/mmol'],
  sodium: ['mmol/L'],
  potassium: ['mmol/L'],
  hb: ['g/dL'],
  ferritin: ['ng/mL'],
  b12: ['pg/mL'],
  vitD: ['ng/mL'],
  hsCrp: ['mg/L'],
  tsh: ['µIU/mL'],
  ft3: ['pg/mL'],
  testosterone: ['ng/dL'],
  cortisol: ['µg/dL'],
};

/** Leading unit of a research unit string ("U/L (33 M / 25 F)" → "U/L"). */
function cleanUnit(markerId: string, raw: string, ruleId: string): string {
  const s = String(raw ?? '').trim();
  const allowed = THRESHOLD_UNITS[markerId] ?? [];
  const sorted = [...allowed].sort((a, b) => b.length - a.length);
  for (const u of sorted) if (s === u || s.startsWith(`${u} `) || s.startsWith(`${u}(`)) return u;
  throw new Error(`${ruleId}: unit "${raw}" not in the ${markerId} threshold units`);
}

const OPS: Readonly<Record<string, 'gte' | 'gt' | 'lte' | 'lt' | 'eq'>> = { gte: 'gte', '>=': 'gte', gt: 'gt', '>': 'gt', lte: 'lte', '<=': 'lte', lt: 'lt', '<': 'lt', '==': 'eq' };
const SYMBOLIC = new Set(['whoCutoff', 'healthyULN', 'labLow', 'labHigh', 'labULN']);

/* ------------------------------------------------------------------------------------------- sources */

interface SourceRef {
  id: string;
  /** The project's own research notes (never shown as a source on screen). */
  internal?: boolean;
  doi?: string;
  pmid?: string;
  url?: string;
  note?: string;
}

/** DOI, PMID and URL out of a citation text. */
export function parseCitation(id: string, text: string): SourceRef {
  const ref: SourceRef = { id };
  if (/^\W*Vitals (internal|research index)/.test(text)) ref.internal = true;
  const doi = /\b(?:doi|DOI)\s*[:\s]\s*(10\.\d{4,9}\/[^\s·;,|<>)]+[^\s·;,.|<>)])/.exec(text) ?? /\b(10\.\d{4,9}\/[^\s·;,|<>)]+[^\s·;,.|<>)])/.exec(text);
  if (doi) ref.doi = doi[1];
  const pmid = /PMID[:\s]*\s*(\d{6,9})/.exec(text);
  if (pmid) ref.pmid = pmid[1];
  const url = /(https?:\/\/[^\s<>|]+[^\s<>|.,;)])/.exec(text);
  if (url) ref.url = url[1];
  const note = text
    .replace(/\s+/g, ' ')
    .replace(/^\*\*\[S\d+\]\*\*\s*/, '')
    .trim();
  if (note) ref.note = note.length > 240 ? `${note.slice(0, 237)}…` : note;
  return ref;
}

/** The markdown source list: "S1. …", "| S1 | … | … |" or "- **[S1]** …" lines. */
export function parseMarkdownSources(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of md.split('\n')) {
    let m = /^S(\d+)\.\s+(.*)$/.exec(line);
    if (m) {
      out[`S${m[1]}`] ??= m[2]!;
      continue;
    }
    m = /^\|\s*S(\d+)\s*\|(.*)\|\s*$/.exec(line);
    if (m) {
      out[`S${m[1]}`] ??= m[2]!.split('|').map((c) => c.trim()).join(' · ');
      continue;
    }
    m = /^-\s+\*\*\[S(\d+)\]\*\*\s*(.*)$/.exec(line);
    if (m) out[`S${m[1]}`] ??= m[2]!;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- conditions */

type Condition =
  | { op: 'cmp'; cmp: 'gte' | 'gt' | 'lte' | 'lt'; value: number | string; unit: string }
  | { op: 'between'; low: number; high: number; unit: string }
  | { op: 'outside'; range: 'lab' | [number, number]; unit: string }
  | { op: 'any' }
  | { op: 'missing'; withinWeeks: number }
  | { op: 'xUln'; factor: number }
  | { op: 'fallPct'; pct: number }
  | { op: 'afterFast'; days: number; fastHours: number };

type Also =
  | { kind: 'marker'; markerId: string; cmp: string; value: number; unit: string }
  | { kind: 'field'; field: string; cmp: string; value: number | string | boolean | readonly string[] }
  | { kind: 'repeat' }
  | { kind: 'flag'; flag: string }
  | { kind: 'sex'; sex: 'male' | 'female' };

/**
 * Conditions written in prose in the research unit text, mapped by rule id to a context field. A field the app does
 * not know yet stays unknown at run time, so the rule does not fire (listed as unresolved, never guessed).
 */
const PROSE_ALSO: Readonly<Record<string, Also[]>> = {
  'W-L-CREAT-1': [{ kind: 'field', field: 'context.creatineLast2w', cmp: 'eq', value: true }],
  'W-L-GGT-4': [{ kind: 'field', field: 'alcohol.lowForWeeks', cmp: 'gte', value: 4 }],
  'W-L-NA-4': [{ kind: 'field', field: 'plan.aerobicSessionOver2h', cmp: 'eq', value: true }],
  'W-L-NA-5': [{ kind: 'field', field: 'plan.longFastOrPsmf', cmp: 'eq', value: true }],
  'W-L-K-5': [{ kind: 'field', field: 'plan.longFastOrPsmf', cmp: 'eq', value: true }],
  'W-L-K-6': [{ kind: 'field', field: 'caffeineMgPerDay', cmp: 'gt', value: 400 }],
};

function alsoFrom(raw: Json, ruleId: string): Also {
  if (raw.repeat === true) return { kind: 'repeat' };
  const cmp = OPS[raw.op] ?? (raw.op === 'in' ? 'in' : undefined);
  if (!cmp) throw new Error(`${ruleId}: also.op "${raw.op}"`);
  const other = raw.markerId ?? (raw.field && MARKER_ID[raw.field] ? raw.field : undefined);
  if (other) {
    const markerId = MARKER_ID[other];
    if (!markerId) throw new Error(`${ruleId}: also marker "${other}"`);
    return { kind: 'marker', markerId, cmp, value: Number(raw.value), unit: cleanUnit(markerId, raw.unit, ruleId) };
  }
  if (raw.field === 'fasting') return { kind: 'field', field: 'reading.fasting', cmp, value: raw.value };
  if (typeof raw.field === 'string') return { kind: 'field', field: raw.field, cmp, value: raw.value };
  throw new Error(`${ruleId}: also ${JSON.stringify(raw)}`);
}

function conditionFrom(markerId: string, w: Json, ruleId: string): { when: Condition; also: Also[] } {
  const also: Also[] = [];
  if (w.sex === 'M' || w.sex === 'F') also.push({ kind: 'sex', sex: w.sex === 'M' ? 'male' : 'female' });
  if (w.also) also.push(alsoFrom(w.also, ruleId));
  if (Array.isArray(w.and)) for (const a of w.and) also.push(alsoFrom(a, ruleId));
  also.push(...(PROSE_ALSO[ruleId] ?? []));
  const unitText = String(w.unit ?? '');
  switch (w.op) {
    case 'any':
      return { when: { op: 'any' }, also };
    case 'missing':
      return { when: { op: 'missing', withinWeeks: /(\d+)\s*wk/.exec(unitText) ? Number(/(\d+)\s*wk/.exec(unitText)![1]) : 4 }, also };
    case 'flag':
      return { when: { op: 'any' }, also: [...also, { kind: 'flag', flag: String(w.value) }] };
    case 'gte_with_flag': {
      const flag = /\+\s*(\w+)/.exec(unitText)?.[1];
      if (!flag) throw new Error(`${ruleId}: flag in "${unitText}"`);
      return { when: { op: 'cmp', cmp: 'gte', value: Number(w.value), unit: cleanUnit(markerId, unitText, ruleId) }, also: [...also, { kind: 'flag', flag }] };
    }
    case 'within_days_after': {
      const h = /fast\s*>\s*(\d+)\s*h/.exec(unitText);
      if (!h) throw new Error(`${ruleId}: fast hours in "${unitText}"`);
      return { when: { op: 'afterFast', days: Number(w.value), fastHours: Number(h[1]) }, also };
    }
    case 'between': {
      const [lo, hi] = w.value as [number, number];
      return { when: { op: 'between', low: lo, high: hi, unit: cleanUnit(markerId, unitText, ruleId) }, also };
    }
    case 'outside': {
      if (w.value === 'labRange') return { when: { op: 'outside', range: 'lab', unit: cleanUnit(markerId, unitText, ruleId) }, also };
      if (Array.isArray(w.value)) return { when: { op: 'outside', range: [Number(w.value[0]), Number(w.value[1])], unit: cleanUnit(markerId, unitText, ruleId) }, also };
      throw new Error(`${ruleId}: outside ${JSON.stringify(w.value)}`);
    }
  }
  const cmp = OPS[w.op];
  if (!cmp || cmp === 'eq') throw new Error(`${ruleId}: op "${w.op}"`);
  if (/x\s*lab\s*ULN/i.test(unitText)) {
    // "> 1 × lab ULN" is "> the lab's upper limit"
    if (Number(w.value) === 1) return { when: { op: 'cmp', cmp: 'gt', value: 'labULN', unit: THRESHOLD_UNITS[markerId]![0]! }, also };
    return { when: { op: 'xUln', factor: Number(w.value) }, also };
  }
  if (/%\s*fall/.test(unitText)) return { when: { op: 'fallPct', pct: Number(w.value) }, also };
  // "≥ 0 means any entered value" (lipids notes)
  if ((cmp === 'gte' && w.value === 0) || w.value === null) return { when: { op: 'any' }, also };
  if (typeof w.value === 'string') {
    if (!SYMBOLIC.has(w.value)) throw new Error(`${ruleId}: threshold "${w.value}"`);
    return { when: { op: 'cmp', cmp, value: w.value, unit: cleanUnit(markerId, unitText, ruleId) }, also };
  }
  if (typeof w.value !== 'number') throw new Error(`${ruleId}: value ${JSON.stringify(w.value)}`);
  return { when: { op: 'cmp', cmp, value: w.value, unit: cleanUnit(markerId, unitText, ruleId) }, also };
}

/* ------------------------------------------------------------------------------------------- effects */

interface Lock {
  lock: string;
  value: number;
  unit: string;
  bySex?: { male: number; female: number };
  relative?: 'deficitDefaultMinus';
}
interface Effect {
  locks?: Lock[];
  flags?: string[];
  levers: string[];
  preferWeight?: number;
  noSuggest?: string[];
  reask?: string;
  retestWeeks?: number;
  displayValue?: { name: string; value: number | string };
  holdsDeficit?: boolean;
}

const LOCK_UNIT: Readonly<Record<string, string>> = {
  'deficit-cap': '%',
  'max-fast': 'h',
  'protein-cap': 'g/kg',
  'carb-floor': 'g/d',
  'satfat-cap': '%E',
  'fat-cap': '%E',
  'creatine-cap': 'g/d',
  'potassium-supp-cap': 'g/d',
  'alcohol-cap': 'g/d',
  'added-sugar-cap': '%E',
  'surplus-cap': '% of maintenance',
  'caffeine-cap': 'mg/d',
};
const lock = (id: string, value: number, extra: Partial<Lock> = {}): Lock => ({ lock: id, value, unit: LOCK_UNIT[id]!, ...extra });

const FAST_LEVERS = ['fast24', 'fast36_48', 'fast48plus'];
/** "Moderate" deficit where a research rule caps without a number: the 20 % its ferritin rule states (W-L-FERRITIN-1). */
const MODERATE_DEFICIT_PCT = 20;

/** Caps whose number is only in the message: the number the message states. */
const CAP_FROM_MESSAGE: Readonly<Record<string, Lock[]>> = {
  'W-L-TSH-2': [lock('max-fast', 24)],
  'W-L-FERRITIN-1': [lock('deficit-cap', 20)],
  'W-L-FT3-3': [lock('deficit-cap', MODERATE_DEFICIT_PCT)],
  'W-L-TESTOSTERONE-3': [lock('deficit-cap', MODERATE_DEFICIT_PCT)],
};
/** Clinician rules whose message holds the plan ("stays at maintenance", "fasting is paused"). */
const CLINICIAN_HOLDS: Readonly<Record<string, Lock[]>> = {
  'W-L-HB-5': [lock('deficit-cap', 0)],
  'W-L-CORTISOL-1': [lock('max-fast', 12)],
};
/** Kidney flag (§13.5.3: eGFR < 60 or ACR ≥ 30 sets the existing `kidney-disease` flag). */
const KIDNEY_FLAG_RULES = new Set(['W-L-EGFR-1', 'W-L-ACR-1']);
/** Re-asks that pause the planner search (§13.5.3); the rest are sample-context questions shown with the note. */
export const BLOCKING_REASKS = new Set(['diabetes', 'kidney', 'gout', 'foodAllergy']);
const REASK_ABOUT: Readonly<Record<string, string>> = { diabetes_question: 'diabetes' };

function leversOf(target: string): string[] {
  const out: string[] = [];
  for (const part of target.split('|')) {
    const t = part.replace(/[<>=].*$/, '');
    if (isLever(t)) out.push(t);
    else if (t === 'fasting') out.push(...FAST_LEVERS);
    else if (t === 'eggYolksPerDay') out.push('dietcholesterol');
    else if (t === 'fatPctE') out.push('vlc');
  }
  return [...new Set(out)];
}

function effectFrom(r: Json, markerId: string, kind: string, metaRetest: number | null): Effect {
  const id: string = r.id;
  const target = String(r.target ?? '');
  const v = r.value;
  const e: Effect = { levers: leversOf(target) };
  const obj = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Json>) : null;
  if (obj?.maxFastHours !== undefined && kind !== 'warn') (e.locks ??= []).push(lock('max-fast', Number(obj.maxFastHours)));
  if (obj && Array.isArray(obj.alsoTargets)) e.levers = [...new Set([...e.levers, ...obj.alsoTargets.filter(isLever)])];
  if (KIDNEY_FLAG_RULES.has(id)) e.flags = ['kidney-disease'];

  switch (kind) {
    case 'cap': {
      if (CAP_FROM_MESSAGE[id]) (e.locks ??= []).push(...CAP_FROM_MESSAGE[id]!);
      else if (target === 'satfat') (e.locks ??= []).push(lock('satfat-cap', Number(v)));
      else if (target === 'addedSugarPctE') (e.locks ??= []).push(lock('added-sugar-cap', Number(v)));
      else if (target === 'fatPctE') {
        // fat ≤ 30 %E and "keto is not proposed": the carbohydrate floor that keeps the planner out of the ketogenic range
        (e.locks ??= []).push(lock('fat-cap', Number(v)), lock('carb-floor', 50));
      } else if (target === 'alcohol') {
        if (typeof v === 'number') (e.locks ??= []).push(lock('alcohol-cap', v));
        else if (obj?.gPerDayMen !== undefined) (e.locks ??= []).push(lock('alcohol-cap', Number(obj.gPerDayMen), { bySex: { male: Number(obj.gPerDayMen), female: Number(obj.gPerDayWomen) } }));
      } else if (target === 'surplus' && obj?.maxPctAboveMaintenance !== undefined) (e.locks ??= []).push(lock('surplus-cap', 100 + Number(obj.maxPctAboveMaintenance)));
      else if (target === 'caffeine' && obj?.maxMgPerDay !== undefined) (e.locks ??= []).push(lock('caffeine-cap', Number(obj.maxMgPerDay)));
      else if (target === 'highprotein') (e.locks ??= []).push(lock('protein-cap', typeof v === 'number' ? v : Number(obj?.maxProteinGPerKg)));
      else if (target === 'deficit_large' && typeof v === 'string' && /deficitPct\s*[−-]\s*(\d+)/.test(v))
        (e.locks ??= []).push(lock('deficit-cap', Number(/deficitPct\s*[−-]\s*(\d+)/.exec(v)![1]), { relative: 'deficitDefaultMinus' }));
      else if ((target === 'fast48plus' || target === 'fast36_48' || target === 'fasting') && typeof v === 'number') (e.locks ??= []).push(lock('max-fast', v));
      else if (target.startsWith('supp:') && obj?.suggest === false) {
        const all = [target, ...((obj.alsoTargets as string[] | undefined) ?? [])];
        e.noSuggest = all;
        if (all.some((t) => /creatine/.test(t))) (e.locks ??= []).push(lock('creatine-cap', 0));
        if (all.some((t) => /potassium/.test(t))) (e.locks ??= []).push(lock('potassium-supp-cap', 0));
      }
      if (obj?.reaskBefore) e.reask = String(obj.reaskBefore);
      if (!e.locks?.length) throw new Error(`${id}: cap without a lock (${target} ${JSON.stringify(v)})`);
      break;
    }
    case 'clinician': {
      if (CLINICIAN_HOLDS[id]) {
        (e.locks ??= []).push(...CLINICIAN_HOLDS[id]!);
        e.holdsDeficit = CLINICIAN_HOLDS[id]!.some((l) => l.lock === 'deficit-cap' && l.value === 0) || undefined;
        if (!e.holdsDeficit) delete e.holdsDeficit;
      }
      if (obj?.maxDeficitPct !== undefined) (e.locks ??= []).push(lock('deficit-cap', Number(obj.maxDeficitPct)));
      if (target.startsWith('supp:') && (v === 0 || /will not suggest|stops suggesting/.test(String(r.message)))) e.noSuggest = [target];
      break;
    }
    case 'reask':
      e.reask = REASK_ABOUT[target] ?? target;
      break;
    case 'retest': {
      const weeks = typeof v === 'number' ? v : obj?.weeks !== undefined ? Number(obj.weeks) : metaRetest;
      if (weeks !== null && weeks !== undefined && weeks > 0) e.retestWeeks = weeks;
      else if (weeks === 0) e.displayValue = { name: 'retest', value: 'when your weight is stable' };
      break;
    }
    case 'prefer':
      e.preferWeight = r.severity === 'caution' ? 0.02 : 0.01;
      if (typeof v === 'number') e.displayValue = { name: target, value: v };
      else if (obj?.maxSodiumGPerDay !== undefined) e.displayValue = { name: 'maxSodiumGPerDay', value: Number(obj.maxSodiumGPerDay) };
      else if (!e.levers.length) e.displayValue = { name: target, value: String(v ?? '') };
      break;
    case 'warn':
      if (obj?.minFluidL !== undefined) e.displayValue = { name: 'minFluidL', value: Number(obj.minFluidL) };
      if (obj?.maxFastHours !== undefined) e.displayValue = { name: 'maxFastHours', value: Number(obj.maxFastHours) };
      if (target === 'hba1c') e.displayValue = { name: 'hba1c', value: 'may read wrong' };
      break;
  }
  void markerId;
  return e;
}

const SEVERITY: Readonly<Record<string, 'info' | 'caution' | 'danger'>> = {
  info: 'info',
  caution: 'caution',
  danger: 'danger',
  'see-clinician': 'danger',
  'stop-and-see': 'danger',
};
const DEFAULT_SEVERITY: Readonly<Record<string, 'info' | 'caution' | 'danger'>> = { cap: 'caution', warn: 'caution', clinician: 'danger', reask: 'info', retest: 'info', prefer: 'info' };

/* ------------------------------------------------------------------------------------------- build */

const short = (json: string): string => json.replace(/^R13-/, '').replace(/\.json$/, '');

export function buildTable(inputs: readonly ResearchInput[]): Json {
  const markers: Json[] = [];
  const interactions: Json[] = [];
  const rules: Json[] = [];
  const seenIds = new Set<string>();

  for (const inp of inputs) {
    const ns = short(inp.json);
    const cit: Record<string, string> = { ...parseMarkdownSources(inp.markdown), ...(inp.data.sources ?? {}), ...(inp.data.sourceIds ?? {}) };
    const src = (ids: unknown, where: string): SourceRef[] => {
      const list = (Array.isArray(ids) ? ids : ids === undefined ? [] : [ids]) as string[];
      return list.map((s) => {
        const text = cit[s];
        if (!text) throw new Error(`${where}: source ${s} not listed in ${inp.md}`);
        return parseCitation(`${ns}:${s}`, text);
      });
    };

    for (const m of inp.data.markers) {
      const markerId = MARKER_ID[m.id];
      if (!markerId) throw new Error(`${inp.json}: marker "${m.id}"`);
      markers.push({
        markerId,
        label: m.label,
        sourceId: m.id,
        dossier: inp.md,
        conventionalUnit: m.units.conventional,
        siUnit: m.units.si,
        ranges: (m.ranges ?? []).map((g: Json) => ({
          region: g.region,
          ...(typeof g.low === 'number' ? { low: g.low } : {}),
          ...(typeof g.high === 'number' ? { high: g.high } : {}),
          ...(typeof g.target === 'number' ? { target: g.target } : {}),
          note: g.note ?? '',
          sources: (Array.isArray(g.source) ? g.source : [g.source]).filter(Boolean).map((s: string) => `${ns}:${s}`),
        })),
        retestWeeks: typeof m.retestWeeks === 'number' ? m.retestWeeks : null,
      });
    }

    for (const i of inp.data.interactions) {
      const markerId = MARKER_ID[i.markerId];
      if (!markerId) throw new Error(`${inp.json}: interaction marker "${i.markerId}"`);
      if (!isLever(i.lever)) throw new Error(`${inp.json}: lever "${i.lever}"`);
      interactions.push({
        markerId,
        lever: i.lever,
        direction: i.direction,
        effectText: String(i.effectSize ?? ''),
        unit: i.unit ?? '',
        ...(i.population ? { population: i.population } : {}),
        timeCourseWeeks: typeof i.timeCourseWeeks === 'number' ? i.timeCourseWeeks : null,
        mechanism: i.mechanism ?? '',
        grade: i.grade,
        sources: src(i.sources, `${inp.json} ${i.markerId}/${i.lever}`),
        dossier: inp.md,
      });
    }

    const metaRetest = (rid: string): number | null => {
      const m = inp.data.markers.find((x: Json) => x.id === rid);
      return typeof m?.retestWeeks === 'number' ? m.retestWeeks : null;
    };

    for (const r of inp.data.rules) {
      const markerId = MARKER_ID[r.markerId];
      if (!markerId) throw new Error(`${r.id}: marker "${r.markerId}"`);
      if (seenIds.has(r.id)) throw new Error(`${r.id}: duplicate id`);
      seenIds.add(r.id);
      const { when, also } = conditionFrom(markerId, r.when, r.id);
      const kind = r.kind;
      if (!['cap', 'warn', 'reask', 'clinician', 'retest', 'prefer'].includes(kind)) throw new Error(`${r.id}: kind "${kind}"`);
      const severity = r.severity ? SEVERITY[r.severity] : DEFAULT_SEVERITY[kind];
      if (!severity) throw new Error(`${r.id}: severity "${r.severity}"`);
      rules.push({
        id: r.id,
        markerId,
        dossier: inp.md,
        kind,
        when,
        also,
        severity,
        message: r.message,
        effect: effectFrom(r, markerId, kind, metaRetest(r.markerId)),
        grade: r.grade,
        sources: src(r.sources, r.id),
        ...(r.mapsTo ? { mapsTo: String(r.mapsTo) } : {}),
        target: String(r.target ?? ''),
      });
    }

    // clinician-only thresholds of each marker that no clinician rule already covers
    for (const m of inp.data.markers) {
      const markerId = MARKER_ID[m.id]!;
      let n = 0;
      for (const c of m.clinicianOnly ?? []) {
        n++;
        const unitText = String(c.unit ?? '');
        if (/FIB-4/.test(unitText)) continue; // needs platelets and age-weighted AST/ALT: not computed by the app
        const id = `W-L-${String(r13Code(m.id))}-C${n}`;
        const w = /after\s*>=\s*4\s*weeks/.test(unitText) ? { ...c, unit: 'x lab ULN' } : c;
        const { when, also } = conditionFrom(markerId, w, id);
        if (/after\s*>=\s*4\s*weeks/.test(unitText)) also.push({ kind: 'field', field: 'alcohol.lowForWeeks', cmp: 'gte', value: 4 });
        const dup = rules.some((x) => x.markerId === markerId && x.kind === 'clinician' && sameWhen(x.when, when));
        if (dup) continue;
        // the same threshold drives an ordinary rule (fasting glucose 126, HbA1c 6.5, uric acid 6.8): a caution, not a danger
        const common = rules.some((x) => x.markerId === markerId && x.kind !== 'clinician' && sameWhen(x.when, when));
        rules.push({
          id,
          markerId,
          dossier: inp.md,
          kind: 'clinician',
          when,
          also,
          severity: common ? 'caution' : 'danger',
          message: c.message,
          effect: { levers: [] },
          // clinician-only thresholds carry no grade in the research files; guideline thresholds, graded C (R5: unsure → low)
          grade: 'C',
          sources: src(c.source, id),
          target: 'clinicianOnly',
        });
      }
    }
  }

  return { schema: 'vitals.markerInteractions/1', generatedFrom: inputs.map((i) => `research/${i.json}`), markers, interactions, rules };
}

const R13_CODE: Readonly<Record<string, string>> = {
  fasting_glucose: 'FPG',
  fasting_insulin: 'INS',
  uric_acid: 'URIC',
  nonhdl: 'NHDL',
  creatinine: 'CREAT',
  uacr: 'ACR',
  sodium: 'NA',
  potassium: 'K',
};
const r13Code = (rid: string): string => R13_CODE[rid] ?? rid.toUpperCase();

function sameWhen(a: Condition, b: Condition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------------------------------- cli */

export function readInputs(root: string): ResearchInput[] {
  const dir = join(root, 'research');
  return RESEARCH_FILES.map((f) => ({
    json: f.json,
    md: f.md,
    data: JSON.parse(readFileSync(join(dir, f.json), 'utf8')) as RawFile,
    markdown: readFileSync(join(dir, f.md), 'utf8'),
  }));
}

export const serialise = (table: Json): string => `${JSON.stringify(table, null, 1)}\n`;

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out = join(root, 'src/markers/interactions.json');
  const text = serialise(buildTable(readInputs(root)));
  if (process.argv.includes('--check')) {
    const cur = readFileSync(out, 'utf8');
    if (cur !== text) {
      console.error('src/markers/interactions.json is out of date: run node scripts/markers/build-interactions.ts');
      process.exit(1);
    }
    console.log('interactions.json is up to date');
  } else {
    writeFileSync(out, text);
    const t = JSON.parse(text) as { markers: unknown[]; interactions: unknown[]; rules: unknown[] };
    console.log(`wrote ${out}: ${t.markers.length} markers, ${t.interactions.length} interactions, ${t.rules.length} rules`);
  }
}
