import { render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionBar, TopBar } from '../shell/TopBar';
import { ShellContext, type ShellContextValue } from '../shell/ShellContext';

// the sync chip and the ring key are covered by their own tests
vi.mock('../shell/HeaderSync', () => ({ HeaderSync: () => null }));
vi.mock('@/features/ring/RingKey', () => ({ RingKey: () => null }));

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

/** A minimal shell: the sticky context slot at the top, the action slot at the foot. */
function Shell({ children }: { children: ReactNode }) {
  const [contextSlot, setContextSlot] = useState<HTMLDivElement | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const ctx: ShellContextValue = { contextSlot, actionSlot, setMobileHeader: () => undefined, setActionBarCount: () => undefined };
  return (
    <ShellContext.Provider value={ctx}>
      <div data-testid="context-slot" ref={setContextSlot} />
      <main>{children}</main>
      <div data-testid="action-slot" ref={setActionSlot} />
    </ShellContext.Provider>
  );
}

function renderScreen(ui: ReactNode) {
  render(
    <MemoryRouter>
      <Shell>{ui}</Shell>
    </MemoryRouter>,
  );
  return { top: screen.getByTestId('context-slot'), foot: screen.getByTestId('action-slot') };
}

describe('the action bar', () => {
  it('on desktop carries the screen’s parameters and actions along the bottom; the context bar keeps the title', () => {
    desktop();
    const { top, foot } = renderScreen(
      <>
        <TopBar title="Simulate" params={<span>12 wk</span>} actions={<button type="button">Run</button>} />
        <ActionBar>
          <button type="button">Run (phone)</button>
        </ActionBar>
      </>,
    );
    expect(within(top).getByRole('heading', { level: 1, name: 'Simulate' })).toBeInTheDocument();
    expect(within(top).queryByRole('button', { name: 'Run' })).toBeNull();
    expect(within(top).queryByText('12 wk')).toBeNull();
    const desk = foot.querySelector('.lm-actionbar[data-place="desk"]') as HTMLElement;
    expect(desk).not.toBeNull();
    expect(within(desk).getByRole('button', { name: 'Run' })).toBeInTheDocument();
    // parameters first, the actions (primary last) after them, as on the phone bar
    expect(desk.textContent).toBe('12 wkRun');
    // the screen's phone bar is still mounted beside it; CSS shows the desktop one (no duplicate in the a11y tree)
    expect(foot.querySelector('.lm-actionbar[data-place="foot"]')).not.toBeNull();
  });

  it('on desktop keeps a status-only line in the context bar and opens no bar', () => {
    desktop();
    const { top, foot } = renderScreen(<TopBar title="Your body" actions={<span>saved on this device</span>} />);
    expect(within(top).getByText('saved on this device')).toBeInTheDocument();
    expect(foot.querySelector('.lm-actionbar')).toBeNull();
  });

  it('below 1024 px leaves the actions in the context bar and puts the screen’s <ActionBar> at the foot', () => {
    const { top, foot } = renderScreen(
      <>
        <TopBar title="Plan" actions={<button type="button">Adjust goals</button>} />
        <ActionBar>
          <button type="button">Find plans</button>
        </ActionBar>
      </>,
    );
    expect(within(top).getByRole('button', { name: 'Adjust goals' })).toBeInTheDocument();
    const bar = foot.querySelector('.lm-actionbar') as HTMLElement;
    expect(bar.dataset.place).toBe('foot');
    expect(within(bar).getByRole('button', { name: 'Find plans' })).toBeInTheDocument();
    expect(foot.querySelector('[data-place="desk"]')).toBeNull();
  });

  it('below 1024 px marks the context bar as the foot bar (CSS fixes it above the action bar); the title stays an h1 in the top slot', () => {
    const { top, foot } = renderScreen(
      <>
        <TopBar title="Today" actions={<button type="button">Today menu</button>} />
        <ActionBar>
          <button type="button">Find plans</button>
        </ActionBar>
      </>,
    );
    const bar = top.querySelector('.lm-ctx') as HTMLElement;
    expect(bar.dataset.bottom).toBe('true');
    expect(within(bar).getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    // the heading comes before the page's own content in the DOM: reading order is unchanged
    expect(top.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(foot.querySelector('.lm-actionbar')).not.toBeNull();
  });

  it('on desktop and for compact screens the context bar stays at the top', () => {
    desktop();
    const { top } = renderScreen(<TopBar title="Today" />);
    expect((top.querySelector('.lm-ctx') as HTMLElement).dataset.bottom).toBeUndefined();
  });
});

describe('the context bar below 1024 px', () => {
  it('is not marked for foot placement on a compact screen', () => {
    const { top } = renderScreen(<TopBar title="Settings" compactOnMobile />);
    expect((top.querySelector('.lm-ctx') as HTMLElement).dataset.bottom).toBeUndefined();
  });
});
