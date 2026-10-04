import { beforeAll, describe, expect, it } from 'vitest';
import { SERIES } from '@/engine/types/metrics';
import { EVIDENCE_TOPICS } from './index';
import { PARAM_INDEX } from './params';
import type { EvidenceTopic } from './schema';

const GRADES = ['A', 'B', 'C', 'D'];
const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;

/**
 * Outcome metrics (`kind: 'metric'`, the chartable / goal-eligible catalogue entries) that no mechanism lists in
 * `relatedMetricIds`. Empty today: every outcome metric has at least one mechanism. Add an id here (with the reason)
 * only when the library genuinely has no suitable article; the test below fails on stale entries.
 */
const UNCOVERED_METRICS_ALLOWED: ReadonlySet<string> = new Set<string>([]);

let topics: EvidenceTopic[] = [];

beforeAll(async () => {
  topics = await Promise.all(EVIDENCE_TOPICS.map(async (entry) => (await entry.load()).default));
}, 120_000);

describe('evidence registry', () => {
  it('has unique dossier numbers and slugs', () => {
    const dossiers = EVIDENCE_TOPICS.map((e) => e.dossier);
    const slugs = EVIDENCE_TOPICS.map((e) => e.slug);
    expect(new Set(dossiers).size).toBe(dossiers.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('matches the dossier, slug and title of every loaded topic', () => {
    EVIDENCE_TOPICS.forEach((entry, i) => {
      const topic = topics[i];
      if (!topic) throw new Error(`topic ${entry.slug} did not load`);
      expect(topic.dossier, `${entry.slug} dossier`).toBe(entry.dossier);
      expect(topic.slug, `${entry.slug} slug`).toBe(entry.slug);
      expect(topic.title, `${entry.slug} title`).toBe(entry.title);
    });
  });
});

describe('evidence content', () => {
  it('registers at least one topic and loads each of them', () => {
    expect(EVIDENCE_TOPICS.length).toBeGreaterThan(0);
    expect(topics).toHaveLength(EVIDENCE_TOPICS.length);
  });

  it('has globally unique mechanism ids', () => {
    const seen = new Map<string, string>();
    for (const topic of topics) {
      for (const m of topic.mechanisms) {
        const previous = seen.get(m.id);
        expect(
          previous,
          `mechanism id ${m.id} in topic ${topic.dossier} is already used in topic ${previous}`,
        ).toBeUndefined();
        seen.set(m.id, topic.dossier);
      }
    }
  });

  it('has unique reference ids within each topic', () => {
    for (const topic of topics) {
      const ids = topic.references.map((r) => r.id);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(duplicates, `duplicate reference ids in topic ${topic.dossier}`).toEqual([]);
    }
  });

  it('resolves every referenceIds entry to a reference in the same topic', () => {
    for (const topic of topics) {
      const known = new Set(topic.references.map((r) => r.id));
      const unresolved: string[] = [];
      const check = (where: string, ids: string[] | undefined) => {
        for (const id of ids ?? []) if (!known.has(id)) unresolved.push(`${where} -> ${id}`);
      };
      for (const m of topic.mechanisms) {
        check(`mechanism ${m.id}`, m.referenceIds);
        for (const k of m.keyNumbers) check(`mechanism ${m.id} key number "${k.label}"`, k.referenceIds);
      }
      for (const myth of topic.myths) check(`myth ${myth.id}`, myth.referenceIds);
      expect(unresolved, `unresolved references in topic ${topic.dossier}`).toEqual([]);
    }
  });

  it('gives every mechanism a summary, how-modelled text and a grade reason', () => {
    for (const topic of topics) {
      for (const m of topic.mechanisms) {
        expect(nonEmpty(m.summary), `${m.id} summary`).toBe(true);
        expect(nonEmpty(m.howModelled), `${m.id} howModelled`).toBe(true);
        expect(nonEmpty(m.gradeReason), `${m.id} gradeReason`).toBe(true);
      }
    }
  });

  it('uses grades A to D only', () => {
    for (const topic of topics) {
      for (const m of topic.mechanisms) {
        expect(GRADES, `${m.id} grade`).toContain(m.grade);
      }
    }
  });
});

describe('evidence <-> metric catalogue', () => {
  const catalogueIds = new Set<string>(SERIES.map((d) => d.id));

  it('lists only catalogue metric ids (no duplicates) in every relatedMetricIds', () => {
    const problems: string[] = [];
    for (const topic of topics) {
      for (const m of topic.mechanisms) {
        for (const id of m.relatedMetricIds) {
          if (!catalogueIds.has(id)) problems.push(`${m.id} -> unknown metric id "${id}"`);
        }
        const dupes = m.relatedMetricIds.filter((id, i) => m.relatedMetricIds.indexOf(id) !== i);
        if (dupes.length) problems.push(`${m.id} -> duplicate ${dupes.join(', ')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('gives every outcome metric at least one mechanism (except the allow-listed ones)', () => {
    const covered = new Set<string>();
    for (const topic of topics)
      for (const m of topic.mechanisms) for (const id of m.relatedMetricIds) covered.add(id);

    // Chartable outcome channels only; detail (decomposition) and input-echo series are not required to have articles.
    const outcomeIds = SERIES.filter((d) => d.kind === 'metric').map((d) => d.id as string);
    const uncovered = outcomeIds.filter((id) => !covered.has(id) && !UNCOVERED_METRICS_ALLOWED.has(id));
    expect(uncovered, 'outcome metrics with no mechanism in relatedMetricIds').toEqual([]);

    const stale = [...UNCOVERED_METRICS_ALLOWED].filter((id) => covered.has(id) || !outcomeIds.includes(id));
    expect(
      stale,
      'allow-listed metrics that are now covered (or are not outcome metrics): remove them',
    ).toEqual([]);
  });
});

describe('evidence <-> model parameters', () => {
  it('lists only known parameter ids (no duplicates) in every relatedParamIds', () => {
    const problems: string[] = [];
    for (const topic of topics) {
      for (const m of topic.mechanisms) {
        const ids = m.relatedParamIds ?? [];
        for (const id of ids) if (!PARAM_INDEX.has(id)) problems.push(`${m.id} -> unknown parameter id "${id}"`);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        if (dupes.length) problems.push(`${m.id} -> duplicate ${dupes.join(', ')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('links every activity-intake and tracking parameter from at least one mechanism', () => {
    const linked = new Set(topics.flatMap((t) => t.mechanisms.flatMap((m) => m.relatedParamIds ?? [])));
    const missing = [...PARAM_INDEX.keys()].filter(
      (id) => (id.startsWith('activityIntake.') || id.startsWith('assimilation.')) && !linked.has(id),
    );
    expect(missing).toEqual([]);
  });
});
