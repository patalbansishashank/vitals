/* ==========================================================================
   <AdherenceDial> (COMPONENTS §13.9) — the day's prescription as a dial of
   arcs weighted by what each item contributes. Never green/red, never a
   sweep to completion, never a streak. Sizes: glyph 16 (arcs only) · sm 64
   (number) · md 120 (number + "so far"/coverage). Quiet mode: empty centre,
   the word under the dial. role="img" + full sentence + hidden table.
   ========================================================================== */
import { memo, useId } from 'react';
import { arcPath, bandOutline, dialArcs, dialSentence } from './adherenceGeometry';
import type { DialItem } from './types';
import './living-charts.css';

export type DialSize = 'glyph' | 'sm' | 'md';

const GEOM: Record<DialSize, { px: number; r: number; band: number; hair: number }> = {
  glyph: { px: 16, r: 6.25, band: 2, hair: 0.75 },
  sm: { px: 64, r: 28, band: 3, hair: 1 },
  md: { px: 120, r: 54, band: 3, hair: 1 },
};

export interface AdherenceDialProps {
  items: readonly DialItem[];
  /** AdherenceScore.score (0–100) or null ("—", not enough logged). */
  score: number | null;
  size?: DialSize;
  /** Confirmed day; false = "so far". */
  final?: boolean;
  /** Coverage line under the number (shown when coverage < 0.6): "based on 3 of 5 items". */
  coverageText?: string | null;
  /** Quiet mode: the centre stays empty and this word sits under the dial. */
  quietWord?: string;
  /** Click on an arc → the checklist row. */
  onArcClick?: (id: string) => void;
  /** Overrides the generated sentence. */
  label?: string;
  className?: string;
}

export const AdherenceDial = memo(function AdherenceDial({ items, score, size = 'sm', final = false, coverageText, quietWord, onArcClick, label, className }: AdherenceDialProps) {
  const g = GEOM[size];
  const c = g.px / 2;
  const arcs = dialArcs(items, g.r, size === 'glyph' ? 1.25 : 2);
  const tableId = useId();
  const sentence = label ?? dialSentence(items, score, { final, ...(quietWord !== undefined ? { quietWord } : {}) });
  const quiet = quietWord !== undefined;
  return (
    <div className={['lmc-dial', className].filter(Boolean).join(' ')} data-size={size}>
      <svg className="lmc-dial__svg" width={g.px} height={g.px} viewBox={`0 0 ${g.px} ${g.px}`} role="img" aria-label={sentence} aria-describedby={size === 'glyph' ? undefined : tableId}>
        <circle className="lmc-dial__hair" cx={c} cy={c} r={g.r} strokeWidth={g.hair * 0.75} />
        {arcs.map((a) => {
          const click = onArcClick ? () => onArcClick(a.id) : undefined;
          const title = a.detail ?? a.label;
          if (a.state === 'unknown') {
            return (
              <path key={a.id} className="lmc-dial__arc" data-state="unknown" d={arcPath(c, c, g.r, a.start, a.end)} strokeWidth={g.hair} strokeDasharray={size === 'glyph' ? '1 1' : '2 2'} onClick={click} data-arc={a.id}>
                <title>{title}</title>
              </path>
            );
          }
          if (a.state === 'done') {
            return (
              <path key={a.id} className="lmc-dial__arc" data-state="done" d={arcPath(c, c, g.r, a.start, a.end)} strokeWidth={g.band} onClick={click} data-arc={a.id}>
                <title>{title}</title>
              </path>
            );
          }
          const split = a.state === 'partial' ? (a.split ?? a.start) : a.start;
          return (
            <g key={a.id} className="lmc-dial__arc" data-state={a.state} onClick={click} data-arc={a.id}>
              <title>{title}</title>
              {split > a.start ? <path className="lmc-dial__ink" d={arcPath(c, c, g.r, a.start, split)} strokeWidth={g.band} /> : null}
              {size === 'glyph' ? (
                <path className="lmc-dial__hollow-line" d={arcPath(c, c, g.r, split, a.end)} strokeWidth={g.hair} />
              ) : (
                <path className="lmc-dial__hollow" d={bandOutline(c, c, g.r, g.band + 1, split, a.end)} strokeWidth={1} />
              )}
            </g>
          );
        })}
      </svg>
      {size !== 'glyph' && !quiet ? (
        <div className="lmc-dial__centre" aria-hidden="true">
          <span className="lmc-dial__num">{score === null ? '—' : Math.round(score)}</span>
          {size === 'md' ? <span className="lmc-dial__sub">{score === null ? 'not enough logged' : final ? 'final' : 'so far'}</span> : null}
        </div>
      ) : null}
      {quiet && size !== 'glyph' ? <span className="lmc-dial__word">{quietWord}</span> : null}
      {coverageText && size !== 'glyph' ? <span className="lmc-dial__coverage">{coverageText}</span> : null}
      {size !== 'glyph' ? (
        <div className="lm-sr">
          <table id={tableId}>
            <caption>Items of the day</caption>
            <thead>
              <tr>
                <th scope="col">item</th>
                <th scope="col">share of the day</th>
                <th scope="col">counted</th>
              </tr>
            </thead>
            <tbody>
              {arcs.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.label}</th>
                  <td>{Math.round(a.share * 100)} %</td>
                  <td>{a.credit === null ? 'not logged' : `${Math.round(a.credit * 100)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
});
