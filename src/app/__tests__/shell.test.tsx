import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as LivingMode from '@/features/living/mode';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFound, PageFallback } from '../shell/RouteStates';
import { NoticesRegion, showNotice, useNoticeStore } from '../shell/notices';
import { CirclePause, ClipboardCheck, Inbox, ShieldCheck, UserRound, WifiOff } from 'lucide-react';
import { StatusCapsule } from '@/components/StatusCapsule';
import { ShellHeader, TopBar } from '../shell/TopBar';
import { Sidebar } from '../shell/Chrome';
import { SIDEBAR_ID, SIDEBAR_KEY, useSidebarPref } from '../shell/sidebar';

vi.mock('../shell/HeaderSync', () => ({ HeaderSync: () => null }));

// The app mode drives the global ⋯ items, the override's Back and the dead-end way home; the real one is covered by
// modeNav.test.tsx.
const appMode = vi.hoisted(() => ({ mode: 'planning' as 'planning' | 'living', override: false }));
vi.mock('@/features/living/mode', async (importOriginal) => ({
  ...(await importOriginal<typeof LivingMode>()),
  useAppMode: () => ({ mode: appMode.mode, override: appMode.override, plan: null }),
}));

const original = window.matchMedia;
/** ≥ 1024 px: only the `lg` query (and the wider-than queries below it) match. */
function desktop() {
  window.matchMedia = ((query: string) =>
    ({
      matches: /min-width:\s*(48|64)rem/.test(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = original;
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderAt(path: string, ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<>{ui}<Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const openMore = () => fireEvent.click(screen.getByRole('button', { name: 'More' }));
const items = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);

beforeEach(() => {
  appMode.mode = 'planning';
  appMode.override = false;
  localStorage.removeItem(SIDEBAR_KEY);
  useSidebarPref.setState({ pref: null });
});

// r068 U14: the ⋯ holds the page's own actions only; every place is in the navigation (the phone dock's More page,
// the desktop sidebar), so the ⋯ never doubles as a menu of destinations
describe('the one ⋯ in the phone bar', () => {
  it('Living: the page’s own items only (no places, no divider, no theme switch)', () => {
    appMode.mode = 'living';
    const onAway = vi.fn();
    renderAt('/today', <TopBar title="Today" menu={[{ id: 'away', label: 'I’m busy or away…', onSelect: onAway }]} />);
    openMore();
    expect(items()).toEqual(['I’m busy or away…']);
    expect(within(screen.getByRole('menu')).queryByRole('separator')).toBeNull();
    expect(screen.queryByText(/theme/i)).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'I’m busy or away…' }));
    expect(onAway).toHaveBeenCalledTimes(1);
  });

  it('a page without actions of its own shows no ⋯ at all, in either mode', () => {
    renderAt('/body', <TopBar title="Your body" />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    cleanup();
    appMode.mode = 'living';
    renderAt('/coach', <TopBar title="Coach" />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  // r068 U14 (and L19): a screen's ⋯ is its own actions only; the places live in the dock, More and the sidebar
  it('any screen’s ⋯ holds the page’s own actions only, and a page without any shows no ⋯', () => {
    appMode.mode = 'living';
    renderAt('/food', <TopBar title="Food" menu={[{ id: 'pantry', label: 'Pantry', onSelect: () => {} }]} />);
    openMore();
    expect(items()).toEqual(['Pantry']);
    expect(within(screen.getByRole('menu')).queryByRole('separator')).toBeNull();
    cleanup();
    renderAt('/coach', <TopBar title="Coach" />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});

describe('a pushed page’s header (Lumen §6: Back, a centred title, nothing else)', () => {
  it('has no ⋯ when the page brings no actions of its own (the global items wait on the tab pages)', () => {
    appMode.mode = 'living';
    renderAt('/food/pantry', <TopBar title="Pantry" back={{ to: '/food', label: 'Food' }} />);
    expect(screen.getByRole('button', { name: 'Back to Food' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pantry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    // dividers and section labels alone are not actions
    cleanup();
    renderAt('/food/pantry', <TopBar title="Pantry" back menu={[{ kind: 'divider', id: 'd' }]} />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('keeps the one ⋯ when the page passes its own items, and holds only those', () => {
    appMode.mode = 'living';
    const onPause = vi.fn();
    renderAt('/plan/active', <TopBar title="Plan details" back menu={[{ id: 'pause', label: 'Pause plan', onSelect: onPause }]} />);
    openMore();
    expect(items()).toEqual(['Pause plan']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause plan' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('back.mobileOnly (Settings): pushed on phones (no ⋯, a Back); a tab-page bar on desktop (no Back)', () => {
    renderAt('/settings', <TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(document.querySelector('.lm-ctx')).toHaveAttribute('data-phone', 'pushed');
    cleanup();
    desktop();
    renderAt('/settings', <TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />);
    expect(document.querySelector('.lm-ctx')).toHaveAttribute('data-desk', 'tab');
    // the sidebar holds Coach and Settings on desktop, and the page has no actions of its own: no ⋯ at all
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});

// 0.6.3: the app restarted on Settings (after an update from Settings › About) and its Back sent the person to "/",
// which in Planning mode reopened Settings: a loop with no way out on a phone.
describe('Back without a target of its own', () => {
  function renderEntries(entries: string[], ui: ReactNode) {
    return render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="*" element={<>{ui}<Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('Settings opened first (no history behind it): Back lands on Today', () => {
    renderEntries(['/settings'], <TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
  });

  it('with a screen behind it, Back goes one step back in history', () => {
    renderEntries(['/body', '/settings'], <TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/body');
  });

  it('any pushed page with no history lands on Today too', () => {
    renderEntries(['/ring/signals/hr'], <TopBar title="Heart rate" back />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
  });
});

// r068 U14: the navigation no longer changes in the planning override (Today is always a dock key and a sidebar row),
// so the header never borrows a Back slot for "Back to Today"
describe('the planning override', () => {
  it('a tab page gets no "Back to Today" key; a pushed page keeps its own Back', () => {
    appMode.override = true;
    renderAt('/simulate', <TopBar title="Simulate" />);
    expect(screen.queryByRole('button', { name: 'Back to Today' })).toBeNull();
    expect(document.querySelector('.lm-ctx')).toHaveAttribute('data-phone', 'tab');
    cleanup();
    renderAt('/evidence/t/energy', <TopBar title="Energy balance" back={{ to: '/evidence', label: 'Evidence' }} />);
    expect(screen.getByRole('button', { name: 'Back to Evidence' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to Today' })).toBeNull();
  });
});

describe('the desktop bar (SPEC §8.3)', () => {
  beforeEach(desktop);

  it('leads with the title (the sidebar key lives in the sidebar, r068 U13); the fact line rides in the bar', () => {
    renderAt('/today', <TopBar title="Today" subtitle="Saturday, 17 October · day 16 of 90" />);
    const row = document.querySelector('.lm-ctx__row') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Sidebar' })).toBeNull();
    expect(row.firstElementChild).toHaveClass('lm-ctx__heading');
    expect(within(row).getByText('Saturday, 17 October · day 16 of 90')).toHaveClass('lm-ctx__sub');
  });

  it('the sidebar’s own key (aria-controls the sidebar, Ctrl/⌘ + B) expands and collapses it, and the choice is kept on this device', () => {
    renderAt('/today', <Sidebar />);
    const head = document.querySelector('.lm-side__head') as HTMLElement;
    const toggle = within(head).getByRole('button', { name: 'Sidebar' });
    expect(toggle).toHaveAttribute('aria-controls', SIDEBAR_ID);
    expect(toggle).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');
    // no choice yet and a window under 1280 px: collapsed
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('expanded');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('collapsed');
  });

  it('a pushed page: Back, then the title', () => {
    renderAt('/food/pantry', <TopBar title="Pantry" back={{ to: '/food', label: 'Food' }} />);
    const row = document.querySelector('.lm-ctx__row') as HTMLElement;
    const keys = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(keys[0]).toBe('Back to Food');
  });

  it('the ⋯ carries the page’s own actions only (the sidebar holds the places), and is gone without any', () => {
    appMode.mode = 'living';
    const onAway = vi.fn();
    renderAt('/today', <TopBar title="Today" menu={[{ id: 'away', label: 'I’m busy or away…', onSelect: onAway }]} />);
    openMore();
    expect(items()).toEqual(['I’m busy or away…']);
    expect(within(screen.getByRole('menu')).queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'I’m busy or away…' }));
    expect(onAway).toHaveBeenCalledTimes(1);
    cleanup();
    renderAt('/progress', <TopBar title="Progress" />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    cleanup();
    renderAt('/progress', <TopBar title="Progress" menu={[{ kind: 'divider', id: 'd' }]} />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('phones have no sidebar key (no sidebar there)', () => {
    window.matchMedia = original;
    renderAt('/today', <TopBar title="Today" />);
    expect(screen.queryByRole('button', { name: 'Sidebar' })).toBeNull();
  });
});

describe('the shell’s own header', () => {
  it('while no screen has a TopBar (a lazy screen loading): no title and no ⋯ of its own (the dock’s More holds the places)', () => {
    renderAt('/body', <ShellHeader />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('on desktop: no keys of its own (the sidebar holds the global items and its own key)', () => {
    desktop();
    renderAt('/body', <ShellHeader />);
    expect(screen.queryByRole('button', { name: 'Sidebar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('the header’s status icons (SPEC §9)', () => {
  const statusKeys = () => [...document.querySelectorAll<HTMLElement>('.lm-ctx .lm-status-icon:not([hidden])')].map((b) => b.getAttribute('aria-label'));

  it('hold the page’s status before the ⋯ as an icon with its meaning as its name, and a press opens its sheet', () => {
    const open = vi.fn();
    renderAt(
      '/today',
      <TopBar title="Today" status={<StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention onClick={open} />} menu={[{ id: 'away', label: 'Busy or away', onSelect: () => {} }]} />,
    );
    const icon = screen.getByRole('button', { name: 'Weekly check-in ready' });
    expect(icon.closest('.lm-ctx__status')).not.toBeNull();
    expect(icon).toHaveTextContent('');
    expect(icon.compareDocumentPosition(screen.getByRole('button', { name: 'More' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(icon);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('show at most two, the ones that want attention first; the rest open from the top of the ⋯', () => {
    appMode.mode = 'living';
    const paused = vi.fn();
    renderAt(
      '/today',
      <TopBar
        title="Today"
        status={
          <>
            <StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention onClick={() => {}} />
            <StatusCapsule icon={CirclePause} label="Plan paused" onClick={paused} />
            <StatusCapsule icon={Inbox} label="2 changes waiting" attention onClick={() => {}} />
          </>
        }
        menu={[{ id: 'away', label: 'Busy or away', onSelect: () => {} }]}
      />,
    );
    expect(statusKeys()).toEqual(['Weekly check-in ready', '2 changes waiting']);
    openMore();
    expect(items()).toEqual(['Plan paused', 'Busy or away']);
    expect(within(screen.getByRole('menu')).getAllByRole('separator')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plan paused' }));
    expect(paused).toHaveBeenCalledTimes(1);
  });

  it('beside a primary key a phone bar shows one; the desktop bar shows two, and its ⋯ appears for the rest', () => {
    const bar = (
      <TopBar
        title="Plan"
        status={
          <>
            <StatusCapsule icon={UserRound} label="Your body isn’t finished yet" attention onClick={() => {}} />
            <StatusCapsule icon={ShieldCheck} label="Safety mode: Gentle mode" onClick={() => {}} />
            <StatusCapsule icon={WifiOff} label="You’re offline" />
          </>
        }
        primary={<button type="button">Find plans</button>}
      />
    );
    renderAt('/plan/goals', bar);
    expect(statusKeys()).toEqual(['Your body isn’t finished yet']);
    cleanup();
    desktop();
    renderAt('/plan/goals', bar);
    expect(statusKeys()).toEqual(['Your body isn’t finished yet', 'Safety mode: Gentle mode']);
    openMore();
    // one with nothing to open is listed as words, not as an item
    expect(within(screen.getByRole('menu')).queryAllByRole('menuitem')).toHaveLength(0);
    expect(within(screen.getByRole('menu')).getByText('You’re offline')).toBeInTheDocument();
  });

  it('a phone tab page’s fact line is its own row under the title row; a pushed page keeps it under its title', () => {
    renderAt('/today', <TopBar title="Today" subtitle="Saturday, 17 October · day 16 of 90" status={<StatusCapsule icon={Inbox} label="2 changes waiting" onClick={() => {}} />} />);
    const fact = screen.getByText('Saturday, 17 October · day 16 of 90');
    expect(fact).toHaveClass('lm-ctx__sub');
    expect(fact.parentElement).toHaveClass('lm-ctx');
    expect(fact.closest('.lm-ctx__row')).toBeNull();
    expect(fact.previousElementSibling).toHaveClass('lm-ctx__row');
    cleanup();
    renderAt('/plan/active', <TopBar title="Plan details" subtitle="Medium plan" back />);
    expect(screen.getByText('Medium plan').closest('.lm-ctx__heading')).not.toBeNull();
  });
});

describe('the banner slot', () => {
  afterEach(() => act(() => useNoticeStore.setState({ notices: [] })));

  it('shows one banner at a time, the most important first; dismissing it reveals the next', () => {
    render(<NoticesRegion />);
    act(() => {
      showNotice({ id: 'living-no-plan', severity: 'info', title: 'Start a plan to use Today.', dismissible: true });
      showNotice({ id: 'pwa-update', severity: 'info', priority: 1, title: 'Update available', dismissible: true });
    });
    const region = screen.getByRole('region', { name: 'Notices' });
    expect(within(region).getByText('Update available')).toBeInTheDocument();
    expect(within(region).queryByText('Start a plan to use Today.')).toBeNull();
    act(() => showNotice({ id: 'storage-blocked', severity: 'caution', title: "This browser isn't saving data." }));
    expect(within(region).getByText("This browser isn't saving data.")).toBeInTheDocument();
    expect(within(region).queryByText('Update available')).toBeNull();
    act(() => useNoticeStore.getState().dismiss('storage-blocked'));
    fireEvent.click(within(region).getByRole('button', { name: 'Dismiss' }));
    expect(within(region).getByText('Start a plan to use Today.')).toBeInTheDocument();
  });
});

describe('route states', () => {
  // 0.6.3: Today is home in every mode (it used to be Your body in Planning mode)
  it('not found: one line and one way home, to Today in Planning mode too', () => {
    renderAt('/nowhere', <NotFound />);
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByText("This page doesn't exist.")).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Go to Today']);
    expect(links[0]).toHaveAttribute('href', '/today');
  });

  it('a dead end under Today itself leads to Your body, never back into Today', () => {
    renderAt('/today/nowhere', <NotFound />);
    expect(screen.getByRole('link', { name: 'Go to Your body' })).toHaveAttribute('href', '/body');
  });

  it('not found in Living mode goes to Today', () => {
    appMode.mode = 'living';
    renderAt('/nowhere', <NotFound />);
    expect(screen.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today');
  });

  it('loading is a static skeleton, announced once, with no spinner, progress bar or heading', () => {
    render(<PageFallback />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading screen');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelectorAll('.lm-route-skel__block').length).toBeGreaterThan(0);
  });
});
