/**
 * Your body in quiet mode (r071, SPEC Q7). Body used to read only the safety "gentle" mode, so a person with quiet mode on
 * still saw body fat, fat and lean mass, maintenance kcal, weight and lab values here. Now every reading waits behind words
 * and pictures, and "Show numbers" brings them back for one card. The switch is the real one: Settings › Appearance, then a
 * navigation to /body, never a store write that skips the setting's own path. Inputs the person types (the Basics steppers,
 * the Shape scales, Habits) stay as they are: they are what the person set, not a reading.
 */
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { seedClearedSafety, STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { flushBodyPersistence, useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';

vi.setConfig({ testTimeout: 40_000 });
configure({ asyncUtilTimeout: 15_000 });

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

const store = () => useProfileStore.getState();

function seedBody() {
  act(() => {
    store().resetBody();
    store().setSex('male');
    store().setAge(36);
    store().setHeight(178);
    store().setWeight(84.9);
    store().setLabs({ ldlMmolL: 3.4, hdlMmolL: 1.2, hba1cPct: 5.4 });
    store().setSetup('done');
  });
}

/** Quiet mode through the setting's own switch, then Your body. */
async function openBodyQuiet() {
  const router = createMemoryRouter(routes, { initialEntries: ['/settings/appearance'] });
  render(<RouterProvider router={router} />);
  const sw = await screen.findByRole('switch', { name: 'Quiet mode' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(sw);
  await waitFor(() => expect(useSettingsStore.getState().quietMode).toBe(true));
  await act(async () => void router.navigate('/body'));
  await screen.findByRole('heading', { level: 1, name: 'Your body' });
  return router;
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');
const card = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  // a fresh document store and default settings: a test that turns quiet mode on must not leave it on for the next
  freshState();
  seedClearedSafety();
  seedBody();
});

afterEach(() => flushBodyPersistence());

describe('Your body with quiet mode on (the real switch)', () => {
  it('Estimates is a word and a picture: no number from a reading, for the eye or the ear', async () => {
    await openBodyQuiet();
    const est = card('body-estimates');
    expect(text(est)).not.toMatch(/\d/);
    expect(est.querySelectorAll('.lm-body-est__cell')).toHaveLength(0);
    for (const el of est.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label'), el.outerHTML.slice(0, 80)).not.toMatch(/\d/);
    // the polite live region says that the estimates moved, never to what
    expect(document.querySelector('.lm-body-est [aria-live="polite"]')?.textContent).toBe('Estimates updated.');
    // "Show numbers" is this card's key and brings the numbers back for it
    await userEvent.click(within(est).getByRole('button', { name: 'Show numbers' }));
    expect(est.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/^Body fat \d+\.\d percent/);
    expect(est.querySelectorAll('.lm-body-est__cell')).toHaveLength(3);
    // the setting itself is untouched
    expect(useSettingsStore.getState().quietMode).toBe(true);
  });

  it('Figure: still drawn, named without a number, and with no visceral view (every number on it is an area or a mass)', async () => {
    await openBodyQuiet();
    const fig = card('body-figure');
    const picture = within(fig).getByRole('img', { name: /^Figure, / });
    expect(picture.getAttribute('aria-label') ?? picture.querySelector('title')?.textContent ?? '').not.toMatch(/\d/);
    expect(fig.querySelector('.lm-body-viewbank')).toBeNull();
    expect(within(fig).queryByRole('radio', { name: 'Visceral' })).toBeNull();
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).not.toBeNull();
  });

  it('Maintenance: a word line, the parts by name, no kcal, and the one unknown said without its number', async () => {
    await openBodyQuiet();
    const maint = card('body-maintenance');
    expect(text(maint)).toContain('Set from your answers');
    expect(text(maint)).not.toMatch(/\d/);
    expect(maint.querySelector('.lm-hero')).toBeNull();
    expect(maint.querySelector('.lm-body-iv')).toBeNull();
    // the bar's own name lists the parts without amounts
    const bar = within(maint).getByRole('img', { name: /^What your maintenance is made of/i });
    expect(bar.getAttribute('aria-label')).not.toMatch(/\d/);
    // "Show numbers" brings the number back for this card
    await userEvent.click(within(maint).getByRole('button', { name: 'Show numbers' }));
    expect(maint.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/\d/);
    expect(text(maint)).toMatch(/\d kcal/);
  });

  it('Lab values keep their names and wait behind "Show numbers"', async () => {
    await openBodyQuiet();
    const labs = card('body-labs');
    expect(within(labs).getByText('LDL cholesterol')).toBeInTheDocument();
    // the only digit left is the one in a name ("HbA1c"), never in a value
    expect(text(labs).replace(/HbA1c/g, '')).not.toMatch(/\d/);
    expect(within(labs).getAllByText('Hidden')).toHaveLength(3);
    await userEvent.click(within(labs).getByRole('button', { name: 'Show numbers' }));
    expect(within(labs).getByText(/3\.40 mmol\/L/)).toBeInTheDocument();
    expect(within(labs).getByText(/5\.4 %/)).toBeInTheDocument();
  });

  it('Shape: the slider says the value you set and nothing from the estimate', async () => {
    await openBodyQuiet();
    const slider = await screen.findByRole('slider', { name: 'Body fat' });
    const spoken = slider.getAttribute('aria-valuetext') ?? '';
    expect(spoken).toMatch(/^body fat on the figure \d+\.\d percent$/);
    expect(spoken).not.toMatch(/Estimate|likely/);
  });

  it('every other card keeps its (i), and the page names no image with a number', async () => {
    await openBodyQuiet();
    for (const title of ['Figure', 'Estimates', 'Shape', 'Basics', 'Maintenance', 'Habits', 'Lab values']) {
      expect(screen.getByRole('button', { name: `About ${title}` }), title).toBeInTheDocument();
    }
  });
});

describe('Your body with quiet mode off', () => {
  it('shows the numbers: the same cards, no "Show numbers" key', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/body'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    expect(card('body-estimates').querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/^Body fat \d+\.\d percent/);
    expect(within(card('body-maintenance')).queryByRole('button', { name: 'Show numbers' })).toBeNull();
    expect(within(card('body-labs')).queryByRole('button', { name: 'Show numbers' })).toBeNull();
    expect(within(card('body-labs')).getByText(/3\.40 mmol\/L/)).toBeInTheDocument();
    expect(within(card('body-figure')).getByRole('radio', { name: 'Visceral' })).toBeInTheDocument();
  });
});

describe('gentle mode with quiet mode switched off', () => {
  it('keeps what it always did (the figure waits, the fat numbers wait) even though the quiet setting says no', async () => {
    seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes' });
    act(() => useSettingsStore.getState().set({ quietMode: false, quietModeSet: true }));
    const router = createMemoryRouter(routes, { initialEntries: ['/body'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/The figure is hidden in gentle mode/)).toBeInTheDocument();
    expect(text(card('body-estimates'))).not.toMatch(/\d/);
    expect(within(card('body-maintenance')).getByRole('button', { name: 'Show numbers' })).toBeInTheDocument();
  });
});

describe('Show numbers is for the moment', () => {
  it('turning quiet mode off and on again brings the words back, not the numbers shown before', async () => {
    const router = await openBodyQuiet();
    await userEvent.click(within(card('body-estimates')).getByRole('button', { name: 'Show numbers' }));
    expect(card('body-estimates').querySelectorAll('.lm-body-est__cell')).toHaveLength(3);
    await act(async () => void router.navigate('/settings/appearance'));
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet mode' }));
    await waitFor(() => expect(useSettingsStore.getState().quietMode).toBe(false));
    await userEvent.click(screen.getByRole('switch', { name: 'Quiet mode' }));
    await waitFor(() => expect(useSettingsStore.getState().quietMode).toBe(true));
    await act(async () => void router.navigate('/body'));
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    expect(text(card('body-estimates'))).not.toMatch(/\d/);
  });
});
