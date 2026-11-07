/**
 * The Simulate screen's chrome (unslop SPEC §4): one header — the scenario switcher as its title, Schedule | Results as
 * its tabs — and one ⋯ that carries the schedule's week and selection actions. Nothing else in the title row: the one
 * Run key is in the page, at the end of the schedule's horizon row (on Results: the empty card's action before the
 * first run, then the head of the stage). No second bar ("nothing armed · Pick a program"), no second program tray, no
 * second Run key, no in-page notices. Program rows have no ⋯ of their own (SIM-01): a tap opens the program's sheet
 * (Edit all A days · Duplicate · Delete) and the row's one key, Paint, picks it to paint with.
 */
import '@/features/charts/test/setupDom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/App';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { initialScenarios, useScheduleStore } from '@/state/scheduleStore';
import { withSystemWrite } from '@/state/scope';

// jsdom has no scrolling; ScrollRestoration calls it on navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Simulate header and its one ⋯', () => {
  beforeEach(() => {
    localStorage.clear();
    withSystemWrite(() => useScheduleStore.setState({ ...initialScenarios(), history: {} }));
    seedClearedSafety();
  });

  it('puts the switcher, the tabs and the one Run key in the header, the horizon in the first row; the week actions in its ⋯', async () => {
    renderAt('/simulate/starter/schedule');
    const h1 = await screen.findByRole('heading', { level: 1 }, { timeout: 20_000 });
    expect(within(h1).getByRole('button', { name: /Moderate deficit/ })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Simulator section' });
    expect(within(tabs).getByRole('link', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Results' })).toBeInTheDocument();
    // exactly one Run key on the screen: the header's primary (r068 SC1), as Find plans is the Planner's
    const run = screen.getAllByRole('button', { name: /^Run/ });
    expect(run).toHaveLength(1);
    const header = h1.closest('.lm-ctx') as HTMLElement;
    expect(within(header).getByRole('button', { name: /^Run/ })).toBe(run[0]);
    expect(within(document.querySelector('.sim-horizon-row') as HTMLElement).getByRole('radiogroup', { name: 'Horizon in months' })).toBeInTheDocument();
    // the inline program list is the only program picker; no "armed" bar
    expect(screen.getAllByRole('list', { name: 'Programs' })).toHaveLength(1);
    expect(screen.queryByText(/nothing armed|Pick a program|painting with/)).toBeNull();
    // one ⋯ on the screen, the header's, holding the week and selection actions: no row menus
    expect(screen.getAllByRole('button', { name: 'More' })).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /actions$/ })).toHaveLength(0);
    expect(document.querySelectorAll('.sim-tray [aria-haspopup="menu"]:not(.sim-pkey--new)')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'More schedule actions' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Insert a copy of week 1' })).toBeInTheDocument());
    expect(within(menu).getByRole('menuitem', { name: 'Delete week 1' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Clear to A/ })).toBeInTheDocument();
    // r068 U14: places live in the navigation (dock › More, sidebar), never in a page's ⋯
    expect(within(menu).queryByRole('menuitem', { name: 'Settings' })).toBeNull();
  }, 40_000);

  it('keeps the wide schedule full width while its day editor opens and closes as an overlay', async () => {
    const originalMatchMedia = window.matchMedia;
    const wide = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...originalMatchMedia(query),
      matches: query === '(min-width: 64rem)' || query === '(min-width: 80rem)',
    }));
    try {
      renderAt('/simulate/starter/schedule');
      const grid = await screen.findByRole('grid', { name: /-day schedule/ }, { timeout: 20_000 });
      const schedule = grid.closest('.sim-sched') as HTMLElement;
      const calendar = schedule.querySelector('.sim-rasterface');
      const day = grid.querySelector<HTMLElement>('[data-day="0"]')!;
      expect(schedule).not.toHaveAttribute('data-editor');
      expect(document.querySelector('.sim-sched__editor')).toBeNull();

      fireEvent.keyDown(day, { key: 'Enter' });
      let editor = document.querySelector('.sim-sched__editor') as HTMLElement;
      expect(editor).toHaveAttribute('data-mode', 'overlay');
      expect(schedule).not.toHaveAttribute('data-editor');
      expect(schedule.querySelector('.sim-rasterface')).toBe(calendar);
      expect(schedule.contains(editor)).toBe(false);

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(document.querySelector('.sim-sched__editor')).toBeNull());
      expect(schedule.querySelector('.sim-rasterface')).toBe(calendar);

      fireEvent.keyDown(day, { key: 'Enter' });
      editor = document.querySelector('.sim-sched__editor') as HTMLElement;
      fireEvent.click(within(editor).getByRole('button', { name: /close/i }));
      await waitFor(() => expect(document.querySelector('.sim-sched__editor')).toBeNull());
      expect(schedule).not.toHaveAttribute('data-editor');
      expect(schedule.querySelector('.sim-rasterface')).toBe(calendar);
    } finally {
      wide.mockRestore();
    }
  }, 40_000);

  it('a program row opens its sheet; Paint picks it to paint with; every program action stays reachable', async () => {
    renderAt('/simulate/starter/schedule');
    await screen.findByRole('heading', { level: 1 }, { timeout: 20_000 });
    const list = screen.getByRole('list', { name: 'Programs' });
    const rowOf = (id: string) => within(list).getByRole('button', { name: new RegExp(`^Program ${id},`) });

    // Paint is the row's one key: a toggle, pressed while the program is picked; again lets it go
    const paintA = within(list).getByRole('button', { name: 'Paint with program A' });
    expect(paintA).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(paintA);
    expect(paintA).toHaveAttribute('aria-pressed', 'true');
    expect(paintA.closest('.sim-pkey')).toHaveAttribute('data-armed', 'true');
    fireEvent.click(paintA);
    expect(paintA).toHaveAttribute('aria-pressed', 'false');

    // the row opens the program's sheet (it no longer arms): title · ✕, one fact line, text keys
    expect(rowOf('A')).toHaveAttribute('aria-haspopup', 'dialog');
    rowOf('A').focus();
    fireEvent.click(rowOf('A'));
    expect(paintA).toHaveAttribute('aria-pressed', 'false');
    let sheet = await screen.findByRole('dialog', { name: /^A · / });
    expect(sheet.querySelector('.sim-progsheet__fact')?.textContent).toMatch(/ · \d+ A days$/);
    expect(within(sheet).getByRole('button', { name: 'Edit all A days' })).toBeInTheDocument();
    // the last program cannot go; the key stays focusable and says why
    expect(within(sheet).getByRole('button', { name: 'Delete · replace with…' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(sheet).queryByRole('menu')).toBeNull();

    // Edit all A days: the day editor on all A days; closing it goes back to A's row
    fireEvent.click(within(sheet).getByRole('button', { name: 'Edit all A days' }));
    const scope = await screen.findByRole('radiogroup', { name: /Edits apply to/ });
    expect(within(scope).getByRole('radio', { name: /^all \d+ A days/ })).toHaveAttribute('aria-checked', 'true');
    const editor = scope.closest('dialog') as HTMLElement;
    fireEvent.click(within(editor).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(document.activeElement).toBe(rowOf('A')));

    // Duplicate: the copy is B, picked to paint with
    fireEvent.click(rowOf('A'));
    sheet = await screen.findByRole('dialog', { name: /^A · / });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Paint with program B' })).toHaveAttribute('aria-pressed', 'true'));

    // Delete asks first; keeping it returns focus to its row
    fireEvent.click(rowOf('B'));
    sheet = await screen.findByRole('dialog', { name: /^B · / });
    expect(sheet.querySelector('.sim-progsheet__fact')?.textContent).toMatch(/ · no B days$/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    let confirm = await screen.findByRole('alertdialog', { name: 'Delete B?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep B' }));
    await waitFor(() => expect(document.activeElement).toBe(rowOf('B')));

    // deleting it unpicks it, and focus goes to the program that takes its days
    fireEvent.click(rowOf('B'));
    sheet = await screen.findByRole('dialog', { name: /^B · / });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    confirm = await screen.findByRole('alertdialog', { name: 'Delete B?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete B' }));
    await waitFor(() => expect(within(list).queryByRole('button', { name: /^Program B,/ })).toBeNull());
    expect(within(list).getByRole('button', { name: 'Paint with program A' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(document.activeElement).toBe(rowOf('A')));
  }, 60_000);

  it('results before the first run: one card with the fact and the one Run key (the header has none)', async () => {
    renderAt('/simulate/starter/results');
    const h1 = await screen.findByRole('heading', { level: 1 }, { timeout: 20_000 });
    expect(await screen.findByRole('heading', { name: 'No projection yet' }, { timeout: 20_000 })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Run/ })).toHaveLength(1);
    expect(within(h1.closest('.lm-ctx') as HTMLElement).queryByRole('button', { name: /^Run/ })).toBeNull();
    const card = screen.getByRole('region', { name: 'Projection' });
    expect(within(card).getByRole('button', { name: /^Run/ })).toBeInTheDocument();
    expect(screen.queryByText(/Replace active plan|Start this plan/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Warnings' })).toBeNull();
  }, 40_000);
});
