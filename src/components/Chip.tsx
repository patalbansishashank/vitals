import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import { StatusMark, type Severity } from './Notice';

/** The 8 metric families; each wears its hue everywhere (DESIGN_DIRECTION §3.2). */
export type MetricCategory = 'body' | 'fuel' | 'energy' | 'cellular' | 'performance' | 'recovery' | 'cardio' | 'hormones';

export const CATEGORY_LABEL: Record<MetricCategory, string> = {
  body: 'body composition',
  fuel: 'fuel & ketosis',
  energy: 'energy & metabolism',
  cellular: 'cellular signalling',
  performance: 'performance & training',
  recovery: 'recovery & wellbeing',
  cardio: 'cardiometabolic',
  hormones: 'hormones & appetite',
};

/** CSS colour for a category (reads the token, so it re-themes). */
export const categoryColor = (c: MetricCategory): string => `var(--lm-cat-${c})`;

export interface SwatchProps {
  /** Category hue, or any token colour string. */
  category?: MetricCategory;
  color?: string;
  /** `line` 10×3 (line metrics) · `square` 8×8 (bar metrics) · `dash` (second metric in a category). */
  shape?: 'line' | 'square' | 'dash';
  className?: string;
}

/** The metric key glyph used in chips, lanes, legends and readouts. Decorative. */
export function Swatch({ category, color, shape = 'line', className }: SwatchProps) {
  return (
    <i
      className={cx('lm-swatch', className)}
      data-shape={shape === 'line' ? undefined : shape}
      style={{ color: color ?? (category ? categoryColor(category) : 'var(--lm-ink)') } as CSSProperties}
      aria-hidden="true"
    />
  );
}

interface ChipBase {
  children: ReactNode;
  icon?: IconComponent;
  /** Trailing × that calls this (24 px hit area). */
  onRemove?: () => void;
  /** Accessible name for the remove key, e.g. "Remove fat mass". */
  removeLabel?: string;
  className?: string;
  disabled?: boolean;
}

export type ChipProps = ChipBase &
  (
    | { kind?: 'plain'; onClick?: () => void }
    | { kind: 'metric'; category: MetricCategory; swatch?: SwatchProps['shape']; onClick?: () => void }
    | { kind: 'filter'; pressed: boolean; onPressedChange: (pressed: boolean) => void }
    | { kind: 'status'; severity: Severity; onClick?: () => void }
  );

/**
 * 24 px chip: `plain`, `metric` (category swatch), `filter` (toggle — pressed =
 * ink fill), `status` (severity mark + label; achromatic surface, colour on the
 * mark only). Add `onRemove` for a removable chip.
 */
export function Chip(props: ChipProps) {
  const { children, icon, onRemove, removeLabel, className, disabled } = props;
  const lead =
    props.kind === 'metric' ? (
      <Swatch category={props.category} shape={props.swatch} />
    ) : props.kind === 'status' ? (
      <StatusMark severity={props.severity} size={16} />
    ) : icon ? (
      <Icon icon={icon} size={16} />
    ) : null;

  const text = <span className="lm-chip__text">{children}</span>;
  const remove = onRemove ? (
    <button type="button" className="lm-chip__remove" aria-label={removeLabel ?? 'Remove'} onClick={onRemove} disabled={disabled}>
      <Icon icon={X} size={14} />
    </button>
  ) : null;

  if (props.kind === 'filter') {
    return (
      <button
        type="button"
        className={cx('lm-chip', className)}
        data-kind="filter"
        aria-pressed={props.pressed}
        disabled={disabled}
        onClick={() => props.onPressedChange(!props.pressed)}
      >
        {lead}
        {text}
      </button>
    );
  }

  const onClick = 'onClick' in props ? props.onClick : undefined;
  if (onClick && !onRemove) {
    return (
      <button type="button" className={cx('lm-chip', className)} data-kind={props.kind ?? 'plain'} onClick={onClick} disabled={disabled}>
        {lead}
        {text}
      </button>
    );
  }
  return (
    <span className={cx('lm-chip', className)} data-kind={props.kind ?? 'plain'} data-removable={onRemove ? 'true' : undefined} aria-disabled={disabled || undefined}>
      {lead}
      {text}
      {remove}
    </span>
  );
}
