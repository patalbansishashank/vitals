import { useEffect, useId, useRef, type Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  EmptyStage,
  Faceplate,
  Icon,
  Key,
  KeyLink,
  Notice,
  formatNumber,
  useReducedMotion,
} from '@/components';
import { paths } from '@/app/paths';
import type { EvidenceTopic } from '@/content/evidence/schema';
import { numberTopicReferences, resolveTopicHash } from '../data/citations';
import type { MechanismDoc } from '../data/search';
import { useEvidenceRepository, type TopicState } from '../hooks';
import { claimAnchor, topicHref, type EvidenceNavState } from '../links';
import { ArticleLoading } from './ArticleView';
import { SourceRefs, SourcesList } from './ArticleParts';
import { Disclaimer, VerdictChip } from './bits';
import { Sec } from './MechanismArticle';
import {
  AllTopicsNav,
  EvidenceLayout,
  MiniHeader,
  OnThisPage,
  jumpToSection,
  useActiveSection,
  type PageSection,
} from './PageNav';
import { MechanismRow } from './Rows';

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

function topicSections(t: EvidenceTopic): PageSection[] {
  const s: PageSection[] = [{ id: 'overview', label: 'overview' }];
  if (t.mechanisms.length) s.push({ id: 'mechanisms', label: 'mechanisms' });
  if (t.myths.length) s.push({ id: 'claims', label: 'common claims' });
  if (t.openQuestions.length) s.push({ id: 'open-questions', label: 'open questions' });
  s.push({ id: 'citations', label: 'sources' });
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
    <article className="ev-article lm-face" aria-labelledby={titleId}>
      <header id="overview" className="ev-article__head">
        <p className="ev-article__eng lm-eng">
          <span>topic</span>
          <span aria-hidden="true">·</span>
          <span>{formatNumber(topic.mechanisms.length)} mechanisms</span>
          <span aria-hidden="true">·</span>
          <span>{formatNumber(topic.myths.length)} common claims</span>
          <span aria-hidden="true">·</span>
          <span>{formatNumber(refs.length)} sources</span>
        </p>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ev-title">
          {topic.title}
        </h2>
      </header>
      <p className="ev-lead">{topic.scope}</p>

      {docs.length ? (
        <Sec id="mechanisms" title="Mechanisms">
          <ul className="ev-list">
            {docs.map((d) => (
              <MechanismRow key={d.id} doc={d} context="category" />
            ))}
          </ul>
        </Sec>
      ) : null}

      {topic.myths.length ? (
        <Sec id="claims" title="Common claims">
          <p className="ev-prose ev-prose--small">
            Popular statements about this topic, stated fairly, and what the evidence says about them.
          </p>
          <ol className="ev-claims">
            {topic.myths.map((y) => (
              <li key={y.id} id={claimAnchor(y.id)} className="ev-claim" tabIndex={-1}>
                <p className="ev-claim__text">“{y.claim}”</p>
                <VerdictChip verdict={y.verdict} />
                <p className="ev-claim__body">{y.explanation}</p>
                {y.referenceIds.length ? (
                  <p className="ev-claim__refs">
                    <span className="lm-eng">sources</span>{' '}
                    <SourceRefs ids={y.referenceIds} numbers={numbers} label="Sources for this claim" />
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </Sec>
      ) : null}

      {topic.openQuestions.length ? (
        <Sec id="open-questions" title="Open questions">
          <p className="ev-prose ev-prose--small">
            What the research has not settled, and how it affects the model.
          </p>
          <ul className="ev-questions">
            {topic.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Sec>
      ) : null}

      <Sec id="citations" title="Sources">
        <SourcesList refs={refs} />
      </Sec>

      <footer className="ev-article__foot">
        <nav aria-label="Other topics" className="ev-pager">
          {prev ? (
            <Link to={topicHref(prev.slug)} state={NAV_STATE} className="ev-pager__a" data-dir="prev">
              <span className="lm-eng">
                <Icon icon={ChevronLeft} size={14} /> previous topic
              </span>
              <span className="ev-pager__t">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={topicHref(next.slug)} state={NAV_STATE} className="ev-pager__a" data-dir="next">
              <span className="lm-eng">
                next topic <Icon icon={ChevronRight} size={14} />
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
}

/** `/evidence/topics/:slug`: one topic — scope, mechanisms, common claims, open questions, sources. */
export function TopicView({ slug, state, lg, xl }: TopicViewProps) {
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

  if (state.status === 'loading') {
    return (
      <EvidenceLayout side={side}>
        <ArticleLoading label="Loading the topic" />
      </EvidenceLayout>
    );
  }
  if (state.status === 'error') {
    return (
      <EvidenceLayout side={side}>
        <Faceplate as="div" className="ev-state">
          <Notice
            severity="danger"
            layout="ruled"
            title="This topic couldn’t be loaded."
            actions={
              <Key size="sm" onClick={state.retry}>
                Try again
              </Key>
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
  if (!topic) {
    return (
      <EvidenceLayout side={side}>
        <EmptyStage
          title="No topic with this address."
          art={null}
          action={
            <KeyLink variant="solid" to={`${paths.evidence}?group=topic`}>
              Browse the topics
            </KeyLink>
          }
        >
          {`“${slug ?? ''}” isn’t one of the library’s topics.`}
        </EmptyStage>
      </EvidenceLayout>
    );
  }

  const jump = (id: string) => jumpToSection(id, reduced);
  return (
    <>
      <EvidenceLayout
        side={side}
        aside={xl ? <OnThisPage sections={sections} active={active} onJump={jump} hint={false} /> : null}
        asideLabel="On this page"
      >
        <TopicArticle key={topic.slug} topic={topic} headingRef={headingRef} />
        <Disclaimer />
      </EvidenceLayout>
      {!lg ? (
        <MiniHeader
          key={topic.slug}
          title={topic.title}
          sections={sections}
          active={active}
          onJump={jump}
          watch={headingRef}
        />
      ) : null}
    </>
  );
}
