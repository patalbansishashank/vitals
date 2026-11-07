/**
 * Short marker statuses the markers screens show inline (C6 vocabulary; D7-01, D7-02). Pure: no React.
 * - eGFR: a value printed without its /1.73 m² index may be absolute GFR; it is kept exactly as typed or read, never
 *   converted or staged as indexed eGFR, and reads "Unit unclear" until the indexing is confirmed (D7-02).
 * - Population-specific rules (male testosterone cut-offs): when the rule's reference physiology or sample facts are not
 *   established, the reading stays visible with its lab range and the rule reads "Needs context" (D7-01), never a match.
 * The reasons (which population, which sample facts) belong in the info sheet, not on the row.
 */
import { MARKER_UNITS, ruleById, type MarkerEvaluation, type MarkerId } from '@/markers';
import { gfrQuantityFromUnit } from '@/lib/measurementOperators';

export const GFR_UNIT_UNCLEAR = 'Unit unclear';
export const NEEDS_CONTEXT = 'Needs context';

/** True for an eGFR in a unit that does not say it is indexed per 1.73 m² (bare mL/min, creatinine clearance…). */
export function gfrUnitUnclear(id: MarkerId | string | null | undefined, unit: string | null | undefined): boolean {
  return id === 'egfr' && !!unit && gfrQuantityFromUnit(unit) !== 'egfrIndexed';
}

/**
 * One line per marker whose rule applicability is unresolved ("Testosterone · Needs context"), in evaluation order and
 * once per marker. Rules the table no longer knows fall back to their id's marker when it parses.
 */
export function applicabilityLines(applicability: MarkerEvaluation['applicability'] | undefined): Array<{ markerId: string; text: string }> {
  const out: Array<{ markerId: string; text: string }> = [];
  for (const a of applicability ?? []) {
    if (a.status !== 'unresolved') continue;
    const markerId = ruleById(a.rule)?.markerId;
    if (!markerId || out.some((o) => o.markerId === markerId)) continue;
    const label = MARKER_UNITS[markerId as MarkerId]?.label ?? markerId;
    out.push({ markerId, text: `${label} · ${NEEDS_CONTEXT}` });
  }
  return out;
}
