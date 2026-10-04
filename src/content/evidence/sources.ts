/**
 * Source references: the one place that turns engine data into text a user may read.
 *
 * Engine data (metric catalogue, safety rules, model parameters) points at evidence in two ways:
 *  - a structured `SourceRef` (`{ topic, refs }`, see `schema.ts`), authored on metrics and warning rules;
 *  - the maintainers' own pointer into the research notes ("04 §4.3", "17 §3 [6][7]"), kept on parameters and on the
 *    metrics' `src` as a comment-grade string. Those strings are internal and are NEVER rendered.
 *
 * `legacySourceToRefs` converts the second kind to the first (topics only get a number list when the pointer carries
 * "[n]" marks); `paramSource` does the same for a `ParamDef` and also lifts the study references (author, year) out of
 * its free-text `source`. Everything a screen shows goes through `sourceRefLabel` / `paramSourceLabel`, so the guard test
 * (`__tests__/noInternalRefs.test.ts`) can check the rendered text once for all of them.
 */
import { EVIDENCE_TOPICS } from './index';
import type { EvidenceTopicSlug, SourceRef } from './schema';

/** Short names for citing a topic inline ("Safety limits › references 6, 7"). The full titles are in `EVIDENCE_TOPICS`. */
export const TOPIC_SHORT_NAME: Readonly<Record<EvidenceTopicSlug, string>> = {
  'body-weight-models': 'Body-weight models',
  'energy-expenditure': 'Energy expenditure',
  'protein-muscle': 'Protein and muscle',
  'carbohydrate-glycogen-insulin': 'Carbohydrate, glycogen and insulin',
  'fat-oxidation-ketosis': 'Fat oxidation and ketosis',
  'cardiometabolic-markers': 'Blood fats and markers',
  'fasting-meal-timing': 'Fasting and meal timing',
  'autophagy-longevity': 'Autophagy',
  'resistance-training': 'Resistance training',
  'cardio-activity': 'Cardio and activity',
  'energy-surplus': 'Energy surplus',
  'hormones-appetite': 'Hormones and appetite',
  'transitions-periodisation': 'Diet transitions',
  'body-composition-estimation': 'Body composition',
  'fibre-hydration-substances': 'Fibre, hydration and substances',
  'sleep-sex-age': 'Sleep, sex and age',
  'safety-limits': 'Safety limits',
  'performance-wellbeing-bone': 'Performance and wellbeing',
  'extended-water-fasting': 'Extended water fasting',
  'other-levers': 'Other levers',
  'daily-activity-maintenance': 'Daily activity',
  'wearable-scores': 'Wearable scores',
  'tracking-replanning': 'Tracking and re-planning',
  'training-catalogue': 'Training catalogue',
  supplements: 'Supplements',
  'evidence-policy': 'How evidence is weighed',
  'blood-markers-and-diet': 'Blood markers and diet',
  'kitchen-pantry-recipes': 'Kitchen and pantry',
};

/** The separator between a topic name and what is cited inside it. */
export const SOURCE_SEP = ' › ';

const SLUG_BY_DOSSIER: ReadonlyMap<string, EvidenceTopicSlug> = new Map(
  EVIDENCE_TOPICS.map((e) => [e.dossier, e.slug as EvidenceTopicSlug]),
);
const DOSSIER_BY_SLUG: ReadonlyMap<string, string> = new Map(EVIDENCE_TOPICS.map((e) => [e.slug, e.dossier]));

/** Internal: the research-file number behind a topic slug (mechanism ids start with it). Never show it. */
export function dossierOfTopic(slug: string): string | undefined {
  return DOSSIER_BY_SLUG.get(slug);
}

/**
 * Internal: the topic each after-launch research note ("R1 §3.2") was written up in. Notes that are not evidence topics
 * (figure, planner algorithms, sync, AI providers) are absent.
 */
const SLUG_BY_RESEARCH: ReadonlyMap<string, EvidenceTopicSlug> = new Map([
  ['1', 'daily-activity-maintenance'],
  ['3', 'training-catalogue'],
  ['4', 'supplements'],
  ['5', 'evidence-policy'],
  ['9', 'wearable-scores'],
  ['10', 'wearable-scores'],
  ['11', 'tracking-replanning'],
  ['13', 'blood-markers-and-diet'],
]);

/** Internal: the topic a research-file number belongs to (`undefined` for files that are not topics, e.g. 18). */
export function topicOfDossier(dossier: string): EvidenceTopicSlug | undefined {
  return SLUG_BY_DOSSIER.get(dossier);
}

export function topicShortName(slug: EvidenceTopicSlug): string {
  return TOPIC_SHORT_NAME[slug];
}

/** The short name of a topic by any slug string, falling back to `title` for slugs the registry does not know. */
export function topicDisplayName(slug: string, title: string): string {
  return (TOPIC_SHORT_NAME as Readonly<Record<string, string | undefined>>)[slug] ?? title;
}

/** "reference 6" / "references 6, 7". */
export function referenceNumbersText(refs: readonly number[]): string {
  return `${refs.length === 1 ? 'reference' : 'references'} ${refs.join(', ')}`;
}

/** "Safety limits" or "Safety limits › references 6, 7": the plain-text form of one reference. */
export function sourceRefLabel(ref: SourceRef): string {
  const name = topicShortName(ref.topic);
  return ref.refs?.length ? `${name}${SOURCE_SEP}${referenceNumbersText(ref.refs)}` : name;
}

/** Several references joined for one line. */
export function sourceRefsLabel(refs: readonly SourceRef[]): string {
  return refs.map(sourceRefLabel).join('; ');
}

/**
 * The research note's "[n]" numbers are the positions in the note's own source list. A topic page numbers its sources in
 * the same order, except where sources were left off the page (regulatory and helpline pages, a news release): then the
 * page's numbering is shorter. This maps a note's number to the page's position, or `undefined` when that source is not
 * on the page (the reference then points at the topic as a whole).
 *
 * Safety limits: notes 1-80 are the page's 1-80; 81-84 (helplines) are not on the page; 85-99 are 81-95 (four fewer);
 * 100 (a guideline PDF) is not on the page; 101-102 are 96-97; 103-111 (regulatory and communication sources) are not
 * on the page; 112 is 98; 113 is not on the page; 114 is 99. A test checks the result against the page's source list.
 */
export function topicRefPosition(topic: EvidenceTopicSlug, n: number): number | undefined {
  if (topic !== 'safety-limits') return n;
  if (n <= 80) return n;
  if (n <= 84 || n === 100 || (n >= 103 && n <= 111) || n === 113) return undefined;
  if (n <= 99) return n - 4;
  if (n <= 102) return n - 5;
  return n === 112 ? 98 : n === 114 ? 99 : undefined;
}

/**
 * The maintainers' pointer ("13 §4.1-4.6, 04 §4.1", "17 §3 [6][7]", "05 §6") as structured references. Each
 * comma/semicolon/× separated part that starts with a two-digit research-file number becomes one reference to that
 * file's topic (merged when the same topic recurs); "[n]" marks inside the part become `refs`. Parts that name no topic
 * ("schedule", "MODEL_SPEC §1.2", file 18) are dropped. After-launch research notes ("R1 §3.2", "R11 §3.1") map to the
 topic they were written up in (`SLUG_BY_RESEARCH`).
 */
export function legacySourceToRefs(text: string): SourceRef[] {
  const byTopic = new Map<EvidenceTopicSlug, { refs: number[]; legacy: string[] }>();
  for (const part of text.split(/[,;×]/)) {
    const m = /^\s*(?:(\d{2})|R(\d{1,2}))\b/.exec(part);
    if (!m) continue;
    const topic = m[1] ? topicOfDossier(m[1]) : SLUG_BY_RESEARCH.get(m[2]!);
    if (!topic) continue;
    const cur = byTopic.get(topic) ?? { refs: [], legacy: [] };
    for (const r of part.matchAll(/\[(\d+)\]/g)) {
      const n = topicRefPosition(topic, Number(r[1]));
      if (n !== undefined && !cur.refs.includes(n)) cur.refs.push(n);
    }
    cur.legacy.push(part.trim());
    byTopic.set(topic, cur);
  }
  return [...byTopic].map(([topic, v]) => ({
    topic,
    ...(v.refs.length ? { refs: v.refs } : {}),
    legacy: v.legacy.join(', '),
  }));
}

/* ------------------------------------------------------------------ model parameters */

/** A study named in a parameter's `source`, by author and year ("Hall 2011"), with its PubMed id when given. */
export interface StudyCitation {
  /** Display form, "Hall 2011". */
  label: string;
  pmid?: string;
}

/** The fields of a `ParamDef` that this module reads (kept structural so the engine type stays independent). */
export interface ParamSourceFields {
  readonly source: string;
  readonly dossier: string;
}

export interface ParamSource {
  /** Library topics the number is documented in (from the maintainers' `dossier` pointer). */
  topics: SourceRef[];
  /** Studies named in the source text. */
  studies: StudyCitation[];
}

// "Hall 2011", "Müller 2015 PMID 26399868", "Rosqvist 2014/2019", "Smith et al. 2010", "NHANES 2017-Mar 2020".
const STUDY =
  /(?<![\p{L}\d])(\p{Lu}[\p{L}'’-]{2,}(?: (?:et al\.?|and \p{Lu}[\p{L}'’-]+|&\s*\p{Lu}[\p{L}'’-]+))?) (\d{4})(?!\d)(?:[a-z]\b)?(?:\/(\d{4})(?!\d))?(?: (?:[A-Z][A-Za-z]+ )?PMID (\d+))?/gu;
// Words that precede a year in the source text but are not authors (identifiers, months, document words).
const NOT_AUTHORS = new Set([
  'PMID',
  'ISBN',
  'DOI',
  'PROPOSED',
  'DERIVED',
  'ASSUMPTION',
  'ENGINEERING',
  'Spec',
  'Review',
  'Rev',
  'Table',
  'Figure',
  'Fig',
  'Step',
  'Version',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
]);

/** Structured view of a parameter's evidence: library topics plus the study references (author, year). */
export function paramSource(def: ParamSourceFields): ParamSource {
  const studies: StudyCitation[] = [];
  const seen = new Set<string>();
  for (const m of def.source.matchAll(STUDY)) {
    const author = m[1]!.replace(/ et al\.?$/, ' et al.');
    if (NOT_AUTHORS.has(author)) continue;
    const label = `${author} ${m[2]}${m[3] ? `/${m[3]}` : ''}`;
    if (seen.has(label)) continue;
    seen.add(label);
    studies.push({ label, ...(m[4] ? { pmid: m[4] } : {}) });
  }
  return { topics: legacySourceToRefs(def.dossier).map(({ legacy: _legacy, ...ref }) => ref), studies };
}

/**
 * One line a screen can show for a parameter's evidence: topic names, then the studies. A parameter that rests on no
 * topic and names no study is Vitals' own modelling choice.
 */
export function paramSourceLabel(def: ParamSourceFields): string {
  const { topics, studies } = paramSource(def);
  const parts: string[] = [];
  if (topics.length) parts.push(topics.map((t) => topicShortName(t.topic)).join('; '));
  if (studies.length) parts.push(studies.map((s) => s.label).join('; '));
  return parts.length ? parts.join(SOURCE_SEP) : 'Vitals model choice';
}
