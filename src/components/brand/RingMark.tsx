import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { useReducedMotion } from '../lib/hooks';
import { CENTRE, CROP_VIEWBOX, cutFor, PALETTE, SMALL_CUT_MAX_PX, MEDIUM_CUT_MAX_PX, trimOffset } from './geometry';
import './brand.css';

export type RingMarkTone = 'auto' | 'light' | 'dark' | 'mono';

export interface RingMarkProps {
  /**
   * Visible size in px (the viewBox is cropped to the ring, so 22 draws a 22 px ring). 22 sits beside the 19 px
   * wordmark; the cut gets heavier at 40 px and under and again at 24 and under.
   */
  size?: number;
  /**
   * `auto` (default) reads the Ember tokens: an ivory ring and bezel (--lm-ink) and a gold dot (--lm-signal), no edge
   * (the app is dark only). `light` / `dark` are the fixed palette of the shipped brand files for a known ground;
   * `mono` draws everything in currentColor.
   */
  tone?: RingMarkTone;
  /** Accessible name. Omit for a decorative mark (aria-hidden). */
  title?: string;
  className?: string;
  /** Play the draw-on once on mount (the ring draws round its bezel, the dot pops). Reduced motion shows the still mark. */
  animate?: boolean;
}

const colours = (tone: RingMarkTone) => {
  if (tone === 'mono') return { ink: 'currentColor', signal: 'currentColor', edge: null };
  if (tone === 'auto') return { ink: 'var(--lm-ink)', signal: 'var(--lm-signal)', edge: null };
  return PALETTE[tone];
};

const cutName = (size: number) => (size <= SMALL_CUT_MAX_PX ? 'small' : size <= MEDIUM_CUT_MAX_PX ? 'medium' : 'standard');

/**
 * The Vitals mark, the plan ring: an ivory ring open at four o'clock over a hairline bezel, and a gold dot inside
 * aimed at the opening (the next thing to do). Drawn from mark-geometry.ts, the same numbers as every icon.
 */
export function RingMark({ size = 22, tone = 'auto', title, className, animate: wantAnimate = false }: RingMarkProps) {
  const c = cutFor(size);
  const col = colours(tone);
  // Still mark under reduced motion (brand.css stills it too, for the moment before the settings override is read).
  const reduced = useReducedMotion();
  const animate = wantAnimate && !reduced;
  const style = animate ? ({ '--lm-ringmark-len': c.ring.length, '--lm-ringmark-trim': trimOffset(c) } as CSSProperties) : undefined;
  return (
    <svg
      className={cx('lm-ringmark', className)}
      data-cut={cutName(size)}
      data-tone={tone}
      data-animate={animate || undefined}
      viewBox={CROP_VIEWBOX}
      width={size}
      height={size}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {c.track ? (
        <circle
          className="lm-ringmark__track"
          cx={CENTRE}
          cy={CENTRE}
          r={c.track.r}
          fill="none"
          stroke={col.ink}
          strokeWidth={c.track.stroke}
          strokeOpacity={c.track.opacity}
        />
      ) : null}
      <path
        className="lm-ringmark__ring"
        d={c.ring.d}
        fill="none"
        stroke={col.ink}
        strokeWidth={c.ring.stroke}
        strokeLinecap="round"
        strokeDasharray={animate ? c.ring.length : undefined}
      />
      <circle
        className="lm-ringmark__dot"
        cx={c.dot.cx}
        cy={c.dot.cy}
        r={c.dot.r}
        fill={col.signal}
        stroke={col.edge ?? undefined}
        strokeWidth={col.edge ? c.dot.edge : undefined}
      />
    </svg>
  );
}
