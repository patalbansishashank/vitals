/**
 * Intake v3 on screen: answer → Back → change an earlier answer from "What we'll use" → leave → return shows the same
 * question; the parent chip; the maintenance result before the measured-energy questions; the Body page's maintenance
 * card reads the same document and opens the chapter to change it; no sheet or slide-in panel anywhere (SUITE_SPEC
 * §13.1 acceptance 3 and 5).
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/App';
import { resetBusState, resetHistory } from '@/commands';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { useProfileStore } from '@/state/profileStore';
import { setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { detectIndia } from '../context';
import { readIntake, turnsOf } from '../doc';
import { DEFAULT_CONTEXT } from '../flow';
import { saveChapter, settleIntakeSaves } from '../persist';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  localStorage.clear();
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  seedClearedSafety();
  withSystemWrite(() => useProfileStore.getState().resetBody());
  act(() => {
    const s = useProfileStore.getState();
    s.setSex('male');
    s.setAge(36);
    s.setHeight(178);
    s.setWeight(84.9);
    s.setSetup('done');
  });
});

afterEach(async () => {
  await settleIntakeSaves();
});

const card = () => document.querySelector<HTMLElement>('.lm-ik-card')!;
/** The step row (Back · Skip · Next): the screen's ActionBar on the chapter screen. */
const nav = () => document.querySelector<HTMLElement>('.lm-actionbar .lm-ik-nav')!;
const cardPrompt = () => within(card()).getByText((_, el) => el?.tagName === 'LEGEND').textContent;
const noSheets = () => expect(document.querySelector('[role="dialog"], .lm-sheet, .lm-panel, .lm-side-panel')).toBeNull();

const sctx = { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-02T09:00:00.000Z' };
const UP_TO_SLEEP = {
  values: { work: 'no', stepsKnown: 'roughly', stepsRough: 6000, stepsScope: 'totalDay', offDay: 'mixed', home: 'some', sport: [], trainNow: 'none', sleep: { bed: 23, wake: 7 }, sleepQuality: 'fair' },
  status: { work: 'answered', stepsKnown: 'answered', stepsRough: 'answered', stepsScope: 'answered', offDay: 'answered', home: 'answered', sport: 'answered', trainNow: 'answered', sleep: 'answered', sleepQuality: 'answered' },
} as const;

describe('the chapter screen', () => {
  it('answer → Back → change an earlier answer → leave → return: the same question opens', async () => {
    const router = renderAt('/onboarding/activity?from=body');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    // the first card has Back too (it leaves the chapter: Q3-J1-07); Next is the gold primary and waits for an answer:
    // pressed with none, it stays on the question, names the fix and sends focus to the answers
    expect(within(nav()).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    const next = within(nav()).getByRole('button', { name: /Next/ });
    expect(next).not.toHaveAttribute('aria-disabled');
    await userEvent.click(next);
    expect(cardPrompt()).toBe('Do you work or study outside the home most weeks?');
    expect(within(card()).getByText('Choose an answer first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'yes' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'yes' }));
    // the follow-up restates its context and shows the parent answer as a chip
    await waitFor(() => expect(cardPrompt()).toBe('What do you mostly do on a workday, at work or study?'));
    expect(within(card()).getByText(/Because you said: work or study outside home · yes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^sitting at a desk or driving/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How many days a week do you go to work or study, and how many hours is a usual day there?'));
    await userEvent.click(within(card()).getByRole('button', { name: /^8 h/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));

    // Back: the previous question opens in change mode with its answer; Back again; Cancel returns
    await userEvent.click(within(nav()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(cardPrompt()).toMatch(/^How many days a week/));
    expect(within(card()).getByText('Changing an answer')).toBeInTheDocument();
    await userEvent.click(within(nav()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(cardPrompt()).toBe('What do you mostly do on a workday, at work or study?'));
    // Save keeps the answer and returns to the first open question
    await userEvent.click(within(nav()).getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));

    // Change an earlier answer from its row in "What we'll use" (the chapter keeps no answers list): only that
    // question is re-asked, then the chapter goes on at its first open question
    await waitFor(() => expect(turnsOf(readIntake(), 'activity').values.workTime).toBeDefined());
    await settleIntakeSaves();
    act(() => void router.navigate('/onboarding/summary?from=body'));
    await screen.findByRole('heading', { level: 1, name: "What we'll use" });
    const day = within(screen.getByRole('region', { name: 'A normal day' }));
    expect(day.getByRole('link', { name: /^Change: Work or study outside home, yes/ })).toBeInTheDocument();
    await userEvent.click(day.getByRole('link', { name: /^Change: At work or study, / }));
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await waitFor(() => expect(cardPrompt()).toBe('What do you mostly do on a workday, at work or study?'));
    expect(within(card()).getByText('Changing an answer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^on my feet most of the time/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));

    // leave and return (another chapter, then back): the same question
    await waitFor(() => expect(turnsOf(readIntake(), 'activity').values.job).toBe('onFeet'));
    await settleIntakeSaves();
    act(() => void router.navigate('/onboarding/training?from=body'));
    await screen.findByRole('heading', { level: 1, name: 'Training and equipment' });
    act(() => void router.navigate('/onboarding/activity?from=body'));
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));

    // and after a reload (a fresh screen on the stored document)
    cleanup();
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?');
    expect(turnsOf(readIntake(), 'activity').values).toMatchObject({ work: 'yes', job: 'onFeet', workTime: { days: 5, hours: 8 } });
    noSheets();
  }, 30_000);

  it('Back on the first card of a chapter goes to the previous chapter during setup, or back to the body page (Q3-J1-07)', async () => {
    const router = renderAt('/onboarding/training?from=setup');
    await screen.findByRole('heading', { level: 1, name: 'Training and equipment' });
    await userEvent.click(within(nav()).getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    expect(router.state.location.search).toContain('from=setup');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/body'));
    expect(router.state.location.search).toBe('?setup=shape');
    cleanup();
    const r2 = renderAt('/onboarding/training?from=body');
    await screen.findByRole('heading', { level: 1, name: 'Training and equipment' });
    await userEvent.click(within(nav()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(r2.state.location.hash).toBe('#habits'));
  }, 30_000);

  it('a returning visit keeps the stored answers when the document loads after the first render with a changed stamp (Q3-J1)', async () => {
    // the stored document was stamped with the other locale (→ the stamp changes) and carries chapter A up to sleep
    // quality, plus the `meta.stepDevice` an older document has from the removed devices chapter (ignored); the store
    // opens only after the screen has rendered once, so the answers and the context arrive in one render
    const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
    setDocumentStore(createDocumentStore({ backend, device: 'TESTDEVICE000001' }));
    const other = { ...sctx, india: !detectIndia() };
    await saveChapter('activity', { values: { ...UP_TO_SLEEP.values, 'meta.india': !detectIndia(), 'meta.gentle': false, 'meta.stepDevice': true }, status: { ...UP_TO_SLEEP.status } }, other);
    await settleIntakeSaves();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    setDocumentStore(createDocumentStore({ backend: async () => (await gate, backend), device: 'TESTDEVICE000001' }));
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await act(async () => open());
    await waitFor(() => expect(cardPrompt()).toMatch(/^Have you ever had your resting energy/));
    // the stored answers were adopted, not overwritten by the late stamp
    await settleIntakeSaves();
    expect(turnsOf(readIntake(), 'activity')).toMatchObject({ values: { sleepQuality: 'fair', stepsRough: 6000 }, status: { sleepQuality: 'answered' } });
  }, 30_000);

  it('the maintenance result comes before the measured-energy questions; answering them needs no sheet', async () => {
    await saveChapter('activity', UP_TO_SLEEP as never, sctx);
    await settleIntakeSaves();
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    expect(screen.getByRole('heading', { name: 'Your maintenance' })).toBeInTheDocument();
    expect(cardPrompt()).toMatch(/^Have you ever had your resting energy or your maintenance calories measured/);
    // the result leads the step, the question follows it, and the rail is gone once the result card shows
    const result = screen.getByRole('region', { name: 'Your maintenance' });
    expect(result.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.lm-ik-rail')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a measurement' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^yes, my resting energy/ }));
    await waitFor(() => expect(cardPrompt()).toBe('What was your measured figure, and how was it measured?'));
    expect(within(card()).getByText(/Because you said: measured before · yes, resting energy/)).toBeInTheDocument();
    noSheets();
  }, 30_000);
});

describe('Your body › Maintenance', () => {
  it('shows the number and its parts with units, asks nothing inline, and opens the chapter from its one key', async () => {
    await saveChapter('activity', UP_TO_SLEEP as never, sctx);
    await settleIntakeSaves();
    const router = renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' }, { timeout: 10_000 });
    const maint = document.getElementById('body-maintenance')!;
    // the owner's path is gone (no "add measurement", no "Correct it"), and so are the inline question card, the
    // "Measured before?" heading, the answers fold and the per-part Change keys
    expect(within(maint).queryByRole('button', { name: /Add a measurement|Correct it/ })).toBeNull();
    expect(maint.querySelector('.lm-ik-card, details')).toBeNull();
    expect(within(maint).queryByText('Measured before?')).toBeNull();
    expect(within(maint).queryByRole('button', { name: /^Change/ })).toBeNull();
    // the parts: amounts with their unit, no header row, and the steps part keeps one line ("6,000 steps")
    const table = within(maint).getByRole('table');
    expect(table.querySelector('thead')).toBeNull();
    expect(within(table).getByText(/^6,000 steps$/)).toBeInTheDocument();
    expect(within(table).getAllByText('kcal').length).toBeGreaterThan(1);
    // the card's one key opens chapter A from Your body; answering happens there, never in a sheet
    noSheets();
    await userEvent.click(within(maint).getByRole('link', { name: 'Edit answers' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/activity'));
    expect(router.state.location.search).toBe('?from=body');
  }, 30_000);
});
