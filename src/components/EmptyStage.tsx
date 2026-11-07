import type { ReactNode } from 'react';
import { cx } from './lib/cx';

/** A 40 px line illustration (a tiny raster with a paint stroke, ink-3), shown only when passed as `art`. */
export function EmptyRasterArt() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => <rect key={`${r}-${c}`} x={3 + c * 9} y={7 + r * 9} width={7} height={7} rx={1.5} fill={r === 1 && c < 3 ? 'currentColor' : 'none'} fillOpacity={r === 1 && c < 3 ? 0.35 : 0} />),
      )}
      <path d="M4 20.5h24" strokeWidth="2" strokeLinecap="round" />
      <circle cx="30.5" cy="20.5" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export interface EmptyStageProps {
  /** The one fact, as a short sentence (title-m 16/500): "No meals logged". */
  title: ReactNode;
  /** Optional single line (14, stone). Only when the title cannot carry it; never an essay. */
  children?: ReactNode;
  /** The one action (a key: verb + object). */
  action?: ReactNode;
  /** Optional illustration. None by default (one fact + one action); pass `<EmptyRasterArt />` to show one. */
  art?: ReactNode | null;
  /** Heading level for the title. Default h2. */
  titleAs?: 'h2' | 'h3';
  /** @deprecated The perforated stage is gone; this is ignored. */
  perforated?: boolean;
  className?: string;
}

/** Empty state: one fact and one action, left-aligned, no stage, no mascots. */
export function EmptyStage({ title, children, action, art, titleAs = 'h2', perforated: _perforated, className }: EmptyStageProps) {
  const H = titleAs;
  return (
    <div className={cx('lm-empty', className)}>
      {art === null || art === undefined ? null : <div className="lm-empty__art">{art}</div>}
      <H className="lm-empty__title">{title}</H>
      {children ? <p className="lm-empty__body">{children}</p> : null}
      {action ? <div className="lm-empty__action">{action}</div> : null}
    </div>
  );
}

/** Alias from the task brief. */
export const EmptyState = EmptyStage;

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Render n text-line placeholders (last one 60 % wide). */
  lines?: number;
  className?: string;
}

/**
 * Static placeholder block — no shimmer (DESIGN_DIRECTION §3.5). Only for list
 * rows/text that take > 300 ms; charts keep their frame and never use this.
 */
export function Skeleton({ width = '100%', height = 12, lines, className }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <span className={cx('grid gap-2', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="lm-skeleton" style={{ width: i === lines - 1 ? '60%' : width, height }} />
        ))}
      </span>
    );
  }
  return <span className={cx('lm-skeleton', className)} style={{ width, height }} aria-hidden="true" />;
}
