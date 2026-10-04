/**
 * Guard: nothing a user can read may name the build process.
 *
 * Research notes ("dossiers"), their section numbers ("§4.3"), ruling ids (R-MAINT), work-package ids (WP3), spec names
 * (MODEL_SPEC), review markers ("REVIEW:") and agent/orchestration words are maintainers' vocabulary. Users see evidence
 * cited by topic name (linked into the Evidence library) and by study reference (author, year).
 *
 * What is scanned, and how:
 *  1. every value exported from `src/features/**\/copy.ts` (strings, nested objects, arrays, and the output of copy
 *     functions called with probe arguments);
 *  2. every string of every Evidence library topic (except ids and links, which are not prose);
 *  3. the metric catalogue's visible fields and the rendering of its `sources`, and the rendering of every model
 *     parameter's evidence (`paramSourceLabel`) and its label;
 *  4. every string literal and JSX text in non-test source under `src/features/**` (a static scan of the code, comments
 *     excluded), so inline UI strings in components cannot leak either; this includes the onboarding screening rules
 *     (`src/features/onboarding/safetyRules.ts`) and the Planner's preflight and request text;
 *  5. the safety warnings: every rule's message template and its rendering with unknown placeholders, the rendering of
 *     its evidence (`sourceRefsLabel`), the warning panel's title, body and remedy text for every rule id, and the
 *     answers of the onboarding screening for sample profiles (lock reasons, messages, fasting reasons);
 *  6. the validation report page (`docs/VALIDATION_REPORT.md`, bundled at /evidence/validation), line by line, with a few
 *     extra patterns for documents (file paths, shell commands, ruling vocabulary);
 *  6b. the validation page's data sections: the activity intake checks' copy and miss reasons, the planner benchmarks
 *     fixture and, when the planner's harness has published it, the benchmarks file;
 *  7. status words: Evidence content and the validation page write "unverified" and "proposed fit" in plain lower case;
 *     the all-capitals labels of the research notes (UNVERIFIED, PROPOSED) must not reach a screen.
 *
 * When a hit appears: rewrite the text (topic name, study reference, or plain words). Do not widen ALLOWED_LITERALS to
 * hide copy; it is only for identifiers that are not copy.
 *
 * The Planner's user-facing source (`PLANNER_SOURCES`, section 4b) gets a stricter scan: besides the patterns above,
 * prose literals there must not carry safety-rule ids (HC-…, W-…), plan ids (PLAN-…) or file names. Identifier-shaped
 * literals (no spaces: map keys, rule ids) are not prose and are skipped; so are the maintainer pointer fields
 * (`dossier`, `source`, `sources`, `dossierRefs`, `maintainerRef`, `ref`, `where`), which keep their research references
 * on purpose and are never rendered. Every rule id the planner explains reads as plain words (`ruleText`).
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/engine/core/moduleRegistry';
import { RULE_TEXT, ruleText } from '@/engine/planner/domain/explain';
import { MARGIN_IDS } from '@/engine/planner/domain/model';
import { fillTemplate } from '@/engine/model/safety/messages';
import { RULES, W_F04_TEXT } from '@/engine/model/safety/rules';
import type { SimWarning } from '@/engine/types/events';
import { SERIES } from '@/engine/types/metrics';
import { evaluateScreening, type ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { groupWarnings, toWarningItem, warningRemedy } from '@/features/simulator/results/lib/warnings';
import { EVIDENCE_TOPICS } from '../index';
import type { EvidenceTopic } from '../schema';
import { ALL_PARAMS } from '../params';
import { paramSourceLabel, sourceRefsLabel } from '../sources';
import { ACTIVITY_INTAKE_GROUPS, ACTIVITY_INTAKE_MISS_REASONS } from '../validation/activityIntake';
import { PLANNER_BENCHMARKS_FIXTURE } from '../validation/plannerBenchmarks';
import { leak, report, scan, strings } from './leakScan';

/* ------------------------------------------------------------------ 1. copy objects */

const copyModules = import.meta.glob('/src/features/**/copy.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

describe('copy objects (src/features/**/copy.ts)', () => {
  it('finds the copy modules', () => {
    expect(Object.keys(copyModules).length).toBeGreaterThanOrEqual(4);
  });

  for (const [file, mod] of Object.entries(copyModules)) {
    it(`${file.replace('/src/features/', '')} has no internal references`, () => {
      const rows: Array<[string, string]> = [];
      for (const [name, value] of Object.entries(mod)) strings(value, name, rows);
      expect(rows.length, 'no strings found: is the module empty?').toBeGreaterThan(0);
      expect(scan(rows), report(scan(rows))).toEqual([]);
    });
  }
});

describe('copy objects show no unfilled placeholders', () => {
  // A "{vendor}" left in a plain string reaches the screen literally (Q1B-B-10). Templates are functions, except
  // these strings, which their screen fills with .replace().
  const FILLED_AT_USE = new Set(['settings/ai/copy.ts AI_COPY.sent']);
  it('no plain copy string contains a {placeholder}', () => {
    const hits: string[] = [];
    for (const [file, mod] of Object.entries(copyModules)) {
      const rows: Array<[string, string]> = [];
      for (const [name, value] of Object.entries(mod)) strings(value, name, rows);
      for (const [path, text] of rows) {
        const at = `${file.replace('/src/features/', '')} ${path}`;
        if (/\{[A-Za-z_]+\}/.test(text) && !FILLED_AT_USE.has(at)) hits.push(`${at}: ${text}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 2. evidence content */

/** The all-capitals status labels of the research notes. On screen they read "unverified" and "proposed (fit)". */
const STATUS_CAPITALS = /\b(UNVERIFIED|PROPOSED)\b/;

/** Fields of a topic that are identifiers or links, not prose. */
const NOT_PROSE = new Set([
  'id',
  'slug',
  'dossier',
  'referenceIds',
  'relatedMetricIds',
  'pmid',
  'doi',
  'url',
]);

/** All topics, loaded once for the content tests below. */
let topicsLoad: Promise<EvidenceTopic[]> | undefined;
const loadTopics = (): Promise<EvidenceTopic[]> =>
  (topicsLoad ??= Promise.all(EVIDENCE_TOPICS.map(async (e) => (await e.load()).default)));

describe('evidence library content', () => {
  it('has no internal references in any topic', async () => {
    const topics = await loadTopics();
    const rows: Array<[string, string]> = [];
    for (const t of topics) strings(t, t.slug, rows, NOT_PROSE);
    expect(rows.length).toBeGreaterThan(1000);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  }, 120_000);

  it('writes status words in plain lower case ("unverified", "proposed fit"), never as research-note capitals', async () => {
    const topics = await loadTopics();
    const rows: Array<[string, string]> = [];
    for (const t of topics) strings(t, t.slug, rows, NOT_PROSE);
    const hits = rows
      .filter(([, text]) => STATUS_CAPITALS.test(text))
      .map(([path, text]) => `${path}  ${text.slice(0, 80)}`);
    expect(hits, report(hits)).toEqual([]);
  }, 120_000);

  it('has no internal references in the topic registry titles', () => {
    const rows: Array<[string, string]> = EVIDENCE_TOPICS.map((e) => [e.slug, e.title]);
    expect(scan(rows)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 3. metric and parameter sources */

describe('metric catalogue', () => {
  it('has no internal references in its visible fields or in the rendering of its sources', () => {
    const rows: Array<[string, string]> = [];
    for (const d of SERIES) {
      rows.push(
        [`${d.id}.label`, d.label],
        [`${d.id}.unit`, d.unit],
        [`${d.id}.sources`, sourceRefsLabel(d.sources)],
      );
      for (const f of ['goalNote', 'caveat', 'description'] as const) {
        const v = (d as { [k: string]: unknown })[f];
        if (typeof v === 'string') rows.push([`${d.id}.${f}`, v]);
      }
    }
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  });
});

describe('model parameters', () => {
  it('render their evidence and label without internal references', () => {
    const rows: Array<[string, string]> = [];
    for (const m of MODULES) {
      for (const p of m.params) {
        rows.push([`${p.id}.evidence`, paramSourceLabel(p)]);
        if (p.label) rows.push([`${p.id}.label`, p.label]);
      }
    }
    expect(rows.length).toBeGreaterThan(1500);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  });

  it('outside the module registry (activity intake, tracking, catalogue) render without internal references', () => {
    const rows: Array<[string, string]> = [];
    const inModules = new Set(MODULES.flatMap((m) => m.params.map((p) => p.id)));
    for (const p of ALL_PARAMS.filter((q) => !inModules.has(q.id))) {
      rows.push([`${p.id}.evidence`, paramSourceLabel(p)]);
      if (p.label) rows.push([`${p.id}.label`, p.label]);
    }
    expect(rows.length).toBeGreaterThan(80);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 4. static scan of the UI code */

/**
 * Files skipped by the static scan because another work package owns them and is rewriting them now.
 * Empty: the onboarding screening rules and the Planner's preflight and request text are clean and covered.
 * Add a path here only while its owner is mid-rewrite, with a TODO to remove it.
 */
const SKIPPED_FILES: readonly string[] = [];

/**
 * String literals that match a pattern but are identifiers, not copy. Keep this list short and explain each entry; the
 * test fails if an entry stops matching, so it cannot silently grow stale.
 */
const ALLOWED_LITERALS: ReadonlyArray<{ file: string; text: string; why: string }> = [
  {
    file: '/src/features/evidence/data/filters.ts',
    text: 'dossier',
    why: 'the name older shared links used for the topic grouping (?group=dossier); parsed, never shown',
  },
];

const sources = import.meta.glob(
  [
    '/src/features/**/*.{ts,tsx}',
    '!/src/features/**/__tests__/**',
    '!/src/features/**/test/**',
    '!/src/features/**/*.test.{ts,tsx}',
    '!/src/features/**/testing.ts',
    '!/src/features/**/fixtures.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** String literals, template pieces and JSX text of a source file (comments and identifiers excluded). */
function literals(file: string, code: string): Array<[number, string]> {
  const sf = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: Array<[number, string]> = [];
  const visit = (n: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text;
    else if (ts.isJsxText(n)) text = n.text;
    if (text !== null) out.push([sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('UI source under src/features', () => {
  it('scans the feature sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(150);
  });

  it('has no internal references in string literals or JSX text', () => {
    const hits: string[] = [];
    const used = new Set<number>();
    for (const [file, code] of Object.entries(sources)) {
      if (SKIPPED_FILES.includes(file)) continue;
      for (const [line, text] of literals(file, code)) {
        const l = leak(text);
        if (!l) continue;
        const allowed = ALLOWED_LITERALS.findIndex((a) => a.file === file && a.text === text);
        if (allowed >= 0) used.add(allowed);
        else hits.push(`${file}:${line}  ${l}`);
      }
    }
    expect(hits, report(hits)).toEqual([]);
    const stale = ALLOWED_LITERALS.filter((_, i) => !used.has(i)).map((a) => `${a.file} "${a.text}"`);
    expect(stale, 'ALLOWED_LITERALS entries that no longer match anything').toEqual([]);
  }, 60_000);

  it('skips only files that still exist', () => {
    for (const f of SKIPPED_FILES) expect(Object.keys(sources), f).toContain(f);
  });
});

/* ------------------------------------------------------------------ 4b. the Planner's user-facing source */

/** Every planner source whose strings can reach a screen: the Planner UI and the engine files that write its copy. */
const PLANNER_SOURCES = import.meta.glob(
  [
    '/src/features/planner/**/*.{ts,tsx}',
    '!/src/features/planner/**/__tests__/**',
    '!/src/features/planner/**/*.test.{ts,tsx}',
    '/src/engine/planner/domain/{explain,fastingExplain,safety,validate,limits,ideal,difficulty,equipment}.ts',
    '/src/engine/planner/domain/registry/*.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** The engine files of the list above, by name, so a rename cannot drop one from the scan silently. */
const PLANNER_ENGINE_FILES = [
  'explain',
  'fastingExplain',
  'safety',
  'validate',
  'limits',
  'ideal',
  'difficulty',
  'equipment',
  'registry/blocks',
  'registry/levers',
].map((f) => `/src/engine/planner/domain/${f}.ts`);

/** Maintainer pointer fields: research references kept on purpose, never rendered. */
const POINTER_KEYS = new Set(['dossier', 'source', 'sources', 'dossierRefs', 'maintainerRef', 'ref', 'where']);

/** What planner prose must not carry on top of `FORBIDDEN`: rule ids, plan ids, file names, spec names. */
const PLANNER_FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bHC-[A-Z]/, 'safety-rule id (HC-…)'],
  [/\bW-[A-Z0-9]{1,3}-?\d/, 'warning id (W-…)'],
  [/\bPLAN-/, 'plan id (PLAN-…)'],
  [/\b[\w-]+\.(md|tsx?|json)\b/, 'file name'],
  [/\b[A-Z]+_SPEC\b/, 'spec name'],
];

const plannerLeak = (text: string): string | null => {
  const l = leak(text);
  if (l) return l;
  for (const [re, name] of PLANNER_FORBIDDEN) if (re.test(text)) return `${name}: ${text.slice(0, 80)}`;
  return null;
};

/** Prose literals of a planner file: string pieces with a space, outside the maintainer pointer fields. */
function plannerProse(file: string, code: string): Array<[number, string]> {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<[number, string]> = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && POINTER_KEYS.has(n.name.getText(sf).replace(/['"]/g, ''))) return;
    let text: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text;
    else if (ts.isJsxText(n)) text = n.text;
    if (text !== null && /\S\s+\S/.test(text.trim())) out.push([sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('Planner user-facing source (UI and engine copy)', () => {
  it('includes the Planner UI and every engine file that writes planner copy', () => {
    const files = Object.keys(PLANNER_SOURCES);
    expect(files.filter((f) => f.startsWith('/src/features/planner/')).length).toBeGreaterThan(30);
    for (const f of PLANNER_ENGINE_FILES) expect(files, f).toContain(f);
  });

  it('has no internal references, rule ids, plan ids or file names in its prose', () => {
    const hits: string[] = [];
    for (const [file, code] of Object.entries(PLANNER_SOURCES))
      for (const [line, text] of plannerProse(file, code)) {
        const l = plannerLeak(text);
        if (l) hits.push(`${file}:${line}  ${l}`);
      }
    expect(hits, report(hits)).toEqual([]);
  });

  it('explains every rule id it can name in plain words', () => {
    const ids = [
      ...Object.keys(RULE_TEXT),
      ...MARGIN_IDS,
      // repair, decode and validator ids that reach "Limited by …" / "it would break …"
      'HC-E1.28d',
      'HC-E3/E1',
      'HC-P3/P4',
      'HC-F3/F4',
      'HC-X4/X5',
      'HC-X5',
      'tier.optIn',
      'floors.energy',
      'decode.energyEnvelope',
      'decode.lowDayEnvelope',
      'decode.fast24Placement',
      'decode.rtOnSpecialDay',
      'decode.eventPlacement',
      'user',
    ];
    const hits: string[] = [];
    for (const id of ids) {
      const t = ruleText(id);
      if (t === id) hits.push(`${id}  has no plain-words text`);
      const l = plannerLeak(t);
      if (l) hits.push(`${id}  ${l}`);
    }
    expect(hits, report(hits)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 5. safety warnings */

/** Plausible peak value per rule id for building a panel item (the panel only prints it in titles). */
const SAMPLE_PEAK = 30;

describe('safety warnings (src/engine/model/safety)', () => {
  it('every rule message and its sources read without internal references', () => {
    const rows: Array<[string, string]> = [['W-F04.text', W_F04_TEXT]];
    for (const r of RULES) {
      rows.push([`${r.id}.template`, r.template]);
      rows.push([`${r.id}.message`, fillTemplate(r.template, {})]);
      rows.push([`${r.id}.sources`, sourceRefsLabel(r.sources)]);
    }
    expect(rows.length).toBeGreaterThan(240);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  });

  it('the warning panel text for every rule (title, body, remedy, evidence) has no internal references', () => {
    const rows: Array<[string, string]> = [];
    const warnings: SimWarning[] = RULES.map((r) => ({
      id: r.id,
      severity: r.severity,
      startDay: 2,
      endDay: 9,
      peakValue: SAMPLE_PEAK,
      message: fillTemplate(r.template, {}),
      src: '',
      sources: r.sources,
    }));
    for (const w of warnings) {
      const item = toWarningItem(w);
      rows.push(
        [`${w.id}.title`, item.title],
        [`${w.id}.body`, item.body],
        [`${w.id}.sources`, sourceRefsLabel(item.sources)],
      );
      const remedy = warningRemedy(w);
      if (remedy) rows.push([`${w.id}.remedy`, remedy.label]);
    }
    // grouping keeps every warning (always-on notes included)
    const g = groupWarnings(warnings);
    expect(g.danger.length + g.caution.length + g.info.length + g.notes.length).toBe(RULES.length);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  });

  it('the screening answers (locks, messages, fasting reasons) for sample profiles have no internal references', () => {
    const base: ScreeningAnswers = {
      ageBand: '18-64',
      pregnancy: 'no',
      eatingDisorder: 'no',
      scoffRisk: false,
      diabetes: 'no',
      conditions: 'no',
      metabolic: 'no',
      medications: 'no',
      symptoms: 'no',
      supervisedExercise: 'no',
      musculoskeletal: 'no',
      alcohol: 'no',
    };
    const profiles: ScreeningAnswers[] = [
      base,
      { ...base, ageBand: 'under-18' },
      { ...base, ageBand: '65-74' },
      { ...base, ageBand: '75-plus' },
      { ...base, pregnancy: 'pregnant-or-breastfeeding' },
      { ...base, pregnancy: 'planning' },
      { ...base, pregnancy: 'prefer-not' },
      { ...base, eatingDisorder: 'yes' },
      { ...base, diabetes: 'yes', diabetesItems: ['insulin'] },
      { ...base, diabetes: 'yes', diabetesItems: ['diet-only'] },
      { ...base, conditions: 'yes', conditionItems: ['heart', 'liver'] },
      { ...base, metabolic: 'yes', metabolicItems: ['gout', 'gallstones'] },
      { ...base, medications: 'yes', medicationItems: ['diuretic', 'lithium'] },
      { ...base, medications: 'prefer-not' },
      { ...base, symptoms: 'yes', alcohol: 'yes', musculoskeletal: 'yes', supervisedExercise: 'yes' },
    ];
    const rows: Array<[string, string]> = [];
    profiles.forEach((a, i) => {
      for (const ctx of [{}, { ageYears: 40, bmi: 17.5, bodyFatPct: 9, sex: 'male' as const }]) {
        strings(evaluateScreening(a, ctx), `profile${i}`, rows);
      }
    });
    expect(rows.length).toBeGreaterThan(300);
    const hits = scan(rows);
    expect(hits, report(hits)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 6. validation report page */

const validationDocs = import.meta.glob('/docs/VALIDATION_REPORT.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** What a document (not a UI string) must not carry either: file paths, shell commands, ruling and process vocabulary. */
const DOCUMENT_FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(pnpm|vitest)\b/i, 'shell command'],
  [/\b(docs|research|src)\/[\w.-]+/, 'repository path'],
  [/\.(md|tsx?)\b/, 'file name'],
  [
    /\b(ruling|finisher|blocker[- ]round|release check|work package|registry|registered)\b/i,
    'build-process wording',
  ],
  [/\bO-\d{1,2}\b/, 'oracle id (O-#)'],
  [/\b\d{2} (?:V\d|#\d)/, 'scenario id'],
];

describe('validation report page (docs/VALIDATION_REPORT.md)', () => {
  const text = Object.values(validationDocs)[0] ?? '';

  it('is bundled, so /evidence/validation shows the report', () => {
    expect(Object.keys(validationDocs)).toEqual(['/docs/VALIDATION_REPORT.md']);
    expect(text.length).toBeGreaterThan(5000);
    expect(text).toMatch(/^# /m);
  });

  it('has no internal references', () => {
    const rows: Array<[string, string]> = text
      .split('\n')
      .map((line, i) => [`VALIDATION_REPORT.md:${i + 1}`, line]);
    const hits = scan(rows);
    for (const [path, line] of rows)
      for (const [re, name] of DOCUMENT_FORBIDDEN)
        if (re.test(line)) hits.push(`${path}  ${name}: ${line.slice(0, 80)}`);
    expect(hits, report(hits)).toEqual([]);
  });

  it('writes status words in plain lower case', () => {
    expect(STATUS_CAPITALS.test(text)).toBe(false);
  });

  it('keeps its tables whole (every row has the header’s columns)', () => {
    const cells = (l: string) => l.replace(/\\\|/g, '').split('|').length - 2;
    const lines = text.split('\n');
    let cols = 0;
    let rowsSeen = 0;
    const bad: string[] = [];
    lines.forEach((l, i) => {
      if (!l.startsWith('|')) return;
      rowsSeen++;
      if (!lines[i - 1]?.startsWith('|')) cols = cells(l);
      else if (cells(l) !== cols) bad.push(`line ${i + 1}: ${cells(l)} columns, header has ${cols}`);
    });
    expect(rowsSeen).toBeGreaterThan(200);
    expect(bad, report(bad)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 6b. validation page data sections */

const benchmarkFiles = import.meta.glob('/docs/validation/planner-benchmarks.json', {
  import: 'default',
  eager: true,
}) as Record<string, unknown>;

describe('validation page data sections', () => {
  const IDS = new Set(['scenarioId', 'key', 'id', 'suiteId', 'algorithmId', 'candidateId', 'baselineId', 'generatedAt']);

  it('activity intake checks: titles, descriptions, sources, row labels and miss reasons', () => {
    const rows: Array<[string, string]> = [];
    strings(ACTIVITY_INTAKE_GROUPS, 'activityIntake', rows, IDS);
    strings(Object.values(ACTIVITY_INTAKE_MISS_REASONS), 'missReasons', rows);
    expect(rows.length).toBeGreaterThan(60);
    const hits = scan(rows);
    for (const [path, text] of rows)
      for (const [re, name] of DOCUMENT_FORBIDDEN) if (re.test(text)) hits.push(`${path}  ${name}: ${text.slice(0, 80)}`);
    for (const [path, text] of rows) if (/\b(PAL0|TDEE0|RMR0|R-MAINT|V\d{1,2})\b/.test(text)) hits.push(`${path}  model symbol: ${text}`);
    expect(hits, report(hits)).toEqual([]);
  });

  it('planner benchmarks: the fixture and any published file', () => {
    const rows: Array<[string, string]> = [];
    strings(PLANNER_BENCHMARKS_FIXTURE, 'fixture', rows, IDS);
    for (const [file, data] of Object.entries(benchmarkFiles)) strings(data, file, rows, IDS);
    const hits = scan(rows);
    for (const [path, text] of rows)
      for (const [re, name] of DOCUMENT_FORBIDDEN) if (re.test(text)) hits.push(`${path}  ${name}: ${text.slice(0, 80)}`);
    expect(hits, report(hits)).toEqual([]);
  });
});
