/**
 * A small client-side search index for the Evidence library (no dependency):
 * tokenised inverted index with field weights, prefix matching, a few acronym
 * aliases, AND across query words and faceted filters. Topics are added one at a
 * time as they load, so results are progressive.
 */
import { CATEGORY_LABEL } from '@/components';
import type {
  EvidenceCategory,
  EvidenceGrade,
  EvidenceTopic,
  Mechanism,
  Myth,
} from '@/content/evidence/schema';
import { metricLabel, type MetricInfo } from '../metricLabels';
import { CATEGORY_ORDER, GRADE_ORDER, type EvidenceFilters } from './filters';

export interface TopicMeta {
  dossier: string;
  slug: string;
  title: string;
}

export interface MechanismDoc {
  kind: 'mechanism';
  id: string;
  mechanism: Mechanism;
  topic: TopicMeta;
  order: number;
}
export interface MythDoc {
  kind: 'myth';
  id: string;
  myth: Myth;
  topic: TopicMeta;
  order: number;
}
export interface MetricDoc {
  kind: 'metric';
  id: string;
  metric: MetricInfo;
  order: number;
}
export type EvidenceDoc = MechanismDoc | MythDoc | MetricDoc;

export interface SearchHit<D extends EvidenceDoc = EvidenceDoc> {
  doc: D;
  score: number;
}

export type Facets = { category: Record<EvidenceCategory, number>; grade: Record<EvidenceGrade, number> };

export interface SearchResults {
  query: string;
  /** Normalised query words (after stop-word removal), for highlighting. */
  tokens: string[];
  mechanisms: SearchHit<MechanismDoc>[];
  myths: SearchHit<MythDoc>[];
  metrics: SearchHit<MetricDoc>[];
  /** Mechanism counts per category (ignoring the category filter) and per grade (ignoring the grade filter). */
  facets: Facets;
  /** Mechanisms in the index at the time of the search. */
  totalMechanisms: number;
}

/* ------------------------------------------------------------------ text */

const STOP = new Set(
  'a an and are as at be by does do for from how in into is it its of on or per than that the their this to vs was what when which why with without your you'.split(
    ' ',
  ),
);

/** Acronyms and familiar names people type (spec: aliases such as "keto", "PSMF"). */
const ALIASES: Record<string, string[]> = {
  psmf: ['protein sparing modified fast'],
  if: ['intermittent fasting'],
  tre: ['time restricted eating'],
  omad: ['one meal a day'],
  adf: ['alternate day fasting'],
  vlcd: ['very low calorie', 'very low energy'],
  lcd: ['low calorie'],
  keto: ['ketogenic', 'ketosis', 'ketone'],
  lchf: ['low carbohydrate'],
  carb: ['carbohydrate'],
  hiit: ['high intensity interval'],
  neat: ['non exercise activity'],
  tdee: ['total energy expenditure', 'total daily energy expenditure'],
  rmr: ['resting metabolic rate', 'resting energy'],
  bmr: ['basal metabolic rate', 'resting metabolic rate'],
  ree: ['resting energy expenditure'],
  tef: ['thermic effect'],
  mps: ['muscle protein synthesis'],
  mpb: ['muscle protein breakdown'],
  ffm: ['fat free mass'],
  dnl: ['de novo lipogenesis'],
  bhb: ['hydroxybutyrate', 'ketone'],
  ea: ['energy availability'],
  reds: ['relative energy deficiency'],
  cgm: ['continuous glucose'],
  rt: ['resistance training'],
  lifting: ['resistance training'],
  weights: ['resistance training'],
  cardio: ['aerobic', 'endurance'],
  dexa: ['dxa'],
  bia: ['bioelectrical impedance'],
  bf: ['body fat'],
  hrt: ['hormone therapy'],
  tsh: ['thyroid'],
  t3: ['triiodothyronine', 'thyroid'],
};

/** Lowercase, strip accents, keep letters and digits (so "VO₂max" → "vo2max", "β" stays). */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** Light plural folding, applied to both index and query. */
export function stem(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !/(ss|us|is|ys)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** Words of a text, normalised and stemmed. `keepStop` keeps stop words (queries made only of them). */
export function tokenize(text: string, keepStop = false): string[] {
  const out: string[] = [];
  for (const raw of normalize(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    if (!keepStop && STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export interface QueryTerm {
  /** Normalised word as typed. */
  token: string;
  /** Any one alternative must match; within an alternative every token must match. */
  alternatives: string[][];
}

export function parseQuery(query: string): { terms: QueryTerm[]; tokens: string[] } {
  const all = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const content = all.filter((t) => !STOP.has(t));
  const words = (content.length ? content : all).slice(0, 12);
  const terms: QueryTerm[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const token = stem(w);
    if (seen.has(token)) continue;
    seen.add(token);
    const alternatives = [[token], ...(ALIASES[w] ?? ALIASES[token] ?? []).map((phrase) => tokenize(phrase))];
    terms.push({ token, alternatives });
  }
  const tokens = [...new Set(terms.flatMap((t) => t.alternatives.flat()))];
  return { terms, tokens };
}

/* ------------------------------------------------------------------ highlight + snippet */

export interface Segment {
  text: string;
  hit: boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hitPattern(tokens: readonly string[]): RegExp | null {
  const usable = tokens.filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  if (!usable.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.map(escapeRe).join('|')})[\\p{L}\\p{N}]*`, 'giu');
}

/** Split `text` into plain and matched runs (whole words that start with a query word). */
export function highlight(text: string, tokens: readonly string[]): Segment[] {
  const re = hitPattern(tokens);
  if (!re) return [{ text, hit: false }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), hit: false });
    out.push({ text: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

export function containsHit(text: string, tokens: readonly string[]): boolean {
  const re = hitPattern(tokens);
  return re ? re.test(text) : false;
}

export interface Snippet {
  /** Where the words were found, lowercase ("how Vitals models it"). */
  field: string;
  segments: Segment[];
}

/** Searchable prose of a document, in the order snippets prefer. */
export function snippetFields(doc: EvidenceDoc): Array<[field: string, text: string]> {
  if (doc.kind === 'mechanism') {
    const m = doc.mechanism;
    const fields: Array<[string, string | undefined]> = [
      ['summary', m.summary],
      ['how Vitals models it', m.howModelled],
      [
        'key numbers',
        m.keyNumbers.map((k) => `${k.label}: ${k.value}${k.note ? ` (${k.note})` : ''}`).join(' · '),
      ],
      ['timing', m.timeCourse],
      ['what changes it', m.moderators],
      ['contested and uncertain', m.caveats],
      ['grade', m.gradeReason],
      ['used by', m.relatedMetricIds.map(metricLabel).join(', ')],
    ];
    return fields.filter((f): f is [string, string] => Boolean(f[1]));
  }
  if (doc.kind === 'myth') return [['explanation', doc.myth.explanation]];
  return doc.metric.caveat ? [['caveat', doc.metric.caveat]] : [];
}

/** A ~200-character window around the first matched word, or null when nothing matches. */
export function makeSnippet(doc: EvidenceDoc, tokens: readonly string[], width = 200): Snippet | null {
  const re = hitPattern(tokens);
  if (!re) return null;
  for (const [field, text] of snippetFields(doc)) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    const at = m.index;
    let start = Math.max(0, at - Math.round(width * 0.3));
    if (start > 0) {
      const space = text.indexOf(' ', start);
      start = space >= 0 && space < at ? space + 1 : start;
    }
    let end = Math.min(text.length, start + width);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      end = space > at ? space : end;
    }
    const body = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
    return { field, segments: highlight(body, tokens) };
  }
  return null;
}

/* ------------------------------------------------------------------ index */

const W = {
  title: 10,
  claim: 9,
  metricLabel: 7,
  summary: 4,
  category: 3,
  topic: 2,
  body: 2,
  detail: 1.5,
  minor: 1,
} as const;

const PREFIX_FACTOR = 0.8;

const emptyFacets = (): Facets => ({
  category: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<EvidenceCategory, number>,
  grade: Object.fromEntries(GRADE_ORDER.map((g) => [g, 0])) as Record<EvidenceGrade, number>,
});

export class SearchIndex {
  private docs: EvidenceDoc[] = [];
  private titles: string[] = [];
  private postings = new Map<string, Map<number, number>>();
  private vocab: string[] | null = null;
  private topics = new Set<string>();
  private metricsAdded = false;
  private mechanismCount = 0;

  get size(): number {
    return this.docs.length;
  }

  get mechanisms(): number {
    return this.mechanismCount;
  }

  hasTopic(slug: string): boolean {
    return this.topics.has(slug);
  }

  private add(
    doc: EvidenceDoc,
    title: string,
    fields: Array<[text: string | undefined, weight: number]>,
  ): void {
    const idx = this.docs.length;
    this.docs.push(doc);
    this.titles.push(normalize(title));
    const weights = new Map<string, { w: number; n: number }>();
    for (const [text, weight] of fields) {
      if (!text) continue;
      for (const tok of tokenize(text)) {
        const prev = weights.get(tok);
        if (prev) {
          prev.w = Math.max(prev.w, weight);
          prev.n += 1;
        } else weights.set(tok, { w: weight, n: 1 });
      }
    }
    for (const [tok, { w, n }] of weights) {
      let list = this.postings.get(tok);
      if (!list) {
        list = new Map();
        this.postings.set(tok, list);
        this.vocab = null;
      }
      list.set(idx, w + 0.25 * Math.min(n - 1, 4));
    }
  }

  /** Index one topic (idempotent). `rank` orders topics in the unfiltered listing (registry order). */
  addTopic(topic: EvidenceTopic, rank: number): void {
    if (this.topics.has(topic.slug)) return;
    this.topics.add(topic.slug);
    const meta: TopicMeta = { dossier: topic.dossier, slug: topic.slug, title: topic.title };
    topic.mechanisms.forEach((m, i) => {
      this.mechanismCount += 1;
      this.add({ kind: 'mechanism', id: m.id, mechanism: m, topic: meta, order: rank * 1000 + i }, m.title, [
        [m.title, W.title],
        [m.relatedMetricIds.map(metricLabel).join(' '), W.metricLabel],
        [m.summary, W.summary],
        [CATEGORY_LABEL[m.category], W.category],
        [topic.title, W.topic],
        [m.howModelled, W.body],
        [m.keyNumbers.map((k) => k.label).join(' '), W.body],
        [m.timeCourse, W.detail],
        [m.moderators, W.detail],
        [m.caveats, W.detail],
        [m.gradeReason, W.minor],
        [m.keyNumbers.map((k) => `${k.value} ${k.note ?? ''}`).join(' '), W.minor],
      ]);
    });
    topic.myths.forEach((y, i) => {
      this.add({ kind: 'myth', id: y.id, myth: y, topic: meta, order: rank * 1000 + i }, y.claim, [
        [y.claim, W.claim],
        [y.explanation, W.body],
        [topic.title, W.topic],
      ]);
    });
  }

  /** Index the metric catalogue once. */
  addMetrics(metrics: readonly MetricInfo[]): void {
    if (this.metricsAdded) return;
    this.metricsAdded = true;
    metrics.forEach((metric, i) => {
      this.add({ kind: 'metric', id: metric.id, metric, order: i }, metric.label, [
        [metric.label, W.title],
        [metric.id.replace(/([a-z])([A-Z])/g, '$1 $2'), W.metricLabel],
        [metric.category ? CATEGORY_LABEL[metric.category] : undefined, W.category],
      ]);
    });
  }

  private sortedVocab(): string[] {
    if (!this.vocab) this.vocab = [...this.postings.keys()].sort();
    return this.vocab;
  }

  /** doc → best weight for one query token (exact, or prefix of a longer word). */
  private matchToken(token: string, cache: Map<string, Map<number, number>>): Map<number, number> {
    const cached = cache.get(token);
    if (cached) return cached;
    const out = new Map<number, number>();
    for (const [d, w] of this.postings.get(token) ?? []) out.set(d, w);
    if (token.length >= 2) {
      const vocab = this.sortedVocab();
      let lo = 0;
      let hi = vocab.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (vocab[mid]! < token) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < vocab.length && vocab[i]!.startsWith(token); i++) {
        const t = vocab[i]!;
        if (t === token) continue;
        for (const [d, w] of this.postings.get(t)!) {
          const s = w * PREFIX_FACTOR;
          if ((out.get(d) ?? 0) < s) out.set(d, s);
        }
      }
    }
    cache.set(token, out);
    return out;
  }

  private scoreQuery(terms: QueryTerm[]): Map<number, number> {
    const cache = new Map<string, Map<number, number>>();
    let acc: Map<number, number> | null = null;
    for (const term of terms) {
      const termScores = new Map<number, number>();
      for (const alt of term.alternatives) {
        if (!alt.length) continue;
        let altScores: Map<number, number> | null = null;
        for (const tok of alt) {
          const m = this.matchToken(tok, cache);
          if (!altScores) altScores = new Map(m);
          else {
            const next = new Map<number, number>();
            for (const [d, s] of altScores) {
              const t = m.get(d);
              if (t !== undefined) next.set(d, s + t);
            }
            altScores = next;
          }
          if (!altScores.size) break;
        }
        for (const [d, s] of altScores ?? []) {
          const avg = s / alt.length;
          if ((termScores.get(d) ?? 0) < avg) termScores.set(d, avg);
        }
      }
      if (!acc) acc = termScores;
      else {
        const next = new Map<number, number>();
        for (const [d, s] of acc) {
          const t = termScores.get(d);
          if (t !== undefined) next.set(d, s + t);
        }
        acc = next;
      }
      if (!acc.size) break;
    }
    return acc ?? new Map();
  }

  search(query: string, filters: EvidenceFilters): SearchResults {
    const { terms, tokens } = parseQuery(query);
    const cats = new Set(filters.categories);
    const grades = new Set(filters.grades);
    const filtered = cats.size > 0 || grades.size > 0;
    const facets = emptyFacets();
    const mechanisms: SearchHit<MechanismDoc>[] = [];
    const myths: SearchHit<MythDoc>[] = [];
    const metrics: SearchHit<MetricDoc>[] = [];

    const consider = (doc: EvidenceDoc, score: number) => {
      if (doc.kind === 'mechanism') {
        const { category, grade } = doc.mechanism;
        const catOk = !cats.size || cats.has(category);
        const gradeOk = !grades.size || grades.has(grade);
        if (gradeOk) facets.category[category] += 1;
        if (catOk) facets.grade[grade] += 1;
        if (catOk && gradeOk) mechanisms.push({ doc, score });
      } else if (doc.kind === 'myth') {
        // Claims carry neither category nor grade: any active filter excludes them.
        if (!filtered) myths.push({ doc, score });
      } else {
        const { category, grade } = doc.metric;
        if (
          (!cats.size || (category && cats.has(category))) &&
          (!grades.size || (grade && grades.has(grade)))
        )
          metrics.push({ doc, score });
      }
    };

    if (!terms.length) {
      for (const doc of this.docs) if (doc.kind === 'mechanism') consider(doc, 0);
      mechanisms.sort((a, b) => a.doc.order - b.doc.order);
      return { query, tokens, mechanisms, myths, metrics, facets, totalMechanisms: this.mechanismCount };
    }

    const phrase = terms.map((t) => t.token).join(' ');
    for (const [d, base] of this.scoreQuery(terms)) {
      const doc = this.docs[d]!;
      const title = this.titles[d]!;
      let score = base;
      if (phrase.length >= 3 && title.includes(phrase)) score += title.startsWith(phrase) ? 9 : 6;
      consider(doc, score);
    }
    const byScore = (a: SearchHit, b: SearchHit) => b.score - a.score || a.doc.order - b.doc.order;
    mechanisms.sort(byScore);
    myths.sort(byScore);
    metrics.sort(byScore);
    return { query, tokens, mechanisms, myths, metrics, facets, totalMechanisms: this.mechanismCount };
  }
}
