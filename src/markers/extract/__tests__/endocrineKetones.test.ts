// @vitest-environment node
/**
 * D2-07 / D2-08 contributions of the marker pipeline: measured laboratory values stay distinct from model states.
 *   - Report rows for analytes the engine holds only as latent/relative states (IGF-1, SHBG, leptin, sex hormones) or as a
 *     blood-ketone point concentration from another observation path (BHB, urine/breath ketones) are shown, never mapped
 *     onto a planned marker — "insulin-like growth factor" is not fasting insulin.
 *   - A measured total testosterone reaches the engine baseline exactly with its provenance; without a reading nothing is
 *     fabricated (no absolute analyte from model state).
 */
import { describe, expect, it } from 'vitest';
import { labBaselinesWithDates } from '../../baselines';
import { readingFromInput } from '../../doc';
import type { MarkersDoc } from '../../types';
import { matchName } from '../synonyms';

describe('report names the model must not adopt as planned markers', () => {
  it.each([
    'IGF-1 (Somatomedin C)',
    'Insulin like Growth Factor 1',
    'INSULIN-LIKE GROWTH FACTOR-1, SERUM',
    'SHBG',
    'Sex Hormone Binding Globulin',
    'Leptin',
    'Estradiol (E2)',
    'Beta-Hydroxybutyrate (BHB)',
    'Ketones, Urine',
    'Serum Ketones',
  ])('%s is shown, not used', (name) => {
    const m = matchName(name);
    expect(m.markerId).toBeNull();
    expect(m.kind).toBe('display');
  });
  it('fasting insulin and total testosterone still map', () => {
    expect(matchName('Insulin, Fasting').markerId).toBe('insulin');
    expect(matchName('Testosterone, Total').markerId).toBe('testosterone');
  });
});

describe('measured testosterone is an exact baseline; none is fabricated', () => {
  const doc = (withT: boolean): MarkersDoc => ({
    _schema: 1,
    readings: withT ? [readingFromInput({ id: 'testosterone', value: 412, unit: 'ng/dL', date: '2026-09-20', sampleId: 's1' }, 'manual', '2026-09-20T09:00:00Z')] : [],
    displayOnly: [],
    context: {},
    chapter: 'manual',
  });
  it('keeps the measured value (converted exactly, provenance and sample id) and leaves it absent without a reading', () => {
    const b = labBaselinesWithDates(doc(true), '2026-10-02');
    expect(b.labs.testosteroneNmolL).toBeCloseTo(412 * 0.03467, 9);
    expect(b.labMeta.testosteroneNmolL).toMatchObject({ source: 'marker', measuredOn: '2026-09-20', sampleId: 's1', original: { value: 412, unit: 'ng/dL' } });
    const none = labBaselinesWithDates(doc(false), '2026-10-02');
    expect(none.labs.testosteroneNmolL).toBeUndefined();
    expect(none.labMeta.testosteroneNmolL).toBeUndefined();
  });
});
