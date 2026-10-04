/** Smoke render of each chapter and the summary, plus one-tap answers, "ask me later", keyboard and progress. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { readIntake, turnsOf } from '../doc';
import { settleIntakeSaves } from '../persist';

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
  withSystemWrite(() => {
    const s = useProfileStore.getState();
    s.resetBody();
  });
  act(() => {
    const s = useProfileStore.getState();
    s.setSex('female');
    s.setAge(34);
    s.setHeight(162);
    s.setWeight(64);
    s.setSetup('done');
  });
});

afterEach(async () => {
  await settleIntakeSaves();
});

const groups = (name: string) => screen.getAllByRole('group', { name });

describe('intake chapters render', () => {
  it('a normal day: one question card, default shown, chapter progress, live maintenance rail; no tab bar in setup', async () => {
    renderAt('/onboarding/activity?from=setup');
    expect(await screen.findByRole('heading', { level: 1, name: 'A normal day' })).toBeInTheDocument();
    expect(groups('Do you work or study outside the home most weeks?').length).toBeGreaterThan(0);
    expect(screen.getByText('if you skip: not known')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'A normal day, question 1 of 9; 0 of 5 chapters done');
    expect(screen.getByText(/^maintenance ≈ [\d\s]+ · likely [\d\s]+–[\d\s]+$/)).toBeInTheDocument();
    // first run runs chromeless: the shell drops the tab bar (the rail stays on desktop)
    expect(document.querySelector('.lm-tabbar')).toBeNull();
    expect(document.querySelector('.lm-app')).toHaveAttribute('data-chromeless', 'true');
    // later questions are not shown until reached
    expect(screen.queryByText('Do you know how many steps you walk a day?')).toBeNull();
  });

  it('training and equipment', async () => {
    renderAt('/onboarding/training?from=body');
    expect(await screen.findByRole('heading', { level: 1, name: 'Training and equipment' })).toBeInTheDocument();
    expect(groups('How long have you exercised regularly (at least twice a week), in total?').length).toBeGreaterThan(0);
    expect(screen.getByText(/What you'd be willing to do/)).toBeInTheDocument();
  });

  it('food and kitchen (diet, kitchen and supplements sections share the chapter)', async () => {
    renderAt('/onboarding/diet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Food and kitchen' })).toBeInTheDocument();
    expect(groups('Which of these do you eat?').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Jain' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'mutton or goat' })).toBeInTheDocument();
  });

  it('devices and data shows the privacy lines', async () => {
    renderAt('/onboarding/devices');
    expect(await screen.findByRole('heading', { level: 1, name: 'Devices and data' })).toBeInTheDocument();
    expect(screen.getByText('Device data stays on your devices. There is no Vitals server for it.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'ring' })).toBeInTheDocument();
  });

  it('"Answer by chatting instead" appears only with a Coach provider and opens the Coach with a prefilled message', async () => {
    const { setCoachAvailable } = await import('@/features/living/coach/availability');
    renderAt('/onboarding/training?from=body');
    expect(await screen.findByRole('heading', { level: 1, name: 'Training and equipment' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Answer by chatting instead' })).toBeNull();
    act(() => setCoachAvailable(true));
    try {
      expect(screen.getByRole('link', { name: 'Answer by chatting instead' })).toHaveAttribute('href', '/coach');
    } finally {
      act(() => setCoachAvailable(false));
    }
  });

  it('outside the first run the shell keeps the tab bar', async () => {
    renderAt('/onboarding/devices');
    expect(await screen.findByRole('heading', { level: 1, name: 'Devices and data' })).toBeInTheDocument();
    expect(document.querySelector('.lm-app')).not.toHaveAttribute('data-chromeless');
    expect(document.querySelector('.lm-tabbar')).not.toBeNull();
  });

  it('what we will use (summary) and unknown sections', async () => {
    const router = renderAt('/onboarding/nope');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/activity'));
    act(() => void router.navigate('/onboarding/summary'));
    expect(await screen.findByText("Here's what Vitals will work from.")).toBeInTheDocument();
    expect(screen.getAllByText('not answered yet').length).toBeGreaterThan(0);
  });
});

describe('answering', () => {
  it('one tap commits and advances; the receipt says what was saved; "ask me later" applies the default', async () => {
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await userEvent.click(screen.getByRole('button', { name: 'no — retired, at home, caring for family' }));
    expect(await screen.findByRole('button', { name: /^Change: Do you work or study outside the home most weeks\?, no/ })).toBeInTheDocument();
    expect(groups('Do you know how many steps you walk a day?').length).toBeGreaterThan(0);
    // the work-day questions are not asked
    expect(screen.queryByText('What do you mostly do on a workday, at work or study?')).toBeNull();
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'A normal day, question 2 of 9; 0 of 5 chapters done'));

    // L = ask me later
    const turn = document.getElementById('ik-stepsKnown')!;
    fireEvent.keyDown(within(turn).getAllByRole('button')[0]!, { key: 'L' });
    expect(await screen.findByText("using no — we'll work them out from your answers · asked later")).toBeInTheDocument();

    await settleIntakeSaves();
    const t = turnsOf(readIntake(), 'activity');
    expect(t.values.work).toBe('no');
    expect(t.status).toMatchObject({ work: 'answered', stepsKnown: 'skipped' });
  });

  it('keyboard: arrows move focus between answer keys without committing; Enter commits', async () => {
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    const yes = screen.getByRole('button', { name: 'yes' });
    yes.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'no — retired, at home, caring for family' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /^Change:/ })).toBeNull();
    await userEvent.keyboard('{ArrowLeft}{Enter}');
    expect(await screen.findByRole('button', { name: /^Change: Do you work or study outside the home most weeks\?, yes/ })).toBeInTheDocument();
    expect(groups('What do you mostly do on a workday, at work or study?').length).toBeGreaterThan(0);
    // examples are part of the accessible name
    expect(screen.getByRole('button', { name: /sitting at a desk or driving — for example office, driving/ })).toBeInTheDocument();
  });

  it('"Skip this part" finishes the chapter with defaults and shows the maintenance result', async () => {
    renderAt('/onboarding/activity?from=setup');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Skip this part' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Your maintenance' })).toBeInTheDocument();
    // the chapter receipt follows the result and its two questions (asked later by the skip)
    expect(screen.getByRole('link', { name: 'Next: training' })).toBeInTheDocument();
    expect(screen.getByText(/asked later/, { selector: '.lm-ik-receipt-end__counts' })).toBeInTheDocument();
    await settleIntakeSaves();
    expect(readIntake().skipped?.activity).toBeTruthy();
    expect(turnsOf(readIntake(), 'activity').skippedAll).toBe(true);
  });
});
