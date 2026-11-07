import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { EmptyStage, Key, KeyLink, Page, ProgressRule, Skeleton, useReducedMotion } from '@/components';
import { TopBar, type BackTarget } from '@/app/shell';
import { paths } from '@/app/paths';
import { useGradesHelp } from '../GradeLegend';
import type { MechanismState } from '../hooks';
import { Disclaimer } from './bits';
import { MechanismArticle, articleSections } from './MechanismArticle';
import {
  EvidenceLayout,
  OnThisPage,
  TopicNav,
  jumpToSection,
  useActiveSection,
  useContents,
  useTitleScrolledAway,
} from './PageNav';

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

export function ArticleLoading({ label }: { label: string }) {
  return (
    <div className="ev-article" aria-busy="true">
      <ProgressRule label={label} reducedText="Loading…" className="ev-progress" />
      <div className="ev-article__skeleton" aria-hidden="true">
        <Skeleton width="80%" height={24} />
        <Skeleton width="45%" height={14} />
        <Skeleton lines={4} height={14} />
      </div>
    </div>
  );
}

export interface ArticleViewProps {
  state: MechanismState;
  lg: boolean;
  xl: boolean;
  /** The header's Back: where the reader came from (the library, a topic, or Explain's chart). */
  back: BackTarget;
}

/**
 * `/evidence/:mechanismId`, a pushed page: the header (Back, the mechanism's name, the ⋯ with "On this page" and
 * "How grades work"), then the article. Focus lands on the title (or the requested section); j/k walk the sections.
 */
export function ArticleView({ state, lg, xl, back }: ArticleViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const reduced = useReducedMotion();
  const ready = state.status === 'ready';
  const m = state.mechanism;
  const sections = m ? articleSections(m) : [];
  const ids = sections.map((s) => s.id);
  const idsKey = ids.join('|');
  const active = useActiveSection(ids, ready);
  const jump = (id: string) => jumpToSection(id, reduced);
  const contents = useContents(sections, active, jump);
  const grades = useGradesHelp();

  // Arrival: go to the requested section (Explain opens at "equation"), else focus the title.
  useEffect(() => {
    if (!ready) return;
    let r2 = 0;
    const r1 = window.requestAnimationFrame(() => {
      r2 = window.requestAnimationFrame(() => {
        const hash = decodeURIComponent(location.hash.slice(1));
        if (hash && document.getElementById(hash)) jumpToSection(hash, true);
        else headingRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(r1);
      window.cancelAnimationFrame(r2);
    };
  }, [ready, state.id, location.hash]);

  // j / k: next / previous section (desktop). A press during a smooth scroll counts from where it is heading.
  const lastJump = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!ready || !lg) return;
    const list = idsKey.split('|');
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (document.querySelector('dialog[open]')) return;
      const recent = lastJump.current && e.timeStamp - lastJump.current.at < 900 ? lastJump.current.id : null;
      const from = recent ?? active;
      const at = from ? list.indexOf(from) : 0;
      const next = Math.max(0, Math.min(list.length - 1, at + (e.key === 'j' ? 1 : -1)));
      const id = list[next];
      if (!id) return;
      e.preventDefault();
      lastJump.current = { id, at: e.timeStamp };
      jumpToSection(id, reduced);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ready, lg, idsKey, active, reduced]);

  const found = ready && m && state.topic ? { m, topic: state.topic } : null;
  const away = useTitleScrolledAway(headingRef, found?.m.id);
  const header = (
    <TopBar
      title={
        found ? (
          <span className="ev-hdrtitle" data-shown={away || undefined}>
            {found.m.title}
          </span>
        ) : (
          'Evidence'
        )
      }
      documentTitle={found ? found.m.title : state.status === 'not-found' ? 'Mechanism not found' : 'Evidence'}
      back={back}
      menu={found ? (xl ? [grades.menuItem] : [contents.menuItem, grades.menuItem]) : undefined}
    />
  );

  let body;
  if (state.status === 'loading') {
    body = (
      <EvidenceLayout side={lg ? <span /> : null}>
        <ArticleLoading label="Loading the mechanism" />
      </EvidenceLayout>
    );
  } else if (state.status === 'error') {
    body = (
      <EvidenceLayout side={lg ? <span /> : null}>
        <EmptyStage
          title="This part of the library couldn’t be loaded."
          action={
            <>
              <Key onClick={state.retry}>Try again</Key>
              <KeyLink variant="text" to={paths.evidence}>
                Go to Evidence
              </KeyLink>
            </>
          }
        >
          Vitals may have been updated, or the connection dropped. Your data is safe.
        </EmptyStage>
      </EvidenceLayout>
    );
  } else if (!found) {
    body = (
      <EvidenceLayout side={lg ? <span /> : null}>
        <EmptyStage
          title="No mechanism with this address."
          action={
            <KeyLink variant="solid" to={paths.evidence}>
              Search the library
            </KeyLink>
          }
        />
      </EvidenceLayout>
    );
  } else {
    body = (
      <EvidenceLayout
        side={lg ? <TopicNav topic={found.topic} currentId={found.m.id} /> : null}
        aside={xl ? <OnThisPage sections={sections} active={active} onJump={jump} /> : null}
        asideLabel="On this page"
      >
        <MechanismArticle
          key={found.m.id}
          mechanism={found.m}
          topic={found.topic}
          index={state.index ?? 0}
          headingRef={headingRef}
          onGradesHelp={grades.show}
        />
        <Disclaimer />
      </EvidenceLayout>
    );
  }

  return (
    <>
      {header}
      <Page className="ev-page">{body}</Page>
      {found && !xl ? contents.panel : null}
      {grades.panel}
    </>
  );
}
