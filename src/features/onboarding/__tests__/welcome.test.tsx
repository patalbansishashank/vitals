import '@/features/charts/test/setupDom'; // uPlot (pulled in by the Planner route) reads matchMedia at import
/**
 * Route guard + the first-run flow through the real route table: redirects, the hard stop, re-consent,
 * import review, and the accessibility contract of the flow (fieldsets/legends, radio groups, polite
 * consequences, aria-disabled Continue with its reason, keyboard: arrows, Enter on the consent box,
 * Ctrl+Enter to continue, focus on each step's heading).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { paths } from '@/app/paths';
import { useSafetyStore } from '@/state/safetyStore';
import { ACK_VERSIONS } from '../copy';
import { STANDARD_ANSWERS, seedClearedSafety } from '../testing';
import { withSystemWrite } from '@/state/scope';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
const where = (r: ReturnType<typeof renderAt>) => `${r.state.location.pathname}${r.state.location.search}`;

// The lazy screens load the command bus and large chunks; load them once up front so cold module loading (seconds under
// a parallel run) does not eat the per-test timeouts.
beforeAll(async () => {
  await import('@/commands');
  await Promise.all([import('../WelcomePage'), import('@/features/evidence/EvidencePage'), import('@/features/settings/SettingsPage'), import('../SafetyLimitsPage'), import('@/features/planner/PlannerPage')]);
}, 120_000);

beforeEach(() => {
  localStorage.clear();
  act(() => useSafetyStore.getState().resetSafety());
});

describe('route guard', () => {
  it('sends first-run visitors from "/" and from the instrument routes to /welcome', async () => {
    for (const path of ['/', '/body', '/simulate', '/plan/goals']) {
      const r = renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: 'Plan your food, fasting and training, then live it day by day.' })).toBeInTheDocument();
      expect(r.state.location.pathname).toBe('/welcome');
      document.body.innerHTML = '';
    }
  });

  it('keeps Evidence, Settings and Safety & limits open before screening', async () => {
    for (const [path, heading] of [
      ['/evidence', /evidence/i],
      ['/settings', 'Settings'],
      ['/safety', 'Safety & limits'],
    ] as const) {
      const r = renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(r.state.location.pathname).toBe(path);
      document.body.innerHTML = '';
    }
  });

  // 0.6.3: "/" is Today in every mode; the last screen no longer decides where the app opens (it used to reopen it)
  it('lets a returning user through and sends "/" to Today, whatever the last screen was', async () => {
    act(() => seedClearedSafety());
    localStorage.setItem('vitals.ui.lastRoute', JSON.stringify({ state: '/plan', version: 1 }));
    const r = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Today' }, { timeout: 8000 });
    expect(r.state.location.pathname).toBe('/today');
  });

  it('shows the hard stop to under-18s on every guarded route, with Evidence still open', async () => {
    act(() => useSafetyStore.getState().commitAnswers({ ageBand: 'under-18' }, new Date().toISOString()));
    const r = renderAt('/simulate');
    const h = await screen.findByRole('heading', { level: 1, name: 'Vitals is for adults.' });
    expect(where(r)).toBe('/welcome?step=stop');
    await waitFor(() => expect(h).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Open the Evidence library' })).toHaveAttribute('href', '/evidence');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull(); // no app navigation on the hard stop
  });

  it('asks for consent again when the disclaimer version changes', async () => {
    act(() => {
      seedClearedSafety();
      useSafetyStore.getState().acknowledge('disclaimer', ACK_VERSIONS.disclaimer - 1, new Date().toISOString());
    });
    const r = renderAt('/body');
    expect(await screen.findByRole('heading', { level: 1, name: 'Before you start' })).toBeInTheDocument();
    expect(where(r)).toBe('/welcome?step=consent&review=updated');
    expect(screen.getByText('The disclaimer has changed.')).toBeInTheDocument();
  });

  it('asks to review imported answers before the gate clears', async () => {
    act(() => {
      seedClearedSafety();
      withSystemWrite(() => useSafetyStore.setState({ pendingReview: true }));
    });
    const r = renderAt('/plan');
    expect(await screen.findByRole('heading', { level: 1, name: 'About you' })).toBeInTheDocument();
    expect(where(r)).toBe('/welcome?step=screening&review=import');
    expect(screen.getByText(/came from an imported file/)).toBeInTheDocument();
  });

  it('asks to review answers after 12 months', async () => {
    act(() => seedClearedSafety(STANDARD_ANSWERS, '2024-01-01T00:00:00.000Z'));
    const r = renderAt('/body');
    expect(await screen.findByText(/a year since you answered/)).toBeInTheDocument();
    expect(where(r)).toBe('/welcome?step=screening&review=expired');
  });
});

describe('first-run flow (a11y + keyboard)', () => {
  async function answerAll(user: ReturnType<typeof userEvent.setup>) {
    const q = (name: string) => screen.getByRole('radiogroup', { name });
    await user.click(within(q('Are you pregnant or breastfeeding, or planning a pregnancy in the next few months?')).getByRole('radio', { name: 'no' }));
    await user.click(within(q('Have you ever been diagnosed with, or treated for, an eating disorder?')).getByRole('radio', { name: 'no' }));
    for (const g of screen.getAllByRole('group').filter((el) => el.tagName === 'FIELDSET' && el.classList.contains('lm-onb-row'))) {
      await user.click(within(g).getByRole('radio', { name: 'no' }));
    }
    for (const name of [
      'Do you have diabetes, or take any medicine to lower blood sugar?',
      /heart condition, high blood pressure/,
      /gout, kidney stones, gallstones/,
      'Do you regularly take prescription medicine for a long-term condition?',
      /fainted, had chest pain/,
      'Has a doctor said you should only exercise under medical supervision?',
      /bone, joint or muscle problem/,
      /drink heavily/,
    ]) {
      await user.click(within(screen.getByRole('radiogroup', { name })).getByRole('radio', { name: 'no' }));
    }
  }

  it('walks intro → screening → consent → Your body with labelled controls and focus on each heading', async () => {
    const user = userEvent.setup();
    const r = renderAt('/');
    const intro = await screen.findByRole('heading', { level: 1, name: 'Plan your food, fasting and training, then live it day by day.' });
    await waitFor(() => expect(intro).toHaveFocus());
    // the intake header: the step name centred, the step segments under it; no count, no ⋯ (the brand leads the text)
    const steps = screen.getByRole('list', { name: 'Setup progress' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    // whole states: the step you are on gold, the later ones track (no partial fill)
    expect(within(steps).getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['current', 'todo', 'todo']);
    const header = steps.closest('header')!;
    expect(within(header).getByText('Welcome')).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'More' })).toBeNull();
    // (the step position is read out to assistive tech only)
    const seen = header.cloneNode(true) as HTMLElement;
    seen.querySelectorAll('.lm-sr').forEach((el) => el.remove());
    expect(seen.textContent).toBe('Welcome');
    // one headline, one line, one action: no example chart, no download block; restoring data stays one quiet link
    expect(screen.getByText(/Your data starts on this device/)).toBeInTheDocument();
    expect(screen.queryByText(/twelve-week projection|Download for/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Import data from a file' })).toHaveAttribute('href', paths.settings('data'));
    await user.click(screen.getAllByRole('button', { name: /Get started/ })[0]!);

    const about = await screen.findByRole('heading', { level: 1, name: 'About you' });
    await waitFor(() => expect(about).toHaveFocus());
    expect(where(r)).toBe('/welcome?step=screening');
    // the same header grammar as the chapters: Back, the step's name (the h1) centred, the segments; no subtitle
    expect(about.closest('header')).toBe(screen.getByRole('list', { name: 'Setup progress' }).closest('header'));
    expect(within(about.closest('header')!).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Setup progress' })).getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['done', 'current', 'todo']);
    expect(screen.queryByText(/A few questions/)).toBeNull();
    // age and pregnancy are radio rows on the group's surface, not a bordered option box inside the card
    for (const name of ['How old are you?', 'Are you pregnant or breastfeeding, or planning a pregnancy in the next few months?']) {
      const rows = screen.getByRole('radiogroup', { name });
      expect(rows).toHaveClass('lm-onb-choices');
      expect(rows.closest('.lm-onb-q')!.querySelector('.lm-bank')).toBeNull();
    }

    // Continue is aria-disabled (still focusable) with the reason exposed.
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: /questions left/ })).toBeInTheDocument();

    // Keyboard: arrows move and select inside a radio group.
    const age = screen.getByRole('radiogroup', { name: 'How old are you?' });
    within(age).getAllByRole('radio')[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(within(age).getByRole('radio', { name: '18–64' })).toHaveAttribute('aria-checked', 'true');

    // Each question is a fieldset with a legend.
    expect(screen.getByRole('group', { name: 'How old are you?' }).tagName).toBe('FIELDSET');

    // A consequence appears inline, in a polite live region.
    await user.click(within(screen.getByRole('radiogroup', { name: /drink heavily/ })).getByRole('radio', { name: 'prefer not to say' }));
    const alcoholCard = document.getElementById('q-alcohol')!;
    expect(within(within(alcoholCard).getByRole('status')).getByText('Plans keep fasts short.')).toBeInTheDocument();

    await answerAll(user);
    expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-disabled');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const before = await screen.findByRole('heading', { level: 1, name: 'Before you start' });
    await waitFor(() => expect(before).toHaveFocus());
    expect(screen.getByRole('heading', { name: 'Your safety settings' })).toBeInTheDocument();
    expect(screen.getByText('Standard mode.')).toBeInTheDocument();
    // the outcome is one line here: the limits are listed once, on Safety & limits
    expect(screen.queryByText('Limits for plans')).toBeNull();
    expect(screen.getByRole('heading', { name: 'What Vitals is' })).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'I understand' });
    expect(box).not.toBeChecked(); // never pre-checked
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-disabled', 'true');

    // Enter on the checkbox toggles it; Ctrl+Enter continues when valid.
    box.focus();
    await user.keyboard('{Enter}');
    expect(box).toBeChecked();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(r.state.location.pathname).toBe('/body'));
    expect(r.state.location.search).toBe('?setup=basics');
    const s = useSafetyStore.getState();
    expect(s.acknowledgements.disclaimer?.version).toBe(ACK_VERSIONS.disclaimer);
    expect(s.answers?.alcohol).toBe('no');
    expect(s.answers).not.toHaveProperty('scoff');
  });

  it('under 18: the rest of the questions disappear, Continue leads to the hard stop, and a mistake can be undone', async () => {
    const user = userEvent.setup();
    const r = renderAt('/welcome?step=screening');
    await screen.findByRole('heading', { level: 1, name: 'About you' });
    await user.click(screen.getByRole('radio', { name: 'under 18' }));
    expect(screen.queryByRole('radiogroup', { name: /pregnant/ })).toBeNull();
    expect(within(document.getElementById('q-ageBand')!).getByRole('status')).toHaveTextContent('Vitals is for adults.');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Vitals is for adults.' })).toBeInTheDocument();
    expect(useSafetyStore.getState().answers).toEqual({ ageBand: 'under-18' }); // nothing else is kept
    await user.click(screen.getByRole('button', { name: 'I entered my age by mistake' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'About you' })).toBeInTheDocument();
    expect(where(r)).toBe('/welcome?step=screening');
    expect(useSafetyStore.getState().answers).toBeNull();
  });

  it('review from Settings: lifting gentle mode asks for confirmation, then returns to Settings › Safety', async () => {
    act(() => seedClearedSafety({ ...STANDARD_ANSWERS, eatingDisorder: 'yes', scoffRisk: undefined }));
    const user = userEvent.setup();
    const r = renderAt('/welcome?step=screening&review=settings');
    await screen.findByRole('heading', { level: 1, name: 'About you' });
    expect(screen.queryByRole('list', { name: 'Setup progress' })).toBeNull();
    const ed = screen.getByRole('radiogroup', { name: /eating disorder/ });
    expect(within(ed).getByRole('radio', { name: 'yes' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(ed).getByRole('radio', { name: 'no' }));
    for (const g of screen.getAllByRole('group').filter((el) => el.classList.contains('lm-onb-row'))) {
      await user.click(within(g).getByRole('radio', { name: 'no' }));
    }
    await user.click(screen.getByRole('button', { name: 'Save answers' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off gentle mode?' });
    await user.click(within(dialog).getByRole('button', { name: 'Turn it off' }));
    // Settings › Safety is its own page (/settings/safety)
    await waitFor(() => expect(r.state.location.pathname).toBe('/settings/safety'));
    expect(useSafetyStore.getState().answers?.eatingDisorder).toBe('no');
  });
});
