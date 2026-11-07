/** D7-01/D7-02 inline statuses on the markers screens. */
import { describe, expect, it } from 'vitest';
import { GFR_UNIT_UNCLEAR, NEEDS_CONTEXT, applicabilityLines, gfrUnitUnclear } from './markersStatus';

describe('marker statuses', () => {
  it('eGFR in bare mL/min is "Unit unclear"; the indexed unit is not', () => {
    expect(gfrUnitUnclear('egfr', 'mL/min')).toBe(true);
    expect(gfrUnitUnclear('egfr', 'mL/min/1.73 m²')).toBe(false);
    expect(gfrUnitUnclear('ldl', 'mg/dL')).toBe(false);
    expect(GFR_UNIT_UNCLEAR).toBe('Unit unclear');
  });

  it('unresolved rule applicability reads "Needs context", once per marker; resolved rules say nothing', () => {
    expect(applicabilityLines(undefined)).toEqual([]);
    expect(applicabilityLines([{ rule: 'no-such-rule', status: 'unresolved', reason: 'x' }])).toEqual([]);
    const lines = applicabilityLines([{ rule: 'W-L-FERRITIN-8', status: 'unresolved', reason: 'sex' }, { rule: 'W-L-FERRITIN-8', status: 'unresolved', reason: 'sex' }, { rule: 'W-L-VITD-3', status: 'applicable', reason: '' }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toMatch(new RegExp(`· ${NEEDS_CONTEXT}$`));
  });
});
