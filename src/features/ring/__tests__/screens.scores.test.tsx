/** Ring › Scores. (r071: split out of `screens.test.tsx`.) */
import './clock';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { dispatch } from '@/commands/bus';
import { useSettingsStore } from '@/state/settingsStore';
import { ringHooks, setupScreens, renderAt, card, expectWordsOnly } from './screenKit';

setupScreens();

describe('Ring screens: scores', () => {
  ringHooks();

  it('Scores: three Vitals heroes name their source, Gauge stays separate, and contributors open from a hero', async () => {
    renderAt('/ring/scores');
    expect(await screen.findByRole('heading', { name: 'Day score' }, { timeout: 8000 })).toBeInTheDocument();
    // Gauge uses a different method: each score names its source on the page.
    const gauge = (await screen.findByRole('heading', { name: 'On-device scores' }, { timeout: 8000 })).closest('section')!;
    expect(within(gauge).getByRole('heading', { name: 'Phone Recovery' })).toBeInTheDocument();
    // The parts are now heroes, so the Day score does not repeat the three rows.
    expect(screen.queryByRole('heading', { name: 'Indices' })).toBeNull();
    const dayCard = card('Day score');
    expect(within(dayCard).queryByRole('list', { name: 'Day score parts' })).toBeNull();
    for (const name of ['Vitals Recovery', 'Vitals Sleep', 'Vitals Activity']) expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    expect(dayCard.querySelector('.lmz-line')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What went into Recovery' }));
    const contributors = await screen.findByRole('dialog', { name: 'What went into Recovery' });
    expect(within(contributors).getByRole('list', { name: /^What went into it/ })).toBeInTheDocument();
    expect(within(contributors).getByRole('region', { name: 'Vitals Recovery table' })).toBeInTheDocument();
    fireEvent.click(within(contributors).getByRole('button', { name: 'Close' }));
    // (r071) the explanation moved into the (i): how the score is made, the sleep share and the part weights
    fireEvent.click(within(dayCard).getByRole('button', { name: 'About Day score' }));
    const panel = await screen.findByRole('dialog', { name: 'How the Day score works' });
    expect(within(panel).getByText(/Sleep carries about \d+\s%/)).toBeInTheDocument();
    expect(within(panel).getByText('Time asleep 50, window continuity 25, midpoint against your usual 25.')).toBeInTheDocument();
    expect(screen.getByText('Last workout load')).toBeInTheDocument();
    expect(screen.queryByText(/Cardio load/)).toBeNull();
  });


  it('Scores in quiet mode keep every score, missing reason and contributor panel in words', async () => {
    await dispatch('settings.update', { patch: { quietMode: true } });
    renderAt('/ring/scores');
    await screen.findByRole('heading', { name: 'On-device scores' }, { timeout: 8000 });
    expectWordsOnly(card('Day score'));
    for (const name of ['Vitals Recovery', 'Vitals Sleep', 'Vitals Activity']) expectWordsOnly(card(name));
    fireEvent.click(screen.getByRole('button', { name: 'What went into Recovery' }));
    expectWordsOnly(await screen.findByRole('dialog', { name: 'What went into Recovery' }));
  });

  it('Scores: the Day-score target editor writes the synced dayScoreTarget through settings.update (Codex UI #26)', async () => {
    renderAt('/ring/scores');
    const day = (
      await screen.findByRole('heading', { level: 2, name: 'Day score' }, { timeout: 8000 })
    ).closest('section')!;
    fireEvent.click(await within(day).findByRole('button', { name: 'Edit target' }));
    // (r068 SC4) a stepper: a typed value out of 0–100 is never committed, so the saved target stays in range
    const input = await screen.findByRole('spinbutton', { name: /target/i });
    expect(input).toHaveValue('70');
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useSettingsStore.getState().dayScoreTarget).toBe(80));
    // (r071) the ring's sentence and the foot both say the new target
    await waitFor(() => expect(within(day).getByRole('meter', { name: 'Day score' }).getAttribute('aria-valuetext')).toMatch(/target 80/));
    expect(within(day).getByText('Target 80')).toBeInTheDocument();
  });

});
