/**
 * The supplements part of the Coach's briefing (SUITE_SPEC §13.2: "the Coach suggests it before any purchase"; "never
 * suggested"). Model-facing text plus short lines for the visible "What the Coach knows" panel.
 */
import { supplementRecord } from './dose';
import { rowsIn } from './state';
import type { SupplementRow, SupplementsSectionV2 } from './types';

/** Short name: the catalogue name without its bracketed detail, or the typed text. */
export function supplementShortName(row: Pick<SupplementRow, 'supplementId' | 'text'>): string {
  const r = supplementRecord(row.supplementId);
  if (r) return r.name.replace(/\s*\(.*\)\s*$/, '');
  return row.text ?? row.supplementId ?? 'supplement';
}

/** "5 g · morning, night" (nothing when no dose and no time). */
export function doseText(row: Pick<SupplementRow, 'dose' | 'unit' | 'timesOfDay'>): string {
  const dose = row.dose !== undefined ? `${row.dose} ${row.unit ?? ''}`.trim() : '';
  const when = row.timesOfDay.join(', ');
  return [dose, when].filter(Boolean).join(' · ');
}

export interface SupplementBriefing {
  taking: string[];
  onHand: string[];
  notForMe: string[];
  /** One line for the model; null when nothing is known. */
  text: string | null;
  /** Lines for the visible panel. */
  lines: string[];
}

const STANCE_TEXT: Record<SupplementsSectionV2['stance'], string> = {
  taking: 'takes some supplements',
  onHand: 'has some supplements at home but does not take them',
  open: 'open to supplements',
  food_first: 'prefers food first (suggest no products)',
};

export function supplementBriefing(section: SupplementsSectionV2 | null): SupplementBriefing {
  if (!section) return { taking: [], onHand: [], notForMe: [], text: null, lines: [] };
  const fmt = (r: SupplementRow) => {
    const d = doseText(r);
    return d ? `${supplementShortName(r)} (${d})` : supplementShortName(r);
  };
  const taking = rowsIn(section, 'taking').map(fmt);
  const onHand = rowsIn(section, 'onHand').map((r) => supplementShortName(r));
  const notForMe = rowsIn(section, 'notForMe').map((r) => supplementShortName(r));
  const parts = [`Supplements: ${STANCE_TEXT[section.stance]}.`];
  if (taking.length) parts.push(`Takes now: ${taking.join('; ')}.`);
  if (onHand.length) parts.push(`Has at home, not taking (suggest using these before anything that must be bought): ${onHand.join('; ')}.`);
  if (notForMe.length) parts.push(`Does not want (never suggest): ${notForMe.join('; ')}.`);
  const lines: string[] = [];
  if (taking.length) lines.push(`supplements you take: ${taking.join(', ')}`);
  if (onHand.length) lines.push(`supplements you have at home: ${onHand.join(', ')}`);
  if (notForMe.length) lines.push(`supplements you don’t want: ${notForMe.join(', ')}`);
  return { taking, onHand, notForMe, text: parts.join(' '), lines };
}
