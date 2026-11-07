/**
 * The (i) of a card, as copy (r071 AUDIT §1.2, SPEC "the (i) button"). Each feature's copy file holds an `INFO` block with
 * one `InfoEntry` per card: plain strings in plain words, second person, 25 to 60 words, so the copy guard
 * (`living/__tests__/copy.test.ts`) scans them like every other string and no component writes prose of its own.
 * `infoSpec` turns an entry into the foundation's `InfoSpec` for `<CardHead info={…} />`:
 *
 *   - an evidence slug becomes a link to `/evidence/topics/:slug`, titled from the topic's own title (so a link can never
 *     say something the topic does not);
 *   - `range` and `terms` pass through; `twin`, `explain` and `footer` are nodes the page adds (`extra`).
 *
 * The explanation that used to be subtext lives here and nowhere else: a card's body keeps numbers, a picture and mono
 * facts. Pure: no React, no store reads.
 */
import type { ReactNode } from 'react';
import type { InfoSpec } from '@/components';
import { paths } from '@/app/paths';
import { EVIDENCE_TOPICS } from '@/content/evidence';

/** What an (i) panel says, in strings. */
export interface InfoEntry {
  /** The panel's title. Default (when absent): the card's title. */
  title?: string;
  /** One reading paragraph, or sections with their own heading. */
  body: string | ReadonlyArray<{ heading?: string; body: string }>;
  /** The "where this comes from" line: the kind and the card's own words. */
  source?: { kind: 'ring' | 'phone' | 'estimate' | 'logged' | 'plan' | 'engine'; words?: string };
  /** The normal or goal range as a sentence: "Usually 60 to 100". */
  range?: string;
  /** Per-word explanations (the old per-value popovers). */
  terms?: ReadonlyArray<{ term: string; text: string }>;
  /** /evidence topic slug(s) from `EVIDENCE_TOPICS` ("protein-muscle"). */
  evidence?: string | ReadonlyArray<string>;
}

/** The nodes only a page can supply. */
export interface InfoExtra {
  twin?: ReactNode;
  explain?: ReactNode;
  footer?: ReactNode;
  /** Overrides `entry.range` with a node (a band table). */
  range?: ReactNode;
}

const TOPIC_TITLE: ReadonlyMap<string, string> = new Map(EVIDENCE_TOPICS.map((t) => [t.slug, t.title]));

/** The title of an evidence topic; null for a slug that is not one. */
export const evidenceTopicTitle = (slug: string): string | null => TOPIC_TITLE.get(slug) ?? null;

/** An entry as the foundation's `InfoSpec`. An unknown evidence slug is dropped (and `infoProblems` reports it in tests). */
export function infoSpec(entry: InfoEntry, extra: InfoExtra = {}): InfoSpec {
  const slugs = entry.evidence === undefined ? [] : typeof entry.evidence === 'string' ? [entry.evidence] : [...entry.evidence];
  const evidence = slugs.flatMap((slug) => {
    const label = evidenceTopicTitle(slug);
    return label ? [{ to: paths.evidenceTopic(slug), label }] : [];
  });
  return {
    ...(entry.title ? { title: entry.title } : {}),
    body: typeof entry.body === 'string' ? entry.body : entry.body.map((s) => ({ ...(s.heading ? { heading: s.heading } : {}), body: s.body })),
    ...(entry.source ? { source: entry.source } : {}),
    ...(extra.range !== undefined ? { range: extra.range } : entry.range ? { range: entry.range } : {}),
    ...(entry.terms?.length ? { terms: [...entry.terms] } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(extra.explain ? { explain: extra.explain } : {}),
    ...(extra.twin ? { twin: extra.twin } : {}),
    ...(extra.footer ? { footer: extra.footer } : {}),
  };
}

/** Words in the reading text. */
export function infoWords(entry: Pick<InfoEntry, 'body'>): number {
  const text = typeof entry.body === 'string' ? entry.body : entry.body.map((s) => s.body).join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

/** The bounds the owner asked for (AUDIT §5.2: 25 to 60 words), with a little room either way for a section split. */
export const INFO_WORDS = { min: 20, max: 70 } as const;

/**
 * What is wrong with an entry, for a feature's own copy test: `expect(Object.entries(INFO).flatMap(([id, e]) => infoProblems(e, id))).toEqual([])`.
 * Checks the length of the reading text, that every evidence slug is a real topic, and that nothing in it moralises,
 * shouts or points at the build ("see §", a file path).
 */
export function infoProblems(entry: InfoEntry, id: string): string[] {
  const out: string[] = [];
  const words = infoWords(entry);
  if (words < INFO_WORDS.min || words > INFO_WORDS.max) out.push(`${id}: ${words} words (want ${INFO_WORDS.min} to ${INFO_WORDS.max})`);
  const slugs = entry.evidence === undefined ? [] : typeof entry.evidence === 'string' ? [entry.evidence] : [...entry.evidence];
  for (const s of slugs) if (!TOPIC_TITLE.has(s)) out.push(`${id}: no evidence topic "${s}"`);
  const text = [typeof entry.body === 'string' ? entry.body : entry.body.map((s) => s.body).join(' '), entry.range ?? '', ...(entry.terms ?? []).map((t) => t.text), entry.source?.words ?? ''].join(' ');
  if (/!\s*$|\bstreaks?\b|\bfailed\b|\bcheat/i.test(text)) out.push(`${id}: moralising or shouting`);
  if (/§|\.tsx?\b|src\/|\bAUDIT\b|\bSPEC\b/.test(text)) out.push(`${id}: points at the build`);
  return out;
}
