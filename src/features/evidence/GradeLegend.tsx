import { useCallback, useId, useMemo, useState, type ReactElement } from 'react';
import { GradeBadge, ResponsivePanel, cx, type MenuItem } from '@/components';
import { GRADE_MEANING, GRADES_HELP_TITLE } from './copy';
import { GRADE_ORDER } from './data/filters';
import './evidence.css';

/** The four grades, each with its word and what it rests on. */
export function GradeList({ className }: { className?: string }) {
  return (
    <dl className={cx('ev-legend__list', className)}>
      {GRADE_ORDER.map((g) => (
        <div key={g} className="ev-legend__item">
          <dt>
            <GradeBadge grade={g} tooltip={false} />
            <span>{GRADE_MEANING[g].word}</span>
          </dt>
          <dd>{GRADE_MEANING[g].text}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface GradeLegendProps {
  /** Anchor id. */
  id?: string;
  /** Heading level of the legend title. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  /** Drop the card (inside a drawer or another card). */
  bare?: boolean;
  className?: string;
}

/**
 * What the A–D evidence grades mean (evidence-library.md §6). Grades are achromatic on purpose: they never read as
 * good/bad or compete with data colour.
 */
export function GradeLegend({ id = 'grades', headingLevel = 'h2', bare = false, className }: GradeLegendProps) {
  const H = headingLevel;
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} className={cx('ev-legend', !bare && 'lm-face', className)} tabIndex={-1}>
      <H id={titleId} className="lm-h3">
        {GRADES_HELP_TITLE}
      </H>
      <GradeList />
    </section>
  );
}

/**
 * "How grades work" as a sheet (phones) or side panel (desktop): `menuItem` for the header ⋯, `show` for a text key
 * next to a grade, and the `panel` to render once.
 */
export function useGradesHelp(): { show: () => void; menuItem: MenuItem; panel: ReactElement } {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const menuItem = useMemo<MenuItem>(() => ({ id: 'ev-grades', label: GRADES_HELP_TITLE, onSelect: show }), [show]);
  const panel = (
    <ResponsivePanel scrim open={open} onClose={() => setOpen(false)} title={GRADES_HELP_TITLE} detents={['half', 'full']}>
      <div className="ev-panelbody">
        <GradeList />
      </div>
    </ResponsivePanel>
  );
  return { show, menuItem, panel };
}
