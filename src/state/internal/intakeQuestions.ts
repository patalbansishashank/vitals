/**
 * The intake question graph as headless data for the Coach's conversational onboarding (`intake.nextQuestions`;
 * importable only from `src/commands/**`, like `./intake.ts`): the next unanswered questions in the same fixed order
 * the screens use (v3, SUITE_SPEC §13.1), with the self-contained prompt, the parent answer it depends on, the answer
 * shape and the `intake.answer` call that records an answer.
 */
import { CHAPTER_QUESTIONS, CHAPTERS } from '@/features/intake/chapters';
import { intakeContextNow, intakeDocNow } from './intake';
import { flowContextOf } from '@/features/intake/context';
import { turnsOf } from '@/features/intake/doc';
import { frozenContext, isDone, optionsOf, stampContext, visibleQuestions, type Question } from '@/features/intake/flow';
import { SECTION_CHAPTER, TURNS_SECTION, type ChapterId, type IntakeSectionId } from '@/features/intake/types';

export type QuestionAnswerShape =
  | { type: 'single'; options: Array<{ value: string; label: string; examples?: string }>; defaultValue?: string }
  | { type: 'multi'; options: Array<{ value: string; label: string; examples?: string; exclusive?: boolean }>; required?: boolean; ranked?: boolean; otherLabel?: string }
  | { type: 'number'; min: number; max: number; step: number; unit?: string; presets: number[]; defaultValue?: number }
  | { type: 'custom'; widget: string };

export interface IntakeQuestionView {
  /** The id in the chapter's turns (what `intake.answer` writes). */
  id: string;
  /** Stable graph id, `${chapter}.${id}`. */
  qid: string;
  chapter: ChapterId;
  /** The question this one branches from (shown under it), and the answer it depends on. */
  parent?: string;
  context?: string;
  /** Position in the chapter's fixed order (1-based, visible questions). */
  order: number;
  /** "Ask me later" allowed. */
  askLater: boolean;
  /** The section `intake.answer` writes to for this question's turn. */
  section: IntakeSectionId;
  prompt: string;
  why?: string;
  skipText: string;
  /** Questions of the chapter answered or asked later so far, and visible in total (children count). */
  progress: { answered: number; total: number };
  answer: QuestionAnswerShape;
  /** The call that records an answer: replace `<value>`. Skipping: the same with status 'skipped' and no value. */
  answerCall: { command: 'intake.answer'; input: { section: IntakeSectionId; answers: { turns: { values: Record<string, unknown>; status: Record<string, 'answered' | 'skipped'> } } } };
}

export interface NextIntakeQuestions {
  questions: IntakeQuestionView[];
  /** Chapter being asked (null when everything asked is answered or skipped). */
  chapter: ChapterId | null;
  progress: Array<{ chapter: ChapterId; answered: number; total: number }>;
  complete: boolean;
}

function shapeOf(q: Question, ctx: ReturnType<typeof flowContextOf>): QuestionAnswerShape {
  switch (q.kind) {
    case 'single':
      return { type: 'single', options: optionsOf(q, ctx).map((o) => ({ value: o.value, label: o.label, ...(o.examples ? { examples: o.examples } : {}) })), ...(q.defaultValue ? { defaultValue: q.defaultValue } : {}) };
    case 'multi':
      return {
        type: 'multi',
        options: optionsOf(q, ctx).map((o) => ({ value: o.value, label: o.label, ...(o.examples ? { examples: o.examples } : {}), ...(o.exclusive ? { exclusive: true } : {}) })),
        ...(q.required ? { required: true } : {}),
        ...(q.ranked ? { ranked: true } : {}),
        ...(q.otherLabel ? { otherLabel: q.otherLabel } : {}),
      };
    case 'number':
      return { type: 'number', min: q.min, max: q.max, step: q.step, ...(q.unit ? { unit: q.unit } : {}), presets: [...q.presets], ...(q.defaultValue !== undefined ? { defaultValue: q.defaultValue } : {}) };
    case 'custom':
      return { type: 'custom', widget: q.widget };
  }
}

/** The next unanswered questions (at most `limit`, from one chapter) for a section or chapter order. */
export function nextIntakeQuestions(now: string, section?: IntakeSectionId, limit = 3): NextIntakeQuestions {
  const doc = intakeDocNow();
  const sctx = intakeContextNow(doc, now);
  const fctx = flowContextOf(sctx);
  const only = section ? SECTION_CHAPTER[section] : null;
  const progress: NextIntakeQuestions['progress'] = [];
  let found: { chapter: ChapterId; qs: Question[] } | null = null;
  const contexts: Record<string, string> = {};
  const orders: Record<string, number> = {};
  for (const chapter of CHAPTERS) {
    if (only && chapter !== only) continue;
    // blood markers are answered through markers.* (and the Coach's own markers tools), not intake.answer
    if (chapter === 'markers') continue;
    // what is asked depends on the stored answers only; the live context is read as the screens stamp it
    const answers = stampContext(turnsOf(doc, chapter), fctx);
    const vis = visibleQuestions(CHAPTER_QUESTIONS[chapter], answers);
    vis.forEach((q, i) => {
      orders[`${chapter}.${q.id}`] = i + 1;
      const c = q.contextLine?.(answers.values, frozenContext(answers, fctx));
      if (c) contexts[`${chapter}.${q.id}`] = c;
    });
    progress.push({ chapter, answered: vis.filter((q) => isDone(answers, q.id)).length, total: vis.length });
    const pending = vis.filter((q) => !isDone(answers, q.id));
    if (!found && pending.length > 0 && !answers.skippedAll) found = { chapter, qs: pending };
  }
  const questions = (found?.qs ?? []).slice(0, limit).map<IntakeQuestionView>((q) => {
    const section = TURNS_SECTION[q.chapter];
    const qid = `${q.chapter}.${q.id}`;
    return {
      id: q.id,
      qid,
      chapter: q.chapter,
      ...(q.parent ? { parent: q.parent } : {}),
      ...(contexts[qid] ? { context: contexts[qid] } : {}),
      order: orders[qid] ?? 0,
      askLater: q.askLater !== false,
      section,
      prompt: q.prompt,
      ...(q.why ? { why: q.why } : {}),
      skipText: q.skipText,
      progress: progress.find((x) => x.chapter === q.chapter) ?? { answered: 0, total: 0 },
      answer: shapeOf(q, fctx),
      answerCall: { command: 'intake.answer', input: { section, answers: { turns: { values: { [q.id]: '<value>' }, status: { [q.id]: 'answered' } } } } },
    };
  });
  return { questions, chapter: found?.chapter ?? null, progress, complete: found === null };
}
