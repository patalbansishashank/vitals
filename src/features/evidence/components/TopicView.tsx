import { useEffect, useId, useRef, type Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyStage, Icon, Key, KeyLink, Page, useReducedMotion } from '@/components';
import { TopBar, type BackTarget } from '@/app/shell';
import { paths } from '@/app/paths';
import type { EvidenceTopic } from '@/content/evidence/schema';
import { numberTopicReferences, resolveTopicHash } from '../data/citations';
import type { MechanismDoc } from '../data/search';
import { useGradesHelp } from '../GradeLegend';
import { useEvidenceRepository, type TopicState } from '../hooks';
import { claimAnchor, topicHref, type EvidenceNavState } from '../links';
import { ArticleLoading } from './ArticleView';
import { SourceRefs, SourcesSection } from './ArticleParts';
import { Disclaimer, VerdictChip } from './bits';
import { Sec } from './MechanismArticle';
import {
  AllTopicsNav,
  EvidenceLayout,
  OnThisPage,
  jumpToSection,
  useActiveSection,
  useContents,
  useTitleScrolledAway,
  type PageSection,
} from './PageNav';
import { MechanismRow } from './Rows';
import { countGrades, GradeShare } from './GradeShare';

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

function topicSections(t: EvidenceTopic): PageSection[] {
  const s: PageSection[] = [{ id: 'overview', label: 'Overview' }];
  if (t.mechanisms.length) s.push({ id: 'mechanisms', label: 'Mechanisms' });
  if (t.myths.length) s.push({ id: 'claims', label: 'Common claims' });
  if (t.openQuestions.length) s.push({ id: 'open-questions', label: 'Open questions' });
  s.push({ id: 'citations', label: 'Sources' });
  return s;
}

function TopicArticle({ topic, headingRef }: { topic: EvidenceTopic; headingRef: Ref<HTMLHeadingElement> }) {
  const repo = useEvidenceRepository();
  const titleId = useId();
  const refs = numberTopicReferences(topic);
  const numbers = new Map(refs.map((r) => [r.ref.id, r]));
  const meta = { dossier: topic.dossier, slug: topic.slug, title: topic.title };
  const docs: MechanismDoc[] = topic.mechanisms.map((m, i) => ({
    kind: 'mechanism',
    id: m.id,
    mechanism: m,
    topic: meta,
    order: i,
  }));
  const at = repo.entries.findIndex((e) => e.slug === topic.slug);
  const prev = at > 0 ? repo.entries[at - 1] : undefined;
  const next = at >= 0 ? repo.entries[at + 1] : undefined;

  return (
    <article className="ev-article" aria-labelledby={titleId}>
      <header id="overview" className="ev-article__head">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ev-title">
          {topic.title}
        </h2>
      </header>
      <p className="ev-lead">{topic.scope}</p>

      {docs.length ? (
        <Sec id="mechanisms" title="Mechanisms">
          <GradeShare counts={countGrades(topic.mechanisms)} />
          <ul className="ev-list lm-material">
            {docs.map((d) => (
              <MechanismRow key={d.id} doc={d} />
            ))}
          </ul>
        </Sec>
      ) : null}

      {topic.myths.length ? (
        <Sec id="claims" title="Common claims">
          <ol className="ev-claims">
            {topic.myths.map((y) => (
              <li key={y.id} id={claimAnchor(y.id)} className="ev-claim" tabIndex={-1}>
                <p className="ev-claim__text">“{y.claim}”</p>
                <VerdictChip verdict={y.verdict} />
                <p className="ev-claim__body">
                  {y.explanation}
                  {y.referenceIds.length ? (
                    <>
                      {' '}
                      <SourceRefs ids={y.referenceIds} numbers={numbers} label="Sources for this claim" />
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        </Sec>
      ) : null}

      {topic.openQuestions.length ? (
        <Sec id="open-questions" title="Open questions">
          <ul className="ev-questions">
            {topic.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Sec>
      ) : null}

      <SourcesSection id="citations" refs={refs} />

      <footer className="ev-article__foot">
        <nav aria-label="Other topics" className="ev-pager">
          {prev ? (
            <Link to={topicHref(prev.slug)} state={NAV_STATE} className="ev-pager__a" data-dir="prev">
              <span className="ev-pager__k">
                <Icon icon={ChevronLeft} size={14} /> Previous topic
              </span>
              <span className="ev-pager__t">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={topicHref(next.slug)} state={NAV_STATE} className="ev-pager__a" data-dir="next">
              <span className="ev-pager__k">
                Next topic <Icon icon={ChevronRight} size={14} />
              </span>
              <span className="ev-pager__t">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      </footer>
    </article>
  );
}

export interface TopicViewProps {
  slug: string | undefined;
  state: TopicState;
  lg: boolean;
  xl: boolean;
  /** The header's Back: where the reader came from. */
  back: BackTarget;
}

/** `/evidence/topics/:slug`, a pushed page: scope, mechanisms, common claims, open questions, sources. */
export function TopicView({ slug, state, lg, xl, back }: TopicViewProps) {
  const repo = useEvidenceRepository();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const reduced = useReducedMotion();
  const topic = state.topic;
  const ready = state.status === 'ready' && Boolean(topic);
  const sections = topic ? topicSections(topic) : [];
  const active = useActiveSection(
    sections.map((s) => s.id),
    ready,
  );
  const jump = (id: string) => jumpToSection(id, reduced);
  const contents = useContents(sections, active, jump);
  const grades = useGradesHelp();

  useEffect(() => {
    if (!ready) return;
    let r2 = 0;
    const r1 = window.requestAnimationFrame(() => {
      r2 = window.requestAnimationFrame(() => {
        const raw = decodeURIComponent(location.hash.slice(1));
        // "#ref-6" (engine data citing the sixth source) → that source's entry
        const hash = topic ? resolveTopicHash(raw, topic) : raw;
        if (hash && document.getElementById(hash)) jumpToSection(hash, true);
        else headingRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(r1);
      window.cancelAnimationFrame(r2);
    };
  }, [ready, slug, topic, location.hash]);

  const side = lg ? <AllTopicsNav entries={repo.entries} currentSlug={slug} /> : null;
  const shown = ready && topic ? topic : null;
  const away = useTitleScrolledAway(headingRef, shown?.slug);
  const header = (
    <TopBar
      title={
        shown ? (
          <span className="ev-hdrtitle" data-shown={away || undefined}>
            {shown.title}
          </span>
        ) : (
          'Evidence'
        )
      }
      documentTitle={shown ? shown.title : 'Evidence'}
      back={back}
      menu={shown ? (xl ? [grades.menuItem] : [contents.menuItem, grades.menuItem]) : undefined}
    />
  );

  let body;
  if (state.status === 'loading') {
    body = (
      <EvidenceLayout side={side}>
        <ArticleLoading label="Loading the topic" />
      </EvidenceLayout>
    );
  } else if (state.status === 'error') {
    body = (
      <EvidenceLayout side={side}>
        <EmptyStage
          title="This topic couldn’t be loaded."
          action={<Key onClick={state.retry}>Try again</Key>}
        >
          Vitals may have been updated, or the connection dropped. Your data is safe.
        </EmptyStage>
      </EvidenceLayout>
    );
  } else if (!shown) {
    body = (
      <EvidenceLayout side={side}>
        <EmptyStage
          title="No topic with this address."
          action={
            <KeyLink variant="solid" to={paths.evidence}>
              Browse the topics
            </KeyLink>
          }
        />
      </EvidenceLayout>
    );
  } else {
    body = (
      <EvidenceLayout
        side={side}
        aside={xl ? <OnThisPage sections={sections} active={active} onJump={jump} /> : null}
        asideLabel="On this page"
      >
        <TopicArticle key={shown.slug} topic={shown} headingRef={headingRef} />
        <Disclaimer />
      </EvidenceLayout>
    );
  }

  return (
    <>
      {header}
      <Page className="ev-page">{body}</Page>
      {shown && !xl ? contents.panel : null}
      {grades.panel}
    </>
  );
}
