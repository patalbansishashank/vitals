/** The short videos page and the ring's own status card. (r071: split out of `screens.test.tsx`.) */
import './clock';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ringHooks, setupScreens, renderAt, card, today, expectWordsOnly } from './screenKit';

import { setGaugeApi } from '../api';
import { makeGaugeFixture } from '../fixtures';
import { dispatch } from '@/commands/bus';

setupScreens();

describe('Ring screens: videos and device', () => {
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

  it('Short videos: the neutral day hero and its limit editor sends reels.set through Gauge', async () => {
    renderAt('/ring/short-videos');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Short videos' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    // (r071, SPEC Q13) neutral: the count against the limit in plain words, no brain, no stage names
    expect(await screen.findByRole('img', { name: /^\d+ of 30 videos$/, hidden: true })).toBeInTheDocument();
    expect(screen.getByText(/your limit$/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /brain/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Wilted|Cracked|Rotting|rotten|Greying|look at a tree/);
    expect(screen.queryByText('Set on the phone, in Gauge.')).toBeNull();
    const limit = card(/Fri|Thu|Wed|Tue|Mon|Sat|Sun/);
    expect(screen.queryByRole('heading', { name: 'Daily limit' })).toBeNull();
    fireEvent.click(await within(limit).findByRole('button', { name: 'Change limit' }));
    const field = await screen.findByRole('spinbutton', { name: /daily limit/i });
    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await within(limit).findByText('Saved on the phone', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(limit).getByText('Limit 20')).toBeInTheDocument());
  });
  it('keeps an unsent day missing in the hero and in the app history', async () => {
    const api = makeGaugeFixture();
    setGaugeApi({
      ...api,
      shortVideo: async (from, to) => {
        const data = await api.shortVideo(from, to);
        return data ? { ...data, days: data.days.filter((d) => d.date !== today) } : null;
      },
    });
    renderAt('/ring/short-videos');
    await screen.findByRole('heading', { level: 2, name: 'Last 7 days' }, { timeout: 8000 });
    expect(screen.getByText('The phone hasn’t sent today’s count yet.')).toBeInTheDocument();
    expect(document.querySelector('.rgv-bars .lmz-bars__col:last-child')).toHaveAttribute(
      'data-empty',
      'true',
    );
    expect(screen.queryByRole('img', { name: '0 of 30 videos' })).toBeNull();
    fireEvent.click(within(card('Last 7 days')).getByRole('button', { name: 'About Last 7 days' }));
    const panel = await screen.findByRole('dialog', { name: 'Short-video history' });
    expect(within(panel).getByRole('region', { name: 'Last 7 days table' })).toBeInTheDocument();
  });

  it('keeps the day information panel free of counts and countdown digits in quiet mode', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring/short-videos');
    const heading = await screen.findByRole('heading', { level: 2, name: 'This day' }, { timeout: 8000 });
    fireEvent.click(within(heading.closest('section')!).getByRole('button', { name: 'About This day' }));
    const panel = await screen.findByRole('dialog', { name: 'Short videos' });
    expectWordsOnly(panel);
  });
});
