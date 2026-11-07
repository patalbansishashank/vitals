/** "What we'll use": the title is the header's; the first run's keys are the step row (Back secondary, the primary key last). */
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
    s.setSex('female');
    s.setAge(34);
    s.setHeight(162);
    s.setWeight(64);
    s.setSetup('done');
  });
});

afterEach(async () => {
  await settleIntakeSaves();
  cleanup();
});

describe('summary page keys', () => {
  it('first run: Back and "Looks right — continue" are the step row (the ActionBar), once; the title is the header\'s', async () => {
    const router = renderAt('/onboarding/summary?from=setup');
    await screen.findByRole('heading', { level: 1, name: "What we'll use" });
    // no second title and no lead under the header
    expect(screen.getAllByText("What we'll use")).toHaveLength(1);
    // the same chapter scale as the chapters: no chapter is open here, so nothing is gold; nothing is finished yet
    const scale = screen.getByRole('progressbar', { name: 'Setup progress' });
    expect([...scale.querySelectorAll('.lm-steps__seg')].map((e) => e.getAttribute('data-state'))).toEqual(['todo', 'todo', 'todo', 'todo']);
    expect(scale).toHaveAttribute('aria-valuetext', '0 of 4 chapters done');
    expect(screen.queryByText(/Here's what/)).toBeNull();
    // each key exists once on the page, in the step row
    expect(screen.getAllByRole('button', { name: 'Looks right — continue' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Back' })).toHaveLength(1);
    const foot = document.querySelector<HTMLElement>('.lm-actionbar[data-place="foot"]')!;
    expect(foot.contains(screen.getByRole('button', { name: 'Looks right — continue' }))).toBe(true);
    // Back first (secondary), the primary key last
    const keys = [...foot.querySelectorAll<HTMLElement>('a, button')].map((k) => k.textContent);
    expect(keys).toEqual(['Back', 'Looks right — continue']);
    expect(within(foot).getByRole('link', { name: 'Back' })).toHaveAttribute('href', expect.stringContaining('/onboarding/markers'));
    await userEvent.click(within(foot).getByRole('button', { name: 'Looks right — continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/body'));
    expect(router.state.location.search).toBe('?setup=start');
  }, 30_000);

  it('from Your body: no page keys — the header\'s Back returns to Your body', async () => {
    const router = renderAt('/onboarding/summary');
    await screen.findByRole('heading', { level: 1, name: "What we'll use" });
    expect(document.querySelector('.lm-actionbar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Looks right/ })).not.toBeInTheDocument();
    // one way back: the header's Back (no second "Back to Your body" key on the page)
    expect(screen.getAllByRole('button', { name: 'Back to Your body' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back to Your body' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/body'));
  }, 30_000);

  it('each part is a heading with its change key and one card of single-line rows', async () => {
    const sctx = { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-02T09:00:00.000Z' };
    await saveChapter(
      'training',
      { values: { where: ['home'], kit: { owned: ['dumbbell'], custom: [] }, time: { days: 3, minutes: 30, best: 'any' } }, status: { where: 'answered', kit: 'answered', time: 'answered' } },
      sctx,
    );
    await settleIntakeSaves();
    renderAt('/onboarding/summary');
    await screen.findByRole('heading', { level: 1, name: "What we'll use" });
    const parts = [...document.querySelectorAll<HTMLElement>('.lm-ik-part')];
    expect(parts.map((p) => p.querySelector('h2')?.textContent).slice(0, 4)).toEqual(['A normal day', 'Training and equipment', 'Food and kitchen', 'Blood markers']);
    const training = within(screen.getByRole('region', { name: 'Training and equipment' }));
    expect(training.getByRole('link', { name: 'Change training' })).toHaveAttribute('href', expect.stringContaining('/onboarding/training'));
    expect(training.getByRole('link', { name: 'Change training' })).toHaveTextContent('Change');
    const rows = [...screen.getByRole('region', { name: 'Training and equipment' }).querySelectorAll('.lm-ik-part__row')];
    const text = rows.map((r) => `${r.querySelector('dt')!.textContent}: ${r.querySelector('dd')!.textContent}`);
    expect(text).toContain('Where: home');
    expect(text).toContain('Equipment at home: dumbbells');
    expect(text).toContain('Sessions: 3 a week, 30 min each');
    expect(text).toContain('Time of day: any time');
    // a part nobody has answered says so, with an Answer key
    expect(within(screen.getByRole('region', { name: 'Blood markers' })).getByText('not answered yet')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Blood markers' })).getByRole('link', { name: 'Change blood markers' })).toHaveTextContent('Answer');
  }, 30_000);
});
