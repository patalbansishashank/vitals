import type { CSSProperties } from 'react';
import type { DifficultyBreakdown } from '@/engine/planner/domain/types';
import { BURDEN_TIGHT, PAST_LIMIT, burdenRows, effortFooter, effortHeader } from '../ladder';

export interface BurdenScaleProps {
  difficulty: DifficultyBreakdown;
  /** Card size: 6 px bars, text truncated to the value (full text in the Overview tab). */
  compact?: boolean;
  /** The Ideal: a value past your limit runs on past the tick as a hatched segment. */
  ideal?: boolean;
  gentle?: boolean;
  /** Overview only: the footer line goes on with "When several limits are tight…". */
  footnote?: boolean;
  /** Header line ("effort 64 / 100 · hardest part: hunger"); off on cards, whose title carries the effort. */
  header?: boolean;
}

/** The fill as a share of the track: a plain percentage string, so equal values draw equal bars on every card. */
export const fillWidth = (value: number): string => `${Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10}%`;

/**
 * BurdenScale (COMPONENTS §13.7, plan-ladder.md §12.1): the seven burdens in fixed order on one scale for every card —
 * the track runs from today's habit (left) to your limit (the tick at its right end), the same width on every card. On
 * the Ideal only, a value past your limit continues past the tick as a hatched segment (at most half a track), and the
 * Ideal reserves that room only when some row needs it. A compact "now · your limit" legend sits above the rows and a
 * footer line says what the effort number is. A description list with the full sentence for screen readers.
 */
export function BurdenScale({ difficulty, compact = false, ideal = false, gentle = false, footnote = false, header = true }: BurdenScaleProps) {
  const rows = burdenRows(difficulty, { ideal, gentle });
  const overflow = rows.some((r) => r.over > 0);
  return (
    <div className="lp-burden" data-size={compact ? 'compact' : 'full'} data-overflow={overflow || undefined}>
      {header ? <p className="lp-burden__head">{effortHeader(difficulty)}</p> : null}
      <p className="lp-burden__legend" aria-hidden="true">
        <span>now</span>
        <i className="lp-burden__legend-track" />
        <span>your limit</span>
        {overflow ? (
          <>
            <i className="lp-burden__legend-over" />
            <span>{PAST_LIMIT}</span>
          </>
        ) : null}
      </p>
      <dl className="lp-burden__rows">
        {rows.map((r) => (
          <div key={r.id} className="lp-burden__row" data-active={r.active || undefined} data-over={r.over > 0 || undefined}>
            <dt className="lp-burden__label">{r.label}</dt>
            <dd className="lp-burden__val">
              {r.active ? (
                <span className="lp-burden__bar" aria-hidden="true">
                  <i className="lp-burden__fill" style={{ width: fillWidth(r.value) } as CSSProperties} />
                  <i className="lp-burden__limit" />
                  {r.over > 0 ? <i className="lp-burden__over" data-capped={r.capped || undefined} style={{ width: fillWidth(r.over) } as CSSProperties} title={PAST_LIMIT} /> : null}
                </span>
              ) : (
                <span className="lp-burden__bar lp-burden__bar--none" aria-hidden="true" />
              )}
              <span className="lp-burden__text" title={compact ? r.text : undefined}>
                {r.text}
                {r.over > 0 ? <span className="lm-sr">{` (${PAST_LIMIT})`}</span> : null}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="lp-burden__foot">
        {effortFooter(difficulty)}
        {footnote ? ` ${BURDEN_TIGHT}` : null}
      </p>
    </div>
  );
}
