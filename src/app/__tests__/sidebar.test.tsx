import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as LivingMode from '@/features/living/mode';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetActivePlan } from '@/features/living/activePlan';
import { AppShell } from '../shell/AppShell';
import { Sidebar } from '../shell/Chrome';
import { setNavBadge, useNavBadges } from '../shell/nav';
import { SIDEBAR_ID, SIDEBAR_KEY, setSidebarCollapsed, toggleSidebar, useSidebarPref } from '../shell/sidebar';
import { TopBar } from '../shell/TopBar';

vi.mock('../shell/HeaderSync', () => ({ HeaderSync: () => null }));
vi.mock('@/agents/AgentSurfaces', () => ({ AgentSurfaces: () => null }));

// The app mode decides the rows; the real one is covered by modeNav.test.tsx.
const appMode = vi.hoisted(() => ({ mode: 'planning' as 'planning' | 'living', override: false }));
vi.mock('@/features/living/mode', async (importOriginal) => ({
  ...(await importOriginal<typeof LivingMode>()),
  useAppMode: () => ({ mode: appMode.mode, override: appMode.override, plan: null }),
}));

// jsdom has no scrolling; ScrollRestoration calls it on navigation.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

const original = window.matchMedia;
// AppShell subscribes to save failures through a lazy bus import. Wait for its dependency graph before the small
// navigation tests finish, so a loaded suite cannot tear jsdom down while that import is still resolving.
beforeAll(async () => {
  await import('@/commands/bus');
}, 120_000);

/** A window `px` wide: the min-width queries up to that width match (lg = 64rem, xl = 80rem). */
function windowWidth(px: number) {
  window.matchMedia = ((query: string) => {
    const m = /min-width:\s*([\d.]+)rem/.exec(query);
    return {
      matches: m ? Number(m[1]) * 16 <= px : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  appMode.mode = 'planning';
  appMode.override = false;
  localStorage.removeItem(SIDEBAR_KEY);
  useSidebarPref.setState({ pref: null });
  windowWidth(1440);
});
afterEach(() => {
  window.matchMedia = original;
  vi.restoreAllMocks();
  act(() => useNavBadges.setState({ badges: {} }));
  resetActivePlan();
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderSidebar(path: string, extra?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Sidebar />
              {extra}
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
/** r068 U14: the sidebar's labelled groups (main · planning · library) and Settings at the foot (app). */
const group = (name: 'main' | 'plan' | 'planning' | 'library' | 'app') => sidebar().querySelector<HTMLElement>(`[data-group='${name}']`)!;
const groupLabels = () => [...sidebar().querySelectorAll('.lm-side__group-label')].map((l) => l.textContent);
/** Each row's accessible name (links: the destination's name; the mode switch: its words). */
const rowNames = (el: HTMLElement) => [...el.querySelectorAll('a, button')].map((r) => r.getAttribute('aria-label') ?? r.textContent);

describe('the desktop sidebar (SPEC §8.2, r068 U14)', () => {
  it('Living: the brand, then one list in labelled groups: Today · Food · Train · Ring / Your plan / Planning / Library, Settings at the foot', () => {
    appMode.mode = 'living';
    renderSidebar('/today');
    const nav = sidebar();
    expect(nav).toHaveAttribute('id', SIDEBAR_ID);
    expect(within(nav).getByRole('link', { name: 'Vitals, home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByText('Vitals')).toBeInTheDocument();
    expect(rowNames(group('main'))).toEqual(['today', 'food', 'train', 'ring', 'energy', 'progress']);
    // (r068 final M19) the running plan's own page is the only row a plan adds; Progress and Coach keep their groups
    expect(rowNames(group('plan'))).toEqual(['plan details']);
    expect(rowNames(group('planning'))).toEqual(['body', 'simulate', 'plan', 'coach']);
    expect(rowNames(group('library'))).toEqual(['evidence']);
    expect(rowNames(group('app'))).toEqual(['settings']);
    expect(groupLabels()).toEqual(['Your plan', 'Planning', 'Library']);
    // the label is drawn on the row (capitalised); the accessible name stays the destination's name
    expect(within(group('main')).getByRole('link', { name: 'today' })).toHaveTextContent('Today');
    // no mode switch row: the planning screens are rows of their own
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Sidebar']);
    expect(within(nav).queryByText(/theme/i)).toBeNull();
  });

  it('marks the current destination (aria-current: the gold-soft row) and its rows navigate', () => {
    appMode.mode = 'living';
    renderSidebar('/food');
    expect(within(group('main')).getByRole('link', { name: 'food' })).toHaveAttribute('aria-current', 'page');
    expect(within(group('main')).getByRole('link', { name: 'today' })).not.toHaveAttribute('aria-current');
    fireEvent.click(within(group('app')).getByRole('link', { name: 'settings' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings');
    expect(within(group('app')).getByRole('link', { name: 'settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('Plan is current on the Planner’s pages but not on Plan details (a Living page under /plan/active)', () => {
    appMode.mode = 'living';
    renderSidebar('/plan/goals');
    expect(within(group('planning')).getByRole('link', { name: 'plan' })).toHaveAttribute('aria-current', 'page');
    cleanup();
    renderSidebar('/plan/active');
    expect(within(group('planning')).getByRole('link', { name: 'plan' })).not.toHaveAttribute('aria-current');
    expect(within(group('plan')).getByRole('link', { name: 'plan details' })).toHaveAttribute('aria-current', 'page');
  });

  // the list is stable: Planning mode leaves out only the places a plan opens (Food, Plan details) and names Train's hub
  // "Activities"; Progress needs no plan (r068 L29: weigh-ins, body, markers) and follows Ring
  it('Planning: the same rows in the same order, without Food and Plan details; Activities opens Train’s activity hub', () => {
    renderSidebar('/body');
    expect(rowNames(group('main'))).toEqual(['today', 'activities', 'ring', 'energy', 'progress']);
    expect(rowNames(group('planning'))).toEqual(['body', 'simulate', 'plan', 'coach']);
    expect(rowNames(group('library'))).toEqual(['evidence']);
    expect(rowNames(group('app'))).toEqual(['settings']);
    expect(within(group('main')).getByRole('link', { name: 'activities' })).toHaveAttribute('href', '/train');
    // its only button is its own key (r068 U13)
    expect(within(sidebar()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Sidebar']);
  });

  it('the planning override changes nothing in the list', () => {
    appMode.mode = 'living';
    appMode.override = true;
    renderSidebar('/simulate');
    expect(rowNames(group('main'))).toEqual(['today', 'food', 'train', 'ring', 'energy', 'progress']);
    expect(within(group('planning')).getByRole('link', { name: 'simulate' })).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar()).queryByRole('button', { name: 'Back to Today' })).toBeNull();
  });

  it('a badge shows as a dot on the row and joins its name ("coach, a proposal is waiting")', () => {
    renderSidebar('/body');
    act(() => setNavBadge('coach', true));
    const coach = within(group('planning')).getByRole('link', { name: 'coach, a proposal is waiting' });
    expect(coach.querySelector('.lm-side__dot')).not.toBeNull();
  });
});

describe('expanded and collapsed', () => {
  it('until the person chooses, it follows the window: expanded from 1280 px, collapsed below', () => {
    renderSidebar('/body');
    expect(sidebar()).not.toHaveAttribute('data-collapsed');
    cleanup();
    windowWidth(1100);
    renderSidebar('/body');
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
  });

  it('collapsed: the same rows and names (icons; the labels stay in the accessibility tree)', () => {
    act(() => setSidebarCollapsed(true));
    appMode.mode = 'living';
    renderSidebar('/today');
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    expect(rowNames(group('main'))).toEqual(['today', 'food', 'train', 'ring', 'energy', 'progress']);
    expect(rowNames(group('plan'))).toEqual(['plan details']);
    expect(rowNames(group('planning'))).toEqual(['body', 'simulate', 'plan', 'coach']);
    expect(rowNames(group('app'))).toEqual(['settings']);
  });

  it('collapsed rows name themselves in a tooltip on keyboard focus; expanded rows show no tooltip', () => {
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) {
      return sel === ':focus-visible' ? true : Element.prototype.matches.call(this, sel);
    });
    vi.useFakeTimers();
    try {
      act(() => setSidebarCollapsed(true));
      renderSidebar('/body');
      act(() => within(group('planning')).getByRole('link', { name: 'simulate' }).focus());
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Simulate');
      act(() => within(group('planning')).getByRole('link', { name: 'simulate' }).blur());
      act(() => setSidebarCollapsed(false));
      act(() => within(group('planning')).getByRole('link', { name: 'plan' }).focus());
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the choice is kept on this device; blocked storage keeps it for the session without failing', () => {
    act(() => toggleSidebar());
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('collapsed');
    expect(useSidebarPref.getState().pref).toBe('collapsed');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    act(() => toggleSidebar());
    expect(useSidebarPref.getState().pref).toBe('expanded');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('collapsed');
  });
});

describe('in the shell', () => {
  function renderShell(path = '/body') {
    const router = createMemoryRouter(
      [{ path: '/', element: <AppShell />, children: [{ path: '*', element: <TopBar title="Your body" /> }] }],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it('does not steal focus from a panel or new page control while a delayed route title is pending', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const flush = () => {
      for (let frame = 0; frame < 65; frame++) {
        const queued = [...frames.values()];
        frames.clear();
        for (const callback of queued) callback(performance.now());
      }
    };

    const router = renderShell('/body');
    const title = await screen.findByRole('heading', { level: 1, name: 'Your body' });
    await act(async () => {
      await router.navigate('/simulate');
    });
    const panel = document.createElement('aside');
    panel.className = 'lm-sidepanel';
    const panelTitle = document.createElement('h2');
    panelTitle.tabIndex = -1;
    panel.append(panelTitle);
    document.body.append(panel);
    panelTitle.focus();
    act(flush);
    expect(document.activeElement).toBe(panelTitle);
    panel.remove();

    // A subsequent route change with no interaction still sends focus to the page title.
    await act(async () => {
      await router.navigate('/body');
    });
    act(flush);
    expect(document.activeElement).toBe(title);

    await act(async () => {
      await router.navigate('/simulate');
    });
    const control = document.createElement('button');
    control.textContent = 'Edit day';
    document.querySelector('.lm-main')!.append(control);
    control.focus();
    act(flush);
    expect(document.activeElement).toBe(control);
  });

  it('the app frame carries the state (data-sidebar) for the layout; the sidebar’s own key controls it', async () => {
    renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const app = document.querySelector('.lm-app')!;
    expect(app).toHaveAttribute('data-sidebar', 'expanded');
    // r068 U13: the key sits in the sidebar's own head, not in the bar
    expect(within(document.querySelector<HTMLElement>('.lm-ctx-slot')!).queryByRole('button', { name: 'Sidebar' })).toBeNull();
    const toggle = within(document.querySelector<HTMLElement>('.lm-side__head')!).getByRole('button', { name: 'Sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveClass('lm-sidebar');
    fireEvent.click(toggle);
    expect(app).toHaveAttribute('data-sidebar', 'collapsed');
    expect(document.querySelector('.lm-sidebar')).toHaveAttribute('data-collapsed', 'true');
  });

  it('Ctrl/⌘ + B toggles it on desktop (not on auto-repeat), and does nothing below 1024 px', async () => {
    renderShell();
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    const app = document.querySelector('.lm-app')!;
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(app).toHaveAttribute('data-sidebar', 'collapsed');
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(app).toHaveAttribute('data-sidebar', 'expanded');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, repeat: true });
    expect(app).toHaveAttribute('data-sidebar', 'expanded');
    fireEvent.keyDown(window, { key: 'b' });
    expect(app).toHaveAttribute('data-sidebar', 'expanded');
    windowWidth(800);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('expanded');
  });
});
