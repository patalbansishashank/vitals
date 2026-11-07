import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { renderLiving } from '../../testing';
import TodayPage from '../TodayPage';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

// the fixture's today is Thu 1 Oct 2026
function renderMenu() {
  return renderLiving(
    <>
      <TodayPage />
      <Toaster />
    </>,
    { path: '/today', route: 'today' },
  );
}

async function openAway(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Busy or away' }));
  return screen.findByRole('dialog', { name: 'Busy or away' });
}

describe('Today ⋯ · Busy or away', () => {
  it('holds the page items once and nothing else: no check-in, pause, end, re-plan or places (r068 U14)', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: 'More' }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent?.trim());
    expect(items).toEqual([
      'Edit cards',
      'Record an activity',
      'Log an activity',
      'Busy or away',
      'Log a fast',
    ]);
    expect(
      items.filter((t) => t === 'Planning tools' || t === 'Settings' || t === 'Plan details'),
    ).toHaveLength(0);
    expect(items.some((t) => /Check in|Pause|End plan|Re-plan/.test(t ?? ''))).toBe(false);
  });

  it('tells the plan about busy days (tomorrow to the day after by default) and the proposal shows as a change card', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    expect(within(sheet).getByLabelText('From')).toHaveValue('2026-10-02');
    expect(within(sheet).getByLabelText('To')).toHaveValue('2026-10-03');
    // each date is a date target that reads the day ("Fri 2 Oct"), never the browser's own field
    expect(sheet.querySelectorAll('.lv-date')).toHaveLength(2);
    expect(within(sheet).getByText('Fri 2 Oct')).toBeInTheDocument();
    expect(within(sheet).getByText('Sat 3 Oct')).toBeInTheDocument();
    // the five reasons are one radio group of wrapping pills, "Busy" chosen
    const reasons = within(sheet).getByRole('radiogroup', { name: 'What’s happening' });
    expect(within(reasons).getAllByRole('radio')).toHaveLength(5);
    expect(within(reasons).getByRole('radio', { name: 'Busy' })).toHaveAttribute('aria-checked', 'true');
    expect(sheet.textContent).not.toMatch(/Tell the plan about|Only you see this/);
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(declare).toHaveBeenCalledWith({ kind: 'busy', from: '2026-10-02', to: '2026-10-03' });
    expect(
      await screen.findByText('Busy days: no training, food as planned. A proposal is waiting on Today.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Busy or away' })).not.toBeInTheDocument(),
    );
    const cards = h.stub.source
      .changes('today')
      .filter((c) => c.state === 'pending' && /^Proposal · busy /.test(c.title));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.impact?.goalDates.length).toBeGreaterThan(0);
  });

  it('a meal out is one day, with a note', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    await user.click(within(sheet).getByRole('radio', { name: 'Meal out' }));
    expect(within(sheet).queryByLabelText('To')).toBeNull();
    await user.type(within(sheet).getByLabelText(/^Note/), 'birthday dinner');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(declare).toHaveBeenCalledWith({
      kind: 'socialMeal',
      from: '2026-10-02',
      to: '2026-10-02',
      note: 'birthday dinner',
    });
  });

  it('pushing the plan back by those days dispatches a shift instead', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const shift = vi.spyOn(h.stub.actions, 'shift');
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    await user.click(within(sheet).getByRole('checkbox', { name: 'Push the plan back 2 days' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(shift).toHaveBeenCalledWith({ from: '2026-10-02', days: 2, mode: 'pushBack' });
    expect(declare).not.toHaveBeenCalled();
    expect(await screen.findByText('A proposal is waiting on Today.')).toBeInTheDocument();
    expect(
      h.stub.source.changes('today').some((c) => c.title === 'Proposal · push the plan back 2 days'),
    ).toBe(true);
  });

  it('picking dates in the targets moves the range and the push-back count with it', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    fireEvent.change(within(sheet).getByLabelText('From'), { target: { value: '2026-10-05' } });
    fireEvent.change(within(sheet).getByLabelText('To'), { target: { value: '2026-10-08' } });
    expect(within(sheet).getByText('Mon 5 Oct')).toBeInTheDocument();
    expect(within(sheet).getByText('Thu 8 Oct')).toBeInTheDocument();
    expect(within(sheet).getByRole('checkbox', { name: 'Push the plan back 4 days' })).not.toBeChecked();
    // a cleared field or a day before today never becomes the range
    fireEvent.change(within(sheet).getByLabelText('From'), { target: { value: '' } });
    fireEvent.change(within(sheet).getByLabelText('From'), { target: { value: '2026-09-20' } });
    expect(within(sheet).getByLabelText('From')).toHaveValue('2026-10-05');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(declare).toHaveBeenCalledWith({ kind: 'busy', from: '2026-10-05', to: '2026-10-08' });
  });

  it('says why when the plan refuses, and keeps the sheet open', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    vi.spyOn(h.stub.actions, 'declareEvent').mockResolvedValue({
      ok: false,
      message: 'There is no safe plan from here, so nothing changed.',
    });
    const sheet = await openAway(user);
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('There is no safe plan from here, so nothing changed.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Busy or away' })).toBeInTheDocument();
  });
});
