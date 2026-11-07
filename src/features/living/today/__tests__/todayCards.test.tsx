import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { freshState } from '@/commands/__tests__/harness';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { renderLiving } from '../../testing';
import TodayPage from '../TodayPage';
import { resolveTodayCards, storeTodayCards } from '../cards/todayCardsModel';
import { todayCardRegistry } from '../cards/registry';
import { MQ, Toaster } from '@/components';
import { todayViewFixture, CONTRACT_DATE } from './todayView.fixture';

beforeEach(() => freshState({ cleared: true }));
const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

async function editCards(label = 'Edit cards') {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

function desktop() {
  window.matchMedia = (query) => ({
    matches: query === MQ.lg,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

describe('Today card choices', () => {
  it('keeps page logging disabled on a planless future date', async () => {
    renderLiving(<TodayPage />, { path: '/today/2026-10-03', route: 'today/:date', plan: null });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Log an activity' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
  it('uses words in the hero tick toast in quiet mode even when the planned session label contains minutes', async () => {
    renderLiving(
      <>
        <TodayPage />
        <Toaster />
      </>,
      {
        path: '/today',
        route: 'today',
        now: `${CONTRACT_DATE}T13:00:00`,
        source: (stub) => ({
          ...stub.source,
          today: (date) => {
            const view = todayViewFixture({ date });
            return {
              ...view,
              quietMode: true,
              logged: { ...view.logged, items: [] },
              checklist: view.checklist
                .filter((r) => r.kind === 'session')
                .map((r) => ({ ...r, done: false })),
            };
          },
        }),
      },
    );
    fireEvent.click(screen.getByRole('button', { name: /^Mark next .+ as planned$/ }));
    const notice = await screen.findByText(/: as planned$/);
    expect(notice.textContent).not.toMatch(/\d/);
  });
  it('defaults are stable, and an explicit empty choice remains empty', () => {
    expect(resolveTodayCards(null, todayCardRegistry).map((s) => s.id)).toEqual([
      'eaten',
      'energy',
      'sleep',
      'steps',
      'weight',
    ]);
    expect(resolveTodayCards([], todayCardRegistry)).toEqual([]);
  });
  it('drops unknown ids, removes duplicates and repairs unsupported sizes without changing order', () => {
    expect(
      resolveTodayCards(
        ['gone', 'hero', 'steps:card', 'steps:tile', 'weight:hero', 'energy'],
        todayCardRegistry,
      ),
    ).toEqual([{ id: 'steps', size: 'card' }, { id: 'weight', size: 'tile' }, { id: 'energy', size: 'card' }]);
    expect(
      storeTodayCards(
        [
          { id: 'weight', size: 'card' },
          { id: 'steps', size: 'tile' },
        ],
        todayCardRegistry,
      ),
    ).toEqual(['weight:card', 'steps:tile']);
    expect(resolveTodayCards(['weight:wide', 'energy:wide'], todayCardRegistry)).toEqual([
      { id: 'weight', size: 'wide' }, { id: 'energy', size: 'wide' },
    ]);
  });
  it('enables desktop widths only through the existing Edit cards menu and removes them on Done', async () => {
    desktop();
    renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    const grid = screen.getByRole('group', { name: "Today's cards" });
    expect(grid).not.toHaveAttribute('data-rearrange');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit cards' })).toBeNull();
    await editCards();
    const width = screen.getByRole('slider', { name: 'Width of Steps' });
    expect(width).toHaveClass('lm-cardgrid__corner');
    expect(grid).toHaveAttribute('data-rearrange', 'true');
    expect(grid.querySelector('[data-id="hero"] .lm-cardgrid__corner')).toBeNull();
    fireEvent.keyDown(width, { key: 'End' });
    await waitFor(() => expect(useSettingsStore.getState().todayCards).toContain('steps:wide'));
    expect(grid.querySelector('[data-id="steps"]')).toHaveAttribute('data-span', '12');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Width of Steps' }), { key: 'Home' });
    await waitFor(() => expect(useSettingsStore.getState().todayCards).toContain('steps:tile'));
    await editCards('Done editing cards');
    expect(grid).not.toHaveAttribute('data-rearrange');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
    expect(screen.queryByText(/Editing cards ·/)).toBeNull();
  });
  it('expands saved desktop tiles on mobile without rewriting widths and offers reorder without resize', async () => {
    withSystemWrite(() => useSettingsStore.setState({ todayCards: ['energy:tile', 'weight:tile', 'steps:tile'] }));
    renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    const grid = screen.getByRole('group', { name: "Today's cards" });
    for (const id of ['energy', 'weight', 'steps']) {
      const cell = grid.querySelector(`[data-id="${id}"]`)!;
      expect(cell).toHaveAttribute('data-span', '2');
      expect(cell.querySelector('.lm-gcard')).toHaveAttribute('data-size', 'card');
    }
    expect(useSettingsStore.getState().todayCards).toEqual(['energy:tile', 'weight:tile', 'steps:tile']);
    await editCards();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.keyDown(screen.getByRole('group', { name: /^Weight, position/ }), { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(useSettingsStore.getState().todayCards).toEqual(['weight:tile', 'energy:tile', 'steps:tile']));
  });
  it('offers keyboard reorder without a toolbar and keeps the hero fixed', async () => {
    renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit cards' }));
    const grid = screen.getByRole('group', { name: "Today's cards" });
    expect(grid.querySelector('[data-id="hero"] .lm-cardgrid__corner')).toBeNull();
    expect(screen.queryByRole('button', { name: /Move / })).toBeNull();
    fireEvent.keyDown(screen.getByRole('group', { name: /^Weight, position/ }), { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(useSettingsStore.getState().todayCards).toEqual([
      'eaten:card', 'energy:card', 'sleep:card', 'weight:tile', 'steps:tile',
    ]));
    expect([...screen.getByRole('group', { name: "Today's cards" }).children].map((el) => (el as HTMLElement).dataset.id)).toEqual([
      'hero', 'eaten', 'energy', 'weight', 'steps',
    ]);
    fireEvent.keyDown(screen.getByRole('group', { name: /^Weight, position/ }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: /^Weight, position/ })).toBeNull());
    expect(screen.queryByRole('slider', { name: 'Width of Weight' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
  });
  it('shows only the hero for an empty saved list, with Add available only after the existing menu toggle', async () => {
    withSystemWrite(() => useSettingsStore.setState({ todayCards: [] }));
    const h = renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    const grid = screen.getByRole('group', { name: "Today's cards" });
    expect([...grid.children].map((e) => (e as HTMLElement).dataset.id)).toEqual(['hero']);
    expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit cards' }));
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a card' })).toBeInTheDocument();
    expect(grid.querySelector('.lm-cardgrid__corner')).toBeNull();
    expect(screen.queryByRole('dialog', { name: "Today's cards" })).toBeNull();
    h.result.unmount();
  });
  it('keeps normal info read-only and changes card selection only in the editing library', async () => {
    renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    fireEvent.click(screen.getByRole('button', { name: 'About Weight' }));
    const panel = await screen.findByRole('dialog', { name: 'Weight' });
    expect(within(panel).queryByRole('button', { name: /Remove from Today/ })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /close/i }));
    await editCards();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    const library = await screen.findByRole('dialog', { name: "Today's cards" });
    fireEvent.click(within(library).getByRole('button', { name: 'Remove Weight' }));
    await waitFor(() => expect(useSettingsStore.getState().todayCards).toEqual([
      'eaten:card', 'energy:card', 'sleep:card', 'steps:tile',
    ]));
    fireEvent.click(within(library).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(useSettingsStore.getState().todayCards).toBeNull());
  });
  it.each([false, true])('route changes end editing and close the library (planless=%s)', async (planless) => {
    const h = renderLiving(<TodayPage />, { path: '/today', route: 'today/:date?', ...(planless ? { plan: null } : {}) });
    await editCards();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    expect(await screen.findByRole('dialog', { name: "Today's cards" })).toBeInTheDocument();
    await act(() => h.router.navigate('/today/2026-10-02'));
    expect(screen.queryByRole('dialog', { name: "Today's cards" })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
    expect(screen.getByRole('group', { name: "Today's cards" })).not.toHaveAttribute('data-rearrange');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit cards' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Done editing cards' })).toBeNull();
  });
  it('keeps unavailable energy in the saved list while quiet mode hides the card', async () => {
    withSystemWrite(() => useSettingsStore.setState({ todayCards: ['energy', 'steps:card'] }));
    renderLiving(<TodayPage />, {
      path: '/today',
      route: 'today',
      source: (stub) => ({
        ...stub.source,
        today: (date) => {
          const view = stub.source.today(date);
          return view ? { ...view, quietMode: true } : null;
        },
      }),
    });
    expect(screen.queryByRole('region', { name: 'Energy' })).toBeNull();
    expect(useSettingsStore.getState().todayCards).toEqual(['energy', 'steps:card']);
    await editCards();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    expect((await screen.findAllByText('Hidden in quiet mode')).length).toBeGreaterThan(0);
  });
});
