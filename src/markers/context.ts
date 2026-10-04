/**
 * The one rule-context builder (SUITE_SPEC §13.5.3) for every caller: the screens (`useMarkerRuleContext`), the
 * `markers.*` commands (`ruleContext`) and the planner's re-ask precondition (`pendingMarkerReask`). Pure: callers read
 * the sources (profile, screening, intake document, live plan) and pass them in.
 *
 * Fields filled from what the app actually holds (`RuleContext.fields`):
 * - `supplements.calcium`, `supplements.ashwagandha`: the `supplements` section of `intake/me` (a row in state
 *   `taking` → true; `onHand`/`notForMe`, or no row while the section is answered → false; a row in state `unknown`, or
 *   the section never answered → not filled).
 * - `medications.levothyroxine`, `conditions.thyroidTreated`: the screening's medicines question (thyroid hormone
 *   picked → true; "no" → false; "yes" without thyroid hormone → levothyroxine false, treated false unless "other"
 *   medicines were picked; "prefer not to say" or unanswered → not filled).
 * - `diet.pattern`: the food chapter's diet kind (vegan, vegetarian, eggetarian, omnivore) once answered.
 * - `dietChangeDate`: once the live plan has started, the start date of the first plan in the latest run of plans with
 *   the live plan's diet pattern (SUITE_SPEC §13.5: "plan start with a different diet pattern"). A plan's diet pattern is
 *   its baseline profile's animal-food level, omnivore when not set (as the engine reads it). The first plan ever counts.
 * Everything else a rule names (plan aerobic load, deficit %, fasting, caffeine, sleep, high-dose biotin, sample-after-
 * fast …) is not filled: the rule stays unresolved, never guessed.
 */
import type { PersonProfile } from '@/engine/types/profile';
import type { LocalDate } from '@/store';
import { ruleContextFrom } from './rules';
import type { RuleContext } from './types';

type FieldValue = number | string | boolean | undefined;

/** A supplement row as the builder reads it (the `SupplementRow` subset). */
export interface ContextSupplementRow {
  supplementId: string | null;
  text?: string;
  state: 'taking' | 'onHand' | 'notForMe' | 'unknown';
}

export interface MarkerContextInputs {
  profile?: Pick<PersonProfile, 'body' | 'safety' | 'sexUnspecified'>;
  /** The screening outcome's flags. */
  flags?: readonly string[];
  /** The screening's medicines answer and the classes picked. */
  medications?: { answer?: 'yes' | 'no' | 'prefer-not' | string; items?: readonly string[] } | null;
  /** The intake `supplements` section's rows; null/undefined when the section was never answered. */
  supplements?: { rows: readonly ContextSupplementRow[] } | null;
  /** The food chapter's diet kind; null until answered. */
  dietKind?: 'vegan' | 'vegetarian' | 'eggetarian' | 'omnivore' | null;
  /** The live plan (scheduled, active or paused), or null. `dietPattern` null/absent = omnivore. */
  plan?: { status: string; startDate: LocalDate; dietPattern?: string | null } | null;
  /** The plans that started before the live plan (any order), with their diet pattern. */
  earlierPlans?: ReadonlyArray<{ startDate: LocalDate; dietPattern?: string | null }>;
}

/** Catalogue ids the rules read, with the names a free-text row may use. */
const SUPPLEMENT_FIELDS: ReadonlyArray<{ field: string; id: string; names: readonly string[] }> = [
  { field: 'supplements.calcium', id: 'calcium', names: ['calcium'] },
  { field: 'supplements.ashwagandha', id: 'ashwagandha', names: ['ashwagandha', 'withania'] },
];

function supplementField(rows: readonly ContextSupplementRow[], id: string, names: readonly string[]): boolean | undefined {
  const matches = rows.filter((r) => {
    if (r.supplementId) return r.supplementId.toLowerCase() === id;
    const t = r.text?.toLowerCase() ?? '';
    return names.some((n) => t.includes(n));
  });
  if (matches.some((r) => r.state === 'taking')) return true;
  if (matches.some((r) => r.state === 'unknown')) return undefined;
  return false;
}

/** The dotted fields the builder can fill (absent = not known). */
export function markerContextFields(i: MarkerContextInputs): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (i.supplements) for (const s of SUPPLEMENT_FIELDS) out[s.field] = supplementField(i.supplements.rows, s.id, s.names);

  const m = i.medications;
  if (m?.answer === 'no') {
    out['medications.levothyroxine'] = false;
    out['conditions.thyroidTreated'] = false;
  } else if (m?.answer === 'yes' && m.items) {
    const thyroid = m.items.includes('thyroid');
    out['medications.levothyroxine'] = thyroid;
    out['conditions.thyroidTreated'] = thyroid ? true : m.items.includes('other') ? undefined : false;
  }

  if (i.dietKind) out['diet.pattern'] = i.dietKind;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * The diet change date: the start of the first plan in the latest run of plans sharing the live plan's diet pattern
 * (the live plan's own start when the plan before it had another pattern, or when it is the first plan).
 */
export function dietChangeDateOf(i: Pick<MarkerContextInputs, 'plan' | 'earlierPlans'>, today: LocalDate): LocalDate | undefined {
  const p = i.plan;
  if (!p || p.status === 'scheduled' || p.status === 'ended' || p.startDate > today) return undefined;
  const pattern = p.dietPattern ?? 'omnivore';
  const earlier = (i.earlierPlans ?? []).filter((e) => e.startDate < p.startDate).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  let date = p.startDate;
  for (const e of earlier) {
    if ((e.dietPattern ?? 'omnivore') !== pattern) break;
    date = e.startDate;
  }
  return date;
}

/** The rule context for today from everything the app holds (see the file header for what is filled). */
export function markerRuleContext(i: MarkerContextInputs, today: LocalDate): RuleContext {
  const extra: Partial<RuleContext> = { flags: [...(i.flags ?? [])] };
  const fields = markerContextFields(i);
  if (Object.keys(fields).length) extra.fields = fields;
  const change = dietChangeDateOf(i, today);
  if (change) extra.dietChangeDate = change;
  return ruleContextFrom(i.profile, today, extra);
}
