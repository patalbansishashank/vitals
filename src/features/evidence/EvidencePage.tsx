import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { MQ, useMediaQuery } from '@/components';
import type { BackTarget } from '@/app/shell';
import { paths } from '@/app/paths';
import { ArticleView } from './components/ArticleView';
import { IndexView } from './components/IndexView';
import { focusFirstResult } from './components/Results';
import { TopicView } from './components/TopicView';
import {
  CATEGORY_ORDER,
  GRADE_ORDER,
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
 * Evidence library (design/screens/evidence-library.md): `/evidence` (index, a tab page with the search under its
 * title), `/evidence/:mechanismId` (article) and `/evidence/topics/:topicSlug` (topic), both pushed pages with Back.
 * Each view renders its own header. "/" focuses the search, or opens the index with it focused.
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
    setParams(writeIndexParams({ ...state, ...next }, params), { replace });
  };
  const onQuery = (q: string) => setIndex({ q }, true);

  // "/" focuses the search field; on an article or topic page it opens the index with the field focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      const input = searchRef.current;
      if (view !== 'index' || !input) {
        navigate(paths.evidence, { state: { focusSearch: true } satisfies EvidenceNavState });
        return;
      }
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, navigate]);

  const toResults = () => focusFirstResult(document.querySelector<HTMLElement>('[data-results-root]'));

  const back: BackTarget = nav?.returnTo
    ? { to: nav.returnTo.to, label: nav.returnTo.label }
    : nav?.from === 'evidence'
      ? { label: 'Evidence' }
      : { to: paths.evidence, label: 'Evidence' };

  if (view === 'article') return <ArticleView state={mech} lg={lg} xl={xl} back={back} />;
  if (view === 'topic') return <TopicView slug={topicSlug} state={topic} lg={lg} xl={xl} back={back} />;
  return (
    <IndexView
      state={state}
      lg={lg}
      documentTitle={state.q ? `“${state.q}” in Evidence` : 'Evidence'}
      onQuery={onQuery}
      onToggleCategory={(c) => setIndex({ categories: toggleValue(state.categories, c, CATEGORY_ORDER) }, false)}
      onToggleGrade={(g) => setIndex({ grades: toggleValue(state.grades, g, GRADE_ORDER) }, false)}
      onClearFilters={() => setIndex({ categories: [], grades: [] }, false)}
      searchRef={searchRef}
      onArrowDown={toResults}
    />
  );
}
