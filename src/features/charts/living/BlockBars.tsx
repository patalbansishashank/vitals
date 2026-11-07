/* ==========================================================================
   <BlockBars> (CHART_SPEC §7.9) — adherence per block of the plan for the
   week (training · protein · energy · fasting · steps): horizontal 0–100 %
   bars, a 6 px pill track with a gold fill to the mean, the value at the end
   ("84 %"; nothing logged → "Not logged": a gap stays a gap). Labels and
   words in sentence case. No scale, no ticks, no target line at 100 — the
   value says the number, and a full bar is not a goal to close. An optional
   plain line underneath names the biggest gap. Quiet mode: words instead of
   numbers.
   Drawn with the shared <ShareBar> (energy SPEC A.3.3: one primitive, the
   look unchanged): the `.lmc-bb` rules lay its row out as label · track ·
   value and keep the 6 px track, the gold fill and the type of before.
   ========================================================================== */
import { memo, type ReactNode } from 'react';
import { Engraved, ShareBar, type ShareBarRow } from '@/components';
import { chartHue, type ChartHue } from './skin';
import { quietScoreWord } from './trend';
import type { BlockBar } from './types';
import './living-charts.css';

export interface BlockBarsProps {
  bars: readonly BlockBar[];
  /** One plain line under the bars naming the week's biggest gap ("Biggest gap: Thu energy, 1 610 of 2 664 kcal"). */
  costliest?: string;
  /** Quiet mode: value words ("Mostly") instead of numbers. */
  quiet?: boolean;
  /** Overrides the quiet vocabulary (default ≥ 85 "as planned" · 60–84 "mostly" · 30–59 "partly" · < 30 "a little"). */
  quietWord?: (mean: number) => string;
  /** A short label above the bars, sentence case ("This week"). */
  caption?: ReactNode;
  /**
   * (r068 V12) The weakest part of the week stands out: its bar in full gold, the others in a softer gold (only when it
   * is clearly the weakest, 10 points or more under the next).
   */
  markWeakest?: boolean;
  /** (r071) The bars' hue: a category or a domain through `chartHue`. Default `plan` (gold: the plan's own data). */
  hue?: ChartHue;
  className?: string;
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a bar says at its end: "84 %", "not logged", or the quiet word. */
export function blockValueText(bar: BlockBar, opts: { quiet?: boolean; quietWord?: (mean: number) => string } = {}): string {
  if (bar.mean === null || !Number.isFinite(bar.mean)) return 'not logged';
  if (opts.quiet) return (opts.quietWord ?? ((m: number) => quietScoreWord(m)))(bar.mean);
  return `${Math.round(bar.mean)} %`;
}

/**
 * One ShareBar row per block. The visible value is `valueText` ("84 %", "Not logged", "Mostly"); `shareText` carries
 * the spoken tail only ("3 items", or "this week" in quiet mode and for a gap, so quiet mode speaks no digits): each item
 * reads "Training, 84 %, 3 items this week".
 */
/** (r068 V12) The id of the clearly weakest block (10 points or more under the next known one), else null. */
export function weakestBlock(bars: readonly BlockBar[]): string | null {
  const known = bars.filter((b) => b.mean !== null && Number.isFinite(b.mean)).sort((a, b) => a.mean! - b.mean!);
  if (known.length < 2) return null;
  return known[1]!.mean! - known[0]!.mean! >= 10 ? known[0]!.id : null;
}

export function blockRows(bars: readonly BlockBar[], opts: { quiet?: boolean; quietWord?: (mean: number) => string; markWeakest?: boolean; hue?: string } = {}): ShareBarRow[] {
  const weakest = opts.markWeakest ? weakestBlock(bars) : null;
  const base = opts.hue ?? 'var(--lm-signal)';
  return bars.map((b) => {
    const known = b.mean !== null && Number.isFinite(b.mean);
    const text = blockValueText(b, opts);
    const numeric = known && !opts.quiet;
    return {
      id: b.id,
      label: sentence(b.label),
      valueText: numeric ? `${Math.round(b.mean!)}\u00a0%` : sentence(text),
      share: known ? clamp100(b.mean!) / 100 : 0,
      shareText: numeric ? (b.n === 1 ? '1 item' : `${b.n} items`) : '',
      hue: weakest === null || weakest === b.id ? base : `color-mix(in oklab, ${base} 42%, var(--lm-elevated))`,
      ...(known ? {} : { unknown: true }),
    };
  });
}

export const BlockBars = memo(function BlockBars({ bars, costliest, quiet = false, quietWord, caption, markWeakest = false, hue, className }: BlockBarsProps) {
  return (
    <div className={['lmc-bb', className].filter(Boolean).join(' ')} data-quiet={quiet ? 'true' : undefined}>
      {caption ? <div className="lmc-bb__cap">{typeof caption === 'string' ? <Engraved>{caption}</Engraved> : caption}</div> : null}
      <ShareBar className="lmc-bb__share" label="Adherence by part of the plan" rows={blockRows(bars, { quiet, markWeakest, hue: chartHue(hue, 'plan'), ...(quietWord ? { quietWord } : {}) })} shareOf="this week" />
      {costliest ? <p className="lmc-bb__cost">{costliest}</p> : null}
    </div>
  );
});
