/**
 * Q3-J5-04: a fast can be logged by hand from the Today menu on any day (the fast row only shows when the day's
 * prescription has one). The sheet takes last ate · first ate and dispatches `log.fast` (record) with both instants.
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
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import { TodayMenu } from '../components/TodayMenu';
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
      <TodayMenu plan={fixturePlan(FIXTURE_TODAY)} today={FIXTURE_TODAY} onCheckIn={() => undefined} />
      <Toaster />
    </>,
  );
}

async function openFast(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Today menu' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Log a fast…' }));
  return screen.findByRole('dialog', { name: 'Log a fast' });
}

const set = (sheet: HTMLElement, label: string, value: string) => fireEvent.change(within(sheet).getByLabelText(label), { target: { value } });

describe('Today menu · Log a fast…', () => {
  it('defaults to a 16 h fast ending now and logs the times entered', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const logFast = vi.spyOn(h.stub.actions, 'logFast');
    const sheet = await openFast(user);
    expect(within(sheet).getByLabelText('last ate (fast started)')).toHaveValue('2026-09-30T21:00');
    expect(within(sheet).getByLabelText('first ate (fast ended)')).toHaveValue('2026-10-01T13:00');
    set(sheet, 'last ate (fast started)', '2026-09-30T20:00');
    set(sheet, 'first ate (fast ended)', '2026-10-01T12:30');
    expect(within(sheet).getByText('A fast of 16 h 30.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Log fast' }));
    expect(logFast).toHaveBeenCalledWith(iso('2026-09-30T20:00'), iso('2026-10-01T12:30'));
    expect(await screen.findByText('Fast of 16 h 30 logged.')).toBeInTheDocument();
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
    set(sheet, 'last ate (fast started)', start);
    set(sheet, 'first ate (fast ended)', end);
    // the field's error, and the key's disabled reason
    expect(within(sheet).getAllByText(message).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole('button', { name: 'Log fast' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Log fast' }));
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
    set(sheet, 'last ate (fast started)', '2026-09-30T19:45');
    set(sheet, 'first ate (fast ended)', '2026-10-01T11:45');
    await user.click(within(sheet).getByRole('button', { name: 'Log fast' }));
    await waitFor(() => expect(d).toHaveBeenCalledWith('log.fast', { action: 'record', lastIntakeAt: iso('2026-09-30T19:45'), firstIntakeAt: iso('2026-10-01T11:45') }));
    expect(await screen.findByText('Fast of 16 h logged.')).toBeInTheDocument();
  });
});
