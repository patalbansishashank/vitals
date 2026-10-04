import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GradeBadge, Icon, Notice } from '@/components';
import type { EvidenceTopic, Mechanism } from '@/content/evidence/schema';
import { topicDisplayName } from '@/content/evidence/sources';
import { GRADE_D_BANNER, STATUS_TEXT } from '../copy';
import { numberReferences } from '../data/citations';
import { ARTICLE_SECTIONS, mechanismHref, topicHref, type EvidenceNavState } from '../links';
import { EquationBlock, KeyNumbersTable, SourcesList } from './ArticleParts';
import { CategoryMark, GoalLinks, UsedByChips } from './bits';
import { ParamCards } from './ParamCard';
import type { PageSection } from './PageNav';

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

/** The sections an article actually has, in reading order (for "on this page" and j/k). */
export function articleSections(m: Mechanism): PageSection[] {
  const s: PageSection[] = [{ id: 'mechanism', label: 'mechanism' }];
  s.push({ id: ARTICLE_SECTIONS.equation, label: m.equation ? 'equation' : 'how it is modelled' });
  if (m.keyNumbers.length) s.push({ id: ARTICLE_SECTIONS.parameters, label: 'key numbers' });
  if (m.relatedParamIds?.length) s.push({ id: ARTICLE_SECTIONS.modelParameters, label: 'parameters' });
  if (m.timeCourse) s.push({ id: ARTICLE_SECTIONS.timing, label: 'timing' });
  if (m.moderators) s.push({ id: ARTICLE_SECTIONS.moderators, label: 'what changes it' });
  if (m.relatedMetricIds.length) s.push({ id: ARTICLE_SECTIONS.usedBy, label: 'used by' });
  if (m.caveats) s.push({ id: ARTICLE_SECTIONS.contested, label: 'contested' });
  s.push({ id: ARTICLE_SECTIONS.citations, label: 'sources' });
  return s;
}

/** An article section: h3 heading (focusable for j/k and anchors) + content. */
export function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const hId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={hId} className="ev-sec">
      <h3 id={hId} className="ev-sec__h" tabIndex={-1}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface MechanismArticleProps {
  mechanism: Mechanism;
  topic: EvidenceTopic;
  /** Position within the topic (previous / next). */
  index: number;
  headingRef?: Ref<HTMLHeadingElement>;
  /** From Explain: "‹ Back to Spring cut results". */
  returnTo?: { to: string; label: string };
}

/**
 * One mechanism, read-mode: plain language before notation, then the numbers,
 * timing, moderators, what it drives, what is contested, and the sources.
 */
export function MechanismArticle({
  mechanism: m,
  topic,
  index,
  headingRef,
  returnTo,
}: MechanismArticleProps) {
  const titleId = useId();
  const refs = numberReferences(m, topic);
  const numbers = new Map(refs.map((r) => [r.ref.id, r]));
  const prev = index > 0 ? topic.mechanisms[index - 1] : undefined;
  const next = topic.mechanisms[index + 1];
  const status = STATUS_TEXT[m.status];

  return (
    <article className="ev-article lm-face" aria-labelledby={titleId}>
      {returnTo ? (
        <Link to={returnTo.to} className="ev-backlink">
          <Icon icon={ChevronLeft} size={16} />
          Back to {returnTo.label}
        </Link>
      ) : null}
      <header id="mechanism" className="ev-article__head">
        <p className="ev-article__eng lm-eng">
          <CategoryMark category={m.category} />
          <span aria-hidden="true">·</span>
          <Link to={topicHref(topic.slug)} state={NAV_STATE} className="ev-englink">
            {topicDisplayName(topic.slug, topic.title)}
          </Link>
          <span aria-hidden="true">·</span>
          <span>{status.label}</span>
        </p>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ev-title">
          {m.title}
        </h2>
        <p className="ev-gradeline">
          <GradeBadge grade={m.grade} />
          <span className="ev-gradeline__g">Grade {m.grade}</span> — {m.gradeReason}{' '}
          <Link to={{ pathname: '/evidence', hash: 'grades' }} className="ev-link ev-small">
            How grades work
          </Link>
        </p>
        {m.status !== 'established' ? (
          <p className="ev-statusline">
            <b>{status.label === 'contested' ? 'Contested' : status.label}:</b> {status.text}
          </p>
        ) : null}
      </header>

      {m.summary ? (
        <p className="ev-lead">{m.summary}</p>
      ) : (
        <Notice severity="info" layout="ruled" title="Evidence write-up in progress.">
          <p>
            The plain-language summary for this mechanism is not written yet. What the research does give is
            shown below.
          </p>
        </Notice>
      )}

      {m.grade === 'D' ? (
        <Notice severity="info" layout="ruled" title={GRADE_D_BANNER.title} className="ev-dnote">
          <p>{GRADE_D_BANNER.body}</p>
        </Notice>
      ) : null}

      <Sec id={ARTICLE_SECTIONS.equation} title="How Vitals models it">
        <div className="ev-well">
          <p className="lm-eng ev-well__label">in plain language</p>
          <p className="ev-prose">{m.howModelled}</p>
          {m.equation ? <EquationBlock equation={m.equation} /> : null}
        </div>
      </Sec>

      {m.keyNumbers.length ? (
        <Sec id={ARTICLE_SECTIONS.parameters} title="Key numbers">
          <KeyNumbersTable mechanism={m} numbers={numbers} />
        </Sec>
      ) : null}

      {m.relatedParamIds?.length ? (
        <Sec id={ARTICLE_SECTIONS.modelParameters} title="Model parameters">
          <p className="ev-prose ev-prose--small">
            The numbers the model uses for this mechanism, with the two evidence labels: whether the mechanism is known,
            and how certain the measured value is. Lower certainty widens the range the model samples, never its centre.
          </p>
          <ParamCards mechanism={m} />
        </Sec>
      ) : null}

      {m.timeCourse ? (
        <Sec id={ARTICLE_SECTIONS.timing} title="Timing">
          <p className="ev-prose">{m.timeCourse}</p>
        </Sec>
      ) : null}

      {m.moderators ? (
        <Sec id={ARTICLE_SECTIONS.moderators} title="What changes it">
          <p className="ev-prose">{m.moderators}</p>
        </Sec>
      ) : null}

      {m.relatedMetricIds.length ? (
        <Sec id={ARTICLE_SECTIONS.usedBy} title="Used by">
          <p className="ev-prose ev-prose--small">
            The Simulator channels this mechanism drives. Open one to see it in your results.
          </p>
          <UsedByChips ids={m.relatedMetricIds} label={false} />
          <GoalLinks ids={m.relatedMetricIds} />
        </Sec>
      ) : null}

      {m.caveats ? (
        <Sec id={ARTICLE_SECTIONS.contested} title="Contested and uncertain">
          <div className="ev-box">
            <p className="ev-prose">{m.caveats}</p>
          </div>
        </Sec>
      ) : null}

      <Sec id={ARTICLE_SECTIONS.citations} title="Sources">
        {refs.length ? (
          <SourcesList refs={refs} />
        ) : (
          <p className="ev-prose ev-prose--small">No sources are listed for this mechanism yet.</p>
        )}
      </Sec>

      <footer className="ev-article__foot">
        {prev || next ? (
          <nav aria-label={`More in ${topicDisplayName(topic.slug, topic.title)}`} className="ev-pager">
            {prev ? (
              <Link to={mechanismHref(prev.id)} state={NAV_STATE} className="ev-pager__a" data-dir="prev">
                <span className="lm-eng">
                  <Icon icon={ChevronLeft} size={14} /> previous
                </span>
                <span className="ev-pager__t">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={mechanismHref(next.id)} state={NAV_STATE} className="ev-pager__a" data-dir="next">
                <span className="lm-eng">
                  next <Icon icon={ChevronRight} size={14} />
                </span>
                <span className="ev-pager__t">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
        <p className="ev-article__topic">
          Part of the topic{' '}
          <Link to={topicHref(topic.slug)} state={NAV_STATE} className="ev-link">
            {topic.title}
          </Link>
          : {topic.mechanisms.length} mechanisms, {topic.myths.length} common claims and{' '}
          {topic.openQuestions.length} open questions.
        </p>
      </footer>
    </article>
  );
}
