/** `evidence.*` (SUITE_SPEC §1.9): the Evidence library's topics, searched and summarised (titles, scope, mechanisms). */
import { EVIDENCE_TOPICS } from '@/content/evidence';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';

const TopicSummary = T.Object({ slug: T.String(), title: T.String(), scope: T.String(), link: T.String(), score: T.Number() });

async function loadAll() {
  return Promise.all(EVIDENCE_TOPICS.map(async (e) => ({ entry: e, topic: (await e.load()).default })));
}

export const evidenceSearch = defineCommand({
  id: 'evidence.search',
  version: 1,
  title: 'Search the evidence library',
  description: 'Find evidence topics by words (e.g. "protein muscle", "fasting ketosis"): titles and scope with a link to each topic page, best match first.',
  input: T.Object({ q: T.String({ minLength: 1, maxLength: 200 }) }),
  output: T.Array(TopicSummary),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the Evidence screens read the library content directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (_ctx, input) => {
    const words = input.q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const topics = await loadAll();
    return topics
      .map(({ entry, topic }) => {
        const hay = `${topic.title} ${topic.scope} ${topic.mechanisms.map((m) => `${m.title} ${m.summary}`).join(' ')}`.toLowerCase();
        const score = words.reduce((n, w) => n + (topic.title.toLowerCase().includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0);
        return { slug: entry.slug, title: topic.title, scope: topic.scope, link: `/evidence/topics/${entry.slug}`, score };
      })
      .filter((t) => t.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  },
});

export const evidenceGet = defineCommand({
  id: 'evidence.get',
  version: 1,
  title: 'Read an evidence topic',
  description: 'One evidence topic: scope, its mechanisms (title, plain-language summary, evidence grade A–D and status) and common claims with verdicts, with a link to the page.',
  input: T.Object({ slug: T.String({ minLength: 1 }) }),
  output: T.Object({
    slug: T.String(),
    title: T.String(),
    scope: T.String(),
    link: T.String(),
    mechanisms: T.Array(T.Object({ id: T.String(), title: T.String(), summary: T.String(), grade: T.String(), status: T.String() })),
    myths: T.Array(T.Object({ claim: T.String(), verdict: T.String() })),
  }),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the Evidence screens read the library content directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (_ctx, input) => {
    const entry = EVIDENCE_TOPICS.find((e) => e.slug === input.slug) ?? fail('not_found', 'There is no evidence topic with that name.');
    const topic = (await entry.load()).default;
    return {
      slug: entry.slug,
      title: topic.title,
      scope: topic.scope,
      link: `/evidence/topics/${entry.slug}`,
      mechanisms: topic.mechanisms.map((m) => ({ id: m.id, title: m.title, summary: m.summary, grade: m.grade, status: m.status })),
      myths: topic.myths.map((m) => ({ claim: m.claim, verdict: m.verdict })),
    };
  },
});

declare module '../types' {
  interface CommandMap {
    'evidence.search': typeof evidenceSearch;
    'evidence.get': typeof evidenceGet;
  }
}
