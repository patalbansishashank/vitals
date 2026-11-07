import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { MechanismArticle } from '../components/MechanismArticle';
import { topicFuel } from './fixtures';

function renderArticle(index: number) {
  const m = topicFuel.mechanisms[index]!;
  return render(
    <MemoryRouter>
      <MechanismArticle mechanism={m} topic={topicFuel} index={index} />
    </MemoryRouter>,
  );
}

describe('MechanismArticle with every optional field', () => {
  it('renders every section in reading order under the title', () => {
    renderArticle(0);
    const article = screen.getByRole('article', { name: 'Glycogen holds water' });
    const headings = within(article)
      .getAllByRole('heading')
      .map((h) => `${h.tagName}:${h.textContent}`);
    // the equation and the key numbers sit behind one closed "Technical details"
    expect(headings).toEqual([
      'H2:Glycogen holds water',
      'H3:How Vitals models it',
      'H3:Technical details',
      'H4:Equation',
      'H4:Key numbers',
      'H3:Timing',
      'H3:What changes it',
      'H3:Used by',
      'H3:Contested and uncertain',
      'H3:Sources',
    ]);
    expect(screen.getByText(/Each gram of glycogen is stored/)).toBeInTheDocument();
    expect(screen.getByText('Grade B')).toBeInTheDocument();
    expect(screen.getByText(/Several human studies measured water loss/)).toBeInTheDocument();
    // contested status is explained, not just named
    expect(screen.getByText(/Studies disagree/)).toBeInTheDocument();
    // equation: expression and its note are kept apart
    expect(screen.getByText('W_gly = k · G')).toBeInTheDocument();
    expect(screen.getByText('(k = 3.0 g/g, range 2.7–4.0)')).toBeInTheDocument();
    const technical = screen.getByRole('heading', { name: 'Technical details' }).closest('details')!;
    expect(technical).not.toHaveAttribute('open');
    expect(technical).toContainElement(screen.getByRole('figure', { name: 'Equation' }));
    // no eyebrows or notes around the equation
    expect(screen.queryByText(/as published in the research|in plain language/)).toBeNull();
  });

  it('renders key numbers as a table with a caption, header cells and source links', () => {
    renderArticle(0);
    const table = screen.getByRole('table', { name: /Key numbers for “Glycogen holds water”/ });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Quantity', 'Value', 'Sources']);
    const row = within(table).getByRole('rowheader', { name: 'Water per gram of glycogen' }).closest('tr')!;
    expect(within(row).getByText(/Measured with biopsies/)).toBeInTheDocument();
    const src = within(row).getByRole('link', { name: 'Source 1: Olsson KE 1970' });
    expect(src).toHaveAttribute('href', '#src-olsson1970');
    // the table never scrolls sideways (rows stack on phones): no scroll region and no "scroll →" hint
    expect(table.closest('[role="region"]')).toBeNull();
    expect(screen.queryByText(/scroll/)).toBeNull();
  });

  it('opens the closed Sources list when a source number is followed', async () => {
    const user = userEvent.setup();
    renderArticle(0);
    const sources = screen.getByRole('heading', { name: 'Sources' }).closest('details')!;
    expect(sources).not.toHaveAttribute('open');
    await user.click(screen.getAllByRole('link', { name: 'Source 1: Olsson KE 1970' })[0]!);
    expect(sources).toHaveAttribute('open');
  });

  it('numbers sources in citation order and links out safely', () => {
    const { container } = renderArticle(0);
    const list = container.querySelector('ol.ev-sources')!;
    const items = within(list as HTMLElement).getAllByRole('listitem');
    // mechanism refs first (olsson, abs), then the extra one a key number cites (smith)
    expect(items.map((li) => li.id)).toEqual(['src-olsson1970', 'src-abs2010', 'src-smith2001']);

    const external = within(list as HTMLElement).getAllByRole('link');
    expect(external.length).toBeGreaterThanOrEqual(4);
    for (const a of external) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      expect(a.getAttribute('href')).toMatch(/^https:\/\//);
    }
    expect(within(items[0]!).getByRole('link', { name: /PubMed 5475323/ })).toHaveAttribute(
      'href',
      'https://pubmed.ncbi.nlm.nih.gov/5475323/',
    );
    expect(within(items[0]!).getByRole('link', { name: /DOI 10.1111/ })).toHaveAttribute(
      'href',
      'https://doi.org/10.1111/j.1748-1716.1970.tb04764.x',
    );
    expect(within(items[2]!).getByRole('link', { name: /Full text \(PMC\)/ })).toHaveAttribute(
      'href',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC1000/',
    );
  });

  it('counts the sources in the Sources toggle, with no verification labels, and tags study types in words', () => {
    const { container } = renderArticle(0);
    const summary = container.querySelector('#citations > summary')!;
    expect(summary.textContent).toBe('Sources3');
    expect(screen.queryByText(/unverified|abstract level/)).toBeNull();
    const [, abs, smith] = Array.from(container.querySelectorAll<HTMLElement>('li.ev-source'));
    // study-type tags only when the title says so, as plain text after the citation
    expect(within(abs!).getByText(/meta-analysis · randomised trial/)).toBeInTheDocument();
    expect(within(smith!).getByText(/animal/)).toBeInTheDocument();
  });

  it('renders "used by" rows from the metric adapter, with a goal key for goal-able metrics', () => {
    renderArticle(0);
    const used = screen.getByRole('list', { name: 'Metrics this mechanism drives' });
    const chips = within(used)
      .getAllByRole('link')
      .filter((a) => a.classList.contains('ev-usedrow__link'));
    expect(chips.map((c) => c.textContent)).toEqual(['Glycogen (total)', 'Scale weight']);
    expect(chips[0]).toHaveAttribute('href', '/simulate?view=focus&m=glycogenTotal');
    expect(screen.getByRole('link', { name: 'Use as a goal: Scale weight' })).toHaveAttribute(
      'href',
      '/plan/goals?add=scaleWeight',
    );
  });

  it('links to the previous / next mechanism of the topic and the topic page', () => {
    renderArticle(0);
    const pager = screen.getByRole('navigation', { name: 'More in Test fuel and water' });
    expect(
      within(pager).getByRole('link', { name: /Next.*Ketone production rises in a fast/ }),
    ).toHaveAttribute('href', '/evidence/90-bare');
    // the footer names the topic
    const topicLinks = screen.getAllByRole('link', { name: 'Test fuel and water' });
    expect(topicLinks.length).toBeGreaterThanOrEqual(1);
    for (const l of topicLinks) expect(l).toHaveAttribute('href', '/evidence/topics/test-fuel');
  });
});

describe('MechanismArticle with no optional field', () => {
  it('omits the sections it has nothing for and says so honestly', () => {
    renderArticle(1);
    const article = screen.getByRole('article', { name: 'Ketone production rises in a fast' });
    expect(
      within(article)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Ketone production rises in a fast', 'How Vitals models it', 'Sources']);
    expect(screen.queryByRole('heading', { name: 'Technical details' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Metrics this mechanism drives' })).toBeNull();
    expect(screen.getByText('No sources are listed for this mechanism yet.')).toBeInTheDocument();
    // grade D gets the exploratory state line (in the header, not a notice between sections)
    expect(screen.getByText('Exploratory. Mostly animal or cell evidence.').closest('header')).not.toBeNull();
    // established needs no status explanation
    expect(screen.queryByText(/Consistent across the published studies/)).toBeNull();
  });

  it('never renders a non-http link from content', () => {
    const { container } = render(
      <MemoryRouter>
        <MechanismArticle
          mechanism={{ ...topicFuel.mechanisms[1]!, referenceIds: ['evil2020'] }}
          topic={topicFuel}
          index={1}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByText(/Not a real link/)).toBeInTheDocument();
  });
});
