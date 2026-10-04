import { EMPTY_FILTERS } from '../data/filters';
import { highlight, makeSnippet, normalize, parseQuery, SearchIndex, tokenize } from '../data/search';
import { outcomeMetrics } from '../metricLabels';
import { topicFuel, topicHeart } from './fixtures';

function index(withMetrics = true): SearchIndex {
  const ix = new SearchIndex();
  ix.addTopic(topicFuel, 0);
  ix.addTopic(topicHeart, 1);
  if (withMetrics) ix.addMetrics(outcomeMetrics());
  return ix;
}

const ids = (hits: Array<{ doc: { id: string } }>) => hits.map((h) => h.doc.id);

describe('text normalisation', () => {
  it('lowercases, strips accents and keeps subscript digits', () => {
    expect(normalize('VO₂max Café')).toBe('vo2max cafe');
    expect(tokenize('VO₂max and the ketones')).toEqual(['vo2max', 'ketone']);
  });

  it('keeps stop words only when the query has nothing else', () => {
    expect(parseQuery('the ketones').terms.map((t) => t.token)).toEqual(['ketone']);
    expect(parseQuery('if').terms.map((t) => t.token)).toEqual(['if']);
  });
});

describe('SearchIndex', () => {
  it('lists every mechanism in library order without a query', () => {
    const r = index().search('', EMPTY_FILTERS);
    expect(ids(r.mechanisms)).toEqual(['90-full', '90-bare', '90-psmf', '91-ldl', '90-misplaced']);
    expect(r.myths).toEqual([]);
    expect(r.metrics).toEqual([]);
    expect(r.totalMechanisms).toBe(5);
  });

  it('requires every query word (AND) and matches word prefixes', () => {
    const ix = index();
    expect(ids(ix.search('glycogen scale', EMPTY_FILTERS).mechanisms)).toEqual(['90-full']);
    expect(ids(ix.search('glyco', EMPTY_FILTERS).mechanisms)).toContain('90-full');
    expect(ix.search('glycogen zebra', EMPTY_FILTERS).mechanisms).toEqual([]);
  });

  it('ranks a title match above a body match', () => {
    const r = index().search('ketone', EMPTY_FILTERS);
    expect(ids(r.mechanisms)[0]).toBe('90-bare');
  });

  it('expands acronyms (PSMF, keto)', () => {
    expect(ids(index().search('PSMF', EMPTY_FILTERS).mechanisms)).toEqual(['90-psmf']);
    expect(ids(index().search('keto', EMPTY_FILTERS).mechanisms)).toContain('90-bare');
  });

  it('searches the labels of the metrics a mechanism drives', () => {
    // "scale weight" is not in 90-full's prose, only in its relatedMetricIds (scaleWeight)
    expect(ids(index().search('scale weight', EMPTY_FILTERS).mechanisms)).toContain('90-full');
  });

  it('finds metrics from the engine catalogue and common claims', () => {
    const r = index().search('hunger', EMPTY_FILTERS);
    expect(ids(r.metrics)).toContain('hunger');
    const claims = index().search('first week', EMPTY_FILTERS);
    expect(ids(claims.myths)).toEqual(['90-myth-first-week']);
  });

  it('combines filter groups with AND and values within a group with OR', () => {
    const ix = index();
    expect(ids(ix.search('', { categories: ['fuel'], grades: [] }).mechanisms)).toEqual([
      '90-full',
      '90-bare',
    ]);
    expect(ids(ix.search('', { categories: ['fuel', 'cardio'], grades: [] }).mechanisms)).toEqual([
      '90-full',
      '90-bare',
      '91-ldl',
    ]);
    expect(ids(ix.search('', { categories: [], grades: ['A', 'D'] }).mechanisms)).toEqual([
      '90-bare',
      '90-psmf',
      '91-ldl',
    ]);
    expect(ids(ix.search('', { categories: ['fuel'], grades: ['A'] }).mechanisms)).toEqual([]);
    expect(ids(ix.search('glycogen', { categories: ['fuel'], grades: ['B'] }).mechanisms)).toEqual([
      '90-full',
    ]);
  });

  it('counts facets ignoring their own group', () => {
    const r = index().search('', { categories: ['fuel'], grades: ['B'] });
    // category counts respect the grade filter only
    expect(r.facets.category).toMatchObject({ fuel: 1, body: 0, cardio: 0 });
    // grade counts respect the category filter only
    expect(r.facets.grade).toMatchObject({ A: 0, B: 1, C: 0, D: 1 });
  });

  it('drops claims (no grade, no category) when a filter is on, but filters metrics by their own category', () => {
    const ix = index();
    expect(ix.search('first week', { categories: ['fuel'], grades: [] }).myths).toEqual([]);
    const fuel = ix.search('glycogen', { categories: ['fuel'], grades: [] }).metrics;
    expect(fuel.length).toBeGreaterThan(0);
    expect(fuel.every((h) => h.doc.metric.category === 'fuel')).toBe(true);
  });

  it('is progressive: results grow as topics are added, and adding a topic twice is a no-op', () => {
    const ix = new SearchIndex();
    ix.addTopic(topicFuel, 0);
    expect(ix.search('ldl', EMPTY_FILTERS).mechanisms).toEqual([]);
    ix.addTopic(topicHeart, 1);
    ix.addTopic(topicHeart, 1);
    expect(ids(ix.search('ldl', EMPTY_FILTERS).mechanisms)).toEqual(['91-ldl']);
    expect(ix.mechanisms).toBe(5);
  });
});

describe('highlight and snippets', () => {
  it('marks whole words that start with a query word', () => {
    const segs = highlight('Ketones rise; ketosis follows.', ['keto']);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['Ketones', 'ketosis']);
    expect(segs.map((s) => s.text).join('')).toBe('Ketones rise; ketosis follows.');
  });

  it('quotes the passage that matched when the title did not', () => {
    const ix = index();
    const hit = ix.search('biopsies', EMPTY_FILTERS).mechanisms[0]!;
    const snip = makeSnippet(hit.doc, parseQuery('biopsies').tokens);
    expect(snip?.field).toBe('key numbers');
    expect(snip?.segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['biopsies']);
    expect(snip?.segments.map((s) => s.text).join('')).toMatch(/^…per gram of glycogen/);
  });
});
