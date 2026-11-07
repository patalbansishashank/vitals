/**
 * Q3-J5-04: a fast can be logged by hand from Today's ⋯ on any day (the fast row only shows when the day's prescription
 * has one). The sheet takes started · ended and dispatches `log.fast` (record) with both instants. Ember: the header is
 * Cancel · "Log a fast" · Log; the length the two ends make is a value in the body ("16 h 30"), and the body holds no
 * commit key.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { dispatch } from '@/commands';
import type * as Commands from '@/commands';
import { renderLiving } from '../../testing';
import { LivingClockContext, fixedClock } from '../../clock';
import { LivingActionsProvider } from '../../data/actions';
import { createCommandLivingActions } from '../../data/commands';
import { FIXTURE_TODAY } from '../../data/fixtures';
import TodayPage from '../TodayPage';
import { FastSheet } from '../components/FastSheet';

vi.mock('@/commands', async (importOriginal) => {
  const m = await importOriginal<typeof Commands>();
  return { ...m, dispatch: vi.fn(m.dispatch) };
});

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const iso = (wall: string) => new Date(wall).toISOString();

// the fixture's now is Thu 1 Oct 2026 13:00
function renderMenu() {
  return renderLiving(
    <>
      <TodayPage />
      <Toaster />
    </>,
    { path: '/today', route: 'today' },
  );
}

async function openFast(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Log a fast' }));
  return screen.findByRole('dialog', { name: 'Log a fast' });
}

const set = (sheet: HTMLElement, label: string, value: string) => fireEvent.change(within(sheet).getByLabelText(label), { target: { value } });
const length = (sheet: HTMLElement) => within(sheet).getByRole('status', { name: 'Length' });

describe('Today ⋯ · Log a fast', () => {
  it('defaults to a 16 h fast ending now and logs the times entered', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const logFast = vi.spyOn(h.stub.actions, 'logFast');
    const sheet = await openFast(user);
    expect(within(sheet).getByLabelText('Started')).toHaveValue('2026-09-30T21:00');
    expect(within(sheet).getByLabelText('Ended')).toHaveValue('2026-10-01T13:00');
    // each end is a date target that reads the day and the time, never the browser's own field
    expect(sheet.querySelectorAll('.lv-date')).toHaveLength(2);
    expect(within(sheet).getByText('Wed 30 Sep · 21:00')).toBeInTheDocument();
    expect(within(sheet).getByText('Thu 1 Oct · 13:00')).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/A fast you did|last thing you ate/);
    // the header carries the commit; the body holds the two ends and the length, never a key of its own
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(sheet.querySelector('.lv-sheet .lm-key')).toBeNull();
    expect(length(sheet)).toHaveTextContent(/^16 h$/);
    set(sheet, 'Started', '2026-09-30T20:00');
    set(sheet, 'Ended', '2026-10-01T12:30');
    expect(length(sheet)).toHaveTextContent('16 h 30');
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    expect(logFast).toHaveBeenCalledWith(iso('2026-09-30T20:00'), iso('2026-10-01T12:30'));
    expect(await screen.findByText('Fast of 16 h 30 logged')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a fast' })).not.toBeInTheDocument());
  });

  it.each([
    ['an end before the start', '2026-10-01T10:00', '2026-10-01T09:00', 'The end has to be after the start.'],
    ['an end later than now', '2026-10-01T00:00', '2026-10-01T14:00', 'The end can’t be later than now.'],
    ['a fast longer than 72 h', '2026-09-27T12:00', '2026-10-01T12:00', 'A fast logged here can be up to 72 hours.'],
  ])('refuses %s and says why', async (_, start, end, message) => {
    const user = userEvent.setup();
    const h = renderMenu();
    const logFast = vi.spyOn(h.stub.actions, 'logFast');
    const sheet = await openFast(user);
    set(sheet, 'Started', start);
    set(sheet, 'Ended', end);
    // the field's error, and the header verb's disabled reason
    expect(within(sheet).getAllByText(message).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole('button', { name: 'Log' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    expect(logFast).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Log a fast' })).toBeInTheDocument();
  });

  it('dispatches log.fast (record) with the last- and first-intake instants', async () => {
    const user = userEvent.setup();
    const d = vi.mocked(dispatch);
    d.mockClear();
    d.mockResolvedValueOnce({ ok: true, output: { entryId: 'e-fast' } } as never);
    const actions = createCommandLivingActions(renderLiving(<></>).stub.source);
    render(
      <LivingClockContext.Provider value={fixedClock(`${FIXTURE_TODAY}T13:00:00`)}>
        <LivingActionsProvider value={actions}>
          <FastSheet onClose={() => undefined} />
          <Toaster />
        </LivingActionsProvider>
      </LivingClockContext.Provider>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Log a fast' });
    set(sheet, 'Started', '2026-09-30T19:45');
    set(sheet, 'Ended', '2026-10-01T11:45');
    expect(length(sheet)).toHaveTextContent(/^16 h$/);
    await user.click(within(sheet).getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(d).toHaveBeenCalledWith('log.fast', { action: 'record', lastIntakeAt: iso('2026-09-30T19:45'), firstIntakeAt: iso('2026-10-01T11:45') }));
    expect(await screen.findByText('Fast of 16 h logged')).toBeInTheDocument();
  });
});
