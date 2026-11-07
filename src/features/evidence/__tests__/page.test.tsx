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
    const user = userEvent.setup();
    renderAt('/evidence?q=glycogen&cat=fuel&grade=B', await loadedRepository());
    // the search sits in the header, under the title
    const header = screen.getByRole('heading', { level: 1, name: 'Evidence' }).closest('.lm-ctx')!;
    expect(within(header as HTMLElement).getByRole('searchbox', { name: /Search mechanisms/ })).toHaveValue('glycogen');
    const mechanisms = screen.getByRole('heading', { name: 'Mechanisms' }).closest('section')!;
    const titles = within(mechanisms)
      .getAllByRole('link')
      .filter((a) => a.classList.contains('ev-row__link'))
      .map((a) => a.textContent);
    expect(titles).toEqual(['Glycogen holds water']);

    // phones: one filter layer, in a sheet behind the Filter key (which says how many filters are on)
    expect(screen.queryByRole('button', { name: /fuel & ketosis/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filter, 2 on' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(sheet).getByRole('button', { name: /fuel & ketosis/i })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: /body composition/i })).toHaveAttribute('aria-pressed', 'false');
    // grade chips read as words, not bare letters
    const gradeB = within(sheet).getByRole('button', { name: /^Grade B/ });
    expect(gradeB).toHaveAttribute('aria-pressed', 'true');
    expect(gradeB).toHaveTextContent('Good');
  });

  it('writes filter changes back to the URL (push) and survives back', async () => {
    const user = userEvent.setup();
    const router = renderAt('/evidence?cat=fuel', await loadedRepository());
    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await user.click(within(sheet).getByRole('button', { name: /body composition/i }));
    expect(params().get('cat')).toBe('body,fuel');
    await user.click(within(sheet).getByRole('button', { name: /^Grade A/ }));
    expect(params().get('grade')).toBe('A');
    expect(within(sheet).getByRole('button', { name: /^Grade A/ })).toHaveAttribute('aria-pressed', 'true');

    await act(() => router.navigate(-1));
    expect(params().get('grade')).toBeNull();
    expect(within(sheet).getByRole('button', { name: /^Grade A/ })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(sheet).getByRole('button', { name: 'Clear filters' }));
    expect(params().get('cat')).toBeNull();
  });

  it('groups the library by topic, each header opening its topic page', async () => {
    renderAt('/evidence', await loadedRepository());
    const group = await screen.findByRole('link', { name: 'Test fuel and water' });
    expect(group).toHaveAttribute('href', '/evidence/topics/test-fuel');
    expect(group.closest('h3')).not.toBeNull();
    // no lead sentence, provenance stats, grouping switch or grade legend on the index
    expect(screen.queryByText(/mechanisms ·|validation report|How Vitals’ model works/)).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Group by' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'How grades work' })).toBeNull();
  });

  it('library rows carry the name, grade and facts only; the prose stays in the article', async () => {
    renderAt('/evidence', await loadedRepository());
    await screen.findByRole('link', { name: 'Glycogen holds water' });
    const row = document.querySelector<HTMLElement>('[data-row-id="90-full"]')!;
    expect(within(row).getByRole('img', { name: /^Evidence grade B/ })).toBeInTheDocument();
    expect(within(row).getByText('Contested')).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/stored with about 3 g of water/);
    expect(document.querySelector('.ev-row__match')).toBeNull();
    // a row with no fact to state is its name and grade alone
    const bare = document.querySelector<HTMLElement>('[data-row-id="90-bare"]')!;
    expect(bare.querySelector('.ev-row__meta')).toBeNull();
    expect(bare).not.toHaveTextContent(/glycogen runs low/);
  });

  it('search quotes the passage that matched only when the title does not show it', async () => {
    renderAt('/evidence?q=glycogen', await loadedRepository());
    await screen.findByRole('link', { name: 'Glycogen holds water' });
    const passage = (id: string) =>
      document.querySelector(`[data-row-id="${id}"] .ev-row__match`)?.textContent ?? null;
    // the title holds the match: nothing to quote
    expect(passage('90-full')).toBeNull();
    // the match is in the summary: its sentence, whole, with the word marked
    expect(passage('90-bare')).toBe('The liver makes ketones when its glycogen runs low.');
    expect(document.querySelector('[data-row-id="90-bare"] mark')).toHaveTextContent('glycogen');
  });

  it('search names where a passage outside the summary came from', async () => {
    renderAt('/evidence?q=biopsies', await loadedRepository());
    await screen.findByRole('link', { name: 'Glycogen holds water' });
    expect(document.querySelector('[data-row-id="90-full"] .ev-row__match')).toHaveTextContent(
      'Key numbers: Water per gram of glycogen: ≈ 3 g/g (range 2.7–4) (Measured with biopsies.)',
    );
  });

  it('a claim row quotes its explanation only when the match is there', async () => {
    renderAt('/evidence?q=deficit', await loadedRepository());
    const claim = await screen.findByRole('link', { name: /The first week of weight loss is all fat/ });
    const row = claim.closest('li')!;
    expect(row.querySelector('.ev-row__match')).toHaveTextContent(
      'Mostly glycogen and the water it holds; fat loss follows the energy deficit.',
    );
    expect(within(row).getByText('not supported')).toBeInTheDocument();
  });

  it('a claim row whose claim holds the match shows its verdict without the explanation', async () => {
    renderAt('/evidence?q=week', await loadedRepository());
    const claim = await screen.findByRole('link', { name: /The first week of weight loss is all fat/ });
    const row = claim.closest('li')!;
    expect(row.querySelector('.ev-row__match')).toBeNull();
    expect(within(row).getByText('not supported')).toBeInTheDocument();
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
    // a pushed page: the header names the mechanism
    expect(screen.getByRole('heading', { level: 1, name: 'Glycogen holds water' })).toBeInTheDocument();
    expect(document.title).toBe('Glycogen holds water · Vitals');
  });

  it('"/" on an article opens the index with the search field focused', async () => {
    renderAt('/evidence/90-full', await loadedRepository());
    await screen.findByRole('article', { name: 'Glycogen holds water' });
    fireEvent.keyDown(document.body, { key: '/' });
    await waitFor(() => expect(where()).toBe('/evidence'));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: /Search mechanisms/ })).toHaveFocus());
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
