import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { seedClearedSafety, STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { flushBodyPersistence, useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';

// The first render pulls the whole lazy route graph through the transformer: give a loaded machine room.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

// jsdom has no scrolling; the router's ScrollRestoration and deep links call these.
window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const store = () => useProfileStore.getState();

function seedBody() {
  act(() => {
    store().resetBody();
    store().setSex('male');
    store().setAge(36);
    store().setHeight(178);
    store().setWeight(84.9);
    store().setSetup('done');
  });
}

/** The polite live region under Estimates (updated on release / key step). */
const liveText = () => document.querySelector('.lm-body-est [aria-live="polite"]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  act(() => useSettingsStore.getState().set({ units: 'metric', showFigure: true }));
  seedClearedSafety();
});

afterEach(() => flushBodyPersistence());

describe('Your body page', () => {
  it('names every image on the page (the figure is named by its <title>, not by an aria-label attribute)', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(img, img.outerHTML.slice(0, 120)).toHaveAccessibleName(/\S/);
  });

  it('renders every section and the persistent disclaimer next to the estimates', async () => {
    seedBody();
    renderAt('/body');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your body' })).toBeInTheDocument();
    for (const name of ['Basics', 'Figure', 'Estimates', 'Shape', 'Habits', 'Lab values']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    // every shape control is a labelled native slider
    for (const name of ['body fat', 'belly & waist', 'hips & thighs', 'upper body', 'lower body', 'waist at the top of the hip bones']) {
      expect(screen.getByRole('slider', { name })).toBeInTheDocument();
    }
    // drawing-only controls wait behind Shape › Adjust the drawing; nothing about the drawing sits in Basics
    expect(screen.queryByRole('slider', { name: 'frame' })).toBeNull();
    expect(within(document.getElementById('body-basics')!).queryByText(/figure|drawing/i)).toBeNull();
    // the figure is an image described by its generated description: shape words, never a "base"
    expect(
      screen.getByRole('img', {
        name: /^Figure, 178 cm, shoulders (clearly|a little) wider than hips\. Estimated body fat \d+ percent, .*\. Muscle as expected for this size\. Drawn in two layers: lean tissue inside, fat as a see-through outer layer\.$/,
      }),
    ).toBeInTheDocument();
    // jsdom has no WebGL2: the SVG figure draws the body
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).toHaveAttribute('data-renderer', 'svg');
    expect(screen.getByText(/Not medical advice/)).toBeInTheDocument();
    expect(liveText()).toMatch(/^Body fat \d+\.\d percent, likely \d+\.\d to \d+\.\d\. Lean mass/);
  });

  it('lays plain Your body out as two independent stacks with Maintenance as a card in one of them; both plan keys live in the action bar, not in a card', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const cols = document.querySelector('.lm-body-cols')!;
    const [left, right] = Array.from(cols.querySelectorAll(':scope > .lm-body-stack'));
    expect(cols.querySelectorAll(':scope > .lm-body-stack')).toHaveLength(2);
    for (const id of ['body-figure', 'body-estimates', 'body-basics', 'body-habits', 'body-labs']) expect(left!.querySelector(`#${id}`), id).not.toBeNull();
    // Maintenance is a normal card in the right stack, at the same width as its neighbours (no full-width row)
    for (const id of ['body-shape', 'body-maintenance']) expect(right!.querySelector(`#${id}`), id).not.toBeNull();
    expect(Array.from(cols.children).every((c) => c.classList.contains('lm-body-stack'))).toBe(true);
    expect(document.getElementById('body-setup')).toBeNull();
    expect(document.querySelector('.lm-body-continue')).toBeNull();
    expect(document.querySelector('.lm-body-halves')).toBeNull();
    // the two keys: Simulate a plan, then Find a plan as the primary
    const keys = Array.from(document.querySelectorAll('.lm-actionbar a')).filter((a) => /^(Simulate a plan|Find a plan)$/.test(a.textContent?.trim() ?? ''));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const find = keys.find((a) => a.textContent?.trim() === 'Find a plan')!;
    expect(find.getAttribute('data-variant')).toBe('solid');
    expect(find.getAttribute('href')).toBe('/plan/goals');
    expect(keys.find((a) => a.textContent?.trim() === 'Simulate a plan')!.getAttribute('href')).toBe('/simulate');
  });

  it('shows the same maintenance number in Estimates and in the Maintenance card', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const est = document.getElementById('body-estimates')!;
    const maint = document.getElementById('body-maintenance')!;
    const num = (el: HTMLElement) => {
      const r = Array.from(el.querySelectorAll('.lm-readout')).find((x) => /^maintenance/.test(x.textContent ?? ''))!;
      return r.querySelector('.lm-readout__value')!.textContent!.replace(/\s|\u00a0|\u202f/g, '').replace(/kcal.*/, '');
    };
    await waitFor(() => expect(num(est)).toMatch(/^\d+$/));
    expect(num(maint)).toBe(num(est));
  });

  it('keeps the figure card header to the title and switch; the how-to sits in the caption under the figure, with no credits link', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const card = document.getElementById('body-figure')!;
    const head = card.querySelector('.lm-face-head')!;
    // header: the title and the figure / visceral switch, nothing else
    expect(head.querySelector('.lm-eng')).toBeNull();
    expect(head.textContent).toBe('Figurefigurevisceral');
    // caption: the how-to joins the illustrative-figure note (jsdom has no WebGL2: the flat figure's wording)
    const caption = card.querySelector('figcaption')!;
    expect(caption.textContent).toMatch(
      /^Drag the figure to change its shape, or use the sliders\. Illustrative figure\. Shows proportions from your inputs, not your exact shape\./,
    );
    expect(caption.textContent).toMatch(/Muscles and bones show reference anatomy\.$/);
    // credits live in Settings › About, not on the figure
    expect(within(card).queryByText(/3D model credits/i)).toBeNull();
    expect(card.querySelector('a[href$="NOTICE.html"]')).toBeNull();
  });

  it('updates the estimates live when a shape slider moves by keyboard', async () => {
    seedBody();
    renderAt('/body');
    const slider = await screen.findByRole('slider', { name: 'body fat' });
    const before = liveText();
    const fatBefore = /Body fat (\d+\.\d)/.exec(before)?.[1];
    expect(store().shape.bodyFatPct).toBeUndefined();

    const startValue = Number((slider as HTMLInputElement).value);
    const writes: Array<number | undefined> = [];
    const unsubscribe = useProfileStore.subscribe((st, prev) => {
      if (st.shape.bodyFatPct !== prev.shape.bodyFatPct) writes.push(st.shape.bodyFatPct);
    });

    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true }); // −1.0 point
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(slider, { key: 'PageDown' }); // −5 points (major tick)

    // the thumb moved at once (three steps add up); nothing is written until the keys rest for 150 ms
    expect(Number((slider as HTMLInputElement).value)).toBeCloseTo(startValue - 7, 1);
    expect(store().shape.bodyFatPct).toBeUndefined();
    // then one write with the final value: the slider is now "touched" and stored; the estimate moved toward it
    await waitFor(() => expect(store().shape.bodyFatPct).toBeDefined());
    unsubscribe();
    expect(writes).toHaveLength(1);
    expect(store().shape.bodyFatPct).toBeCloseTo(startValue - 7, 1);
    const after = liveText();
    const fatAfter = /Body fat (\d+\.\d)/.exec(after)?.[1];
    expect(Number(fatAfter)).toBeLessThan(Number(fatBefore));
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^body fat on the figure \d+\.\d percent\. Estimate \d+\.\d percent/));
    // the figure is drawn at the value you set, and the body-fat slider's own note says how that relates to the
    // estimate: one note there (not the usual hint), a polite live region, never under the figure
    const note = screen.getByText(/The figure shows .* as you set it/);
    expect(note).toHaveAttribute('aria-live', 'polite');
    expect(note.closest('.lm-scale__note')?.id).toBe(slider.getAttribute('aria-describedby'));
    expect(note.closest('#body-figure')).toBeNull();
    expect(document.querySelector('.lm-body-figure__notes')).toBeNull();
    expect(note.closest('.lm-scale__note')).not.toHaveTextContent(/Start from our estimate|reference at/);

    // distribution readout is a share of fat, and moves with the slider
    const belly = screen.getByRole('slider', { name: 'belly & waist' });
    const shareBefore = belly.getAttribute('aria-valuetext');
    fireEvent.keyDown(belly, { key: 'End' });
    // the share comes from the engine, so it follows the thumb on the next frame (and again on the write)
    await waitFor(() => expect(belly.getAttribute('aria-valuetext')).not.toBe(shareBefore));
    expect(belly).toHaveAttribute('aria-valuetext', expect.stringMatching(/^belly and waist: \d+ percent of your body fat$/));

    // Reset to estimate clears every touched shape slider
    await userEvent.click(screen.getByRole('button', { name: 'Reset to estimate' }));
    expect(store().shape).toEqual({});
  });

  it('shows a measured waist and locks the belly scale', async () => {
    seedBody();
    renderAt('/body');
    const toggle = await screen.findByRole('switch', { name: 'use measurement' });
    await userEvent.click(toggle);
    expect(store().waist.use).toBe(true);
    expect(store().waist.cm).not.toBeNull();
    expect(screen.getAllByText(/set by your waist measurement/).length).toBeGreaterThan(0);
    expect(screen.getByRole('slider', { name: 'belly & waist' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('switches to imperial without changing what is stored', async () => {
    seedBody();
    renderAt('/body');
    await userEvent.click(await screen.findByRole('radio', { name: 'imperial' }));
    const weight = screen.getByRole('spinbutton', { name: 'weight' });
    expect(weight).toHaveValue('187.2');
    // re-committing the shown value is not a change
    await userEvent.click(weight);
    await userEvent.keyboard('{Enter}');
    fireEvent.blur(weight);
    expect(store().weightKg).toBe(84.9);
    await userEvent.click(screen.getByRole('radio', { name: 'metric' }));
    expect(screen.getByRole('spinbutton', { name: 'weight' })).toHaveValue('84.9');
  });

  it('first run: basics → shape → the intake (a normal day …) → what we will use → choose a start', async () => {
    act(() => store().resetBody());
    const router = renderAt('/body');
    // an unfinished setup returns to its step
    await waitFor(() => expect(router.state.location.search).toBe('?setup=basics'));
    expect(await screen.findByText(/Four facts the equations need/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Setup progress' })).toBeInTheDocument();
    const next = () => screen.getAllByRole('button', { name: 'Next: shape' })[0]!;
    expect(next()).toHaveAttribute('aria-disabled', 'true');
    // estimates wait for the real weight
    expect(screen.getAllByText('needs weight').length).toBeGreaterThan(0);

    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'sex for the physiology equations' })).getByRole('radio', { name: 'female' }));
    for (const [name, value] of [
      ['age', '41'],
      ['height', '166'],
      ['weight', '68.5'],
    ] as const) {
      const input = screen.getByRole('spinbutton', { name });
      await userEvent.clear(input);
      await userEvent.type(input, `${value}{Enter}`);
    }
    expect(store()).toMatchObject({ sex: 'female', ageYears: 41, heightCm: 166, weightKg: 68.5 });
    expect(next()).not.toHaveAttribute('aria-disabled');
    await userEvent.click(next());
    await waitFor(() => expect(router.state.location.search).toBe('?setup=shape'));
    expect(store().setup).toBe('shape');
    expect(screen.getByRole('slider', { name: 'body fat' })).toBeInTheDocument();

    // v0.2: the habits step is retired; the first run continues into the intake
    await userEvent.click(screen.getAllByRole('button', { name: 'Skip for now' })[0]!);
    await waitFor(() => expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/onboarding/activity?from=setup'));
    expect(store().shapeSkipped).toBe(true);
    expect(store().setup).toBe('habits');
    expect(await screen.findByRole('heading', { level: 1, name: 'A normal day' })).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Do you work or study outside the home most weeks?' }).length).toBeGreaterThan(0);
    // an unfinished first run that comes back to Your body resumes in the intake
    act(() => void router.navigate('/body'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/activity'));

    // the summary hands over to "Choose a start"
    act(() => void router.navigate('/onboarding/summary?from=setup'));
    await userEvent.click(await screen.findByRole('button', { name: 'Looks right — continue' }));
    await waitFor(() => expect(router.state.location.search).toBe('?setup=start'));
    expect(store().setup).toBe('done');
    expect(screen.getByRole('heading', { name: 'Choose a start' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Simulate a plan I have in mind' })).toHaveAttribute('href', '/simulate');
    expect(screen.getByRole('link', { name: 'Find a plan for my goals' })).toHaveAttribute('href', '/plan/goals');
  });

  it('gentle mode hides the figure and tucks body-fat numbers behind "show numbers"', async () => {
    seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes' });
    seedBody();
    renderAt('/body');
    expect(await screen.findByText(/The figure is hidden in gentle mode/)).toBeInTheDocument();
    const est = document.querySelector('.lm-body-est') as HTMLElement;
    expect(within(est).queryByText('body fat')).toBeNull();
    expect(within(est).getByText('maintenance')).toBeInTheDocument();
    await userEvent.click(within(est).getByRole('button', { name: 'show numbers' }));
    expect(within(est).getByText('body fat')).toBeInTheDocument();
  });

  it('keeps the shape sliders when Settings hides the figure', async () => {
    seedBody();
    act(() => useSettingsStore.getState().set({ showFigure: false }));
    renderAt('/body');
    expect(await screen.findByText(/Your estimates still use the shape sliders/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Figure,/ })).toBeNull();
    expect(screen.getByRole('slider', { name: 'body fat' })).toBeInTheDocument();
  });

  it('Adjust the drawing: the frame slider speaks in shape words, never sex or gender words', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('slider', { name: 'body fat' });
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the drawing' }));
    const slider = await screen.findByRole('slider', { name: 'frame' });
    const text = slider.getAttribute('aria-valuetext') ?? '';
    expect(text).toMatch(/hips|shoulders|balanced|even/i);
    const region = slider.closest('.lm-frame') as HTMLElement;
    expect(`${text} ${region.textContent}`).not.toMatch(/\b(male|female|men|man|women|woman|masculine|feminine|gender|sex)\b/i);
    // a keyboard step writes profile.figure.frame; "Match my basics" puts it back to null
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(store().figure.frame).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Match my basics' }));
    await waitFor(() => expect(store().figure.frame).toBeNull());
  });

  it('the stage bar swaps the figure for the visceral view, with a link to how it is drawn', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('slider', { name: 'body fat' });
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).not.toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'visceral' }));
    expect(await screen.findByText(/Drawn to scale from your estimate/)).toBeInTheDocument();
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).toBeNull();
    const how = screen.getByRole('link', { name: /How this is drawn/ });
    expect(how.getAttribute('href')).toMatch(/body-composition-estimation/);
    await userEvent.click(screen.getByRole('radio', { name: 'figure' }));
    expect(await screen.findByRole('img', { name: /^Figure,/ })).toBeInTheDocument();
  });
});
