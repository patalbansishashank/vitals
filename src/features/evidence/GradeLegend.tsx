import { useId } from 'react';
import { GradeBadge } from '@/components';
import { cx } from '@/components';
import { GRADE_MEANING, NOTE_WORD_TEXT, STATUS_TEXT } from './copy';
import { GRADE_ORDER } from './data/filters';
import './evidence.css';

export interface GradeLegendProps {
  /** Anchor id (the library links to `/evidence#grades`). */
  id?: string;
  /** Heading level of the legend title. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  /** Also explain the mechanism status words (established · proposed fit · contested). */
  showStatus?: boolean;
  /** Drop the faceplate (inside a drawer or another faceplate). */
  bare?: boolean;
  className?: string;
}

/**
 * What the A–D evidence grades mean (evidence-library.md §6). Grades are achromatic
 * on purpose: they never read as good/bad or compete with data colour.
 */
export function GradeLegend({
  id = 'grades',
  headingLevel = 'h2',
  showStatus = true,
  bare = false,
  className,
}: GradeLegendProps) {
  const H = headingLevel;
  const titleId = useId();
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cx('ev-legend', !bare && 'lm-face', className)}
      tabIndex={-1}
    >
      <H id={titleId} className="lm-h3">
        How grades work
      </H>
      <p className="ev-legend__intro">
        Every mechanism carries a grade for how strong the human evidence behind it is.
      </p>
      <dl className="ev-legend__list">
        {GRADE_ORDER.map((g) => (
          <div key={g} className="ev-legend__item">
            <dt>
              <GradeBadge grade={g} tooltip={false} />
              <b>{GRADE_MEANING[g].word}</b>
            </dt>
            <dd>{GRADE_MEANING[g].text}</dd>
          </div>
        ))}
      </dl>
      {showStatus ? (
        <>
          <p className="ev-legend__sub lm-eng">status</p>
          <dl className="ev-legend__list" data-kind="status">
            {(Object.keys(STATUS_TEXT) as Array<keyof typeof STATUS_TEXT>).map((s) => (
              <div key={s} className="ev-legend__item">
                <dt className="lm-eng">{STATUS_TEXT[s].label}</dt>
                <dd>{STATUS_TEXT[s].text}</dd>
              </div>
            ))}
          </dl>
          <p className="ev-legend__sub lm-eng">in notes</p>
          <dl className="ev-legend__list" data-kind="note-words">
            {(Object.keys(NOTE_WORD_TEXT) as Array<keyof typeof NOTE_WORD_TEXT>).map((w) => (
              <div key={w} className="ev-legend__item">
                <dt className="lm-eng">{NOTE_WORD_TEXT[w].label}</dt>
                <dd>{NOTE_WORD_TEXT[w].text}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </section>
  );
}
