/**
 * Welcome back (Ember): after a lapse Today opens a one-time sheet ("You missed 2 days" · Fill in as planned / Leave
 * empty) instead of a notice in the page. Answering it — either key, or closing it — is remembered on this device, so
 * the sheet does not come back for that lapse. V1h: a day other than today never offers the catch-up (on a future date
 * the gap ran up to that date and the key would log future days as eaten as planned).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TodayView } from '@/living';
import TodayPage from '../TodayPage';
import { renderLiving } from '../../testing';
import { clearAnsweredLapses } from '../welcomeBack';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const withWelcome = (v: TodayView): TodayView => ({
  ...v,
  notices: [
    ...v.notices,
    {
      id: 'welcomeBack',
      kind: 'welcomeBack',
      level: 'info',
      text: 'Welcome back, nothing to catch up on.',
      command: { id: 'log.bulk', input: { days: [{ date: '2026-09-28' }, { date: '2026-09-29' }] } },
    },
  ],
});

const render = (path: string, route: string) =>
  renderLiving(<TodayPage />, {
    path,
    route,
    source: (stub) => ({ ...stub.source, today: (d) => withWelcome(stub.source.today(d)!) }),
  });

beforeEach(() => clearAnsweredLapses());

describe('welcome back', () => {
  it('a future day shows no catch-up offer', async () => {
    render('/today/2026-10-03', 'today/:date');
    await screen.findByRole('region', { name: /^(Plan|Today)$/ });
    expect(screen.queryByRole('dialog', { name: /You missed/ })).toBeNull();
    expect(screen.queryByText(/Welcome back|Fill in as planned/)).toBeNull();
  });

  it('today opens it once as a sheet; filling in backfills the gap and it does not come back', async () => {
    const h = render('/today', 'today');
    const backfill = vi.spyOn(h.stub.actions, 'backfill');
    const sheet = await screen.findByRole('dialog', { name: 'You missed 2 days' });
    // never a notice between the page's sections
    expect(screen.queryByRole('region', { name: 'Notices' })).toBeNull();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Fill in as planned' })));
    expect(backfill).toHaveBeenCalledWith(['2026-09-28', '2026-09-29']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'You missed 2 days' })).toBeNull());
    h.result.unmount();
    render('/today', 'today');
    await screen.findByRole('region', { name: /^(Plan|Today)$/ });
    expect(screen.queryByRole('dialog', { name: 'You missed 2 days' })).toBeNull();
  });

  it('"Leave empty" answers it too, without logging anything', async () => {
    const h = render('/today', 'today');
    const backfill = vi.spyOn(h.stub.actions, 'backfill');
    const sheet = await screen.findByRole('dialog', { name: 'You missed 2 days' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Leave empty' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'You missed 2 days' })).toBeNull());
    expect(backfill).not.toHaveBeenCalled();
    h.result.unmount();
    render('/today', 'today');
    await screen.findByRole('region', { name: /^(Plan|Today)$/ });
    expect(screen.queryByRole('dialog', { name: 'You missed 2 days' })).toBeNull();
  });
});
