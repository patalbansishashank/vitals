import type { CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { useReducedMotion } from '../lib/hooks';
import { CROP_VIEWBOX, cutFor, PALETTE, SMALL_CUT_MAX_PX, trimOffset } from './geometry';
import './brand.css';

export type RingMarkTone = 'auto' | 'light' | 'dark' | 'mono';

export interface RingMarkProps {
  /**
   * Visible size in px (the viewBox is cropped to the ring, so 22 draws a 22 px ring). 22 sits beside the 19 px
   * wordmark; the cut switches to the heavier small one at 32 and under.
   */
  size?: number;
  /**
   * `auto` follows the theme through the --lm-* tokens (ring ink, signal dot, edge only on light grounds);
   * `light` / `dark` are the fixed palette for a known ground; `mono` draws ring and dot in currentColor.
   */
  tone?: RingMarkTone;
  /** Accessible name. Omit for a decorative mark (aria-hidden). */
  title?: string;
  className?: string;
  /** Play Lumen's draw-on once on mount (ring draws, dot pops). Reduced motion shows the still mark. */
  animate?: boolean;
}

const colours = (tone: RingMarkTone) => {
  if (tone === 'mono') return { ink: 'currentColor', signal: 'currentColor', edge: null };
  if (tone === 'auto') return { ink: 'var(--lm-ink)', signal: 'var(--lm-signal)', edge: 'var(--lm-signal-edge)' };
  return PALETTE[tone];
};

/** The Vitals mark: the open ring and its signal dot, drawn from public/brand/mark.svg's geometry. */
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
      data-cut={size <= SMALL_CUT_MAX_PX ? 'small' : 'standard'}
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
      <path
        className="lm-ringmark__ring"
        d={c.ring.d}
        fill="none"
        stroke={col.ink}
        strokeWidth={c.ring.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
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
