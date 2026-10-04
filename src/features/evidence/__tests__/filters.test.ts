import {
  indexSearch,
  parseIndexParams,
  toggleValue,
  writeIndexParams,
  CATEGORY_ORDER,
  type IndexUrlState,
} from '../data/filters';

describe('index URL state', () => {
  it('parses the query string into filters', () => {
    const s = parseIndexParams(
      new URLSearchParams('q=keto&cat=fuel,cardiometabolic&grade=b,A&group=topic'),
    );
    expect(s).toEqual({ q: 'keto', categories: ['fuel', 'cardio'], grades: ['A', 'B'], group: 'topic' });
  });

  it('still opens links that name the topic grouping the old way', () => {
    expect(parseIndexParams(new URLSearchParams('group=dossier')).group).toBe('topic');
  });

  it('accepts repeated params and drops unknown values', () => {
    const s = parseIndexParams(new URLSearchParams('cat=body&cat=nonsense&grade=E&grade=c&group=weird'));
    expect(s).toEqual({ q: '', categories: ['body'], grades: ['C'], group: 'category' });
  });

  it('round-trips state → URL → state', () => {
    const states: IndexUrlState[] = [
      { q: 'protein sparing', categories: ['hormones', 'body'], grades: ['D', 'A'], group: 'topic' },
      { q: '', categories: [], grades: [], group: 'category' },
      { q: 'β-hydroxybutyrate & ketones', categories: ['cardio'], grades: ['B'], group: 'category' },
    ];
    for (const s of states) {
      const back = parseIndexParams(new URLSearchParams(writeIndexParams(s).toString()));
      expect(back).toEqual({
        ...s,
        q: s.q.trim(),
        categories: CATEGORY_ORDER.filter((c) => s.categories.includes(c)),
        grades: [...s.grades].sort(),
      });
    }
  });

  it('writes canonical, minimal URLs and keeps unrelated params', () => {
    const p = writeIndexParams(
      { q: ' keto ', categories: ['fuel', 'body'], grades: ['B', 'A'], group: 'category' },
      new URLSearchParams('theme=dark&cat=energy'),
    );
    expect(p.get('theme')).toBe('dark');
    expect(p.get('q')).toBe('keto');
    expect(p.get('cat')).toBe('body,fuel');
    expect(p.get('grade')).toBe('A,B');
    expect(p.has('group')).toBe(false);
    expect(indexSearch({ q: '', categories: [], grades: [] })).toBe('');
  });

  it('toggles values in canonical order', () => {
    expect(toggleValue(['fuel'], 'body', CATEGORY_ORDER)).toEqual(['body', 'fuel']);
    expect(toggleValue(['body', 'fuel'], 'body', CATEGORY_ORDER)).toEqual(['fuel']);
  });
});
