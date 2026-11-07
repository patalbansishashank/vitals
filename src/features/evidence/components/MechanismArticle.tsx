import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Icon, InfoKey } from '@/components';
import type { EvidenceTopic, Mechanism } from '@/content/evidence/schema';
import { topicDisplayName } from '@/content/evidence/sources';
import { GRADE_D_NOTE, GRADE_MEANING, GRADES_HELP_TITLE, STATUS_TEXT } from '../copy';
import { numberReferences } from '../data/citations';
import { ARTICLE_SECTIONS, mechanismHref, topicHref, type EvidenceNavState } from '../links';
import { EquationBlock, KeyNumbersTable, SourcesSection } from './ArticleParts';
import { UsedByChips } from './bits';
import { ParamCards } from './ParamCard';
import type { PageSection } from './PageNav';
import {
  WARRANT_LABEL,
  hasWarrantContent,
  modelStatusLabel,
  observationText,
} from '@/content/evidence/warrants';

/** Section id of the warrant block (C6: outcome-scoped warrants, population, what the evidence observed). */
export const WARRANT_SECTION = 'warrant';

/** The mechanism carries C6 warrant content (shown only in the library and the Explain sheet, never inline). */
export const hasWarrant = (m: Mechanism): boolean => hasWarrantContent(m);

const NAV_STATE: EvidenceNavState = { from: 'evidence' };

/** The sections an article actually has, in reading order (for "On this page" and j/k). */
export function articleSections(m: Mechanism): PageSection[] {
  const s: PageSection[] = [{ id: 'mechanism', label: 'Overview' }];
  s.push({ id: ARTICLE_SECTIONS.equation, label: 'How Vitals models it' });
  if (m.equation || m.keyNumbers.length)
    s.push({ id: ARTICLE_SECTIONS.parameters, label: 'Technical details' });
  if (m.relatedParamIds?.length) s.push({ id: ARTICLE_SECTIONS.modelParameters, label: 'Model parameters' });
  if (m.timeCourse) s.push({ id: ARTICLE_SECTIONS.timing, label: 'Timing' });
  if (m.moderators) s.push({ id: ARTICLE_SECTIONS.moderators, label: 'What changes it' });
  if (m.relatedMetricIds.length) s.push({ id: ARTICLE_SECTIONS.usedBy, label: 'Used by' });
  if (m.caveats) s.push({ id: ARTICLE_SECTIONS.contested, label: 'Contested and uncertain' });
  if (hasWarrant(m)) s.push({ id: WARRANT_SECTION, label: 'Warrant' });
  s.push({ id: ARTICLE_SECTIONS.citations, label: 'Sources' });
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
  /** Opens "How grades work" (the link at the end of the grade line). */
  onGradesHelp?: () => void;
}

/**
 * One mechanism, read-mode: the title and its grade, the plain-language summary, how Vitals models it (equation and
 * key numbers behind "Technical details"), timing, moderators, what it drives, what is contested, and the sources.
 */
export function MechanismArticle({
  mechanism: m,
  topic,
  index,
  headingRef,
  onGradesHelp,
}: MechanismArticleProps) {
  const titleId = useId();
  const refs = numberReferences(m, topic);
  const numbers = new Map(refs.map((r) => [r.ref.id, r]));
  const prev = index > 0 ? topic.mechanisms[index - 1] : undefined;
  const next = topic.mechanisms[index + 1];
  const status = STATUS_TEXT[m.status];
  const technical = Boolean(m.equation) || m.keyNumbers.length > 0;
  const techId = `${ARTICLE_SECTIONS.parameters}-title`;

  return (
    <article className="ev-article" aria-labelledby={titleId}>
      <header id="mechanism" className="ev-article__head">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ev-title">
          {m.title}
        </h2>
        {/* one grade label (the letter and its word), "How grades work" as an info key beside it, the reason under it */}
        <div className="ev-gradeline">
          <p className="ev-gradeline__top">
            <span className="ev-gradeline__g">Grade {m.grade}</span>
            <span className="ev-gradeline__w">{GRADE_MEANING[m.grade].word}</span>
            {onGradesHelp ? (
              <InfoKey label={GRADES_HELP_TITLE} className="ev-gradeline__help" onClick={onGradesHelp} />
            ) : null}
          </p>
          <p className="ev-gradeline__why">{m.gradeReason}</p>
        </div>
        {m.grade === 'D' ? <p className="ev-statusline">{GRADE_D_NOTE}</p> : null}
        {m.status !== 'established' ? (
          <p className="ev-statusline">
            <span className="ev-statusline__w">{status.label}:</span> {status.text}
          </p>
        ) : null}
      </header>

      {m.summary ? (
        <p className="ev-lead">{m.summary}</p>
      ) : (
        <p className="ev-lead ev-muted">The plain-language summary isn’t written yet.</p>
      )}

      <Sec id={ARTICLE_SECTIONS.equation} title="How Vitals models it">
        <p className="ev-prose">{m.howModelled}</p>
      </Sec>

      {technical ? (
        <details id={ARTICLE_SECTIONS.parameters} className="ev-sec ev-disclose">
          <summary className="ev-disclose__sum">
            <h3 id={techId} className="ev-sec__h" tabIndex={-1}>
              Technical details
            </h3>
          </summary>
          <div className="ev-disclose__body">
            {m.equation ? (
              <>
                <h4 className="ev-sub">Equation</h4>
                <EquationBlock equation={m.equation} />
              </>
            ) : null}
            {m.keyNumbers.length ? (
              <>
                <h4 className="ev-sub">Key numbers</h4>
                <KeyNumbersTable mechanism={m} numbers={numbers} />
              </>
            ) : null}
          </div>
        </details>
      ) : null}

      {m.relatedParamIds?.length ? (
        <Sec id={ARTICLE_SECTIONS.modelParameters} title="Model parameters">
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
          <UsedByChips ids={m.relatedMetricIds} />
        </Sec>
      ) : null}

      {m.caveats ? (
        <Sec id={ARTICLE_SECTIONS.contested} title="Contested and uncertain">
          <p className="ev-prose">{m.caveats}</p>
        </Sec>
      ) : null}

      {hasWarrant(m) ? (
        <Sec id={WARRANT_SECTION} title="Warrant">
          <dl className="ev-xp__numbers">
            {m.modelStatus && m.modelStatus !== 'production' ? (
              <div>
                <dt>In the model</dt>
                <dd>{modelStatusLabel(m)}</dd>
              </div>
            ) : null}
            {(m.warrants ?? []).map((w, i) => (
              <div key={`w${i}`}>
                <dt>{WARRANT_LABEL[w.type] ?? w.type}</dt>
                <dd>{[w.confidence, w.scope].filter(Boolean).join(' · ')}</dd>
              </div>
            ))}
            {m.outcomeScope ? (
              <div>
                <dt>Covers</dt>
                <dd>{m.outcomeScope}</dd>
              </div>
            ) : null}
            {m.population ? (
              <div>
                <dt>Population</dt>
                <dd>{m.population}</dd>
              </div>
            ) : null}
            {(m.observations ?? []).map((o, i) => (
              <div key={`o${i}`}>
                <dt>Observed</dt>
                <dd>{observationText(o)}</dd>
              </div>
            ))}
          </dl>
        </Sec>
      ) : null}

      {refs.length ? (
        <SourcesSection id={ARTICLE_SECTIONS.citations} refs={refs} />
      ) : (
        <Sec id={ARTICLE_SECTIONS.citations} title="Sources">
          <p className="ev-prose ev-muted">No sources are listed for this mechanism yet.</p>
        </Sec>
      )}

      <footer className="ev-article__foot">
        {prev || next ? (
          <nav aria-label={`More in ${topicDisplayName(topic.slug, topic.title)}`} className="ev-pager">
            {prev ? (
              <Link to={mechanismHref(prev.id)} state={NAV_STATE} className="ev-pager__a" data-dir="prev">
                <span className="ev-pager__k">
                  <Icon icon={ChevronLeft} size={14} /> Previous
                </span>
                <span className="ev-pager__t">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={mechanismHref(next.id)} state={NAV_STATE} className="ev-pager__a" data-dir="next">
                <span className="ev-pager__k">
                  Next <Icon icon={ChevronRight} size={14} />
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
          .
        </p>
      </footer>
    </article>
  );
}
