/**
 * The food chapter's kitchen questions for intake v3 (design/screens/onboarding-intake-v3.md §6.1 F5, F7, F7b, F7c;
 * docs/SUITE_SPEC.md §13.1 and §13.3): cuisines, cooking equipment, staples and what is in the kitchen now, each
 * answered with the catalogue picker. `commitKitchenAnswer` turns a picker answer into the command to dispatch
 * (`kitchen.set` for the first three, `pantry.add` replacing the whole list for the pantry), so the flow can commit it.
 *
 * Orders (unique within the food chapter): cuisines 50 (after the diet questions), equipment 70, staples 71,
 * pantry 72 (the kitchen block closes the chapter, before supplements).
 */
import { lazy, type ComponentType } from 'react';
import type { KitchenKind } from '@/catalogues/kitchen';
import type { PickerValue } from '@/features/components/PickerTypes';
import { pickerToKitchenInput, pickerToPantryInput } from '@/features/components/pickerValue';
import { kitchenNow } from '@/content/catalogues/kitchenCatalogue';
import type { IntakeSectionId } from '../types';
import type { ChapterPart } from './index';

// The package's own description of its four picker questions (SUITE_SPEC §13.1 field names); `INTAKE_PARTS` below
// turns them into the flow's `Question` shape.
export type QuestionId = string;
export type Answers = Readonly<Record<QuestionId, unknown>>;
export type ChapterIdV3 = 'activity' | 'training' | 'food' | 'markers' | 'devices';
export interface AnswerOption {
  value: string;
  label: string;
}
export type AnswerSpec =
  | { kind: 'single'; options: AnswerOption[] }
  | { kind: 'multi'; options: AnswerOption[]; ranked?: boolean; otherLabel?: string }
  | { kind: 'number'; min: number; max: number; step: number; unit?: string }
  | { kind: 'measure'; units: string[]; methods: string[] }
  | { kind: 'custom'; widget: string };
export interface QuestionV3 {
  id: QuestionId;
  chapter: ChapterIdV3;
  section: IntakeSectionId | 'markers';
  order: number;
  parent?: QuestionId;
  condition?: (a: Answers) => boolean;
  text: string;
  contextLine?: (a: Answers) => string | null;
  answer: AnswerSpec;
  askLater: boolean;
  skipText: string;
  short: string;
  why?: string;
  anchor?: string;
}

/** A kitchen question: the picker kind it opens, and (pantry) the optional framing with "Skip this list". */
export interface KitchenQuestion extends QuestionV3 {
  answer: { kind: 'custom'; widget: `cataloguePicker:${KitchenKind}` };
  pickerKind: KitchenKind;
  /** F7c: optional framing above the picker; the footer reads "Skip this list" and skipping counts as answered. */
  pantryOptional?: true;
  /** What a skip records as the answer ("skipped, by choice": answered, never asked again). */
  skipAnswer?: 'skipped';
}

export type KitchenQuestionId = 'food.cuisines' | 'food.equipment' | 'food.staples' | 'food.pantry';

const picker = (kind: KitchenKind) => ({ kind: 'custom', widget: `cataloguePicker:${kind}` }) as const;

export const KITCHEN_QUESTIONS: readonly KitchenQuestion[] = [
  {
    id: 'food.cuisines',
    chapter: 'food',
    section: 'diet',
    order: 50,
    text: 'Which cuisines do you cook or eat most often?',
    answer: picker('cuisines'),
    pickerKind: 'cuisines',
    askLater: true,
    skipText: 'set by your region',
    short: 'cuisines',
    why: 'Recipes come from the food you already eat, starting with the cuisine you tap first.',
  },
  {
    id: 'food.equipment',
    chapter: 'food',
    section: 'kitchen',
    order: 70,
    text: 'What cooking equipment do you have in your kitchen?',
    answer: picker('equipment'),
    pickerKind: 'equipment',
    askLater: true,
    skipText: 'set by your region',
    short: 'equipment',
    why: 'Recipes only ask for a pressure cooker, an oven or a blender when you have one.',
  },
  {
    id: 'food.staples',
    chapter: 'food',
    section: 'diet',
    order: 71,
    text: 'Which staples do you keep and cook with most?',
    answer: picker('staples'),
    pickerKind: 'staples',
    askLater: true,
    skipText: 'set by your region',
    short: 'staples',
    why: 'Meals are built around the grains, pulses and oils you buy anyway.',
  },
  {
    id: 'food.pantry',
    chapter: 'food',
    section: 'kitchen',
    order: 72,
    text: 'What’s in your kitchen right now?',
    answer: picker('pantry'),
    pickerKind: 'pantry',
    askLater: true,
    skipText: 'skipped, by choice',
    short: 'in the kitchen now',
    why: 'Recipes can use what is already at home, so less goes to waste.',
    pantryOptional: true,
    skipAnswer: 'skipped',
  },
];

/** The command that saves one picker answer (dispatch it with this literal id; the inputs are whole lists). */
export type KitchenCommit = { commandId: 'kitchen.set'; input: Record<string, unknown> } | { commandId: 'pantry.add'; input: ReturnType<typeof pickerToPantryInput> };

export function commitKitchenAnswer(questionId: KitchenQuestionId | string, value: PickerValue): KitchenCommit | null {
  switch (questionId) {
    case 'food.cuisines':
      return { commandId: 'kitchen.set', input: pickerToKitchenInput('cuisines', value) };
    case 'food.equipment':
      return { commandId: 'kitchen.set', input: pickerToKitchenInput('equipment', value) };
    case 'food.staples':
      return { commandId: 'kitchen.set', input: pickerToKitchenInput('staples', value) };
    case 'food.pantry':
      return { commandId: 'pantry.add', input: pickerToPantryInput(value) };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------------------
 * The chapter-part contract of the intake v3 registry (`chapters/index.ts` on E16): `INTAKE_PARTS` and
 * `INTAKE_WIDGETS`, typed by E16's `ChapterPart` (`./index.ts`).
 */

/** The four picker questions as one part of the food chapter: after "who cooks", replacing the v0.2 kitchen turns. */
export const INTAKE_PARTS: readonly ChapterPart[] = [
  {
    chapter: 'food',
    after: 'cooks',
    replaces: ['kitchen', 'staples', 'pantry', 'cuisine'],
    questions: KITCHEN_QUESTIONS.map((q) => ({
      id: q.id,
      chapter: 'food' as const,
      section: q.section as IntakeSectionId,
      kind: 'custom' as const,
      widget: q.answer.widget,
      anchor: q.pickerKind,
      prompt: q.text,
      ...(q.why ? { why: q.why } : {}),
      skipText: q.skipText,
      short: q.short,
      askLater: q.askLater,
      receipt: (v: unknown) => pickerReceipt(v, q.skipText, q.pantryOptional ? q.skipText : 'none'),
    })),
  },
];

/** Catalogue id → words when the entry carries no label ("eq.pressure_cooker_medium" → "pressure cooker medium"). */
const idWords = (id: string): string => id.replace(/^[a-z]+\./, '').replace(/[_-]+/g, ' ').trim();

/**
 * The answered-list line of a picker answer: the first few items by name, then a count; never the raw entries. An
 * empty list reads `empty` ("none"; the optional pantry's "Skip this list" commits an empty list: "skipped, by choice").
 */
export function pickerReceipt(value: unknown, skipText: string, empty = 'none'): string {
  if (value === 'skipped') return skipText;
  if (!Array.isArray(value)) return '';
  const text = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
  // the person's words, else the catalogue name stored at Done, else the catalogue's (when loaded), else the id's words
  const names = (value as PickerValue)
    .map((e) => text(e?.label) || text(e?.name) || (typeof e?.id === 'string' ? (kitchenNow()?.cat.get(e.id)?.label ?? idWords(e.id)) : ''))
    .filter(Boolean);
  if (!names.length) return empty;
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

/** Custom answer widgets of the part, by widget id. */
// lazy: the picker dispatches commands and loads the catalogue, so the registry (read by Your body, the summary and the
// Coach's intake view) must not pull it in; the QuestionCard renders widgets under Suspense
const Picker = lazy(() => import('@/features/components/PickerIntakeWidget').then((m) => ({ default: m.PickerIntakeWidget })));
export const INTAKE_WIDGETS: Readonly<Record<string, ComponentType<never>>> = {
  'cataloguePicker:equipment': Picker as ComponentType<never>,
  'cataloguePicker:cuisines': Picker as ComponentType<never>,
  'cataloguePicker:staples': Picker as ComponentType<never>,
  'cataloguePicker:pantry': Picker as ComponentType<never>,
};
