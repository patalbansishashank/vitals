import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './lib/cx';
import { Icon, type IconComponent } from './icons/Icon';
import type { Severity } from './Notice';
import { domainToken, type Domain, type DomainName } from './domain';

/** The 8 metric families; each wears its (warm, desaturated) hue everywhere (DESIGN_DIRECTION §3.2). */
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

/**
 * CSS colour for a domain's SOLID (marks: an icon, a dot, a bar, a tick), sitting beside `categoryColor` for the cards
 * that are not a metric category (plan, food, steps, sleep …). `plan` is gold (`--lm-signal`); `neutral` is ink. The
 * soft ink tint, the glow core and the unlit remainder are `--lm-hue-<domain>-ink|deep|dim`, or `--lm-ink-h`,
 * `--lm-deep` and `--lm-dim` inside a `data-domain` element (`domainToken(domain, role)` gives any of the four). Text
 * never wears the solid. The type is `Domain` (src/components/domain.ts: the eight hues, `plan` and `neutral`).
 */
export const domainColor = (d: Domain): string => domainToken(d, 'solid');

export interface SwatchProps {
  /** Category hue, a domain hue, or any token colour string. */
  category?: MetricCategory;
  domain?: DomainName;
  color?: string;
  /** `line` 10×3 (line metrics) · `square` 8×8 (bar metrics) · `dash` (second metric in a category). */
  shape?: 'line' | 'square' | 'dash';
  className?: string;
}

/** The metric key glyph used in chips, lanes, legends and readouts. Decorative. */
export function Swatch({ category, domain, color, shape = 'line', className }: SwatchProps) {
  return (
    <i
      className={cx('lm-swatch', className)}
      data-shape={shape === 'line' ? undefined : shape}
      style={{ color: color ?? (category ? categoryColor(category) : domain ? domainColor(domain) : 'var(--lm-ink)') } as CSSProperties}
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
    | { kind: 'domain'; domain: DomainName; onClick?: () => void }
    | { kind: 'filter'; pressed: boolean; onPressedChange: (pressed: boolean) => void }
    | { kind: 'status'; severity: Severity; onClick?: () => void }
  );

/**
 * A pill: a 22 px tag when it only reads, 28 px with a 1 px hairline when it acts (r071: pills, like the primary key).
 * `plain`, `metric` (category swatch), `domain` (a 6 px dot in the domain's solid, `domainColor`: the words stay
 * stone, the colour is on the mark only), `filter` (toggle — pressed = gold wash + gold edge), `status` (a 6 px dot in
 * the severity colour + label, stone text). Add `onRemove` for a removable chip. For a header state use
 * `StatusCapsule`.
 */
export function Chip(props: ChipProps) {
  const { children, icon, onRemove, removeLabel, className, disabled } = props;
  const lead =
    props.kind === 'metric' ? (
      <Swatch category={props.category} shape={props.swatch} />
    ) : props.kind === 'status' ? (
      <span className="lm-chip__dot" aria-hidden="true" />
    ) : props.kind === 'domain' ? (
      <span className="lm-chip__dot" aria-hidden="true" style={{ '--lm-chip-hue': domainColor(props.domain) } as CSSProperties} />
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

  const severity = props.kind === 'status' ? props.severity : undefined;
  const onClick = 'onClick' in props ? props.onClick : undefined;
  if (onClick && !onRemove) {
    return (
      <button type="button" className={cx('lm-chip', className)} data-kind={props.kind ?? 'plain'} data-severity={severity} onClick={onClick} disabled={disabled}>
        {lead}
        {text}
      </button>
    );
  }
  return (
    <span
      className={cx('lm-chip', className)}
      data-kind={props.kind ?? 'plain'}
      data-severity={severity}
      data-removable={onRemove ? 'true' : undefined}
      aria-disabled={disabled || undefined}
    >
      {lead}
      {text}
      {remove}
    </span>
  );
}
