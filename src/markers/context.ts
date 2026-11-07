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
 *   the live plan's diet pattern (SUITE_SPEC §13.5: "plan start with a different diet pattern"), or a later explicit diet
 *   change the person entered. A plan's diet pattern is its exposure (D7-05): the animal-food level (omnivore when not
 *   set, as the engine reads it) AND, when both plans state it, the carbohydrate class of its schedule (very-low-carb /
 *   low-carb / moderate, the app's own lever definitions), so a big carbohydrate/fat change inside the omnivore category is
 *   a change too. The first plan ever counts.
 * Medication changes are not read here: the markers document's dated, classed changes (`MarkersDoc.medications`) reach the
 * rules and the engine baseline builder through the one freshness context (`freshnessOf`, ./doc.ts).
 * Everything else a rule names (plan aerobic load, deficit %, fasting, caffeine, sleep, high-dose biotin, sample-after-
 * fast …) is not filled: the rule stays unresolved, never guessed.
 *
 * Reference physiology (D7-01): from the confirmed physiological sex parameter and a known adult age (`ruleContextFrom`);
 * "prefer not to say" or a missing age is unresolved. A caller holding a lab's own reference context (e.g. the person's
 * report states the reference applies to them) may pass `referencePhysiology` explicitly; it is never inferred from
 * gender, and hormone therapy is read per sample.
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
  /**
   * The live plan (scheduled, active or paused), or null. `dietPattern` null/absent = omnivore. `carbClass` (D7-05): the
   * schedule's carbohydrate class; null = not determinable, absent = not supplied (then only the animal-food level counts).
   */
  plan?: { status: string; startDate: LocalDate; dietPattern?: string | null; carbClass?: CarbClass | null } | null;
  /** The plans that started before the live plan (any order), with their diet pattern and carbohydrate class. */
  earlierPlans?: ReadonlyArray<{ startDate: LocalDate; dietPattern?: string | null; carbClass?: CarbClass | null }>;
  /** (D7-05) A big diet change the person entered explicitly (e.g. before any plan); used when it is the later one. */
  dietChangeDate?: LocalDate | null;
  /** (D7-01) An explicit reference-physiology context; absent = derived from the profile (unknown stays unresolved). */
  referencePhysiology?: RuleContext['referencePhysiology'];
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

/** Carbohydrate class of a plan's schedule (the app's lever definitions: < 50 g, < 130 g, else moderate). */
export type CarbClass = 'vlc' | 'lowcarb' | 'moderate';

/**
 * Same diet exposure (D7-05): the same animal-food level and, when both plans state a carbohydrate class, the same class.
 * A class known on one side only (or not determinable on one side) counts as a change, so the baseline is not kept
 * across an unverified composition change; neither side stating one keeps the legacy animal-level comparison.
 */
function sameExposure(a: { dietPattern?: string | null; carbClass?: CarbClass | null }, b: { dietPattern?: string | null; carbClass?: CarbClass | null }): boolean {
  if ((a.dietPattern ?? 'omnivore') !== (b.dietPattern ?? 'omnivore')) return false;
  if (a.carbClass === undefined && b.carbClass === undefined) return true;
  return !!a.carbClass && a.carbClass === b.carbClass;
}

/**
 * The diet change date: the start of the first plan in the latest run of plans sharing the live plan's diet exposure
 * (the live plan's own start when the plan before it had another pattern, or when it is the first plan), or the explicit
 * diet change the person entered when that is later (never one in the future).
 */
export function dietChangeDateOf(i: Pick<MarkerContextInputs, 'plan' | 'earlierPlans' | 'dietChangeDate'>, today: LocalDate): LocalDate | undefined {
  const explicit = i.dietChangeDate && i.dietChangeDate <= today ? i.dietChangeDate : undefined;
  const p = i.plan;
  if (!p || p.status === 'scheduled' || p.status === 'ended' || p.startDate > today) return explicit;
  const earlier = (i.earlierPlans ?? []).filter((e) => e.startDate < p.startDate).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  let date = p.startDate;
  for (const e of earlier) {
    if (!sameExposure(e, p)) break;
    date = e.startDate;
  }
  return explicit && explicit > date ? explicit : date;
}

/** The rule context for today from everything the app holds (see the file header for what is filled). */
export function markerRuleContext(i: MarkerContextInputs, today: LocalDate): RuleContext {
  const extra: Partial<RuleContext> = { flags: [...(i.flags ?? [])] };
  const fields = markerContextFields(i);
  if (Object.keys(fields).length) extra.fields = fields;
  const change = dietChangeDateOf(i, today);
  if (change) extra.dietChangeDate = change;
  if (i.referencePhysiology) extra.referencePhysiology = i.referencePhysiology;
  return ruleContextFrom(i.profile, today, extra);
}
