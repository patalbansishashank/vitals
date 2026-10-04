import type { EvidenceGrade, Mechanism, Myth } from '@/content/evidence/schema';

/** Grade meanings as the UI states them (also the /evidence#grades legend). */
export const GRADE_MEANING: Record<EvidenceGrade, { word: string; text: string }> = {
  A: { word: 'Strong', text: 'Meta-analyses, validated models or several controlled human trials agree.' },
  B: { word: 'Good', text: 'A few human trials or consistent human mechanistic data.' },
  C: { word: 'Limited', text: 'Indirect or small human studies. Read the shape, not the exact number.' },
  D: {
    word: 'Speculative',
    text: 'Animal or cell studies, or expert judgement. Shown for exploration; the Planner weights it lightly.',
  },
};

export const STATUS_TEXT: Record<Mechanism['status'], { label: string; text: string }> = {
  established: { label: 'established', text: 'Consistent across the published studies.' },
  'proposed-fit': {
    label: 'proposed fit',
    text: 'A model fit Vitals proposes from the published data, not one study’s number.',
  },
  contested: {
    label: 'contested',
    text: 'Studies disagree. See “Contested and uncertain” for what is in dispute.',
  },
};

/**
 * Two words key-number notes and captions use for values that are not read straight from one study. They are written
 * lower case in running text ("a proposed fit", "the slope is unverified") and shown the same way on source badges.
 */
export const NOTE_WORD_TEXT: Record<'proposed' | 'unverified', { label: string; text: string }> = {
  proposed: {
    label: 'proposed',
    text: 'A value Vitals chose, or fitted to published data, where no study gives one number.',
  },
  unverified: {
    label: 'unverified',
    text: 'A number or source the research team could not confirm against the original paper. Treat it with care.',
  },
};

export const VERDICT_TEXT: Record<Myth['verdict'], string> = {
  'not-supported': 'not supported',
  oversimplified: 'oversimplified',
  unproven: 'unproven',
  'supported-with-caveats': 'supported, with caveats',
};

export const INDEX_LEAD = 'How Vitals’ model works, and how sure we are about each part.';

/** The library's one-line disclaimer (information, not medical advice). */
export const DISCLAIMER =
  'Plain-language summaries of published research for an average adult. Information, not medical advice: talk to a clinician about your own health.';

export const GRADE_D_BANNER = {
  title: 'Exploratory. Mostly animal or cell evidence.',
  body: 'The Simulator shows it; the Planner won’t trade a higher goal for it.',
};
