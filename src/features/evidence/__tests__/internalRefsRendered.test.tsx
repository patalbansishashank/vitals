/**
 * What the Evidence library actually puts on screen, checked for research-note vocabulary (see
 * `src/content/evidence/__tests__/noInternalRefs.test.ts` for the source-level guard). Uses the real topics
 * (a few, to keep it quick) and also looks at aria-labels, titles and link text.
 */
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { EVIDENCE_TOPICS, type EvidenceTopicEntry } from '@/content/evidence';
import type { EvidenceTopic } from '@/content/evidence/schema';
import { SERIES } from '@/engine/types/metrics';
import { EvidenceRepository } from '../data/repository';
import EvidencePage from '../EvidencePage';
import { ExplainDrawer } from '../ExplainDrawer';
import { EvidenceRepositoryContext } from '../hooks';
import { SourceRefLinks } from '../components/SourceRefLinks';

const SLUGS = ['safety-limits', 'fat-oxidation-ketosis', 'extended-water-fasting'];

/** Everything a reader (or a screen reader) can get from the page: text plus label-like attributes. */
function readable(root: HTMLElement = document.body): string[] {
  const out = [root.textContent ?? ''];
  for (const el of root.querySelectorAll('[aria-label],[title],[alt],[placeholder]')) {
    for (const a of ['aria-label', 'title', 'alt', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
  }
  return out;
}

const hits = (root?: HTMLElement) =>
  readable(root)
    .map(leak)
    .filter((l): l is string => l !== null);

async function realRepository(): Promise<EvidenceRepository> {
  const repo = new EvidenceRepository(EVIDENCE_TOPICS.filter((e) => SLUGS.includes(e.slug)));
  await repo.loadAll();
  return repo;
}

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
  return render(
    <EvidenceRepositoryContext.Provider value={repo}>
      <RouterProvider router={router} />
    </EvidenceRepositoryContext.Provider>,
  );
}

describe('Evidence library pages', () => {
  it('index (by category and by topic) names no research notes', async () => {
    const repo = await realRepository();
    const a = renderAt('/evidence', repo);
    await screen.findByRole('heading', { name: 'Mechanisms' });
    expect(hits()).toEqual([]);
    expect(screen.getByText('by topic')).toBeInTheDocument();
    a.unmount();
    renderAt('/evidence?group=topic', repo);
    await screen.findByRole('heading', { name: 'Mechanisms' });
    expect(hits()).toEqual([]);
    expect(screen.getAllByText(/\d+ topics/).length).toBeGreaterThan(0);
  }, 30_000);

  it('a topic page names no research notes and its sources can be reached by number', async () => {
    const repo = await realRepository();
    renderAt('/evidence/topics/safety-limits#ref-6', repo);
    await screen.findByRole('article', { name: /Safety limits/ });
    expect(hits()).toEqual([]);
    expect(screen.getByRole('navigation', { name: 'Other topics' })).toBeInTheDocument();
  }, 30_000);

  it('an article names no research notes', async () => {
    const repo = await realRepository();
    const topic = repo.getTopic('fat-oxidation-ketosis');
    const mech = topic?.mechanisms[0];
    expect(mech).toBeDefined();
    renderAt(`/evidence/${mech!.id}`, repo);
    await screen.findByRole('article', { name: mech!.title });
    expect(hits()).toEqual([]);
    expect(screen.getByText(/^Part of the topic/)).toBeInTheDocument();
  }, 30_000);

  it('an unknown topic address says so in plain words', async () => {
    renderAt('/evidence/topics/not-a-topic', await realRepository());
    expect(await screen.findByRole('heading', { name: 'No topic with this address.' })).toBeInTheDocument();
    expect(hits()).toEqual([]);
  });
});

describe('Explain drawer for a metric with no linked mechanism', () => {
  it('points at the topics that define it, by name', async () => {
    const metric = SERIES.find((d) => d.kind === 'metric' && d.sources[0]?.topic === 'energy-expenditure');
    expect(metric).toBeDefined();
    const empty: EvidenceTopic = {
      dossier: '02',
      slug: 'energy-expenditure',
      title: 'Energy expenditure and metabolic adaptation',
      scope: 'Scope.',
      mechanisms: [],
      myths: [],
      openQuestions: [],
      references: [],
    };
    const entry: EvidenceTopicEntry = {
      dossier: '02',
      slug: empty.slug,
      title: empty.title,
      load: async () => ({ default: empty }),
    };
    const repo = new EvidenceRepository([entry]);
    await repo.loadAll();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <MemoryRouter>
          <EvidenceRepositoryContext.Provider value={repo}>
            <button type="button" onClick={() => setOpen(true)}>
              Explain
            </button>
            <ExplainDrawer open={open} onClose={() => setOpen(false)} metricId={metric!.id} />
          </EvidenceRepositoryContext.Provider>
        </MemoryRouter>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Explain' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The topics that define it:/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Energy expenditure' })).toHaveAttribute(
      'href',
      '/evidence/topics/energy-expenditure',
    );
    expect(hits(dialog)).toEqual([]);
  });
});

describe('SourceRefLinks', () => {
  it('renders "Topic › references 6, 7" with each part linked into the library', () => {
    render(
      <MemoryRouter>
        <p data-testid="cite">
          <SourceRefLinks
            refs={[{ topic: 'safety-limits', refs: [6, 7] }, { topic: 'energy-expenditure' }]}
          />
        </p>
      </MemoryRouter>,
    );
    const cite = screen.getByTestId('cite');
    expect(cite.textContent).toBe('Safety limits › references 6, 7 · Energy expenditure');
    const links = within(cite).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/evidence/topics/safety-limits',
      '/evidence/topics/safety-limits#ref-6',
      '/evidence/topics/safety-limits#ref-7',
      '/evidence/topics/energy-expenditure',
    ]);
  });

  it('says "reference" for a single number', () => {
    render(
      <MemoryRouter>
        <p data-testid="cite">
          <SourceRefLinks refs={[{ topic: 'safety-limits', refs: [38] }]} />
        </p>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('cite').textContent).toBe('Safety limits › reference 38');
  });
});
