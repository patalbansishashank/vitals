/**
 * Q6-12: the row sheet's answer bank shows what is logged — "As planned" for a ticked row, "Partly" for a partly
 * logged one (a meal logged below its plan), nothing for a row not logged yet (KeyBank selected, COMPONENTS §2). Three answers, one row of three
 * equal keys: Train has its own way in ("Open in Train"), not a fourth answer that navigates away. A meal opens the
 * meal sheet Food opens too: the same fact line and answers, the manual logger and "Recipe and targets".
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useParams } from 'react-router';
import { useToday } from '../../clock';
import { useLiving } from '../../data/source';
import { todayRows } from '../model';
import { PrescriptionRows } from '../components/PrescriptionRows';
import { renderLiving } from '../../testing';
import { CONTRACT_DATE, todayViewFixture } from './todayView.fixture';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

function TestRows() {
  const params = useParams();
  const today = useToday();
  const date = params.date ?? today;
  const view = useLiving((s) => s.today(date), [date]);
  return (
    <section role="region" aria-label="Plan">
      {view ? (
        <PrescriptionRows rows={todayRows(view)} date={date} readOnly={false} quiet={view.quietMode} />
      ) : null}
    </section>
  );
}

const ANSWERS = ['As planned', 'Partly', 'Skipped'] as const;

function checked(name: RegExp): string[] {
  const bank = screen.getByRole('radiogroup', { name });
  return ANSWERS.filter(
    (a) => within(bank).getByRole('radio', { name: a }).getAttribute('aria-checked') === 'true',
  );
}

describe('Today row sheet shows the logged answer (Q6-12)', () => {
  it('reads the contract: Partly, or nothing; a logged meal reads its value against the plan and agrees with it', async () => {
    const view = todayViewFixture();
    renderLiving(<TestRows />, {
      path: `/today/${CONTRACT_DATE}`,
      route: 'today/:date',
      source: (stub) => ({
        ...stub.source,
        today: (d) => (d === CONTRACT_DATE ? view : stub.source.today(d)),
      }),
    });
    const plan = await screen.findByRole('region', { name: 'Plan' });
    fireEvent.click(within(plan).getByRole('button', { name: 'Details for lunch' }));
    // 640 kcal logged against a bigger plan: Partly, never "As planned" beside a smaller number
    expect(checked(/^How did lunch go/)).toEqual(['Partly']);
    const sheet = screen.getByRole('dialog', { name: 'Lunch' });
    // one row of three equal keys (KeyBank sets a grid column per key)
    const bank = within(sheet).getByRole('radiogroup');
    expect(within(bank).getAllByRole('radio')).toHaveLength(3);
    expect(bank).toHaveAttribute('data-segments', '3');
    expect((sheet.textContent ?? '').replace(/[\u2009\u202f\u00a0]/g, ' ')).toMatch(
      /640 \/ \d[\d ]* kcal/,
    );
    // the meal sheet: more food for the meal, and its recipe and targets; no full-width key in the body
    expect(within(sheet).getByRole('button', { name: 'Add more' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Recipe and targets' })).toBeInTheDocument();
    expect(sheet.querySelector('.lv-sheet .lm-key[data-block="true"]')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lunch' })).not.toBeInTheDocument());

    fireEvent.click(within(plan).getByRole('button', { name: 'Details for lift · 45 min' }));
    expect(checked(/^How did lift · 45 min go/)).toEqual(['Partly']);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Lift · 45 min' })).getByRole('button', { name: /close/i }),
    );

    fireEvent.click(within(plan).getByRole('button', { name: 'Details for snack' }));
    expect(checked(/^How did snack go/)).toEqual([]);
  });

  it('a row ticked "as planned" opens with "As planned" selected', async () => {
    renderLiving(<TestRows />, { path: '/today', route: 'today' });
    const plan = await screen.findByRole('region', { name: 'Plan' });
    await act(async () =>
      fireEvent.click(within(plan).getByRole('button', { name: 'Mark lunch as planned' })),
    );
    await waitFor(() =>
      expect(within(plan).queryByRole('button', { name: 'Mark lunch as planned' })).toBeNull(),
    );
    fireEvent.click(within(plan).getByRole('button', { name: 'Details for lunch' }));
    expect(checked(/^How did lunch go/)).toEqual(['As planned']);
  });

  it('a night with no target in the plan asks for the hours: the tick never invents them', async () => {
    const view = todayViewFixture();
    view.prescription = { ...view.prescription!, sleep: undefined };
    const h = renderLiving(<TestRows />, {
      path: `/today/${CONTRACT_DATE}`,
      route: 'today/:date',
      source: (stub) => ({
        ...stub.source,
        today: (d) => (d === CONTRACT_DATE ? view : stub.source.today(d)),
      }),
    });
    const tick = vi.spyOn(h.stub.actions, 'tick');
    const plan = await screen.findByRole('region', { name: 'Plan' });
    fireEvent.click(within(plan).getByRole('button', { name: /Any time/ }));
    fireEvent.click(within(plan).getByRole('button', { name: 'Change sleep' }));
    const sheet = await screen.findByRole('dialog', { name: 'Sleep' });
    expect(within(sheet).queryByRole('radiogroup')).toBeNull();
    expect(within(sheet).getByLabelText(/Hours asleep/)).toBeInTheDocument();
    expect(tick).not.toHaveBeenCalled();
  });

  it('a meal opens the same sheet as Food: the answer applies at once, "Recipe and targets" opens Food’s recipe sheet', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<TestRows />, {
      path: '/today',
      route: 'today',
      routes: [{ path: 'food', element: <p>food page</p> }],
    });
    const answerMeal = vi.spyOn(h.stub.actions, 'answerMeal');
    const plan = await screen.findByRole('region', { name: 'Plan' });
    await user.click(within(plan).getByRole('button', { name: 'Details for dinner' }));
    let sheet = await screen.findByRole('dialog', { name: 'Dinner' });
    // nothing logged: the meal's targets as one readout line, no answer selected, and "I ate something else"
    expect(sheet.textContent).toMatch(/kcal[\s\S]*protein[\s\S]*carbs[\s\S]*fat/);
    expect(checked(/^How did dinner go/)).toEqual([]);
    expect(within(sheet).getByRole('button', { name: 'I ate something else' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('radio', { name: 'Skipped' }));
    await waitFor(() =>
      expect(answerMeal).toHaveBeenCalledWith(expect.any(String), {
        slot: 'dinner',
        mark: 'skipped',
        replaces: [],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dinner' })).not.toBeInTheDocument());
    // the answer it has is selected next time, and choosing it again logs nothing more
    await user.click(within(plan).getByRole('button', { name: 'Details for dinner' }));
    sheet = await screen.findByRole('dialog', { name: 'Dinner' });
    expect(checked(/^How did dinner go/)).toEqual(['Skipped']);
    await user.click(within(sheet).getByRole('radio', { name: 'Skipped' }));
    expect(answerMeal).toHaveBeenCalledTimes(1);
    await user.click(within(plan).getByRole('button', { name: 'Details for dinner' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Dinner' })).getByRole('button', {
        name: 'Recipe and targets',
      }),
    );
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/food'));
    expect(h.router.state.location.search).toBe('?recipe=dinner');
  });

  it('"I ate something else" opens the manual logger for the meal, on Today', async () => {
    const user = userEvent.setup();
    renderLiving(<TestRows />, { path: '/today', route: 'today' });
    const plan = await screen.findByRole('region', { name: 'Plan' });
    await user.click(within(plan).getByRole('button', { name: 'Details for dinner' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Dinner' })).getByRole('button', {
        name: 'I ate something else',
      }),
    );
    // r068 L10: the logger's one field searches or describes
    expect(await screen.findByRole('searchbox', { name: 'Search or describe' })).toBeInTheDocument();
  });
});
