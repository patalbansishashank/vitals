import type { CSSProperties } from 'react';
import { formatNumber, useReveal } from '@/components';
import './intervalBar.css';

export type IntervalSize = 'full' | 'thin';

export interface IntervalBarProps {
  low: number;
  high: number;
  value: number;
  decimals?: number;
  format?: (x: number) => string;
  /** `full` (default): a scale of ticks with the range's two ends printed under it. `thin`: a slim scale for a small cell, the range said by its caller. */
  size?: IntervalSize;
  /** Quiet mode: the picture without a number (no ends, nothing for assistive technology to read). */
  quiet?: boolean;
  /** First view lights the range's ticks and drops the marker in (default true). False renders the final frame at once. */
  animate?: boolean;
}

/** Ticks across the scale: a long one for a hero, a short one for a cell of three. */
const TICKS: Record<IntervalSize, number> = { full: 41, thin: 25 };

export interface IntervalModel {
  /** The scale's domain: the range with half its width of room on both sides, and the estimate inside it. */
  min: number;
  max: number;
  /** Where a value sits, in percent of the scale (clamped). */
  at: (x: number) => number;
  /** One entry per tick: its place in percent and whether it lies inside the range. */
  ticks: Array<{ pos: number; lit: boolean }>;
}

/** The scale of one estimate and its 80 % range, as a pure model (the component only draws it). */
export function intervalModel(low: number, high: number, value: number, size: IntervalSize = 'full'): IntervalModel {
  const span = Math.max(high - low, Math.abs(value) * 0.02, 1e-9);
  const min = Math.min(low, value) - span * 0.5;
  const max = Math.max(high, value) + span * 0.5;
  const at = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min || 1)) * 100));
  const n = TICKS[size];
  const eps = (max - min) * 1e-6;
  const ticks = Array.from({ length: n }, (_, i) => {
    const pos = (i / (n - 1)) * 100;
    const x = min + (pos / 100) * (max - min);
    return { pos, lit: x >= low - eps && x <= high + eps };
  });
  return { min, max, at, ticks };
}

/**
 * The 80 % range as a scale (r071): ticks across the whole cell, the ticks inside the range lit in the card's hue (or
 * where no card sets one it uses the energy hue), the estimate as a 3 px ivory marker with a soft glow, and the range's two
 * ends printed under it in mono. Quiet: the same picture and no numeral anywhere.
 */
export function IntervalBar({ low, high, value, decimals = 1, format, size = 'full', quiet = false, animate = true }: IntervalBarProps) {
  const [ref, pending] = useReveal<HTMLDivElement>({ animate });
  const m = intervalModel(low, high, value, size);
  const fmt = (x: number) => (format ? format(x) : formatNumber(x, decimals));
  return (
    <div ref={ref} className="lm-body-iv" data-size={size} data-quiet={quiet || undefined} data-reveal={pending ? 'pending' : undefined}>
      <span className="lm-sr">{quiet ? 'the likely range around the estimate' : `likely ${fmt(low)} to ${fmt(high)}`}</span>
      <div className="lm-body-iv__track" aria-hidden="true">
        {m.ticks.map((t, i) => (
          <i key={i} className="lm-body-iv__t" data-lit={t.lit || undefined} style={{ left: `${t.pos}%`, '--i': i } as CSSProperties} />
        ))}
        <span className="lm-body-iv__pt" style={{ left: `${m.at(value)}%` }} />
      </div>
      {quiet || size === 'thin' ? null : (
        <div className="lm-body-iv__ends lm-num" aria-hidden="true">
          <span style={{ left: `${m.at(low)}%` }}>{fmt(low)}</span>
          <span style={{ left: `${m.at(high)}%` }}>{fmt(high)}</span>
        </div>
      )}
    </div>
  );
}
