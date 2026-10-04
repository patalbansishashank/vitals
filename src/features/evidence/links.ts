import { paths } from '@/app/paths';
import type { MarkerId } from '@/markers/types'; // E20: markers

/** Article section anchors (IA §2 names `#parameters` and `#citations`). */
export const ARTICLE_SECTIONS = {
  equation: 'equation',
  parameters: 'parameters',
  modelParameters: 'model-parameters',
  timing: 'timing',
  moderators: 'moderators',
  usedBy: 'used-by',
  contested: 'contested',
  citations: 'citations',
} as const;
export type ArticleSection = (typeof ARTICLE_SECTIONS)[keyof typeof ARTICLE_SECTIONS];

/** `/evidence/:id`, optionally at a section (`equation`, `parameters`, `citations`…). */
export function mechanismHref(id: string, section?: ArticleSection): string {
  return `${paths.mechanism(id)}${section ? `#${section}` : ''}`;
}

export function topicHref(slug: string, anchor?: string): string {
  return `${paths.evidenceTopic(slug)}${anchor ? `#${anchor}` : ''}`;
}

/**
 * `#ref-6`: the sixth numbered source of a topic page. Engine data cites sources by this number (`SourceRef.refs`), and
 * the topic page resolves the hash to the matching source entry (`resolveTopicHash`).
 */
export const topicRefAnchor = (n: number): string => `ref-${n}`;

export const claimAnchor = (mythId: string): string => `claim-${mythId}`;
export const sourceAnchor = (refId: string): string => `src-${refId}`;

/** Router state carried into the library. */
export interface EvidenceNavState {
  /** Set by links inside the library: "back" can use history. */
  from?: 'evidence';
  /** Set by Explain: the article shows "‹ Back to …" and returns to the exact chart state. */
  returnTo?: { to: string; label: string };
}

// E20: markers — the "Why" link from a blood-marker card into the Evidence library.
/** Slug of the Evidence topic that explains blood markers (`/evidence/topics/blood-markers-and-diet`). */
export const BLOOD_MARKERS_TOPIC = 'blood-markers-and-diet';

/** The mechanism (article) id in that topic for each marker; creatinine and eGFR share one article. */
export const MARKER_MECHANISM_ID: Readonly<Record<MarkerId, string>> = {
  ldl: '28-lipids-ldl',
  hdl: '28-lipids-hdl',
  nonHdl: '28-lipids-non-hdl',
  tg: '28-lipids-triglycerides',
  apoB: '28-lipids-apob',
  lpa: '28-lipids-lpa',
  fpg: '28-sugar-fasting-glucose',
  hba1c: '28-sugar-hba1c',
  insulin: '28-sugar-fasting-insulin',
  urate: '28-sugar-uric-acid',
  alt: '28-liver-alt',
  ast: '28-liver-ast',
  ggt: '28-liver-ggt',
  creatinine: '28-kidney-creatinine-egfr',
  egfr: '28-kidney-creatinine-egfr',
  uacr: '28-kidney-urine-acr',
  sodium: '28-electrolytes-sodium',
  potassium: '28-electrolytes-potassium',
  tsh: '28-thyroid-tsh',
  ft3: '28-thyroid-free-t3',
  hb: '28-blood-haemoglobin',
  ferritin: '28-blood-ferritin',
  b12: '28-vitamins-b12',
  vitD: '28-vitamins-vitamin-d',
  hsCrp: '28-inflammation-hs-crp',
  testosterone: '28-hormones-testosterone',
  cortisol: '28-hormones-cortisol',
};

/** `/evidence/28-lipids-ldl` for a known marker (optionally at a section), else the topic page. */
export function markerEvidenceHref(markerId: string, section?: ArticleSection): string {
  const id = (MARKER_MECHANISM_ID as Readonly<Record<string, string | undefined>>)[markerId];
  return id ? mechanismHref(id, section) : topicHref(BLOOD_MARKERS_TOPIC);
}
