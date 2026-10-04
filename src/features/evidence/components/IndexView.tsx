import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router';
import { Key, Notice, formatNumber } from '@/components';
import type { EvidenceCategory, EvidenceGrade } from '@/content/evidence/schema';
import { paths } from '@/app/paths';
import { INDEX_LEAD } from '../copy';
import { filtersKey, type GroupBy, type IndexUrlState } from '../data/filters';
import type { EvidenceRepository } from '../data/repository';
import { ExplainDrawer } from '../ExplainDrawer';
import { GradeLegend } from '../GradeLegend';
import { useEvidenceRepository, useEvidenceSearch } from '../hooks';
import { Disclaimer } from './bits';
import { Filters } from './Filters';
import { EvidenceLayout } from './PageNav';
import { PAGE_SIZE, Results } from './Results';
import { takeLastOpenedRow } from './Rows';
import { SearchField } from './SearchField';
import { hasValidationReport } from '../validationReport';

/** Rows shown per history entry, so "back" restores the list length (and scroll). */
const shownByEntry = new Map<string, number>();

function libraryStats(repo: EvidenceRepository): string {
  const topics = repo.loadedTopics();
  let mechanisms = 0;
  let claims = 0;
  const sources = new Set<string>();
  for (const t of topics) {
    mechanisms += t.mechanisms.length;
    claims += t.myths.length;
    for (const r of t.references)
      sources.add(r.doi?.toLowerCase() || r.pmid || `${r.authors}|${r.year}|${r.title}`.toLowerCase());
  }
  return `${formatNumber(mechanisms)} mechanisms · ${formatNumber(claims)} common claims · ${formatNumber(sources.size)} sources · ${topics.length} topics`;
}

export interface IndexViewProps {
  state: IndexUrlState;
  lg: boolean;
  xl: boolean;
  onQuery: (q: string) => void;
  onToggleCategory: (c: EvidenceCategory) => void;
  onToggleGrade: (g: EvidenceGrade) => void;
  onClearFilters: () => void;
  onGroup: (g: GroupBy) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onArrowDown: () => void;
}

/** `/evidence`: intro, search (mobile), filters, results or the grouped library, grade legend. */
export function IndexView({
  state,
  lg,
  xl,
  onQuery,
  onToggleCategory,
  onToggleGrade,
  onClearFilters,
  onGroup,
  searchRef,
  onArrowDown,
}: IndexViewProps) {
  const repo = useEvidenceRepository();
  const search = useEvidenceSearch(state.q, state);
  const location = useLocation();
  const navType = useNavigationType();
  const rootRef = useRef<HTMLDivElement>(null);
  const [explain, setExplain] = useState<{ id: string; open: boolean } | null>(null);

  // Pagination: resets when the query, filters or grouping change; survives back/forward.
  const resetKey = `${state.q.trim()}|${filtersKey(state)}|${state.group}`;
  const entryKey = location.key;
  const [page, setPage] = useState(() => ({
    key: resetKey,
    n: shownByEntry.get(entryKey) ?? PAGE_SIZE,
    focusAt: -1,
  }));
  const shown = page.key === resetKey ? page.n : PAGE_SIZE;
  const focusAt = page.key === resetKey ? page.focusAt : -1;
  const showMore = () => {
    const n = shown + PAGE_SIZE;
    shownByEntry.set(entryKey, n);
    setPage({ key: resetKey, n, focusAt: shown });
  };

  // After "Show more", move focus to the first newly shown row.
  useEffect(() => {
    if (focusAt < 0) return;
    const links = rootRef.current?.querySelectorAll<HTMLElement>('[data-results="mechanisms"] .ev-row__link');
    links?.[focusAt]?.focus();
  }, [focusAt, shown]);

  // Back from an article: focus returns (once) to the row that was opened.
  useEffect(() => {
    if (navType !== 'POP') return;
    let r2 = 0;
    const r1 = window.requestAnimationFrame(() => {
      r2 = window.requestAnimationFrame(() => {
        const id = takeLastOpenedRow();
        if (!id) return;
        const el = rootRef.current?.querySelector<HTMLElement>(
          `[data-row-id="${CSS.escape(id)}"] .ev-row__link`,
        );
        el?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(r1);
      window.cancelAnimationFrame(r2);
    };
  }, [navType]);

  // /evidence#grades — the page renders after the browser's own anchor jump, so do it here.
  useEffect(() => {
    if (location.hash !== '#grades') return;
    const r = window.requestAnimationFrame(() => {
      const el = document.getElementById('grades');
      el?.scrollIntoView?.({ block: 'start' });
      el?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(r);
  }, [location.hash]);

  const filters = (layout: 'panel' | 'bar') => (
    <Filters
      layout={layout}
      filters={state}
      facets={search.facets}
      counting={!search.complete}
      onToggleCategory={onToggleCategory}
      onToggleGrade={onToggleGrade}
      onClear={onClearFilters}
    />
  );

  return (
    <>
      <EvidenceLayout
        side={
          lg ? (
            <section aria-labelledby="ev-filters-title">
              <h2 id="ev-filters-title" className="lm-sr">
                Filter the library
              </h2>
              {filters('panel')}
            </section>
          ) : null
        }
        aside={xl ? <GradeLegend showStatus={false} /> : null}
        asideLabel="How grades work"
      >
        <div ref={rootRef} className="ev-index" data-results-root="">
          <div className="ev-intro">
            <p className="ev-intro__lead">{INDEX_LEAD}</p>
            <p className="ev-intro__stats lm-eng">
              {search.complete ? libraryStats(repo) : `${search.total} topics`}
              {hasValidationReport ? (
                <>
                  {' · '}
                  <Link className="lm-link" to={paths.validationReport}>
                    validation report
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          {!lg ? (
            <section className="ev-mobilefilters" aria-labelledby="ev-filters-title-m">
              <h2 id="ev-filters-title-m" className="lm-sr">
                Search and filter the library
              </h2>
              <SearchField
                where="page"
                value={state.q}
                onCommit={onQuery}
                inputRef={searchRef}
                onArrowDown={onArrowDown}
              />
              {filters('bar')}
            </section>
          ) : null}
          {search.failed.length ? (
            <Notice
              severity="caution"
              title={`${search.failed.length === search.total ? 'The library' : `${search.failed.length} of ${search.total} topics`} couldn’t be loaded.`}
              actions={
                <Key size="sm" onClick={() => void repo.retryFailed()}>
                  Try again
                </Key>
              }
            >
              <p>
                {search.failed.length === search.total
                  ? 'Check your connection, then try again.'
                  : 'Results leave them out for now. Check your connection, then try again.'}
              </p>
            </Notice>
          ) : null}
          <Results
            search={search}
            state={state}
            shown={shown}
            onShowMore={showMore}
            onQuery={onQuery}
            onClearFilters={onClearFilters}
            onGroup={onGroup}
            onExplainMetric={(id) => setExplain({ id, open: true })}
          />
          {!xl ? <GradeLegend /> : null}
          <Disclaimer />
        </div>
      </EvidenceLayout>
      <ExplainDrawer
        open={Boolean(explain?.open)}
        onClose={() => setExplain((e) => (e ? { ...e, open: false } : e))}
        metricId={explain?.id}
      />
    </>
  );
}
