import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import {
  EmptyStage,
  Faceplate,
  Key,
  KeyLink,
  Notice,
  ProgressRule,
  Skeleton,
  useReducedMotion,
} from '@/components';
import { paths } from '@/app/paths';
import type { MechanismState } from '../hooks';
import { Disclaimer } from './bits';
import { MechanismArticle, articleSections } from './MechanismArticle';
import { EvidenceLayout, MiniHeader, OnThisPage, TopicNav, jumpToSection, useActiveSection } from './PageNav';

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

export function ArticleLoading({ label }: { label: string }) {
  return (
    <div className="ev-article lm-face" aria-busy="true">
      <ProgressRule label={label} reducedText="Loading…" className="ev-progress" />
      <div className="ev-article__skeleton" aria-hidden="true">
        <Skeleton width={180} height={10} />
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
  returnTo?: { to: string; label: string };
}

/** `/evidence/:mechanismId`: states around the article, focus on arrival, j/k, "on this page". */
export function ArticleView({ state, lg, xl, returnTo }: ArticleViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const reduced = useReducedMotion();
  const ready = state.status === 'ready';
  const m = state.mechanism;
  const sections = m ? articleSections(m) : [];
  const ids = sections.map((s) => s.id);
  const idsKey = ids.join('|');
  const active = useActiveSection(ids, ready);

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

  if (state.status === 'loading') {
    return (
      <EvidenceLayout side={lg ? <span /> : null}>
        <ArticleLoading label="Loading the mechanism" />
      </EvidenceLayout>
    );
  }

  if (state.status === 'not-found' || !m || !state.topic) {
    if (state.status === 'error') {
      return (
        <EvidenceLayout side={lg ? <span /> : null}>
          <Faceplate as="div" className="ev-state">
            <Notice
              severity="danger"
              layout="ruled"
              title="This part of the library couldn’t be loaded."
              actions={
                <>
                  <Key size="sm" onClick={state.retry}>
                    Try again
                  </Key>
                  <KeyLink size="sm" variant="quiet" to={paths.evidence}>
                    Go to Evidence
                  </KeyLink>
                </>
              }
            >
              <p>
                Vitals may have been updated while this tab was open, or the connection dropped. Your data is
                safe.
              </p>
            </Notice>
          </Faceplate>
        </EvidenceLayout>
      );
    }
    return (
      <EvidenceLayout side={lg ? <span /> : null}>
        <EmptyStage
          title="No mechanism with this address."
          art={null}
          action={
            <KeyLink variant="solid" to={paths.evidence}>
              Search the library
            </KeyLink>
          }
        >
          {`“${state.id ?? ''}” isn’t in the library. It may have been renamed.`}
        </EmptyStage>
      </EvidenceLayout>
    );
  }

  const jump = (id: string) => jumpToSection(id, reduced);

  return (
    <>
      <EvidenceLayout
        side={lg ? <TopicNav topic={state.topic} currentId={m.id} /> : null}
        aside={xl ? <OnThisPage sections={sections} active={active} onJump={jump} /> : null}
        asideLabel="On this page"
      >
        <MechanismArticle
          key={m.id}
          mechanism={m}
          topic={state.topic}
          index={state.index ?? 0}
          headingRef={headingRef}
          returnTo={returnTo}
        />
        <Disclaimer />
      </EvidenceLayout>
      {!lg ? (
        <MiniHeader
          key={m.id}
          title={m.title}
          grade={m.grade}
          sections={sections}
          active={active}
          onJump={jump}
          watch={headingRef}
        />
      ) : null}
    </>
  );
}
