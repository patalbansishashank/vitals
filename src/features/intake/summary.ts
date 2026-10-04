/** "What we'll use" (design §6.6) and the Body page's chapter lines: one plain line per chapter (pure). */
import { CHAPTER_QUESTIONS, CHAPTERS } from './chapters';
import { askedLater, isComplete, progress, receiptOf, usedValues, visibleQuestions, type FlowContext, type Question } from './flow';
import { D, SUMMARY, TURN } from './copy';
import { turnsOf } from './doc';
import { markersChapterLine } from './chapters/markers';
import { readMarkersDoc } from './chapters/markersStore';
import type { ChapterId, IntakeDoc } from './types';

/** Receipts of the named questions, in order, answered ones only. */
function picks(chapter: ChapterId, doc: IntakeDoc, ctx: FlowContext, ids: readonly string[]): string[] {
  const qs = CHAPTER_QUESTIONS[chapter];
  const a = turnsOf(doc, chapter);
  const v = usedValues(qs, a, ctx);
  const out: string[] = [];
  for (const id of ids) {
    const q = qs.find((x) => x.id === id) as Question | undefined;
    if (!q || v[id] === undefined || a.status[id] !== 'answered') continue;
    const text = receiptOf(q, v[id], ctx);
    if (text) out.push(text);
  }
  return out;
}

/** What the plans use for the named questions that were asked later (their "if you skip" text), as one phrase. */
function usingDefaults(chapter: ChapterId, doc: IntakeDoc, ctx: FlowContext, ids: readonly string[]): string | null {
  const qs = CHAPTER_QUESTIONS[chapter];
  const a = turnsOf(doc, chapter);
  const shown = new Set(askedLater(qs, a, ctx).map((q) => q.id));
  const texts = ids.flatMap((id) => {
    const q = qs.find((x) => x.id === id) as Question | undefined;
    return q && shown.has(id) && q.skipText ? [q.skipText] : [];
  });
  return texts.length ? TURN.usingLater(texts.join(', ')) : null;
}

export interface ChapterState {
  chapter: ChapterId;
  /** Questions answered or asked later / visible (children count). */
  done: number;
  total: number;
  complete: boolean;
  started: boolean;
  /** Questions asked later that still apply. */
  later: Question[];
}

export function chapterState(chapter: ChapterId, doc: IntakeDoc, ctx: FlowContext): ChapterState {
  const qs = CHAPTER_QUESTIONS[chapter];
  const a = turnsOf(doc, chapter);
  const p = progress(qs, { answers: a, reopened: null }, ctx);
  return { chapter, done: p.done, total: p.total, complete: isComplete(qs, a, ctx), started: Object.keys(a.status).length > 0, later: askedLater(qs, a, ctx) };
}

export function allChapterStates(doc: IntakeDoc, ctx: FlowContext): Record<ChapterId, ChapterState> {
  return Object.fromEntries(CHAPTERS.map((c) => [c, chapterState(c, doc, ctx)])) as Record<ChapterId, ChapterState>;
}

/** Questions asked later across chapters (the reminder chip's count). */
export function askedLaterCount(doc: IntakeDoc, ctx: FlowContext): number {
  return CHAPTERS.reduce((n, c) => n + chapterState(c, doc, ctx).later.length, 0);
}

/** The first chapter + question still waiting: unanswered first, then asked later. */
export function nextOpen(doc: IntakeDoc, ctx: FlowContext): { chapter: ChapterId; question?: Question } | null {
  for (const c of CHAPTERS) {
    const s = chapterState(c, doc, ctx);
    if (!s.complete) return { chapter: c };
  }
  for (const c of CHAPTERS) {
    const s = chapterState(c, doc, ctx);
    if (s.later.length) return { chapter: c, question: s.later[0] };
  }
  return null;
}

const LINE_QUESTIONS: Partial<Record<Exclude<ChapterId, 'devices'>, readonly string[]>> = {
  activity: ['job', 'workTime', 'stepsNumber', 'stepsRough', 'home', 'trainNow'],
  training: ['where', 'kit', 'time', 'wontDo', 'injuries'],
  food: ['eat', 'rules', 'cuisine', 'cooks', 'mealTime', 'supplements'],
};

/**
 * One line per chapter. Answers read as given; questions asked later read "using <default> · asked later" (§8), so a
 * chapter that was skipped still says what the plans use. Null only when the chapter was never touched.
 */
export function chapterLine(chapter: ChapterId, doc: IntakeDoc, ctx: FlowContext): string | null {
  // blood markers: E20's line from the markers document ("4 values · lipids, sugar"), else the chapter's turns
  if (chapter === 'markers') {
    const line = markersChapterLine(readMarkersDoc());
    if (line) return line;
  }
  const s = chapterState(chapter, doc, ctx);
  if (!s.started) return null;
  if (chapter === 'devices') {
    const d = doc.devices;
    if (!d || !d.has.length || d.has.includes('none')) return SUMMARY.devicesNone;
    const names = d.has.filter((x) => x !== 'none').map((x, i) => `${D.has.options[x]}${d.models[i] && d.models[i] !== D.which.notSure ? ` (${d.models[i]})` : ''}`);
    const inn = (d.streams ?? []).filter((p) => p.imported).map((p) => D.matrix.streams[p.stream]);
    const coach = (d.streams ?? []).filter((p) => p.coach !== 'hidden').length;
    return [names.join(', '), inn.length ? SUMMARY.streamsIn(inn.join(', ')) : SUMMARY.devicesNone.split(' · ')[1], coach ? SUMMARY.coachSome(coach) : SUMMARY.coachNothing].filter(Boolean).join(' · ');
  }
  if (chapter === 'food' && doc.diet && doc.diet.rulesComplete === false) return SUMMARY.foodUnset;
  // a chapter without a chosen set (blood markers, from its own module) reads its first answers in order
  const ids = LINE_QUESTIONS[chapter] ?? visibleQuestions(CHAPTER_QUESTIONS[chapter], turnsOf(doc, chapter), ctx).slice(0, 3).map((q) => q.id);
  const parts = [...picks(chapter, doc, ctx, ids), usingDefaults(chapter, doc, ctx, ids)].filter((x): x is string => Boolean(x));
  return parts.join(' · ') || null;
}
