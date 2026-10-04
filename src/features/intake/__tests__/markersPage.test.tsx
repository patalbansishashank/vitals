/** `/onboarding/markers` end to end (hosted by the intake v3 QuestionCard) with the real command bus: entry card, skip records 'skipped', five-part progress. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/App';
import { resetBusState, resetHistory } from '@/commands';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { useProfileStore } from '@/state/profileStore';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { M } from '../chapters/markers';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

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

describe('blood markers chapter page', () => {
  it('opens on the entry card with both statements; "No, skip" records the chapter as skipped', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/onboarding/markers?from=setup'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Blood markers' })).toBeInTheDocument();
    expect(await screen.findByText(M.statement1)).toBeInTheDocument(); // the widget loads lazily
    expect(screen.getByText(M.statement2)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Setup progress' });
    expect(bar.querySelectorAll('.lm-ik-progress__seg')).toHaveLength(5);
    expect(bar.querySelector('[data-optional="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: M.has.options.skip }));
    await waitFor(() => expect((getDocumentStore().peek('markers', 'me') as { chapter?: string } | null)?.chapter).toBe('skipped'));
    // v3 host (I2): the answered list records "skipped" and the chapter receipt leads to the next part
    expect(await screen.findByRole('link', { name: /^Next: / })).toHaveAttribute('href', '/onboarding/devices?from=setup');
    expect(screen.getAllByText('skipped').length).toBeGreaterThan(0);
  });

  it('the typed table has one footer: Back · Ask me later · Save, and its disabled reason once (Q3-J1-06, Q3-J1-07)', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/onboarding/markers?from=setup'] });
    render(<RouterProvider router={router} />);
    // the entry card has Back too (to the previous chapter)
    await screen.findByText(M.statement1);
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: M.has.options.manual }));
    const save = await screen.findByRole('button', { name: M.table.save(0) });
    const card = save.closest<HTMLElement>('.lm-ik-card')!;
    expect(card.querySelectorAll('.lm-ik-card__foot, .lm-mk-card__foot, .lm-mk-footrow')).toHaveLength(1);
    const foot = card.querySelector<HTMLElement>('.lm-ik-card__foot')!;
    expect(foot).toContainElement(save);
    expect(within(foot).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(within(foot).queryByRole('button', { name: /^Next/ })).toBeNull();
    expect(card.querySelectorAll('.lm-mk-reason')).toHaveLength(1);
  });
});
