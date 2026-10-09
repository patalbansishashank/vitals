/**
 * The intake's question graph and its state machine (pure; docs/SUITE_SPEC.md §13.1, design/screens/onboarding-intake-v3.md).
 *
 * A chapter is a list of questions in a FIXED order. Whether a question is asked depends only on the stored answers
 * (`applies` reads earlier answers and the `meta.*` answers stamped at chapter entry, never live context), so the open
 * question — the first visible one with neither an answer nor "ask me later" (`firstOpen`) — is the same on every
 * render, after leaving and returning, after a reload and on the Body page. A child (`parent`) is shown directly under
 * its parent and only while the parent is visible and answered. Change re-asks one question: answers that no longer
 * apply are kept and reported as "not used" (never deleted); children that newly apply become open and are asked next.
 */
import type { ChapterAnswers, ChapterId, IntakeSectionId } from './types';

/** What the flow knows besides the answers (locale, device answers from other chapters, safety, gentle mode). */
export interface FlowContext {
  /** India locale: Indian examples first, ₹, Indian kitchen defaults. */
  india: boolean;
  /** Gentle mode (safety): maintenance without kcal by default, alcohol not asked. */
  gentle: boolean;
  /** A step-counting device was named in the devices chapter (walking commute minutes are not added again). */
  stepDevice: boolean;
}

export const DEFAULT_CONTEXT: FlowContext = { india: false, gentle: false, stepDevice: false };

export interface AnswerOption<V extends string = string> {
  value: V;
  label: string;
  /** Examples are part of the accessible name ("sitting at a desk or driving — for example office, driving"). */
  examples?: string;
  /** Picking it clears the others (multi: "none"). */
  exclusive?: boolean;
}

interface QuestionBase {
  id: string;
  chapter: ChapterId;
  section: IntakeSectionId;
  /** Deep-link anchor (`/onboarding/activity#steps`). */
  anchor?: string;
  prompt: string;
  /** "why we ask": one or two sentences naming what the answer changes. */
  why?: string;
  /** "if you skip: …" — the default the answer takes when skipped. */
  skipText: string;
  /** Short name for the receipt and the live region ("on a workday"). */
  short: string;
  /** The question this one branches from: shown indented under it, asked only once it is answered. */
  parent?: string;
  /**
   * The parent answer this question depends on, shown above the prompt as a chip ("because you said: …"). Every child
   * has one (tested). Reads the answers only.
   */
  contextLine?: (values: Readonly<Record<string, unknown>>, ctx: FlowContext) => string | null;
  /** "Ask me later" allowed (default true; false only for gating questions). */
  askLater?: boolean;
  /**
   * PURE: whether the question is asked, from the answers of questions before it and the `meta.*` answers (`ctx` here
   * is always `frozenContext(answers)`, never the live environment).
   */
  applies?: (values: Readonly<Record<string, unknown>>, ctx: FlowContext) => boolean;
  /** Receipt answer text (default: the option label(s) or the number). */
  receipt?: (value: unknown, ctx: FlowContext) => string;
}

/** Options may depend on the context (₹ or $, cuisines sorted by region). */
export type Options = ReadonlyArray<AnswerOption> | ((ctx: FlowContext) => ReadonlyArray<AnswerOption>);

export interface SingleQuestion extends QuestionBase {
  kind: 'single';
  options: Options;
  /** Cards with examples stack one per row on mobile. */
  cards?: boolean;
  /** Option value the skip default corresponds to (tagged "default", never preselected). */
  defaultValue?: string;
}

export interface MultiQuestion extends QuestionBase {
  kind: 'multi';
  options: Options;
  /** Options ticked when the turn opens (locale kitchen defaults); still a choice, committed with Done. */
  initial?: (values: Readonly<Record<string, unknown>>, ctx: FlowContext) => string[];
  /** Tap order matters (ranked cuisines). */
  ranked?: boolean;
  /** Free text "other" field label (kept as typed, stored as `text:<what was typed>`). */
  otherLabel?: string;
  /** At least one pick (or "other") before Done; "none" counts only when picked. */
  required?: boolean;
}

/** Prefix of free-text entries in a multi answer. */
export const TEXT_PREFIX = 'text:';
export const isTextEntry = (v: string): boolean => v.startsWith(TEXT_PREFIX);
export const textOf = (v: string): string => v.slice(TEXT_PREFIX.length);

export function optionsOf(q: SingleQuestion | MultiQuestion, ctx: FlowContext): ReadonlyArray<AnswerOption> {
  return typeof q.options === 'function' ? q.options(ctx) : q.options;
}

/** The receipt's answer text for any question. */
export function receiptOf(q: Question, value: unknown, ctx: FlowContext): string {
  if (q.receipt) return q.receipt(value, ctx);
  if (q.kind === 'multi') return multiReceipt(q, value, ctx);
  if (q.kind === 'single') return optionsOf(q, ctx).find((o) => o.value === value)?.label ?? String(value);
  if (q.kind === 'number') return q.presetLabel ? q.presetLabel(Number(value)) : String(value);
  return String(value);
}

/** Receipt text of a multi answer: option labels (in answer order) and typed entries verbatim. */
export function multiReceipt(q: MultiQuestion, value: unknown, ctx: FlowContext): string {
  const list = Array.isArray(value) ? (value as string[]) : [];
  const opts = optionsOf(q, ctx);
  return list.map((v) => (isTextEntry(v) ? textOf(v) : (opts.find((o) => o.value === v)?.label ?? v))).join(', ');
}

export interface NumberQuestion extends QuestionBase {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Accessible name of the stepper ("steps a day"). */
  name: string;
  presets: readonly number[];
  presetLabel?: (n: number) => string;
  defaultValue?: number;
}

/** Composite turns (work days × hours, step numbers, sport rows, willingness bank …) rendered by a chapter widget. */
export interface CustomQuestion extends QuestionBase {
  kind: 'custom';
  widget: string;
  /**
   * The widget brings its own keys (the markers table's "Save 6 values"): they take Next's place in the card's one
   * footer (`CardFootSlot`), so the card never shows two footers or two disabled reasons.
   */
  ownFooter?: boolean;
  /**
   * A card with nothing to answer (a computed card such as how each device's data arrives): Next is always enabled and
   * records this value, so the person just moves on.
   */
  advance?: unknown;
}

export type Question = SingleQuestion | MultiQuestion | NumberQuestion | CustomQuestion;

/* ------------------------------------------------------------------------------------------- context as answers */

/**
 * Locale, gentle mode and "a step device was named" are written into the chapter's answers at chapter entry
 * (`meta.*`, no status), so what is asked depends on nothing but the stored answers (§13.1 invariant).
 */
export const META = { india: 'meta.india', gentle: 'meta.gentle', stepDevice: 'meta.stepDevice' } as const;

/** The flow context the answers carry (falls back to `live` for a key never stamped, e.g. a chapter not yet entered). */
export function frozenContext(a: ChapterAnswers, live: FlowContext = DEFAULT_CONTEXT): FlowContext {
  const b = (k: string, d: boolean) => (typeof a.values[k] === 'boolean' ? (a.values[k] as boolean) : d);
  return { india: b(META.india, live.india), gentle: b(META.gentle, live.gentle), stepDevice: b(META.stepDevice, live.stepDevice) };
}

/** The answers with the live context stamped in; the same object when nothing changes. */
export function stampContext(a: ChapterAnswers, live: FlowContext): ChapterAnswers {
  const want: Record<string, boolean> = { [META.india]: live.india, [META.gentle]: live.gentle, [META.stepDevice]: live.stepDevice };
  if (Object.entries(want).every(([k, v]) => a.values[k] === v)) return a;
  return { ...a, values: { ...a.values, ...want } };
}

/* ------------------------------------------------------------------------------------------- state machine */

export interface FlowState {
  answers: ChapterAnswers;
  /** A question opened in change mode (Change on a row, or Back); null = the first open question. UI state only. */
  reopened: string | null;
}

const copyAnswers = (a: ChapterAnswers): ChapterAnswers => ({
  values: { ...a.values },
  status: { ...a.status },
  ...(a.order ? { order: [...a.order] } : {}),
  ...(a.skippedAll ? { skippedAll: true } : {}),
});

export const initialFlow = (answers?: ChapterAnswers): FlowState => ({ answers: answers ? copyAnswers(answers) : { values: {}, status: {} }, reopened: null });

export function applies(q: Question, values: Readonly<Record<string, unknown>>, ctx: FlowContext): boolean {
  return q.applies ? q.applies(values, ctx) : true;
}

export const isDone = (a: ChapterAnswers, id: string): boolean => a.status[id] !== undefined;

/**
 * Questions asked given the answers, in fixed order. Each question sees only the answers of questions asked before it
 * (plus the `meta.*` answers), so a chain of children collapses as soon as its root no longer applies; a child is
 * visible only while its parent is visible and answered.
 */
export function visibleQuestions(qs: readonly Question[], a: ChapterAnswers, live?: FlowContext): Question[] {
  return walk(qs, a, live).asked;
}

/**
 * `live` only fills `meta.*` keys a chapter never had stamped (documents from before v3); once the screen or the Coach
 * has stamped them, the answers alone decide.
 */
function walk(qs: readonly Question[], a: ChapterAnswers, live: FlowContext = DEFAULT_CONTEXT): { asked: Question[]; used: Record<string, unknown> } {
  const ctx = frozenContext(a, live);
  const used: Record<string, unknown> = {};
  for (const k of Object.values(META)) if (a.values[k] !== undefined) used[k] = a.values[k];
  const asked: Question[] = [];
  const shown = new Set<string>();
  for (const q of qs) {
    if (q.parent && (!shown.has(q.parent) || a.status[q.parent] !== 'answered')) continue;
    if (!applies(q, used, ctx)) continue;
    asked.push(q);
    shown.add(q.id);
    if (a.values[q.id] !== undefined) used[q.id] = a.values[q.id];
  }
  return { asked, used };
}

/** The open question: the first visible one with neither an answer nor "ask me later"; null = chapter complete. */
export function firstOpen(qs: readonly Question[], a: ChapterAnswers, live?: FlowContext): Question | null {
  return walk(qs, a, live).asked.find((q) => !isDone(a, q.id)) ?? null;
}

/** The card shown: a question open in change mode, else `firstOpen`. */
export function activeQuestion(qs: readonly Question[], s: FlowState, live?: FlowContext): Question | null {
  if (s.reopened) {
    const r = visibleQuestions(qs, s.answers, live).find((q) => q.id === s.reopened);
    if (r) return r;
  }
  return firstOpen(qs, s.answers, live);
}

/** Answered or asked-later questions, in order (the answered list's rows). */
export function receipts(qs: readonly Question[], s: FlowState, live?: FlowContext): Question[] {
  return visibleQuestions(qs, s.answers, live).filter((q) => isDone(s.answers, q.id));
}

/** The question Back opens: the visible question before the card shown (the last one when the chapter is done). */
export function backTarget(qs: readonly Question[], s: FlowState, live?: FlowContext): Question | null {
  const vis = visibleQuestions(qs, s.answers, live);
  const cur = activeQuestion(qs, s, live);
  const i = cur ? vis.indexOf(cur) : vis.length;
  return i > 0 ? vis[i - 1]! : null;
}

/** Back: the previous visible question opens in change mode; nothing is erased. */
export function back(qs: readonly Question[], s: FlowState, live?: FlowContext): FlowState {
  const t = backTarget(qs, s, live);
  return t ? { ...s, reopened: t.id } : s;
}

const withOrder = (a: ChapterAnswers, id: string): string[] => [...(a.order ?? []).filter((x) => x !== id), id];

/** Next / a one-tap answer: store the value (closes change mode; the next card is `firstOpen`). */
export function commit(s: FlowState, id: string, value: unknown): FlowState {
  return {
    answers: { ...s.answers, values: { ...s.answers.values, [id]: value }, status: { ...s.answers.status, [id]: 'answered' }, order: withOrder(s.answers, id) },
    reopened: null,
  };
}

/** "Ask me later": record it; the shown default applies (the value is dropped so nothing stale is used). */
export function skip(s: FlowState, id: string): FlowState {
  const values = { ...s.answers.values };
  delete values[id];
  return { answers: { ...s.answers, values, status: { ...s.answers.status, [id]: 'skipped' }, order: withOrder(s.answers, id) }, reopened: null };
}

export function reopen(s: FlowState, id: string): FlowState {
  return { ...s, reopened: id };
}

export function cancelReopen(s: FlowState): FlowState {
  return { ...s, reopened: null };
}

/** "Skip this part": every visible, unanswered question becomes "asked later" (defaults apply); answers given stay. */
export function skipChapter(qs: readonly Question[], s: FlowState, live?: FlowContext): FlowState {
  let next: FlowState = { answers: { ...s.answers, skippedAll: true }, reopened: null };
  // walk forward: a skip can change what is asked next, so re-evaluate after each one
  for (let guard = 0; guard < qs.length + 1; guard++) {
    const q = firstOpen(qs, next.answers, live);
    if (!q) break;
    next = skip(next, q.id);
    next.answers.skippedAll = true;
  }
  return next;
}

export interface Progress {
  /** Visible questions answered or asked later (children count). */
  done: number;
  /** Visible questions given the answers so far. */
  total: number;
  /** Of `done`, how many were asked later. */
  skipped: number;
  /** Position of the card shown among the visible questions, 1-based (total + 1 when complete). */
  position: number;
}

/** Progress = answered (incl. asked later) ÷ visible questions, per question (§13.1). */
export function progress(qs: readonly Question[], s: FlowState, live?: FlowContext): Progress {
  const vis = visibleQuestions(qs, s.answers, live);
  const done = vis.filter((q) => isDone(s.answers, q.id));
  const act = activeQuestion(qs, s, live);
  return { done: done.length, total: vis.length, skipped: done.filter((q) => s.answers.status[q.id] === 'skipped').length, position: act ? vis.indexOf(act) + 1 : vis.length + 1 };
}

/** Answers kept for questions that no longer apply (shown as "not used"). */
export function notUsed(qs: readonly Question[], a: ChapterAnswers, live?: FlowContext): string[] {
  const vis = new Set(visibleQuestions(qs, a, live).map((q) => q.id));
  return qs.filter((q) => !vis.has(q.id) && a.values[q.id] !== undefined).map((q) => q.id);
}

/** Questions asked later that still apply — the reminder chip's count. */
export function askedLater(qs: readonly Question[], a: ChapterAnswers, live?: FlowContext): Question[] {
  return visibleQuestions(qs, a, live).filter((q) => a.status[q.id] === 'skipped');
}

export const isComplete = (qs: readonly Question[], a: ChapterAnswers, live?: FlowContext): boolean => firstOpen(qs, a, live) === null;

/** The values a reducer should read: only questions that apply (answers to questions no longer asked are ignored). */
export function usedValues(qs: readonly Question[], a: ChapterAnswers, live?: FlowContext): Record<string, unknown> {
  const { used } = walk(qs, a, live);
  for (const k of Object.values(META)) delete used[k];
  return used;
}

/** The question a deep-link anchor names. */
export function questionByAnchor(qs: readonly Question[], anchor: string): Question | undefined {
  return qs.find((q) => q.anchor === anchor || q.id === anchor);
}

/** Depth in the parent tree (0 = top level), for the answered list's indent. */
export function depthOf(qs: readonly Question[], q: Question): number {
  let d = 0;
  let p = q.parent;
  while (p && d < 8) {
    d++;
    p = qs.find((x) => x.id === p)?.parent;
  }
  return d;
}
