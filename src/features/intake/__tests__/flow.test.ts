/** The intake state machine (flow.ts): asking order, branching, skips, "change", "not used", progress. */
import { describe, expect, it } from 'vitest';
import { ACTIVITY_QUESTIONS } from '../chapters/activity';
import { FOOD_QUESTIONS } from '../chapters/food';
import {
  DEFAULT_CONTEXT,
  activeQuestion,
  askedLater,
  cancelReopen,
  commit,
  initialFlow,
  isComplete,
  multiReceipt,
  notUsed,
  progress,
  questionByAnchor,
  receiptOf,
  receipts,
  reopen,
  skip,
  skipChapter,
  usedValues,
  visibleQuestions,
  type FlowState,
  type MultiQuestion,
} from '../flow';

const ctx = DEFAULT_CONTEXT;
const qs = ACTIVITY_QUESTIONS;
const ids = (list: Array<{ id: string }>) => list.map((q) => q.id);
const answer = (s: FlowState, pairs: Array<[string, unknown]>) => pairs.reduce((acc, [id, v]) => commit(acc, id, v), s);

describe('asking order and branching', () => {
  it('starts with the first question and walks forward one at a time', () => {
    let s = initialFlow();
    expect(activeQuestion(qs, s, ctx)?.id).toBe('work');
    s = commit(s, 'work', 'yes');
    expect(activeQuestion(qs, s, ctx)?.id).toBe('job');
    s = commit(s, 'job', 'desk');
    expect(activeQuestion(qs, s, ctx)?.id).toBe('workTime');
    expect(ids(receipts(qs, s, ctx))).toEqual(['work', 'job']);
  });

  it('"not working" skips the work-day questions entirely', () => {
    const s = commit(initialFlow(), 'work', 'no');
    const vis = ids(visibleQuestions(qs, s.answers, ctx));
    expect(vis).not.toContain('job');
    expect(vis).not.toContain('workTime');
    expect(vis).not.toContain('commute');
    expect(activeQuestion(qs, s, ctx)?.id).toBe('stepsKnown');
  });

  it('follow-ups appear only when their answer asks for them (and chains collapse with their root)', () => {
    let s = answer(initialFlow(), [
      ['work', 'yes'],
      ['job', 'mixed'],
      ['workTime', { days: 5, hours: 8 }],
      ['commute', 'walk'],
    ]);
    expect(activeQuestion(qs, s, ctx)?.id).toBe('commuteMin');
    s = commit(s, 'commuteMin', 30);
    s = commit(s, 'stepsKnown', 'phone');
    expect(activeQuestion(qs, s, ctx)?.id).toBe('stepsNumber');
    s = commit(s, 'stepsNumber', { mean: 6000 });
    expect(activeQuestion(qs, s, ctx)?.id).toBe('phoneCarried');
    // changing the root (work → no) drops the commute branch from what is asked and used
    s = commit(s, 'work', 'no');
    expect(ids(visibleQuestions(qs, s.answers, ctx))).not.toContain('commuteMin');
    expect(usedValues(qs, s.answers, ctx).commuteMin).toBeUndefined();
  });
});

describe('ask me later, change, not used', () => {
  it('"ask me later" records a skip, drops any value and moves on', () => {
    let s = commit(initialFlow(), 'work', 'yes');
    s = commit(s, 'job', 'desk');
    s = reopen(s, 'job');
    expect(activeQuestion(qs, s, ctx)?.id).toBe('job');
    s = skip(s, 'job');
    expect(s.answers.status.job).toBe('skipped');
    expect(s.answers.values.job).toBeUndefined();
    expect(s.reopened).toBeNull();
    expect(askedLater(qs, s.answers, ctx).map((q) => q.id)).toEqual(['job']);
  });

  it('"change" reopens a receipt in place; Esc (cancel) returns to the next open question', () => {
    let s = answer(initialFlow(), [
      ['work', 'yes'],
      ['job', 'desk'],
    ]);
    s = reopen(s, 'work');
    expect(activeQuestion(qs, s, ctx)?.id).toBe('work');
    s = cancelReopen(s);
    expect(activeQuestion(qs, s, ctx)?.id).toBe('workTime');
  });

  it('answers that no longer apply are kept and reported as not used (never silently deleted)', () => {
    let s = answer(initialFlow(), [
      ['work', 'yes'],
      ['job', 'onFeet'],
    ]);
    s = commit(s, 'work', 'no');
    expect(s.answers.values.job).toBe('onFeet');
    expect(notUsed(qs, s.answers, ctx)).toEqual(['job']);
    // and they come back when the branch reopens
    s = commit(s, 'work', 'yes');
    expect(notUsed(qs, s.answers, ctx)).toEqual([]);
    expect(usedValues(qs, s.answers, ctx).job).toBe('onFeet');
  });
});

describe('skip this part, completeness, progress', () => {
  it('"Skip this part" skips every open question (re-evaluating branches) and keeps given answers', () => {
    const s0 = commit(initialFlow(), 'work', 'no');
    const s = skipChapter(qs, s0, ctx);
    expect(s.answers.skippedAll).toBe(true);
    expect(s.answers.values.work).toBe('no');
    expect(isComplete(qs, s.answers, ctx)).toBe(true);
    // follow-ups whose roots were skipped are not asked
    expect(s.answers.status.stepsNumber).toBeUndefined();
    expect(s.answers.status.sleep).toBe('skipped');
  });

  it('progress = answered (incl. asked later) ÷ visible questions, per question; children count (v3)', () => {
    let s = initialFlow();
    // children are not visible until their parent is answered
    expect(progress(qs, s, ctx)).toMatchObject({ done: 0, total: 9, position: 1 });
    s = answer(s, [
      ['work', 'yes'],
      ['job', 'desk'],
    ]);
    // job, workTime and commute are now visible under work
    expect(progress(qs, s, ctx)).toMatchObject({ done: 2, total: 12, position: 3 });
    s = answer(s, [
      ['workTime', { days: 5, hours: 8 }],
      ['commute', 'cycle'],
    ]);
    // the commute-minutes child is asked next, in its own position
    expect(activeQuestion(qs, s, ctx)?.id).toBe('commuteMin');
    expect(progress(qs, s, ctx)).toMatchObject({ done: 4, total: 13, position: 5 });
    s = skip(s, 'commuteMin');
    expect(progress(qs, s, ctx)).toMatchObject({ done: 5, skipped: 1 });
    s = commit(initialFlow(), 'work', 'no');
    expect(progress(qs, s, ctx).total).toBe(9);
  });

  it('deep-link anchors name questions', () => {
    expect(questionByAnchor(qs, 'steps')?.id).toBe('stepsKnown');
    expect(questionByAnchor(qs, 'sleep')?.id).toBe('sleep');
    expect(questionByAnchor(qs, 'job')?.id).toBe('job');
  });
});

describe('receipts', () => {
  it('reads single, number and multi answers back in plain words', () => {
    const job = qs.find((q) => q.id === 'job')!;
    expect(receiptOf(job, 'desk', ctx)).toBe('desk or driving');
    const rough = qs.find((q) => q.id === 'stepsRough')!;
    expect(receiptOf(rough, 7000, ctx)).toMatch(/about 7.000 a day/);
    const allergies = FOOD_QUESTIONS.find((q) => q.id === 'allergies') as MultiQuestion;
    expect(multiReceipt(allergies, ['peanut', 'text:jackfruit'], ctx)).toBe('peanut, jackfruit');
  });
});
