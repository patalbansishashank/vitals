/**
 * The energy figures the Energy card on Today and the Energy page share (r071 AUDIT §1.1 entry 10: these left
 * `ActivityFace.tsx` first, so the page and the cards import one copy). Pure.
 *
 *  - `rangeOf`: a figure's likely range from the day's scenario envelope, scaled to the figure.
 *  - `overPlanText`: the forecast against the plan, "+320 kcal by bedtime, over the plan" (the forecast only, D10).
 *  - `planState`: the same comparison as one word for a card foot ("Over the plan", "On plan", "Under the plan").
 *  - `ENERGY_WORDS`: the names of the three marks of the day's figures.
 */
import { formatEnergyRange, type EnergyUnitChoice, type StatChip } from '@/components';
import type { Envelope } from '@/living/sensors/types';
import { energyText } from './model';

/** The energy key's row names (r068 T10: "Plan" alone read as the food plan's kcal). */
export const ENERGY_WORDS = {
  soFar: 'Burned so far',
  byBedtime: 'Likely by bedtime',
  plan: 'Planned burn',
} as const;

/** A figure's likely range from the day's scenario envelope: its ends (kcal) and its text in the unit. */
export function rangeOf(
  value: number,
  env: Envelope | null | undefined,
  total: number | null | undefined,
  unit: EnergyUnitChoice = 'kcal',
): { lo: number; hi: number; text: string } | null {
  if (!env || !total || !(total > 0) || !Number.isFinite(env.lo) || !Number.isFinite(env.hi)) return null;
  const lo = (value * env.lo) / total;
  const hi = (value * env.hi) / total;
  return { lo, hi, text: `${formatEnergyRange(lo, hi, unit, { withUnit: false })}` };
}

/** "1 210–1 630" from a scenario envelope, scaled to a figure of that day, as a stat chip. */
export function rangeChip(
  value: number,
  env: Envelope | null | undefined,
  total: number | null | undefined,
  unit: EnergyUnitChoice = 'kcal',
): StatChip | undefined {
  const r = rangeOf(value, env, total, unit);
  return r ? { kind: 'qualifier', text: r.text } : undefined;
}

/** How far the likely day is from the plan, past which it is "over" or "under" (the same margin for the sentence and the word). */
const planMargin = (plan: number): number => Math.max(50, 0.05 * plan);

/** "+320 kcal by bedtime, over the plan" when the likely day passes the plan by a margin (the forecast only, D10). */
export function overPlanText(byBedtime: number, plan: number | null, unit: EnergyUnitChoice = 'kcal'): string | null {
  if (plan === null || !(plan > 0)) return null;
  const over = byBedtime - plan;
  if (Math.abs(over) < planMargin(plan)) return null;
  return `${over > 0 ? '+' : '−'}${energyText(Math.abs(over), unit)} ${unit} by bedtime, ${over > 0 ? 'over' : 'under'} the plan`;
}

/** The comparison as a word for a card foot: `over`, `under` or `on` (null without a plan). */
export function planState(byBedtime: number, plan: number | null): 'over' | 'under' | 'on' | null {
  if (plan === null || !(plan > 0)) return null;
  const over = byBedtime - plan;
  return Math.abs(over) < planMargin(plan) ? 'on' : over > 0 ? 'over' : 'under';
}

/** The foot's word for `planState`. */
export const PLAN_STATE_WORD = { over: 'Over the plan', under: 'Under the plan', on: 'On plan' } as const;
