/**
 * The person's supplements (SUITE_SPEC §13.2): what they take, what they have at home but do not take, and what they
 * do not want. Stored as the `supplements` section of `intake/me` (`SupplementsSectionV2`); the v1 section (a stance
 * and a `taking[]` list) is read through `toSectionV2` (`./migrate.ts`).
 */

/** taking = takes it now · onHand = has it at home, does not take it · notForMe = does not want it · unknown = not said. */
export type SupplementState = 'taking' | 'onHand' | 'notForMe' | 'unknown';
export const SUPPLEMENT_STATES: readonly SupplementState[] = ['taking', 'onHand', 'notForMe', 'unknown'];

export type TimeOfDay = 'morning' | 'midday' | 'evening' | 'night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'midday', 'evening', 'night'];

/** The answer to "Do you take supplements now, or have some at home?". */
export type SupplementStance = 'taking' | 'onHand' | 'open' | 'food_first';
export const SUPPLEMENT_STANCES: readonly SupplementStance[] = ['taking', 'onHand', 'open', 'food_first'];

export interface SupplementRow {
  /** Catalogue id; null while the row is free text not yet matched to the catalogue. */
  supplementId: string | null;
  /** What the person typed (free-text rows; kept after matching for the record). */
  text?: string;
  state: SupplementState;
  dose?: number;
  unit?: string;
  timesOfDay: TimeOfDay[];
  /** Local date (YYYY-MM-DD) the person started taking it, when known. */
  since?: string;
}

export interface SupplementsSectionV2 {
  _v: 2;
  stance: SupplementStance;
  rows: SupplementRow[];
}

/** The v1 section (before plan 02): a stance and the supplements taken with a clock hour. */
export interface SupplementsSectionV1 {
  stance: 'food_first' | 'open';
  taking: Array<{ supplementId: string; dose: number; unit: string; clockH?: number }>;
}
