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

/** Shape › Fine-tune shape: where it sits, muscle and measurements wait behind it. */
async function openFineTune() {
  const key = await screen.findByRole('button', { name: 'Fine-tune shape' });
  if (key.getAttribute('aria-expanded') !== 'true') await userEvent.click(key);
}

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

  it('renders every section; Shape opens with every scale out, Fine-tune shape open', async () => {
    seedBody();
    renderAt('/body');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your body' })).toBeInTheDocument();
    for (const name of ['Basics', 'Figure', 'Estimates', 'Shape', 'Habits', 'Lab values']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    // every shape scale is out, so each one visibly reshapes the figure; the disclosure starts open
    expect(screen.getByRole('slider', { name: 'Body fat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fine-tune shape' })).toHaveAttribute('aria-expanded', 'true');
    // every shape control is a labelled native slider
    for (const name of ['Belly & waist', 'Hips & thighs', 'Upper body', 'Lower body']) {
      expect(screen.getByRole('slider', { name })).toBeInTheDocument();
    }
    // the two measurements: one section, a row each, each switch named for what it uses
    expect(screen.getByRole('heading', { name: 'Measurements' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Use measured waist' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Use measured body fat' })).not.toBeChecked();
    // no helper paragraphs in Shape
    expect(within(document.getElementById('body-shape')!).queryByText(/Start from our estimate|“Expected” is|narrows the range/)).toBeNull();
    // drawing-only controls wait behind Figure › Adjust the drawing; nothing about the drawing sits in Basics
    expect(screen.queryByRole('slider', { name: 'Frame' })).toBeNull();
    expect(within(document.getElementById('body-basics')!).queryByText(/figure|drawing/i)).toBeNull();
    // the figure is an image described by its generated description: shape words, never a "base"
    expect(
      screen.getByRole('img', {
        name: /^Figure, 178 cm, shoulders (clearly|a little) wider than hips\. Estimated body fat \d+ percent, .*\. Muscle as expected for this size\. Drawn in two layers: lean tissue inside, fat as a see-through outer layer\.$/,
      }),
    ).toBeInTheDocument();
    // jsdom has no WebGL2: the SVG figure draws the body
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).toHaveAttribute('data-renderer', 'svg');
    // Estimates: body fat as the hero with its range as a scale, then three smaller readouts (no caption, chip, per-readout
    // helper); the foot says the state and what the scales show
    const est = document.getElementById('body-estimates')!;
    expect(est.querySelector('.lm-hero')).toHaveAttribute('aria-label', expect.stringMatching(/^Body fat \d+\.\d percent, likely \d+\.\d to \d+\.\d$/));
    expect(est.querySelectorAll('.lm-body-est__cell')).toHaveLength(3);
    expect(within(est).queryByText(/likely range = 80 %|based on averages|Not medical advice|Body fat × weight/)).toBeNull();
    expect(est.querySelector('.lm-cardfoot')).toHaveTextContent(/80 % range/i);
    expect(liveText()).toMatch(/^Body fat \d+\.\d percent, likely \d+\.\d to \d+\.\d\. Lean mass \d+\.\d kilograms\.$/);
    // the always-true "saved on this device" is gone; Lab values is one mono line and a pill until something is entered
    expect(screen.queryByText(/saved on this device/)).toBeNull();
    const labs = document.getElementById('body-labs')!;
    expect(within(labs).getByText('No lab values')).toBeInTheDocument();
    expect(within(labs).getByRole('button', { name: 'Add lab values' })).toBeInTheDocument();
    expect(within(labs).getByRole('link', { name: 'Blood markers in Progress' })).toHaveAttribute('href', '/progress#markers');
  });

  it('gives every card one (i), named for it, and no other key in its head', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    for (const [id, title] of [
      ['body-figure', 'Figure'],
      ['body-estimates', 'Estimates'],
      ['body-shape', 'Shape'],
      ['body-basics', 'Basics'],
      ['body-maintenance', 'Maintenance'],
      ['body-habits', 'Habits'],
      ['body-labs', 'Lab values'],
    ] as const) {
      const head = document.getElementById(id)!.querySelector<HTMLElement>('.lm-cardhead')!;
      const keys = within(head).queryAllByRole('button').filter((b) => !b.classList.contains('lm-gcard__open'));
      expect(keys.map((k) => k.getAttribute('aria-label')), id).toEqual([`About ${title}`]);
    }
  });

  it('opens a card\'s (i) as a panel with its source and range, and the figure\'s with a link to how it is drawn', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    await userEvent.click(screen.getByRole('button', { name: 'About Estimates' }));
    const panel = await screen.findByRole('dialog', { name: 'How these are estimated' });
    expect(within(panel).getAllByText(/80 % range/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('Where this comes from')).toBeInTheDocument();
    expect(within(panel).getByText('Range')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'How these are estimated' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'About Figure' }));
    const figurePanel = await screen.findByRole('dialog', { name: 'About the figure' });
    expect(within(figurePanel).getByRole('link', { name: /How this is drawn/ }).getAttribute('href')).toMatch(/body-composition-estimation/);
  });

  it('lays plain Your body out as two independent stacks: the figure, its estimates, maintenance and labs left; Shape beside the figure, then basics and habits', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const cols = document.querySelector('.lm-body-cols')!;
    const [left, right] = Array.from(cols.querySelectorAll(':scope > .lm-body-stack'));
    expect(cols.querySelectorAll(':scope > .lm-body-stack')).toHaveLength(2);
    for (const id of ['body-figure', 'body-estimates', 'body-maintenance', 'body-labs']) expect(left!.querySelector(`#${id}`), id).not.toBeNull();
    // Shape heads the right stack (beside the figure); Basics and Habits are normal cards under it (r068 V-BD-3)
    expect(right!.firstElementChild?.id).toBe('body-shape');
    for (const id of ['body-basics', 'body-habits']) expect(right!.querySelector(`#${id}`), id).not.toBeNull();
    expect(Array.from(cols.children).every((c) => c.classList.contains('lm-body-stack'))).toBe(true);
    expect(document.getElementById('body-setup')).toBeNull();
  });

  it('puts no bar on the tab page: in Planning mode the navigation holds Simulate and Plan, so the header has no way-on keys', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    expect(document.querySelector('.lm-actionbar')).toBeNull();
    const header = document.querySelector<HTMLElement>('.lm-ctx-slot')!;
    expect(within(header).queryByRole('link', { name: /Find plans|Simulate a plan/ })).toBeNull();
    // no ⋯ at all: the header's ⋯ holds a page's own actions only (r068 U14), and this page has none here
    expect(screen.queryAllByRole('button', { name: 'More' })).toHaveLength(0);
  });

  it('gives maintenance one home: its own card, not a fifth readout in Estimates', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const est = document.getElementById('body-estimates')!;
    expect(/maintenance/i.test(est.textContent ?? '')).toBe(false);
    expect(document.getElementById('body-maintenance')!.querySelector('.lm-hero')).not.toBeNull();
  });

  it('keeps the figure card to its title and (i), a switch row, the layer row; no caption; Adjust the drawing sits under the layers', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const card = document.getElementById('body-figure')!;
    const head = card.querySelector<HTMLElement>('.lm-cardhead')!;
    // header: the title and the (i), nothing else; the figure / visceral switch is its own row over the stage
    expect(head.textContent).toBe('Figure');
    expect(within(head).getAllByRole('button')).toHaveLength(1);
    const bank = card.querySelector<HTMLElement>('.lm-body-viewbank')!;
    expect(within(bank).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Figure', 'Visceral']);
    // "Load detailed figure" is the foot's link, not a head key
    expect(within(head).queryByRole('button', { name: /Load detailed figure/ })).toBeNull();
    // no how-to or disclaimer caption under the figure
    expect(card.querySelector('figcaption')).toBeNull();
    expect(within(card).queryByText(/Drag the figure|Illustrative figure|reference anatomy/)).toBeNull();
    // the drawing's own controls open in place, in the figure card (no jump down the page)
    const adjust = within(card).getByRole('button', { name: 'Adjust the drawing' });
    expect(adjust).toHaveAttribute('aria-expanded', 'false');
    expect(within(document.getElementById('body-shape')!).queryByRole('button', { name: 'Adjust the drawing' })).toBeNull();
    // credits live in Settings › About, not on the figure
    expect(within(card).queryByText(/3D model credits/i)).toBeNull();
    expect(card.querySelector('a[href$="NOTICE.html"]')).toBeNull();
  });

  it('updates the estimates live when a shape slider moves by keyboard', async () => {
    seedBody();
    renderAt('/body');
    const slider = await screen.findByRole('slider', { name: 'Body fat' });
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
    await openFineTune();
    const belly = screen.getByRole('slider', { name: 'Belly & waist' });
    const shareBefore = belly.getAttribute('aria-valuetext');
    fireEvent.keyDown(belly, { key: 'End' });
    // the share comes from the engine, so it follows the thumb on the next frame (and again on the write)
    await waitFor(() => expect(belly.getAttribute('aria-valuetext')).not.toBe(shareBefore));
    expect(belly).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Belly and waist: \d+ percent of your body fat$/));

    // Reset to estimate clears every touched shape slider
    await userEvent.click(screen.getByRole('button', { name: 'Reset to estimate' }));
    expect(store().shape).toEqual({});
  });

  it('shows a measured waist and locks the belly scale', async () => {
    seedBody();
    renderAt('/body');
    await openFineTune();
    expect(screen.queryByRole('slider', { name: 'Waist at the top of the hip bones' })).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Use measured waist' }));
    expect(store().waist.use).toBe(true);
    expect(store().waist.cm).not.toBeNull();
    expect(screen.getByRole('slider', { name: 'Waist at the top of the hip bones' })).toBeInTheDocument();
    expect(screen.getAllByText(/set by your waist measurement/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('slider', { name: 'Belly & waist' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('?focus=waist opens Fine-tune shape and focuses the waist switch', async () => {
    seedBody();
    renderAt('/body?focus=waist');
    const toggle = await screen.findByRole('switch', { name: 'Use measured waist' });
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(screen.getByRole('button', { name: 'Fine-tune shape' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('switches to imperial without changing what is stored', async () => {
    seedBody();
    renderAt('/body');
    await userEvent.click(await screen.findByRole('radio', { name: 'Imperial' }));
    const weight = screen.getByRole('spinbutton', { name: 'Weight' });
    expect(weight).toHaveValue('187.2');
    // re-committing the shown value is not a change
    await userEvent.click(weight);
    await userEvent.keyboard('{Enter}');
    fireEvent.blur(weight);
    expect(store().weightKg).toBe(84.9);
    await userEvent.click(screen.getByRole('radio', { name: 'Metric' }));
    expect(screen.getByRole('spinbutton', { name: 'Weight' })).toHaveValue('84.9');
  });

  it('first run: basics → shape → the intake (a normal day …) → what we will use → choose a start', async () => {
    act(() => store().resetBody());
    const router = renderAt('/body');
    // an unfinished setup returns to its step
    await waitFor(() => expect(router.state.location.search).toBe('?setup=basics'));
    expect(await screen.findByRole('list', { name: 'Setup progress' })).toBeInTheDocument();
    // step 1: the four inputs first, no intro; the figure (following height, weight and sex) and the estimates after
    // them; a focused flow, so its keys dock at the foot (no navigation pill while no plan is live)
    expect(screen.queryByText(/Four facts the equations need/)).toBeNull();
    const basicsCard = document.getElementById('body-basics')!;
    expect(basicsCard.compareDocumentPosition(document.getElementById('body-figure')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById('body-estimates')).not.toBeNull();
    // read-only there: the drawing's controls come with the scales at step 2
    expect(screen.queryByRole('button', { name: /Adjust the drawing/ })).toBeNull();
    await waitFor(() => expect(document.querySelector('.lm-actionbar-slot[data-docked]')).not.toBeNull());
    const next = () => screen.getAllByRole('button', { name: 'Next: shape' })[0]!;
    expect(screen.getAllByRole('button', { name: 'Next: shape' })).toHaveLength(1);
    expect(next()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Sex' })).getByRole('radio', { name: 'Female' }));
    for (const [name, value] of [
      ['Age', '41'],
      ['Height', '166'],
      ['Weight', '68.5'],
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
    expect(screen.getByRole('slider', { name: 'Body fat' })).toBeInTheDocument();
    // labels only: the shape card opens on its scale, no instruction line above it
    expect(screen.queryByText(/match the figure/i)).toBeNull();
    // inputs first: the shape card comes before the figure
    const shapeCard = document.getElementById('body-shape')!;
    expect(shapeCard.compareDocumentPosition(document.getElementById('body-figure')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

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
    // the page title is the step; two ways on, nothing else
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a start' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find plans' })).toHaveAttribute('href', '/plan/goals');
    expect(screen.getByRole('link', { name: 'Simulate a plan' })).toHaveAttribute('href', '/simulate');
    expect(screen.queryByRole('link', { name: 'Back to Your body' })).toBeNull();
  });

  it('gentle mode hides the figure and tucks the estimates\' numbers behind "Show numbers"', async () => {
    seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes' });
    seedBody();
    renderAt('/body');
    expect(await screen.findByText(/The figure is hidden in gentle mode/)).toBeInTheDocument();
    const est = document.querySelector('.lm-body-est') as HTMLElement;
    // words and a picture: no body-fat or lean-mass number, no cell of readouts
    expect(est.textContent).not.toMatch(/\d/);
    expect(est.querySelectorAll('.lm-body-est__cell')).toHaveLength(0);
    await userEvent.click(within(est).getByRole('button', { name: 'Show numbers' }));
    expect(within(est).getByText('Fat mass')).toBeInTheDocument();
    expect(within(est).getByText('Lean mass')).toBeInTheDocument();
    expect(est.querySelector('.lm-hero')?.getAttribute('aria-label')).toMatch(/^Body fat \d/);
  });

  it('keeps the shape sliders when Settings hides the figure', async () => {
    seedBody();
    act(() => useSettingsStore.getState().set({ showFigure: false }));
    renderAt('/body');
    expect(await screen.findByText(/Your estimates still use the shape sliders/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Figure,/ })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Body fat' })).toBeInTheDocument();
  });

  it('Adjust the drawing: the frame slider speaks in shape words, never sex or gender words', async () => {
    seedBody();
    renderAt('/body');
    await screen.findByRole('slider', { name: 'Body fat' });
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the drawing' }));
    const slider = await screen.findByRole('slider', { name: 'Frame' });
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
    await screen.findByRole('slider', { name: 'Body fat' });
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).not.toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Visceral' }));
    expect(await screen.findByText(/Drawn to scale from your estimate/)).toBeInTheDocument();
    expect(document.querySelector('.lm-body-stage .lm-fig3d')).toBeNull();
    const how = screen.getByRole('link', { name: /How this is drawn/ });
    expect(how.getAttribute('href')).toMatch(/body-composition-estimation/);
    await userEvent.click(screen.getByRole('radio', { name: 'Figure' }));
    expect(await screen.findByRole('img', { name: /^Figure,/ })).toBeInTheDocument();
  });
});
