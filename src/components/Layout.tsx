import type { ComponentPropsWithoutRef, CSSProperties } from 'react';
import { cx } from './lib/cx';

export interface PageProps extends ComponentPropsWithoutRef<'div'> {
  /** `narrow` caps the column at ~760 px (settings, prose); default is the 1440 content max. */
  width?: 'full' | 'narrow';
}

/** The content column under the context bar: 16 px gutters on mobile, 24 px on desktop, max 1440. */
export function Page({ width = 'full', className, ...rest }: PageProps) {
  return <div className={cx('lm-page', className)} data-width={width} {...rest} />;
}

export interface ScrollRailProps extends ComponentPropsWithoutRef<'div'> {
  /** Gap between cells in px (default 8). */
  gap?: number;
  /**
   * Bleed to the page edge (default): the rail spans the gutter and its
   * scroll-padding equals the gutter so the first cell aligns with the column
   * and the next cell peeks (REVIEW_FINDINGS #7). Set false inside faceplates.
   */
  bleed?: boolean;
  /** Inline padding when not bleeding (e.g. the faceplate's 16 px). */
  padding?: number;
}

/** Horizontal snap rail for mobile strips: readouts, program keys, plan cards, anchor chips. */
export function ScrollRail({ gap = 8, bleed = true, padding, className, style, ...rest }: ScrollRailProps) {
  const vars = {
    '--rail-gap': `${gap}px`,
    ...(padding !== undefined ? { '--rail-pad': `${padding}px` } : null),
    ...style,
  } as CSSProperties;
  return <div className={cx('lm-scroll-rail', className)} data-bleed={bleed} style={vars} {...rest} />;
}

/** Visually hidden but announced by screen readers. */
export function VisuallyHidden({ className, ...rest }: ComponentPropsWithoutRef<'span'>) {
  return <span className={cx('lm-sr', className)} {...rest} />;
}
