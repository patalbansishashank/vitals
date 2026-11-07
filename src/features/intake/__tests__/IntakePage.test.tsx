/** Smoke render of each chapter and the summary, plus one-tap answers, Skip (asked later), keyboard and progress. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
/** The step row: the screen's ActionBar (docked at the bottom on phones). */
const nav = () => document.querySelector<HTMLElement>('.lm-actionbar .lm-ik-nav')!;
/** The header's one ⋯ ("More"), which holds the chapter's own actions ("Skip this part", "Answer by chatting instead"). */
const more = () => screen.queryByRole('button', { name: 'More' });
/** Opens the header ⋯ and returns its page items (the ones before the global items' divider). */
async function chapterActions() {
  await userEvent.click(more()!);
  const menu = within(screen.getByRole('menu'));
  return menu.getAllByRole('menuitem');
}

describe('intake chapters render', () => {
  it('a normal day: one question card, one step row, chapter segments without a count, live maintenance rail; no tab bar in setup', async () => {
    renderAt('/onboarding/activity?from=setup');
    expect(await screen.findByRole('heading', { level: 1, name: 'A normal day' })).toBeInTheDocument();
    expect(groups('Do you work or study outside the home most weeks?').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.lm-ik-card')).toHaveLength(1);
    // one step row (Back · Skip · Next), in the screen's ActionBar, Next the gold primary; one Skip on the page (the
    // chapter's own skip is in the header ⋯); no "if you skip" line, no counts on screen
    expect([...nav().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Back', 'Skip', 'Next']);
    expect(within(nav()).getByRole('button', { name: 'Next' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getAllByRole('button', { name: /skip/i })).toHaveLength(1);
    expect(screen.queryByText(/if you skip/i)).toBeNull();
    expect(screen.queryByText(/question \d+ of \d+/i)).toBeNull();
    expect(screen.queryByText(/^\d+ of \d+$/)).toBeNull();
    // the header's scale is the chapter segments only (one per chapter, in whole states: this one gold, the rest
    // track), its value spoken
    const bar = screen.getByRole('progressbar', { name: 'Setup progress' });
    expect(bar).toHaveAttribute('aria-valuetext', 'A normal day, question 1 of 9; 0 of 4 chapters done');
    expect([...bar.querySelectorAll('.lm-steps__seg')].map((e) => e.getAttribute('data-state'))).toEqual(['current', 'todo', 'todo', 'todo']);
    expect(bar.textContent).toBe('');
    // no "Your answers" fold under the step (the answers live in the receipt and in "What we'll use")
    expect(screen.queryByText('Your answers')).toBeNull();
    // no "Default" tag on any key
    expect(screen.queryByText('Default')).toBeNull();
    const rail = document.querySelector<HTMLElement>('.lm-ik-rail')!;
    expect(within(rail).getByRole('img', { name: /^about .* kcal a day — likely / })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'About Your maintenance' })).toBeInTheDocument();
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
    // no chapter intro paragraph over the first question
    expect(screen.queryByText(/What you'd be willing to do/)).toBeNull();
  });

  it('food and kitchen (diet, kitchen and supplements sections share the chapter)', async () => {
    renderAt('/onboarding/diet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Food and kitchen' })).toBeInTheDocument();
    expect(groups('Which of these do you eat?').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Jain' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'mutton or goat' })).toBeInTheDocument();
  });

  it('"Answer by chatting instead" is in the header ⋯ only with a Coach provider and opens the Coach with a prefilled message', async () => {
    const { setCoachAvailable } = await import('@/features/living/coach/availability');
    const router = renderAt('/onboarding/training?from=body');
    expect(await screen.findByRole('heading', { level: 1, name: 'Training and equipment' })).toBeInTheDocument();
    // the chapter's actions lead the ⋯; no key for them on the page
    expect((await chapterActions()).map((m) => m.textContent)[0]).toBe('Skip this part');
    expect(screen.queryByRole('menuitem', { name: 'Answer by chatting instead' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Skip this part' })).toBeNull();
    // the scale: chapter A unfinished (track), this chapter gold
    expect([...screen.getByRole('progressbar', { name: 'Setup progress' }).querySelectorAll('.lm-steps__seg')].map((e) => e.getAttribute('data-state'))).toEqual(['todo', 'current', 'todo', 'todo']);
    act(() => setCoachAvailable(true));
    try {
      await chapterActions();
      await userEvent.click(screen.getByRole('menuitem', { name: 'Answer by chatting instead' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/coach'));
      expect(router.state.location.state).toMatchObject({ draft: { text: expect.stringContaining('training and equipment') } });
    } finally {
      act(() => setCoachAvailable(false));
    }
  });

  it('every intake screen is a focused flow: no tab bar, outside the first run too', async () => {
    renderAt('/onboarding/training');
    expect(await screen.findByRole('heading', { level: 1, name: 'Training and equipment' })).toBeInTheDocument();
    expect(document.querySelector('.lm-app')).toHaveAttribute('data-chromeless', 'true');
    expect(document.querySelector('.lm-tabbar')).toBeNull();
  });

  it('what we will use (summary) and unknown sections (the removed devices part too)', async () => {
    const old = renderAt('/onboarding/devices');
    await waitFor(() => expect(old.state.location.pathname).toBe('/onboarding/activity'));
    cleanup();
    const router = renderAt('/onboarding/nope');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/activity'));
    act(() => void router.navigate('/onboarding/summary'));
    expect(await screen.findByRole('heading', { level: 1, name: "What we'll use" })).toBeInTheDocument();
    expect(screen.getAllByText('not answered yet').length).toBeGreaterThan(0);
  });
});

describe('answering', () => {
  it('one tap commits and advances; Skip (L) asks later and applies the default; "What we\'ll use" lists both, each row opening its question', async () => {
    const router = renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await userEvent.click(screen.getByRole('button', { name: 'no — retired, at home, caring for family' }));
    expect((await screen.findAllByRole('group', { name: 'Do you know how many steps you walk a day?' })).length).toBeGreaterThan(0);
    // the work-day questions are not asked
    expect(screen.queryByText('What do you mostly do on a workday, at work or study?')).toBeNull();
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuetext', 'A normal day, question 2 of 9; 0 of 4 chapters done'));

    // L = Skip (asked later)
    const turn = document.getElementById('ik-stepsKnown')!;
    fireEvent.keyDown(within(turn).getAllByRole('button')[0]!, { key: 'L' });
    await waitFor(() => expect(document.getElementById('ik-stepsKnown')).toBeNull());

    await settleIntakeSaves();
    const t = turnsOf(readIntake(), 'activity');
    expect(t.values.work).toBe('no');
    expect(t.status).toMatchObject({ work: 'answered', stepsKnown: 'skipped' });

    // the answers moved to "What we'll use": the given one and the asked-later one, each row a link to its question
    act(() => void router.navigate('/onboarding/summary'));
    await screen.findByRole('heading', { level: 1, name: "What we'll use" });
    const day = within(screen.getByRole('region', { name: 'A normal day' }));
    expect(day.getByRole('link', { name: 'Change: Work or study outside home, no — retired, at home, caring for family' })).toHaveAttribute('href', '/onboarding/activity#work');
    expect(day.getByRole('link', { name: "Change: Know your steps, using no — we'll work them out from your answers · asked later" })).toHaveAttribute('href', '/onboarding/activity#steps');
  });

  it('keyboard: arrows move focus between answer keys without committing; Enter commits', async () => {
    renderAt('/onboarding/activity');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    const yes = screen.getByRole('button', { name: 'yes' });
    yes.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'no — retired, at home, caring for family' })).toHaveFocus();
    // moving focus commits nothing: the same question is open and nothing is saved
    expect(document.getElementById('ik-work')).not.toBeNull();
    expect(turnsOf(readIntake(), 'activity').status.work).toBeUndefined();
    await userEvent.keyboard('{ArrowLeft}{Enter}');
    expect((await screen.findAllByRole('group', { name: 'What do you mostly do on a workday, at work or study?' })).length).toBeGreaterThan(0);
    await settleIntakeSaves();
    expect(turnsOf(readIntake(), 'activity').values.work).toBe('yes');
    // examples are part of the accessible name
    expect(screen.getByRole('button', { name: /sitting at a desk or driving — for example office, driving/ })).toBeInTheDocument();
  });

  it('"Skip this part" (header ⋯) finishes the chapter with defaults and shows the maintenance result', async () => {
    const router = renderAt('/onboarding/activity?from=setup');
    await screen.findByRole('heading', { level: 1, name: 'A normal day' });
    await chapterActions();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Skip this part' }));
    expect(await screen.findByRole('heading', { name: 'Your maintenance' })).toBeInTheDocument();
    // the chapter receipt and its keys (the step row's place): the next part, and the questions the skip asked later
    expect(screen.getByRole('heading', { name: 'A normal day done' })).toBeInTheDocument();
    expect(within(nav()).getByRole('link', { name: 'Next: training' })).toBeInTheDocument();
    expect(within(nav()).getByRole('button', { name: 'Answer skipped questions' })).toBeInTheDocument();
    // the skip is no longer offered once the part is done: the pushed header has no ⋯ left
    expect(more()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip this part' })).toBeNull();
    await settleIntakeSaves();
    expect(readIntake().skipped?.activity).toBeTruthy();
    expect(turnsOf(readIntake(), 'activity').skippedAll).toBe(true);
    // the finished chapter fills its segment once the next one is open; that one is gold
    act(() => void router.navigate('/onboarding/training?from=setup'));
    await screen.findByRole('heading', { level: 1, name: 'Training and equipment' });
    expect([...screen.getByRole('progressbar', { name: 'Setup progress' }).querySelectorAll('.lm-steps__seg')].map((e) => e.getAttribute('data-state'))).toEqual(['done', 'current', 'todo', 'todo']);
  });
});
