/* ==========================================================================
   The chart skin of the SVG charts (r071, AUDIT §1.4 "Charts: visual layer"): what TrendLane, ScoreHistory, the
   adherence calendar and dial, BlockBars and Progress's LaneChart share, so they read as one family beside the canvas
   lanes (core/draw.ts draws the same marks on a canvas).

   - One hue per chart. `chartHue('body')` is `categoryColor` for a metric category and `domainColor` for a domain
     (plan, food, steps, sleep ...), both read from the tokens, so it re-themes. A chart sets it as `--lmc-hue`;
     everything the skin draws reads that variable and never a hex.
   - The line is the hue (`--lmc-line`), except on a card with a glow, where the focal marks are ivory (RESEARCH §3.2:
     the energy solid falls to 1.8:1 on its own glow, the others to about 3:1). There the hue lives in the glow, the
     band, the area and the dot's halo. The rule is one selector in living-charts.css.
   - The end dot: a hue (or ivory) fill, a 2 px surface ring, a flat halo and one soft glow; on a hero chart it pulses
     twice (2.4 s each, 4.8 s in all, under WCAG 2.2.2) after the line has drawn, then rests. Never under reduced motion,
     forced colours or more contrast.
   - First view: the data group wipes in left to right (a clip reveal, 700 ms). `useReveal` holds `data-reveal="pending"`
     on the chart until 20 % of it is in view, so the CSS can hide the group; a chart that cannot animate (reduced
     motion, jsdom, `animate={false}`) is never pending and renders its final markup from the first frame.
   ========================================================================== */
import { useEffect, useState } from 'react';
import { categoryColor, domainColor, useMotionEnabled, type DomainName, type MetricCategory } from '@/components';

/** What a chart can wear: a metric category (`body`, `cardio` ...) or a domain (`plan`, `steps`, `sleep` ...). */
export type ChartHue = MetricCategory | DomainName;

const CATEGORIES: ReadonlySet<string> = new Set<MetricCategory>(['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones']);

/** A metric category is read through `categoryColor`, anything else through `domainColor`. */
export const isMetricCategory = (h: string): h is MetricCategory => CATEGORIES.has(h);

/** The CSS colour of a chart's hue, as a token reference (`var(--lm-cat-body)`, `var(--lm-signal)` for `plan`). */
export function chartHue(hue: ChartHue | undefined, fallback: ChartHue = 'body'): string {
  const h = hue ?? fallback;
  return isMetricCategory(h) ? categoryColor(h) : domainColor(h);
}

/** One 2.4 s pulse; `--lm-pulse-cycles` (2) of them make 4.8 s. */
export const PULSE_MS = 2400;
/** The clip reveal of the data group, in ms (`--lmc-draw` in the stylesheet). */
export const DRAW_MS = 700;

/**
 * Whether the end dot is pulsing: from the moment the chart has been revealed (`pending` false) for two pulses, then
 * for good. False where motion cannot run. State is set only from the timer's callback.
 */
export function usePulseAfterReveal(pending: boolean, enabled: boolean, animate = true): boolean {
  const motion = useMotionEnabled(animate);
  const [done, setDone] = useState(false);
  const on = enabled && motion;
  useEffect(() => {
    if (pending || !on) return;
    const stop = window.setTimeout(() => setDone(true), DRAW_MS + 2 * PULSE_MS);
    return () => window.clearTimeout(stop);
  }, [pending, on]);
  return on && !pending && !done;
}

export interface EndDotProps {
  x: number;
  y: number;
  /** Dot radius: 5 on a hero chart, 3.5 on a small one. */
  r?: number;
  /** A pulsing ring around the dot (the hero chart's first seconds). */
  pulse?: boolean;
  /** An estimate, not a reading: the dot is hollow. */
  hollow?: boolean;
}

/** The end of the line: halo, soft glow, surface ring and dot. Decorative (`aria-hidden` through its svg). */
export function EndDot({ x, y, r = 5, pulse = false, hollow = false }: EndDotProps) {
  return (
    <g className="lmc-end" data-mark="end" data-hollow={hollow || undefined}>
      <circle className="lmc-end__halo" cx={x} cy={y} r={r + 6} />
      {pulse ? <circle className="lmc-end__pulse" cx={x} cy={y} r={r + 1} /> : null}
      <circle className="lmc-end__ring" cx={x} cy={y} r={r + 1} />
      <circle className="lmc-end__dot" cx={x} cy={y} r={r} />
    </g>
  );
}

export interface SkinGradientsProps {
  /** A prefix that makes the ids unique to one chart (`useId`, sanitised). */
  id: string;
  /** A hue of its own (a token reference) instead of the chart's `--lmc-hue`: one gradient pair per series of a lane. */
  hue?: string;
}

/**
 * The two vertical gradients every SVG chart can use, both in the chart's hue (`--lmc-hue`, read through `stop-color`):
 * `${id}-area` fades from the area's top alpha at the line to nothing at the baseline, `${id}-band` from the band's top
 * alpha to its bottom alpha. The alphas are CSS variables (`--lmc-area-top`, `--lmc-band-top`, `--lmc-band-bottom`), so
 * a card can flatten them. Static: nothing here ever animates (AUDIT §4.2 rule 2).
 */
export function SkinGradients({ id, hue }: SkinGradientsProps) {
  const own = hue ? { stopColor: hue } : undefined;
  return (
    <>
      <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
        <stop className="lmc-grad lmc-grad--area-top" offset="0" style={own} />
        <stop className="lmc-grad lmc-grad--area-end" offset="1" style={own} />
      </linearGradient>
      <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
        <stop className="lmc-grad lmc-grad--band-top" offset="0" style={own} />
        <stop className="lmc-grad lmc-grad--band-end" offset="1" style={own} />
      </linearGradient>
    </>
  );
}
