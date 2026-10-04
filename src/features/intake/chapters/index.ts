/**
 * The chapter registry (SUITE_SPEC §13.1): every chapter's question graph in its fixed order, with the parts other
 * packages add from their own files picked up when present:
 *   - `./food-kitchen.ts` (kitchen equipment, cuisines, staples, pantry pickers),
 *   - `./supplements.ts` (taking vs on hand),
 *   - `./markers.ts` + `./markersChapter.tsx` (the optional blood-markers chapter, between food and devices: questions in
 *     the first, lazy widgets in the second; `./markersDemo.ts` stays out of the glob so it never reaches production).
 * Each such module exports `INTAKE_PARTS: readonly ChapterPart[]` (and, for custom answer widgets,
 * `INTAKE_WIDGETS: Record<widgetId, Component>`). A part's questions are inserted after `after` (default: the end of
 * its chapter); `replaces` removes base questions (their stored answers stay and are no longer used).
 */
import type { ComponentType } from 'react';
import { SEED_SUPPLEMENTS } from '@/content/catalogues';
import { receiptOf, type Question } from '../flow';
import { ALL_CHAPTERS, type ChapterId } from '../types';
import { ACTIVITY_QUESTIONS } from './activity';
import { DEVICES_QUESTIONS } from './devices';
import { foodQuestions } from './food';
import { TRAINING_QUESTIONS } from './training';

export interface ChapterPart {
  chapter: ChapterId;
  /** Insert after this question id of the chapter (default: at the end). */
  after?: string;
  /** Base question ids this part takes over. */
  replaces?: readonly string[];
  questions: readonly Question[];
}

interface PartModule {
  INTAKE_PARTS?: readonly ChapterPart[];
  INTAKE_WIDGETS?: Readonly<Record<string, ComponentType<never>>>;
}

const modules = import.meta.glob<PartModule>(['./food-kitchen.ts', './supplements.ts', './markers.ts', './markersWidgets.ts'], { eager: true });

/** Parts and widgets registered by the other packages' chapter files (sorted by path, so the order is stable). */
const LOADED = Object.keys(modules)
  .sort()
  .map((k) => modules[k]!);
export const PART_WIDGETS: Readonly<Record<string, ComponentType<never>>> = Object.assign({}, ...LOADED.map((m) => m.INTAKE_WIDGETS ?? {}));

/** Supplement names for the "which do you take" receipt. */
const SUPPLEMENT_CHOICES = SEED_SUPPLEMENTS.map((s) => ({ id: s.id, name: s.name.replace(/ \(.*\)$/, ''), unit: s.dose.unit, dose: s.dose.amount ?? 1 }));

const BASE: Readonly<Record<ChapterId, readonly Question[]>> = {
  activity: ACTIVITY_QUESTIONS,
  training: TRAINING_QUESTIONS,
  food: foodQuestions(SUPPLEMENT_CHOICES),
  markers: [],
  devices: DEVICES_QUESTIONS,
};

/** Merge parts into a base graph (pure; exported for tests). */
export function mergeParts(base: readonly Question[], parts: readonly ChapterPart[]): Question[] {
  const drop = new Set(parts.flatMap((p) => p.replaces ?? []));
  let out = base.filter((q) => !drop.has(q.id));
  for (const p of parts) {
    const at = p.after ? out.findIndex((q) => q.id === p.after) : -1;
    out = at >= 0 ? [...out.slice(0, at + 1), ...p.questions, ...out.slice(at + 1)] : [...out, ...p.questions];
  }
  return out;
}

/**
 * A child without its own `contextLine` gets the generic chip: the parent's short name and its answer
 * ("work or study outside home · yes").
 */
export function withContextLines(qs: readonly Question[]): Question[] {
  return qs.map((q) => {
    if (!q.parent || q.contextLine) return q;
    const parent = qs.find((x) => x.id === q.parent);
    if (!parent) return q;
    return { ...q, contextLine: (values, ctx) => (values[parent.id] === undefined ? null : `${parent.short} · ${receiptOf(parent, values[parent.id], ctx)}`) };
  });
}

function build(): Record<ChapterId, readonly Question[]> {
  const parts = LOADED.flatMap((m) => m.INTAKE_PARTS ?? []);
  return Object.fromEntries(
    ALL_CHAPTERS.map((c) => [
      c,
      withContextLines(
        mergeParts(
          BASE[c],
          parts.filter((p) => p.chapter === c),
        ),
      ),
    ]),
  ) as unknown as Record<ChapterId, readonly Question[]>;
}

/** Every chapter's graph, in fixed order. */
export const CHAPTER_QUESTIONS: Readonly<Record<ChapterId, readonly Question[]>> = build();

/** The chapters shown, in order (a chapter with no questions — blood markers before its module lands — is left out). */
export const CHAPTERS: readonly ChapterId[] = ALL_CHAPTERS.filter((c) => CHAPTER_QUESTIONS[c].length > 0);
