/**
 * Q6-12: the row sheet's answer bank shows what is logged — "as planned" for a ticked row, "partly" for a partly
 * logged one, nothing for a row not logged yet (KeyBank selected, COMPONENTS §2).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import TodayPage from '../TodayPage';
import { renderLiving } from '../../testing';
import { CONTRACT_DATE, todayViewFixture } from './todayView.fixture';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const ANSWERS = ['as planned', 'partly', 'skipped', 'something else'] as const;

function checked(name: RegExp): string[] {
  const bank = screen.getByRole('radiogroup', { name });
  return ANSWERS.filter((a) => within(bank).getByRole('radio', { name: a }).getAttribute('aria-checked') === 'true');
}

describe('Today row sheet shows the logged answer (Q6-12)', () => {
  it('reads the contract: as planned, partly, or nothing', async () => {
    const view = todayViewFixture();
    renderLiving(<TodayPage />, {
      path: `/today/${CONTRACT_DATE}`,
      route: 'today/:date',
      source: (stub) => ({ ...stub.source, today: (d) => (d === CONTRACT_DATE ? view : stub.source.today(d)) }),
    });
    const plan = await screen.findByRole('region', { name: 'Today’s plan' });
    fireEvent.click(within(plan).getByRole('button', { name: 'More for lunch' }));
    expect(checked(/^How did lunch go/)).toEqual(['as planned']);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    fireEvent.click(within(plan).getByRole('button', { name: 'More for lift · 45 min' }));
    expect(checked(/^How did lift · 45 min go/)).toEqual(['partly']);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    fireEvent.click(within(plan).getByRole('button', { name: 'More for snack' }));
    expect(checked(/^How did snack go/)).toEqual([]);
  });

  it('a row ticked "as planned" opens with "as planned" selected', async () => {
    renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    const plan = await screen.findByRole('region', { name: 'Today’s plan' });
    await act(async () => fireEvent.click(within(plan).getByRole('button', { name: 'Mark lunch as planned' })));
    await waitFor(() => expect(within(plan).getByRole('button', { name: /^lunch: as planned/ })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(within(plan).getByRole('button', { name: 'More for lunch' }));
    expect(checked(/^How did lunch go/)).toEqual(['as planned']);
  });
});
