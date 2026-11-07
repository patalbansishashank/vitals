import type { ComponentPropsWithoutRef, CSSProperties } from 'react';
import { cx } from './lib/cx';

export interface PageProps extends ComponentPropsWithoutRef<'div'> {
  /**
   * @deprecated r068 U5: no page has a max-width any more; `narrow` is accepted and ignored. Long prose caps its own
   * paragraphs (`--lm-measure-prose`).
   */
  width?: 'full' | 'narrow';
  /** Lay the page's children out as one column, `--lm-stack` (16 px) apart (the same as wrapping them in `<Stack>`). */
  stack?: boolean;
}

/**
 * The content column under the top bar: the full width beside the sidebar, inside the page gutters (16 px phones,
 * 24 px from 1024 px). No max-width (r068 U5).
 */
export function Page({ width = 'full', stack = false, className, ...rest }: PageProps) {
  return <div className={cx('lm-page', className)} data-width={width} data-stack={stack || undefined} {...rest} />;
}

export interface StackProps extends ComponentPropsWithoutRef<'div'> {
  /** `page` 16 px between cards and sections (default) · `card` 12 px between blocks inside a card · `row` 8 px. */
  gap?: 'page' | 'card' | 'row';
}

/** One column of cards or sections with the system's spacing (`.lm-stack`). The default page layout. */
export function Stack({ gap = 'page', className, ...rest }: StackProps) {
  return <div className={cx('lm-stack', className)} data-gap={gap === 'page' ? undefined : gap} {...rest} />;
}

export interface ColumnsProps extends ComponentPropsWithoutRef<'div'> {
  /** The width from which the two columns show; below it they stack as one. `lg` 1024 px (default) · `md` 768 · `xl` 1280. */
  from?: 'md' | 'lg' | 'xl';
  /** The split: `equal` (default) · `wide-start` 3 : 2 · `wide-end` 2 : 3. */
  ratio?: 'equal' | 'wide-start' | 'wide-end';
  /** `start` (default): each column as tall as its content · `stretch`: both columns as tall as the row. */
  align?: 'start' | 'stretch';
}

/**
 * An explicit two-column grid (`.lm-cols`), `--lm-stack` apart, that collapses to one column below `from`. Use it only
 * where two columns read better (a chart beside its table, a list beside its detail); every other page is one column.
 * Put a `<Stack>` in each column when a column holds several cards.
 */
export function Columns({ from = 'lg', ratio = 'equal', align = 'start', className, ...rest }: ColumnsProps) {
  return (
    <div
      className={cx('lm-cols', className)}
      data-from={from}
      data-ratio={ratio === 'equal' ? undefined : ratio}
      data-align={align === 'start' ? undefined : align}
      {...rest}
    />
  );
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
