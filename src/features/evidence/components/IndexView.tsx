import { useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router';
import { paths } from '@/app/paths';
import { EmptyStage, IconKey, InlineWarning, Key, Page } from '@/components';
import { TopBar } from '@/app/shell';
import type { EvidenceCategory, EvidenceGrade } from '@/content/evidence/schema';
import { filtersKey, type IndexUrlState } from '../data/filters';
import { ExplainDrawer } from '../ExplainDrawer';
import { useGradesHelp } from '../GradeLegend';
import { useEvidenceRepository, useEvidenceSearch } from '../hooks';
import type { EvidenceNavState } from '../links';
import { FilterGroups, FilterSheet, type FiltersProps } from './Filters';
import { EvidenceLayout } from './PageNav';
import { PAGE_SIZE, Results } from './Results';
import { takeLastOpenedRow } from './Rows';
import { SearchField } from './SearchField';

/** Rows shown per history entry, so "back" restores the list length (and scroll). */
const shownByEntry = new Map<string, number>();

export interface IndexViewProps {
  state: IndexUrlState;
  lg: boolean;
  documentTitle: string;
  onQuery: (q: string) => void;
  onToggleCategory: (c: EvidenceCategory) => void;
  onToggleGrade: (g: EvidenceGrade) => void;
  onClearFilters: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onArrowDown: () => void;
}

/**
 * `/evidence`: the header (title, search with the phone Filter key under it, "How grades work" in the ⋯), then the
 * library grouped by topic, or the search results. Desktop keeps the filters in the left column.
 */
export function IndexView({
  state,
  lg,
  documentTitle,
  onQuery,
  onToggleCategory,
  onToggleGrade,
  onClearFilters,
  searchRef,
  onArrowDown,
}: IndexViewProps) {
  const repo = useEvidenceRepository();
  const navigate = useNavigate();
  const search = useEvidenceSearch(state.q, state);
  const location = useLocation();
  const navType = useNavigationType();
  const rootRef = useRef<HTMLDivElement>(null);
  const [explain, setExplain] = useState<{ id: string; open: boolean } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const grades = useGradesHelp();
  const showGrades = grades.show;

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

  // "/" pressed on an article or topic page brings the reader here with the search field focused.
  const focusSearch = Boolean((location.state as EvidenceNavState | null)?.focusSearch);
  useEffect(() => {
    if (!focusSearch) return;
    const r = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(r);
  }, [focusSearch, location.key, searchRef]);

  // /evidence#grades (older links to the grade legend) opens "How grades work".
  useEffect(() => {
    if (location.hash !== '#grades') return;
    const r = window.requestAnimationFrame(showGrades);
    return () => window.cancelAnimationFrame(r);
  }, [location.hash, showGrades]);

  const filterProps: FiltersProps = {
    filters: state,
    facets: search.facets,
    counting: !search.complete,
    onToggleCategory,
    onToggleGrade,
    onClear: onClearFilters,
  };
  const activeFilters = state.categories.length + state.grades.length;
  const allFailed = search.failed.length > 0 && search.failed.length === search.total;

  return (
    <>
      <TopBar
        title="Evidence"
        documentTitle={documentTitle}
        menu={[
          grades.menuItem,
          {
            id: 'validation',
            label: 'Validation report',
            onSelect: () => navigate(`${paths.evidence}/validation`),
          },
        ]}
        tabs={
          <div className="ev-searchrow">
            <SearchField
              where={lg ? 'bar' : 'page'}
              value={state.q}
              onCommit={onQuery}
              inputRef={searchRef}
              onArrowDown={onArrowDown}
            />
            {!lg ? (
              <IconKey
                icon={SlidersHorizontal}
                label={activeFilters ? `Filter, ${activeFilters} on` : 'Filter'}
                className="ev-filterkey"
                data-active={activeFilters ? 'true' : undefined}
                data-count={activeFilters || undefined}
                aria-haspopup="dialog"
                onClick={() => setFilterOpen(true)}
              />
            ) : null}
          </div>
        }
      />
      <Page className="ev-page">
        <EvidenceLayout
          side={
            lg ? (
              <section aria-labelledby="ev-filters-title">
                <h2 id="ev-filters-title" className="lm-sr">
                  Filter the library
                </h2>
                <FilterGroups {...filterProps} onGradesHelp={showGrades} />
              </section>
            ) : null
          }
        >
          <div ref={rootRef} className="ev-index" data-results-root="">
            {allFailed ? (
              <EmptyStage
                title="The library couldn’t be loaded."
                action={<Key onClick={() => void repo.retryFailed()}>Try again</Key>}
              >
                Check your connection.
              </EmptyStage>
            ) : search.failed.length ? (
              <InlineWarning
                severity="caution"
                action={
                  <Key variant="text" size="sm" onClick={() => void repo.retryFailed()}>
                    Try again
                  </Key>
                }
              >
                {search.failed.length} of {search.total} topics couldn’t be loaded.
              </InlineWarning>
            ) : null}
            <Results
              search={search}
              state={state}
              shown={shown}
              onShowMore={showMore}
              onQuery={onQuery}
              onClearFilters={onClearFilters}
              onExplainMetric={(id) => setExplain({ id, open: true })}
              clearInline={!lg}
            />
          </div>
        </EvidenceLayout>
      </Page>
      {!lg ? <FilterSheet {...filterProps} open={filterOpen} onClose={() => setFilterOpen(false)} /> : null}
      {grades.panel}
      <ExplainDrawer
        open={Boolean(explain?.open)}
        onClose={() => setExplain((e) => (e ? { ...e, open: false } : e))}
        metricId={explain?.id}
      />
    </>
  );
}
