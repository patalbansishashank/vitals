import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { MQ, Page, useMediaQuery } from '@/components';
import { TopBar } from '@/app/shell';
import type { BackTarget } from '@/app/shell';
import { paths } from '@/app/paths';
import { ArticleView } from './components/ArticleView';
import { IndexView } from './components/IndexView';
import { focusFirstResult } from './components/Results';
import { SearchField } from './components/SearchField';
import { TopicView } from './components/TopicView';
import {
  CATEGORY_ORDER,
  GRADE_ORDER,
  indexSearch,
  parseIndexParams,
  toggleValue,
  writeIndexParams,
  type IndexUrlState,
} from './data/filters';
import { useMechanism, useTopic } from './hooks';
import type { EvidenceNavState } from './links';
import './evidence.css';

type View = 'index' | 'article' | 'topic';

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

/**
 * Evidence library (design/screens/evidence-library.md): `/evidence` (index),
 * `/evidence/:mechanismId` (article) and `/evidence/topics/:topicSlug` (dossier).
 * One page serves all three so the desktop search field in the context bar keeps
 * focus while the reader moves between them.
 */
export default function EvidencePage() {
  const { mechanismId, topicSlug } = useParams();
  const view: View = topicSlug ? 'topic' : mechanismId ? 'article' : 'index';
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lg = useMediaQuery(MQ.lg);
  const xl = useMediaQuery(MQ.xl);
  const searchRef = useRef<HTMLInputElement>(null);
  const state = parseIndexParams(params);
  const mech = useMechanism(view === 'article' ? mechanismId : undefined);
  const topic = useTopic(view === 'topic' ? topicSlug : undefined);
  const nav = (location.state ?? null) as EvidenceNavState | null;

  /** Query-string state: typing replaces the history entry; filter changes push one, so back undoes them. */
  const setIndex = (next: Partial<IndexUrlState>, replace: boolean) => {
    const merged = { ...state, ...next };
    if (view === 'index') setParams(writeIndexParams(merged, params), { replace });
    else navigate({ pathname: paths.evidence, search: indexSearch({ q: merged.q }) });
  };
  const onQuery = (q: string) => setIndex({ q }, true);

  // "/" focuses the search field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const input = searchRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toResults = () => focusFirstResult(document.querySelector<HTMLElement>('[data-results-root]'));

  const back: BackTarget | undefined =
    view === 'index'
      ? undefined
      : nav?.returnTo
        ? { to: nav.returnTo.to, label: nav.returnTo.label }
        : nav?.from === 'evidence'
          ? { label: 'Evidence' }
          : { to: paths.evidence, label: 'Evidence' };

  const documentTitle =
    view === 'article'
      ? mech.status === 'ready' && mech.mechanism
        ? mech.mechanism.title
        : mech.status === 'not-found'
          ? 'Mechanism not found'
          : 'Evidence'
      : view === 'topic'
        ? topic.status === 'ready' && topic.topic
          ? topic.topic.title
          : 'Evidence'
        : state.q
          ? `“${state.q}” in Evidence`
          : 'Evidence';

  return (
    <>
      <TopBar
        title="Evidence"
        documentTitle={documentTitle}
        back={back}
        compactOnMobile={view !== 'index'}
        actions={
          lg ? (
            <SearchField
              where="bar"
              value={view === 'index' ? state.q : ''}
              onCommit={onQuery}
              inputRef={searchRef}
              onArrowDown={view === 'index' ? toResults : undefined}
            />
          ) : undefined
        }
      />
      <Page className="ev-page">
        {view === 'index' ? (
          <IndexView
            state={state}
            lg={lg}
            xl={xl}
            onQuery={onQuery}
            onToggleCategory={(c) =>
              setIndex({ categories: toggleValue(state.categories, c, CATEGORY_ORDER) }, false)
            }
            onToggleGrade={(g) => setIndex({ grades: toggleValue(state.grades, g, GRADE_ORDER) }, false)}
            onClearFilters={() => setIndex({ categories: [], grades: [] }, false)}
            onGroup={(group) => setIndex({ group }, true)}
            searchRef={searchRef}
            onArrowDown={toResults}
          />
        ) : view === 'article' ? (
          <ArticleView state={mech} lg={lg} xl={xl} returnTo={nav?.returnTo} />
        ) : (
          <TopicView slug={topicSlug} state={topic} lg={lg} xl={xl} />
        )}
      </Page>
    </>
  );
}
