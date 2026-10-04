/**
 * Q4-16: the ladder banner's note text and its "because" chip name the reading in the same unit, the one the person
 * entered (SUITE_SPEC §13.5.3).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { MAN_95 } from '@/engine/planner/domain/__tests__/personas';
import { readingFromInput } from '../../doc';
import { evaluateMarkers, ruleContextFrom } from '../../rules';
import type { MarkerReadingInput, MarkersDoc } from '../../types';
import { MarkerBanner } from '../MarkerBanner';

const DATE = '2026-08-03';
const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({
  _schema: 1,
  readings: inputs.map((i) => readingFromInput(i, 'manual', `${DATE}T09:00:00Z`)),
  displayOnly: [],
  context: {},
  chapter: 'manual',
});
const ctx = ruleContextFrom(MAN_95, '2026-10-02');

describe('banner and chip units (Q4-16)', () => {
  it('potassium entered in mEq/L reads "5.3 mEq/L" in both the note and the chip', () => {
    const ev = evaluateMarkers(doc([{ id: 'potassium', value: 5.3, unit: 'mEq/L', date: DATE, labRange: { low: 3.5, high: 5.1, unit: 'mEq/L' } }]), ctx);
    const notes = ev.notes.filter((n) => n.markerId === 'potassium');
    expect(notes.length).toBeGreaterThan(0);
    render(
      <MemoryRouter>
        <MarkerBanner notes={notes} />
      </MemoryRouter>,
    );
    for (const n of notes) expect(n.text).not.toContain('mmol/L');
    const banner = screen.getByRole('region', { name: 'From your blood test' });
    expect(banner.textContent).not.toContain('mmol/L');
    // the sentence leaves the reading to its chip (Q6-14)
    expect(banner.textContent).toContain('Because of this result, ');
    for (const chip of screen.getAllByRole('button', { name: /^because your potassium/ })) expect(chip.textContent).toBe('because your potassium was 5.3 mEq/L on 3 Aug 2026');
  });

  it('LDL entered in mmol/L leads with mmol/L in both; the note keeps its mg/dL equivalent for its other numbers', () => {
    const ev = evaluateMarkers(doc([{ id: 'ldl', value: 5.2, unit: 'mmol/L', date: DATE }]), ctx);
    const n = ev.notes.find((x) => x.rule === 'W-L-LDL-7')!;
    expect(n.text).toMatch(/^Your LDL was 5\.2 mmol\/L \(201 mg\/dL\) on 3 Aug 2026\. At 190 or more/);
    render(
      <MemoryRouter>
        <MarkerBanner notes={[n]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /^because your LDL/ }).textContent).toBe('because your LDL cholesterol was 5.2 mmol/L on 3 Aug 2026');
  });

  it('a reading entered in the message unit is unchanged', () => {
    const ev = evaluateMarkers(doc([{ id: 'ldl', value: 192, unit: 'mg/dL', date: DATE }]), ctx);
    expect(ev.notes.find((x) => x.rule === 'W-L-LDL-1')!.text).toContain('because your LDL was 192 mg/dL on 3 Aug 2026.');
  });
});
