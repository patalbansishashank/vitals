/** The Social time page and the ring's own status card. (social-time: replaced the short-video page here.) */
import './clock';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ringHooks, setupScreens, renderAt, today, expectWordsOnly } from './screenKit';

import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import { dispatch } from '@/commands/bus';

setupScreens();

describe('Ring screens: social time and device', () => {
  ringHooks();

  it('Ring status: "Check for updates" asks Gauge and shows the outcome', async () => {
    renderAt('/ring');
    const ring = (await screen.findByRole('heading', { level: 2, name: 'Ring' }, { timeout: 8000 })).closest(
      'section',
    )!;
    fireEvent.click(await within(ring).findByRole('button', { name: 'Check for updates' }));
    expect(
      await within(ring).findByText('The ring app is up to date (2.8.0)', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('Social time: the day hero, the target band and the per-app split in (i)', async () => {
    const api = makeGaugeFixture();
    setGaugeApi({
      ...api,
      socialTime: async (from, to) => {
        const data = await api.socialTime!(from, to);
        if (!data) return null;
        const days = data.days.map((d) => (d.date === today ? { ...d, totalSeconds: 1980, perApp: { instagram: 1200, youtube: 780 } } : d));
        return { ...data, days: days.some((d) => d.date === today) ? days : [...days, { date: today, totalSeconds: 1980, perApp: { instagram: 1200, youtube: 780 }, targetMinMinutes: 30, targetMaxMinutes: 45 }] };
      },
    });
    renderAt('/ring/social');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Social time' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    // the day's minutes as the hero (quiet, non-judging: minutes in social apps today)
    const hero = await screen.findByRole('img', { name: /min in social apps today$/, hidden: true });
    const dayCard = hero.closest('section')!;
    // the target band is named, not shamed
    expect(screen.getAllByText(/Daily target 30.45/).length).toBeGreaterThan(0);
    // the per-app split lives behind (i), never on the card as subtext
    fireEvent.click(within(dayCard).getByRole('button', { name: /^About / }));
    const panel = await screen.findByRole('dialog', { name: 'Social time' });
    expect(within(panel).getByRole('heading', { name: 'By app' })).toBeInTheDocument();
  });

  it('keeps an unsent day missing in the hero', async () => {
    const api = makeGaugeFixture();
    setGaugeApi({
      ...api,
      socialTime: async (from, to) => {
        const data = await api.socialTime!(from, to);
        return data ? { ...data, days: data.days.filter((d) => d.date !== today) } : null;
      },
    });
    renderAt('/ring/social');
    await screen.findByRole('heading', { level: 2, name: 'Last 7 days' }, { timeout: 8000 });
    expect(screen.getByText('No social time sent for today yet.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('img', { name: /in social apps today$/ })).toBeNull());
  });

  it('keeps the day information panel free of numbers in quiet mode', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring/social');
    const heading = await screen.findByRole('heading', { level: 2, name: 'This day' }, { timeout: 8000 });
    fireEvent.click(within(heading.closest('section')!).getByRole('button', { name: 'About This day' }));
    const panel = await screen.findByRole('dialog', { name: 'Social time' });
    expectWordsOnly(panel);
  });
});
