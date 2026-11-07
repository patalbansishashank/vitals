import { render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionBar, TopBar } from '../shell/TopBar';
import { ShellContext, type ShellContextValue } from '../shell/ShellContext';

// the sync chip is covered by its own test
vi.mock('../shell/HeaderSync', () => ({ HeaderSync: () => null }));

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

/** ≥ 1024 px: only the `lg` query (and wider-than queries below it) match. */
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

/** A minimal shell, in the real order: the header slot at the top of main, the page, the action slot after it. */
function Shell({ children }: { children: ReactNode }) {
  const [contextSlot, setContextSlot] = useState<HTMLDivElement | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const ctx: ShellContextValue = { contextSlot, actionSlot, setActionBarCount: () => undefined };
  return (
    <ShellContext.Provider value={ctx}>
      <main>
        <div data-testid="header-slot" ref={setContextSlot} />
        <div data-testid="page">{children}</div>
        <div data-testid="action-slot" ref={setActionSlot} />
      </main>
    </ShellContext.Provider>
  );
}

function renderScreen(ui: ReactNode) {
  render(
    <MemoryRouter>
      <Shell>{ui}</Shell>
    </MemoryRouter>,
  );
  return { top: screen.getByTestId('header-slot'), page: screen.getByTestId('page'), foot: screen.getByTestId('action-slot') };
}

describe('the header (TopBar) at every width', () => {
  it.each([
    ['below 1024 px', () => undefined],
    ['on desktop', desktop],
  ])('%s sits at the top of the content column, the h1 first in the reading order, never at the foot', (_w, setup) => {
    setup();
    const { top, page } = renderScreen(<TopBar title="Today" subtitle="Saturday, 17 October" />);
    const header = top.querySelector('.lm-ctx') as HTMLElement;
    expect(within(header).getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(within(header).getByText('Saturday, 17 October')).toHaveClass('lm-ctx__sub');
    expect(header.dataset.bottom).toBeUndefined();
    expect(header.dataset.phone).toBe('tab');
    expect(top.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the legacy params (as the desktop subtitle line) and actions in the header; nothing moves to a bar at the foot', () => {
    desktop();
    const { top, foot } = renderScreen(<TopBar title="Simulate" params={<span>12 wk</span>} actions={<button type="button">Run</button>} />);
    const header = top.querySelector('.lm-ctx') as HTMLElement;
    expect(within(header).getByText('12 wk').closest('.lm-ctx__params')).not.toBeNull();
    expect(within(header).getByRole('button', { name: 'Run' }).closest('.lm-ctx__trail')).not.toBeNull();
    expect(foot.querySelector('.lm-actionbar')).toBeNull();
    expect(document.querySelector('[data-place="desk"]')).toBeNull();
  });

  it('a subtitle wins over params', () => {
    const { top } = renderScreen(<TopBar title="Today" subtitle="Sat 17 Oct" params={<span>old status line</span>} />);
    expect(within(top).getByText('Sat 17 Oct')).toBeInTheDocument();
    expect(within(top).queryByText('old status line')).toBeNull();
  });

  it('right end: the status, then the primary pill, then the one ⋯ (in that order)', () => {
    const { top } = renderScreen(
      // the ⋯ holds the page's own actions only (r068 U14), so the page passes one
      <TopBar title="Today" status={<span>Check-in ready</span>} primary={<button type="button">Log meal</button>} menu={[{ id: 'away', label: 'Busy or away', onSelect: () => undefined }]} />,
    );
    const trail = top.querySelector('.lm-ctx__trail') as HTMLElement;
    const order = [...trail.querySelectorAll('span, button')].map((n) => n.getAttribute('aria-label') ?? n.textContent);
    expect(order.indexOf('Check-in ready')).toBeLessThan(order.indexOf('Log meal'));
    expect(order.indexOf('Log meal')).toBeLessThan(order.indexOf('More'));
    expect(within(top).getAllByRole('button', { name: 'More' })).toHaveLength(1);
    // the status icons are grouped in .lm-ctx__caps, the keys (primary, ⋯) after it, never inside
    const caps = trail.querySelector('.lm-ctx__caps') as HTMLElement;
    expect(within(caps).getByText('Check-in ready')).toBeInTheDocument();
    expect(within(caps).queryByRole('button', { name: 'Log meal' })).toBeNull();
    expect(within(caps).queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('pushed page: a Back key named for where it goes, the title centred (data-phone="pushed"); mobileOnly keeps the desktop tab header', () => {
    const { top } = renderScreen(<TopBar title="Pantry" back={{ to: '/food', label: 'Food' }} />);
    const header = top.querySelector('.lm-ctx') as HTMLElement;
    expect(header.dataset.phone).toBe('pushed');
    expect(header.dataset.desk).toBe('pushed');
    expect(within(header).getByRole('button', { name: 'Back to Food' })).toHaveClass('lm-ctx__back');
  });

  it('back.mobileOnly (Settings): pushed on phones, a tab-page header on desktop', () => {
    const { top } = renderScreen(<TopBar title="Settings" back={{ mobileOnly: true }} compactOnMobile />);
    const header = top.querySelector('.lm-ctx') as HTMLElement;
    expect(header.dataset.phone).toBe('pushed');
    expect(header.dataset.desk).toBe('tab');
  });

  it('tabs and progress sit under the title inside the header block', () => {
    const { top } = renderScreen(<TopBar title="Train" tabs={<span>today | week</span>} progress={<span>step 2 of 5</span>} />);
    const header = top.querySelector('.lm-ctx') as HTMLElement;
    expect(within(header).getByText('today | week').closest('.lm-ctx__tabs')).not.toBeNull();
    expect(within(header).getByText('step 2 of 5').closest('.lm-ctx__progress')).not.toBeNull();
  });
});

describe('the action bar', () => {
  it.each([
    ['below 1024 px', () => undefined],
    ['on desktop', desktop],
  ])('%s renders its row after the screen’s content, in the flow (no bar above the tab bar, no fixed desktop bar)', (_w, setup) => {
    setup();
    const { page, foot } = renderScreen(
      <>
        <TopBar title="Plan" actions={<button type="button">Adjust goals</button>} />
        <ActionBar>
          <button type="button">Find plans</button>
        </ActionBar>
        <p>goals</p>
      </>,
    );
    const row = foot.querySelector('.lm-actionbar') as HTMLElement;
    expect(row.dataset.place).toBe('foot');
    expect(within(row).getByRole('button', { name: 'Find plans' })).toBeInTheDocument();
    // after the page's content in the DOM, whatever its place in the JSX
    expect(page.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(page).queryByRole('button', { name: 'Find plans' })).toBeNull();
    // the header's actions stay in the header
    expect(within(row).queryByRole('button', { name: 'Adjust goals' })).toBeNull();
  });

  it('outside the shell renders its row in place', () => {
    render(
      <ActionBar>
        <button type="button">Next</button>
      </ActionBar>,
    );
    expect(screen.getByRole('button', { name: 'Next' }).closest('.lm-actionbar')).not.toBeNull();
  });
});
