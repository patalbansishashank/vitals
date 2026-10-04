import { beforeAll, describe, expect, it } from 'vitest';
import { MARKER_IDS } from '@/markers/types';
import { MARKER_MECHANISM_ID, markerEvidenceHref } from '@/features/evidence/links';
import { EVIDENCE_TOPICS } from '../index';
import type { EvidenceTopic } from '../schema';
import { TOPIC_SHORT_NAME, legacySourceToRefs } from '../sources';
import { scan, strings } from './leakScan';

const SLUG = 'blood-markers-and-diet';

/** Marker groups and the article ids each must have (id prefix `28-<group>-`). */
const GROUPS: Record<string, string[]> = {
  lipids: ['ldl', 'hdl', 'non-hdl', 'triglycerides', 'apob', 'lpa'],
  sugar: ['fasting-glucose', 'hba1c', 'fasting-insulin', 'uric-acid'],
  liver: ['alt', 'ast', 'ggt'],
  kidney: ['creatinine-egfr', 'urine-acr'],
  electrolytes: ['sodium', 'potassium'],
  thyroid: ['tsh', 'free-t3'],
  blood: ['haemoglobin', 'ferritin'],
  vitamins: ['b12', 'vitamin-d'],
  inflammation: ['hs-crp'],
  hormones: ['testosterone', 'cortisol'],
};

/** Maintainers' vocabulary that must never reach this page (on top of the shared leak patterns). */
const INTERNAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bR\d{1,2}[a-z]?\b/, 'research-note id (R13)'],
  [/\bW-[A-Z]/, 'rule id (W-…)'],
  [/(^|[\s[(,])S\d{1,3}(?=[\s\],);.]|$)/, 'research source id (S12)'],
  [/dossier/i, 'dossier'],
  [/§/, 'section sign'],
  [/MODEL_SPEC|SUITE_SPEC/, 'spec name'],
  [/\.(md|json|tsx?)\b/, 'file name'],
  [/\binternal\b/i, 'internal note'],
  [/\bengine\b/i, 'engine wording'],
];

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

let topic: EvidenceTopic;

beforeAll(async () => {
  const entry = EVIDENCE_TOPICS.find((e) => e.slug === SLUG);
  if (!entry) throw new Error('topic not registered');
  topic = (await entry.load()).default;
});

describe('Blood markers and diet topic', () => {
  it('is registered with a title and short name', () => {
    expect(topic.slug).toBe(SLUG);
    expect(topic.title).toBe('Blood markers and diet');
    expect(TOPIC_SHORT_NAME[SLUG]).toBe('Blood markers and diet');
    expect(legacySourceToRefs('R13 lipids').map((r) => r.topic)).toEqual([SLUG]);
  });

  it('has an article for every marker in every group', () => {
    const ids = new Set(topic.mechanisms.map((m) => m.id));
    for (const [group, markers] of Object.entries(GROUPS)) {
      for (const m of markers) expect(ids.has(`28-${group}-${m}`), `${group} › ${m}`).toBe(true);
    }
  });

  it('states the plan rules plainly: nothing banned, not medical advice, retest dates', () => {
    expect(topic.scope).toMatch(/not medical advice/);
    for (const m of topic.mechanisms) {
      expect(m.howModelled, m.id).toMatch(/Nothing is banned outright/);
      expect(
        m.keyNumbers.some((k) => /retest|measured once|measure once/i.test(`${k.label} ${k.value}`)),
        m.id,
      ).toBe(true);
    }
  });

  it('cites only sources that carry a DOI, PMID or URL', () => {
    expect(topic.references.length).toBeGreaterThan(100);
    for (const r of topic.references) expect(Boolean(r.doi || r.pmid || r.url), r.id).toBe(true);
    const cited = new Set(topic.mechanisms.flatMap((m) => m.referenceIds));
    for (const r of topic.references)
      expect(
        cited.has(r.id) || topic.myths.some((y) => y.referenceIds.includes(r.id)),
        `${r.id} unused`,
      ).toBe(true);
  });

  it('contains no internal references', () => {
    const rows: Array<[string, string]> = [];
    strings(topic, SLUG, rows, NOT_PROSE);
    expect(scan(rows)).toEqual([]);
    const hits = rows.flatMap(([path, text]) =>
      INTERNAL.filter(([re]) => re.test(text)).map(([, name]) => `${path}: ${name}: ${text.slice(0, 80)}`),
    );
    expect(hits).toEqual([]);
  });

  it('gives every marker of the interaction table a Why link into this topic', () => {
    const ids = new Set(topic.mechanisms.map((m) => m.id));
    for (const id of MARKER_IDS) {
      expect(ids.has(MARKER_MECHANISM_ID[id]), id).toBe(true);
      expect(markerEvidenceHref(id)).toBe(`/evidence/${MARKER_MECHANISM_ID[id]}`);
    }
    expect(markerEvidenceHref('unknown')).toBe(`/evidence/topics/${SLUG}`);
  });
});
