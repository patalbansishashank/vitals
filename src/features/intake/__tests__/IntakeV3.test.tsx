/**
 * Intake v3 on screen: answer → Back → Change an earlier answer → leave → return shows the same question; the parent
 * chip; the maintenance result before the measured-energy questions; the Body page's inline questions write the same
 * document as the chapter; no sheet or slide-in panel anywhere (SUITE_SPEC §13.1 acceptance 3 and 5).
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
const cardPrompt = () => within(card()).getByText((_, el) => el?.tagName === 'LEGEND').textContent;
const noSheets = () => expect(document.querySelector('[role="dialog"], .lm-sheet, .lm-panel, .lm-side-panel')).toBeNull();

const sctx = { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-02T09:00:00.000Z' };
const UP_TO_SLEEP = {
  values: { work: 'no', stepsKnown: 'roughly', stepsRough: 6000, offDay: 'mixed', home: 'some', sport: [], trainNow: 'none', sleep: { bed: 23, wake: 7 }, sleepQuality: 'fair' },
  status: { work: 'answered', stepsKnown: 'answered', stepsRough: 'answered', offDay: 'answered', home: 'answered', sport: 'answered', trainNow: 'answered', sleep: 'answered', sleepQuality: 'answered' },
} as const;

describe('the chapter screen', () => {
  it('answer → Back → change an earlier answer → leave → return: the same question opens', async () => {
    const router = renderAt('/onboarding/activity?from=body');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    // the first card has Back too (it leaves the chapter: Q3-J1-07), Next waits for an answer
    expect(within(card()).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: /Next/ })).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'yes' }));
    // the follow-up restates its context and shows the parent answer as a chip
    await waitFor(() => expect(cardPrompt()).toBe('What do you mostly do on a workday, at work or study?'));
    expect(within(card()).getByText(/because you said: work or study outside home · yes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^sitting at a desk or driving/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How many days a week do you go to work or study, and how many hours is a usual day there?'));
    await userEvent.click(within(card()).getByRole('button', { name: /^8 h/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));

    // Back: the previous question opens in change mode with its answer; Back again; Cancel returns
    await userEvent.click(within(card()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(cardPrompt()).toMatch(/^How many days a week/));
    expect(within(card()).getByText('changing an answer')).toBeInTheDocument();
    await userEvent.click(within(card()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(cardPrompt()).toBe('What do you mostly do on a workday, at work or study?'));
    // Save keeps the answer and returns to the first open question
    await userEvent.click(within(card()).getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));

    // Change an earlier answer from its row: only that question is re-asked
    await userEvent.click(screen.getByRole('button', { name: /^Change: What do you mostly do on a workday/ }));
    await waitFor(() => expect(cardPrompt()).toBe('What do you mostly do on a workday, at work or study?'));
    await userEvent.click(screen.getByRole('button', { name: /^on my feet most of the time/ }));
    await waitFor(() => expect(cardPrompt()).toBe('How do you usually get to work or study on a workday?'));
    expect(screen.getByRole('button', { name: /^Change: Do you work or study outside the home most weeks\?, yes/ })).toBeInTheDocument();

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
    await userEvent.click(within(card()).getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    expect(router.state.location.search).toContain('from=setup');
    await userEvent.click(within(card()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/body'));
    expect(router.state.location.search).toBe('?setup=shape');
    cleanup();
    const r2 = renderAt('/onboarding/training?from=body');
    await screen.findByRole('heading', { level: 1, name: 'Training and equipment' });
    await userEvent.click(within(card()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(r2.state.location.hash).toBe('#habits'));
  }, 30_000);

  it('a returning visit keeps the stored answers when the document loads after the first render with a step device (Q3-J1)', async () => {
    // the stored document carries a ring (devices: step device → the stamp changes) and chapter A up to sleep quality;
    // the store opens only after the screen has rendered once, so the answers and the context arrive in one render
    const backend = createMemoryBackend({ device: 'TESTDEVICE000001' });
    setDocumentStore(createDocumentStore({ backend, device: 'TESTDEVICE000001' }));
    const ring = { ...sctx, india: detectIndia(), stepDevice: true };
    await saveChapter('devices', { values: { has: ['ring'] }, status: { has: 'answered' } }, ring);
    await saveChapter('activity', { values: { ...UP_TO_SLEEP.values, 'meta.india': detectIndia(), 'meta.gentle': false, 'meta.stepDevice': true }, status: { ...UP_TO_SLEEP.status } }, ring);
    await settleIntakeSaves();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    setDocumentStore(createDocumentStore({ backend: async () => (await gate, backend), device: 'TESTDEVICE000001' }));
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await act(async () => open());
    await waitFor(() => expect(cardPrompt()).toMatch(/^Have you ever had your resting energy/));
    expect(screen.getByRole('button', { name: /^Change: On a usual night, how well do you sleep\?, fair/ })).toBeInTheDocument();
  }, 30_000);

  it('the maintenance result comes before the measured-energy questions; answering them needs no sheet', async () => {
    await saveChapter('activity', UP_TO_SLEEP as never, sctx);
    await settleIntakeSaves();
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    expect(screen.getByRole('heading', { name: 'Your maintenance' })).toBeInTheDocument();
    expect(cardPrompt()).toMatch(/^Have you ever had your resting energy or your maintenance calories measured/);
    expect(screen.queryByRole('button', { name: 'Correct it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a measurement' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^yes, my resting energy/ }));
    await waitFor(() => expect(cardPrompt()).toBe('What was your measured figure, and how was it measured?'));
    expect(within(card()).getByText(/because you said: measured before · yes, resting energy/)).toBeInTheDocument();
    noSheets();
  }, 30_000);
});

describe('Your body › Maintenance', () => {
  it('asks the measured-energy question inline, writes the same document as the chapter, and lists chapter A with Change', async () => {
    await saveChapter('activity', UP_TO_SLEEP as never, sctx);
    await settleIntakeSaves();
    renderAt('/body');
    await screen.findByRole('heading', { level: 1, name: 'Your body' }, { timeout: 10_000 });
    const maint = document.getElementById('body-maintenance')!;
    // the owner's path is gone: no "add measurement", no "Correct it", no sheet
    expect(within(maint).queryByRole('button', { name: /Add a measurement|Correct it/ })).toBeNull();
    // chapter A's answers with Change, folded under an inline disclosure
    await userEvent.click(within(maint).getByText('A normal day: your answers'));
    expect(maint.querySelector('details')).toHaveAttribute('open');
    expect(within(maint).getByRole('button', { name: /^Change: Do you work or study outside the home most weeks\?, no/ })).toBeInTheDocument();
    // M1 inline, without Back
    const m1 = within(maint).getAllByRole('group', { name: /^Have you ever had your resting energy/ })[0]!;
    expect(within(m1).queryByRole('button', { name: 'Back' })).toBeNull();
    await userEvent.click(within(m1).getByRole('button', { name: /^no/ }));
    await waitFor(() => expect(turnsOf(readIntake(), 'activity').values.measuredEver).toBe('no'));
    await settleIntakeSaves();
    const t = turnsOf(readIntake(), 'activity');
    expect(t.values.measuredEver).toBe('no');
    expect(t.status.measuredEver).toBe('answered');
    // the same document the chapter writes: the earlier answers are untouched
    for (const [k, v] of Object.entries(UP_TO_SLEEP.values)) expect(t.values[k]).toEqual(v);
    await waitFor(() => expect(within(maint).getByRole('button', { name: /^Change: Have you ever had your resting energy/ })).toBeInTheDocument());

    // Change on a row opens the card inline in change mode; Cancel restores the row
    await userEvent.click(within(maint).getByRole('button', { name: /^Change: Do you work or study outside the home most weeks\?/ }));
    const changing = within(maint).getAllByRole('group', { name: 'Do you work or study outside the home most weeks?' })[0]!;
    expect(within(changing).getByText('changing an answer')).toBeInTheDocument();
    await userEvent.click(within(changing).getByRole('button', { name: 'Cancel' }));
    expect(within(maint).queryByText('changing an answer')).toBeNull();

    // every driver "change" in the panel opens a question, never a sheet
    for (const b of within(within(maint).getAllByRole('table')[0]!).queryAllByRole('button')) {
      if (/resting metabolism/.test(b.getAttribute('aria-label') ?? '')) await userEvent.click(b);
    }
    noSheets();
  }, 30_000);
});
