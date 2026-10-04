/** The summary lines (design §6.6, §8): a skipped chapter says what the plans use; deferred questions point to Your setup. */
import { describe, expect, it } from 'vitest';
import { CHAPTER_QUESTIONS } from '../chapters';
import { SUMMARY, TURN } from '../copy';
import { DEFAULT_CONTEXT, skipChapter, type FlowState } from '../flow';
import { chapterLine } from '../summary';
import { EMPTY_INTAKE, type IntakeDoc } from '../types';

const ctx = DEFAULT_CONTEXT;

function docWithTraining(turns: object): IntakeDoc {
  return { ...EMPTY_INTAKE, training: { turns } } as unknown as IntakeDoc;
}

describe('chapterLine', () => {
  it('is null for a chapter nobody has touched', () => {
    expect(chapterLine('training', EMPTY_INTAKE, ctx)).toBeNull();
  });

  it('says what the plans use for a skipped chapter, marked as asked later', () => {
    const start: FlowState = { answers: { values: {}, status: {} }, reopened: null };
    const skipped = skipChapter(CHAPTER_QUESTIONS.training, start, ctx);
    const line = chapterLine('training', docWithTraining(skipped.answers), ctx);
    expect(line).not.toBeNull();
    expect(line).toMatch(/^using .* · asked later$/);
    expect(line).not.toBe(SUMMARY.notAnswered);
    expect(TURN.usingLater('x')).toBe('using x · asked later');
  });

  it('counts asked-later questions in plain words (the row is hidden when there are none)', () => {
    expect(SUMMARY.askedLaterValue(3)).toBe('3 questions');
    expect(SUMMARY.askedLaterValue(1)).toBe('1 question');
  });
});
