/**
 * E20: the Coach's blood test report card renders the review table; its save key is the card's Apply and passes the
 * ticked rows as `CardActionExtra.markers` (nothing is applied without the person ticking rows).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { MarkersReviewCard } from '@/ai/coach/types';
import { M } from '@/features/intake/chapters/markers';
import type { ChangeCardView } from '../../components/ChangeCard';
import type { CoachTurn } from '../adapter';
import { CoachTurnRow } from '../components/CoachTurnRow';
import { extractionOfCard } from '../components/CoachMarkersReview';

const NOW = new Date('2026-10-01T13:00:00');

const REVIEW: MarkersReviewCard = {
  extractionId: 'ex-1',
  attachmentId: 'att-1',
  route: 'textLayer',
  sampleDate: '2026-09-14',
  rows: [
    { row: 0, markerId: 'ldl', name: 'LDL Cholesterol', value: 192, unit: 'mg/dL', range: '< 100', confidence: 1, calculated: false, issues: [] },
    { row: 1, markerId: 'hdl', name: 'HDL Cholesterol', value: 41, unit: 'mg/dL', confidence: 0.95, calculated: false, issues: [] },
    { row: 2, markerId: 'nonHdl', name: 'Non-HDL (calculated)', value: 226, unit: 'mg/dL', confidence: 0.9, calculated: true, issues: [] },
  ],
  displayOnly: 0,
  notInReport: [],
};

const CARD: ChangeCardView = {
  id: 'mk-1',
  class: 'log',
  title: 'Blood test report · not saved yet',
  source: { label: 'Coach · read from the PDF' },
  createdAt: NOW.toISOString(),
  items: [{ label: 'LDL Cholesterol', before: null, after: '192 mg/dL' }],
  note: 'Nothing is saved until you confirm.',
  state: 'pending',
  markers: REVIEW,
};

const turn = (card: ChangeCardView): CoachTurn => ({ id: 't1', role: 'coach', at: NOW.toISOString(), text: 'Read 3 results.', cards: [card] });

describe('Coach blood test report card', () => {
  it('maps the card rows onto the table extraction', () => {
    const x = extractionOfCard(REVIEW);
    expect(x.rows[0]).toEqual({ row: 0, markerId: 'ldl', nameOnReport: 'LDL Cholesterol', value: 192, unit: 'mg/dL', labRange: '< 100', calculated: false, confidence: 1, issues: [] });
    expect(x.sampleDate).toBe('2026-09-14');
  });

  it('renders the review table; Apply passes the ticked rows as CardActionExtra.markers', async () => {
    const onCardAction = vi.fn();
    render(
      <MemoryRouter>
        <CoachTurnRow turn={turn(CARD)} now={NOW} quiet={false} provider="Anthropic" onCardAction={onCardAction} />
      </MemoryRouter>,
    );
    const card = screen.getByRole('article', { name: /Blood test report/ });
    // the table's save is the Apply: the card has no Apply of its own, rows start unticked
    const boxes = (await within(card).findAllByRole('checkbox')) as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(within(card).queryByRole('button', { name: /^Log it|^Apply/ })).toBeNull();
    expect(within(card).getByRole('button', { name: M.report2.save(0) })).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(within(card).getByRole('checkbox', { name: /LDL cholesterol/ }));
    fireEvent.click(within(card).getByRole('button', { name: M.report2.save(1) }));
    await waitFor(() => expect(onCardAction).toHaveBeenCalled());
    const [c, action, extra] = onCardAction.mock.calls[0]!;
    expect(c.id).toBe('mk-1');
    expect(action).toBe('apply');
    expect(extra).toEqual({ markers: { accept: [{ row: 0, date: '2026-09-14' }] } });
  });

  it('an applied card shows no table', () => {
    render(
      <MemoryRouter>
        <CoachTurnRow turn={turn({ ...CARD, state: 'applied', title: 'Blood test results saved' })} now={NOW} quiet={false} provider="Anthropic" onCardAction={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
