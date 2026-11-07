/* ==========================================================================
   Freshness and learning marks (DATAVIZ P11, SPEC A.3.2).
   - <ReadingAge>: "3 min ago" in stone; past the stale rule it adds the 6 px
     gold stale dot (aria-hidden: the row's sentence says "stale").
   - <LearningLine>: the fact line "Learning your baseline · night 3 of 7"
     with a seven-dot fill, never a dashed card (dashes mean provisional).
   ========================================================================== */
import { cx } from '../lib/cx';
import { clamp } from './geometry';
import './viz.css';

export interface ReadingAgeProps {
  /** "3 min ago" */
  ageText: string;
  stale?: boolean;
  className?: string;
}

export function ReadingAge({ ageText, stale = false, className }: ReadingAgeProps) {
  return (
    <span className={cx('lmv-age', className)} data-stale={stale || undefined}>
      {stale ? <span className="lmv-stale-dot" aria-hidden="true" /> : null}
      {ageText}
    </span>
  );
}

export interface LearningLineProps {
  /** Nights so far. */
  nights: number;
  /** Nights needed (7). */
  of: number;
  /** Default "Learning your baseline · night 3 of 7". */
  text?: string;
  className?: string;
}

/** "Learning your baseline · night 3 of 7". */
export const learningText = (nights: number, of: number): string => `Learning your baseline · night ${clamp(Math.round(nights), 0, of)} of ${of}`;

export function LearningLine({ nights, of, text, className }: LearningLineProps) {
  const n = clamp(Math.round(nights), 0, of);
  return (
    <p className={cx('lmv lmv-learning', className)}>
      <span className="lmv-learning__dots" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} data-filled={i < n || undefined} />
        ))}
      </span>
      <span>{text ?? learningText(n, of)}</span>
    </p>
  );
}
