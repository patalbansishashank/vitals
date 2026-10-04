/**
 * Supplements questions (SUITE_SPEC §13.2; design/screens/onboarding-intake-v3.md §6.2 S1, S2): "Do you take
 * supplements now, or have some at home?" and, for either of the first two answers, "Which supplements do you take or
 * have at home?" with one dose row (`SupplementRow`) per item.
 *
 * `supplementQuestions()` gives the two questions in the v3 `Question` shape (ids `supplements` and `taking`, so stored
 * answers keep working; `taking` is a child of `supplements` with its context line). `chapters/food.ts` places them in
 * the food chapter's fixed order, where the base graph had them, so no `INTAKE_PARTS` replacement is needed.
 *
 * Answers: the stance is one of `taking | onHand | open | food_first`; the list answer is `SupplementRow[]`. The old
 * list answer (`{ supplementId, dose, unit, time }[]`, written by "I already take some") reads as taking rows.
 */
import {
  SUPPLEMENT_STANCES,
  TIMES_OF_DAY,
  doseText,
  rowsIn,
  supplementShortName,
  validateDose,
  type SupplementRow,
  type SupplementStance,
  type SupplementsSectionV2,
  type TimeOfDay,
} from '@/catalogues/supplements';
import type { CustomQuestion, SingleQuestion } from '../flow';

export const SUPPLEMENTS_COPY = {
  stance: {
    prompt: 'Do you take supplements now, or have some at home?',
    short: 'supplements',
    skip: 'food first',
    why: 'Supplements you already take stay in every plan; ones you have at home are suggested before anything you would need to buy.',
    options: {
      taking: 'I already take some',
      onHand: 'I have some at home but don’t take them',
      open: 'None now, but I’m open to them',
      food_first: 'I’d rather get everything from food',
    } satisfies Record<SupplementStance, string>,
  },
  list: {
    prompt: 'Which supplements do you take or have at home?',
    short: 'which supplements',
    skip: 'none listed',
    why: 'For each one: how much each time and when (morning, midday, evening, night), or that you have it but don’t take it.',
    context: (stance: string) => `supplements · ${stance}`,
    pick: 'Supplements',
    other: 'Something else',
    otherPlaceholder: 'e.g. ashwagandha gummies',
    add: 'Add',
    none: 'none after all',
    count: (taking: number, onHand: number) => [taking ? `${taking} taking` : '', onHand ? `${onHand} at home` : ''].filter(Boolean).join(' · '),
  },
} as const;

const S = SUPPLEMENTS_COPY;
const stanceOf = (v: unknown): SupplementStance | null => (SUPPLEMENT_STANCES.includes(v as SupplementStance) ? (v as SupplementStance) : null);
const listed = (stance: unknown): boolean => stance === 'taking' || stance === 'onHand';

/** The list answer as rows: v2 rows as they are, legacy `{ supplementId, dose, unit, time }` entries as taking rows. */
export function rowsOfAnswer(v: unknown): SupplementRow[] {
  if (!Array.isArray(v)) return [];
  const out: SupplementRow[] = [];
  for (const x of v as Array<Record<string, unknown>>) {
    if (!x || typeof x !== 'object') continue;
    const id = typeof x.supplementId === 'string' && x.supplementId ? x.supplementId : null;
    const text = typeof x.text === 'string' && x.text.trim() ? x.text.trim() : undefined;
    if (!id && !text) continue;
    const dose = typeof x.dose === 'number' && Number.isFinite(x.dose) ? x.dose : undefined;
    const unit = typeof x.unit === 'string' && x.unit ? x.unit : undefined;
    if (typeof x.state === 'string') {
      const times = Array.isArray(x.timesOfDay) ? TIMES_OF_DAY.filter((t) => (x.timesOfDay as unknown[]).includes(t)) : [];
      out.push({ supplementId: id, ...(text ? { text } : {}), state: x.state as SupplementRow['state'], ...(dose !== undefined ? { dose } : {}), ...(unit ? { unit } : {}), timesOfDay: times, ...(typeof x.since === 'string' ? { since: x.since } : {}) });
    } else {
      const time = TIMES_OF_DAY.includes(x.time as TimeOfDay) ? [x.time as TimeOfDay] : [];
      out.push({ supplementId: id, state: 'taking', ...(dose !== undefined ? { dose } : {}), ...(unit ? { unit: unit === 'g protein' ? 'g' : unit } : {}), timesOfDay: time });
    }
  }
  return out;
}

/** The stored section from the chapter's answers (stance ids `supplements`/`food.suppStance`, list `taking`/`food.suppList`). */
export function supplementsSectionOf(values: Readonly<Record<string, unknown>>): SupplementsSectionV2 {
  const stance = stanceOf(values['food.suppStance'] ?? values.supplements) ?? 'food_first';
  const rows = listed(stance) ? rowsOfAnswer(values['food.suppList'] ?? values.taking) : [];
  return { _v: 2, stance, rows };
}

/** Done is allowed with zero rows ("none after all"); with rows, every taking row needs a valid dose and a time. */
export function listComplete(rows: readonly SupplementRow[]): boolean {
  return rows.every((r) => validateDose(r).ok);
}

/** Receipt of the list answer: "Creatine monohydrate 5 g · morning; Whey protein (at home)". */
export function listReceipt(v: unknown): string {
  const rows = rowsOfAnswer(v);
  if (!rows.length) return S.list.skip;
  return rows
    .map((r) => {
      const name = supplementShortName(r);
      if (r.state === 'taking') return `${name} ${doseText(r)}`.trim();
      if (r.state === 'onHand') return `${name} (at home)`;
      if (r.state === 'notForMe') return `${name} (not for me)`;
      return name;
    })
    .join('; ');
}

/** The two questions of the food chapter's v3 graph (ids kept: `supplements`, `taking`, so stored answers keep working). */
export function supplementQuestions(): [SingleQuestion, CustomQuestion] {
  return [
    {
      id: 'supplements',
      chapter: 'food',
      section: 'supplements',
      anchor: 'supplements',
      kind: 'single',
      prompt: S.stance.prompt,
      short: S.stance.short,
      skipText: S.stance.skip,
      why: S.stance.why,
      defaultValue: 'food_first',
      options: SUPPLEMENT_STANCES.map((o) => ({ value: o, label: S.stance.options[o] })),
    },
    {
      id: 'taking',
      chapter: 'food',
      section: 'supplements',
      kind: 'custom',
      widget: 'supplements',
      parent: 'supplements',
      contextLine: (v) => {
        const st = stanceOf(v.supplements);
        return st ? S.list.context(S.stance.options[st]) : null;
      },
      prompt: S.list.prompt,
      short: S.list.short,
      skipText: S.list.skip,
      why: S.list.why,
      applies: (v) => listed(v.supplements),
      receipt: (v) => listReceipt(v),
    },
  ];
}

/** Counts for the list card's Done key. */
export function listCounts(rows: readonly SupplementRow[]): string {
  const sec: SupplementsSectionV2 = { _v: 2, stance: 'taking', rows: [...rows] };
  return S.list.count(rowsIn(sec, 'taking').length, rowsIn(sec, 'onHand').length);
}
