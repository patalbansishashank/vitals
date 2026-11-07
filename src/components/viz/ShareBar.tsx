/* ==========================================================================
   <ShareBar> (DATAVIZ P8, SPEC A.3.2, restyled r071): parts of a whole, one row
   each: a 6 px dot in the part's hue, the name (14/500), the value (15/500,
   tabular) and the share in mono caps, over a full-pill track (6 px, or 4 px at
   `sm`) filled to the share in that hue. The one primitive behind stage rows,
   zone bars, macro tracks and block bars. Bars are aria-hidden; each item reads
   "Deep, 1 h 08, 14 % of the night". The fills grow from the left on first view
   (transform only, 700 ms, 60 ms apart; `animate`, final markup identical).
   ========================================================================== */
import { useRef, type CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useInView } from '@/app/motion';
import { clamp, speak } from './geometry';
import './viz.css';

export interface ShareBarRow {
  id: string;
  label: string;
  /** "1 h 08", "0 min" */
  valueText: string;
  /** 0..1 */
  share: number;
  /** "14 %"; default the share rounded. */
  shareText?: string;
  /** A token colour, e.g. 'var(--lm-hr-zone-3)'. */
  hue: string;
  /** "Unclassified": minutes no stage or zone was given. */
  unknown?: boolean;
}

export interface ShareBarProps {
  label: string;
  rows: ShareBarRow[];
  /** md: 6 px track; sm: 4 px. */
  size?: 'md' | 'sm';
  /** A fact under the rows ("Incomplete night: 82 % named"). */
  note?: string;
  /** What the share is of, spoken: "of the night". Default "of the total". */
  shareOf?: string;
  quiet?: boolean;
  state?: 'normal' | 'loading';
  /** (r071) Grow the fills in on first view (default true); false and reduced motion draw the final frame at once. */
  animate?: boolean;
  className?: string;
}

/** "14 %" (no-break space), from a 0..1 share. */
export const shareText = (row: Pick<ShareBarRow, 'share' | 'shareText'>): string => row.shareText ?? `${formatNumber(Math.round(clamp(row.share, 0, 1) * 100))}\u00a0%`;

/** "Deep, 1 h 08, 14 % of the night". Quiet: the name and its share in words. */
export function spokenShare(row: ShareBarRow, shareOf = 'of the total', quiet = false): string {
  if (quiet) {
    const s = clamp(row.share, 0, 1);
    const w = s === 0 ? 'none' : s < 0.1 ? 'a small part' : s < 0.34 ? 'some' : s < 0.67 ? 'a large part' : 'most';
    return `${row.label}, ${w} ${shareOf}`;
  }
  return speak(`${row.label}, ${row.valueText}, ${shareText(row)} ${shareOf}`);
}

export function ShareBar({ label, rows, size = 'md', note, shareOf = 'of the total', quiet = false, state = 'normal', animate = true, className }: ShareBarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref);
  const pending = animate && !inView;
  return (
    <div ref={ref} className={cx('lmv lmv-share', className)} data-size={size} data-state={state} data-reveal={pending ? 'pending' : undefined} aria-busy={state === 'loading' || undefined}>
      <ul className="lmv-share__list" aria-label={label}>
        {rows.map((row, i) => {
          const pct = clamp(row.share, 0, 1) * 100;
          return (
            <li key={row.id} className="lmv-share__row" style={{ '--lmv-i': i } as CSSProperties} data-unknown={row.unknown || undefined} data-zero={pct === 0 || undefined}>
              <span className="lm-sr">{state === 'loading' ? `${row.label}, loading` : spokenShare(row, shareOf, quiet)}</span>
              <span className="lmv-share__line" aria-hidden="true">
                <span className="lmv-share__sw" style={{ background: row.unknown ? undefined : row.hue }} />
                <span className="lmv-share__name">{row.label}</span>
                {quiet || state === 'loading' ? null : (
                  <>
                    <span className="lmv-share__value">{row.valueText}</span>
                    <span className="lmv-share__pct lm-mono">{shareText(row)}</span>
                  </>
                )}
              </span>
              <span className="lmv-share__track" aria-hidden="true">
                {state === 'loading' || pct === 0 ? null : <span className="lmv-share__fill" style={{ width: `${pct}%`, background: row.unknown ? undefined : row.hue }} />}
              </span>
            </li>
          );
        })}
      </ul>
      {note ? <p className="lmv-note">{note}</p> : null}
    </div>
  );
}
