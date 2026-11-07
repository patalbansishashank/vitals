/** "What we'll use" (design §6.6) and the Body page's chapter lines: one plain line per chapter (pure). */
import { CHAPTER_QUESTIONS, CHAPTERS } from './chapters';
import { askedLater, isComplete, progress, receiptOf, usedValues, visibleQuestions, type FlowContext, type Question } from './flow';
import { SUMMARY, T, TURN } from './copy';
import { turnsOf } from './doc';
import { groupReceipts, currentReadings, markersChapterLine } from './chapters/markers';
import { readMarkersDoc } from './chapters/markersStore';
import { rowsOfAnswer } from './chapters/supplements';
import { equipmentLabel, type KitValue, type TrainTimeValue } from './chapters/training';
import { doseText, supplementShortName } from '@/catalogues/supplements';
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
    // (r068 final M9) each answer names what it answers ("Cooking: I do"), so the line never reads as loose fragments
    // ("vegetarian (with dairy) · none · I do")
    const label = SUMMARY.labels[chapter]?.[id] ?? q.short;
    if (text) out.push(label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${text}` : text);
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

const LINE_QUESTIONS: Partial<Record<ChapterId, readonly string[]>> = {
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
  if (chapter === 'food' && doc.diet && doc.diet.rulesComplete === false) return SUMMARY.foodUnset;
  // a chapter without a chosen set (blood markers, from its own module) reads its first answers in order
  const ids = LINE_QUESTIONS[chapter] ?? visibleQuestions(CHAPTER_QUESTIONS[chapter], turnsOf(doc, chapter), ctx).slice(0, 3).map((q) => q.id);
  const parts = [...picks(chapter, doc, ctx, ids), usingDefaults(chapter, doc, ctx, ids)].filter((x): x is string => Boolean(x));
  return parts.join(' · ') || null;
}


/* ------------------------------------------------------------------------------------------- "What we'll use": the details */

export interface SummaryRow {
  /** Short name of the answer, from the question it answers. */
  label: string;
  /** The answer in plain words. */
  value: string;
  /** The question was asked later: the value is what the plans use meanwhile. */
  later?: boolean;
  /** The question this row answers (its deep-link anchor): the row opens it to change the answer. */
  anchor?: string;
}

export interface SummaryOptions {
  /** The maintenance headline for "a normal day" ("about 2 460 kcal a day — likely 2 150–2 780"); null in gentle mode. */
  energy?: string | null;
  dateStyle?: 'day-month' | 'month-day';
}

const R = SUMMARY.rows;

/** One answer as rows: most are one row (label + receipt); the equipment, the time and the supplements list are fuller. */
function rowsOf(chapter: ChapterId, q: Question, value: unknown, ctx: FlowContext, label: string): SummaryRow[] {
  if (chapter === 'training' && q.id === 'kit') {
    const k = (value ?? { owned: [], custom: [] }) as KitValue;
    const names = [...k.owned.filter((id) => id !== 'plates').map((id) => equipmentLabel(id)), ...k.custom];
    return [{ label, value: names.length ? names.join(', ') : T.kit.receiptNone }];
  }
  if (chapter === 'training' && q.id === 'time') {
    const t = value as TrainTimeValue;
    return [
      { label, value: `${t.days} a week, ${t.minutes} min each` },
      { label: R.timeOfDay, value: T.time.bestOptions[t.best] },
    ];
  }
  if (chapter === 'food' && q.id === 'taking') {
    const list = rowsOfAnswer(value);
    if (list.length) {
      return list.map((r) => ({
        label: supplementShortName(r),
        value: r.state === 'taking' ? doseText(r) || 'taking' : r.state === 'onHand' ? 'at home, not taking' : r.state === 'notForMe' ? 'not for me' : 'not said yet',
      }));
    }
  }
  const text = receiptOf(q, value, ctx);
  return text ? [{ label, value: text }] : [];
}

/** The answered (or asked-later) questions of a chapter, in order, one labelled row each. */
function answerRows(chapter: ChapterId, doc: IntakeDoc, ctx: FlowContext): SummaryRow[] {
  const qs = CHAPTER_QUESTIONS[chapter];
  const a = turnsOf(doc, chapter);
  const used = usedValues(qs, a, ctx);
  const rows: SummaryRow[] = [];
  for (const q of visibleQuestions(qs, a, ctx)) {
    const label = SUMMARY.labels[chapter]?.[q.id] ?? q.short;
    const anchor = q.anchor ?? q.id;
    const status = a.status[q.id];
    if (status === 'skipped') rows.push({ label, value: TURN.usingLater(q.skipText), later: true, anchor });
    else if (status === 'answered' && used[q.id] !== undefined) rows.push(...rowsOf(chapter, q, used[q.id], ctx, label).map((r) => ({ ...r, anchor })));
  }
  return rows;
}

function markerRows(opts: SummaryOptions): SummaryRow[] | null {
  const doc = readMarkersDoc();
  if (!doc || doc.chapter === null) return null;
  const readings = currentReadings(doc);
  const status = doc.chapter === 'skipped' ? (readings.length ? `${R.markersSkipped}; ${R.markersKept(readings.length)}` : R.markersSkipped) : readings.length ? R.markersSaved(readings.length) : R.markersNone;
  const rows: SummaryRow[] = [{ label: R.status, value: status }];
  for (const g of groupReceipts(readings, opts.dateStyle)) {
    rows.push({ label: g.label, value: `${g.values} · ${g.dateText}` });
  }
  return rows;
}

/**
 * "What we'll use", one part: a labelled row per answer, so each reads on its own ("steps · about 2 100 a day") instead of
 * one dense line, and opens its question to change it (the chapters keep no answers list of their own). Null when the
 * part was never touched. Labels come from the question each answer belongs to.
 */
export function chapterRows(chapter: ChapterId, doc: IntakeDoc, ctx: FlowContext, opts: SummaryOptions = {}): SummaryRow[] | null {
  if (chapter === 'markers') return markerRows(opts);
  if (!chapterState(chapter, doc, ctx).started) return null;
  const rows = answerRows(chapter, doc, ctx);
  if (chapter === 'food' && doc.diet && doc.diet.rulesComplete === false) rows.unshift({ label: R.recipes, value: R.recipesPaused });
  if (chapter === 'activity' && opts.energy) rows.push({ label: R.energy, value: opts.energy });
  return rows;
}
