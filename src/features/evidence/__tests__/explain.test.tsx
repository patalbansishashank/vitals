import { useState } from 'react';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import type { EvidenceRepository } from '../data/repository';
import { EvidenceRepository as Repo } from '../data/repository';
import { ExplainDrawer, type ExplainDrawerProps } from '../ExplainDrawer';
import { EvidenceRepositoryContext, useMechanism } from '../hooks';
import { fixtureRegistry, loadedRepository } from './fixtures';

function Harness({
  repo,
  ...props
}: Omit<ExplainDrawerProps, 'open' | 'onClose'> & { repo: EvidenceRepository }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <EvidenceRepositoryContext.Provider value={repo}>
        <button type="button" onClick={() => setOpen(true)}>
          Explain this curve
        </button>
        <ExplainDrawer {...props} open={open} onClose={() => setOpen(false)} />
      </EvidenceRepositoryContext.Provider>
    </MemoryRouter>
  );
}

describe('ExplainDrawer', () => {
  it('opens with the compact explanation of a mechanism and closes again', async () => {
    const user = userEvent.setup();
    const repo = new Repo(fixtureRegistry().entries);
    render(
      <Harness
        repo={repo}
        mechanismIds={['90-full']}
        returnTo={{ to: '/simulate/s1/results?m=glycogenTotal', label: 'Spring cut results' }}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'Explain this curve' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Glycogen holds water' });
    // loads the topic on demand, then shows summary, how modelled, grade + reason, top 3 numbers, caveats
    expect(await within(dialog).findByText(/Each gram of glycogen is stored/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Water bound to glycogen is counted/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Grade B — Several human studies/)).toBeInTheDocument();
    expect(within(dialog).getByText('Water per gram of glycogen')).toBeInTheDocument();
    expect(within(dialog).getByText('Overshoot after depletion')).toBeInTheDocument();
    expect(within(dialog).queryByText('Fourth number')).toBeNull();
    expect(within(dialog).getByText('1 more in the full entry')).toBeInTheDocument();
    expect(within(dialog).getByText('The exact ratio varies between studies.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Information, not medical advice/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /^Open in Evidence/ })).toHaveAttribute(
      'href',
      '/evidence/90-full#equation',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness repo={await loadedRepository()} mechanismIds={['90-bare']} />);
    await user.click(screen.getByRole('button', { name: 'Explain this curve' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('explains a metric through the mechanisms that list it, or says none is linked yet', async () => {
    const user = userEvent.setup();
    const repo = await loadedRepository();
    const { unmount } = render(<Harness repo={repo} metricId="scaleWeight" />);
    await user.click(screen.getByRole('button', { name: 'Explain this curve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Scale weight' });
    expect(within(dialog).getByText('1 mechanism behind this')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Glycogen holds water').length).toBeGreaterThan(0);
    unmount();

    render(<Harness repo={repo} metricId="hunger" />);
    await user.click(screen.getByRole('button', { name: 'Explain this curve' }));
    const d2 = await screen.findByRole('dialog', { name: 'Hunger pressure' });
    expect(
      within(d2).getByText('No mechanism is linked to this channel in the library yet.'),
    ).toBeInTheDocument();
  });

  it('lists several mechanisms and names the ones the library does not have', async () => {
    const user = userEvent.setup();
    render(<Harness repo={await loadedRepository()} mechanismIds={['90-full', '91-ldl', '99-unknown']} />);
    await user.click(screen.getByRole('button', { name: 'Explain this curve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Explain' });
    await within(dialog).findByText(/not in the library yet \(99-unknown\)/);
    expect(within(dialog).getByText('2 mechanisms behind this')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('link', { name: /^Open in Evidence/ })).toHaveLength(2);
  });
});

describe('useMechanism', () => {
  const wrap =
    (repo: EvidenceRepository) =>
    ({ children }: { children: ReactNode }) => (
      <EvidenceRepositoryContext.Provider value={repo}>{children}</EvidenceRepositoryContext.Provider>
    );

  it('goes loading → ready for a known id and loading → not-found for an unknown one', async () => {
    const repo = new Repo(fixtureRegistry().entries);
    const { result } = renderHook(() => useMechanism('91-ldl'), { wrapper: wrap(repo) });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.mechanism?.title).toBe('Saturated fat raises LDL cholesterol');
    expect(result.current.topic?.dossier).toBe('91');

    const missing = renderHook(() => useMechanism('77-nope'), { wrapper: wrap(repo) });
    await waitFor(() => expect(missing.result.current.status).toBe('not-found'));
  });

  it('reports an error when the owning topic cannot load', async () => {
    const repo = new Repo(fixtureRegistry({ fail: ['test-heart'] }).entries);
    const { result } = renderHook(() => useMechanism('91-ldl'), { wrapper: wrap(repo) });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
