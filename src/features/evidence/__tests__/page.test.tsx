import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { EvidenceRepository } from '../data/repository';
import EvidencePage from '../EvidencePage';
import { EvidenceRepositoryContext } from '../hooks';
import { loadedRepository } from './fixtures';

let current: ReturnType<typeof createMemoryRouter> | null = null;
const where = () => {
  const l = current!.state.location;
  return `${l.pathname}${l.search}${l.hash}`;
};

function renderAt(url: string, repo: EvidenceRepository) {
  const page = <EvidencePage />;
  const router = createMemoryRouter(
    [
      { path: '/evidence', element: page },
      { path: '/evidence/:mechanismId', element: page },
      { path: '/evidence/topics/:topicSlug', element: page },
    ],
    { initialEntries: [url] },
  );
  current = router;
  render(
    <EvidenceRepositoryContext.Provider value={repo}>
      <RouterProvider router={router} />
    </EvidenceRepositoryContext.Provider>,
  );
  return router;
}

const params = () => new URLSearchParams(current!.state.location.search);

describe('Evidence index: URL ↔ filters', () => {
  it('reads query, categories and grades from the URL', async () => {
    renderAt('/evidence?q=glycogen&cat=fuel&grade=B', await loadedRepository());
    expect(screen.getByRole('searchbox', { name: /Search mechanisms/ })).toHaveValue('glycogen');
    expect(screen.getByRole('button', { name: /fuel & ketosis/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /body composition/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Grade B/ })).toHaveAttribute('aria-pressed', 'true');
    const mechanisms = screen.getByRole('heading', { name: 'Mechanisms' }).closest('section')!;
    const titles = within(mechanisms)
      .getAllByRole('link')
      .filter((a) => a.classList.contains('ev-row__link'))
      .map((a) => a.textContent);
    expect(titles).toEqual(['Glycogen holds water']);
  });

  it('writes filter changes back to the URL (push) and survives back', async () => {
    const user = userEvent.setup();
    const router = renderAt('/evidence?cat=fuel', await loadedRepository());
    await user.click(screen.getByRole('button', { name: /body composition/ }));
    expect(params().get('cat')).toBe('body,fuel');
    await user.click(screen.getByRole('button', { name: /^Grade A/ }));
    expect(params().get('grade')).toBe('A');
    expect(screen.getByRole('button', { name: /^Grade A/ })).toHaveAttribute('aria-pressed', 'true');

    await act(() => router.navigate(-1));
    expect(params().get('grade')).toBeNull();
    expect(screen.getByRole('button', { name: /^Grade A/ })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(params().get('cat')).toBeNull();
  });

  it('debounces typing into ?q= and clears with Escape', async () => {
    renderAt('/evidence', await loadedRepository());
    const box = screen.getByRole('searchbox', { name: /Search mechanisms/ });
    fireEvent.change(box, { target: { value: 'ldl' } });
    expect(params().get('q')).toBeNull();
    // generous timeouts: the whole suite runs in parallel and a busy worker can miss the default 1 s
    await waitFor(() => expect(params().get('q')).toBe('ldl'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByRole('link', { name: /Saturated fat raises LDL/ })).toBeInTheDocument(), { timeout: 3000 });
    // E20: markers. The URL changes before React commits the (transition) render of the results; with a larger library
    // that render takes longer, so wait for the committed query (the page title) before pressing Escape.
    await waitFor(() => expect(document.title).toMatch(/“ldl” in Evidence/), { timeout: 5000 });
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(box).toHaveValue(''));
    await waitFor(() => expect(params().get('q')).toBeNull(), { timeout: 3000 });
    // three 3 s waits can exceed the default 5 s test timeout on a loaded machine
  }, 15_000);

  it('shows the empty state with suggestions when nothing matches', async () => {
    const user = userEvent.setup();
    renderAt('/evidence?q=zebrafish', await loadedRepository());
    expect(screen.getByRole('heading', { name: 'No mechanism matches “zebrafish”.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'hunger' }));
    expect(params().get('q')).toBe('hunger');
  });

  it('opens an article from a row, then offers the way back', async () => {
    const user = userEvent.setup();
    renderAt('/evidence?q=glycogen', await loadedRepository());
    await user.click(screen.getByRole('link', { name: 'Glycogen holds water' }));
    expect(where()).toBe('/evidence/90-full');
    expect(await screen.findByRole('article', { name: 'Glycogen holds water' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Evidence' })).toBeInTheDocument();
    expect(document.title).toBe('Glycogen holds water · Vitals');
  });

  it('renders a topic page with its claims and open questions', async () => {
    renderAt('/evidence/topics/test-fuel', await loadedRepository());
    expect(await screen.findByRole('article', { name: 'Test fuel and water' })).toBeInTheDocument();
    const claims = screen.getByRole('heading', { name: 'Common claims' }).closest('section')!;
    expect(within(claims).getByText('“The first week of weight loss is all fat.”')).toBeInTheDocument();
    expect(within(claims).getByText('not supported')).toBeInTheDocument();
    expect(screen.getByText('How much water per gram of glycogen do women store?')).toBeInTheDocument();
  });

  it('says so when a mechanism id is unknown', async () => {
    renderAt('/evidence/88-missing', await loadedRepository());
    expect(
      await screen.findByRole('heading', { name: 'No mechanism with this address.' }),
    ).toBeInTheDocument();
  });
});
