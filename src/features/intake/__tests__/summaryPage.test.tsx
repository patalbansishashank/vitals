/** "What we'll use": the page's keys live in the shared action bar (Back secondary, the primary key last), not in the card. */
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
  it('first run: Back and "Looks right — continue" are in the action bar, none inside the card', async () => {
    const router = renderAt('/onboarding/summary?from=setup');
    await screen.findByText("Here's what Vitals will work from.");
    const card = document.querySelector<HTMLElement>('.lm-ik-summary__face')!;
    expect(within(card).queryByRole('button', { name: /Looks right/ })).toBeNull();
    expect(card.querySelector('.lm-face-foot')).toBeNull();
    // each key exists once on the page, in the action bar
    expect(screen.getAllByRole('button', { name: 'Looks right — continue' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Back' })).toHaveLength(1);
    const foot = document.querySelector<HTMLElement>('.lm-actionbar[data-place="foot"]')!;
    expect(foot.contains(screen.getByRole('button', { name: 'Looks right — continue' }))).toBe(true);
    // Back first (secondary), the primary key last
    const keys = [...foot.querySelectorAll<HTMLElement>('a, button')].map((k) => k.textContent);
    expect(keys).toEqual(['Back', 'Looks right — continue']);
    expect(within(foot).getByRole('link', { name: 'Back' })).toHaveAttribute('href', expect.stringContaining('/onboarding/devices'));
    await userEvent.click(within(foot).getByRole('button', { name: 'Looks right — continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/body'));
    expect(router.state.location.search).toBe('?setup=start');
  }, 30_000);

  it('from Your body: the one key is "Back to Your body", in the action bar', async () => {
    const router = renderAt('/onboarding/summary');
    await screen.findByText("Here's what Vitals will work from.");
    const card = document.querySelector<HTMLElement>('.lm-ik-summary__face')!;
    expect(within(card).queryByRole('button')).toBeNull();
    // (the title bar's own back chevron carries the same words; the page's key is the one in the action bar)
    const foot = document.querySelector<HTMLElement>('.lm-actionbar[data-place="foot"]')!;
    expect(within(foot).getAllByRole('button', { name: 'Back to Your body' })).toHaveLength(1);
    expect(document.querySelectorAll('.lm-ik-summary-keys')).toHaveLength(1);
    expect([...foot.querySelectorAll<HTMLElement>('a, button')].map((k) => k.textContent)).toEqual(['Back to Your body']);
    await userEvent.click(within(foot).getByRole('button', { name: 'Back to Your body' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/body'));
  }, 30_000);

  it('each part is a heading with its change key and one labelled line per answer', async () => {
    const sctx = { ...DEFAULT_CONTEXT, safety: null, now: '2026-10-02T09:00:00.000Z' };
    await saveChapter(
      'training',
      { values: { where: ['home'], kit: { owned: ['dumbbell'], custom: [] }, time: { days: 3, minutes: 30, best: 'any' } }, status: { where: 'answered', kit: 'answered', time: 'answered' } },
      sctx,
    );
    await settleIntakeSaves();
    renderAt('/onboarding/summary');
    await screen.findByText("Here's what Vitals will work from.");
    const parts = [...document.querySelectorAll<HTMLElement>('.lm-ik-part')];
    expect(parts.map((p) => p.querySelector('h3')?.textContent).slice(0, 5)).toEqual(['A normal day', 'Training and equipment', 'Food and kitchen', 'Blood markers', 'Devices and data']);
    const training = within(screen.getByRole('region', { name: 'Training and equipment' }));
    expect(training.getByRole('link', { name: 'Change training' })).toHaveAttribute('href', expect.stringContaining('/onboarding/training'));
    const rows = [...screen.getByRole('region', { name: 'Training and equipment' }).querySelectorAll('.lm-ik-part__row')];
    const text = rows.map((r) => `${r.querySelector('dt')!.textContent}: ${r.querySelector('dd')!.textContent}`);
    expect(text).toContain('where: home');
    expect(text).toContain('equipment at home: dumbbells');
    expect(text).toContain('sessions: 3 a week, 30 min each');
    expect(text).toContain('time of day: any time');
    // a part nobody has answered says so, with an Answer key
    expect(within(screen.getByRole('region', { name: 'Blood markers' })).getByText('not answered yet')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Blood markers' })).getByRole('link', { name: 'Change blood markers' })).toHaveTextContent('Answer');
  }, 30_000);
});
