import type { EvidenceGrade, Mechanism, Myth } from '@/content/evidence/schema';

/** Grade meanings as the UI states them (grade chips, the "How grades work" panel). */
export const GRADE_MEANING: Record<EvidenceGrade, { word: string; text: string }> = {
  A: { word: 'Strong', text: 'Meta-analyses, validated models or several controlled human trials agree.' },
  B: { word: 'Good', text: 'A few human trials or consistent human mechanistic data.' },
  C: { word: 'Limited', text: 'Indirect or small human studies. Read the shape, not the exact number.' },
  D: { word: 'Speculative', text: 'Animal or cell studies, or expert judgement.' },
};

/** Mechanism status: the word (row and article state) and, for the article, what it means. */
export const STATUS_TEXT: Record<Mechanism['status'], { label: string; text: string }> = {
  established: { label: 'Established', text: 'Consistent across the published studies.' },
  'proposed-fit': {
    label: 'Proposed fit',
    text: 'A model fit Vitals proposes from the published data, not one study’s number.',
  },
  contested: {
    label: 'Contested',
    text: 'Studies disagree. See “Contested and uncertain” for what is in dispute.',
  },
};

export const VERDICT_TEXT: Record<Myth['verdict'], string> = {
  'not-supported': 'not supported',
  oversimplified: 'oversimplified',
  unproven: 'unproven',
  'supported-with-caveats': 'supported, with caveats',
};

/** The library's one-line disclaimer (information, not medical advice): article, topic and Explain endings. */
export const DISCLAIMER =
  'Plain-language summaries of published research for an average adult. Information, not medical advice: talk to a clinician about your own health.';

/** The state line a grade-D article carries under its grade. */
export const GRADE_D_NOTE = 'Exploratory. Mostly animal or cell evidence.';

/** Title of the grade meanings panel (header ⋯, the article's grade line, the desktop filter column). */
export const GRADES_HELP_TITLE = 'How grades work';

/** First letter up: catalogue and caller strings are lower case ("body composition", "what it is made of"). */
export const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
