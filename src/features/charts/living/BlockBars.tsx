/* ==========================================================================
   <BlockBars> (CHART_SPEC §7.9) — adherence per block of the plan for the
   week (training · protein · energy · fasting · steps): horizontal 0–100
   bars, 8 px well track with an ink fill to the mean, printed ticks at
   0 / 50 / 100 with the numerals once under the bars, the value at the end
   ("84"; nothing logged → "not logged"). No target line at 100 — a full bar
   is not a goal to close. The costliest item is named in text underneath.
   Quiet mode: words instead of numbers, no numerals on the scale.
   ========================================================================== */
import { memo, type ReactNode } from 'react';
import { Engraved } from '@/components';
import { quietScoreWord } from './trend';
import type { BlockBar } from './types';
import './living-charts.css';

export interface BlockBarsProps {
  bars: readonly BlockBar[];
  /** The item that cost the most this week, as a sentence from the source ("Thursday's lift carried 30 % and was skipped twice"). */
  costliest?: string;
  /** Quiet mode: value words ("mostly") instead of numbers; the scale keeps its ticks without numerals. */
  quiet?: boolean;
  /** Overrides the quiet vocabulary (default ≥ 85 "as planned" · 60–84 "mostly" · 30–59 "partly" · < 30 "a little"). */
  quietWord?: (mean: number) => string;
  /** Engraved caption above the bars, lowercase ("this week"). */
  caption?: ReactNode;
  className?: string;
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/** What a bar says at its end: "84", "not logged", or the quiet word. */
export function blockValueText(bar: BlockBar, opts: { quiet?: boolean; quietWord?: (mean: number) => string } = {}): string {
  if (bar.mean === null || !Number.isFinite(bar.mean)) return 'not logged';
  if (opts.quiet) return (opts.quietWord ?? ((m: number) => quietScoreWord(m)))(bar.mean);
  return String(Math.round(bar.mean));
}

const SCALE = [0, 50, 100] as const;

export const BlockBars = memo(function BlockBars({ bars, costliest, quiet = false, quietWord, caption, className }: BlockBarsProps) {
  return (
    <div className={['lmc-bb', className].filter(Boolean).join(' ')} data-quiet={quiet ? 'true' : undefined}>
      {caption ? <div className="lmc-bb__cap">{typeof caption === 'string' ? <Engraved>{caption}</Engraved> : caption}</div> : null}
      <ul className="lmc-bb__list" aria-label="Adherence by part of the plan">
        {bars.map((b) => {
          const known = b.mean !== null && Number.isFinite(b.mean);
          const text = blockValueText(b, { quiet, ...(quietWord ? { quietWord } : {}) });
          return (
            <li key={b.id} className="lmc-bb__row" data-known={known ? 'true' : 'false'}>
              <span className="lmc-bb__label">{b.label}</span>
              <span className="lmc-bb__track" aria-hidden="true">
                {known ? <span className="lmc-bb__fill" style={{ width: `${clamp100(b.mean!)}%` }} /> : null}
                {SCALE.map((t) => (
                  <i key={t} className="lmc-bb__tick" style={{ left: `${t}%` }} />
                ))}
              </span>
              <span className="lmc-bb__value">
                {text}
                {known && !quiet ? <span className="lm-sr"> out of 100</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="lmc-bb__scale" aria-hidden="true">
        <span />
        <span className="lmc-bb__nums">
          {!quiet
            ? SCALE.map((t) => (
                <b key={t} style={{ left: `${t}%` }}>
                  {t}
                </b>
              ))
            : null}
        </span>
        <span />
      </div>
      {costliest ? (
        <p className="lmc-bb__cost">
          <Engraved>cost the most</Engraved> <span>{costliest}</span>
        </p>
      ) : null}
    </div>
  );
});
