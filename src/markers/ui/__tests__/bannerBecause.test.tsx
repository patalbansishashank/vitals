/**
 * Q6-14: on the ladder's "From your blood test" banner the note's sentence does not repeat the "because your LDL was
 * 172 mg/dL on 14 Sep 2026" that its chip says right after it (COMPONENTS §14.6).
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { MAN_95 } from '@/engine/planner/domain/__tests__/personas';
import { fillMessage, withoutBecause } from '../../because';
import { readingFromInput } from '../../doc';
import { rules } from '../../interactions.json';
import { evaluateMarkers, ruleContextFrom } from '../../rules';
import type { MarkerReadingInput, MarkersDoc } from '../../types';
import { MarkerBanner } from '../MarkerBanner';

const DATE = '2026-09-14';
const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({
  _schema: 1,
  readings: inputs.map((i) => readingFromInput(i, 'manual', `${DATE}T09:00:00Z`)),
  displayOnly: [],
  context: {},
  chapter: 'manual',
});
const ctx = ruleContextFrom(MAN_95, '2026-10-02');

describe('withoutBecause (Q6-14)', () => {
  it('drops a because-clause inside the sentence with its comma', () => {
    expect(withoutBecause('Saturated fat is kept under 10 % of energy because your LDL was 172 mg/dL on 14 Sep 2026. Ghee is swapped.')).toBe(
      'Saturated fat is kept under 10 % of energy. Ghee is swapped.',
    );
    expect(withoutBecause('Prefer filtered coffee, because your LDL was 5.2 mmol/L (201 mg/dL) on Sep 14, 2026. Unfiltered raises LDL.')).toBe(
      'Prefer filtered coffee. Unfiltered raises LDL.',
    );
    expect(withoutBecause('Aerobic exercise is ranked higher because your HDL was 35 mg/dL on 14 Sep 2026; it raises HDL.')).toBe('Aerobic exercise is ranked higher; it raises HDL.');
  });

  it('a sentence that opens with it reads "Because of this result", or starts after the colon', () => {
    expect(withoutBecause('Because your potassium was 5.3 mEq/L on 3 Aug 2026, the plan keeps caffeine under 400 mg a day.')).toBe(
      'Because of this result, the plan keeps caffeine under 400 mg a day.',
    );
    expect(withoutBecause('Because your ALT was 80 U/L on 3 Aug 2026: green tea extract can rarely injure the liver.')).toBe('Green tea extract can rarely injure the liver.');
  });

  it('leaves sentences without the clause alone', () => {
    for (const t of ['Your LDL was 201 mg/dL on 3 Aug 2026. At 190 or more, see a clinician.', 'Because your free T3 (2.1 pg/mL) and testosterone were both low on 3 Aug 2026, a diet break is scheduled.'])
      expect(withoutBecause(t)).toBe(t);
  });

  it('every research message reads as a sentence without the clause', () => {
    for (const r of rules as ReadonlyArray<{ message: string }>) {
      const filled = fillMessage(r.message, { value: 172, date: '14 Sep 2026', cap: 20, uln: '33 U/L', old: 150, d1: '1 Jan 2026', d2: '14 Sep 2026' });
      const out = withoutBecause(filled);
      expect(out, filled).not.toMatch(/because your [^,:;]+? (?:was|were) \d[^;]*? on 14 Sep 2026/i);
      expect(out, filled).toMatch(/^[A-Z(]/);
      expect(out, filled).not.toMatch(/ {2}| [,.;]|^[,.;:]/);
    }
  });
});

describe('the ladder banner (Q6-14)', () => {
  it('says the LDL reading once: in the chip, not again in the sentence', () => {
    const ev = evaluateMarkers(doc([{ id: 'ldl', value: 172, unit: 'mg/dL', date: DATE }]), ctx);
    const notes = ev.notes.filter((n) => n.text.includes('because your LDL was 172 mg/dL on 14 Sep 2026'));
    expect(notes.length).toBeGreaterThan(0);
    render(
      <MemoryRouter>
        <MarkerBanner notes={notes} max={20} />
      </MemoryRouter>,
    );
    const banner = screen.getByRole('region', { name: 'From your blood test' });
    for (const item of within(banner).getAllByRole('listitem')) {
      const said = item.textContent?.match(/your LDL[^.;]*?172 mg\/dL on 14 Sep 2026/g) ?? [];
      expect(said, item.textContent ?? '').toHaveLength(1);
      expect(within(item).getByRole('button', { name: /^because your LDL/ })).toBeInTheDocument();
    }
  });
});
