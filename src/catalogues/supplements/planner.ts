/**
 * What the planner receives from the supplements section (SUITE_SPEC §13.2 "Planner and Food rules").
 *
 * Supplements with a planner lever (creatine L7, omega-3 L8, psyllium L9 "viscous fibre"; others are display-only,
 * §8.5) map per row:
 * | state | planner |
 * |---|---|
 * | taking | consented (`optIns.levers`); listed as `habitual` (the person already takes it) |
 * | onHand | consented (`optIns.levers`) with zero purchase cost (`onHand`, never in "things to buy") |
 * | notForMe | refused: `constraints.excludedLevers` (the planner's consent-refusal path, kept by the Ideal) |
 * | unknown / no row | stance `open` → the catalogue opt-in as before (creatine); otherwise not offered |
 *
 * Output lists are in a fixed order (L7, L8, L9) so request hashes are stable; the stance `open` with no rows gives
 * exactly `['creatine']`, the pre-v2 request.
 */
import { supplementRecord } from './dose';
import type { SupplementsSectionV2 } from './types';

export interface SupplementLever {
  supplementId: string;
  lever: 'L7' | 'L8' | 'L9';
  /** Lever family the planner's consent check accepts (`optIns.levers` holds an id or a family). */
  family: 'creatine' | 'omega3' | 'fibre';
}

export const SUPPLEMENT_LEVERS: readonly SupplementLever[] = [
  { supplementId: 'creatine_monohydrate', lever: 'L7', family: 'creatine' },
  { supplementId: 'omega3_epa_dha', lever: 'L8', family: 'omega3' },
  { supplementId: 'psyllium', lever: 'L9', family: 'fibre' },
];

/** The catalogue opt-in the stance `open` grants without rows (unchanged from v1). */
const OPEN_DEFAULT: readonly string[] = ['creatine'];

export interface SupplementPlannerInputs {
  /** For `safety.optIns.levers` (families, fixed order). */
  optInLevers: string[];
  /** For `constraints.excludedLevers` (lever ids, fixed order). */
  excludedLevers: string[];
  /** Lever ids the person already takes: part of the baseline, never "added" by a plan. */
  habitual: string[];
  /** Lever ids the person has at home: no purchase needed. */
  onHand: string[];
}

export function supplementPlannerInputs(section: SupplementsSectionV2 | null): SupplementPlannerInputs {
  const out: SupplementPlannerInputs = { optInLevers: [], excludedLevers: [], habitual: [], onHand: [] };
  if (!section) return out;
  const stateOf = (id: string) => section.rows.find((r) => (r.supplementId ? supplementRecord(r.supplementId)?.id ?? r.supplementId : null) === id)?.state;
  for (const l of SUPPLEMENT_LEVERS) {
    const s = stateOf(l.supplementId);
    if (s === 'taking') {
      out.optInLevers.push(l.family);
      out.habitual.push(l.lever);
    } else if (s === 'onHand') {
      out.optInLevers.push(l.family);
      out.onHand.push(l.lever);
    } else if (s === 'notForMe') out.excludedLevers.push(l.lever);
    else if (section.stance === 'open' && OPEN_DEFAULT.includes(l.family)) out.optInLevers.push(l.family);
  }
  return out;
}

/**
 * Catalogue ids the Food tab and the Coach may suggest as cards: only when the stance is `open`, never a `notForMe`
 * row and never one the person already takes or has at home (those show as their own rows).
 */
export function suggestible(section: SupplementsSectionV2 | null): { allowed: boolean; skip: ReadonlySet<string> } {
  const skip = new Set((section?.rows ?? []).map((r) => r.supplementId).filter((x): x is string => !!x));
  return { allowed: section?.stance === 'open', skip };
}
