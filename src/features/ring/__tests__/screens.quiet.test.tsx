/** Quiet mode across the Overview's cards: words only, no digits. (r071: split out of `screens.test.tsx`.) */
import './clock';
import { screen, waitFor, within } from '@testing-library/react';
import { dispatch } from '@/commands/bus';
import { ringHooks, setupScreens, renderAt, card, expectWordsOnly } from './screenKit';

setupScreens();

describe('Ring screens: quiet', () => {
  ringHooks();

  it('quiet mode: no kcal, no Day score digits, no score histories', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring');
    const disc = (
      await screen.findByRole('heading', { level: 2, name: 'Day score' }, { timeout: 8000 })
    ).closest('section')!;
    await within(disc).findByRole('meter', { name: 'Day score' });
    expect(within(disc).queryByText(/^\d+$/)).toBeNull();
    expect(screen.queryByText('Ring energy estimate')).toBeNull();
    expect(screen.queryByText(/kcal/)).toBeNull();
  });


  // 0.6.3: quiet mode is words only on the Ring's cards, assistive technology included (bed and wake as parts of the
  // day, asleep against the goal as a word, readings as their status words, no counts, ages and syncs in words)
  it('quiet mode: the Activity, Sleep, Signals, body and Short videos cards carry no digits, aria included', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring');
    await screen.findByRole('heading', { level: 1, name: 'Ring' }, { timeout: 8000 });
    const names = ['Activity', 'Sleep', 'Signals', 'Short videos'];
    for (const n of names) await screen.findByRole('heading', { level: 2, name: n }, { timeout: 8000 });
    // let every card's questions answer
    await waitFor(() =>
      expect(within(card('Sleep')).getByText(/^Fell asleep (in the|early|late)/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(within(card('Short videos')).getByText(/./, { selector: '.rgv-word, .lm-hero__word' })).toBeInTheDocument(),
    );
    for (const n of names) expectWordsOnly(card(n));
    // The two parts of the day stay together on one readable fact line.
    expect(within(card('Sleep')).getByText(/Fell asleep (in the|early|late).* · Woke (in the|early|late)/, { selector: '.lm-overflow__item' })).toBeInTheDocument();
  });
});
