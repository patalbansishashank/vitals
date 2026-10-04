/**
 * Evidence library content schema. One `EvidenceTopic` per research topic, authored as typed data in
 * `src/content/evidence/topics/NN-slug.ts` and lazy-loaded by the Evidence feature.
 * Text is written in our own words for a curious non-specialist; numbers come from the cited research verbatim.
 * Maintainers: a topic was written from the research file `research/NN-*.md` whose number prefixes the topic file;
 * that number is internal (`EvidenceTopic.dossier`) and never appears in text the user can read.
 */
export type EvidenceGrade = 'A' | 'B' | 'C' | 'D';

/**
 * Every Evidence library topic, by slug (the order of `EVIDENCE_TOPICS` in `./index.ts`; a test keeps the two in step).
 * Slugs are the stable public names of topics: they appear in `/evidence/topics/:slug` and in `SourceRef.topic`.
 */
export const EVIDENCE_TOPIC_SLUGS = [
  'body-weight-models',
  'energy-expenditure',
  'protein-muscle',
  'carbohydrate-glycogen-insulin',
  'fat-oxidation-ketosis',
  'cardiometabolic-markers',
  'fasting-meal-timing',
  'autophagy-longevity',
  'resistance-training',
  'cardio-activity',
  'energy-surplus',
  'hormones-appetite',
  'transitions-periodisation',
  'body-composition-estimation',
  'fibre-hydration-substances',
  'sleep-sex-age',
  'safety-limits',
  'performance-wellbeing-bone',
  'extended-water-fasting',
  'other-levers',
  'daily-activity-maintenance',
  'wearable-scores',
  'tracking-replanning',
  'training-catalogue',
  'supplements',
  'evidence-policy',
  'blood-markers-and-diet',
  'kitchen-pantry-recipes',
] as const;
export type EvidenceTopicSlug = (typeof EVIDENCE_TOPIC_SLUGS)[number];

/**
 * A structured pointer from engine data (metric catalogue, safety rules, parameters) into the Evidence library.
 * This is what the UI renders ("Safety limits › references 6, 7", each part a link); it never carries the
 * maintainers' pointers into the research notes (those live in `legacy` and in code comments, and are not shown).
 */
export interface SourceRef {
  /** The library topic the claim or number comes from. */
  topic: EvidenceTopicSlug;
  /**
   * 1-based positions in that topic's numbered source list (the "[6][7]" of the research notes; the topic page numbers
   * its sources in the same order). Omit to point at the topic as a whole.
   */
  refs?: readonly number[];
  /** Maintainers only: the research-note pointer this was converted from, e.g. "17 §3". Never rendered. */
  legacy?: string;
}

/** The eight metric categories of the design system (design/tokens.css `--lm-cat-*`). */
export type EvidenceCategory =
  | 'body'
  | 'fuel'
  | 'energy'
  | 'cellular'
  | 'performance'
  | 'recovery'
  | 'cardio'
  | 'hormones';

export interface Reference {
  /** Stable key, lowercase `firstauthorYEAR` plus a letter if needed, e.g. `hall2011a`. Unique within a topic. */
  id: string;
  authors: string;
  year: number;
  title: string;
  journal: string;
  pmid?: string;
  doi?: string;
  url?: string;
  /** Set when the dossier could only confirm the source at abstract level or marked it UNVERIFIED. */
  verification?: 'full-text' | 'abstract' | 'unverified';
}

export interface KeyNumber {
  label: string;
  /** Value with unit, as a display string, e.g. "≈ 3 g water per g glycogen (range 2–4)". */
  value: string;
  note?: string;
  referenceIds?: string[];
}

export interface Mechanism {
  /** Globally unique kebab-case id prefixed with the dossier number, e.g. `04-liver-glycogen-depletion`. */
  id: string;
  title: string;
  category: EvidenceCategory;
  /** Plain-language lead, 2–4 sentences, no jargon left unexplained. */
  summary: string;
  /** How the engine represents it, in words a non-programmer can follow. */
  howModelled: string;
  /** The equation in readable plain text / unicode (not LaTeX), when the dossier gives one. */
  equation?: string;
  keyNumbers: KeyNumber[];
  /** Onset, time-constant, saturation, reversal. */
  timeCourse?: string;
  /** What changes it: sex, age, body-fat level, training status, energy balance… */
  moderators?: string;
  grade: EvidenceGrade;
  /** One sentence: why this grade. */
  gradeReason: string;
  status: 'established' | 'proposed-fit' | 'contested';
  /** What is contested or uncertain, if anything. */
  caveats?: string;
  referenceIds: string[];
  /** Engine metric ids this mechanism drives. Filled in by the integration pass; leave empty for now. */
  relatedMetricIds: string[];
  /**
   * Model parameter ids (`ParamDef.id`, e.g. `activityIntake.occDesk`) whose numbers this mechanism documents. The
   * article shows them as parameter cards; every id must resolve in `PARAM_INDEX` (`./params.ts`, a test checks).
   */
  relatedParamIds?: string[];
}

export interface Myth {
  id: string;
  /** The popular claim, stated fairly. */
  claim: string;
  verdict: 'not-supported' | 'oversimplified' | 'unproven' | 'supported-with-caveats';
  explanation: string;
  referenceIds: string[];
}

export interface EvidenceTopic {
  /** Internal research-file number, e.g. "04" (prefix of the topic file and of mechanism ids). Never shown to users. */
  dossier: string;
  slug: string;
  title: string;
  /** 2–3 sentence scope statement. */
  scope: string;
  mechanisms: Mechanism[];
  myths: Myth[];
  openQuestions: string[];
  references: Reference[];
}
