/**
 * V1h: a day other than today never offers the welcome-back catch-up. On a future date the gap ran up to that date
 * ("Fill the 1675 missed days in as planned?") and the key would log future days as eaten as planned.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import type { TodayView } from '@/living';
import TodayPage from '../TodayPage';
import { renderLiving } from '../../testing';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

const withWelcome = (v: TodayView): TodayView => ({
  ...v,
  notices: [{ id: 'welcomeBack', kind: 'welcomeBack', level: 'info', text: 'Welcome back, nothing to catch up on.', command: { id: 'log.bulk', input: { days: [{ date: '2026-10-02' }, { date: '2026-10-03' }] } } }],
});

// the zone shows two notices and folds the rest behind a key: open it so every notice is in the document
async function openAllNotices() {
  const zone = await screen.findByRole('region', { name: 'Notices' });
  const more = within(zone).queryAllByRole('button', { expanded: false }).at(-1);
  if (more) fireEvent.click(more);
}

describe('welcome back only on today', () => {
  it('a future day shows no catch-up offer', async () => {
    renderLiving(<TodayPage />, { path: '/today/2026-10-03', route: 'today/:date', source: (stub) => ({ ...stub.source, today: (d) => withWelcome(stub.source.today(d)!) }) });
    await openAllNotices();
    expect(screen.queryByText(/Welcome back/)).toBeNull();
    expect(screen.queryByText(/missed days? in as planned/)).toBeNull();
  });

  it('today still shows it', async () => {
    renderLiving(<TodayPage />, { path: '/today', route: 'today', source: (stub) => ({ ...stub.source, today: (d) => withWelcome(stub.source.today(d)!) }) });
    await openAllNotices();
    expect(await screen.findByText(/Welcome back/)).toBeTruthy();
  });
});
